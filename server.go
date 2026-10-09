// eNGE LAN server: emulator files, game files, and cloud saves on one port.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const (
	maxStateBytes  = 32 * 1024 * 1024
	memoryCardSize = 128 * 1024
)

type server struct {
	docsDir  string
	gamesDir string
	cloudDir string
}

type gameEntry struct {
	name string
	url  string
}

func ensureGamesCSV(gamesDir string) error {
	root, err := filepath.EvalSymlinks(gamesDir)
	if err != nil {
		return err
	}
	csvPath := filepath.Join(root, "games.csv")
	if _, err := os.Stat(csvPath); err == nil {
		log.Printf("using existing games catalog: %s", csvPath)
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}

	var games []gameEntry
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".cue") {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		parts := strings.Split(filepath.ToSlash(relative), "/")
		encodedParts := make([]string, len(parts))
		for i, part := range parts {
			encodedParts[i] = url.PathEscape(part)
		}
		name := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if len(parts) > 1 && parts[0] != "." {
			name = parts[0]
		}
		games = append(games, gameEntry{name: name, url: "/" + strings.Join(encodedParts, "/")})
		return nil
	})
	if err != nil {
		return err
	}
	sort.Slice(games, func(i, j int) bool { return strings.ToLower(games[i].name) < strings.ToLower(games[j].name) })

	file, err := os.Create(csvPath)
	if err != nil {
		return err
	}
	defer file.Close()
	for _, line := range append([]string{"name,url"}, csvLines(games)...) {
		if _, err := fmt.Fprintln(file, line); err != nil {
			return err
		}
	}
	log.Printf("created games catalog: %s with %d CUE game(s)", csvPath, len(games))
	return nil
}

func csvLines(games []gameEntry) []string {
	lines := make([]string, 0, len(games))
	for _, game := range games {
		lines = append(lines, csvField(game.name)+","+csvField(game.url))
	}
	return lines
}

func csvField(value string) string {
	if !strings.ContainsAny(value, ",\"\r\n") {
		return value
	}
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func biosCatalogCSV(gamesDir string) ([]byte, error) {
	root, err := filepath.EvalSymlinks(gamesDir)
	if err != nil {
		return nil, err
	}
	var bios []gameEntry
	seenNames := make(map[string]bool)
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		name := strings.ToLower(entry.Name())
		if !strings.HasPrefix(name, "scph") && name != "bios.bin" && name != "openbios.bin" {
			return nil
		}
		if seenNames[name] {
			return nil
		}
		seenNames[name] = true
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		parts := strings.Split(filepath.ToSlash(relative), "/")
		encodedParts := make([]string, len(parts))
		for i, part := range parts {
			encodedParts[i] = url.PathEscape(part)
		}
		bios = append(bios, gameEntry{name: entry.Name(), url: "/" + strings.Join(encodedParts, "/")})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(bios, func(i, j int) bool { return strings.ToLower(bios[i].name) < strings.ToLower(bios[j].name) })
	lines := append([]string{"name,url"}, csvLines(bios)...)
	return []byte(strings.Join(lines, "\n") + "\n"), nil
}

func ensureBiosCSV(gamesDir string) error {
	root, err := filepath.EvalSymlinks(gamesDir)
	if err != nil {
		return err
	}
	csvPath := filepath.Join(root, "bios.csv")
	if _, err := os.Stat(csvPath); err == nil {
		log.Printf("using existing BIOS catalog: %s", csvPath)
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	data, err := biosCatalogCSV(gamesDir)
	if err != nil {
		return err
	}
	if err := os.WriteFile(csvPath, data, 0644); err != nil {
		return err
	}
	log.Printf("created BIOS catalog: %s", csvPath)
	return nil
}

func (s *server) cors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, PUT, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Range")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")
	w.Header().Set("Cache-Control", "no-store, max-age=0")
}

func safePath(root, requestPath string) (string, bool) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(requestPath, "/")))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", false
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return "", false
	}
	path := filepath.Join(root, clean)
	resolved, err := filepath.Abs(path)
	if err != nil || (resolved != root && !strings.HasPrefix(resolved, root+string(os.PathSeparator))) {
		return "", false
	}
	return resolved, true
}

