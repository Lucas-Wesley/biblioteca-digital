package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
)

// Dados de livros físicos para os planos de leitura (R35). Não existe um "TMDB dos livros";
// juntamos três fontes abertas, uma completando a outra:
//   - BrasilAPI ISBN: só por ISBN, mas é a melhor para edições brasileiras (CBL, Mercado Editorial…);
//   - Open Library: por ISBN e por título, sem chave;
//   - Google Books: o maior acervo; sem chave a cota é dividida com o mundo e acaba cedo, então
//     GOOGLE_BOOKS_KEY (grátis, 1.000 consultas por dia) é recomendada.
// Nenhuma traz a lista de capítulos: no livro físico o Lucas informa quantos são.

var (
	brasilAPIBase   = "https://brasilapi.com.br"
	openLibraryBase = "https://openlibrary.org"
	googleBooksBase = "https://www.googleapis.com"
	googleBooksKey  = os.Getenv("GOOGLE_BOOKS_KEY")
	catalogClient   = &http.Client{Timeout: 8 * time.Second}
	coverClient     = safeClient(10 * time.Second)
)

const maxCatalogResults = 12

type bookInfo struct {
	Title     string `json:"title"`
	Author    string `json:"author"`
	Publisher string `json:"publisher"`
	Year      string `json:"year"`
	Pages     int    `json:"pages"`
	ISBN      string `json:"isbn"`
	CoverURL  string `json:"cover_url"`
	Source    string `json:"source"` // de onde veio (a primeira fonte que achou)
}

// fill completa os campos vazios com os de outra fonte.
func (b *bookInfo) fill(o bookInfo) {
	pick := func(dst *string, v string) {
		if *dst == "" {
			*dst = v
		}
	}
	pick(&b.Title, o.Title)
	pick(&b.Author, o.Author)
	pick(&b.Publisher, o.Publisher)
	pick(&b.Year, o.Year)
	pick(&b.ISBN, o.ISBN)
	pick(&b.CoverURL, o.CoverURL)
	pick(&b.Source, o.Source)
	if b.Pages == 0 {
		b.Pages = o.Pages
	}
}

func (b bookInfo) complete() bool {
	return b.Title != "" && b.Author != "" && b.Pages > 0 && b.CoverURL != ""
}

// normalISBN tira hífens e espaços; devolve "" se não parece um ISBN.
func normalISBN(s string) string {
	var out []byte
	for _, r := range strings.ToUpper(s) {
		switch {
		case r >= '0' && r <= '9', r == 'X':
			out = append(out, byte(r))
		case r == '-' || r == ' ' || r == '.':
		default:
			return ""
		}
	}
	if len(out) != 10 && len(out) != 13 {
		return ""
	}
	if strings.IndexByte(string(out), 'X') >= 0 && (len(out) != 10 || strings.IndexByte(string(out), 'X') != 9) {
		return ""
	}
	return string(out)
}

// handleCatalog: GET /api/catalogo?q= (título, autor ou ISBN) ou ?isbn=.
func (lib *library) handleCatalog(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	isbn := normalISBN(r.URL.Query().Get("isbn"))
	if isbn == "" {
		isbn = normalISBN(q)
	}
	if isbn == "" && len([]rune(q)) < 2 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "digite o título, o autor ou o ISBN"})
		return
	}
	var list []bookInfo
	var err error
	if isbn != "" {
		list, err = lookupISBN(r.Context(), isbn)
	} else {
		list, err = searchTitle(r.Context(), q)
	}
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "as fontes de livros não responderam; tente de novo ou preencha à mão"})
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// lookupISBN tenta uma fonte, depois a outra, completando o que faltou. Só dá erro se nenhuma respondeu.
func lookupISBN(ctx context.Context, isbn string) ([]bookInfo, error) {
	var found bookInfo
	failures := 0
	sources := []func(context.Context, string) (bookInfo, error){brasilAPIISBN, openLibraryISBN, googleBooksISBN}
	for _, source := range sources {
		b, err := source(ctx, isbn)
		if err != nil {
			failures++
			continue
		}
		found.fill(b)
		if found.complete() {
			break
		}
	}
	if found.Title == "" {
		if failures == len(sources) {
			return nil, errors.New("nenhuma fonte respondeu")
		}
		return []bookInfo{}, nil
	}
	if found.ISBN == "" {
		found.ISBN = isbn
	}
	return []bookInfo{found}, nil
}

