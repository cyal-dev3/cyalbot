# Handoff: área rpg-progresion

Estado al cierre: los 18 archivos de esta área compilan y `npm test` pasa los 27 tests nuevos de `tests/rpgprog-*.test.ts`. Ver "Pendiente" para el estado de `npx tsc --noEmit` global (errores en archivos ajenos en edición).

## Hecho

### src/lib/rpg-actions.ts (nuevo)
- `grantRewards(db, jid, { exp?, money?, diamonds?, potions?, questObjectives? }, { source, multiplier?, rank?, now? })`: único punto de entrega de recompensas. En orden: multiplicador del plugin → multiplicadores de rango (`getRankBenefits`, desactivable con `rank: false` para recompensas fijas: registro, misiones, logros, daily que ya usa `dailyBonus`) → `applyGlobalModes` → bonus de gremio (+2 % XP por nivel, `GUILD_XP_BONUS_PER_LEVEL`) → corte de esclavitud (`SLAVERY_CUT = 50`, el amo recibe exactamente lo que se le quita al esclavo, con `grantExp`) → `grantExp` (nivel automático con bonus), `money`, `totalEarned`, `limit`, `potion` → `db.updateUser` → misión `earn` por el dinero entregado y los `questObjectives` del plugin. Devuelve `{ lines, leveledUp, from, to, exp, money, diamonds, potions }`; `lines` trae modos, gremio, esclavitud, subida de nivel y misiones completadas, listo para el mensaje.
- `replyCooldown(ctx, remaining, [{ cmd, desc }])`: una línea en compacto (`ctx.handler.isCompactMode`), bloque con sugerencias y nota de reducción por rango en normal.
- `formatReward(ctx, titulo, lines, { compact?, intro?, footer? })`: una sola línea `titulo: a · b · c` en compacto; bloque `├ ╰` en normal.
- `usageError(ctx, plugin, motivo?)`: imprime `plugin.usage` (o `help`) anteponiendo `usedPrefix` a las líneas que empiezan por un alias del plugin.
- `isPassiveActive(user, now)`: único criterio de modo pasivo (interruptor sin caducidad; ver Decisiones). `isEnslaved(user, now)`, `clamp`, `getPlayerId(db, jid, user?)` (md5 del JID, persistido en `user.playerId`).

### src/lib/quests.ts (nuevo)
- `updateQuestProgress(db, jid, objective, amount, now?)`: matchea por `quest.objective` (ya no por `questId.includes`), ejecuta `ensureQuestsFresh` antes, y **auto-reclama** las misiones que llegan al objetivo vía `grantRewards` (items al inventario, línea `🎁 Misión completada: ...`). Devuelve `{ completed, lines }`.
- `ensureQuestsFresh(user, now)`: reasigna diarias a las 24 h y semanales a los 7 días (o si faltan). `claimCompletedQuests` cobra las completadas-sin-reclamar heredadas. `renderQuestList` único para diarias y semanales. `getQuestById` sobre el índice `ALL_DAILY_QUESTS`/`ALL_WEEKLY_QUESTS`.
- `QuestGoal = QuestObjective | 'mine' | 'daily' | 'fumar' | 'transfer' | 'fish' | 'hunt' | 'explore'` y `EXTRA_DAILY_QUESTS` (minar 3, daily 1, fumar 2, transferir 1000, pescar 3) porque `DAILY_QUESTS`/`QuestObjective` viven en `types/rpg.ts` (agente combate).

