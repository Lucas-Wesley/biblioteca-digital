package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"errors"
	"net/http"
	"net/url"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Capítulos e texto de um livro (R33), para o Acervo resumir um ou mais capítulos. O texto vem
// do índice da busca (R32): o livro precisa estar indexado. No EPUB, os capítulos são os do
// sumário, como os trechos já guardam; no PDF, o sumário do arquivo (o pdftohtml lê), e um PDF
// sem sumário é escolhido por páginas.

const (
	outlineTimeout = 30 * time.Second
	maxBookText    = 600_000 // caracteres por pedido de texto
)

type chapter struct {
	N         int    `json:"n"` // de 1 em diante, na ordem do livro
	Title     string `json:"title"`
	Level     int    `json:"level"`
	FirstPage int    `json:"first_page"`
	LastPage  int    `json:"last_page"`
	Chars     int    `json:"chars"`
	// Marcações do Lucas no capítulo: o Acervo as trata como os pontos-chave do resumo.
	Highlights int `json:"highlights"`
	// Onde o capítulo começa, no formato das marcações: abre o leitor ali (meta do dia, R35).
	Anchor string `json:"anchor"`
}

type bookChapters struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Author   string    `json:"author"`
	Format   string    `json:"format"`
	Indexed  bool      `json:"indexed"`
	Error    string    `json:"error,omitempty"` // por que o livro não está no índice
	Pages    int       `json:"pages"`
	Chapters []chapter `json:"chapters"`
}

type indexedPassage struct {
	Page        int
	Chapter     string
	Href        string
	Progression float64
	Text        string
}

func (l *library) bookPassages(ctx context.Context, id string) ([]indexedPassage, error) {
	rows, err := l.db.QueryContext(ctx,
		`SELECT page, chapter, href, progression, text FROM passages WHERE book_id = ? ORDER BY rowid`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []indexedPassage
	for rows.Next() {
		var p indexedPassage
		if err := rows.Scan(&p.Page, &p.Chapter, &p.Href, &p.Progression, &p.Text); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

// chaptersOf monta o sumário com páginas e tamanho. fileName só é usado no PDF.
func (l *library) chaptersOf(ctx context.Context, id string) (bookChapters, []indexedPassage, error) {
	var b bookChapters
	var fileName string
	err := l.db.QueryRowContext(ctx, `SELECT id, title, author, format, file_name FROM books WHERE id = ?`, id).
		Scan(&b.ID, &b.Title, &b.Author, &b.Format, &fileName)
	if err != nil {
		return b, nil, err
	}
	b.Chapters = []chapter{}
	var indexError sql.NullString
	l.db.QueryRowContext(ctx, `SELECT error FROM indexed_books WHERE book_id = ?`, id).Scan(&indexError)
	if !indexError.Valid {
		b.Error = "o livro ainda está entrando no índice da busca"
		return b, nil, nil
	}
	if indexError.String != "" {
		b.Error = indexError.String
		return b, nil, nil
	}
	b.Indexed = true
	passages, err := l.bookPassages(ctx, id)
	if err != nil {
		return b, nil, err
	}
	for _, p := range passages {
		b.Pages = max(b.Pages, p.Page)
	}
	if b.Format == formatPDF {
		b.Chapters = pdfChapters(l.pdfOutline(ctx, filepath.Join(l.booksDir, fileName)), passages, b.Pages)
	} else {
		b.Chapters = epubChapters(passages)
	}
	return b, passages, nil
}

// epubChapters: cada sequência de trechos com o mesmo capítulo é um capítulo.
func epubChapters(passages []indexedPassage) []chapter {
	list := []chapter{}
	for i, p := range passages {
		if i == 0 || p.Chapter != passages[i-1].Chapter {
			title := p.Chapter
			if title == "" {
				title = "Antes do primeiro capítulo"
			}
			list = append(list, chapter{N: len(list) + 1, Title: title, Level: 1, FirstPage: p.Page,
				Anchor: anchorFor(formatEpub, p.Page, p.Href, p.Progression)})
		}
		c := &list[len(list)-1]
		c.LastPage = p.Page
		c.Chars += utf8.RuneCountInString(p.Text)
	}
	return list
}

type outlineItem struct {
	Title string
	Level int
	Page  int
}

// pdfOutline lê o sumário do PDF com o pdftohtml (do mesmo Poppler do pdftotext). Sem o programa
// ou sem sumário, devolve nada: o livro é escolhido por páginas.
func (l *library) pdfOutline(ctx context.Context, file string) []outlineItem {
	ctx, cancel := context.WithTimeout(ctx, outlineTimeout)
	defer cancel()
	bin := filepath.Join(filepath.Dir(l.pdftotext), "pdftohtml")
	if !strings.ContainsRune(l.pdftotext, filepath.Separator) {
		bin = "pdftohtml"
	}
	var out bytes.Buffer
	cmd := exec.CommandContext(ctx, bin, "-xml", "-i", "-q", "-stdout", "-f", "1", "-l", "1", file)
	cmd.Stdout = &out
	if cmd.Run() != nil {
		return nil
	}
	return parseOutline(out.Bytes())
}

// parseOutline lê o <outline> do pdftohtml -xml: os filhos de um item vêm num <outline> logo
// depois dele.
func parseOutline(data []byte) []outlineItem {
	dec := xml.NewDecoder(bytes.NewReader(data))
	dec.Strict = false
	dec.AutoClose = xml.HTMLAutoClose
	dec.Entity = xml.HTMLEntity
	var items []outlineItem
	depth := 0
	var current *outlineItem
	var text strings.Builder
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "outline":
				depth++
			case "item":
				page := 0
				for _, a := range t.Attr {
					if a.Name.Local == "page" {
						page, _ = strconv.Atoi(a.Value)
					}
				}
				current = &outlineItem{Level: depth, Page: page}
				text.Reset()
			}
		case xml.CharData:
			if current != nil {
				text.Write(t)
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "outline":
				depth--
			case "item":
				if current != nil {
					current.Title = strings.Join(strings.Fields(text.String()), " ")
					if current.Page > 0 && current.Title != "" {
						items = append(items, *current)
					}
					current = nil
				}
			}
		}
	}
	return items
}

