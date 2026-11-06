package main

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

const (
	maxProgressBytes = 16 << 10
	maxPositionChars = 4 << 10
	timeLayout       = "2006-01-02T15:04:05.000Z"
)

// progress serve a todos os formatos: position é um Locator do Readium no EPUB e o número da
// página no PDF, com a fração lida no modo texto ("12.40"). Quem veio da época do epub.js ainda
// pode ter um CFI aqui; o leitor o converte.
type progress struct {
	Position  string  `json:"position"`
	Percent   float64 `json:"percent"`
	UpdatedAt string  `json:"updated_at,omitempty"`
}

// isoTime formata uma coluna de data; as linhas antigas foram gravadas com CURRENT_TIMESTAMP.
func isoTime(column string) string {
	return `strftime('%Y-%m-%dT%H:%M:%fZ', ` + column + `)`
}

// editTime é quando o leitor fez a mudança, que pode ter sido offline, horas antes de chegar
// aqui. Um relógio adiantado não pode bloquear as mudanças seguintes, então o futuro vira agora.
func editTime(sent string) string {
	now := time.Now().UTC()
	t, err := time.Parse(time.RFC3339, sent)
	if err != nil || t.After(now) {
		t = now
	}
	return t.UTC().Format(timeLayout)
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
		`SELECT position, percent, `+isoTime("updated_at")+` FROM progress WHERE book_id = ?`, id).
		Scan(&p.Position, &p.Percent, &p.UpdatedAt)
	writeJSON(w, http.StatusOK, p)
}

// handlePutProgress vale a última leitura, não a última a chegar: um celular que volta para
// casa com progresso antigo não apaga o que foi lido depois em outro aparelho.
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
		`INSERT INTO progress (book_id, position, percent, updated_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (book_id) DO UPDATE SET
			position = excluded.position, percent = excluded.percent, updated_at = excluded.updated_at
		 WHERE julianday(excluded.updated_at) >= julianday(progress.updated_at)`,
		id, p.Position, p.Percent, editTime(p.UpdatedAt))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao salvar o progresso"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
