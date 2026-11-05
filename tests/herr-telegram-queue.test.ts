import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { MessageQueue, isConnectionError, type QueuedMessage } from '../src/lib/telegram-queue.js';

setLogLevel('error');

interface Sent { jid: string; content: Record<string, unknown> }

function fakeSock(options: { failWith?: (content: Record<string, unknown>) => Error | null } = {}) {
  const sent: Sent[] = [];
  return {
    sent,
    user: { id: 'bot@s.whatsapp.net' },
    async sendMessage(jid: string, content: Record<string, unknown>) {
      const error = options.failWith?.(content);
      if (error) throw error;
      sent.push({ jid, content });
      return { key: { id: `wa-${sent.length}` } };
    },
  };
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'herr-queue-'));
}

/** Espera cediendo al bucle de E/S (setImmediate no se mockea, así sirve también con mock.timers). */
async function waitFor(check: () => boolean, tries = 20_000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(check(), 'la condición no se cumplió a tiempo');
}

function msg(id: string, extra: Partial<Parameters<MessageQueue['enqueue']>[0]> = {}) {
  return { id, senderName: 'Tipster', text: `texto ${id}`, whatsappGroupId: 'g@g.us', ...extra };
}

test('isConnectionError distingue errores de red', () => {
  assert.equal(isConnectionError(new Error('Connection Closed')), true);
  assert.equal(isConnectionError(new Error('read ECONNRESET')), true);
  assert.equal(isConnectionError(new Error('bad request')), false);
  assert.equal(isConnectionError('string'), false);
});

test('entrega en orden, persiste la media y la borra al enviar', async () => {
  const dir = await tmp();
  const sock = fakeSock();
  const queue = new MessageQueue({ dir, delayBetweenMessages: 0 });
  await queue.load();
  queue.updateSocket(sock);

  const first = queue.enqueue(msg('1', { mediaType: 'photo', mediaBuffer: Buffer.from('imagen') }));
  queue.enqueue(msg('2'));
  queue.enqueue(msg('3', { text: '' , mediaType: 'video', mediaBuffer: Buffer.from('video') }));
  assert.equal(queue.pendingCount, 3);
  await first.ready;
  assert.ok(first.item.mediaPath);
  assert.equal((await readFile(first.item.mediaPath!)).toString(), 'imagen');

  await waitFor(() => sock.sent.length === 3 && queue.pendingCount === 0 && !queue.isProcessing);
  assert.deepEqual(sock.sent.map((s) => s.jid), ['g@g.us', 'g@g.us', 'g@g.us']);
  assert.equal((sock.sent[0].content.caption as string), '*Tipster:* texto 1');
  assert.ok(Buffer.isBuffer(sock.sent[0].content.image));
  assert.equal(sock.sent[1].content.text, '*Tipster:* texto 2');
  assert.deepEqual(sock.sent[1].content.mentions, []);
  assert.ok(Buffer.isBuffer(sock.sent[2].content.video));
  await assert.rejects(access(first.item.mediaPath!), 'la media enviada se borra del disco');
  await queue.stop();
  const saved = JSON.parse(await readFile(join(dir, 'telegram-queue.json'), 'utf8')) as { queue: QueuedMessage[] };
  assert.deepEqual(saved.queue, []);
});

test('lo encolado sin socket se recupera del disco al arrancar de nuevo', async () => {
  const dir = await tmp();
  const q1 = new MessageQueue({ dir, delayBetweenMessages: 0 });
  await q1.load();
  await q1.enqueue(msg('a', { mediaType: 'photo', mediaBuffer: Buffer.from('foto') })).ready;
  await q1.enqueue(msg('b')).ready;
  await q1.stop();

  const sock = fakeSock();
  const q2 = new MessageQueue({ dir, delayBetweenMessages: 0 });
  assert.equal(await q2.load(), 2);
  assert.equal(q2.pendingCount, 2);
  q2.updateSocket(sock);
  await waitFor(() => sock.sent.length === 2);
  assert.ok(Buffer.isBuffer(sock.sent[0].content.image));
  assert.equal(sock.sent[1].content.text, '*Tipster:* texto b');
  await q2.stop();
});

