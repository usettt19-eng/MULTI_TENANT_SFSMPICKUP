import { supabase } from './supabase';
import type { DismissalScheduleType } from '../types/database';

/**
 * Resuelve quiénes son los encargados de la salida (o del post school) de un
 * grado+sección en una fecha dada — hasta 2 personas, "slot 1" y "slot 2".
 * Para cada slot, en este orden de prioridad:
 *   1. Excepción de ese día exacto para ese slot (dismissal_overrides.slot).
 *   2. Horario semanal recurrente (dismissal_assignments.staff_id / staff_id_2)
 *      para ese día de la semana.
 *   3. Sin nadie en ese slot (el flujo compartido de recepción/admin sigue
 *      funcionando igual, esto solo agrega un aviso dirigido).
 *
 * Compara `gradeName`/`section` contra el texto libre en `students`, ya que
 * ahí no hay una relación formal a `school_grades`.
 */
export async function resolveResponsibleStaffIds(
  tenantId: string,
  gradeName: string | null | undefined,
  section: string | null | undefined,
  scheduleType: DismissalScheduleType,
  date: Date = new Date(),
): Promise<string[]> {
  if (!tenantId || !gradeName) return [];

  const { data: grade } = await supabase
    .from('school_grades')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('name', gradeName)
    .maybeSingle();
  if (!grade) return [];

  const dateStr = date.toISOString().slice(0, 10);
  const dayOfWeek = date.getDay();
  // Sin distinguir mayúsculas/minúsculas: la sección del alumno ("Year 10")
  // y la de la asignación en Ajustes ("YEAR 10") no siempre coinciden letra
  // por letra.
  const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();
  const sectionValue = norm(section);

  // Entre varias filas candidatas (una con sección exacta, otra "para todo
  // el grado"), la sección exacta gana siempre.
  const pickExact = <T extends { section: string }>(rows: T[]): T | undefined =>
    rows.find(r => norm(r.section) === sectionValue) || rows.find(r => norm(r.section) === '');

  const { data: assignmentRows } = await supabase
    .from('dismissal_assignments')
    .select('staff_id, staff_id_2, section')
    .eq('tenant_id', tenantId)
    .eq('grade_id', grade.id)
    .eq('schedule_type', scheduleType)
    .eq('day_of_week', dayOfWeek);

  const assignment = assignmentRows && assignmentRows.length > 0 ? pickExact(assignmentRows) : undefined;
  let slot1: string | null = assignment?.staff_id ?? null;
  let slot2: string | null = assignment?.staff_id_2 ?? null;

  const { data: overrideRows } = await supabase
    .from('dismissal_overrides')
    .select('staff_id, section, slot')
    .eq('tenant_id', tenantId)
    .eq('grade_id', grade.id)
    .eq('schedule_type', scheduleType)
    .eq('override_date', dateStr);

  if (overrideRows && overrideRows.length > 0) {
    const slot1Overrides = overrideRows.filter(o => o.slot === 1);
    const slot2Overrides = overrideRows.filter(o => o.slot === 2);
    const slot1Pick = slot1Overrides.length > 0 ? pickExact(slot1Overrides) : undefined;
    const slot2Pick = slot2Overrides.length > 0 ? pickExact(slot2Overrides) : undefined;
    if (slot1Pick) slot1 = slot1Pick.staff_id;
    if (slot2Pick) slot2 = slot2Pick.staff_id;
  }

  return Array.from(new Set([slot1, slot2].filter((id): id is string => !!id)));
}
