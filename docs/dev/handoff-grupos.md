# Handoff: área grupos y administración

Estado al cierre de la ronda de corrección: `npx tsc --noEmit` pasa completo y `npm test` pasa en todo lo mío (`tests/grupos-*.test.ts` y `tests/moderation.test.ts`: 62 tests). Las dos fallas que quedan en la suite son de `tests/rpgprog-actions.test.ts` y `tests/rpgprog-robar.test.ts` (área RPG, en edición en paralelo).

Regla que seguí: `plugins/index.ts`, `handler.ts`, `index.ts`, `anti-delete.ts`, `group-events.ts`, `types/*` y `logger.ts` no se tocaron. Todo lo que exportaba algo que `plugins/index.ts` importa sigue existiendo como wrapper `@deprecated` (ver "Para plugins/index.ts") para que compile en todo momento. Los archivos que la tarea pedía borrar quedaron como shims de una línea con `@deprecated`; se borran en el mismo cambio que migre `index.ts`.

## Hecho

### Ronda de corrección (hallazgos de los revisores)
Qué se corrigió y dónde; cada punto tiene test salvo que se diga lo contrario.
- **`bot on|off` apuntaba al alias que se lleva la IA** (group-toggles.ts, 3 hallazgos): el alias principal es ahora `botgrupo` (`command: ['botgrupo', 'bot']`), así estado, ayuda, `offText` y el panel `/grupo` muestran el comando que sí funciona; `bot` queda como alias para cuando IA lo retire. El parche del handler (abajo) usa `parseToggle(arg) === 'on'` y la lista de alias del propio plugin, para que `botgrupo activar` también pase la puerta.
- **`setpic` no veía la imagen en grupos con mensajes temporales** (group-tools.ts): usa `mediaInMessage`/`getQuotedOrOwnMedia` de `lib/media.ts` sobre `m.message` (ya desenvuelto) con tope de 5 MB; se borró la copia de `downloadMessageMedia` de group-tools y group-tagall importa la de `lib/media.ts`.
- **`antilink all` marcaba correos, versiones y palabras pegadas a un punto** (moderation.ts, 2 hallazgos): el host sin esquema no puede ir pegado a `@`, `.`, `/`, `-` ni a otro carácter de palabra y su primera etiqueta lleva una letra (`soporte@empresa.com`, `2.0.es` ya no disparan). Los TLD se parten en dos listas: los que no son palabras (`com`, `net`, `org`, `io`, `app`, `online`...) cuentan sin ruta (`ejemplo.com`); los códigos de país que también son sílabas (`me`, `es`, `co`, `to`, `tv`, `mx`...) solo con ruta, `www.` o esquema (`ok.es verdad` y `compra.me algo` ya no disparan; `ejemplo.es` suelto tampoco, ver Decisiones).
- **Números con espacios en args** (participants.ts): `numbersInArgs` (ahora exportada) une los grupos cortos consecutivos de dígitos (`+52 1 000 000 0003` llega en cinco args) y trata un grupo de 7 a 16 dígitos como número completo; una palabra (`10m`) cierra el grupo en curso. El test usa `split(/\s+/)` como el handler.
- **unmute/listmute con entradas guardadas en el otro formato** (group-mute.ts): nueva `isSameParticipant(metadata, a, b)` en participants.ts (también la usa `assertCanModerate`) y `findStoredMute(ctx, settings, target)` exportada; unmute borra la entrada tal como está guardada y mute/tempmute la migran al id canónico en vez de duplicarla.
- **mute sobre un tempmute** (group-mute.ts): `/mute` sobre un mute temporal lo vuelve permanente ("antes era temporal"), `/tempmute` sobre cualquier mute actualiza el vencimiento ("mute actualizado"), y solo `/mute` sobre un permanente avisa "ya está silenciado permanentemente" indicando `/unmute`.
- **Confirmación falsa en kick/promote/demote** (group-admin.ts): `splitUpdateResults(sent, results, metadata)` exportada compara la respuesta de WhatsApp con `isSameParticipant` mirando `r.jid` y `content.attrs.{jid,lid,phone_number}`; si el servidor respondió por participante y alguno no aparece, cuenta como fallo.
- **Pilas de llamadas y rutas en `/logs` y `botstats`** (runtime-stats.ts, admin-stats.ts): `sanitizeLogMessage` (exportada) quita las líneas `at ...`, aplana a una línea y recorta a 600 caracteres antes de guardar en el buffer; `botstats` muestra `basename(CONFIG.databasePath)`.
- **`def.extra[word]` heredaba de Object.prototype** (group-toggles.ts, 2 hallazgos): `Object.hasOwn`; `/antilink constructor` o `__proto__` muestran el estado como cualquier argumento desconocido.
- **`{p}` sin sustituir en la descripción de automute** (group-toggles.ts): texto sin marcador; test que ninguna `description`/`label` lleve `{p}`.
- **Shims `@deprecated` en vez de borrar archivos** (hallazgo sobre group-protection.ts y compañía): no se cambia. `plugins/index.ts` (ajeno) sigue importándolos (comprobado: `registerGroup*`, `antiLinkPlugin` de group-protection, `notifyPlugin`...) y la regla es que `tsc` pase en todo momento; el borrado va en el mismo cambio que migre index.ts (lista exacta en "Para plugins/index.ts").

