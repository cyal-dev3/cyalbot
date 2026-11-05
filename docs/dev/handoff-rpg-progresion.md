# Handoff: área rpg-progresion

Estado al cierre de la ronda de corrección: `npx tsc --noEmit` pasa en todo el árbol y `npm test` pasa (336 tests, 37 de ellos en `tests/rpgprog-*.test.ts`). Los 19 archivos del área compilan sin locals sin uso (`--noUnusedLocals` limpio en ellos).

## Hecho

### Ronda de corrección (hallazgos de los revisores)

| Hallazgo | Veredicto | Cambio |
|---|---|---|
| Farmeo infinito de XP de gremio con `depositar`/`retirar` (alta) | Correcto | `rpg-gremios.ts`: `retirar` resta la XP equivalente (`removeGuildExp`, baja de nivel si hace falta, nunca por debajo de Nv.1 / 0 XP). `guildExpForMoney` y `GUILD_MONEY_PER_EXP = 100` centralizan la equivalencia. Test `rpgprog-gremios`: 5 ciclos depositar todo/retirar todo dejan `exp = 0`, `level = 1`. |
| Robos "exitosos" de +0 XP/maná (media, baja, baja: tres informes) | Correcto | `rpg-robar.ts`: `getStealableResources(victim, thief)` calcula lo que de verdad puede cambiar de manos (XP sobre `xpRange(level).min`, maná `min(víctima, hueco del ladrón)`); `hasStealableResources` y `calculateRobAttempt` usan eso. Si el recurso sorteado no llega al mínimo se cae al primero que sí, y si no hay ninguno se devuelve "bolsillos vacíos" sin consumir cooldown. `lastRob` se fija solo cuando el robo se resuelve (éxito o fallo), con guarda `taken <= 0`. Tests nuevos: XP en el piso, maná con ladrón lleno, handler sin recursos. |
| Modo pasivo incoherente / regresión con bombardear-duelo-items (alta, alta, media) | Correcto | `isPassiveActive(user, now) = passiveMode && passiveModeUntil > now`, el mismo criterio que leen `rpg-bombardear.ts:80/88`, `rpg-duelo.ts:485`, `rpg-items-especiales.ts:144` y `owner-rpg.ts:789`. `/pasivo` escribe `passiveModeUntil = PASSIVE_MODE_NO_EXPIRY` (`Number.MAX_SAFE_INTEGER`) al activar y `0` al desactivar: no caduca en silencio y los lectores antiguos lo respetan. Los pasivos legados con fecha de 30 días la conservan (y `/economia` la muestra); los legados ya caducados dejan de estar protegidos, igual que antes del cambio (no vuelven a protegerse "gratis"). Tests en `rpgprog-actions` y `rpgprog-economia` (handler real de `/pasivo`). |
| `/cazar` y `/hunt` colisionan con rpg-atacar (media, media, media) | Correcto | `rpg-cazar.ts`: el comando pasa a `caceria|cacería|cazarpresa` (sin `cazar`/`hunt`) para no robarle alias a atacar ni quedar inaccesible según el orden de registro. `rpg-pescar.ts` y `rpg-explorar.ts` sugieren `caceria`. Las instrucciones de index.ts/menu.ts de abajo están corregidas. Cuando combate suelte `cazar`/`hunt` de rpg-atacar, se añaden aquí. |
| `claimCompletedQuests` renueva antes de cobrar (baja) | Correcto | `lib/quests.ts`: `claimPendingQuests` cobra lo completado-sin-reclamar ANTES de `ensureQuestsFresh`, tanto en `claimCompletedQuests` como en `updateQuestProgress`. `/misiones` llama `claimCompletedQuests` (en vez de `ensureQuestsFresh` a secas) y muestra las líneas cobradas. Tests: progreso heredado con `lastDailyReset = now - 25h` se cobra y luego se renueva. |
| Fumar muestra la cantidad base, no la entregada (baja) | Correcto | `rpg-fumar.ts`: los efectos con recompensa ya no traen `message`; la línea se construye con `describeDelivered(result)` a partir de `grantRewards` (rango, modos, gremio, esclavitud). `message` queda solo para efectos sin recompensa. |
| Mensajes de banco/transferir/liberar con saldos dobles (alta) | Correcto | `rpg-economia.ts`: `newMoney/newBank/senderBalance/moneyLeft` se calculan antes de `db.updateUser` y se usan en la BD y en el texto. `liberar` además muestra las líneas de misión `spend`. Tests con handler real: depósito 300 sobre 1200 muestra `$300`/`$900`; transferir 1k muestra el saldo real. |
| `usageError` pone en negrita un motivo multilínea (baja) | Correcto | `lib/rpg-actions.ts`: solo la primera línea del motivo va entre `*`. |
| Mensajes muy largos: perfil 60-69, clases 65, logros 43, misiones 36, stats 28, registro 26 (media) | Correcto | Perfil 18 líneas (una por grupo de stats, cooldowns y rango en una línea; el detalle de rango va a `/nivel`, que ahora incluye `formatRankBenefits`). `/clases` 17 líneas (resumen) + `/clases <n>` detalle. `/logros` 10 líneas (conteo por categoría + desbloqueables) + `/logros <categoría>` detalle. `/misiones` 17 (dos líneas por misión). `/stats` 11. Registro 11. Medido con un `ctx` falso. |
| `daily_fish_3` en el sorteo sin `/pescar` registrado (baja) | Correcto como riesgo, no corregible aquí | El plugin existe; lo que falta es la entrada en `src/plugins/index.ts` (agente core, ver abajo). Debe aplicarse en el mismo commit que `lib/quests.ts`; no se ha filtrado el pool porque `lib/quests.ts` no conoce el registro de plugins y el filtro quedaría muerto en cuanto se registre. |
| `owner-rpg.ts setclase` sigue cocinando stats con `CLASS_STATS_MIGRATION_ENABLED = true` (media) | Correcto, fuera del área | Ya estaba en este handoff (punto 2 de combate); se mantiene como obligatorio en el mismo commit de integración. |
| `calculateRobAttempt` no usa `calculateDamage` (baja) | Decisión mantenida | No se cambia: el robo no tiene tirada de daño, y meter ataque/defensa en la probabilidad alteraría el balance sin criterio del informe. Queda explícito en "Decisiones". |

