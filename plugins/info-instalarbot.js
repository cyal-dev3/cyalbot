const handler = async (m, {conn, usedPrefix}) => {
  const text = `╭─ Instalar Bot ─╮
│
│ Contacta al owner para
│ mas informacion sobre
│ como instalar tu propio bot.
│
│ Contacto:
│ wa.me/523314429560
│
╰────────────────╯`;

  await conn.sendMessage(m.chat, { text: text.trim() }, { quoted: m });
};

handler.command = ['instalarbot'];
export default handler;