// pdfChapters: cada item vai da sua página até antes do próximo item do mesmo nível ou acima;
// o último, até o fim do livro.
func pdfChapters(items []outlineItem, passages []indexedPassage, pages int) []chapter {
	charsOnPage := map[int]int{}
	for _, p := range passages {
		charsOnPage[p.Page] += utf8.RuneCountInString(p.Text)
	}
	list := []chapter{}
	for i, it := range items {
		last := pages
		for _, next := range items[i+1:] {
			if next.Level <= it.Level {
				last = max(it.Page, next.Page-1)
				break
			}
		}
		c := chapter{N: i + 1, Title: it.Title, Level: it.Level, FirstPage: it.Page, LastPage: min(last, max(pages, it.Page)),
			Anchor: anchorFor(formatPDF, it.Page, "", 0)}
		for p := c.FirstPage; p <= c.LastPage; p++ {
			c.Chars += charsOnPage[p]
		}
		list = append(list, c)
	}
	return list
}

func (l *library) handleChapters(w http.ResponseWriter, r *http.Request) {
	b, passages, err := l.chaptersOf(r.Context(), r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler os capítulos"})
		return
	}
	if b.Indexed {
		marks, err := l.placedAnnotations(r.Context(), b, passages)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler as marcações"})
			return
		}
		for i := range b.Chapters {
			for _, m := range marks {
				if m.passage >= 0 && insideChapter(b.Format, b.Chapters[i], passages[m.passage]) {
					b.Chapters[i].Highlights++
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, b)
}

type textPassage struct {
	Page   int    `json:"page"`
	Text   string `json:"text"`
	Anchor string `json:"anchor"`
}

type textPart struct {
	Title      string          `json:"title"`
	FirstPage  int             `json:"first_page"`
	LastPage   int             `json:"last_page"`
	Passages   []textPassage   `json:"passages"`
	Highlights []textHighlight `json:"highlights"`
}

// textHighlight: uma marcação do Lucas dentro da parte, na ordem do livro.
type textHighlight struct {
	Quote  string `json:"quote"`
	Note   string `json:"note"`
	Page   int    `json:"page"`
	Anchor string `json:"anchor"`
}

// handleText: GET /api/books/{id}/text?chapters=2,3 ou ?from=10&to=25 (páginas). Cada capítulo
// (ou o intervalo) é uma parte, com o texto trecho a trecho e onde abrir cada um.
func (l *library) handleText(w http.ResponseWriter, r *http.Request) {
	b, passages, err := l.chaptersOf(r.Context(), r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler o texto"})
		return
	}
	if !b.Indexed {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "sem texto: " + b.Error})
		return
	}
	marks, err := l.placedAnnotations(r.Context(), b, passages)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler as marcações"})
		return
	}
	// part junta os trechos que entram e as marcações que caem neles.
	part := func(title string, first, last int, inside func(indexedPassage) bool) textPart {
		p := textPart{Title: title, FirstPage: first, LastPage: last, Highlights: []textHighlight{}}
		for _, ps := range passages {
			if inside(ps) {
				p.Passages = append(p.Passages, textPassage{ps.Page, ps.Text, anchorFor(b.Format, ps.Page, ps.Href, ps.Progression)})
			}
		}
		for _, m := range marks {
			if m.passage >= 0 && inside(passages[m.passage]) {
				p.Highlights = append(p.Highlights, textHighlight{m.Quote, m.Note, passages[m.passage].Page, m.Anchor})
			}
		}
		return p
	}
	q := r.URL.Query()
	var parts []textPart
	if list := q.Get("chapters"); list != "" {
		for _, s := range strings.Split(list, ",") {
			n, err := strconv.Atoi(strings.TrimSpace(s))
			if err != nil || n < 1 || n > len(b.Chapters) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "capítulo inexistente: " + s})
				return
			}
			c := b.Chapters[n-1]
			parts = append(parts, part(c.Title, c.FirstPage, c.LastPage, func(p indexedPassage) bool { return insideChapter(b.Format, c, p) }))
		}
	} else {
		from, err1 := strconv.Atoi(q.Get("from"))
		to, err2 := strconv.Atoi(q.Get("to"))
		if err1 != nil || err2 != nil || from < 1 || to < from {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "escolha capítulos (chapters=1,2) ou páginas (from e to)"})
			return
		}
		title := "Páginas " + strconv.Itoa(from) + " a " + strconv.Itoa(to)
		parts = append(parts, part(title, from, to, func(p indexedPassage) bool { return p.Page >= from && p.Page <= to }))
	}
	total := 0
	for i := range parts {
		if parts[i].Passages == nil {
			parts[i].Passages = []textPassage{}
		}
		for _, p := range parts[i].Passages {
			total += utf8.RuneCountInString(p.Text)
		}
	}
	if total > maxBookText {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "texto grande demais: escolha menos capítulos"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": b.ID, "title": b.Title, "author": b.Author, "format": b.Format, "parts": parts})
}

