package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const navXHTML = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="landmarks"><ol><li><a href="fora.xhtml">Não é sumário</a></li></ol></nav>
<nav epub:type="toc"><h1>Sumário</h1><ol>
  <li><a href="cap%201.xhtml">Capítulo&nbsp;1</a>
    <ol><li><a href="cap%201.xhtml#parte">Parte</a></li></ol>
  </li>
  <li><span>Sem link</span><ol><li><a href="sub/cap2.xhtml">Capítulo 2</a></li></ol></li>
</ol></nav></body></html>`

const ncxXML = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint><navLabel><text> Um </text></navLabel><content src="cap%201.xhtml"/>
    <navPoint><navLabel><text>Dois</text></navLabel><content src="sub/cap2.xhtml#a"/></navPoint>
  </navPoint>
</navMap></ncx>`

func publicationOpf(extraMetadata, extraManifest, spineAttrs string) []byte {
	return []byte(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata><dc:title>Livro</dc:title><dc:creator>Autora</dc:creator><dc:language>pt-BR</dc:language>` + extraMetadata + `</metadata>
  <manifest>
    <item id="c1" href="cap%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="sub/cap2.xhtml" media-type="application/xhtml+xml"/>
    <item id="capa" href="capa.png" media-type="image/png" properties="cover-image"/>` + extraManifest + `
  </manifest>
  <spine ` + spineAttrs + `><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`)
}

func publicationBook(t *testing.T, opf []byte, extra map[string][]byte) (http.Handler, string) {
	t.Helper()
	files := map[string][]byte{
		"mimetype":                []byte("application/epub+zip"),
		"META-INF/container.xml":  []byte(containerXML),
		"OEBPS/content.opf":       opf,
		"OEBPS/cap 1.xhtml":       []byte("<html><body>" + strings.Repeat("a", 3000) + "</body></html>"),
		"OEBPS/sub/cap2.xhtml":    []byte("<html><body>dois</body></html>"),
		"OEBPS/capa.png":          pngCover,
		"OEBPS/nao-declarado.css": []byte("p{}"),
	}
	for name, data := range extra {
		files[name] = data
	}
	dir := filepath.Join(t.TempDir(), "books")
	mkdir(t, dir)
	writeFile(t, filepath.Join(dir, "livro.epub"), zipBytes(t, files))
	h, _ := testServerComLivros(t, dir)
	return h, "/api/books/" + listBooks(t, h)[0].ID + "/publication/"
}

func readManifest(t *testing.T, h http.Handler, base string) pubManifest {
	t.Helper()
	rec := get(h, base+"manifest.json")
	if rec.Code != http.StatusOK {
		t.Fatalf("manifesto: %d %s", rec.Code, rec.Body)
	}
	var m pubManifest
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestManifestoTemOrdemRecursosEMetadados(t *testing.T) {
	h, base := publicationBook(t, publicationOpf("", "", ""), nil)
	m := readManifest(t, h, base)
	if m.Metadata.Title != "Livro" || m.Metadata.Author[0] != "Autora" || m.Metadata.Language[0] != "pt-BR" || m.Metadata.Layout != "" {
		t.Errorf("metadata = %+v", m.Metadata)
	}
	if len(m.ReadingOrder) != 2 || m.ReadingOrder[0].Href != "OEBPS/cap%201.xhtml" || m.ReadingOrder[0].Type != "application/xhtml+xml" {
		t.Errorf("readingOrder = %+v", m.ReadingOrder)
	}
	byHref := map[string]pubLink{}
	for _, r := range m.Resources {
		byHref[r.Href] = r
	}
	if byHref["OEBPS/capa.png"].Rel != "cover" {
		t.Errorf("capa: %+v", byHref["OEBPS/capa.png"])
	}
	if byHref["OEBPS/nao-declarado.css"].Type != "text/css" {
		t.Errorf("arquivo não declarado no OPF precisa ir para o offline: %+v", m.Resources)
	}
	for _, fora := range []string{"mimetype", "META-INF/container.xml", "OEBPS/cap%201.xhtml"} {
		if _, ok := byHref[fora]; ok {
			t.Errorf("%s não é recurso", fora)
		}
	}
	if !strings.Contains(get(h, base+"manifest.json").Body.String(), `"href":"positions.json"`) {
		t.Error("o manifesto precisa apontar para as posições")
	}
}

func TestPosicoesCrescemPeloTamanhoDosCapitulos(t *testing.T) {
	h, base := publicationBook(t, publicationOpf("", "", ""), nil)
	var p pubPositions
	if err := json.Unmarshal(get(h, base+"positions.json").Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	// cap 1 tem 3025 bytes (3 posições); cap2, 29 (1 posição).
	if p.Total != 4 || len(p.Positions) != 4 {
		t.Fatalf("total = %d: %+v", p.Total, p.Positions)
	}
	if p.Positions[0].Locations.TotalProgression != 0 || p.Positions[3].Href != "OEBPS/sub/cap2.xhtml" || p.Positions[3].Locations.Position != 4 {
		t.Errorf("posições = %+v", p.Positions)
	}
	for i := 1; i < len(p.Positions); i++ {
		if p.Positions[i].Locations.TotalProgression <= p.Positions[i-1].Locations.TotalProgression {
			t.Errorf("progresso não cresce em %d: %+v", i, p.Positions)
		}
	}
}

func TestSumarioEpub3TemNiveisEIgnoraOutrosNavs(t *testing.T) {
	opf := publicationOpf("", `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`, "")
	h, base := publicationBook(t, opf, map[string][]byte{"OEBPS/nav.xhtml": []byte(navXHTML)})
	toc := readManifest(t, h, base).Toc
	if len(toc) != 2 {
		t.Fatalf("toc = %+v", toc)
	}
	if toc[0].Title != "Capítulo 1" || toc[0].Href != "OEBPS/cap%201.xhtml" {
		t.Errorf("primeiro = %+v", toc[0])
	}
	if len(toc[0].Children) != 1 || toc[0].Children[0].Href != "OEBPS/cap%201.xhtml#parte" {
		t.Errorf("filhos = %+v", toc[0].Children)
	}
	if toc[1].Title != "Capítulo 2" || toc[1].Href != "OEBPS/sub/cap2.xhtml" {
		t.Errorf("o filho de um título sem link deve subir: %+v", toc[1])
	}
}

func TestSumarioEpub2VemDoNcx(t *testing.T) {
	opf := publicationOpf("", `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`, `toc="ncx"`)
	h, base := publicationBook(t, opf, map[string][]byte{"OEBPS/toc.ncx": []byte(ncxXML)})
	toc := readManifest(t, h, base).Toc
	if len(toc) != 1 || toc[0].Title != "Um" || toc[0].Children[0].Href != "OEBPS/sub/cap2.xhtml#a" {
		t.Fatalf("toc = %+v", toc)
	}
}

func TestLivroSemSumarioAindaAbre(t *testing.T) {
	h, base := publicationBook(t, publicationOpf("", "", ""), nil)
	if toc := readManifest(t, h, base).Toc; toc == nil || len(toc) != 0 {
		t.Fatalf("toc = %#v", toc)
	}
}

func TestPaginaFixaEDirecaoDeLeitura(t *testing.T) {
	opf := publicationOpf(`<meta property="rendition:layout">pre-paginated</meta>`, "", `page-progression-direction="rtl"`)
	h, base := publicationBook(t, opf, nil)
	m := readManifest(t, h, base)
	if m.Metadata.Layout != "fixed" || m.Metadata.ReadingProgression != "rtl" {
		t.Errorf("metadata = %+v", m.Metadata)
	}
	var p pubPositions
	json.Unmarshal(get(h, base+"positions.json").Body.Bytes(), &p)
	if p.Total != 2 {
		t.Errorf("página fixa tem uma posição por arquivo: %d", p.Total)
	}
}

func TestEntregaArquivoInternoComTipoDoOpf(t *testing.T) {
	h, base := publicationBook(t, publicationOpf("", "", ""), nil)
	rec := get(h, base+"OEBPS/cap%201.xhtml")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "aaa") {
		t.Fatalf("%d", rec.Code)
	}
	// O tipo vem do OPF: a imagem de produção não tem tabela de tipos para .xhtml.
	if got := rec.Header().Get("Content-Type"); got != "application/xhtml+xml" {
		t.Errorf("Content-Type = %q", got)
	}
	if rec.Header().Get("Content-Security-Policy") != "sandbox" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("sem proteção contra script do livro: %v", rec.Header())
	}
	if got := get(h, base+"OEBPS/nao-declarado.css").Header().Get("Content-Type"); got != "text/css" {
		t.Errorf("sem declaração no OPF: %q", got)
	}
}

func TestPublicacaoRecusaCaminhosInvalidos(t *testing.T) {
	h, base := publicationBook(t, publicationOpf("", "", ""), nil)
	for _, caminho := range []string{"OEBPS/nada.xhtml", "OEBPS", "..%2F..%2Fetc%2Fpasswd"} {
		if rec := get(h, base+caminho); rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d", caminho, rec.Code)
		}
	}
	if rec := get(h, "/api/books/nao-existe/publication/manifest.json"); rec.Code != http.StatusNotFound {
		t.Errorf("livro inexistente: %d", rec.Code)
	}
}

func TestPublicacaoNaoExisteParaPDF(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "books")
	mkdir(t, dir)
	writeFile(t, filepath.Join(dir, "livro.pdf"), []byte("%PDF-1.4 teste"))
	h, _ := testServerComLivros(t, dir)
	if rec := get(h, "/api/books/"+listBooks(t, h)[0].ID+"/publication/manifest.json"); rec.Code != http.StatusNotFound {
		t.Fatalf("%d", rec.Code)
	}
}

func mkdir(t *testing.T, dir string) {
	t.Helper()
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
}
