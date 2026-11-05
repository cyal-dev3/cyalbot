import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';
import { DownloadError } from '../src/errors.js';
import { cacheKey, classifyFile, extensionForMime, newToken, publicFileUrl, TOKEN_RE, type StoredEntry } from '../src/files.js';
import { buildDownloadData, parseDownloadRequest } from '../src/routes.js';
import { collectImageUrls, errorFromWarnings, estimatedSize, firstPlaylistEntryUrl, formatSelector, hasAudioFormats, hasVideoFormats, isImageFormat, normalizeMetadata } from '../src/ytdlp.js';

describe('parseDownloadRequest', () => {
  it('aplica valores por defecto', () => {
    const req = parseDownloadRequest({ url: 'https://www.youtube.com/watch?v=abc' });
    assert.equal(req.quality, 'medium');
    assert.equal(req.audioOnly, false);
    assert.equal(req.url, 'https://www.youtube.com/watch?v=abc');
  });
  it('acepta quality y audioOnly validos', () => {
    const req = parseDownloadRequest({ url: 'https://x.com/a/status/1', quality: 'low', audioOnly: true });
    assert.equal(req.quality, 'low');
    assert.equal(req.audioOnly, true);
  });
  it('rechaza body o campos invalidos', () => {
    const bad = (body: unknown, code: string) =>
      assert.throws(() => parseDownloadRequest(body), (e: unknown) => e instanceof DownloadError && e.code === code);
    bad(null, 'BAD_REQUEST');
    bad([], 'BAD_REQUEST');
    bad({}, 'INVALID_URL');
    bad({ url: 'http://localhost/x' }, 'INVALID_URL');
    bad({ url: 'https://example.com/v', quality: 'ultra' }, 'BAD_REQUEST');
    bad({ url: 'https://example.com/v', audioOnly: 'yes' }, 'BAD_REQUEST');
  });
});

describe('buildDownloadData', () => {
  it('construye la respuesta del contrato con medias y el primero como principal', () => {
    const entry: StoredEntry = {
      token: 'a'.repeat(32),
      dir: '/tmp/x',
      createdAt: Date.now(),
      meta: null,
      files: [
        { path: '/tmp/x/1.mp4', filename: '1.mp4', size: 100, type: 'video', mime: 'video/mp4' },
        { path: '/tmp/x/2.jpg', filename: '2.jpg', size: 50, type: 'image', mime: 'image/jpeg' },
      ],
    };
    const data = buildDownloadData('http://downloader:3002', entry, {
      title: 'T',
      author: 'A',
      duration: 12,
      thumbnail: 'https://i/img.jpg',
      platform: 'youtube',
      isPlaylist: false,
      entries: 1,
    });
    assert.equal(data.url, `http://downloader:3002/files/${'a'.repeat(32)}`);
    assert.equal(data.type, 'video');
    assert.equal(data.filename, '1.mp4');
    assert.equal(data.size, 100);
    assert.equal(data.duration, 12);
    assert.equal(data.title, 'T');
    assert.equal(data.author, 'A');
    assert.equal(data.medias.length, 2);
    assert.equal(data.medias[1].url, `http://downloader:3002/files/${'a'.repeat(32)}/1`);
    assert.equal(data.medias[1].type, 'image');
  });
  it('rellena null cuando no hay metadata', () => {
    const entry: StoredEntry = {
      token: 'b'.repeat(32),
      dir: '/tmp/y',
      createdAt: Date.now(),
      meta: null,
      files: [{ path: '/tmp/y/a.mp3', filename: 'a.mp3', size: 1, type: 'audio', mime: 'audio/mpeg' }],
    };
    const data = buildDownloadData('http://h', entry, null);
    assert.equal(data.duration, null);
    assert.equal(data.thumbnail, null);
    assert.equal(data.title, null);
    assert.equal(data.author, null);
    assert.equal(data.type, 'audio');
  });
});

describe('files helpers', () => {
  it('genera tokens hex de 32 caracteres distintos', () => {
    const a = newToken();
    const b = newToken();
    assert.match(a, TOKEN_RE);
    assert.notEqual(a, b);
  });
  it('clasifica extensiones y descarta temporales', () => {
    assert.deepEqual(classifyFile('v.mp4'), { mime: 'video/mp4', type: 'video' });
    assert.deepEqual(classifyFile('a.MP3'), { mime: 'audio/mpeg', type: 'audio' });
    assert.deepEqual(classifyFile('i.webp'), { mime: 'image/webp', type: 'image' });
    assert.equal(classifyFile('v.mp4.part'), null);
    assert.equal(classifyFile('info.json'), null);
    assert.equal(classifyFile('noext'), null);
    assert.equal(extensionForMime('image/jpeg; charset=binary'), 'jpg');
    assert.equal(extensionForMime('application/octet-stream'), null);
  });
  it('clave de cache distingue url, calidad y audio', () => {
    assert.notEqual(cacheKey('u', 'low', false), cacheKey('u', 'low', true));
    assert.notEqual(cacheKey('u', 'low', false), cacheKey('u', 'best', false));
    assert.equal(cacheKey('u', 'low', false), cacheKey('u', 'low', false));
    assert.equal(publicFileUrl('http://h', 'tok', 0), 'http://h/files/tok');
    assert.equal(publicFileUrl('http://h', 'tok', 2), 'http://h/files/tok/2');
  });
});

