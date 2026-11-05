# Handoff: área descargas y media

Estado al cierre: `npm test` pasa (166 tests, 26 nuevos en `tests/descargas-*.test.ts`). `npx tsc --noEmit` pasa en todos los archivos de esta área; al cerrar fallaba solo en `src/lib/social.ts` (archivo de otro agente en edición simultánea, ver "Pendiente").

El bot ahora usa el servicio propio `downloader/` como única fuente de descargas. Se eliminaron los 23 scrapers de terceros, Cobalt, `play-dl` y `@distube/ytdl-core`. Pipeline de media reescrito sobre `execFile` con timeouts y temporales que siempre se borran. Probado con ffmpeg 6.1 real (sticker estático, animado desde mp4 y webm, toimg/tovideo/togif de sticker animado, needsConversion, extracción mp3, compresión 480p; sin temporales huérfanos).

## Hecho

### src/lib/downloader-client.ts (nuevo)
- Cliente del contrato HTTP de `downloader/`: `downloadMedia(url, {audioOnly?, quality?})`, `getInfo(url)`, `search(q, {limit?, source?})`, `health()`.
- Comprueba `response.ok`, parsea el body con tolerancia (un 502 HTML del proxy devuelve `INTERNAL` con `status: 502`), mapea `type` 1:1 (`video|audio|image`), propaga `medias[]` con `size`, `title`, `author`, `duration`, `thumbnail`. Códigos desconocidos (p. ej. el nuevo `CLIENT_CLOSED` del servicio) caen en `INTERNAL`.
- Resultado discriminado `ClientResult<T> = {success:true, data} | {success:false, code, message, status?}`.
- `describeDownloadError(code, {message?, sizeBytes?})` y `describeFailure(failure)` -> texto humano (LOGIN_REQUIRED, TOO_LARGE con "pesa N MB, el máximo es 60 MB" leyendo N del mensaje del servicio o de `sizeBytes`, TIMEOUT, RATE_LIMITED, UNSUPPORTED, NOT_FOUND, UNAUTHORIZED, INTERNAL).
- Cabecera `x-api-key` desde `process.env.DOWNLOADER_API_KEY` si está definida. Timeout de descarga `Math.max(CONFIG.downloaderApi.timeout, 120000)`; info/search 60 s; health 5 s.
- `isDownloaderConfigured()` y `NOT_CONFIGURED_MESSAGE` ("Las descargas no están configuradas en este bot (DOWNLOADER_API_URL)."). Todos los comandos lo comprueban antes de reaccionar.
- `SEARCH_SOURCES = ['youtube']`: `search(q, {source:'soundcloud'})` devuelve `UNSUPPORTED` sin llamar al servicio (hoy `/v1/search` solo hace `ytsearch`). Cuando el servicio soporte `source`, basta añadir la fuente a la constante.

### src/lib/downloaders.ts (1157 -> 115 líneas)
- Quedan: tipos `DownloadResult`/`MediaItem` (con `size`), `Platform` (mismos 8 miembros, porque `handler.ts` tiene un `Record<Platform, string>`), `PLATFORMS: Record<Platform,{name, emoji}>`, `platformLabel(p)`, `detectPlatform(url)` por **host** de la URL (acepta `threads.com`, `fb.com`, `vt.tiktok.com`, `instagram.com/<user>/reel`, `/share`, `x.com/i/status`, `pinterest.<tld>`, `instagr.am`; `?u=x.com` ya no engaña), `URL_REGEX`, `extractUrl(text, quotedText?, regex?)` (devuelve `match[0]` sin puntuación final), `downloadAuto(url, {audioOnly?, quality?})` que llama al cliente una sola vez para cualquier plataforma incluida `unknown` y traduce el fallo a `error` humano + `code`.
- Eliminados: los 23 scrapers, `downloadWithDev3Api`, `isDev3ApiAvailable`, `downloadWithCobalt`, `CobaltOptions`, `searchPinterest`, `description`.
- `handler.ts` sigue compilando: usa `downloadAuto(url)`, `detectPlatform`, `Platform` con la misma forma.

