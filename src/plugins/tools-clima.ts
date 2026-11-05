/**
 * Plugin de Clima
 * Comando: /clima
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

/**
 * Obtiene información del clima usando wttr.in
 */
export async function getWeather(city: string): Promise<{
  success: boolean;
  data?: {
    location: string;
    temperature: string;
    feelsLike: string;
    condition: string;
    humidity: string;
    wind: string;
    visibility: string;
    uvIndex: string;
    precipitation: string;
  };
  error?: string;
}> {
  try {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'curl/7.68.0', // wttr.in responde mejor con User-Agent de curl
        'Accept-Language': 'es'
      }
    });

    if (!response.ok) {
      return { success: false, error: 'Ciudad no encontrada' };
    }

    const data = await response.json() as {
      nearest_area?: Array<{
        areaName?: Array<{ value?: string }>;
        country?: Array<{ value?: string }>;
        region?: Array<{ value?: string }>;
      }>;
      current_condition?: Array<{
        temp_C?: string;
        FeelsLikeC?: string;
        weatherDesc?: Array<{ value?: string }>;
        humidity?: string;
        windspeedKmph?: string;
        winddir16Point?: string;
        visibility?: string;
        uvIndex?: string;
        precipMM?: string;
      }>;
    };

    const area = data.nearest_area?.[0];
    const current = data.current_condition?.[0];

    if (!area || !current) {
      return { success: false, error: 'No se pudo obtener información del clima' };
    }

    const location = `${area.areaName?.[0]?.value || city}, ${area.region?.[0]?.value || ''}, ${area.country?.[0]?.value || ''}`;

    return {
      success: true,
      data: {
        location: location.replace(/, ,/g, ',').replace(/,\s*$/, ''),
        temperature: current.temp_C || '?',
        feelsLike: current.FeelsLikeC || '?',
        condition: current.weatherDesc?.[0]?.value || 'Desconocido',
        humidity: current.humidity || '?',
        wind: `${current.windspeedKmph || '?'} km/h ${current.winddir16Point || ''}`,
        visibility: current.visibility || '?',
        uvIndex: current.uvIndex || '?',
        precipitation: current.precipMM || '0'
      }
    };
  } catch (error) {
    console.error('Error obteniendo clima:', error);
    return { success: false, error: 'Error al conectar con el servicio' };
  }
}

/**
 * Obtiene emoji según la condición del clima
 */
function getWeatherEmoji(condition: string): string {
  const lower = condition.toLowerCase();
  if (lower.includes('sunny') || lower.includes('clear') || lower.includes('despejado')) return '☀️';
  if (lower.includes('cloud') || lower.includes('nube') || lower.includes('overcast')) return '☁️';
  if (lower.includes('rain') || lower.includes('lluvia') || lower.includes('drizzle')) return '🌧️';
  if (lower.includes('thunder') || lower.includes('tormenta') || lower.includes('storm')) return '⛈️';
  if (lower.includes('snow') || lower.includes('nieve')) return '❄️';
  if (lower.includes('fog') || lower.includes('mist') || lower.includes('niebla')) return '🌫️';
  if (lower.includes('partly') || lower.includes('parcial')) return '⛅';
  if (lower.includes('haze')) return '🌁';
  return '🌤️';
}

/**
 * Comando /clima - Obtener información del clima
 */
export const climaPlugin: PluginHandler = {
  command: ['clima', 'weather', 'tiempo'],
  description: 'Obtener información del clima de una ciudad',
  category: 'tools',

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;

    const city = text.trim();

    if (!city) {
      await m.reply(
        `🌤️ *CLIMA*\n\n` +
        `📝 Uso: /clima <ciudad>\n\n` +
        `📌 Ejemplos:\n` +
        `• /clima Ciudad de México\n` +
        `• /clima Madrid, España\n` +
        `• /clima New York\n` +
        `• /clima Tokyo`
      );
      return;
    }

    await m.react('⏳');

    const result = await getWeather(city);

    if (!result.success || !result.data) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo obtener el clima'}`);
      return;
    }

    const emoji = getWeatherEmoji(result.data.condition);

    await m.react('✅');

    await m.reply(
      `${emoji} *CLIMA ACTUAL*\n\n` +
      `📍 *Ubicación:* ${result.data.location}\n\n` +
      `🌡️ *Temperatura:* ${result.data.temperature}°C\n` +
      `🤔 *Sensación:* ${result.data.feelsLike}°C\n` +
      `☁️ *Condición:* ${result.data.condition}\n\n` +
      `💧 *Humedad:* ${result.data.humidity}%\n` +
      `💨 *Viento:* ${result.data.wind}\n` +
      `👁️ *Visibilidad:* ${result.data.visibility} km\n` +
      `☀️ *Índice UV:* ${result.data.uvIndex}\n` +
      `🌧️ *Precipitación:* ${result.data.precipitation} mm`
    );
  }
};
