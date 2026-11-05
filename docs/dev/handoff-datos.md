# Handoff: área datos (capa de datos y utilidades RPG)

Estado al cierre de la ronda de corrección: `npm test` pasa (96 tests, 37 en `tests/datos-*.test.ts`). `npx tsc --noEmit` no da errores en los archivos del área datos; los errores que quedan son de archivos ajenos en edición (download-*.ts, media-play.ts, rpg-fumar.ts).

## Hecho

### Ronda de corrección (hallazgos de los revisores)
Todos los hallazgos eran correctos; ninguno se descartó. Por archivo:

- **database.ts, `save()`/`stop()` (pérdida de datos en el apagado)**: `save()` con una escritura en curso ya no devuelve esa promesa (lowdb serializa el JSON al llamar a `write()` y el disco se escribe después, así que lo mutado entre medias quedaba fuera): encadena otra escritura al terminar si la BD volvió a quedar sucia. `stop()` espera la escritura en curso y repite `save()` mientras `dirty` (tope `MAX_STOP_SAVE_ATTEMPTS = 3` por si el disco falla de forma persistente; en ese caso loguea error). Test con un `write` que serializa y escribe 50 ms después.
- **database.ts, `migrateUser` e inventario corrupto**: `sanitizeInventory` descarta entradas que no sean `{ itemId: string, quantity: número finito }` antes de fundir items renombrados; antes un `null` en el inventario hacía que `getUser` lanzara para siempre. Test.
- **database.ts, `migrateUser` y `health > maxHealth`**: un stat actual (`health/mana/stamina`) corrupto se repone con el máximo del propio usuario (`CURRENT_STAT_MAX`), no con el default absoluto. Test.
- **database.ts, `migrateUser` y `user.betting`**: `migrateBetting` repara la estructura de `betting` solo si existe (clona el default si no es objeto; `applyDefaults` sobre `betting` y `betting.stats`), sin crearlo y marcando dirty solo si reparó algo. Antes `followPick`/`resolvePick` lanzaban `TypeError` con un betting persistido sin `stats`. Tests (unitario y con BD sembrada).
- **database.ts, `runMigrations`**: llama a `migrateUser(user)` antes de `removeClassBaseStats(user)` (sobre campos ausentes la resta daba NaN y el siguiente `getUser` los reponía al default perdiendo el bonus de nivel). `removeClassBaseStats` además trata valores no finitos como el default. Test con `{ playerClass: 'guerrero' }`.
- **database.ts, `updateUser`**: los valores objeto de `updates` que no sean ya la referencia del propio usuario se clonan con `structuredClone`. Cierra el agujero de `db.updateUser(jid, { ...DEFAULT_USER })` (owner-rpg.ts:1576), que dejaba `inventory`, `combatStats`, etc. compartidos con `DEFAULT_USER` y contaminaba a todos los usuarios creados después. Pasar `user.inventory` del propio usuario no lo sustituye por una copia (los plugins siguen con la misma referencia). Test.
- **database.ts, `load()`**: solo un `SyntaxError` (JSON inválido) dispara la recuperación desde `.bak` y el renombrado a `.corrupt-*`; cualquier otro error (EACCES, EBUSY, EISDIR...) se propaga desde `init()` para no apartar un archivo sano ni arrancar con datos viejos. Test con un directorio en lugar de archivo (EISDIR).
- **auto-regen.ts, barrido**: `applyRegenToAllUsers` (ahora exportada para poder testearla) visita a todos los registrados; `regenUser` devuelve `updates` vacío cuando no hay nada que hacer. Así los usuarios al máximo con timestamps en 0 se inicializan en el barrido, como pedía la especificación. Cada usuario va en su propio `try/catch` para que uno corrupto no aborte al resto. Test con `initDatabase` y un usuario corrupto.
- **auto-regen.ts, acumulación con el stat al máximo**: `regenStat` avanza el timestamp aunque el stat esté lleno (solo en múltiplos del intervalo por punto, para no marcar dirty cada minuto). Antes 10 h al máximo + un golpe a 1 HP daban +99 HP un minuto después. Test.
- **levelling.ts, `setLevel` hacia abajo**: los máximos no bajan de `DEFAULT_USER` (piso antes: 1) y el dinero no se toca; subir sigue sumando el bonus completo. Un usuario subido con el `setnivel` antiguo (sin bonus) ya no acaba con `maxHealth 85` y `money 0` al bajarlo a 0. Tests actualizados y nuevo.
- **database.ts, `CLASS_STATS_MIGRATION_ENABLED = true`** (cambio que el agente RPG hizo en el árbol de trabajo): se mantiene en `true` porque rpg-clase.ts ya no suma/resta `baseStats` (verificado al cierre: la única referencia que queda es de texto). Queda pendiente owner-rpg.ts `setclase` (ver "Para otros agentes" 6).
- **Dualidad de `globalModes`**: no se puede cerrar desde el área datos (owner-rpg.ts es ajeno); se añadió a "Pendiente" con sus consecuencias funcionales y a "Para otros agentes" como requisito del mismo commit.


