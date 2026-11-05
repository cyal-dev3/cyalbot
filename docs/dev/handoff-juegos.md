# Handoff: área juegos y diversión

Estado al cierre de la ronda de corrección: `npx tsc --noEmit` pasa en todo el árbol. `npm test`: 360/361; el único fallo es `tests/integracion-registry.test.ts` ("colisiones de alias…") por alias nuevos de `rpg-duelo`/`rpg-dungeon` (área RPG, en edición al cierre; ningún alias de juegos aparece en la lista). Los 42 tests de `tests/juegos-*.test.ts` pasan (11 nuevos en esta ronda; `tests/juegos-mesas.test.ts` es nuevo).

## Hecho

### src/lib/games/state.ts (nuevo)
- `CASINO_LIMITS` (minBet 50, maxBet 25 000, duelFee 5 %, maxTables 100, idleMs 15 min, jackpotShare 1 %).
- `CasinoState { escrow: EscrowEntry[]; stats: Record<game, {wagered, paid, rounds}>; jackpot }`, `getCasino(db)` (referencia viva en `settings.casino`, la crea y repara si está corrupta) y `gameStats(db, game)`.

### src/lib/games/bets.ts (nuevo)
- `parseBet(text, {min?, max?, balance, fallback?})` → `{ok:true, amount} | {ok:false, reason}`. Solo enteros; usa `parseAmount` de utils para k/m/todo/all/mitad; "todo" se acota al máximo de la mesa en vez de rechazarse.
- `debitBet(db, jid, amount, game, {round?})`, `creditWin(db, jid, amount, game)`: tocan `user.money` con `updateUser` y acumulan `casino.stats[game]`.
- Custodia: `holdBet(db, groupId, jid, amount, game, {round?})`, `heldAmount`, `heldByPlayer`, `releaseEscrow(db, groupId, game, {pay: Map} | {refund: true})`, `refundPlayer(db, groupId, jid, game)` (retirarse antes de empezar), `refundAllEscrow(db)` y `restoreCasino(db)` (para index.ts tras `initDatabase`). Los reembolsos restan de `wagered` para que el margen refleje solo apuestas jugadas.
- `houseEdge(db)` para `casinostats`. `formatCoins(n)`.

### src/lib/games/session.ts (nuevo)
- `GameSessionManager<TPlayer, TState, TPhase>`: `create/get/has/join/leave/isPlayerIn/findByPlayer/setPhase/current/advance/setTimer/clearTimer/remainingSeconds/close({refund})/sweepIdle/touch/describe`. `setTimer` envuelve el callback en una promesa: si lanza, loguea, reembolsa la custodia y cierra la mesa; `unref()` en todos los timers. `create` barre mesas inactivas (> idleMs) y respeta `maxTables`.
- Registro global de managers: `listActiveTables(groupId)`, `closeAllTables(groupId)`, `activeGameOf(groupId, games)`.
- `setActiveConnection(conn)` / `getConn()`: cada comando de juego lo llama vía `enter(ctx)`.

### src/lib/games/common.ts (nuevo)
- `enter(ctx)` (registra la conexión y engancha contextos), `requireRegistered`, `requireGroup`, `isRegistered(jid)` (sin crear fichas fantasma), `playerName(jid, pushName)` (displayName con `hasUser` antes de `getUser`), `say/edit` (envío y edición desde temporizadores), `rollInt/pickOne/shuffle` con `crypto.randomInt`, `sleep`.
- `declareContext(ctx)` + `attachContexts(handler, only?)`: cada juego declara su `CommandContext` al cargar el módulo; `registerXxx(handler)` lo registra. **Mientras plugins/index.ts no llame a los `registerXxx`, el primer comando de juego ejecutado los engancha** en `ctx.handler` (WeakMap por handler, idempotente), así las acciones sin prefijo funcionan ya con el registro viejo.
- `GameInfo` + `rulesText(info, prefix)` + `infoPlugin(info, aliases)` para `casino <juego>` y los alias `slotinfo/bjinfo/ruletainfo`.

### src/lib/games/blackjack.ts (nuevo)
Reglas puras testeadas: `handValue` (as 1/11, `soft`), `isBlackjack`, `isBust`, `dealerShouldStand` (17, incluido suave), `dealerPlay`, `settle(player, dealer, bet)` (3:2 natural, natural del crupier gana a 21 no natural, empate devuelve), `newDeck(4)` con Fisher-Yates de una pasada.

