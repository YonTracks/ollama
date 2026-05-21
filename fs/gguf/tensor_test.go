package gguf

import (
	"errors"
	"math"
	"testing"
)

func TestTensorInfoNumValuesCheckedRejectsOverflow(t *testing.T) {
	ti := TensorInfo{
		Name:  "bad",
		Shape: []uint64{uint64(math.MaxInt64/2 + 1), 3},
		Type:  TensorTypeF32,
	}

	_, err := ti.NumValuesChecked()
	if !errors.Is(err, errTensorShapeOverflow) {
		t.Fatalf("NumValuesChecked() error = %v, want errTensorShapeOverflow", err)
	}
	if ti.Valid() {
		t.Fatal("Valid() = true, want false for overflowing tensor")
	}
}

func TestTensorInfoNumBytesCheckedRejectsOverflow(t *testing.T) {
	ti := TensorInfo{
		Name:  "bad",
		Shape: []uint64{uint64(math.MaxInt64/4 + 1)},
		Type:  TensorTypeF32,
	}

	_, err := ti.NumBytesChecked()
	if !errors.Is(err, errTensorSizeOverflow) {
		t.Fatalf("NumBytesChecked() error = %v, want errTensorSizeOverflow", err)
	}
}

func TestTensorInfoNumBytesCheckedQuantized(t *testing.T) {
	ti := TensorInfo{
		Name:  "q4",
		Shape: []uint64{32},
		Type:  TensorTypeQ4_0,
	}

	got, err := ti.NumBytesChecked()
	if err != nil {
		t.Fatalf("NumBytesChecked() error = %v", err)
	}
	if got != 18 {
		t.Fatalf("NumBytesChecked() = %d, want 18", got)
	}
}
