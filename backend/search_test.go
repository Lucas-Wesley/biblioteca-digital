package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// searchServer monta a biblioteca com o indexador à mão: o teste indexa quando quer.
func searchServer(t *testing.T, booksDir string) (http.Handler, *library) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "teste.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	lib, err := newLibrary(context.Background(), db, booksDir, filepath.Join(t.TempDir(), "covers"))
	if err != nil {
		t.Fatal(err)
	}
	if err := lib.sync(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := lib.indexPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	return newServer(db, fstest.MapFS{"index.html": {Data: []byte("app")}}, lib, "teste"), lib
}

type searchResponse struct {
	Results []searchResult `json:"results"`
	State   searchState    `json:"state"`
}

func searchFor(t *testing.T, h http.Handler, query string) searchResponse {
	t.Helper()
	rec := get(h, "/api/search?"+query)
	if rec.Code != http.StatusOK {
		t.Fatalf("busca %s: %d %s", query, rec.Code, rec.Body)
	}
	var r searchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &r); err != nil {
		t.Fatal(err)
	}
	return r
}

const searchOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata><dc:title>Frutas do Brasil</dc:title><dc:creator>Autora</dc:creator></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="cap%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="cap2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`

const searchNav = `<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>
<li><a href="cap%201.xhtml">Capítulo 1: Os citros</a></li>
<li><a href="cap2.xhtml#inicio">Capítulo 2: O caju</a></li>
</ol></nav></body></html>`

// Cada parágrafo de enchimento tem 500 caracteres, para os trechos e as páginas caírem em lugar
// conhecido: 1.500 caracteres por página (R31).
var filler = strings.Repeat("palavra ", 62) + "fim."

func searchEpub(t *testing.T) []byte {
	t.Helper()
	cap1 := "<html><head><title>Não entra</title></head><body>" +
		"<p>" + filler + "</p><p>" + filler + "</p><p>" + filler + "</p>" +
		"<h2>A laranja</h2><p>A <b>laranja</b> doce veio da Ásia e chegou ao Brasil com os portugueses no século XVI.</p>" +
		"</body></html>"
	cap2 := "<html><body><p id=\"inicio\">O caju é nativo do Nordeste brasileiro. A castanha vem junto.</p></body></html>"
	return zipBytes(t, map[string][]byte{
		"mimetype":               []byte("application/epub+zip"),
		"META-INF/container.xml": []byte(containerXML),
		"OEBPS/content.opf":      []byte(searchOpf),
		"OEBPS/nav.xhtml":        []byte(searchNav),
		"OEBPS/cap 1.xhtml":      []byte(cap1),
		"OEBPS/cap2.xhtml":       []byte(cap2),
	})
}

func TestBuscaNoEpubComPaginaCapituloEPontoDoLivro(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "books")
	mkdir(t, dir)
	writeFile(t, filepath.Join(dir, "frutas.epub"), searchEpub(t))
	h, _ := searchServer(t, dir)

	// Sem acento e no singular, acha "Ásia" e "portugueses".
	r := searchFor(t, h, "q=laranja+asia+portugues")
	if len(r.Results) != 1 {
		t.Fatalf("resultados = %+v", r.Results)
	}
	got := r.Results[0]
	if got.Title != "Frutas do Brasil" || got.Format != "epub" || got.Chapter != "Capítulo 1: Os citros" {
		t.Errorf("resultado = %+v", got)
	}
	// Três parágrafos de 500 fecham a página 1; a laranja começa a página 2.
	if got.Page != 2 {
		t.Errorf("página = %d", got.Page)
	}
	if !strings.Contains(got.Snippet, "**laranja**") || !strings.Contains(got.Text, "A laranja doce veio da Ásia") {
		t.Errorf("trecho = %q / %q", got.Snippet, got.Text)
	}
	if strings.Contains(got.Text, "Não entra") {
		t.Error("o <head> não é texto do livro")
	}
	var anchor struct {
		Href      string `json:"href"`
		Locations struct {
			Progression float64 `json:"progression"`
		} `json:"locations"`
	}
	if err := json.Unmarshal([]byte(got.Anchor), &anchor); err != nil {
		t.Fatal(err)
	}
	if anchor.Href != "OEBPS/cap%201.xhtml" || anchor.Locations.Progression < 0.8 || anchor.Locations.Progression > 0.95 {
		t.Errorf("âncora = %s", got.Anchor)
	}

	// O capítulo 2 tem o título do sumário, mesmo com #trecho no link.
	if r := searchFor(t, h, "q=caju"); len(r.Results) != 1 || r.Results[0].Chapter != "Capítulo 2: O caju" {
		t.Errorf("caju = %+v", r.Results)
	}
	if r.State.Books != 1 || r.State.Indexed != 1 || len(r.State.Failed) != 0 {
		t.Errorf("estado = %+v", r.State)
	}
}

func TestBuscaSemTodasAsPalavrasCompletaComQualquerUma(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "books")
	mkdir(t, dir)
	writeFile(t, filepath.Join(dir, "frutas.epub"), searchEpub(t))
	h, _ := searchServer(t, dir)

	// Nenhum trecho tem "laranja" e "caju" juntos: vêm os dois, cada um com a sua palavra.
	r := searchFor(t, h, "q=a+origem+da+laranja+e+do+caju")
	if len(r.Results) != 2 {
		t.Fatalf("resultados = %+v", r.Results)
	}
	if r := searchFor(t, h, "q=abacaxi"); len(r.Results) != 0 {
		t.Errorf("abacaxi = %+v", r.Results)
	}
	if r := searchFor(t, h, "q="); len(r.Results) != 0 {
		t.Errorf("busca vazia = %+v", r.Results)
	}
	// Aspas e operadores do FTS5 no pedido não quebram a busca.
	if r := searchFor(t, h, `q=%22laranja%22+OR+NEAR(caju`); len(r.Results) == 0 {
		t.Error("pedido com aspas e operadores deveria achar algo")
	}
	if r := searchFor(t, h, "q=laranja&book=outro"); len(r.Results) != 0 {
		t.Errorf("filtro por livro = %+v", r.Results)
	}
}

func TestLivroApagadoSaiDoIndice(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "books")
	mkdir(t, dir)
	writeFile(t, filepath.Join(dir, "frutas.epub"), searchEpub(t))
	h, lib := searchServer(t, dir)
	os.Remove(filepath.Join(dir, "frutas.epub"))
	if err := lib.sync(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := lib.indexPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	if r := searchFor(t, h, "q=laranja"); len(r.Results) != 0 || r.State.Indexed != 0 {
		t.Errorf("depois de apagar = %+v", r)
	}
}

// simplePDF escreve um PDF de verdade, com uma página por texto.
func simplePDF(pages []string) []byte {
	var objs []string
	n := len(pages)
	kids := []string{}
	for i := range pages {
		kids = append(kids, fmt.Sprintf("%d 0 R", 3+2*i))
	}
	objs = append(objs, "<< /Type /Catalog /Pages 2 0 R >>")
	objs = append(objs, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), n))
	font := 3 + 2*n
	for i, text := range pages {
		objs = append(objs, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>", font, 4+2*i))
		stream := fmt.Sprintf("BT /F1 12 Tf 72 720 Td (%s) Tj ET", text)
		objs = append(objs, fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream))
	}
	objs = append(objs, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n")
	offsets := []int{}
	for i, o := range objs {
		offsets = append(offsets, buf.Len())
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&buf, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	return buf.Bytes()
}

func TestBuscaNoPdfComAPaginaReal(t *testing.T) {
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
	writeFile(t, filepath.Join(dir, "escaneado.pdf"), simplePDF([]string{"", ""}))
	h, _ := searchServer(t, dir)

	r := searchFor(t, h, "q=levain+farinha")
	if len(r.Results) != 1 || r.Results[0].Page != 2 || r.Results[0].Anchor != `{"pagina":2}` {
		t.Fatalf("resultados = %+v", r.Results)
	}
	if r.State.Books != 2 || r.State.Indexed != 1 || len(r.State.Failed) != 1 || !strings.Contains(r.State.Failed[0].Error, "não tem texto") {
		t.Errorf("estado = %+v", r.State)
	}
}

func TestSemPdftotextOPdfFicaComErroEOEpubContinua(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "books")
	mkdir(t, dir)
	writeFile(t, filepath.Join(dir, "frutas.epub"), searchEpub(t))
	writeFile(t, filepath.Join(dir, "manual.pdf"), simplePDF([]string{"Texto qualquer do manual."}))
	db, _ := sql.Open("sqlite", filepath.Join(t.TempDir(), "teste.db"))
	t.Cleanup(func() { db.Close() })
	lib, err := newLibrary(context.Background(), db, dir, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	lib.pdftotext = filepath.Join(t.TempDir(), "nao-existe")
	lib.sync(context.Background())
	if err := lib.indexPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	state, _ := lib.searchState(context.Background())
	if state.Indexed != 1 || len(state.Failed) != 1 || !strings.Contains(state.Failed[0].Error, "pdftotext não está instalado") {
		t.Errorf("estado = %+v", state)
	}
}
