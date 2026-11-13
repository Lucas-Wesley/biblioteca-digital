package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Planos de leitura (R35): metas por dia para ler um livro, físico ou da biblioteca. O Lucas
// escolhe a unidade (capítulos ou páginas), quanto por dia e em quais dias da semana; o servidor
// monta o cronograma até o fim do livro, e cada meta é marcada à mão como lida ou não lida.

const (
	unitChapters    = "capitulos"
	unitPages       = "paginas"
	stateRead       = "lida"
	stateNotRead    = "nao-lida"
	maxPlanBytes    = 2 << 20
	maxPlanUnits    = 100_000
	maxPlanChapters = 2_000
	maxPlanText     = 300
	allWeekdays     = "0123456"
)

type planChapter struct {
	Title     string `json:"title"`
	FirstPage int    `json:"first_page,omitempty"`
	LastPage  int    `json:"last_page,omitempty"`
	Anchor    string `json:"anchor,omitempty"` // livro digital: onde o capítulo começa
}

// goal é a meta de um dia: do capítulo (ou página) From até o To, inclusive.
type goal struct {
	ID    int64  `json:"id"`
	Day   string `json:"day"`
	From  int    `json:"from"`
	To    int    `json:"to"`
	State string `json:"state"` // "" (a fazer), "lida" ou "nao-lida"
}

type plan struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	Author    string        `json:"author"`
	Publisher string        `json:"publisher"`
	ISBN      string        `json:"isbn"`
	BookID    string        `json:"book_id"` // livro da biblioteca, quando é digital
	HasCover  bool          `json:"has_cover"`
	Unit      string        `json:"unit"`
	Total     int           `json:"total"`
	First     int           `json:"first"` // de onde o plano começa (quem já leu uma parte)
	PerDay    int           `json:"per_day"`
	Weekdays  string        `json:"weekdays"` // 0 = domingo
	StartDay  string        `json:"start_day"`
	Chapters  []planChapter `json:"chapters"`
	Percent   float64       `json:"percent"` // até onde o leitor chegou, no livro digital
	Goals     []goal        `json:"goals"`
	CreatedAt string        `json:"created_at"`
}

// planInput é o que o app manda ao criar ou ajustar. today é o dia no aparelho (Brasília).
type planInput struct {
	Title     string        `json:"title"`
	Author    string        `json:"author"`
	Publisher string        `json:"publisher"`
	ISBN      string        `json:"isbn"`
	BookID    string        `json:"book_id"`
	CoverURL  string        `json:"cover_url"`
	Unit      string        `json:"unit"`
	Total     int           `json:"total"`
	First     int           `json:"first"`
	PerDay    int           `json:"per_day"`
	Weekdays  string        `json:"weekdays"`
	StartDay  string        `json:"start_day"`
	Chapters  []planChapter `json:"chapters"`
	Today     string        `json:"today"`
}

func (in *planInput) clean() string {
	in.Title = cleanText(in.Title)
	in.Author = cleanText(in.Author)
	in.Publisher = cleanText(in.Publisher)
	in.ISBN = normalISBN(in.ISBN)
	in.CoverURL = strings.TrimSpace(in.CoverURL)
	if in.First == 0 {
		in.First = 1
	}
	if in.Weekdays == "" {
		in.Weekdays = allWeekdays
	}
	if in.Chapters == nil {
		in.Chapters = []planChapter{}
	}
	for i := range in.Chapters {
		in.Chapters[i].Title = cleanText(in.Chapters[i].Title)
	}
	switch {
	case in.Title == "":
		return "informe o título do livro"
	case utf8.RuneCountInString(in.Title) > maxPlanText || utf8.RuneCountInString(in.Author) > maxPlanText ||
		utf8.RuneCountInString(in.Publisher) > maxPlanText:
		return "texto longo demais"
	case in.Unit != unitChapters && in.Unit != unitPages:
		return "escolha capítulos ou páginas"
	case in.Total < 1 || in.Total > maxPlanUnits:
		return "informe quantos capítulos ou páginas o livro tem"
	case in.First < 1 || in.First > in.Total:
		return "o começo precisa estar dentro do livro"
	case in.PerDay < 1 || in.PerDay > in.Total:
		return "a meta por dia precisa ser de pelo menos 1 e no máximo o livro inteiro"
	case !validWeekdays(in.Weekdays):
		return "escolha ao menos um dia da semana"
	case !validDay(in.StartDay) || !validDay(in.Today):
		return "data inválida"
	case len(in.Chapters) > maxPlanChapters:
		return "capítulos demais"
	case in.Unit == unitChapters && len(in.Chapters) > 0 && len(in.Chapters) != in.Total:
		return "a lista de capítulos não bate com o total"
	case in.CoverURL != "" && !strings.HasPrefix(in.CoverURL, "https://") && !strings.HasPrefix(in.CoverURL, "http://"):
		return "endereço de capa inválido"
	}
	return ""
}

