
const handler = (m) => m;

// Verificación silenciosa del estado premium
// Solo actualiza el estado sin enviar mensajes no solicitados
// para evitar que WhatsApp detecte el bot como spam
export async function all(m) {
  if (m.chat.endsWith('broadcast')) return;

  const user = global.db.data.users[m.sender];
  if (!user) return;

  // Solo actualizar el estado si el premium ha expirado
  // NO enviar mensajes - el usuario verá su estado cuando use un comando premium
  if (user.premiumTime != 0 && user.premium) {
    if (new Date() * 1 >= user.premiumTime) {
      user.premiumTime = 0;
      user.premium = false;
      // No enviar mensaje aquí - será notificado cuando intente usar un comando premium
    }
  }
}

export default handler;
