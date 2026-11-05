import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DownloadError, STATUS_BY_CODE, extractErrorLine, mapYtdlpError, toDownloadError } from '../src/errors.js';

describe('mapYtdlpError', () => {
  const cases: [string, string, number][] = [
    ['ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies', 'LOGIN_REQUIRED', 422],
    ['ERROR: [Instagram] Cxyz: General metadata extraction failed (You may want to try with --cookies / rate-limit reached or login required)', 'LOGIN_REQUIRED', 422],
    ['ERROR: [twitter] 123: NSFW tweet requires authentication. Use --cookies', 'LOGIN_REQUIRED', 422],
    ['ERROR: [youtube] abc: Private video. Sign in if you have been granted access to this video', 'LOGIN_REQUIRED', 422],
    ['ERROR: [youtube] abc: Video unavailable', 'NOT_FOUND', 404],
    ['ERROR: [TikTok] 123: Unable to download webpage: HTTP Error 404: Not Found', 'NOT_FOUND', 404],
    ['ERROR: [youtube] abc: This video has been removed by the uploader', 'NOT_FOUND', 404],
    ['ERROR: Unsupported URL: https://example.com/page', 'UNSUPPORTED', 422],
    ['ERROR: [generic] page: No video formats found!; please report this issue', 'UNSUPPORTED', 422],
    ['ERROR: [youtube] abc: Requested format is not available. Use --list-formats', 'UNSUPPORTED', 422],
    ['[download] File is larger than max-filesize (90000000 bytes > 62914560 bytes). Aborting.', 'TOO_LARGE', 413],
    ['ERROR: [youtube] abc: Unable to download webpage: HTTP Error 429: Too Many Requests', 'RATE_LIMITED', 429],
    ['ERROR: [TikTok] 1: Unable to download webpage: The read operation timed out', 'TIMEOUT', 504],
    ['ERROR: [twitter] 1: Unable to download webpage: HTTP Error 500: Domain Not Found', 'INTERNAL', 500],
    ['ERROR: [twitter] 1: Tweet not found', 'NOT_FOUND', 404],
    ['ERROR: algo raro paso', 'INTERNAL', 500],
    ['', 'INTERNAL', 500],
    // El id del extractor generico es el slug de la URL y no debe influir en el codigo.
    ['ERROR: [generic] timeout: Unable to download webpage: HTTP Error 404: Not Found', 'NOT_FOUND', 404],
    ['ERROR: [generic] rate-limit: Unable to download webpage: HTTP Error 404: Not Found', 'NOT_FOUND', 404],
    ['ERROR: [generic] login: Unable to download webpage: HTTP Error 404: Not Found', 'NOT_FOUND', 404],
    ['ERROR: [generic] private-video.mp4: Unable to download webpage: HTTP Error 404: Not Found', 'NOT_FOUND', 404],
    ['ERROR: Unsupported URL: https://example.com/timeout/login-required', 'UNSUPPORTED', 422],
    // El codigo HTTP manda sobre palabras sueltas del mensaje.
    ['ERROR: [generic] x: Unable to download webpage: HTTP Error 429: Too Many Requests (timeout)', 'RATE_LIMITED', 429],
    // Errores de recurso que antes caian en INTERNAL.
    ['ERROR: Postprocessing: WARNING: unable to obtain file audio codec with ffprobe', 'UNSUPPORTED', 422],
    ['ERROR: [generic] abc123xyz: Unable to download webpage: HTTP Error 302: Found (redirect loop detected)', 'UNSUPPORTED', 422],
    ['ERROR: [generic] video: Unable to download webpage: <urlopen error [Errno -2] Name or service not known>', 'NOT_FOUND', 404],
    ['ERROR: [generic] video: Unable to download webpage: HTTP Error 403: Forbidden', 'UNSUPPORTED', 422],
    ['ERROR: [generic] video: Unable to download webpage: <urlopen error Tunnel connection failed: 403 Forbidden>', 'UNSUPPORTED', 422],
  ];

  for (const [output, code, status] of cases) {
    it(`mapea "${output.slice(0, 60)}" a ${code}`, () => {
      const err = mapYtdlpError(output);
      assert.ok(err instanceof DownloadError);
      assert.equal(err.code, code);
      assert.equal(err.status, status);
      assert.equal(STATUS_BY_CODE[err.code], status);
    });
  }

  it('usa la ultima linea ERROR como mensaje y recorta el prefijo del extractor', () => {
    const err = mapYtdlpError('WARNING: algo\nERROR: [youtube] abc: Video unavailable\n');
    assert.equal(err.message, 'Video unavailable');
  });

  it('ignora el JSON de stdout aunque contenga palabras clave', () => {
    const json = JSON.stringify({ title: 'private video timeout', description: 'rate-limit login required' });
    const err = mapYtdlpError(`${json}\nERROR: [youtube] abc: Video unavailable`);
    assert.equal(err.code, 'NOT_FOUND');
    assert.equal(err.message, 'Video unavailable');
    // Solo JSON y nada mas: INTERNAL con el fallback, nunca un codigo inventado.
    assert.equal(mapYtdlpError(json).code, 'INTERNAL');
  });

  it('CLIENT_CLOSED es interno (499) y no se mapea desde yt-dlp', () => {
    assert.equal(STATUS_BY_CODE.CLIENT_CLOSED, 499);
    assert.notEqual(mapYtdlpError('ERROR: client closed').code, 'CLIENT_CLOSED');
  });

  it('usa el fallback si no hay salida', () => {
    assert.equal(mapYtdlpError('', 'fallo').message, 'fallo');
    assert.equal(extractErrorLine(''), null);
  });
});

describe('toDownloadError', () => {
  it('conserva DownloadError y envuelve el resto como INTERNAL', () => {
    const original = new DownloadError('TIMEOUT', 'x');
    assert.equal(toDownloadError(original), original);
    const wrapped = toDownloadError(new Error('boom'));
    assert.equal(wrapped.code, 'INTERNAL');
    assert.equal(wrapped.message, 'boom');
    assert.equal(toDownloadError('texto').message, 'texto');
  });
});
