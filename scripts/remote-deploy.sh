#!/usr/bin/env bash
# Roda na VM, chamado pelo deploy.sh. Se o app não ficar saudável, volta ao commit anterior.
set -euo pipefail

SHA="$1"
REPO=https://github.com/Lucas-Wesley/biblioteca-digital.git
APP_DIR=/opt/apps/biblioteca-digital
STATE=/opt/apps/biblioteca-digital.deployed
COMPOSE=(docker compose -f compose.yaml -f compose.prod.yaml)

[ -d "$APP_DIR/.git" ] || git clone -q "$REPO" "$APP_DIR"
cd "$APP_DIR"
git fetch -q origin
git checkout -q --detach "$SHA"

PREV=$(cat "$STATE" 2>/dev/null || true)

export VERSION="$SHA"
"${COMPOSE[@]}" build --quiet

if ! "${COMPOSE[@]}" up -d --wait --wait-timeout 60; then
  echo "ERRO: ${SHA:0:7} não ficou saudável." >&2
  "${COMPOSE[@]}" logs --tail 20 >&2 || true
  if [ -n "$PREV" ]; then
    echo "==> Voltando para ${PREV:0:7}" >&2
    git checkout -q --detach "$PREV"
    VERSION="$PREV" "${COMPOSE[@]}" up -d --wait --wait-timeout 60
  fi
  exit 1
fi

echo "$SHA" > "$STATE"

# Mantém só as imagens do commit atual e do anterior
docker images biblioteca-digital --format '{{.Tag}}' \
  | { grep -vxF -e "$SHA" -e "${PREV:-$SHA}" || true; } \
  | xargs -r -I{} docker rmi -f "biblioteca-digital:{}" >/dev/null
docker image prune -f >/dev/null