func (s *server) staticFile(w http.ResponseWriter, r *http.Request) {
	requestPath := r.URL.Path
	if requestPath == "/" {
		requestPath = "/index.html"
	}
	var file string
	var ok bool
	if file, ok = safePath(s.docsDir, requestPath); !ok {
		http.NotFound(w, r)
		return
	}
	if info, err := os.Stat(file); err != nil || info.IsDir() {
		file, ok = safePath(s.gamesDir, requestPath)
		if !ok {
			http.NotFound(w, r)
			return
		}
	}
	info, err := os.Stat(file)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}

	f, err := os.Open(file)
	if err != nil {
		http.Error(w, "Unable to open file", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	size := info.Size()
	start, end := int64(0), size-1
	rangeHeader := r.Header.Get("Range")
	if rangeHeader != "" {
		if !strings.HasPrefix(rangeHeader, "bytes=") || strings.Contains(rangeHeader, ",") {
			http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
			return
		}
		parts := strings.SplitN(strings.TrimPrefix(rangeHeader, "bytes="), "-", 2)
		if len(parts) != 2 {
			http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
			return
		}
		if parts[0] == "" {
			n, parseErr := strconv.ParseInt(parts[1], 10, 64)
			if parseErr != nil || n <= 0 {
				http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
				return
			}
			if n > size {
				n = size
			}
			start = size - n
		} else {
			var parseErr error
			start, parseErr = strconv.ParseInt(parts[0], 10, 64)
			if parseErr != nil || start < 0 || start >= size {
				http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
				return
			}
			if parts[1] != "" {
				end, parseErr = strconv.ParseInt(parts[1], 10, 64)
				if parseErr != nil || end < start {
					http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
					return
				}
			}
			if end >= size {
				end = size - 1
			}
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.Header().Set("Content-Type", mime.TypeByExtension(filepath.Ext(file)))
		w.WriteHeader(http.StatusPartialContent)
		if r.Method != http.MethodHead {
			_, _ = f.Seek(start, io.SeekStart)
			_, _ = io.CopyN(w, f, end-start+1)
		}
		return
	}

	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("Content-Type", mime.TypeByExtension(filepath.Ext(file)))
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

func (s *server) cloudPath(name string) string { return filepath.Join(s.cloudDir, name) }

func (s *server) cloud(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	switch r.URL.Path {
	case "/api/status":
		state, _ := os.Stat(s.cloudPath("state.json"))
		card, _ := os.Stat(s.cloudPath("memorycard.mcr"))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"state": state != nil, "memorycard": card != nil})
	case "/api/state":
		s.cloudFile(w, r, "state.json", "application/json", maxStateBytes)
	case "/api/memorycard":
		s.cloudFile(w, r, "memorycard.mcr", "application/octet-stream", memoryCardSize)
	default:
		http.NotFound(w, r)
	}
}

func (s *server) cloudFile(w http.ResponseWriter, r *http.Request, name, contentType string, limit int64) {
	path := s.cloudPath(name)
	if r.Method == http.MethodGet {
		data, err := os.ReadFile(path)
		if err != nil {
			http.Error(w, "Nothing has been saved yet", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		_, _ = w.Write(data)
		return
	}
	if r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if r.ContentLength < 0 || r.ContentLength > limit {
		http.Error(w, "Payload is missing or too large", http.StatusRequestEntityTooLarge)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil || int64(len(data)) != r.ContentLength || int64(len(data)) > limit {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}
	if name == "state.json" && !json.Valid(data) {
		http.Error(w, "Save state must be valid JSON", http.StatusBadRequest)
		return
	}
	if name == "memorycard.mcr" && len(data) != memoryCardSize {
		http.Error(w, "Memory card must be exactly 128 KB", http.StatusBadRequest)
		return
	}
	if err := os.MkdirAll(s.cloudDir, 0755); err != nil {
		http.Error(w, "Unable to create cloud storage", http.StatusInternalServerError)
		return
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0644); err != nil || os.Rename(temporary, path) != nil {
		http.Error(w, "Unable to save cloud file", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func localIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		defer conn.Close()
		if address, ok := conn.LocalAddr().(*net.UDPAddr); ok {
			return address.IP.String()
		}
	}
	return "127.0.0.1"
}

func main() {
	port := flag.Int("port", 8000, "HTTP port")
	docsDir := flag.String("docs", "docs", "emulator docs directory")
	gamesDir := flag.String("games", "games", "game files directory")
	cloudDir := flag.String("cloud", "cloud-data", "cloud save directory")
	flag.Parse()

	s := &server{docsDir: *docsDir, gamesDir: *gamesDir, cloudDir: *cloudDir}
	if err := ensureGamesCSV(*gamesDir); err != nil {
		log.Printf("could not generate games.csv: %v", err)
	}
	if err := ensureBiosCSV(*gamesDir); err != nil {
		log.Printf("could not generate bios.csv: %v", err)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.cors(w)
		if r.URL.Path == "/bios.csv" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			data, err := biosCatalogCSV(s.gamesDir)
			if err != nil {
				http.Error(w, "Unable to build BIOS catalog", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "text/csv; charset=utf-8")
			w.Header().Set("Content-Length", strconv.Itoa(len(data)))
			if r.Method == http.MethodGet {
				_, _ = w.Write(data)
			}
			return
		}
		if r.URL.Path == "/api/status" || r.URL.Path == "/api/state" || r.URL.Path == "/api/memorycard" {
			s.cloud(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		s.staticFile(w, r)
	})

	address := fmt.Sprintf("0.0.0.0:%d", *port)
	log.Printf("eNGE server listening on http://%s:%d", localIP(), *port)
	log.Printf("docs=%s games=%s cloud=%s", *docsDir, *gamesDir, *cloudDir)
	log.Fatal(http.ListenAndServe(address, loggingHandler(handler)))
}

func loggingHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s Range=%q", r.RemoteAddr, r.Method, r.URL.RequestURI())
		next.ServeHTTP(w, r)
	})
}
