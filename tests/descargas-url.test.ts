import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, extractUrl, platformLabel, PLATFORMS, URL_REGEX } from '../src/lib/downloaders.js';
import { tiktokPlugin, instagramPlugin, facebookPlugin, twitterPlugin, pinterestPlugin, threadsPlugin } from '../src/plugins/download-platform.js';
import { parseDownloadArgs } from '../src/plugins/download-universal.js';

test('detectPlatform reconoce hosts y variantes nuevas', () => {
  const cases: [string, string][] = [
    ['https://www.tiktok.com/@user/video/7234', 'tiktok'],
    ['https://vm.tiktok.com/ZMabc/', 'tiktok'],
    ['https://vt.tiktok.com/ZSabc/', 'tiktok'],
    ['https://www.instagram.com/p/Cxyz/', 'instagram'],
    ['https://www.instagram.com/usuario/reel/Cxyz/', 'instagram'],
    ['https://www.instagram.com/share/abc', 'instagram'],
    ['https://www.facebook.com/watch?v=123', 'facebook'],
    ['https://fb.watch/abc/', 'facebook'],
    ['https://fb.com/video/123', 'facebook'],
    ['https://m.facebook.com/story.php?id=1', 'facebook'],
    ['https://x.com/i/status/1234567890', 'twitter'],
    ['https://twitter.com/user/status/1', 'twitter'],
    ['https://mobile.twitter.com/user/status/1', 'twitter'],
    ['https://pin.it/abc', 'pinterest'],
    ['https://www.pinterest.com/pin/123/', 'pinterest'],
    ['https://ar.pinterest.com/pin/123/', 'pinterest'],
    ['https://www.threads.net/@user/post/abc', 'threads'],
    ['https://www.threads.com/@user/post/abc', 'threads'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube.com/shorts/abc', 'youtube'],
    ['https://vimeo.com/123', 'unknown'],
    ['https://example.com/?u=https://x.com/a/status/1', 'unknown'],
    ['no es una url', 'unknown'],
  ];
  for (const [url, expected] of cases) {
    assert.equal(detectPlatform(url), expected, url);
  }
});

test('platformLabel y PLATFORMS cubren todas las plataformas', () => {
  assert.equal(platformLabel('tiktok'), '📱 TikTok');
  assert.equal(platformLabel('unknown'), '🌐 Enlace');
  assert.deepEqual(Object.keys(PLATFORMS).sort(), ['facebook', 'instagram', 'pinterest', 'threads', 'tiktok', 'twitter', 'unknown', 'youtube']);
});

test('extractUrl devuelve la primera URL del texto, luego del citado, sin puntuación final', () => {
  assert.equal(extractUrl('mira esto https://vm.tiktok.com/ZMabc/ jaja'), 'https://vm.tiktok.com/ZMabc/');
  assert.equal(extractUrl('(https://x.com/u/status/1).'), 'https://x.com/u/status/1');
  assert.equal(extractUrl('sin url', 'citado: https://youtu.be/abc, mira'), 'https://youtu.be/abc');
  assert.equal(extractUrl('sin url', undefined), null);
  assert.equal(extractUrl(undefined, undefined), null);
  assert.equal(extractUrl('', ''), null);
  assert.equal(extractUrl('https://a.com/x https://b.com/y'), 'https://a.com/x');
  assert.equal(extractUrl('hola', 'https://x.com/u/status/1 https://vm.tiktok.com/Z/', /https?:\/\/[\w.]*tiktok\.com\/\S+/i), 'https://vm.tiktok.com/Z/');
  assert.equal(extractUrl('texto https://youtu.be/abc', undefined, /https?:\/\/[\w.]*tiktok\.com\/\S+/i), null);
  assert.equal(URL_REGEX.test('ftp://x'), false);
});

test('las regex de cada plataforma aceptan sus formatos y rechazan los ajenos', () => {
  const specs: [RegExp, string[], string[]][] = [
    [/https?:\/\/(?:[\w-]+\.)?tiktok\.com\/[^\s<>"']+/i, ['https://www.tiktok.com/@u/video/1', 'https://vt.tiktok.com/ZS/'], ['https://youtu.be/x']],
    [/https?:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv|stories|share)\/[^\s<>"']+/i,
      ['https://www.instagram.com/p/C1/', 'https://www.instagram.com/reel/C1/', 'https://instagram.com/usuario.x/reel/C1/', 'https://www.instagram.com/share/abc', 'https://www.instagram.com/stories/user/123/'],
      ['https://www.instagram.com/usuario/', 'https://x.com/u/status/1']],
    [/https?:\/\/(?:[\w-]+\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s<>"']+/i, ['https://www.facebook.com/watch?v=1', 'https://fb.watch/a/', 'https://m.facebook.com/x/videos/1'], ['https://facebook.evil.com/x']],
    [/https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/(?:i\/|\w+\/)status\/\d+[^\s<>"']*/i, ['https://x.com/i/status/1', 'https://twitter.com/user/status/12?s=20'], ['https://x.com/user', 'https://x.com/home']],
    [/https?:\/\/(?:(?:[\w-]+\.)?pinterest\.[a-z.]+\/pin\/[^\s<>"']+|pin\.it\/[^\s<>"']+)/i, ['https://pin.it/abc', 'https://www.pinterest.com/pin/1/', 'https://mx.pinterest.com/pin/1/'], ['https://www.pinterest.com/usuario/tablero/']],
    [/https?:\/\/(?:www\.)?threads\.(?:net|com)\/(?:@[\w.]+\/)?post\/[^\s<>"']+/i, ['https://www.threads.net/@u/post/C1', 'https://www.threads.com/@u.x/post/C1', 'https://threads.net/post/C1'], ['https://www.threads.net/@u']],
  ];
  for (const [regex, good, bad] of specs) {
    for (const url of good) assert.equal(extractUrl(`mira ${url} ok`, undefined, regex), url, url);
    for (const url of bad) assert.equal(extractUrl(url, undefined, regex), null, url);
  }
  // Los plugins existen y tienen sus comandos sin el alias 'pin'.
  for (const plugin of [tiktokPlugin, instagramPlugin, facebookPlugin, twitterPlugin, pinterestPlugin, threadsPlugin]) {
    assert.ok(Array.isArray(plugin.command) && plugin.command.length > 0);
    assert.equal(plugin.category, 'download');
  }
  assert.deepEqual(pinterestPlugin.command, ['pinterest']);
});

test('parseDownloadArgs lee url y modo en cualquier orden', () => {
  const base = { audioOnly: false, quality: 'medium' as const };
  assert.deepEqual(parseDownloadArgs('https://youtu.be/x', base), { url: 'https://youtu.be/x', mode: { audioOnly: false, quality: 'medium' } });
  assert.deepEqual(parseDownloadArgs('https://youtu.be/x audio', base).mode, { audioOnly: true, quality: 'medium' });
  assert.deepEqual(parseDownloadArgs('hd https://youtu.be/x', base).mode, { audioOnly: false, quality: 'best' });
  assert.deepEqual(parseDownloadArgs('https://youtu.be/x low', base).mode, { audioOnly: false, quality: 'low' });
  assert.equal(parseDownloadArgs('audio', base).url, null);
});
