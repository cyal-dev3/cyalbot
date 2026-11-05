# Handoff: área núcleo (handler, arranque, registro de plugins, menú, libs base)

Estado al cierre: `npx tsc --noEmit` pasa en todo el árbol y `npm test` pasa (166 tests, 50 de mi área en `tests/nucleo-*.test.ts`, `tests/utils.test.ts` y `tests/config.test.ts`); la suite termina sola en ~6 s. Durante el trabajo `tests/datos-auto-regen.test.ts` falló un rato mientras el agente de datos editaba; al cierre pasa.

## Hecho

### src/lib/wa-message.ts (nuevo)
- `unwrapMessage(msg)`: acepta el `IWebMessageInfo` completo o solo `message` y devuelve el contenido real usando `normalizeMessageContent` de Baileys (efímeros, ver una vez v1/v2/extension, documento con caption, editados). Era el bug de "el bot ignora todo en grupos con mensajes temporales".
- `getText(content)`: conversation, extendedText, caption de imagen/video/documento, respuestas de botones/listas.
- `getContextInfo`, `getMentions` (contextInfo de texto extendido, imagen, video, documento, audio, sticker, botones), `getQuoted` (mensaje citado ya desenvuelto, con `stanzaId`, `participant` y `text`), `getMediaSize`.
- `downloadMedia(conn, msg)`: `downloadMediaMessage` con logger pino silencioso y `reuploadRequest`; sustituye los `logger: console as any` repartidos.

### src/lib/command-suggest.ts (nuevo)
- `commandAliases(plugin)` (movida aquí desde plugins/index.ts, que la re-exporta): arrays en minúsculas; RegExp solo si es una alternancia simple `^(a|b|c)$` (admite `(?:` y escapes); si tiene cuantificadores u otros metacaracteres devuelve `[]`. `isSimpleCommand(plugin)`.
- `damerauLevenshtein(a, b)` y `suggestCommand(cmd, aliases, { primary?, maxDistance = 2, minPrefix = 4 })`: ignora tildes y mayúsculas, acepta distancia <= min(2, floor((len-1)/2)) o prefijo común >= 4, prefiere alias principal y luego el más corto.

### src/lib/scheduler.ts (nuevo)
- `every(name, ms, fn)`, `after(name, ms, fn)`, `stop(name)`, `has(name)`, `list()`, `stopAll()`. Timers con `unref()`, errores (sincrónicos o promesas rechazadas) capturados y logueados con `lastError` en `list()`. Registrar el mismo nombre reemplaza la tarea anterior.
- Migrados: `MessageHandler` (cleanup de mensajes rastreados y autoclear) y los 3 intervalos + timeout inicial de cleanup-scheduler.

### src/lib/fetch-media.ts (nuevo)
- `fetchMedia(url, { timeoutMs = 30000, maxBytes = 64 MB, headers? })` -> `{ buffer, mimetype } | null`. Nunca lanza. AbortController para timeout, `res.ok`, rechaza `text/html`, `content-length` > máximo y corta el stream si excede. SSRF: `rejectReason(url)` rechaza protocolos distintos de http(s), `localhost`/`*.local`/`*.internal`, IPs privadas literales (v4, v6, v4-mapped) y hosts que resuelven (DNS) a IP privada; excepción: el host de `DOWNLOADER_API_URL`. También exporta `isPrivateAddress`, `isPrivateHost`.
- El agente de descargas ya lo consume desde `src/lib/media-send.ts` y `src/lib/http.ts`.

