
const handler = async (m, {conn}) => {
  const datas = global
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/es.json`))
  const tradutor = _translate.plugins.maker_gay

  const vn = './src/assets/audio/01J673A5RN30C5EYPMKE5MR9XQ.mp3';
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
  await conn.sendFile(m.chat, global.API('https://some-random-api.com', '/canvas/gay', {
    avatar: avatar,
  }), 'gay.png', tradutor.texto1, m);
  await conn.sendMessage(m.chat, {audio: {url: vn}, fileName: `error.mp3`, mimetype: 'audio/mpeg', ptt: true}, {quoted: m});
};
handler.help = ['gay'];
handler.tags = ['maker'];
handler.command = /^(gay)$/i;
export default handler;