### src/lib/rpg-actions.ts (nuevo)
- `grantRewards(db, jid, { exp?, money?, diamonds?, potions?, questObjectives? }, { source, multiplier?, rank?, now? })`: único punto de entrega de recompensas. En orden: multiplicador del plugin → multiplicadores de rango (`getRankBenefits`, desactivable con `rank: false` para recompensas fijas: registro, misiones, logros, daily que ya usa `dailyBonus`) → `applyGlobalModes` → bonus de gremio (+2 % XP por nivel, `GUILD_XP_BONUS_PER_LEVEL`) → corte de esclavitud (`SLAVERY_CUT = 50`, el amo recibe exactamente lo que se le quita al esclavo, con `grantExp`) → `grantExp` (nivel automático con bonus), `money`, `totalEarned`, `limit`, `potion` → `db.updateUser` → misión `earn` por el dinero entregado y los `questObjectives` del plugin. Devuelve `{ lines, leveledUp, from, to, exp, money, diamonds, potions }`.
- `replyCooldown(ctx, remaining, [{ cmd, desc }])`: una línea en compacto (`ctx.handler.isCompactMode`), bloque con sugerencias y nota de reducción por rango en normal.
- `formatReward(ctx, titulo, lines, { compact?, intro?, footer? })`: una sola línea `titulo: a · b · c` en compacto; bloque `├ ╰` en normal.
- `usageError(ctx, plugin, motivo?)`: imprime `plugin.usage` (o `help`) anteponiendo `usedPrefix` a las líneas que empiezan por un alias del plugin; solo la primera línea del motivo en negrita.
- `isPassiveActive(user, now)` y `PASSIVE_MODE_NO_EXPIRY` (ver tabla). `isEnslaved(user, now)`, `clamp`, `getPlayerId(db, jid, user?)` (md5 del JID, persistido en `user.playerId`).

