package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Busca no texto dos livros (R32). Cada livro é quebrado em trechos de mais ou menos uma página,
// guardados num índice FTS5 do SQLite. A busca serve ao Lucas, na tela "Buscar nos meus livros",
// e ao Pesquisador do Acervo, que cita livro e página.

// passage é um trecho do livro: no PDF, uma página; no EPUB, perto de 1.500 caracteres, a mesma
// régua das páginas estimadas (R31), quebrados no fim de um parágrafo.
type passage struct {
	Page        int
	Chapter     string
	Href        string  // EPUB: o capítulo, como no manifesto
	Progression float64 // EPUB: onde o trecho começa dentro do capítulo, de 0 a 1
	Text        string
}

const (
	maxSearchResults = 50
	pdfTimeout       = 3 * time.Minute
	minPassageRunes  = 20
)

// epubPassages lê o texto do EPUB na ordem de leitura, com o capítulo de cada trecho.
func epubPassages(file string) ([]passage, error) {
	zr, err := zip.OpenReader(file)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	opf, opfPath, err := readOpf(&zr.Reader)
	if err != nil {
		return nil, err
	}
	dir := path.Dir(opfPath)
	items := map[string]opfItem{}
	for _, item := range opf.Items {
		items[item.ID] = item
	}
	titles := chapterTitles(readToc(&zr.Reader, opf, dir), map[string]string{})

	var passages []passage
	total, chapter := 0, ""
	for _, ref := range opf.Spine.Items {
		item, ok := items[ref.IDRef]
		if !ok {
			continue
		}
		name := entryName(dir, item.Href)
		data, err := readZipFile(&zr.Reader, name, maxEpubXMLBytes)
		if err != nil {
			continue
		}
		if title, ok := titles[name]; ok {
			chapter = title
		}
		size := textLength(data)
		if size == 0 {
			continue
		}
		href := escapeHref(name)
		var text strings.Builder
		start, inChapter, startInChapter := total, 0, 0
		flush := func() {
			if t := strings.TrimSpace(text.String()); utf8.RuneCountInString(t) >= minPassageRunes {
				passages = append(passages, passage{
					Page:        start/charsPerPage + 1,
					Chapter:     chapter,
					Href:        href,
					Progression: float64(startInChapter) / float64(size),
					Text:        t,
				})
			}
			text.Reset()
			start, startInChapter = total, inChapter
		}
		walkText(data, func(piece string, spaceBefore bool) {
			if s := text.String(); spaceBefore && s != "" && !strings.HasSuffix(s, " ") && !strings.HasSuffix(s, "\n") {
				text.WriteByte(' ')
			}
			text.WriteString(piece)
			n := utf8.RuneCountInString(piece)
			total += n
			inChapter += n
			// Um parágrafo enorme (livro sem <p>) também é quebrado, para o trecho não virar o capítulo.
			if total-start >= 2*charsPerPage {
				flush()
			}
		}, func() {
			if text.Len() > 0 && !strings.HasSuffix(text.String(), "\n") {
				text.WriteByte('\n')
			}
			if total-start >= charsPerPage {
				flush()
			}
		})
		flush()
	}
	return passages, nil
}

// chapterTitles dá o título de cada arquivo do sumário (o primeiro que aponta para ele).
func chapterTitles(toc []pubLink, titles map[string]string) map[string]string {
	for _, link := range toc {
		file, _, _ := strings.Cut(link.Href, "#")
		if name, err := url.PathUnescape(file); err == nil && link.Title != "" {
			if _, ok := titles[name]; !ok {
				titles[name] = link.Title
			}
		}
		chapterTitles(link.Children, titles)
	}
	return titles
}

var (
	hyphenBreak = regexp.MustCompile(`(\p{L})-\n(\p{Ll})`)
	lineBreak   = regexp.MustCompile(`([^\n])\n([^\n])`)
	blankLines  = regexp.MustCompile(`\n{2,}`)
	spaces      = regexp.MustCompile(`[ \t]+`)
)

// pdfPassages usa o pdftotext (Poppler): uma página por trecho, com o número real da página.
// PDF escaneado não tem texto e fica de fora da busca.
func pdfPassages(ctx context.Context, bin, file string) ([]passage, error) {
	ctx, cancel := context.WithTimeout(ctx, pdfTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "-enc", "UTF-8", file, "-")
	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	if err := cmd.Run(); err != nil {
		if errors.Is(err, exec.ErrNotFound) || errors.Is(err, fs.ErrNotExist) {
			return nil, errors.New("pdftotext não está instalado")
		}
		return nil, fmt.Errorf("pdftotext falhou: %s", firstLine(stderr.String(), err.Error()))
	}
	var passages []passage
	for i, page := range strings.Split(out.String(), "\f") {
		page = strings.ReplaceAll(page, "\r", "")
		page = hyphenBreak.ReplaceAllString(page, "$1$2")
		page = lineBreak.ReplaceAllString(page, "$1 $2")
		page = blankLines.ReplaceAllString(page, "\n")
		page = strings.TrimSpace(spaces.ReplaceAllString(page, " "))
		if utf8.RuneCountInString(page) >= minPassageRunes {
			passages = append(passages, passage{Page: i + 1, Text: page})
		}
	}
	return passages, nil
}

