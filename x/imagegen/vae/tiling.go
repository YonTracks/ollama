// Package vae provides shared utilities for VAE (Variational Autoencoder) operations.
package vae

import (
	"fmt"

	"github.com/ollama/ollama/x/imagegen/mlx"
)

// TilingConfig holds configuration for tiled VAE decoding.
// This is a general technique to reduce memory usage when decoding large latents.
type TilingConfig struct {
	TileSize int32 // Tile size in latent space (e.g., 64 latent → 512 pixels for 8x VAE)
	Overlap  int32 // Overlap in latent space (e.g., 16 latent = 25% of 64)
}

// DefaultTilingConfig returns reasonable defaults matching diffusers.
// tile_latent_min_size=64, tile_overlap_factor=0.25
func DefaultTilingConfig() *TilingConfig {
	return &TilingConfig{
		TileSize: 64, // 64 latent pixels
		Overlap:  16, // 25% overlap
	}
}

// DecodeTiled decodes latents using tiled processing with overlap blending,
// but keeps all tile assembly on-device.
//
// Parameters:
//   - latents: [1, H, W, C] latent tensor in NHWC format
//   - cfg: tiling configuration (tile size and overlap)
//   - decoder: function to decode a single tile [1, H, W, C] -> [1, H*scale, W*scale, 3]
//
// Returns: [1, 3, H*scale, W*scale] decoded image in NCHW format.
func DecodeTiled(latents *mlx.Array, cfg *TilingConfig, decoder func(*mlx.Array) *mlx.Array) *mlx.Array {
	shape := latents.Shape()
	H := shape[1] // latent height
	W := shape[2] // latent width
	C := shape[3]

	tileLatentSize := cfg.TileSize
	overlapLatent := cfg.Overlap

	// If image is small enough, just decode normally
	if H <= tileLatentSize && W <= tileLatentSize {
		decoded := decoder(latents) // [1, Hpx, Wpx, 3]
		decoded = mlx.AsType(decoded, mlx.DtypeFloat32)
		decoded = mlx.ClipScalar(decoded, 0.0, 1.0, true, true)
		decoded = mlx.Transpose(decoded, 0, 3, 1, 2) // NHWC -> NCHW
		return decoded
	}

	// Tiling parameters
	overlapSize := tileLatentSize - overlapLatent // stride in latent space
	blendExtent := overlapLatent * 8              // overlap in pixel space
	totalH := H * 8
	totalW := W * 8

	// Accumulate weighted RGB and weights on-device
	acc := mlx.Zeros([]int32{1, totalH, totalW, 3}, mlx.DtypeFloat32)
	wacc := mlx.Zeros([]int32{1, totalH, totalW, 1}, mlx.DtypeFloat32)
	mlx.Eval(acc, wacc)

	for i := int32(0); i < H; i += overlapSize {
		for j := int32(0); j < W; j += overlapSize {
			i2 := min(i+tileLatentSize, H)
			j2 := min(j+tileLatentSize, W)

			// Extract latent tile
			tile := mlx.Slice(latents, []int32{0, i, j, 0}, []int32{1, i2, j2, C})

			// Decode tile on device: [1, Hpx, Wpx, 3]
			decoded := decoder(tile)
			decoded = mlx.AsType(decoded, mlx.DtypeFloat32)
			decoded = mlx.Contiguous(decoded)
			mlx.Eval(decoded)

			decodedShape := decoded.Shape()
			fmt.Printf("DEBUG DecodeTiled tile: latent=[%d:%d,%d:%d] decodedShape=%v dtype=%v\n",
				i, i2, j, j2, decodedShape, decoded.Dtype())

			tileH := decodedShape[1]
			tileW := decodedShape[2]

			// Blend mask: [1, tileH, tileW, 1]
			mask := makeBlendMask(
				tileH,
				tileW,
				blendExtent,
				i > 0,  // blend top if not topmost tile
				i2 < H, // blend bottom if not bottommost tile
				j > 0,  // blend left if not leftmost tile
				j2 < W, // blend right if not rightmost tile
			)

			maskRGB := mlx.BroadcastTo(mask, []int32{1, tileH, tileW, 3})
			weighted := mlx.Mul(decoded, maskRGB)

			// Destination placement in full pixel image
			dstY0 := i * 8
			dstX0 := j * 8
			dstY1 := dstY0 + tileH
			dstX1 := dstX0 + tileW

			// acc[dst] += weighted
			accRegion := mlx.Slice(acc,
				[]int32{0, dstY0, dstX0, 0},
				[]int32{1, dstY1, dstX1, 3},
			)
			accSum := mlx.Add(accRegion, weighted)
			newAcc := mlx.SliceUpdate(acc, accSum,
				[]int32{0, dstY0, dstX0, 0},
				[]int32{1, dstY1, dstX1, 3},
			)

			// wacc[dst] += mask
			wRegion := mlx.Slice(wacc,
				[]int32{0, dstY0, dstX0, 0},
				[]int32{1, dstY1, dstX1, 1},
			)
			wSum := mlx.Add(wRegion, mask)
			newWacc := mlx.SliceUpdate(wacc, wSum,
				[]int32{0, dstY0, dstX0, 0},
				[]int32{1, dstY1, dstX1, 1},
			)

			// Old accumulators were kept by the previous Eval; release them before replacing.
			acc.Free()
			wacc.Free()

			// Realize per tile so the graph doesn't grow forever.
			mlx.Eval(newAcc, newWacc)

			acc = newAcc
			wacc = newWacc
		}
	}

	// Normalize accumulated RGB by accumulated weights
	waccRGB := mlx.BroadcastTo(wacc, []int32{1, totalH, totalW, 3})
	waccRGB = mlx.AddScalar(waccRGB, 1e-6) // avoid divide-by-zero on any unexpected holes
	result := mlx.Div(acc, waccRGB)

	// Release accumulators once final result exists
	acc.Free()
	wacc.Free()

	// NHWC -> NCHW
	result = mlx.Transpose(result, 0, 3, 1, 2)
	result = mlx.ClipScalar(result, 0.0, 1.0, true, true)
	mlx.Eval(result)

	fmt.Printf("DEBUG DecodeTiled: totalH=%d totalW=%d result.Shape()=%v\n", totalH, totalW, result.Shape())

	return result
}

