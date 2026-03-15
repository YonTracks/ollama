// Package qwen3 provides a shared Qwen3 text encoder used by multiple image generation models.
package qwen3

import (
	"fmt"
	"log"
	"math"
	"strings"

	"github.com/ollama/ollama/x/imagegen/manifest"
	"github.com/ollama/ollama/x/imagegen/mlx"
	"github.com/ollama/ollama/x/imagegen/nn"
	"github.com/ollama/ollama/x/imagegen/safetensors"
	"github.com/ollama/ollama/x/imagegen/tokenizer"
)

// Config holds Qwen3 text encoder configuration
type Config struct {
	HiddenSize        int32   `json:"hidden_size"`
	NumHiddenLayers   int32   `json:"num_hidden_layers"`
	IntermediateSize  int32   `json:"intermediate_size"`
	NumAttentionHeads int32   `json:"num_attention_heads"`
	NumKeyValueHeads  int32   `json:"num_key_value_heads"`
	VocabSize         int32   `json:"vocab_size"`
	RMSNormEps        float32 `json:"rms_norm_eps"`
	RopeTheta         float32 `json:"rope_theta"`
	HeadDim           int32   `json:"head_dim"`
}

// Attention implements Qwen3 attention with QK norms
type Attention struct {
	QProj nn.LinearLayer `weight:"q_proj"`
	KProj nn.LinearLayer `weight:"k_proj"`
	VProj nn.LinearLayer `weight:"v_proj"`
	OProj nn.LinearLayer `weight:"o_proj"`
	QNorm *nn.RMSNorm    `weight:"q_norm"`
	KNorm *nn.RMSNorm    `weight:"k_norm"`
	// Computed fields
	NHeads    int32
	NKVHeads  int32
	HeadDim   int32
	Scale     float32
	RopeTheta float32
}