### src/handler.ts (reescrito)
- Serialización con wa-message (`m.message` nuevo: contenido desenvuelto). `quoted.key.fromMe` se calcula comparando el participante citado con los ids del bot (`sameUser`).
- Índice de alias `Map<alias, {name, plugin}>` construido en `registerPlugin` con `commandAliases`; los RegExp complejos van a `patternPlugins` y se prueban en orden contra el comando y el texto completo. Despacho O(1) con `findPlugin(alias)`; "el primero registrado gana". Colisiones: `log.warn` con ambos nombres y `getAliasCollisions()` -> `{ alias, winner, loser }[]` (no lanza; `loadPlugins` loguea el total).
- Contextos: `matchContext` se consulta ANTES del registro global; sin prefijo solo si `context.noPrefix` y el plugin no tiene `noPrefix: false`. Eliminados `DUEL_COMMANDS_NO_PREFIX`, `SKILL_PATTERNS_NO_PREFIX` e `isNoPrefixDuelCommand`: ningún texto sin prefijo es comando salvo que un contexto activo lo acepte. Los plugins de contexto pasan por las mismas comprobaciones owner/group/admin/botAdmin/register.
- Comando desconocido: `replyUnknownCommand` con `suggestCommand` sobre `visibleAliases({ isOwner, isAdmin, isGroup })` (filtra owner/admin/group), cooldown de 10 s por chat (`LRUCache`), en `compactMode` solo reacción ❓, y se ignoran "comandos" sin letras ni dígitos ("...", "/").
- Metadata de grupo perezosa: `resolveGroupRoles` (lib/group-events) solo cuando el chat tiene antiLink/antiSpam/antiBad/automute activos o el plugin tiene admin/botAdmin/group. `isAdmin`/`isBotAdmin` por coincidencia exacta (`sameUser`) contra `p.id` y `p.lid`, y el bot contra número y LID; borrado el bloque de `includes()`. Si la metadata es null para un comando admin/botAdmin responde "No pude leer los datos del grupo, inténtalo en unos segundos". Al negar admin/botAdmin se invalida la caché. Mensaje de botAdmin con instrucción de cómo dar admin al bot.
- Errores de plugin: nunca `error.message` al chat; `CONFIG.messages.error + " (ref xxxxxx)"` y `log.error` con nombre, ref y stack. Además escribe `db.data.stats[name]` (total/success/failed/lastUsed) como pedía handoff-datos.
- `MessageContext` ampliado: `ctx.send(content, opts?)` (envía + rastrea solo en grupos y devuelve el resultado), `ctx.target(opts?)` (= `getTargetUser(m, { args, ...opts })`), `ctx.chatSettings` (leído una vez; sin entrada en BD devuelve `structuredClone(DEFAULT_CHAT_SETTINGS)` sin crearla), `ctx.user` getter perezoso (`db.getUser` solo si se accede).
- `trackMessage` solo para `@g.us`; `isAutoClearEnabled/isCompactMode/isAutoMuteEnabled` leen `db.data.chats[id]?.campo` y no crean entradas (antes autoclear creaba ChatSettings de cada chat privado cada 30 s).
- Automatismos: antilink usa `search()` (el regex tiene flag g); autosticker usa `downloadMedia` y mira `m.message.imageMessage` (ya desenvuelto); autodownload delega en `lib/autodownload.ts` del agente de descargas (dedupe, límite de YouTube, `sendMedias`), que a su vez usa `fetchMedia`.
- IA: `./lib/ai.js` se carga con `import()` perezoso solo si `CONFIG.ai.enabled`. Motivo: `ai.ts` importa `plugins/index.ts`, que importa todos los plugins, y `admin-stats.ts` importa `src/index.ts` (que arranca el bot al evaluarse); con import estático cualquier test del handler intentaría conectar a WhatsApp y además `rpg-dungeon-interactivo.ts` deja un `setInterval` de módulo vivo. Ver "Para otros agentes" (agente IA) para volver al import estático.
- Eliminados: `makeMessageInvisible`/`INVISIBLE_CHAR` (sin usos), `isAdmin(participants, jid)`, `PLATFORM_NAMES`, la tabla de duelo sin prefijo. `getMuteRegistry` se conserva (lo usa group-mute.ts). Timers via `scheduler` con prefijo único por instancia (`handler:xxxx:*`).

