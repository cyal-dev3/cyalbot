# Handoff: área descargas y media

Estado al cierre (ronda de corrección): `npx tsc --noEmit` pasa en todo el repo. Los 34 tests de esta área (`tests/descargas-*.test.ts`, 7 archivos; `descargas-ffmpeg` usa ffmpeg real y se omite solo si no está instalado) pasan; en `npm test` fallaban al cerrar únicamente `tests/rpgprog-actions.test.ts` y `tests/rpgprog-robar.test.ts`, cuyos archivos (`src/lib/rpg-actions.ts`, `src/plugins/rpg-robar.ts`) estaba editando el agente de RPG en ese momento (se repitió a los 30 s con el mismo resultado; no tocan nada de esta área).

### Ronda de corrección (revisión adversarial)
Corregido:
- **Alias `steal`/`robar` de `/s`** colisionaban con `rpg-robar` (el primer plugin registrado gana el alias): quitados; el alias nuevo es `stealsticker` y `/s` respondiendo a un sticker ya hacía solo `addExif`. Ayuda y `usage` actualizados.
- **`/info` colisionaba con `rpg-inventario` (`iteminfo`)**: el plugin `media-info.ts` pasa a `['videoinfo', 'linkinfo', 'dlinfo']`.
- **`/comprimir` con alto impar <= 480** (`scale=-2:'min(480,ih)'` dejaba alto impar y libx264/yuv420p fallaba): ahora `scale=-2:'trunc(min(480,ih)/2)*2'`. Test con un mp4 de 640x361.
- **WebP animado como entrada de `createSticker`** (`/s <url>` de un .webp animado o enviado como imagen/documento): `videoToSticker` pasaba el .webp a `-i` y ffmpeg no lo decodifica. Ahora `mediaInputArgs` (antes `stickerInputArgs`) sirve para cualquier entrada y demuxa con node-webpmux cuando es WebP animado. Test: `createSticker(videoToSticker(mp4))`.
- **Topes de 100 KB / 500 KB garantizados**: `encodeUntilFits` ya no devuelve el último buffer si ninguno cabe; hay más escalones (estáticos hasta calidad 5; animados añaden `8 fps/q10/5 s` y `6 fps/q5/3 s`, sin bajar de 512x512 porque WhatsApp lo exige) y, si aun así no cabe, lanza `StickerTooLargeError` ("El sticker sigue pesando N KB tras N intentos...") que `replyMediaError` muestra tal cual. Verificado con un video de ruido de 8 s: antes entregaba 9,8 MB; ahora responde con ese error.
- **Reserva de "1 descarga por chat" atómica**: `shouldAutoDownload` marca el chat ocupado en el mismo tick que pasa las comprobaciones sincrónicas (antes del `getInfo` de YouTube) y lo libera si YouTube no cumple; si devuelve `true` el chat queda reservado y se libera con `releaseAutoDownload(chat)` (lo hace `handleAutoDownload` en `finally`). Test: dos enlaces de YouTube en paralelo al mismo chat -> una sola llamada a `/v1/info` y a `/v1/download`.
- **Timeout que no cubría el cuerpo**: `request()` y `health()` usan `fetchTextWithTimeout` (nuevo en `http.ts`), que mantiene el timer hasta leer el body. Un servidor que manda cabeceras y se cuelga a mitad del JSON ahora devuelve `TIMEOUT`. Test con `/hang`.
- **`describeDownloadError('TOO_LARGE')`** solo extrae el tamaño de "pesa (unos) N MB" (formato de `routes.ts`) y solo si N > 60; "El archivo supera el maximo de 60 MB" o "El body supera 64 KB" dan el texto genérico.
- **Host de Pinterest acotado**: `pinterest\.(com|xx|co.xx|com.xx)` y `pin.it`; `pinterest.evil.com` ya es `unknown` (y la regex de `/pinterest` igual).
- **Regresión de enlaces sin esquema**: `URL_REGEX` acepta, además de cualquier `http(s)://`, enlaces a plataformas conocidas sin esquema (`vm.tiktok.com/x`, `youtube.com/watch?v=`); las regex de la tabla tienen `(?:https?:\/\/)?`; `extractUrl` devuelve siempre la URL con `https://` (`normalizeUrl`) y `downloadAuto` también normaliza. La tabla se exporta como `PLATFORM_SPECS` y el test la importa en vez de copiar las regex.
- **`/play` sin argumentos respondiendo a un texto sin enlace** buscaba `''` (BAD_REQUEST): ahora usa el texto citado (hasta 120 caracteres) como búsqueda.
- **`/tts en:` o `/tts -en` respondiendo a un mensaje** leían "en:" en español: `parseTtsInput` admite código sin texto (`{lang:'en', text:''}`) y el plugin toma el citado en ese idioma.
- **`-fps_mode`** (ffmpeg >= 5.1): `videoToSticker` ya no lo necesita (el filtro `fps` deja la salida a ritmo constante) y `stickerToVideo` usa `-vsync vfr` (válido en 4.4 y posteriores). Versión mínima de ffmpeg: 4.4 (la imagen Docker trae 5.1).
- **Handoff**: la sección de `handler.ts` estaba obsoleta (el núcleo ya aplicó el reemplazo) y la de `menu.ts` también (el menú ahora se genera del registro); reescritas.
- Tests añadidos a `descargas-media-send` para IPv4 mapeada en IPv6 (`[::ffff:7f00:1]`, `[::ffff:a9fe:a9fe]`) y redirecciones a hosts privados: las dos correcciones las hizo ya el núcleo en `src/lib/fetch-media.ts` (`mappedV4` hex y `fetchFollowing` con `redirect: 'manual'`); los tests fijan aquí la dependencia.

