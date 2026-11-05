# Servicio de descargas de cyalbot. Construir: docker build -t cyalbot-downloader ./downloader
# Correr: docker run -p 3002:3002 -e PUBLIC_URL=http://localhost:3002 -v downloads:/downloads cyalbot-downloader

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production \
    DOWNLOAD_DIR=/downloads \
    YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    HOST=0.0.0.0 \
    PORT=3002
# yt-dlp se instala en un venv propio para no tocar el Python del sistema.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade pip yt-dlp \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /downloads && chown -R node:node /app /downloads
USER node
VOLUME ["/downloads"]
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
