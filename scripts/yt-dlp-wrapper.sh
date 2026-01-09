#!/bin/bash
# Wrapper para yt-dlp que asegura el entorno correcto

export PATH="/root/.nvm/versions/node/v20.19.6/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PYTHONPATH="/usr/local/lib/python3.12/dist-packages"
export HOME="/root"

exec /usr/local/bin/yt-dlp "$@"
