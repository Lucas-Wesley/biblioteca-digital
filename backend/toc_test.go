package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func fakeClaude(t *testing.T, out string, err error) *[]string {
	t.Helper()
	var seen []string
	old := runClaude
	runClaude = func(_ context.Context, dir string, args []string) ([]byte, []byte, error) {
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			seen = append(seen, e.Name())
		}
		seen = append(seen, args...)
		return []byte(out), nil, err
	}
	t.Cleanup(func() { runClaude = old })
	return &seen
}

func photoForm(t *testing.T, n int) (*bytes.Buffer, string) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 20, 20))
	img.Set(1, 1, color.Black)
	var pic bytes.Buffer
	png.Encode(&pic, img)
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for range n {
		w, _ := form.CreateFormFile("foto", "sumario.png")
		w.Write(pic.Bytes())
	}
	form.Close()
	return &body, form.FormDataContentType()
}

func postPhotos(h http.Handler, body *bytes.Buffer, contentType string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/sumario", body)
	req.Header.Set("Content-Type", contentType)
	h.ServeHTTP(rec, req)
	return rec
}

func TestSumarioPelaFoto(t *testing.T) {
	seen := fakeClaude(t, `{"result":"","is_error":false,"structured_output":{"capitulos":[
		{"titulo":"Prefácio","pagina":7},{"titulo":"I. A chegada","pagina":11,"parte":"Parte um"},
		{"titulo":"II. A casa","pagina":29,"parte":"Parte um"},{"titulo":"  ","pagina":40}],"observacao":"Tudo legível."}}`, nil)
	h, _ := testServer(t)
	body, ct := photoForm(t, 2)
	rec := postPhotos(h, body, ct)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST: %d %s", rec.Code, rec.Body)
	}
	var got struct {
		Chapters []tocChapter `json:"chapters"`
		Note     string       `json:"note"`
	}
	json.Unmarshal(rec.Body.Bytes(), &got)
	want := []tocChapter{{"Prefácio", 7, 10}, {"Parte um · I. A chegada", 11, 28}, {"Parte um · II. A casa", 29, 0}}
	if !slices.Equal(got.Chapters, want) || got.Note != "Tudo legível." {
		t.Fatalf("got = %+v", got)
	}
	// As fotos estavam na pasta da tarefa, e o Claude só pode ler: nada de internet ou terminal.
	args := strings.Join(*seen, " ")
	if !strings.Contains(args, "foto-1.png foto-2.png") || !strings.Contains(args, "--allowedTools Read") ||
		!strings.Contains(args, "WebSearch") || !strings.Contains(args, "Bash") {
		t.Fatalf("chamada = %s", args)
	}
}

func TestSumarioPelaFotoRecusaOQueNaoEFoto(t *testing.T) {
	fakeClaude(t, `{}`, nil)
	h, _ := testServer(t)
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	w, _ := form.CreateFormFile("foto", "x.txt")
	w.Write([]byte("não é uma foto"))
	form.Close()
	if rec := postPhotos(h, &body, form.FormDataContentType()); rec.Code != http.StatusBadRequest {
		t.Fatalf("texto: %d", rec.Code)
	}
	body2, ct := photoForm(t, maxTocPhotos+1)
	if rec := postPhotos(h, body2, ct); rec.Code != http.StatusBadRequest {
		t.Fatalf("fotos demais: %d", rec.Code)
	}
}

func TestSumarioPelaFotoComClaudeSemLogin(t *testing.T) {
	fakeClaude(t, `{"result":"Not logged in · Please run /login","is_error":true}`, errors.New("exit status 1"))
	h, _ := testServer(t)
	body, ct := photoForm(t, 1)
	rec := postPhotos(h, body, ct)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "token") {
		t.Fatalf("sem login: %d %s", rec.Code, rec.Body)
	}
}

func TestTokenDaContaAtivaVemDoArquivo(t *testing.T) {
	file := filepath.Join(t.TempDir(), "token")
	os.WriteFile(file, []byte(" abc \n"), 0o600)
	t.Setenv("CLAUDE_TOKEN_ARQUIVO", file)
	env := claudeEnv()
	if env == nil || env[len(env)-1] != "CLAUDE_CODE_OAUTH_TOKEN=abc" {
		t.Fatalf("env = %v", env)
	}
}
