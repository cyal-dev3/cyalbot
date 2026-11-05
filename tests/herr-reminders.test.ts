import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setLogLevel } from '../src/lib/logger.js';
import {
  parseDuration, splitReminder, zonedParts, zonedTimestamp, monthDayKey,
  scheduleReminder, listReminders, cancelReminder, runRemindersTick, dailyBirthdayCheck,
  startReminders, stopReminders, MAX_ACTIVE_REMINDERS, MAX_SEND_ATTEMPTS, MAX_LATE_MS, type ReminderDb,
} from '../src/lib/reminders.js';
import { DEFAULT_DATABASE } from '../src/types/database.js';

setLogLevel('error');

const ZONE = 'America/Mexico_City';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 5 de noviembre de 2026 a las 10:00 en Ciudad de México (UTC-6).
const NOW = zonedTimestamp({ year: 2026, month: 11, day: 5, hour: 10, minute: 0 }, ZONE);

function fakeDb(): ReminderDb & { dirty: number } {
  const db = { data: structuredClone(DEFAULT_DATABASE), dirty: 0, markDirty() { db.dirty++; } };
  return db;
}

interface Sent { jid: string; text: string; mentions?: string[] }

function fakeConn(fail = false) {
  const sent: Sent[] = [];
  return {
    sent,
    async sendMessage(jid: string, content: { text?: string; mentions?: string[] }) {
      if (fail) throw new Error('Connection Closed');
      sent.push({ jid, text: content.text ?? '', mentions: content.mentions });
      return undefined;
    },
  };
}

test('zonedTimestamp y zonedParts son inversas', () => {
  const p = zonedParts(NOW, ZONE);
  assert.deepEqual(p, { year: 2026, month: 11, day: 5, hour: 10, minute: 0 });
  assert.equal(monthDayKey(NOW, ZONE), '11-05');
});

test('parseDuration entiende duraciones relativas', () => {
  assert.equal(parseDuration('10m', NOW, ZONE), 10 * 60_000);
  assert.equal(parseDuration('2h', NOW, ZONE), 2 * HOUR);
  assert.equal(parseDuration('1d', NOW, ZONE), DAY);
  assert.equal(parseDuration('en 30 min', NOW, ZONE), 30 * 60_000);
  assert.equal(parseDuration('1.5 horas', NOW, ZONE), 1.5 * HOUR);
  assert.equal(parseDuration('2 semanas', NOW, ZONE), 14 * DAY);
});

test('parseDuration entiende horas y fechas en la zona del bot', () => {
  assert.equal(parseDuration('mañana 9:00', NOW, ZONE), 23 * HOUR);
  assert.equal(parseDuration('mañana', NOW, ZONE), 23 * HOUR);
  assert.equal(parseDuration('hoy 18:30', NOW, ZONE), 8.5 * HOUR);
  // Una hora que ya pasó hoy se entiende para mañana.
  assert.equal(parseDuration('hoy 8:00', NOW, ZONE), 22 * HOUR);
  assert.equal(parseDuration('a las 7pm', NOW, ZONE), 9 * HOUR);
  assert.equal(parseDuration('15/12 18:30', NOW, ZONE), zonedTimestamp({ year: 2026, month: 12, day: 15, hour: 18, minute: 30 }, ZONE) - NOW);
  // Una fecha ya pasada sin año salta al año siguiente.
  assert.equal(parseDuration('1/1', NOW, ZONE), zonedTimestamp({ year: 2027, month: 1, day: 1, hour: 9, minute: 0 }, ZONE) - NOW);
});

test('parseDuration rechaza lo que no entiende o se sale del rango', () => {
  assert.equal(parseDuration('luego', NOW, ZONE), null);
  assert.equal(parseDuration('10', NOW, ZONE), null);
  assert.equal(parseDuration('30s', NOW, ZONE), null);
  assert.equal(parseDuration('400d', NOW, ZONE), null);
  assert.equal(parseDuration('25:00', NOW, ZONE), null);
  assert.equal(parseDuration('32/12', NOW, ZONE), null);
});