// applyRoPEQwen3 applies the custom RoPE for Qwen3 text encoder
func applyRoPEQwen3(x *mlx.Array, seqLen int32, theta float32) *mlx.Array {
	log.Printf("DEBUG applyRoPEQwen3: entered seqLen=%d theta=%f", seqLen, theta)

	if x == nil {
		log.Printf("DEBUG applyRoPEQwen3: x is nil")
		panic("applyRoPEQwen3: x is nil")
	}

	shape := x.Shape()
	log.Printf("DEBUG applyRoPEQwen3: x.Shape() = %#v", shape)

	if len(shape) == 0 {
		panic("applyRoPEQwen3: x.Shape() returned empty slice")
	}
	if len(shape) < 4 {
		panic(fmt.Sprintf("applyRoPEQwen3: expected rank-4 tensor, got shape=%#v", shape))
	}

	B := shape[0]
	L := shape[1]
	H := shape[2]
	D := shape[3]

	log.Printf("DEBUG applyRoPEQwen3: B=%d L=%d H=%d D=%d", B, L, H, D)

	if D <= 0 {
		panic(fmt.Sprintf("applyRoPEQwen3: invalid D=%d", D))
	}
	if D%2 != 0 {
		panic(fmt.Sprintf("applyRoPEQwen3: D must be even, got D=%d", D))
	}
	if seqLen <= 0 {
		panic(fmt.Sprintf("applyRoPEQwen3: seqLen must be > 0, got %d", seqLen))
	}
	if L != seqLen {
		log.Printf("DEBUG applyRoPEQwen3: WARNING L (%d) != seqLen (%d)", L, seqLen)
	}

	half := D / 2
	log.Printf("DEBUG applyRoPEQwen3: half=%d", half)

	freqsArr := make([]float32, half)
	logTheta := float32(math.Log(float64(theta)))
	for i := int32(0); i < half; i++ {
		freqsArr[i] = float32(math.Exp(float64(-logTheta * float32(i) / float32(half))))
	}
	freqs := mlx.NewArray(freqsArr, []int32{half})
	log.Printf("DEBUG applyRoPEQwen3: freqs.Shape() = %#v", freqs.Shape())

	posArr := make([]float32, seqLen)
	for i := int32(0); i < seqLen; i++ {
		posArr[i] = float32(i)
	}
	pos := mlx.NewArray(posArr, []int32{seqLen})
	log.Printf("DEBUG applyRoPEQwen3: pos.Shape() = %#v", pos.Shape())

	posExpanded := mlx.Reshape(pos, seqLen, 1)
	log.Printf("DEBUG applyRoPEQwen3: posExpanded.Shape() = %#v", posExpanded.Shape())

	freqsExpanded := mlx.Reshape(freqs, 1, half)
	log.Printf("DEBUG applyRoPEQwen3: freqsExpanded.Shape() = %#v", freqsExpanded.Shape())

	args := mlx.Mul(posExpanded, freqsExpanded)
	log.Printf("DEBUG applyRoPEQwen3: args.Shape() = %#v", args.Shape())

	cosVals := mlx.Cos(args)
	log.Printf("DEBUG applyRoPEQwen3: cosVals pre-reshape Shape() = %#v", cosVals.Shape())

	sinVals := mlx.Sin(args)
	log.Printf("DEBUG applyRoPEQwen3: sinVals pre-reshape Shape() = %#v", sinVals.Shape())

	cosVals = mlx.Reshape(cosVals, seqLen, 1, half)
	log.Printf("DEBUG applyRoPEQwen3: cosVals.Shape() = %#v", cosVals.Shape())

	sinVals = mlx.Reshape(sinVals, seqLen, 1, half)
	log.Printf("DEBUG applyRoPEQwen3: sinVals.Shape() = %#v", sinVals.Shape())

	x1 := mlx.Slice(x, []int32{0, 0, 0, 0}, []int32{B, L, H, half})
	log.Printf("DEBUG applyRoPEQwen3: x1.Shape() = %#v", x1.Shape())

	x2 := mlx.Slice(x, []int32{0, 0, 0, half}, []int32{B, L, H, D})
	log.Printf("DEBUG applyRoPEQwen3: x2.Shape() = %#v", x2.Shape())

	part1 := mlx.Sub(mlx.Mul(x1, cosVals), mlx.Mul(x2, sinVals))
	log.Printf("DEBUG applyRoPEQwen3: part1.Shape() = %#v", part1.Shape())

	part2 := mlx.Add(mlx.Mul(x1, sinVals), mlx.Mul(x2, cosVals))
	log.Printf("DEBUG applyRoPEQwen3: part2.Shape() = %#v", part2.Shape())

	out := mlx.Concatenate([]*mlx.Array{part1, part2}, 3)
	log.Printf("DEBUG applyRoPEQwen3: out.Shape() = %#v", out.Shape())

	return out
}

