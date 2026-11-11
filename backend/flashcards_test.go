package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func markOn(t *testing.T, h http.Handler, bookID, id, quote, anchor, note string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"color": "amarelo", "quote": quote, "anchor": anchor, "note": note, "label": "", "percent": 0.5})
	if rec := put(h, "/api/books/"+bookID+"/annotations/"+id, string(body)); rec.Code != http.StatusNoContent {
		t.Fatalf("marcação %s: %d %s", id, rec.Code, rec.Body)
	}
}

func frutasComMarcacoes(t *testing.T) (http.Handler, *library, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "books")
	mkdir(t, dir)
	writeFile(t, filepath.Join(dir, "frutas.epub"), searchEpub(t))
	h, lib := searchServer(t, dir)
	id := onlyBookID(t, h)
	// Pelo lugar do Readium (o href como o leitor o vê, sem a pasta) e pelo texto, quando o lugar não bate.
	markOn(t, h, id, "caju", "nativo do Nordeste", `{"href":"cap2.xhtml","locations":{"progression":0.1}}`, "lembrar da castanha")
	markOn(t, h, id, "laranja", "A laranja doce veio da Ásia e chegou ao Brasil", `{"href":"outro-nome.xhtml"}`, "")
	return h, lib, id
}

func TestMarcacoesEntramNoCapituloENoTexto(t *testing.T) {
	h, _, id := frutasComMarcacoes(t)

	var b bookChapters
	json.Unmarshal(get(h, "/api/books/"+id+"/chapters").Body.Bytes(), &b)
	if len(b.Chapters) != 2 || b.Chapters[0].Highlights != 1 || b.Chapters[1].Highlights != 1 {
		t.Fatalf("marcações por capítulo = %+v", b.Chapters)
	}

	var txt textResponse
	json.Unmarshal(get(h, "/api/books/"+id+"/text?chapters=2").Body.Bytes(), &txt)
	hs := txt.Parts[0].Highlights
	if len(hs) != 1 || hs[0].Quote != "nativo do Nordeste" || hs[0].Note != "lembrar da castanha" || !strings.Contains(hs[0].Anchor, "cap2.xhtml") {
		t.Errorf("marcações do capítulo 2 = %+v", hs)
	}
	json.Unmarshal(get(h, "/api/books/"+id+"/text?chapters=1").Body.Bytes(), &txt)
	if hs := txt.Parts[0].Highlights; len(hs) != 1 || !strings.HasPrefix(hs[0].Quote, "A laranja") {
		t.Errorf("marcações do capítulo 1 = %+v", hs)
	}
}

func TestMarcacaoViraPedidoNoFlashcards(t *testing.T) {
	h, lib, id := frutasComMarcacoes(t)
	var recebido map[string]any
	falso := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /api/baralhos":
			io.WriteString(w, `[{"id":"b1","nome":"Botânica","cartoes":3}]`)
		case "POST /api/textos":
			json.NewDecoder(r.Body).Decode(&recebido)
			if recebido["baralho_id"] == "sumiu" {
				w.WriteHeader(http.StatusBadRequest)
				io.WriteString(w, `{"erro":"Esse baralho não existe mais. Escolha outro."}`)
				return
			}
			w.WriteHeader(http.StatusCreated)
			io.WriteString(w, `{"id":42,"estado":"na_fila"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer falso.Close()

	url := "/api/books/" + id + "/annotations/caju/flashcards"
	if rec := post(h, url, `{"deck_id":"b1"}`); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("sem o Flashcards configurado: %d", rec.Code)
	}
	lib.flashcards = flashcardsConfig{url: falso.URL, link: "https://flashcards.internal", library: "https://biblioteca.internal"}

	var decks []flashcardsDeck
	json.Unmarshal(get(h, "/api/flashcards/decks").Body.Bytes(), &decks)
	if len(decks) != 1 || decks[0].Nome != "Botânica" {
		t.Errorf("baralhos = %+v", decks)
	}

	rec := post(h, url, `{"deck_id":"b1"}`)
	var resp struct {
		FlashcardsAt string `json:"flashcards_at"`
		Review       string `json:"review"`
	}
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if rec.Code != http.StatusCreated || resp.Review != "https://flashcards.internal/#/geracao/42" || resp.FlashcardsAt == "" {
		t.Fatalf("pedido: %d %s", rec.Code, rec.Body)
	}
	contexto, _ := recebido["contexto"].(string)
	if recebido["origem"] != "biblioteca" || recebido["texto"] != "nativo do Nordeste" || recebido["titulo"] != "Frutas do Brasil › Capítulo 2: O caju" ||
		!strings.Contains(contexto, "lembrar da castanha") || !strings.Contains(contexto, "A castanha vem junto") ||
		!strings.HasPrefix(recebido["link"].(string), "https://biblioteca.internal/#/livro/"+id+"?em=") {
		t.Errorf("pedido ao Flashcards = %+v", recebido)
	}

	// A marcação lembra o envio, para avisar antes de mandar de novo.
	for _, a := range listAnnotations(t, h, "/api/books/"+id+"/annotations") {
		if (a.ID == "caju") != (a.FlashcardsAt != "") {
			t.Errorf("enviada em = %+v", a)
		}
	}

	if rec := post(h, url, `{"deck_id":"sumiu"}`); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "não existe mais") {
		t.Errorf("baralho apagado: %d %s", rec.Code, rec.Body)
	}
	for _, c := range []struct{ url, body string }{
		{url, `{}`},
		{"/api/books/" + id + "/annotations/nao-sincronizada/flashcards", `{"deck_id":"b1"}`},
		{"/api/books/nao-existe/annotations/caju/flashcards", `{"deck_id":"b1"}`},
	} {
		if rec := post(h, c.url, c.body); rec.Code != http.StatusBadRequest && rec.Code != http.StatusNotFound {
			t.Errorf("%s %s: %d", c.url, c.body, rec.Code)
		}
	}
}
