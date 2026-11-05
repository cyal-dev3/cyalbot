# Handoff: área rpg-combate (combate, duelos, dungeons, items, tienda, forja, owner)

Estado al cierre: `npx tsc --noEmit` no da errores en los archivos del área (los que quedan, si los hay, son de `src/handler.ts` y `src/plugins/game-trivia.ts`, ajenos y en edición). `npm test` pasa completo (305 tests, 32 nuevos en `tests/rpgcombate-*.test.ts`).

## Hecho

### src/lib/rpg-combat.ts (nuevo)
- **Registro de ocupados** compartido: `setBusy(jid, 'duel'|'dungeon')` (false si ya está en otra actividad), `getBusy`, `clearBusy`, `listBusy`, `busyMessage`. Lo consultan duelo, dungeon, /atacar, /bombardear (víctima) y /boss.
- **Efectos de estado** (`StatusEffect` usado de verdad): `CombatantState { effects, blocking }`, `createCombatState`, `effectiveAttack/effectiveDefense` (buffs % y debuff), `isEvading/consumeEvasion` (la evasión dura hasta el siguiente golpe recibido), `tickEffects` (descuenta una acción propia). `applySkillEffect(skill, attackerState, defenderState)` aplica `buff.attack/defense/evasion` al atacante y `debuff.defense` al defensor y devuelve `{ lines, dealsDamage }`; el daño directo lo resuelve el combate con `skill.effect.damageMultiplier`.
- **Buffs del usuario**: `PERMANENT_BUFF = Number.MAX_SAFE_INTEGER` (expiresAt de las runas; `Infinity` no sobrevive al JSON), `DROP_LUCK_BUFF` (`'dropLuck' as ActiveBuff['type']`, único sitio con el cast), `activeBuffs`, `pruneExpiredBuffs`, `getExpMultiplier(user)` (producto de los `expBoost` activos: elixir, boost 24h y runas), `getDropLuck(user)`, `rollDrops(drops, { luckBonus, chanceMultiplier, random })`.
- **Combatientes**: `Fighter`, `statsWithPet(stats, pet)` (aplica `getPetBuff` de rpg-mascotas), `playerStats(user)` = `calculateTotalStats` + mascota, `fighterFromUser`, `fighterFromMonster(monster, boss)` con `PVE.DUNGEON.BOSS_STATS_MULTIPLIER` y `PVE.MONSTER_CRIT_CHANCE`.
- **`simulateFight(a, b, { maxTurns, attackerMultiplier, defenderMultiplier })`** → `{ result: 'won'|'lost'|'draw', damageDealt, damageTaken, turns, attackerHealth, defenderHealth, log }`. Usa `calculateDamage` de rpg-utils; en tests se controla sustituyendo `Math.random`.
- **`handlePlayerDeath(db, jid, name?, now?)`**: seguro de vida → cuota 0; si no, `calculateIMSSFee(randomInt)` de constants, paga o anota deuda, **fija `debtCreatedAt = now` si era 0** (para el interés de rpg-economia), revive con 1 HP y devuelve `{ fee, paid, insured, debt, tierLabel, message }`. Sustituye a `applyDeathPenalty`/`generateIMSSMessage`/`calculateIMSSFee` de rpg-bombardear (borrados; solo los importaban archivos del área).
- **`grantCombatRewards(db, jid, { exp, money, items?, quest? })`**: `applyGlobalModes` + `getExpMultiplier` + `grantExp`, suma dinero/totalEarned, entrega botín con `addLoot` (inventario o forgeMaterials), persiste y llama `updateQuestProgress(db, jid, 'earn', money)` y la misión indicada (`combat`/`dungeon`). Devuelve `{ exp, money, leveledUp, from, to, expMultiplier, lines, items, lost }`.

