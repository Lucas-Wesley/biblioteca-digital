package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func del(h http.Handler, url string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, url, nil))
	return rec
}

func listAnnotations(t *testing.T, h http.Handler, url string) []annotation {
	t.Helper()
	rec := get(h, url)
	if rec.Code != http.StatusOK {
		t.Fatalf("lista: %d", rec.Code)
	}
	var list []annotation
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	return list
}

func TestCriaAtualizaEApagaMarcacao(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	url := "/api/books/" + listBooks(t, h)[0].ID + "/annotations"
	if got := listAnnotations(t, h, url); got == nil || len(got) != 0 {
		t.Fatalf("sem marcações deve ser lista vazia: %#v", got)
	}

	body := `{"color":"amarelo","note":"","quote":"trecho","anchor":"{\"href\":\"c.xhtml\"}","label":"Cap 1","percent":0.5,"updated_at":"2026-01-01T10:00:00.000Z","created_at":"2026-01-01T10:00:00.000Z"}`
	if rec := put(h, url+"/a1", body); rec.Code != http.StatusNoContent {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	got := listAnnotations(t, h, url)
	if len(got) != 1 || got[0].ID != "a1" || got[0].Quote != "trecho" || got[0].Label != "Cap 1" || got[0].Percent != 0.5 {
		t.Fatalf("got = %+v", got)
	}

	// Reenviar não duplica, e a nota nova entra.
	body2 := `{"color":"verde","note":"nota","quote":"trecho","anchor":"{}","percent":0.5,"updated_at":"2026-01-01T11:00:00.000Z"}`
	put(h, url+"/a1", body2)
	got = listAnnotations(t, h, url)
	if len(got) != 1 || got[0].Color != "verde" || got[0].Note != "nota" {
		t.Fatalf("depois de atualizar: %+v", got)
	}
	if got[0].Anchor != `{"href":"c.xhtml"}` {
		t.Errorf("a âncora não muda ao editar: %q", got[0].Anchor)
	}

	if rec := del(h, url+"/a1"); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE: %d", rec.Code)
	}
	if rec := del(h, url+"/a1"); rec.Code != http.StatusNoContent {
		t.Errorf("repetir o DELETE deve funcionar: %d", rec.Code)
	}
	if got := listAnnotations(t, h, url); len(got) != 0 {
		t.Fatalf("depois de apagar: %+v", got)
	}
}

func TestEdicaoOfflineMaisAntigaNaoSobrescreve(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	url := "/api/books/" + listBooks(t, h)[0].ID + "/annotations"
	put(h, url+"/a1", `{"color":"azul","note":"nova","anchor":"{}","percent":0,"updated_at":"2026-01-02T10:00:00Z"}`)
	put(h, url+"/a1", `{"color":"rosa","note":"velha","anchor":"{}","percent":0,"updated_at":"2026-01-01T10:00:00Z"}`)
	if got := listAnnotations(t, h, url); got[0].Note != "nova" {
		t.Fatalf("got = %+v", got)
	}
}

func TestRecusaMarcacaoInvalida(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	url := "/api/books/" + listBooks(t, h)[0].ID + "/annotations"
	valid := `{"color":"verde","anchor":"{}","percent":0}`
	casos := map[string]string{
		`nao e json`: "/a1",
		`{"color":"preto","anchor":"{}","percent":0}`: "/a1",
		`{"color":"verde","anchor":"","percent":0}`:   "/a1",
		`{"color":"verde","anchor":"{}","percent":2}`: "/a1",
		valid: "/id%20invalido",
	}
	for body, sufixo := range casos {
		if rec := put(h, url+sufixo, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s %s: %d", sufixo, body, rec.Code)
		}
	}
	if rec := put(h, "/api/books/nao-existe/annotations/a1", valid); rec.Code != http.StatusNotFound {
		t.Errorf("livro inexistente: %d", rec.Code)
	}
	if rec := get(h, "/api/books/nao-existe/annotations"); rec.Code != http.StatusNotFound {
		t.Errorf("lista de livro inexistente: %d", rec.Code)
	}
}

func TestProgressoOfflineMaisAntigoNaoSobrescreve(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	url := "/api/books/" + listBooks(t, h)[0].ID + "/progress"
	put(h, url, `{"position":"novo","percent":0.8,"updated_at":"2026-01-02T10:00:00Z"}`)
	put(h, url, `{"position":"velho","percent":0.2,"updated_at":"2026-01-01T10:00:00Z"}`)
	var p progress
	if err := json.Unmarshal(get(h, url).Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Position != "novo" || p.UpdatedAt != "2026-01-02T10:00:00.000Z" {
		t.Fatalf("p = %+v", p)
	}
}

func TestRelogioAdiantadoNaoBloqueiaProgresso(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	url := "/api/books/" + listBooks(t, h)[0].ID + "/progress"
	futuro := time.Now().Add(240 * time.Hour).UTC().Format(time.RFC3339)
	put(h, url, `{"position":"a","percent":0.1,"updated_at":"`+futuro+`"}`)
	time.Sleep(5 * time.Millisecond)
	put(h, url, `{"position":"b","percent":0.2}`)
	var p progress
	json.Unmarshal(get(h, url).Body.Bytes(), &p)
	if p.Position != "b" {
		t.Fatalf("p = %+v", p)
	}
}

func TestListaLivrosTrazProgresso(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	id := listBooks(t, h)[0].ID
	if b := listBooks(t, h)[0]; b.Percent != 0 || b.ReadAt != "" {
		t.Fatalf("sem leitura: %+v", b)
	}
	put(h, "/api/books/"+id+"/progress", `{"position":"x","percent":0.25}`)
	if b := listBooks(t, h)[0]; b.Percent != 0.25 || b.ReadAt == "" {
		t.Fatalf("com leitura: %+v", b)
	}
}

func TestMigracaoAguentaVersaoDesfeita(t *testing.T) {
	h, db := testServerComLivros(t, bookFixture(t))
	_ = h
	// Uma versão anterior do app reescreve o user_version, mas deixa a tabela nova no banco.
	if _, err := db.Exec(`PRAGMA user_version = 3`); err != nil {
		t.Fatal(err)
	}
	if err := migrate(t.Context(), db); err != nil {
		t.Fatal(err)
	}
}
