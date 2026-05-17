//go:build windows || darwin

package tools

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	defaultListLimit       = 200
	maxListLimit           = 1000
	defaultReadMaxBytes    = 64 * 1024
	maxReadBytes           = 256 * 1024
	defaultSearchMaxBytes  = 256 * 1024
	maxSearchFileBytes     = 1024 * 1024
	defaultSearchMaxResult = 25
	maxSearchResults       = 100
)

var (
	errStopSearch = errors.New("stop search")

	generatedDirNames = map[string]struct{}{
		".git":         {},
		".next":        {},
		"build":        {},
		"dist":         {},
		"node_modules": {},
		"out":          {},
		"target":       {},
	}
)

// RegisterDesktopTools registers read-only local tools for the desktop app.
func RegisterDesktopTools(registry *Registry) {
	registry.Register(NewListFilesTool())
	registry.Register(NewReadTextFileTool())
	registry.Register(NewSearchFilesTool())
}

type desktopToolBase struct {
	mu         sync.RWMutex
	workingDir string
}

func (t *desktopToolBase) SetWorkingDir(dir string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.workingDir = dir
}

func (t *desktopToolBase) workingDirectory() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.workingDir
}

type ListFilesTool struct {
	desktopToolBase
}

func NewListFilesTool() *ListFilesTool {
	return &ListFilesTool{}
}

func (t *ListFilesTool) Name() string {
	return "desktop.list_files"
}

func (t *ListFilesTool) Description() string {
	return "List files and folders under the configured desktop working directory. Read-only and scoped to that directory."
}

func (t *ListFilesTool) Prompt() string {
	return ""
}

func (t *ListFilesTool) Schema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Relative path under the configured working directory. Defaults to '.'. Absolute paths are accepted only when they stay inside the working directory.",
			},
			"limit": map[string]any{
				"type":        "integer",
				"description": "Maximum number of entries to return. Defaults to 200 and is capped at 1000.",
				"default":     defaultListLimit,
			},
			"include_hidden": map[string]any{
				"type":        "boolean",
				"description": "Include dot-prefixed files and folders. Defaults to false.",
				"default":     false,
			},
			"include_generated": map[string]any{
				"type":        "boolean",
				"description": "Include common generated/dependency folders such as node_modules, dist, build, .next, target, and .git. Defaults to false.",
				"default":     false,
			},
		},
	}
}

type FileEntry struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	SizeBytes int64  `json:"size_bytes,omitempty"`
	Modified  string `json:"modified,omitempty"`
}

type ListFilesResult struct {
	Path      string      `json:"path"`
	Entries   []FileEntry `json:"entries"`
	Truncated bool        `json:"truncated"`
}

func (t *ListFilesTool) Execute(ctx context.Context, args map[string]any) (any, string, error) {
	root := t.workingDirectory()
	target, rel, rootAbs, err := resolveDesktopPath(root, stringArg(args, "path", "."))
	if err != nil {
		return nil, "", err
	}

	includeHidden := boolArg(args, "include_hidden", false)
	includeGenerated := boolArg(args, "include_generated", false)
	if err := validateAllowedRelativePath(rel, includeHidden, includeGenerated); err != nil {
		return nil, "", err
	}

	info, err := os.Stat(target)
	if err != nil {
		return nil, "", fmt.Errorf("unable to inspect path: %w", err)
	}
	if !info.IsDir() {
		return nil, "", fmt.Errorf("path is not a directory: %s", displayRel(rel))
	}

	entries, err := os.ReadDir(target)
	if err != nil {
		return nil, "", fmt.Errorf("unable to list directory: %w", err)
	}

	sort.Slice(entries, func(i, j int) bool {
		leftDir := entries[i].IsDir()
		rightDir := entries[j].IsDir()
		if leftDir != rightDir {
			return leftDir
		}
		return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
	})

	limit := intArg(args, "limit", defaultListLimit, 1, maxListLimit)
	result := ListFilesResult{Path: displayRel(rel), Entries: make([]FileEntry, 0, min(limit, len(entries)))}

	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, "", err
		}
		if !includeHidden && isHiddenName(entry.Name()) {
			continue
		}
		if !includeGenerated && entry.IsDir() && isGeneratedName(entry.Name()) {
			continue
		}
		if len(result.Entries) >= limit {
			result.Truncated = true
			break
		}

		entryPath := filepath.Join(target, entry.Name())
		entryRel, err := relativeDisplayPath(rootAbs, entryPath)
		if err != nil {
			continue
		}

		entryType := "file"
		if entry.Type()&os.ModeSymlink != 0 {
			entryType = "symlink"
		} else if entry.IsDir() {
			entryType = "directory"
		}

		item := FileEntry{
			Path: entryRel,
			Name: entry.Name(),
			Type: entryType,
		}
		if info, err := entry.Info(); err == nil {
			item.Modified = info.ModTime().UTC().Format(time.RFC3339)
			if info.Mode().IsRegular() {
				item.SizeBytes = info.Size()
			}
		}
		result.Entries = append(result.Entries, item)
	}

	return result, listFilesText(result), nil
}