func firstLine(s, fallback string) string {
	s = strings.TrimSpace(strings.SplitN(strings.TrimSpace(s), "\n", 2)[0])
	if s == "" {
		return fallback
	}
	return s
}

// ---------- Índice ----------

// notifyIndex avisa o indexador de que há livro novo. Sem indexador rodando (testes), não faz nada.
func (l *library) notifyIndex() {
	select {
	case l.indexWake <- struct{}{}:
	default:
	}
}

// keepIndex roda em segundo plano: indexa o que falta ao iniciar e a cada livro enviado.
func (l *library) keepIndex(ctx context.Context) {
	// Um erro de outra vez (ex.: pdftotext ausente) ganha outra chance a cada início.
	l.db.ExecContext(ctx, `DELETE FROM indexed_books WHERE error != ''`)
	for {
		if err := l.indexPending(ctx); err != nil && ctx.Err() == nil {
			log.Printf("índice: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-l.indexWake:
		}
	}
}

// indexPending indexa os livros que ainda não estão no índice e tira os que saíram da biblioteca.
func (l *library) indexPending(ctx context.Context) error {
	if _, err := l.db.ExecContext(ctx, `DELETE FROM passages WHERE book_id NOT IN (SELECT id FROM books)`); err != nil {
		return err
	}
	if _, err := l.db.ExecContext(ctx, `DELETE FROM indexed_books WHERE book_id NOT IN (SELECT id FROM books)`); err != nil {
		return err
	}
	rows, err := l.db.QueryContext(ctx, `SELECT b.id, b.file_name, b.format, b.title FROM books b
		LEFT JOIN indexed_books i ON i.book_id = b.id WHERE i.book_id IS NULL ORDER BY b.title`)
	if err != nil {
		return err
	}
	type pending struct{ id, fileName, format, title string }
	var list []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.fileName, &p.format, &p.title); err != nil {
			rows.Close()
			return err
		}
		list = append(list, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, p := range list {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		file := filepath.Join(l.booksDir, p.fileName)
		var passages []passage
		var err error
		if p.format == formatPDF {
			passages, err = pdfPassages(ctx, l.pdftotext, file)
		} else {
			passages, err = epubPassages(file)
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		msg := ""
		switch {
		case err != nil:
			msg = err.Error()
		case len(passages) == 0:
			msg = "o livro não tem texto (PDF escaneado?)"
		}
		if msg != "" {
			log.Printf("índice: %s: %s", p.title, msg)
		}
		if err := l.saveIndex(ctx, p.id, passages, msg); err != nil {
			return err
		}
	}
	return nil
}

func (l *library) saveIndex(ctx context.Context, id string, passages []passage, msg string) error {
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM passages WHERE book_id = ?`, id); err != nil {
		return err
	}
	for _, p := range passages {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO passages (text, book_id, page, chapter, href, progression) VALUES (?, ?, ?, ?, ?, ?)`,
			p.Text, id, p.Page, p.Chapter, p.Href, p.Progression); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT OR REPLACE INTO indexed_books (book_id, passages, error, indexed_at) VALUES (?, ?, ?, ?)`,
		id, len(passages), msg, time.Now().UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	return tx.Commit()
}

// ---------- Busca ----------

type searchResult struct {
	BookID  string `json:"book_id"`
	Title   string `json:"title"`
	Author  string `json:"author"`
	Format  string `json:"format"`
	Page    int    `json:"page"`
	Chapter string `json:"chapter"`
	Snippet string `json:"snippet"` // o pedaço com as palavras achadas entre **
	Text    string `json:"text"`    // o trecho inteiro
	Anchor  string `json:"anchor"`  // onde abrir o livro, no formato das marcações
}

type searchState struct {
	Books   int            `json:"books"`
	Indexed int            `json:"indexed"`
	Failed  []failedSearch `json:"failed"`
}

type failedSearch struct {
	Title string `json:"title"`
	Error string `json:"error"`
}

// Palavras curtas e comuns demais: na busca alternativa (qualquer palavra), só trariam ruído.
var stopWords = map[string]bool{
	"a": true, "o": true, "as": true, "os": true, "de": true, "da": true, "do": true, "das": true, "dos": true,
	"e": true, "em": true, "na": true, "no": true, "nas": true, "nos": true, "um": true, "uma": true,
	"para": true, "por": true, "com": true, "que": true, "se": true, "ao": true, "aos": true, "the": true,
	"of": true, "and": true, "qual": true, "como": true, "sobre": true,
}

// searchTerms quebra o pedido em palavras; as de 4 letras ou mais valem também como começo de
// palavra ("laranja" acha "laranjas" e "laranjeira").
func searchTerms(q string) []string {
	words := strings.FieldsFunc(strings.ToLower(q), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
	var terms []string
	seen := map[string]bool{}
	for _, w := range words {
		if seen[w] {
			continue
		}
		seen[w] = true
		term := `"` + w + `"`
		if utf8.RuneCountInString(w) >= 4 {
			term += "*"
		}
		terms = append(terms, term)
	}
	return terms
}

func anyTerm(terms []string) string {
	var useful []string
	for _, t := range terms {
		if !stopWords[strings.Trim(t, `"*`)] {
			useful = append(useful, t)
		}
	}
	return strings.Join(useful, " OR ")
}