### src/lib/http.ts (nuevo)
- `BROWSER_USER_AGENT`, `fetchWithTimeout(url, {timeoutMs, ...init})` (AbortController, respeta una `signal` externa) y re-exporta `isPrivateHost` de `fetch-media.ts`.

### src/lib/media-send.ts (nuevo)
- `LIMITS = {video: 64 MB, audio: 16 MB, image: 16 MB}`, `mimetypeFor(type, filename?, fetchedMime?)` (mp3 -> `audio/mpeg`, m4a -> `audio/mp4`, ogg/opus -> `audio/ogg`; video siempre `video/mp4`; imagen por el content-type real), `formatMb`.
- `fetchMedia` **se reutiliza de `src/lib/fetch-media.ts`** (el agente de núcleo ya lo creó: AbortController, `response.ok`, rechazo de `text/html`, corte del stream al superar `maxBytes`, rechazo de hosts privados salvo el de `DOWNLOADER_API_URL`). No se duplicó; `media-send.ts` lo re-exporta.
- `sendMedias(conn, m, medias, {caption?, limit?, fileName?, timeoutMs?, trackMessage?})` -> `{sent, total, errors[]}`: comprueba `media.size` contra el límite antes de bajar, mimetype por tipo real, caption solo en el primero (para audio lo manda como texto aparte), cita el mensaje original y llama a `trackMessage(key)` por cada envío para `/clear`.

### src/lib/ffmpeg.ts (nuevo)
- `runFfmpeg(args, {timeoutMs=60000})` (siempre `-y`), `runFfprobe(args, {timeoutMs=15000})`, ambos con `execFile`, `-hide_banner -loglevel error` (`-nostdin` solo en ffmpeg: ffprobe no lo acepta), `maxBuffer` 4 MB, `killSignal: SIGKILL`. Errores como `FfmpegError{tool, timedOut}` con la última línea de stderr ("ffmpeg no está instalado" en ENOENT).
- `TMP_DIR = process.env.TMP_DIR || join(cwd,'tmp')`, `ensureTmpDir()`, `withTempFiles(exts, fn)` y `withTempDir(fn)` (para secuencias de fotogramas); ambos borran siempre.

### src/lib/video-converter.ts (reescrito)
- `probeVideo(path)` -> un único ffprobe JSON con códec de video y audio, `pix_fmt`, contenedor, dimensiones y duración. `isWhatsAppCompatible(probe)` = h264 + yuv420p + (sin audio o aac) + contenedor mp4. `needsConversion(buffer)`.
- `ensureWhatsAppCompatible(buffer, force=false)` escribe el temporal una vez, inspecciona y recodifica sobre ese mismo temporal solo si hace falta. `convertVideoForWhatsApp(buffer, {crf, maxHeight})`, `compressVideo(buffer)` (crf 30, 480p), `extractAudioFromVideo(buffer, 'mp3'|'m4a')` (mp3 por defecto con libmp3lame).
- Eliminado `forceConvertForWhatsApp` (solo lo usaba el plugin universal, que ya no convierte: el servicio entrega mp4 H.264/AAC).

### src/lib/sticker.ts (reescrito)
- `detectMedia(buffer)` -> `{mime, ext, kind: image|video|unknown, animated}`; `isAnimatedWebp(buffer)` exportada (flag de VP8X o chunk ANIM). Quitadas la rama MKV inalcanzable, el heurístico "pesa más de 50 KB y tiene moov", `isAiSticker` y el `export default`.
- `imageToSticker(buffer, meta, {crop})` reintenta calidades 90/75/60/45/30 hasta <= 100 KB; `videoToSticker` reintenta (fps, calidad) 15/60, 12/45, 10/30, 8/20 hasta <= 500 KB, recorta a 8 s. `createSticker(buffer, meta, {crop})` elige por el contenido real.
- `stickerToImage/Video/Gif`: ffmpeg (hasta 7.0, el de Debian/Ubuntu) **no decodifica WebP animado**; los stickers animados se separan en fotogramas con node-webpmux (`demux({buffers:true})`) y se pasan a ffmpeg como lista `concat` con la duración real de cada fotograma. Antes estas tres funciones fallaban con "Nothing was written into output file" para cualquier sticker animado.
- `addExif` carga node-webpmux tolerando que la clase venga en `default` (CJS bajo tsx fallaba con "Image is not a constructor").
- `StickerMetadata` sin `isAiSticker`; `createSticker(buffer, {packname, author, categories})` como lo llama `handler.ts` sigue igual.

