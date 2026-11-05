package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

const containerXML = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

// PNG de 1x1 pixel.
var pngCover = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89")

func opfXML(metadata, manifest string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata>` + metadata + `</metadata>
  <manifest>` + manifest + `</manifest>
</package>`
}

func zipBytes(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func epubBytes(t *testing.T, title string) []byte {
	t.Helper()
	return zipBytes(t, map[string][]byte{
		"META-INF/container.xml": []byte(containerXML),
		"OEBPS/content.opf": []byte(opfXML(
			`<dc:title>`+title+`</dc:title><dc:creator>Machado de Assis</dc:creator>`,
			`<item id="c" href="images/capa%20livro.png" media-type="image/png" properties="cover-image"/>`,
		)),
		"OEBPS/images/capa livro.png": pngCover,
	})
}

func writeFile(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
}

func bookFixture(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "books")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "quincas-borba.epub"), epubBytes(t, "Quincas Borba"))
	writeFile(t, filepath.Join(dir, "anotacao.txt"), []byte("nao e livro"))
	writeFile(t, filepath.Join(dir, ".oculto.epub"), epubBytes(t, "Oculto"))
	writeFile(t, filepath.Join(dir, "corrompido.epub"), []byte("nao e zip"))
	return dir
}

func listBooks(t *testing.T, h http.Handler) []book {
	t.Helper()
	var books []book
	if err := json.Unmarshal(get(h, "/api/books").Body.Bytes(), &books); err != nil {
		t.Fatal(err)
	}
	return books
}

func upload(t *testing.T, h http.Handler, name string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	part.Write(content)
	form.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/books", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestCatalogaSoEpubsValidosDaPasta(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	books := listBooks(t, h)
	if len(books) != 1 {
		t.Fatalf("books = %+v", books)
	}
	b := books[0]
	if b.Title != "Quincas Borba" || b.Author != "Machado de Assis" || !b.HasCover {
		t.Fatalf("book = %+v", b)
	}
}

func TestListaVaziaRetornaArray(t *testing.T) {
	h, _ := testServer(t)
	if got := get(h, "/api/books").Body.String(); got != "[]\n" {
		t.Fatalf("body = %q", got)
	}
}

func TestEnviaLivroEEntregaArquivoECapa(t *testing.T) {
	dir := t.TempDir()
	h, _ := testServerComLivros(t, dir)
	content := epubBytes(t, "Dom Casmurro")

	rec := upload(t, h, "qualquer-nome.epub", content)
	if rec.Code != http.StatusCreated {
		t.Fatalf("%d %q", rec.Code, rec.Body.String())
	}
	var b book
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	if b.Title != "Dom Casmurro" || b.Author != "Machado de Assis" || !b.HasCover {
		t.Fatalf("book = %+v", b)
	}

	arquivo := get(h, "/api/books/"+b.ID+"/file")
	if arquivo.Code != http.StatusOK || !bytes.Equal(arquivo.Body.Bytes(), content) {
		t.Fatalf("arquivo: %d", arquivo.Code)
	}
	if ct := arquivo.Header().Get("Content-Type"); ct != "application/epub+zip" {
		t.Fatalf("Content-Type = %q", ct)
	}

	capa := get(h, "/api/books/"+b.ID+"/cover")
	if capa.Code != http.StatusOK || !bytes.Equal(capa.Body.Bytes(), pngCover) {
		t.Fatalf("capa: %d", capa.Code)
	}
	if ct := capa.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("Content-Type = %q", ct)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != b.ID+bookExt {
		t.Fatalf("pasta de livros = %v", entries)
	}
	if info, _ := entries[0].Info(); info.Mode().Perm() != 0o644 {
		t.Fatalf("permissão = %v", info.Mode().Perm())
	}
}

func TestRecusaLivroRepetido(t *testing.T) {
	dir := t.TempDir()
	h, _ := testServerComLivros(t, dir)
	content := epubBytes(t, "Dom Casmurro")
	upload(t, h, "a.epub", content)
	if rec := upload(t, h, "b.epub", content); rec.Code != http.StatusConflict {
		t.Fatalf("status = %d", rec.Code)
	}
	if books := listBooks(t, h); len(books) != 1 {
		t.Fatalf("books = %+v", books)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("pasta de livros = %v", entries)
	}
}

func TestRecusaArquivoQueNaoEEpubSemDeixarResto(t *testing.T) {
	dir := t.TempDir()
	h, _ := testServerComLivros(t, dir)
	casos := map[string][]byte{
		"texto":        []byte("nao e zip"),
		"zip qualquer": zipBytes(t, map[string][]byte{"a.txt": []byte("oi")}),
		"opf quebrado": zipBytes(t, map[string][]byte{
			"META-INF/container.xml": []byte(containerXML),
			"OEBPS/content.opf":      []byte("<package"),
		}),
	}
	for nome, content := range casos {
		if rec := upload(t, h, "livro.epub", content); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d", nome, rec.Code)
		}
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("pasta de livros = %v", entries)
	}
}

func TestEnvioSemArquivoEBadRequest(t *testing.T) {
	h, _ := testServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/books", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestSemMetadadosUsaNomeDoArquivoENaoTemCapa(t *testing.T) {
	h, _ := testServer(t)
	rec := upload(t, h, "meu-livro_antigo.epub", zipBytes(t, map[string][]byte{
		"META-INF/container.xml": []byte(containerXML),
		"OEBPS/content.opf":      []byte(opfXML("", "")),
	}))
	var b book
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	if b.Title != "Meu Livro Antigo" || b.Author != "" || b.HasCover {
		t.Fatalf("book = %+v", b)
	}
	if capa := get(h, "/api/books/"+b.ID+"/cover"); capa.Code != http.StatusNotFound {
		t.Fatalf("capa: %d", capa.Code)
	}
}

func TestLeMetadadosDeEpub2(t *testing.T) {
	file := filepath.Join(t.TempDir(), "livro.epub")
	writeFile(t, file, zipBytes(t, map[string][]byte{
		"META-INF/container.xml": []byte(containerXML),
		"OEBPS/content.opf": []byte(opfXML(
			`<dc:title>
				Memórias   Póstumas
			</dc:title><dc:creator>Autor Um</dc:creator><dc:creator>Autora Dois</dc:creator><meta name="cover" content="img1"/>`,
			`<item id="img1" href="capa.png" media-type="image/png"/>`,
		)),
		"OEBPS/capa.png": pngCover,
	}))
	meta, err := readEpub(file)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Title != "Memórias Póstumas" || meta.Author != "Autor Um, Autora Dois" || meta.CoverType != "image/png" {
		t.Fatalf("meta = %+v", meta)
	}
}

func TestCapaSVGEIgnorada(t *testing.T) {
	file := filepath.Join(t.TempDir(), "livro.epub")
	writeFile(t, file, zipBytes(t, map[string][]byte{
		"META-INF/container.xml": []byte(containerXML),
		"OEBPS/content.opf": []byte(opfXML(
			`<dc:title>Livro</dc:title>`,
			`<item id="c" href="capa.svg" media-type="image/svg+xml" properties="cover-image"/>`,
		)),
		"OEBPS/capa.svg": []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
	}))
	meta, err := readEpub(file)
	if err != nil {
		t.Fatal(err)
	}
	if meta.CoverType != "" || meta.Cover != nil {
		t.Fatalf("meta = %+v", meta)
	}
}

func TestSincronizaArquivosAdicionadosERemovidosDaPasta(t *testing.T) {
	dir := bookFixture(t)
	h, db := testServerComLivros(t, dir)
	b := listBooks(t, h)[0]

	lib, err := newLibrary(t.Context(), db, dir, filepath.Join(t.TempDir(), "covers"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(dir, "quincas-borba.epub"), filepath.Join(dir, "renomeado.epub")); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "novo.epub"), epubBytes(t, "Livro Novo"))
	if err := lib.sync(t.Context()); err != nil {
		t.Fatal(err)
	}

	books := listBooks(t, h)
	if len(books) != 2 {
		t.Fatalf("books = %+v", books)
	}
	if arquivo := get(h, "/api/books/"+b.ID+"/file"); arquivo.Code != http.StatusOK {
		t.Fatalf("renomeado: %d", arquivo.Code)
	}

	for _, nome := range []string{"renomeado.epub", "novo.epub"} {
		if err := os.Remove(filepath.Join(dir, nome)); err != nil {
			t.Fatal(err)
		}
	}
	if err := lib.sync(t.Context()); err != nil {
		t.Fatal(err)
	}
	if books := listBooks(t, h); len(books) != 0 {
		t.Fatalf("books = %+v", books)
	}
}

func TestBloqueiaAcessoForaDaPastaDeLivros(t *testing.T) {
	dir := bookFixture(t)
	fora := filepath.Join(filepath.Dir(dir), "segredo.epub")
	writeFile(t, fora, []byte("segredo"))
	if err := os.Symlink(fora, filepath.Join(dir, "atalho.epub")); err != nil {
		t.Fatal(err)
	}
	h, db := testServerComLivros(t, dir)
	// Registros adulterados no banco também não podem sair da pasta.
	for id, fileName := range map[string]string{"atalho": "atalho.epub", "fora": "../segredo.epub"} {
		if _, err := db.Exec(`INSERT INTO books (id, file_name, title, author, cover_type) VALUES (?, ?, 'x', '', '')`, id, fileName); err != nil {
			t.Fatal(err)
		}
	}
	for _, url := range []string{
		"/api/books/..%2Fsegredo.epub/file",
		"/api/books/quincas-borba.epub/file",
		"/api/books/nao-existe/file",
		"/api/books/atalho/file",
		"/api/books/fora/file",
		"/api/books/atalho/cover",
	} {
		rec := get(h, url)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, corpo = %q", url, rec.Code, rec.Body.String())
		}
	}
}
