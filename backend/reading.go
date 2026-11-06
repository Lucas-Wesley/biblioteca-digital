package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"time"
)

const maxReadingBytes = 4 << 10

// readingDay é quanto um aparelho leu de um livro num dia: o tempo com a leitura ativa e as
// páginas lidas. Cada aparelho manda o total dele do dia, que só cresce; reenviar não soma duas
// vezes, e as estatísticas somam os aparelhos.
type readingDay struct {
	Device    string  `json:"device"`
	Day       string  `json:"day"`
	BookID    string  `json:"book_id"`
	Seconds   int     `json:"seconds"`
	Pages     float64 `json:"pages"`
	BookPages int     `json:"book_pages"`
}

var deviceID = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

// validDay aceita só a data (AAAA-MM-DD), no horário de Brasília, como o leitor a calcula.
func validDay(day string) bool {
	_, err := time.Parse(time.DateOnly, day)
	return err == nil
}

func (l *library) handlePutReading(w http.ResponseWriter, r *http.Request) {
	id, day := r.PathValue("id"), r.PathValue("day")
	if !l.bookExists(r.Context(), id) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	var d readingDay
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxReadingBytes)).Decode(&d)
	if err != nil || !validDay(day) || !deviceID.MatchString(d.Device) ||
		d.Seconds < 0 || d.Seconds > 24*60*60 || d.Pages < 0 || d.Pages > 1e5 || d.BookPages < 0 || d.BookPages > 1e6 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "leitura inválida"})
		return
	}
	_, err = l.db.ExecContext(r.Context(),
		`INSERT INTO reading_days (device, day, book_id, seconds, pages, book_pages, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (device, day, book_id) DO UPDATE SET
			seconds = MAX(seconds, excluded.seconds), pages = MAX(pages, excluded.pages),
			book_pages = excluded.book_pages, updated_at = excluded.updated_at`,
		d.Device, day, id, d.Seconds, d.Pages, d.BookPages, now())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao salvar a leitura"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleListReading devolve os dias de leitura de todos os aparelhos; as contas ficam no app,
// que também soma o que o aparelho ainda não enviou.
func (l *library) handleListReading(w http.ResponseWriter, r *http.Request) {
	rows, err := l.db.QueryContext(r.Context(),
		`SELECT device, day, book_id, seconds, pages, book_pages FROM reading_days ORDER BY day, book_id, device`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler as estatísticas"})
		return
	}
	defer rows.Close()
	list := []readingDay{}
	for rows.Next() {
		var d readingDay
		if err := rows.Scan(&d.Device, &d.Day, &d.BookID, &d.Seconds, &d.Pages, &d.BookPages); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler as estatísticas"})
			return
		}
		list = append(list, d)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler as estatísticas"})
		return
	}
	writeJSON(w, http.StatusOK, list)
}
