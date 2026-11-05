# Handoff: integración (ronda 1)

Estado al cierre: `npx tsc --noEmit` pasa en todo el árbol y `npm test` pasa completo (377 tests; 36 en `tests/nucleo-*.test.ts` del handler, group-events/anti-delete y cleanup, 3 en `tests/integracion-registry.test.ts`). Durante la ronda fallaron a ratos `tests/rpgprog-*.test.ts` y `tests/rpgcombate-duelo.test.ts`, cuyos archivos estaba editando el agente RPG en paralelo; al cierre pasan.

Nota: durante la ronda el orquestador hizo commits de checkpoint que ya incluyen la mayor parte de estos cambios; sin commitear quedan el ajuste de `registerPlugin` en handler.ts, la lista blanca por pares del test de integración y este handoff.

## Hecho

### Qué se aplicó de cada handoff

| Handoff | Pedido | Estado |
|---|---|---|
| grupos | `plugins/index.ts`: imports nuevos, `TOGGLE_ENTRIES`, consts de group-admin/mute/delete/pin/lock, `ENTRIES.grupos` completo, borrar las 6 `Section.register` y `admin-notify` | Hecho |
| grupos | Borrar shims `group-protection/antidelete/autosticker/autodownload/compact`, `admin-notify`, los `register*` de group-admin/mute/delete/pin/lock y los `export { ... } from './group-toggles.js'` de group-welcome y group-antibad | Hecho (grep: ningún importador) |
| grupos | handler: `participants.ts` para roles y `m.sender` canónico | Hecho (vía `resolveGroupRoles`, que ahora delega en participants.ts; `canonicalJid` en el handler) |
| grupos | handler: `isUserMuted` -> `isMutedNow`; sin `muteRegistry` | Hecho; además los mutes temporales vencidos se retiran de la BD al detectarlos |
| grupos | handler: bot apagado por grupo (`isBotEnabled` + `parseToggle` + alias de `botTogglePlugin`) | Hecho |
| grupos | handler: antilink/antispam/antibad con `isForbiddenLink`/`getAntiLinkMode`/`getMaxWarnings`/`applyAutoWarning` | Hecho; exentos admins y owner (lo pedía la tarea) |
| grupos | `MessageHandlerInterface.deleteMessage/removeTrackedMessages/botIds`; `deleteMessage` llama `forgetMessage`; `plugin.untracked` en vez de `UNTRACKED_COMMANDS` | Hecho; group-delete.ts dejó de hacer duck typing y `clear N` usa `removeTrackedMessages` |
| grupos | anti-delete: descartar `update.update.key.fromMe`, omitir si el revocador es admin, `forgetMessage`, encabezado con mención | Hecho |
| grupos | group-events: participants.ts, `renderGroupMessage`, sin bienvenida al bot, `adminAlerts !== false`, despedida con mención | Hecho (`detect` sigue hasta el rename de datos) |
| grupos | index.ts: `recordReconnectAttempt/recordReconnect/recordError`; borrar `getReconnectStats`/`reconnectCount` | Hecho (admin-stats ya importaba runtime-stats) |
| grupos | logger.ts: `recordLogLine` para warn/error | Hecho |
| descargas | `plugins/index.ts`: `platformDownloadPlugins`, media-info/tomp3/comprimir, quitar `download-*` y cobalt | Hecho; borrados los 6 `download-<plataforma>.ts` y el export `cobaltPlugin` |
| descargas | config: `downloaderApi.apiKey`, timeout 120000, `tmpDir`; downloader-client y ffmpeg leen CONFIG | Hecho (`TMP_DIR` de ffmpeg.ts sigue exportado como alias de `CONFIG.tmpDir` porque lo importan sus tests) |
| descargas | cleanup-scheduler: sin `runPlayDlSweep`; barre `CONFIG.tmpDir` incluidas carpetas `frames_*` | Hecho (`sweepDirectory` exportada y testeada) |
| descargas | `.env.example` `DOWNLOADER_API_TIMEOUT_MS=120000`; docker-compose igual | Hecho |
| descargas | `types/node-webpmux.d.ts` (hasAnim, frames, demux) y quitar el cast de sticker.ts | Hecho |
| descargas | anti-delete con `downloadMessageMedia` de media.ts | Hecho |
| descargas | handler: `void handleAutoDownload` para no bloquear | Hecho (con `.catch` por si `shouldAutoDownload` lanzara) |
| descargas | menu.ts: sin referencias a `/cobalt`, `/pin`, `/steal` | Verificado: no había; el menú se genera del registro |
| datos | index.ts: `stopAutoRegen`/`stopAutoEvents` en `gracefulShutdown` | Ya estaba; se añadió `stopReminders` |
| datos | `DatabaseSchema.stats` con escritores | Ya lo hacía el handler (`recordStat`) |
| datos / núcleo | Timers a scheduler: `database.saveInterval`, auto-regen, auto-events; `updateAutoEventsSocket` | Hecho |
| núcleo | import estático de ai.ts | NO: `ai.ts` sigue importando `commandAliases` de `plugins/index.js` (ver Pendiente) |
| núcleo | test de integración que exija cero colisiones | Hecho con lista blanca temporal (ver abajo) |
| juegos (en curso) | `setActiveConnection(conn)` en `open` | Hecho (el módulo existe y su firma es estable) |
| herramientas (en curso) | `startReminders`/`setRemindersConnection`/`stopReminders` en index.ts | Hecho |