// Forward computes attention with causal masking and optional padding mask
func (attn *Attention) Forward(x *mlx.Array, mask *mlx.Array, maskMode string) *mlx.Array {
	if x == nil {
		panic("Attention.Forward: input x is nil")
	}

	shape := x.Shape()
	log.Printf("DEBUG Attention.Forward: input x.Shape() = %#v", shape)

	if len(shape) < 2 {
		panic(fmt.Sprintf("Attention.Forward: expected input rank >= 2, got shape=%#v", shape))
	}

	B := shape[0]
	L := shape[1]
	log.Printf("DEBUG Attention.Forward: B=%d L=%d NHeads=%d NKVHeads=%d HeadDim=%d RopeTheta=%f",
		B, L, attn.NHeads, attn.NKVHeads, attn.HeadDim, attn.RopeTheta)

	q := attn.QProj.Forward(x)
	log.Printf("DEBUG Attention.Forward: after QProj q.Shape() = %#v", q.Shape())

	k := attn.KProj.Forward(x)
	log.Printf("DEBUG Attention.Forward: after KProj k.Shape() = %#v", k.Shape())

	v := attn.VProj.Forward(x)
	log.Printf("DEBUG Attention.Forward: after VProj v.Shape() = %#v", v.Shape())

	q = mlx.Reshape(q, B, L, attn.NHeads, attn.HeadDim)
	log.Printf("DEBUG Attention.Forward: after q reshape q.Shape() = %#v", q.Shape())

	k = mlx.Reshape(k, B, L, attn.NKVHeads, attn.HeadDim)
	log.Printf("DEBUG Attention.Forward: after k reshape k.Shape() = %#v", k.Shape())

	v = mlx.Reshape(v, B, L, attn.NKVHeads, attn.HeadDim)
	log.Printf("DEBUG Attention.Forward: after v reshape v.Shape() = %#v", v.Shape())

	q = attn.QNorm.Forward(q, 1e-6)
	log.Printf("DEBUG Attention.Forward: after QNorm q.Shape() = %#v", q.Shape())

	k = attn.KNorm.Forward(k, 1e-6)
	log.Printf("DEBUG Attention.Forward: after KNorm k.Shape() = %#v", k.Shape())

	log.Printf("DEBUG Attention.Forward: before applyRoPEQwen3 q.Shape() = %#v", q.Shape())
	q = applyRoPEQwen3(q, L, attn.RopeTheta)
	log.Printf("DEBUG Attention.Forward: after applyRoPEQwen3 q.Shape() = %#v", q.Shape())

	log.Printf("DEBUG Attention.Forward: before applyRoPEQwen3 k.Shape() = %#v", k.Shape())
	k = applyRoPEQwen3(k, L, attn.RopeTheta)
	log.Printf("DEBUG Attention.Forward: after applyRoPEQwen3 k.Shape() = %#v", k.Shape())

	q = mlx.Transpose(q, 0, 2, 1, 3)
	log.Printf("DEBUG Attention.Forward: after q transpose q.Shape() = %#v", q.Shape())

	k = mlx.Transpose(k, 0, 2, 1, 3)
	log.Printf("DEBUG Attention.Forward: after k transpose k.Shape() = %#v", k.Shape())

	v = mlx.Transpose(v, 0, 2, 1, 3)
	log.Printf("DEBUG Attention.Forward: after v transpose v.Shape() = %#v", v.Shape())

	if attn.NKVHeads < attn.NHeads {
		repeats := attn.NHeads / attn.NKVHeads
		log.Printf("DEBUG Attention.Forward: repeating KV heads repeats=%d", repeats)
		k = repeatKV(k, repeats)
		log.Printf("DEBUG Attention.Forward: after repeatKV k.Shape() = %#v", k.Shape())
		v = repeatKV(v, repeats)
		log.Printf("DEBUG Attention.Forward: after repeatKV v.Shape() = %#v", v.Shape())
	}

	out := mlx.ScaledDotProductAttentionWithSinks(q, k, v, attn.Scale, maskMode, mask, nil)
	log.Printf("DEBUG Attention.Forward: after attention out.Shape() = %#v", out.Shape())

	out = mlx.Transpose(out, 0, 2, 1, 3)
	log.Printf("DEBUG Attention.Forward: after out transpose out.Shape() = %#v", out.Shape())

	out = mlx.Reshape(out, B, L, attn.NHeads*attn.HeadDim)
	log.Printf("DEBUG Attention.Forward: after out reshape out.Shape() = %#v", out.Shape())

	out = attn.OProj.Forward(out)
	log.Printf("DEBUG Attention.Forward: after OProj out.Shape() = %#v", out.Shape())

	return out
}

// repeatKV repeats key/value heads for GQA
func repeatKV(x *mlx.Array, repeats int32) *mlx.Array {
	if repeats == 1 {
		return x
	}
	shape := x.Shape()
	x = mlx.ExpandDims(x, 2)
	x = mlx.Tile(x, []int32{1, 1, repeats, 1, 1})
	return mlx.Reshape(x, shape[0], shape[1]*repeats, shape[2], shape[3])
}

