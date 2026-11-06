package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func post(h http.Handler, url, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, url, strings.NewReader(body)))
	return rec
}

func listLinks(t *testing.T, h http.Handler) []link {
	t.Helper()
	rec := get(h, "/api/links")
	if rec.Code != http.StatusOK {
		t.Fatalf("lista: %d", rec.Code)
	}
	var list []link
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	return list
}

func TestLinksVemComOsSitesCandidatos(t *testing.T) {
	h, _ := testServer(t)
	list := listLinks(t, h)
	if len(list) != 15 {
		t.Fatalf("len = %d", len(list))
	}
	urls := map[string]bool{}
	for _, k := range list {
		urls[k.URL] = true
	}
	if !urls["https://pt.wikisource.org"] || !urls["https://br.welib.org"] {
		t.Fatalf("faltam sites: %v", urls)
	}
}

func TestAdicionaEApagaLink(t *testing.T) {
	h, _ := testServer(t)
	rec := post(h, "/api/links", `{"url":" https://exemplo.org/livros ","note":"teste"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST: %d %s", rec.Code, rec.Body)
	}
	var k link
	json.Unmarshal(rec.Body.Bytes(), &k)
	if k.ID == 0 || k.Name != "exemplo.org" || k.URL != "https://exemplo.org/livros" || k.Note != "teste" {
		t.Fatalf("k = %+v", k)
	}
	if len(listLinks(t, h)) != 16 {
		t.Fatal("o link novo não entrou na lista")
	}
	if rec := post(h, "/api/links", `{"url":"https://exemplo.org/livros"}`); rec.Code != http.StatusConflict {
		t.Errorf("repetido: %d", rec.Code)
	}

	id := strconv.FormatInt(k.ID, 10)
	if rec := del(h, "/api/links/"+id); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE: %d", rec.Code)
	}
	if rec := del(h, "/api/links/"+id); rec.Code != http.StatusNotFound {
		t.Errorf("apagar de novo: %d", rec.Code)
	}
	if len(listLinks(t, h)) != 15 {
		t.Fatal("o link não saiu da lista")
	}
}

func TestRecusaLinkInvalido(t *testing.T) {
	h, _ := testServer(t)
	for _, body := range []string{`{"url":"javascript:alert(1)"}`, `{"url":"exemplo.org"}`, `{"url":""}`, `não é json`} {
		if rec := post(h, "/api/links", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
}