### src/lib/rpg-inventory.ts (nuevo)
- `addItem(user, itemId, qty, { enhanceLevel? })` con tope `LIMITS.MAX_INVENTORY_SIZE` (unidades totales; añade lo que cabe y devuelve `{ ok, added, reason: 'unknown'|'invalid'|'full' }`). Los equipables con `enhanceLevel > 0` son **entradas únicas** insertadas delante de las demás del mismo item (calculateTotalStats toma la primera entrada, así lee la pieza mejorada).
- `removeItem(user, itemId, qty, { enhanceLevel? })`: falla sin tocar nada si no hay suficientes; sin `enhanceLevel` descuenta primero las unidades sin mejorar.
- `resolveItem(term, candidates)`: exacto (id o nombre sin tildes) > empieza-por > contiene; si en el primer nivel con resultados hay más de un candidato devuelve `{ status: 'ambiguous', candidates }` y el comando responde la lista (`formatAmbiguous`) sin actuar. Sirve para items, materiales, recetas, dungeons y habilidades (cualquier `{ id, name }`).
- `isEquipped`, `findEquippedEntry(user, slot)` (la entrada de mayor nivel de forja), `countItem`, `inventorySize`, `freeInventorySpace`, `inventoryItems`, `isEquipable`, `EQUIPMENT_SLOTS`.
- Materiales: `addMaterial`, `removeMaterial`, `getMaterialCount`, `missingMaterials`, `consumeMaterials` (todo o nada), `listMaterials`, `addLoot(user, id)` (enruta a inventario o forgeMaterials), `lootLabel`, `migrateLegacyMaterials(user)` (mueve `hierro/oro_material/cristal_mana/escama_dragon` del inventario antiguo a forgeMaterials).
- Sustituye las 7 copias de "añadir item" y 4 de "quitar" que había en atacar, dungeon, dungeon-interactivo, tienda (x2), forja (x2), inventario, owner-rpg.

### src/constants/rpg.ts
- `PVP`: `DUEL_COOLDOWN` (5 min, `user.lastDuel`), `DUEL_ACTION_COOLDOWN`, `DUEL_BET`, `DUEL_COMBO`, `DUEL_REGEN`, `DUEL_COSTS`, `BLOCK_REDUCTION`, `DUEL_EXP`, `BOMB_KILL_REWARD`.
- `PVE`: `ATTACK_STAMINA_COST`, `ATTACK_MIN_STAMINA`, `MAX_TURNS` (20, empate), y en `PVE.DUNGEON`: `XP_MULTIPLIER_ON_FLEE/TIMEOUT`, `MAX_TURNS_PER_FIGHT`, `BOSS_REWARD_MULTIPLIER`, `REGEN_BETWEEN/BEFORE_BOSS`, `ACTION_TIMEOUT`, `MAX_TIMEOUTS`, `SESSION_INACTIVITY`, `CLEANUP_INTERVAL`, `DEFEND_REDUCTION`, `DEFEND_MANA_REGEN`, `FLEE_BASE_CHANCE`, `FLEE_STAMINA_BONUS`.
- Nuevos: `SPECIAL_ITEMS` (duraciones y rangos de los items de diamantes), `BOSS` (jefe mundial), `SHOP` (`PAGE_SIZE`, `MAX_PER_PURCHASE`, `MAX_STACK`), `ITEM_TYPE_EMOJI`, `ITEM_TYPE_NAMES`, `SLOT_ALIASES`, `ITEM_TYPE_ALIASES`, tipo `EquipmentSlot`.

### src/types/rpg.ts
- `FORGE_MATERIALS` y `ForgeMaterial` viven aquí (antes en rpg-forja.ts) con `price?` para los que vende la tienda (carbon, piedra, cobre, hierro, cuero). `LEGACY_MATERIAL_ITEMS` (id antiguo → material).
- **Eliminados los `ITEMS` de tipo material** (`hierro`, `oro_material`, `escama_dragon`, `cristal_mana`): los drops de monstruos/dungeons apuntan ahora a ids de `FORGE_MATERIALS` (`oro`, `cristal`, `hierro`, `escama_dragon`) y van a `forgeMaterials`. `WEEKLY_QUESTS.weekly_dungeon_5` da `pocion_forja` en vez de `cristal_mana`. Tipo `Drop` para drops.
- `ItemType` conserva `'material'` (lo usan los alias de categoría) aunque ya no haya items de ese tipo.

