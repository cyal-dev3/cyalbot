

const handler = async (m, {conn, usedprefix}) => {
  const datas = global
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/es.json`))
  const tradutor = _translate.plugins.maker_blur

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
  conn.sendFile(m.chat, global.API('https://some-random-api.com', '/canvas/blur', {
    avatar: avatar,
  }), 'blur.png', tradutor.texto1, m);
};
handler.help = ['blur', 'difuminar2'];
handler.tags = ['maker'];
handler.command = /^(blur|difuminar2)$/i;
export default handler;
