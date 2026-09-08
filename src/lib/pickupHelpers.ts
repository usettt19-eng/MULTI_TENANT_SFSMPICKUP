// SmartCheckIn.tsx guarda esto en pickup_events.notes cuando el que llega es
// un reemplazo autorizado (no el papá/mamá/tutor) verificado por QR — así
// cualquier pantalla que lea pickup_events puede mostrar/anunciar el nombre
// correcto en vez de asumir que quien llegó fue el titular de la cuenta.
export const REPLACEMENT_NOTE_PREFIX = '[REEMPLAZO] ';

export function getReplacementNameFromNotes(notes: string | null | undefined): string | null {
  if (!notes || !notes.startsWith(REPLACEMENT_NOTE_PREFIX)) return null;
  return notes.slice(REPLACEMENT_NOTE_PREFIX.length);
}

// Quién "llegó" a buscar al alumno, para el anuncio por voz en recepción —
// un bus (BusRoutesPanel) es, por dentro, un perfil de padre fantasma, así
// que sin este chequeo el anuncio decía "el representante de Fulano ha
// llegado", como si un padre real hubiera venido, en vez de nombrar el bus.
export interface ArrivalLabel {
  isBus: boolean;
  // Bus: nombre de la ruta (ej. "Bus 1"). Padre: la relación (ej. "el papá").
  label: string;
}

export async function resolveArrivalLabel(
  supabase: any,
  parentId: string,
  studentId: string,
): Promise<ArrivalLabel> {
  const { data: busRoute } = await supabase
    .from('bus_routes')
    .select('name')
    .eq('profile_id', parentId)
    .maybeSingle();
  if (busRoute) return { isBus: true, label: busRoute.name };

  const { data: relData } = await supabase
    .from('parent_students')
    .select('relationship')
    .eq('parent_id', parentId)
    .eq('student_id', studentId)
    .maybeSingle();

  let label = 'el representante';
  if (relData?.relationship === 'father') label = 'el papá';
  else if (relData?.relationship === 'mother') label = 'la mamá';
  else if (relData?.relationship === 'guardian') label = 'el tutor';
  return { isBus: false, label };
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

// Un "reemplazo" autorizado (persona distinta al padre/tutor titular que
// puede recoger al alumno) vive dentro de profiles.additional_tutor_name
// como JSON: { replacements: ReplacementAuthorization[] }. Antes de este
// campo, una vez aprobado quedaba válido para siempre, cualquier día — sin
// vencimiento ni restricción. Ahora el padre puede elegir entre: recurrente
// (válido indefinidamente, pero solo los días de semana que marque) o de un
// solo uso (válido una vez, cualquier día, y se consume al escanearse).
export interface ReplacementAuthorization {
  name: string;
  phone?: string;
  photo_url?: string | null;
  token: string;
  created_at: string;
  // Ausente (registros de antes de este campo) se trata como `true` sin
  // restricción de día, igual que el comportamiento original.
  is_recurring?: boolean;
  // 0 = domingo … 6 = sábado. Solo aplica si is_recurring es true.
  days_of_week?: number[] | null;
  // Solo aplica si is_recurring es false: fecha en que se consumió el
  // único uso permitido.
  used_at?: string | null;
  // A cuáles hijos del padre aplica. null/undefined/[] (registros de antes
  // de este campo) se trata como "todos los hijos del padre", igual que el
  // comportamiento original — importa sobre todo para un padre con hijos en
  // dos colegios (parent_school_access): sin esto, autorizar un reemplazo
  // para uno de sus hijos lo autorizaba también en el OTRO colegio.
  student_ids?: string[] | null;
}

export function findMatchingReplacement(
  replacements: ReplacementAuthorization[] | null | undefined,
  token: string,
  name: string,
): ReplacementAuthorization | null {
  return (replacements ?? []).find((r) => r.token === token && r.name === name) ?? null;
}

export function isReplacementAuthorizedNow(r: ReplacementAuthorization): boolean {
  const isRecurring = r.is_recurring !== false;
  if (isRecurring) {
    if (!Array.isArray(r.days_of_week) || r.days_of_week.length === 0) return true;
    return r.days_of_week.includes(new Date().getDay());
  }
  return !r.used_at;
}

export function isReplacementForStudent(r: ReplacementAuthorization, studentId: string): boolean {
  if (!Array.isArray(r.student_ids) || r.student_ids.length === 0) return true;
  return r.student_ids.includes(studentId);
}