### src/plugins/rpg-items-especiales.ts (nuevo)
- Tabla `itemId → handler({ ctx, db, user, rest, now })` → `{ ok, message, updates }`. `useSpecialItem(ctx, db, user, item, rest)` ejecuta el handler y **solo si tuvo efecto** descuenta una unidad y guarda; sin handler o con `ok: false` responde el motivo sin consumir.
- Implementados: `ticket_muteo` (grupo + bot admin; `handler.setAutoMute(chat, true)` + `muteUser`; se desmutea con `setTimeout(24h).unref()`), `ticket_kick` (`conn.groupParticipantsUpdate(...'remove')`), ambos rechazan admins, owner (`isOwnerId`) y al bot (`sameUser(conn.user.id)`), `bomba_dinero` (roba 500-2000 a cada registrado del grupo salvo pasivos y con `shieldRobo`; sin víctimas no se consume), `escudo_robo`/`escudo_antibombas` (`PVP.SHIELD_DURATION`, extiende si ya había), `seguro_vida` (48 h), `cofre_oro`, `pocion_suerte` (buff `dropLuck` 20 %, 1 h), `caja_misteriosa` (equipable raro+ ponderado por rareza, excluye los exclusivos de diamantes), `cambio_nombre <nuevo>`, `reset_clase` (`playerClass = null` y recorta stats), `doble_exp_permanente` (un `expBoost` permanente con valor 1.25/1.5/1.75; la cuarta runa se rechaza sin consumir).
- Exporta `SPECIAL_ITEM_USAGE`, `isSpecialItem`, `mysteryBoxPool`, `pickMysteryBoxItem`, `permanentExpStacks`.

### src/plugins/rpg-inventario.ts
- `/inventario [tipo]` con ocupación `x/500`, nivel de forja por entrada, ✓ en la pieza equipada (la de mayor nivel), buffs activos (incl. permanentes y `dropLuck`), `/inventario materiales` lista forgeMaterials; migra materiales antiguos al abrirlo.
- `/equipar`, `/desequipar` (recorta vida/maná/energía al nuevo máximo), `/usar` (resolución con `resolveItemWithRest` que separa el texto sobrante para `cambio nombre`; items especiales delegan en rpg-items-especiales; `forgeBoost` crea su buff igual que `expBoost`; `all`/cantidad calculan lo necesario), `/iteminfo` también muestra materiales e ids.
- Exporta `inventoryPlugins` (nombres `rpg-inventario`, `rpg-equipar`, ...) además de `registerInventoryPlugins`.

### src/plugins/rpg-tienda.ts
- `/tienda` muestra categorías; `/tienda <categoría> [página]` y `/tienda diamantes [página]` paginan (`SHOP.PAGE_SIZE`) y muestran el `id` de cada item; `/tienda materiales` vende materiales básicos directo a forgeMaterials.
- `/comprar [item|id] [cantidad]` detecta por sí solo si el item es de monedas, de diamantes o material (`comprard` y sus alias son el mismo plugin), usa `resolveItem` (ambigüedad → lista), nivel requerido, `SHOP.MAX_STACK` (runa máx. 3, tickets 10), tope de inventario (compra solo lo que cabe), misión `spend`. Pistas de uso con `SPECIAL_ITEM_USAGE`.
- `/vender [item|material] [n]`, `/vender todo consumibles|materiales`; nunca un item equipado; actualiza `totalEarned` y misión `earn`.
- Añadidos a la tienda de monedas: `martillo_guerra`, `capa_cazador`, `pocion_forja`.

### src/plugins/rpg-forja.ts
- `FORGE_MATERIALS` re-exportado desde types. `craft_elixir_exp` produce `elixir_exp`. Recetas nuevas para los items que antes no se podían obtener (martillo_guerra, armadura_sombras, tunica_archimago, anillo_vampiro, amuleto_mana_infinito, cinturon_titan, capa_invisibilidad, pendiente_dragon).
- `/forja recetas [categoría] [página]` con `id` (= `resultItemId`) y estado ✅/📦/🔒; `/forja craftear [nombre|id]` con `resolveItem`; probabilidad = base + `forgeBoost` (Poción del Herrero) acotada a 100; `consumeMaterials` atómico.
- `/forja mejorar [slot]`: trabaja sobre `findEquippedEntry`; separa la unidad a mejorar del montón (`splitEnhanceEntry`) para que el +N no se herede; al destruir solo cae esa unidad (si quedan otras siguen equipadas); al volver a +0 se funde con el montón. Textos con `FORGE.ENHANCE_BONUS_PER_LEVEL`/`MAX_ENHANCE_LEVEL`. Las mejoras +6 en adelante piden confirmación **respondiendo `si`/`no` sin prefijo** durante 60 s (`forgeContext`, `pendingConfirm` por jid y chat); la confirmación comprueba que el item no cambió.
- `/forja fundir [item]` solo equipo no equipado (funde la unidad de menor nivel); `/forja vender [material] [n]` con `sellPrice`; `/forja materiales` con valor total e ids.

