const handler = async (m, {conn, usedPrefix}) => {
  const text = `╭─ Owner ─╮
│ Nombre: Cyal
│ Numero: wa.me/523314429560
╰──────────╯`;

  await conn.sendMessage(m.chat, { text: text.trim() }, { quoted: m });
};

handler.help = ['owner'];
handler.tags = ['info'];
handler.command = /^(owner|creator|creador|propietario)$/i;

export default handler;