### src/lib/database.ts
- **Copias independientes**: creación y reset de usuarios/chats usan `structuredClone(DEFAULT_USER)` / `structuredClone(DEFAULT_CHAT_SETTINGS)`. Antes `{ ...DEFAULT_USER }` compartía `inventory`, `equipment`, `achievements`, `titles`, `activeBuffs`, `dailyQuests`, `weeklyQuests`, `combatStats`, `kissStats`, `hugStats`, `slaves`, `forgeMaterials` (y `warnings`, `mutedUsers`, `badWords` en chats) entre todos los creados en el mismo proceso.
- **`migrateUser(user)` tabular y exportada**: para cada clave de `DEFAULT_USER`, si falta, si el default es numérico y el valor no es finito, o si el default es array/objeto y el valor no lo es, asigna `structuredClone(default)`. Devuelve `boolean` y `getUser` solo marca dirty cuando cambió algo. Se eliminó la migración lowercase→camelCase de timestamps (esquema antiguo) y la reconstrucción incondicional de `user.betting` que dejaba `isDirty` siempre en true. Añade un paso puntual: funde `elixir_experiencia` en `elixir_exp` dentro del inventario (ver `RENAMED_ITEMS`).
- `migrateChatSettings(chat)` con la misma tabla para `DEFAULT_CHAT_SETTINGS`.
- **`resetUser(jid)`** público: reemplaza al usuario por un clon limpio y lo devuelve.
- **`save()` robusto**: devuelve `Promise<boolean>`; `dirty=false` antes de escribir y vuelve a `true` si falla; serializa escrituras concurrentes (`saving`); copia `database.json` → `database.json.bak` como máximo una vez por minuto antes de escribir.
- **`init()` tolerante**: si `read()` falla intenta `database.json.bak`; si tampoco, arranca con `DEFAULT_DATABASE`; en ambos casos renombra el archivo dañado a `database.json.corrupt-<timestamp>`. Valida que `users/chats/guilds/stats/settings` sean objetos planos (reemplaza los inválidos) y rellena `settings` con defaults. Loguea tamaño del archivo (KB) y número de usuarios con `createLogger('db')`.
- **`markDirty()`** público y getter **`isDirty`** (solo lectura).
- **Gremios**: `getGuild(id)`, `saveGuild(guild)`, `deleteGuild(id)`, `listGuilds()`; todos marcan dirty. `guilds` queda garantizado como objeto tras `init()`.
- **Migración por versión**: `SCHEMA_VERSION = 2`, `settings.schemaVersion`. La migración a v2 (`removeClassBaseStats(user)`, exportada y testeada) resta `CLASSES[playerClass].baseStats` de `maxHealth/maxMana/maxStamina/attack/defense` con piso en los valores de `DEFAULT_USER` y recorta `health/mana/stamina` al nuevo máximo. **Está desactivada** por `export const CLASS_STATS_MIGRATION_ENABLED = false` hasta que rpg-clase.ts deje de sumar baseStats (ver "Para otros agentes"). Mientras está en false, `schemaVersion` no se sube, así que la migración correrá una sola vez al activarla.
- **Betting**: toda la lógica se movió a `BettingStore` (`db.betting`). En `Database` quedan wrappers `@deprecated` con la misma firma, así los plugins de betting compilan sin cambios.
- Sin `console.*`; todo por `createLogger('db')`. Se quitó el encabezado decorativo.

### src/lib/betting-store.ts (nuevo)
- Clase `BettingStore(db: Database)` con `normalizeTipsterName`, `getBettingSystem`, `updateBettingSystem`, `getOrCreateTipster`, `getTipster`, `registerPick`, `resolvePick`, `cancelPick`, `getPendingPicks`, `getPickByMessageId`, `setPickMessageId`, `clearPendingPicks`, `getPickById`, `getLastPendingPick`, `followPick`, `getTipsterFollowers`, `followTipster`, `unfollowTipster`, `getUserBetting`, `getTipsterRanking`, `getPickHistory`. También exporta la función libre `normalizeTipsterName` y `MAX_FAVORITE_TIPSTERS = 20`.
- `createDefaultBetting()` = `structuredClone(DEFAULT_USER_BETTING)`; es el único sitio que crea `user.betting` (los 4 puntos antiguos ahora pasan por `getUserBetting`).
- `resolvePick` aplica `BettingSystem.maxHistory`: tras resolver, si hay más picks resueltos que `maxHistory` descarta los resueltos más antiguos (los pendientes nunca se tocan).
- `followTipster` corregido: si el usuario ya tiene 20 favoritos y el tipster no está entre ellos devuelve `false` sin añadirlo a `followers` (antes quedaba como follower sin ser favorito).
- `getBettingSystem`/`getOrCreateTipster` usan `structuredClone` de los defaults.

