/**
 * Plugin Mode System
 * Controla el modo de operación del bot
 * Comando: /mode public|private|group|inbox
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';

const VALID_MODES = ['public', 'private', 'group', 'inbox'] as const;

const MODE_DESCRIPTIONS: Record<string, string> = {
  public: '🌐 Público - Todos pueden usar el bot',
  private: '🔒 Privado - Solo el owner puede usar el bot',
  group: '👥 Grupo - Solo funciona en grupos',
  inbox: '📱 Inbox - Solo funciona en chat privado'
};

/**
 * Comando /mode - Cambiar modo del bot
 */
export const modePlugin: PluginHandler = {
  command: ['mode', 'modo'],
  description: 'Cambiar el modo de operación del bot',
  category: 'owner',
  owner: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();
    const settings = db.getSettings();

    const option = text.toLowerCase().trim() as typeof VALID_MODES[number];

    if (VALID_MODES.includes(option)) {
      db.updateSettings({ botMode: option });
      await m.reply(`✅ *Modo cambiado*\n\n${MODE_DESCRIPTIONS[option]}`);
    } else {
      const currentMode = settings.botMode || 'public';
      let menu = `🔒 *MODO DEL BOT*\n\nModo actual: ${MODE_DESCRIPTIONS[currentMode]}\n\n📝 Modos disponibles:\n`;
      for (const mode of VALID_MODES) {
        const active = mode === currentMode ? ' ◀️' : '';
        menu += `• /mode ${mode} - ${MODE_DESCRIPTIONS[mode]}${active}\n`;
      }
      await m.reply(menu);
    }
  }
};