### src/plugins/game-blackjack.ts (reescrito, 1052 → ~430 líneas)
- `bj <apuesta>`: reparte al instante en solo (también en privado) o te une a la mesa abierta del grupo. `bj mesa <apuesta>`: abre mesa, 20 s de inscripción. `bj salir`: levantarse durante la inscripción (reembolso).
- Acciones de contexto `blackjack` (noPrefix, activo solo en fase `turnos`): `pedir|carta`, `plantarse|plantar|quedar|pasar|stand`, `doblar|double`. Solo el jugador en turno; 45 s por turno (al expirar se planta). Doblar solo con 2 cartas, respeta maxBet y saldo (custodia extra sin contar ronda). Sin seguro.
- Todo el dinero pasa por custodia; el resultado final paga con `releaseEscrow`.
- Sin alias `hit` ni `vermesa`. Exports deprecados para que index.ts compile: `blackjackPlugin` (= `bjPlugin`), `jugarPlugin` (atajo `jugar|unirse|entrar` → bj), `bjSalirPlugin` (`bjsalir|salirmesa|bjleave`), `bjMesaPlugin` (`bjmesa|bjstatus` → mesa genérica), `bjInfoPlugin`, y `pedirPlugin/plantarsePlugin/doblarPlugin` (los del contexto).

### src/plugins/game-roulette.ts (reescrito, 885 → ~290 líneas)
- `BET_TYPES` única fuente para parseo, pagos y ayuda (pleno 35:1; rojo/negro/par/impar/bajo/alto 1:1; docena/columna 2:1 como `d1..d3`, `c1..c3`). `parseBetType` exportado y testeado.
- `ruleta <tipo> <apuesta>` abre la mesa si no existe y registra la apuesta en un paso; 30 s; `ruleta` sin args: ayuda corta; `ruleta salir` retira apuestas; `girar|spin` (contexto, cualquier apostador) adelanta el giro. Hasta 5 apuestas por persona.
- Animación: un mensaje editado 4 veces y el resultado en otro. Sin alias `bet`, `vermesa`, `ruletamesa`, `tirar`. Deprecados: `apostarPlugin` (`apostar|ap` → ruleta), `ruletaSalirPlugin`, `ruletaMesaPlugin` (`ruletastatus|mesaruleta` → mesa), `ruletaInfoPlugin`, `girarPlugin`.

### src/plugins/game-slot.ts (reescrito)
- Descuenta la apuesta antes de girar; triple paga `bet*mult`, par `bet*mult/2`; pesos `[30,25,20,15,10,7,5,3]` × mult `[2,3,4,5,7,10,15,25]` → RTP teórico 0.87 (test exige 0.85-0.92 teórico y 0.80-0.95 en 1e6 giros simulados).
- Cooldown 3 s por usuario (reacciona ⏳), acepta `5k/todo/mitad`, muestra el neto real, racha de victorias, jackpot progresivo (1 % de cada apuesta perdida → `casino.jackpot`, lo cobra el próximo triple ⭐). Apuesta inválida = error claro (`parseBet`).
- Alias `casino` sale del slot (ahora es el comando `casino`). `spinReel/spinReels/evaluate/simulateRtp` exportados para tests.

### src/plugins/game-mesa.ts (nuevo)
`mesa|mesas` (mesa activa de cualquier juego con fase y segundos) y `cerrarmesa|cerrarmesas` (admin u owner: reembolsa y limpia todas las mesas del grupo).

### src/plugins/game-casino.ts (nuevo)
`casino|juegos` (lista con el comando mínimo de cada juego; `casino <juego>` reglas; sustituye slotinfo/bjinfo/ruletainfo, que quedan como alias), `casinostats` (owner: margen por juego, jackpot, custodia pendiente). `registerCasino(handler)` registra mesa, slot, bj, ruleta, dados, ppt, adivina, ttt, carrera, casino y casinostats con sus contextos; `registerMinijuegos(handler)` registra trivia, ahorcado y memoria.