### src/lib/quests.ts (nuevo)
- `updateQuestProgress(db, jid, objective, amount, now?)`: cobra primero lo heredado (`claimPendingQuests`), luego `ensureQuestsFresh`, luego suma progreso matcheando por `quest.objective` y **auto-reclama** vía `grantRewards` (items al inventario, línea `🎁 Misión completada: ...`). Devuelve `{ completed, lines }`.
- `ensureQuestsFresh(user, now)`: reasigna diarias a las 24 h y semanales a los 7 días (o si faltan). `claimCompletedQuests` cobra antes de renovar. `renderQuestList` único (dos líneas por misión). `getQuestById` sobre el índice `ALL_DAILY_QUESTS`/`ALL_WEEKLY_QUESTS`.
- `QuestGoal = QuestObjective | 'mine' | 'daily' | 'fumar' | 'transfer' | 'fish' | 'hunt' | 'explore'` y `EXTRA_DAILY_QUESTS` (minar 3, daily 1, fumar 2, transferir 1000, pescar 3) porque `DAILY_QUESTS`/`QuestObjective` viven en `types/rpg.ts` (agente combate).

### src/plugins/rpg-daily.ts, rpg-work.ts, rpg-minar.ts, rpg-fumar.ts
- `checkCooldown` → base → `grantRewards` → `formatReward`. Sin comprobaciones manuales de `registered`, sin copias de modos globales ni corte de esclavitud a mano. Importan `globalModes` de `lib/global-modes.ts`.
- daily: racha `user.dailyStreak` (`nextStreak`: continúa si el reclamo anterior fue hace menos de 2 cooldowns), +5 % XP/dinero por día hasta 7 (`streakBonusPercent`) y +1 diamante por día de racha; misión `daily`.
- work: `questObjectives: work`; el bonus de dinero pasa por `grantRewards` (misión `earn` automática).
- minar: `questObjectives: mine`; cooldown con alias real y `msToTime`.
- fumar: `COOLDOWNS.FUMAR`; los efectos devuelven `{ rewards, updates, expLoss, message? }`: lo positivo pasa por `grantRewards` y la línea muestra lo entregado (`describeDelivered`), Amnesia usa `loseExp`, la multa del IMSS fija `debtCreatedAt` con `ensureDebtTimestamps`; misión `fumar`.

### src/plugins/rpg-verificar.ts
- `parseRegistration`: acepta `Nombre 18`, `Nombre.18`, `Nombre,18`, solo nombre (pide la edad con el ejemplo relleno) y sin argumentos usa `pushName`.
- Inicializa `lastHealthRegen`/`lastStaminaRegen = now`, persiste `playerId` y entrega el bono con `grantRewards` (`rank: false`). Mensaje de 11 líneas.

### src/plugins/rpg-nivel.ts
- Vista de progreso: nivel, barra, XP restante, siguiente rango y `formatRankBenefits` completo (el perfil remite aquí). Si `canLevelUp` llama `grantExp(user, 0)` y muestra los niveles y bonus aplicados. No escribe `user.role`.

### src/plugins/rpg-perfil.ts
- 18 líneas: título, clase, gremio `[TAG] Nombre (Nv.X)` y mascota en una línea; nivel/rango/XP total; stats en dos líneas; economía en una (+ deuda); `formatCooldowns(user)` en una línea (`work 3m · minar listo · ...`); `formatRankSummary(level)` en una línea. `playerId` vía `getPlayerId`. Objetivo con `ctx.target({ args, allowSelf: true })`.

