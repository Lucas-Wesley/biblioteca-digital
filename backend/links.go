package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const maxLinkBytes = 8 << 10

// link é um site onde procurar livros; a página Buscar livros lista todos.
type link struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Note      string `json:"note"`
	CreatedAt string `json:"created_at"`
}

func (l *library) handleListLinks(w http.ResponseWriter, r *http.Request) {
	rows, err := l.db.QueryContext(r.Context(),
		`SELECT id, name, url, note, created_at FROM links ORDER BY name COLLATE NOCASE`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar os links"})
		return
	}
	defer rows.Close()
	list := []link{}
	for rows.Next() {
		var k link
		if err := rows.Scan(&k.ID, &k.Name, &k.URL, &k.Note, &k.CreatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar os links"})
			return
		}
		list = append(list, k)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar os links"})
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (l *library) handleAddLink(w http.ResponseWriter, r *http.Request) {
	var k link
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxLinkBytes)).Decode(&k); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "link inválido"})
		return
	}
	k.URL = strings.TrimSpace(k.URL)
	k.Name = strings.TrimSpace(k.Name)
	k.Note = strings.TrimSpace(k.Note)
	// Só http e https: o endereço vira um href na página.
	u, err := url.Parse(k.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "endereço inválido; use http:// ou https://"})
		return
	}
	if k.Name == "" {
		k.Name = u.Host
	}
	err = l.db.QueryRowContext(r.Context(),
		`INSERT INTO links (name, url, note) VALUES (?, ?, ?) RETURNING id, created_at`,
		k.Name, k.URL, k.Note).Scan(&k.ID, &k.CreatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "esse endereço já está na lista"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao salvar o link"})
		return
	}
	writeJSON(w, http.StatusCreated, k)
}

func (l *library) handleDeleteLink(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "link não encontrado"})
		return
	}
	var deleted int64
	err = l.db.QueryRowContext(r.Context(), `DELETE FROM links WHERE id = ? RETURNING id`, id).Scan(&deleted)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "link não encontrado"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao apagar o link"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