### src/plugins/rpg-atacar.ts
- `simulateFight` con `fighterFromUser` (clase + equipo + mascota) y `PVE.MAX_TURNS`; resultado `won|lost|draw` (el empate solo aplica el daño recibido, sin recompensa ni IMSS). Victoria → `grantCombatRewards` (modos globales, buffs de XP, drops con `rollDrops` + suerte, misión `combat`) y `addPetExp`; derrota → `handlePlayerDeath`. Misión `combat` también avanza al perder/empatar. Textos con `msToTime(PVP.ATTACK_COOLDOWN)`. Rechaza si el jugador está en duelo/dungeon. Se borró la `updateQuestProgress` local (duplicaba la de rpg-misiones con otra semántica).

### src/plugins/rpg-bombardear.ts
- `COOLDOWNS.BOMB` y textos con `msToTime`; `calculateTotalStats` de rpg-utils; escudo antibombas con tiempo restante real; muerte (propia o de la víctima) → `handlePlayerDeath`; recompensa por kill → `grantCombatRewards` con `PVP.BOMB_KILL_REWARD`; no se puede bombardear a quien está en duelo/dungeon. `/pagardeuda` limpia `debtCreatedAt/debtInterestApplied` al saldar; `/deuda` muestra el seguro activo.

### src/plugins/rpg-dungeon-common.ts (nuevo)
- `findDungeon(term)` (resolveItem), `checkDungeonEntry(user, jid, dungeon)` (ocupado, cooldown, nivel, energía, salud), `formatDungeonList`, `buildEncounters(dungeon)` (monstruos + boss con multiplicadores), `monsterRewards`, `monsterDrops` (`DROP_CHANCE_REDUCTION` salvo boss, suerte), `finalizeDungeonLoot(dungeon, loot, reason, { diedToBoss, luckBonus })` (multiplicadores y drops garantizados/bonus al completar; recorte `PARTIAL/FULL/FLEE/TIMEOUT` y pérdida de items si no), `healthBar` con clamp.

### src/plugins/rpg-dungeon.ts
- Un solo comando `dungeon|dungeons|mazmorra|dr`: sin args lista; `<nombre>` entra en interactivo; `<nombre> rapido` (o `dr`) simula con `simulateFight` por encuentro reutilizando `buildEncounters`/`monsterRewards`/`finalizeDungeonLoot`; un combate que llega al tope de turnos obliga a retirarse (`flee`). Eliminados los 11 alias redundantes (`dungeonsrapido`, `dungeons-rapido`, `mazmorrasrapido`, `dungeonrapido`, `dungeon-rapido`, `mazmorrarapida`, `exploraciones`, `explorar`, `mazmorras`, ...). `dungeonsPlugin` queda como alias `@deprecated` del mismo objeto.

### src/plugins/rpg-dungeon-interactivo.ts
- Sesión con `CombatantState` para jugador y monstruo (buffs/evasión/trampa de clase vía `applySkillEffect`), `currentHealth = min(health, max)`, barras con clamp, huir solo en tu turno y nunca contra el boss, **contador de timeouts** (`MAX_TIMEOUTS` = 3 → termina como `timeout`), `lastActionTime` solo se refresca con acciones del jugador, persistencia de vida/maná/energía al terminar, `PVE.DUNGEON.*`, drops a forgeMaterials vía `grantCombatRewards`, `addPetExp` al completar, `setBusy/clearBusy`.
- El `setInterval` de módulo pasa a `startDungeonCleanup()/stopDungeonCleanup()` con `.unref()`; la limpieza cierra la sesión avisando al jugador.
- Acciones solo en `dungeonContext` (`isActive: activeDungeons.has(m.sender)`, `noPrefix`): `a|atacar|attack|atk`, `d|defender|defend|def|b|bloquear`, `/^(h|habilidad|skill|poder|p|h\d+)$/`, `/^(i|item|pocion|usar|i\d+)$/`, `huir|escapar|flee|salir|rendirse`, `estado|status|st`. Exporta `startInteractiveDungeon`, `activeDungeons`, `formatSessionStatus`, `cancelDungeon` y los antiguos nombres como `@deprecated`.