### src/lib/levelling.ts
- `grantExp(user, amount, { multiplier? })`: suma XP (floor de `amount * multiplier`), sube al nivel de `findLevel(exp)` sin bajar nunca el nivel actual, aplica `CONFIG.rpg.levelUpBonus` por cada nivel ganado (max stats + dinero; `health/stamina/mana` suben el mismo bonus con tope en el máximo real de `calculateTotalStats`) y devuelve `{ gained, leveledUp, from, to }`. Muta `user`; el caller persiste con `db.updateUser`.
- `setLevel(user, level)`: fija `exp = xpRange(level).min` y aplica o retira el bonus por la diferencia de niveles (pisos: maxHealth/maxStamina ≥ 1, maxMana ≥ 0, money ≥ 0; recorta stats actuales).
- `loseExp(user, amount)`: nunca baja de `xpRange(user.level).min`; devuelve lo restado.
- `getLevelProgress` acotado: `current ≥ 0`, `percent` en [0,100], `remaining ≥ 0`, y tolera `exp` no finito.
- Mensaje de error de `xpRange` sin emoji.

### src/lib/rpg-utils.ts
- `calculateTotalStats(user)`: única fuente de stats. Importa `ITEMS`/`CLASSES` internamente, suma la clase **siempre** y el equipo con el bonus de forja: `enhanceLevel` se lee de la entrada del inventario con el mismo `itemId` que el slot equipado, y cada stat del item se escala por `getEnhanceMultiplier(level)` = `1 + level * FORGE.ENHANCE_BONUS_PER_LEVEL/100` (+5 % por nivel, máximo +10 → +50 %, el mismo "+5 % stats" que rpg-forja.ts:1075 ya anuncia al jugador pero nunca aplicaba).
- `calculateDamage(attack, defense, critChance, multiplier = 1)`: general, nunca devuelve menos de 1, multiplicador saneado (no finito o ≤ 0 → 1).
- Eliminados `calculateMonsterDamage`, `calculateSuccessChance` y `formatLargeNumber` (grep: 0 usos fuera del propio archivo).
- Exporta el tipo `TotalStats`.

### src/types/user.ts
- `calculateTotalStats(user, items?, classes?)` queda como wrapper `@deprecated` que delega en `lib/rpg-utils.ts` ignorando los parámetros. Efecto: las llamadas que pasaban solo `ITEMS` sin `CLASSES` (rpg-duelo.ts:928-929, rpg-inventario.ts:271) ahora también incluyen la clase, que era lo pretendido.
- `ActiveBuff.type` admite `'forgeBoost'`.
- `role` y `classSelectedAt` pasan a opcionales y `@deprecated`; se quitan de `DEFAULT_USER`.
- Se quitan `betting: undefined` y `pet: undefined` de `DEFAULT_USER` (ya eran opcionales en el tipo).

### src/types/database.ts
- `settings.schemaVersion?: number`.
- Se quita `bettingSystem: undefined` de `DEFAULT_CHAT_SETTINGS`.

### src/types/rpg.ts
- `Item.consumeEffect.forgeBoost?: number` (puntos porcentuales extra de éxito en forja).
- `pocion_forja` pasa de `{ expBoost: 1, duration }` (hack) a `{ forgeBoost: 10, duration: 1h }`.
- Eliminado `elixir_experiencia` (duplicado de `elixir_exp`; la BD lo migra en `migrateUser`).

### src/constants/rpg.ts
- Añadidos `COOLDOWNS { FUMAR: 5 min, BOMB: PVP.BOMB_COOLDOWN, FEED: 4 h, TRAIN: 1 h, PASSIVE_MODE: 6 h }`, `GUILD { CREATE_COST: 10000, MAX_MEMBERS: 50, XP_PER_LEVEL: 5000 }` y `FORGE { MAX_ENHANCE_LEVEL: 10, ENHANCE_BONUS_PER_LEVEL: 5 }` con los valores que hoy usan rpg-fumar.ts:15, rpg-mascotas.ts:22-23, rpg-economia.ts:17 y rpg-gremios.ts:13-14,133.
- Eliminados (grep: sin importadores) `BUFFS`, `PVP.KILL_REWARDS`, `LIMITS.MAX_GROUP_CACHE`, `REGEN.MIN_TIME_HOURS`.

