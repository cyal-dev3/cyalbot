import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';

export interface GroupMessageVars {
  /** Jid del usuario que entra o sale; se convierte en mención. */
  user: string;
  group: string;
  desc?: string | null;
  /** Número de miembros tras el cambio. */
  count?: number;
  /** Nombre visible (pushName) del usuario, si se conoce. */
  name?: string | null;
}

/**
 * Sustituye {user}, {name}, {group}, {desc} y {count} en una plantilla de
 * bienvenida o despedida. {user} queda como "@numero" para ir en `mentions`.
 */
export function renderGroupMessage(template: string, vars: GroupMessageVars): string {
  const tag = mentionTag(vars.user);
  return template
    .replace(/{user}/g, tag)
    .replace(/{name}/g, vars.name?.trim() || tag)
    .replace(/{group}/g, vars.group)
    .replace(/{desc}/g, vars.desc?.trim() || 'Sin descripción')
    .replace(/{count}/g, vars.count !== undefined ? String(vars.count) : '?');
}

const VARIABLES_HELP =
  '📌 Variables:\n' +
  '• {user} - Menciona al usuario\n' +
  '• {name} - Nombre del usuario\n' +
  '• {group} - Nombre del grupo\n' +
  '• {desc} - Descripción del grupo\n' +
  '• {count} - Número de miembros';

async function sendPreview(ctx: MessageContext, template: string, title: string): Promise<void> {
  const { m, conn, groupMetadata } = ctx;
  const text = renderGroupMessage(template, {
    user: m.sender,
    name: m.pushName,
    group: groupMetadata?.subject || 'Grupo',
    desc: groupMetadata?.desc,
    count: groupMetadata?.participants.length ?? ctx.participants?.length,
  });
  const result = await conn.sendMessage(m.chat, { text: `${title}\n\n${text}`, mentions: [m.sender] }, { quoted: m.rawMessage });
  if (result?.key) ctx.handler.trackMessage(m.chat, result.key);
}

/** `/welcome test`: muestra cómo se vería la bienvenida para quien lo pide. */
export async function previewWelcome(ctx: MessageContext): Promise<void> {
  await sendPreview(ctx, getDatabase().getChatSettings(ctx.m.chat).sWelcome, '👋 *Vista previa de bienvenida*');
}

/** `/bye test`: muestra cómo se vería la despedida para quien lo pide. */
export async function previewBye(ctx: MessageContext): Promise<void> {
  await sendPreview(ctx, getDatabase().getChatSettings(ctx.m.chat).sBye, '👋 *Vista previa de despedida*');
}

export const setWelcomePlugin: PluginHandler = {
  command: ['setwelcome', 'bienvenida'],
  description: 'Configurar mensaje de bienvenida personalizado',
  category: 'group',
  help: ['setwelcome <mensaje> - Cambia la bienvenida ({user}, {name}, {group}, {desc}, {count})'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();

    if (!text) {
      const chatSettings = db.getChatSettings(m.chat);
      await m.reply(
        `👋 *CONFIGURAR BIENVENIDA*\n\n` +
        `📝 Uso: ${usedPrefix}setwelcome <mensaje>\n` +
        `👀 Prueba: ${usedPrefix}welcome test\n\n` +
        `${VARIABLES_HELP}\n\n` +
        `📄 Mensaje actual:\n${chatSettings.sWelcome}`,
      );
      return;
    }

    db.updateChatSettings(m.chat, { sWelcome: text });
    await m.reply(`✅ Mensaje de bienvenida actualizado.\n\n${text}\n\n_Pruébalo con ${usedPrefix}welcome test_`);
  },
};

export const setByePlugin: PluginHandler = {
  command: ['setbye', 'despedida'],
  description: 'Configurar mensaje de despedida personalizado',
  category: 'group',
  help: ['setbye <mensaje> - Cambia la despedida ({user}, {name}, {group}, {count})'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();

    if (!text) {
      const chatSettings = db.getChatSettings(m.chat);
      await m.reply(
        `👋 *CONFIGURAR DESPEDIDA*\n\n` +
        `📝 Uso: ${usedPrefix}setbye <mensaje>\n` +
        `👀 Prueba: ${usedPrefix}bye test\n\n` +
        `${VARIABLES_HELP}\n\n` +
        `📄 Mensaje actual:\n${chatSettings.sBye}`,
      );
      return;
    }

    db.updateChatSettings(m.chat, { sBye: text });
    await m.reply(`✅ Mensaje de despedida actualizado.\n\n${text}\n\n_Pruébalo con ${usedPrefix}bye test_`);
  },
};

/**
 * @deprecated Los interruptores viven en group-toggles.ts; plugins/index.ts debe
 * importarlos de ahí. Se mantiene hasta que lo migre el dueño de index.ts.
 */
export { welcomeTogglePlugin, byeTogglePlugin } from './group-toggles.js';
