package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeSources troca as três fontes por um servidor local; handlers diz o que cada caminho responde.
func fakeSources(t *testing.T, handlers map[string]string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for prefix, body := range handlers {
			if strings.HasPrefix(r.URL.Path, prefix) {
				if body == "429" {
					w.WriteHeader(http.StatusTooManyRequests)
					return
				}
				w.Write([]byte(body))
				return
			}
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	old := []string{brasilAPIBase, openLibraryBase, googleBooksBase}
	brasilAPIBase, openLibraryBase, googleBooksBase = srv.URL, srv.URL, srv.URL
	t.Cleanup(func() { brasilAPIBase, openLibraryBase, googleBooksBase = old[0], old[1], old[2] })
}

func catalog(t *testing.T, h http.Handler, query string) []bookInfo {
	t.Helper()
	rec := get(h, "/api/catalogo?"+query)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s: %d %s", query, rec.Code, rec.Body)
	}
	var list []bookInfo
	json.Unmarshal(rec.Body.Bytes(), &list)
	return list
}

func TestISBNTentaUmaFonteEDepoisAOutra(t *testing.T) {
	// A BrasilAPI não tem a capa nem as páginas; a Open Library completa.
	fakeSources(t, map[string]string{
		"/api/isbn/v1/": `{"isbn":"9788535932843","title":"O chamado de Cthulhu","authors":["H.P. Lovecraft"],"publisher":"Companhia das Letras","year":2019}`,
		"/api/books": `{"ISBN:9788535932843":{"title":"Outro título","number_of_pages":448,"publish_date":"Dec 02, 2019",
			"cover":{"large":"https://covers.openlibrary.org/b/id/1-L.jpg"}}}`,
		"/books/v1/volumes": "429",
	})
	h, _ := testServer(t)
	list := catalog(t, h, "isbn=978-85-359-3284-3")
	if len(list) != 1 {
		t.Fatalf("list = %+v", list)
	}
	b := list[0]
	if b.Title != "O chamado de Cthulhu" || b.Pages != 448 || b.CoverURL == "" || b.Publisher != "Companhia das Letras" ||
		b.Source != "BrasilAPI" || b.Year != "2019" {
		t.Fatalf("b = %+v", b)
	}
}

func TestISBNQueNinguemConheceVoltaVazioENaoErro(t *testing.T) {
	fakeSources(t, map[string]string{"/api/books": `{}`, "/books/v1/volumes": `{}`})
	h, _ := testServer(t)
	if list := catalog(t, h, "q=9788535932843"); len(list) != 0 {
		t.Fatalf("list = %+v", list)
	}
}

func TestBuscaPorTituloJuntaAsFontesSemRepetir(t *testing.T) {
	fakeSources(t, map[string]string{
		"/search.json": `{"docs":[{"title":"A Principal Finalidade da Vida","author_name":["Silvio Dutra"]},{"title":"Sussurros na escuridão","author_name":["H.P. Lovecraft"],"number_of_pages_median":87,
			"isbn":["1072510073","9781072510079","9788582850001"],"cover_i":11971450}]}`,
		"/books/v1/volumes": `{"items":[
			{"volumeInfo":{"title":"Sussurros na escuridão","authors":["H.P. Lovecraft"],"pageCount":87,
				"industryIdentifiers":[{"type":"ISBN_13","identifier":"9788582850001"}]}},
			{"volumeInfo":{"title":"Sussurros na Escuridão","subtitle":"e outros contos","authors":["H. P. Lovecraft"],"publisher":"Hedra","pageCount":120,
				"industryIdentifiers":[{"type":"ISBN_13","identifier":"9788577150002"}],"imageLinks":{"thumbnail":"http://books.google.com/x"}}}]}`,
	})
	h, _ := testServer(t)
	list := catalog(t, h, "q=sussurros+na+escuridao")
	if len(list) != 2 {
		t.Fatalf("list = %+v", list)
	}
	if list[0].ISBN != "9788582850001" || list[0].Source != "Open Library" || !strings.Contains(list[0].CoverURL, "11971450") {
		t.Fatalf("primeiro = %+v", list[0])
	}
	if list[1].Title != "Sussurros na Escuridão: e outros contos" || list[1].CoverURL != "https://books.google.com/x" {
		t.Fatalf("segundo = %+v", list[1])
	}
}

func TestBuscaSemNenhumaFonteAvisa(t *testing.T) {
	fakeSources(t, map[string]string{"/search.json": "429", "/books/v1/volumes": "429"})
	h, _ := testServer(t)
	if rec := get(h, "/api/catalogo?q=lovecraft"); rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec := get(h, "/api/catalogo?q=a"); rec.Code != http.StatusBadRequest {
		t.Fatalf("busca curta: %d", rec.Code)
	}
}

func TestNormalISBN(t *testing.T) {
	for in, want := range map[string]string{
		"978-85-359-3284-3": "9788535932843",
		"85 359 3284 X":     "853593284X",
		"lovecraft":         "",
		"12345":             "",
		"X123456789":        "",
	} {
		if got := normalISBN(in); got != want {
			t.Errorf("%q = %q, quero %q", in, got, want)
		}
	}
}

func TestCapaDeEnderecoDaRedeDeCasaNaoEntra(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(make([]byte, 5000)) }))
	defer srv.Close()
	if _, _, err := fetchCover(t.Context(), srv.URL+"/capa.jpg"); err == nil || !strings.Contains(err.Error(), "não permitido") {
		t.Fatalf("err = %v", err)
	}
}
