import { supabase } from './supabase';
import type { DismissalScheduleType } from '../types/database';

/**
 * Resuelve quién es el encargado de la salida (o del post school) de un
 * grado+sección en una fecha dada, en este orden de prioridad:
 *   1. Excepción de ese día exacto (dismissal_overrides).
 *   2. Horario semanal recurrente (dismissal_assignments) para ese día de
 *      la semana.
 *   3. null si no hay nadie asignado (el flujo compartido de recepción/admin
 *      sigue funcionando igual, esto solo agrega un aviso dirigido).
 *
 * Compara `gradeName`/`section` contra el texto libre en `students`, ya que
 * ahí no hay una relación formal a `school_grades`.
 */
export async function resolveResponsibleStaff(
  tenantId: string,
  gradeName: string | null | undefined,
  section: string | null | undefined,
  scheduleType: DismissalScheduleType,
  date: Date = new Date(),
): Promise<string | null> {
  if (!tenantId || !gradeName) return null;

  const { data: grade } = await supabase
    .from('school_grades')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('name', gradeName)
    .maybeSingle();
  if (!grade) return null;

  const dateStr = date.toISOString().slice(0, 10);
  const dayOfWeek = date.getDay();
  const sectionValue = (section || '').trim();

  const { data: override } = await supabase
    .from('dismissal_overrides')
    .select('staff_id, section')
    .eq('tenant_id', tenantId)
    .eq('grade_id', grade.id)
    .eq('schedule_type', scheduleType)
    .eq('override_date', dateStr)
    .in('section', sectionValue ? [sectionValue, ''] : ['']);
  if (override && override.length > 0) {
    const exact = override.find(o => o.section === sectionValue);
    return (exact || override[0]).staff_id;
  }

  const { data: assignment } = await supabase
    .from('dismissal_assignments')
    .select('staff_id, section')
    .eq('tenant_id', tenantId)
    .eq('grade_id', grade.id)
    .eq('schedule_type', scheduleType)
    .eq('day_of_week', dayOfWeek)
    .in('section', sectionValue ? [sectionValue, ''] : ['']);
  if (assignment && assignment.length > 0) {
    const exact = assignment.find(a => a.section === sectionValue);
    return (exact || assignment[0]).staff_id;
  }

  return null;
}