### src/lib/participants.ts (nuevo)
Resolución de personas en grupos `pn` (ids `@s.whatsapp.net`) y `lid` (ids `@lid`). Todo compara con `areJidsSameUser` contra `p.id`, `p.jid` y `p.lid`, así que un sufijo de dispositivo (`:12`) o el formato contrario no rompen nada.
- `findParticipant(metadata, ...jids)`, `isParticipantAdmin(p)`, `isParticipantSuperAdmin(p)`, `getAdmins(metadata)`, `findBotParticipant(metadata, botIds)`, `canonicalJid(metadata, jid)`, `isSameParticipant(metadata, a, b)` (misma persona aunque uno sea número y otro LID), `numbersInArgs(args)`.
- `getBotIds(ctx)`: usa `handler.botIds()` si existe (duck typing; hoy está en la clase y no en la interfaz) y si no deriva de `conn.user.id`/`conn.user.lid`.
- `resolveTargets(ctx, { allowNumber?, allowSelf? })` y `resolveTarget(...)`: mención > cita > número en args; devuelve el `participant.id` del grupo; el número se busca también en `p.jid`; un número que no está en el grupo se devuelve como `@s.whatsapp.net` para que `assertCanModerate` explique "no está en el grupo"; descarta el jid del grupo (citas de mensajes de sistema) y a uno mismo salvo `allowSelf`; sin duplicados.
- `assertCanModerate(ctx, targetId, 'kick'|'promote'|'demote'|'mute'|'warn') => string | null`: uno mismo (también cuando la mención llega en el formato contrario al del grupo), el bot, el owner del bot (mira todos los ids del participante, no solo el que llegó), no está en el grupo, creador del grupo para kick/demote (ni el owner puede), admin salvo que el ejecutor sea owner, "ya es admin"/"no es admin" para promote/demote.
- `removeParticipant(conn, chat, jid)`: expulsa y devuelve si WhatsApp aceptó (`status === '200'`).

### src/lib/runtime-stats.ts (nuevo)
`runtimeStats` (objeto mutable: `startedAt`, `reconnects`, `reconnectAttempts`, `errors`, `lastErrorAt`, `lastError`), `recordReconnectAttempt()`, `recordReconnect()`, `recordError(error, scope?)`, buffer circular de `LOG_BUFFER_SIZE = 200` líneas warn/error con `recordLogLine(level, scope, message)`, `getRecentLogLines(limit?)`, `formatLogLine(line)` y `resetRuntimeStats()` (pruebas). Nadie lo alimenta todavía: ver "Para núcleo".

### src/lib/moderation.ts
- Nuevo `isForbiddenLink(text, mode: 'wa' | 'all' = 'wa')`: `wa` = `chat.whatsapp.com/<código>` y `t.me/...`; `all` = además cualquier URL (`https?://`, `www.` o `dominio.tld[/ruta]` con lista de TLD). Regex propias y sin flag `g` (la de `CONFIG.protection.linkRegex` es `/gi` y `test()` con `lastIndex` da falsos negativos alternos).
- `getAntiLinkMode(settings)`, `getMaxWarnings(settings)` (fallback `CONFIG.protection.maxWarnings`), `getMutedUntil(settings)`, `isMutedNow(settings, jid, now?)`: leen los campos pendientes de `ChatSettings` con cast local.
- `applyAutoWarning(deps, chat, sender, reason)` con `deps = { db: { addWarning, clearWarnings }, conn: { sendMessage, groupParticipantsUpdate }, metadata?, maxWarnings }`: registra el warn como `SYSTEM_WARNER = 'SISTEMA'` sobre el jid canónico, avisa con mención, y al llegar al máximo expulsa (limpia warns) o avisa "no pude expulsarlo (¿es admin?)" conservando el conteo. Devuelve `{ target, count, max, kicked, kickFailed }`. No depende del handler.

### src/plugins/group-toggles.ts (nuevo)
- `parseToggle(text): 'on' | 'off' | 'status'` (on/off/1/0/si/sí/no/yes/activar/desactivar/enable/disable/true/false; cualquier otra cosa o nada = status).
- `createTogglePlugin(def)` y la tabla `TOGGLES` (12 entradas): antilink (acepta `all`/`wa` -> `antiLinkMode`), antispam, antidelete, antibad (`onEnable` carga `CONFIG.defaultBadWords` si `badWords` está vacío), autosticker, autodownload, welcome (`welcome test` previsualiza), bye (campo `detect` hasta el rename; `bye test` previsualiza), autoclear, compacto, automute (ahora `admin: true`, antes owner), y `bot on|off` (campo `enabled`, default true). Sin argumento: estado + uso con el prefijo real. Si ya está en ese estado responde "ya está ...".
- Exporta cada plugin por nombre, `TOGGLE_ENTRIES` (lista `[nombre, plugin]` para `ENTRIES.grupos`), `readToggle`, `statusIcon`, `isBotEnabled(settings)`.
- Cambio de comportamiento: `compacto` y `autoclear` sin argumento antes alternaban; ahora muestran estado (pedido explícito).
- Todos los alias anteriores se conservan (`antieliminar`, `autostiker`, `as`, `autodl`, `autodescarga`, `autolimpiar`, `autoclean`, `compact`, `silencioso`, `quiet`, `autosilencio`, `antigroserias`, `antibadword`).

