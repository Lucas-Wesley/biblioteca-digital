package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"slices"
)

const (
	maxAnnotationBytes = 256 << 10
	maxAnchorChars     = 16 << 10
	maxLabelChars      = 1 << 10
)

var (
	annotationColors = []string{"amarelo", "verde", "azul", "rosa"}
	// O id vem do aparelho, para a marcação feita offline já nascer com ele.
	validAnnotationID = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)
)

// annotation serve aos dois formatos: anchor é um Locator do Readium no EPUB e a página com
// os retângulos da seleção no PDF. quote guarda o texto, para a marcação valer fora do leitor.
type annotation struct {
	ID        string  `json:"id"`
	Color     string  `json:"color"`
	Note      string  `json:"note"`
	Quote     string  `json:"quote"`
	Anchor    string  `json:"anchor"`
	Label     string  `json:"label"`
	Percent   float64 `json:"percent"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

func (l *library) handleListAnnotations(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !l.bookExists(r.Context(), id) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	rows, err := l.db.QueryContext(r.Context(),
		`SELECT id, color, note, quote, anchor, label, percent, created_at, updated_at
		 FROM annotations WHERE book_id = ? ORDER BY percent, created_at`, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar as marcações"})
		return
	}
	defer rows.Close()
	list := []annotation{}
	for rows.Next() {
		var a annotation
		if err := rows.Scan(&a.ID, &a.Color, &a.Note, &a.Quote, &a.Anchor, &a.Label, &a.Percent, &a.CreatedAt, &a.UpdatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar as marcações"})
			return
		}
		list = append(list, a)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar as marcações"})
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handlePutAnnotation cria ou atualiza pelo id, então reenviar a mesma marcação não duplica.
func (l *library) handlePutAnnotation(w http.ResponseWriter, r *http.Request) {
	bookID := r.PathValue("id")
	if !l.bookExists(r.Context(), bookID) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	var a annotation
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxAnnotationBytes)).Decode(&a)
	id := r.PathValue("annotation")
	if err != nil || !validAnnotationID.MatchString(id) || !slices.Contains(annotationColors, a.Color) ||
		a.Anchor == "" || len(a.Anchor) > maxAnchorChars || len(a.Label) > maxLabelChars || a.Percent < 0 || a.Percent > 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "marcação inválida"})
		return
	}
	updatedAt := editTime(a.UpdatedAt)
	createdAt := a.CreatedAt
	if createdAt == "" {
		createdAt = updatedAt
	} else {
		createdAt = editTime(createdAt)
	}
	_, err = l.db.ExecContext(r.Context(),
		`INSERT INTO annotations (id, book_id, color, note, quote, anchor, label, percent, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (id) DO UPDATE SET color = excluded.color, note = excluded.note, updated_at = excluded.updated_at
		 WHERE annotations.book_id = excluded.book_id
			AND julianday(excluded.updated_at) >= julianday(annotations.updated_at)`,
		id, bookID, a.Color, a.Note, a.Quote, a.Anchor, a.Label, a.Percent, createdAt, updatedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao salvar a marcação"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteAnnotation responde 204 mesmo sem a linha: o aparelho pode reenviar o pedido.
func (l *library) handleDeleteAnnotation(w http.ResponseWriter, r *http.Request) {
	_, err := l.db.ExecContext(r.Context(),
		`DELETE FROM annotations WHERE id = ? AND book_id = ?`, r.PathValue("annotation"), r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao apagar a marcação"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