### src/lib/auto-regen.ts
- `regenUser(user, now)` puro (no toca BD ni muta `user`): devuelve `{ healthRegen, staminaRegen, updates }`. Inicializa `lastHealthRegen`/`lastStaminaRegen` a `now` cuando valen 0 aunque el stat esté al máximo. Lo usan `applyRegenToAllUsers` y `applyRegenToUser`.
- El barrido periódico visita a todos los registrados (ver ronda de corrección); `regenUser` decide si hay algo que actualizar.
- Regeneración por puntos: intervalo por punto = `3600000 / regenPerHour`; el timestamp avanza solo lo consumido.
- `getRegenInfo` usa `msUntilNextPoint(last, perHour, now)` = `intervalo - ((now - last) % intervalo)` (exportada y testeada).
- Eliminados `setRegenValues` y `getAutoRegenStatus` (0 usos). `stopAutoRegen` sigue exportado.
- Logger `createLogger('regen')`.

### src/lib/global-modes.ts (nuevo)
- `GlobalModes` y sus subtipos (`BonusMode`, `FreeRobMode`, `EventMode`, `PvpMode`, `ChaosMode`), `GlobalModeKey`, `GLOBAL_MODE_KEYS`, el estado `globalModes` (copiado de owner-rpg.ts:30-104), `checkExpiredModes(now?)`, `AUTO_ACTIVATOR = 'SISTEMA_AUTO'` y `getActiveModes(now?)` → `[{ key, remainingMs, activatedBy }]` para el comando `/eventos`.

### src/lib/auto-events.ts
- Importa de `lib/global-modes.ts` (ya no de `plugins/owner-rpg.ts`).
- `scheduleNextEvent` hace `clearTimeout` del timer previo; guarda `nextEventAt`; `getAutoEventStatus()` devuelve `nextEventInMs: number | null` (ms restantes) y conserva `nextEventIn: string | null` formateado para owner-rpg.
- `toggleAutoEvents` idempotente (activar dos veces no reprograma; solo guarda si cambió).
- `applyEvent` no pisa un modo activo con `activatedBy !== 'SISTEMA_AUTO'`: el generador elige solo entre tipos cuyo modo está libre (`canAutoOverride`) y, si no hay ninguno, el evento se omite. Al expirar restaura el estado previo del modo si seguía vigente (p. ej. otro evento automático solapado) y no toca el modo si un owner lo tomó mientras tanto.
- `forceRandomEvent()` devuelve `GeneratedEvent & { applied: boolean }`; `applied=false` cuando todos los modos están ocupados por un owner (no se anuncia nada).
- Anuncio: "_Usa /eventos para ver los modos activos y su tiempo restante_" en lugar de `.rpgowner`.
- `saveConfig` usa `db.updateSettings({ autoEvents })` en vez de pasar el objeto settings completo.
- Logger `createLogger('events')`.

### tests/datos-*.test.ts (nuevos)
- `datos-database.test.ts`: aislamiento de usuarios y chats, getUser repetido no marca dirty, migrateUser, fusión de `elixir_experiencia`, carga desde disco, resetUser, recuperación desde .bak y renombrado del corrupto, validación de secciones raíz, save con .bak y fallo de escritura, gremios, `removeClassBaseStats`, betting (favoritos y maxHistory). Usa un directorio temporal por test.
- `datos-levelling.test.ts`: progreso acotado, grantExp (bonus, multiplicador, inválidos, no baja nivel), setLevel, loseExp.
- `datos-rpg-utils.test.ts`: stats con clase y forja, multiplicador de forja, wrapper deprecado, daño mínimo/multiplicador/crítico.
- `datos-auto-regen.test.ts`: regenUser puro, topes, `msUntilNextPoint`, avance de timestamps al máximo, barrido con BD temporal y usuario corrupto.

## Para otros agentes

### Agente RPG (plugins rpg-*.ts, owner-rpg.ts)

**1. owner-rpg.ts — reset de usuario** (líneas 1575-1576): sustituir
```ts
const { DEFAULT_USER } = await import('../types/user.js');
db.updateUser(targetJid, { ...DEFAULT_USER });
```
por `db.resetUser(targetJid);`. Desde la ronda de corrección `updateUser` clona los objetos que no son del propio usuario, así que el spread ya no contamina `DEFAULT_USER`, pero `resetUser` es más claro y no pasa por el filtro de campos numéricos.

**2. Modos globales → lib/global-modes.ts**
- owner-rpg.ts: borrar la `interface GlobalModes` (líneas 30-69), `export const globalModes` (71-104) y `export function checkExpiredModes` (111-128). Añadir al bloque de imports:
  `import { globalModes, checkExpiredModes } from '../lib/global-modes.js';`
  y, para que los demás plugins sigan compilando mientras migran, re-exportar:
  `export { globalModes, checkExpiredModes } from '../lib/global-modes.js';`