### src/plugins/rpg-robar.ts (BUG ALTA 146)
- `getStealableResources`, `hasStealableResources(victim, thief?)`, `calculateRobAttempt(thief, victim, { successBonus, amountBonus, rand })` pura con `ROB.*` y `clamp`: la cantidad nunca supera lo que la víctima puede perder de verdad y un éxito nunca transfiere 0. `applyRobTransfer(thief, victim, resource, amount)` con contabilidad cerrada.
- Protecciones: `victim.shieldRobo > now`, nivel mínimo `PVP.MIN_LEVEL_PVP`, `isPassiveActive` en ambos lados; víctima mencionada con `mentions`. Un robo bloqueado o sin recursos no consume el cooldown. Misiones `rob` y `earn`.

### src/plugins/rpg-clase.ts
- Sin suma/resta de `baseStats`: solo `playerClass`, `money` y recorte de `health/mana/stamina` al máximo de `calculateTotalStats`. Sin `classSelectedAt`. `CLASS.MIN_LEVEL`/`CLASS.CHANGE_COST`; `resolveClass` acepta nombre normalizado, alias en inglés y número; coste de cambio en errores; misión `spend`. `formatClassStats`/`formatClassSkills` extraídos. `/clases` resumen (17 líneas) y `/clases <nombre|n>` detalle.
- **En el mismo cambio** `CLASS_STATS_MIGRATION_ENABLED = true` en `src/lib/database.ts` (única línea tocada).

### src/plugins/rpg-economia.ts
- `ensureDebtTimestamps(user, now)` exportada; `applyDebtInterest(db, jid, user, now?)` cobra `floor(días completos)` periodos de 5 % y avanza `debtInterestApplied` solo lo cobrado; confisca un item por encima de `DEBT_SEIZURE_THRESHOLD`.
- `isPassiveActive` re-exportada desde `lib/rpg-actions.ts`; `pasivo` acepta `on|off`, `COOLDOWNS.PASSIVE_MODE`, escribe `PASSIVE_MODE_NO_EXPIRY`/`0`. `/economia` muestra la caducidad solo para pasivos legados con fecha.
- `getActiveSlaves(db, jid, now)` para el límite (`MAX_SLAVES = 3`).
- Banco `ver|depositar|retirar [cantidad]`, atajo `banco 5000` y `/depositar 5000`, `parseAmount`. `BANK_MAX_AMOUNT` es **tope**. Saldos del mensaje calculados antes de persistir.
- `transferir`: `parseAmount`, comisión esperada (`TRANSFER_EXPECTED_COMMISSION`), `usageError`, mención, misión `transfer`, saldo real en el mensaje. `esclavizar`/`liberar`/`adoptar`/`gremio crear`/`clase` disparan `spend`.

### src/plugins/rpg-misiones.ts
- `/misiones` llama `claimCompletedQuests` (cobra heredado, renueva) y renderiza; acepta `reclamar`. `/reclamarmision` igual. `updateQuestProgress` re-exportada como wrapper `@deprecated` con la firma antigua (rpg-dungeon*.ts y rpg-atacar la importan de aquí).

### src/plugins/rpg-ranking.ts
- Usuarios migrados (`db.getRegisteredUsers()` → `db.getUser(jid)`); `RANKINGS` en tabla (dinero = banco + efectivo). Sin alias `reclamar` en `reclamarlogro`; `stats` se mantiene aquí (11 líneas). `/logros` resumen por categoría + `/logros <categoría>`. Recompensas de logros con `grantRewards` y `formatReward`.

### src/plugins/rpg-mascotas.ts
- `UserPet.lastTrain?`. Hambre decae `HUNGER_DECAY_PER_HOUR = 4` desde `lastFed` (`getPetHunger`); `getPetBuff` nulo por debajo de 30. `COOLDOWNS.FEED`/`COOLDOWNS.TRAIN`. `help`/`usage`. Exporta `getPetBuff`, `addPetExp`, `getPetHunger`, `petExpForLevel`.

