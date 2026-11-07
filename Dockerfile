# Imagen de producción. Construir: docker build -t cyalbot .
# Correr:  docker run -it --env-file .env -v $(pwd)/data:/app/data cyalbot
#
# La sesión de WhatsApp y la base de datos viven en /app/data (volumen) para
# sobrevivir a reconstrucciones de la imagen.

FROM node:22-slim AS build
WORKDIR /app
# better-sqlite3 trae binarios precompilados; python3/make/g++ solo se usan si no hay uno para la plataforma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    AUTH_FOLDER=/app/data/session \
    DATABASE_PATH=/app/data/database.sqlite
# ffmpeg: stickers animados y conversión de video. git: para /gitpull (opcional).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