### src/lib/media.ts (nuevo)
- `mediaInMessage(message)` -> `{kind, mimetype, isAnimated, declaredSize}` (documento clasificado por su mimetype), `getQuotedText(m)` (incluye caption de video y documento citados), `downloadMessageMedia(conn, {key, message})`, `getQuotedOrOwnMedia(ctx, kinds, {maxBytes})` (citado primero, luego el propio; lanza `MediaTooLargeError` antes de descargar si `fileLength` supera el tope), `replyMediaError(m, error, fallback)`.
- Sustituye las 7 copias de `downloadMediaMessage(..., {logger: console as any, reuploadRequest})` que había en los plugins de sticker.

### src/lib/autodownload.ts (nuevo)
- `shouldAutoDownload(chat, url)`: servicio configurado, plataforma conocida, sin otra descarga en curso en el chat, dedupe por `chat|url` 10 min, y para YouTube `getInfo` con `duration <= 180` y no playlist.
- `handleAutoDownload(conn, m, text)`: `extractUrl` + `downloadAuto` + `sendMedias` (máx. 5), con el chat marcado ocupado mientras dura.

### src/plugins/download-platform.ts (nuevo) y los 6 download-<plataforma>.ts
- `createDownloadPlugin({commands, platform, urlRegex, help, maxMedias})` y tabla tiktok/instagram/facebook/twitter/pinterest/threads. URL del texto o del citado (incluido caption de video via `getQuotedText`), progreso solo con reacciones ⏳ -> ✅/❌, un único mensaje de error humano. Si el texto trae una URL que no es de la plataforma, lo dice. Pinterest sin alias `pin` (colisionaba con `/pin` de grupos) y sin búsqueda.
- `platformDownloadPlugins`: lista `[nombre, plugin]` lista para `index.ts`.
- Los archivos `download-tiktok.ts`, `-instagram`, `-facebook`, `-twitter`, `-pinterest`, `-threads` **no se borraron**: quedaron como re-export de una línea marcado `@deprecated`, porque `plugins/index.ts` (ajeno) los importa y el `tsc` debía seguir pasando. Bórralos al migrar el import (ver abajo).

### src/plugins/download-universal.ts
- `/dl <url> [audio|hd|low]` (hd = best) con alias `download`, `descargar`, `bajar`, `ytmp4`; `/audio` y `/mp3` (alias `ytmp3`) como modo audio, ya sin `musica`/`music` (colisionaban con `/play`). `parseDownloadArgs` exportada y testeada.
- `/dlstatus` muestra `/health` real (estado, versión, yt-dlp, uptime, cola).
- `/cobalt` eliminado: `cobaltPlugin` sigue exportado como stub `@deprecated` con `command: []` (no registra ningún alias) hasta que `index.ts` deje de importarlo.
- Ya no convierte video en el bot: el servicio garantiza mp4 H.264/AAC.

### src/plugins/media-play.ts (sin play-dl ni ytdl-core)
- `/play <nombre>` -> `search(limit 1)` en YouTube, responde "Encontré: *título* (m:ss)" antes de bajar, rechaza `duration > 1200 s`, `downloadMedia(url, {audioOnly:true})`, envía `audio/mpeg` con `fileName` = título.mp3. `/play <url>` -> `getInfo` (rechaza playlists) + descarga. `/play sc <nombre>` responde que SoundCloud no está disponible (el servicio no tiene `scsearch`). Alias `musica`, `music`, `song`, `cancion`.
- `formatDuration` exportada (la usa `/info`).