describe('ytdlp helpers', () => {
  it('selectores de formato por calidad', () => {
    assert.equal(formatSelector('best', false), 'bv*+ba/b');
    assert.equal(formatSelector('medium', false), 'bv*[height<=720]+ba/b[height<=720]/b');
    assert.equal(formatSelector('low', false), 'bv*[height<=480]+ba/b[height<=480]/b');
    assert.equal(formatSelector('best', true), 'ba/b');
  });
  it('normaliza metadata de un video y de una playlist', () => {
    const single = normalizeMetadata({
      title: 'Video',
      uploader: 'Canal',
      duration: 212.4,
      thumbnails: [{ url: 'small', width: 100 }, { url: 'big', width: 1280 }],
      extractor_key: 'Youtube',
    });
    assert.deepEqual(single, { title: 'Video', author: 'Canal', duration: 212, thumbnail: 'big', platform: 'youtube', isPlaylist: false, entries: 1 });
    const playlist = normalizeMetadata({
      _type: 'playlist',
      title: 'Carrusel',
      extractor_key: 'Instagram',
      entries: [{ title: 'a', uploader: 'user', duration: 5, thumbnail: 't1' }, { title: 'b' }, null],
    });
    assert.equal(playlist.isPlaylist, true);
    assert.equal(playlist.entries, 2);
    assert.equal(playlist.author, 'user');
    assert.equal(playlist.thumbnail, 't1');
    assert.equal(playlist.platform, 'instagram');
  });
  it('estima tamano sumando formatos solicitados', () => {
    assert.equal(estimatedSize({ requested_formats: [{ filesize: 100 }, { filesize_approx: 50 }] }), 150);
    assert.equal(estimatedSize({ filesize: 20 }), 20);
    assert.equal(estimatedSize({ formats: [{ filesize: 1 }] }), null);
    assert.equal(estimatedSize({ _type: 'playlist', entries: [{ filesize: 10 }, { filesize: 5 }] }), 15);
  });
  it('detecta formatos de video e imagenes candidatas', () => {
    assert.equal(hasVideoFormats({ formats: [{ format_id: '1' }] }), true);
    assert.equal(hasVideoFormats({ thumbnails: [{ url: 'x' }] }), false);
    const urls = collectImageUrls({
      _type: 'playlist',
      extractor_key: 'Instagram',
      entries: [
        { formats: [{ format_id: 'v' }], thumbnail: 'https://cdn/vthumb.jpg' },
        { url: 'https://cdn/photo.jpg?x=1' },
        { thumbnails: [{ url: 'https://cdn/t-small.webp', width: 10 }, { url: 'https://cdn/t-big.webp', width: 900 }] },
        { ext: 'jpg', url: 'https://cdn/raw' },
      ],
    });
    assert.deepEqual(urls, ['https://cdn/photo.jpg?x=1', 'https://cdn/t-big.webp', 'https://cdn/raw']);
  });
  it('no usa miniaturas como imagen en plataformas de video', () => {
    assert.deepEqual(collectImageUrls({ extractor_key: 'Youtube', thumbnails: [{ url: 'https://i.ytimg.com/x.jpg' }] }), []);
    assert.deepEqual(collectImageUrls({ extractor_key: 'Instagram', duration: 12, thumbnails: [{ url: 'https://cdn/t.jpg' }] }), []);
    assert.deepEqual(collectImageUrls({ extractor_key: 'Instagram', thumbnails: [{ url: 'https://cdn/t.jpg' }] }), ['https://cdn/t.jpg']);
  });
  it('una URL directa a imagen no cuenta como video y se descarga como imagen', () => {
    // Asi devuelve el extractor generico un PNG: un "formato" con ext png y sin codecs.
    const png = { id: 'PNG_demo', ext: 'png', format_id: '0', vcodec: 'none', acodec: 'none', url: 'https://upload.wikimedia.org/x/PNG_demo.png', extractor_key: 'Generic' };
    assert.equal(isImageFormat(png), true);
    assert.equal(isImageFormat({ ext: 'mp4', vcodec: 'h264' }), false);
    assert.equal(isImageFormat({ ext: 'png', vcodec: 'png' }), false);
    assert.equal(hasVideoFormats(png), false);
    assert.deepEqual(collectImageUrls(png), ['https://upload.wikimedia.org/x/PNG_demo.png']);
    // Varios formatos de imagen: se elige el mayor.
    const multi = { formats: [{ format_id: 'a', ext: 'jpg', url: 'https://h/s.jpg', filesize: 10 }, { format_id: 'b', ext: 'jpg', url: 'https://h/l.jpg', filesize: 90 }] };
    assert.equal(hasVideoFormats(multi), false);
    assert.deepEqual(collectImageUrls(multi), ['https://h/l.jpg']);
    // Mezcla imagen + video: es video.
    assert.equal(hasVideoFormats({ formats: [{ format_id: 'a', ext: 'jpg' }, { format_id: 'b', ext: 'mp4', vcodec: 'avc1' }] }), true);
  });
  it('detecta videos sin pista de audio antes de pedir -x', () => {
    assert.equal(hasAudioFormats({ formats: [{ format_id: 'v', vcodec: 'avc1', acodec: 'none' }] }), false);
    assert.equal(hasAudioFormats({ requested_formats: [{ format_id: 'v', vcodec: 'avc1', acodec: 'none' }, { format_id: 'a', vcodec: 'none', acodec: 'mp4a' }] }), true);
    // Sin informacion de codecs (generic) se asume que puede haber audio.
    assert.equal(hasAudioFormats({ format_id: '0', ext: 'mp4' }), true);
    assert.equal(hasAudioFormats({ format_id: '0', ext: 'png' }), false);
  });
  it('en una playlist pura usa solo la primera entrada; en un carrusel resuelto no', () => {
    const playlist = {
      _type: 'playlist',
      extractor_key: 'YoutubePlaylist',
      entries: [
        { _type: 'url', id: 'aaa', ie_key: 'Youtube', url: 'https://www.youtube.com/watch?v=aaa' },
        { _type: 'url', id: 'bbb', ie_key: 'Youtube', url: 'https://www.youtube.com/watch?v=bbb' },
      ],
    };
    assert.equal(firstPlaylistEntryUrl(playlist), 'https://www.youtube.com/watch?v=aaa');
    assert.equal(firstPlaylistEntryUrl({ _type: 'playlist', extractor_key: 'YoutubeTab', entries: [{ _type: 'url', id: 'ccc', ie_key: 'Youtube', url: 'ccc' }] }), 'https://www.youtube.com/watch?v=ccc');
    const carousel = { _type: 'playlist', extractor_key: 'Instagram', entries: [{ id: '1', formats: [{ format_id: 'v', ext: 'mp4' }] }, { id: '2', ext: 'jpg', url: 'https://cdn/2.jpg' }] };
    assert.equal(firstPlaylistEntryUrl(carousel), null);
    assert.equal(firstPlaylistEntryUrl({ id: 'single', formats: [{ format_id: 'v' }] }), null);
    assert.equal(firstPlaylistEntryUrl({ _type: 'playlist', entries: [] }), null);
  });
  it('convierte avisos del -J en errores concretos e ignora ruido', () => {
    assert.equal(errorFromWarnings('WARNING: [youtube] zzzz: Video unavailable\nWARNING: No video formats found!')?.code, 'NOT_FOUND');
    const mixed = errorFromWarnings('WARNING: [youtube] zzzz: Unable to download webpage: HTTP Error 429: Too Many Requests\nWARNING: [youtube] Video unavailable');
    assert.equal(mixed?.code, 'NOT_FOUND');
    assert.equal(mixed?.message, 'Video unavailable');
    assert.equal(errorFromWarnings('WARNING: [Instagram] x: login required')?.code, 'LOGIN_REQUIRED');
    assert.equal(errorFromWarnings('WARNING: [youtube] No supported JavaScript runtime could be found\nWARNING: No video formats found!'), null);
    assert.equal(errorFromWarnings(''), null);
  });
});