test('splitReminder separa el cuándo del texto probando prefijos largos primero', () => {
  assert.deepEqual(splitReminder('en 30 min sacar la pizza', NOW, ZONE), { at: NOW + 30 * 60_000, text: 'sacar la pizza' });
  assert.deepEqual(splitReminder('mañana 9:00 llamar al dentista', NOW, ZONE), { at: NOW + 23 * HOUR, text: 'llamar al dentista' });
  assert.deepEqual(splitReminder('10m revisar', NOW, ZONE), { at: NOW + 10 * 60_000, text: 'revisar' });
  assert.equal(splitReminder('10m', NOW, ZONE), null);
  assert.equal(splitReminder('comprar pan', NOW, ZONE), null);
});

test('scheduleReminder respeta el máximo por usuario y cancelReminder acepta el final del id', () => {
  const db = fakeDb();
  for (let i = 0; i < MAX_ACTIVE_REMINDERS; i++) {
    const r = scheduleReminder({ chat: 'g@g.us', user: 'u1', text: `r${i}`, at: NOW + 1000 * (i + 1) }, db);
    assert.notEqual(r, 'limit');
  }
  assert.equal(scheduleReminder({ chat: 'g@g.us', user: 'u1', text: 'extra', at: NOW + 1 }, db), 'limit');
  assert.notEqual(scheduleReminder({ chat: 'g@g.us', user: 'u2', text: 'otro', at: NOW + 1 }, db), 'limit');
  assert.equal(listReminders('u1', db).length, MAX_ACTIVE_REMINDERS);

  const first = listReminders('u1', db)[0];
  assert.equal(cancelReminder('u2', first.id, db), null);
  assert.equal(cancelReminder('u1', first.id.slice(-3).toUpperCase(), db)?.id, first.id);
  assert.equal(listReminders('u1', db).length, MAX_ACTIVE_REMINDERS - 1);
  assert.ok(db.dirty > 0);
});

test('runRemindersTick envía los vencidos con mención, conserva los futuros y purga los viejos', async () => {
  const db = fakeDb();
  const conn = fakeConn();
  const due = scheduleReminder({ chat: 'g@g.us', user: '521234@s.whatsapp.net', text: 'sacar la pizza', at: NOW - 1 }, db);
  const future = scheduleReminder({ chat: 'g@g.us', user: '521234@s.whatsapp.net', text: 'más tarde', at: NOW + HOUR }, db);
  assert.notEqual(due, 'limit');
  assert.notEqual(future, 'limit');
  db.data.reminders!.push({ id: 'old01', chat: 'g@g.us', user: 'x', text: 'viejo', at: NOW - 10 * DAY, createdAt: NOW - 10 * DAY, firedAt: NOW - 8 * DAY });

  assert.equal(await runRemindersTick(NOW, db, conn), 1);
  assert.deepEqual(conn.sent, [{ jid: 'g@g.us', text: '⏰ @521234: sacar la pizza', mentions: ['521234@s.whatsapp.net'] }]);
  assert.equal(db.data.reminders!.find((r) => r.id === 'old01'), undefined);
  assert.equal(listReminders('521234@s.whatsapp.net', db).length, 1);

  // Un segundo tick no reenvía el ya disparado.
  assert.equal(await runRemindersTick(NOW + 1000, db, conn), 0);
});

test('si el envío falla el recordatorio queda pendiente para el siguiente tick', async () => {
  const db = fakeDb();
  scheduleReminder({ chat: 'g@g.us', user: 'u', text: 'x', at: NOW - 1 }, db);
  assert.equal(await runRemindersTick(NOW, db, fakeConn(true)), 0);
  assert.equal(listReminders('u', db).length, 1);
  assert.equal(await runRemindersTick(NOW, db, fakeConn()), 1);
});

test('startReminders dispara con el tick de 30 s (mock timers)', async (t) => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: NOW });
  t.after(() => {
    stopReminders();
    mock.timers.reset();
  });
  const db = fakeDb();
  const conn = fakeConn();
  scheduleReminder({ chat: 'g@g.us', user: 'u', text: 'en un minuto', at: NOW + 60_000 }, db);

  startReminders(conn, db);
  await flush();
  assert.equal(conn.sent.length, 0);

  mock.timers.tick(30_000);
  await flush();
  assert.equal(conn.sent.length, 0);

  mock.timers.tick(30_000);
  await flush();
  assert.equal(conn.sent.length, 1);
  assert.match(conn.sent[0].text, /en un minuto/);
});

