package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

const (
	bookExt        = ".epub"
	maxUploadBytes = 500 << 20
)

const booksSchema = `
CREATE TABLE IF NOT EXISTS books (
	id         TEXT PRIMARY KEY,
	file_name  TEXT NOT NULL UNIQUE,
	title      TEXT NOT NULL,
	author     TEXT NOT NULL,
	cover_type TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`

var errDuplicateBook = errors.New("este livro já está na biblioteca")

type book struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Author   string `json:"author"`
	HasCover bool   `json:"has_cover"`
}

type library struct {
	db        *sql.DB
	booksDir  string
	coversDir string
}

func newLibrary(ctx context.Context, db *sql.DB, booksDir, coversDir string) (*library, error) {
	for _, dir := range []string{booksDir, coversDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	if _, err := db.ExecContext(ctx, booksSchema); err != nil {
		return nil, err
	}
	return &library{db: db, booksDir: booksDir, coversDir: coversDir}, nil
}

// sync alinha o catálogo com a pasta: livros copiados à mão entram e os apagados saem.
func (l *library) sync(ctx context.Context) error {
	entries, err := os.ReadDir(l.booksDir)
	if err != nil {
		return err
	}
	onDisk := map[string]bool{}
	for _, e := range entries {
		if e.Type().IsRegular() && isBookFile(e.Name()) {
			onDisk[e.Name()] = true
		}
	}

	rows, err := l.db.QueryContext(ctx, `SELECT id, file_name FROM books`)
	if err != nil {
		return err
	}
	defer rows.Close()
	catalogued := map[string]string{}
	for rows.Next() {
		var id, fileName string
		if err := rows.Scan(&id, &fileName); err != nil {
			return err
		}
		catalogued[fileName] = id
	}
	if err := rows.Err(); err != nil {
		return err
	}

	// Remove primeiro: um arquivo renomeado tem o mesmo id e precisa entrar de novo.
	for fileName, id := range catalogued {
		if onDisk[fileName] {
			continue
		}
		if _, err := l.db.ExecContext(ctx, `DELETE FROM books WHERE id = ?`, id); err != nil {
			return err
		}
		os.Remove(l.coverPath(id))
		log.Printf("catálogo: %s saiu, o arquivo não existe mais", fileName)
	}

	for fileName := range onDisk {
		if _, ok := catalogued[fileName]; ok {
			continue
		}
		file := filepath.Join(l.booksDir, fileName)
		id, err := hashFile(file)
		if err == nil {
			_, err = l.catalog(ctx, file, id, fileName, fileName)
		}
		if err != nil {
			log.Printf("catálogo: %s ignorado: %v", fileName, err)
		}
	}
	return nil
}

// catalog registra o livro e move o arquivo para a pasta de livros. A transação só
// confirma com tudo no lugar; duas cópias do mesmo livro não passam do INSERT.
func (l *library) catalog(ctx context.Context, src, id, fileName, displayName string) (book, error) {
	meta, err := readEpub(src)
	if err != nil {
		return book{}, err
	}
	title := meta.Title
	if title == "" {
		title = titleFromFilename(displayName)
	}
	if title == "" {
		title = "Sem título"
	}

	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return book{}, err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx,
		`INSERT INTO books (id, file_name, title, author, cover_type) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT DO NOTHING`,
		id, fileName, title, meta.Author, meta.CoverType)
	if err != nil {
		return book{}, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return book{}, err
	} else if n == 0 {
		return book{}, errDuplicateBook
	}

	if meta.CoverType != "" {
		if err := os.WriteFile(l.coverPath(id), meta.Cover, 0o644); err != nil {
			return book{}, err
		}
	}
	if dest := filepath.Join(l.booksDir, fileName); dest != src {
		if err := os.Rename(src, dest); err != nil {
			return book{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return book{}, err
	}
	return book{ID: id, Title: title, Author: meta.Author, HasCover: meta.CoverType != ""}, nil
}

func (l *library) coverPath(id string) string {
	return filepath.Join(l.coversDir, id)
}

func (l *library) handleList(w http.ResponseWriter, r *http.Request) {
	rows, err := l.db.QueryContext(r.Context(),
		`SELECT id, title, author, cover_type != '' FROM books ORDER BY title`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar livros"})
		return
	}
	defer rows.Close()
	books := []book{}
	for rows.Next() {
		var b book
		if err := rows.Scan(&b.ID, &b.Title, &b.Author, &b.HasCover); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar livros"})
			return
		}
		books = append(books, b)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar livros"})
		return
	}
	writeJSON(w, http.StatusOK, books)
}

func (l *library) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "envie o arquivo em um formulário"})
		return
	}
	var displayName, tempPath string
	for tempPath == "" {
		part, err := reader.NextPart()
		if err != nil {
			writeUploadReadError(w, err)
			return
		}
		if part.FormName() != "file" {
			continue
		}
		displayName = part.FileName()
		// Fica na pasta de livros para o rename ser atômico; o ponto o esconde do catálogo.
		temp, err := os.CreateTemp(l.booksDir, ".upload-*")
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao guardar o arquivo"})
			return
		}
		tempPath = temp.Name()
		defer os.Remove(tempPath)
		_, err = io.Copy(temp, part)
		if closeErr := temp.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			writeUploadReadError(w, err)
			return
		}
	}

	id, err := hashFile(tempPath)
	if err == nil {
		err = os.Chmod(tempPath, 0o644)
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao guardar o arquivo"})
		return
	}
	b, err := l.catalog(r.Context(), tempPath, id, id+bookExt, displayName)
	switch {
	case errors.Is(err, errNotEpub):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, errDuplicateBook):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case err != nil:
		log.Printf("envio de %q: %v", displayName, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao guardar o arquivo"})
	default:
		writeJSON(w, http.StatusCreated, b)
	}
}