func (l *library) search(ctx context.Context, match, bookID string, limit int, skip map[int64]bool) ([]searchResult, []int64, error) {
	query := `SELECT p.rowid, p.book_id, b.title, b.author, b.format, p.page, p.chapter, p.href, p.progression, p.text,
		snippet(passages, 0, '**', '**', '…', 32)
		FROM passages p JOIN books b ON b.id = p.book_id WHERE passages MATCH ?`
	args := []any{match}
	if bookID != "" {
		query += ` AND p.book_id = ?`
		args = append(args, bookID)
	}
	query += ` ORDER BY rank LIMIT ?`
	args = append(args, limit+len(skip))
	rows, err := l.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var results []searchResult
	var ids []int64
	for rows.Next() && len(results) < limit {
		var r searchResult
		var rowid int64
		var href string
		var progression float64
		if err := rows.Scan(&rowid, &r.BookID, &r.Title, &r.Author, &r.Format, &r.Page, &r.Chapter, &href, &progression, &r.Text, &r.Snippet); err != nil {
			return nil, nil, err
		}
		if skip[rowid] {
			continue
		}
		r.Anchor = anchorFor(r.Format, r.Page, href, progression)
		results = append(results, r)
		ids = append(ids, rowid)
	}
	return results, ids, rows.Err()
}

// anchorFor usa o formato das marcações de cada motor: a página no PDF, o Locator no EPUB.
func anchorFor(format string, page int, href string, progression float64) string {
	var v any = map[string]int{"pagina": page}
	if format != formatPDF {
		v = map[string]any{"href": href, "type": "application/xhtml+xml", "locations": map[string]float64{"progression": progression}}
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// handleSearch: primeiro os trechos com todas as palavras; se faltar, completa com os que têm
// qualquer uma delas, depois.
func (l *library) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, err := strconv.Atoi(q.Get("limit"))
	if err != nil || limit <= 0 {
		limit = 10
	}
	limit = min(limit, maxSearchResults)
	state, err := l.searchState(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha na busca"})
		return
	}
	terms := searchTerms(q.Get("q"))
	results := []searchResult{}
	if len(terms) > 0 {
		all, ids, err := l.search(r.Context(), strings.Join(terms, " "), q.Get("book"), limit, nil)
		if err == nil && len(all) < limit && len(terms) > 1 {
			if alt := anyTerm(terms); alt != "" {
				skip := map[int64]bool{}
				for _, id := range ids {
					skip[id] = true
				}
				var more []searchResult
				more, _, err = l.search(r.Context(), alt, q.Get("book"), limit-len(all), skip)
				all = append(all, more...)
			}
		}
		if err != nil {
			log.Printf("busca %q: %v", q.Get("q"), err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha na busca"})
			return
		}
		results = append(results, all...)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results, "state": state})
}

func (l *library) searchState(ctx context.Context) (searchState, error) {
	s := searchState{Failed: []failedSearch{}}
	if err := l.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM books`).Scan(&s.Books); err != nil {
		return s, err
	}
	if err := l.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM indexed_books WHERE error = ''`).Scan(&s.Indexed); err != nil {
		return s, err
	}
	rows, err := l.db.QueryContext(ctx, `SELECT b.title, i.error FROM indexed_books i JOIN books b ON b.id = i.book_id
		WHERE i.error != '' ORDER BY b.title`)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var f failedSearch
		if err := rows.Scan(&f.Title, &f.Error); err != nil {
			return s, err
		}
		s.Failed = append(s.Failed, f)
	}
	return s, rows.Err()
}