### Juegos nuevos (src/plugins/game-*.ts)
- **game-dados.ts**: `dados <apuesta> alto|bajo|<2-12>` (alto/bajo 1:1, 7 pierde; exacto paga `36/formas × 0.92`, margen 8 %, testeado) y `dados @usuario <apuesta>` duelo al mejor de 3 con `aceptar` (contexto solo para el retado, 60 s), animación en un mensaje editado; el ganador se lleva el bote íntegro.
- **game-ppt.ts**: `ppt <apuesta> piedra|papel|tijera` contra el bot 1:1 (empate devuelve la apuesta menos 5 %); `ppt @usuario <apuesta>` reto con custodia, `aceptar`, mejor de 3, comisión 5 %, 60 s por fase (sin aceptar: reembolso; sin elegir: pierde quien no eligió). Elección por `piedra|papel|tijera|p|pa|t` sin prefijo **en el grupo o por privado al bot** (ver Decisiones).
- **game-adivina.ts**: `adivina <apuesta>` 1-100, 6 intentos: ×5 (≤2), ×2 (≤4), ×1,2 (≤6); el número sin prefijo (contexto solo para el jugador); 90 s por intento, y dejarlos pasar pierde la apuesta. `adivina grupo` sin apuesta, primero en acertar gana 200, pistas más alto/más bajo, 2 min, una ronda cada 5 min por grupo.
- **game-ttt.ts**: `ttt @usuario [apuesta]`, tablero 1️⃣-9️⃣ con ❌⭕, casilla con el número sin prefijo en tu turno, 60 s por turno (quien no juega pierde), ganador cobra el bote, empate devuelve.
- **game-carrera.ts**: `carrera <apuesta> <1-4>`, 30 s de apuestas (una por persona), animación en un mensaje editado 6 veces, paga ×3,5 (RTP 87,5 %).
- **game-memoria.ts**: `memoria` muestra 6 emojis (10 s, menos por nivel), los oculta editando el mensaje y pregunta la posición N; se responde con el emoji sin prefijo; 50 × nivel al primero (nivel máximo 10, una ronda por minuto y grupo); nivel por grupo en memoria, se reinicia al fallar o a los 30 s.
- **game-trivia.ts**: `trivia [tema] [n]` (n ≤ 10), opciones A-D, respuestas `a|b|c|d` sin prefijo (una por persona), 30 s (10 s tras el primer acierto), 300 al primero y 100 al resto, serie con bono de 500 al mejor registrado si no hay empate; una trivia cada 5 min por grupo. Misma reacción 👀 a toda respuesta para no revelar la correcta. Preguntas con `askJSON` (lotes de 10, caché de 50 por tema) y respaldo local.
- **game-ahorcado.ts**: `ahorcado [categoría]`, palabra + pista (IA o banco local), letras sueltas sin prefijo y palabra completa con `ahorcado <palabra>`, 6 vidas con dibujo, 20 por letra correcta, 500 a quien completa, 3 min sin jugadas cierra, una partida cada 5 min por grupo. Trivia y ahorcado se excluyen mutuamente en el mismo grupo (ambos usan letras sueltas).

### src/lib/ai-games.ts (nuevo)
`nextTriviaQuestion(tema, exclude)`, `localTriviaQuestion`, `nextWord(categoria)`, `localWord`, `normalizeWord`. Valida lo que devuelve la IA (4 opciones distintas, índice 0-3, pista que no contiene la palabra). Importa `ai.ts` de forma perezosa (`import()`), porque `ai.ts` arrastra `plugins/index.ts` completo y eso rompía los tests cuando otro plugin estaba a medio editar.

### src/constants/trivia.ts y src/constants/palabras.ts (nuevos)
104 preguntas (8 temas, ≥ 10 por tema, respuesta correcta repartida en las 4 posiciones) y 150 palabras con pista en 10 categorías. Validados en `tests/juegos-trivia.test.ts`.

### src/lib/social.ts (nuevo)
`recordInteraction(db, from, to, 'kiss'|'hug')` (vista uniforme sobre `kissStats/hugStats`, historial limitado a `LIMITS.MAX_KISS_HISTORY`, marca dirty), `interactionStats(db, jid, kind)` (null si no hay ficha o está a cero; usa `hasUser`), `nameOf(jid, pushName)`, `createInteractionPlugin({...})` que genera beso y abrazo con la misma mecánica (`getTargetUser`, menciones con `mentionTag`, hitos, título de relación).

