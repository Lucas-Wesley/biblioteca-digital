package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Sumário pela foto (R36): o Lucas fotografa o sumário do livro físico e o Claude lê as fotos e
// devolve os capítulos com a página de cada um, para ele conferir no plano de leitura. Nenhuma fonte
// aberta traz o sumário de um livro (R35), e assim vale a edição que ele tem na mão.
//
// O Claude Code roda headless (claude -p), como no Acervo e no Flashcards: usa a assinatura, com o
// token da conta escolhida no Hub (CLAUDE_TOKEN_ARQUIVO). Ele só pode ler as fotos da pasta da
// tarefa: sem internet, terminal ou escrita.

const (
	maxTocPhotos     = 8
	maxTocPhotoBytes = 15 << 20
	tocTimeout       = 4 * time.Minute
	tocAllowedTools  = "Read"
	tocDeniedTools   = "Bash,Write,Edit,Glob,Grep,Task,NotebookEdit,WebSearch,WebFetch"
)

var (
	claudeBin   = env("CLAUDE_BIN", "claude")
	claudeModel = os.Getenv("CLAUDE_MODELO")
	// Uma leitura por vez: cada uma abre um Claude Code inteiro.
	tocMutex sync.Mutex
)

var photoExtensions = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}

const tocSchema = `{"type":"object","properties":{
	"capitulos":{"type":"array","items":{"type":"object","properties":{
		"titulo":{"type":"string"},"pagina":{"type":"integer"},"parte":{"type":"string"}},
		"required":["titulo","pagina"]}},
	"observacao":{"type":"string"}},
	"required":["capitulos"]}`

const tocPrompt = `Nesta pasta estão %d foto(s) do sumário de um livro físico, em ordem: %s.
Abra cada foto com a ferramenta Read e devolva os capítulos na ordem do livro:
- "titulo": o título como está impresso, com a numeração (ex.: "I. A chegada", "Capítulo 3 — O porão");
- "pagina": a página onde o capítulo começa, só o número; 0 se o sumário não mostra;
- "parte": se o livro se divide em partes, o nome da parte a que o capítulo pertence; senão, vazio.
Entram também prefácio, introdução, posfácio e notas, se estiverem no sumário. Ignore pontilhados,
cabeçalhos e rodapés da página. Não invente nada: se uma linha estiver ilegível, use o que der para ler
e conte isso em "observacao" (uma frase, em português). Se as fotos não forem de um sumário, devolva a
lista vazia e explique em "observacao".`

type tocChapter struct {
	Title     string `json:"title"`
	FirstPage int    `json:"first_page,omitempty"`
	LastPage  int    `json:"last_page,omitempty"`
}

// claudeEnv devolve o ambiente com o token da conta ativa; nil herda o do app (o .env, ou o login
// da máquina no desenvolvimento).
func claudeEnv() []string {
	file := os.Getenv("CLAUDE_TOKEN_ARQUIVO")
	if file == "" {
		return nil
	}
	b, err := os.ReadFile(file)
	token := strings.TrimSpace(string(b))
	if err != nil || token == "" {
		return nil
	}
	return append(os.Environ(), "CLAUDE_CODE_OAUTH_TOKEN="+token)
}

func (l *library) handleTableOfContents(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxTocPhotos*maxTocPhotoBytes+(1<<20))
	reader, err := r.MultipartReader()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "envie as fotos em um formulário"})
		return
	}
	dir, err := os.MkdirTemp("", "sumario-*")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao guardar as fotos"})
		return
	}
	defer os.RemoveAll(dir)

	var names []string
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			writeUploadReadError(w, err)
			return
		}
		if part.FormName() != "foto" {
			continue
		}
		if len(names) == maxTocPhotos {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("no máximo %d fotos por vez", maxTocPhotos)})
			return
		}
		data, err := io.ReadAll(io.LimitReader(part, maxTocPhotoBytes+1))
		if err != nil {
			writeUploadReadError(w, err)
			return
		}
		ext, ok := photoExtensions[http.DetectContentType(data)]
		if len(data) > maxTocPhotoBytes || !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a foto precisa ser JPEG, PNG ou WebP, com até 15 MB"})
			return
		}
		name := fmt.Sprintf("foto-%d%s", len(names)+1, ext)
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao guardar as fotos"})
			return
		}
		names = append(names, name)
	}
	if len(names) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "nenhuma foto enviada"})
		return
	}

	chapters, note, err := readTableOfContents(r.Context(), dir, names)
	if err != nil {
		log.Printf("sumário pela foto: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chapters": chapters, "note": note})
}

