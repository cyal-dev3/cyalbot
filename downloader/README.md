# cyalbot-downloader

Servicio HTTP propio de descargas para [cyalbot](../README.md). Envuelve `yt-dlp` y `ffmpeg` detras de una API JSON pequena que el bot ya sabe consumir (`DOWNLOADER_API_URL`). Sustituye a APIs publicas de terceros: corre en tu propia maquina o contenedor, sin claves externas.

- Solo modulos nativos de Node 22 (`node:http`, `node:child_process`, ...). Sin dependencias de produccion.
- Video siempre en mp4 H.264/AAC (lo que reproduce WhatsApp); audio en mp3.
- Cola con limite de concurrencia, cache por URL, limpieza automatica de archivos, limite de tamano y timeout por peticion.
- Tokens aleatorios para los archivos, validacion anti-SSRF, nunca pasa la URL por una shell.
- Busqueda en YouTube (`/v1/search`) para el comando `/play` del bot.

## Requisitos

- Node 22+
- `yt-dlp` (recomendado el mas reciente; con `pip install yt-dlp` o el binario oficial)
- `ffmpeg` (y `ffprobe`, que viene con el)
- Opcional: `gallery-dl` para posts que solo tienen fotos.

## Correr en local

```bash
cd downloader
npm install
npm run build
YTDLP_PATH=/ruta/a/yt-dlp PUBLIC_URL=http://localhost:3002 npm start
# desarrollo con recarga:
npm run dev
```

Comprobar: `curl http://localhost:3002/health`

Si `yt-dlp` no esta en el PATH, instalalo en un venv y apunta `YTDLP_PATH` al binario:

```bash
python3 -m venv ~/.yt-dlp && ~/.yt-dlp/bin/pip install yt-dlp
YTDLP_PATH=~/.yt-dlp/bin/yt-dlp npm start
```

Si yt-dlp es reciente (>= 2025.10), el servicio detecta que acepta `--js-runtimes node --remote-components ejs:github` y lo activa: usa Node como runtime JS para los desafios de YouTube y descarga una vez el script resolutor desde GitHub (lo cachea yt-dlp). Con un yt-dlp antiguo esas opciones se omiten.

## Correr en Docker

```bash
docker build -t cyalbot-downloader ./downloader
docker run -d --name downloader -p 3002:3002 \
  -e PUBLIC_URL=http://localhost:3002 \
  -v downloader-files:/downloads \
  cyalbot-downloader
```

La imagen (`node:22-slim`) instala `python3`, `yt-dlp` en un venv (`/opt/yt-dlp`) y `ffmpeg`; corre como usuario `node` y guarda las descargas en el volumen `/downloads`.

Con el bot, usa el `docker-compose.yml` de la raiz del repo:

```bash
cp .env.example .env   # rellena lo del bot
docker compose up -d --build
```

El compose levanta `bot` y `downloader` en la misma red; el bot recibe `DOWNLOADER_API_URL=http://downloader:3002` y el downloader `PUBLIC_URL=http://downloader:3002`, de modo que las URLs de `data.url` son alcanzables desde el bot sin exponer el puerto al host.

## Apuntar el bot

En el `.env` del bot:

```
DOWNLOADER_API_URL=http://localhost:3002     # o http://downloader:3002 en compose
DOWNLOADER_API_TIMEOUT_MS=130000             # algo mayor que DOWNLOAD_TIMEOUT_MS: las descargas pueden tardar mas de 30 s
```

Si defines `DOWNLOADER_API_KEY` en el downloader, el bot tiene que enviar esa misma clave en la cabecera `x-api-key` en cada llamada a `/v1/*`; si no lo hace recibira 401 y caera a los scrapers publicos.

`PUBLIC_URL` del downloader debe ser una direccion que el bot pueda abrir: si corren en la misma maquina, `http://localhost:3002`; en compose, el nombre del servicio; en maquinas distintas, la IP o dominio del downloader.

## Variables de entorno

Todas son opcionales. Ver tambien [`.env.example`](.env.example).