### Nuevos plugins
- `media-info.ts`: `/info <url>` -> título, autor, duración (o nº de elementos si es playlist), plataforma; miniatura via `fetchMedia` (5 MB, 15 s) si la hay.
- `media-tomp3.ts`: `/tomp3` (alias `toaudio`) sobre video citado o propio -> `extractAudioFromVideo` mp3; avisa si supera 16 MB.
- `media-comprimir.ts`: `/comprimir` (alias `compress`, `compactar`) -> `compressVideo` crf 30 / 480p, caption con "antes -> después (N% menos)".

### Stickers
- `sticker-sticker.ts`: `/s` recorta, `/s full` sin recorte, `/s <pack>|<autor>`, `/s <url>` via `fetchMedia` (5 MB, 15 s, exige `image/*`), citado sticker -> solo `addExif` (alias `/steal`, `/robar`). Textos coherentes: videos de hasta 8 s y 5 MB. `parseStickerArgs` exportada.
- `sticker-toimg.ts`: via `getQuotedOrOwnMedia(['sticker'])`.
- `sticker-tovideo.ts`: fábrica `createStickerConvertPlugin`; animación detectada por bytes (`isAnimatedWebp`), no por el flag del mensaje; `/togif` envía video con `gifPlayback` y solo con la palabra `file`/`archivo` manda el `.gif` como documento.

### src/plugins/tools-tts.ts
- Idioma solo explícito: `en: texto` o `-en texto` con código de `LANGUAGES`; todo lo demás es español (antes "la casa" se leía en latín). `/tts idiomas` lista. `fetchWithTimeout` 15 s + `BROWSER_USER_AGENT` compartido. El texto citado incluye caption de video. `parseTtsInput`, `splitTtsChunks`, `getTtsAudio` exportadas.

### Otros
- `package.json`/`package-lock.json`: `npm uninstall play-dl @distube/ytdl-core`.
- `.env.example`: añadidos `DOWNLOADER_API_KEY` y `TMP_DIR`; corregido el comentario de `DOWNLOADER_API_URL` (ya no hay "scrapers públicos"). El default `DOWNLOADER_API_TIMEOUT_MS=30000` no se tocó (ver petición a config).
- Tests nuevos: `descargas-client` (servidor `node:http` falso: éxito con 3 imágenes, audio, 422 LOGIN_REQUIRED, 401, 413, 502 HTML, info/search/health, cabecera y body), `descargas-media-send` (abort por tamaño, content-length excesivo, HTML, SSRF, mimetypes, `sendMedias` con mock de `conn`), `descargas-url` (detectPlatform, extractUrl, regex por plataforma, parseDownloadArgs), `descargas-tts`, `descargas-sticker-detect` (webp VP8X/ANIM, jpeg, png, gif, mp4, webm, `mediaInMessage`).

## Para otros agentes

### src/plugins/index.ts (dueño: núcleo)
Quitar estos imports:
```ts
import { tiktokPlugin } from './download-tiktok.js';
import { instagramPlugin } from './download-instagram.js';
import { facebookPlugin } from './download-facebook.js';
import { twitterPlugin } from './download-twitter.js';
import { pinterestPlugin } from './download-pinterest.js';
import { threadsPlugin } from './download-threads.js';
import { universalDownloadPlugin, cobaltPlugin, audioDownloadPlugin, downloadStatusPlugin } from './download-universal.js';
```
Poner en su lugar:
```ts
import { platformDownloadPlugins } from './download-platform.js';
import { universalDownloadPlugin, audioDownloadPlugin, downloadStatusPlugin } from './download-universal.js';
import { mediaInfoPlugin } from './media-info.js';
import { toMp3Plugin } from './media-tomp3.js';
import { comprimirPlugin } from './media-comprimir.js';
```
En `ENTRIES.media` sustituir las líneas `['download-tiktok', tiktokPlugin]` ... `['download-status', downloadStatusPlugin]` por:
```ts
    ['media-tomp3', toMp3Plugin],
    ['media-comprimir', comprimirPlugin],
    ...platformDownloadPlugins,
    ['download-universal', universalDownloadPlugin],
    ['download-audio', audioDownloadPlugin],
    ['download-info', mediaInfoPlugin],
    ['download-status', downloadStatusPlugin],
```
(`download-cobalt` desaparece.) Después: borrar `src/plugins/download-{tiktok,instagram,facebook,twitter,pinterest,threads}.ts` y el export `cobaltPlugin` de `download-universal.ts`. Nota: `/video` (alias de `tovideo`) y `/gif` siguen igual que antes.