### src/types/message.ts
- `MessageHandlerInterface`: quitado `makeMessageInvisible`; añadidos `getContexts`, `getPlugins`, `getAliasCollisions`, `findPlugin`. Conserva todo lo demás.
- `MessageContext`: `chatSettings`, `user` (readonly, perezoso), `send`, `target`; `groupMetadata/participants/groupAdmins` documentados como perezosos. `SerializedMessage.message` (contenido desenvuelto). Nuevos tipos `AliasCollision`, `TargetOptions`. `CommandContext` documenta que sus plugins no entran al registro global salvo que el autor los registre.

### src/config.ts
- `sameUser(a, b)`: igualdad exacta de dígitos (JID, LID o número), nunca subcadena.
- Eliminados `CONFIG.protection.telegramRegex` y `CONFIG.cooldowns.crime` (grep: 0 usos). `adventure`/`hunt` se quedan.

### src/index.ts
- `logIncoming` usa `getText(unwrapMessage(message))`.
- `scheduleReconnect`: si `connectBot` falla vuelve a programar con backoff; tras 10 fallos seguidos `process.exit(1)` (pm2 reinicia). `getReconnectStats()` -> `{ count, attempts, lastError, lastErrorAt }` (tipo `ReconnectStats` exportado); `lastError` también se rellena con `lastDisconnect.error` en cada cierre.
- `teardownPrevious` llama `cancelPairingTimeout()` y quita también `messages.reaction` y `creds.update` del socket viejo.
- `gracefulShutdown`: `stopAutoRegen()`, `stopAutoEvents()`, `scheduler.stopAll()` antes de `stopTelegramBridge` y `db.stop()`.

### src/main.ts
- `msgRetryCounterCache` deja de exportarse. chalk se mantiene (permitido aquí).

### src/lib/group-events.ts
- `resolveGroupRoles(conn, groupId, sender)` -> `{ isAdmin, isBotAdmin, admins, participants, metadata }` sobre la metadata cacheada; `isGroupAdmin(metadata, jid)`; `botIdentities(conn)` (número y LID). Comparación exacta con `sameUser` contra `p.id` y `p.lid`.
- `handleParticipantsUpdate` invalida la caché en cualquier acción (add/remove también cambian `participants`), no solo promote/demote.

### src/lib/anti-delete.ts
- `rememberMessage` y `resend` usan `unwrapMessage`/`getText`/`getMediaSize`/`downloadMedia`: los mensajes efímeros ahora se reenvían; los de protocolo (sin contenido) no se cachean. Lee `antiDelete` con `db.data.chats[chatId]?.antiDelete` (no crea entradas). El documento conserva su caption.

### src/lib/reaction-handler.ts
- `createLogger('betting')`; usa `db.betting.*`. Los picks `TELEGRAM_BRIDGE` solo los resuelve un admin del grupo (`isGroupAdmin` con `getGroupMetadataCached`) o un owner; el creador sigue pudiendo resolver los suyos (`sameUser`).

### src/lib/cleanup-scheduler.ts
- Nunca borra `pre-key-*`. Poda solo `session-*` y `sender-key-*` con mtime > 90 días. Timers por `scheduler` (`cleanup:initial` cancelable, `cleanup:tmp`, `cleanup:play-dl`, `cleanup:session`). Logger sin emojis ni chalk.

### src/lib/lru-cache.ts, src/lib/utils.ts
- Solo se quitaron los encabezados decorativos. Las firmas (`getTargetUser`, `getTargetUserOrSelf`, `mentionTag`, `displayName`, `parseAmount`, `msToTime`) se mantienen.

