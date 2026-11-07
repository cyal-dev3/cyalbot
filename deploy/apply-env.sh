#!/usr/bin/env bash
# Aplica cambios hechos en el .env del servidor ($REMOTE_DIR/.env) al bot en marcha.
#
#   deploy/apply-env.sh            # host "ebon"
#   deploy/apply-env.sh otrohost
#
# `docker restart` no relee variables de entorno: hay que recrear el contenedor.
# Además docker compose lee la copia $REMOTE_DIR/src/.env, así que primero se
# sincroniza. No imprime valores del .env.
set -euo pipefail

HOST="${1:-ebon}"
REMOTE_DIR="${REMOTE_DIR:-/home/cyalbot}"

ssh "$HOST" "
  set -e
  install -m 600 -o root -g root '$REMOTE_DIR/.env' '$REMOTE_DIR/src/.env'
  cd '$REMOTE_DIR/src'
  docker compose -f docker-compose.prod.yml up -d bot
  sleep 8
  docker logs --since 30s cyalbot 2>&1 | grep -aiE 'iniciando|ANTHROPIC|ia activa|conectado como|error' | tail -5
"
