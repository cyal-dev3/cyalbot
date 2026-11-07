# Cyalbot

Bot de WhatsApp escrito en TypeScript sobre [Baileys](https://github.com/WhiskeySockets/Baileys). Nació como un RPG de grupo y fue creciendo: moderación, descargas de redes sociales, stickers, juegos de casino con moneda virtual, seguimiento de tipsters y, desde esta versión, conversación con Claude.

No usa la API oficial de WhatsApp Business: se vincula como un dispositivo más desde "Dispositivos vinculados". Eso significa que corre con un número normal, y también que Meta puede banear el número si el bot hace spam. Úsalo en grupos donde la gente lo quiera.

## Qué hace

| Área | Ejemplos |
|---|---|
| IA (Claude) | Responde si lo mencionas o le escribes en privado, `/ia <pregunta>`, `/resumen` de los últimos mensajes del grupo, describe fotos, recuerda el hilo de la conversación |
| Grupos | antilink, antispam, antipalabras, anti-delete, warns con expulsión automática, mute, bienvenidas, `/tagall`, abrir/cerrar grupo, limpieza de mensajes del bot |
| Descargas | TikTok, Instagram, Facebook, Twitter/X, Pinterest, Threads, YouTube (`/dl <url>` o autodescarga al pegar un enlace) |
| Stickers | `/s` sobre una imagen o video, `/toimg`, `/tovideo`, autosticker por grupo |
| RPG | registro, niveles, trabajo, minería, pesca, caza, exploración, duelos, dungeons por turnos, jefe mundial, clases, forja, inventario, tienda, banco, misiones, mascotas, gremios, rankings, eventos globales |
| Casino y minijuegos | slots, blackjack, ruleta, dados, piedra-papel-tijera, adivina el número, gato, carrera con las monedas del RPG; trivia, ahorcado y memoria con premios (`/casino`) |
| Herramientas | `/clima`, `/hora`, `/wiki`, `/calc`, `/translate`, `/tts`, `/qr`, `/encuesta`, `/nota`, `/recordar`, `/cumple`, `/id`, reporte de bugs a GitHub |
| Betting | registro de picks de tipsters, verde/roja, estadísticas, puente opcional desde grupos de Telegram |

`/menu` dentro de WhatsApp lista todo por categorías.

## Requisitos

- Node.js 20 o superior
- `ffmpeg` en el PATH (stickers animados, conversión de video)
- Un número de WhatsApp para el bot (puede ser el tuyo, pero conviene uno aparte)
- Opcional: una API key de Anthropic para la parte de IA

## Puesta en marcha

```bash
git clone https://github.com/cyal-dev3/cyalbot.git
cd cyalbot
npm install
cp .env.example .env
```

Edita `.env`. Lo mínimo es `BOT_OWNERS` con tu número (código de país incluido, solo dígitos). Para la IA añade `ANTHROPIC_API_KEY`.

```bash
npm run dev
```

La primera vez pregunta si quieres vincular por QR o por código de 8 dígitos. Las credenciales quedan en `CyaltronicSession/` y no vuelve a preguntar. Si prefieres no responder prompts:

```bash
npm run build
npm run qr                                   # muestra el QR
node dist/index.js --method=code --phone=5213312345678   # código de emparejamiento
```

### Producción con pm2

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

Desde WhatsApp, el owner puede usar `/restart`, `/gitpull` y `/logs`.

### Producción en un servidor (recomendado)

`docker-compose.prod.yml` es la versión endurecida: sin puertos publicados, contenedores sin capacidades ni escalada de privilegios, raíz de solo lectura, límites de memoria y CPU. El `.env` y la carpeta `data/` (sesión de WhatsApp y SQLite) viven fuera del árbol de fuentes. `deploy/deploy.sh [host]` sube el commit actual por SSH con `git archive`, construye las imágenes en el servidor y levanta los servicios; no hace falta Node ni acceso a GitHub allí. La primera vez, deja en el `.env` del servidor `PAIRING_ARGS=--method=code --phone=<número del bot>` y lee el código de vinculación en los logs.

### Producción con Docker

```bash
docker build -t cyalbot .
docker run -it --env-file .env -v $(pwd)/data:/app/data cyalbot
```

La sesión y la base de datos quedan en `./data`. La primera vez corre con `-it` para ver el QR; después puedes usar `-d`.

## Configuración

Todo se controla por variables de entorno. Las importantes:

| Variable | Para qué |
|---|---|
| `BOT_OWNERS` | Números con permisos de owner, separados por coma. Sin esto nadie puede usar `/restart`, `/mode`, `/rpgdar`, etc. |
| `BOT_NAME` | Nombre del bot en menús y stickers |
| `BOT_PREFIX` | Caracteres aceptados como prefijo. Por defecto `!/.` |
| `ANTHROPIC_API_KEY` | Activa la IA. Sin ella el resto del bot funciona igual |
| `CLAUDE_MODEL` | Modelo a usar. Por defecto `claude-opus-5-5` |
| `AI_PRIVATE_CHAT` | Si la IA responde a cualquier mensaje en privado (por defecto sí) |
| `AI_REPLY_TO_MENTIONS` | Si responde en grupos al mencionarla o citarla (por defecto sí; los admins pueden apagarlo por grupo con `/iachat off`) |
| `AI_USER_HOURLY_LIMIT` | Preguntas por usuario por hora |
| `AI_DAILY_TOKEN_BUDGET` | Tope diario de tokens para no llevarte sorpresas en la factura |
| `AI_PERSONA` | Texto libre que se suma a la personalidad del bot |
| `DOWNLOADER_API_URL` | URL de una instancia de dev3-downloader (Cobalt + yt-dlp). Si no la tienes, se usan scrapers públicos, menos fiables |
| `GITHUB_TOKEN`, `GITHUB_REPO` | Para que `/bug` y `/feat` abran issues |
| `TELEGRAM_*`, `WHATSAPP_GROUP_ID` | Puente de Telegram a WhatsApp para picks de tipsters |

La lista completa con comentarios está en [`.env.example`](.env.example).

## Cómo funciona la IA

- En **privado**, cualquier mensaje sin prefijo va a Claude. En **grupos**, solo cuando mencionan al bot o responden a uno de sus mensajes, o con `/ia`.
- Recuerda los últimos 20 turnos de cada chat durante dos horas de inactividad. `/ia reset` lo olvida.
- Si la pregunta es sobre el clima o sobre el personaje RPG de quien escribe, Claude consulta esos datos reales del bot con herramientas en vez de inventarlos.
- Conoce el catálogo de comandos: si alguien le pide un sticker, le dirá que use `/s` en vez de intentarlo él.
- Si adjuntas o citas una imagen, la ve.
- Límites: por usuario por hora y presupuesto diario global. Los owners no tienen límite. `/iastats` muestra el consumo del día, con cuántos tokens vinieron del caché de prompt.
- El system prompt estable va con `cache_control` para que la parte larga (catálogo de comandos) se cobre al precio de caché. El razonamiento va en esfuerzo `low`, que para charla sobra; cámbialo con `AI_EFFORT`.
- Si Claude declina una petición por política, el servidor reintenta con su cadena de respaldo (`fallbacks: "default"`).

## Estructura

```
src/
  index.ts          arranque, reconexión, eventos de Baileys
  main.ts           autenticación (QR / código) y creación del socket
  handler.ts        serializa mensajes, protección de grupos, despacho de comandos
  config.ts         configuración por variables de entorno
  lib/
    ai.ts           integración con Claude (memoria, límites, herramientas, resumen)
    database.ts     SQLite (better-sqlite3) con migraciones de usuarios
    moderation.ts   detección de palabras prohibidas
    anti-delete.ts  reenvío de mensajes borrados
    group-events.ts bienvenidas, despedidas, cambios de admin
    downloaders.ts  descargas con varias fuentes de respaldo
    logger.ts       logs con nivel y hora
  plugins/
    index.ts        tabla de registro (orden importa cuando hay alias repetidos)
    *.ts            un archivo por área de comandos
tests/              pruebas unitarias (node:test)
```

### Crear un comando

```ts
// src/plugins/hola.ts
import type { PluginHandler } from '../types/message.js';

export const holaPlugin: PluginHandler = {
  command: ['hola', 'hi'],
  help: ['hola - Saluda'],
  group: false,     // true = solo grupos
  admin: false,     // true = solo admins del grupo
  owner: false,     // true = solo BOT_OWNERS
  register: false,  // true = requiere personaje RPG
  handler: async ({ m, args }) => {
    await m.reply(`Hola, ${m.pushName || 'tú'}.`);
  },
};
```

Luego impórtalo en `src/plugins/index.ts` y añádelo a la sección que corresponda. `/menu` se genera del registro: con `description`, `usage` y `category` el comando aparece solo. El test de integración falla si un alias ya lo usa otro plugin.

## Scripts

```bash
npm run dev         # arranca con recarga automática
npm run build       # compila a dist/
npm start           # arranca desde dist/
npm run typecheck   # solo tipos
npm test            # pruebas unitarias
```

## Avisos

- Los descargadores dependen de sitios de terceros que cambian sin aviso. Cuando uno deja de funcionar, se prueba el siguiente. Para algo estable monta un dev3-downloader propio.
- La base de datos es un archivo SQLite (`DATABASE_PATH`, por defecto `database.sqlite`). Si vienes de una versión anterior con `database.json`, se importa solo en el primer arranque y el JSON queda renombrado a `.migrated`. Haz copia de la carpeta antes de actualizar.
- El puente de Telegram usa una cuenta de usuario (GramJS), no un bot de Telegram. Lee los términos de Telegram antes de usarlo.

## Licencia

MIT.