test('la media omitida se marca en el texto y usa prepare para caption y menciones', async () => {
  const dir = await tmp();
  const sock = fakeSock();
  const onSent: (string | undefined)[] = [];
  const queue = new MessageQueue({
    dir,
    delayBetweenMessages: 0,
    prepare: (item) => ({ caption: `[${item.senderName}] ${item.text}`, mentions: ['x@s.whatsapp.net'], onSent: (id) => onSent.push(id) }),
  });
  await queue.load();
  queue.updateSocket(sock);
  queue.enqueue(msg('m', { mediaType: 'photo', mediaOmitted: true }));
  await waitFor(() => sock.sent.length === 1);
  assert.equal(sock.sent[0].content.text, '[Tipster] texto m\n\n[media omitida]');
  assert.deepEqual(sock.sent[0].content.mentions, ['x@s.whatsapp.net']);
  assert.deepEqual(onSent, ['wa-1']);
  await queue.stop();
});

test('un error que no es de conexión descarta el mensaje al primer intento y avisa', async () => {
  const dir = await tmp();
  const sock = fakeSock({ failWith: (content) => (String(content.text).includes('bad') ? new Error('media upload failed: 400') : null) });
  const notices: string[] = [];
  const queue = new MessageQueue({ dir, delayBetweenMessages: 0, notify: (t) => { notices.push(t); } });
  await queue.load();
  queue.updateSocket(sock);
  queue.enqueue(msg('bad'));
  queue.enqueue(msg('good'));
  await waitFor(() => sock.sent.length === 1 && queue.pendingCount === 0);
  assert.equal(sock.sent[0].content.text, '*Tipster:* texto good');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /descarté un mensaje de Tipster/);
  assert.equal(queue.isPaused, false);
  await queue.stop();
});

test('los errores de conexión pausan la cola y se reanuda sola con backoff (mock timers)', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());

  const dir = await tmp();
  let failures = 2;
  const sock = fakeSock({ failWith: () => (failures > 0 ? (failures--, new Error('Connection Closed')) : null) });
  const queue = new MessageQueue({ dir, delayBetweenMessages: 0, maxConsecutiveErrors: 1, autoResumeMs: 60_000 });
  await queue.load();
  queue.updateSocket(sock);

  // La persistencia (lowdb/steno) también usa setTimeout en sus reintentos: se espera a ready antes de medir.
  await queue.enqueue(msg('c1')).ready;
  await waitFor(() => queue.isPaused);
  assert.equal(queue.pendingCount, 1);
  assert.equal(sock.sent.length, 0);

  mock.timers.tick(59_000);
  await waitFor(() => !queue.isProcessing);
  assert.equal(queue.isPaused, true, 'sigue pausada antes de cumplirse el minuto');

  // Al minuto reanuda, vuelve a fallar y la segunda pausa seguida dura el doble.
  mock.timers.tick(1_000);
  await waitFor(() => failures === 0 && queue.isPaused && !queue.isProcessing);
  assert.equal(sock.sent.length, 0);

  mock.timers.tick(119_000);
  await waitFor(() => !queue.isProcessing);
  assert.equal(queue.isPaused, true, 'la segunda pausa dura dos minutos');

  mock.timers.tick(1_000);
  await waitFor(() => sock.sent.length === 1);
  assert.equal(queue.isPaused, false);
  assert.equal(queue.pendingCount, 0);
  await queue.stop();
});

test('avisa al owner cuando la cola crece o envejece, una vez por ventana', async () => {
  const dir = await tmp();
  let now = 1_000_000;
  const notices: string[] = [];
  const queue = new MessageQueue({ dir, warnQueueSize: 1, warnAgeMs: 15 * 60_000, now: () => now, notify: (t) => { notices.push(t); } });
  await queue.load();
  queue.enqueue(msg('w1'));
  assert.equal(notices.length, 0);
  queue.enqueue(msg('w2'));
  assert.equal(notices.length, 1);
  assert.match(notices[0], /hay 2 mensajes en cola/);
  queue.enqueue(msg('w3'));
  assert.equal(notices.length, 1, 'el aviso se limita a uno por ventana');

  now += 16 * 60_000;
  queue.enqueue(msg('w4'));
  assert.equal(notices.length, 2);
  assert.ok(queue.oldestAgeMs >= 16 * 60_000);
  await queue.stop();
});