| Variable | Default | Descripcion |
| --- | --- | --- |
| `PORT` | `3002` | Puerto de escucha |
| `HOST` | `0.0.0.0` | Interfaz de escucha |
| `PUBLIC_URL` | `http://localhost:PORT` | Base de las URLs devueltas en `data.url`. Debe ser alcanzable desde el bot |
| `DOWNLOADER_API_KEY` | vacio | Si se define, `/v1/*` exige la cabecera `x-api-key` con ese valor (401 si falta). `/health` y `/files` quedan libres |
| `YTDLP_PATH` | `yt-dlp` | Ruta al binario de yt-dlp |
| `FFMPEG_PATH` | `ffmpeg` | Ruta a ffmpeg (ffprobe se busca junto a el) |
| `GALLERYDL_PATH` | vacio | Ruta a gallery-dl para posts de solo fotos. Opcional |
| `YTDLP_COOKIES` | vacio | Archivo de cookies (formato Netscape) que se pasa como `--cookies` |
| `YTDLP_EXTRACTOR_ARGS` | vacio | Se pasa como `--extractor-args`, p. ej. `youtube:player_client=default,web` |
| `MAX_FILE_MB` | `60` | Tamano maximo por archivo. Se pasa a yt-dlp como `--max-filesize` y se verifica tras descargar (413 `TOO_LARGE`) |
| `DOWNLOAD_TIMEOUT_MS` | `120000` | Presupuesto total por peticion. Al vencer se mata el proceso (SIGTERM, luego SIGKILL) y se responde 504 `TIMEOUT` |
| `MAX_CONCURRENT` | `2` | Descargas simultaneas (`/v1/download`) |
| `META_CONCURRENT` | `4` | Peticiones de metadata simultaneas (`/v1/info`, `/v1/search`); tambien lanzan yt-dlp |
| `QUEUE_MAX` | `20` | Peticiones en espera (por cola) antes de responder 429 `RATE_LIMITED` |
| `MAX_PLAYLIST_ITEMS` | `10` | Entradas maximas que se leen de una lista. Una playlist pura (YouTube, canal, album) descarga solo la primera; un carrusel (Instagram, X) hasta este numero |
| `CACHE_TTL_MIN` | `30` | Minutos que una misma `url+quality+audioOnly` devuelve el token anterior sin volver a descargar |
| `DOWNLOAD_DIR` | `<tmpdir>/cyalbot-downloader` | Carpeta de descargas. Al arrancar se vacia por completo |
| `FILE_TTL_MIN` | `30` | Minutos que vive cada descarga. La limpieza corre cada 5 minutos |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error` |

## Contrato HTTP

Todas las respuestas son JSON. Las de error tienen esta forma, con el status HTTP que corresponde al codigo:

```json
{"success":false,"error":{"code":"LOGIN_REQUIRED","message":"..."},"meta":{"engine":"yt-dlp","requestId":"a1b2c3d4e5f6","durationMs":1234}}
```

| Codigo | Status | Cuando |
| --- | --- | --- |
| `INVALID_URL` | 400 | No es http(s), host privado/localhost/IP literal, URL mal formada |
| `BAD_REQUEST` | 400 | Body no JSON, campos invalidos, metodo incorrecto |
| `UNAUTHORIZED` | 401 | Falta o no coincide `x-api-key` |
| `NOT_FOUND` | 404 | Video eliminado o inexistente (404/410, dominio que no resuelve); token de `/files` desconocido o expirado |
| `TOO_LARGE` | 413 | Archivo mayor que `MAX_FILE_MB` (o body mayor que 64 KB; se responde con JSON, sin cortar la conexion) |
| `UNSUPPORTED` | 422 | yt-dlp no soporta la URL, no hay medios descargables, el sitio devolvio 403, bucle de redirecciones o `audioOnly` sobre un video sin audio |
| `LOGIN_REQUIRED` | 422 | El sitio exige sesion (Instagram, Facebook, videos privados). Pasa cookies |
| `RATE_LIMITED` | 429 | Cola llena o el sitio devolvio 429 |
| `INTERNAL` | 500 | Fallo no clasificado (el mensaje trae la ultima linea de error de yt-dlp) |
| `TIMEOUT` | 504 | Se agoto `DOWNLOAD_TIMEOUT_MS` |

### `GET /health`

```bash
curl http://localhost:3002/health
# {"status":"ok","version":"1.0.0","ytdlp":"2026.10.26","uptimeSeconds":42,"queue":{"active":0,"waiting":0}}
```

`ytdlp` es `null` si el binario no se encuentra. No exige api key.

### `POST /v1/download`

Body: `{"url": string, "quality": "best"|"medium"|"low", "audioOnly": boolean}`. `quality` por defecto `medium` (<= 720p); `low` es <= 480p; `best` sin limite. Con `audioOnly: true` devuelve mp3.

```bash
curl -X POST http://localhost:3002/v1/download \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","quality":"low"}'
```

```json
{
  "success": true,
  "data": {
    "url": "http://localhost:3002/files/362b6d78c9f3aead843cc62fc987c7c3",
    "type": "video",
    "filename": "dQw4w9WgXcQ.mp4",
    "size": 17616370,
    "duration": 213,
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg",
    "title": "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
    "author": "Rick Astley",
    "medias": [
      {"url": "http://localhost:3002/files/362b6d78c9f3aead843cc62fc987c7c3", "type": "video", "filename": "dQw4w9WgXcQ.mp4", "size": 17616370}
    ]
  },
  "meta": {"engine": "yt-dlp", "requestId": "eec16e643a60", "durationMs": 9517, "cached": false}
}
```

`medias` lista todos los archivos cuando hay varios (carrusel de Instagram, hilo con varias fotos); `data.url`, `type`, `filename` y `size` son los del primero. Los adicionales se sirven en `/files/<token>/<indice>`. `type` puede ser `video`, `audio` o `image`. `meta.engine` es `yt-dlp`, `gallery-dl` o `cache`.

Solo audio:

```bash
curl -X POST http://localhost:3002/v1/download -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","audioOnly":true}'
```

Comportamiento:

- Formato de video por calidad: `best` -> `bv*+ba/b`; `medium` -> `bv*[height<=720]+ba/b[height<=720]/b`; `low` -> `bv*[height<=480]+ba/b[height<=480]/b`. Se prefiere h264/m4a en la seleccion (`-S vcodec:h264,res,acodec:m4a`), se fusiona y remuxea a mp4. Despues se inspecciona con ffprobe: si el video no es H.264 o el audio no es AAC se recodifica solo la pista necesaria (`libx264 -preset veryfast -crf 26` / `aac`, `+faststart`).
- Audio: `-x --audio-format mp3 --audio-quality 5`.
- Antes de descargar se consulta la metadata (`-J`) para estimar tamano y responder `TOO_LARGE` sin gastar ancho de banda.
- Si la URL no tiene formatos de video (post de fotos en Instagram, Pinterest, Threads, X), se descargan las imagenes que yt-dlp expone con `fetch`; si no hay y existe `GALLERYDL_PATH`, se usa gallery-dl. Si nada funciona: `UNSUPPORTED`.
- Una URL directa a una imagen (`.png`, `.jpg`, `.webp`...) se devuelve como `type: "image"` sin pasar por mp4.
- Una playlist pura (`youtube.com/playlist?list=...`, canal, album) descarga solo su primera entrada; los carruseles con varias fotos/videos se descargan completos hasta `MAX_PLAYLIST_ITEMS`.
- La misma peticion (URL + quality + audioOnly) dentro de `CACHE_TTL_MIN` devuelve el token ya descargado (`meta.cached: true`).
- Si el cliente cierra la conexion antes de la respuesta, la peticion sale de la cola y se mata el yt-dlp/ffmpeg en curso (en el log aparece con status 499).
- Los errores de yt-dlp se clasifican por el mensaje de su linea `ERROR:`, nunca por la URL ni por el JSON de metadata, asi que un slug como `/timeout` no cambia el codigo.

### `POST /v1/info`

Metadata sin descargar. Acepta playlists (devuelve `isPlaylist` y `entries`).

```bash
curl -X POST http://localhost:3002/v1/info -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
# {"success":true,"data":{"title":"Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)","author":"Rick Astley","duration":213,"thumbnail":"https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/maxresdefault.webp","platform":"youtube","isPlaylist":false,"entries":1},"meta":{...}}
```

### `GET /v1/search?q=texto&limit=5`

Busqueda en YouTube via `ytsearchN:texto` con `--flat-playlist`. `limit` entre 1 y 20 (default 5).

```bash
curl 'http://localhost:3002/v1/search?q=lofi&limit=3'
# {"success":true,"data":{"results":[{"id":"rFZHOHl-L8A","title":"lofi hip hop radio ...","url":"https://www.youtube.com/watch?v=rFZHOHl-L8A","duration":null,"author":"Lofi Girl","thumbnail":"https://i.ytimg.com/vi/rFZHOHl-L8A/hq720.jpg"}]},"meta":{...}}
```

### `GET /files/<token>` y `GET /files/<token>/<indice>`

Sirve el archivo con `Content-Type`, `Content-Length`, `Accept-Ranges` (soporta `Range: bytes=a-b`, 206/416; una unidad distinta de `bytes` se ignora y se sirve completo) y `Content-Disposition: inline; filename=...`. Devuelve 404 si el token no existe o expiro. Los tokens son 16 bytes aleatorios en hex; no se listan ni se pueden adivinar.

```bash
curl -o video.mp4 http://localhost:3002/files/362b6d78c9f3aead843cc62fc987c7c3
curl -H 'Range: bytes=0-1023' -o parte.bin http://localhost:3002/files/362b6d78c9f3aead843cc62fc987c7c3
```

### Autenticacion

Con `DOWNLOADER_API_KEY=secreto`:

```bash
curl -H 'x-api-key: secreto' 'http://localhost:3002/v1/search?q=lofi'
```

Sin la cabecera, `/v1/*` responde 401. `/health` y `/files/*` no la exigen (los tokens ya son secretos y el bot tiene que poder leerlos).

## Cookies (Instagram, Facebook, videos con edad)

Instagram y Facebook bloquean casi todo el acceso anonimo (`LOGIN_REQUIRED`). Exporta las cookies de un navegador con sesion iniciada en formato Netscape (extensiones tipo "Get cookies.txt LOCALLY") y pasa el archivo:

```bash
YTDLP_COOKIES=/ruta/cookies.txt npm start
```

En Docker, monta el archivo y apunta la variable (`-v $PWD/cookies.txt:/cookies/cookies.txt:ro -e YTDLP_COOKIES=/cookies/cookies.txt`); el compose trae el ejemplo comentado. Usa una cuenta secundaria: las plataformas pueden bloquear cuentas que descargan mucho.

## Seguridad

- Solo URLs `http(s)` con dominio publico: se rechazan IPs literales, `localhost`, `*.local`, `*.internal`, etc., y hosts que resuelven a rangos privados. Si el DNS no resuelve se rechaza la URL (salvo que haya un proxy configurado por `HTTPS_PROXY`, en cuyo caso resuelve el proxy). Las URLs derivadas de la metadata (imagenes, miniaturas, redirecciones, entradas de playlist) pasan por la misma validacion antes de pedirse; las redirecciones de imagenes se siguen a mano (maximo 3) revalidando cada salto.
- Limite conocido: yt-dlp vuelve a resolver el nombre al conectar, asi que un DNS malicioso que cambie de respuesta entre la comprobacion y la descarga (rebinding con TTL 0) no se detecta. Si eso preocupa, ejecuta el servicio en una red sin acceso a servicios internos.
- yt-dlp, ffmpeg y gallery-dl se ejecutan con `spawn` (sin shell), en su propio grupo de procesos (al vencer el timeout, cancelar o apagar se mata el grupo entero, incluidos los ffmpeg que lanza yt-dlp) y la URL va tras `--`.
- `/v1/info` y `/v1/search` tambien pasan por una cola (`META_CONCURRENT`), asi que el numero de procesos yt-dlp esta acotado por `MAX_CONCURRENT + META_CONCURRENT`.
- Las imagenes se descargan en streaming a disco con tope `MAX_FILE_MB`; nunca se cargan enteras en memoria.
- Body limitado a 64 KB; nombres de archivo saneados; `/files` solo acepta tokens hex de 32 caracteres, sin acceso al sistema de archivos por ruta.
- Las descargas se borran a los `FILE_TTL_MIN` minutos y todo el directorio se vacia al arrancar.

## Desarrollo

```bash
npm run typecheck
npm test            # unitarios + integracion (se salta si no hay yt-dlp o red)
YTDLP_PATH=/ruta/yt-dlp npm test
npm run build
```

Estructura: `src/server.ts` (HTTP, body, api key, logs), `src/routes.ts` (handlers y forma de la respuesta), `src/ytdlp.ts` (procesos, formatos, metadata, recodificacion, imagenes), `src/files.ts` (tokens, cache, limpieza, servir con Range), `src/queue.ts`, `src/validate.ts` (SSRF y nombres), `src/errors.ts` (codigos y mapeo de mensajes de yt-dlp), `src/config.ts`, `src/logger.ts`.