// searchTitle pergunta à Open Library e ao Google Books ao mesmo tempo e junta as respostas,
// sem repetir a mesma edição.
func searchTitle(ctx context.Context, q string) ([]bookInfo, error) {
	var ol, gb []bookInfo
	var olErr, gbErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); ol, olErr = openLibrarySearch(ctx, q) }()
	go func() { defer wg.Done(); gb, gbErr = googleBooksSearch(ctx, q) }()
	wg.Wait()
	if olErr != nil && gbErr != nil {
		return nil, errors.Join(olErr, gbErr)
	}
	list := []bookInfo{}
	seen := map[string]bool{}
	words := searchWords(q)
	for _, b := range append(ol, gb...) {
		if !matchesAll(b, words) {
			continue
		}
		key := b.ISBN
		if key == "" {
			key = strings.ToLower(b.Title + "|" + b.Author + "|" + b.Publisher)
		}
		if b.Title == "" || seen[key] {
			continue
		}
		seen[key] = true
		list = append(list, b)
		if len(list) == maxCatalogResults {
			break
		}
	}
	return list, nil
}

// getJSON: 404 é "não achou" (sem erro, alvo zerado); outros códigos são falha da fonte.
func getJSON(ctx context.Context, rawURL string, target any) (found bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("User-Agent", "biblioteca-digital (homelab pessoal)")
	resp, err := catalogClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("%s respondeu %d", req.URL.Host, resp.StatusCode)
	}
	return true, json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(target)
}

func brasilAPIISBN(ctx context.Context, isbn string) (bookInfo, error) {
	var d struct {
		Title     string   `json:"title"`
		Subtitle  string   `json:"subtitle"`
		Authors   []string `json:"authors"`
		Publisher string   `json:"publisher"`
		Year      int      `json:"year"`
		PageCount int      `json:"page_count"`
		CoverURL  string   `json:"cover_url"`
		ISBN      string   `json:"isbn"`
	}
	found, err := getJSON(ctx, brasilAPIBase+"/api/isbn/v1/"+isbn, &d)
	if err != nil || !found {
		return bookInfo{}, err
	}
	b := bookInfo{Title: joinTitle(d.Title, d.Subtitle), Author: strings.Join(d.Authors, ", "), Publisher: d.Publisher,
		Pages: d.PageCount, ISBN: d.ISBN, CoverURL: d.CoverURL, Source: "BrasilAPI"}
	if d.Year > 0 {
		b.Year = strconv.Itoa(d.Year)
	}
	return b, nil
}

func openLibraryISBN(ctx context.Context, isbn string) (bookInfo, error) {
	var d map[string]struct {
		Title    string `json:"title"`
		Subtitle string `json:"subtitle"`
		Authors  []struct {
			Name string `json:"name"`
		} `json:"authors"`
		Publishers []struct {
			Name string `json:"name"`
		} `json:"publishers"`
		PublishDate   string `json:"publish_date"`
		NumberOfPages int    `json:"number_of_pages"`
		Cover         struct {
			Large string `json:"large"`
		} `json:"cover"`
	}
	_, err := getJSON(ctx, openLibraryBase+"/api/books?format=json&jscmd=data&bibkeys=ISBN:"+isbn, &d)
	if err != nil {
		return bookInfo{}, err
	}
	e, ok := d["ISBN:"+isbn]
	if !ok {
		return bookInfo{}, nil
	}
	b := bookInfo{Title: joinTitle(e.Title, e.Subtitle), Pages: e.NumberOfPages, ISBN: isbn, CoverURL: e.Cover.Large,
		Year: lastYear(e.PublishDate), Source: "Open Library"}
	var names []string
	for _, a := range e.Authors {
		names = append(names, a.Name)
	}
	b.Author = strings.Join(names, ", ")
	if len(e.Publishers) > 0 {
		b.Publisher = e.Publishers[0].Name
	}
	return b, nil
}