### Por archivo

- **src/plugins/index.ts**: registro migrado según grupos y descargas. La sección `grupos` empieza por `...TOGGLE_ENTRIES` (12 interruptores) y sigue con los 33 comandos de grupo; `media` registra `media-tomp3`, `media-comprimir`, los 6 `download-<plataforma>` (de `platformDownloadPlugins`), `download-universal`, `download-audio`, `download-info` y `download-status`. Sin `admin-notify` ni `download-cobalt`. No se tocaron las secciones de áreas en curso (rpg, inventario, tienda, ranking, juegos, herramientas, betting, ia).
- **Borrados**: `src/plugins/group-protection.ts`, `group-antidelete.ts`, `group-autosticker.ts`, `group-autodownload.ts`, `group-compact.ts`, `admin-notify.ts`, `download-tiktok.ts`, `download-instagram.ts`, `download-facebook.ts`, `download-twitter.ts`, `download-pinterest.ts`, `download-threads.ts`. Quitadas las funciones `register*` de group-admin/mute/delete/pin/lock (y sus `import type { MessageHandler }`), los re-exports de group-welcome y group-antibad, el `cobaltPlugin` de download-universal.ts y los imports que quedaban sin uso en group-mute/group-delete.
- **src/handler.ts**:
  - Mute: la BD es la única fuente (`mutedUsers` + `mutedUntil` con cast). `muteUser` no duplica (`areJidsSameUser`), `unmuteUser` quita la entrada en cualquier formato y su vencimiento, `isUserMuted` = `isMutedNow`. En el flujo de automute, `isMutedOrExpire` retira de la BD un mute temporal ya vencido en cuanto el usuario escribe.
  - Protecciones: una sola `applyProtections` que elige el motivo (`Enviar enlace`, `Spam de mensajes`, `Palabra prohibida (x)`), borra y llama `applyAutoWarning` con `getMaxWarnings(settings)`; `isSpamming` extraído. Exentos admins y owner. `isForbiddenLink` respeta `antiLinkMode` (`antilink all`).
  - Bot apagado por grupo: `isBotEnabled(chatSettings)`; si está apagado solo pasan el owner y `/<alias de botgrupo> <sinónimo de on>` (`BOT_TOGGLE_ALIASES` sale de `commandAliases(botTogglePlugin)`). El chequeo va antes de las protecciones: con el bot apagado tampoco modera.
  - `m.sender` se canonicaliza con `canonicalJid` en cuanto se resuelve la metadata (dentro del closure `roles()`), así `ctx.user`, warns y mutes usan el id con el que el grupo conoce al usuario.
  - `deleteMessage` llama `forgetMessage` antes de borrar; `removeTrackedMessages(chatId, ids)`; `botIds()` ya estaba en la clase y ahora en la interfaz. `UNTRACKED_COMMANDS` eliminado (`plugin.untracked`; group-delete ya lo marca).
  - `registerPlugin` ignora un alias repetido dentro del propio plugin (no es colisión; aparecía con `winner === loser` al cambiar rpg-duelo).
  - Autodownload sin `await` (`.catch` propio).
