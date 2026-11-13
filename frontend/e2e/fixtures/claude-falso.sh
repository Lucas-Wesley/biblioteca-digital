#!/bin/sh
# O "claude" dos testes de navegador: lê o sumário de qualquer foto sempre do mesmo jeito.
cat <<'JSON'
{"result":"","is_error":false,"structured_output":{"capitulos":[{"titulo":"I. A chegada","pagina":11},{"titulo":"II. A carta de Akeley","pagina":29},{"titulo":"III. Vozes na colina","pagina":47}],"observacao":"Tudo legível."}}
JSON