No cambiado (hallazgo correcto pero fuera de mi alcance o ya documentado): los seis `download-<plataforma>.ts` siguen como re-exports `@deprecated` y `cobaltPlugin` como stub porque `plugins/index.ts` (ajeno) los importa; borrar al migrar el import (ver "Para otros agentes").

El bot ahora usa el servicio propio `downloader/` como única fuente de descargas. Se eliminaron los 23 scrapers de terceros, Cobalt, `play-dl` y `@distube/ytdl-core`. Pipeline de media reescrito sobre `execFile` con timeouts y temporales que siempre se borran. Probado con ffmpeg 6.1 real (sticker estático, animado desde mp4 y webm, toimg/tovideo/togif de sticker animado, needsConversion, extracción mp3, compresión 480p; sin temporales huérfanos).

## Hecho

### src/lib/downloader-client.ts (nuevo)
- Cliente del contrato HTTP de `downloader/`: `downloadMedia(url, {audioOnly?, quality?})`, `getInfo(url)`, `search(q, {limit?, source?})`, `health()`.
- Comprueba `response.ok`, parsea el body con tolerancia (un 502 HTML del proxy devuelve `INTERNAL` con `status: 502`), mapea `type` 1:1 (`video|audio|image`), propaga `medias[]` con `size`, `title`, `author`, `duration`, `thumbnail`. Códigos desconocidos (p. ej. el nuevo `CLIENT_CLOSED` del servicio) caen en `INTERNAL`.
- Resultado discriminado `ClientResult<T> = {success:true, data} | {success:false, code, message, status?}`.
- `describeDownloadError(code, {message?, sizeBytes?})` y `describeFailure(failure)` -> texto humano (LOGIN_REQUIRED, TOO_LARGE con "pesa N MB, el máximo es 60 MB" leyendo N del mensaje del servicio o de `sizeBytes`, TIMEOUT, RATE_LIMITED, UNSUPPORTED, NOT_FOUND, UNAUTHORIZED, INTERNAL).
- Cabecera `x-api-key` desde `process.env.DOWNLOADER_API_KEY` si está definida. Timeout de descarga `Math.max(CONFIG.downloaderApi.timeout, 120000)`; info/search 60 s; health 5 s.
- `request()` y `health()` leen el cuerpo dentro del mismo timeout (`fetchTextWithTimeout`); `connectionFailure` traduce abort -> `TIMEOUT`, resto -> `INTERNAL`.
- `isDownloaderConfigured()` y `NOT_CONFIGURED_MESSAGE` ("Las descargas no están configuradas en este bot (DOWNLOADER_API_URL)."). Todos los comandos lo comprueban antes de reaccionar.
- `SEARCH_SOURCES = ['youtube']`: `search(q, {source:'soundcloud'})` devuelve `UNSUPPORTED` sin llamar al servicio (hoy `/v1/search` solo hace `ytsearch`). Cuando el servicio soporte `source`, basta añadir la fuente a la constante.

