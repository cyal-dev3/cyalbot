// Plugin para test de comandos - powered by @Cyal
// Si vas a robar deja creditos o doname >:v
import yts from 'yt-search';
import fetch from 'node-fetch';
import axios from 'axios';
import NodeID3 from 'node-id3';
import fs from 'fs';
import { load } from 'cheerio';
import ytmp33 from '../src/libraries/ytmp33.js';
const { generateWAMessageFromContent, prepareWAMessageMedia } = (await import("baileys")).default;

const AUDIO_SIZE_LIMIT = 50 * 1024 * 1024;
const VIDEO_SIZE_LIMIT = 100 * 1024 * 1024;

let handler = async (m, { conn, args, usedPrefix, command }) => {
    const _translate = JSON.parse(fs.readFileSync(`./src/languages/es/${m.plugin}.json`));
    const tradutor = _translate._testting;
    
    try {
        const query = args.join(' ');
        if (!query) return m.reply(tradutor.errors.no_query.replace('@command', usedPrefix + command));

        let video;
        const isYouTubeUrl = isValidYouTubeUrl(query);
        
        if (isYouTubeUrl) {
            video = await getVideoInfoFromUrl(query);
        } else {
            const { videos } = await yts(query);
            if (!videos || videos.length === 0) return m.reply(tradutor.errors.no_results);
            video = videos[0];
        }

        const videoInfoMsg = `${tradutor.video_info.header}\n\n${tradutor.video_info.title.replace('@title', video.title)}\n${tradutor.video_info.author.replace('@author', video.author.name)}\n${tradutor.video_info.duration.replace('@duration', video.duration?.timestamp || '00:00')}\n${tradutor.video_info.views.replace('@views', (video.views || 0).toLocaleString())}\n${tradutor.video_info.published.replace('@published', video.ago || 'Desconocido')}\n${tradutor.video_info.id.replace('@id', video.videoId)}\n${tradutor.video_info.link.replace('@link', video.url)}`.trim();

        if (command !== 'ytmp3' && command !== 'ytmp4') { 
            conn.sendMessage(m.chat, { image: { url: video.thumbnail }, caption: videoInfoMsg }, { quoted: m });
        }

        const isAudio = command === 'test' || command === 'play' || command === 'ytmp3';
        const format = isAudio ? 'mp3' : '720p';

        let mediaUrl = null;

        if (isAudio) {
            // Intentar múltiples APIs para audio
            // 1. Intentar ssvid.net primero
            try {
                const downloadResult = await yt.download(video.url, format);
                if (downloadResult?.dlink) {
                    mediaUrl = downloadResult.dlink;
                }
            } catch (e) {
                console.log('❌ ssvid.net falló:', e.message);
            }

            // 2. Fallback: ytmp33 (notube.net)
            if (!mediaUrl) {
                try {
                    const result = await ytmp33(video.url);
                    if (result?.status && result?.resultados?.descargar) {
                        mediaUrl = result.resultados.descargar;
                    }
                } catch (e) {
                    console.log('❌ ytmp33 falló:', e.message);
                }
            }

            // 3. Fallback: cobalt.tools API
            if (!mediaUrl) {
                try {
                    const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            url: video.url,
                            vCodec: 'h264',
                            vQuality: '720',
                            aFormat: 'mp3',
                            isAudioOnly: true
                        })
                    });
                    const cobaltData = await cobaltRes.json();
                    if (cobaltData?.url) {
                        mediaUrl = cobaltData.url;
                    }
                } catch (e) {
                    console.log('❌ cobalt.tools falló:', e.message);
                }
            }

            // 4. Fallback: API Delirius
            if (!mediaUrl && global.BASE_API_DELIRIUS) {
                try {
                    const delirius = await (
                        await fetch(`${global.BASE_API_DELIRIUS}/api/download/ytmp3?url=${encodeURIComponent(video.url)}`)
                    ).json();
                    if (delirius?.status && delirius?.data?.download?.url) {
                        mediaUrl = delirius.data.download.url;
                    }
                } catch (e) {
                    console.log('❌ API Delirius falló:', e.message);
                }
            }

            if (!mediaUrl) throw new Error('No se pudo obtener el audio de ninguna API disponible');
        } else {
            // Para video, usar ssvid.net
            const downloadResult = await yt.download(video.url, format);
            if (!downloadResult || !downloadResult.dlink) throw new Error('No se pudo obtener el enlace de descarga');
            mediaUrl = downloadResult.dlink;
        }

        if (isAudio) {
            const [audioBuffer, thumbnailBuffer] = await Promise.all([
                fetch(mediaUrl).then(res => res.arrayBuffer()).then(ab => Buffer.from(ab)),
                fetch(video.thumbnail).then(res => res.arrayBuffer()).then(ab => Buffer.from(ab))
            ]);

            const fileName = `${sanitizeFileName(video.title.substring(0, 64))}.mp3`;

            // Verificar si es un MP3 válido (comienza con ID3 tag o frame sync)
            const isValidMp3 = (audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33) || // ID3
                              (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0); // Frame sync

            let finalBuffer = audioBuffer;

            if (isValidMp3) {
                try {
                    let lyricsData = await Genius.searchLyrics(video.title).catch(() => null);
                    if (!lyricsData && !isYouTubeUrl) {
                        lyricsData = await Genius.searchLyrics(query).catch(() => null);
                    }

                    const formattedLyrics = lyricsData ? formatLyrics(lyricsData.lyrics) : null;

                    const tags = {
                        title: video.title,
                        artist: video.author.name,
                        album: 'YouTube Audio',
                        APIC: thumbnailBuffer,
                        year: new Date().getFullYear(),
                        comment: {
                            language: 'spa',
                            text: `🟢 ᴅᴇsᴄᴀʀɢᴀ ᴘᴏʀ @ʙʀᴜɴᴏsᴏʙʀɪɴᴏ 🟢\n\nVideo De YouTube: ${video.url}`
                        }
                    };

                    if (formattedLyrics) {
                        tags.unsynchronisedLyrics = {
                            language: 'spa',
                            text: `🟢 ᴅᴇsᴄᴀʀɢᴀ ᴘᴏʀ @ʙʀᴜɴᴏsᴏʙʀɪɴᴏ 🟢\n\nTitulo: ${video.title}\n\n${formattedLyrics}`
                        };
                    }

                    finalBuffer = NodeID3.write(tags, audioBuffer);
                } catch (tagError) {
                    console.log('⚠️ No se pudieron agregar tags ID3, enviando audio sin tags');
                    finalBuffer = audioBuffer;
                }
            } else {
                console.log('⚠️ Audio no es MP3 válido, enviando sin modificar');
            }

            try {
                const audioSize = finalBuffer.length;
                const shouldSendAsDocument = audioSize > AUDIO_SIZE_LIMIT;

                if (shouldSendAsDocument) {
                    const documentMedia = await prepareWAMessageMedia({ document: finalBuffer }, { upload: conn.waUploadToServer });
                    const thumbnailMedia = await prepareWAMessageMedia({ image: thumbnailBuffer }, { upload: conn.waUploadToServer });

                    const msg = generateWAMessageFromContent(m.chat, {
                        documentMessage: {
                            ...documentMedia.documentMessage,
                            fileName: fileName,
                            mimetype: 'audio/mpeg',
                            jpegThumbnail: thumbnailMedia.imageMessage.jpegThumbnail,
                            contextInfo: {
                                mentionedJid: [],
                                forwardingScore: 0,
                                isForwarded: false
                            }
                        }
                    }, { quoted: m });

                    await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
                } else {
                    await conn.sendMessage(m.chat, { audio: finalBuffer, fileName: `${sanitizeFileName(video.title)}.mp3`, mimetype: 'audio/mpeg' }, { quoted: m });
                }
            } catch (audioError) {
                const errorMsg = audioError.message || audioError.toString();
                if (errorMsg.includes('Media upload failed') ||
                    errorMsg.includes('ENOSPC') ||
                    errorMsg.includes('no space left') ||
                    errorMsg.includes('Internal Server Error') ||
                    errorMsg.includes('size') ||
                    errorMsg.includes('memory')) {

                    try {
                        const documentMedia = await prepareWAMessageMedia({ document: finalBuffer }, { upload: conn.waUploadToServer });
                        const thumbnailMedia = await prepareWAMessageMedia({ image: thumbnailBuffer }, { upload: conn.waUploadToServer });

                        const msg = generateWAMessageFromContent(m.chat, {
                            documentMessage: {
                                ...documentMedia.documentMessage,
                                fileName: fileName,
                                mimetype: 'audio/mpeg',
                                jpegThumbnail: thumbnailMedia.imageMessage.jpegThumbnail,
                                contextInfo: {
                                    mentionedJid: [],
                                    forwardingScore: 0,
                                    isForwarded: false
                                }
                            }
                        }, { quoted: m });
                        
                        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
                    } catch (urlError) {
                        await m.reply(tradutor.errors.generic.replace('@error', 'Error de envío. Intenta nuevamente.'));
                    }
                } else {
                    await m.reply(tradutor.errors.generic.replace('@error', audioError.message));
                }
            }

        } else {
            // Manejo de video (sin cambios)
            try {
                const [videoBuffer, thumbnailBuffer] = await Promise.all([
                    fetch(mediaUrl).then(res => res.arrayBuffer()).then(ab => Buffer.from(ab)),
                    fetch(video.thumbnail).then(res => res.arrayBuffer()).then(ab => Buffer.from(ab))
                ]);
                
                const videoSize = videoBuffer.length;
                const shouldSendAsDocument = videoSize > VIDEO_SIZE_LIMIT;
                const fileName = `${sanitizeFileName(video.title.substring(0, 64))}.mp4`;

                if (shouldSendAsDocument) {
                    const documentMedia = await prepareWAMessageMedia({ document: videoBuffer }, { upload: conn.waUploadToServer });
                    const thumbnailMedia = await prepareWAMessageMedia({ image: thumbnailBuffer }, { upload: conn.waUploadToServer });
                    
                    const msg = generateWAMessageFromContent(m.chat, {
                        documentMessage: {
                            ...documentMedia.documentMessage,
                            fileName: fileName,
                            mimetype: 'video/mp4',
                            jpegThumbnail: thumbnailMedia.imageMessage.jpegThumbnail,
                            contextInfo: {
                                mentionedJid: [],
                                forwardingScore: 0,
                                isForwarded: false
                            }
                        }
                    }, { quoted: m });
                    
                    await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
                } else {
                    await conn.sendMessage(m.chat, { video: videoBuffer, caption: video.title, mimetype: 'video/mp4', fileName: `${sanitizeFileName(video.title)}.mp4` }, { quoted: m });
                }

            } catch (videoError) {
                const errorMsg = videoError.message || videoError.toString();
                if (errorMsg.includes('Media upload failed') || 
                    errorMsg.includes('ENOSPC') || 
                    errorMsg.includes('no space left') ||
                    errorMsg.includes('Internal Server Error') ||
                    errorMsg.includes('size') || 
                    errorMsg.includes('memory')) {
                    
                    try {
                        const urlDocumentMedia = await prepareWAMessageMedia({ document: { url: mediaUrl } }, { upload: conn.waUploadToServer });
                        const urlThumbnailMedia = await prepareWAMessageMedia({ image: { url: video.thumbnail } }, { upload: conn.waUploadToServer });
                        
                        const msg = generateWAMessageFromContent(m.chat, {
                            documentMessage: {
                                ...urlDocumentMedia.documentMessage,
                                fileName: fileName,
                                mimetype: 'video/mp4',
                                jpegThumbnail: urlThumbnailMedia.imageMessage.jpegThumbnail,
                                contextInfo: {
                                    mentionedJid: [],
                                    forwardingScore: 0,
                                    isForwarded: false
                                }
                            }
                        }, { quoted: m });
                        
                        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
                    } catch (urlError) {
                        await m.reply(tradutor.errors.generic.replace('@error', 'Error de envío. Intenta nuevamente.'));
                    }
                } else {
                    await m.reply(tradutor.errors.generic.replace('@error', videoError.message));
                }
            }
        }

    } catch (e) {
        console.log('DEBUG: Error general en handler:', e.message);
        await m.reply(tradutor.errors.generic.replace('@error', e.message));
    }
};