### src/plugins/group-tools.ts (nuevo)
`grupoPlugin` (`grupo`, `config`, `ajustes`, `settings`: panel con miembros, admins, bot admin, silenciados, límite de warns, palabras prohibidas y cada interruptor con 🟢/🔴 y el comando exacto), `linkPlugin` (`link`, `enlace`, `invitacion`, `grouplink`), `revokePlugin` (`revoke`, `resetlink`, `revocar`), `setNamePlugin` (`setname`, `setsubject`, `nombregrupo`), `setDescPlugin` (`setdesc`, `setdescription`, `descripcion`; `setdesc borrar` la quita), `setPicPlugin` (`setpic`, `setppgroup`, `fotogrupo`, `setgrouppic`; imagen citada o con el comando de caption, vía `getQuotedOrOwnMedia` de lib/media.ts, tope 5 MB), `adminsPlugin` (`admins`, `administradores`, `listadmins`; marca 👑 creador y 🤖 bot), `leavePlugin` (`leave`, `salirgrupo`, `irse`; owner; `conn.groupLeave`). Todos `admin: true` salvo leave.

### src/plugins/group-admin.ts
`promotePlugin`, `demotePlugin`, `kickPlugin` como `const`. Una sola función `moderate(ctx, action)`: acepta varias menciones, pasa cada una por `assertCanModerate`, hace un único `groupParticipantsUpdate` con el array, reparte la respuesta con `splitUpdateResults` (exportada; compara ids vía metadata) y responde un único resumen con menciones reales. Promote/demote solo reaccionan (👑/📉) si todo salió bien (el aviso lo da group-events); kick responde `🚪 @a, @b expulsado(s)` salvo en modo compacto. Quitado el alias `remove` de kick (lo sombreaba `desequipar` de rpg-inventario, nunca funcionó). Se quitó el texto "Usa /leave" (habría sacado al bot, no al usuario). `registerGroupAdminPlugins` queda como wrapper `@deprecated`.

### src/plugins/group-mute.ts
- Sin `handlerRef`; todo por `ctx.handler`.
- `/mute` activa `autoMuteEnabled` solo si estaba apagado y lo dice; ya no exige `/automute on` previo. `automutePlugin` ahora está en group-toggles (re-registrado por el wrapper deprecated).
- Nuevo `tempMutePlugin` (`tempmute`, `mutetemp`, `silenciartemp`): `/tempmute @u 10m|2h|1d` (1 minuto a 30 días; `parseMuteDuration` exportada). Guarda `ChatSettings.mutedUntil[jid] = timestamp` con cast local; `expireMutes(ctx)` quita los vencidos con `handler.unmuteUser` (así el registro en memoria del handler no se desincroniza) en mute/unmute/listmute.
- `findStoredMute(ctx, settings, target)` localiza la entrada guardada aunque esté en el otro formato; mute/tempmute sobre alguien ya silenciado actualizan el vencimiento (y migran la entrada al id canónico) en vez de abortar.
- `isMutedNow` y `getMutedUntil` se re-exportan desde `lib/moderation.ts` (ahí viven para que el handler las importe sin depender de un plugin).
- Menciones reales en mute/tempmute/unmute/listmute; listmute muestra tiempo restante y el estado de automute.

### src/plugins/group-warn.ts
`resolveTarget` + `assertCanModerate` (ni bot, ni owner, ni uno mismo, ni admins salvo owner). `/warns @usuario` lista razón, "hace X" y quién (mención o "sistema"); `/warns` sin objetivo lista usuarios ordenados por cantidad. Nuevo `setWarnsPlugin` (`setwarns`, `maxwarns`, 1-20) guarda `ChatSettings.maxWarnings` con cast; warn lo lee vía `getMaxWarnings`. Si la expulsión falla: "llegó a N/M advertencias, pero no pude expulsarlo (¿es admin?). El conteo se conserva." Modo compacto: reacción + aviso temporal con `replyTemp`.

### src/plugins/group-delete.ts
- `deleteByKey(ctx, chat, key)`: usa `handler.deleteMessage` si existe (duck typing; hoy está en la clase pero no en la interfaz) y si no `conn.sendMessage({ delete })`. `replyTemp(ctx, text, ms, mentions?)` (helper exportado; lo usa group-warn).
- `/delete` detecta si el mensaje citado es del bot (`getBotIds` + `areJidsSameUser`) y manda `fromMe: true`; el serializador siempre pone `fromMe: false` en las citas, así que antes no se podían borrar mensajes del propio bot.
- `/clear N` solo quita del rastreo los procesados: como no hay `removeTrackedMessages`, vacía y vuelve a registrar el resto (pierden su marca de tiempo; ver "Para núcleo"). `untracked: true`.
- `autoClearPlugin` pasó a group-toggles; `registerGroupDeletePlugins` queda `@deprecated` y lo registra desde ahí.

### src/plugins/group-pin.ts
`pinPlugin`, `unpinPlugin` como `const`; `parsePinDuration` exportada: duración no reconocida -> `null` y el bot responde las opciones (24h/7d/30d) en vez de aplicar 24h. Sin `EMOJI` ni `console.error`. Wrapper `registerGroupPinPlugins` `@deprecated`.

### src/plugins/group-lock.ts
`closePlugin`, `openPlugin` como `const`, logger, invalidan la metadata cacheada. Wrapper `@deprecated`.

### src/plugins/group-tagall.ts
- `hideTagPlugin` unifica admin-notify: `command: ['hidetag', 'ht', 'n', 'notify', 'notificar', 'avisar']`, texto propio o citado, y si el citado trae imagen o video lo reenvía con las menciones; excluye al bot con `findBotParticipant`; reacciona 📢.
- `tagAllPlugin`: columnas de 3 por fila, trocea en varios mensajes a partir de `TAG_MAX_CHARS = 3500` (`buildTagChunks` exportada y testeada), excluye al bot.