- Plugins que importan `{ globalModes, checkExpiredModes } from './owner-rpg.js'` y deben pasar a `from '../lib/global-modes.js'`: rpg-atacar.ts:12, rpg-dungeon.ts:12, rpg-duelo.ts:12, rpg-dungeon-interactivo.ts:12, rpg-minar.ts:11, rpg-robar.ts:12, rpg-daily.ts:11, rpg-work.ts:13.
- Al activar modos manualmente (owner-rpg.ts 717, 768, 820, 870, 919) se sigue usando `activatedBy: m.sender`; los eventos automáticos ya respetan cualquier `activatedBy` distinto de `'SISTEMA_AUTO'`.
- **Debe ir en el mismo commit que este cambio de datos**: mientras owner-rpg.ts conserve su propio `globalModes`, hay dos estados distintos en el proceso (`ownerRpg.globalModes !== lib.globalModes`): los eventos automáticos y `forceRandomEvent()` activan modos que ningún plugin lee, `canAutoOverride` no ve los modos del owner y `rpgdesactivar` no puede apagar un evento automático. El re-export de dos líneas en owner-rpg.ts basta para cerrar la ventana sin tocar los demás plugins. Comprobación rápida en la integración: `npx tsx -e "Promise.all([import('./src/lib/global-modes.ts'), import('./src/plugins/owner-rpg.ts')]).then(([a, b]) => console.log(a.globalModes === b.globalModes))"` debe imprimir `true`.

**3. Comando público `/eventos`** (nuevo plugin, p. ej. `src/plugins/rpg-eventos.ts`, registrar en `src/plugins/index.ts` y en menu.ts): el anuncio de eventos automáticos ya lo menciona. Debe listar los modos activos y su tiempo restante usando `getActiveModes()` de `lib/global-modes.ts` (devuelve `[{ key, remainingMs, activatedBy }]`; formatear con `msToTime(remainingMs)`), con detalle por modo leyendo `globalModes[key]` (multiplicadores, `eventName`), e indicar "No hay eventos activos" si está vacío. Opcional: mostrar `getAutoEventStatus().nextEventIn` cuando `enabled`.

**4. owner-rpg.ts — `forceRandomEvent`** (línea 1806): el resultado ahora trae `applied: boolean`. Si es `false` responder que todos los modos están ocupados por un owner en vez de anunciar el evento. Línea 1842: puede usar `status.nextEventIn` (texto) o `status.nextEventInMs` (ms).

**5. Motor de XP (`grantExp`/`setLevel`/`loseExp` de lib/levelling.ts)**. Sustituir las sumas manuales `exp: user.exp + X` por `grantExp(user, X, { multiplier })` (muta `user`; después `db.updateUser(jid, user)` o los campos tocados: `exp, level, maxHealth, maxStamina, maxMana, health, stamina, mana, money`). Call sites:
- rpg-work.ts:190 (master cut), 205, 211 (quitar `canLevelUp` y usar `result.leveledUp`)
- rpg-minar.ts:228, 243, 250
- rpg-atacar.ts:269
- rpg-dungeon.ts:457
- rpg-dungeon-interactivo.ts:643
- rpg-duelo.ts:558
- rpg-daily.ts:149, 163
- rpg-misiones.ts:271
- rpg-robar.ts:348 (`grantExp(thief, amount)`) y 349 (`loseExp(victim, amount)`; antes `Math.max(0, exp - amount)` podía dejar la XP por debajo del mínimo del nivel)
- rpg-fumar.ts:25, 83 (`grantExp`) y 137 (`loseExp`)
- rpg-bombardear.ts:353
- rpg-verificar.ts:106 (bono de registro)
- owner-rpg.ts:357 (`dar xp`: `grantExp(user, amount)`), 442 (`quitar xp`: `loseExp`), 528-529 (`setstat level`: `setLevel(user, value)` y dejar de escribir `role`), 1292-1297 (`setnivel`: sustituir `level * level * 100` por `setLevel(user, level)`), 1431 (regalo masivo xp: `grantExp`).
- rpg-nivel.ts:53-83: con `grantExp` el nivel sube automáticamente al ganar XP; el comando debe quedar como consulta de progreso (y, para usuarios antiguos con `canLevelUp` true, llamar `grantExp(user, 0)` que aplica los niveles pendientes con su bonus). Quitar `user.role = newRole` (línea 83): el rango se deriva con `getRoleByLevel(user.level)`.

