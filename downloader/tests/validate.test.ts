import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DownloadError } from '../src/errors.js';
import { assertPublicHost, assertPublicUrl, isPrivateIp, proxyConfigured, sanitizeFilename, validateUrl } from '../src/validate.js';

function expectInvalid(input: unknown): void {
  assert.throws(
    () => validateUrl(input),
    (err: unknown) => err instanceof DownloadError && err.code === 'INVALID_URL' && err.status === 400,
    `deberia rechazar ${String(input)}`,
  );
}

describe('validateUrl', () => {
  it('acepta URLs http(s) publicas', () => {
    assert.equal(validateUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').hostname, 'www.youtube.com');
    assert.equal(validateUrl('http://vm.tiktok.com/ZMabc/').protocol, 'http:');
    assert.equal(validateUrl('  https://x.com/user/status/1 ').hostname, 'x.com');
  });

  it('rechaza entradas que no son URL', () => {
    expectInvalid(undefined);
    expectInvalid('');
    expectInvalid(123);
    expectInvalid('no es url');
    expectInvalid('youtube.com/watch');
    expectInvalid('https://exa mple.com/a');
    expectInvalid('https://example.com/a\nb');
  });

  it('rechaza esquemas distintos de http(s)', () => {
    expectInvalid('ftp://example.com/file');
    expectInvalid('file:///etc/passwd');
    expectInvalid('javascript:alert(1)');
    expectInvalid('data:text/plain,hola');
  });

  it('rechaza localhost, hosts internos e IPs literales (SSRF)', () => {
    expectInvalid('http://localhost/');
    expectInvalid('http://LOCALHOST:3002/');
    expectInvalid('http://foo.localhost/');
    expectInvalid('http://router.local/');
    expectInvalid('http://db.internal/');
    expectInvalid('http://intranet/');
    expectInvalid('http://127.0.0.1/');
    expectInvalid('http://10.0.0.5:8080/');
    expectInvalid('http://192.168.1.1/');
    expectInvalid('http://169.254.169.254/latest/meta-data');
    expectInvalid('http://8.8.8.8/');
    expectInvalid('http://[::1]/');
    expectInvalid('http://[fe80::1]/');
    expectInvalid('http://0x7f.1/');
    expectInvalid('http://2130706433/');
    expectInvalid('http://user:pass@example.com/');
  });
});

describe('isPrivateIp', () => {
  it('detecta rangos privados y reservados', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      assert.equal(isPrivateIp(ip), true, ip);
    }
  });
  it('acepta direcciones publicas', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '142.250.72.206', '2606:4700:4700::1111']) {
      assert.equal(isPrivateIp(ip), false, ip);
    }
  });
  it('trata lo que no es IP como privado', () => {
    assert.equal(isPrivateIp('no-ip'), true);
  });
});

describe('sanitizeFilename', () => {
  it('elimina rutas y caracteres peligrosos', () => {
    assert.equal(sanitizeFilename('../../etc/passwd'), 'etc_passwd');
    assert.equal(sanitizeFilename('..\\..\\windows\\system32'), 'windows_system32');
    assert.equal(sanitizeFilename('a/b:c*d?e"f<g>h|i.mp4'), 'a_b_c_d_e_f_g_h_i.mp4');
    assert.equal(sanitizeFilename('video\u0000.mp4'), 'video.mp4');
  });
  it('usa fallback cuando queda vacio o es reservado', () => {
    assert.equal(sanitizeFilename(''), 'file');
    assert.equal(sanitizeFilename('...'), 'file');
    assert.equal(sanitizeFilename(null), 'file');
    assert.equal(sanitizeFilename('CON'), 'file');
    assert.equal(sanitizeFilename('nul.txt', 'x'), 'x');
  });
  it('acota la longitud conservando la extension', () => {
    const long = 'a'.repeat(300) + '.mp3';
    const out = sanitizeFilename(long);
    assert.equal(out.length, 120);
    assert.ok(out.endsWith('.mp3'));
  });
  it('conserva nombres normales con unicode', () => {
    assert.equal(sanitizeFilename('Canción  bonita.mp3'), 'Canción bonita.mp3');
  });
});

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

function withoutProxy<T>(fn: () => Promise<T>): Promise<T> {
  const saved = PROXY_VARS.map((k) => [k, process.env[k]] as const);
  for (const k of PROXY_VARS) delete process.env[k];
  return fn().finally(() => {
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
  });
}

describe('assertPublicHost', () => {
  it('rechaza hosts que resuelven a IP privada', async () => {
    await assert.rejects(assertPublicHost('localhost'), (e: unknown) => e instanceof DownloadError && e.code === 'INVALID_URL');
  });

  it('no deja pasar un fallo de DNS sin proxy (fail-closed)', async () => {
    await withoutProxy(async () => {
      assert.equal(proxyConfigured(), false);
      await assert.rejects(
        assertPublicHost('this-domain-does-not-exist-zz123.invalid'),
        (e: unknown) => e instanceof DownloadError && e.code === 'INVALID_URL' && /resolver/.test(e.message),
      );
    });
  });

  it('con proxy configurado delega la resolucion en el proxy', async () => {
    assert.equal(proxyConfigured({ HTTPS_PROXY: 'http://proxy:3128' }), true);
    assert.equal(proxyConfigured({}), false);
    const saved = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://proxy.test:3128';
    try {
      assert.deepEqual(await assertPublicHost('this-domain-does-not-exist-zz123.invalid'), []);
    } finally {
      if (saved === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = saved;
    }
  });

  it('assertPublicUrl valida sintaxis y host en un paso (URLs derivadas de la metadata)', async () => {
    for (const bad of ['http://127.0.0.1/x.jpg', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/img.png', 'file:///etc/passwd', 'http://[::1]/a']) {
      await assert.rejects(assertPublicUrl(bad), (e: unknown) => e instanceof DownloadError && e.code === 'INVALID_URL', bad);
    }
  });
});
