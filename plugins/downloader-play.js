import fs from 'fs'
import fetch from 'node-fetch'
import yts from 'yt-search'
import ytmp33 from '../src/libraries/ytmp33.js'
import { ogmp3 } from '../src/libraries/youtubedl.js'

// Función para descargar audio como buffer y validar
async function downloadAndValidate(url) {
  const response = await fetch(url, { timeout: 30000 });
  const buffer = Buffer.from(await response.arrayBuffer());

  // Un audio de al menos 1 minuto en MP3 128kbps = ~960KB mínimo
  // Usamos 500KB como mínimo para ser seguros
  if (buffer.length < 500000) {
    throw new Error(`Audio muy pequeño: ${(buffer.length / 1024).toFixed(1)}KB (mínimo 500KB)`);
  }

  // Verificar que sea un MP3 válido (ID3 tag o frame sync)
  const isValidMp3 = (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) || // ID3
                    (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0); // Frame sync

  if (!isValidMp3) {
    throw new Error('El archivo descargado no es un MP3 válido');
  }

  return buffer;
}

let handler = async (m, { conn, args, text, usedPrefix, command }) => {
  const datas = global;
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/es.json`));
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
    const videoUrl = regex + result.videoId;
    let audioBuffer = null;
    let errorMessages = [];

    // Intento 1: ogmp3 (apiapi.lat) - MÁS CONFIABLE
    try {
      console.log('🎵 Intentando ogmp3 (apiapi.lat)...');
      const ogResult = await ogmp3.download(videoUrl, '320', 'audio');
      if (ogResult?.status && ogResult?.result?.download) {
        audioBuffer = await downloadAndValidate(ogResult.result.download);
        console.log('✅ ogmp3 exitoso, tamaño:', audioBuffer.length);
      } else {
        throw new Error(ogResult?.error || 'No se obtuvo resultado válido');
      }
    } catch (error) {
      errorMessages.push(`ogmp3: ${error.message}`);
      console.log('❌ Error en ogmp3:', error.message);
    }

    // Intento 2: ytmp33 (notube.net)
    if (!audioBuffer) {
      try {
        console.log('🎵 Intentando ytmp33 (notube.net)...');
        const audiodlp = await ytmp33(videoUrl);
        if (audiodlp?.status && audiodlp?.resultados?.descargar) {
          audioBuffer = await downloadAndValidate(audiodlp.resultados.descargar);
          console.log('✅ ytmp33 exitoso, tamaño:', audioBuffer.length);
        } else {
          throw new Error('ytmp33 no devolvió resultado válido');
        }
      } catch (error) {
        errorMessages.push(`ytmp33: ${error.message}`);
        console.log('❌ Error en ytmp33:', error.message);
      }
    }

    // Intento 3: Ruby-core
    if (!audioBuffer) {
      try {
        console.log('🎵 Intentando Ruby-core...');
        const ruby = await (
          await fetch(
            `https://ruby-core.vercel.app/api/download/youtube/mp3?url=${encodeURIComponent(videoUrl)}`,
            { timeout: 30000 }
          )
        ).json();
        if (ruby?.status && ruby?.download?.url) {
          audioBuffer = await downloadAndValidate(ruby.download.url);
          console.log('✅ Ruby-core exitoso, tamaño:', audioBuffer.length);
        } else {
          throw new Error('Ruby-core no devolvió resultado válido');
        }
      } catch (err2) {
        errorMessages.push(`Ruby-core: ${err2.message}`);
        console.log('❌ Error en Ruby-core:', err2.message);
      }
    }

    // Intento 3: API Delirius
    if (!audioBuffer) {
      try {
        console.log('🎵 Intentando API Delirius...');
        const delirius = await (
          await fetch(
            `${global.BASE_API_DELIRIUS}/api/download/ytmp3?url=${encodeURIComponent(videoUrl)}`,
            { timeout: 30000 }
          )
        ).json();
        if (delirius?.status && delirius?.data?.download?.url) {
          audioBuffer = await downloadAndValidate(delirius.data.download.url);
          console.log('✅ Delirius exitoso, tamaño:', audioBuffer.length);
        } else {
          throw new Error('Delirius no devolvió resultado válido');
        }
      } catch (err3) {
        errorMessages.push(`Delirius: ${err3.message}`);
        console.log('❌ Error en Delirius:', err3.message);
      }
    }

    // Intento 4: cobalt.tools API
    if (!audioBuffer) {
      try {
        console.log('🎵 Intentando cobalt.tools...');
        const cobaltResponse = await fetch('https://api.cobalt.tools/api/json', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: videoUrl,
            vCodec: 'h264',
            vQuality: '720',
            aFormat: 'mp3',
            isAudioOnly: true
          }),
          timeout: 30000
        });
        const cobalt = await cobaltResponse.json();
        if (cobalt?.status === 'stream' && cobalt?.url) {
          audioBuffer = await downloadAndValidate(cobalt.url);
          console.log('✅ cobalt.tools exitoso, tamaño:', audioBuffer.length);
        } else if (cobalt?.status === 'redirect' && cobalt?.url) {
          audioBuffer = await downloadAndValidate(cobalt.url);
          console.log('✅ cobalt.tools redirect exitoso, tamaño:', audioBuffer.length);
        } else {
          throw new Error('cobalt.tools no devolvió resultado válido');
        }
      } catch (err4) {
        errorMessages.push(`cobalt: ${err4.message}`);
        console.log('❌ Error en cobalt.tools:', err4.message);
      }
    }

    // Intento 5: nyxs.pw API
    if (!audioBuffer) {
      try {
        console.log('🎵 Intentando nyxs.pw...');
        const nyxs = await (
          await fetch(`https://api.nyxs.pw/dl/yt-direct?url=${encodeURIComponent(videoUrl)}`, { timeout: 30000 })
        ).json();
        if (nyxs?.status && nyxs?.result?.audioUrl) {
          audioBuffer = await downloadAndValidate(nyxs.result.audioUrl);
          console.log('✅ nyxs.pw exitoso, tamaño:', audioBuffer.length);
        } else {
          throw new Error('nyxs.pw no devolvió resultado válido');
        }
      } catch (err5) {
        errorMessages.push(`nyxs: ${err5.message}`);
        console.log('❌ Error en nyxs.pw:', err5.message);
      }
    }

    // Intento 6: vreden API
    if (!audioBuffer) {
      try {
        console.log('🎵 Intentando vreden...');
        const vreden = await (
          await fetch(`https://api.vreden.my.id/api/ytmp3?url=${encodeURIComponent(videoUrl)}`, { timeout: 30000 })
        ).json();
        if (vreden?.status && vreden?.result?.download?.url) {
          audioBuffer = await downloadAndValidate(vreden.result.download.url);
          console.log('✅ vreden exitoso, tamaño:', audioBuffer.length);
        } else {
          throw new Error('vreden no devolvió resultado válido');
        }
      } catch (err6) {
        errorMessages.push(`vreden: ${err6.message}`);
        console.log('❌ Error en vreden:', err6.message);
      }
    }

    // Intento 7: lolhuman API
    if (!audioBuffer) {
      try {
        console.log('🎵 Intentando lolhuman...');
        const lol = await (
          await fetch(`https://api.lolhuman.xyz/api/ytaudio?apikey=GataDios&url=${encodeURIComponent(videoUrl)}`, { timeout: 30000 })
        ).json();
        if (lol?.status === 200 && lol?.result?.link) {
          audioBuffer = await downloadAndValidate(lol.result.link);
          console.log('✅ lolhuman exitoso, tamaño:', audioBuffer.length);
        } else {
          throw new Error('lolhuman no devolvió resultado válido');
        }
      } catch (err7) {
        errorMessages.push(`lolhuman: ${err7.message}`);
        console.log('❌ Error en lolhuman:', err7.message);
      }
    }

    // Enviar audio si se obtuvo correctamente
    if (audioBuffer && audioBuffer.length > 500000) {
      await conn.sendMessage(
        m.chat,
        { audio: audioBuffer, mimetype: "audio/mpeg" },
        { quoted: m }
      );
    } else {
      console.log('❌ Todos los servicios fallaron:', errorMessages.join(' | '));
      conn.reply(m.chat, `${tradutor.texto6}\n\n_Errores: ${errorMessages.join(', ')}_`, m);
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