type ReadTextFileTool struct {
	desktopToolBase
}

func NewReadTextFileTool() *ReadTextFileTool {
	return &ReadTextFileTool{}
}

func (t *ReadTextFileTool) Name() string {
	return "desktop.read_text_file"
}

func (t *ReadTextFileTool) Description() string {
	return "Read a UTF-8 text file under the configured desktop working directory. Read-only and scoped to that directory."
}

func (t *ReadTextFileTool) Prompt() string {
	return ""
}

func (t *ReadTextFileTool) Schema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Relative file path under the configured working directory. Absolute paths are accepted only when they stay inside the working directory.",
			},
			"max_bytes": map[string]any{
				"type":        "integer",
				"description": "Maximum bytes to read. Defaults to 65536 and is capped at 262144.",
				"default":     defaultReadMaxBytes,
			},
			"start_line": map[string]any{
				"type":        "integer",
				"description": "Optional 1-based line number to start from after reading the bounded file content.",
			},
			"max_lines": map[string]any{
				"type":        "integer",
				"description": "Optional maximum number of lines to return from the bounded file content.",
			},
			"include_hidden": map[string]any{
				"type":        "boolean",
				"description": "Allow reading dot-prefixed files and folders. Defaults to false.",
				"default":     false,
			},
			"include_generated": map[string]any{
				"type":        "boolean",
				"description": "Allow reading files inside common generated/dependency folders such as node_modules, dist, build, .next, target, and .git. Defaults to false.",
				"default":     false,
			},
		},
		"required": []string{"path"},
	}
}

type ReadTextFileResult struct {
	Path       string `json:"path"`
	SizeBytes  int64  `json:"size_bytes"`
	Content    string `json:"content"`
	Truncated  bool   `json:"truncated"`
	StartLine  int    `json:"start_line"`
	EndLine    int    `json:"end_line"`
	TotalLines int    `json:"total_lines"`
}

