package imageproc

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/png"
	"testing"
)

func TestDecodeBytesRejectsOversizeEncodedPayload(t *testing.T) {
	_, _, err := DecodeBytes(make([]byte, MaxEncodedImageBytes+1))
	if !errors.Is(err, ErrImageTooLarge) {
		t.Fatalf("DecodeBytes() error = %v, want ErrImageTooLarge", err)
	}
}

func TestDecodeBytesRejectsOversizeDimensionsBeforeDecode(t *testing.T) {
	data := pngWithIHDR(MaxImageDimension+1, 1)
	_, _, err := DecodeBytes(data)
	if !errors.Is(err, ErrImageTooLarge) {
		t.Fatalf("DecodeBytes() error = %v, want ErrImageTooLarge", err)
	}
}

func TestDecodeBytesAcceptsSmallPNG(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}

	img, format, err := DecodeBytes(buf.Bytes())
	if err != nil {
		t.Fatalf("DecodeBytes() error = %v", err)
	}
	if format != "png" {
		t.Fatalf("format = %q, want png", format)
	}
	if img.Bounds().Dx() != 2 || img.Bounds().Dy() != 2 {
		t.Fatalf("bounds = %v, want 2x2", img.Bounds())
	}
}

func pngWithIHDR(width, height int) []byte {
	var out bytes.Buffer
	out.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})

	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:4], uint32(width))
	binary.BigEndian.PutUint32(ihdr[4:8], uint32(height))
	ihdr[8] = 8
	ihdr[9] = 2
	writePNGChunk(&out, "IHDR", ihdr)
	writePNGChunk(&out, "IEND", nil)
	return out.Bytes()
}

func writePNGChunk(out *bytes.Buffer, kind string, data []byte) {
	_ = binary.Write(out, binary.BigEndian, uint32(len(data)))
	out.WriteString(kind)
	out.Write(data)
	crc := crc32.NewIEEE()
	crc.Write([]byte(kind))
	crc.Write(data)
	_ = binary.Write(out, binary.BigEndian, crc.Sum32())
}