### src/plugins/rpg-daily.ts, rpg-work.ts, rpg-minar.ts, rpg-fumar.ts
- Pasan a `checkCooldown` → base → `grantRewards` → `formatReward`. Se eliminaron las comprobaciones manuales de `registered`, los seis bloques copiados de modos globales y el corte de esclavitud a mano. Importan `globalModes` de `lib/global-modes.ts` (ya no de `owner-rpg.ts`).
- daily: racha `user.dailyStreak` (`nextStreak`: continúa si el reclamo anterior fue hace menos de 2 cooldowns), +5 % XP/dinero por día hasta 7 (`streakBonusPercent`) y +1 diamante por día de racha; misión `daily`.
- work: `questObjectives: work`; el bonus de dinero pasa por `grantRewards` (misión `earn` automática).
- minar: `questObjectives: mine`; cooldown con alias real (`replyCooldown` usa `usedPrefix + command`) y `msToTime`.
- fumar: `COOLDOWNS.FUMAR`; los efectos devuelven `{ rewards, updates, expLoss }`: lo positivo pasa por `grantRewards`, Amnesia usa `loseExp` (no baja de nivel), la multa del IMSS fija `debtCreatedAt` con `ensureDebtTimestamps`; misión `fumar`.

### src/plugins/rpg-verificar.ts
- `parseRegistration`: acepta `Nombre 18`, `Nombre.18`, `Nombre,18`, solo nombre (pide la edad con el ejemplo relleno: `/verificar Nombre.18`) y sin argumentos usa `pushName`.
- Inicializa `lastHealthRegen`/`lastStaminaRegen = now`, persiste `playerId` (mismo que muestra el perfil) y entrega el bono con `grantRewards` (`rank: false`).

### src/plugins/rpg-nivel.ts
- Vista de progreso: nivel, barra, XP restante, siguiente rango. Si `canLevelUp` (usuarios anteriores al nivel automático) llama `grantExp(user, 0)` y muestra los niveles y bonus aplicados. Ya no escribe `user.role` ni suma bonus a mano.

### src/plugins/rpg-perfil.ts
- `calculateTotalStats(user)` (se borró `getRealMaxStats`); muestra título, clase, gremio `[TAG] Nombre (Nv.X)`, mascota (nivel y hambre actual), banco, deuda, ataque/defensa/crítico, cooldowns restantes de work/minar/daily/robar/fumar (`formatCooldowns`, con la reducción de rango) y `formatRankBenefits`. `playerId` persistido vía `getPlayerId`. Objetivo con `ctx.target({ args, allowSelf: true })`.

### src/plugins/rpg-robar.ts (BUG ALTA 146)
- `calculateRobAttempt(thief, victim, { successBonus, amountBonus, rand })` pura, con `ROB.*` y `clamp`: la cantidad nunca supera el recurso real de la víctima. `applyRobTransfer(thief, victim, resource, amount)` con contabilidad cerrada: dinero `min(amount, victim.money)`, XP `loseExp(victim)` → `grantExp(thief, lo perdido)`, maná limitado por el hueco del ladrón (`calculateTotalStats`). `hasStealableResources` con `ROB.MIN_VICTIM_RESOURCES`.
- Protecciones: `victim.shieldRobo > now` bloquea, nivel mínimo de la víctima `PVP.MIN_LEVEL_PVP`, `isPassiveActive` en ambos lados; víctima mencionada con `mentions` (`ctx.send`). Un robo bloqueado no consume el cooldown. Misiones `rob` y `earn` desde `lib/quests.ts`.

### src/plugins/rpg-clase.ts
- Se borró la suma/resta de `baseStats` a `maxHealth/maxMana/maxStamina/attack/defense` (líneas 209-224): solo se guarda `playerClass`, `money` y el recorte de `health/mana/stamina` al máximo real de `calculateTotalStats`. Ya no escribe `classSelectedAt`. `CLASS.MIN_LEVEL`/`CLASS.CHANGE_COST` de constants; `resolveClass` acepta nombre normalizado (`normalizeText`), alias en inglés y número de la lista; el coste de cambio aparece en el error de dinero y en `/clases`; misión `spend` al pagar el cambio. Extraídos `formatClassStats`/`formatClassSkills`. Se eliminó el bloque vacío de "logro de clase" (274-278).
- **En el mismo cambio** `CLASS_STATS_MIGRATION_ENABLED = true` en `src/lib/database.ts` (única línea tocada).