**6. Clase aplicada solo en `calculateTotalStats`** (doble conteo actual):
- rpg-clase.ts:209-224: borrar el bloque que resta `prevClassInfo.baseStats` y suma `classInfo.baseStats` a `user.maxHealth/maxMana/maxStamina/attack/defense`. Mantener solo `playerClass`, `money` y el recorte de `health/mana/stamina` al máximo real (`calculateTotalStats(user)` de lib/rpg-utils.ts).
- owner-rpg.ts:1192-1199 (`setclase`): quitar los `100 + classInfo.baseStats.healthBonus` etc.; solo asignar `playerClass`.
- rpg-perfil.ts:20-30 y rpg-inventario.ts:34-42 suman baseStats a mano: usar `calculateTotalStats(user)`.
- `CLASS_STATS_MIGRATION_ENABLED` ya está en `true` (lo puso el agente RPG al cambiar rpg-clase.ts). En el siguiente arranque la BD restará una sola vez los baseStats a los usuarios con clase y fijará `settings.schemaVersion = 2`. El cambio de owner-rpg.ts `setclase` debe entrar en el mismo commit.

**7. `calculateTotalStats`**: migrar los imports de `calculateTotalStats` desde `../types/user.js` a `../lib/rpg-utils.js` y llamar `calculateTotalStats(user)` (sin `ITEMS`/`CLASSES`): auto-regen ya lo hace; quedan owner-rpg.ts:16,344,1333; rpg-atacar.ts:11,173; rpg-dungeon.ts:10,74,372; rpg-duelo.ts:11,141-142,928-929; rpg-dungeon-interactivo.ts:10,33,884; rpg-nivel.ts:9,74; rpg-bombardear.ts:10,215,329; rpg-inventario.ts:11,271. `ReturnType<typeof calculateTotalStats>` puede sustituirse por el tipo `TotalStats`.

**8. `calculateDamage`**: borrar las copias locales en rpg-atacar.ts:47, rpg-dungeon.ts:22 y rpg-dungeon-interactivo.ts:102 e importar `calculateDamage` de `../lib/rpg-utils.js` (misma firma, con `multiplier` opcional para la de dungeon-interactivo:1191). Donde el monstruo ataca con `5` literal usar `PVE.MONSTER_CRIT_CHANCE`.

**9. Forja y buffs**
- rpg-forja.ts:425: cambiar `resultItemId: 'elixir_experiencia'` por `'elixir_exp'` (el item duplicado se eliminó; la BD funde el inventario existente).
- rpg-forja.ts:1002: aplicar el buff de `pocion_forja`: `successRate + (user.activeBuffs.find(b => b.type === 'forgeBoost' && b.expiresAt > Date.now())?.value ?? 0)`, acotado a 100.
- rpg-forja.ts:1075: el bonus `+5 %` que anuncia ya lo aplica `calculateTotalStats` (usar `FORGE.ENHANCE_BONUS_PER_LEVEL` para el texto).
- rpg-inventario.ts:455-549: tratar `effect.forgeBoost` igual que `expBoost` (crea `ActiveBuff { type: 'forgeBoost', value, expiresAt }` y lo muestra); hoy `pocion_forja` no se podría consumir porque solo mira `expBoost`.
- Items sin efecto real (decidir implementarlos o quitarlos de rpg-tienda.ts:71-83): `caja_misteriosa` (`consumeEffect: {}`), `pocion_resurrecion` (solo cura 999; no revive a nadie porque no hay estado de muerte), `espada_celestial`, `armadura_celestial`, `corona_reyes` (tienen stats pero `price: 0` y solo se venden por diamantes: comprobar que la tienda de diamantes los entregue).

**10. Constantes**: sustituir literales por `COOLDOWNS.FUMAR` (rpg-fumar.ts:15), `COOLDOWNS.FEED`/`COOLDOWNS.TRAIN` (rpg-mascotas.ts:22-23), `COOLDOWNS.PASSIVE_MODE` (rpg-economia.ts:17), `COOLDOWNS.BOMB` (rpg-bombardear.ts:15), `GUILD.CREATE_COST`/`GUILD.MAX_MEMBERS`/`GUILD.XP_PER_LEVEL` (rpg-gremios.ts:13-14, 133-134, 152).

**11. rpg-gremios.ts — usar la API de gremios** (hoy muta `db.data.guilds` sin marcar dirty, así que los cambios solo se guardan si otra cosa marca dirty antes del autoguardado):
- Borrar `getGuilds()` (líneas 16-20) y `findGuildByName` pasar a `db.listGuilds().find(g => g.name.toLowerCase() === normalized) ?? null`.
- Crear (75): `db.saveGuild(guild)`.
- Unirse (~85-89): tras `guild.members.push(...)`, `db.saveGuild(guild)` (o `db.markDirty()`).
- Salir (96-110): `db.getGuild(user.guildId)`; al disolver `db.deleteGuild(guild.id)`; tras modificar `members`/`leader`, `db.saveGuild(guild)`.
- Tesoro/depositar/info (117-152): `db.getGuild(...)`; tras mutar `treasury/exp/level`, `db.saveGuild(guild)`.
- Listar (159): `db.listGuilds()`.