func openLibrarySearch(ctx context.Context, q string) ([]bookInfo, error) {
	var d struct {
		Docs []struct {
			Title     string   `json:"title"`
			Subtitle  string   `json:"subtitle"`
			Authors   []string `json:"author_name"`
			Publisher []string `json:"publisher"`
			Year      int      `json:"first_publish_year"`
			Pages     int      `json:"number_of_pages_median"`
			ISBN      []string `json:"isbn"`
			CoverID   int      `json:"cover_i"`
		} `json:"docs"`
	}
	u := openLibraryBase + "/search.json?limit=10&fields=title,subtitle,author_name,publisher,first_publish_year,number_of_pages_median,isbn,cover_i&q=" +
		url.QueryEscape(q)
	if _, err := getJSON(ctx, u, &d); err != nil {
		return nil, err
	}
	list := []bookInfo{}
	for _, doc := range d.Docs {
		b := bookInfo{Title: joinTitle(doc.Title, doc.Subtitle), Author: strings.Join(doc.Authors, ", "), Pages: doc.Pages,
			ISBN: brazilianFirst(doc.ISBN), Source: "Open Library"}
		if len(doc.Publisher) > 0 {
			b.Publisher = doc.Publisher[0]
		}
		if doc.Year > 0 {
			b.Year = strconv.Itoa(doc.Year)
		}
		if doc.CoverID > 0 {
			b.CoverURL = fmt.Sprintf("https://covers.openlibrary.org/b/id/%d-L.jpg", doc.CoverID)
		}
		list = append(list, b)
	}
	return list, nil
}

type googleVolume struct {
	VolumeInfo struct {
		Title               string   `json:"title"`
		Subtitle            string   `json:"subtitle"`
		Authors             []string `json:"authors"`
		Publisher           string   `json:"publisher"`
		PublishedDate       string   `json:"publishedDate"`
		PageCount           int      `json:"pageCount"`
		IndustryIdentifiers []struct {
			Type       string `json:"type"`
			Identifier string `json:"identifier"`
		} `json:"industryIdentifiers"`
		ImageLinks struct {
			Thumbnail string `json:"thumbnail"`
		} `json:"imageLinks"`
	} `json:"volumeInfo"`
}

func (v googleVolume) info() bookInfo {
	i := v.VolumeInfo
	b := bookInfo{Title: joinTitle(i.Title, i.Subtitle), Author: strings.Join(i.Authors, ", "), Publisher: i.Publisher,
		Pages: i.PageCount, Year: lastYear(i.PublishedDate), Source: "Google Books"}
	for _, id := range i.IndustryIdentifiers {
		if id.Type == "ISBN_13" || (id.Type == "ISBN_10" && b.ISBN == "") {
			b.ISBN = id.Identifier
		}
	}
	if t := i.ImageLinks.Thumbnail; t != "" {
		b.CoverURL = strings.Replace(t, "http://", "https://", 1)
	}
	return b
}

func googleBooks(ctx context.Context, q string) ([]googleVolume, error) {
	u := googleBooksBase + "/books/v1/volumes?maxResults=10&q=" + url.QueryEscape(q)
	if googleBooksKey != "" {
		u += "&key=" + url.QueryEscape(googleBooksKey)
	}
	var d struct {
		Items []googleVolume `json:"items"`
	}
	_, err := getJSON(ctx, u, &d)
	return d.Items, err
}