// MLP implements Qwen3 SwiGLU MLP
type MLP struct {
	GateProj nn.LinearLayer `weight:"gate_proj"`
	UpProj   nn.LinearLayer `weight:"up_proj"`
	DownProj nn.LinearLayer `weight:"down_proj"`
}

// Forward applies the MLP
func (m *MLP) Forward(x *mlx.Array) *mlx.Array {
	gate := m.GateProj.Forward(x)
	gate = mlx.SiLU(gate)
	up := m.UpProj.Forward(x)
	h := mlx.Mul(gate, up)
	return m.DownProj.Forward(h)
}

// Block represents a single Qwen3 transformer block
type Block struct {
	Attention         *Attention  `weight:"self_attn"`
	MLP               *MLP        `weight:"mlp"`
	InputLayerNorm    *nn.RMSNorm `weight:"input_layernorm"`
	PostAttnLayerNorm *nn.RMSNorm `weight:"post_attention_layernorm"`
}

// Forward applies the Qwen3 block
func (qb *Block) Forward(x *mlx.Array, eps float32, mask *mlx.Array, maskMode string) *mlx.Array {
	h := qb.InputLayerNorm.Forward(x, eps)
	attnOut := qb.Attention.Forward(h, mask, maskMode)
	x = mlx.Add(x, attnOut)

	h = qb.PostAttnLayerNorm.Forward(x, eps)
	mlpOut := qb.MLP.Forward(h)
	x = mlx.Add(x, mlpOut)

	return x
}

// TextEncoder is the full Qwen3 encoder
type TextEncoder struct {
	EmbedTokens *nn.Embedding `weight:"model.embed_tokens"`
	Layers      []*Block      `weight:"model.layers"`
	FinalNorm   *nn.RMSNorm   `weight:"model.norm"`
	*Config
}

// Load loads the Qwen3 text encoder from ollama blob storage.
func (m *TextEncoder) Load(modelManifest *manifest.ModelManifest, configPath string) error {
	fmt.Print("  Loading text encoder... ")

	var cfg Config
	if err := modelManifest.ReadConfigJSON(configPath, &cfg); err != nil {
		return fmt.Errorf("config: %w", err)
	}
	m.Config = &cfg
	m.Layers = make([]*Block, cfg.NumHiddenLayers)

	weights, err := manifest.LoadWeightsFromManifest(modelManifest, "text_encoder")
	if err != nil {
		return fmt.Errorf("weights: %w", err)
	}
	if err := weights.Load(0); err != nil {
		return fmt.Errorf("load weights: %w", err)
	}
	defer weights.ReleaseAll()

	for _, name := range weights.ListTensors() {
		if strings.Contains(name, "model.layers.0") && strings.Contains(name, "self_attn") {
			log.Printf("DEBUG Qwen3 tensor name: %s", name)
		}
	}

	return m.loadWeights(weights)
}

// loadWeights loads weights from any WeightSource into the model
func (m *TextEncoder) loadWeights(weights safetensors.WeightSource) error {
	if err := safetensors.LoadModule(m, weights, ""); err != nil {
		return fmt.Errorf("load module: %w", err)
	}
	m.initComputedFields()
	fmt.Println("✓")
	return nil
}