### src/plugins/fun-beso.ts, fun-social.ts, fun-amor.ts (reescritos; beso+social 398 líneas, antes 1047)
- `beso` y `abrazo` vía `createInteractionPlugin`. `misbesos` y `topbesos` con `interactionStats` (sin `getUser` sobre participantes sin ficha) y menciones.
- `kissall`: `register: true`, cooldown 1 h por usuario, máximo 20 menciones (el resto "y N más"), cuenta 1 en `totalGiven`, un recibido por persona; solo registrados con `hasUser`.
- `gudmornin` y `ctm` con `getTargetUser` (rechaza grupos); textos con `mentionTag` en vez de dígitos de LID. `poka` con `nameOf`.
- `frases <poka|ctm> add <texto>|list|del <n>|clear` (máx. 30 frases de 300 caracteres; add/del/clear solo admin u owner, list para todos). Los 8 comandos viejos (`addpoka`, `listpoka`, `delpoka`, `clearpoka`, `addctm`, `listctm`, `delctm`, `clearctm`) quedan como atajos que reescriben los argumentos y llaman al mismo handler.
- `amor`: dos menciones, mención/cita + remitente, o nombres; hash FNV-1a del **JID completo** (o del nombre) independiente del orden. `gay`: `getTargetUserOrSelf`, hash del JID completo.
- Eliminado: inicializaciones defensivas de `kissStats/hugStats`, `LIMITS?.MAX_KISS_HISTORY || 50`, `export default` sin uso, ramas inalcanzables, encabezados decorativos.
- Cada archivo exporta `registerAmor/registerBesos/registerSocial(handler)`.

### Tests nuevos (tests/juegos-*.test.ts, 31 tests)
`juegos-bets` (parseBet, debit/credit/stats, custodia, reembolsos, reparación de estado), `juegos-session` (turnos, límite, timers con `mock.timers` incluido error → reembolso, barrido de inactivas, registro global), `juegos-blackjack` (valor de mano, naturales, plante del crupier, settle, mazo), `juegos-slot` (pesos, evaluate, RTP teórico y simulado 1e6), `juegos-dados` (formas, alto/bajo, exacto RTP 0.92, adivina óptima < 1, desempate de carrera), `juegos-trivia` (banco de trivia y palabras, ruleta parseo/pagos, ppt/ttt, memoria, hashes de amor).

### Ronda de corrección (hallazgos de los revisores)

Por archivo, qué cambió y por qué:

- **src/lib/games/bets.ts**: `parseBet` rechaza decimales (`100.5`, `1.9k`) en vez de truncarlos; `todo`/`mitad`/`N%` se calculan sobre el saldo y se acotan al máximo de la mesa (antes `mitad` era la mitad de `min(saldo, máximo)`); un literal fuera de rango sigue rechazándose. Nuevo `creditPrize(db, jid, amount, game)` y `dailyPrizeLeft`: los premios de minijuegos sin apuesta (trivia, ahorcado, memoria, adivina grupo) crean monedas, así que se acotan a `CASINO_LIMITS.dailyPrizeCap` (5 000) por persona y día en `casino.prizes[jid] = {day, total}` (se purgan las entradas de otros días).
- **src/lib/games/state.ts**: `CASINO_LIMITS.dailyPrizeCap` y `minigameCooldownMs` (5 min); `CasinoState.prizes` (reparado en `getCasino`).
- **src/lib/games/session.ts**: cada `Session` tiene `id`; `get()`/`has()` cierran con reembolso una mesa vencida (> idleMs) al consultarla, y un `setInterval` unref de 60 s barre todos los managers: una mesa atascada ya no depende de que otro grupo abra mesa del mismo juego. `isCurrent(session)` para que las resoluciones con animación comprueben que la mesa sigue siendo la misma antes de pagar.
- **src/lib/games/common.ts**: `noPrefixOnly(isActive)` (los contextos con plugins de patrón libre solo se activan para texto sin prefijo: `!s`, `!menu`, `!cerrarmesa` ya no se los traga una partida); `Cooldown` (espera por clave; corregido en esta ronda para que una clave sin registro devuelva 0 con cualquier reloj); `isCompact(ctx)`.
- **src/plugins/game-blackjack.ts**: `markDone` cierra la mano, limpia el temporizador y avanza el turno de forma síncrona antes de cualquier `await`; `currentPlayer` rechaza a quien ya terminó (`p.done`) y mensajes con argumentos; el temporizador de turno comprueba también `bj.current(groupId) === jid`; `pedir` solo rearma el temporizador (`armTurnTimer`) sin repetir el aviso "Turno de…" (un mensaje por carta en vez de dos).
- **src/plugins/game-roulette.ts**: `spin` comprueba `isCurrent` tras la animación: si un `cerrarmesa` reembolsó a mitad, anuncia que la mesa se cerró y no paga ni cierra la mesa nueva; `girar` exige 10 s de mesa abierta (`MIN_SPIN_WAIT_MS`) para que quien abre no corte a los demás al instante.
- **src/plugins/game-carrera.ts**, **game-dados.ts**: misma comprobación `isCurrent` tras la animación (carrera y duelo). `aceptar` de dados ignora mensajes con argumentos. Dados contra la casa responde en una línea en modo compacto.
- **src/plugins/game-ppt.ts**: al vencer la fase `eleccion`, si solo uno eligió gana por abandono (bote menos comisión); si nadie eligió, reembolso; el reembolso puro queda solo en fase `reto`. Contra el bot, el empate devuelve la apuesta menos la comisión del 5 % (`botPayout`, RTP 0,983 en vez de 1,00). Contexto partido en `ppt` (aceptar, con o sin prefijo) y `ppt-eleccion` (p/pa/t, solo sin prefijo). Modo compacto en la partida contra el bot.
- **src/plugins/game-adivina.ts**: el timeout en modo solo cuenta como derrota (antes reembolsaba: jugando solo los intentos ×5 y dejando expirar el resto el RTP era 1,12); `adivina grupo` paga con `creditPrize` y solo a registrados; `intentoPlugin` ignora mensajes con argumentos ("50 pesos"); contexto `noPrefixOnly`; cooldown con `Cooldown`.
- **src/plugins/game-ttt.ts**: `jugadaTttPlugin` ignora argumentos ("5 minutos y juego"); contexto partido en `ttt` (aceptar) y `ttt-jugada` (`noPrefixOnly`).
- **src/plugins/game-trivia.ts**: cooldown de 5 min por grupo entre trivias; la respuesta se evalúa y se paga antes del `react` (si la pregunta se cerraba durante el await se pagaba sin reflejarlo); `respuestaTriviaPlugin` ignora "a ver quién sabe" (argumentos); el bono de serie solo entre registrados y vía `creditPrize`; si `nextTriviaQuestion` lanza, la sesión se cierra y se avisa (antes quedaba viva bloqueando trivia y ahorcado); contexto `noPrefixOnly`.
- **src/plugins/game-ahorcado.ts**: la sesión se crea en fase `preparando` antes de pedir la palabra (así otro `ahorcado` o una `trivia` no se cuelan durante la llamada a la IA), con `Promise.race` contra 20 s de respaldo local; cooldown de 5 min por grupo (se marca al empezar de verdad); `letraPlugin` ignora mensajes con argumentos ("y tú?", "o sea"); arriesgar la palabra completa pasa a ser explícito con prefijo: `{p}ahorcado <palabra>` mientras hay partida (se elimina `palabraPlugin`, que contaba como fallo cualquier palabra suelta del mismo largo); premios vía `creditPrize`; contexto `noPrefixOnly` y solo en fase `jugando`.
- **src/plugins/game-memoria.ts**: nivel acotado a 10 (`nextLevel`, premio máximo 500), cooldown de 60 s por grupo entre rondas, premio vía `creditPrize`; el prefijo con el que se lanzó la ronda se guarda en el estado y se usa en la respuesta (antes salía siempre `/memoria`).
- **src/plugins/game-slot.ts**: respuesta de una línea en modo compacto.
- **src/plugins/game-casino.ts**: el listado indica el tope diario de premios de minijuegos.
- **src/lib/ai-games.ts**: `triviaCache` y `wordCache` son `LRUCache` de 20 temas (antes `Map` sin tope indexado por texto libre); `loadAI()` dentro del `try` para que un fallo del `import()` caiga al banco local.
- **src/lib/social.ts**: beso/abrazo responden en una línea en modo compacto.
- **src/plugins/fun-social.ts**: `frases … add` toma el texto de `m.text` (`textAfter`), así se conservan saltos de línea; los atajos `addpoka…clearctm` llaman a `runFrases` directamente en vez de hacer spread de `ctx` (el spread ejecutaba el getter perezoso `user` y creaba fichas fantasma).
- **tests**: `juegos-bets` (decimales, mitad sobre saldo, tope diario), `juegos-session` (caducidad en `get/has`, `isCurrent`), `juegos-mesas` (nuevo, con ctx falso y `mock.timers`: timeout de adivina sin reembolso, abandono y reembolso en ppt, `botPayout`, blackjack sin cartas tras plantarse, ruleta con `cerrarmesa` a mitad del giro, contextos que ignoran texto con prefijo y mensajes con argumentos, cooldown de ahorcado, tope de nivel de memoria).

