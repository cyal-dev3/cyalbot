const handler = async (m, {conn, args}) => {
  const datas = global
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/es.json`))
  const tradutor = _translate.plugins.gc_setdesc

  await conn.groupUpdateDescription(m.chat, `${args.join(' ')}`);
  m.reply(tradutor.texto1);
};
handler.help = ['setdesc <text>'];
handler.tags = ['group'];
handler.command = /^setdesc$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
export default handler;