describe('loadConfig', () => {
  it('usa defaults y respeta variables', () => {
    const def = loadConfig({});
    assert.equal(def.port, 3002);
    assert.equal(def.publicUrl, 'http://localhost:3002');
    assert.equal(def.maxFileBytes, 60 * 1024 * 1024);
    assert.equal(def.maxConcurrent, 2);
    assert.equal(def.queueMax, 20);
    assert.equal(def.metaConcurrent, 4);
    assert.equal(def.maxPlaylistItems, 10);
    assert.equal(def.apiKey, null);
    const custom = loadConfig({ PORT: '4000', PUBLIC_URL: 'http://downloader:4000/', MAX_FILE_MB: '10', DOWNLOADER_API_KEY: 'k', LOG_LEVEL: 'DEBUG' });
    assert.equal(custom.publicUrl, 'http://downloader:4000');
    assert.equal(custom.maxFileBytes, 10 * 1024 * 1024);
    assert.equal(custom.apiKey, 'k');
    assert.equal(custom.logLevel, 'debug');
  });
  it('rechaza valores invalidos', () => {
    assert.throws(() => loadConfig({ MAX_CONCURRENT: '0' }));
    assert.throws(() => loadConfig({ PORT: 'abc' }));
    assert.throws(() => loadConfig({ LOG_LEVEL: 'loud' }));
  });
});