// validWeekdays: dígitos de 0 a 6, sem repetir, ao menos um.
func validWeekdays(s string) bool {
	if s == "" || len(s) > 7 {
		return false
	}
	seen := map[rune]bool{}
	for _, r := range s {
		if r < '0' || r > '6' || seen[r] {
			return false
		}
		seen[r] = true
	}
	return true
}

func dayAfter(day string, n int) string {
	t, _ := time.Parse(time.DateOnly, day)
	return t.AddDate(0, 0, n).Format(time.DateOnly)
}

func weekdayOf(day string) byte {
	t, _ := time.Parse(time.DateOnly, day)
	return byte('0' + int(t.Weekday()))
}

// schedule distribui as unidades que faltam pelos dias permitidos, a partir de start. Um dia
// leva perDay unidades; se houver um buraco (uma parte já lida no meio), a meta do dia se divide.
func schedule(units []int, perDay int, weekdays, start string) []goal {
	var goals []goal
	day := start
	for i := 0; i < len(units); i += perDay {
		for !strings.ContainsRune(weekdays, rune(weekdayOf(day))) {
			day = dayAfter(day, 1)
		}
		chunk := units[i:min(i+perDay, len(units))]
		g := goal{Day: day, From: chunk[0], To: chunk[0]}
		for _, u := range chunk[1:] {
			if u == g.To+1 {
				g.To = u
				continue
			}
			goals = append(goals, g)
			g = goal{Day: day, From: u, To: u}
		}
		goals = append(goals, g)
		day = dayAfter(day, 1)
	}
	return goals
}

func newPlanID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (l *library) planCoverPath(id string) string {
	return filepath.Join(l.coversDir, "planos", id)
}

func (lib *library) decodePlan(w http.ResponseWriter, r *http.Request) (planInput, bool) {
	var in planInput
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxPlanBytes)).Decode(&in)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "plano inválido"})
		return in, false
	}
	if msg := in.clean(); msg != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
		return in, false
	}
	if in.BookID != "" && !lib.bookExists(r.Context(), in.BookID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "o livro da biblioteca não existe mais"})
		return in, false
	}
	return in, true
}