- **src/types/message.ts**: `deleteMessage`, `removeTrackedMessages`, `botIds` en `MessageHandlerInterface`; eliminados `MuteConfig`/`MuteRegistry` (sin usos).
- **src/lib/anti-delete.ts**: `forgetMessage` exportada; se lee `update.update.key` (clave de la revocación): `fromMe` -> lo borró el bot, se ignora; `participant` admin (metadata cacheada + participants.ts) -> se ignora; si no, encabezado `🗑️ @usuario borró este mensaje` con `mentions` (texto en el mismo mensaje; media/contacto/ubicación en dos). Media por `downloadMessageMedia` de media.ts con el contenido ya desenvuelto.
- **src/lib/group-events.ts**: `isGroupAdmin`/`isGroupMember`/`resolveGroupRoles` delegan en `findParticipant`/`findBotParticipant`/`getAdmins`/`isParticipantAdmin` de participants.ts (desaparecen `isAdminParticipant`/`participantMatches`); `handleParticipantsUpdate` usa `renderGroupMessage` ({user} mención, {name} = mención al no conocerse el pushName, {group}, {desc}, {count} tras el cambio) en bienvenida y despedida, no saluda ni despide al bot, y condiciona promote/demote a `adminAlerts !== false` (lectura con cast). `getGroupName` se conserva (lo usa index.ts).
- **src/index.ts**: `recordReconnectAttempt` en `scheduleReconnect`, `recordReconnect` en reconexión abierta, `recordError(error, 'conexion')` al fallar `connectBot` y en cada cierre con error, `recordError` en `uncaughtException`/`unhandledRejection`. Borrados `getReconnectStats`, `ReconnectStats`, `reconnectCount`, `lastError*`. En `open`: `setActiveConnection(conn)` (juegos); primera conexión `startReminders(conn)`; reconexión `updateAutoEventsSocket(conn)` (ya no se reprograma el próximo evento) y `setRemindersConnection(conn)`. `gracefulShutdown` llama además `stopReminders()`.
- **src/lib/logger.ts**: `write()` manda warn/error a `recordLogLine(level, scope, mensaje)` sin chalk.
- **src/config.ts**: `downloaderApi.apiKey`, `timeout` por defecto 120000, `tmpDir` (`TMP_DIR || ./tmp`), comentario del servicio actualizado.
- **src/lib/downloader-client.ts** (`authHeaders` -> `CONFIG.downloaderApi.apiKey`), **src/lib/ffmpeg.ts** (`TMP_DIR = CONFIG.tmpDir`).
- **src/lib/cleanup-scheduler.ts**: sin play-dl ni `os.tmpdir()`; `sweepDirectory(dir, maxAge, { filter?, directories? })` exportada: con `directories` borra también subcarpetas viejas con `rm` recursivo contando su tamaño; el barrido de temporales va sobre `CONFIG.tmpDir`. Tareas: `cleanup:initial`, `cleanup:tmp`, `cleanup:session`.
- **src/lib/database.ts**: autoguardado con `scheduler.every(\`db:autosave:<n>\`)` (nombre por instancia: los tests abren varias BD a la vez) y `scheduler.stop` en `stop()`. Los wrappers betting NO se tocaron (ronda 2).
- **src/lib/auto-regen.ts**: `scheduler.every('rpg:regen')`/`scheduler.has`/`scheduler.stop`. **src/lib/auto-events.ts**: próximo evento con `scheduler.after('rpg:auto-event')`, `toggleAutoEvents` consulta `scheduler.has`, nuevo `updateAutoEventsSocket(conn)`. Los timers de restauración por evento (`restoreTimers`) siguen como `setTimeout` con `unref`: son uno por evento activo y se cancelan solos.
- **src/types/node-webpmux.d.ts**: `AnimFrame`, `hasAnim`, `frames`, `demux`. **src/lib/sticker.ts**: `WebpmuxImage` ya es el tipo del módulo, sin intersección local.
- **src/plugins/group-delete.ts**: `deleteByKey` llama `ctx.handler.deleteMessage`; `clear N` usa `handler.removeTrackedMessages`.
- **docker-compose.yml** (`DOWNLOADER_API_TIMEOUT_MS: "120000"`), **.env.example** (`DOWNLOADER_API_TIMEOUT_MS=120000` con comentario; `DOWNLOADER_API_KEY` y `TMP_DIR` ya estaban, sin duplicados).
- **menu.ts**: sin cambios. Se verificó que no cita `/cobalt`, `/pin` ni `/steal`; los comandos nuevos de grupo y media aparecen al estar registrados (todos tienen `description` o `help`, lo exige el test).

