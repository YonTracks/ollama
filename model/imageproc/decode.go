package imageproc

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"io"
)

const (
	MaxEncodedImageBytes = 64 * 1024 * 1024
	MaxImagePixels       = 100_000_000
	MaxImageDimension    = 32_768
)

var ErrImageTooLarge = errors.New("image exceeds decode limits")

// DecodeBytes validates the encoded size and image dimensions before decoding.
func DecodeBytes(data []byte) (image.Image, string, error) {
	if len(data) > MaxEncodedImageBytes {
		return nil, "", fmt.Errorf("%w: encoded image is %d bytes, limit is %d bytes", ErrImageTooLarge, len(data), MaxEncodedImageBytes)
	}

	return decodeBuffered(data)
}

// DecodeReader reads a bounded image payload, validates its dimensions, then decodes it.
func DecodeReader(r io.Reader) (image.Image, string, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxEncodedImageBytes+1))
	if err != nil {
		return nil, "", err
	}
	return DecodeBytes(data)
}

func decodeBuffered(data []byte) (image.Image, string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	if err := validateImageConfig(cfg); err != nil {
		return nil, "", err
	}

	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	return img, format, nil
}

func validateImageConfig(cfg image.Config) error {
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return fmt.Errorf("invalid image dimensions %dx%d", cfg.Width, cfg.Height)
	}
	if cfg.Width > MaxImageDimension || cfg.Height > MaxImageDimension {
		return fmt.Errorf("%w: dimensions %dx%d exceed %d", ErrImageTooLarge, cfg.Width, cfg.Height, MaxImageDimension)
	}
	if cfg.Width > MaxImagePixels/cfg.Height {
		return fmt.Errorf("%w: dimensions %dx%d exceed %d pixels", ErrImageTooLarge, cfg.Width, cfg.Height, MaxImagePixels)
	}

	return nil
}