### src/plugins/menu.ts (dueño: núcleo)
- Quitar la entrada `cobalt` (lista de la línea ~94 y objeto ~356) y `'cobalt'` de `commands` de la sección `download`.
- `pinterest`: `aliases: []`, `desc: 'Descargar un pin de Pinterest'`, `usage: '/pinterest <url>'`.
- `play`: `usage: '/play <nombre o URL>'`, `desc: 'Buscar en YouTube y enviar el audio'`.
- `dl`: `aliases: ['download', 'descargar', 'bajar', 'ytmp4']`, `usage: '/dl <url> [audio|hd|low]'`.
- Añadir en "Descargas": `audio: { cmd: 'audio', aliases: ['mp3', 'ytmp3'], desc: 'Solo el audio (mp3) de un enlace', usage: '/audio <url>' }`, `info: { cmd: 'info', aliases: ['videoinfo'], desc: 'Título, autor y duración de un enlace', usage: '/info <url>' }`, `dlstatus: { cmd: 'dlstatus', aliases: ['downloadstatus'], desc: 'Estado del servicio de descargas', usage: '/dlstatus' }` y sumarlos a `commands` de `download`.
- Añadir en "Media": `tomp3: { cmd: 'tomp3', aliases: ['toaudio'], desc: 'Audio mp3 de un video', usage: '/tomp3 (responder a video)' }`, `comprimir: { cmd: 'comprimir', aliases: ['compress'], desc: 'Comprimir un video a 480p', usage: '/comprimir (responder a video)' }`, y en `s` añadir `usage: '/s [full] [pack|autor] (responder a imagen/video o URL)'` y alias `steal`; sumar `tomp3`, `comprimir` a `commands` de `media`.
- `tts`: `usage: '/tts <texto> | /tts en: <texto> | /tts idiomas'`.

### src/handler.ts (dueño: núcleo) — reemplazo de handleAutoDownload
1. Cambiar `import { downloadAuto, detectPlatform, type Platform } from './lib/downloaders.js';` por `import { handleAutoDownload } from './lib/autodownload.js';`.
2. Borrar `private static readonly URL_REGEX`, `private static readonly PLATFORM_NAMES` y el método completo `private async handleAutoDownload(m, rawMessage)` (líneas ~487-565).
3. En el bloque "AUTO-DOWNLOADER" sustituir `await this.handleAutoDownload(m, rawMessage);` por `await handleAutoDownload(this.conn, m, m.text);`. Si se prefiere no esperar la descarga en el hilo del handler: `void handleAutoDownload(this.conn, m, m.text);` (la función ya captura sus errores y limita a 1 descarga por chat).
4. En `serializeMessage`, el `text` del citado debería incluir `quotedMsg.videoMessage?.caption || quotedMsg.documentMessage?.caption` (o usar `getText` de `wa-message.ts`). Mientras no esté, `src/lib/media.ts#getQuotedText(m)` lo lee por su cuenta.
5. `createSticker(mediaBuffer, { packname, author, categories })` del auto-sticker sigue siendo válido. Si se quiere respetar `CONFIG.botName`, usar `packname: CONFIG.botName`.

