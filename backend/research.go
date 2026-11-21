package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Mais informações (R39): no leitor, o Lucas seleciona um trecho e pede para pesquisar. A pesquisa é
// a do Acervo (D26 e D54 de lá): a IA de lá busca na internet e devolve a explicação com as fontes.
// Aqui fica só o pedido (o trecho, o lugar no livro e quando), para listar as pesquisas do livro e
// voltar ao trecho; o resultado vive no Acervo (marcação com local "livros/<id do livro>"). O livro
// não muda: não há "integrar ao texto"; a pesquisa pode virar uma Referência no Acervo, com o livro,
// o autor, o capítulo e o link de volta ao trecho.

const (
	acervoTimeout = 15 * time.Second
	maxQuoteChars = 1000 // o mesmo limite do Acervo
	contextChars  = 400
)

var acervoClient = &http.Client{Timeout: acervoTimeout}

var researchID = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

type acervoConfig struct {
	url  string // o Acervo pela rede interna do Docker (vazio: integração desligada)
	link string // o Acervo como o Lucas abre, para abrir a Referência
}

type researchSource struct {
	Titulo string `json:"titulo"`
	URL    string `json:"url"`
}

// research: o pedido daqui, com o que o Acervo diz dele.
type research struct {
	ID        string  `json:"id"`
	Quote     string  `json:"quote"`
	Anchor    string  `json:"anchor"`
	Label     string  `json:"label"`
	Percent   float64 `json:"percent"`
	CreatedAt string  `json:"created_at"`
	// Do Acervo: processando, pronto, falhou; "indisponivel" quando o Acervo não respondeu.
	State         string           `json:"state"`
	Error         string           `json:"error,omitempty"`
	Explanation   string           `json:"explanation"`
	Sources       []researchSource `json:"sources"`
	UpdatedAt     string           `json:"updated_at,omitempty"`
	ReferenceLink string           `json:"reference_link,omitempty"`
}

// A marcação como o Acervo devolve.
type acervoMark struct {
	ID           string           `json:"id"`
	Estado       string           `json:"estado"`
	Erro         string           `json:"erro"`
	Explicacao   string           `json:"explicacao"`
	Fontes       []researchSource `json:"fontes"`
	AtualizadoEm string           `json:"atualizado_em"`
	Referencia   string           `json:"referencia"`
}

func (l *library) noAcervo(w http.ResponseWriter) bool {
	if l.acervo.url == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "o Acervo não está configurado neste servidor (ACERVO_URL)"})
		return true
	}
	return false
}

func (l *library) merge(r *research, m *acervoMark) {
	if m == nil {
		r.State, r.Error = "indisponivel", "o Acervo não respondeu; a pesquisa aparece quando ele voltar"
		return
	}
	r.State, r.Error, r.Explanation, r.UpdatedAt = m.Estado, m.Erro, m.Explicacao, m.AtualizadoEm
	if m.Fontes != nil {
		r.Sources = m.Fontes
	}
	if m.Referencia != "" {
		r.ReferenceLink = l.acervo.link + "/#/referencia/" + m.Referencia
	}
}

const researchColumns = `id, quote, anchor, label, percent, created_at`

func scanResearch(row interface{ Scan(...any) error }) (research, error) {
	var r research
	err := row.Scan(&r.ID, &r.Quote, &r.Anchor, &r.Label, &r.Percent, &r.CreatedAt)
	r.Sources = []researchSource{}
	return r, err
}

func (l *library) researchOf(ctx context.Context, bookID, id string) (research, error) {
	return scanResearch(l.db.QueryRowContext(ctx, `SELECT `+researchColumns+` FROM research WHERE book_id = ? AND id = ?`, bookID, id))
}

