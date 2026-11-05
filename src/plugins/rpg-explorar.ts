import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, pickRandom, randomInt, checkCooldown } from '../lib/utils.js';
import { getDatabase, type Database } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { getRankBenefits, type UserRPG } from '../types/user.js';
import { ITEMS, type Item } from '../types/rpg.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { grantRewards, replyCooldown, formatReward, type RewardInput } from '../lib/rpg-actions.js';

/** Descuento del mercader ambulante sobre el precio de tienda (%) */
export const MERCHANT_DISCOUNT = 50;

interface ExploreOutcome {
  title: string;
  lines: string[];
  rewards?: RewardInput;
}

type ExploreEvent = (db: Database, jid: string, user: UserRPG) => ExploreOutcome;

/** Consumibles comprables con los que el mercader puede aparecer */
function merchantStock(): Item[] {
  return Object.values(ITEMS).filter(item => item.type === 'consumable' && item.price > 0 && item.price <= 5000);
}

const EVENTS: { weight: number; run: ExploreEvent }[] = [
  {
    weight: 35,
    run: (_db, _jid, user) => {
      const money = randomInt(100, 400) + user.level * 20;
      const exp = randomInt(50, 150) + user.level * 10;
      return {
        title: '🧰 Encontraste un cofre',
        lines: ['Escondido entre las ruinas había un cofre polvoriento con monedas y un viejo pergamino.'],
        rewards: { exp, money }
      };
    }
  },
  {
    weight: 25,
    run: (db, jid, user) => {
      const total = calculateTotalStats(user);
      // La trampa hiere pero nunca mata
      const damage = Math.min(user.health - 1, Math.max(1, Math.floor(total.maxHealth * randomInt(10, 25) / 100)));
      const lost = Math.min(user.money, randomInt(50, 200));
      db.updateUser(jid, { health: user.health - Math.max(0, damage), money: user.money - lost });
      return {
        title: '🪤 ¡Caíste en una trampa!',
        lines: [
          `Un foso con estacas te dejó magullado: -${Math.max(0, damage)} ${EMOJI.health}`,
          lost > 0 ? `Se te cayeron ${formatNumber(lost)} ${EMOJI.coin} al huir` : 'Al menos no perdiste nada'
        ],
        rewards: { exp: 20 + user.level * 2 }
      };
    }
  },
  {
    weight: 20,
    run: (db, jid, user) => {
      const stock = merchantStock();
      if (stock.length === 0) {
        return { title: '🧳 Un mercader ambulante', lines: ['Tenía la carreta vacía; te deseó buen viaje.'], rewards: { exp: 30 } };
      }
      const item = pickRandom(stock);
      const price = Math.floor(item.price * (100 - MERCHANT_DISCOUNT) / 100);
      if (user.money < price) {
        return {
          title: '🧳 Un mercader ambulante',
          lines: [`Te ofreció ${item.emoji} *${item.name}* por ${formatNumber(price)} ${EMOJI.coin} (-${MERCHANT_DISCOUNT}%), pero no te alcanzó.`],
          rewards: { exp: 30 }
        };
      }
      const inventory = user.inventory.map(i => ({ ...i }));
      const existing = inventory.find(i => i.itemId === item.id);
      if (existing) existing.quantity++;
      else inventory.push({ itemId: item.id, quantity: 1 });
      db.updateUser(jid, { money: user.money - price, inventory });
      return {
        title: '🧳 Un mercader ambulante',
        lines: [`Compraste ${item.emoji} *${item.name}* por ${formatNumber(price)} ${EMOJI.coin} (-${MERCHANT_DISCOUNT}% sobre ${formatNumber(item.price)})`],
        rewards: { exp: 40 }
      };
    }
  },
  {
    weight: 20,
    run: (_db, _jid, user) => ({
      title: '🧙 Un viajero misterioso',
      lines: ['Compartisteis la hoguera y te enseñó trucos de aventurero veterano.'],
      rewards: { exp: randomInt(150, 350) + user.level * 15 }
    })
  }
];

const EXPLORE_MESSAGES = [
  'Te adentraste en el bosque encantado',
  'Recorriste las ruinas del templo olvidado',
  'Cruzaste el desfiladero de los susurros',
  'Exploraste las catacumbas bajo la ciudad',
  'Seguiste un mapa antiguo hasta la costa'
];

export function pickEvent(roll: number = Math.random()): ExploreEvent {
  const total = EVENTS.reduce((sum, e) => sum + e.weight, 0);
  let remaining = roll * total;
  for (const event of EVENTS) {
    remaining -= event.weight;
    if (remaining <= 0) return event.run;
  }
  return EVENTS[EVENTS.length - 1].run;
}

export const explorarPlugin: PluginHandler = {
  command: /^(explorar|explore|expedicion|expedición)$/i,
  tags: ['rpg'],
  help: [`explorar - Explora el mapa: cofres, trampas, mercaderes o viajeros (cada ${CONFIG.cooldowns.adventure / 60000} minutos)`],
  usage: ['explorar'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    const cd = checkCooldown(user.lastExplore ?? 0, CONFIG.cooldowns.adventure, getRankBenefits(user.level).cooldownReduction);
    if (cd.onCooldown) {
      return replyCooldown(ctx, cd.remaining, [
        { cmd: 'cazar', desc: 'Salir de caza' },
        { cmd: 'pescar', desc: 'Ir a pescar' }
      ]);
    }

    db.updateUser(m.sender, { lastExplore: now });
    const outcome = pickEvent()(db, m.sender, user);

    const result = grantRewards(
      db,
      m.sender,
      { ...(outcome.rewards ?? {}), questObjectives: [{ objective: 'explore', amount: 1 }] },
      { source: 'explore', now }
    );

    const lines = [...outcome.lines];
    if (result.exp > 0) lines.push(`+${formatNumber(result.exp)} ${EMOJI.exp} XP`);
    if (result.money > 0) lines.push(`+${formatNumber(result.money)} ${EMOJI.coin} monedas`);
    lines.push(...result.lines);

    const fresh = db.getUser(m.sender);
    await m.reply(formatReward(ctx, outcome.title, lines, {
      intro: `🗺️ *${pickRandom(EXPLORE_MESSAGES)}*`,
      footer: `${EMOJI.health} ${fresh.health} · ${EMOJI.coin} ${formatNumber(fresh.money)} · ${EMOJI.level} Nivel *${fresh.level}*\n` +
        `${EMOJI.time} Próxima expedición en *${Math.floor(cd.effectiveCooldown / 60000)} minutos*. Revisa *${usedPrefix}inventario* si compraste algo.`
    }));
  }
};

export default explorarPlugin;
