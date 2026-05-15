//go:build windows || darwin

package ui

import (
	"io/fs"
	"testing"
)

func TestEmbeddedAppIncludesNextStaticAssets(t *testing.T) {
	fsys, err := fs.Sub(appFS, "app/dist")
	if err != nil {
		t.Fatalf("failed to open embedded app dist: %v", err)
	}

	cssFiles, err := fs.Glob(fsys, "_next/static/chunks/*.css")
	if err != nil {
		t.Fatalf("failed to glob embedded CSS assets: %v", err)
	}
	if len(cssFiles) == 0 {
		t.Fatal("embedded app is missing Next.js CSS assets under _next/static/chunks")
	}

	jsFiles, err := fs.Glob(fsys, "_next/static/chunks/*.js")
	if err != nil {
		t.Fatalf("failed to glob embedded JavaScript assets: %v", err)
	}
	if len(jsFiles) == 0 {
		t.Fatal("embedded app is missing Next.js JavaScript assets under _next/static/chunks")
	}
}
