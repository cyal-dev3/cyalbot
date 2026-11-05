import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, extractUrl, platformLabel, PLATFORMS, URL_REGEX } from '../src/lib/downloaders.js';
import { PLATFORM_SPECS, pinterestPlugin, platformDownloadPlugins } from '../src/plugins/download-platform.js';
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
    ['https://www.pinterest.co.uk/pin/123/', 'pinterest'],
    ['https://www.pinterest.com.mx/pin/123/', 'pinterest'],
    ['https://pinterest.evil.com/pin/123/', 'unknown'],
    ['https://pinterest.cualquiercosa.tld/x', 'unknown'],
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

test('extractUrl acepta enlaces de plataformas conocidas sin esquema y los completa con https', () => {
  assert.equal(extractUrl('/tiktok vm.tiktok.com/ZMxxxx'), 'https://vm.tiktok.com/ZMxxxx');
  assert.equal(extractUrl('www.tiktok.com/@user/video/7300000000000000000'), 'https://www.tiktok.com/@user/video/7300000000000000000');
  assert.equal(extractUrl('mira youtube.com/watch?v=abc ok'), 'https://youtube.com/watch?v=abc');
  assert.equal(extractUrl('youtu.be/abc.'), 'https://youtu.be/abc');
  assert.equal(extractUrl('x.com/i/status/1'), 'https://x.com/i/status/1');
  // Hosts que solo terminan igual o dominios genéricos no cuentan.
  assert.equal(extractUrl('notx.com/u/status/1'), null);
  assert.equal(extractUrl('pinterest.evil.com/pin/1'), null);
  assert.equal(extractUrl('archivo.mp4/x y e.g. algo'), null);
  assert.equal(detectPlatform('vm.tiktok.com/ZMxxxx'), 'tiktok');
});

test('las regex de cada plataforma aceptan sus formatos (con y sin esquema) y rechazan los ajenos', () => {
  const cases: Record<string, [string[], string[]]> = {
    tiktok: [['https://www.tiktok.com/@u/video/1', 'https://vt.tiktok.com/ZS/', 'vm.tiktok.com/ZMx/'], ['https://youtu.be/x']],
    instagram: [
      ['https://www.instagram.com/p/C1/', 'https://www.instagram.com/reel/C1/', 'https://instagram.com/usuario.x/reel/C1/', 'https://www.instagram.com/share/abc', 'https://www.instagram.com/stories/user/123/', 'instagram.com/p/C1/'],
      ['https://www.instagram.com/usuario/', 'https://x.com/u/status/1'],
    ],
    facebook: [['https://www.facebook.com/watch?v=1', 'https://fb.watch/a/', 'https://m.facebook.com/x/videos/1', 'fb.watch/a/'], ['https://facebook.evil.com/x']],
    twitter: [['https://x.com/i/status/1', 'https://twitter.com/user/status/12?s=20', 'x.com/user/status/1'], ['https://x.com/user', 'https://x.com/home']],
    pinterest: [['https://pin.it/abc', 'https://www.pinterest.com/pin/1/', 'https://mx.pinterest.com/pin/1/', 'https://www.pinterest.co.uk/pin/1/', 'pin.it/abc'], ['https://www.pinterest.com/usuario/tablero/', 'https://pinterest.evil.com/pin/1/']],
    threads: [['https://www.threads.net/@u/post/C1', 'https://www.threads.com/@u.x/post/C1', 'https://threads.net/post/C1', 'threads.net/@u/post/C1'], ['https://www.threads.net/@u']],
  };
  assert.deepEqual(PLATFORM_SPECS.map((s) => s.platform).sort(), Object.keys(cases).sort());
  for (const spec of PLATFORM_SPECS) {
    const [good, bad] = cases[spec.platform];
    for (const url of good) {
      const expected = /^https?:/.test(url) ? url : `https://${url}`;
      assert.equal(extractUrl(`mira ${url} ok`, undefined, spec.urlRegex), expected, url);
    }
    for (const url of bad) assert.equal(extractUrl(url, undefined, spec.urlRegex), null, url);
    assert.ok(spec.commands.length > 0);
  }
  // Las entradas para index.ts salen de la misma tabla, con categoría download y sin el alias 'pin'.
  assert.equal(platformDownloadPlugins.length, PLATFORM_SPECS.length);
  for (const [name, plugin] of platformDownloadPlugins) {
    assert.match(name, /^download-/);
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
  assert.equal(parseDownloadArgs('youtube.com/watch?v=abc audio', base).url, 'https://youtube.com/watch?v=abc');
});
