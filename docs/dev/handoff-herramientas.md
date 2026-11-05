# Handoff: área herramientas, betting, Telegram e IA

Estado al cierre de la ronda de corrección: `npx tsc --noEmit` pasa en mis archivos (los únicos errores que aparecieron durante la ronda estaban en `rpg-items-especiales.ts` y `rpg-bombardear.ts`, de otro agente en edición). `npm test`: 377 tests, de los que 57 están en los 7 archivos `tests/herr-*.test.ts` (todos pasan); dos tests ajenos (`integracion-registry`, `rpgprog-economia`) fallaron una vez en la pasada completa por ediciones concurrentes y pasan al relanzarlos solos. La sección **Ronda de corrección** al final resume qué hallazgo se corrigió dónde.

Dependencias añadidas: `mathjs` y `qrcode` (dependencies) y `@types/qrcode` (devDependencies, necesario para compilar; el paquete no trae tipos).

## Hecho

### src/lib/rate-limit.ts (nuevo)
- `RateLimiter(max, windowMs)` de ventana deslizante con `try(key, now?) => { ok, retryInMs, remaining }`, `count(key)`, `reset(key)`, `undo(key)` (devuelve solo la última marca consumida, para acciones que no llegaron a ejecutarse) y `size`. Las claves sin marcas vigentes se borran en cada consulta para que el mapa no crezca. Lo usan `ai.ts` (cupo por usuario y aviso de "aquí solo respondo con /ia"), `tools-github.ts` y `telegram-queue.ts` (aviso de atasco una vez por 15 min).

### src/lib/ai.ts
- **Historial coherente**: `respondWithAI` llama `trimConversation(conv, 1)` (recorta dejando un hueco al turno nuevo) ANTES de medir `base = conv.messages.length` y de hacer el push; así `base` es la longitud real previa también con la conversación llena, y `rollback(conv, base)` en el `catch` y en `refusal` descarta exactamente este turno. Cuando la respuesta no es `tool_use`, al historial solo van los bloques de texto (un `tool_use` cortado por `max_tokens` sin `tool_result` invalidaría todas las llamadas siguientes); si no hay texto se vuelve a `base`. Si la API devuelve un 400 que menciona `tool_use`/`tool_result` (`isBrokenToolHistory`), se hace `resetMemory(chat)` para no dejar la conversación bloqueada hasta el TTL. Al agotar las 4 rondas de herramientas se añade un turno `assistant` con el texto de disculpa.
- `createMessage(params, chatId?)` y `textOf(response, separator?)` privados: las tres llamadas (`complete`, `askJSON`, `summarizeChat`) pasan por ahí; modelo, `betas`, `fallbacks` y `recordUsage` viven en un solo sitio.
- Herramientas nuevas: `hora_actual(zona)` (reusa `getTimeIn` de tools-hora), `buscar_wikipedia(consulta)` (reusa `getWikiSummary` de tools-wiki) y `pendientes_betting()` solo cuando el grupo tiene betting activo (`toolsFor(m)` lo decide con `db.betting.peekBettingSystem`). `runTool` recibe el `SerializedMessage` para saber chat y remitente.
- Límite por usuario con `RateLimiter`; cuando quedan ≤ 20 % de preguntas la respuesta termina con "_(te quedan N preguntas esta hora)_". Si el presupuesto diario está agotado se devuelve el hueco consumido (`reset`).
- `handleMention(req, aiChatEnabled)` nuevo: si el grupo tiene `aiChat` apagado responde una vez por hora y chat "Aquí solo respondo con /ia"; si está encendido llama a `respondWithAI`. **El handler todavía no lo usa** (ver "Para otros agentes").
- `getUsageSummary()` devuelve además `estimatedCostUsd` (`estimateCostUsd`: claude-opus-5-5 a $4/$20 por millón, cache read $0.20; la entrada no cacheada se cobra a $4) y `topChats` (3 chats que más tokens consumieron hoy, contador en memoria del proceso que se vacía al cambiar el día).
- `recordUsage` marca dirty con `db.markDirty()` en vez de `updateSettings` con el objeto completo.

### src/plugins/ai-chat.ts
- `createLogger('ia')` en vez de `console.error`; `/iastats` muestra gasto estimado y top 3 chats; `/iachat off` y los textos de ayuda usan `usedPrefix`; `/resumen` deja de "escribir" (`paused`) también si falla; `usage` en todos los plugins.

### src/plugins/tools-github.ts
- `makeIssueCommand({ kind, minChars, labels, titlePrefix })` genera `/bug` y `/feat`; al issue va `reporterLabel` = pushName + últimos 4 dígitos (`…1234`), nunca el JID del grupo ni el número completo; `issueTitle` aplana saltos de línea y recorta a 70 caracteres.
- `RateLimiter` 3/h por usuario y 20/día global; si GitHub falla se devuelve con `undo` solo el hueco de ese intento, al usuario y al cupo global (antes `reset` borraba toda la hora del usuario y el cupo global no se devolvía). `sanitizeForIssue` pone un espacio de ancho cero tras cada `@` (para no notificar a cuentas de GitHub desde el token del bot) y escapa `|`; se aplica a la descripción, al título y al `pushName` (que además se aplana a una línea). Funciona también en privado (se quitó `group: true`). Respuesta con `#numero` y URL. Timeout 15 s, `createLogger('tools')`, `usedPrefix` en los textos.