### src/config.ts (dueño: núcleo)
Añadir a `CONFIG`:
```ts
  downloaderApi: {
    url: process.env.DOWNLOADER_API_URL || '',
    /** Las descargas tardan más de 30 s; el cliente aplica además un mínimo de 120 s. */
    timeout: envInt('DOWNLOADER_API_TIMEOUT_MS', 120_000),
    /** Cabecera x-api-key si el servicio define DOWNLOADER_API_KEY. */
    apiKey: process.env.DOWNLOADER_API_KEY || '',
  },
  /** Temporales de ffmpeg (stickers, conversiones). */
  tmpDir: process.env.TMP_DIR || join(process.cwd(), 'tmp'),
```
y actualizar el comentario "API local opcional de descargas (dev3-downloader)" por "Servicio propio de descargas (downloader/)". Cuando exista, cambiar en `src/lib/downloader-client.ts#authHeaders` `process.env.DOWNLOADER_API_KEY` por `CONFIG.downloaderApi.apiKey` y en `src/lib/ffmpeg.ts` `TMP_DIR` por `CONFIG.tmpDir`. Subir también `DOWNLOADER_API_TIMEOUT_MS=120000` en `.env.example`.

### src/lib/cleanup-scheduler.ts (dueño: núcleo)
- Eliminar `runPlayDlSweep`, `playDlSweepInterval` y su mención en el log/encabezado: `play-dl` ya no está instalado.
- `runTmpSweep` debe barrer `CONFIG.tmpDir` (o `TMP_DIR` de `src/lib/ffmpeg.ts`) en vez de `join(process.cwd(), 'tmp')`. Los temporales de esta área tienen la forma `<ms>_<hex>_<n>.<ext>` y carpetas `frames_*`; el sweep debería borrar también directorios viejos (`rm(dir, {recursive:true})`).

### src/plugins/group-autodownload.ts (dueño: grupos)
Texto de activación y de estado: "Los enlaces de TikTok, Instagram, Facebook, Twitter/X, Pinterest, Threads y YouTube (videos de hasta 3 min) se descargan solos. Un mismo enlace se ignora durante 10 min y solo hay una descarga a la vez por grupo." Si `DOWNLOADER_API_URL` está vacío conviene avisar al activar: `import { isDownloaderConfigured, NOT_CONFIGURED_MESSAGE } from '../lib/downloader-client.js'`.

### src/lib/ai.ts y src/lib/anti-delete.ts (dueños: IA / núcleo)
Ambos tienen su propia llamada a `downloadMediaMessage(..., { logger: console as never, reuploadRequest })`. Pueden usar `downloadMessageMedia(conn, msg)` de `src/lib/media.ts` (o `downloadMedia` de `src/lib/wa-message.ts`, que es equivalente; conviene dejar una sola de las dos: propongo que `media.ts` delegue en `wa-message.ts` cuando ese archivo esté estable).

### src/types/node-webpmux.d.ts (dueño: núcleo)
Ampliar la declaración con lo que usa `sticker.ts` (hoy lo tipa localmente con un cast):
```ts
declare module 'node-webpmux' {
  export interface AnimFrame { x: number; y: number; width: number; height: number; delay: number; blend: boolean; dispose: boolean }
  export class Image {
    exif: Buffer | null;
    readonly hasAnim: boolean;
    readonly frames: AnimFrame[] | undefined;
    load(buffer: Buffer): Promise<void>;
    save(path: string | null): Promise<Buffer>;
    demux(options: { buffers: true; frame?: number }): Promise<Buffer[]>;
  }
}
```

### src/lib/fetch-media.ts (dueño: núcleo)
`media-send.ts`, `media-info.ts`, `sticker-sticker.ts` y `http.ts` importan `fetchMedia`, `isPrivateHost` y los tipos `FetchedMedia`/`FetchMediaOptions`. Si cambia la firma, avisar o actualizar esos cuatro archivos.

## Para el servicio downloader

- **Búsqueda en SoundCloud**: `GET /v1/search?q=&limit=&source=soundcloud`. Parche en `downloader/src/routes.ts#handleSearch`:
  ```ts
  const source = query.get('source') ?? 'youtube';
  if (!['youtube', 'soundcloud'].includes(source)) throw new DownloadError('BAD_REQUEST', 'source debe ser youtube o soundcloud');
  const results = await searchMedia(app.config, q, limit, source as 'youtube' | 'soundcloud', deadline);
  ```
  y en `downloader/src/ytdlp.ts` generalizar `searchYoutube` a `searchMedia(config, query, limit, source, deadline)` usando el prefijo `scsearch${n}:` para SoundCloud (mismo `--flat-playlist -J`; `webpage_url`/`url` de cada entrada). En el bot basta añadir `'soundcloud'` a `SEARCH_SOURCES` en `src/lib/downloader-client.ts` y `/play sc <nombre>` empieza a funcionar.
