import uploadImage from '../src/libraries/uploadImage.js';

const handler = async (m) => {
  const datas = global;
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/es.json`));
  const tradutor = _translate.plugins.convertidor_tourl;

  const q = m.quoted ? m.quoted : m
  const mime = (q.msg || q).mimetype || ''
  if (!mime) throw `*${tradutor.texto1}*`;
  const buffer = await q.download();
  const link = await uploadImage(buffer);
  m.reply(`*${tradutor.texto2}* ${link}`);
};

handler.help = ['tourl'];
handler.tags = ['converter'];
handler.command = ['upload', 'uploader', 'tourl'];

export default handler;