### src/plugins/tools-translate.ts
- Tabla única `LANGUAGES: { code, label, names }` y `findLanguage()`: primero por nombre (`alemán`, `german`, `japonés`...), y por código solo si no es una palabra española corriente (`AMBIGUOUS_CODES` = de, es, it, la: "/translate de nada" o "/translate la casa" ya no traducen al alemán o al latín). `/translate idiomas` indica con `languageHint` cómo escribir cada uno. Petición con `dt=t&dj=1` tipada (`sentences[].trans`, `src`); comprueba `content-type`; cabecera "inglés → español"; si el único argumento es un idioma y no hay cita, pide el texto. Timeout 10 s, máximo 2000 caracteres, logger.

### src/plugins/tools-clima.ts
- `getWeather` pide `&lang=es` y usa `lang_es`; comprueba `content-type` JSON (wttr.in devuelve HTML para ciudades desconocidas); añade `maxTemp`, `minTemp` y `rainChance` (máximo de `chanceofrain` de las franjas de hoy). Resultado tipado como unión discriminada (`WeatherResult`). Se eliminó `getWeatherEmoji` y sus ramas. Timeout 10 s, logger.

### Herramientas nuevas (todas `category: 'herramientas'`, con `help`, `usage`, `description`, `usedPrefix` en los textos)
- `src/lib/reminders.ts` + `src/plugins/tools-recordar.ts`: un recordatorio cuyo envío falla suma `attempts` y se descarta (se marca `firedAt`) al llegar a `MAX_SEND_ATTEMPTS` (5) o si lleva más de `MAX_LATE_MS` (24 h) de retraso, en vez de reintentarse cada 30 s para siempre; si el autor ya no está en el grupo (`findParticipant` sobre `groupMetadata`, con caché por tick) el recordatorio se le envía en privado y no se publica en el grupo. `parseDuration('10m'|'2h'|'1d'|'en 30 min'|'mañana'|'mañana 9:00'|'hoy 18:30'|'a las 7pm'|'15/12 18:30')` en la zona `BOT_TIMEZONE` (por defecto `America/Mexico_City`), con mínimo 1 min y máximo 1 año; `splitReminder(text)` separa el "cuándo" (prefijos de hasta 4 palabras) del texto. `scheduleReminder` (máximo 10 activos por usuario, devuelve `'limit'`), `listReminders`, `cancelReminder` (id completo o su final). Persisten en `DatabaseSchema.reminders` con `db.markDirty()`. `startReminders(conn, db?)` / `stopReminders()` / `setRemindersConnection(conn)`: tick de 30 s con `unref()` que envía `⏰ @user: texto` con `mentions` y purga los disparados hace > 7 días; `runRemindersTick(now, db, conn)` es la función pura que usa el tick. `dailyBirthdayCheck(conn, db?, now?)` felicita en los grupos con `birthdayAnnounce` a los cumpleañeros de hoy que sean participantes; el propio tick la ejecuta una vez al día entre 09:00 y 09:05 (ventana corta para no repetir tras un reinicio). Comandos: `/recordar <cuándo> <texto>`, `/recordatorios` (o `/recordar lista`), `/recordar cancelar <id>`.
- `tools-encuesta.ts`: `/encuesta pregunta | op1 | op2 [| ...]` (2-12 opciones, sin repetidas, `-m` = varias respuestas) con `poll` nativo (`selectableCount` 1 o 0). `parsePoll` exportada.
- `tools-calc.ts` (mathjs): instancia propia con `import`, `createUnit`, `evaluate`, `parse`, `simplify`, `derivative`, `compile`, `config` y `parser` deshabilitadas vía `math.import({...}, { override: true })` (`config` mutaba la instancia compartida: un usuario podía dejar la calculadora en BigNumber o con tolerancia 1 para todos). `preprocessExpression` convierte "15% de 2400", "10%", "×", "÷" y comas decimales solo cuando están entre dígitos y no separan argumentos ni listas (`max(3,5)`, `[1,2,3]` y `round(2.567,2)` quedan intactos); `a % b` sigue siendo módulo. Máximo 200 caracteres. `calculateWithTimeout` evalúa en un `worker_thread` persistente (el propio módulo actúa de worker: `new Worker(new URL(import.meta.url))` con `workerData.role`, funciona con tsx y con `dist/`), con `resourceLimits` de 256 MB y `terminate()` al vencer los 2 s o al quedarse sin memoria; el hilo se vuelve a crear en la siguiente petición. `stopCalcWorker()` para el apagado y los tests. `calculate` sigue siendo la versión síncrona (la usan el worker y los tests). Errores traducidos ("No sé qué es "x""). Ejemplos de `usage` con conversiones reales (`72 degF to degC`); mathjs no conoce divisas.
- `tools-random.ts`: `/dado [NdM]` (alias `roll`, `tirar`; se quitó `dados`, que es del juego de casino `game-dados.ts`; máx 100d1000, `parseDice`), `/moneda`, `/elegir a | b | c` (también separa por comas o " o ").
- `tools-hora.ts`: `resolveZone` (alias mx, cdmx, es, ar, co, pe, cl, ve, ec, uy, py, bo, us, ny, la, uk, jp, cn, in y variantes; nombre IANA sin distinguir mayúsculas; ciudad final tipo `mexico_city`) validado con `Intl.supportedValuesOf` más una comprobación con `Intl.DateTimeFormat` para los enlaces que ICU no lista como canónicos (`America/Argentina/Buenos_Aires`). `getTimeIn(zona, now?)` → `{ zone, label, time, date, offset }`. Sin argumentos muestra 6 zonas.
- `tools-qr.ts`: `/qr <texto>` (o cita) con `QRCode.toBuffer(text, { width: 512 })`, máximo 1000 caracteres.
- `tools-wiki.ts`: `getWikiSummary(consulta)` = opensearch + `rest_v1/page/summary` de es.wikipedia.org con `AbortSignal.timeout(10_000)`, extract recortado a 600 caracteres en un límite de frase, miniatura y detección de desambiguación. La miniatura solo se descarga si es `https://upload.wikimedia.org/...` (`isAllowedThumbnail`), con `content-type: image/*` y hasta 2 MB (se comprueba `Content-Length` y además se lee el cuerpo por trozos cortando si lo supera).
- `tools-notas.ts`: `ChatSettings.notes` (`Record<clave, { text, author, createdAt }>`); `/nota guardar <clave> <texto>` (o citando), `/nota <clave>`, `/notas`, `/nota borrar <clave>` (autor, admin u owner; también para sobrescribir una nota ajena). Máximo 50 notas × 1000 caracteres, clave normalizada `[a-z0-9_-]` de hasta 30 caracteres; `normalizeNoteKey` rechaza `__proto__`, `constructor` y `prototype` (`isReservedKey`) y todas las lecturas pasan por `Object.hasOwn` (`noteOf`). `/nota <clave>` se envía con `send({ text, mentions: [autor] })` para que la @ del autor sea una mención real (`m.reply` no lleva `mentions`). `group: true` para que el handler resuelva `isAdmin`.
- `tools-cumple.ts`: `DatabaseSchema.birthdays` (`Record<jid, 'MM-DD'>`); `/cumple 25/12` (también `25-12` y `25 de diciembre`, valida el día del mes), `/cumple` muestra el tuyo, `/cumple quitar`; `/cumples` lista los 5 próximos entre los miembros de `ctx.groupMetadata` comparando con `findParticipant` (número o LID, no igualdad de cadenas) y los envía con `mentions`; `/cumpleanios on|off` (admin u owner, comprobado dentro porque comparte plugin con `/cumples`) escribe `ChatSettings.birthdayAnnounce`. `dailyBirthdayCheck` compara igual.

