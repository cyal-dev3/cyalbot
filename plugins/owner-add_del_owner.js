
const handler = async (m, { conn, text, args, usedPrefix, command }) => {
  const datas = global
  const idioma = datas.db.data.users[m.sender].language || global.defaultLenguaje
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/${idioma}.json`))
  const tradutor = _translate.plugins.owner_add_del_owner

  const why = `${tradutor.texto1[0]} ${usedPrefix + command}* @${m.sender.split('@')[0]}\n*◉ ${usedPrefix + command}* ${m.sender.split('@')[0]}\n*◉ ${usedPrefix + command}* <responder>`;
  let who;
  const mentioned = await m.mentionedJid;
  if (mentioned && mentioned[0]) {
    who = mentioned[0];
  } else if (m.quoted) {
    who = await m.quoted.sender;
  } else if (text) {
    who = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
  } else {
    who = false;
  }
  if (!who) return conn.reply(m.chat, why, m, {mentions: [m.sender]});
  switch (command) {
    case 'addowner':
      const nuevoNumero = who;
      global.owner.push([nuevoNumero]);
      await conn.reply(m.chat, tradutor.texto2, m);
      break;
    case 'delowner':
      const numeroAEliminar = who;
      const index = global.owner.findIndex(owner => owner[0] === numeroAEliminar);
      if (index !== -1) {
        global.owner.splice(index, 1);
        await conn.reply(m.chat, tradutor.texto3, m);
      } else {
        await conn.reply(m.chat, tradutor.texto4, m);
      }
      break;
  }
};
handler.command = /^(addowner|delowner)$/i;
handler.rowner = true;
export default handler;
