const handler = async (m, { conn, usedPrefix, command }) => {
  const text = `╭─ Donaciones ─╮
│
│ Hola ${m?.name || 'usuario'}!
│
│ Si te gusta el bot,
│ puedes apoyar el proyecto.
│
│ Contacto:
│ wa.me/523314429560
│
╰──────────────╯`;

  await conn.sendMessage(m.chat, { text: text.trim() }, { quoted: m });
};

handler.help = ['donate'];
handler.tags = ['info'];
handler.command = /^(donate|donar|apoyar|donacion|apoyo)$/i;
export default handler;