### Betting
- `src/lib/betting-store.ts`: `normalizeTipsterName` devuelve `''` para claves reservadas del prototipo (`__proto__`, `constructor`, `prototype`...: antes `getOrCreateTipster('__proto__')` devolvía `Object.prototype` y `registerPick` escribía `pending`/`totalUnits` en TODO el proceso) y `isReservedKey`/`tipsterByKey(system, normalized)` (con `Object.hasOwn`) son el único camino de lectura del índice; `getOrCreateTipster` lanza si el nombre normaliza a vacío (los comandos validan antes); `MAX_TIPSTER_NAME_CHARS` = 40. `peekBettingSystem(chatId)` (lee sin crear), `followTipsterStatus()` → `'ok' | 'already' | 'limit' | 'invalid'`, que comprueba el límite de favoritos y la validez del nombre ANTES de crear el tipster (ya no se pueden crear tipsters basura ilimitados con `/tipster seguir`; el `followTipster` booleano queda `@deprecated` porque `database.ts` lo envuelve con firma booleana), `toggleNotify(jid)` (marca dirty), `rememberReply(chatId, messageId, pickId)` + `getPickByMessageId` consulta también ese índice: responder al mensaje del bot ("PICK REGISTRADO", "PICK GANADO", tarjeta del bridge) localiza el pick. Es un `LRUCache` en memoria (2000 entradas); el `messageId` del mensaje original del tipster sigue persistiendo en el pick. Constante `TELEGRAM_BRIDGE_AUTHOR`.
- `src/lib/betting-parser.ts`: `TIPSTER_REGEX = /^#([\p{L}][\p{L}\p{N}_-]{2,})/u` aplicado a la primera línea (`extractTipsterName`); `tipsterMetrics(t)`, `formatRecord(t)`, `formatStreak`, `signed`, `renderFavoriteTipsters(betting, system, opts)` (fusiona lo que mostraban `/tipster list` y `/mistipsters`), `requireBetting(ctx)` (responde y devuelve `null` si está apagado, con `usedPrefix` y pista distinta para admins), `describePendingPicks(picks, usedPrefix, command, allPending?)` y `pendingIndex(allPending, pick)`: los números son siempre la posición en la lista completa de pendientes del grupo (la que usan `verde/roja/seguir/cancelar <n>`), aunque se muestre un subconjunto filtrado; `findPickFromContext(store, chat, quotedId, text)`: cita → número de la lista → final del id (mínimo 4 caracteres, `endsWith`, ambigüedad → `null`) → tipster con un solo pendiente; sin pista solo acierta si hay exactamente un pendiente, y si se citó un mensaje que no corresponde a ningún pick y no hay texto devuelve `null` (antes resolvía el único pendiente aunque no tuviera relación con lo citado). Recibe `BettingStore`, no `Database`.
- `betting-pick.ts`: `makeResolveCommand(won)` genera `/verde` y `/roja` (se quitaron los alias `g`, `l` y `bet`); cuando no se localiza el pick se responde la lista numerada; `canManagePick`: admin/owner siempre, autor del pick, y en picks del bridge quienes lo siguen; `/cancelar` con override admin/owner; `/pendientes [tipster]` marca 🔓 también para admins y numera con los índices de la lista completa (`/pendientes Beta` → "2. Beta" y `/verde 2` resuelve ese mismo pick; el pie recuerda que el id no cambia); `/pick` rechaza nombres que normalizan a vacío o pasan de 40 caracteres; los mensajes de confirmación se registran con `rememberReply`. `pick` ya no suma `totalFollowed` a mano sin marcar dirty.
- `betting-tipster.ts`: un solo `/tipster` con subcomandos `seguir|dejar|lista|avisos` (y alias `add/remove/list/notify`, etc.); `mistipsters/misfavoritos/mytipsters` son alias del mismo plugin que van directos a `lista`. `misTipstersPlugin` se exporta `@deprecated` apuntando al mismo objeto para que `plugins/index.ts` compile hasta que quite su entrada. `/tipster seguir` responde a `'invalid'`; `/tipsters @usuario` usa `getTargetUserOrSelf` y `db.hasUser` (no crea usuarios al consultar) y envía con `mentions` cuando el texto lleva @usuario.
- `betting-mybets.ts`: recorre los chats con `peekBettingSystem` (antes creaba un `bettingSystem` vacío en cada chat de la BD).
- `betting-stats.ts`: se quitaron los alias `ranking`, `leaderboard` y `limpiar picks`; texto de `/betting on` corregido (#Tipster, `usedPrefix`); métricas vía `tipsterMetrics`.
- Los 4 plugins y el bridge usan `getDatabase().betting.*`; **ningún archivo mío llama ya a los wrappers de `Database`**.

### Telegram
- `src/lib/telegram-queue.ts` (nuevo): `MessageQueue` con `enqueue(input) => { item, ready }` síncrono (el orden queda fijado al llamar; `ready` resuelve cuando media y JSON están en disco y el envío la espera). `senderName` y `mediaBuffer` pueden ser promesas: el bridge encola en cuanto llega el evento y la descarga ocurre dentro de `ready`, así una foto lenta no deja pasar delante a un texto posterior (si la descarga falla o resuelve vacío la media se marca omitida). `prepare(item)` se ejecuta una sola vez por mensaje (`prepared` por id, se olvida al salir de la cola) aunque el envío se reintente. Un id ya presente en la cola se ignora. `stop()` espera todas las `ready` en curso y escribe el JSON una última vez (antes una media grande a medio escribir se perdía al apagar). `pause(ms?, reason)` guarda el motivo (`'manual' | 'errors'`, `pausedBy`) y la pausa por errores se reanuda sola. Persistencia en `<dir>/telegram-queue.json` (lowdb, `dir` configurable, por defecto `data/`, `BRIDGE_DATA_DIR` lo cambia) y media en `<dir>/bridge-media/<id>.<jpg|mp4>`, `load()` al arrancar (marca `mediaOmitted` si falta el archivo), sin expiración de 30 min; aviso al owner (una vez por 15 min) si hay > 50 en cola o el más antiguo lleva > 15 min; errores que no son de conexión → descartar al primer intento con `log.error` y aviso; errores de conexión → reintentos con backoff y, tras `maxConsecutiveErrors`, pausa con reanudación automática a los 60 s duplicando en pausas seguidas (tope 10 min); `prepare(item)` inyectable devuelve `{ caption, mentions, onSent }`; rama de texto con `mentions`; media omitida añade `[media omitida]` al texto y se loguea como `warn`, no como éxito. `pause(autoResumeMs?)`, `resume()`, `stop()`, `updateSocket()`, `pendingCount`, `isPaused`, `isProcessing`, `oldestAgeMs`, `snapshot()`.
- `src/lib/telegram-bridge.ts`: usa la cola; `prepareDelivery` no tiene efectos (detecta el tipster, arma tarjeta y menciones) y el pick se registra en `onSent`, con el `messageId` del envío confirmado: un reintento por caída de WhatsApp ya no duplica picks y un mensaje descartado no deja un pick huérfano. `handleTelegramMessage` encola sin esperar (nombre y descarga como promesas, ver cola). `attemptTelegramReconnect` con candado single-flight (devuelve la misma promesa a quien llame mientras corre), bucle sin recursión, espera entre intentos cancelable (`reconnectDelay`/`settleReconnect`): `restartTelegramBridge` y `stopTelegramBridge` cancelan y esperan la reconexión en vuelo antes de tocar el cliente, así no queda un cliente huérfano escuchando y duplicando mensajes; ya no reanuda la cola al reconectar Telegram (la pausa por errores se reanuda sola y la de WhatsApp la quita `index.ts`; la manual es del owner); agotados los 10 intentos deja de insistir, apaga el health check y avisa al owner hasta `/bridge restart`; health check cada 30 s con `unref()` que no hace nada si hay reconexión en curso o agotada; `createLogger('telegram')` en vez de los `console.log` con chalk; se eliminaron `currentConfig`, los parámetros muertos de `handleTipsterDetection` y el objeto `config` por mensaje. Nuevo `getBridgeStatus()`. Se conservan `startTelegramBridge`, `stopTelegramBridge`, `pauseMessageQueue`, `resumeMessageQueue`, `updateQueueSocket`, `restartTelegramBridge`, `getTelegramClient`, `getPendingMessagesCount`, `isMessageQueuePaused`, `isTelegramConnected` con las mismas firmas.
- `src/plugins/admin-bridge.ts` (nuevo, owner): `/bridge status|restart|pause|resume`; el estado dice si la pausa es manual o por errores.
- `src/generate-session.ts`: usa el paquete `input` (vía `createRequire`, con una interfaz local porque no trae tipos) con `input.password()` para la 2FA; valida que `API_ID` sea numérico (en .env o al pedirlo); al terminar ofrece (`input.confirm`) escribir `TELEGRAM_STRING_SESSION` en `.env` sustituyendo la línea si existe.

### src/types/database.ts
- `ChatSettings.notes?: Record<string, ChatNote>` y `ChatSettings.birthdayAnnounce?: boolean` (al final de la interfaz).
- `DatabaseSchema.reminders?: Reminder[]` y `DatabaseSchema.birthdays?: Record<string, string>` (al final).
- Interfaces nuevas `ChatNote` y `Reminder` (a `Reminder`, que es mía, se le añadió `attempts?: number` en la ronda de corrección).

### Tests nuevos (tests/herr-*.test.ts)
- `herr-rate-limit`: ventana, independencia de claves, borrado de claves vacías, parámetros inválidos, `undo`.
- `herr-reminders`: `zonedTimestamp`/`zonedParts`, `parseDuration` (relativas, reloj, fechas, rechazos), `splitReminder`, límite por usuario y cancelación, `runRemindersTick` (envío con mención, purga, fallo de envío, descarte tras `MAX_SEND_ATTEMPTS` o 24 h de retraso, entrega en privado si el autor salió del grupo, metadata una vez por tick), `startReminders` con `mock.timers` (setInterval + Date), `dailyBirthdayCheck` (incluido grupo con LID).
- `herr-calc`: resultados, preprocesado (comas en argumentos y listas, `%` como módulo), funciones bloqueadas (incluidas `config` y `parser`, comprobando que la configuración no cambió), errores legibles, worker (reutilización, peticiones en paralelo) y una expresión que bloquea (`ones(4000,4000) * ones(4000,4000)`) cortada por el plazo mientras un `setInterval` del hilo principal sigue latiendo.
- `herr-hora`: alias, IANA, ciudad final, validez de todos los alias, formato.
- `herr-betting-parser`: regex, legacy, métricas, `findPickFromContext` (cita, número, id, ambigüedad, tipster, cita que no es de ningún pick), `describePendingPicks`/`pendingIndex` con filtro, `renderFavoriteTipsters`, y con un `BettingStore` real sobre una `Database` falsa: claves reservadas del prototipo (`Object.prototype` queda intacto) y `followTipsterStatus` sin crear tipsters al límite o con nombre inválido.
- `herr-telegram-queue`: orden y persistencia de media, recarga desde disco, media omitida y `prepare`, descarte de errores no recuperables con aviso, pausa y reanudación con backoff (`mock.timers`), aviso de atasco con `now` inyectado, `prepare` una sola vez con dos fallos de conexión en medio (y `onSent` solo al confirmar), orden conservado con media y nombre como promesas lentas o fallidas, `stop()` con media grande en curso, ids duplicados y `pausedBy`.
- `herr-tools` (nuevo): `sanitizeForIssue`/`reporterLabel`/`issueTitle`, `isAllowedThumbnail`, `findLanguage` con códigos ambiguos, alias de `/dado`, `normalizeNoteKey`.

## Para otros agentes

### src/plugins/index.ts (agente núcleo)
1. Importar las herramientas nuevas y el plugin de owner:
   ```ts
   import { horaPlugin } from './tools-hora.js';
   import { wikiPlugin } from './tools-wiki.js';
   import { calcPlugin } from './tools-calc.js';
   import { dadoPlugin, monedaPlugin, elegirPlugin } from './tools-random.js';
   import { qrPlugin } from './tools-qr.js';
   import { encuestaPlugin } from './tools-encuesta.js';
   import { notaPlugin } from './tools-notas.js';
   import { cumplePlugin, cumplesPlugin } from './tools-cumple.js';
   import { recordarPlugin, recordatoriosPlugin } from './tools-recordar.js';
   import { bridgePlugin } from './admin-bridge.js';
   ```
2. En la sección `herramientas`, tras `['tools-tts', ttsPlugin],` añadir:
   ```ts
   ['tools-hora', horaPlugin],
   ['tools-wiki', wikiPlugin],
   ['tools-calc', calcPlugin],
   ['tools-dado', dadoPlugin],
   ['tools-moneda', monedaPlugin],
   ['tools-elegir', elegirPlugin],
   ['tools-qr', qrPlugin],
   ['tools-encuesta', encuestaPlugin],
   ['tools-notas', notaPlugin],
   ['tools-cumple', cumplePlugin],
   ['tools-cumples', cumplesPlugin],
   ['tools-recordar', recordarPlugin],
   ['tools-recordatorios', recordatoriosPlugin],
   ```
3. En la sección `admin`, añadir `['admin-bridge', bridgePlugin],`.
4. Línea 112: cambiar `import { tipsterPlugin, misTipstersPlugin, tipstersDePlugin } from './betting-tipster.js';` por `import { tipsterPlugin, tipstersDePlugin } from './betting-tipster.js';` y borrar la entrada `['betting-mistipsters', misTipstersPlugin],` (los alias `mistipsters/misfavoritos/mytipsters` ya los atiende `tipsterPlugin`). Hasta entonces compila igual gracias al export `@deprecated`, pero el handler avisará de alias en colisión. Después se puede borrar `misTipstersPlugin` de `betting-tipster.ts`.
5. Alias que desaparecen (por si el menú o la documentación los citan): `g`, `l`, `bet` (betting-pick), `ranking`, `leaderboard`, `limpiar picks` (betting-stats), `dados` (tools-random; sigue siendo del casino `game-dados.ts`). `/tipster add|remove|list|notify` siguen funcionando como alias de `seguir|dejar|lista|avisos`.

### src/index.ts (agente núcleo)
- Importar `import { startReminders, stopReminders, setRemindersConnection } from './lib/reminders.js';`.
- En `connection.update` → `open`: en la primera conexión llamar `startReminders(conn);` junto a `startAutoEvents(conn)`; en las reconexiones llamar `setRemindersConnection(conn);` junto a `updateQueueSocket(conn)`.
- En `gracefulShutdown`, antes de `await stopTelegramBridge();`, llamar `stopReminders();`.
- `dailyBirthdayCheck(conn)` (exportada de `lib/reminders.ts`) ya la dispara el propio tick de recordatorios entre 09:00 y 09:05 (zona `BOT_TIMEZONE`); no hace falta programarla aparte. Si se prefiere llevarla a `cleanup-scheduler`/`scheduler.every`, basta con llamarla una vez al día y quitar el bloque de cumpleaños de `tick()` en `reminders.ts`.
- `stopTelegramBridge()` ahora también espera a que la cola termine de escribir su JSON y la media en curso (`messageQueue.stop()`), y cancela una reconexión de Telegram en vuelo; sigue siendo `Promise<void>`.
- Opcional en `gracefulShutdown`: `await stopCalcWorker()` (exportado de `plugins/tools-calc.ts`) termina el hilo de la calculadora; sin la llamada el hilo está `unref` y no impide salir.

### src/handler.ts (agente núcleo)
- Línea ~587: sustituir
  ```ts
  if (CONFIG.ai.replyToMentions && chatSettings.aiChat !== false && ai.isDirectedToBot(m, this.botIds())) {
    await ai.respondWithAI({ conn: this.conn, m, rawMessage, text: m.text, isOwner });
  }
  ```
  por
  ```ts
  if (CONFIG.ai.replyToMentions && ai.isDirectedToBot(m, this.botIds())) {
    await ai.handleMention({ conn: this.conn, m, rawMessage, text: m.text, isOwner }, chatSettings.aiChat !== false);
  }
  ```
  `handleMention` responde "Aquí solo respondo con /ia" una vez por hora y chat cuando `aiChat` está apagado, y llama a `respondWithAI` cuando está encendido.

### src/lib/database.ts (agente datos)
- Ya no hay llamadas a los wrappers de betting fuera de `database.ts`: se pueden borrar `normalizeTipsterName`, `getBettingSystem`, `updateBettingSystem`, `getOrCreateTipster`, `getTipster`, `registerPick`, `resolvePick`, `cancelPick`, `getPendingPicks`, `getPickByMessageId`, `setPickMessageId`, `clearPendingPicks`, `getPickById`, `getLastPendingPick`, `followPick`, `getTipsterFollowers`, `followTipster`, `unfollowTipster`, `getUserBetting`, `getTipsterRanking`, `getPickHistory` (bloque "BETTING (wrappers de compatibilidad)") y los imports de tipos que solo ellos usaban. Al quitar el wrapper `followTipster`, en `betting-store.ts` se puede eliminar el `followTipster` booleano `@deprecated` y renombrar `followTipsterStatus` → `followTipster` (`FollowResult` tiene ahora también `'invalid'`; el wrapper booleano sigue devolviendo `=== 'ok'`).
- `getOrCreateTipster` lanza si el nombre normaliza a vacío (clave reservada o sin letras); el wrapper `@deprecated` hereda ese comportamiento. Nadie fuera de betting lo llama con texto sin validar.
- `migrateChatSettings` no necesita cambios: `notes` y `birthdayAnnounce` son opcionales y los plugins los crean al vuelo.

### src/plugins/menu.ts (agente núcleo)
- Los plugins nuevos declaran `category: 'herramientas'` y `admin-bridge` cae en `owner` por el prefijo `admin-`; no hace falta tocar `CATEGORIES`. Si el menú muestra `MENU_TIPS`, puede añadir "/recordar 30m ..." y "/encuesta".

### .env.example (agente housekeeping/núcleo)
- Documentar `BOT_TIMEZONE` (zona IANA para `/recordar` y el aviso de cumpleaños; por defecto `America/Mexico_City`) y `BRIDGE_DATA_DIR` (carpeta de la cola persistente del puente; por defecto `data`). Añadir `data/` al `.gitignore` si no está.

## Decisiones

- **`followTipsterStatus` en vez de cambiar la firma de `followTipster`**: `database.ts` (ajeno) lo envuelve declarando `boolean`; cambiar el tipo de retorno habría roto `tsc`. El wrapper booleano queda `@deprecated` y la migración final es un renombrado.
- **Índice de respuestas del bot en memoria (`rememberReply`) y no un campo nuevo en `BettingPick`**: la consigna solo permitía añadir campos a `DatabaseSchema` y `ChatSettings`. Tras un reinicio se pierde la asociación con los mensajes del bot, pero el `messageId` del mensaje original del tipster sigue en el pick y los ids/números de `/pendientes` cubren el resto.
- **`findPickFromContext` sin pista solo resuelve si hay un único pendiente** (antes devolvía el más reciente): con varios picks abiertos, un `/verde` a secas resolvía uno al azar desde el punto de vista del usuario. Ahora el comando lista los pendientes numerados y acepta `/verde 2`.
- **`misTipstersPlugin = tipsterPlugin`** como export `@deprecated` en vez de un plugin inerte: así `plugins/index.ts` compila sin cambios y la limpieza es borrar una línea.
- **Permisos de picks del bridge**: antes cualquiera podía resolver o cancelar un pick de Telegram; ahora solo admins/owner y quienes lo siguen (la gente que "puso dinero"). `/cancelar` admite override de admin/owner.
- **Tick de 30 s propio en `reminders.ts` (con `unref`) en vez de `scheduler.every`**: el módulo debe poder probarse con `mock.timers` y una BD falsa sin arrastrar el registro global de `scheduler`, y `stopReminders()` es lo que `index.ts` llamará en el apagado.
- **Cumpleaños dentro del tick de recordatorios** (ventana 09:00-09:05, una vez por día en memoria) en lugar de una tarea aparte: evita duplicar el aviso si el bot reinicia después de las 09:05 sin persistir nada nuevo en la BD. Coste: si el bot está caído en esa ventana, ese día no se felicita.
- **`pendientes_betting` solo aparece en el `tools` de la llamada cuando el grupo tiene betting activo**: en el resto de chats el modelo no ve una herramienta que siempre devolvería "solo en grupos", y el prompt cacheado no cambia (las tools van fuera del bloque `system` cacheado).
- **Gasto estimado**: solo se tarifan entrada no cacheada ($4), cache read ($0.20) y salida ($20); la escritura de caché (1.25x) se cuenta como entrada normal para no complicar `AIUsageDay`, que no se podía ampliar.
- **Top de chats por consumo en memoria** (`Map` acotado a 1000 chats, reinicio diario): `AIUsageDay` está fuera de los tipos que podía tocar y persistir consumo por chat engordaría `settings`. Es un indicador para el owner, no contabilidad.
- **`calculateWithTimeout` en `worker_thread`, no `Promise.race`**: la primera versión seguía la letra de la consigna, pero la evaluación de mathjs es síncrona y `ones(4000,4000)` congelaba el bot entero (los revisores lo midieron: 17 s y 545 MB, u OOM). Deshabilitar funciones una a una (`ones`, `zeros`, `identity`, `det`...) no cierra el problema (`isPrime(bignumber(...))`, potencias de matrices, `combinations`...), así que el aislamiento real es el hilo con `terminate()` y `resourceLimits`. Se reutiliza un hilo persistente porque cargar mathjs cuesta cientos de ms; el módulo se auto-carga como worker (`new Worker(new URL(import.meta.url))`) para no depender de la extensión `.ts`/`.js` del archivo.
- **Registro del pick del bridge en `onSent` y no en `prepare`**: `prepare` se ejecutaba en cada reintento y registraba N picks por mensaje; además registraba antes de saber si el mensaje saldría. Con el registro tras el envío confirmado no hace falta deduplicar y el pick nace ya con su `messageId`. La tarjeta no muestra `pending`, así que el usuario no nota la diferencia.
- **Numeración global en `/pendientes <tipster>`** en vez de quitar los números con filtro: la gente ya usa `verde 2`; mostrar los índices reales mantiene la costumbre sin que un filtro cambie a qué pick apunta cada número. El pie recuerda el id para quien quiera algo estable.
- **Claves reservadas: rechazar en la normalización + `Object.hasOwn`** en vez de pasar `tipsters`/`notes` a `Map` u `Object.create(null)`: los tipos (`Record<string, ...>`) y la persistencia JSON ya existen y son de otros agentes; con las dos barreras ni se crean ni se leen claves heredadas. Solo se bloquean las claves que coinciden exactamente tras normalizar (`hasOwnProperty` → `hasownproperty` es una clave inofensiva).
- **Códigos de idioma ambiguos por nombre**: `de`, `es`, `it`, `la` solo valen escritos como idioma (`alemán`, `italiano`, `latín`); `en` se mantiene como código porque es el destino más usado y la alternativa (marcadores como `->en`) complicaba el comando para todos.
- **La cola del bridge espera `ready` antes de enviar** (media y JSON ya en disco): cuesta unos ms por mensaje pero garantiza que, si el proceso muere entre encolar y enviar, el mensaje no se pierde ni se envía sin su imagen.
- **Errores no de conexión se descartan al primer intento**: reintentar un 400 de WhatsApp (p. ej. media corrupta) bloqueaba la cola entera; se avisa al owner con el motivo.
- **`generate-session.ts` imprime con `process.stdout.write` el asistente interactivo y usa el logger solo para estado/errores**: la salida de un asistente se lee en la terminal y los prefijos de hora y nivel estorban en el valor que hay que copiar. `input` se carga con `createRequire` porque no trae tipos y no podía añadir un `.d.ts` fuera de mis rutas.
- **`/nota` y `/cumples` con `group: true`**: es la única forma de que el handler rellene `isAdmin`/`participants` (lectura perezosa). `/cumple` (guardar el propio) funciona también en privado.
- **`@types/qrcode` como devDependency** además de `mathjs` y `qrcode`: sin tipos `qrcode` no compila con `noImplicitAny`.

## Ronda de corrección (hallazgos de los revisores)

Corregidos, con test donde fue posible:
- **tools-calc** (3 hallazgos): evaluación en worker con tope de tiempo y memoria; `config`/`parser` deshabilitadas; coma decimal que no rompe argumentos ni listas y `%` entre números como módulo; ejemplo de divisas sustituido. Tests en `herr-calc`.
- **betting-store** (2): contaminación de `Object.prototype` por `__proto__`/`constructor` (normalización + `tipsterByKey` con `Object.hasOwn`, validación en `/pick`, `/tipster` y bridge); `followTipsterStatus` ya no crea tipsters al límite ni con nombre inválido (`'invalid'`, máximo 40 caracteres). Tests en `herr-betting-parser`.
- **ai.ts** (2): `trimConversation` antes de fijar `base` (el rollback funciona con la conversación llena); solo texto al historial cuando no hay `tool_use` y `resetMemory` ante un 400 por `tool_use`/`tool_result`.
- **telegram-queue / telegram-bridge** (6): `prepare` único por mensaje y `registerPick` en `onSent`; orden conservado con media lenta (encolado síncrono con promesas); `stop()` espera la media en curso; `restart`/`stop` cancelan y esperan la reconexión en vuelo; la reconexión de Telegram no reanuda pausas ajenas (motivo de pausa); health check silencioso tras agotar intentos. Tests en `herr-telegram-queue` (lo que no depende de GramJS).
- **betting-pick / betting-parser** (2): numeración de `/pendientes <tipster>` coherente con `verde <n>`; cita que no es de ningún pick ya no resuelve el único pendiente.
- **tools-notas** (2): claves reservadas y `Object.hasOwn`; mención del autor con `mentions`.
- **tools-cumple** (1): pertenencia al grupo con `findParticipant` (número/LID) y lista con `mentions`; lo mismo en `dailyBirthdayCheck`.
- **reminders** (1): descarte tras 5 fallos o 24 h de retraso; entrega en privado si el autor salió del grupo.
- **tools-github** (2): `@` y `|` escapados en descripción, título y `pushName`; `undo` del cupo del usuario y del global al fallar GitHub.
- **tools-wiki** (1): miniatura solo de `upload.wikimedia.org`, `image/*`, 2 MB.
- **tools-random** (1): alias `dados` eliminado. **tools-translate** (1): códigos ambiguos solo por nombre.
- **betting-tipster**: `/tipsters @usuario` con `mentions` (señalado de paso en el hallazgo de notas).

Hallazgos que no cambian código mío:
- **docs/dev/handoff-herramientas.md:160 (integración)**: correcto, pero son las tres entradas de "Para otros agentes" (`plugins/index.ts`, `index.ts`, `handler.ts`); siguen pendientes de integración, no se tocaron porque son archivos ajenos.
- La parte de "hasOwnProperty, toString, valueOf" de los hallazgos de prototipo es solo parcialmente correcta: tras `toLowerCase()` esas claves dejan de coincidir con `Object.prototype` y son inofensivas; se bloquean las que sí coinciden (`__proto__`, `constructor`, `prototype`).

## Pendiente

- `plugins/index.ts` no registra todavía las herramientas nuevas ni `admin-bridge`, y sigue importando `misTipstersPlugin` (agente núcleo, instrucciones arriba). Hasta entonces los comandos nuevos no responden.
- `index.ts` no llama a `startReminders`/`setRemindersConnection`/`stopReminders`: los recordatorios se guardan pero no se envían hasta que se integre.
- `handler.ts` no usa `handleMention`: con `aiChat` apagado el bot sigue callado al mencionarlo (comportamiento anterior) en vez de avisar una vez por hora.
- `database.ts` conserva los wrappers `@deprecated` de betting; se pueden borrar (agente datos).
- `.env.example` no documenta `BOT_TIMEZONE` ni `BRIDGE_DATA_DIR`.
- No pude ejecutar el puente de Telegram ni las APIs externas (GitHub, wttr.in, Wikipedia, Google Translate) contra servicios reales desde este entorno; la lógica de red está cubierta por tipos y timeouts, no por tests de integración.
- `tests/herr-telegram-queue.test.ts` escribe en `os.tmpdir()`; el test de pausa con `mock.timers` depende de que `setImmediate` no esté mockeado (está documentado en el propio test).
- El orden de llegada del bridge y la cancelación de la reconexión están cubiertos por los tests de la cola y por lectura, no contra GramJS real (no hay credenciales en este entorno).
- La pausa manual de la cola (`/bridge pause`) la deshace `index.ts` al reabrir WhatsApp (`resumeMessageQueue()`); si se quiere respetar, `index.ts` puede comprobar `getBridgeStatus().queuePausedBy === 'manual'` antes de reanudar.