### src/plugins/rpg-gremios.ts
- API `db.getGuild/saveGuild/deleteGuild/listGuilds`. `getUserGuild` limpia `guildId` huérfano. Subcomandos `retirar` (líder, devuelve la XP del dinero), `expulsar`, `lider`, `descripcion`, `listar [página]`. `addGuildExp`/`removeGuildExp`/`guildExpForMoney`/`GUILD_MONEY_PER_EXP`. El bonus +2 % XP por nivel lo aplica `grantRewards`.

### Plugins nuevos
- `rpg-eventos.ts`: `/eventos` público: modos activos con `getActiveModes` + `msToTime`, detalle por modo, automáticos marcados, "No hay eventos activos" y próximo evento si `getAutoEventStatus().enabled`.
- `rpg-pescar.ts`: `FISH_COOLDOWN = 15 min` (`user.lastFish`), 12 peces por rareza, dinero + XP vía `grantRewards`, material `pescado` solo si existe en `FORGE_MATERIALS`. Misión `fish`.
- `rpg-cazar.ts`: comando **`caceria|cacería|cazarpresa`** (ver tabla), `CONFIG.cooldowns.hunt` (`user.lastHunt`), `HUNT_STAMINA_COST = 20`, presas con peso, drops de materiales existentes, herida que nunca mata. Misión `hunt`.
- `rpg-explorar.ts`: `CONFIG.cooldowns.adventure` (`user.lastExplore`), cofre/trampa/mercader (50 % de descuento)/viajero. Misión `explore`.

### src/types/user.ts (solo campos opcionales)
- `playerId?`, `dailyStreak?`, `lastFish?`, `lastHunt?`, `lastExplore?` en `UserRPG`; `lastTrain?` en `UserPet`.

### tests/rpgprog-*.test.ts (37 tests)
- `rpgprog-actions`: base, modo bonus una vez, corte de esclavitud exacto, nivel automático, gremio, misiones, `isPassiveActive` coherente (caducado/legado/sin caducidad), `clamp`.
- `rpgprog-quests`: asignación, reset 24 h, progreso por `objective`, auto-reclamo, `claimCompletedQuests`, cobro heredado tras el reset (claim y update), `renderQuestList`.
- `rpgprog-economia`: `parseAmount` en depósito/retiro/transferencia, tope, deuda con interés, confiscación, `getActiveSlaves`, mensajes de banco/transferir con saldos reales, `/pasivo` escribe `PASSIVE_MODE_NO_EXPIRY`.
- `rpgprog-robar`: cantidad acotada, `applyRobTransfer` cerrado, probabilidad acotada, XP en el piso, maná con ladrón lleno, handler: escudo/pasivo bloquean, robo real conserva el dinero, víctima sin recursos no consume cooldown.
- `rpgprog-gremios` (nuevo): `removeGuildExp` simétrico a `addGuildExp`; ciclo depositar/retirar no farmea XP.

## Para otros agentes

### Agente RPG combate (rpg-atacar, rpg-duelo, rpg-dungeon*, rpg-bombardear, rpg-items-especiales, rpg-inventario, rpg-tienda, owner-rpg, types/rpg.ts, constants/rpg.ts)

