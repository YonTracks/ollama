package main

import (
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"

	"github.com/ollama/ollama/x/imagegen/mlx"
)

// saveImageArray saves an MLX array as a PNG image.
// Expected format: [B, C, H, W] with values in [0, 1] range and C=3 (RGB).
func saveImageArray(arr *mlx.Array, path string) error {
	img, err := arrayToImage(arr)
	if err != nil {
		return err
	}
	return savePNG(img, path)
}

func savePNG(img *image.RGBA, path string) error {
	if filepath.Ext(path) != ".png" {
		path = path + ".png"
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}

func arrayToImage(arr *mlx.Array) (*image.RGBA, error) {
	fmt.Println("DEBUG ARRAYTOIMAGE UINT8 PATH ACTIVE (x/imagegen/cmd/engine/image.go)")
	shape := arr.Shape()
	if len(shape) != 4 {
		return nil, fmt.Errorf("expected 4D array [B, C, H, W], got %v", shape)
	}
	if shape[0] != 1 {
		return nil, fmt.Errorf("expected batch size 1, got shape %v", shape)
	}
	if shape[1] != 3 {
		return nil, fmt.Errorf("expected 3 channels (RGB), got shape %v", shape)
	}

	// Transform to [H, W, C] on device.
	img := mlx.Squeeze(arr, 0) // [3, H, W]
	arr.Free()

	img = mlx.Transpose(img, 1, 2, 0) // [H, W, 3]

	imgShape := img.Shape()
	H := int(imgShape[0])
	W := int(imgShape[1])
	C := int(imgShape[2])

	if C != 3 {
		img.Free()
		return nil, fmt.Errorf("expected 3 channels (RGB), got %d", C)
	}

	fmt.Printf("DEBUG ArrayToImage uint8: input.Shape()=%v final.Shape()=%v\n", shape, imgShape)

	// Convert to uint8 on device before host readback:
	// clip -> scale -> round -> uint8
	img = mlx.ClipScalar(img, 0.0, 1.0, true, true)
	img = mlx.MulScalar(img, 255.0)
	img = mlx.AddScalar(img, 0.5) // simple rounding before cast
	img = mlx.AsType(img, mlx.DtypeUint8)
	img = mlx.Contiguous(img)
	mlx.Eval(img)

	fmt.Printf("DEBUG ArrayToImage uint8: shape=%v dtype=%v\n", img.Shape(), img.Dtype())

	// Copy compact uint8 RGB bytes to CPU.
	raw := img.Bytes()
	img.Free()

	expected := H * W * 3
	if len(raw) != expected {
		return nil, fmt.Errorf("expected %d RGB bytes, got %d", expected, len(raw))
	}

	// Write directly to Pix slice (faster than SetRGBA)
	goImg := image.NewRGBA(image.Rect(0, 0, W, H))
	pix := goImg.Pix

	src := 0
	for y := 0; y < H; y++ {
		for x := 0; x < W; x++ {
			dstIdx := (y*W + x) * 4
			pix[dstIdx+0] = raw[src+0]
			pix[dstIdx+1] = raw[src+1]
			pix[dstIdx+2] = raw[src+2]
			pix[dstIdx+3] = 255
			src += 3
		}
	}

	return goImg, nil
}