func (t *ReadTextFileTool) Execute(ctx context.Context, args map[string]any) (any, string, error) {
	path := strings.TrimSpace(stringArg(args, "path", ""))
	if path == "" {
		return nil, "", fmt.Errorf("path parameter is required")
	}

	target, rel, _, err := resolveDesktopPath(t.workingDirectory(), path)
	if err != nil {
		return nil, "", err
	}
	includeHidden := boolArg(args, "include_hidden", false)
	includeGenerated := boolArg(args, "include_generated", false)
	if err := validateAllowedRelativePath(rel, includeHidden, includeGenerated); err != nil {
		return nil, "", err
	}

	info, err := os.Stat(target)
	if err != nil {
		return nil, "", fmt.Errorf("unable to inspect file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, "", fmt.Errorf("path is not a regular file: %s", displayRel(rel))
	}

	maxBytes := intArg(args, "max_bytes", defaultReadMaxBytes, 1, maxReadBytes)
	data, truncated, err := readFilePrefix(ctx, target, int64(maxBytes))
	if err != nil {
		return nil, "", err
	}
	if normalized, ok := normalizeTextData(data); ok {
		data = normalized
	} else {
		return nil, "", fmt.Errorf("file does not look like UTF-8 text: %s", displayRel(rel))
	}

	content := string(data)
	lines := splitLines(content)
	totalLines := len(lines)
	startLine := intArg(args, "start_line", 1, 1, 1_000_000_000)
	maxLines := intArg(args, "max_lines", max(totalLines, 1), 1, 1_000_000)
	selected, endLine := selectLines(lines, startLine, maxLines)

	result := ReadTextFileResult{
		Path:       displayRel(rel),
		SizeBytes:  info.Size(),
		Content:    selected,
		Truncated:  truncated || int64(maxBytes) < info.Size(),
		StartLine:  startLine,
		EndLine:    endLine,
		TotalLines: totalLines,
	}

	return result, readTextFileText(result), nil
}

type SearchFilesTool struct {
	desktopToolBase
}

func NewSearchFilesTool() *SearchFilesTool {
	return &SearchFilesTool{}
}

func (t *SearchFilesTool) Name() string {
	return "desktop.search_files"
}

func (t *SearchFilesTool) Description() string {
	return "Search UTF-8 text files under the configured desktop working directory for a literal string. Read-only and scoped to that directory."
}

func (t *SearchFilesTool) Prompt() string {
	return ""
}

func (t *SearchFilesTool) Schema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"query": map[string]any{
				"type":        "string",
				"description": "Literal text to search for.",
			},
			"path": map[string]any{
				"type":        "string",
				"description": "Relative file or directory path under the configured working directory. Defaults to '.'.",
			},
			"max_results": map[string]any{
				"type":        "integer",
				"description": "Maximum matching lines to return. Defaults to 25 and is capped at 100.",
				"default":     defaultSearchMaxResult,
			},
			"case_sensitive": map[string]any{
				"type":        "boolean",
				"description": "Match case exactly. Defaults to false.",
				"default":     false,
			},
			"include_hidden": map[string]any{
				"type":        "boolean",
				"description": "Include dot-prefixed files and folders. Defaults to false.",
				"default":     false,
			},
			"include_generated": map[string]any{
				"type":        "boolean",
				"description": "Include common generated/dependency folders such as node_modules, dist, build, .next, target, and .git. Defaults to false.",
				"default":     false,
			},
			"extensions": map[string]any{
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"description": "Optional file extensions to include, for example ['.go', 'tsx'].",
			},
			"max_file_bytes": map[string]any{
				"type":        "integer",
				"description": "Maximum bytes read per file. Defaults to 262144 and is capped at 1048576.",
				"default":     defaultSearchMaxBytes,
			},
		},
		"required": []string{"query"},
	}
}

type SearchMatch struct {
	Path       string `json:"path"`
	LineNumber int    `json:"line_number"`
	Line       string `json:"line"`
}

type SearchFilesResult struct {
	Query        string        `json:"query"`
	Path         string        `json:"path"`
	Matches      []SearchMatch `json:"matches"`
	Truncated    bool          `json:"truncated"`
	FilesScanned int           `json:"files_scanned"`
}

