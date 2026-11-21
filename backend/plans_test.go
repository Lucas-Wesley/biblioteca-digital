package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestScheduleUmCapituloPorDia(t *testing.T) {
	// 13/11/2026 é uma sexta-feira.
	got := schedule([]int{5, 6, 7}, 1, allWeekdays, "2026-11-13")
	want := []goal{{Day: "2026-11-13", From: 5, To: 5}, {Day: "2026-11-14", From: 6, To: 6}, {Day: "2026-11-15", From: 7, To: 7}}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("meta %d = %+v, quero %+v", i, got[i], want[i])
		}
	}
}

func TestSchedulePulaOsDiasDeFolgaEDivideOsBuracos(t *testing.T) {
	// Só nos dias úteis (1 a 5): sexta, depois segunda; 5, 6 e 7 são contíguos, uma meta só.
	got := schedule([]int{1, 2, 3, 5, 6, 7, 8}, 3, "12345", "2026-11-13")
	want := []goal{{Day: "2026-11-13", From: 1, To: 3}, {Day: "2026-11-16", From: 5, To: 7}, {Day: "2026-11-17", From: 8, To: 8}}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("meta %d = %+v, quero %+v", i, got[i], want[i])
		}
	}
	// 3 e 5 caem no mesmo dia, com o 4 já lido no meio: duas metas no dia.
	got = schedule([]int{3, 5}, 2, allWeekdays, "2026-11-13")
	if len(got) != 2 || got[0] != (goal{Day: "2026-11-13", From: 3, To: 3}) || got[1] != (goal{Day: "2026-11-13", From: 5, To: 5}) {
		t.Fatalf("got %+v", got)
	}
}