Hallazgos no corregidos (con motivo):

- **adivina con 6 intentos y ×5/×2/×1,2 (≤2/≤4/≤6)** en lugar de los 7 intentos pedidos: se mantiene (ver Decisiones); con lo pedido la búsqueda binaria daba RTP 1,66. Quien integre decide si se acepta; `casino adivina` ya muestra las reglas reales.
- **Trivia cierra la pregunta 10 s después del primer acierto (`GRACE_MS`)** en vez de esperar los 30 s: se mantiene; evita esperar en vano y el resto sigue cobrando 100 si acierta en esos 10 s.
- **Conexión muerta tras reconectar / contextos ausentes en el handler nuevo**: no se puede resolver desde esta área. `MessageHandler.conn` es privado y `MessageHandlerInterface` no lo expone, así que `say()`/`edit()` no pueden leer la conexión del handler; `plugins/index.ts` y `src/index.ts` son del núcleo. Las dos llamadas necesarias están en "Para otros agentes" (punto 1 y 2); con ellas el hueco desaparece: los contextos existen desde `loadPlugins` y la conexión se actualiza en cada `open`.
- **Modo compacto en mesas** (omitir avisos intermedios de turno): se aplicó a los juegos de una sola respuesta (slot, dados, ppt contra el bot, beso, abrazo); en las mesas los avisos de turno son la mecánica del juego y no se omiten. Se redujo el ruido del blackjack (un mensaje por carta).

## Para otros agentes

### Agente núcleo — src/plugins/index.ts
1. Borrar los imports de `./game-slot.js`, `./game-blackjack.js`, `./game-roulette.js`, `./fun-amor.js`, `./fun-beso.js`, `./fun-social.js` (líneas 94-108) y sustituirlos por:
   ```ts
   import { registerCasino, registerMinijuegos } from './game-casino.js';
   import { registerAmor } from './fun-amor.js';
   import { registerBesos } from './fun-beso.js';
   import { registerSocial } from './fun-social.js';
   ```
2. Borrar el bloque `juegos` de `ENTRIES` (líneas 278-315, las 36 entradas `['game-...']`/`['fun-...']`) y en `SECTIONS` reemplazar `{ category: 'juegos', entries: ENTRIES.juegos }` por, en este orden y **antes** de `herramientas` (para que `dados` gane a `tools-random.ts`, ver punto 4):
   ```ts
   { category: 'casino', register: registerCasino },
   { category: 'minijuegos', register: registerMinijuegos },
   { category: 'social', register: registerAmor },
   { category: 'social-besos', register: registerBesos },
   { category: 'social-grupo', register: registerSocial },
   ```
   Cuando esto esté hecho, avisar para retirar los exports marcados `@deprecated` en game-blackjack.ts, game-roulette.ts y los atajos `addPokaPlugin…clearCtmPlugin` de fun-social.ts (o retirarlos directamente: ya no tendrán importadores).

### Agente núcleo — src/index.ts
- `import { restoreCasino } from './lib/games/bets.js';` y, en `main()`, justo después de `db = await initDatabase(CONFIG.databasePath);`: `restoreCasino(db);` (reembolsa custodia de mesas interrumpidas por un reinicio).
- `import { setActiveConnection } from './lib/games/session.js';` y en `connectBot()`, justo después de `const h = new MessageHandler(conn, db);` (línea ~128): `setActiveConnection(conn);`. **Importante**: `connectBot` crea un handler nuevo en cada reconexión y `teardownPrevious` cierra el socket viejo; sin esta llamada los temporizadores de las mesas vivas (reparto, giro, carrera) envían por el socket muerto hasta que alguien ejecuta un comando de juego, y sin el punto 1 (registerCasino en loadPlugins) el handler nuevo no tiene contextos y 'pedir', letras, números y 'aceptar' sin prefijo se ignoran hasta ese primer comando.

### Agente datos — src/types/database.ts
En `DatabaseSchema['settings']` añadir `casino?: CasinoState;` con `import type { CasinoState } from '../lib/games/state.js';`. Mientras no exista, `getCasino` escribe con `db.updateSettings({ casino } as never)`.