func (t *SearchFilesTool) Execute(ctx context.Context, args map[string]any) (any, string, error) {
	query := stringArg(args, "query", "")
	if strings.TrimSpace(query) == "" {
		return nil, "", fmt.Errorf("query parameter is required")
	}

	target, rel, rootAbs, err := resolveDesktopPath(t.workingDirectory(), stringArg(args, "path", "."))
	if err != nil {
		return nil, "", err
	}

	options := searchOptions{
		query:            query,
		normalizedQuery:  query,
		caseSensitive:    boolArg(args, "case_sensitive", false),
		includeHidden:    boolArg(args, "include_hidden", false),
		includeGenerated: boolArg(args, "include_generated", false),
		maxResults:       intArg(args, "max_results", defaultSearchMaxResult, 1, maxSearchResults),
		maxFileBytes:     intArg(args, "max_file_bytes", defaultSearchMaxBytes, 1, maxSearchFileBytes),
		extensions:       extensionSet(args["extensions"]),
	}
	if !options.caseSensitive {
		options.normalizedQuery = strings.ToLower(query)
	}
	if err := validateAllowedRelativePath(rel, options.includeHidden, options.includeGenerated); err != nil {
		return nil, "", err
	}

	info, err := os.Stat(target)
	if err != nil {
		return nil, "", fmt.Errorf("unable to inspect path: %w", err)
	}

	result := SearchFilesResult{
		Query:   query,
		Path:    displayRel(rel),
		Matches: []SearchMatch{},
	}

	if info.Mode().IsRegular() {
		if err := searchOneFile(ctx, target, rootAbs, options, &result); err != nil && !errors.Is(err, errStopSearch) {
			return nil, "", err
		}
		return result, searchFilesText(result), nil
	}
	if !info.IsDir() {
		return nil, "", fmt.Errorf("path is not a searchable file or directory: %s", displayRel(rel))
	}

	err = filepath.WalkDir(target, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if path != target && entry.IsDir() {
			name := entry.Name()
			if shouldSkipDirectory(name, options) {
				return filepath.SkipDir
			}
		}
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if !options.includeHidden && isHiddenName(entry.Name()) {
			return nil
		}
		if !extensionAllowed(path, options.extensions) {
			return nil
		}
		if err := searchOneFile(ctx, path, rootAbs, options, &result); err != nil {
			return err
		}
		if len(result.Matches) >= options.maxResults {
			result.Truncated = true
			return errStopSearch
		}
		return nil
	})
	if errors.Is(err, errStopSearch) {
		err = nil
	}
	if err != nil {
		return nil, "", err
	}

	return result, searchFilesText(result), nil
}

type searchOptions struct {
	query            string
	normalizedQuery  string
	caseSensitive    bool
	includeHidden    bool
	includeGenerated bool
	maxResults       int
	maxFileBytes     int
	extensions       map[string]struct{}
}

func resolveDesktopPath(rootDir, requested string) (targetAbs, rel, rootAbs string, err error) {
	if strings.TrimSpace(rootDir) == "" {
		return "", "", "", fmt.Errorf("desktop tools require a working directory in settings")
	}
	if strings.ContainsRune(rootDir, 0) || strings.ContainsRune(requested, 0) {
		return "", "", "", fmt.Errorf("path contains an invalid null byte")
	}

	rootAbs, err = filepath.Abs(rootDir)
	if err != nil {
		return "", "", "", fmt.Errorf("unable to resolve working directory: %w", err)
	}
	rootAbs, err = filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return "", "", "", fmt.Errorf("working directory is unavailable: %w", err)
	}

	requested = strings.TrimSpace(requested)
	if requested == "" {
		requested = "."
	}

	if filepath.IsAbs(requested) {
		targetAbs, err = filepath.Abs(requested)
	} else {
		targetAbs, err = filepath.Abs(filepath.Join(rootAbs, requested))
	}
	if err != nil {
		return "", "", "", fmt.Errorf("unable to resolve path: %w", err)
	}
	targetAbs, err = filepath.EvalSymlinks(targetAbs)
	if err != nil {
		return "", "", "", fmt.Errorf("path is unavailable: %w", err)
	}

	rel, err = filepath.Rel(rootAbs, targetAbs)
	if err != nil {
		return "", "", "", fmt.Errorf("unable to verify path scope: %w", err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", "", "", fmt.Errorf("path is outside the configured working directory")
	}

	return targetAbs, rel, rootAbs, nil
}