test('dailyBirthdayCheck felicita solo a miembros del grupo con aviso activado', async () => {
  const db = fakeDb();
  db.data.birthdays = { 'a@s.whatsapp.net': '11-05', 'b@s.whatsapp.net': '11-05', 'c@s.whatsapp.net': '12-25' };
  db.data.chats['g1@g.us'] = { ...structuredClone(db.data.chats['x'] ?? {}), birthdayAnnounce: true } as never;
  db.data.chats['g2@g.us'] = { birthdayAnnounce: false } as never;
  const conn = {
    ...fakeConn(),
    async groupMetadata(jid: string) {
      return { participants: jid === 'g1@g.us' ? [{ id: 'a@s.whatsapp.net' }, { id: 'c@s.whatsapp.net' }] : [] } as never;
    },
  };
  assert.equal(await dailyBirthdayCheck(conn as never, db, NOW), 1);
  assert.equal(conn.sent.length, 1);
  assert.equal(conn.sent[0].jid, 'g1@g.us');
  assert.deepEqual(conn.sent[0].mentions, ['a@s.whatsapp.net']);
  assert.match(conn.sent[0].text, /@a/);
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

test('un recordatorio que no se puede enviar se descarta tras varios intentos en vez de reintentarse para siempre', async () => {
  const db = fakeDb();
  scheduleReminder({ chat: 'g@g.us', user: 'u', text: 'x', at: NOW - 1 }, db);
  const broken = fakeConn(true);
  for (let i = 1; i < MAX_SEND_ATTEMPTS; i++) {
    assert.equal(await runRemindersTick(NOW + i, db, broken), 0);
    assert.equal(listReminders('u', db).length, 1, `sigue activo tras ${i} intentos`);
    assert.equal(db.data.reminders![0].attempts, i);
  }
  assert.equal(await runRemindersTick(NOW + MAX_SEND_ATTEMPTS, db, broken), 0);
  assert.equal(listReminders('u', db).length, 0, 'descartado al agotar los intentos');
  assert.ok(db.data.reminders![0].firedAt);

  // Con más de un día de retraso se descarta al primer fallo.
  const late = fakeDb();
  scheduleReminder({ chat: 'g@g.us', user: 'u', text: 'tarde', at: NOW - MAX_LATE_MS - 1 }, late);
  await runRemindersTick(NOW, late, broken);
  assert.equal(listReminders('u', late).length, 0);
});

test('si el autor ya no está en el grupo el recordatorio le llega en privado', async () => {
  const db = fakeDb();
  scheduleReminder({ chat: 'g@g.us', user: 'fuera@s.whatsapp.net', text: 'uno', at: NOW - 1 }, db);
  scheduleReminder({ chat: 'g@g.us', user: 'dentro@s.whatsapp.net', text: 'dos', at: NOW - 1 }, db);
  scheduleReminder({ chat: 'lid@g.us', user: '111@lid', text: 'tres', at: NOW - 1 }, db);
  let metadataCalls = 0;
  const conn = {
    ...fakeConn(),
    async groupMetadata(jid: string) {
      metadataCalls++;
      return { participants: jid === 'g@g.us' ? [{ id: 'dentro@s.whatsapp.net' }] : [{ id: '111@lid', jid: '5211@s.whatsapp.net', lid: '111@lid' }] } as never;
    },
  };
  assert.equal(await runRemindersTick(NOW, db, conn as never), 3);
  assert.deepEqual(conn.sent.map((s) => s.jid), ['fuera@s.whatsapp.net', 'g@g.us', 'lid@g.us']);
  assert.equal(metadataCalls, 2, 'la metadata de cada grupo se pide una vez por tick');
});

test('dailyBirthdayCheck reconoce al cumpleañero aunque el grupo use LID', async () => {
  const db = fakeDb();
  db.data.birthdays = { '5215555@s.whatsapp.net': '11-05' };
  db.data.chats['g@g.us'] = { birthdayAnnounce: true } as never;
  const conn = {
    ...fakeConn(),
    async groupMetadata() {
      return { participants: [{ id: '999@lid', lid: '999@lid', jid: '5215555@s.whatsapp.net' }] } as never;
    },
  };
  assert.equal(await dailyBirthdayCheck(conn as never, db, NOW), 1);
  assert.deepEqual(conn.sent[0].mentions, ['5215555@s.whatsapp.net']);
});