### src/plugins/rpg-economia.ts
- `ensureDebtTimestamps(user, now)` exportada: fija `debtCreatedAt`/`debtInterestApplied` si hay deuda y faltan, y los limpia cuando la deuda llega a 0 (una deuda nueva no hereda intereses). `applyDebtInterest(db, jid, user, now?)` la llama primero, cobra `floor(días completos)` periodos de 5 % y avanza `debtInterestApplied` solo lo cobrado (no pierde la fracción de día); confisca un item por encima de `DEBT_SEIZURE_THRESHOLD`.
- `isPassiveActive` re-exportada desde `lib/rpg-actions.ts`; `pasivo` acepta `on|off`, usa `COOLDOWNS.PASSIVE_MODE`, escribe `passiveModeUntil: 0`.
- `getActiveSlaves(db, jid, now)`: cuenta solo esclavos vigentes cuyo `slaveMaster` sigue siendo el usuario; `esclavizar` lo usa para el límite (`MAX_SLAVES = 3`) y limpia la lista.
- Banco con subcomandos `ver|depositar|retirar [cantidad]`, atajo `banco 5000` y `/depositar 5000`, `parseAmount` (`todo`, `1k`, `50%`, `mitad`). `BANK_MAX_AMOUNT` es **tope** (no se puede depositar por encima; se eliminó la comisión del 10 % sobre el exceso) y todos los textos lo dicen. `resolveDepositAmount`/`resolveWithdrawAmount`/`resolveTransferAmount` exportadas y testeadas.
- `transferir`: `parseAmount`, comisión esperada (`TRANSFER_EXPECTED_COMMISSION` ≈ 8 %) en help y errores, forma de uso con `usageError`, mención al receptor, misión `transfer`. `esclavizar`/`liberar`/`adoptar`/`gremio crear`/`clase` disparan `spend`.

### src/plugins/rpg-misiones.ts
- Queda como vista: `/misiones` (acepta `reclamar`) y `/reclamarmision` llaman `claimCompletedQuests`. `updateQuestProgress(db, jid, objective, amount)` se re-exporta como wrapper `@deprecated` con la firma antigua (rpg-dungeon*.ts y rpg-atacar la importan de aquí).

### src/plugins/rpg-ranking.ts
- Usuarios migrados (`db.getRegisteredUsers()` → `db.getUser(jid)`); categorías en una tabla (`RANKINGS`, dinero cuenta banco + efectivo). Quitado el alias `reclamar` de `reclamarlogro` (colisionaba con daily); `stats` se mantiene aquí. Recompensas de logros con `grantRewards` y `formatReward`.

### src/plugins/rpg-mascotas.ts
- `UserPet.lastTrain?` en `types/user.ts`. Hambre que decae `HUNGER_DECAY_PER_HOUR = 4` por hora desde `lastFed` (`getPetHunger(pet, now)`); `getPetBuff(pet, now)` no aporta buff por debajo de 30. `COOLDOWNS.FEED`/`COOLDOWNS.TRAIN` con `checkCooldown` + `replyCooldown`. Entrenar exige hambre ≥ 20 y resta al valor guardado (el decaimiento sigue desde `lastFed`, el cooldown de alimentar no se reinicia). `help`/`usage` en los cuatro plugins. Exporta `getPetBuff`, `addPetExp`, `getPetHunger`, `petExpForLevel`.

### src/plugins/rpg-gremios.ts
- API `db.getGuild/saveGuild/deleteGuild/listGuilds` (antes mutaba `db.data.guilds` sin marcar dirty). `getUserGuild(db, jid, user)` limpia `guildId` huérfano (gremio disuelto o expulsado). Subcomandos nuevos: `retirar` (líder), `expulsar @usuario|nombre`, `lider @usuario|nombre`, `descripcion <texto>` (líder), `listar [página]` (10 por página). `GUILD.CREATE_COST/MAX_MEMBERS/XP_PER_LEVEL`, `addGuildExp`, tag derivado con `normalizeText`, `parseAmount` en depositar/retirar, líder mencionado con `mentions`. El bonus +2 % XP por nivel lo aplica `grantRewards`.