func (lib *library) handleCreatePlan(w http.ResponseWriter, r *http.Request) {
	in, ok := lib.decodePlan(w, r)
	if !ok {
		return
	}
	id := newPlanID()
	coverType := lib.savePlanCover(r.Context(), id, in.CoverURL)
	chapters, _ := json.Marshal(in.Chapters)
	tx, err := lib.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao criar o plano"})
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(),
		`INSERT INTO plans (id, title, author, publisher, isbn, book_id, cover_type, unit, total, first, per_day, weekdays, start_day, chapters, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.Title, in.Author, in.Publisher, in.ISBN, in.BookID, coverType, in.Unit, in.Total, in.First, in.PerDay,
		in.Weekdays, in.StartDay, string(chapters), now(), now())
	if err == nil {
		err = rebuildGoals(r.Context(), tx, id, in, in.StartDay)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		os.Remove(lib.planCoverPath(id))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao criar o plano"})
		return
	}
	lib.writePlan(w, r, id, http.StatusCreated)
}

// handleUpdatePlan ajusta o plano. Mudou o ritmo, a unidade ou o tamanho: o cronograma é refeito
// a partir de hoje (ou da nova data de início), guardando o que já foi lido.
func (lib *library) handleUpdatePlan(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	in, ok := lib.decodePlan(w, r)
	if !ok {
		return
	}
	var old planInput
	var coverType string
	err := lib.db.QueryRowContext(r.Context(),
		`SELECT unit, total, first, per_day, weekdays, start_day, cover_type FROM plans WHERE id = ?`, id).
		Scan(&old.Unit, &old.Total, &old.First, &old.PerDay, &old.Weekdays, &old.StartDay, &coverType)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "plano não encontrado"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ajustar o plano"})
		return
	}
	if in.CoverURL != "" {
		if t := lib.savePlanCover(r.Context(), id, in.CoverURL); t != "" {
			coverType = t
		}
	}
	chapters, _ := json.Marshal(in.Chapters)
	tx, err := lib.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ajustar o plano"})
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(),
		`UPDATE plans SET title = ?, author = ?, publisher = ?, isbn = ?, book_id = ?, cover_type = ?, unit = ?, total = ?,
			first = ?, per_day = ?, weekdays = ?, start_day = ?, chapters = ?, updated_at = ? WHERE id = ?`,
		in.Title, in.Author, in.Publisher, in.ISBN, in.BookID, coverType, in.Unit, in.Total, in.First, in.PerDay,
		in.Weekdays, in.StartDay, string(chapters), now(), id)
	if err == nil && in.Unit != old.Unit {
		// Capítulos lidos não viram páginas lidas: com outra unidade, o plano recomeça do início escolhido.
		_, err = tx.ExecContext(r.Context(), `DELETE FROM plan_goals WHERE plan_id = ?`, id)
	}
	changed := in.Unit != old.Unit || in.Total != old.Total || in.First != old.First || in.PerDay != old.PerDay ||
		in.Weekdays != old.Weekdays || in.StartDay != old.StartDay
	if err == nil && changed {
		start := in.StartDay
		if start == old.StartDay && start < in.Today {
			start = in.Today
		}
		err = rebuildGoals(r.Context(), tx, id, in, start)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ajustar o plano"})
		return
	}
	lib.writePlan(w, r, id, http.StatusOK)
}

// handleReplan leva o que não foi lido para hoje em diante, no mesmo ritmo.
func (lib *library) handleReplan(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Today string `json:"today"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body) != nil || !validDay(body.Today) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "data inválida"})
		return
	}
	in, err := lib.planSettings(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "plano não encontrado"})
		return
	}
	tx, err2 := lib.db.BeginTx(r.Context(), nil)
	if err == nil {
		err = err2
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao refazer o cronograma"})
		return
	}
	defer tx.Rollback()
	err = rebuildGoals(r.Context(), tx, id, in, max(in.StartDay, body.Today))
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao refazer o cronograma"})
		return
	}
	lib.writePlan(w, r, id, http.StatusOK)
}

func (lib *library) planSettings(ctx context.Context, id string) (planInput, error) {
	var in planInput
	err := lib.db.QueryRowContext(ctx, `SELECT unit, total, first, per_day, weekdays, start_day FROM plans WHERE id = ?`, id).
		Scan(&in.Unit, &in.Total, &in.First, &in.PerDay, &in.Weekdays, &in.StartDay)
	return in, err
}