func relativeDisplayPath(rootAbs, targetAbs string) (string, error) {
	targetEval := targetAbs
	if resolved, err := filepath.EvalSymlinks(targetAbs); err == nil {
		targetEval = resolved
	}
	rel, err := filepath.Rel(rootAbs, targetEval)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("path is outside the configured working directory")
	}
	return displayRel(rel), nil
}

func displayRel(rel string) string {
	if rel == "." || rel == "" {
		return "."
	}
	return filepath.ToSlash(rel)
}

func stringArg(args map[string]any, key, fallback string) string {
	value, ok := args[key]
	if !ok || value == nil {
		return fallback
	}
	if s, ok := value.(string); ok {
		return s
	}
	return fallback
}

func boolArg(args map[string]any, key string, fallback bool) bool {
	value, ok := args[key]
	if !ok || value == nil {
		return fallback
	}
	if b, ok := value.(bool); ok {
		return b
	}
	return fallback
}

func intArg(args map[string]any, key string, fallback, minValue, maxValue int) int {
	value, ok := args[key]
	if !ok || value == nil {
		return fallback
	}

	var parsed int
	switch v := value.(type) {
	case int:
		parsed = v
	case int64:
		parsed = int(v)
	case float64:
		parsed = int(v)
	case float32:
		parsed = int(v)
	default:
		return fallback
	}
	if parsed < minValue {
		return minValue
	}
	if parsed > maxValue {
		return maxValue
	}
	return parsed
}

func readFilePrefix(ctx context.Context, path string, limit int64) ([]byte, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, false, fmt.Errorf("unable to open file: %w", err)
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, false, fmt.Errorf("unable to read file: %w", err)
	}
	truncated := int64(len(data)) > limit
	if truncated {
		data = data[:limit]
	}
	return data, truncated, ctx.Err()
}

func looksLikeText(data []byte) bool {
	_, ok := normalizeTextData(data)
	return ok
}

func normalizeTextData(data []byte) ([]byte, bool) {
	if len(data) == 0 {
		return data, true
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return nil, false
	}
	if utf8.Valid(data) {
		return data, true
	}

	trimmed := data
	for i := 0; i < utf8.UTFMax; i++ {
		if len(trimmed) == 0 {
			return trimmed, true
		}
		trimmed = trimmed[:len(trimmed)-1]
		if utf8.Valid(trimmed) {
			return trimmed, true
		}
	}
	return nil, false
}

func splitLines(content string) []string {
	if content == "" {
		return []string{}
	}
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.TrimSuffix(content, "\n")
	if content == "" {
		return []string{""}
	}
	return strings.Split(content, "\n")
}

func selectLines(lines []string, startLine, maxLines int) (string, int) {
	if len(lines) == 0 || startLine > len(lines) {
		return "", 0
	}
	start := startLine - 1
	end := min(len(lines), start+maxLines)
	return strings.Join(lines[start:end], "\n"), end
}

func isHiddenName(name string) bool {
	return strings.HasPrefix(name, ".")
}

func isGeneratedName(name string) bool {
	_, ok := generatedDirNames[name]
	return ok
}

func validateAllowedRelativePath(rel string, includeHidden, includeGenerated bool) error {
	for _, part := range relativePathParts(rel) {
		if !includeHidden && isHiddenName(part) {
			return fmt.Errorf("hidden paths are skipped by default: %s", displayRel(rel))
		}
		if !includeGenerated && isGeneratedName(part) {
			return fmt.Errorf("generated/dependency paths are skipped by default: %s", displayRel(rel))
		}
	}
	return nil
}