### Plugins nuevos
- `rpg-eventos.ts`: `/eventos` público (sin `register`): modos activos con `getActiveModes` + `msToTime`, detalle por modo (`MODE_DETAILS`), marca los automáticos (`AUTO_ACTIVATOR`), "No hay eventos activos" y próximo evento si `getAutoEventStatus().enabled`.
- `rpg-pescar.ts`: cooldown propio `FISH_COOLDOWN = 15 min` (`user.lastFish`), 12 peces por rareza (2/10/23/65 %), dinero + XP vía `grantRewards`, material `pescado` solo si `FORGE_MATERIALS['pescado']` existe (hoy no: solo dinero). Misión `fish`.
- `rpg-cazar.ts`: `CONFIG.cooldowns.hunt` (`user.lastHunt`), cuesta `HUNT_STAMINA_COST = 20` de energía, presas con peso, drops de materiales existentes (`cuero`, `fragmento_alma`, `escama_dragon`, `esencia_fuego`) y riesgo de herida (% de la vida máxima) que nunca baja de 1 de vida. Misión `hunt`.
- `rpg-explorar.ts`: `CONFIG.cooldowns.adventure` (`user.lastExplore`), evento aleatorio con pesos: cofre (dinero + XP), trampa (vida sin matar y algo de dinero), mercader (vende un consumible de `ITEMS` con `MERCHANT_DISCOUNT = 50 %` si alcanza el dinero), viajero (XP). Misión `explore`.

### src/types/user.ts (solo campos opcionales)
- `playerId?`, `dailyStreak?`, `lastFish?`, `lastHunt?`, `lastExplore?` en `UserRPG`; `lastTrain?` en `UserPet`.

### tests/rpgprog-*.test.ts (nuevos, 27 tests)
- `rpgprog-actions`: base sin modos, modo bonus una sola vez, corte de esclavitud exacto y una sola vez, nivel automático, bonus de gremio, misiones `earn`/`questObjectives`, `isPassiveActive`/`clamp`.
- `rpgprog-quests`: asignación, reset 24 h sin tocar semanales, progreso por `objective`, auto-reclamo (recompensa, `claimedAt`, no se repite), `claimCompletedQuests`, `renderQuestList` y objetivos nuevos.
- `rpgprog-economia`: `parseAmount` en depósito/retiro/transferencia, tope del banco, `ensureDebtTimestamps`, interés por periodos con avance del timestamp, sin interés retroactivo, confiscación, `getActiveSlaves`.
- `rpgprog-robar`: cantidad acotada, `applyRobTransfer` cerrado (dinero/XP/maná), probabilidad acotada, y el handler real con un `ctx` falso: escudo y pasivo bloquean sin mover recursos ni consumir cooldown; un robo real conserva la suma de dinero.

## Para otros agentes

### Agente RPG combate (rpg-atacar, rpg-duelo, rpg-dungeon*, rpg-bombardear, rpg-inventario, rpg-tienda, owner-rpg, types/rpg.ts, constants/rpg.ts)