func createPlan(t *testing.T, h http.Handler, body string) plan {
	t.Helper()
	rec := post(h, "/api/plans", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST: %d %s", rec.Code, rec.Body)
	}
	var p plan
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPlanoMontaOCronogramaEGuardaOQueFoiLido(t *testing.T) {
	h, _ := testServer(t)
	p := createPlan(t, h, `{"title":"Sussurros na Escuridão","author":"H.P. Lovecraft","unit":"capitulos","total":8,"first":5,
		"per_day":1,"start_day":"2026-11-13","today":"2026-11-13"}`)
	if len(p.Goals) != 4 || p.Goals[0].From != 5 || p.Goals[3].Day != "2026-11-16" || p.Weekdays != allWeekdays {
		t.Fatalf("plano = %+v", p)
	}

	// Leu o capítulo 5 na sexta e não leu o 6 no sábado.
	base := "/api/plans/" + p.ID + "/goals/"
	if rec := put(h, base+strconv.FormatInt(p.Goals[0].ID, 10), `{"state":"lida"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("marcar: %d %s", rec.Code, rec.Body)
	}
	put(h, base+strconv.FormatInt(p.Goals[1].ID, 10), `{"state":"nao-lida"}`)
	if rec := put(h, base+strconv.FormatInt(p.Goals[1].ID, 10), `{"state":"talvez"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("estado inválido: %d", rec.Code)
	}

	// No domingo, o que ficou para trás vai para hoje em diante.
	rec := post(h, "/api/plans/"+p.ID+"/replan", `{"today":"2026-11-15"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("replan: %d %s", rec.Code, rec.Body)
	}
	json.Unmarshal(rec.Body.Bytes(), &p)
	days := []string{}
	for _, g := range p.Goals {
		days = append(days, g.Day+":"+strconv.Itoa(g.From)+":"+g.State)
	}
	if strings.Join(days, " ") != "2026-11-13:5:lida 2026-11-15:6: 2026-11-16:7: 2026-11-17:8:" {
		t.Fatalf("metas = %v", days)
	}

	// Duas por dia, em páginas não: o ritmo muda e o capítulo lido continua lido.
	rec = put(h, "/api/plans/"+p.ID, `{"title":"Sussurros na Escuridão","unit":"capitulos","total":8,"first":5,"per_day":2,
		"weekdays":"0123456","start_day":"2026-11-13","today":"2026-11-15"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	json.Unmarshal(rec.Body.Bytes(), &p)
	if len(p.Goals) != 3 || p.Goals[1].Day != "2026-11-15" || p.Goals[1].From != 6 || p.Goals[1].To != 7 || p.Goals[2].From != 8 {
		t.Fatalf("metas depois do ajuste = %+v", p.Goals)
	}

	// Trocar para páginas recomeça o plano.
	rec = put(h, "/api/plans/"+p.ID, `{"title":"Sussurros na Escuridão","unit":"paginas","total":90,"first":40,"per_day":10,
		"start_day":"2026-11-15","today":"2026-11-15"}`)
	json.Unmarshal(rec.Body.Bytes(), &p)
	if len(p.Goals) != 6 || p.Goals[0].From != 40 || p.Goals[0].To != 49 || p.Goals[5].To != 90 || p.Goals[0].State != "" {
		t.Fatalf("em páginas = %+v", p.Goals)
	}

	if rec := httpDo(h, http.MethodDelete, "/api/plans/"+p.ID); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE: %d", rec.Code)
	}
	if got := get(h, "/api/plans").Body.String(); strings.TrimSpace(got) != "[]" {
		t.Fatalf("lista depois de apagar: %s", got)
	}
}

func TestPlanoRecusaDadosInvalidos(t *testing.T) {
	h, _ := testServer(t)
	for _, body := range []string{
		`{"unit":"capitulos","total":8,"per_day":1,"start_day":"2026-11-13","today":"2026-11-13"}`,
		`{"title":"x","unit":"linhas","total":8,"per_day":1,"start_day":"2026-11-13","today":"2026-11-13"}`,
		`{"title":"x","unit":"paginas","total":0,"per_day":1,"start_day":"2026-11-13","today":"2026-11-13"}`,
		`{"title":"x","unit":"paginas","total":10,"first":11,"per_day":1,"start_day":"2026-11-13","today":"2026-11-13"}`,
		`{"title":"x","unit":"paginas","total":10,"per_day":1,"weekdays":"78","start_day":"2026-11-13","today":"2026-11-13"}`,
		`{"title":"x","unit":"paginas","total":10,"per_day":1,"start_day":"amanhã","today":"2026-11-13"}`,
		`{"title":"x","unit":"capitulos","total":3,"per_day":1,"chapters":[{"title":"Um"}],"start_day":"2026-11-13","today":"2026-11-13"}`,
		`{"title":"x","unit":"paginas","total":10,"per_day":1,"book_id":"nao-existe","start_day":"2026-11-13","today":"2026-11-13"}`,
	} {
		if rec := post(h, "/api/plans", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", body, rec.Code, rec.Body)
		}
	}
}

func TestPlanoDeLivroDaBibliotecaTrazOProgressoDoLeitor(t *testing.T) {
	h, _ := testServerComLivros(t, bookFixture(t))
	id := listBooks(t, h)[0].ID
	put(h, "/api/books/"+id+"/progress", `{"position":"epubcfi(/6/4)","percent":0.25}`)
	p := createPlan(t, h, `{"title":"Livro","book_id":"`+id+`","unit":"capitulos","total":2,"per_day":1,
		"chapters":[{"title":"Um"},{"title":"Dois"}],"start_day":"2026-11-13","today":"2026-11-13"}`)
	if p.BookID != id || p.Percent != 0.25 || len(p.Chapters) != 2 || p.Chapters[1].Title != "Dois" {
		t.Fatalf("plano = %+v", p)
	}
}

func httpDo(h http.Handler, method, url string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, url, nil))
	return rec
}

// metasDoPlano resume as metas como "dia:de-até:estado".
func metasDoPlano(p plan) string {
	out := []string{}
	for _, g := range p.Goals {
		out = append(out, g.Day+":"+strconv.Itoa(g.From)+"-"+strconv.Itoa(g.To)+":"+g.State)
	}
	return strings.Join(out, " ")
}

const capitulosComNotas = `[{"title":"Prefácio"},{"title":"Um"},{"title":"Dois"},{"title":"Três"},{"title":"Notas","skip":true},{"title":"Índice","skip":true}]`

func TestPlanoDeixaDeForaOsCapitulosMarcados(t *testing.T) {
	h, _ := testServer(t)
	// 6 capítulos, os dois últimos fora do plano: só 4 metas, e nada de "Notas" no cronograma.
	p := createPlan(t, h, `{"title":"Livro","unit":"capitulos","total":6,"per_day":1,"chapters":`+capitulosComNotas+`,
		"start_day":"2026-11-13","today":"2026-11-13"}`)
	if got := metasDoPlano(p); got != "2026-11-13:1-1: 2026-11-14:2-2: 2026-11-15:3-3: 2026-11-16:4-4:" {
		t.Fatalf("metas = %s", got)
	}
	if !p.Chapters[4].Skip || p.Chapters[3].Skip {
		t.Fatalf("capítulos = %+v", p.Chapters)
	}

	// Um capítulo do meio fora: a meta de dois por dia se divide em volta dele, no mesmo dia.
	p = createPlan(t, h, `{"title":"Livro","unit":"capitulos","total":6,"per_day":2,"chapters":[{"title":"Um"},{"title":"Interlúdio","skip":true},
		{"title":"Dois"},{"title":"Três"},{"title":"Quatro"},{"title":"Notas","skip":true}],"start_day":"2026-11-13","today":"2026-11-13"}`)
	if got := metasDoPlano(p); got != "2026-11-13:1-1: 2026-11-13:3-3: 2026-11-14:4-5:" {
		t.Fatalf("metas com buraco = %s", got)
	}
}

func TestPlanoMudarOQueFicaForaRefazDeHojeEGuardaOLido(t *testing.T) {
	h, _ := testServer(t)
	body := func(chapters, today string) string {
		return `{"title":"Livro","unit":"capitulos","total":6,"per_day":1,"weekdays":"0123456","chapters":` + chapters +
			`,"start_day":"2026-11-13","today":"` + today + `"}`
	}
	todos := `[{"title":"Prefácio"},{"title":"Um"},{"title":"Dois"},{"title":"Três"},{"title":"Notas"},{"title":"Índice"}]`
	p := createPlan(t, h, body(todos, "2026-11-13"))
	if len(p.Goals) != 6 {
		t.Fatalf("metas = %s", metasDoPlano(p))
	}
	// Leu o prefácio e o capítulo Um.
	for _, g := range p.Goals[:2] {
		put(h, "/api/plans/"+p.ID+"/goals/"+strconv.FormatInt(g.ID, 10), `{"state":"lida"}`)
	}

	// No dia 15, tira as notas e o índice: o lido fica, o resto vem de hoje em diante, sem eles.
	rec := put(h, "/api/plans/"+p.ID, body(capitulosComNotas, "2026-11-15"))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	json.Unmarshal(rec.Body.Bytes(), &p)
	if got := metasDoPlano(p); got != "2026-11-13:1-1:lida 2026-11-14:2-2:lida 2026-11-15:3-3: 2026-11-16:4-4:" {
		t.Fatalf("metas depois de tirar = %s", got)
	}

	// Põe as notas de volta; o "Reorganizar" também respeita o que está fora.
	rec = put(h, "/api/plans/"+p.ID, body(`[{"title":"Prefácio"},{"title":"Um"},{"title":"Dois"},{"title":"Três"},{"title":"Notas"},{"title":"Índice","skip":true}]`, "2026-11-15"))
	json.Unmarshal(rec.Body.Bytes(), &p)
	if got := metasDoPlano(p); got != "2026-11-13:1-1:lida 2026-11-14:2-2:lida 2026-11-15:3-3: 2026-11-16:4-4: 2026-11-17:5-5:" {
		t.Fatalf("metas depois de incluir = %s", got)
	}
	rec = post(h, "/api/plans/"+p.ID+"/replan", `{"today":"2026-11-20"}`)
	json.Unmarshal(rec.Body.Bytes(), &p)
	if got := metasDoPlano(p); got != "2026-11-13:1-1:lida 2026-11-14:2-2:lida 2026-11-20:3-3: 2026-11-21:4-4: 2026-11-22:5-5:" {
		t.Fatalf("metas depois de reorganizar = %s", got)
	}

	// Um capítulo já lido que sai do plano continua com a meta lida.
	rec = put(h, "/api/plans/"+p.ID, body(`[{"title":"Prefácio","skip":true},{"title":"Um"},{"title":"Dois"},{"title":"Três"},{"title":"Notas"},{"title":"Índice","skip":true}]`, "2026-11-20"))
	json.Unmarshal(rec.Body.Bytes(), &p)
	if !strings.HasPrefix(metasDoPlano(p), "2026-11-13:1-1:lida 2026-11-14:2-2:lida 2026-11-20:3-3:") {
		t.Fatalf("metas = %s", metasDoPlano(p))
	}
}

func TestPlanoPrecisaDeAoMenosUmCapituloDentro(t *testing.T) {
	h, _ := testServer(t)
	for _, body := range []string{
		// Todos fora.
		`{"title":"x","unit":"capitulos","total":2,"per_day":1,"chapters":[{"title":"Notas","skip":true},{"title":"Índice","skip":true}],"start_day":"2026-11-13","today":"2026-11-13"}`,
		// Do começo escolhido em diante, só sobra o que está fora.
		`{"title":"x","unit":"capitulos","total":3,"first":2,"per_day":1,"chapters":[{"title":"Um"},{"title":"Notas","skip":true},{"title":"Índice","skip":true}],"start_day":"2026-11-13","today":"2026-11-13"}`,
		// Três por dia, mas só dois capítulos entram.
		`{"title":"x","unit":"capitulos","total":3,"per_day":3,"chapters":[{"title":"Um"},{"title":"Dois"},{"title":"Notas","skip":true}],"start_day":"2026-11-13","today":"2026-11-13"}`,
	} {
		if rec := post(h, "/api/plans", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", body, rec.Code, rec.Body)
		}
	}
	// Em páginas, a marca dos capítulos não conta: o sumário só dá os nomes.
	p := createPlan(t, h, `{"title":"x","unit":"paginas","total":10,"per_day":5,"chapters":[{"title":"Notas","first_page":1,"skip":true}],
		"start_day":"2026-11-13","today":"2026-11-13"}`)
	if len(p.Goals) != 2 {
		t.Fatalf("metas = %s", metasDoPlano(p))
	}
}