### src/plugins/index.ts
- `Section.entries` directo (sin `ENTRIES`), nombres legibles para owner-rpg (`owner-rpg-<primer alias>`), re-exporta `commandAliases`, exporta `listCommands(handler)` -> `CommandInfo[]` (name, commands, description, help, usage, category, tags, flags, plugin) y `describePlugin(plugin)` (`description || help[0]` sin el "cmd - "). `loadPlugins` loguea el número de colisiones.
- No se añadieron secciones de plugins que aún no existen (ver Pendiente).

### src/plugins/menu.ts (reescrito)
- Sin `CATEGORIES`/`COMMANDS`/`NEW_COMMANDS` hardcodeados. Categorías desde `plugin.category` (mapa `CATEGORY_ALIASES`), fallback por prefijo del nombre de registro (rpg-, owner-, admin-, game-, fun-, group-, media-, sticker-, download-, tools-, betting-, ai-) y mapa de tags legacy; `plugin.owner` fuerza "owner".
- `/menu`: 8 comandos más usados según `db.data.stats` (completa con `QUICK_COMMANDS`), categorías con conteo filtradas por permisos del que pregunta (admin real via `resolveGroupRoles`), tip aleatorio. `/menu <categoría>`: comandos con descripción. `/menu <comando>`: descripción, uso (`usage` o `help` con el prefijo real), alias, requisitos y categoría. Oculta los alias perdedores de `getAliasCollisions()` y los plugins que quedan sin alias visible. Siempre `usedPrefix`, nunca "/" fijo.

### Tests
- `tests/nucleo-handler.test.ts` (conn falso + `initDatabase` en directorio temporal): prefijo configurable, array/RegExp simple/compleja, comando desconocido + cooldown + compacto + filtrado por permisos, orden de permisos, isBotAdmin exacto y por LID, metadata perezosa y cacheada, metadata null, contexto activo/inactivo con y sin prefijo, permisos en contexto, efímero, error sin filtrar, trackMessage/ajustes sin crear ChatSettings, colisiones, ctx.user/target/send, botMode y mute.
- `tests/nucleo-wa-message.test.ts`, `tests/nucleo-command-suggest.test.ts` (atakar->atacar, invetario->inventario, menú->menu, xyz->null, prefijo largo, empates), `tests/nucleo-scheduler.test.ts`, `tests/nucleo-fetch-media.test.ts` (servidor HTTP local registrado como `DOWNLOADER_API_URL`: ok, HTML, 404, content-length, stream cortado, timeout, rangos privados).
- `tests/utils.test.ts`: msToTime con días, parseAmount, getTargetUser/OrSelf, mentionTag, displayName. `tests/config.test.ts`: sameUser.

## Para otros agentes

### Agente IA (src/lib/ai.ts)
1. Línea 23: cambiar `import { commandAliases } from '../plugins/index.js';` por `import { commandAliases } from '../lib/command-suggest.js';` (misma firma). Esto rompe el ciclo ai -> plugins/index -> todos los plugins. Cuando esté hecho, el handler puede volver al import estático: en `src/handler.ts` sustituir el bloque `loadAI` por `import { rememberChatLine, isDirectedToBot, respondWithAI } from './lib/ai.js';` y quitar los `await loadAI()`.
2. `extractImage` (línea ~261): usar `const content = unwrapMessage(rawMessage);` y `content?.imageMessage` en vez de `rawMessage.message?.imageMessage` (las fotos en grupos con mensajes temporales llegan dentro de `ephemeralMessage`). Para descargar, `downloadMedia(conn, source)` de `./wa-message.js` en lugar de `downloadMediaMessage(..., { logger: console as never, ... })`.
3. `initAI` puede usar `describePlugin(plugin)` de `plugins/index.ts` (o copiar la lógica) para la descripción del catálogo.

