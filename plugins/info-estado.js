import os from "os";
import { performance } from "perf_hooks";

const handler = async (m, { conn, usedPrefix }) => {
  const _uptime = process.uptime() * 1000;
  const uptime = clockString(_uptime);
  const totalusrReg = Object.values(global.db.data.users).filter((user) => user.registered == true).length;
  const totalusr = Object.keys(global.db.data.users).length;
  const chats = Object.entries(conn.chats).filter(
    ([id, data]) => id && data.isChats,
  );
  const groups = chats.filter(([id]) => id.endsWith("@g.us"));
  const { restrict, antiCall, antiprivado, modejadibot } =
    global.db.data.settings[conn.user.jid] || {};
  const { autoread, gconly, pconly, self } = global.opts || {};
  const old = performance.now();
  const neww = performance.now();
  const rtime = (neww - old).toFixed(4);

  const info = `╭─ Estado del Bot ─╮
│ Owner: Cyal
│ Numero: wa.me/523314429560
│
│ Ping: ${rtime}ms
│ Uptime: ${uptime}
│ Prefijo: ${usedPrefix}
│ Modo: ${self ? "privado" : "publico"}
│
│ Registrados: ${totalusrReg}
│ Usuarios: ${totalusr}
│ Chats: ${chats.length - groups.length}
│ Grupos: ${groups.length}
│
│ Autoread: ${autoread ? "on" : "off"}
│ Restrict: ${restrict ? "on" : "off"}
│ Solo PC: ${pconly ? "on" : "off"}
│ Solo GC: ${gconly ? "on" : "off"}
│ Anti privado: ${antiprivado ? "on" : "off"}
│ Anti call: ${antiCall ? "on" : "off"}
│ Jadibot: ${modejadibot ? "on" : "off"}
╰──────────────────╯`;

  await conn.sendMessage(m.chat, { text: info.trim() }, { quoted: m });
};

handler.command = /^(ping|info|status|estado|infobot)$/i;
export default handler;

function clockString(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return [h, m, s].map((v) => v.toString().padStart(2, 0)).join(":");
}