func relativePathParts(rel string) []string {
	if rel == "." || rel == "" {
		return nil
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	filtered := parts[:0]
	for _, part := range parts {
		if part == "" || part == "." {
			continue
		}
		filtered = append(filtered, part)
	}
	return filtered
}

func shouldSkipDirectory(name string, options searchOptions) bool {
	if !options.includeHidden && isHiddenName(name) {
		return true
	}
	if !options.includeGenerated && isGeneratedName(name) {
		return true
	}
	return false
}

func extensionSet(value any) map[string]struct{} {
	var rawValues []string
	switch values := value.(type) {
	case []any:
		rawValues = make([]string, 0, len(values))
		for _, raw := range values {
			if ext, ok := raw.(string); ok {
				rawValues = append(rawValues, ext)
			}
		}
	case []string:
		rawValues = values
	default:
		return nil
	}
	if len(rawValues) == 0 {
		return nil
	}

	set := make(map[string]struct{}, len(rawValues))
	for _, ext := range rawValues {
		ext = strings.TrimSpace(strings.ToLower(ext))
		if ext == "" {
			continue
		}
		if !strings.HasPrefix(ext, ".") {
			ext = "." + ext
		}
		set[ext] = struct{}{}
	}
	if len(set) == 0 {
		return nil
	}
	return set
}

func extensionAllowed(path string, extensions map[string]struct{}) bool {
	if len(extensions) == 0 {
		return true
	}
	_, ok := extensions[strings.ToLower(filepath.Ext(path))]
	return ok
}

func searchOneFile(ctx context.Context, path, rootAbs string, options searchOptions, result *SearchFilesResult) error {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil
	}

	data, _, err := readFilePrefix(ctx, path, int64(options.maxFileBytes))
	if err != nil {
		return err
	}
	if normalized, ok := normalizeTextData(data); ok {
		data = normalized
	} else {
		return nil
	}

	rel, err := relativeDisplayPath(rootAbs, path)
	if err != nil {
		return nil
	}

	result.FilesScanned++
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 64*1024), options.maxFileBytes)
	lineNumber := 0
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		lineNumber++
		line := scanner.Text()
		haystack := line
		if !options.caseSensitive {
			haystack = strings.ToLower(line)
		}
		if strings.Contains(haystack, options.normalizedQuery) {
			result.Matches = append(result.Matches, SearchMatch{
				Path:       rel,
				LineNumber: lineNumber,
				Line:       truncateLine(strings.TrimSpace(line)),
			})
			if len(result.Matches) >= options.maxResults {
				result.Truncated = true
				return errStopSearch
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil
	}
	return nil
}

func truncateLine(line string) string {
	const maxLineChars = 300
	if len(line) <= maxLineChars {
		return line
	}
	return line[:maxLineChars] + "..."
}

func listFilesText(result ListFilesResult) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Directory: %s\n", result.Path)
	for _, entry := range result.Entries {
		name := entry.Path
		if entry.Type == "directory" {
			name += "/"
		}
		fmt.Fprintf(&b, "- %s (%s", name, entry.Type)
		if entry.SizeBytes > 0 {
			fmt.Fprintf(&b, ", %d bytes", entry.SizeBytes)
		}
		b.WriteString(")\n")
	}
	if result.Truncated {
		b.WriteString("Results truncated.\n")
	}
	return strings.TrimSpace(b.String())
}

func readTextFileText(result ReadTextFileResult) string {
	var b strings.Builder
	fmt.Fprintf(&b, "File: %s\n", result.Path)
	fmt.Fprintf(&b, "Lines: %d-%d of %d\n", result.StartLine, result.EndLine, result.TotalLines)
	if result.Truncated {
		b.WriteString("Content truncated by max_bytes.\n")
	}
	b.WriteString("\n")
	b.WriteString(result.Content)
	return b.String()
}

func searchFilesText(result SearchFilesResult) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Search: %q in %s\n", result.Query, result.Path)
	if len(result.Matches) == 0 {
		fmt.Fprintf(&b, "No matches across %d scanned files.", result.FilesScanned)
		return b.String()
	}
	for _, match := range result.Matches {
		fmt.Fprintf(&b, "- %s:%d: %s\n", match.Path, match.LineNumber, match.Line)
	}
	if result.Truncated {
		b.WriteString("Results truncated.\n")
	}
	return strings.TrimSpace(b.String())
}
