package main

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
)

const (
	positionListType = "application/vnd.readium.position-list+json"
	// Uma posição a cada 1024 bytes, a mesma regra dos outros apps do Readium.
	bytesPerPosition = 1024
)

// As imagens do Go para Alpine não têm tabela de tipos do sistema, e nela nem sempre há .xhtml.
var resourceTypes = map[string]string{
	".css":   "text/css",
	".gif":   "image/gif",
	".html":  "text/html",
	".jpeg":  "image/jpeg",
	".jpg":   "image/jpeg",
	".js":    "text/javascript",
	".mp3":   "audio/mpeg",
	".mp4":   "video/mp4",
	".ncx":   "application/x-dtbncx+xml",
	".otf":   "font/otf",
	".png":   "image/png",
	".smil":  "application/smil+xml",
	".svg":   "image/svg+xml",
	".ttf":   "font/ttf",
	".webp":  "image/webp",
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".xhtml": "application/xhtml+xml",
	".xml":   "application/xml",
}

type pubLink struct {
	Href     string    `json:"href"`
	Type     string    `json:"type,omitempty"`
	Title    string    `json:"title,omitempty"`
	Rel      string    `json:"rel,omitempty"`
	Children []pubLink `json:"children,omitempty"`
}

type pubMetadata struct {
	ConformsTo         string   `json:"conformsTo"`
	Title              string   `json:"title"`
	Author             []string `json:"author,omitempty"`
	Language           []string `json:"language,omitempty"`
	Layout             string   `json:"layout,omitempty"`
	ReadingProgression string   `json:"readingProgression,omitempty"`
}

type pubManifest struct {
	Context      string      `json:"@context"`
	Metadata     pubMetadata `json:"metadata"`
	Links        []pubLink   `json:"links"`
	ReadingOrder []pubLink   `json:"readingOrder"`
	Resources    []pubLink   `json:"resources"`
	Toc          []pubLink   `json:"toc"`
}

type pubLocations struct {
	Position         int     `json:"position"`
	Progression      float64 `json:"progression"`
	TotalProgression float64 `json:"totalProgression"`
}

type pubPosition struct {
	Href      string       `json:"href"`
	Type      string       `json:"type"`
	Locations pubLocations `json:"locations"`
}

type pubPositions struct {
	Total     int           `json:"total"`
	Positions []pubPosition `json:"positions"`
}

type navPoint struct {
	Label    string     `xml:"navLabel>text"`
	Content  navContent `xml:"content"`
	Children []navPoint `xml:"navPoint"`
}

type navContent struct {
	Src string `xml:"src,attr"`
}

// escapeHref devolve o caminho no formato de URL, como o navegador vai pedi-lo.
func escapeHref(name string) string {
	return (&url.URL{Path: name}).EscapedPath()
}

// resolveHref junta um href do livro à pasta do arquivo que o citou. Mantém o #trecho.
func resolveHref(dir, href string) string {
	file, fragment, hasFragment := strings.Cut(href, "#")
	if unescaped, err := url.PathUnescape(file); err == nil {
		file = unescaped
	}
	resolved := escapeHref(path.Join(dir, file))
	if hasFragment {
		resolved += "#" + fragment
	}
	return resolved
}

func typeOfEntry(name string, declared map[string]string) string {
	if t := declared[name]; t != "" {
		return t
	}
	if t := resourceTypes[strings.ToLower(path.Ext(name))]; t != "" {
		return t
	}
	return "application/octet-stream"
}

// readOpf devolve o OPF e o caminho dele dentro do ZIP.
func readOpf(zr *zip.Reader) (opfPackage, string, error) {
	var container epubContainer
	if err := readZipXML(zr, "META-INF/container.xml", &container); err != nil || len(container.Rootfiles) == 0 {
		return opfPackage{}, "", errInvalidBook
	}
	opfPath := path.Clean(container.Rootfiles[0].FullPath)
	var opf opfPackage
	if err := readZipXML(zr, opfPath, &opf); err != nil {
		return opfPackage{}, "", errInvalidBook
	}
	return opf, opfPath, nil
}

func declaredTypes(opf opfPackage, dir string) map[string]string {
	types := map[string]string{}
	for _, item := range opf.Items {
		types[entryName(dir, item.Href)] = item.MediaType
	}
	return types
}

func entryName(dir, href string) string {
	file, _, _ := strings.Cut(href, "#")
	if unescaped, err := url.PathUnescape(file); err == nil {
		file = unescaped
	}
	return path.Join(dir, file)
}