### src/lib/downloaders.ts (1157 -> 115 líneas)
- Quedan: tipos `DownloadResult`/`MediaItem` (con `size`), `Platform` (mismos 8 miembros, porque `handler.ts` tiene un `Record<Platform, string>`), `PLATFORMS: Record<Platform,{name, emoji}>`, `platformLabel(p)`, `normalizeUrl(url)` (antepone `https://`), `detectPlatform(url)` por **host** de la URL (acepta `threads.com`, `fb.com`, `vt.tiktok.com`, `instagram.com/<user>/reel`, `/share`, `x.com/i/status`, `pinterest.com|.xx|.co.xx|.com.xx`, `pin.it`, `instagr.am`; `?u=x.com` ya no engaña, `pinterest.evil.com` tampoco), `URL_REGEX` (cualquier URL con esquema o enlace sin esquema a una plataforma conocida), `extractUrl(text, quotedText?, regex?)` (devuelve `match[0]` sin puntuación final y con esquema), `downloadAuto(url, {audioOnly?, quality?})` que llama al cliente una sola vez para cualquier plataforma incluida `unknown` y traduce el fallo a `error` humano + `code`.
- Eliminados: los 23 scrapers, `downloadWithDev3Api`, `isDev3ApiAvailable`, `downloadWithCobalt`, `CobaltOptions`, `searchPinterest`, `description`.
- `handler.ts` sigue compilando: usa `downloadAuto(url)`, `detectPlatform`, `Platform` con la misma forma.

### src/lib/http.ts (nuevo)
- `BROWSER_USER_AGENT`, `fetchWithTimeout(url, {timeoutMs, ...init})` (AbortController, respeta una `signal` externa), `fetchTextWithTimeout` (igual pero el timer cubre también `response.text()`) y re-exporta `isPrivateHost` de `fetch-media.ts`.

### src/lib/media-send.ts (nuevo)
- `LIMITS = {video: 64 MB, audio: 16 MB, image: 16 MB}`, `mimetypeFor(type, filename?, fetchedMime?)` (mp3 -> `audio/mpeg`, m4a -> `audio/mp4`, ogg/opus -> `audio/ogg`; video siempre `video/mp4`; imagen por el content-type real), `formatMb`.
- `fetchMedia` **se reutiliza de `src/lib/fetch-media.ts`** (el agente de núcleo ya lo creó: AbortController, `response.ok`, rechazo de `text/html`, corte del stream al superar `maxBytes`, rechazo de hosts privados salvo el de `DOWNLOADER_API_URL`). No se duplicó; `media-send.ts` lo re-exporta.
- `sendMedias(conn, m, medias, {caption?, limit?, fileName?, timeoutMs?, trackMessage?})` -> `{sent, total, errors[]}`: comprueba `media.size` contra el límite antes de bajar, mimetype por tipo real, caption solo en el primero (para audio lo manda como texto aparte), cita el mensaje original y llama a `trackMessage(key)` por cada envío para `/clear`.