handler.help = ['test <query>', 'test2 <query>'];
handler.tags = ['downloader'];
handler.command = /^(test|test2|play|play2|ytmp3|ytmp4)$/i;
export default handler;

const yt = {
    get baseUrl() {
        return {
            origin: 'https://ssvid.net'
        }
    },

    get baseHeaders() {
        return {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'origin': this.baseUrl.origin,
            'referer': this.baseUrl.origin + '/youtube-to-mp3'
        }
    },

    validateFormat: function (userFormat) {
        const validFormat = ['mp3', '360p', '720p', '1080p']
        if (!validFormat.includes(userFormat)) throw Error(`Formato inválido. Formatos disponibles: ${validFormat.join(', ')}`)
    },

    handleFormat: function (userFormat, searchJson) {
        this.validateFormat(userFormat)
        let result
        if (userFormat == 'mp3') {
            result = searchJson.links?.mp3?.mp3128?.k
        } else {
            let selectedFormat
            const allFormats = Object.entries(searchJson.links.mp4)

            const quality = allFormats.map(v => v[1].q).filter(v => /\d+p/.test(v)).map(v => parseInt(v)).sort((a, b) => b - a).map(v => v + 'p')
            if (!quality.includes(userFormat)) {
                selectedFormat = quality[0]
            } else {
                selectedFormat = userFormat
            }
            const find = allFormats.find(v => v[1].q == selectedFormat)
            result = find?.[1]?.k
        }
        if (!result) throw Error(`Formato ${userFormat} no disponible para este video`)
        return result
    },

    hit: async function (path, payload) {
        try {
            const body = new URLSearchParams(payload)
            const opts = { headers: this.baseHeaders, body, 'method': 'post' }
            const r = await fetch(`${this.baseUrl.origin}${path}`, opts)
            if (!r.ok) throw Error(`${r.status} ${r.statusText}\n${await r.text()}`)
            const j = await r.json()
            return j
        } catch (e) {
            throw Error(`${path}\n${e.message}`)
        }
    },

    download: async function (queryOrYtUrl, userFormat = 'mp3') {
        this.validateFormat(userFormat)

        let search = await this.hit('/api/ajax/search', {
            "query": queryOrYtUrl,
            "cf_token": "",
            "vt": "youtube"
        })

        if (search.p == 'search') {
            if (!search?.items?.length) throw Error(`No se encontraron resultados para: ${queryOrYtUrl}`)
            const { v, t } = search.items[0]
            const videoUrl = 'https://www.youtube.com/watch?v=' + v

            search = await this.hit('/api/ajax/search', {
                "query": videoUrl,
                "cf_token": "",
                "vt": 'youtube'
            })
        }

        const vid = search.vid
        const k = this.handleFormat(userFormat, search)

        const convert = await this.hit('/api/ajax/convert', {
            k, vid
        })

        if (convert.c_status == 'CONVERTING') {
            let convert2
            const limit = 10
            let attempt = 0
            do {
                attempt++
                convert2 = await this.hit('/api/convert/check?hl=en', {
                    vid,
                    b_id: convert.b_id
                })
                if (convert2.c_status == 'CONVERTED') {
                    return convert2
                }
                await new Promise(re => setTimeout(re, 5000))
            } while (attempt < limit && convert2.c_status == 'CONVERTING')
            throw Error('El archivo aún se está procesando. Intenta de nuevo en unos momentos.')

        } else {
            return convert
        }
    },
}

