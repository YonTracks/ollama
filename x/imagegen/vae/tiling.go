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

// decodedTile holds a decoded tile's pixel data and dimensions.
type decodedTile struct {
	data   []float32
	height int32
	width  int32
}

// DecodeTiled decodes latents using tiled processing with overlap blending.
// This reduces memory usage for large images by processing in overlapping tiles.
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
		decoded := decoder(latents)
		decoded = mlx.AsType(decoded, mlx.DtypeFloat32)
		decoded = mlx.ClipScalar(decoded, 0.0, 1.0, true, true)
		decoded = mlx.Transpose(decoded, 0, 3, 1, 2) // NHWC -> NCHW
		return decoded
	}

	// Calculate tiling parameters (matching diffusers)
	overlapSize := tileLatentSize - overlapLatent // stride in latent space

	// Blend extent in pixel space (8x upscale for Flux2 VAE)
	tileSampleSize := tileLatentSize * 8     // tile size in pixels after 8x upscale
	blendExtent := overlapLatent * 8         // blend region in pixels
	rowLimit := tileSampleSize - blendExtent // non-overlapping region per tile

	// Phase 1: Decode all tiles and store in 2D grid
	var rows [][]decodedTile

	for i := int32(0); i < H; i += overlapSize {
		var row []decodedTile

		for j := int32(0); j < W; j += overlapSize {
			// Extract tile (may be smaller at edges)
			i2 := min(i+tileLatentSize, H)
			j2 := min(j+tileLatentSize, W)

			tile := mlx.Slice(latents, []int32{0, i, j, 0}, []int32{1, i2, j2, C})

			// Decode tile and read back as float32
			decoded := decoder(tile) // [1, Hpx, Wpx, 3]
			decoded = mlx.AsType(decoded, mlx.DtypeFloat32)
			decoded = mlx.Contiguous(decoded)

			// IMPORTANT:
			// On Windows/CUDA, reading tiled decode outputs as [1, H, W, 3] (4D)
			// has proven unstable and can lead to crashes or invalid memory reads.
			// Squeezing to a true 3D tensor [H, W, 3] before Data() makes the
			// readback significantly more reliable.
			//
			// Root cause is likely tied to backend memory layout / batching handling
			// in MLX when materializing NHWC tensors with a batch dimension.
			//
			// Therefore we:
			//   1) Fully materialize the decoded tile
			//   2) Squeeze batch dimension -> [H, W, 3]
			//   3) Re-materialize the squeezed tensor
			//   4) Read back from the 3D contiguous tensor

			// Materialize the decoded tile
			mlx.Eval(decoded)
			mlx.Sync()

			decodedShape := decoded.Shape()
			fmt.Printf("DEBUG DecodeTiled tile: latent=[%d:%d,%d:%d] decodedShape=%v dtype=%v\n",
				i, i2, j, j2, decodedShape, decoded.Dtype())

			// Drop batch dim: [1, H, W, 3] -> [H, W, 3]
			decoded3 := mlx.Squeeze(decoded, 0)
			decoded3 = mlx.Contiguous(decoded3)

			// Ensure squeezed tensor is also fully realized
			mlx.Eval(decoded3)
			mlx.Sync()

			decoded3Shape := decoded3.Shape()
			fmt.Printf("DEBUG DecodeTiled tile squeezed shape=%v dtype=%v\n",
				decoded3Shape, decoded3.Dtype())

			// Safe float32 readback from 3D tensor
			tileH := decoded3Shape[0]
			tileW := decoded3Shape[1]
			tileData := decoded3.Data()

			// Free intermediates after readback
			decoded3.Free()
			decoded.Free()
			tile.Free()

			row = append(row, decodedTile{
				data:   tileData,
				height: tileH,
				width:  tileW,
			})
		}

		rows = append(rows, row)
	}

	// Phase 2: Blend adjacent tiles (modifies in place)
	for i := range rows {
		for j := range rows[i] {
			tile := &rows[i][j]

			// Blend with tile above
			if i > 0 {
				above := &rows[i-1][j]
				blendV(above, tile, blendExtent)
			}

			// Blend with tile to the left
			if j > 0 {
				left := &rows[i][j-1]
				blendH(left, tile, blendExtent)
			}
		}
	}

	// Phase 3: Calculate crop dimensions for each tile
	colWidths := make([]int32, len(rows[0]))
	for j := range rows[0] {
		keepW := rowLimit
		if int32(j+1)*overlapSize >= W {
			keepW = rows[0][j].width
		}
		colWidths[j] = keepW
	}

	rowHeights := make([]int32, len(rows))
	for i := range rows {
		keepH := rowLimit
		if int32(i+1)*overlapSize >= H {
			keepH = rows[i][0].height
		}
		rowHeights[i] = keepH
	}

	// Calculate total dimensions
	var totalW, totalH int32
	for _, w := range colWidths {
		totalW += w
	}
	for _, h := range rowHeights {
		totalH += h
	}

	// Phase 4: Assemble final image row-by-row in float32 HWC
	finalData := make([]float32, totalH*totalW*3)

	dstY := int32(0)
	for i, row := range rows {
		keepH := rowHeights[i]

		for y := int32(0); y < keepH; y++ {
			dstX := int32(0)
			for j, tile := range row {
				keepW := colWidths[j]

				for x := int32(0); x < keepW; x++ {
					for c := int32(0); c < 3; c++ {
						srcIdx := (y*tile.width+x)*3 + c
						dstIdx := ((dstY+y)*totalW+(dstX+x))*3 + c
						finalData[dstIdx] = tile.data[srcIdx]
					}
				}
				dstX += keepW
			}
		}
		dstY += keepH
	}

	// Create float32 NHWC array, then transpose to NCHW
	result := mlx.NewArray(finalData, []int32{1, totalH, totalW, 3})
	result = mlx.Transpose(result, 0, 3, 1, 2)
	result = mlx.ClipScalar(result, 0.0, 1.0, true, true)

	fmt.Printf("DEBUG DecodeTiled: totalH=%d totalW=%d result.Shape()=%v\n", totalH, totalW, result.Shape())

	return result
}

// blendV blends the bottom of 'above' tile into top of 'current' tile (vertical blend)
// Matches diffusers blend_v formula.
func blendV(above, current *decodedTile, blendExtent int32) {
	blend := min(blendExtent, min(above.height, current.height))
	if blend <= 0 {
		return
	}

	w := min(above.width, current.width)
	for y := int32(0); y < blend; y++ {
		alpha := float32(y) / float32(blend)
		for x := int32(0); x < w; x++ {
			for c := int32(0); c < 3; c++ {
				aboveIdx := ((above.height-blend+y)*above.width+x)*3 + c
				currIdx := (y*current.width+x)*3 + c
				current.data[currIdx] = above.data[aboveIdx]*(1-alpha) + current.data[currIdx]*alpha
			}
		}
	}
}

// blendH blends the right of 'left' tile into left of 'current' tile (horizontal blend)
// Matches diffusers blend_h formula.
func blendH(left, current *decodedTile, blendExtent int32) {
	blend := min(blendExtent, min(left.width, current.width))
	if blend <= 0 {
		return
	}

	h := min(left.height, current.height)
	for y := int32(0); y < h; y++ {
		for x := int32(0); x < blend; x++ {
			alpha := float32(x) / float32(blend)
			for c := int32(0); c < 3; c++ {
				leftIdx := (y*left.width+(left.width-blend+x))*3 + c
				currIdx := (y*current.width+x)*3 + c
				current.data[currIdx] = left.data[leftIdx]*(1-alpha) + current.data[currIdx]*alpha
			}
		}
	}
}
