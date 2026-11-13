#!/bin/sh
# O "claude" dos testes de navegador: lê o sumário de qualquer foto sempre do mesmo jeito. Um lote
# de 2 a 7 fotos traz o resto do sumário, para testar a leitura em lotes (R37).
fotos=$(ls foto-* 2>/dev/null | wc -l | tr -d ' ')
if [ "$fotos" -ge 2 ] && [ "$fotos" -le 7 ]; then
cat <<'JSON'
{"result":"","is_error":false,"structured_output":{"capitulos":[{"titulo":"IV. O fonógrafo","pagina":65},{"titulo":"V. A fuga","pagina":83}],"observacao":""}}
JSON
exit 0
fi
cat <<'JSON'
{"result":"","is_error":false,"structured_output":{"capitulos":[{"titulo":"I. A chegada","pagina":11},{"titulo":"II. A carta de Akeley","pagina":29},{"titulo":"III. Vozes na colina","pagina":47}],"observacao":"Tudo legível."}}
JSON