function isValidYouTubeUrl(url) {
    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/|music\.youtube\.com\/watch\?v=)/i;
    return ytRegex.test(url) && extractVideoId(url);
}

async function getVideoInfoFromUrl(url) {
    try {
        const videoId = extractVideoId(url);
        if (!videoId) throw new Error('URL de YouTube no válida');
        const videoInfo = await yts({ videoId: videoId });
        
        if (!videoInfo || !videoInfo.title) {
            throw new Error('No se pudo obtener información del video');
        }
        return {
            videoId: videoId,
            url: `https://youtu.be/${videoId}`,
            title: videoInfo.title,
            author: {
                name: videoInfo.author.name
            },
            duration: {
                seconds: videoInfo.seconds,
                timestamp: videoInfo.timestamp
            },
            thumbnail: videoInfo.thumbnail,
            views: videoInfo.views,
            ago: videoInfo.ago
        };
        
    } catch (error) {
        return getVideoInfoFromYouTubeAPI(url);
    }
}

async function getVideoInfoFromYouTubeAPI(url) {
    try {
        const videoId = extractVideoId(url);
        if (!videoId) throw new Error('ID de video no válido');
        return {
            videoId: videoId,
            url: url,
            title: 'Video de YouTube', 
            author: {
                name: 'Canal de YouTube' 
            },
            duration: {
                seconds: 0,
                timestamp: '0:00'
            },
            thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            views: 0,
            ago: 'Desconocido'
        };
        
    } catch (error) {
        throw new Error(`Error al procesar URL de YouTube: ${error.message}`);
    }
}

