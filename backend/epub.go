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
	"path"
	"slices"
	"strings"
)

const (
	maxEpubXMLBytes = 5 << 20
	maxCoverBytes   = 20 << 20
)

var errNotEpub = errors.New("o arquivo não é um EPUB válido")

// SVG fica de fora: aberto direto no navegador, ele poderia executar script na origem do app.
var coverTypes = []string{"image/jpeg", "image/png", "image/gif", "image/webp"}

type epubMeta struct {
	Title     string
	Author    string
	CoverType string
	Cover     []byte
}

type opfPackage struct {
	Titles   []string `xml:"metadata>title"`
	Creators []string `xml:"metadata>creator"`
	Metas    []struct {
		Name    string `xml:"name,attr"`
		Content string `xml:"content,attr"`
	} `xml:"metadata>meta"`
	Items []opfItem `xml:"manifest>item"`
}

type opfItem struct {
	ID         string `xml:"id,attr"`
	Href       string `xml:"href,attr"`
	MediaType  string `xml:"media-type,attr"`
	Properties string `xml:"properties,attr"`
}

// readEpub lê título, autor e capa. Um EPUB sem capa ou sem título é aceito;
// sem container.xml ou OPF legível, não é considerado EPUB.
func readEpub(file string) (epubMeta, error) {
	r, err := zip.OpenReader(file)
	if err != nil {
		return epubMeta{}, errNotEpub
	}
	defer r.Close()

	var container struct {
		Rootfiles []struct {
			FullPath string `xml:"full-path,attr"`
		} `xml:"rootfiles>rootfile"`
	}
	if err := readZipXML(&r.Reader, "META-INF/container.xml", &container); err != nil || len(container.Rootfiles) == 0 {
		return epubMeta{}, errNotEpub
	}
	opfPath := path.Clean(container.Rootfiles[0].FullPath)

	var opf opfPackage
	if err := readZipXML(&r.Reader, opfPath, &opf); err != nil {
		return epubMeta{}, errNotEpub
	}

	meta := epubMeta{}
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

// coverHref procura a capa como no EPUB 3, depois como no EPUB 2 e, por fim, pelo nome.
func (o opfPackage) coverHref() string {
	for _, item := range o.Items {
		if slices.Contains(strings.Fields(item.Properties), "cover-image") {
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
