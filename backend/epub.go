package main

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"slices"
	"strings"
)

const (
	maxEpubXMLBytes = 5 << 20
	maxCoverBytes   = 20 << 20
)

var errInvalidBook = errors.New("o arquivo não é um EPUB ou PDF válido")

// SVG fica de fora: aberto direto no navegador, ele poderia executar script na origem do app.
var coverTypes = []string{"image/jpeg", "image/png", "image/gif", "image/webp"}

type bookMeta struct {
	Format    string
	Title     string
	Author    string
	CoverType string
	Cover     []byte
}

type opfPackage struct {
	Titles   []string `xml:"metadata>title"`
	Creators []string `xml:"metadata>creator"`
	Metas    []struct {
		Name     string `xml:"name,attr"`
		Content  string `xml:"content,attr"`
		Property string `xml:"property,attr"`
		Value    string `xml:",chardata"`
	} `xml:"metadata>meta"`
	Items     []opfItem `xml:"manifest>item"`
	Languages []string  `xml:"metadata>language"`
	Spine     opfSpine  `xml:"spine"`
}

type opfSpine struct {
	Toc       string `xml:"toc,attr"`
	Direction string `xml:"page-progression-direction,attr"`
	Items     []struct {
		IDRef string `xml:"idref,attr"`
	} `xml:"itemref"`
}

type epubContainer struct {
	Rootfiles []struct {
		FullPath string `xml:"full-path,attr"`
	} `xml:"rootfiles>rootfile"`
}

type opfItem struct {
	ID         string `xml:"id,attr"`
	Href       string `xml:"href,attr"`
	MediaType  string `xml:"media-type,attr"`
	Properties string `xml:"properties,attr"`
}

// readBookMeta identifica o formato pelo conteúdo, não pela extensão. Um PDF só tem o
// formato preenchido aqui: quem extrai os metadados dele é o navegador, com o PDF.js.
func readBookMeta(file string) (bookMeta, error) {
	f, err := os.Open(file)
	if err != nil {
		return bookMeta{}, err
	}
	defer f.Close()
	header := make([]byte, 5)
	if _, err := io.ReadFull(f, header); err != nil {
		return bookMeta{}, errInvalidBook
	}
	if string(header) == "%PDF-" {
		return bookMeta{Format: formatPDF}, nil
	}
	return readEpub(file)
}

// readEpub lê título, autor e capa. Um EPUB sem capa ou sem título é aceito;
// sem container.xml ou OPF legível, não é considerado EPUB.
func readEpub(file string) (bookMeta, error) {
	r, err := zip.OpenReader(file)
	if err != nil {
		return bookMeta{}, errInvalidBook
	}
	defer r.Close()

	opf, opfPath, err := readOpf(&r.Reader)
	if err != nil {
		return bookMeta{}, err
	}

	meta := bookMeta{Format: formatEpub}
	if len(opf.Titles) > 0 {
		meta.Title = cleanText(opf.Titles[0])
	}
	authors := []string{}
	for _, creator := range opf.Creators {
		if name := cleanText(creator); name != "" {
			authors = append(authors, name)
		}
	}
	meta.Author = strings.Join(authors, ", ")

	if href := opf.coverHref(); href != "" {
		meta.Cover, meta.CoverType = readCover(&r.Reader, path.Dir(opfPath), href)
	}
	return meta, nil
}

func hasProperty(item opfItem, property string) bool {
	return slices.Contains(strings.Fields(item.Properties), property)
}

// fixedLayout indica livro de página fixa (quadrinhos, por exemplo), declarado no EPUB 3.
func (o opfPackage) fixedLayout() bool {
	for _, m := range o.Metas {
		if m.Property == "rendition:layout" && cleanText(m.Value) == "pre-paginated" {
			return true
		}
	}
	return false
}

// coverHref procura a capa como no EPUB 3, depois como no EPUB 2 e, por fim, pelo nome.
func (o opfPackage) coverHref() string {
	for _, item := range o.Items {
		if hasProperty(item, "cover-image") {
			return item.Href
		}
	}
	for _, m := range o.Metas {
		if m.Name != "cover" {
			continue
		}
		for _, item := range o.Items {
			if item.ID == m.Content {
				return item.Href
			}
		}
	}
	for _, item := range o.Items {
		if strings.HasPrefix(item.MediaType, "image/") &&
			(strings.Contains(strings.ToLower(item.ID), "cover") || strings.Contains(strings.ToLower(item.Href), "cover")) {
			return item.Href
		}
	}
	return ""
}

// readCover confere o tipo pelo conteúdo, não pelo que o OPF declara.
func readCover(zr *zip.Reader, dir, href string) ([]byte, string) {
	if unescaped, err := url.PathUnescape(href); err == nil {
		href = unescaped
	}
	data, err := readZipFile(zr, path.Join(dir, href), maxCoverBytes)
	if err != nil {
		return nil, ""
	}
	coverType := http.DetectContentType(data)
	if !slices.Contains(coverTypes, coverType) {
		return nil, ""
	}
	return data, coverType
}

func readZipXML(zr *zip.Reader, name string, target any) error {
	data, err := readZipFile(zr, name, maxEpubXMLBytes)
	if err != nil {
		return err
	}
	return xml.Unmarshal(data, target)
}

// readZipFile limita o tamanho lido para um ZIP malformado não esgotar a memória.
func readZipFile(fsys fs.FS, name string, limit int64) ([]byte, error) {
	f, err := fsys.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s passa de %d bytes", name, limit)
	}
	return data, nil
}

func cleanText(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
