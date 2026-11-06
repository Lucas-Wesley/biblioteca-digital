package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func listReading(t *testing.T, h http.Handler) []readingDay {
	t.Helper()
	rec := get(h, "/api/reading")
	if rec.Code != http.StatusOK {
		t.Fatalf("lista: %d", rec.Code)
	}
	var list []readingDay
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	return list
}

func TestLeituraDoDiaPorAparelho(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	id := listBooks(t, h)[0].ID
	url := "/api/books/" + id + "/reading/2026-11-06"
	if got := listReading(t, h); got == nil || len(got) != 0 {
		t.Fatalf("sem leitura deve ser lista vazia: %#v", got)
	}

	if rec := put(h, url, `{"device":"celular-1","seconds":600,"pages":12.5,"book_pages":300}`); rec.Code != http.StatusNoContent {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	// O total do aparelho cresce; um envio atrasado, com total menor, não apaga o que já veio.
	put(h, url, `{"device":"celular-1","seconds":900,"pages":15,"book_pages":300}`)
	put(h, url, `{"device":"celular-1","seconds":300,"pages":4,"book_pages":300}`)
	put(h, url, `{"device":"tablet-22","seconds":120,"pages":2,"book_pages":300}`)

	got := listReading(t, h)
	if len(got) != 2 {
		t.Fatalf("um registro por aparelho: %+v", got)
	}
	if got[0] != (readingDay{Device: "celular-1", Day: "2026-11-06", BookID: id, Seconds: 900, Pages: 15, BookPages: 300}) {
		t.Errorf("celular = %+v", got[0])
	}
	if got[1].Device != "tablet-22" || got[1].Seconds != 120 {
		t.Errorf("tablet = %+v", got[1])
	}
}

func TestLeituraInvalidaERecusada(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	base := "/api/books/" + listBooks(t, h)[0].ID + "/reading/"
	casos := map[string]string{
		"2026-13-40": `{"device":"celular-1","seconds":60,"pages":1,"book_pages":10}`,
		"2026-11-06": `{"device":"x","seconds":60,"pages":1,"book_pages":10}`,
		"2026-11-07": `{"device":"celular-1","seconds":-1,"pages":1,"book_pages":10}`,
		"2026-11-08": `{"device":"celular-1","seconds":90000,"pages":1,"book_pages":10}`,
		"2026-11-09": `não é json`,
	}
	for day, body := range casos {
		if rec := put(h, base+day, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s %s: %d", day, body, rec.Code)
		}
	}
	if rec := put(h, "/api/books/nao-existe/reading/2026-11-06", `{"device":"celular-1","seconds":60,"pages":1,"book_pages":10}`); rec.Code != http.StatusNotFound {
		t.Errorf("livro que não existe: %d", rec.Code)
	}
	if got := listReading(t, h); len(got) != 0 {
		t.Errorf("nada deveria ter entrado: %+v", got)
	}
}

func TestPaginasEstimadasDoEpub(t *testing.T) {
	// cap 1 tem 3.000 letras e cap 2, "dois": 3.004 caracteres dão 2 páginas de 1.500.
	h, base := publicationBook(t, publicationOpf("", "", ""), nil)
	if got := readManifest(t, h, base).Metadata.NumberOfPages; got != 2 {
		t.Errorf("numberOfPages = %d", got)
	}
	texto := `<html><head><title>Não conta</title><style>p{}</style></head><body><p>Olá,   mundo&nbsp;!</p><script>x()</script></body></html>`
	if got := textLength([]byte(texto)); got != len([]rune("Olá, mundo !")) {
		t.Errorf("textLength = %d", got)
	}
}
