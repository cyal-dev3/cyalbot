const handler = async (m, {conn, usedPrefix, text}) => {
  const datas = global
  const idioma = datas.db.data.users[m.sender].language || global.defaultLenguaje
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/${idioma}.json`))
  const tradutor = _translate.plugins.gc_promote

  if (isNaN(text) && !text.match(/@/g)) {

  } else if (isNaN(text)) {
    var number = text.split`@`[1];
  } else if (!isNaN(text)) {
    var number = text;
  }

  if (!text && !m.quoted) return conn.reply(m.chat, `${tradutor.texto1[0]}\n\n*┯┷*\n*┠≽ ${usedPrefix}daradmin @tag*\n*┠≽ ${usedPrefix}darpoder ${tradutor.texto1[1]}\n*┷┯*`, m);
  if (number.length > 13 || (number.length < 11 && number.length > 0)) return conn.reply(m.chat, tradutor.texto2, m);

  try {
    var user;
    if (text) {
      user = number + '@s.whatsapp.net';
    } else if (m.quoted) {
      user = await m.quoted.sender;
    } else {
      const mentioned = await m.mentionedJid;
      if (mentioned && mentioned[0]) {
        user = mentioned[0];
      } else {
        user = number + '@s.whatsapp.net';
      }
    }
  } catch (e) {
  } finally {
    conn.groupParticipantsUpdate(m.chat, [user], 'promote');
    conn.reply(m.chat, tradutor.texto3, m);
  }
};
handler.help = ['promote'].map((v) => 'mention ' + v);
handler.tags = ['group'];
handler.command = /^(promote|daradmin|darpoder)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
handler.fail = null;
export default handler;