// initComputedFields initializes computed fields after loading weights
func (m *TextEncoder) initComputedFields() {
	cfg := m.Config
	if m.FinalNorm != nil {
		m.FinalNorm.Eps = cfg.RMSNormEps
	}

	for i, block := range m.Layers {
		if block == nil || block.Attention == nil {
			log.Printf("DEBUG initComputedFields: layer %d missing block or attention", i)
			continue
		}

		block.Attention.NHeads = cfg.NumAttentionHeads
		block.Attention.NKVHeads = cfg.NumKeyValueHeads
		block.Attention.HeadDim = cfg.HeadDim
		block.Attention.Scale = float32(1.0 / math.Sqrt(float64(cfg.HeadDim)))
		block.Attention.RopeTheta = cfg.RopeTheta

		if block.Attention.QNorm != nil {
			block.Attention.QNorm.Eps = cfg.RMSNormEps
		}
		if block.Attention.KNorm != nil {
			block.Attention.KNorm.Eps = cfg.RMSNormEps
		}
		if block.InputLayerNorm != nil {
			block.InputLayerNorm.Eps = cfg.RMSNormEps
		}
		if block.PostAttnLayerNorm != nil {
			block.PostAttnLayerNorm.Eps = cfg.RMSNormEps
		}

		if i == 0 {
			if q, ok := block.Attention.QProj.(*nn.Linear); ok && q != nil && q.Weight != nil {
				log.Printf("DEBUG initComputedFields: layer0 q_proj weight = %#v", q.Weight.Shape())
			}
			if k, ok := block.Attention.KProj.(*nn.Linear); ok && k != nil && k.Weight != nil {
				log.Printf("DEBUG initComputedFields: layer0 k_proj weight = %#v", k.Weight.Shape())
			}
			if v, ok := block.Attention.VProj.(*nn.Linear); ok && v != nil && v.Weight != nil {
				log.Printf("DEBUG initComputedFields: layer0 v_proj weight = %#v", v.Weight.Shape())
			}
			if o, ok := block.Attention.OProj.(*nn.Linear); ok && o != nil && o.Weight != nil {
				log.Printf("DEBUG initComputedFields: layer0 o_proj weight = %#v", o.Weight.Shape())
			}
		}
	}
}

// Forward encodes text tokens with provided attention mask (LxL) and mask mode.
func (te *TextEncoder) Forward(tokens *mlx.Array, attnMask *mlx.Array, maskMode string) *mlx.Array {
	h := te.EmbedTokens.Forward(tokens)
	eps := te.RMSNormEps

	for _, layer := range te.Layers {
		h = layer.Forward(h, eps, attnMask, maskMode)
	}

	// Apply final RMS norm
	h = te.FinalNorm.Forward(h, eps)

	return h
}

// ForwardWithLayerOutputs encodes text tokens and returns hidden states from specified layers.
// This is used by Flux2 which needs embeddings from specific intermediate layers.
func (te *TextEncoder) ForwardWithLayerOutputs(tokens *mlx.Array, layerIndices []int, attnMask *mlx.Array, maskMode string) []*mlx.Array {
	log.Printf("DEBUG ForwardWithLayerOutputs: tokens.Shape() = %#v", tokens.Shape())
	if attnMask != nil {
		log.Printf("DEBUG ForwardWithLayerOutputs: attnMask.Shape() = %#v", attnMask.Shape())
	}
	log.Printf("DEBUG ForwardWithLayerOutputs: layerIndices = %#v", layerIndices)

	h := te.EmbedTokens.Forward(tokens)
	log.Printf("DEBUG ForwardWithLayerOutputs: after EmbedTokens h.Shape() = %#v", h.Shape())

	eps := te.RMSNormEps

	outputs := make([]*mlx.Array, len(layerIndices))
	layerSet := make(map[int]int)
	for i, idx := range layerIndices {
		layerSet[idx] = i
	}

	for i, layer := range te.Layers {
		h = layer.Forward(h, eps, attnMask, maskMode)
		log.Printf("DEBUG ForwardWithLayerOutputs: after layer %d h.Shape() = %#v", i, h.Shape())
		if outIdx, ok := layerSet[i]; ok {
			outputs[outIdx] = h
		}
	}

	return outputs
}

// ApplyChatTemplate wraps prompt in Qwen3 chat format.
// If think is true, adds the <think></think> block after the assistant tag
// (matches tokenizer.apply_chat_template with enable_thinking=False in Python).
func ApplyChatTemplate(prompt string, think bool) string {
	base := "<|im_start|>user\n" + prompt + "<|im_end|>\n<|im_start|>assistant\n"
	if think {
		return base + "<think>\n\n</think>\n\n"
	}
	return base
}