### src/plugins/rpg-duelo.ts
- Estado `ActiveDuel { players: { challenger, target }: DuelPlayer, pot, groupJid, ... }`; `createDuelPlayer` usa `playerStats(user)` (clase + equipo con forja + mascota) sin volver a sumar arma/armadura. `performDuelAction(duel, side, { kind: 'attack' | 'block' | 'skill' })` es pura (solo muta el duelo) y sustituye las ~150 líneas duplicadas: cooldown de acción, costes/regeneración, combo (`PVP.DUEL_COMBO`), bloqueo (`BLOCK_REDUCTION`), evasión, buffs y trampa (`applySkillEffect`), `pvpDamageMultiplier()`, `PVP.DAMAGE_MULTIPLIER`, crítico al 70 %, curación de robo_vital.
- `settleDuel(db, duel, winner | null, reason)`: libera ocupados, vida real proporcional para ambos (`floor(vidaDuelo / HEALTH_MULTIPLIER)`), persiste maná/energía y `lastDuel`, **IMSS solo a quien llegó a 0**, `pvpWins/pvpLosses`, pot al ganador o devolución (empate/sin acciones), XP con `grantCombatRewards` (`PVP.DUEL_EXP`), `addPetExp`. `resolveTimeout`: sin acciones → `refund`; misma vida → `draw`; si no, gana el de más vida.
- `/duelo`: ayuda, duelo activo, `canFight` (registro, `PVP.MIN_LEVEL_PVP`, modo pasivo, salud, ocupado) para ambos, `user.lastDuel` + `PVP.DUEL_COOLDOWN`, apuesta `PVP.DUEL_BET`, reto con `groupJid`. `/aceptar` solo en el mismo grupo, repite las comprobaciones, **descuenta la apuesta a ambos (escrow)**, `setBusy` a ambos, temporizador `unref`. `/rechazar`.
- Acciones solo en `duelContext` (`isActive`: hay duelo en el chat y el remitente participa; `noPrefix`): `a|atacar|attack|golpe|golpear|hit|g`, `d|defender|bloquear|block|b`, `h|habilidad|poder|skill|p` (sin args lista todas las habilidades con ✅/❌/⏳), regex de alias/nombres de habilidad, `rendirse|surrender|abandonar|huir|salir`, `estado|status|st`. Mismo vocabulario a/d/h que el dungeon.

### src/plugins/owner-rpg.ts
- Importa y **re-exporta** `globalModes`/`checkExpiredModes` de `lib/global-modes.ts` (cierra la dualidad que pedía el handoff de datos); menú de modos con `getActiveModes`.
- Cantidades validadas (`parseCount` ≥ 1); `rpgdar/rpgquitar/rpgdaratodos` de XP con `grantExp`/`loseExp`; vida/maná/energía acotados a `calculateTotalStats`; `rpgset level` y `rpgsetnivel` (alias `rpgmaxlevel`) con `setLevel`; `rpgset maxhealth/maxmana/maxstamina` acotan los actuales; `rpgsetclase` solo `playerClass` (recorta stats); `rpgfullstats` con `setLevel(1000)`; `rpgdaritem` acepta materiales y respeta el tope; **`rpgquitaritem`** nuevo (desequipa si no quedan); `rpgresetcd/rpgresetcdall` con `cooldownFieldsFor(type)` (incluye `lastBomb`, `lastFumar`, `lastDuel`); `rpgborrar` → `db.resetUser`; `rpginfo` con rango por `getRoleByLevel`, stats base → total, cooldowns de constantes (atacar, dungeon, duelo, bomba, fumar) y protecciones; `rpgforceevent` respeta `applied`; textos con `usedPrefix`; sin `role`/`classSelectedAt`.
- Nuevos **`rpgsesiones`** (duelos, dungeons y ocupados) y **`rpgcancelar [@user|duelo]`** (cierra un dungeon atascado o cancela el duelo del grupo devolviendo la apuesta).
- Exporta `ownerRpgEntries: [nombre, plugin][]` con nombres legibles (`owner-rpg-dar`, ...); el `default` sigue siendo el array de plugins (`@deprecated`).

