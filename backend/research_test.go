package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// Mais informações (R39): a pesquisa vai ao Acervo com o livro e o texto em volta; o pedido fica aqui,
// o resultado vem de lá, e a pesquisa vira Referência com o livro, o autor e o link de volta.
func TestMaisInformacoesPeloAcervo(t *testing.T) {
	h, lib, id := frutasComMarcacoes(t)
	var mu sync.Mutex
	marcas := map[string]map[string]any{}
	var virou map[string]any
	falso := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		partes := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/detalhes"), "/")
		switch {
		case r.Method == "PUT":
			var m map[string]any
			json.NewDecoder(r.Body).Decode(&m)
			m["id"], m["estado"], m["explicacao"], m["fontes"] = partes[1], "pronto", "O caju é **nativo**.", []map[string]string{{"titulo": "Fonte", "url": "https://exemplo.com"}}
			marcas[partes[1]] = m
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(m)
		case r.Method == "GET" && len(partes) == 1:
			lista := []map[string]any{}
			for _, m := range marcas {
				if m["local"] == r.URL.Query().Get("local") {
					lista = append(lista, m)
				}
			}
			json.NewEncoder(w).Encode(lista)
		case r.Method == "GET":
			json.NewEncoder(w).Encode(marcas[partes[1]])
		case r.Method == "POST" && partes[2] == "refazer":
			marcas[partes[1]]["estado"] = "processando"
			json.NewEncoder(w).Encode(marcas[partes[1]])
		case r.Method == "POST" && partes[2] == "referencia":
			json.NewDecoder(r.Body).Decode(&virou)
			marcas[partes[1]]["referencia"] = "ref1"
			w.WriteHeader(http.StatusCreated)
			io.WriteString(w, `{"referencia":{"id":"ref1"},"ja_existia":false}`)
		case r.Method == "DELETE":
			delete(marcas, partes[1])
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer falso.Close()

	base := "/api/books/" + id + "/research"
	pedido := `{"id":"pesq-0001","quote":"nativo do Nordeste","anchor":"{\"href\":\"cap2.xhtml\",\"locations\":{\"progression\":0.1}}","label":"","percent":0.5}`
	if rec := post(h, base, pedido); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("sem o Acervo configurado: %d", rec.Code)
	}
	lib.acervo = acervoConfig{url: falso.URL, link: "https://acervo.internal"}
	lib.flashcards.library = "https://biblioteca.internal"

	rec := post(h, base, pedido)
	var item research
	json.Unmarshal(rec.Body.Bytes(), &item)
	if rec.Code != http.StatusCreated || item.State != "pronto" || len(item.Sources) != 1 {
		t.Fatalf("pedido: %d %s", rec.Code, rec.Body)
	}
	m := marcas["pesq-0001"]
	if m["local"] != "livros/"+id || !strings.HasPrefix(m["titulo"].(string), "Frutas do Brasil") || m["trecho"] != "nativo do Nordeste" || m["antes"] == "" {
		t.Errorf("pedido ao Acervo = %+v", m)
	}
	for _, ruim := range []string{`{"id":"x","quote":"a"}`, `{"id":"pesq-0002","quote":"  "}`, `{"id":"pesq-0003","quote":"` + strings.Repeat("a", 1001) + `"}`} {
		if rec := post(h, base, ruim); rec.Code != http.StatusBadRequest {
			t.Errorf("pedido ruim aceito: %s → %d", ruim[:20], rec.Code)
		}
	}

	var lista []research
	json.Unmarshal(get(h, base).Body.Bytes(), &lista)
	if len(lista) != 1 || lista[0].Explanation != "O caju é **nativo**." || lista[0].Anchor == "" {
		t.Fatalf("lista = %+v", lista)
	}
	if rec := post(h, base+"/pesq-0001/refazer", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"state":"processando"`) {
		t.Errorf("refazer: %d %s", rec.Code, rec.Body)
	}

	rec = post(h, base+"/pesq-0001/referencia", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "https://acervo.internal/#/referencia/ref1") {
		t.Fatalf("virar referência: %d %s", rec.Code, rec.Body)
	}
	origem := virou["origem"].(map[string]any)
	if origem["titulo"] != "Frutas do Brasil" || !strings.HasPrefix(origem["link"].(string), "https://biblioteca.internal/#/livro/"+id+"?em=") {
		t.Errorf("origem = %+v", origem)
	}
	json.Unmarshal(get(h, base+"/pesq-0001").Body.Bytes(), &item)
	if item.ReferenceLink != "https://acervo.internal/#/referencia/ref1" {
		t.Errorf("link da referência = %+v", item)
	}

	if rec := del(h, base+"/pesq-0001"); rec.Code != http.StatusNoContent || len(marcas) != 0 {
		t.Fatalf("apagar: %d %v", rec.Code, marcas)
	}
	json.Unmarshal(get(h, base).Body.Bytes(), &lista)
	if len(lista) != 0 {
		t.Errorf("sobrou: %+v", lista)
	}
}

func TestTextoEmVoltaDoTrecho(t *testing.T) {
	antes, depois := aroundQuote("O caju é   nativo do\nNordeste e dá castanha.", "nativo do Nordeste")
	if antes != "O caju é " || depois != " e dá castanha." {
		t.Errorf("%q %q", antes, depois)
	}
}