// EncodePrompt encodes a text prompt using the tokenizer and encoder.
// If think is true, includes the <think></think> block in the chat template.
func (te *TextEncoder) EncodePrompt(tok *tokenizer.Tokenizer, prompt string, maxLen int, think bool) (*mlx.Array, *mlx.Array) {
	formattedPrompt := ApplyChatTemplate(prompt, think)

	tokens := tok.Encode(formattedPrompt, false)

	if len(tokens) > maxLen {
		tokens = tokens[:maxLen]
	}

	maskData := make([]float32, maxLen)
	for i := 0; i < len(tokens); i++ {
		maskData[i] = 1.0
	}

	// Get PAD token (different from EOS for Qwen3)
	padToken := tok.PAD()
	if padToken < 0 {
		padToken = tok.EOS() // fallback
	}

	paddedTokens := make([]int32, maxLen)
	copy(paddedTokens, tokens)
	for i := len(tokens); i < maxLen; i++ {
		paddedTokens[i] = padToken
	}

	tokensArr := mlx.NewArrayInt32(paddedTokens, []int32{1, int32(maxLen)})
	maskArr := mlx.NewArray(maskData, []int32{1, int32(maxLen)})

	// Build combined causal + PAD mask [L, L]
	// mask[i,j] = 0 if (j <= i AND valid[j]) else -inf
	L := int32(maxLen)
	validLen := int32(len(tokens))
	combinedMaskData := make([]float32, L*L)
	negInf := float32(-1e9)
	for i := int32(0); i < L; i++ {
		for j := int32(0); j < L; j++ {
			idx := i*L + j
			if j <= i && j < validLen {
				combinedMaskData[idx] = 0
			} else {
				combinedMaskData[idx] = negInf
			}
		}
	}
	maskMat := mlx.NewArray(combinedMaskData, []int32{L, L})

	embeddings := te.Forward(tokensArr, maskMat, "")

	return embeddings, maskArr
}

// EncodePromptWithLayers encodes a text prompt and returns embeddings from specified layers.
// Used by Flux2 which concatenates embeddings from multiple intermediate layers.
// If think is true, includes the <think></think> block in the chat template.
// Returns embeddings and padded sequence length.
func (te *TextEncoder) EncodePromptWithLayers(tok *tokenizer.Tokenizer, prompt string, maxLen int, layerIndices []int, think bool) (*mlx.Array, int32) {
	formattedPrompt := ApplyChatTemplate(prompt, think)
	tokens := tok.Encode(formattedPrompt, false)

	if len(tokens) > maxLen {
		tokens = tokens[:maxLen]
	}

	// Pad to maxLen
	padToken := tok.PAD()
	if padToken < 0 {
		padToken = tok.EOS() // fallback
	}
	padded := make([]int32, maxLen)
	copy(padded, tokens)
	for i := len(tokens); i < maxLen; i++ {
		padded[i] = padToken
	}
	tokensArr := mlx.NewArrayInt32(padded, []int32{1, int32(maxLen)})

	// Build combined causal + PAD mask [L, L]
	// mask[i,j] = 0 if (j <= i AND valid[j]) else -inf
	// This combines causal masking with PAD token masking
	L := int32(maxLen)
	validLen := int32(len(tokens))
	maskData := make([]float32, L*L)
	negInf := float32(-1e9)
	for i := int32(0); i < L; i++ {
		for j := int32(0); j < L; j++ {
			idx := i*L + j
			if j <= i && j < validLen {
				maskData[idx] = 0 // allowed: causal OK and not PAD
			} else {
				maskData[idx] = negInf // blocked: future or PAD
			}
		}
	}
	maskMat := mlx.NewArray(maskData, []int32{L, L})

	layerOutputs := te.ForwardWithLayerOutputs(tokensArr, layerIndices, maskMat, "")

	// Concatenate layer outputs along the hidden dimension
	// Each output is [B, L, hidden_dim], result is [B, L, num_layers * hidden_dim]
	embeddings := mlx.Concatenate(layerOutputs, 2)

	// Return embeddings and padded length
	return embeddings, int32(maxLen)
}