### src/plugins/group-welcome.ts
`renderGroupMessage(template, { user, name, group, desc, count })` exportada (nuevas variables `{count}` y `{name}`), `previewWelcome(ctx)`/`previewBye(ctx)` para `welcome test`/`bye test`. setwelcome/setbye usan `usedPrefix` y documentan las variables. Los toggles se re-exportan desde group-toggles (`@deprecated`, solo para index.ts).

### src/plugins/group-antibad.ts
`antiBadPlugin` pasó a group-toggles (re-export `@deprecated`). add/del/list guardan las palabras plegadas con `foldText` (como compara `findBadWord`), usan `usedPrefix`, y `listbadwords` acepta también `vergroserias` sin acento.

### src/plugins/admin-stats.ts
`statSync(CONFIG.databasePath)`, `runtimeStats` en vez de `getReconnectStats` de index.ts, `msToTime` en vez de `formatUptime`, `mentionTag`, `db.getRegisteredUsers()`. Comando `['botstats', 'adminstats']` (quitado `stats`: lo sombreaba el ranking RPG). Muestra errores y último error.

### src/plugins/admin-restart.ts
`pm2HasProcess()` (`execFile('pm2', ['jlist'])` y busca `CONFIG.pm2Name`) antes de prometer el reinicio; sin pm2 responde que no hay supervisor en vez de `process.exit`. `/logs` lee primero el buffer de runtime-stats y solo si está vacío cae a pm2 (si existe). `createLogger('owner')`.

### Shims `@deprecated` (borrar al migrar index.ts)
`group-protection.ts`, `group-antidelete.ts`, `group-autosticker.ts`, `group-autodownload.ts` (re-export desde group-toggles), `group-compact.ts` (`registerGroupCompactPlugin` registra el toggle), `admin-notify.ts` (`notifyPlugin` = `hideTagPlugin`; mientras index.ts registre ambos, el mismo plugin aparece dos veces y `getAliasCollisions` lo listará: desaparece al quitar la entrada).

### Tests nuevos
`tests/grupos-participants.test.ts` (metadata en modo `pn` y `lid`, isSameParticipant, numbersInArgs con args partidos como los parte el handler), `tests/grupos-toggles.test.ts` (parseToggle, cada toggle contra una `Database` temporal, antilink all, antibad default, botgrupo on/off, welcome test, argumentos del prototipo, descripciones sin `{p}`), `tests/grupos-mute.test.ts` (isMutedNow, parseMuteDuration y los comandos mute/tempmute/unmute contra una `Database` temporal con un handler mínimo: entrada antigua, tempmute -> mute permanente, actualización de vencimiento, migración), `tests/grupos-tools.test.ts` (tagall, renderGroupMessage, pin, runtime-stats, sanitizeLogMessage, splitUpdateResults, setpic con mensaje efímero) y `tests/moderation.test.ts` (isForbiddenLink en ambos modos con los falsos positivos de los revisores, getMaxWarnings, applyAutoWarning).

## Para otros agentes

### Para plugins/index.ts (dueño: núcleo)

Imports a quitar:
```ts
import { registerGroupAdminPlugins } from './group-admin.js';
import { registerGroupMutePlugins } from './group-mute.js';
import { registerGroupDeletePlugins } from './group-delete.js';
import { registerGroupPinPlugins } from './group-pin.js';
import { registerGroupLockPlugins } from './group-lock.js';
import { registerGroupCompactPlugin } from './group-compact.js';
import { antiLinkPlugin, antiSpamPlugin } from './group-protection.js';
import { setWelcomePlugin, setByePlugin, welcomeTogglePlugin, byeTogglePlugin } from './group-welcome.js';
import { antiDeletePlugin } from './group-antidelete.js';
import { antiBadPlugin, addBadWordPlugin, delBadWordPlugin, listBadWordsPlugin } from './group-antibad.js';
import { autoStickerPlugin } from './group-autosticker.js';
import { autoDownloadPlugin } from './group-autodownload.js';
import { notifyPlugin } from './admin-notify.js';
import { warnPlugin, unwarnPlugin, listWarnPlugin, clearWarnPlugin } from './group-warn.js';
```
Imports a poner en su lugar:
```ts
import { promotePlugin, demotePlugin, kickPlugin } from './group-admin.js';
import { mutePlugin, tempMutePlugin, unmutePlugin, listMutePlugin } from './group-mute.js';
import { deletePlugin, clearPlugin } from './group-delete.js';
import { pinPlugin, unpinPlugin } from './group-pin.js';
import { closePlugin, openPlugin } from './group-lock.js';
import { TOGGLE_ENTRIES } from './group-toggles.js';
import { warnPlugin, unwarnPlugin, listWarnPlugin, clearWarnPlugin, setWarnsPlugin } from './group-warn.js';
import { setWelcomePlugin, setByePlugin } from './group-welcome.js';
import { addBadWordPlugin, delBadWordPlugin, listBadWordsPlugin } from './group-antibad.js';
import {
  grupoPlugin, linkPlugin, revokePlugin, setNamePlugin, setDescPlugin, setPicPlugin, adminsPlugin, leavePlugin,
} from './group-tools.js';
```
(`tagAllPlugin, hideTagPlugin` de `./group-tagall.js` se quedan como están.)