function sanitizeFileName(name) {
    return name.replace(/[\\/:*?"<>|]/g, '');
}

function formatLyrics(lyrics) {
    if (!lyrics) return null;
    return lyrics
        .replace(/^\d+\s+Contributor[s]?.*?Lyrics/i, '')
        .replace(/\[Letra de ".*?"\]/g, '')
        .replace(/\[.*?\s+Lyrics\]/g, '')
        .replace(/\[([^\]]+)\]/g, '\n[$1]\n')
        .replace(/^\s+|\s+$/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .filter(line => !line.match(/^(Embed|You might also like|See.*?Live)/i))
        .join('\n');
}

function extractVideoId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|m\.youtube\.com\/watch\?v=)([^&\n?#]+)/);
    return match ? match[1] : null;
}

const Genius = {
    async searchLyrics(query) {
        try {
            const searchUrl = `https://genius.com/api/search/song?q=${encodeURIComponent(query)}`;
            const searchRes = await axios.get(searchUrl);
            
            if (!searchRes.data.response?.sections?.[0]?.hits?.length) {
                throw new Error('No se encontraron letras en Genius.');
            }
            
            const songPath = searchRes.data.response.sections[0].hits[0].result.path;
            const lyricsUrl = `https://genius.com${songPath}`;
            const { data } = await axios.get(lyricsUrl);
            const $ = load(data); 
            
            let lyrics = $('div[class*="Lyrics__Container"]').html();
            if (!lyrics) throw new Error('Letra no disponible en formato estructurado.');

            lyrics = lyrics.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').trim();

            return {
                title: searchRes.data.response.sections[0].hits[0].result.title,
                artist: searchRes.data.response.sections[0].hits[0].result.primary_artist.name,
                url: lyricsUrl,
                lyrics: lyrics
            };

        } catch (error) {
            throw error;
        }
    }
};

