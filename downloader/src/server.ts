import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { loadConfig, type Config } from './config.js';
import { DownloadError, toDownloadError } from './errors.js';
import { FileStore } from './files.js';
import { log, setLogLevel } from './logger.js';
import { Queue } from './queue.js';
import {
  handleDownload,
  handleFiles,
  handleHealth,
  handleInfo,
  handleSearch,
  sendError,
  sendJson,
  type AppContext,
  type RequestContext,
} from './routes.js';

const MAX_BODY_BYTES = 64 * 1024;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new DownloadError('TOO_LARGE', `El body supera ${MAX_BODY_BYTES / 1024} KB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (total === 0) {
        reject(new DownloadError('BAD_REQUEST', 'Falta el body JSON'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new DownloadError('BAD_REQUEST', 'El body no es JSON valido'));
      }
    });
    req.on('error', (err) => reject(toDownloadError(err)));
  });
}

function checkApiKey(config: Config, req: IncomingMessage): void {
  if (!config.apiKey) return;
  const header = req.headers['x-api-key'];
  const provided = Array.isArray(header) ? header[0] : header;
  if (provided !== config.apiKey) throw new DownloadError('UNAUTHORIZED', 'Cabecera x-api-key invalida o ausente');
}

async function route(app: AppContext, req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<number> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  if (pathname === '/health' && (method === 'GET' || method === 'HEAD')) {
    return sendJson(res, 200, await handleHealth(app));
  }
  if (pathname.startsWith('/files/')) {
    if (method !== 'GET' && method !== 'HEAD') throw new DownloadError('BAD_REQUEST', 'Metodo no permitido');
    const status = handleFiles(app, req, res, pathname);
    if (status !== null) return status;
    throw new DownloadError('NOT_FOUND', 'Ruta no encontrada');
  }

  checkApiKey(app.config, req);

  if (pathname === '/v1/download' && method === 'POST') {
    const body = await readJsonBody(req);
    const result = await handleDownload(app, body, ctx);
    return sendJson(res, 200, {
      success: true,
      data: result.data,
      meta: { engine: result.engine, requestId: ctx.requestId, durationMs: Date.now() - ctx.startedAt, cached: result.cached },
    });
  }
  if (pathname === '/v1/info' && method === 'POST') {
    const body = await readJsonBody(req);
    const data = await handleInfo(app, body);
    return sendJson(res, 200, { success: true, data, meta: { engine: 'yt-dlp', requestId: ctx.requestId, durationMs: Date.now() - ctx.startedAt } });
  }
  if (pathname === '/v1/search' && method === 'GET') {
    const data = await handleSearch(app, url.searchParams);
    return sendJson(res, 200, { success: true, data, meta: { engine: 'yt-dlp', requestId: ctx.requestId, durationMs: Date.now() - ctx.startedAt } });
  }
  if (['/v1/download', '/v1/info', '/v1/search'].includes(pathname)) {
    throw new DownloadError('BAD_REQUEST', 'Metodo no permitido');
  }
  throw new DownloadError('NOT_FOUND', 'Ruta no encontrada');
}

export interface App {
  server: Server;
  context: AppContext;
  close: () => Promise<void>;
}

/** Crea la aplicacion sin escuchar todavia. `listen` arranca en el puerto/host indicados (0 = aleatorio). */
export async function createApp(config: Config): Promise<App> {
  setLogLevel(config.logLevel);
  const store = new FileStore(config.downloadDir, config.fileTtlMs, config.cacheTtlMs);
  await store.init();
  store.startCleanup();
  const context: AppContext = { config, store, queue: new Queue(config.maxConcurrent, config.queueMax), startedAt: Date.now() };

  const server = createServer((req, res) => {
    const ctx: RequestContext = { requestId: randomBytes(6).toString('hex'), startedAt: Date.now() };
    res.setHeader('X-Request-Id', ctx.requestId);
    route(context, req, res, ctx)
      .catch((err: unknown) => {
        const mapped = toDownloadError(err);
        if (mapped.code === 'INTERNAL') log.error('Error interno', { requestId: ctx.requestId, error: mapped.message });
        if (res.headersSent) {
          res.destroy();
          return mapped.status;
        }
        return sendError(res, mapped, ctx);
      })
      .then((status) => {
        log.info('request', {
          method: req.method,
          path: (req.url ?? '/').split('?')[0],
          status,
          ms: Date.now() - ctx.startedAt,
          requestId: ctx.requestId,
        });
      });
  });
  // Las descargas pueden tardar; se evita que Node cierre el socket antes de responder.
  server.requestTimeout = config.downloadTimeoutMs + 30_000;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 10_000;

  const close = () =>
    new Promise<void>((resolve) => {
      store.stopCleanup();
      server.closeIdleConnections();
      server.close(() => resolve());
      setTimeout(() => {
        server.closeAllConnections();
        resolve();
      }, 5000).unref();
    });

  return { server, context, close };
}

export function listen(app: App, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, host, () => {
      const address = app.server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  const port = await listen(app, config.port, config.host);
  log.info('cyalbot-downloader escuchando', {
    host: config.host,
    port,
    publicUrl: config.publicUrl,
    version: config.version,
    downloadDir: config.downloadDir,
    apiKey: config.apiKey ? 'si' : 'no',
  });
  const shutdown = (signal: string) => {
    log.info('Apagando', { signal });
    app.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const isMain = process.argv[1] && /server\.(?:ts|js)$/.test(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    log.error('No se pudo arrancar', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