// buildPublication transforma o EPUB no manifesto que o Readium lê. Os recursos vêm do ZIP,
// e não do OPF: há livros que usam arquivos não declarados, e o offline precisa de todos.
func buildPublication(zr *zip.Reader) (pubManifest, pubPositions, error) {
	opf, opfPath, err := readOpf(zr)
	if err != nil {
		return pubManifest{}, pubPositions{}, err
	}
	dir := path.Dir(opfPath)
	types := declaredTypes(opf, dir)
	items := map[string]opfItem{}
	for _, item := range opf.Items {
		items[item.ID] = item
	}

	sizes := map[string]int{}
	for _, f := range zr.File {
		sizes[f.Name] = int(f.UncompressedSize64)
	}

	inSpine := map[string]bool{}
	readingOrder := []pubLink{}
	total := 0
	for _, ref := range opf.Spine.Items {
		item, ok := items[ref.IDRef]
		if !ok {
			continue
		}
		name := entryName(dir, item.Href)
		if _, exists := sizes[name]; !exists {
			continue
		}
		inSpine[name] = true
		readingOrder = append(readingOrder, pubLink{Href: escapeHref(name), Type: typeOfEntry(name, types)})
		total += sizes[name]
	}

	coverName := ""
	if href := opf.coverHref(); href != "" {
		coverName = entryName(dir, href)
	}
	resources := []pubLink{}
	for _, f := range zr.File {
		if inSpine[f.Name] || f.Name == "mimetype" || strings.HasSuffix(f.Name, "/") || strings.HasPrefix(f.Name, "META-INF/") {
			continue
		}
		link := pubLink{Href: escapeHref(f.Name), Type: typeOfEntry(f.Name, types)}
		if f.Name == coverName {
			link.Rel = "cover"
		}
		resources = append(resources, link)
	}

	fixed := opf.fixedLayout()
	positions := []pubPosition{}
	passed := 0
	for _, link := range readingOrder {
		name, _ := url.PathUnescape(link.Href)
		size := sizes[name]
		count := size/bytesPerPosition + 1
		if fixed {
			count = 1
		}
		for i := range count {
			progression := float64(i) / float64(count)
			totalProgression := 0.0
			if total > 0 {
				totalProgression = (float64(passed) + progression*float64(size)) / float64(total)
			}
			positions = append(positions, pubPosition{Href: link.Href, Type: link.Type, Locations: pubLocations{
				Position:         len(positions) + 1,
				Progression:      progression,
				TotalProgression: totalProgression,
			}})
		}
		passed += size
	}

	metadata := pubMetadata{
		ConformsTo: "https://readium.org/webpub-manifest/profiles/epub",
		Language:   opf.Languages,
	}
	if len(opf.Titles) > 0 {
		metadata.Title = cleanText(opf.Titles[0])
	}
	if metadata.Title == "" {
		metadata.Title = "Sem título"
	}
	for _, creator := range opf.Creators {
		if name := cleanText(creator); name != "" {
			metadata.Author = append(metadata.Author, name)
		}
	}
	if fixed {
		metadata.Layout = "fixed"
	}
	if opf.Spine.Direction == "rtl" || opf.Spine.Direction == "ltr" {
		metadata.ReadingProgression = opf.Spine.Direction
	}

	manifest := pubManifest{
		Context:  "https://readium.org/webpub-manifest/context.jsonld",
		Metadata: metadata,
		Links: []pubLink{
			{Rel: "self", Href: "manifest.json", Type: "application/webpub+json"},
			{Href: "positions.json", Type: positionListType},
		},
		ReadingOrder: readingOrder,
		Resources:    resources,
		Toc:          readToc(zr, opf, dir),
	}
	return manifest, pubPositions{Total: len(positions), Positions: positions}, nil
}

// readToc prefere o sumário do EPUB 3 e cai no NCX do EPUB 2. Sem sumário legível, o livro
// ainda abre: o leitor só avisa que não há capítulos.
func readToc(zr *zip.Reader, opf opfPackage, dir string) []pubLink {
	for _, item := range opf.Items {
		if !hasProperty(item, "nav") {
			continue
		}
		name := entryName(dir, item.Href)
		if data, err := readZipFile(zr, name, maxEpubXMLBytes); err == nil {
			if toc := parseNavToc(data, path.Dir(name)); len(toc) > 0 {
				return toc
			}
		}
	}
	for _, item := range opf.Items {
		if item.ID != opf.Spine.Toc && item.MediaType != "application/x-dtbncx+xml" {
			continue
		}
		name := entryName(dir, item.Href)
		var ncx struct {
			Points []navPoint `xml:"navMap>navPoint"`
		}
		if err := readZipXML(zr, name, &ncx); err == nil {
			return convertNavPoints(ncx.Points, path.Dir(name))
		}
	}
	return []pubLink{}
}

