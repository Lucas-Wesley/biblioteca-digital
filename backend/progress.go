package main

import (
	"context"
	"encoding/json"
	"net/http"
)

const (
	maxProgressBytes = 16 << 10
	maxPositionChars = 4 << 10
)

// progress serve a todos os formatos: position é um CFI no EPUB e o número da página no PDF.
type progress struct {
	Position  string  `json:"position"`
	Percent   float64 `json:"percent"`
	UpdatedAt string  `json:"updated_at,omitempty"`
}

func (l *library) bookExists(ctx context.Context, id string) bool {
	var found string
	return l.db.QueryRowContext(ctx, `SELECT id FROM books WHERE id = ?`, id).Scan(&found) == nil
}

func (l *library) handleGetProgress(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !l.bookExists(r.Context(), id) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	// Sem linha, a resposta é o progresso zerado: o livro apenas ainda não foi aberto.
	p := progress{}
	l.db.QueryRowContext(r.Context(),
		`SELECT position, percent, updated_at FROM progress WHERE book_id = ?`, id).
		Scan(&p.Position, &p.Percent, &p.UpdatedAt)
	writeJSON(w, http.StatusOK, p)
}

func (l *library) handlePutProgress(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !l.bookExists(r.Context(), id) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	var p progress
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxProgressBytes)).Decode(&p)
	if err != nil || p.Position == "" || len(p.Position) > maxPositionChars || p.Percent < 0 || p.Percent > 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "progresso inválido"})
		return
	}
	_, err = l.db.ExecContext(r.Context(),
		`INSERT INTO progress (book_id, position, percent) VALUES (?, ?, ?)
		 ON CONFLICT (book_id) DO UPDATE SET
			position = excluded.position, percent = excluded.percent, updated_at = CURRENT_TIMESTAMP`,
		id, p.Position, p.Percent)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao salvar o progresso"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
