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

/**
 * Inverso de resolveResponsibleStaffIds(): dado un miembro del staff, a qué
 * grado+sección está asignado HOY (mismo criterio de prioridad: excepción
 * del día sobre horario semanal recurrente). Se usa solo para MOSTRAR la
 * asignación en "Mi Salón" (ej. "Asignado hoy a: 03 - Jaguars") — la lista
 * de quién llegó sigue armándose por separado desde `notifications`, no
 * desde acá, así que esto no puede desalinear a quién se le muestra un
 * padre. Sin este indicador, un staff sin ninguna tarjeta no podía saber si
 * era porque no tiene asignación o porque nadie ha llegado todavía.
 *
 * En vez de resolver grado por grado, trae todas las asignaciones y
 * excepciones de hoy en dos consultas y calcula en memoria — una sola
 * pasada por colegio, sin importar cuántos grados/secciones tenga.
 */
export async function resolveMyGradeSectionsToday(
  tenantId: string,
  staffId: string,
  scheduleType: DismissalScheduleType,
  date: Date = new Date(),
): Promise<Array<{ gradeName: string; section: string }>> {
  if (!tenantId || !staffId) return [];

  const { data: grades } = await supabase
    .from('school_grades')
    .select('id, name, sections')
    .eq('tenant_id', tenantId);
  if (!grades || grades.length === 0) return [];

  const dateStr = date.toISOString().slice(0, 10);
  const dayOfWeek = date.getDay();

  const [{ data: assignmentRows }, { data: overrideRows }] = await Promise.all([
    supabase
      .from('dismissal_assignments')
      .select('grade_id, staff_id, staff_id_2, section')
      .eq('tenant_id', tenantId)
      .eq('schedule_type', scheduleType)
      .eq('day_of_week', dayOfWeek),
    supabase
      .from('dismissal_overrides')
      .select('grade_id, staff_id, section, slot')
      .eq('tenant_id', tenantId)
      .eq('schedule_type', scheduleType)
      .eq('override_date', dateStr),
  ]);

  const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();
  const pickExact = <T extends { section: string }>(rows: T[], sectionValue: string): T | undefined =>
    rows.find(r => norm(r.section) === sectionValue) || rows.find(r => norm(r.section) === '');

  const result: Array<{ gradeName: string; section: string }> = [];

  for (const grade of grades) {
    // Un grado sin secciones configuradas se trata como una sola sección en
    // blanco (mismo fallback que usa el resto de la app para ese caso).
    const sections: string[] = grade.sections && grade.sections.length > 0 ? grade.sections : [''];

    for (const section of sections) {
      const sectionValue = norm(section);

      const gradeAssignments = (assignmentRows || []).filter(r => r.grade_id === grade.id);
      const assignment = gradeAssignments.length > 0 ? pickExact(gradeAssignments, sectionValue) : undefined;
      let slot1: string | null = assignment?.staff_id ?? null;
      let slot2: string | null = assignment?.staff_id_2 ?? null;

      const gradeOverrides = (overrideRows || []).filter(r => r.grade_id === grade.id);
      if (gradeOverrides.length > 0) {
        const slot1Overrides = gradeOverrides.filter(o => o.slot === 1);
        const slot2Overrides = gradeOverrides.filter(o => o.slot === 2);
        const slot1Pick = slot1Overrides.length > 0 ? pickExact(slot1Overrides, sectionValue) : undefined;
        const slot2Pick = slot2Overrides.length > 0 ? pickExact(slot2Overrides, sectionValue) : undefined;
        if (slot1Pick) slot1 = slot1Pick.staff_id;
        if (slot2Pick) slot2 = slot2Pick.staff_id;
      }

      if (slot1 === staffId || slot2 === staffId) {
        result.push({ gradeName: grade.name, section });
      }
    }
  }

  return result;
}