func writeUploadReadError(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &tooBig):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "o arquivo passa do limite de 500 MB"})
	case errors.Is(err, io.EOF):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "nenhum arquivo enviado"})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "falha ao receber o arquivo"})
	}
}

func (l *library) handleFile(w http.ResponseWriter, r *http.Request) {
	var fileName string
	err := l.db.QueryRowContext(r.Context(),
		`SELECT file_name FROM books WHERE id = ?`, r.PathValue("id")).Scan(&fileName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	// OpenInRoot impede sair da pasta de livros, inclusive por link simbólico.
	f, err := os.OpenInRoot(l.booksDir, fileName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	w.Header().Set("Content-Type", "application/epub+zip")
	http.ServeContent(w, r, fileName, info.ModTime(), f)
}

func (l *library) handleCover(w http.ResponseWriter, r *http.Request) {
	var id, coverType string
	err := l.db.QueryRowContext(r.Context(),
		`SELECT id, cover_type FROM books WHERE id = ? AND cover_type != ''`, r.PathValue("id")).Scan(&id, &coverType)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "capa não encontrada"})
		return
	}
	f, err := os.Open(l.coverPath(id))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "capa não encontrada"})
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "capa não encontrada"})
		return
	}
	w.Header().Set("Content-Type", coverType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, id, info.ModTime(), f)
}

// hashFile gera o id do livro pelo conteúdo, o que também identifica cópias repetidas.
func hashFile(file string) (string, error) {
	f, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil))[:32], nil
}

func isBookFile(name string) bool {
	return filepath.Base(name) == name && !strings.HasPrefix(name, ".") && strings.HasSuffix(name, bookExt)
}

// titleFromFilename transforma "quincas-borba.epub" em "Quincas Borba".
func titleFromFilename(name string) string {
	words := strings.FieldsFunc(strings.TrimSuffix(name, bookExt), func(r rune) bool {
		return r == '-' || r == '_' || unicode.IsSpace(r)
	})
	for i, word := range words {
		runes := []rune(word)
		runes[0] = unicode.ToUpper(runes[0])
		words[i] = string(runes)
	}
	return strings.Join(words, " ")
}