### Tests
- `tests/integracion-registry.test.ts` (nuevo): `loadPlugins` en un handler con conn falso y BD temporal no lanza y carga > 150 plugins (comprueba presencia de `group-bot`, `group-grupo`, `group-tempmute`, `group-setwarns`, `download-tiktok`, `download-info`, `media-tomp3`, `media-comprimir` y ausencia de `admin-notify`, `download-cobalt`, `group-protection`); cada plugin tiene al menos un alias (o un RegExp con patrón: `rpg-skill-detector`, `rpg-dungeon-habilidad`, `rpg-dungeon-item`) y `description` o `help`; las colisiones están todas en `ALLOWED_COLLISION_PAIRS` (pares ganador>perdedor documentados) y ninguna es `winner === loser`; emite `diagnostic` con los pares tolerados que ya no colisionan. Importar `plugins/index.ts` no arranca nada y el proceso termina solo (admin-stats ya no importa index.ts; el `setInterval` de rpg-dungeon-interactivo ya vive en `startDungeonCleanup` con `unref`; el de `lib/games/session.ts` lleva `unref`).
- `tests/nucleo-handler.test.ts` (+4): bot apagado por grupo, antilink con advertencia/mención/exenciones/modo `all`, mute temporal vencido y vigente, `removeTrackedMessages` + `untracked` + `deleteMessage` olvida en anti-delete.
- `tests/nucleo-group-events.test.ts` (nuevo): bienvenida/despedida con variables y mención y sin saludar al bot; `adminAlerts`; anti-delete con revocador usuario/bot/admin y `forgetMessage`.
- `tests/nucleo-cleanup.test.ts` (nuevo): `sweepDirectory` con archivos y carpetas `frames_*` viejas y recientes.

## Para otros agentes

### Agente RPG combate (rpg-duelo.ts, rpg-dungeon*.ts, rpg-combate-router.ts, owner-rpg.ts)
- Ronda 2 en `src/plugins/index.ts`: añadir `import { registerCombatContexts } from './rpg-combate-router.js';` y la sección `{ category: 'rpg-combate', register: registerCombatContexts }` antes de `rpg`; quitar las secciones `inventario`/`tienda` y las entradas listadas en su handoff; usar `ownerRpgEntries` en lugar de `ownerRpgPlugins.map(...)`. En `src/index.ts`, `stopDungeonCleanup` en `gracefulShutdown`. Al hacerlo, borrar de `ALLOWED_COLLISION_PAIRS` (tests/integracion-registry.test.ts) los 8 pares `rpg-*`.
- Hoy `atacarDueloPlugin`/`bloquearDueloPlugin`/`rendirsePlugin` listan algún alias dos veces en `command`; el handler ya lo ignora, pero conviene limpiarlo.

### Agente herramientas / IA (ai-chat.ts, ai.ts, betting-tipster.ts, tools-*.ts, admin-bridge.ts)
- `src/lib/ai.ts` línea 25: `import { commandAliases } from '../plugins/index.js';` -> `from './command-suggest.js'`. Cuando esté, en `src/handler.ts` sustituir el bloque `loadAI` (líneas 25-31) por `import { rememberChatLine, isDirectedToBot, respondWithAI } from './lib/ai.js';` y las dos llamadas `await loadAI()` por el módulo directo. Mientras, el import sigue perezoso.
- Quitar `bot` de `aiPlugin.command` para que `/bot on|off` llegue al interruptor de grupo; después borrar el par `'ai-chat>group-bot'` de `ALLOWED_COLLISION_PAIRS` y avisar a grupos para volver a poner `bot` como alias principal de `DEFS.bot`.
- Ronda 2 en `plugins/index.ts`: imports y entradas de tools-hora/wiki/calc/random/qr/encuesta/notas/cumple/recordar, `['admin-bridge', bridgePlugin]`, quitar `misTipstersPlugin` y la entrada `betting-mistipsters` (y el par `'betting-tipster>betting-mistipsters'` de la lista blanca). `index.ts` ya llama `startReminders`/`setRemindersConnection`/`stopReminders`.
- `recordError` de runtime-stats escribe una línea en el buffer y `index.ts` además hace `log.error(...)`, que ahora también entra al buffer vía logger: en `/logs` el mismo fallo aparece dos veces. Sugerencia (dueño: grupos, runtime-stats.ts): que `recordError` solo actualice contadores y deje el buffer al logger.