test('prepare se ejecuta una sola vez por mensaje aunque el envío se reintente', async () => {
  const dir = await tmp();
  let failures = 2;
  const sock = fakeSock({ failWith: () => (failures-- > 0 ? new Error('Connection Closed') : null) });
  let prepareCalls = 0;
  const onSent: (string | undefined)[] = [];
  const queue = new MessageQueue({
    dir,
    delayBetweenMessages: 0,
    retryDelays: [1],
    maxConsecutiveErrors: 10,
    prepare: (item) => {
      prepareCalls++;
      return { caption: item.text, onSent: (id) => onSent.push(id) };
    },
  });
  await queue.load();
  queue.updateSocket(sock);
  queue.enqueue(msg('r'));
  await waitFor(() => sock.sent.length === 1 && queue.pendingCount === 0);
  assert.equal(prepareCalls, 1);
  assert.deepEqual(onSent, ['wa-1'], 'onSent solo se llama con el envío confirmado');
  queue.enqueue(msg('s'));
  await waitFor(() => sock.sent.length === 2);
  assert.equal(prepareCalls, 2, 'cada mensaje se prepara una vez');
  await queue.stop();
});

test('el orden es el de encolado aunque la media del primero tarde más en descargarse', async () => {
  const dir = await tmp();
  const sock = fakeSock();
  const queue = new MessageQueue({ dir, delayBetweenMessages: 0 });
  await queue.load();
  queue.updateSocket(sock);

  let releaseSlow!: (b: Buffer) => void;
  const slow = new Promise<Buffer>((resolve) => { releaseSlow = resolve; });
  let releaseName!: (n: string) => void;
  const name = new Promise<string>((resolve) => { releaseName = resolve; });
  const first = queue.enqueue(msg('lenta', { mediaType: 'photo', mediaBuffer: slow, senderName: name }));
  queue.enqueue(msg('rapida', { mediaType: 'photo', mediaBuffer: Promise.resolve(Buffer.from('ya')) }));
  queue.enqueue(msg('fallida', { mediaType: 'photo', mediaBuffer: Promise.reject(new Error('timeout de descarga')) }));
  assert.equal(first.item.senderName, 'Desconocido');

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sock.sent.length, 0, 'nada sale antes que el primero');
  releaseName('Ana');
  releaseSlow(Buffer.from('tarde'));
  await waitFor(() => sock.sent.length === 3);
  assert.equal(sock.sent[0].content.caption, '*Ana:* texto lenta');
  assert.equal((sock.sent[0].content.image as Buffer).toString(), 'tarde');
  assert.equal((sock.sent[1].content.image as Buffer).toString(), 'ya');
  assert.equal(sock.sent[2].content.text, '*Tipster:* texto fallida\n\n[media omitida]');
  await queue.stop();
});

test('stop espera a que la media en curso llegue al disco y deja el JSON completo', async () => {
  const dir = await tmp();
  const queue = new MessageQueue({ dir, delayBetweenMessages: 0 });
  await queue.load();
  const big = Buffer.alloc(2 * 1024 * 1024, 1);
  queue.enqueue(msg('grande', { mediaType: 'photo', mediaBuffer: big }));
  await queue.stop();
  const saved = JSON.parse(await readFile(join(dir, 'telegram-queue.json'), 'utf8')) as { queue: QueuedMessage[] };
  assert.equal(saved.queue.length, 1);
  assert.ok(saved.queue[0].mediaPath);
  assert.equal((await readFile(saved.queue[0].mediaPath!)).length, big.length);
});

test('un id repetido no se encola dos veces y la pausa recuerda su motivo', async () => {
  const dir = await tmp();
  const queue = new MessageQueue({ dir, delayBetweenMessages: 0 });
  await queue.load();
  queue.enqueue(msg('dup'));
  queue.enqueue(msg('dup'));
  assert.equal(queue.pendingCount, 1);
  assert.equal(queue.pausedBy, null);
  queue.pause();
  assert.equal(queue.pausedBy, 'manual');
  queue.resume();
  queue.pause(60_000, 'errors');
  assert.equal(queue.pausedBy, 'errors');
  await queue.stop();
});
