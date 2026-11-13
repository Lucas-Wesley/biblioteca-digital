package main

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func onlyBookID(t *testing.T, h http.Handler) string {
	t.Helper()
	var books []book
	if err := json.Unmarshal(get(h, "/api/books").Body.Bytes(), &books); err != nil || len(books) != 1 {
		t.Fatalf("livros = %+v (%v)", books, err)
	}
	return books[0].ID
}

type textResponse struct {
	Title string     `json:"title"`
	Parts []textPart `json:"parts"`
}

func TestCapitulosETextoDoEpub(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "books")
	mkdir(t, dir)
	writeFile(t, filepath.Join(dir, "frutas.epub"), searchEpub(t))
	h, _ := searchServer(t, dir)
	id := onlyBookID(t, h)

	var b bookChapters
	rec := get(h, "/api/books/"+id+"/chapters")
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("capítulos: %d %s", rec.Code, rec.Body)
	}
	if !b.Indexed || b.Title != "Frutas do Brasil" || len(b.Chapters) != 2 {
		t.Fatalf("capítulos = %+v", b)
	}
	c1, c2 := b.Chapters[0], b.Chapters[1]
	if c1.N != 1 || c1.Title != "Capítulo 1: Os citros" || c1.FirstPage != 1 || c1.LastPage != 2 || c1.Chars < 1500 {
		t.Errorf("capítulo 1 = %+v", c1)
	}
	if c2.Title != "Capítulo 2: O caju" || c2.FirstPage != 2 {
		t.Errorf("capítulo 2 = %+v", c2)
	}

	// A âncora de cada capítulo abre o leitor no começo dele (meta do dia, R35); a da página também.
	if !strings.Contains(c2.Anchor, "cap2.xhtml") || !strings.Contains(c1.Anchor, `"progression"`) {
		t.Errorf("âncoras = %q, %q", c1.Anchor, c2.Anchor)
	}
	var page struct{ Anchor string }
	json.Unmarshal(get(h, "/api/books/"+id+"/anchor?page=2").Body.Bytes(), &page)
	if !strings.Contains(page.Anchor, ".xhtml") {
		t.Errorf("âncora da página 2 = %q", page.Anchor)
	}
	if rec := get(h, "/api/books/"+id+"/anchor?page=99"); rec.Code != http.StatusNotFound {
		t.Errorf("página fora do livro: %d", rec.Code)
	}

	// O capítulo 2 começa na mesma página em que o 1 termina, mas o texto é só o dele.
	var txt textResponse
	json.Unmarshal(get(h, "/api/books/"+id+"/text?chapters=2").Body.Bytes(), &txt)
	if len(txt.Parts) != 1 || len(txt.Parts[0].Passages) != 1 || !strings.Contains(txt.Parts[0].Passages[0].Text, "caju") {
		t.Fatalf("texto do capítulo 2 = %+v", txt)
	}
	if strings.Contains(txt.Parts[0].Passages[0].Text, "laranja") || !strings.Contains(txt.Parts[0].Passages[0].Anchor, "cap2.xhtml") {
		t.Errorf("trecho do capítulo 2 = %+v", txt.Parts[0].Passages[0])
	}
	json.Unmarshal(get(h, "/api/books/"+id+"/text?chapters=1,2").Body.Bytes(), &txt)
	if len(txt.Parts) != 2 || txt.Parts[0].Title != "Capítulo 1: Os citros" {
		t.Errorf("dois capítulos = %+v", txt.Parts)
	}

	for _, q := range []string{"chapters=3", "chapters=x", "from=5&to=2", ""} {
		if rec := get(h, "/api/books/"+id+"/text?"+q); rec.Code != http.StatusBadRequest {
			t.Errorf("%q: %d", q, rec.Code)
		}
	}
	if rec := get(h, "/api/books/nao-existe/chapters"); rec.Code != http.StatusNotFound {
		t.Errorf("livro inexistente: %d", rec.Code)
	}
}

func TestPdfSemSumarioEscolhePorPaginas(t *testing.T) {
	if _, err := exec.LookPath("pdftotext"); err != nil {
		t.Skip("pdftotext não instalado")
	}
	dir := filepath.Join(t.TempDir(), "books")
	mkdir(t, dir)
	writeFile(t, filepath.Join(dir, "manual.pdf"), simplePDF([]string{
		"Primeira pagina sobre fermentacao natural do pao.",
		"Segunda pagina: o levain precisa de farinha e agua.",
		"Terceira pagina sobre o forno a lenha bem quente.",
	}))
	h, _ := searchServer(t, dir)
	id := onlyBookID(t, h)

	var b bookChapters
	json.Unmarshal(get(h, "/api/books/"+id+"/chapters").Body.Bytes(), &b)
	if !b.Indexed || b.Pages != 3 || len(b.Chapters) != 0 {
		t.Fatalf("capítulos = %+v", b)
	}
	var txt textResponse
	json.Unmarshal(get(h, "/api/books/"+id+"/text?from=2&to=3").Body.Bytes(), &txt)
	if len(txt.Parts) != 1 || len(txt.Parts[0].Passages) != 2 || txt.Parts[0].Passages[0].Anchor != `{"pagina":2}` {
		t.Errorf("páginas 2 a 3 = %+v", txt.Parts)
	}
}

func TestLivroForaDoIndiceNaoTemTexto(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "books")
	mkdir(t, dir)
	writeFile(t, filepath.Join(dir, "frutas.epub"), searchEpub(t))
	h, lib := searchServer(t, dir)
	id := onlyBookID(t, h)
	lib.db.Exec(`DELETE FROM indexed_books`)

	var b bookChapters
	json.Unmarshal(get(h, "/api/books/"+id+"/chapters").Body.Bytes(), &b)
	if b.Indexed || !strings.Contains(b.Error, "entrando no índice") {
		t.Errorf("capítulos = %+v", b)
	}
	if rec := get(h, "/api/books/"+id+"/text?chapters=1"); rec.Code != http.StatusConflict {
		t.Errorf("texto: %d", rec.Code)
	}
}

func TestSumarioDoPdfComNiveis(t *testing.T) {
	xmlOut := `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml producer="poppler">
<page number="1"><text>capa</text></page>
<outline>
<item page="3">Introdução &amp; método</item>
<item page="5">Parte I</item>
<outline>
<item page="5">Capítulo 1</item>
<item page="9">Capítulo 2</item>
</outline>
<item>Sem página</item>
<item page="14">Parte II</item>
</outline>
</pdf2xml>`
	items := parseOutline([]byte(xmlOut))
	if len(items) != 5 || items[0].Title != "Introdução & método" || items[2].Level != 2 || items[4].Title != "Parte II" {
		t.Fatalf("itens = %+v", items)
	}
	passages := []indexedPassage{}
	for p := 1; p <= 20; p++ {
		passages = append(passages, indexedPassage{Page: p, Text: "0123456789"})
	}
	got := pdfChapters(items, passages, 20)
	want := [][2]int{{3, 4}, {5, 13}, {5, 8}, {9, 13}, {14, 20}}
	for i, w := range want {
		if got[i].FirstPage != w[0] || got[i].LastPage != w[1] {
			t.Errorf("%s: %d–%d, queria %d–%d", got[i].Title, got[i].FirstPage, got[i].LastPage, w[0], w[1])
		}
	}
	if got[1].Chars != 90 {
		t.Errorf("tamanho da Parte I = %d", got[1].Chars)
	}
}
