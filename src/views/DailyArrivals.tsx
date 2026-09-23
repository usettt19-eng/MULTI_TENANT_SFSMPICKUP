import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { TopNav } from '../components/TopNav';
import { Sunrise, Users, Loader2, CalendarDays } from 'lucide-react';

interface ArrivalRow {
  studentName: string;
  parentName: string;
  arrivedAt: string;
}

// Claves internas de agrupación (nunca se muestran directas) — el rótulo
// visible sale de sectionLabel() más abajo, que sí pasa por t() para
// cambiar con el idioma.
const NO_SECTION_KEY = '__no_section__';
const NO_STUDENT_KEY = '__no_student__';

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function DailyArrivals() {
  const { profile } = useAuth() as any;
  const { t } = useLanguage();
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [bySection, setBySection] = useState<Record<string, ArrivalRow[]>>({});
  const [totalArrivals, setTotalArrivals] = useState(0);

  useEffect(() => {
    fetchArrivals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenant_id, selectedDate]);

  const fetchArrivals = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);

    const dayStart = new Date(`${selectedDate}T00:00:00`);
    const dayEnd = new Date(`${selectedDate}T23:59:59.999`);

    const { data: arrivals, error } = await supabase
      .from('morning_arrivals')
      .select('id, parent_id, arrived_at')
      .eq('tenant_id', profile.tenant_id)
      .gte('arrived_at', dayStart.toISOString())
      .lte('arrived_at', dayEnd.toISOString())
      .order('arrived_at', { ascending: true });

    if (error) console.error('Error al traer llegadas matutinas:', error);

    if (!arrivals || arrivals.length === 0) {
      setBySection({});
      setTotalArrivals(0);
      setLoading(false);
      return;
    }

    const parentIds = Array.from(new Set(arrivals.map(a => a.parent_id)));

    const [{ data: parents }, { data: links }] = await Promise.all([
      supabase.from('profiles').select('id, first_name, last_name').in('id', parentIds),
      supabase
        .from('parent_students')
        .select('parent_id, students(first_name, last_name, grade, section, tenant_id)')
        .in('parent_id', parentIds)
        .eq('students.tenant_id', profile.tenant_id),
    ]);

    const parentNameById = new Map(
      (parents || []).map((p: any) => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || t('dailyArrivals.parentNoName')])
    );
    const studentsByParent = new Map<string, any[]>();
    (links || []).forEach((l: any) => {
      if (!l.students) return;
      if (!studentsByParent.has(l.parent_id)) studentsByParent.set(l.parent_id, []);
      studentsByParent.get(l.parent_id)!.push(l.students);
    });

    const grouped: Record<string, ArrivalRow[]> = {};
    arrivals.forEach((a: any) => {
      const parentName = parentNameById.get(a.parent_id) || t('dailyArrivals.parentNoName');
      const students = studentsByParent.get(a.parent_id) || [];

      if (students.length === 0) {
        (grouped[NO_STUDENT_KEY] ||= []).push({ studentName: '—', parentName, arrivedAt: a.arrived_at });
        return;
      }

      students.forEach((s: any) => {
        const grade = s.grade || '';
        const section = s.section || '';
        const key = grade || section ? `${grade}${grade && section ? ' · ' : ''}${section}` : NO_SECTION_KEY;
        (grouped[key] ||= []).push({
          studentName: `${s.first_name || ''} ${s.last_name || ''}`.trim() || '—',
          parentName,
          arrivedAt: a.arrived_at,
        });
      });
    });

    setBySection(grouped);
    setTotalArrivals(arrivals.length);
    setLoading(false);
  };

  const sortedSections = Object.keys(bySection).sort((a, b) => {
    if (a === NO_SECTION_KEY || a === NO_STUDENT_KEY) return 1;
    if (b === NO_SECTION_KEY || b === NO_STUDENT_KEY) return -1;
    return a.localeCompare(b);
  });

  const isToday = selectedDate === todayISO();

  const sectionLabel = (key: string) => {
    if (key === NO_SECTION_KEY) return t('dailyArrivals.noSectionAssigned');
    if (key === NO_STUDENT_KEY) return t('dailyArrivals.noStudentLinked');
    return key;
  };

  return (
    <>
      <TopNav title="SmartPickup" subtitle={t('dailyArrivals.subtitle')} />

      <div className="p-8 max-w-7xl mx-auto space-y-8 font-body animate-in fade-in duration-700">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              {t('dailyArrivals.title')} <Sunrise className="w-9 h-9 text-primary" />
            </h1>
            <p className="text-sm text-slate-500 font-medium">
              {t('dailyArrivals.description')}
            </p>
          </div>
          <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-2 px-4">
            <CalendarDays className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-sm font-bold text-slate-700 outline-none bg-transparent"
            />
            {isToday && (
              <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg uppercase tracking-widest">
                {t('dailyArrivals.todayBadge')}
              </span>
            )}
          </div>
        </header>

        {loading ? (
          <div className="h-[40vh] flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-slate-400 font-bold mt-4">{t('dailyArrivals.loading')}</p>
          </div>
        ) : totalArrivals === 0 ? (
          <div className="h-[40vh] flex flex-col items-center justify-center text-center">
            <Sunrise className="w-14 h-14 text-slate-200 mb-4" />
            <p className="text-slate-400 font-bold">{t('dailyArrivals.noArrivalsThatDay')}</p>
          </div>
        ) : (
          <>
            {/* Resumen por sección */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {sortedSections.map(section => (
                <div key={section} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate" title={sectionLabel(section)}>
                    {sectionLabel(section)}
                  </p>
                  <p className="text-3xl font-black text-slate-900 mt-1">{bySection[section].length}</p>
                </div>
              ))}
              <div className="bg-primary text-white rounded-2xl shadow-sm p-5">
                <p className="text-[10px] font-black uppercase tracking-widest opacity-80 flex items-center gap-1">
                  <Users className="w-3 h-3" /> {t('dailyArrivals.totalLabel')}
                </p>
                <p className="text-3xl font-black mt-1">{totalArrivals}</p>
              </div>
            </div>

            {/* Registro detallado por sección */}
            <div className="space-y-6">
              {sortedSections.map(section => (
                <div key={section} className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
                  <div className="px-8 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <h2 className="text-sm font-black text-slate-800 tracking-tight">{sectionLabel(section)}</h2>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      {bySection[section].length} {bySection[section].length !== 1 ? t('dailyArrivals.arrivalsPlural') : t('dailyArrivals.arrivalSingular')}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr>
                          <th className="px-8 py-3 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{t('dailyArrivals.tableHeaderStudent')}</th>
                          <th className="px-8 py-3 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{t('dailyArrivals.tableHeaderParent')}</th>
                          <th className="px-8 py-3 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-right">{t('dailyArrivals.tableHeaderTime')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {bySection[section].map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-8 py-4 text-sm font-bold text-slate-700">{row.studentName}</td>
                            <td className="px-8 py-4 text-sm font-medium text-slate-500">{row.parentName}</td>
                            <td className="px-8 py-4 text-sm font-black text-slate-900 text-right">
                              {new Date(row.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