func convertNavPoints(points []navPoint, dir string) []pubLink {
	links := []pubLink{}
	for _, point := range points {
		links = append(links, pubLink{
			Href:     resolveHref(dir, point.Content.Src),
			Title:    cleanText(point.Label),
			Children: convertNavPoints(point.Children, dir),
		})
	}
	return links
}

type navNode struct {
	href, title string
	children    []*navNode
}

// parseNavToc lê o <nav epub:type="toc">. O XHTML dos livros costuma ter entidades de HTML,
// que o XML estrito recusa.
func parseNavToc(data []byte, dir string) []pubLink {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	decoder.Strict = false
	decoder.Entity = xml.HTMLEntity
	decoder.AutoClose = xml.HTMLAutoClose

	root := &navNode{}
	stack := []*navNode{root}
	inToc, inLabel := false, false
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := token.(type) {
		case xml.StartElement:
			switch {
			case t.Name.Local == "nav":
				for _, attr := range t.Attr {
					if attr.Name.Local == "type" && strings.Contains(attr.Value, "toc") {
						inToc = true
					}
				}
			case !inToc:
			case t.Name.Local == "li":
				node := &navNode{}
				top := stack[len(stack)-1]
				top.children = append(top.children, node)
				stack = append(stack, node)
			case t.Name.Local == "a" || t.Name.Local == "span":
				inLabel = len(stack) > 1
				if t.Name.Local == "a" && inLabel {
					for _, attr := range t.Attr {
						if attr.Name.Local == "href" {
							stack[len(stack)-1].href = attr.Value
						}
					}
				}
			}
		case xml.CharData:
			if inLabel {
				stack[len(stack)-1].title += string(t)
			}
		case xml.EndElement:
			switch {
			case t.Name.Local == "nav" && inToc:
				return convertNavNodes(root.children, dir)
			case !inToc:
			case t.Name.Local == "li" && len(stack) > 1:
				stack = stack[:len(stack)-1]
				inLabel = false
			case t.Name.Local == "a" || t.Name.Local == "span":
				inLabel = false
			}
		}
	}
	return convertNavNodes(root.children, dir)
}

// Um título sem link (<span>) não leva a lugar nenhum: os filhos sobem um nível.
func convertNavNodes(nodes []*navNode, dir string) []pubLink {
	links := []pubLink{}
	for _, node := range nodes {
		children := convertNavNodes(node.children, dir)
		if node.href == "" {
			links = append(links, children...)
			continue
		}
		links = append(links, pubLink{Href: resolveHref(dir, node.href), Title: cleanText(node.title), Children: children})
	}
	return links
}

// handlePublication entrega o EPUB aberto em partes: manifesto, posições e arquivos internos.
func (l *library) handlePublication(w http.ResponseWriter, r *http.Request) {
	f, info, format, err := l.openBookFile(r.Context(), r.PathValue("id"))
	if err != nil || format != formatEpub {
		if f != nil {
			f.Close()
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "livro não encontrado"})
		return
	}
	defer f.Close()
	zr, err := zip.NewReader(f, info.Size())
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": errInvalidBook.Error()})
		return
	}

	name := r.PathValue("path")
	if name == "manifest.json" || name == "positions.json" {
		manifest, positions, err := buildPublication(zr)
		switch {
		case err != nil:
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		case name == "manifest.json":
			writeJSON(w, http.StatusOK, manifest)
		default:
			writeJSON(w, http.StatusOK, positions)
		}
		return
	}
	l.serveEntry(w, zr, name)
}

func (l *library) serveEntry(w http.ResponseWriter, zr *zip.Reader, name string) {
	entry, err := zr.Open(name)
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrInvalid) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "arquivo não encontrado no livro"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao ler o livro"})
		return
	}
	defer entry.Close()
	info, err := entry.Stat()
	if err != nil || info.IsDir() {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "arquivo não encontrado no livro"})
		return
	}
	types := map[string]string{}
	if opf, opfPath, err := readOpf(zr); err == nil {
		types = declaredTypes(opf, path.Dir(opfPath))
	}
	w.Header().Set("Content-Type", typeOfEntry(name, types))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// O Readium busca o arquivo por fetch. Aberto direto no navegador, um XHTML ou SVG do
	// livro poderia executar script na origem do app; com sandbox, não.
	w.Header().Set("Content-Security-Policy", "sandbox")
	io.Copy(w, entry)
}
