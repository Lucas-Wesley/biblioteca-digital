#!/usr/bin/env bash
# Baixa um EPUB de domínio público (Quincas Borba, Project Gutenberg) para testar o leitor.
# Uso: baixar-livro-exemplo.sh [pasta]
set -euo pipefail

PASTA="${1:-data/books}"
DESTINO="$PASTA/quincas-borba.epub"

[ -f "$DESTINO" ] && exit 0

mkdir -p "$PASTA"
TEMP=$(mktemp "$PASTA/.download.XXXXXX")
trap 'rm -f "$TEMP"' EXIT
curl -fsSL --max-time 120 -o "$TEMP" https://www.gutenberg.org/ebooks/55682.epub3.images
head -c 60 "$TEMP" | grep -aq 'application/epub+zip' || { echo "ERRO: o arquivo baixado não é um EPUB." >&2; exit 1; }
chmod 644 "$TEMP"
mv "$TEMP" "$DESTINO"