// runClaude é trocado nos testes.
var runClaude = func(ctx context.Context, dir string, args []string) ([]byte, []byte, error) {
	cmd := exec.CommandContext(ctx, claudeBin, args...)
	cmd.Env = claudeEnv()
	cmd.Dir = dir
	cmd.WaitDelay = 5 * time.Second
	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	err := cmd.Run()
	return out.Bytes(), stderr.Bytes(), err
}

func readTableOfContents(ctx context.Context, dir string, names []string) ([]tocChapter, string, error) {
	tocMutex.Lock()
	defer tocMutex.Unlock()
	ctx, cancel := context.WithTimeout(ctx, tocTimeout)
	defer cancel()

	prompt := fmt.Sprintf(tocPrompt, len(names), strings.Join(names, ", "))
	args := []string{"-p", prompt, "--output-format", "json", "--no-session-persistence",
		"--allowedTools", tocAllowedTools, "--disallowedTools", tocDeniedTools, "--json-schema", tocSchema}
	if claudeModel != "" {
		args = append(args, "--model", claudeModel)
	}
	out, stderr, runErr := runClaude(ctx, dir, args)
	if ctx.Err() != nil {
		return nil, "", errors.New("o Claude demorou demais para ler as fotos; tente com menos fotos")
	}
	var resp struct {
		Result     string          `json:"result"`
		IsError    bool            `json:"is_error"`
		Structured json.RawMessage `json:"structured_output"`
	}
	if err := json.Unmarshal(out, &resp); err != nil {
		if runErr != nil {
			return nil, "", fmt.Errorf("o Claude não rodou: %s", firstLine(string(stderr), runErr.Error()))
		}
		return nil, "", errors.New("resposta do Claude ilegível")
	}
	if resp.IsError || runErr != nil {
		msg := firstLine(resp.Result, firstLine(string(stderr), "erro sem mensagem"))
		if strings.Contains(msg, "Not logged in") || strings.Contains(msg, "/login") {
			return nil, "", errors.New("o Claude recusou o login: troque o token da conta ativa no Hub, na tela Claude")
		}
		return nil, "", fmt.Errorf("o Claude falhou: %s", msg)
	}
	var data struct {
		Chapters []struct {
			Title string `json:"titulo"`
			Page  int    `json:"pagina"`
			Part  string `json:"parte"`
		} `json:"capitulos"`
		Note string `json:"observacao"`
	}
	raw := []byte(resp.Structured)
	if len(raw) == 0 || string(raw) == "null" {
		start, end := strings.Index(resp.Result, "{"), strings.LastIndex(resp.Result, "}")
		if start < 0 || end < start {
			return nil, "", errors.New("o Claude não devolveu os capítulos")
		}
		raw = []byte(resp.Result[start : end+1])
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, "", errors.New("o Claude não devolveu os capítulos")
	}
	chapters := []tocChapter{}
	for _, c := range data.Chapters {
		title := cleanText(c.Title)
		if part := cleanText(c.Part); part != "" && !strings.Contains(strings.ToLower(title), strings.ToLower(part)) {
			title = part + " · " + title
		}
		if title == "" {
			continue
		}
		chapters = append(chapters, tocChapter{Title: title, FirstPage: max(c.Page, 0)})
	}
	if len(chapters) > maxPlanChapters {
		chapters = chapters[:maxPlanChapters]
	}
	fillLastPages(chapters)
	return chapters, cleanText(data.Note), nil
}

// fillLastPages: cada capítulo vai até a página antes do próximo, quando as páginas crescem.
func fillLastPages(chapters []tocChapter) {
	for i := range chapters {
		if i+1 < len(chapters) && chapters[i].FirstPage > 0 && chapters[i+1].FirstPage > chapters[i].FirstPage {
			chapters[i].LastPage = chapters[i+1].FirstPage - 1
		}
	}
}