### Agente RPG combate (rpg-duelo.ts, rpg-dungeon-interactivo.ts)
Los comandos sin prefijo del duelo ("g", "golpe", "huir", nombres de habilidades...) ya NO llegan al registro global. Hay que registrar contextos en el `register` del módulo (o donde se cargan los plugins) con `handler.registerContext(...)`:
```ts
handler.registerContext({
  name: 'duelo',
  noPrefix: true,
  isActive: (m) => m.isGroup && hayDueloActivoEntre(m.chat, m.sender),   // por chat + participante
  plugins: [atacarDueloPlugin, bloquearDueloPlugin, poderDueloPlugin, skillDetectorPlugin, rendirsePlugin],
});
handler.registerContext({
  name: 'dungeon',
  noPrefix: true,
  isActive: (m) => tieneSesionDungeon(m.sender),                          // por sender
  plugins: [atacarDungeonPlugin, defenderDungeonPlugin, habilidadDungeonPlugin, itemDungeonPlugin, huirDungeonPlugin, estadoDungeonPlugin],
});
```
- `skillDetectorPlugin` (RegExp con `.?`) se prueba contra el texto completo, así "bola de fuego" funciona sin prefijo dentro del contexto.
- Dos opciones por plugin: (a) solo en el contexto -> quitar su entrada de `src/plugins/index.ts` (desaparecen las colisiones de `a`, `d`, `h`, `i`, `huir`, `estado`, `g`, `hit`, `b`, `p`, `salir`, `usar`, `poder`, `habilidad` con otros plugins) y el comando solo responde durante el juego; (b) además en el registro global -> dejar la entrada; el contexto sigue teniendo prioridad mientras esté activo. Para "a"/"d"/"h"/"i" se recomienda (a).
- Un plugin de contexto puede vetar el modo sin prefijo con `noPrefix: false`.
- `rpg-dungeon-interactivo.ts:95` `setInterval(cleanupInactiveSessions, ...)` de módulo: sustituir por `scheduler.every('dungeon:cleanup', 5 * 60 * 1000, cleanupInactiveSessions)` (import `* as scheduler from '../lib/scheduler.js'`). Hoy mantiene vivo cualquier proceso que importe el plugin (tests).

### Agente juegos (game-blackjack.ts, game-roulette.ts, game-*.ts nuevos)
- Igual que arriba: contextos `blackjack` (plugins pedir/plantarse/doblar/jugar/bjsalir, `isActive` = hay mesa en el chat y el sender está sentado), `ruleta` (apostar/girar/ruletasalir), `trivia`/`adivina`/`ppt`/`ttt` (la respuesta sin prefijo solo mientras la partida está activa). Decidir por plugin si además sigue en el registro global (ver opciones a/b).
- Aliases que hoy colisionan con otros plugins y conviene mover al contexto: `hit` (pedir vs golpe), `bet` (apostar vs pick), `vermesa`, `mesa`, `salir`.

### Agente grupos (group-delete.ts)
- `clearPlugin` y `autoClearPlugin`: añadir `untracked: true`. Cuando esté, borrar `UNTRACKED_COMMANDS` de `src/handler.ts` (línea ~50 y su uso en `execute`).
- Los plugins que leen `ctx.isAdmin`/`ctx.isBotAdmin`/`ctx.participants`/`ctx.groupAdmins` deben declarar `group: true` (o `admin`/`botAdmin`); si no, el handler no pide la metadata y esos campos llegan `false`/`undefined`. Grep actual: todos los que los usan ya lo declaran salvo menu.ts (resuelto dentro del propio menú).
- Para forzar una relectura de la metadata (p. ej. tras promover a alguien desde un plugin) usar `invalidateGroupMetadata(chatId)` de `lib/group-events.ts`.

### Agente datos (database.ts, auto-regen.ts, auto-events.ts)
- `Database.init` línea ~135: `this.saveInterval = setInterval(...)` -> `scheduler.every('db:autosave', AUTOSAVE_INTERVAL_MS, () => { if (this.dirty) void this.save(); })` y en `stop()` `scheduler.stop('db:autosave')`. Idem `auto-regen.ts:175` (`scheduler.every('rpg:regen', ...)`, `stopAutoRegen` -> `scheduler.stop`) y `auto-events.ts` (timer de próximo evento con `scheduler.after('rpg:auto-event', ms, fn)`).

