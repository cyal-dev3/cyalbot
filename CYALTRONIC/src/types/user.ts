/**
 * 👤 Interfaz de usuario RPG para CYALTRONIC
 * Define la estructura de datos de cada jugador
 */

export interface UserRPG {
  // 📝 Datos de registro
  name: string;
  age: number;
  registered: boolean;
  regTime: number;

  // 📊 Sistema de niveles
  level: number;
  exp: number;
  role: string;

  // ⚔️ Estadísticas de combate
  health: number;
  stamina: number;
  mana: number;

  // 💰 Economía
  money: number;
  limit: number;  // 💎 Diamantes
  potion: number;

  // ⏰ Cooldowns (timestamps)
  lastclaim: number;
  lastwork: number;
}

/**
 * Valores por defecto para un nuevo usuario
 */
export const DEFAULT_USER: UserRPG = {
  // Registro
  name: '',
  age: -1,
  registered: false,
  regTime: -1,

  // Niveles
  level: 0,
  exp: 0,
  role: '🌱 Novato',

  // Stats
  health: 100,
  stamina: 100,
  mana: 20,

  // Economía
  money: 15,
  limit: 20,
  potion: 10,

  // Cooldowns
  lastclaim: 0,
  lastwork: 0
};

/**
 * Obtiene el rol/título basado en el nivel del jugador
 * @param level - Nivel actual del jugador
 * @returns Título con emoji correspondiente
 */
export function getRoleByLevel(level: number): string {
  const roles: [number, string][] = [
    [0, '🌱 Novato'],
    [5, '⚔️ Aprendiz'],
    [10, '🗺️ Explorador'],
    [20, '🛡️ Guerrero'],
    [35, '⭐ Veterano'],
    [50, '💎 Élite'],
    [75, '🔮 Maestro'],
    [100, '👑 Leyenda'],
    [150, '🌟 Mítico'],
    [200, '🏆 Inmortal']
  ];

  for (let i = roles.length - 1; i >= 0; i--) {
    if (level >= roles[i][0]) return roles[i][1];
  }
  return '🌱 Novato';
}
