package main

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

const bookExt = ".epub"

type book struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

func handleListBooks(booksDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		entries, err := os.ReadDir(booksDir)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar livros"})
			return
		}
		books := []book{}
		for _, e := range entries {
			if e.Type().IsRegular() && validBookID(e.Name()) {
				books = append(books, book{ID: e.Name(), Title: titleFromFilename(e.Name())})
			}
		}
		sort.Slice(books, func(i, j int) bool { return books[i].Title < books[j].Title })
		writeJSON(w, http.StatusOK, books)
	}
}

func handleBookFile(booksDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !validBookID(id) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
			return
		}
		// OpenInRoot impede sair da pasta de livros, inclusive por link simbólico.
		f, err := os.OpenInRoot(booksDir, id)
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
		http.ServeContent(w, r, id, info.ModTime(), f)
	}
}

func validBookID(id string) bool {
	return filepath.Base(id) == id && !strings.HasPrefix(id, ".") && strings.HasSuffix(id, bookExt)
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
