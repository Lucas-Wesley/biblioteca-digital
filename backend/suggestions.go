package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const maxSuggestionBytes = 16 << 10

// suggestion é uma melhoria que o Lucas anota no app (Ajustes). O Claude Code lê pela API, faz o
// que foi pedido e marca como feita, com uma resposta. A API é igual em todas as apps do homelab,
// por isso os campos em português.
type suggestion struct {
	ID        string `json:"id"`
	Text      string `json:"texto"`
	Screen    string `json:"tela"`
	State     string `json:"estado"` // nova, feita ou descartada
	Answer    string `json:"resposta"`
	CreatedAt string `json:"criada_em"`
	UpdatedAt string `json:"atualizada_em"`
}

// O id vem do aparelho: a sugestão escrita fora de casa sobe depois sem duplicar.
var suggestionID = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

var suggestionStates = map[string]bool{"nova": true, "feita": true, "descartada": true}

const suggestionColumns = `id, texto, tela, estado, resposta, criada_em, atualizada_em`

func scanSuggestion(row interface{ Scan(...any) error }) (suggestion, error) {
	var s suggestion
	err := row.Scan(&s.ID, &s.Text, &s.Screen, &s.State, &s.Answer, &s.CreatedAt, &s.UpdatedAt)
	return s, err
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func (l *library) handleListSuggestions(w http.ResponseWriter, r *http.Request) {
	rows, err := l.db.QueryContext(r.Context(),
		`SELECT `+suggestionColumns+` FROM sugestoes ORDER BY estado != 'nova', criada_em DESC`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar as sugestões"})
		return
	}
	defer rows.Close()
	list := []suggestion{}
	for rows.Next() {
		s, err := scanSuggestion(rows)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar as sugestões"})
			return
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar as sugestões"})
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handlePutSuggestion cria a sugestão ou corrige o texto de uma que ainda não foi feita.
func (l *library) handlePutSuggestion(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !suggestionID.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id inválido"})
		return
	}
	var body struct {
		Text   string `json:"texto"`
		Screen string `json:"tela"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSuggestionBytes)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sugestão inválida"})
		return
	}
	text := strings.TrimSpace(body.Text)
	if text == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "escreva a sugestão"})
		return
	}
	_, err := l.db.ExecContext(r.Context(), `INSERT INTO sugestoes (id, texto, tela, estado, criada_em, atualizada_em)
		VALUES (?, ?, ?, 'nova', ?, ?)
		ON CONFLICT (id) DO UPDATE SET texto = excluded.texto, atualizada_em = excluded.atualizada_em
		WHERE estado = 'nova'`, id, text, strings.TrimSpace(body.Screen), now(), now())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao salvar a sugestão"})
		return
	}
	l.writeSuggestion(w, r, id)
}

// handleMarkSuggestion muda o estado e deixa uma resposta; é o que o Claude Code usa ao terminar.
func (l *library) handleMarkSuggestion(w http.ResponseWriter, r *http.Request) {
	var body struct {
		State  string `json:"estado"`
		Answer string `json:"resposta"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSuggestionBytes)).Decode(&body); err != nil || !suggestionStates[body.State] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "estado inválido: use nova, feita ou descartada"})
		return
	}
	res, err := l.db.ExecContext(r.Context(), `UPDATE sugestoes SET estado = ?, resposta = ?, atualizada_em = ? WHERE id = ?`,
		body.State, strings.TrimSpace(body.Answer), now(), r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao salvar a sugestão"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sugestão não encontrada"})
		return
	}
	l.writeSuggestion(w, r, r.PathValue("id"))
}

func (l *library) handleDeleteSuggestion(w http.ResponseWriter, r *http.Request) {
	if _, err := l.db.ExecContext(r.Context(), `DELETE FROM sugestoes WHERE id = ?`, r.PathValue("id")); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao apagar a sugestão"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (l *library) writeSuggestion(w http.ResponseWriter, r *http.Request, id string) {
	s, err := scanSuggestion(l.db.QueryRowContext(r.Context(), `SELECT `+suggestionColumns+` FROM sugestoes WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sugestão não encontrada"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler a sugestão"})
		return
	}
	writeJSON(w, http.StatusOK, s)
}