### src/lib/ffmpeg.ts (nuevo)
- `runFfmpeg(args, {timeoutMs=60000})` (siempre `-y`), `runFfprobe(args, {timeoutMs=15000})`, ambos con `execFile`, `-hide_banner -loglevel error` (`-nostdin` solo en ffmpeg: ffprobe no lo acepta), `maxBuffer` 4 MB, `killSignal: SIGKILL`. Errores como `FfmpegError{tool, timedOut}` con la última línea de stderr ("ffmpeg no está instalado" en ENOENT).
- `TMP_DIR = process.env.TMP_DIR || join(cwd,'tmp')`, `ensureTmpDir()`, `withTempFiles(exts, fn)` y `withTempDir(fn)` (para secuencias de fotogramas); ambos borran siempre.

### src/lib/video-converter.ts (reescrito)
- `probeVideo(path)` -> un único ffprobe JSON con códec de video y audio, `pix_fmt`, contenedor, dimensiones y duración. `isWhatsAppCompatible(probe)` = h264 + yuv420p + (sin audio o aac) + contenedor mp4. `needsConversion(buffer)`.
- `ensureWhatsAppCompatible(buffer, force=false)` escribe el temporal una vez, inspecciona y recodifica sobre ese mismo temporal solo si hace falta. `convertVideoForWhatsApp(buffer, {crf, maxHeight})` fuerza dimensiones pares también con `maxHeight` (`trunc(min(h,ih)/2)*2`), `compressVideo(buffer)` (crf 30, 480p), `extractAudioFromVideo(buffer, 'mp3'|'m4a')` (mp3 por defecto con libmp3lame).
- Eliminado `forceConvertForWhatsApp` (solo lo usaba el plugin universal, que ya no convierte: el servicio entrega mp4 H.264/AAC).

### src/lib/sticker.ts (reescrito)
- `detectMedia(buffer)` -> `{mime, ext, kind: image|video|unknown, animated}`; `isAnimatedWebp(buffer)` exportada (flag de VP8X o chunk ANIM). Quitadas la rama MKV inalcanzable, el heurístico "pesa más de 50 KB y tiene moov", `isAiSticker` y el `export default`.
- `imageToSticker(buffer, meta, {crop})` reintenta calidades 90/75/60/45/30/15/5 hasta <= 100 KB; `videoToSticker` reintenta (fps, calidad, segundos) 15/60/8, 12/45/8, 10/30/8, 8/20/8, 8/10/5, 6/5/3 hasta <= 500 KB. Si ningún intento cabe lanza `StickerTooLargeError` (texto para el usuario incluido) en vez de entregar un sticker que WhatsApp rechaza. `createSticker(buffer, meta, {crop})` elige por el contenido real.
- `mediaInputArgs(buffer, dir)` prepara la entrada de ffmpeg para cualquier formato: ffmpeg (hasta 7.0, el de Debian/Ubuntu) **no decodifica WebP animado**, así que esos se separan en fotogramas con node-webpmux (`demux({buffers:true})`) y se pasan como lista `concat` con la duración real de cada fotograma. Lo usan `imageToSticker`, `videoToSticker` (un WebP animado que llega como imagen/URL se re-encodea) y `stickerToImage/Video/Gif`. Antes estas tres últimas fallaban con "Nothing was written into output file" para cualquier sticker animado.
- Sin `-fps_mode` (ffmpeg >= 5.1): `stickerToVideo` usa `-vsync vfr`; funciona con ffmpeg 4.4+.
- `addExif` carga node-webpmux tolerando que la clase venga en `default` (CJS bajo tsx fallaba con "Image is not a constructor").
- `StickerMetadata` sin `isAiSticker`; `createSticker(buffer, {packname, author, categories})` como lo llama `handler.ts` sigue igual.

### src/lib/media.ts (nuevo)
- `mediaInMessage(message)` -> `{kind, mimetype, isAnimated, declaredSize}` (documento clasificado por su mimetype), `getQuotedText(m)` (incluye caption de video y documento citados), `downloadMessageMedia(conn, {key, message})`, `getQuotedOrOwnMedia(ctx, kinds, {maxBytes})` (citado primero, luego el propio; lanza `MediaTooLargeError` antes de descargar si `fileLength` supera el tope), `replyMediaError(m, error, fallback)`.
- Sustituye las 7 copias de `downloadMediaMessage(..., {logger: console as any, reuploadRequest})` que había en los plugins de sticker.

