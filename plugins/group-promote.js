const handler = async (m, {conn, usedPrefix, text, participants}) => {
  const datas = global
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/es.json`))
  const tradutor = _translate.plugins.gc_promote

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
    return conn.reply(m.chat, `${tradutor.texto1[0]}\n\n*┯┷*\n*┠≽ ${usedPrefix}daradmin @tag*\n*┠≽ ${usedPrefix}darpoder ${tradutor.texto1[1]}\n*┷┯*`, m);
  }

  const user = await getMentionedUser();

  if (!user) {
    return conn.reply(m.chat, `Uso: ${usedPrefix}daradmin @usuario\n\nTambién puedes responder a un mensaje del usuario.`, m);
  }

  try {
    // Si el user es un LID, intentar obtener el JID real para la operación
    let userToPromote = user;
    if (user.endsWith('@lid') && participants) {
      const foundP = participants.find(p => p.lid === user || p.id === user);
      if (foundP?.id && !foundP.id.endsWith('@lid')) {
        userToPromote = foundP.id;
      } else if (foundP?.jid && !foundP.jid.endsWith('@lid')) {
        userToPromote = foundP.jid;
      }
    }

    await conn.groupParticipantsUpdate(m.chat, [userToPromote], 'promote');
    conn.reply(m.chat, tradutor.texto3, m);
  } catch (e) {
    conn.reply(m.chat, `Error al promover: ${e.message || 'desconocido'}`, m);
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