`ENTRIES.admin` (quitar `['admin-notify', notifyPlugin]`):
```ts
admin: [
  ['admin-restart', restartPlugin],
  ['admin-gitpull', gitPullPlugin],
  ['admin-logs', logsPlugin],
  ['admin-mode', modePlugin],
  ['admin-stats', adminStatsPlugin],
],
```
`ENTRIES.grupos` completo:
```ts
grupos: [
  ...TOGGLE_ENTRIES,
  ['group-grupo', grupoPlugin],
  ['group-promote', promotePlugin],
  ['group-demote', demotePlugin],
  ['group-kick', kickPlugin],
  ['group-mute', mutePlugin],
  ['group-tempmute', tempMutePlugin],
  ['group-unmute', unmutePlugin],
  ['group-listmute', listMutePlugin],
  ['group-warn', warnPlugin],
  ['group-unwarn', unwarnPlugin],
  ['group-listwarn', listWarnPlugin],
  ['group-clearwarn', clearWarnPlugin],
  ['group-setwarns', setWarnsPlugin],
  ['group-delete', deletePlugin],
  ['group-clear', clearPlugin],
  ['group-pin', pinPlugin],
  ['group-unpin', unpinPlugin],
  ['group-close', closePlugin],
  ['group-open', openPlugin],
  ['group-addbadword', addBadWordPlugin],
  ['group-delbadword', delBadWordPlugin],
  ['group-listbadwords', listBadWordsPlugin],
  ['group-setwelcome', setWelcomePlugin],
  ['group-setbye', setByePlugin],
  ['group-tagall', tagAllPlugin],
  ['group-hidetag', hideTagPlugin],
  ['group-link', linkPlugin],
  ['group-revoke', revokePlugin],
  ['group-setname', setNamePlugin],
  ['group-setdesc', setDescPlugin],
  ['group-setpic', setPicPlugin],
  ['group-admins', adminsPlugin],
  ['group-leave', leavePlugin],
],
```
`SECTIONS`: borrar las seis líneas `{ category: 'grupos-admin', register: registerGroupAdminPlugins }`, `grupos-mute`, `grupos-delete`, `grupos-compact`, `grupos-pin`, `grupos-lock`. Antes iban antes de `admin` y `grupos`; ahora todo va en `grupos`. Alias que ya no existen: `remove` (kick; lo ganaba `desequipar`), `stats` (adminstats; lo ganaba el ranking RPG). `notificar` sigue existiendo, pero en `hideTagPlugin`.

Después de ese cambio: borrar `src/plugins/group-protection.ts`, `group-antidelete.ts`, `group-autosticker.ts`, `group-autodownload.ts`, `group-compact.ts`, `admin-notify.ts`; quitar las funciones `register*` de group-admin/mute/delete/pin/lock y las líneas `export { ... } from './group-toggles.js'` de group-welcome.ts y group-antibad.ts (yo lo hago si me avisan; son borrados mecánicos).

### Para menu.ts (dueño: núcleo)
Comandos nuevos a listar en la categoría de grupos: `grupo` (`config`, `ajustes`), `link`, `revoke`, `setname`, `setdesc`, `setpic`, `admins`, `tempmute @u 10m|2h|1d`, `setwarns <n>`, `warns [@usuario]`, `botgrupo on|off` (apaga el bot en el grupo; `bot` solo cuando IA lo suelte), `welcome test`, `bye test`, `antilink all`. En owner: `leave`, `botstats` (ya no `stats`). `hidetag`/`n` ahora también `avisar`/`notify`. Quitar `remove` de kick y `stats` de adminstats si aparecen.

### Para ai-chat.ts (dueño: IA)
`aiPlugin` tiene el alias `bot` y la sección `ia` se registra antes que `grupos`, así que `/bot on|off` cae en la IA. Por eso el interruptor se anuncia como `botgrupo` en todos sus textos y `bot` es solo alias secundario. Si quitan `bot` de `aiPlugin.command` (recomendado; quedan `ia`, `ai`, `claude`, `pregunta`), `/bot on|off` empieza a funcionar sin tocar nada más; avísenme y pongo `bot` de nuevo como alias principal en `DEFS.bot`. Además `iachat` puede migrar a la tabla de group-toggles con `{ command: ['iachat', 'aichat', 'iamenciones'], field: 'aiChat', defaultOn: true, label: 'IA por menciones', emoji: '🤖', ... }` y así aparece en el panel `/grupo`.

## Para núcleo (handler/index/anti-delete/group-events)

### handler.ts: roles y remitente canónico
Sustituir el bloque que calcula `participants`, `groupAdmins`, `isAdmin`, `isBotAdmin` (búsqueda del bot por `includes(botNumber)`, que da falsos positivos por subcadena) por:
```ts
import { findParticipant, findBotParticipant, isParticipantAdmin, canonicalJid } from './lib/participants.js';
// ...
if (groupMetadata) {
  // El remitente puede llegar como LID o como número; se guarda como lo conoce el grupo.
  m.sender = canonicalJid(groupMetadata, m.sender);
  participants = groupMetadata.participants.map((p) => p.id);
  groupAdmins = groupMetadata.participants.filter(isParticipantAdmin).map((p) => p.id);
  isAdmin = isParticipantAdmin(findParticipant(groupMetadata, m.sender));
  isBotAdmin = isParticipantAdmin(findBotParticipant(groupMetadata, this.botIds()));
}
```
y el método `isAdmin(participants, jid)` pasa a `return isParticipantAdmin(findParticipant({ participants }, jid));`. (group-events.ts acaba de ganar `isAdminParticipant`/`participantMatches`/`botIdentities` que hacen lo mismo con `sameUser`; conviene que importen de participants.ts para tener una sola implementación.)

