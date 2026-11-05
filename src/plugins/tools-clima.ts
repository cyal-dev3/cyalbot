import type { PluginHandler } from '../types/message.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('tools');
const TIMEOUT_MS = 10_000;

export interface WeatherData {
  location: string;
  temperature: string;
  feelsLike: string;
  condition: string;
  humidity: string;
  wind: string;
  visibility: string;
  uvIndex: string;
  precipitation: string;
  /** Máxima y mínima de hoy */
  maxTemp: string;
  minTemp: string;
  /** Probabilidad de lluvia de hoy (máxima entre las franjas horarias) */
  rainChance: string;
}

export type WeatherResult = { success: true; data: WeatherData } | { success: false; error: string };

interface WttrResponse {
  nearest_area?: { areaName?: { value?: string }[]; country?: { value?: string }[]; region?: { value?: string }[] }[];
  current_condition?: {
    temp_C?: string;
    FeelsLikeC?: string;
    weatherDesc?: { value?: string }[];
    lang_es?: { value?: string }[];
    humidity?: string;
    windspeedKmph?: string;
    winddir16Point?: string;
    visibility?: string;
    uvIndex?: string;
    precipMM?: string;
  }[];
  weather?: { maxtempC?: string; mintempC?: string; hourly?: { chanceofrain?: string }[] }[];
}

/** Clima actual desde wttr.in (JSON) con descripción en español. */
export async function getWeather(city: string): Promise<WeatherResult> {
  try {
    const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=es`, {
      // wttr.in responde mejor con User-Agent de curl.
      headers: { 'User-Agent': 'curl/7.68.0', 'Accept-Language': 'es' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return { success: false, error: 'Ciudad no encontrada.' };
    if (!response.ok) return { success: false, error: `El servicio de clima respondió ${response.status}.` };
    if (!(response.headers.get('content-type') ?? '').includes('json')) {
      return { success: false, error: 'El servicio de clima no reconoció esa ciudad.' };
    }

    const data = (await response.json()) as WttrResponse;
    const area = data.nearest_area?.[0];
    const current = data.current_condition?.[0];
    if (!area || !current) return { success: false, error: 'No pude obtener el clima de esa ciudad.' };

    const today = data.weather?.[0];
    const rainChance = Math.max(0, ...(today?.hourly ?? []).map((h) => parseInt(h.chanceofrain ?? '0', 10) || 0));
    const location = [area.areaName?.[0]?.value || city, area.region?.[0]?.value, area.country?.[0]?.value]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(', ');

    return {
      success: true,
      data: {
        location,
        temperature: current.temp_C || '?',
        feelsLike: current.FeelsLikeC || '?',
        condition: current.lang_es?.[0]?.value || current.weatherDesc?.[0]?.value || 'Desconocido',
        humidity: current.humidity || '?',
        wind: `${current.windspeedKmph || '?'} km/h ${current.winddir16Point || ''}`.trim(),
        visibility: current.visibility || '?',
        uvIndex: current.uvIndex || '?',
        precipitation: current.precipMM || '0',
        maxTemp: today?.maxtempC || '?',
        minTemp: today?.mintempC || '?',
        rainChance: String(rainChance),
      },
    };
  } catch (error) {
    log.warn('clima:', error instanceof Error ? error.message : error);
    return { success: false, error: 'No pude conectar con el servicio de clima.' };
  }
}

export const climaPlugin: PluginHandler = {
  command: ['clima', 'weather', 'tiempo'],
  description: 'Clima actual de una ciudad',
  category: 'herramientas',
  help: ['clima <ciudad> - Clima actual, máxima/mínima y probabilidad de lluvia'],
  usage: ['clima Ciudad de México', 'clima Madrid, España'],

  handler: async ({ m, text, usedPrefix }) => {
    const city = text.trim();
    if (!city) {
      return m.reply(`¿De qué ciudad? *${usedPrefix}clima Guadalajara* o *${usedPrefix}clima Madrid, España*`);
    }

    await m.react('⏳');
    const result = await getWeather(city);
    if (!result.success) {
      await m.react('❌');
      return m.reply(`❌ ${result.error}`);
    }
    const w = result.data;
    await m.react('✅');
    await m.reply(
      `🌤️ *${w.location}*\n\n` +
      `🌡️ ${w.temperature}°C (sensación ${w.feelsLike}°C) · ${w.condition}\n` +
      `📈 Máx ${w.maxTemp}°C · 📉 Mín ${w.minTemp}°C\n` +
      `🌧️ Lluvia: ${w.rainChance}% (${w.precipitation} mm)\n` +
      `💧 Humedad ${w.humidity}% · 💨 Viento ${w.wind}\n` +
      `👁️ Visibilidad ${w.visibility} km · ☀️ UV ${w.uvIndex}`,
    );
  },
};