**12. Campos muertos**: dejar de escribir `role` (rpg-nivel.ts:83; owner-rpg.ts:529, 1238, 1297) y `classSelectedAt` (rpg-clase.ts:234; owner-rpg.ts:1193). owner-rpg.ts:1355 debe mostrar `getRoleByLevel(user.level)` en vez de `user.role` (los usuarios nuevos ya no tienen `role`). Cuando no quede ningún escritor, se quitan ambos del tipo.

### Agente core (index.ts, handler.ts)

- **index.ts**: importar `stopAutoRegen` junto a `startAutoRegen` (línea 14: `import { startAutoRegen, stopAutoRegen } from './lib/auto-regen.js';`) y `stopAutoEvents` (línea 13: `import { startAutoEvents, stopAutoEvents } from './lib/auto-events.js';`); en `gracefulShutdown` (líneas 183-195) llamar `stopAutoRegen();` y `stopAutoEvents();` antes de `await db.stop();`.
- **handler.ts**: `DatabaseSchema.stats: Record<string, CommandStats>` existe pero nadie escribe en él. Al ejecutar un comando debería hacer `const s = db.data.stats[name] ??= { total: 0, success: 0, failed: 0, lastUsed: 0 }; s.total++; s.success++ | s.failed++; s.lastUsed = Date.now(); db.markDirty();` para que `/stats` (admin-stats.ts) pueda mostrarlo.
- `db.save()` ahora devuelve `boolean`; `db.stop()` sigue siendo `Promise<void>`.

### Agente betting (plugins betting-*.ts, lib/betting-parser.ts)

- Nada obligatorio: los wrappers `db.xxx` siguen funcionando. Migración recomendada: `db.getBettingSystem(...)` → `db.betting.getBettingSystem(...)` y así con el resto; `betting-parser.ts` puede tipar el parámetro como `BettingStore` en vez de `Database`.
- `followTipster` ahora devuelve `false` también cuando el usuario tiene 20 favoritos; el plugin puede distinguirlo comprobando `db.betting.getUserBetting(jid).favoriteTipsters.length >= MAX_FAVORITE_TIPSTERS` antes de llamar para dar el mensaje adecuado.

## Decisiones

### Ronda de corrección
- **`updateUser` clona por identidad, no siempre**: clonar todo valor objeto habría dejado obsoletas las referencias locales de los plugins que hacen `db.updateUser(jid, { inventory: user.inventory })` y siguen usando `user.inventory`. Solo se clona lo que no es ya la referencia almacenada (spreads de `DEFAULT_USER`, objetos de otro usuario, arrays nuevos). Alternativa descartada: `deepFreeze(DEFAULT_USER)`, que convertía la corrupción silenciosa en un `TypeError` en el flujo de reset del owner.
- **El barrido de regeneración ya no filtra por "al máximo"**: el filtro necesitaba el mismo `calculateTotalStats` que el cálculo, así que no ahorraba nada y era lo que impedía inicializar y avanzar timestamps de los usuarios llenos. La especificación pedía ambas cosas (filtrar e inicializar); se prioriza inicializar.
- **Timestamps avanzan al máximo solo en múltiplos del intervalo**: ponerlos a `now` marcaría dirty cada minuto para todos los usuarios llenos; avanzar al último intervalo completo marca dirty como mucho una vez por intervalo (6 min para energía, 30 min para vida) y el autoguardado ya escribe cada 30 s cuando hay cambios.
- **`setLevel` hacia abajo no toca el dinero**: el oro concedido al subir puede estar gastado; restarlo dejaba a cero a usuarios que nunca lo recibieron (subidos con `level*level*100`). Si se quiere confiscar, debe hacerlo el comando del owner explícitamente.
- **`stop()` con tope de 3 intentos**: `while (dirty)` sin tope se colgaría con un disco roto; tres intentos cubren la ventana de la escritura en curso y un fallo transitorio.
- **Solo `SyntaxError` es corrupción**: lowdb ya convierte ENOENT en "sin datos"; cualquier otro error de lectura es de E/S y debe impedir el arranque, no provocar que el siguiente autoguardado pise la BD con el `.bak` o con defaults.
- **No se añade un test que importe owner-rpg.ts**: hoy fallaría (dos `globalModes`) y `npm test` debe pasar; la comprobación queda como paso de integración (ver "Para otros agentes" 2).


