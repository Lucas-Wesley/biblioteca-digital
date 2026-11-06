package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func send(h http.Handler, method, url, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, url, strings.NewReader(body)))
	return rec
}

func TestSugestoesDeMelhoria(t *testing.T) {
	h, _ := testServer(t)
	const url = "/api/sugestoes/3f6c1d2e-aaaa-4bbb-8ccc-000000000001"

	rec := send(h, http.MethodPut, url, `{"texto":" Marcar trecho com dois toques ","tela":"leitor"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	var s suggestion
	json.Unmarshal(rec.Body.Bytes(), &s)
	if s.Text != "Marcar trecho com dois toques" || s.Screen != "leitor" || s.State != "nova" {
		t.Fatalf("criada: %+v", s)
	}
	// A fila do aparelho pode reenviar: não duplica.
	send(h, http.MethodPut, url, `{"texto":"Marcar trecho com dois toques","tela":"leitor"}`)
	if rec := send(h, http.MethodPut, url, `{"texto":"  "}`); rec.Code != http.StatusBadRequest {
		t.Errorf("sugestão vazia aceita: %d", rec.Code)
	}
	if rec := send(h, http.MethodPut, "/api/sugestoes/x", `{"texto":"a"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("id inválido aceito: %d", rec.Code)
	}

	rec = send(h, http.MethodPatch, url, `{"estado":"feita","resposta":"Feito na versão nova."}`)
	json.Unmarshal(rec.Body.Bytes(), &s)
	if rec.Code != http.StatusOK || s.State != "feita" || s.Answer != "Feito na versão nova." {
		t.Fatalf("PATCH: %d %+v", rec.Code, s)
	}
	if rec := send(h, http.MethodPatch, url, `{"estado":"talvez"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("estado inválido aceito: %d", rec.Code)
	}
	// Depois de feita, reenviar o texto não muda nada.
	send(h, http.MethodPut, url, `{"texto":"outra coisa"}`)

	var list []suggestion
	json.Unmarshal(get(h, "/api/sugestoes").Body.Bytes(), &list)
	if len(list) != 1 || list[0].Text != "Marcar trecho com dois toques" {
		t.Fatalf("lista: %+v", list)
	}
	if rec := send(h, http.MethodDelete, url, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE: %d", rec.Code)
	}
	json.Unmarshal(get(h, "/api/sugestoes").Body.Bytes(), &list)
	if len(list) != 0 {
		t.Fatalf("não apagou: %+v", list)
	}
}