1. **rpg-inventario.ts — `/usar escudo robo`**: no existe (rpg-tienda.ts:639 lo anuncia y rpg-robar.ts ya lo respeta). Al consumir `escudo_robo`: `db.updateUser(jid, { shieldRobo: Date.now() + PVP.SHIELD_DURATION })` y quitar el item; análogo para `escudo_antibombas` → `shieldBombas` y `seguro_vida` → `seguroVida` (48 h).
2. **owner-rpg.ts `setclase` (≈1192-1199)**: quitar los `100 + classInfo.baseStats.healthBonus` etc.; asignar solo `playerClass` y recortar `health/mana/stamina` a `calculateTotalStats(user)`. rpg-clase.ts ya no cocina stats y `CLASS_STATS_MIGRATION_ENABLED` está en `true`: si `setclase` sigue sumando, esos usuarios tendrán doble bonus.
3. **Modo pasivo**: sustituir `x.passiveMode && x.passiveModeUntil > now` (rpg-bombardear.ts:252 y 262, y cualquier otro) por `isPassiveActive(x, now)` de `../lib/rpg-actions.js`. `passiveModeUntil` ya no se escribe (se deja en 0); mientras bombardear no migre, un pasivo activado tras este cambio no se respeta en bombas.
4. **Deuda IMSS**: en `applyDeathPenalty` (rpg-bombardear.ts), tras `debt: newTotalDebt`, llamar `ensureDebtTimestamps(user, now)` de `./rpg-economia.js` (o fijar `debtCreatedAt`/`debtInterestApplied = now` si valían 0). Lo mismo en `pagardeuda` cuando la deuda llega a 0 (la función ya limpia los timestamps).
5. **Mascotas en combate**: aplicar `getPetBuff(user.pet, now)` de `./rpg-mascotas.js` (`{ attackMul, defenseMul }`) sobre ataque/defensa en atacar/duelo/dungeon, y `addPetExp(user.pet, xp)` al ganar (persistir `pet`). El buff es 0 si el hambre actual (`getPetHunger`) está por debajo de 30.
6. **Misiones**: importar `updateQuestProgress` de `../lib/quests.js` (rpg-dungeon.ts:11, rpg-dungeon-interactivo.ts:11); el wrapper de rpg-misiones.ts se borrará después. rpg-atacar.ts:362 tiene una copia local que matchea por `questId.includes` y no auto-reclama: borrarla e importar la de `lib/quests.ts` (`'combat'`). Devuelve `{ lines }` para añadir al mensaje. Para hacer avanzar `earn` desde dungeon basta con pasar el dinero por `grantRewards` (lo dispara solo).
7. **`grantRewards`** (`../lib/rpg-actions.js`): sustituir en atacar/dungeon/duelo/bombardear las sumas manuales de XP/dinero y las copias de modos globales y corte de esclavitud por `grantRewards(db, jid, { exp, money, questObjectives: [{ objective: 'combat', amount: 1 }] }, { source: 'attack' })` y `formatReward(ctx, titulo, lines)`. Si la recompensa ya trae multiplicadores de rango propios (p. ej. `dungeonRewardBonus`), pasar `rank: false`.
8. **types/rpg.ts — `QuestObjective`**: ampliar con `'mine' | 'daily' | 'fumar' | 'transfer' | 'fish' | 'hunt' | 'explore'` y mover `EXTRA_DAILY_QUESTS` (lib/quests.ts) a `DAILY_QUESTS`; entonces `QuestGoal` puede volver a ser `QuestObjective` y `QuestDef` desaparecer.
9. **constants/rpg.ts**: añadir `GUILD.XP_BONUS_PER_LEVEL: 2` y migrar `GUILD_XP_BONUS_PER_LEVEL` de lib/rpg-actions.ts a esa constante; opcionalmente `COOLDOWNS.FISH: 15 min` (hoy `FISH_COOLDOWN` local en rpg-pescar.ts) y `ROB.MIN_THIEF_MONEY: 50`.
10. **rpg-forja.ts**: si se quiere que la pesca deje material, añadir `pescado: { id: 'pescado', name: 'Pescado', emoji: '🐟', rarity: 'comun', description: 'Pescado fresco del lago', sellPrice: 8 }` a `FORGE_MATERIALS` (rpg-pescar.ts lo detecta solo) y alguna receta que lo use.
11. **rpg-tienda.ts / `spend`**: `comprar` debería llamar `updateQuestProgress(db, jid, 'spend', precioTotal)` (`../lib/quests.js`). Hoy `spend` lo disparan clase, esclavizar, liberar, adoptar y gremio crear; no hay misión `spend` en `DAILY_QUESTS`/`WEEKLY_QUESTS`, así que si se decide no añadirla se pueden quitar esas llamadas.
12. `owner-rpg.ts`: `resetUser`, `setLevel`, `grantExp/loseExp` y `getRoleByLevel` según handoff-datos.md (puntos 1, 5, 12) siguen pendientes de ese archivo.

### Agente core (src/plugins/index.ts, src/plugins/menu.ts, src/handler.ts)