// makeBlendMask builds a separable feather mask with shape [1, h, w, 1].
// The mask ramps only on interior edges; outer image edges stay at full weight.
func makeBlendMask(
	h, w, blend int32,
	blendTop, blendBottom, blendLeft, blendRight bool,
) *mlx.Array {
	if blend <= 0 {
		data := make([]float32, h*w)
		for i := range data {
			data[i] = 1.0
		}
		return mlx.NewArrayFloat32(data, []int32{1, h, w, 1})
	}

	yw := make([]float32, h)
	xw := make([]float32, w)

	for y := int32(0); y < h; y++ {
		v := float32(1.0)

		if blendTop && y < blend {
			v *= float32(y) / float32(blend)
		}
		if blendBottom && y >= h-blend {
			v *= float32(h-y) / float32(blend)
		}
		if v < 0 {
			v = 0
		}
		if v > 1 {
			v = 1
		}
		yw[y] = v
	}

	for x := int32(0); x < w; x++ {
		v := float32(1.0)

		if blendLeft && x < blend {
			v *= float32(x) / float32(blend)
		}
		if blendRight && x >= w-blend {
			v *= float32(w-x) / float32(blend)
		}
		if v < 0 {
			v = 0
		}
		if v > 1 {
			v = 1
		}
		xw[x] = v
	}

	data := make([]float32, h*w)
	for y := int32(0); y < h; y++ {
		for x := int32(0); x < w; x++ {
			data[y*w+x] = yw[y] * xw[x]
		}
	}

	return mlx.NewArrayFloat32(data, []int32{1, h, w, 1})
}