### Agente Telegram (telegram-bridge.ts)
- `telegram-bridge.ts:616` healthcheck: `scheduler.every('telegram:healthcheck', ms, fn)`; `stopTelegramBridge` -> `scheduler.stop('telegram:healthcheck')`.

### Agente descargas (download-*.ts, downloaders.ts)
- `platformLabel`, `extractUrl` y `lib/autodownload.ts` ya existen y el handler los usa; `media-send.ts` ya re-exporta `fetchMedia`. Los 7 plugins `download-*` deben pasar por `fetchMedia`/`sendMedias` (no `fetch(url).arrayBuffer()` directo).
- Si hace falta descargar de un host interno distinto a `DOWNLOADER_API_URL`, `fetch-media.ts` no lo permite a propósito; ampliar `allowedByConfig` en vez de saltarse la comprobación.

### Agente admin (admin-stats.ts)
- `getReconnectStats()` ahora devuelve también `lastError` y `lastErrorAt`; mostrarlos en el dashboard. Importar desde `../index.js` crea un ciclo con el punto de entrada (que ejecuta `main()` al evaluarse); si se crea un `src/lib/runtime-stats.ts` neutro, mover ahí el estado de reconexión y que `index.ts` lo actualice.

### Todos los agentes de plugins
- Textos: usar `ctx.usedPrefix` en lugar de "/" fijo (el menú ya lo hace).
- Rellenar `description` (una línea) y `usage` (`['cmd <arg>', 'cmd sub']`, sin prefijo) en cada plugin: el menú y la sugerencia de comandos los usan. `category` admite: ia, rpg, juegos, fun, betting, media, descargas, herramientas, grupos, owner (alias aceptados en `CATEGORY_ALIASES` de menu.ts: group, game, download, tools, sticker...).
- `ctx.chatSettings` es una lectura; para persistir usar `db.updateChatSettings(chatId, { ... })`. En privado (o grupo sin entrada) es un clon de los defaults.
- `ctx.user` crea el usuario en la BD al primer acceso (igual que `db.getUser`); si solo se consulta, usar `db.data.users[jid]`.
- `ctx.send(content)` en lugar de `conn.sendMessage` cuando el mensaje deba poder borrarse con /clear.
- `ctx.target({ allowSelf })` sustituye a `getTargetUser(m, ...)` + parseo manual de números.
- Nunca enviar `error.message` al usuario; dejar que el handler lo convierta en "error (ref xxxxxx)" o loguear con `createLogger`.

### Integrador final (plugins/index.ts)
- Hay plugins nuevos sin registrar en `SECTIONS` (están en el árbol pero ningún handoff los pedía aún cuando cerré): `game-adivina.ts`, `game-carrera.ts`, `game-dados.ts`, `game-memoria.ts`, `game-ppt.ts`, `game-ttt.ts`, `group-toggles.ts`, `group-tools.ts`, `media-comprimir.ts`, `media-info.ts`, `media-tomp3.ts`, `download-platform.ts`, `rpg-items-especiales.ts`, y el `/eventos` que pide handoff-datos. Añadir sus entradas/`register` en la sección correspondiente según cada `handoff-*.md`, y los `registerContext` de duelo/dungeon/juegos.
- El test de integración debe exigir `handler.getAliasCollisions().length === 0` tras `loadPlugins`.

## Decisiones