### src/plugins/rpg-boss.ts (nuevo, opcional 9)
- Jefe mundial con vida compartida en `db.getSettings().worldBoss` (cast `SettingsWithBoss`, `db.updateSettings`). `/boss` estado y top 3; `/boss atacar` (cooldown `BOSS.ATTACK_COOLDOWN` por jugador en el propio estado, `BOSS.STAMINA_COST`, daño escalado `1 + nivel/10`, contraataque, muerte → IMSS). Al morir: `BOSS.REWARD.MONEY_POOL` repartido `50/30/20` entre el top 3, XP para todos por daño, item de `pickMysteryBoxItem` al primero, `bossesKilled`. Owner: `/bossinvocar [nombre]`, `/bossdespedir`.

### src/plugins/rpg-combate-router.ts (nuevo)
- `combatEntries` (todos los plugins globales del área con nombre legible) y `registerCombatContexts(handler)`: registra esos plugins, los contextos `duelContext`, `dungeonContext`, `forgeContext` y llama `startDungeonCleanup()`.

### tests/rpgcombate-*.test.ts (nuevos, 32 tests)
- `combat`: simulateFight (won/lost/draw determinista con `Math.random` fijo), applySkillEffect/evasión/expiración, registro de ocupados, multiplicadores de buffs y `rollDrops`, handlePlayerDeath (pago, deuda con `debtCreatedAt`, seguro), grantCombatRewards (buff x2, botín a inventario y materiales, misión).
- `inventory`: apilado, entradas únicas mejoradas y su orden, tope, removeItem atómico y por nivel, resolveItem (niveles y ambigüedad), isEquipped/findEquippedEntry, materiales atómicos, addLoot, migración de materiales antiguos.
- `duelo`: createDuel, acciones (cooldown, bloqueo a la mitad, no bloquear dos veces), habilidades (clase ajena, evasión, trampa, cooldown), escrow y vida final proporcional, IMSS solo al que llegó a 0, rendirse sin IMSS, timeout sin acciones (devolución), empate (devolución) y timeout con ganador.
- `items-especiales`: cada item hace lo que dice o no se consume (incluye tickets con `handler.muteUser`/`groupParticipantsUpdate` falsos y bomba respetando pasivo/escudo).

## Para otros agentes

### Agente core: src/plugins/index.ts
1. Añadir el import `import { registerCombatContexts } from './rpg-combate-router.js';` y la sección (antes de `{ category: 'rpg', entries: ENTRIES.rpg }` para que `inventario`/`tienda` sigan ganando los alias `usar`, `info`, `remove`):
   ```ts
   { category: 'rpg-combate', register: registerCombatContexts },
   ```
2. Eliminar las secciones `{ category: 'inventario', register: registerInventoryPlugins }` y `{ category: 'tienda', register: registerShopPlugins }` y sus imports (los incluye `combatEntries`).
3. Quitar de `ENTRIES.rpg` y de los imports: `rpg-atacar`, `rpg-duelo`, `rpg-aceptar`, `rpg-rechazar`, `rpg-atacar-duelo`, `rpg-bloquear-duelo`, `rpg-poder-duelo`, `rpg-skill-detector`, `rpg-rendirse`, `rpg-bombardear`, `rpg-pagardeuda`, `rpg-verdeuda`, `rpg-dungeons-interactivo`, `rpg-dungeon-interactivo`, `rpg-dungeon-atacar`, `rpg-dungeon-defender`, `rpg-dungeon-habilidad`, `rpg-dungeon-item`, `rpg-dungeon-huir`, `rpg-dungeon-estado`, `rpg-dungeon`, `rpg-dungeons`, `rpg-forja` y la línea `...ownerRpgPlugins.map((p, i): Entry => [\`owner-rpg-${i}\`, p])` (con su `import ownerRpgPlugins from './owner-rpg.js'`). Los exports antiguos siguen existiendo marcados `@deprecated` para que compile mientras tanto; cuando index.ts migre se pueden borrar (están al final de rpg-duelo.ts, rpg-dungeon.ts, rpg-dungeon-interactivo.ts y el `default` de owner-rpg.ts).
4. En `src/index.ts`, importar `stopDungeonCleanup` de `./plugins/rpg-dungeon-interactivo.js` y llamarlo en `gracefulShutdown` junto a `stopAutoRegen()`/`stopAutoEvents()` (el arranque ya lo hace `registerCombatContexts`).