**src/plugins/index.ts** — imports (junto a los demás `rpg-*`):
```ts
import { eventosPlugin } from './rpg-eventos.js';
import { pescarPlugin } from './rpg-pescar.js';
import { cazarPlugin } from './rpg-cazar.js';
import { explorarPlugin } from './rpg-explorar.js';
```
y en `ENTRIES.rpg`, después de `['rpg-minar', minePlugin],`:
```ts
    ['rpg-pescar', pescarPlugin],
    ['rpg-cazar', cazarPlugin],
    ['rpg-explorar', explorarPlugin],
    ['rpg-eventos', eventosPlugin],
```
Aliases que registran: `pescar|fish|pesca`, `cazar|hunt|caceria|cacería`, `explorar|explore|expedicion|expedición`, `eventos|events|modos|evento`. **Colisión**: `rpg-atacar.ts` usa el alias `hunt` (menu.ts lo lista como alias de `atacar`); como `rpg-atacar` se registra antes, `hunt` seguirá yendo a atacar. Si se prefiere que `hunt` sea cazar, quitarlo de `rpg-atacar.ts` (agente combate) o de `rpg-cazar.ts`.

**src/plugins/menu.ts**:
- Categoría `rpg` (`id: 'rpg'`): `commands: ['verificar', 'perfil', 'nivel', 'daily', 'work', 'minar', 'pescar', 'cazar', 'explorar', 'eventos']`.
- En `COMMAND_INFO` (bloque `// RPG Básico`):
```ts
  pescar: { cmd: 'pescar', aliases: ['fish'], desc: 'Pescar para ganar dinero y XP', usage: '/pescar' },
  cazar: { cmd: 'cazar', aliases: ['caceria'], desc: 'Cazar presas: dinero, XP y materiales (gasta energía)', usage: '/cazar' },
  explorar: { cmd: 'explorar', aliases: ['explore', 'expedicion'], desc: 'Explorar el mapa: cofres, trampas, mercaderes', usage: '/explorar' },
  eventos: { cmd: 'eventos', aliases: ['events', 'modos'], desc: 'Ver eventos y modos globales activos', usage: '/eventos' },
```
- Actualizar `nivel`: `desc: 'Ver tu progreso de nivel (sube solo al ganar XP)'`; `daily`: quitar el alias `reclamar` de la descripción si aparece (sigue siendo alias de daily, ya no de reclamarlogro); `banco`: `usage: '/banco [depositar|retirar] [cantidad]'`; `pasivo`: ya acepta `on|off`; `gremio`: añadir `expulsar`, `lider`, `retirar`, `descripcion`, `listar [página]` donde se documente.

**src/handler.ts**: nada obligatorio. `ctx.target` ya se usa en perfil/robar/transferir/esclavizar/gremio.

### Agente grupos (admin-stats.ts)
- `stats` queda en rpg-ranking.ts (se registra antes). Quitar el alias `stats` de `adminStatsPlugin` para que no quede sombreado (dejar p. ej. `botstats`/`adminstats`).

### Agente datos (src/types/user.ts, database.ts)
- Cuando owner-rpg y bombardear dejen de leer `passiveModeUntil`, marcarlo `@deprecated`/opcional en `UserRPG` y quitarlo de `DEFAULT_USER` (ya nadie lo escribe con un valor distinto de 0).
- `UserRPG.role`/`classSelectedAt`: esta área ya no los escribe.

## Decisiones