### src/lib/autodownload.ts (nuevo)
- `shouldAutoDownload(chat, url)`: servicio configurado, plataforma conocida, sin otra descarga en curso en el chat, dedupe por `chat|url` 10 min (todo sincrónico y, si pasa, **reserva el chat en el mismo tick**), y para YouTube `getInfo` con `duration <= 180` y no playlist (si falla, libera). Si devuelve `true` el llamador libera con `releaseAutoDownload(chat)`.
- `handleAutoDownload(conn, m, text)`: `extractUrl` + `shouldAutoDownload` + `downloadAuto` + `sendMedias` (máx. 5), liberando el chat en `finally`.

### src/plugins/download-platform.ts (nuevo) y los 6 download-<plataforma>.ts
- `createDownloadPlugin({commands, platform, urlRegex, help, maxMedias})` y tabla `PLATFORM_SPECS` tiktok/instagram/facebook/twitter/pinterest/threads (regex con esquema opcional, como los comandos antiguos). URL del texto o del citado (incluido caption de video via `getQuotedText`), progreso solo con reacciones ⏳ -> ✅/❌, un único mensaje de error humano. Si el texto trae una URL que no es de la plataforma, lo dice. Pinterest sin alias `pin` (colisionaba con `/pin` de grupos) y sin búsqueda.
- `platformDownloadPlugins`: lista `[nombre, plugin]` lista para `index.ts`.
- Los archivos `download-tiktok.ts`, `-instagram`, `-facebook`, `-twitter`, `-pinterest`, `-threads` **no se borraron**: quedaron como re-export de una línea marcado `@deprecated`, porque `plugins/index.ts` (ajeno) los importa y el `tsc` debía seguir pasando. Bórralos al migrar el import (ver abajo).

### src/plugins/download-universal.ts
- `/dl <url> [audio|hd|low]` (hd = best) con alias `download`, `descargar`, `bajar`, `ytmp4`; `/audio` y `/mp3` (alias `ytmp3`) como modo audio, ya sin `musica`/`music` (colisionaban con `/play`). `parseDownloadArgs` exportada y testeada.
- `/dlstatus` muestra `/health` real (estado, versión, yt-dlp, uptime, cola).
- `/cobalt` eliminado: `cobaltPlugin` sigue exportado como stub `@deprecated` con `command: []` (no registra ningún alias) hasta que `index.ts` deje de importarlo.
- Ya no convierte video en el bot: el servicio garantiza mp4 H.264/AAC.

### src/plugins/media-play.ts (sin play-dl ni ytdl-core)
- `/play <nombre>` -> `search(limit 1)` en YouTube, responde "Encontré: *título* (m:ss)" antes de bajar, rechaza `duration > 1200 s`, `downloadMedia(url, {audioOnly:true})`, envía `audio/mpeg` con `fileName` = título.mp3. `/play <url>` -> `getInfo` (rechaza playlists) + descarga. `/play` sin texto respondiendo a un mensaje: usa su enlace o, si no tiene, su texto como búsqueda. `/play sc <nombre>` responde que SoundCloud no está disponible (el servicio no tiene `scsearch`). Alias `musica`, `music`, `song`, `cancion`.
- `formatDuration` exportada (la usa `/videoinfo`).

### Nuevos plugins
- `media-info.ts`: `/videoinfo <url>` (alias `linkinfo`, `dlinfo`; `info` lo tiene `rpg-inventario`) -> título, autor, duración (o nº de elementos si es playlist), plataforma; miniatura via `fetchMedia` (5 MB, 15 s) si la hay.
- `media-tomp3.ts`: `/tomp3` (alias `toaudio`) sobre video citado o propio -> `extractAudioFromVideo` mp3; avisa si supera 16 MB.
- `media-comprimir.ts`: `/comprimir` (alias `compress`, `compactar`) -> `compressVideo` crf 30 / 480p, caption con "antes -> después (N% menos)".