// rebuildGoals guarda as metas lidas e refaz as outras a partir de start com o que falta ler.
// Se já há meta lida no dia de começar, o cronograma novo começa no dia seguinte.
func rebuildGoals(ctx context.Context, tx *sql.Tx, id string, in planInput, start string) error {
	rows, err := tx.QueryContext(ctx, `SELECT day, "from", "to" FROM plan_goals WHERE plan_id = ? AND state = ?`, id, stateRead)
	if err != nil {
		return err
	}
	read := map[int]bool{}
	lastRead := ""
	for rows.Next() {
		var day string
		var from, to int
		if err := rows.Scan(&day, &from, &to); err != nil {
			rows.Close()
			return err
		}
		for u := from; u <= to; u++ {
			read[u] = true
		}
		lastRead = max(lastRead, day)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if lastRead == start {
		start = dayAfter(start, 1)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM plan_goals WHERE plan_id = ? AND state != ?`, id, stateRead); err != nil {
		return err
	}
	var units []int
	for u := in.First; u <= in.Total; u++ {
		if !read[u] {
			units = append(units, u)
		}
	}
	for _, g := range schedule(units, in.PerDay, in.Weekdays, start) {
		if _, err := tx.ExecContext(ctx, `INSERT INTO plan_goals (plan_id, day, "from", "to", state) VALUES (?, ?, ?, ?, '')`,
			id, g.Day, g.From, g.To); err != nil {
			return err
		}
	}
	return nil
}

func (lib *library) handleMarkGoal(w http.ResponseWriter, r *http.Request) {
	var body struct {
		State string `json:"state"`
	}
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body)
	if err != nil || !slices.Contains([]string{"", stateRead, stateNotRead}, body.State) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "estado inválido"})
		return
	}
	res, err := lib.db.ExecContext(r.Context(), `UPDATE plan_goals SET state = ? WHERE id = ? AND plan_id = ?`,
		body.State, r.PathValue("goal"), r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao marcar a meta"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "meta não encontrada"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (lib *library) handleDeletePlan(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tx, err := lib.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao apagar o plano"})
		return
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(r.Context(), `DELETE FROM plans WHERE id = ?`, id)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `DELETE FROM plan_goals WHERE plan_id = ?`, id)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao apagar o plano"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "plano não encontrado"})
		return
	}
	os.Remove(lib.planCoverPath(id))
	w.WriteHeader(http.StatusNoContent)
}

func (lib *library) handleListPlans(w http.ResponseWriter, r *http.Request) {
	list, err := lib.plans(r.Context(), "")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao listar os planos"})
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (lib *library) writePlan(w http.ResponseWriter, r *http.Request, id string, status int) {
	list, err := lib.plans(r.Context(), id)
	if err != nil || len(list) == 0 {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler o plano"})
		return
	}
	writeJSON(w, status, list[0])
}

// plans lê os planos (todos, ou só o do id) com as metas e o progresso do leitor.
func (lib *library) plans(ctx context.Context, id string) ([]plan, error) {
	rows, err := lib.db.QueryContext(ctx,
		`SELECT p.id, p.title, p.author, p.publisher, p.isbn, p.book_id, p.cover_type != '', p.unit, p.total, p.first,
			p.per_day, p.weekdays, p.start_day, p.chapters, COALESCE(pr.percent, 0), p.created_at
		 FROM plans p LEFT JOIN progress pr ON pr.book_id = p.book_id AND p.book_id != ''
		 WHERE ? = '' OR p.id = ? ORDER BY p.created_at`, id, id)
	if err != nil {
		return nil, err
	}
	list := []plan{}
	index := map[string]int{}
	for rows.Next() {
		var p plan
		var chapters string
		if err := rows.Scan(&p.ID, &p.Title, &p.Author, &p.Publisher, &p.ISBN, &p.BookID, &p.HasCover, &p.Unit, &p.Total,
			&p.First, &p.PerDay, &p.Weekdays, &p.StartDay, &chapters, &p.Percent, &p.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		p.Chapters = []planChapter{}
		json.Unmarshal([]byte(chapters), &p.Chapters)
		p.Goals = []goal{}
		index[p.ID] = len(list)
		list = append(list, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = lib.db.QueryContext(ctx,
		`SELECT id, plan_id, day, "from", "to", state FROM plan_goals WHERE ? = '' OR plan_id = ? ORDER BY day, "from"`, id, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var g goal
		var planID string
		if err := rows.Scan(&g.ID, &planID, &g.Day, &g.From, &g.To, &g.State); err != nil {
			return nil, err
		}
		if i, ok := index[planID]; ok {
			list[i].Goals = append(list[i].Goals, g)
		}
	}
	return list, rows.Err()
}

func (lib *library) handlePlanCover(w http.ResponseWriter, r *http.Request) {
	var id, coverType string
	err := lib.db.QueryRowContext(r.Context(), `SELECT id, cover_type FROM plans WHERE id = ? AND cover_type != ''`,
		r.PathValue("id")).Scan(&id, &coverType)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "capa não encontrada"})
		return
	}
	f, err := os.Open(lib.planCoverPath(id))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "capa não encontrada"})
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "capa não encontrada"})
		return
	}
	w.Header().Set("Content-Type", coverType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, id, info.ModTime(), f)
}

// savePlanCover baixa a capa achada na busca e a guarda aqui, para abrir sem internet. Sem
// capa (ou com falha), o plano entra assim mesmo e devolve "".
func (lib *library) savePlanCover(ctx context.Context, id, url string) string {
	if url == "" {
		return ""
	}
	data, coverType, err := fetchCover(ctx, url)
	if err != nil {
		return ""
	}
	if os.MkdirAll(filepath.Dir(lib.planCoverPath(id)), 0o755) != nil || os.WriteFile(lib.planCoverPath(id), data, 0o644) != nil {
		return ""
	}
	return coverType
}