- **Modo pasivo sin caducidad** (`isPassiveActive = passiveMode === true`): la alternativa (usar `passiveModeUntil` de forma coherente) obligaba a elegir una duración arbitraria y a avisar al jugador cuando caducara; el cooldown de 6 h entre cambios ya evita el abuso. `passiveModeUntil` se sigue escribiendo (a 0) solo por compatibilidad con bombardear hasta que migre.
- **`BANK_MAX_AMOUNT` como tope duro** en vez de umbral con comisión: el texto del help decía "máximo a depositar" y la comisión del 10 % sobre el exceso contradecía al "protegido de robos" (el jugador perdía dinero al depositar). Descartado mantener la comisión.
- **`grantRewards` aplica el rango por defecto y permite `rank: false`**: daily usa `dailyBonus` (no `expMultiplier`) como antes, y misiones/logros/registro son recompensas fijas; aplicar `expMultiplier` encima habría cambiado la economía de esas tres fuentes sin que el informe lo pidiera.
- **Auto-reclamo de misiones** (en `updateQuestProgress`): `/misiones reclamar` y `/reclamarmision` quedan solo para progreso heredado. El dinero de una misión cuenta para `earn` (puede completar otra misión en cadena; termina porque cada misión se cobra una vez).
- **`EXTRA_DAILY_QUESTS` en lib/quests.ts** y no en `types/rpg.ts`: ese archivo es del agente de combate; el índice unificado (`getQuestById`) hace la fusión transparente.
- **`calculateDamage` no se usa en robar**: el informe lo sugería junto a `clamp`, pero el robo no tiene ataque/defensa; meter una tirada de daño en la probabilidad de robo habría cambiado el balance sin criterio. Se usan `ROB.*` + `clamp`.
- **Ladrón gana exactamente lo que pierde la víctima también en maná**: la cantidad se limita al hueco del ladrón (`maxMana` real) en vez de perderse.
- **Hambre de mascota como función del tiempo** (`getPetHunger`) en vez de un cron que decremente: no necesita timer ni barrido; `hunger` guardado = valor en `lastFed` menos entrenamientos.
- **Racha diaria con margen de 2 cooldowns**: con un cooldown de 24 h, exigir "ayer" exacto (comparación de `toDateString`) rompía la racha por diferencias de hora; ahora continúa si el reclamo anterior fue hace menos de 48 h.
- **`FISH_COOLDOWN` local (15 min)** en lugar de reutilizar `CONFIG.cooldowns.hunt` (45 min): la pesca da menos que la caza y no gasta energía; la constante se puede mover a `COOLDOWNS` (agente combate) sin tocar el plugin.
- **Mercader de explorar entrega el item directamente** (compra inmediata con 50 % de descuento) en vez de crear un estado "descuento pendiente" en tienda: evita tocar rpg-tienda.ts y un campo nuevo de usuario.
- **Herida de caza/trampa nunca mata** (`health ≥ 1`): el IMSS/`applyDeathPenalty` es del agente de combate y meter muertes en recolección duplicaría esa lógica.
- **`ranking dinero` suma banco + efectivo**: antes el banco permitía esconder dinero del ranking.
- **Wrapper `@deprecated` de `updateQuestProgress` en rpg-misiones.ts** con la firma antigua (devuelve `void`) para que rpg-dungeon*.ts compilen sin cambios.

## Pendiente

- **`npx tsc --noEmit` global** falla por archivos ajenos en edición simultánea (ninguno de esta área; con el árbol anterior a esos cambios compilaba todo): `src/plugins/index.ts:32-35,112` (importa `dungeonsPlugin`, `dungeonsInteractivoPlugin`, `atacarDungeonPlugin`... y `misTipstersPlugin`, que rpg-dungeon*.ts y betting-tipster.ts ya no exportan) y `src/plugins/rpg-duelo.ts:13` (`applyDeathPenalty`/`generateIMSSMessage` ya no se exportan desde rpg-bombardear.ts). Se repitió la comprobación pasados 30 s y persisten.
- **`npm test`**: 224/224 en la última ejecución (incluidos los 27 `tests/rpgprog-*.test.ts`).
- `/eventos`, `/pescar`, `/cazar`, `/explorar` no están registrados hasta que el agente core aplique las entradas de index.ts y menu.ts.
- El alias `hunt` seguirá yendo a `atacar` mientras rpg-atacar.ts lo conserve.
- `escudo_robo` se respeta en robar pero no se puede activar hasta que rpg-inventario implemente `/usar escudo robo`.
- La pesca no deja material hasta que exista `FORGE_MATERIALS.pescado`.
- `passiveModeUntil` sigue en el tipo y en `DEFAULT_USER` (escrito a 0) hasta que bombardear/owner-rpg usen `isPassiveActive`.
- `GUILD_XP_BONUS_PER_LEVEL` vive en lib/rpg-actions.ts hasta que se añada a `GUILD` en constants/rpg.ts.
