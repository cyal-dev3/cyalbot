# Auditoría del repositorio (noviembre 2026)

Estado de partida: último commit en abril de 2026, unas 34 000 líneas de TypeScript, compila sin errores, sin README, sin pruebas, sin CI. El bot funcionaba en un servidor concreto y todo lo que dependía de ese servidor estaba escrito a fuego en el código.

Este documento recoge lo que se encontró, lo que se corrigió en esta pasada y lo que queda pendiente. Los apartados marcados con **Hecho** ya están en el código.

## 1. Seguridad y privacidad

| # | Hallazgo | Riesgo | Estado |
|---|---|---|---|
| 1.1 | `src/lidsresolve.json` versionado con números de teléfono y LIDs reales de usuarios. Ningún código lo leía. | Fuga de datos personales en un repo público | **Hecho**: eliminado del repo y añadido a `.gitignore` |
| 1.2 | Números de teléfono de los dueños como valor por defecto en `config.ts`. Cualquiera que clonara el repo arrancaba con esos owners. | Exposición de datos y permisos de owner a terceros | **Hecho**: `BOT_OWNERS` obligatorio por entorno, sin default |
| 1.3 | Comprobación de owner por subcadena: `senderNum.includes(owner) \|\| owner.includes(senderNum)`. Un número que contuviera al del owner, o un LID corto contenido en él, pasaba como owner. | Escalada de privilegios | **Hecho**: comparación exacta tras normalizar (`isOwnerId`), con pruebas |
| 1.4 | `/gitpull` ejecutaba `cd /home/dev3/cyalbot/ && sudo -u dev3 git pull` con `exec` (shell). Ruta y usuario del servidor en el código, y `sudo`. | No portable; `sudo` innecesario | **Hecho**: `execFile('git', ['pull', '--ff-only'])` en `process.cwd()` |
| 1.5 | `ecosystem.config.cjs` con `cwd: '/home/dev3/cyalbot/CYALTRONIC'` y arrancando con `npx tsx` en producción. | No arranca en otra máquina; compila TS en cada reinicio | **Hecho**: `cwd: __dirname`, `script: dist/index.js` |
| 1.6 | 14 vulnerabilidades en dependencias (`ws` alta, `undici` crítica). | DoS, fuga de cabeceras | **Hecho**: `npm audit fix` las resolvió salvo `protobufjs` 6.8.8, pin exacto dentro de `libsignal` (dependencia de Baileys). Forzar la versión podría romper el cifrado; se deja para cuando Baileys actualice |
| 1.7 | `/bug` y `/feat` permiten a cualquier usuario crear issues en GitHub con el token del bot. Tienen mínimo de caracteres pero no límite de frecuencia. | Spam de issues | Pendiente: añadir cooldown por usuario (ver roadmap) |
| 1.8 | `antibad` hacía `textLower.includes(word)` como respaldo del regex de palabra completa, así que "computadora" disparaba por "puta" y "vínculo" por "culo". | Borrado de mensajes legítimos y avisos falsos | **Hecho**: `lib/moderation.ts` con tokenización Unicode e insensible a acentos, con pruebas |
| 1.9 | Repositorio y owner de GitHub fijos en `tools-github.ts`. | No reutilizable | **Hecho**: `GITHUB_REPO` por entorno |

## 2. Reutilización y operación

| # | Hallazgo | Estado |
|---|---|---|
| 2.1 | Sin README ni documentación de variables de entorno. Había 8 variables leídas en distintos archivos sin lista. | **Hecho**: `README.md` y `.env.example` comentado |
| 2.2 | La API de descargas "dev3-downloader" en `localhost:3002` se asumía presente; sin ella, cada descarga empezaba con una petición fallida a localhost. | **Hecho**: `DOWNLOADER_API_URL` opcional; si está vacío se salta |
| 2.3 | Sin pruebas, sin lint, sin CI. | **Hecho**: `node:test` con 15 pruebas (moderación, owner, utilidades, parser), workflow de GitHub Actions con typecheck + test + build |
| 2.4 | Sin Dockerfile. | **Hecho**: imagen multi-stage con ffmpeg y volumen para sesión y base de datos |
| 2.5 | `engines.node >= 18`, pero Baileys y el SDK de Anthropic requieren 20+. | **Hecho**: `>= 20` |
| 2.6 | `package.json` con nombre y descripción desactualizados, sin scripts de test ni typecheck. | **Hecho** |

