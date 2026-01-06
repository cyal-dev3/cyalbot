const handler = async (m, {conn, usedPrefix, text, participants}) => {
  const datas = global
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/es.json`))
  const tradutor = _translate.plugins.gc_demote

  // Función para obtener el usuario mencionado
  const getMentionedUser = async () => {
    // 1. Primero intentar obtener de mensaje citado/respondido
    if (m.quoted && m.quoted.sender) {
      return m.quoted.sender;
    }

    // 2. Intentar obtener del contextInfo (menciones)
    const contextInfo = m.message?.extendedTextMessage?.contextInfo;
    if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
      const mentioned = contextInfo.mentionedJid[0];
      // Si es un LID, intentar resolver a JID real
      if (mentioned.endsWith('@lid') && participants) {
        const realJid = await resolveLidFromParticipants(mentioned, participants);
        if (realJid) return realJid;
      }
      return mentioned;
    }

    // 3. Intentar de m.mentionedJid
    if (m.mentionedJid && m.mentionedJid.length > 0) {
      const mentioned = m.mentionedJid[0];
      if (mentioned.endsWith('@lid') && participants) {
        const realJid = await resolveLidFromParticipants(mentioned, participants);
        if (realJid) return realJid;
      }
      return mentioned;
    }

    // 4. Intentar extraer número del texto (formato manual: número sin @)
    if (text) {
      const numberMatch = text.replace(/[^0-9]/g, '');
      if (numberMatch && numberMatch.length >= 10 && numberMatch.length <= 15) {
        return numberMatch + '@s.whatsapp.net';
      }
    }

    return null;
  };

  // Resolver LID a JID real usando la lista de participantes
  const resolveLidFromParticipants = async (lid, participants) => {
    if (!lid || !participants) return null;

    // Buscar en participantes si alguno tiene este LID
    for (const p of participants) {
      const participantId = p.id || p.jid;
      const participantLid = p.lid;

      if (participantLid === lid) {
        return participantId;
      }
    }

    return null;
  };

  if (!text && !m.quoted) {
    return conn.reply(m.chat, `${tradutor.texto1[0]} ${usedPrefix}quitaradmin @tag*\n*┠≽ ${usedPrefix}quitaradmin ${tradutor.texto1[1]}`, m);
  }

  const user = await getMentionedUser();

  if (!user) {
    return conn.reply(m.chat, `Uso: ${usedPrefix}quitaradmin @usuario\n\nTambién puedes responder a un mensaje del usuario.`, m);
  }

  try {
    // Si el user es un LID, intentar obtener el JID real para la operación
    let userToDemote = user;
    if (user.endsWith('@lid') && participants) {
      const foundP = participants.find(p => p.lid === user || p.id === user);
      if (foundP?.id && !foundP.id.endsWith('@lid')) {
        userToDemote = foundP.id;
      } else if (foundP?.jid && !foundP.jid.endsWith('@lid')) {
        userToDemote = foundP.jid;
      }
    }

    await conn.groupParticipantsUpdate(m.chat, [userToDemote], 'demote');
    conn.reply(m.chat, tradutor.texto3, m);
  } catch (e) {
    conn.reply(m.chat, `Error al degradar: ${e.message || 'desconocido'}`, m);
  }
};
handler.help = ['demote'].map((v) => 'mention ' + v);
handler.tags = ['group'];
handler.command = /^(demote|quitarpoder|quitaradmin)$/i;
handler.group = true;
handler.admin = true;
handler.botAdmin = true;
handler.fail = null;
export default handler;