### Agente juegos (game-*.ts, fun-*.ts, lib/games)
- Ronda 2 en `plugins/index.ts`: sustituir el bloque `juegos` por `registerCasino`/`registerMinijuegos`/`registerAmor`/`registerBesos`/`registerSocial` antes de `herramientas`. En `src/index.ts` falta `restoreCasino(db)` tras `initDatabase` (no se añadió porque `lib/games/bets.ts` seguía en edición); `setActiveConnection(conn)` ya se llama en cada `open`.
- menu.ts: cambiar el tip `'/slot y /blackjack para apostar'` por `'/casino para ver los juegos'` cuando `casino` esté registrado.

### Agente datos (types/database.ts)
- Campos de `ChatSettings` pendientes (hoy con cast en handler.ts, group-events.ts, moderation.ts, group-toggles.ts, group-mute.ts, group-warn.ts): `enabled: true`, `antiLinkMode: 'wa'`, `maxWarnings?`, `mutedUntil: {}`, `adminAlerts: true`, `bye` (rename de `detect` con migración). Al añadirlos: en `handler.ts#unmuteUser` quitar el `as Partial<ChatSettings>`; en `group-events.ts` borrar `adminAlertsEnabled` y leer `settings.adminAlerts !== false` directo, y `settings.detect` -> `settings.bye`.
- Borrar los wrappers betting de `database.ts` cuando betting-*.ts usen `db.betting.*` (ronda 2).

### Agente grupos (participants.ts, group-toggles.ts)
- `participants.ts#getBotIds` puede usar `ctx.handler.botIds()` directamente: ya está en `MessageHandlerInterface`.
- `DEFS.autodownload.onText` con el texto que pide descargas (plataformas, 3 min de YouTube, 10 min de dedupe) y aviso si `!isDownloaderConfigured()`.
- Cuando `enabled` exista en el tipo, `PendingBooleanField` sobra en group-toggles.ts.

### Agente descargas (media.ts)
- El comentario de `getQuotedText` ("que el handler aún no incorpora") está desfasado: `m.quoted.text` ya incluye el caption de video y documento (`getText` de wa-message.ts). `getQuotedText` puede quedar como alias de `m.quoted?.text ?? ''` o eliminarse.

## Decisiones