### Agente core: src/handler.ts
- Borrar `DUEL_COMMANDS_NO_PREFIX`, `SKILL_PATTERNS_NO_PREFIX` y la rama `isNoPrefixDuelCommand` (líneas 19-22 y 877-878 en la versión leída): el texto sin prefijo del duelo y del dungeon lo resuelven ya los `CommandContext` registrados. Sin este cambio, "g", "huir" o "fuego" en un grupo sin duelo activo siguen entrando al despacho global como comando.

### Agente core: src/plugins/menu.ts
- Categoría tienda: `commands: ['tienda', 'comprar', 'vender']` (quitar `comprard`; `/comprar` detecta la tienda de diamantes). Quitar la entrada `comprard` del detalle o describirla como alias.
- Dungeons: los comandos son `dungeon` (lista/entrar), `dungeon <nombre> rapido` y `dr`; eliminar `dungeonsrapido`, `dungeons`, `mazmorras`, `explorar` si aparecen.
- Duelo: `duelo`, `aceptar`, `rechazar`; las acciones (`a/d/h/rendirse/estado`) van sin prefijo dentro del duelo, igual que en el dungeon.
- Owner: añadir `rpgquitaritem`, `rpgsetnivel`, `rpgsesiones`, `rpgcancelar`, `bossinvocar`, `bossdespedir`; nuevo comando público `boss`.

### Agente datos: src/types/user.ts y src/lib/database.ts
- `ActiveBuff.type`: añadir `'dropLuck'` (porcentaje extra de probabilidad de drop). rpg-combat.ts lo guarda hoy con `DROP_LUCK_BUFF = 'dropLuck' as ActiveBuff['type']`; al tipar el campo se puede quitar el cast.
- `migrateUser`: llamar a `migrateLegacyMaterials(user)` de `lib/rpg-inventory.ts` (devuelve `boolean`) para mover de una vez los items `hierro/oro_material/cristal_mana/escama_dragon` del inventario antiguo a `forgeMaterials`. Hoy lo hacen `/inventario`, `/forja` y `/vender` al abrirse, así que no se pierde nada, pero `/perfil` u otros lectores verían entradas sin definición hasta entonces.
- `lib/rpg-utils.ts` `calculateTotalStats`: el nivel de forja se lee de la **primera** entrada del inventario con el `itemId` equipado; rpg-inventory mantiene las entradas mejoradas delante, pero sería más robusto usar la de mayor `enhanceLevel` (`findEquippedEntry` de rpg-inventory hace eso). Opcional.

### Agente RPG progresión
- **Buffs de XP**: nadie fuera del combate aplicaba `activeBuffs` de tipo `expBoost` (elixir, boost 24h, runas). Usar `getExpMultiplier(user)` de `lib/rpg-combat.ts` como `multiplier` de `grantExp` en rpg-work, rpg-minar, rpg-daily, rpg-fumar (o moverla a `lib/levelling.ts`). `pruneExpiredBuffs(user)` limpia los caducados.
- rpg-robar.ts: respetar `victim.shieldRobo > now` (el item `escudo_robo` ya lo fija; hoy solo lo respeta la bomba de dinero).
- rpg-misiones.ts (`reclamarMisionPlugin`) y rpg-daily/rpg-verificar si entregan items: usar `addItem(user, id)`/`addLoot` de `lib/rpg-inventory.ts` para respetar el tope y las entradas únicas, en vez de `inventory.find/push`.
- rpg-perfil.ts: `calculateTotalStats` ya incluye mascota si se usa `playerStats(user)` de rpg-combat (opcional, para que el perfil muestre lo mismo que el combate).
- rpg-clase.ts: `reset_clase` deja `playerClass = null`; el cambio posterior debe ser gratis (no es un "cambio de clase" con `CLASS.CHANGE_COST`).
- Los materiales de `/minar` ya coinciden con `FORGE_MATERIALS` (mismos ids); si se añaden minerales nuevos deben existir en `FORGE_MATERIALS`.

## Decisiones

