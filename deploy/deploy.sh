#!/usr/bin/env bash
# Despliega el commit actual (HEAD) en el servidor por SSH y reconstruye los contenedores.
#
#   deploy/deploy.sh            # host "ebon" de ~/.ssh/config
#   deploy/deploy.sh otrohost   # otro alias de SSH
#
# Qué hace: empaqueta el árbol versionado con `git archive` (sin .git, sin .env,
# sin node_modules), lo sube a $REMOTE_DIR/src, construye las imágenes en el
# servidor y levanta docker-compose.prod.yml. El .env y ./data del servidor no
# se tocan. No hace falta Node ni acceso a GitHub en el servidor.
set -euo pipefail

HOST="${1:-ebon}"
REMOTE_DIR="${REMOTE_DIR:-/home/cyalbot}"
REV="$(git rev-parse --short HEAD)"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Hay cambios sin commitear; se despliega solo lo commiteado ($REV)." >&2
fi

echo "==> Subiendo fuente $REV a $HOST:$REMOTE_DIR/src"
git archive --format=tar HEAD | ssh "$HOST" "
  set -e
  mkdir -p '$REMOTE_DIR/src.new' && tar -x -C '$REMOTE_DIR/src.new'
  rm -rf '$REMOTE_DIR/src.old'
  [ -d '$REMOTE_DIR/src' ] && mv '$REMOTE_DIR/src' '$REMOTE_DIR/src.old'
  mv '$REMOTE_DIR/src.new' '$REMOTE_DIR/src'
  echo '$REV' > '$REMOTE_DIR/src/.deployed-rev'
"

echo "==> Construyendo y levantando en $HOST"
ssh "$HOST" "
  set -e
  cd '$REMOTE_DIR/src'
  # Copia (no enlace): el Docker en snap no sigue enlaces fuera del directorio del proyecto.
  install -m 600 -o root -g root '$REMOTE_DIR/.env' .env
  docker compose -f docker-compose.prod.yml build --pull
  docker compose -f docker-compose.prod.yml up -d --remove-orphans
  docker image prune -f >/dev/null
  docker compose -f docker-compose.prod.yml ps
"

echo "==> Listo ($REV). Logs: ssh $HOST 'cd $REMOTE_DIR/src && docker compose -f docker-compose.prod.yml logs -f bot'"
