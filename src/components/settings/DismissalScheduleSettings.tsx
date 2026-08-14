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
  const [ovStaffId, setOvStaffId] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const actorName = () => `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Administrador';

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [gradesRes, staffRes, assignRes, overrideRes, settingsRes] = await Promise.all([
        supabase.from('school_grades').select('*').order('level_order'),
        supabase.from('profiles').select('id, first_name, last_name').eq('role', 'admin'),
        supabase.from('dismissal_assignments').select('*, staff:profiles(first_name, last_name)'),
        supabase.from('dismissal_overrides').select('*, staff:profiles(first_name, last_name)').gte('override_date', today).order('override_date'),
        supabase.from('school_settings').select('primary_dismissal_mode').maybeSingle(),
      ]);

      if (gradesRes.error) throw gradesRes.error;
      if (assignRes.error) throw assignRes.error;
      if (overrideRes.error) throw overrideRes.error;

      setGrades(gradesRes.data || []);
      setStaff(staffRes.data || []);
      setAssignments(assignRes.data || []);
      setOverrides(overrideRes.data || []);
      if (settingsRes.data?.primary_dismissal_mode) setPrimaryMode(settingsRes.data.primary_dismissal_mode);

      const derived: Record<string, Set<string>> = {};
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

  const addSection = (gradeId: string) => {
    const value = (newSectionInput[gradeId] || '').trim();
    if (!value) return;
    setSectionsByGrade(prev => {
      const current = prev[gradeId] || [];
      if (current.includes(value)) return prev;
      return { ...prev, [gradeId]: [...current, value].sort() };
    });
    setNewSectionInput(prev => ({ ...prev, [gradeId]: '' }));
  };

  const staffLabel = (id: string | null | undefined) => {
    if (!id) return 'sin asignar';
    const s = staff.find(p => p.id === id);
    return s ? `${s.first_name || ''} ${s.last_name || ''}`.trim() : 'desconocido';
  };

  const getAssignment = (gradeId: string, section: string, dayOfWeek: number) =>
    assignments.find(a => a.grade_id === gradeId && a.section === section && a.schedule_type === scheduleType && a.day_of_week === dayOfWeek);

  const scheduleLabel = scheduleType === 'regular' ? 'salida regular' : 'post school';

  const handleAssignDay = async (grade: SchoolGrade, section: string, dayOfWeek: number, staffId: string) => {
    const key = `${grade.id}|${section}|${dayOfWeek}`;
    setSavingKey(key);
    const existing = getAssignment(grade.id, section, dayOfWeek);
    const previousStaffId = existing?.staff_id || null;

    try {
      if (!staffId) {
        if (existing) {
          const { error } = await supabase.from('dismissal_assignments').delete().eq('id', existing.id);
          if (error) throw error;
          setAssignments(prev => prev.filter(a => a.id !== existing.id));
        }
      } else {
        const { data, error } = await supabase
          .from('dismissal_assignments')
          .upsert(
            { tenant_id: profile.tenant_id, grade_id: grade.id, section, schedule_type: scheduleType, day_of_week: dayOfWeek, staff_id: staffId },
            { onConflict: 'tenant_id,grade_id,section,schedule_type,day_of_week' }
          )
          .select('*, staff:profiles(first_name, last_name)')
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
          `Horario de ${scheduleLabel} actualizado: ${grade.name}${section ? ' - ' + section : ''}, ${dayLabel}. ` +
          `Antes: ${staffLabel(previousStaffId)}. Ahora: ${staffLabel(staffId)}.`,
          actorName(),
          { grade_id: grade.id, section, schedule_type: scheduleType, day_of_week: dayOfWeek, previous_staff_id: previousStaffId, new_staff_id: staffId || null },
          profile.tenant_id,
        );
      }
    } catch (err: any) {
      alert('Error al guardar: ' + err.message);
    } finally {
      setSavingKey(null);
    }
  };

  // Primaria: un solo encargado aplicado a los 5 días de una vez.
  const handleAssignAllWeek = async (grade: SchoolGrade, section: string, staffId: string) => {
    if (!staffId) return;
    setSavingKey(`${grade.id}|${section}|all`);
    try {
      const rows = WEEKDAYS.map(d => ({
        tenant_id: profile.tenant_id, grade_id: grade.id, section, schedule_type: scheduleType, day_of_week: d.value, staff_id: staffId,
      }));
      const { data, error } = await supabase
        .from('dismissal_assignments')
        .upsert(rows, { onConflict: 'tenant_id,grade_id,section,schedule_type,day_of_week' })
        .select('*, staff:profiles(first_name, last_name)');
      if (error) throw error;
      setAssignments(prev => [
        ...prev.filter(a => !(a.grade_id === grade.id && a.section === section && a.schedule_type === scheduleType)),
        ...(data || []),
      ]);
      await logActivity(
        'DISMISSAL_SCHEDULE',
        `Encargado de ${scheduleLabel} actualizado para toda la semana: ${grade.name}${section ? ' - ' + section : ''}. Ahora: ${staffLabel(staffId)}.`,
        actorName(),
        { grade_id: grade.id, section, schedule_type: scheduleType, new_staff_id: staffId },
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
          { tenant_id: profile.tenant_id, grade_id: ovGradeId, section: ovSection, schedule_type: scheduleType, override_date: ovDate, staff_id: ovStaffId, created_by: profile.id },
          { onConflict: 'tenant_id,grade_id,section,schedule_type,override_date' }
        )
        .select('*, staff:profiles(first_name, last_name)')
        .single();
      if (error) throw error;
      setOverrides(prev => [...prev.filter(o => o.id !== data.id), data].sort((a, b) => a.override_date.localeCompare(b.override_date)));

      await logActivity(
        'DISMISSAL_OVERRIDE',
        `Reasignación de un solo día: ${grade?.name || ''}${ovSection ? ' - ' + ovSection : ''}, ${ovDate} → ${staffLabel(ovStaffId)} (${scheduleLabel}).`,
        actorName(),
        { grade_id: ovGradeId, section: ovSection, schedule_type: scheduleType, override_date: ovDate, staff_id: ovStaffId },
        profile.tenant_id,
      );

      setOvGradeId(''); setOvSection(''); setOvDate(''); setOvStaffId('');
    } catch (err: any) {
      alert('Error al crear la excepción: ' + err.message);
    } finally {
      setSavingOverride(false);
    }
  };

  const handleDeleteOverride = async (ov: DismissalOverride) => {
    if (!confirm('¿Eliminar esta excepción? Ese día se vuelve a usar el horario regular.')) return;
    try {
      const { error } = await supabase.from('dismissal_overrides').delete().eq('id', ov.id);
      if (error) throw error;
      setOverrides(prev => prev.filter(o => o.id !== ov.id));
      const grade = grades.find(g => g.id === ov.grade_id);
      await logActivity(
        'DISMISSAL_OVERRIDE',
        `Excepción eliminada: ${grade?.name || ''}${ov.section ? ' - ' + ov.section : ''}, ${ov.override_date}. Vuelve al horario regular.`,
        actorName(),
        { grade_id: ov.grade_id, section: ov.section, schedule_type: ov.schedule_type, override_date: ov.override_date },
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
            <section key={grade.id} className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b border-slate-50 pb-4 flex-wrap gap-2">
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-3">
                  <CalendarClock className="w-5 h-5 text-indigo-500" /> {grade.name}
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
                  <div key={section || '__default__'} className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                    <p className="text-xs font-black text-slate-600 uppercase tracking-widest mb-3">
                      Sección {section || '(todo el grado)'}
                    </p>

                    {grade.stage === 'primaria' ? (
                      <div className="flex items-center gap-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-32">{staffModeLabel}</label>
                        <select
                          value={getAssignment(grade.id, section, 1)?.staff_id || ''}
                          onChange={e => handleAssignAllWeek(grade, section, e.target.value)}
                          disabled={savingKey === `${grade.id}|${section}|all`}
                          className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-indigo-500"
                        >
                          <option value="">— Sin asignar —</option>
                          {staff.map(s => (
                            <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="grid grid-cols-5 gap-2">
                        {WEEKDAYS.map(day => (
                          <div key={day.value}>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 text-center">{day.label}</label>
                            <select
                              value={getAssignment(grade.id, section, day.value)?.staff_id || ''}
                              onChange={e => handleAssignDay(grade, section, day.value, e.target.value)}
                              disabled={savingKey === `${grade.id}|${section}|${day.value}`}
                              className="w-full bg-white border border-slate-200 rounded-xl px-2 py-2.5 text-xs font-medium outline-none focus:border-indigo-500"
                            >
                              <option value="">—</option>
                              {staff.map(s => (
                                <option key={s.id} value={s.id}>{s.first_name} {(s.last_name || '').slice(0, 1)}.</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                <div className="flex gap-3">
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
                    className="bg-indigo-50 text-indigo-600 px-4 rounded-xl hover:bg-indigo-100 transition-colors flex items-center gap-2 text-xs font-black uppercase tracking-widest"
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
      <section className="bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-sm space-y-6">
        <h3 className="text-lg font-black text-slate-900 flex items-center gap-3 border-b border-slate-50 pb-4">
          <CalendarClock className="w-5 h-5 text-amber-500" /> Excepciones de un Día ({scheduleLabel})
        </h3>
        <p className="text-xs text-slate-500 font-medium leading-relaxed">
          Para cuando el encargado habitual no está ese día. Se aplica solo en la fecha indicada — al día siguiente
          vuelve automáticamente al horario preprogramado. Queda registrado en la bitácora de actividad.
        </p>

        <form onSubmit={handleCreateOverride} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
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
                <div key={ov.id} className="flex items-center justify-between p-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <div className="text-sm">
                    <span className="font-black text-slate-800">{ov.override_date}</span>
                    <span className="text-slate-500"> — {grade?.name || 'Grado'}{ov.section ? ` - ${ov.section}` : ''}: </span>
                    <span className="font-bold text-amber-700">{staffLabel(ov.staff_id)}</span>
                  </div>
                  <button onClick={() => handleDeleteOverride(ov)} className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors">
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
