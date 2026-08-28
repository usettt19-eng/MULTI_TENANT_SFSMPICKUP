// SmartCheckIn.tsx guarda esto en pickup_events.notes cuando el que llega es
// un reemplazo autorizado (no el papá/mamá/tutor) verificado por QR — así
// cualquier pantalla que lea pickup_events puede mostrar/anunciar el nombre
// correcto en vez de asumir que quien llegó fue el titular de la cuenta.
export const REPLACEMENT_NOTE_PREFIX = '[REEMPLAZO] ';

export function getReplacementNameFromNotes(notes: string | null | undefined): string | null {
  if (!notes || !notes.startsWith(REPLACEMENT_NOTE_PREFIX)) return null;
  return notes.slice(REPLACEMENT_NOTE_PREFIX.length);
}

// Umbral para marcar un anuncio de llegada como atrasado en las pantallas de
// personal (no para nada visible al padre).
export const STALE_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutos

export function formatAnnouncedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const time = d.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit' })} ${time}`;
}

export function isStaleAnnouncement(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > STALE_THRESHOLD_MS;
}