- **`needsDefault` también repara arrays/objetos corruptos** (p. ej. `inventory: null`), no solo numéricos: un `null` donde se espera array rompe `inventory.find` en muchos plugins. Lo que el informe pedía (faltantes + numéricos no finitos) está incluido.
- **No se conserva "si `health` es inválido → `health = maxHealth`"** de la migración antigua: la tabla asigna el default (100). Es un caso de corrupción rarísimo y la regla tabular es más fácil de razonar y testear.
- **Fusión de `elixir_experiencia` en `migrateUser`** en lugar de dejar el item en `ITEMS`: así el jugador no pierde el consumible al retirar el duplicado. Alternativa descartada: mantener ambos items (seguiría el doble listado en tienda/inventario).
- **`role` fuera de `DEFAULT_USER`** (opcional en el tipo) en lugar de mantenerlo: mantenerlo haría que el campo se escribiera eternamente en cada usuario. El único lector (owner-rpg.ts:1355) debe pasar a `getRoleByLevel`.
- **`grantExp` no baja de nivel** aunque `findLevel(exp) < level` (owner puede fijar niveles por encima de la XP): bajar niveles automáticamente al ganar XP sería sorprendente. `setLevel` sí ajusta en ambas direcciones.
- **Bonus de forja multiplicativo por stat del item** (`round(stat * (1 + 0.05 * nivel))`) y no sobre los stats totales del jugador: es lo que el texto de rpg-forja.ts ("+X % stats" del item) promete y evita que una espada +1 multiplique la vida base.
- **Migración de clase condicionada por constante** y con `schemaVersion` sin subir mientras está apagada: si se subiera la versión sin aplicar, nunca se ejecutaría.
- **`save()` serializa escrituras** (`saving` promise): evita que el autoguardado y `stop()` escriban a la vez y que un `write` tardío pise uno más nuevo.
- **Respaldo .bak antes de escribir, no después**: así el .bak siempre es la última versión que se sabía correcta en disco, no la que se está escribiendo.
- **`forceRandomEvent` devuelve `applied` en vez de `null`**: owner-rpg.ts usa el resultado sin comprobar null; así compila y funciona hasta que lo adapten.
- **`getAutoEventStatus` mantiene `nextEventIn` como texto y añade `nextEventInMs`**: owner-rpg.ts:1842 lo interpola en un mensaje; devolver solo ms habría mostrado un número crudo al owner.
- **`regenUser` devuelve `updates` en vez de mutar**: permite que `applyRegenToAllUsers` persista vía `updateUser` (que filtra valores inválidos) y hace la función testeable sin BD.
- **Timers de restauración de eventos con `unref()`**: no mantienen vivo el proceso en el apagado; son cortos (≤ 30 min) y solo restauran el estado previo de un modo.
- Las `PVE.MONSTER_CRIT_CHANCE` se conserva aunque `calculateMonsterDamage` desaparezca: los plugins la deberían usar en lugar del literal `5`.

## Pendiente

- **Regresión intermedia de los eventos automáticos**: hasta que owner-rpg.ts re-exporte `globalModes`/`checkExpiredModes` desde `lib/global-modes.ts` (punto 2), auto-events escribe en un objeto que ningún plugin lee: los eventos se anuncian pero no afectan a XP/dinero/daño/robo, la protección "no pisar modos del owner" no opera y `rpgdesactivar` no apaga eventos automáticos. Antes de este cambio auto-events importaba el objeto de owner-rpg y sí funcionaba. Es un cambio de dos líneas en owner-rpg.ts que debe ir en el mismo commit.
- **Migración de stats de clase activa** (`CLASS_STATS_MIGRATION_ENABLED = true`, puesto por el agente RPG): rpg-clase.ts ya no suma baseStats, pero owner-rpg.ts `setclase` (1192-1199) sigue escribiendo `100 + baseStats...`; mientras no se cambie, los usuarios a los que el owner asigne clase tendrán el bonus doble. La migración corre una sola vez en el próximo arranque y sube `schemaVersion` a 2.

- **`/eventos`**, el reemplazo de `.rpgowner` en el anuncio, lo crea el agente RPG (punto 3); mientras tanto el texto apunta a un comando que no existe.
- **owner-rpg.ts:1355** mostrará `undefined` como rango para usuarios creados tras este cambio hasta que use `getRoleByLevel(user.level)` (punto 12).
- **rpg-forja.ts:425** produce `elixir_experiencia`, que ya no está en `ITEMS`: el craft entregará un item sin definición hasta que se cambie a `elixir_exp` (punto 9). La BD lo funde al siguiente `getUser`.
- **`pocion_forja`** no se puede consumir hasta que rpg-inventario.ts maneje `forgeBoost` (punto 9); antes tampoco hacía nada útil (daba `expBoost: 1`).
- `index.ts` no llama a `stopAutoRegen`/`stopAutoEvents` en `gracefulShutdown` (agente core).
- `DatabaseSchema.stats` sigue sin escritores (agente core).
- No se tocó `src/types/index.ts` (no está en mi lista); sigue re-exportando `DEFAULT_USER`, que ahora ya no incluye `role`/`classSelectedAt`.