- **Búsqueda de Pinterest** (`source=pinterest`): se retiró del bot. yt-dlp no busca en Pinterest; si se quiere, el servicio tendría que consultar `https://www.pinterest.com/resource/BaseSearchResource/get/` directamente. No es prioritario.
- `README.md` del servicio recomienda `DOWNLOADER_API_TIMEOUT_MS=120000` para el bot; el cliente ya fuerza ese mínimo.

## Decisiones

- **Los 6 archivos de plataforma no se borraron** sino que son re-exports `@deprecated` de una línea: borrar rompía `plugins/index.ts` (ajeno) y la regla era que `tsc` pasase en todo momento. Igual con `cobaltPlugin` (stub con `command: []`, que no registra alias).
- **`fetchMedia` del núcleo** en lugar de uno propio: `src/lib/fetch-media.ts` ya existía con exactamente el comportamiento pedido (timeout, ok, HTML, corte por bytes, SSRF con excepción para el host del servicio). Evité duplicar; `http.ts` re-exporta `isPrivateHost` de ahí.
- **`sendMedias` devuelve `{sent, total, errors}`** y no solo un número: los plugins necesitan el motivo del primer fallo para el único mensaje de error humano.
- **Pinterest búsqueda retirada**: no hay forma estable de consultar pinterest.com sin intermediarios con un simple fetch (exige cookies/CSRF y cambia a menudo); mejor en el servicio si algún día interesa.
- **SoundCloud**: el servicio no tiene `scsearch`; `/play sc` responde que no está disponible en vez de fingir con resultados de YouTube.
- **`/tomp3` produce mp3** (libmp3lame) y no m4a: WhatsApp lo muestra como audio normal en todos los dispositivos y coincide con lo que entrega el servicio con `audioOnly`.
- **Stickers animados -> video/gif/imagen via node-webpmux + concat**: ffmpeg 5.x/6.x (Debian/Ubuntu, imagen `node:22-slim`) no decodifica WebP animado; sin esto `/tovideo`, `/togif` y `/toimg` nunca funcionaban con stickers animados.
- **Detección de plataforma por host** y no por subcadena, para que `example.com/?u=x.com/...` no se trate como Twitter.
- **El bot ya no recodifica videos descargados**: el servicio los entrega en H.264/AAC mp4 (`ensureWhatsappCompatible` en el servidor). `ensureWhatsAppCompatible` del bot queda para media de usuarios (`/comprimir`, futuro uso).
- `detectPlatform`/`Platform` conservan los 8 valores porque `handler.ts` tiene un `Record<Platform, string>` que fallaría al añadir miembros.

## Pendiente

- `npx tsc --noEmit` fallaba al cerrar en archivos ajenos en edición simultánea: `src/lib/ai.ts` (`peekBettingSystem` no existe en `BettingStore`) y `rpg-duelo.ts`/`rpg-dungeon.ts`/`rpg-dungeon-interactivo.ts` (importan `applyDeathPenalty`/`generateIMSSMessage` que `rpg-bombardear.ts` ya no exporta). Antes falló en `game-trivia.ts` y `social.ts` y ambos se resolvieron solos. Ningún error en archivos de esta área (se repitió tres veces con 30 s o más entre intentos).
- Todo lo listado en "Para otros agentes": hasta que `index.ts` migre, los comandos nuevos `/info`, `/tomp3`, `/comprimir` existen pero no están registrados, y `/cobalt` sigue importado como stub.
- `/play sc` y `source=soundcloud` dependen del parche al servicio.
- Las regex de cada plataforma viven en la tabla de `download-platform.ts` y se prueban copiándolas en `tests/descargas-url.test.ts`; si alguien las cambia, actualizar el test (o exportar la tabla).