### Agente herramientas — src/plugins/tools-random.ts
`dadoPlugin` registra `'dados'` (línea 20), que colisiona con el juego `dados`. Quitar `'dados'` de ese array (quedan `dado`, `roll`, `tirar`) o aceptar que el casino se registre antes y lo sombree.

### Agente núcleo / menú — src/plugins/menu.ts
- Categoría `fun` (línea 175): `['amor', 'gay', 'beso', 'misbesos', 'topbesos', 'abrazo', 'kissall', 'gudmornin', 'poka', 'ctm', 'hazana', 'frases']` (quitar `slot`).
- Categoría `casino` (línea 181): `['casino', 'mesa', 'cerrarmesa', 'slot', 'bj', 'ruleta', 'dados', 'ppt', 'adivina', 'ttt', 'carrera', 'trivia', 'ahorcado', 'memoria']`.
- Línea 218 (admin): sustituir los 8 `addpoka…clearctm` por `'frases'`.
- `COMMANDS`: `slot` sin alias `casino`; `blackjack` → `bj` con usage `/bj <apuesta> | /bj mesa <apuesta>`; eliminar `jugar`, `pedir`, `plantarse`, `doblar`, `bjmesa` (ahora `mesa`), `apostar`, `girar` como entradas propias (siguen funcionando pero son acciones de contexto/atajos); `ruleta` usage `/ruleta <tipo> <apuesta>`; añadir `casino`, `mesa`, `cerrarmesa`, `dados`, `ppt`, `adivina`, `ttt`, `carrera`, `trivia`, `ahorcado`, `memoria`, `frases` (textos de uso en los `usage` de cada plugin).
- Línea 47: "/slot y /blackjack para apostar" → "/casino para ver los juegos".

### README / documentación
Cambios de comportamiento de esta ronda que deben verse en README/menú: arriesgar la palabra del ahorcado es `{p}ahorcado <palabra>` (con prefijo); `girar` en ruleta requiere 10 s de mesa abierta; en adivina solo dejar pasar 90 s sin intentar pierde la apuesta; en ppt quien no elige en 60 s pierde el duelo y el empate contra el bot descuenta 5 %; trivia y ahorcado una vez cada 5 min por grupo, memoria una ronda por minuto y nivel máximo 10; premios de minijuegos hasta 5 000 por persona y día.

Alias eliminados: `hit` (colisionaba con duelo), `vermesa` (usar `mesa`), `bet` (colisionaba con picks de betting), `ruletamesa`, `tirar`, `dd`, `pregunta` (trivia usa `trivia|quiz`; `pregunta` es de ai-chat), `casino` deja de ser alias de slot. Alias nuevos: `casino`, `mesa`, `cerrarmesa`, `casinostats`, `dados`, `ppt`, `adivina`, `ttt|gato`, `carrera`, `trivia|quiz`, `ahorcado`, `memoria`, `frases`. La tabla de README línea 16 debería listar los juegos nuevos.

## Decisiones