1. **rpg-inventario.ts — `/usar escudo robo`**: no existe (rpg-tienda.ts:639 lo anuncia y rpg-robar.ts ya lo respeta). Al consumir `escudo_robo`: `db.updateUser(jid, { shieldRobo: Date.now() + PVP.SHIELD_DURATION })` y quitar el item; análogo para `escudo_antibombas` → `shieldBombas` y `seguro_vida` → `seguroVida` (48 h).
2. **owner-rpg.ts `setclase` (≈1192-1199) — OBLIGATORIO en el mismo commit**: quitar los `100 + classInfo.baseStats.healthBonus` etc. y `classSelectedAt`; asignar solo `playerClass` y recortar `health/mana/stamina` a `calculateTotalStats(user)` (igual que rpg-clase.ts). `CLASS_STATS_MIGRATION_ENABLED` está en `true`: si `setclase` sigue sumando, esos usuarios tendrán doble bonus y perderán los bonus de nivel.
3. **Modo pasivo**: sustituir `x.passiveMode && x.passiveModeUntil > now` por `isPassiveActive(x, now)` de `../lib/rpg-actions.js` en `rpg-bombardear.ts:80` y `:88`, `rpg-duelo.ts:485`, `rpg-items-especiales.ts:144` y `owner-rpg.ts:789`. Hoy ambos criterios coinciden (pasivo escribe `PASSIVE_MODE_NO_EXPIRY`), así que no es urgente, pero deja un solo sitio donde cambiarlo.
4. **Deuda IMSS**: en `applyDeathPenalty`, tras `debt: newTotalDebt`, llamar `ensureDebtTimestamps(user, now)` de `./rpg-economia.js` (o fijar `debtCreatedAt`/`debtInterestApplied = now` si valían 0). Lo mismo en `pagardeuda` cuando la deuda llega a 0.
5. **Mascotas en combate**: aplicar `getPetBuff(user.pet, now)` de `./rpg-mascotas.js` (`{ attackMul, defenseMul }`) en atacar/duelo/dungeon, y `addPetExp(user.pet, xp)` al ganar (persistir `pet`).
6. **Misiones**: importar `updateQuestProgress` de `../lib/quests.js` (rpg-dungeon.ts:11, rpg-dungeon-interactivo.ts:11); el wrapper de rpg-misiones.ts se borrará después. rpg-atacar.ts:362 tiene una copia local que matchea por `questId.includes` y no auto-reclama: borrarla e importar la de `lib/quests.ts` (`'combat'`).
7. **`grantRewards`** (`../lib/rpg-actions.js`): sustituir en atacar/dungeon/duelo/bombardear las sumas manuales de XP/dinero y las copias de modos globales y corte de esclavitud por `grantRewards(db, jid, { exp, money, questObjectives: [{ objective: 'combat', amount: 1 }] }, { source: 'attack' })` y `formatReward(ctx, titulo, lines)`. Si la recompensa ya trae multiplicadores de rango propios, pasar `rank: false`.
8. **rpg-atacar.ts:32 — alias `cazar`/`hunt`**: si se quiere que `/cazar` sea la cacería, quitarlos de `command` de atacar y avisar: entonces rpg-cazar.ts pasa a `/^(cazar|hunt|caceria|cacería|cazarpresa)$/i` y la entrada de menú cambia a `cmd: 'cazar'`. Mientras tanto el comando de cacería es `caceria` y `/cazar` sigue atacando.
9. **types/rpg.ts — `QuestObjective`**: ampliar con `'mine' | 'daily' | 'fumar' | 'transfer' | 'fish' | 'hunt' | 'explore'` y mover `EXTRA_DAILY_QUESTS` (lib/quests.ts) a `DAILY_QUESTS`; entonces `QuestGoal` puede volver a ser `QuestObjective` y `QuestDef` desaparecer.
10. **constants/rpg.ts**: añadir `GUILD.XP_BONUS_PER_LEVEL: 2` y `GUILD.MONEY_PER_EXP: 100` y migrar `GUILD_XP_BONUS_PER_LEVEL` (lib/rpg-actions.ts) y `GUILD_MONEY_PER_EXP` (rpg-gremios.ts); opcionalmente `COOLDOWNS.FISH: 15 min` y `ROB.MIN_THIEF_MONEY: 50`.
11. **rpg-forja.ts**: para que la pesca deje material, añadir `pescado: { id: 'pescado', name: 'Pescado', emoji: '🐟', rarity: 'comun', description: 'Pescado fresco del lago', sellPrice: 8 }` a `FORGE_MATERIALS` (rpg-pescar.ts lo detecta solo).
12. **rpg-tienda.ts / `spend`**: `comprar` debería llamar `updateQuestProgress(db, jid, 'spend', precioTotal)` (`../lib/quests.js`); si no se añade una misión `spend`, se pueden quitar las llamadas de clase/esclavizar/liberar/adoptar/gremio crear.
13. `owner-rpg.ts`: `resetUser`, `setLevel`, `grantExp/loseExp` y `getRoleByLevel` según handoff-datos.md siguen pendientes de ese archivo.