### Stickers
- `sticker-sticker.ts`: `/s` recorta, `/s full` sin recorte, `/s <pack>|<autor>`, `/s <url>` via `fetchMedia` (5 MB, 15 s, exige `image/*`), citado sticker -> solo `addExif` (alias `/stealsticker`; `steal`/`robar` son de `rpg-robar`). `StickerTooLargeError` se muestra al usuario via `replyMediaError`. Textos coherentes: videos de hasta 8 s y 5 MB. `parseStickerArgs` exportada.
- `sticker-toimg.ts`: via `getQuotedOrOwnMedia(['sticker'])`.
- `sticker-tovideo.ts`: fábrica `createStickerConvertPlugin`; animación detectada por bytes (`isAnimatedWebp`), no por el flag del mensaje; `/togif` envía video con `gifPlayback` y solo con la palabra `file`/`archivo` manda el `.gif` como documento.

### src/plugins/tools-tts.ts
- Idioma solo explícito: `en: texto` o `-en texto` con código de `LANGUAGES`; todo lo demás es español (antes "la casa" se leía en latín). `en:` o `-en` solos respondiendo a un mensaje leen el citado en ese idioma. `/tts idiomas` lista. `fetchWithTimeout` 15 s + `BROWSER_USER_AGENT` compartido. El texto citado incluye caption de video. `parseTtsInput`, `splitTtsChunks`, `getTtsAudio` exportadas.

### Otros
- `package.json`/`package-lock.json`: `npm uninstall play-dl @distube/ytdl-core`.
- `.env.example`: añadidos `DOWNLOADER_API_KEY` y `TMP_DIR`; corregido el comentario de `DOWNLOADER_API_URL` (ya no hay "scrapers públicos"). El default `DOWNLOADER_API_TIMEOUT_MS=30000` no se tocó (ver petición a config).
- Tests: `descargas-client` (servidor `node:http` falso: éxito con 3 imágenes, audio, 422 LOGIN_REQUIRED, 401, 413, 502 HTML, info/search/health, cabecera y body, servidor colgado a mitad del cuerpo), `descargas-media-send` (abort por tamaño, content-length excesivo, HTML, SSRF incluida IPv4 mapeada en IPv6 y redirecciones a privadas, mimetypes, `sendMedias` con mock de `conn`), `descargas-url` (detectPlatform, extractUrl con y sin esquema, `PLATFORM_SPECS`, parseDownloadArgs), `descargas-tts`, `descargas-sticker-detect` (webp VP8X/ANIM, jpeg, png, gif, mp4, webm, `mediaInMessage`), `descargas-autodownload` (reserva por chat, dedupe, dos YouTube en paralelo), `descargas-ffmpeg` (ffmpeg real: alto impar, WebP animado como entrada, sticker -> mp4/png; se omite sin ffmpeg).

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
El menú ya se genera desde el registro de plugins (`description`, `usage`, `category`), así que no hay tabla que editar: al registrar los plugins nuevos en `index.ts` aparecen solos en "Descargas" (`category: 'download'`) y "Media y stickers". Comprobar únicamente que no quede ninguna referencia textual a `/cobalt`, `/pin` o `/steal` en tips o textos fijos.

### src/handler.ts (dueño: núcleo) — ya aplicado, queda una sugerencia
El reemplazo de `handleAutoDownload` por `lib/autodownload.ts` ya está hecho (import en la línea ~11 y llamada en el bloque sin prefijo), y `serializeMessage` ya incluye el caption de video/documento del citado via `getText` de `wa-message.ts`. Solo queda opcional:
- La llamada es `await handleAutoDownload(this.conn, m, m.text)`, así que cada descarga automática (hasta 120 s+) bloquea el procesado del resto de mensajes. Se puede cambiar a `void handleAutoDownload(this.conn, m, m.text);`: la función captura sus errores y, con la reserva atómica por chat, dos enlaces seguidos del mismo chat no se bajan a la vez.
- `createSticker(mediaBuffer, { packname, author, categories })` del auto-sticker sigue siendo válido. Si se quiere respetar `CONFIG.botName`, usar `packname: CONFIG.botName`. Si `createSticker` lanza `StickerTooLargeError` (imagen que no cabe en 100 KB), basta ignorarla en el auto-sticker.

