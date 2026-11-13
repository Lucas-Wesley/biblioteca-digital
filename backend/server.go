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
	mux.HandleFunc("GET /api/books/{id}/progress", lib.handleGetProgress)
	mux.HandleFunc("PUT /api/books/{id}/progress", lib.handlePutProgress)
	mux.HandleFunc("GET /api/books/{id}/publication/{path...}", lib.handlePublication)
	mux.HandleFunc("GET /api/books/{id}/annotations", lib.handleListAnnotations)
	mux.HandleFunc("PUT /api/books/{id}/annotations/{annotation}", lib.handlePutAnnotation)
	mux.HandleFunc("DELETE /api/books/{id}/annotations/{annotation}", lib.handleDeleteAnnotation)
	mux.HandleFunc("POST /api/books/{id}/annotations/{annotation}/flashcards", lib.handleAnnotationFlashcards)
	mux.HandleFunc("GET /api/flashcards/decks", lib.handleFlashcardsDecks)
	mux.HandleFunc("PUT /api/books/{id}/reading/{day}", lib.handlePutReading)
	mux.HandleFunc("GET /api/reading", lib.handleListReading)
	mux.HandleFunc("GET /api/search", lib.handleSearch)
	mux.HandleFunc("GET /api/books/{id}/chapters", lib.handleChapters)
	mux.HandleFunc("GET /api/books/{id}/text", lib.handleText)
	mux.HandleFunc("GET /api/links", lib.handleListLinks)
	mux.HandleFunc("POST /api/links", lib.handleAddLink)
	mux.HandleFunc("DELETE /api/links/{id}", lib.handleDeleteLink)
	mux.HandleFunc("GET /api/plans", lib.handleListPlans)
	mux.HandleFunc("POST /api/plans", lib.handleCreatePlan)
	mux.HandleFunc("PUT /api/plans/{id}", lib.handleUpdatePlan)
	mux.HandleFunc("DELETE /api/plans/{id}", lib.handleDeletePlan)
	mux.HandleFunc("GET /api/plans/{id}/cover", lib.handlePlanCover)
	mux.HandleFunc("POST /api/plans/{id}/replan", lib.handleReplan)
	mux.HandleFunc("PUT /api/plans/{id}/goals/{goal}", lib.handleMarkGoal)
	mux.HandleFunc("GET /api/catalogo", lib.handleCatalog)
	mux.HandleFunc("GET /api/sugestoes", lib.handleListSuggestions)
	mux.HandleFunc("PUT /api/sugestoes/{id}", lib.handlePutSuggestion)
	mux.HandleFunc("PATCH /api/sugestoes/{id}", lib.handleMarkSuggestion)
	mux.HandleFunc("DELETE /api/sugestoes/{id}", lib.handleDeleteSuggestion)
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