### Agente core (src/plugins/index.ts, src/plugins/menu.ts, src/handler.ts)

**src/plugins/index.ts** — imports (junto a los demás `rpg-*`):
```ts
import { eventosPlugin } from './rpg-eventos.js';
import { pescarPlugin } from './rpg-pescar.js';
import { cazarPlugin } from './rpg-cazar.js';
import { explorarPlugin } from './rpg-explorar.js';
```
y en `ENTRIES.rpg`, después de `['rpg-minar', minePlugin],` (es decir, ANTES de `['rpg-atacar', atacarPlugin]`; no hay colisión porque rpg-cazar ya no registra `cazar` ni `hunt`):
```ts
    ['rpg-pescar', pescarPlugin],
    ['rpg-cazar', cazarPlugin],
    ['rpg-explorar', explorarPlugin],
    ['rpg-eventos', eventosPlugin],
```
Aliases que registran: `pescar|fish|pesca`, `caceria|cacería|cazarpresa`, `explorar|explore|expedicion|expedición`, `eventos|events|modos|evento`. Ninguno colisiona con los plugins actuales. **Debe ir en el mismo commit que `lib/quests.ts`**: la misión diaria `daily_fish_3` ya entra en el sorteo y solo `/pescar` la hace avanzar.

**src/plugins/menu.ts**:
- Categoría `rpg` (`id: 'rpg'`): `commands: ['verificar', 'perfil', 'nivel', 'daily', 'work', 'minar', 'pescar', 'caceria', 'explorar', 'eventos']`.
- En `COMMAND_INFO` (bloque `// RPG Básico`):
```ts
  pescar: { cmd: 'pescar', aliases: ['fish'], desc: 'Pescar para ganar dinero y XP', usage: '/pescar' },
  caceria: { cmd: 'caceria', aliases: ['cazarpresa'], desc: 'Salir de caza: dinero, XP y materiales (gasta energía)', usage: '/caceria' },
  explorar: { cmd: 'explorar', aliases: ['explore', 'expedicion'], desc: 'Explorar el mapa: cofres, trampas, mercaderes', usage: '/explorar' },
  eventos: { cmd: 'eventos', aliases: ['events', 'modos'], desc: 'Ver eventos y modos globales activos', usage: '/eventos' },
```
- Actualizar `nivel`: `desc: 'Ver tu progreso de nivel y beneficios de rango (sube solo al ganar XP)'`; `clases`: `usage: '/clases [nombre o número]'`; `logros`: `usage: '/logros [categoría]'`; `daily`: quitar `reclamar` de la descripción si aparece como alias de reclamarlogro (sigue siendo alias de daily); `banco`: `usage: '/banco [depositar|retirar] [cantidad]'`; `pasivo`: `on|off`; `gremio`: añadir `expulsar`, `lider`, `retirar`, `descripcion`, `listar [página]`.

**src/handler.ts**: nada obligatorio.

### Agente grupos (admin-stats.ts)
- `stats` queda en rpg-ranking.ts (se registra antes). Quitar el alias `stats` de `adminStatsPlugin` (dejar `botstats`/`adminstats`).

### Agente datos (src/types/user.ts, database.ts)
- `passiveModeUntil` sigue siendo necesario (es el criterio compartido). Actualizar su comentario en `UserRPG`: "0 = inactivo; `PASSIVE_MODE_NO_EXPIRY` = pasivo sin caducidad; otro valor = pasivo legado con fecha".
- `UserRPG.role`/`classSelectedAt`: esta área ya no los escribe.

## Decisiones

