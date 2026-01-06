
const handler = async (m, {text, conn, usedPrefix, command}) => {
  const datas = global
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/es.json`))
  const tradutor = _translate.plugins.owner_block_unblock

  const why = `${tradutor.texto1} ${usedPrefix + command} @${m.sender.split('@')[0]}*`;
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
  if (!who) conn.reply(m.chat, why, m, {mentions: [m.sender]});
  const res = [];
  switch (command) {
    case 'blok': case 'block':
      if (who) {
        await conn.updateBlockStatus(who, 'block').then(() => {
          res.push(who);
        });
      } else conn.reply(m.chat, why, m, {mentions: [m.sender]});
      break;
    case 'unblok': case 'unblock':
      if (who) {
        await conn.updateBlockStatus(who, 'unblock').then(() => {
          res.push(who);
        });
      } else conn.reply(m.chat, why, m, {mentions: [m.sender]});
      break;
  }
  if (res[0]) conn.reply(m.chat, `${tradutor.texto2[0]} ${command} ${tradutor.texto2[1]} ${res ? `${res.map((v) => '@' + v.split('@')[0])}` : ''}*`, m, {mentions: res});
};
handler.command = /^(block|unblock)$/i;
handler.rowner = true;
export default handler;