- **Colisiones por pares de plugins, no por alias**: la primera versión de la lista blanca fijaba las triplas `alias/ganador/perdedor` y se rompió en minutos porque el agente de combate estaba renombrando alias (`atk`, `def`, `flee`...). Comparar por par de nombres tolera ese vaivén y sigue detectando cualquier colisión nueva entre otros plugins. Un par tolerado que deje de colisionar se avisa con `diagnostic`, no con fallo, para que el test no dependa de archivos ajenos en edición.
- **Alias repetido dentro del propio plugin no es colisión** (`registerPlugin` recorre `new Set(aliases)`): el índice ya apuntaba al mismo plugin, así que registrar "colisión consigo mismo" solo ensuciaba el log y el menú.
- **Owner y admins exentos de las protecciones**: núcleo había dejado exentos solo a los admins; la tarea pide eximir también al owner, y `applyAutoWarning` acabaría intentando expulsarlo (lo que WhatsApp rechaza si es admin y lo que no se quiere si no lo es).
- **La puerta de "bot apagado" va antes de las protecciones**: un grupo que apaga el bot espera que no haga nada, tampoco borrar enlaces; el owner sigue pasando para poder administrar.
- **Mutes temporales vencidos se limpian al escribir** (`isMutedOrExpire`) además de en los comandos de mute: así el usuario recupera la voz a tiempo aunque nadie use `/mute` después; `isUserMuted` de la interfaz sigue siendo pura.
- **Canonicalizar `m.sender` dentro de `roles()`**: la metadata es perezosa (solo se pide cuando hay protecciones activas o el plugin la necesita), y hacerlo ahí evita una consulta de metadata por cada mensaje de cada grupo. Consecuencia: sin metadata (fallo de red, chat privado) `m.sender` queda como llegó. `isOwner` se calcula antes, con el id original (en grupos LID el owner por número ya no se reconocía antes de este cambio; no se intentó resolver aquí porque exigiría metadata en cada comando de owner).
- **`updateAutoEventsSocket` en vez de `stopAutoEvents(); startAutoEvents(conn)`**: con el timer en el scheduler, reprogramar en cada reconexión alargaba el intervalo real entre eventos.
- **Nombre de tarea por instancia en `Database`** (`db:autosave:<n>`): `datos-database.test.ts` abre varias BD a la vez; con un nombre fijo la segunda habría cancelado el autoguardado de la primera.
- **`restoreCasino` no se añadió a index.ts**: `lib/games/bets.ts` es de un área en curso y la tarea solo pedía `setActiveConnection`; queda para la ronda 2 junto al registro del casino.
- **`sweepDirectory` exportada** para poder probar el borrado de carpetas sin esperar al timer ni depender de `CONFIG.tmpDir`.
- **Se mantuvo `TMP_DIR` exportado en ffmpeg.ts** (= `CONFIG.tmpDir`) porque `descargas-ffmpeg.test.ts` y el propio módulo lo usan; cambiar la firma pública de un archivo ajeno no era necesario.

## Pendiente

- **Ronda 2 (áreas en curso)**: registrar en `plugins/index.ts` los plugins de juegos (`registerCasino`...), herramientas (tools-*, admin-bridge), RPG progresión (`rpg-pescar/cazar/explorar/eventos`) y RPG combate (`registerCombatContexts`, `ownerRpgEntries`); `restoreCasino(db)` y `stopDungeonCleanup()` en index.ts; campos nuevos de `ChatSettings` y quitar los casts; borrar wrappers betting de database.ts; quitar el alias `bot` de ai-chat; import estático de ai.ts en el handler; `ALLOWED_COLLISION_PAIRS` a cero.
- **Colisiones de alias vigentes** (35 alias, 10 pares; todas de áreas en curso):

| Alias | Gana | Pierde |
|---|---|---|
| atacar, attack | rpg-atacar | rpg-atacar-duelo |
| atacar, attack | rpg-atacar | rpg-dungeon-atacar |
| a, atk | rpg-atacar-duelo | rpg-dungeon-atacar |
| d, b, defender, bloquear, defend, def | rpg-bloquear-duelo | rpg-dungeon-defender |
| huir, salir, rendirse, escapar, flee | rpg-rendirse | rpg-dungeon-huir |
| dungeon, dungeons, mazmorra, dr | rpg-dungeons-interactivo | rpg-dungeon-interactivo |
| dungeon, dungeons, mazmorra, dr | rpg-dungeons-interactivo | rpg-dungeon |
| dungeon, dungeons, mazmorra, dr | rpg-dungeons-interactivo | rpg-dungeons |
| bot | ai-chat | group-bot |
| tipster, tip, mistipsters, misfavoritos, mytipsters | betting-tipster | betting-mistipsters |

  (La lista exacta de alias puede variar mientras combate renombre comandos; el test la imprime como `diagnostic`.)
- `/bot on|off` responde la IA hasta que ai-chat suelte el alias; los textos anuncian `/botgrupo`, que funciona.
- `ai.ts` sigue importando `plugins/index.ts`: el handler mantiene el import perezoso.
- En `/logs` un error registrado con `recordError` + `log.error` aparece dos veces (ver nota a runtime-stats).
- Sin prueba de `index.ts` (ejecuta `main()` al importarse); los cambios de reconexión/runtime-stats se verificaron por lectura y con tsc.
- No se probó contra WhatsApp real: el formato de `update.update.key` en una revocación (clave del protocolMessage con `fromMe`/`participant`) se tomó de la implementación de Baileys (`process-message`, `REVOKE`); conviene una pasada manual: borrar un mensaje propio, que lo borre un admin, que lo borre el bot por antilink.