- **Modo pasivo coherente con `passiveModeUntil`** (`isPassiveActive = passiveMode && passiveModeUntil > now`, activación escribe `PASSIVE_MODE_NO_EXPIRY`): la alternativa de un interruptor que ignorara `passiveModeUntil` dejaba sin protección frente a bombas/duelos/items a quien activara el pasivo (esos plugins leen el campo) y volvía a proteger a pasivos legados ya caducados. Con el criterio compartido no hace falta migración en `database.ts` (fuera del área) y no caduca en silencio para los nuevos.
- **XP de gremio reversible al retirar** en vez de "XP solo por aportación neta histórica": `Guild` (types/database.ts) es del agente de datos y añadir `treasuryPeak` tocaría su archivo; restar la XP equivalente cierra el exploit sin campos nuevos. Descartada la comisión sobre `retirar` (castiga usos legítimos sin cerrar el farmeo si la comisión es menor que el valor del nivel).
- **`caceria` como comando principal de la caza**: `cazar`/`hunt` ya son alias de atacar y el handler se queda con el primero registrado; renombrar evita depender del orden en index.ts y de un cambio en rpg-atacar. Se vuelve a `cazar` cuando combate suelte el alias.
- **Cobrar antes de renovar** en misiones: el reset es un detalle de asignación; lo que el jugador ya completó se paga siempre.
- **`BANK_MAX_AMOUNT` como tope duro** en vez de umbral con comisión.
- **`grantRewards` aplica el rango por defecto y permite `rank: false`** para recompensas fijas (daily con `dailyBonus`, misiones, logros, registro).
- **Auto-reclamo de misiones** en `updateQuestProgress`; `/misiones reclamar` y `/reclamarmision` quedan para progreso heredado.
- **`EXTRA_DAILY_QUESTS` en lib/quests.ts** y no en `types/rpg.ts` (archivo del agente de combate).
- **`calculateDamage` no se usa en robar**: el robo no tiene ataque/defensa; meter una tirada de daño en la probabilidad cambiaría el balance sin criterio. Se usan `ROB.*` + `clamp`. Si el integrador quiere la letra del informe, el sitio es `successChance` en `calculateRobAttempt` con un término acotado de `calculateTotalStats(thief).attack - calculateTotalStats(victim).defense`.
- **Ladrón gana exactamente lo que pierde la víctima también en maná**, limitado al hueco del ladrón, y el sorteo evita recursos sin margen.
- **Hambre de mascota como función del tiempo** (`getPetHunger`) en vez de un cron.
- **Racha diaria con margen de 2 cooldowns**.
- **`FISH_COOLDOWN` local (15 min)**; la constante se puede mover a `COOLDOWNS` sin tocar el plugin.
- **Mercader de explorar entrega el item directamente**.
- **Herida de caza/trampa nunca mata**.
- **`ranking dinero` suma banco + efectivo**.
- **Mensajes cortos con detalle bajo demanda** (`/clases <n>`, `/logros <categoría>`, `/nivel` para el rango) en vez de recortar información: el modo compacto del handler ya lo respetan `formatReward`/`replyCooldown`.

## Pendiente

- `/eventos`, `/pescar`, `/caceria`, `/explorar` no están registrados hasta que el agente core aplique las entradas de index.ts y menu.ts (mismo commit que `lib/quests.ts` por `daily_fish_3`).
- `/cazar` y `/hunt` siguen siendo atacar mientras rpg-atacar.ts los conserve.
- `owner-rpg.ts setclase` sigue cocinando stats de clase (punto 2 de combate, obligatorio con `CLASS_STATS_MIGRATION_ENABLED = true`).
- `escudo_robo` se respeta en robar pero no se puede activar hasta que rpg-inventario implemente `/usar escudo robo`.
- La pesca no deja material hasta que exista `FORGE_MATERIALS.pescado`.
- `GUILD_XP_BONUS_PER_LEVEL` y `GUILD_MONEY_PER_EXP` viven en el área hasta que se añadan a `GUILD` en constants/rpg.ts.