### handler.ts: mute con vencimiento
`isUserMuted(groupId, userId)` debe pasar a:
```ts
import { isMutedNow } from './lib/moderation.js';
isUserMuted(groupId: string, userId: string): boolean {
  return isMutedNow(this.db.getChatSettings(groupId), userId);
}
```
`muteUser`/`unmuteUser` pueden seguir escribiendo `mutedUsers` (el `muteRegistry` en memoria sobra: `isMutedNow` ya compara con `areJidsSameUser`, que el `Set` no hace). Si el handler quiere limpiar vencidos al vuelo: cuando `isMutedNow` devuelva false pero `mutedUsers` contenga al usuario, llamar `unmuteUser` y borrar la clave de `mutedUntil`.

### handler.ts: bot apagado por grupo
Tras el chequeo de `botMode`:
```ts
import { isBotEnabled, parseToggle, botTogglePlugin } from './plugins/group-toggles.js';
// ...
const chatSettings = m.isGroup ? this.db.getChatSettings(m.chat) : null;
if (chatSettings && !isBotEnabled(chatSettings) && !isOwner) {
  // Solo se deja pasar "botgrupo on" (y sus sinónimos: activar, si, 1...) para poder reactivarlo.
  const prefixed = m.text.match(CONFIG.prefix);
  const [cmd, arg] = prefixed ? m.text.slice(prefixed[0].length).trim().toLowerCase().split(/\s+/) : [];
  if (!(botTogglePlugin.command.includes(cmd ?? '') && parseToggle(arg) === 'on')) return;
}
```
`isBotEnabled` lee `enabled` con default true mientras no exista en el tipo; `parseToggle` acepta los mismos sinónimos que el plugin, así `/botgrupo activar` no se queda bloqueado en la puerta.

### handler.ts: antilink/antispam/antibad con advertencias reales
Hoy antispam solo amenaza y antilink usa `CONFIG.protection.linkRegex` (`/gi`, `match` funciona pero `test` alternaría). Sustituir las tres ramas por:
```ts
import { findBadWord, isForbiddenLink, getAntiLinkMode, getMaxWarnings, applyAutoWarning } from './lib/moderation.js';
// dentro de `if (isBotAdmin && !isAdmin && m.text)`:
const deps = { db: this.db, conn: this.conn, metadata: groupMetadata, maxWarnings: getMaxWarnings(chatSettings) };

if (chatSettings.antiLink && isForbiddenLink(m.text, getAntiLinkMode(chatSettings))) {
  await this.deleteMessage(m.chat, m.key);
  await applyAutoWarning(deps, m.chat, m.sender, 'Enviar enlace');
  return;
}
if (chatSettings.antiSpam && this.isSpamming(m)) {            // la lógica actual del spamTracker, extraída
  await this.deleteMessage(m.chat, m.key);
  await applyAutoWarning(deps, m.chat, m.sender, 'Spam de mensajes');
  return;
}
if (chatSettings.antiBad) {
  const found = findBadWord(m.text, chatSettings.badWords ?? []);
  if (found) {
    await this.deleteMessage(m.chat, m.key);
    await applyAutoWarning(deps, m.chat, m.sender, `Palabra prohibida (${found})`);
    return;
  }
}
```
`applyAutoWarning` ya manda el aviso con mención y expulsa (o explica que no pudo) al llegar a `maxWarnings`; borrar los `sendMessage`/`addWarning`/`groupParticipantsUpdate` manuales de esas ramas.

### handler.ts + types/message.ts: interfaz
Añadir a `MessageHandlerInterface`:
```ts
/** Borra un mensaje y hace que anti-delete lo olvide. */
deleteMessage(chatId: string, key: proto.IMessageKey): Promise<boolean>;
/** Quita del rastreo de /clear solo esos ids (clear N no debe vaciar todo). */
removeTrackedMessages(chatId: string, ids: string[]): void;
/** Identificadores del bot (número y LID). */
botIds(): string[];
```
En la clase, `deleteMessage` debe llamar `forgetMessage(chatId, messageKey.id)` (ver anti-delete) antes de `sendMessage({ delete })`, y añadir:
```ts
removeTrackedMessages(chatId: string, ids: string[]): void {
  const wanted = new Set(ids);
  const remaining = (this.messageTracker.get(chatId) ?? []).filter((t) => !t.key.id || !wanted.has(t.key.id));
  this.messageTracker.set(chatId, remaining);
}
```
Cuando existan: en group-delete.ts `deleteByKey` deja de hacer duck typing y `clearPlugin` sustituye el bloque "vaciar y volver a registrar" por `handler.removeTrackedMessages(m.chat, [...processed])`; en participants.ts `getBotIds` usa `ctx.handler.botIds()` directamente. Avísenme y lo cambio (tres líneas).

También `trackMessage` de los comandos: hoy el handler excluye `clear/limpiar/clean/autoclear` por nombre; `clearPlugin` ya declara `untracked: true`, úsenlo en vez de la lista.

