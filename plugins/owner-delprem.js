

const handler = async (m, {conn, text, usedPrefix, command}) => {
  const datas = global
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/es.json`))
  const tradutor = _translate.plugins.owner_delprem

  let who;
  if (m.isGroup) {
    const mentioned = await m.mentionedJid;
    if (mentioned && mentioned[0]) {
      who = mentioned[0];
    } else if (m.quoted) {
      who = await m.quoted.sender;
    } else {
      who = false;
    }
  } else {
    who = m.chat;
  }
  const user = global.db.data.users[who];
  if (!who) throw tradutor.texto1;
  if (!user) throw tradutor.texto2;
  if (user.premiumTime = 0) throw tradutor.texto3;
  const txt = text.replace('@' + who.split`@`[0], '').trim();

  user.premiumTime = 0;

  user.premium = false;

  const textdelprem = `*[❗] @${who.split`@`[0]} ${tradutor.texto4}`;
  m.reply(textdelprem, null, {mentions: conn.parseMention(textdelprem)});
};
handler.help = ['delprem <@user>'];
handler.tags = ['owner'];
handler.command = /^(remove|-|del)prem$/i;
handler.group = true;
handler.rowner = true;
export default handler;