// insideChapter: se o trecho é do capítulo. No EPUB, o capítulo é a sequência de trechos dele, não só
// as páginas (dois capítulos podem dividir uma página).
func insideChapter(format string, c chapter, p indexedPassage) bool {
	inside := p.Page >= c.FirstPage && p.Page <= c.LastPage
	if format != formatPDF {
		inside = inside && (p.Chapter == c.Title || (c.Title == "Antes do primeiro capítulo" && p.Chapter == ""))
	}
	return inside
}

// placedAnnotation: uma marcação com o trecho do índice em que ela cai (-1: nenhum).
type placedAnnotation struct {
	annotation
	passage int
}

func (l *library) placedAnnotations(ctx context.Context, b bookChapters, passages []indexedPassage) ([]placedAnnotation, error) {
	list, err := l.annotationsOf(ctx, b.ID)
	if err != nil {
		return nil, err
	}
	placed := make([]placedAnnotation, len(list))
	for i, a := range list {
		placed[i] = placedAnnotation{a, passageOf(b.Format, a, passages)}
	}
	return placed, nil
}

// passageOf acha o trecho do índice onde está a marcação: no PDF, pela página; no EPUB, pelo arquivo do
// capítulo e pela posição dentro dele. Se o lugar não bate (outro formato de âncora, arquivo com outro
// nome), procura o começo do texto marcado.
func passageOf(format string, a annotation, passages []indexedPassage) int {
	var place struct {
		Pagina    int    `json:"pagina"`
		Href      string `json:"href"`
		Locations struct {
			Progression float64 `json:"progression"`
		} `json:"locations"`
	}
	json.Unmarshal([]byte(a.Anchor), &place)
	found := -1
	for i, p := range passages {
		if format == formatPDF {
			if place.Pagina > 0 && p.Page == place.Pagina {
				return i
			}
			continue
		}
		// Os trechos de um arquivo vêm em ordem: fica o último que começa antes da marcação.
		if place.Href != "" && sameHref(p.Href, place.Href) && (found == -1 || p.Progression <= place.Locations.Progression) {
			found = i
		}
	}
	if found >= 0 {
		return found
	}
	start := []rune(normalText(a.Quote))
	if len(start) < 12 {
		return -1
	}
	key := string(start[:min(len(start), 80)])
	for i, p := range passages {
		if strings.Contains(normalText(p.Text), key) {
			return i
		}
	}
	return -1
}

func sameHref(a, b string) bool {
	clean := func(h string) string {
		h, _, _ = strings.Cut(h, "#")
		if u, err := url.PathUnescape(h); err == nil {
			h = u
		}
		return strings.TrimPrefix(h, "/")
	}
	a, b = clean(a), clean(b)
	return a == b || strings.HasSuffix(a, "/"+b) || strings.HasSuffix(b, "/"+a)
}

func normalText(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// handlePageAnchor: GET /api/books/{id}/anchor?page=N, onde a página começa (a das Estatísticas e
// da busca). Abre o leitor no começo da meta do dia quando o plano é por páginas (R35).
func (l *library) handlePageAnchor(w http.ResponseWriter, r *http.Request) {
	page, err := strconv.Atoi(r.URL.Query().Get("page"))
	if err != nil || page < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "página inválida"})
		return
	}
	b, passages, err := l.chaptersOf(r.Context(), r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler o livro"})
		return
	}
	if b.Format == formatPDF {
		writeJSON(w, http.StatusOK, map[string]string{"anchor": anchorFor(formatPDF, page, "", 0)})
		return
	}
	for _, p := range passages {
		if p.Page >= page {
			writeJSON(w, http.StatusOK, map[string]string{"anchor": anchorFor(formatEpub, p.Page, p.Href, p.Progression)})
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "página fora do livro"})
}