### src/plugins/rpg-robar.ts (dueño: RPG) — opcional
`steal` y `robar` se quedaron en el RPG. Si se prefiere que `/steal` sea el de stickers (como pedía la especificación original), quitar `'steal'` de `command` en `rpg-robar.ts` y añadirlo en `sticker-sticker.ts` (`command: ['s', 'sticker', 'stiker', 'stick', 'stealsticker', 'steal']`).

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

### src/plugins/group-toggles.ts (dueño: grupos) — `DEFS.autodownload.onText`
Texto de activación y de estado (hoy dice solo "se descargarán solos"): "Los enlaces de TikTok, Instagram, Facebook, Twitter/X, Pinterest, Threads y YouTube (videos de hasta 3 min) se descargan solos. Un mismo enlace se ignora durante 10 min y solo hay una descarga a la vez por grupo." Si `DOWNLOADER_API_URL` está vacío conviene avisar al activar: `import { isDownloaderConfigured, NOT_CONFIGURED_MESSAGE } from '../lib/downloader-client.js'`.

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
- Los mensajes `TOO_LARGE` del servicio tienen dos formas: "El archivo pesa (unos) N MB y el maximo es 60 MB" (con tamaño real) y "El archivo supera el maximo de 60 MB" (sin él). El bot solo lee N de la primera; si se unifica el formato, mantener "pesa N MB".

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
- **Alias de stickers**: en vez de pelear `steal`/`robar` con el RPG (que los tenía antes), `/s` sobre un sticker citado hace el "robo" y el alias largo es `stealsticker`; el cambio en RPG queda como opcional.
- **Stickers que no caben**: se lanza error en vez de bajar la resolución por debajo de 512x512 (WhatsApp rechaza otros tamaños) o entregar un archivo sobredimensionado; los dos escalones nuevos recortan duración (5 s y 3 s) antes de rendirse.
- **Enlaces sin esquema**: `URL_REGEX` solo acepta sin esquema hosts de plataformas conocidas (no cualquier `algo.tld/x`), para que el autodownloader no dispare con textos como "archivo.mp4/x"; con esquema acepta cualquiera, como antes.
- **`shouldAutoDownload` reserva el chat**: la alternativa (reservar en `handleAutoDownload` tras el `await`) dejaba la ventana del `getInfo` de YouTube abierta; a cambio la función exige `releaseAutoDownload` cuando devuelve `true`, documentado en el JSDoc.
- **`-vsync` en vez de `-fps_mode`**: compatible con ffmpeg 4.4 (Ubuntu 22.04) y aceptado (deprecated) en 5.x/6.x/7.x.

## Pendiente

- Todo lo listado en "Para otros agentes": hasta que `index.ts` migre, los comandos nuevos `/videoinfo`, `/tomp3`, `/comprimir` existen pero no están registrados, `/cobalt` sigue importado como stub y los seis `download-<plataforma>.ts` siguen como re-exports `@deprecated`.
- `/play sc` y `source=soundcloud` dependen del parche al servicio.
- `config.ts` sigue sin `downloaderApi.apiKey` ni `tmpDir`: `downloader-client.ts` lee `process.env.DOWNLOADER_API_KEY` y `ffmpeg.ts` `process.env.TMP_DIR` directamente.
- `cleanup-scheduler.ts` todavía tiene `runPlayDlSweep` y barre `join(cwd,'tmp')` en vez de `TMP_DIR`.
- No hay test automático del caso "ningún intento cabe" de `encodeUntilFits` (requiere un video de ruido de 512x512 y ~60 s de CPU); se verificó a mano con ffmpeg 6.1.
