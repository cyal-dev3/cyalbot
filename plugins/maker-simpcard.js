

const handler = async (m, {conn}) => {
  const datas = global
  const idioma = datas.db.data.users[m.sender].language || global.defaultLenguaje
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/${idioma}.json`))
  const tradutor = _translate.plugins.maker_simpcard

  let who;
  if (m.quoted) {
    who = await m.quoted.sender;
  } else {
    const mentioned = await m.mentionedJid;
    if (mentioned && mentioned[0]) {
      who = mentioned[0];
    } else {
      who = m.fromMe ? conn.user.jid : m.sender;
    }
  }
  const avatar = await conn.profilePictureUrl(who, 'image').catch((_) => 'https://telegra.ph/file/24fa902ead26340f3df2c.png');
  conn.sendFile(m.chat, global.API('https://some-random-api.com', '/canvas/simpcard', {
    avatar: avatar,
  }), 'simpcard.png', tradutor.texto1, m);
};
handler.help = ['simpcard'];
handler.tags = ['maker'];
handler.command = /^(simpcard)$/i;
export default handler;