### anti-delete.ts: no reenviar lo que borra el bot ni los admins, y decir quién borró
```ts
import { getGroupMetadataCached } from './group-events.js';
import { findParticipant, isParticipantAdmin } from './participants.js';
import { mentionTag } from './utils.js';

/** Para que handler.deleteMessage evite reenviar lo que borra el propio bot (antilink, antibad, mute, clear). */
export function forgetMessage(chatId: string, msgId: string): void {
  cache.delete(keyOf(chatId, msgId));
}

// en handleMessageUpdates, tras comprobar isRevoke y antiDelete:
const revokeKey = update.update?.key;          // clave del mensaje de revocación: quién borró
if (revokeKey?.fromMe) continue;               // lo borró el bot
const revoker = revokeKey?.participant ?? cached.key.participant ?? undefined;
if (revoker) {
  const metadata = await getGroupMetadataCached(conn, chatId);
  if (isParticipantAdmin(findParticipant(metadata, revoker))) continue;   // un admin borra con permiso
}
const header = `🗑️ ${mentionTag(revoker ?? cached.key.participant ?? chatId)} borró este mensaje`;
const mentions = revoker ? [revoker] : [];
```
y en `resend`: para texto, enviar `{ text: `${header}\n\n${texto}`, mentions }`; para media/contacto/ubicación, enviar primero `{ text: header, mentions }` y luego el contenido como hoy (`resend(conn, chatId, cached, header, mentions)`). En Baileys el `messages.update` de una revocación trae `update.key` con la clave del mensaje de revocación (`fromMe` si lo mandó el bot, `participant` = quien borró).

### group-events.ts
- Importar `renderGroupMessage` de `../plugins/group-welcome.js` (o moverla a group-events.ts y que group-welcome la re-exporte desde ahí; cualquiera de las dos, avísenme) y usarla con `count: metadata.participants.length` y `name: pushName si se conoce`. Hoy `{desc}` y `{count}` solo se resuelven en bienvenida; con `renderGroupMessage` ambos mensajes aceptan todas las variables y `{user}` va como mención también en la despedida.
- No dar la bienvenida al bot: `if (botIdentities(conn).some((id) => areJidsSameUser(id, participant))) continue;` al principio del bucle de `add`.
- Avisos de promote/demote condicionados: `if (settings.adminAlerts !== false) await conn.sendMessage(...)` (campo nuevo, ver datos). Con `/promote` el bot ya no manda texto propio; este aviso es el único.
- Despedida: leer `settings.bye` en vez de `settings.detect` cuando datos haga el rename; mientras, `detect`.
- Sus `isAdminParticipant`/`participantMatches`/`botIdentities` nuevos duplican `isParticipantAdmin`/`findParticipant`/`getBotIds` de participants.ts.

### index.ts
```ts
import { recordReconnect, recordReconnectAttempt, recordError } from './lib/runtime-stats.js';
// scheduleReconnect(): tras reconnectAttempts++ -> recordReconnectAttempt();
// connection === 'open' y !isFirstConnection: reconnectCount++ -> recordReconnect();
// process.on('uncaughtException', (error) => { recordError(error); log.error(...) });
// process.on('unhandledRejection', (reason) => { recordError(reason); log.error(...) });
```
Borrar `export function getReconnectStats` y `reconnectCount` (admin-stats ya no los importa; `reconnectAttempts` sigue haciendo falta para el backoff).

### logger.ts
En `write()`, antes del `if (LEVELS[level] < LEVELS[currentLevel]) return;` o justo después de componer `line`:
```ts
import { recordLogLine } from './runtime-stats.js';
if (level === 'warn' || level === 'error') recordLogLine(level, scope, parts.map(format).join(' '));
```
(sin chalk: el buffer se manda por WhatsApp con `/logs`). `recordLogLine` ya pasa el texto por `sanitizeLogMessage` (quita las líneas `at ...` de `error.stack`, aplana y recorta a 600 caracteres), así que pueden pasar `format(error)` tal cual sin exponer rutas del servidor. runtime-stats.ts no importa logger.ts, así que no hay ciclo.

## Para datos (types/database.ts)

Campos nuevos de `ChatSettings` (hoy los leo/escribo con cast local; al añadirlos al tipo se pueden quitar los casts en group-toggles.ts, group-mute.ts, group-warn.ts y lib/moderation.ts, lo hago yo si me avisan):

| Campo | Tipo | Default | Quién lo usa |
|---|---|---|---|
| `enabled` | `boolean` | `true` | `bot on\|off` (group-toggles), handler debe respetarlo |
| `antiLinkMode` | `'wa' \| 'all'` | `'wa'` | `antilink all`, `isForbiddenLink`, handler |
| `maxWarnings` | `number` | `CONFIG.protection.maxWarnings` (3); mejor no poner default en la BD y dejar que `getMaxWarnings` haga fallback, así cambiar CONFIG sigue afectando a los grupos que no lo tocaron | `/setwarns`, warn, applyAutoWarning |
| `mutedUntil` | `Record<string, number>` | `{}` | `/tempmute`, `isMutedNow`, handler |
| `adminAlerts` | `boolean` | `true` | group-events (avisos de promote/demote) |
| `bye` | `boolean` | `true` | reemplaza a `detect`: migración `chat.bye = chat.detect ?? true; delete chat.detect` en `migrateChatSettings` (subir `SCHEMA_VERSION`). Al hacerlo, cambiar `field: 'detect'` por `field: 'bye'` en `DEFS.bye` de group-toggles.ts y en group-events.ts |

`DEFAULT_CHAT_SETTINGS` sugerido: `enabled: true, antiLinkMode: 'wa', mutedUntil: {}, adminAlerts: true, bye: true` (y `maxWarnings` opcional sin default). `migrateChatSettings` con `applyDefaults` los rellenará solo.

## Decisiones

