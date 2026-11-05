import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createApp, listen, type App } from '../src/server.js';

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

function canRun(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 15_000 }, (err) => resolve(!err));
  });
}

async function hasNetwork(): Promise<boolean> {
  try {
    const res = await fetch('https://www.youtube.com/robots.txt', { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    // Sin proxy configurado para fetch puede fallar aunque yt-dlp si tenga salida; se comprueba con yt-dlp.
    return canRun(YTDLP, ['--no-warnings', '--flat-playlist', '--playlist-items', '1', '-J', 'ytsearch1:test']);
  }
}

const ytdlpOk = await canRun(YTDLP, ['--version']);
const networkOk = ytdlpOk ? await hasNetwork() : false;
const skipReason = !ytdlpOk ? `yt-dlp no disponible (${YTDLP})` : !networkOk ? 'sin red' : undefined;

describe('integracion con yt-dlp real', { skip: skipReason }, () => {
  let app: App;
  let base: string;
  let tmp: string;

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'dl-int-'));
    app = await createApp(
      loadConfig({ PORT: '0', HOST: '127.0.0.1', DOWNLOAD_DIR: tmp, YTDLP_PATH: YTDLP, LOG_LEVEL: 'error', DOWNLOAD_TIMEOUT_MS: '90000' }),
    );
    base = `http://127.0.0.1:${await listen(app, 0, '127.0.0.1')}`;
  });

  after(async () => {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('/health reporta la version de yt-dlp', async () => {
    const body = (await (await fetch(`${base}/health`)).json()) as { ytdlp: string | null };
    assert.match(body.ytdlp ?? '', /^\d{4}\.\d{2}\.\d{2}/);
  });

  it('/v1/search devuelve resultados de YouTube', { timeout: 60_000 }, async () => {
    const res = await fetch(`${base}/v1/search?q=lofi&limit=3`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; data: { results: { id: string; title: string; url: string }[] } };
    assert.equal(body.success, true);
    assert.ok(body.data.results.length >= 1 && body.data.results.length <= 3);
    assert.match(body.data.results[0].url, /youtube\.com\/watch\?v=/);
    assert.equal(typeof body.data.results[0].title, 'string');
  });

  it('/v1/info devuelve metadata sin descargar', { timeout: 60_000 }, async () => {
    const res = await fetch(`${base}/v1/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    });
    const body = (await res.json()) as { success: boolean; data: { title: string; duration: number; platform: string; isPlaylist: boolean }; error?: { code: string; message: string } };
    if (!body.success) {
      // YouTube puede exigir cookies desde ciertas redes; eso no es un fallo del servicio.
      assert.ok(['LOGIN_REQUIRED', 'RATE_LIMITED'].includes(body.error?.code ?? ''), JSON.stringify(body.error));
      return;
    }
    assert.equal(res.status, 200);
    assert.match(body.data.title, /Never Gonna Give You Up/i);
    assert.ok(body.data.duration > 200);
    assert.equal(body.data.platform, 'youtube');
    assert.equal(body.data.isPlaylist, false);
  });
});