## 3. Calidad del código y "olor a generado"

Lo que hacía que el proyecto se sintiera generado por plantilla:

- Banner ASCII de 15 líneas y una lista de comandos impresa en consola en cada arranque.
- Un emoji al inicio del comentario de cabecera de los 90 archivos, y el sufijo "- CYALTRONIC" en cada uno.
- `plugins/index.ts`: 450 líneas de `handler.registerPlugin(...)` uno por uno, con `console.log('      ✅ ...')` después de cada bloque, y un `totalPlugins` sumado a mano (`5 + 3 + 21 + 8 + ...`) con comentarios que ya no coincidían con lo registrado.
- Logs con emoji en cada línea y `console.log` directo en 90 archivos, sin niveles.
- `getPluginsInfo()` devolvía solo los 7 plugins básicos aunque su nombre sugiriera otra cosa.

Cambios:

- **Hecho**: `index.ts` reescrito. Arranque en una línea de log, anti-delete y eventos de grupo extraídos a `lib/anti-delete.ts` y `lib/group-events.ts`.
- **Hecho**: `main.ts` reescrito con el mismo flujo de autenticación pero sin cuadros decorativos.
- **Hecho**: `plugins/index.ts` pasa a una tabla de secciones ordenadas. El total se calcula del registro real (207 plugins, 708 alias). Se verificó alias por alias que los 23 comandos duplicados (`usar`, `ranking`, `stats`, `pin`, `remove`, `notificar`, `reclamar`...) los resuelve el mismo plugin que antes.
- **Hecho**: `lib/logger.ts` con niveles (`LOG_LEVEL`) y hora. Lo usan el núcleo y los módulos nuevos; los 90 plugins siguen con `console.log` en sus mensajes internos para no tocar lógica de juego en esta pasada.
- **Hecho**: cabeceras de archivo limpias (81 archivos).
- Se dejaron los emojis en los **mensajes que ve el usuario en WhatsApp**: ahí son normales y la gente los espera.

## 4. Bugs y comportamiento

| # | Hallazgo | Estado |
|---|---|---|
| 4.1 | `db.getUser(m.sender)` se llamaba en cada mensaje recibido, antes de saber si era comando. Cada persona que escribía en cualquier grupo quedaba creada en `database.json` con el objeto completo del RPG (unos 60 campos). En grupos grandes el JSON crece sin uso real. | **Hecho**: solo se crea al ejecutar un comando o al consultarlo |
| 4.2 | `uncaughtException` solo hace log y sigue. Con pm2/Docker es aceptable, pero un error en un `setInterval` puede dejar estado a medias. | Sin cambios; documentado |
| 4.3 | La base de datos escribía el JSON completo cada 30 s si hubo cambios; con miles de usuarios cada escritura eran varios MB. | **Hecho** (nov. 2026): SQLite con `better-sqlite3`. Solo se escriben las filas que cambiaron; el JSON antiguo se importa una vez |
| 4.4 | Los descargadores (1150 líneas) raspan sitios de terceros (snaptik, ssstik, snapinsta, savetwitter...). Se rompen a menudo y no hay forma de saber cuál falla sin leer logs. | Sin cambios de fondo. Recomendación: usar `DOWNLOADER_API_URL` con un Cobalt propio y tratar los scrapers como respaldo |
| 4.5 | `tags` vs `category`, `help` vs `description`: dos convenciones mezcladas en los plugins. El menú (`menu.ts`, 199 comandos a mano) no se generaba de los plugins. | **Hecho**: `/menu` se genera del registro (`listCommands`), con alias sombreados ocultos y comandos más usados según `stats` |
| 4.6 | Baileys 6.7 (rama legacy). La 7.0 lleva un año en release candidate con cambios incompatibles. | Sin cambios: 6.7.24 es la última estable. Revisar al salir 7.0 final |

## 5. Comparación con otros bots

Se revisaron proyectos de la misma familia (Baileys, TypeScript):

- **botmesh** (framework con paquete `@botmesh/ai`): soporta Anthropic, OpenAI, Ollama y Gemini, auto-respuestas, tool calling, memoria por usuario y RAG. Es prerelease.
- **zaileys**: librería sobre Baileys con soporte para WhatsApp Web y Cloud API, y un scaffold que deja elegir proveedor de IA.
- **Chisato-WhatsApp**: bot generalista en TypeScript, buena referencia de estructura; licencia AGPL.
- **liqueur**: framework de comandos para Baileys inspirado en Sapphire (decoradores, precondiciones, cooldowns declarativos).