- **Shims en vez de borrar archivos**: la tarea pedía borrar group-protection/antidelete/autosticker/autodownload/compact/admin-notify, pero `plugins/index.ts` (ajeno) los importa y la regla de "tsc pasa en todo momento" manda. Quedan como re-exports `@deprecated` de una línea; el borrado va con la migración de index.ts.
- **Toggles de welcome/bye viven en group-toggles e importan `previewWelcome`/`previewBye` de group-welcome**; group-welcome re-exporta los toggles solo para index.ts. Es un ciclo de módulos temporal e inofensivo (ningún lado usa el binding del otro al evaluarse) que desaparece con el shim.
- **`automute` pasa de owner a admin**: `/mute` ya lo activa solo, así que dejarlo en owner solo servía para bloquear a los admins. Como interruptor sirve para apagar el borrado sin perder la lista.
- **`botgrupo on|off`**: `admin: true` y no owner, porque el handler dejará pasar `botgrupo on`; si solo el owner pudiera apagarlo, un admin que lo apagara se quedaría sin poder encenderlo. `botgrupo` es el alias principal (el que ven estado, ayuda, `offText` y panel) porque `bot` lo gana `/ia`; anunciar un comando que responde la IA dejaba grupos apagados sin camino visible de vuelta.
- **hidetag manda el texto tal cual** (sin el encabezado "📢 NOTIFICACIÓN" que ponía admin-notify): el sentido del comando es que el mensaje parezca escrito a mano; `/n` conserva el nombre pero no el adorno.
- **`isMutedNow` es pura** (no borra vencidos): el handler consulta en cada mensaje y no debe escribir en la BD por leer; la limpieza la hacen los comandos de mute vía `handler.unmuteUser` para no desincronizar el `Set` en memoria del handler.
- **`applyAutoWarning` recibe `maxWarnings` resuelto** en vez de leer la BD: así el handler decide la fuente (`getMaxWarnings(chatSettings)`) y las pruebas no necesitan una `Database`.
- **Regex de enlaces propias en moderation.ts**: `CONFIG.protection.linkRegex` es `/gi`, y el núcleo está quitando `telegramRegex` de CONFIG en paralelo. `wa.me/` no se considera invitación (no es un enlace de grupo).
- **Dominios de país sin ruta no cuentan en `antilink all`**: `compra.me algo` y `ejemplo.me` son sintácticamente idénticos; no hay forma de distinguirlos sin diccionario. Se prefiere dejar pasar `ejemplo.es` suelto a borrar y advertir por `ok.es verdad`. Con ruta, `www.` o esquema sí se detectan, y los TLD que no son palabras (`com`, `net`, `org`, `io`, `app`...) se detectan siempre.
- **`numbersInArgs` une grupos cortos de dígitos**: el handler parte por espacios, así que un número con espacios llega troceado. Un grupo de 7 a 16 dígitos es un número por sí solo; los cortos consecutivos se unen; una palabra cierra el grupo. Un número corto suelto detrás de un número completo (`... 0003 10 m`) se pegaría al número, es ambiguo por naturaleza y no se intenta adivinar; `10m` (la forma normal de tempmute) sí se separa.
- **mute sobre alguien ya silenciado actualiza en vez de abortar**: `/mute` convierte un temporal en permanente y `/tempmute` fija un nuevo vencimiento (también sobre un permanente); solo `/mute` sobre un permanente avisa. Así un admin extiende o fija un castigo sin pasar por `/unmute`.
- **`splitUpdateResults` cuenta como fallo a quien no aparece en la respuesta** cuando WhatsApp respondió por participante; antes se asumía éxito y se confirmaba algo que no pasó. Lista vacía sigue siendo "aceptado" (comportamiento de `removeParticipant`).
- **`/clear` marca como procesados también los que fallaron** (igual que `processAutoClear`): reintentarlos en el siguiente `/clear` no va a funcionar mejor y solo infla el contador de errores.
- **Promote/demote sin texto propio** aunque group-events aún no condicione su aviso: hoy el usuario ve un único aviso (el de group-events), antes veía dos.
- **`compacto`/`autoclear` sin argumento muestran estado** (antes alternaban), por coherencia con el resto de la tabla.
- **Media por `lib/media.ts`**: group-tools (setpic) y group-tagall (hidetag con imagen/video citados) usan `getQuotedOrOwnMedia`/`downloadMessageMedia` de ahí; la copia local que tenía group-tools se borró.
- **`setwarns` tope 20**: por encima el sistema de warns deja de tener sentido y un admin despistado podría anularlo con un número enorme.

## Pendiente

- Todo lo listado en "Para núcleo" y "Para datos": sin esos cambios, `tempmute` solo expira cuando alguien usa un comando de mute (el handler sigue mirando su `Set`), `bot off` no apaga nada, `antilink all`/`setwarns` no afectan al handler (que sigue con la regex y el máximo de CONFIG), anti-delete sigue reenviando lo que borra el bot, y `/logs` y `botstats` muestran 0 reconexiones/errores y buffer vacío hasta que logger.write e index.ts alimenten runtime-stats.
- `/bot on|off` responde la IA mientras `aiPlugin` conserve el alias `bot`; todos los textos anuncian `/botgrupo`, que es el que funciona.
- Las entradas re-registradas (`/clear` tras `clear N`) pierden su marca de tiempo hasta que exista `removeTrackedMessages`.
- No probé contra WhatsApp real (sin sesión en este entorno): `setpic`, `revoke`, `groupParticipantsUpdate` con arrays y el reenvío de media en `hidetag` están verificados solo por tipos; conviene una pasada manual en un grupo de prueba: `/grupo`, `/kick @a @b`, `/tempmute @x 1m` (esperar y escribir), `/warns @x`, `/n` respondiendo a una imagen, `/pin 2h` (debe listar opciones).
- `menu.ts` no conoce los comandos nuevos (ver "Para menu.ts").