func googleBooksISBN(ctx context.Context, isbn string) (bookInfo, error) {
	items, err := googleBooks(ctx, "isbn:"+isbn)
	if err != nil || len(items) == 0 {
		return bookInfo{}, err
	}
	return items[0].info(), nil
}

func googleBooksSearch(ctx context.Context, q string) ([]bookInfo, error) {
	items, err := googleBooks(ctx, q)
	if err != nil {
		return nil, err
	}
	list := make([]bookInfo, 0, len(items))
	for _, v := range items {
		list = append(list, v.info())
	}
	return list, nil
}

func joinTitle(title, subtitle string) string {
	title, subtitle = strings.TrimSpace(title), strings.TrimSpace(subtitle)
	if subtitle == "" {
		return title
	}
	return title + ": " + subtitle
}

// lastYear acha o ano numa data como "Dec 02, 2019" ou "2019-12-02".
func lastYear(date string) string {
	for _, f := range strings.FieldsFunc(date, func(r rune) bool { return r < '0' || r > '9' }) {
		if len(f) == 4 {
			return f
		}
	}
	return ""
}

// brazilianFirst prefere um ISBN de editora brasileira (978-85, 978-65): a busca devolve o de
// todas as edições, e a do Lucas quase sempre é a nacional.
func brazilianFirst(list []string) string {
	for _, i := range list {
		if strings.HasPrefix(i, "97885") || strings.HasPrefix(i, "97865") {
			return i
		}
	}
	for _, i := range list {
		if len(i) == 13 {
			return i
		}
	}
	if len(list) > 0 {
		return list[0]
	}
	return ""
}

// safeClient só conecta em endereços públicos: a capa vem de um endereço que o app recebeu, e
// não pode servir para alcançar a rede de casa.
func safeClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		ip := net.ParseIP(host)
		if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast() {
			return errors.New("endereço não permitido")
		}
		return nil
	}}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = dialer.DialContext
	transport.Proxy = nil
	return &http.Client{Timeout: timeout, Transport: transport}
}

func fetchCover(ctx context.Context, rawURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "biblioteca-digital (homelab pessoal)")
	resp, err := coverClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("capa: %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxCoverBytes+1))
	if err != nil {
		return nil, "", err
	}
	coverType := http.DetectContentType(data)
	// A Open Library devolve um GIF de 1 pixel quando não tem a capa.
	if len(data) > maxCoverBytes || len(data) < 1000 || !slices.Contains(coverTypes, coverType) {
		return nil, "", errors.New("capa inválida")
	}
	return data, coverType, nil
}

var accents = strings.NewReplacer(
	"á", "a", "à", "a", "â", "a", "ã", "a", "ä", "a", "é", "e", "è", "e", "ê", "e", "ë", "e",
	"í", "i", "ì", "i", "î", "i", "ï", "i", "ó", "o", "ò", "o", "ô", "o", "õ", "o", "ö", "o",
	"ú", "u", "ù", "u", "û", "u", "ü", "u", "ç", "c", "ñ", "n",
)

func fold(s string) string {
	return accents.Replace(strings.ToLower(s))
}

// searchWords: as palavras que importam na busca (3 letras ou mais, sem acento): "na", "de" e
// "o" não ajudam a achar o livro.
func searchWords(q string) []string {
	var words []string
	for _, w := range strings.FieldsFunc(fold(q), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if len([]rune(w)) >= 3 {
			words = append(words, w)
		}
	}
	return words
}

// matchesAll: as fontes devolvem também o que só se parece com a busca (a Open Library procura até
// no texto dos livros); fica só o que tem todas as palavras no título ou no autor.
func matchesAll(b bookInfo, words []string) bool {
	text := fold(b.Title + " " + b.Author)
	for _, w := range words {
		if !strings.Contains(text, w) {
			return false
		}
	}
	return true
}
