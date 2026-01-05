const handler = async (m, {conn, usedPrefix}) => {
  const text = `╭─ Host Info ─╮
│ Bot: Cyal Bot
│ Owner: Cyal
│ Numero: wa.me/523314429560
╰─────────────╯`;

  await conn.sendMessage(m.chat, { text: text.trim() }, { quoted: m });
};

handler.command = ['host'];
export default handler;
