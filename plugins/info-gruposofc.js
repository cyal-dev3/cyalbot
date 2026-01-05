const handler = async (m, {conn, usedPrefix}) => {
  const text = `╭─ Grupos ─╮
│
│ Por el momento no hay
│ grupos oficiales disponibles.
│
│ Contacto:
│ wa.me/523314429560
│
╰──────────╯`;

  await conn.sendMessage(m.chat, { text: text.trim() }, { quoted: m });
};

handler.command = ['linkgc', 'grupos'];
export default handler;