// handleListResearch: GET /api/books/{id}/research, as pesquisas do livro, da mais nova para a mais velha.
func (l *library) handleListResearch(w http.ResponseWriter, r *http.Request) {
	bookID := r.PathValue("id")
	rows, err := l.db.QueryContext(r.Context(), `SELECT `+researchColumns+` FROM research WHERE book_id = ? ORDER BY created_at DESC`, bookID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler as pesquisas"})
		return
	}
	defer rows.Close()
	list := []research{}
	for rows.Next() {
		item, err := scanResearch(rows)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler as pesquisas"})
			return
		}
		list = append(list, item)
	}
	rows.Close()
	if len(list) > 0 && l.acervo.url != "" {
		var marks []acervoMark
		err := l.callAcervo(r.Context(), http.MethodGet, "/api/detalhes?local="+url.QueryEscape("livros/"+bookID), nil, &marks)
		byID := map[string]*acervoMark{}
		for i := range marks {
			byID[marks[i].ID] = &marks[i]
		}
		for i := range list {
			m := byID[list[i].ID]
			if err == nil && m == nil {
				m = &acervoMark{Estado: "falhou", Erro: "a pesquisa não está mais no Acervo"}
			}
			l.merge(&list[i], m)
		}
	}
	writeJSON(w, http.StatusOK, list)
}

// handleGetResearch: GET /api/books/{id}/research/{research}.
func (l *library) handleGetResearch(w http.ResponseWriter, r *http.Request) {
	if l.noAcervo(w) {
		return
	}
	item, err := l.researchOf(r.Context(), r.PathValue("id"), r.PathValue("research"))
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pesquisa não encontrada"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler a pesquisa"})
		return
	}
	var m acervoMark
	if err := l.callAcervo(r.Context(), http.MethodGet, "/api/detalhes/"+item.ID, nil, &m); err != nil {
		l.merge(&item, nil)
	} else {
		l.merge(&item, &m)
	}
	writeJSON(w, http.StatusOK, item)
}

// aroundQuote: o texto antes e depois do trecho, na página do índice onde ele está (contexto para a IA).
func aroundQuote(passage, quote string) (string, string) {
	text := strings.Join(strings.Fields(passage), " ")
	q := strings.Join(strings.Fields(quote), " ")
	i := strings.Index(strings.ToLower(text), strings.ToLower(q))
	if i < 0 || q == "" {
		return lastRunes(text, contextChars*2), ""
	}
	return lastRunes(text[:i], contextChars), firstRunes(text[i+len(q):], contextChars)
}

func lastRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[len(r)-n:])
}

func firstRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// handleCreateResearch: POST /api/books/{id}/research {id, quote, anchor, label, percent}. O id vem do
// aparelho: pedir de novo o mesmo não pesquisa duas vezes.
func (l *library) handleCreateResearch(w http.ResponseWriter, r *http.Request) {
	if l.noAcervo(w) {
		return
	}
	var body struct {
		ID      string  `json:"id"`
		Quote   string  `json:"quote"`
		Anchor  string  `json:"anchor"`
		Label   string  `json:"label"`
		Percent float64 `json:"percent"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido inválido"})
		return
	}
	quote := strings.TrimSpace(body.Quote)
	switch {
	case !researchID.MatchString(body.ID):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id inválido"})
		return
	case quote == "":
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "selecione um trecho"})
		return
	case utf8.RuneCountInString(quote) > maxQuoteChars:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("trecho longo demais: selecione até %d caracteres", maxQuoteChars)})
		return
	}
	ctx := r.Context()
	bookID := r.PathValue("id")
	b, passages, err := l.chaptersOf(ctx, bookID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler o livro"})
		return
	}
	before, after := "", ""
	label := strings.TrimSpace(body.Label)
	if i := passageOf(b.Format, annotation{Quote: quote, Anchor: body.Anchor}, passages); i >= 0 {
		before, after = aroundQuote(passages[i].Text, quote)
		if passages[i].Chapter != "" {
			label = passages[i].Chapter
		}
	}
	title := b.Title
	if b.Author != "" {
		title += ", de " + b.Author
	}
	if label != "" {
		title += " (" + label + ")"
	}
	if _, err := l.db.ExecContext(ctx, `INSERT OR IGNORE INTO research (id, book_id, quote, anchor, label, percent, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, body.ID, bookID, quote, body.Anchor, label, body.Percent, time.Now().UTC().Format(time.RFC3339)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao guardar a pesquisa"})
		return
	}
	var m acervoMark
	request := map[string]string{"local": "livros/" + bookID, "titulo": title, "trecho": quote, "antes": before, "depois": after}
	if err := l.callAcervo(ctx, http.MethodPut, "/api/detalhes/"+body.ID, request, &m); err != nil {
		l.db.ExecContext(ctx, `DELETE FROM research WHERE id = ?`, body.ID)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	item, err := l.researchOf(ctx, bookID, body.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler a pesquisa"})
		return
	}
	l.merge(&item, &m)
	writeJSON(w, http.StatusCreated, item)
}

// handleResearchAction: POST /api/books/{id}/research/{research}/{action}, com action "refazer"
// (pedir de novo) ou "referencia" (virar uma Referência no Acervo).
func (l *library) handleResearchAction(w http.ResponseWriter, r *http.Request) {
	if l.noAcervo(w) {
		return
	}
	ctx := r.Context()
	bookID := r.PathValue("id")
	item, err := l.researchOf(ctx, bookID, r.PathValue("research"))
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pesquisa não encontrada"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler a pesquisa"})
		return
	}
	switch r.PathValue("action") {
	case "refazer":
		var m acervoMark
		if err := l.callAcervo(ctx, http.MethodPost, "/api/detalhes/"+item.ID+"/refazer", nil, &m); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		l.merge(&item, &m)
		writeJSON(w, http.StatusOK, item)
	case "referencia":
		var title, author string
		l.db.QueryRowContext(ctx, `SELECT title, author FROM books WHERE id = ?`, bookID).Scan(&title, &author)
		link := fmt.Sprintf("%s/#/livro/%s", l.flashcards.library, url.PathEscape(bookID))
		if item.Anchor != "" {
			link += "?em=" + url.QueryEscape(item.Anchor)
		}
		request := map[string]any{"origem": map[string]string{"titulo": title, "autor": author, "capitulo": item.Label, "link": link}}
		var created struct {
			Referencia struct {
				ID string `json:"id"`
			} `json:"referencia"`
			JaExistia bool `json:"ja_existia"`
		}
		if err := l.callAcervo(ctx, http.MethodPost, "/api/detalhes/"+item.ID+"/referencia", request, &created); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"reference_link": l.acervo.link + "/#/referencia/" + created.Referencia.ID,
			"existed":        created.JaExistia,
		})
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ação desconhecida"})
	}
}

// handleDeleteResearch: DELETE /api/books/{id}/research/{research}; apaga aqui e no Acervo.
func (l *library) handleDeleteResearch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("research")
	if l.acervo.url != "" {
		var ignored any
		if err := l.callAcervo(r.Context(), http.MethodDelete, "/api/detalhes/"+url.PathEscape(id), nil, &ignored); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
	}
	if _, err := l.db.ExecContext(r.Context(), `DELETE FROM research WHERE book_id = ? AND id = ?`, r.PathValue("id"), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao apagar a pesquisa"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// callAcervo fala com o Acervo; a mensagem de erro dele chega ao Lucas como veio.
func (l *library) callAcervo(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, l.acervo.url+path, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := acervoClient.Do(req)
	if err != nil {
		return errors.New("o Acervo não respondeu")
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 300 {
		var e struct {
			Erro string `json:"erro"`
		}
		if json.Unmarshal(data, &e) == nil && e.Erro != "" {
			return errors.New(strings.TrimSuffix(e.Erro, "."))
		}
		return fmt.Errorf("o Acervo respondeu %d", resp.StatusCode)
	}
	if resp.StatusCode == http.StatusNoContent || len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}
