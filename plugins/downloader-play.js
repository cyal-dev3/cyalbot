import fs from 'fs'
import fetch from 'node-fetch'
import yts from 'yt-search'
import ytmp33 from '../src/libraries/ytmp33.js'

let handler = async (m, { conn, args, text, usedPrefix, command }) => {
  const datas = global;
  const idioma = datas.db.data.users[m.sender].language || global.defaultLenguaje;
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/${idioma}.json`));
  const tradutor = _translate.plugins.descargas_play

  if (!text) throw `${tradutor.texto1[0]} ${usedPrefix + command} ${tradutor.texto1[1]}`;
  let additionalText = '';
  if (['play'].includes(command)) {
    additionalText = 'audio';
  } else if (['play2'].includes(command)) {
    additionalText = 'vídeo';
  }

  const regex = "https://youtube.com/watch?v="
  const result = await search(args.join(' '))
  const body = `${tradutor.texto2[0]} ${result.title}\n${tradutor.texto2[1]} ${result.ago}\n${tradutor.texto2[2]} ${result.duration.timestamp}\n${tradutor.texto2[3]} ${formatNumber(result.views)}\n${tradutor.texto2[4]} ${result.author.name}\n${tradutor.texto2[5]} ${result.videoId}\n${tradutor.texto2[6]} ${result.type}\n${tradutor.texto2[7]} ${result.url}\n${tradutor.texto2[8]} ${result.author.url}\n\n${tradutor.texto2[9]} ${additionalText}, ${tradutor.texto2[10]}`.trim();
  conn.sendMessage(m.chat, { image: { url: result.thumbnail }, caption: body }, { quoted: m });

  if (command === 'play') {
    try {
      // Usar ytmp33 (notube.net)
      const audiodlp = await ytmp33(regex + result.videoId);
      if (audiodlp?.status && audiodlp?.resultados?.descargar) {
        const downloader = audiodlp.resultados.descargar;
        await conn.sendMessage(m.chat, { audio: { url: downloader }, mimetype: "audio/mpeg" }, { quoted: m });
      } else {
        throw new Error('ytmp33 no devolvió resultado válido');
      }
    } catch (error) {
      console.log('❌ Error en ytmp33, intentando Ruby-core fallback...', error);
      try {
        const ruby = await (
          await fetch(
            `https://ruby-core.vercel.app/api/download/youtube/mp3?url=${encodeURIComponent(regex + result.videoId)}`
          )
        ).json();
        if (ruby?.status && ruby?.download?.url) {
          const audioLink = ruby.download.url;
          await conn.sendMessage(
            m.chat,
            { audio: { url: audioLink }, mimetype: "audio/mpeg" },
            { quoted: m }
          );
        } else {
          throw new Error('Ruby-core no devolvió resultado válido');
        }
      } catch (err2) {
        console.log('❌ Falla en Ruby-core, intentando API Delirius...', err2);
        try {
          const delirius = await (
            await fetch(
              `${global.BASE_API_DELIRIUS}/api/download/ytmp3?url=${encodeURIComponent(regex + result.videoId)}`
            )
          ).json();
          if (delirius?.status && delirius?.data?.download?.url) {
            await conn.sendMessage(
              m.chat,
              { audio: { url: delirius.data.download.url }, mimetype: "audio/mpeg" },
              { quoted: m }
            );
          } else {
            conn.reply(m.chat, tradutor.texto6, m);
          }
        } catch (err3) {
          console.log('❌ Falla en API Delirius mp3:', err3);
          conn.reply(m.chat, tradutor.texto6, m);
        }
      }
    }
  }

  if (command === 'play2') {
    try {
      // Intentar Ruby-core primero para videos
      const ruby = await (
        await fetch(
          `https://ruby-core.vercel.app/api/download/youtube/mp4?url=${encodeURIComponent(regex + result.videoId)}`
        )
      ).json();
      if (ruby?.status && ruby?.download?.url) {
        const videoLink = ruby.download.url;
        await conn.sendMessage(
          m.chat,
          { video: { url: videoLink }, mimetype: "video/mp4" },
          { quoted: m }
        );
      } else {
        throw new Error('Ruby-core mp4 no devolvió resultado válido');
      }
    } catch (error) {
      console.log('❌ Error en Ruby-core mp4, intentando API Delirius...', error);
      try {
        const delirius = await (
          await fetch(
            `${global.BASE_API_DELIRIUS}/api/download/ytmp4?url=${encodeURIComponent(regex + result.videoId)}`
          )
        ).json();
        if (delirius?.status && delirius?.data?.download?.url) {
          await conn.sendMessage(
            m.chat,
            { video: { url: delirius.data.download.url }, mimetype: "video/mp4" },
            { quoted: m }
          );
        } else {
          conn.reply(m.chat, tradutor.texto6, m);
        }
      } catch (err2) {
        console.log('❌ Falla en API Delirius mp4:', err2);
        conn.reply(m.chat, tradutor.texto6, m);
      }
    }
  }
};

handler.help = ['play', 'play2'];
handler.tags = ['downloader'];
//handler.command = ['play', 'play2'];

export default handler;

async function search(query, options = {}) {
  const searchRes = await yts.search({ query, hl: 'es', gl: 'ES', ...options });
  return searchRes.videos[0];
}

function formatNumber(num) {
  return num.toLocaleString();
}