- **Import perezoso de ai.ts en el handler** en vez de import estático: es la única forma, sin tocar `ai.ts`/`admin-stats.ts` (ajenos), de que el handler sea testeable sin arrancar el bot ni cargar los 100 plugins. Se revierte en un paso cuando el agente IA cambie su import (ver arriba). Alternativa descartada: guardar `main()` de index.ts tras un `isMainModule` por `process.argv[1]`, porque pm2 en modo fork no garantiza `argv[1]`.
- **`commandAliases` vive en lib/command-suggest.ts** y no en utils.ts: necesita el tipo `PluginHandler` y está emparentada con las sugerencias; plugins/index.ts la re-exporta para no romper importadores.
- **RegExp complejas fuera del índice** (`patternPlugins` en orden de registro): indexar sus alias exigiría enumerar el lenguaje de la regex. Consecuencia asumida: si una regex compleja se registra antes que un array con un alias que también casa, gana el array (el índice se consulta primero). Hoy la única regex compleja es `skillDetectorPlugin`, que pasa a contexto.
- **Cooldown de sugerencias por chat, no por usuario**: en grupos lo que molesta es el ruido del bot, no la repetición por persona.
- **Sugerencias acotadas por longitud** (distancia <= floor((len-1)/2)): con el umbral fijo de 2, "xyz" sugería "yo" y "ab" sugería "a".
- **`ctx.chatSettings` como clon de defaults cuando no hay entrada** también en grupos, no solo en privado: así leer ajustes nunca escribe en la BD; los plugins persisten con `updateChatSettings`.
- **Protecciones (antilink/antispam/antibad) siguen exentas solo para admins**, no para owners: era el comportamiento anterior y un owner no admin en un grupo ajeno no debería tener trato especial frente a las reglas del grupo.
- **`resolveGroupRoles` en group-events.ts y no en el handler**: reaction-handler y menu también necesitan saber si alguien es admin sin pasar por el handler.
- **Picks de Telegram solo por admin u owner** (antes cualquiera podía marcarlos con una reacción): los picks sin dueño eran manipulables por cualquier miembro.
- **`handleParticipantsUpdate` invalida la caché en add/remove también**: `ctx.participants` se usa para validar objetivos de kick/promote y quedaba desfasado.
- **Menú sin categoría "nuevos"**: no hay forma de saber qué es nuevo desde el registro; la lista hardcodeada envejecía. Los "más usados" salen de `db.data.stats`, que el handler ahora alimenta.
- **Scheduler por nombre con reemplazo**: evita duplicar timers en reconexiones; el handler usa un prefijo aleatorio por instancia para no pisar al handler anterior antes de su `stop()`.
- **cleanup-scheduler conserva `runSessionSweep`** acotado a session-/sender-key- > 90 días: son ficheros de chats muertos y Baileys los regenera si hace falta; las pre-keys no se tocan nunca.
- **`fetchMedia` consulta DNS** además de los literales: un dominio que resuelve a 10.x es el vector SSRF real; si el lookup falla se deja que `fetch` falle por su cuenta.

## Pendiente

- **Colisiones de alias**: siguen existiendo hasta que RPG combate y juegos muevan sus comandos cortos a contextos (lista exacta en el log de arranque: "alias X de A ya lo usa B"). El handler no lanza; el test de integración debe exigir cero.
- **Comandos de duelo/dungeon sin prefijo no funcionan** hasta que se registren los contextos (punto RPG combate). Con prefijo siguen funcionando igual que antes.
- **`src/lib/ai.ts`** sigue importando `plugins/index.ts` y leyendo `rawMessage.message?.imageMessage` (agente IA).
- **Ciclo `admin-stats.ts` -> `index.ts`** (arranca el bot al importarse): no es mío; impide importar `plugins/index.ts` en tests.
- **`rpg-dungeon-interactivo.ts:95`** `setInterval` de módulo sin `unref` (agente RPG): cualquier test que importe plugins/index.ts no terminaría.
- **Timers ajenos sin migrar a scheduler**: database.saveInterval, auto-regen, auto-events, telegram healthcheck.
- **Plugins nuevos sin registrar** en `plugins/index.ts` (ver "Integrador final").
- `UNTRACKED_COMMANDS` en handler.ts se puede borrar cuando group-delete marque `untracked: true`.