- **`performDuelAction` y `settleDuel` sin `ctx`**: separar la lógica del envío de mensajes permitió testear escrow, vida final y empate sin WhatsApp; los plugins solo traducen el resultado a `m.reply`.
- **Vida real final = `floor(vidaDuelo / HEALTH_MULTIPLIER)`** en lugar de `vidaReal * porcentaje`: es la inversa exacta de cómo se construye la vida del duelo y hace que el daño recibido se traduzca linealmente. Quien llega a 0 queda a 0 y pasa por `handlePlayerDeath` (que revive con 1); el resto nunca baja de 1.
- **Escrow al aceptar**: la apuesta se descuenta a ambos en `/aceptar` y se devuelve en empate, sin acciones o cancelación del owner; antes se cobraba al perder y podía no haber fondos.
- **Apuesta fuera de `grantCombatRewards`**: el pot se paga con `updateUser` directo para que los modos globales no multipliquen dinero que ya era de los jugadores.
- **Entradas únicas para equipo mejorado** con la mejorada delante del montón: `calculateTotalStats` (ajeno) lee la primera entrada; así no hace falta tocarlo para que la pieza +N cuente. Se pide igualmente el cambio a `findEquippedEntry` como mejora.
- **Materiales solo en `forgeMaterials`**: los `ITEMS` de tipo material desaparecen; los drops usan ids de `FORGE_MATERIALS` y `addLoot` enruta. Alternativa descartada: mantener ambos almacenes y sincronizarlos.
- **`caja_misteriosa` y recetas de forja para los items huérfanos** en vez de borrarlos: todos los equipables raro+ que no se vendían ni caían de nada ahora salen de la caja y tienen receta; ninguno se eliminó.
- **Empate en `/atacar`**: 20 turnos sin decidirse aplican solo el daño recibido, sin recompensa ni IMSS (antes contaba como derrota con el jugador vivo).
- **Confirmación de forja con `si`/`no` sin prefijo** vía `CommandContext` en lugar de repetir el comando con `confirmar`; expira a los 60 s y revalida que el item siga igual.
- **`a/d/h/i` compartidos** entre duelo y dungeon; `g/b/poder` se mantienen como alias en el duelo. Como ambos son contextos, la prioridad sobre el registro global (p. ej. `atacar` PvE) la resuelve el handler.
- **Mute del ticket en memoria** (`setTimeout(24h).unref()`): el registro de mute no tiene expiración; si el bot se reinicia antes, el mute queda hasta que un admin lo quite. Persistirlo requeriría cambiar `MuteConfig` (core).
- **Timeout del jefe mundial**: el cooldown por jugador se guarda en el propio estado del jefe (settings) y no en el usuario, para no añadir campos a `UserRPG`.
- **Torneo (`rpg-torneo.ts`) no implementado**: se priorizaron los puntos 1-8 y el jefe mundial; ver Pendiente.
- Se mantuvo `RARITY_COLORS` (lo usan inventario y tienda); `EnhanceResult`, `manaMultiplier` local, `playerLevel`, `dropItems` y la `StatusEffect` sin uso desaparecieron con las reescrituras.

## Pendiente

- **plugins/index.ts, index.ts, handler.ts, menu.ts**: cambios listados en "Para otros agentes"; hasta que index.ts registre `registerCombatContexts`, los contextos no están activos y las acciones de duelo/dungeon solo responden con prefijo a través de los exports `@deprecated` (y el dungeon rápido sigue accesible por `/dr`). Los nombres `owner-rpg-N` persisten hasta que index.ts use `ownerRpgEntries`.
- **`rpg-torneo.ts`** (opcional 9): inscripción 2 min con `/torneo`, emparejamientos aleatorios por rondas resueltas con `simulateFight(fighterFromUser(a), fighterFromUser(b))`, pot de inscripciones al campeón vía `updateUser` (no por `grantCombatRewards`), estado en memoria por grupo y `setBusy` de los inscritos durante la ronda. No se hizo por tiempo.
- `pocion_resurrecion` sigue siendo un consumible normal que restaura todo (su descripción ya lo dice así); no hay estado de "muerto" que revivir.
- El mute por ticket no sobrevive a un reinicio (ver Decisiones).
- La tienda de diamantes y `/comprar` con `comprard` como alias: `menu.ts` sigue listando `comprard` como comando propio hasta que lo cambie el agente core.
- `handler.ts` actual no rellena `chatSettings/user/send/target` en el `ctx` de los contextos (lo está cambiando el agente core); los plugins de esta área no los usan, así que no dependen de ello.
