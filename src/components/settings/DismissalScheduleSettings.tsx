import React, { useState, useEffect } from 'react';
import { supabase, logActivity } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { CalendarClock, Plus, Trash2, AlertCircle, X } from 'lucide-react';
import type {
  SchoolGrade, DismissalAssignment, DismissalOverride, DismissalScheduleType, Profile,
} from '../../types/database';

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
];

const ASSIGNMENT_SELECT =
  '*, staff:profiles!dismissal_assignments_staff_id_fkey(first_name, last_name), staff2:profiles!dismissal_assignments_staff_id_2_fkey(first_name, last_name)';

export function DismissalScheduleSettings() {
  const { profile } = useAuth() as any;
  const [grades, setGrades] = useState<SchoolGrade[]>([]);
  const [staff, setStaff] = useState<Pick<Profile, 'id' | 'first_name' | 'last_name'>[]>([]);
  const [assignments, setAssignments] = useState<DismissalAssignment[]>([]);
  const [overrides, setOverrides] = useState<DismissalOverride[]>([]);
  const [primaryMode, setPrimaryMode] = useState<'teacher' | 'staff'>('teacher');
  const [scheduleType, setScheduleType] = useState<DismissalScheduleType>('regular');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [sectionsByGrade, setSectionsByGrade] = useState<Record<string, string[]>>({});
  const [newSectionInput, setNewSectionInput] = useState<Record<string, string>>({});

  const [ovGradeId, setOvGradeId] = useState('');
  const [ovSection, setOvSection] = useState('');
  const [ovDate, setOvDate] = useState('');
  const [ovSlot, setOvSlot] = useState<1 | 2>(1);
  const [ovStaffId, setOvStaffId] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  useEffect(() => { fetchAll(); }, [profile?.tenant_id]);

  const actorName = () => `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Administrador';

  const fetchAll = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [gradesRes, staffRes, assignRes, overrideRes, settingsRes] = await Promise.all([
        supabase.from('school_grades').select('*').eq('tenant_id', profile.tenant_id).order('level_order'),
        supabase.from('profiles').select('id, first_name, last_name').eq('tenant_id', profile.tenant_id).eq('role', 'admin'),
        supabase.from('dismissal_assignments').select(ASSIGNMENT_SELECT).eq('tenant_id', profile.tenant_id),
        supabase.from('dismissal_overrides').select('*, staff:profiles!staff_id(first_name, last_name)').eq('tenant_id', profile.tenant_id).gte('override_date', today).order('override_date'),
        supabase.from('school_settings').select('primary_dismissal_mode').eq('tenant_id', profile.tenant_id).maybeSingle(),
      ]);

      if (gradesRes.error) throw gradesRes.error;
      if (assignRes.error) throw assignRes.error;
      if (overrideRes.error) throw overrideRes.error;

      setGrades(gradesRes.data || []);
      setStaff(staffRes.data || []);
      setAssignments(assignRes.data || []);
      setOverrides(overrideRes.data || []);
      if (settingsRes.data?.primary_dismissal_mode) setPrimaryMode(settingsRes.data.primary_dismissal_mode);

      // Fuente de verdad: la columna sections del grado. Se une con las secciones
      // que ya tengan asignaciones/excepciones (por si quedaron de antes de esta columna).
      const derived: Record<string, Set<string>> = {};
      (gradesRes.data || []).forEach((g: SchoolGrade) => {
        derived[g.id] = new Set(g.sections || []);
      });
      [...(assignRes.data || []), ...(overrideRes.data || [])].forEach((row: any) => {
        if (!row.section) return;
        if (!derived[row.grade_id]) derived[row.grade_id] = new Set();
        derived[row.grade_id].add(row.section);
      });
      const derivedObj: Record<string, string[]> = {};
      Object.entries(derived).forEach(([gradeId, set]) => { derivedObj[gradeId] = Array.from(set).sort(); });
      setSectionsByGrade(derivedObj);
    } catch (err: any) {
      console.error(err);
      setError(
        err?.code === '42P01'
          ? 'Las tablas de horarios de salida todavía no existen en esta base de datos.'
          : (err.message || 'No se pudo cargar la configuración de horarios.')
      );
    } finally {
      setLoading(false);
    }
  };

  const saveSections = async (gradeId: string, sections: string[]) => {
    const { error } = await supabase.from('school_grades').update({ sections }).eq('id', gradeId);
    if (error) throw error;
    setGrades(prev => prev.map(g => (g.id === gradeId ? { ...g, sections } : g)));
  };

  const addSection = async (gradeId: string) => {
    const value = (newSectionInput[gradeId] || '').trim();
    if (!value) return;
    const current = sectionsByGrade[gradeId] || [];
    if (current.includes(value)) { setNewSectionInput(prev => ({ ...prev, [gradeId]: '' })); return; }
    const next = [...current, value].sort();
    setSectionsByGrade(prev => ({ ...prev, [gradeId]: next }));
    setNewSectionInput(prev => ({ ...prev, [gradeId]: '' }));
    try {
      await saveSections(gradeId, next);
    } catch (err: any) {
      setSectionsByGrade(prev => ({ ...prev, [gradeId]: current }));
      alert('Error al guardar la sección: ' + err.message);
    }
  };

  const removeSection = async (gradeId: string, section: string) => {
    if (!confirm(`¿Quitar la sección "${section}"? Los encargados ya asignados a esa sección no se borran, solo deja de aparecer aquí.`)) return;
    const current = sectionsByGrade[gradeId] || [];
    const next = current.filter(s => s !== section);
    setSectionsByGrade(prev => ({ ...prev, [gradeId]: next }));
    try {
      await saveSections(gradeId, next);
    } catch (err: any) {
      setSectionsByGrade(prev => ({ ...prev, [gradeId]: current }));
      alert('Error al quitar la sección: ' + err.message);
    }
  };

  const staffLabel = (id: string | null | undefined) => {
    if (!id) return 'sin asignar';
    const s = staff.find(p => p.id === id);
    return s ? `${s.first_name || ''} ${s.last_name || ''}`.trim() : 'desconocido';
  };

  const getAssignment = (gradeId: string, section: string, dayOfWeek: number) =>
    assignments.find(a => a.grade_id === gradeId && a.section === section && a.schedule_type === scheduleType && a.day_of_week === dayOfWeek);

  const scheduleLabel = scheduleType === 'regular' ? 'salida regular' : 'post school';

  /**
   * Cada fila de dismissal_assignments guarda hasta 2 personas (staff_id y
   * staff_id_2). staff_id es obligatorio en la base de datos: si se vacía el
   * slot 1 pero el slot 2 tiene a alguien, se promueve al slot 1 en vez de
   * dejar la fila en un estado inválido. Si los dos quedan vacíos, se borra
   * la fila entera (mismo comportamiento que antes de tener 2 slots).
   */
  const handleAssignSlot = async (grade: SchoolGrade, section: string, dayOfWeek: number, slot: 1 | 2, staffId: string) => {
    const key = `${grade.id}|${section}|${dayOfWeek}|${slot}`;
    setSavingKey(key);
    const existing = getAssignment(grade.id, section, dayOfWeek);
    const previousStaffId = slot === 1 ? (existing?.staff_id || null) : (existing?.staff_id_2 || null);

    let nextSlot1: string | null = existing?.staff_id || null;
    let nextSlot2: string | null = existing?.staff_id_2 || null;
    if (slot === 1) nextSlot1 = staffId || null; else nextSlot2 = staffId || null;
    if (!nextSlot1 && nextSlot2) { nextSlot1 = nextSlot2; nextSlot2 = null; }

    try {
      if (!nextSlot1) {
        if (existing) {
          const { error } = await supabase.from('dismissal_assignments').delete().eq('id', existing.id);
          if (error) throw error;
          setAssignments(prev => prev.filter(a => a.id !== existing.id));
        }
      } else {
        const { data, error } = await supabase
          .from('dismissal_assignments')
          .upsert(
            { tenant_id: profile.tenant_id, grade_id: grade.id, section, schedule_type: scheduleType, day_of_week: dayOfWeek, staff_id: nextSlot1, staff_id_2: nextSlot2 },
            { onConflict: 'tenant_id,grade_id,section,schedule_type,day_of_week' }
          )
          .select(ASSIGNMENT_SELECT)
          .single();
        if (error) throw error;
        setAssignments(prev => [
          ...prev.filter(a => !(a.grade_id === grade.id && a.section === section && a.schedule_type === scheduleType && a.day_of_week === dayOfWeek)),
          data,
        ]);
      }

      if (previousStaffId !== staffId) {
        const dayLabel = WEEKDAYS.find(d => d.value === dayOfWeek)?.label || String(dayOfWeek);
        await logActivity(
          'DISMISSAL_SCHEDULE',
          `Horario de ${scheduleLabel} actualizado (persona ${slot}): ${grade.name}${section ? ' - ' + section : ''}, ${dayLabel}. ` +
          `Antes: ${staffLabel(previousStaffId)}. Ahora: ${staffLabel(staffId)}.`,
          actorName(),
          { grade_id: grade.id, section, schedule_type: scheduleType, day_of_week: dayOfWeek, slot, previous_staff_id: previousStaffId, new_staff_id: staffId || null },
          profile.tenant_id,
        );
      }
    } catch (err: any) {
      alert('Error al guardar: ' + err.message);
    } finally {
      setSavingKey(null);
    }
  };

  // Primaria: un encargado por slot, aplicado a los 5 días de una vez.
  const handleAssignAllWeekSlot = async (grade: SchoolGrade, section: string, slot: 1 | 2, staffId: string) => {
    setSavingKey(`${grade.id}|${section}|all|${slot}`);
    try {
      const rows = WEEKDAYS.map(d => {
        const existing = getAssignment(grade.id, section, d.value);
        let nextSlot1: string | null = existing?.staff_id || null;
        let nextSlot2: string | null = existing?.staff_id_2 || null;
        if (slot === 1) nextSlot1 = staffId || null; else nextSlot2 = staffId || null;
        if (!nextSlot1 && nextSlot2) { nextSlot1 = nextSlot2; nextSlot2 = null; }
        return { day: d.value, nextSlot1, nextSlot2, existingId: existing?.id };
      });

      const toDelete = rows.filter(r => !r.nextSlot1 && r.existingId).map(r => r.existingId as string);
      const toUpsert = rows.filter(r => r.nextSlot1);

      if (toDelete.length > 0) {
        const { error } = await supabase.from('dismissal_assignments').delete().in('id', toDelete);
        if (error) throw error;
      }

      let upserted: DismissalAssignment[] = [];
      if (toUpsert.length > 0) {
        const { data, error } = await supabase
          .from('dismissal_assignments')
          .upsert(
            toUpsert.map(r => ({
              tenant_id: profile.tenant_id, grade_id: grade.id, section, schedule_type: scheduleType,
              day_of_week: r.day, staff_id: r.nextSlot1, staff_id_2: r.nextSlot2,
            })),
            { onConflict: 'tenant_id,grade_id,section,schedule_type,day_of_week' }
          )
          .select(ASSIGNMENT_SELECT);
        if (error) throw error;
        upserted = data || [];
      }

      setAssignments(prev => [
        ...prev.filter(a => !(a.grade_id === grade.id && a.section === section && a.schedule_type === scheduleType)),
        ...upserted,
      ]);
      await logActivity(
        'DISMISSAL_SCHEDULE',
        `Encargado ${slot} de ${scheduleLabel} actualizado para toda la semana: ${grade.name}${section ? ' - ' + section : ''}. Ahora: ${staffLabel(staffId)}.`,
        actorName(),
        { grade_id: grade.id, section, schedule_type: scheduleType, slot, new_staff_id: staffId || null },
        profile.tenant_id,
      );
    } catch (err: any) {
      alert('Error al guardar: ' + err.message);
    } finally {
      setSavingKey(null);
    }
  };

  const handleCreateOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ovGradeId || !ovDate || !ovStaffId) return;
    setSavingOverride(true);
    try {
      const grade = grades.find(g => g.id === ovGradeId);
      const { data, error } = await supabase
        .from('dismissal_overrides')
        .upsert(
          { tenant_id: profile.tenant_id, grade_id: ovGradeId, section: ovSection, schedule_type: scheduleType, override_date: ovDate, slot: ovSlot, staff_id: ovStaffId, created_by: profile.id },
          { onConflict: 'tenant_id,grade_id,section,schedule_type,override_date,slot' }
        )
        .select('*, staff:profiles!staff_id(first_name, last_name)')
        .single();
      if (error) throw error;
      setOverrides(prev => [...prev.filter(o => o.id !== data.id), data].sort((a, b) => a.override_date.localeCompare(b.override_date)));

      await logActivity(
        'DISMISSAL_OVERRIDE',
        `Reasignación de un solo día (persona ${ovSlot}): ${grade?.name || ''}${ovSection ? ' - ' + ovSection : ''}, ${ovDate} → ${staffLabel(ovStaffId)} (${scheduleLabel}).`,
        actorName(),
        { grade_id: ovGradeId, section: ovSection, schedule_type: scheduleType, override_date: ovDate, slot: ovSlot, staff_id: ovStaffId },
        profile.tenant_id,
      );

      setOvGradeId(''); setOvSection(''); setOvDate(''); setOvSlot(1); setOvStaffId('');
    } catch (err: any) {
      alert('Error al crear la excepción: ' + err.message);
    } finally {
      setSavingOverride(false);
    }
  };

  const handleDeleteOverride = async (ov: DismissalOverride) => {
    if (!confirm('¿Eliminar esta excepción? Ese día se vuelve a usar el horario regular para esa persona.')) return;
    try {
      const { error } = await supabase.from('dismissal_overrides').delete().eq('id', ov.id);
      if (error) throw error;
      setOverrides(prev => prev.filter(o => o.id !== ov.id));
      const grade = grades.find(g => g.id === ov.grade_id);
      await logActivity(
        'DISMISSAL_OVERRIDE',
        `Excepción eliminada (persona ${ov.slot}): ${grade?.name || ''}${ov.section ? ' - ' + ov.section : ''}, ${ov.override_date}. Vuelve al horario regular.`,
        actorName(),
        { grade_id: ov.grade_id, section: ov.section, schedule_type: ov.schedule_type, override_date: ov.override_date, slot: ov.slot },
        profile.tenant_id,
      );
    } catch (err: any) {
      alert('Error al eliminar: ' + err.message);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Cargando horarios de salida...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 flex items-start gap-4">
        <AlertCircle className="w-6 h-6 flex-shrink-0 mt-1" />
        <div>
          <h3 className="font-bold text-lg mb-2">No se pudo cargar</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex gap-2">
        <button
          onClick={() => setScheduleType('regular')}
          className={`px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
            scheduleType === 'regular' ? 'bg-primary text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-200'
          }`}
        >
          Salida Regular
        </button>
        <button
          onClick={() => setScheduleType('post_school')}
          className={`px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
            scheduleType === 'post_school' ? 'bg-primary text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-200'
          }`}
        >
          Post School
        </button>
      </div>

      {grades.length === 0 ? (
        <div className="bg-white rounded-[2.5rem] p-8 border border-slate-100 text-center text-slate-500">
          Primero crea los grados en la pestaña "Estructura y Puertas".
        </div>
      ) : (
        grades.map(grade => {
          const sections = sectionsByGrade[grade.id] && sectionsByGrade[grade.id].length > 0 ? sectionsByGrade[grade.id] : [''];
          const staffModeLabel = grade.stage === 'primaria'
            ? (primaryMode === 'teacher' ? 'Profesor Encargado' : 'Personal Asignado')
            : 'Encargado';

          return (
            <section key={grade.id} className="bg-white rounded-[2rem] sm:rounded-[2.5rem] p-4 sm:p-8 border border-slate-100 shadow-sm space-y-4 sm:space-y-6">
              <div className="flex items-center justify-between border-b border-slate-50 pb-4 flex-wrap gap-2">
                <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2 sm:gap-3 flex-wrap">
                  <CalendarClock className="w-5 h-5 text-indigo-500 shrink-0" /> {grade.name}
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                    {grade.stage === 'primaria' ? 'Primaria' : 'Secundaria'}
                  </span>
                </h3>
                {grade.exit_time && (
                  <span className="text-xs font-bold text-slate-500">Salida: {grade.exit_time.slice(0, 5)}</span>
                )}
              </div>

              <div className="space-y-4">
                {sections.map(section => (
                  <div key={section || '__default__'} className="bg-slate-50 rounded-2xl p-3 sm:p-5 border border-slate-100">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-black text-slate-600 uppercase tracking-widest">
                        Sección {section || '(todo el grado)'}
                      </p>
                      {section && (
                        <button
                          type="button"
                          onClick={() => removeSection(grade.id, section)}
                          title="Quitar sección"
                          className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {grade.stage === 'primaria' ? (
                      <div className="space-y-3">
                        {([1, 2] as const).map(slot => (
                          <div key={slot} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest sm:w-32 shrink-0">
                              {staffModeLabel} {slot}
                            </label>
                            <select
                              value={(slot === 1 ? getAssignment(grade.id, section, 1)?.staff_id : getAssignment(grade.id, section, 1)?.staff_id_2) || ''}
                              onChange={e => handleAssignAllWeekSlot(grade, section, slot, e.target.value)}
                              disabled={savingKey === `${grade.id}|${section}|all|${slot}`}
                              className="flex-1 w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-indigo-500"
                            >
                              <option value="">— Sin asignar —</option>
                              {staff.map(s => (
                                <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="overflow-x-auto -mx-1 px-1">
                        <div className="grid grid-cols-5 gap-2 min-w-[440px]">
                          {WEEKDAYS.map(day => (
                            <div key={day.value} className="space-y-1">
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 text-center">{day.label}</label>
                              {([1, 2] as const).map(slot => (
                                <select
                                  key={slot}
                                  value={(slot === 1 ? getAssignment(grade.id, section, day.value)?.staff_id : getAssignment(grade.id, section, day.value)?.staff_id_2) || ''}
                                  onChange={e => handleAssignSlot(grade, section, day.value, slot, e.target.value)}
                                  disabled={savingKey === `${grade.id}|${section}|${day.value}|${slot}`}
                                  title={`Persona ${slot}`}
                                  className="w-full bg-white border border-slate-200 rounded-xl px-2 py-2.5 text-xs font-medium outline-none focus:border-indigo-500"
                                >
                                  <option value="">—</option>
                                  {staff.map(s => (
                                    <option key={s.id} value={s.id}>{s.first_name} {(s.last_name || '').slice(0, 1)}.</option>
                                  ))}
                                </select>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    placeholder="Nueva sección (ej. A, B)"
                    value={newSectionInput[grade.id] || ''}
                    onChange={e => setNewSectionInput(prev => ({ ...prev, [grade.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSection(grade.id); } }}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => addSection(grade.id)}
                    className="bg-indigo-50 text-indigo-600 px-4 py-2.5 sm:py-0 rounded-xl hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest"
                  >
                    <Plus className="w-4 h-4" /> Sección
                  </button>
                </div>
              </div>
            </section>
          );
        })
      )}

      {/* Excepciones de un solo día */}
      <section className="bg-white rounded-[2rem] sm:rounded-[2.5rem] p-4 sm:p-8 border border-slate-100 shadow-sm space-y-6">
        <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4">
          <CalendarClock className="w-5 h-5 text-amber-500 shrink-0" /> Excepciones de un Día ({scheduleLabel})
        </h3>
        <p className="text-xs text-slate-500 font-medium leading-relaxed">
          Para cuando una de las personas encargadas no está ese día — se reemplaza solo a esa, la otra sigue igual.
          Se aplica solo en la fecha indicada — al día siguiente vuelve automáticamente al horario preprogramado.
          Queda registrado en la bitácora de actividad.
        </p>

        <form onSubmit={handleCreateOverride} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="md:col-span-1">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Grado</label>
            <select required value={ovGradeId} onChange={e => setOvGradeId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-amber-500">
              <option value="">Elegir...</option>
              {grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Sección</label>
            <input value={ovSection} onChange={e => setOvSection(e.target.value)} placeholder="(opcional)" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Fecha</label>
            <input required type="date" value={ovDate} onChange={e => setOvDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Reemplaza a</label>
            <select required value={ovSlot} onChange={e => setOvSlot(Number(e.target.value) as 1 | 2)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-amber-500">
              <option value={1}>Persona 1</option>
              <option value={2}>Persona 2</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Encargado ese día</label>
            <select required value={ovStaffId} onChange={e => setOvStaffId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-amber-500">
              <option value="">Elegir...</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={savingOverride} className="bg-amber-500 text-white py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-amber-600 disabled:opacity-50">
            Asignar Hoy
          </button>
        </form>

        <div className="space-y-2">
          {overrides.filter(o => o.schedule_type === scheduleType).length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No hay excepciones próximas.</p>
          ) : (
            overrides.filter(o => o.schedule_type === scheduleType).map(ov => {
              const grade = grades.find(g => g.id === ov.grade_id);
              return (
                <div key={ov.id} className="flex items-center justify-between gap-3 flex-wrap p-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <div className="text-sm">
                    <span className="font-black text-slate-800">{ov.override_date}</span>
                    <span className="text-slate-500"> — {grade?.name || 'Grado'}{ov.section ? ` - ${ov.section}` : ''} (persona {ov.slot}): </span>
                    <span className="font-bold text-amber-700">{staffLabel(ov.staff_id)}</span>
                  </div>
                  <button onClick={() => handleDeleteOverride(ov)} className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
