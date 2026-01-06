/**
 * ✅ Plugin de Registro - CYALTRONIC
 * Permite a los usuarios registrarse en el sistema RPG
 */

import { createHash } from 'crypto';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';

// Patrón para validar nombre.edad o nombre,edad
const REG_PATTERN = /^(.+)[.,](\d+)$/;

export const verificarPlugin: PluginHandler = {
  command: /^(verificar|registrar|register|reg)$/i,
  tags: ['rpg'],
  help: [
    'verificar <nombre>.<edad>',
    'registrar Shadow.18'
  ],

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix, command } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Verificar si ya está registrado
    if (user.registered) {
      return m.reply(
        `${EMOJI.warning} *¡Ya estás registrado, aventurero!*\n\n` +
        `${EMOJI.info} Tu nombre: *${user.name}*\n` +
        `${EMOJI.level} Tu nivel: *${user.level}*\n\n` +
        `${EMOJI.star} Usa *${usedPrefix}perfil* para ver tu progreso completo.`
      );
    }

    // Validar formato del comando
    if (!text) {
      return m.reply(
        `${EMOJI.error} *¡Formato incorrecto!*\n\n` +
        `${EMOJI.info} *Uso correcto:*\n` +
        `➡️ ${usedPrefix}${command} nombre.edad\n\n` +
        `${EMOJI.star} *Ejemplos:*\n` +
        `• ${usedPrefix}${command} Guerrero.18\n` +
        `• ${usedPrefix}${command} Shadow.25\n` +
        `• ${usedPrefix}${command} Dragon,21`
      );
    }

    const match = text.match(REG_PATTERN);
    if (!match) {
      return m.reply(
        `${EMOJI.error} *¡Formato incorrecto!*\n\n` +
        `${EMOJI.info} Debes usar el formato: *nombre.edad*\n` +
        `${EMOJI.star} Ejemplo: *${usedPrefix}${command} MiNombre.20*`
      );
    }

    const [, rawName, ageStr] = match;
    const name = rawName.trim();
    const age = parseInt(ageStr, 10);

    // Validar nombre
    if (name.length < 2) {
      return m.reply(
        `${EMOJI.error} El nombre debe tener *al menos 2 caracteres*.`
      );
    }

    if (name.length > 25) {
      return m.reply(
        `${EMOJI.error} El nombre no puede tener *más de 25 caracteres*.`
      );
    }

    // Validar edad
    if (isNaN(age) || age < 13) {
      return m.reply(
        `${EMOJI.error} Debes tener *al menos 13 años* para registrarte.`
      );
    }

    if (age > 100) {
      return m.reply(
        `${EMOJI.error} Por favor ingresa una *edad válida* (menor a 100).`
      );
    }

    // Generar ID único del jugador
    const serialNumber = createHash('md5')
      .update(m.sender + Date.now().toString())
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();

    // Registrar usuario
    const bonus = CONFIG.rpg.registerBonus;

    db.updateUser(m.sender, {
      name,
      age,
      registered: true,
      regTime: Date.now(),
      money: user.money + bonus.money,
      exp: user.exp + bonus.exp
    });

    // Mensaje de bienvenida
    await m.reply(
      `${EMOJI.success}${EMOJI.crown} *¡REGISTRO EXITOSO!* ${EMOJI.crown}${EMOJI.success}\n\n` +
      `${EMOJI.sparkles} *¡Bienvenido al mundo de CYALTRONIC, ${name}!*\n\n` +
      `╭─────────────────────────╮\n` +
      `│  ${EMOJI.star} *DATOS DE REGISTRO*\n` +
      `├─────────────────────────\n` +
      `│  ${EMOJI.info} Nombre: *${name}*\n` +
      `│  ${EMOJI.info} Edad: *${age} años*\n` +
      `│  ${EMOJI.info} ID: *#${serialNumber}*\n` +
      `│  ${EMOJI.time} Fecha: *${new Date().toLocaleDateString('es-MX')}*\n` +
      `╰─────────────────────────╯\n\n` +
      `${EMOJI.gift} *¡REGALO DE BIENVENIDA!*\n` +
      `├ +${bonus.money.toLocaleString()} ${EMOJI.coin} Monedas\n` +
      `├ +${bonus.exp.toLocaleString()} ${EMOJI.exp} Experiencia\n` +
      `╰─────────────────────────\n\n` +
      `${EMOJI.sword} *¡Tu aventura comienza ahora!*\n\n` +
      `${EMOJI.info} *Comandos útiles:*\n` +
      `• *${usedPrefix}perfil* - Ver tu perfil\n` +
      `• *${usedPrefix}daily* - Recompensa diaria\n` +
      `• *${usedPrefix}work* - Trabajar por XP\n` +
      `• *${usedPrefix}nivel* - Subir de nivel`
    );
  }
};

export default verificarPlugin;
