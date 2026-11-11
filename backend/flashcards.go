package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Marcação → Flashcards (R34): no leitor, o Lucas toca numa marcação e pede um cartão, escolhendo um
// baralho que já existe. O servidor junta o trecho marcado, a nota, o capítulo e o parágrafo em volta
// e manda ao Flashcards (POST /api/textos, origem "biblioteca"). Lá a IA propõe a frente e o verso e o
// Lucas aprova na revisão; nada entra no baralho sem passar por ele. Cada cartão guarda o link que
// abre o livro no trecho.

const flashcardsTimeout = 15 * time.Second

var flashcardsClient = &http.Client{Timeout: flashcardsTimeout}

type flashcardsConfig struct {
	url     string // o Flashcards pela rede interna do Docker (vazio: integração desligada)
	link    string // o Flashcards como o Lucas abre, para o link da revisão
	library string // a Biblioteca como o Lucas abre, para o link de volta no cartão
}

type flashcardsDeck struct {
	ID   string `json:"id"`
	Nome string `json:"nome"`
}

func (l *library) noFlashcards(w http.ResponseWriter) bool {
	if l.flashcards.url == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "o Flashcards não está configurado neste servidor (FLASHCARDS_URL)"})
		return true
	}
	return false
}

// handleFlashcardsDecks: GET /api/flashcards/decks, os baralhos do Flashcards, para escolher.
func (l *library) handleFlashcardsDecks(w http.ResponseWriter, r *http.Request) {
	if l.noFlashcards(w) {
		return
	}
	var decks []flashcardsDeck
	if err := l.callFlashcards(r.Context(), http.MethodGet, "/api/baralhos", nil, &decks); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "o Flashcards não respondeu: " + err.Error()})
		return
	}
	if decks == nil {
		decks = []flashcardsDeck{}
	}
	writeJSON(w, http.StatusOK, decks)
}

// handleAnnotationFlashcards: POST /api/books/{id}/annotations/{annotation}/flashcards {deck_id}.
func (l *library) handleAnnotationFlashcards(w http.ResponseWriter, r *http.Request) {
	if l.noFlashcards(w) {
		return
	}
	var body struct {
		DeckID string `json:"deck_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxFieldBytes)).Decode(&body); err != nil || body.DeckID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "escolha um baralho"})
		return
	}
	bookID, annotationID := r.PathValue("id"), r.PathValue("annotation")
	b, passages, err := l.chaptersOf(r.Context(), bookID)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler o livro"})
		return
	}
	marks, err := l.placedAnnotations(r.Context(), b, passages)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler as marcações"})
		return
	}
	var mark *placedAnnotation
	for i := range marks {
		if marks[i].ID == annotationID {
			mark = &marks[i]
		}
	}
	if mark == nil {
		// Feita offline e ainda não sincronizada: o aparelho manda de novo quando voltar a rede.
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "a marcação ainda não chegou ao servidor; tente de novo em instantes"})
		return
	}

	request := flashcardsRequest(b, mark, passages, l.flashcards.library)
	request["baralho_id"] = body.DeckID
	var generation struct {
		ID int64 `json:"id"`
	}
	if err := l.callFlashcards(r.Context(), http.MethodPost, "/api/textos", request, &generation); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	sentAt := time.Now().UTC().Format(time.RFC3339)
	if _, err := l.db.ExecContext(r.Context(),
		`INSERT INTO annotation_flashcards (annotation_id, sent_at) VALUES (?, ?)
		 ON CONFLICT (annotation_id) DO UPDATE SET sent_at = excluded.sent_at`, annotationID, sentAt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao guardar o envio"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"flashcards_at": sentAt,
		"review":        fmt.Sprintf("%s/#/geracao/%d", l.flashcards.link, generation.ID),
	})
}

// flashcardsRequest monta o pedido: o trecho marcado é o texto; o resto é contexto para a IA.
func flashcardsRequest(b bookChapters, mark *placedAnnotation, passages []indexedPassage, libraryLink string) map[string]any {
	chapter := mark.Label
	if mark.passage >= 0 && passages[mark.passage].Chapter != "" {
		chapter = passages[mark.passage].Chapter
	}
	title := b.Title
	if chapter != "" {
		title += " › " + chapter
	}
	var context strings.Builder
	fmt.Fprintf(&context, "Livro: %q", b.Title)
	if b.Author != "" {
		fmt.Fprintf(&context, ", de %s", b.Author)
	}
	context.WriteString(".")
	if chapter != "" {
		fmt.Fprintf(&context, " Capítulo: %q.", chapter)
	}
	if note := strings.TrimSpace(mark.Note); note != "" {
		fmt.Fprintf(&context, "\nNota do Lucas na marcação: %q.", note)
	}
	if mark.passage >= 0 {
		fmt.Fprintf(&context, "\nTrecho em volta da marcação (a página do livro):\n%s", strings.TrimSpace(passages[mark.passage].Text))
	}
	return map[string]any{
		"origem":   "biblioteca",
		"titulo":   title,
		"texto":    strings.TrimSpace(mark.Quote),
		"contexto": context.String(),
		"link":     fmt.Sprintf("%s/#/livro/%s?em=%s", libraryLink, url.PathEscape(b.ID), url.QueryEscape(mark.Anchor)),
	}
}

// callFlashcards fala com o Flashcards; a mensagem de erro dele chega ao Lucas como veio.
func (l *library) callFlashcards(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, l.flashcards.url+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := flashcardsClient.Do(req)
	if err != nil {
		return errors.New("o Flashcards não respondeu")
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 300 {
		var e struct {
			Erro string `json:"erro"`
		}
		if json.Unmarshal(data, &e) == nil && e.Erro != "" {
			return errors.New(e.Erro)
		}
		return fmt.Errorf("o Flashcards respondeu %d", resp.StatusCode)
	}
	return json.Unmarshal(data, out)
}