Lo que esos proyectos tienen y este no tenía, y qué se hizo:

| Capacidad | Ellos | Aquí |
|---|---|---|
| Chat con IA, memoria por chat | Sí | **Hecho**: `lib/ai.ts` con Claude, memoria de 20 turnos con TTL, menciones y privado |
| Tool calling desde la IA | botmesh | **Hecho**: `consultar_clima` y `perfil_rpg`; patrón listo para añadir más |
| Límites de gasto | Parcial | **Hecho**: por usuario/hora y presupuesto diario de tokens, persistido |
| Visión (imágenes) | Algunos | **Hecho**: imagen adjunta o citada |
| Configuración por entorno con ejemplo | Sí | **Hecho** |
| Docker | Sí | **Hecho** |
| Tests y CI | Sí | **Hecho** (base; la cobertura es baja) |
| Cooldowns declarativos en plugins | liqueur | Pendiente: cada plugin calcula el suyo con `checkCooldown` |
| Carga automática de plugins por carpeta | Varios | Pendiente; se optó por tabla explícita porque el orden de registro decide alias duplicados |
| Soporte Cloud API oficial | zaileys, botmesh | Fuera de alcance: cambia el modelo (sin grupos como hoy, sin stickers de terceros) |

Fuentes consultadas: [botmesh](https://github.com/andresayac/botmesh/wiki), [zaileys](https://www.claudepluginhub.com/skills/zeative-zaileys-official-plugins-zaileys-official/zaileys-scaffold), [Chisato-WhatsApp](https://github.com/Nobi-2/Chisato-WhatsApp), [comparativa de librerías 2026](https://whatsapp.checkleaked.cc/es/blog/best-open-source-whatsapp-libraries).

## 6. Integración con Claude: decisiones

- SDK oficial `@anthropic-ai/sdk` 1.5. Modelo por defecto `claude-opus-5-5`, configurable.
- Pensamiento adaptativo (el de serie en este modelo) con `effort: low` para charla. Para WhatsApp la latencia importa más que el razonamiento profundo.
- `max_tokens` 1024: respuestas cortas a propósito. Si se corta, el bot lo dice.
- System prompt en dos bloques: el estable (identidad, reglas de estilo para WhatsApp, catálogo de 200 comandos) con `cache_control`, y el volátil (fecha, chat, quién escribe) después. Así la parte grande se cobra como caché a partir de la segunda petición.
- `fallbacks: "default"` con la beta `server-side-fallback-2026-07-01`: si el modelo declina por política, el servidor reintenta con su modelo de respaldo. Si el modelo elegido no lo soporta, la petición corre igual con ese modelo.
- Herramientas con `strict: true`. Bucle manual de hasta 4 rondas. Se guarda el `content` completo del asistente en el historial para que los `tool_use`/`tool_result` queden emparejados.
- En grupos, cada turno de usuario se prefija con `[Nombre]:` para que el modelo sepa quién habla en una conversación compartida.
- Errores con las clases tipadas del SDK: autenticación, rate limit, 400 y resto se reportan distinto al usuario y al log.
- No se pudo probar contra la API real en esta sesión (sin API key en el entorno). Se verificó compilación y tipos; la primera prueba en vivo debería ser `/ia hola` y `/iastats`.

## 7. Contenido a revisar por el dueño

**Retirados en noviembre de 2026 por decisión del dueño** (el código de la economía de esclavos y de la bomba sigue en `rpg-economia.ts` y `rpg-bombardear.ts` sin registrar, por si se quiere recuperar; `/gay`, `/kissall`, `/chingatumadre` y las frases `ctm` se borraron):

- `/esclavizar`, `/esclavos`, `/liberar` (economía RPG).
- `/chingatumadre` y la lista `ctm`, `/gay` (fun).
- `/kissall`, `/bombardear`.

Nota: `escudo_antibombas` sigue en la tienda aunque ya no haya bombas; `/pagardeuda` y `/deuda` (IMSS) se conservan porque los usan atacar, duelo y dungeon.

## 8. Roadmap sugerido

Orden de valor por esfuerzo:

1. **Probar la IA en vivo** con una API key, ajustar `AI_PERSONA` y los límites, y mirar `/iastats` tras un día de uso real.
2. ~~Generar `/menu` desde el registro~~ Hecho.
3. ~~Cooldown en `/bug` y `/feat`~~ Hecho (3 por usuario y hora, cupo global diario).
4. **Más herramientas para la IA** que usen lo que el bot ya sabe: `tienda`, `ranking`; `clima`, `hora`, `wiki` y `perfil_rpg` ya existen. Cada herramienta son 15 líneas en `lib/ai.ts`.
5. **Transcripción de notas de voz** con `/ia` sobre un audio (Whisper local o servicio).
6. ~~Migrar `console.log` de plugins al logger~~ Hecho (solo `main.ts` imprime directo, para el QR y el código de vinculación).
7. ~~SQLite~~ Hecho.
8. **Scrapers**: ya existe el servicio propio `downloader/` (yt-dlp); los scrapers de `downloaders.ts` quedan como respaldo.
9. **Baileys 7** cuando salga la versión final.
10. **Torneo RPG** (`rpg-torneo.ts`): inscripción, emparejamientos con `simulateFight`, pot al campeón. Diseñado en `docs/dev/handoff-rpg-combate.md`, no implementado.
11. **`protobufjs` 6.8.8** dentro de `libsignal` (Baileys): sin arreglo hasta que Baileys actualice.

## 9. Resumen de archivos

Nuevos: `README.md`, `.env.example`, `Dockerfile`, `.dockerignore`, `.editorconfig`, `.github/workflows/ci.yml`, `src/lib/ai.ts`, `src/lib/logger.ts`, `src/lib/moderation.ts`, `src/lib/anti-delete.ts`, `src/lib/group-events.ts`, `src/plugins/ai-chat.ts`, `tests/*.test.ts`, este documento.

Reescritos: `src/index.ts`, `src/main.ts`, `src/config.ts`, `src/plugins/index.ts`, `src/plugins/admin-restart.ts`, `ecosystem.config.cjs`.

Modificados: `src/handler.ts` (owner, antibad, usuario perezoso, enganche de IA, logger), `src/types/database.ts` (`aiChat`, `aiUsage`), `src/plugins/menu.ts` (categoría IA), `src/plugins/tools-github.ts`, `src/plugins/tools-clima.ts`, `src/lib/downloaders.ts`, `package.json`, `.gitignore`, y cabeceras de 81 archivos.

Eliminado: `src/lidsresolve.json`.

## 10. Segunda pasada (noviembre de 2026): integración y despliegue

Tras la ronda de agentes por áreas (ver `docs/dev/handoff-*.md`) quedaba la integración final. Lo que se hizo:

- `plugins/index.ts` registra todo: casino y minijuegos (con sus contextos sin prefijo), social, 13 herramientas nuevas, `admin-bridge`, RPG de progresión (pescar, cazar, explorar, eventos) y el área de combate completa vía `registerCombatContexts` (duelo, dungeon, forja, jefe mundial, owner). Cero colisiones de alias; `tests/integracion-registry.test.ts` lo exige.
- `index.ts`: `restoreCasino` al arrancar (devuelve apuestas en custodia tras un reinicio), `stopDungeonCleanup` y `stopCalcWorker` al apagar. `/bot on|off` vuelve a ser el interruptor del grupo; la IA responde a `ia`, `ai`, `claude`, `pregunta`.
- Base de datos en SQLite (punto 4.3). `DATABASE_PATH` por defecto `database.sqlite`; un `.json` antiguo se importa solo.
- `/calc`: tope de 250 000 elementos en matrices y rangos. Una matriz de 4000x4000 agotaba el heap del hilo en una sola asignación y V8 abortaba el proceso entero, no solo el worker.
- `stickerToVideo` usa `-fps_mode` (ffmpeg 8+ eliminó `-vsync`) con respaldo para ffmpeg 4.4.
- `ChatSettings` tipa `enabled`, `antiLinkMode`, `maxWarnings`, `mutedUntil`, `adminAlerts` (antes se leían con casts en seis archivos).
- El log de mensajes entrantes solo pide el nombre del grupo si `LOG_LEVEL=debug`. `recordError` ya no duplica la línea en `/logs`.
- Comandos retirados: ver sección 7.

Estado: `npm run typecheck`, `npm test` (387 pruebas) y `npm run build` pasan. Pendiente de probar en vivo: la IA con API key real, el puente de Telegram y la primera arrancada con un `database.json` de producción (hacer copia antes).
