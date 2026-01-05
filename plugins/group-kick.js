const handler = async (m, {conn, participants, command, usedPrefix, text}) => {
  const datas = global
  const idioma = datas.db.data.users[m.sender].language || global.defaultLenguaje
  const _translate = JSON.parse(fs.readFileSync(`./src/languages/${idioma}.json`))
  const tradutor = _translate.plugins.grupos_eliminar

  if (!global.db.data.settings[conn.user.jid].restrict) throw `${tradutor.texto1[0]} (*_restrict_*), ${tradutor.texto1[1]}`;

  const kicktext = `${tradutor.texto2} _${usedPrefix + command} @usuario_`;

  // Funcion para obtener el JID real del usuario mencionado
  const getMentionedUser = async () => {
    // 1. Primero intentar obtener de mensaje citado/respondido
    if (m.quoted && m.quoted.sender) {
      return m.quoted.sender;
    }

    // 2. Intentar obtener del contextInfo
    const contextInfo = m.message?.extendedTextMessage?.contextInfo;
    if (contextInfo) {
      // Si hay participantes mencionados directamente
      if (contextInfo.mentionedJid && contextInfo.mentionedJid.length > 0) {
        const mentioned = contextInfo.mentionedJid[0];
        // Si es un LID, buscar en participantes del grupo
        if (mentioned.endsWith('@lid')) {
          const realJid = await resolveLidFromParticipants(mentioned, participants);
          if (realJid) return realJid;
        }
        return mentioned;
      }

      // Si hay participant en el contextInfo
      if (contextInfo.participant) {
        return contextInfo.participant;
      }
    }

    // 3. Intentar de m.mentionedJid
    if (m.mentionedJid && m.mentionedJid.length > 0) {
      const mentioned = m.mentionedJid[0];
      if (mentioned.endsWith('@lid')) {
        const realJid = await resolveLidFromParticipants(mentioned, participants);
        if (realJid) return realJid;
      }
      return mentioned;
    }

    // 4. Intentar extraer numero del texto
    if (text) {
      const numberMatch = text.match(/(\d{10,15})/);
      if (numberMatch) {
        return numberMatch[1] + '@s.whatsapp.net';
      }
    }

    return null;
  };

  // Resolver LID a JID real usando la lista de participantes
  const resolveLidFromParticipants = async (lid, participants) => {
    if (!lid || !participants) return null;

    const lidNumber = lid.split('@')[0];

    // Buscar en participantes si alguno tiene este LID
    for (const p of participants) {
      const participantId = p.id || p.jid;
      if (!participantId) continue;

      try {
        // Verificar si este participante corresponde al LID
        const check = await conn.onWhatsApp(participantId);
        if (check && check[0] && check[0].lid) {
          const checkLid = check[0].lid.split('@')[0];
          if (checkLid === lidNumber) {
            return participantId;
          }
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  };

  const mentionedUser = await getMentionedUser();

  if (!mentionedUser || mentionedUser === 'undefined@s.whatsapp.net') {
    return m.reply(`Uso: ${usedPrefix}${command} @usuario\n\nTambien puedes responder a un mensaje del usuario que quieres expulsar.`);
  }

  // Verificar que no sea el bot
  if (mentionedUser.includes(conn.user.jid.split('@')[0])) {
    return m.reply(tradutor.texto4);
  }

  // Verificar que el usuario este en el grupo
  const isInGroup = participants.some(p => (p.id || p.jid) === mentionedUser);
  if (!isInGroup) {
    return m.reply(`El usuario no esta en el grupo.`);
  }

  try {
    const response = await conn.groupParticipantsUpdate(m.chat, [mentionedUser], 'remove');
    const userTag = mentionedUser.split('@')[0];

    if (response[0]?.status === '200') {
      m.reply(`Usuario @${userTag} expulsado.`, m.chat, {mentions: [mentionedUser]});
    } else if (response[0]?.status === '406') {
      m.reply(`No se puede expulsar a @${userTag}, puede ser admin.`, m.chat, {mentions: [mentionedUser]});
    } else if (response[0]?.status === '404') {
      m.reply(`Usuario @${userTag} no encontrado en el grupo.`, m.chat, {mentions: [mentionedUser]});
    } else {
      m.reply(`No se pudo expulsar al usuario. Codigo: ${response[0]?.status || 'desconocido'}`);
    }
  } catch (error) {
    m.reply(`Error al expulsar: ${error.message || 'desconocido'}`);
  }
};

handler.help = ['kick @usuario'];
handler.tags = ['group'];
handler.command = /^(kick|expulsar|eliminar|echar|sacar)$/i;
handler.admin = handler.group = handler.botAdmin = true;

export default handler;
