package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func testServer(t *testing.T) (http.Handler, *sql.DB) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "teste.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	web := fstest.MapFS{
		"index.html": {Data: []byte("<h1>app</h1>")},
		"app.js":     {Data: []byte("console.log(1)")},
	}
	return newServer(db, web, "abc123"), db
}

func get(h http.Handler, url string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	return rec
}

func TestHealthRetornaVersaoEStatus(t *testing.T) {
	h, _ := testServer(t)
	rec := get(h, "/api/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "ok" || body["version"] != "abc123" {
		t.Fatalf("body = %v", body)
	}
}

func TestHealthFalhaSemBanco(t *testing.T) {
	h, db := testServer(t)
	db.Close()
	if rec := get(h, "/api/health"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestArquivoEstaticoEFallback(t *testing.T) {
	h, _ := testServer(t)
	if rec := get(h, "/app.js"); !strings.Contains(rec.Body.String(), "console.log") {
		t.Fatalf("app.js = %q", rec.Body.String())
	}
	for _, url := range []string{"/", "/rota/qualquer"} {
		if rec := get(h, url); !strings.Contains(rec.Body.String(), "<h1>app</h1>") {
			t.Fatalf("%s = %d %q", url, rec.Code, rec.Body.String())
		}
	}
}

func TestRotaDeAPIDesconhecidaNaoCaiNoFrontend(t *testing.T) {
	h, _ := testServer(t)
	if rec := get(h, "/api/nao-existe"); rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
}