- **Alias cortos de blackjack**: no se usan `p/s/d` porque `p` es `poder` (duelo), `s` es sticker y `d`/`dd` se prestan a confusión; quedan `pedir|carta`, `plantarse|plantar|quedar|pasar|stand`, `doblar|double`. Dentro del contexto van sin prefijo igual.
- **Exports deprecados como atajos distintos** (`jugarPlugin`, `apostarPlugin`…) en vez de reasignar el mismo objeto: el handler nuevo avisa de cada alias duplicado al registrar y el mismo objeto bajo varios nombres habría llenado el log de colisiones.
- **Contextos enganchados perezosamente desde `enter(ctx)`**: mantiene funcional el no-prefijo con el `plugins/index.ts` actual sin tocarlo; `registerXxx` usa la misma función idempotente, así no hay doble registro cuando el núcleo migre.
- **Una mesa por juego y grupo** (no una mesa por grupo para todos los juegos): permite trivia + blackjack a la vez; `mesa` lista todas. Trivia y ahorcado sí se excluyen porque ambos consumen letras sueltas.
- **ppt: elección en grupo o por privado**. Solo por privado habría sido más justo pero exige tener abierto el chat con el bot; se admite en el grupo avisando que el rival lo verá (reacción con el emoji elegido). Alternativa descartada: borrar el mensaje de elección (requiere bot admin y no es fiable).
- **adivina con 6 intentos y ×5/×2/×1,2 por ≤2/≤4/≤6** en lugar de 7 intentos ×5/×2/×1,2 por ≤3/≤5/≤7: con búsqueda binaria lo pedido daba RTP 1,66 (siempre se acierta en ≤7); lo implementado da 0,97 óptimo y ~0,9 jugando normal (test `adivina óptima < 1`).
- **Duelo de dados sin comisión** (el bote se entrega íntegro) porque no se pidió; ppt sí cobra el 5 % indicado. Ambos usan `CASINO_LIMITS.duelFee` solo donde aplica.
- **Trivia reacciona igual (👀) a toda respuesta** y revela aciertos al cerrar: reaccionar ✅ al primero regalaba la respuesta al resto.
- **`releaseEscrow` resta reembolsos de `wagered`** para que `casinostats` mida solo dinero jugado.
- **`ai-games` importa `ai.ts` con `import()`**: evita cargar el registro completo de plugins en tests y al arrancar sin IA.
- **Nivel de memoria en memoria de proceso**, no en BD: es un contador de calentamiento, perderlo al reiniciar no afecta a nadie.
- **ñ se trata como n en el ahorcado** (`normalizeWord`), igual que las tildes; evita que una palabra con ñ sea imposible de adivinar desde teclados sin ella.
- **Tope diario de premios en vez de solo cooldowns**: los cooldowns por grupo limitan el ritmo, pero con varios grupos un mismo jugador podría seguir cobrando; el tope por persona (`creditPrize`) acota la creación de monedas independientemente de dónde juegue. Se aplica solo a premios sin apuesta; las apuestas del casino ya tienen margen de la casa.
- **Palabra completa del ahorcado con prefijo** (`ahorcado <palabra>`) en vez de palabra suelta sin prefijo: la alternativa (exigir que encaje con las letras reveladas) seguía contando "jaja"/"hola" al inicio de la partida, cuando no hay letras.
- **Contextos partidos en dos** (ttt, ppt) en lugar de un flag nuevo en `CommandContext`: `aceptar` debe funcionar con y sin prefijo, los patrones solo sin prefijo, y `CommandContext`/handler.ts son del núcleo.
- **Comprobar `isCurrent` tras la animación** en vez de dar un id de sesión a cada entrada de custodia: con la comprobación la mesa vieja nunca toca una custodia ajena, y no hace falta cambiar el formato persistido de `casino.escrow`.
- **Caducidad perezosa en `get()/has()` más barrido periódico**: la caducidad perezosa resuelve el caso "un solo grupo" sin depender de un intervalo; el intervalo cubre mesas que nadie vuelve a consultar.
- **ppt contra el bot con comisión en el empate** (y no 1,9× al ganar): el enunciado pide 1:1 y la comisión reutiliza `duelFee`; margen resultante 1,7 %.
- **Timeout de adivina solo = derrota** (no "se planta" con reembolso parcial): cualquier reembolso parcial deja un camino con RTP > 1 si es mayor que la pérdida esperada de los intentos restantes.

## Pendiente

- `npm test` falla solo en `tests/integracion-registry.test.ts` por colisiones de alias de `rpg-duelo`/`rpg-dungeon` (área RPG); ningún archivo ni alias del área de juegos está implicado.
- Los juegos nuevos (dados, ppt, adivina, ttt, carrera, trivia, ahorcado, memoria, casino, mesa) no están cargados hasta que `plugins/index.ts` llame a `registerCasino`/`registerMinijuegos` (punto 1 de "Para otros agentes"). Slot, blackjack, ruleta y los sociales sí funcionan con el registro actual vía los exports deprecados.
- Tras una reconexión, hasta que el núcleo aplique los puntos 1 y 2 de "src/index.ts", las acciones sin prefijo y los mensajes de temporizadores dependen de que alguien ejecute antes un comando de juego con prefijo.
- `types/database.ts` aún no declara `casino` (agente datos); el estado (incluido `prizes`) se guarda igual.
- `menu.ts` y README listan comandos que ya no existen como entradas propias (`jugar`, `bjmesa`, `apostar`, `addpoka`…) hasta que el agente de menú los actualice.
- El contexto `ahorcado` compite con el `duelo` de rpg por palabras sueltas como `golpe` solo si el duelo se implementa como contexto registrado después; tras esta ronda el ahorcado solo consume letras sueltas sin argumentos, así que la colisión queda reducida a mensajes de una letra.
