package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func bookFixture(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "books")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "quincas-borba.epub"), "conteudo-epub")
	writeFile(t, filepath.Join(dir, "anotacao.txt"), "nao e livro")
	writeFile(t, filepath.Join(dir, ".oculto.epub"), "oculto")
	return dir
}

func TestListaSoLivrosEpub(t *testing.T) {
	rec := get(handleListBooks(bookFixture(t)), "/api/books")
	var books []book
	if err := json.Unmarshal(rec.Body.Bytes(), &books); err != nil {
		t.Fatal(err)
	}
	if len(books) != 1 || books[0].ID != "quincas-borba.epub" || books[0].Title != "Quincas Borba" {
		t.Fatalf("books = %+v", books)
	}
}

func TestListaVaziaRetornaArray(t *testing.T) {
	rec := get(handleListBooks(t.TempDir()), "/api/books")
	if got := rec.Body.String(); got != "[]\n" {
		t.Fatalf("body = %q", got)
	}
}

func TestEntregaArquivoDoLivro(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	rec := get(h, "/api/books/quincas-borba.epub/file")
	if rec.Code != http.StatusOK || rec.Body.String() != "conteudo-epub" {
		t.Fatalf("%d %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/epub+zip" {
		t.Fatalf("Content-Type = %q", ct)
	}
}

func TestBloqueiaAcessoForaDaPastaDeLivros(t *testing.T) {
	dir := bookFixture(t)
	fora := filepath.Join(filepath.Dir(dir), "segredo.epub")
	writeFile(t, fora, "segredo")
	if err := os.Symlink(fora, filepath.Join(dir, "atalho.epub")); err != nil {
		t.Fatal(err)
	}
	h, _ := testServerComLivros(t, dir)
	for _, url := range []string{
		"/api/books/..%2Fsegredo.epub/file",
		"/api/books/.oculto.epub/file",
		"/api/books/anotacao.txt/file",
		"/api/books/nao-existe.epub/file",
		"/api/books/atalho.epub/file",
	} {
		rec := get(h, url)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, corpo = %q", url, rec.Code, rec.Body.String())
		}
	}
}
