const handler = async (m, {conn, args}) => {
  const text = args.slice(1).join(' ');
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
  const name = conn.getName(who);
  conn.sendFile(m.chat, global.API('https://some-random-api.com', '/canvas/its-so-stupid', {
    avatar: avatar,
    dog: text || 'im+stupid',
  }), 'itssostupid.png', `*@${name}*`, m, {mentions: [who]});
};
handler.help = ['itssostupid', 'iss', 'stupid'];
handler.tags = ['maker'];
handler.command = /^(itssostupid|iss|stupid)$/i;
export default handler;
