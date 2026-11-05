package main

import (
	"database/sql"
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

func newServer(db *sql.DB, web fs.FS, lib *library, version string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", handleHealth(db, version))
	mux.HandleFunc("GET /api/books", lib.handleList)
	mux.HandleFunc("POST /api/books", lib.handleUpload)
	mux.HandleFunc("GET /api/books/{id}/file", lib.handleFile)
	mux.HandleFunc("GET /api/books/{id}/cover", lib.handleCover)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "não encontrado"})
	})
	mux.Handle("/", spaHandler(web))
	return mux
}

func handleHealth(db *sql.DB, version string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := db.PingContext(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "erro", "version": version})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": version})
	}
}

// spaHandler entrega os arquivos do frontend; caminhos desconhecidos recebem o index.html.
func spaHandler(web fs.FS) http.Handler {
	files := http.FileServerFS(web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" {
			if _, err := fs.Stat(web, name); err != nil {
				http.ServeFileFS(w, r, web, "index.html")
				return
			}
		}
		files.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}
