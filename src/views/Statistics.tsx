import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  BarChart3, Clock, Navigation, DoorOpen, UserPlus, FileEdit,
  Car, Users, Loader2, TrendingUp,
} from 'lucide-react';

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const PERIOD_OPTIONS = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
];

function minutesBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const diff = (new Date(b).getTime() - new Date(a).getTime()) / 60000;
  return diff >= 0 ? diff : null;
}

function formatMinutes(mins: number | null): string {
  if (mins === null || Number.isNaN(mins)) return '—';
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}min`;
}

// Barra horizontal simple sin librería — suficiente para un primer vistazo,
// se puede reemplazar por una librería de gráficos más adelante si hace falta.
const Bar: React.FC<{ label: string; value: number; max: number; colorClass?: string }> = ({ label, value, max, colorClass = 'bg-indigo-500' }) => {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-[10px] font-black text-slate-400 uppercase text-right">{label}</span>
      <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${colorClass} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-[10px] font-black text-slate-600 text-right">{value}</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sublabel }: { icon: any; label: string; value: string; sublabel?: string }) {
  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 bg-slate-100 rounded-lg">
          <Icon className="w-4 h-4 text-slate-500" />
        </div>
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-2xl font-black text-slate-800">{value}</p>
      {sublabel && <p className="text-[10px] font-bold text-slate-400 mt-1">{sublabel}</p>}
    </div>
  );
}

export function Statistics() {
  const { profile } = useAuth() as any;
  const [periodDays, setPeriodDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const [pickupEvents, setPickupEvents] = useState<any[]>([]);
  const [replacementRequests, setReplacementRequests] = useState<any[]>([]);
  const [visitors, setVisitors] = useState<any[]>([]);
  const [forms, setForms] = useState<any[]>([]);
  const [formResponses, setFormResponses] = useState<any[]>([]);
  const [carpoolCount, setCarpoolCount] = useState(0);
  const [community, setCommunity] = useState({ totalStudents: 0, totalParents: 0 });

  useEffect(() => {
    fetchAll();
  }, [profile?.tenant_id, periodDays]);

  const fetchAll = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);

    const since = new Date();
    since.setDate(since.getDate() - periodDays);
    const sinceISO = since.toISOString();

    const [
      pickupsRes,
      replacementsRes,
      visitorsRes,
      formsRes,
      studentsCountRes,
      parentsCountRes,
    ] = await Promise.all([
      supabase
        .from('pickup_events')
        .select('id, status, announced_at, released_at, completed_at, door_id, location_verified')
        .eq('tenant_id', profile.tenant_id)
        .gte('announced_at', sinceISO),
      supabase
        .from('replacement_requests')
        .select('id, status, created_at')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', sinceISO),
      supabase
        .from('daily_visitors')
        .select('id, reason, check_in_time')
        .eq('tenant_id', profile.tenant_id)
        .gte('check_in_time', sinceISO),
      supabase
        .from('forms')
        .select('id, form_type, created_at, form_responses(count)')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', sinceISO),
      supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', profile.tenant_id),
      supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', profile.tenant_id)
        .eq('role', 'parent'),
    ]);

    setPickupEvents(pickupsRes.data || []);
    setReplacementRequests(replacementsRes.data || []);
    setVisitors(visitorsRes.data || []);
    setForms(formsRes.data || []);
    setCommunity({
      totalStudents: studentsCountRes.count || 0,
      totalParents: parentsCountRes.count || 0,
    });

    // Respuestas: se piden aparte, filtradas por los ids de forms del
    // periodo, porque el conteo embebido de arriba solo sirve para el total
    // por formulario, no para saber cuándo llegó cada respuesta individual.
    const formIds = (formsRes.data || []).map((f: any) => f.id);
    if (formIds.length > 0) {
      const { data: responsesData } = await supabase
        .from('form_responses')
        .select('id, form_id, created_at')
        .in('form_id', formIds);
      setFormResponses(responsesData || []);
    } else {
      setFormResponses([]);
    }

    const [{ count: carpoolAuthCount }, { count: carpoolOverrideCount }] = await Promise.all([
      supabase
        .from('carpool_authorizations')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', sinceISO),
      supabase
        .from('carpool_overrides')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', sinceISO),
    ]);
    setCarpoolCount((carpoolAuthCount || 0) + (carpoolOverrideCount || 0));

    setLoading(false);
  };

  const stats = useMemo(() => {
    const completed = pickupEvents.filter(p => p.status === 'completed');
    const withCycleTime = completed
      .map(p => minutesBetween(p.announced_at, p.completed_at))
      .filter((m): m is number => m !== null);
    const avgCycleMinutes = withCycleTime.length > 0
      ? withCycleTime.reduce((a, b) => a + b, 0) / withCycleTime.length
      : null;

    const withResponseTime = pickupEvents
      .map(p => minutesBetween(p.announced_at, p.released_at))
      .filter((m): m is number => m !== null);
    const avgResponseMinutes = withResponseTime.length > 0
      ? withResponseTime.reduce((a, b) => a + b, 0) / withResponseTime.length
      : null;

    const withLocationFlag = pickupEvents.filter(p => p.location_verified !== null && p.location_verified !== undefined);
    const gpsCount = withLocationFlag.filter(p => p.location_verified === true).length;
    const gpsPct = withLocationFlag.length > 0 ? Math.round((gpsCount / withLocationFlag.length) * 100) : null;

    const doorCounts: Record<string, number> = {};
    pickupEvents.forEach(p => {
      const door = p.door_id || 'Sin especificar';
      doorCounts[door] = (doorCounts[door] || 0) + 1;
    });
    const topDoor = Object.entries(doorCounts).sort((a, b) => b[1] - a[1])[0];

    const hourCounts: number[] = new Array(24).fill(0);
    const dayCounts: number[] = new Array(7).fill(0);
    pickupEvents.forEach(p => {
      if (!p.announced_at) return;
      const d = new Date(p.announced_at);
      hourCounts[d.getHours()]++;
      dayCounts[d.getDay()]++;
    });
    const activeHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter(h => h.count > 0);
    const maxHourCount = Math.max(1, ...hourCounts);
    const maxDayCount = Math.max(1, ...dayCounts);

    const replacementApproved = replacementRequests.filter(r => r.status === 'approved').length;
    const replacementRejected = replacementRequests.filter(r => r.status === 'rejected').length;
    const replacementPending = replacementRequests.filter(r => r.status === 'pending').length;
    const replacementDecided = replacementApproved + replacementRejected;
    const replacementApprovalRate = replacementDecided > 0
      ? Math.round((replacementApproved / replacementDecided) * 100)
      : null;

    const avisos = forms.filter(f => f.form_type === 'announcement');
    const autorizaciones = forms.filter(f => f.form_type !== 'announcement');
    // Nota: la tasa real de respuesta por padre destinatario requeriría cruzar
    // grados/secciones objetivo con la matrícula — fuera de alcance de este
    // primer corte. Aquí solo se muestra el conteo total enviado/respondido.

    const visitorReasonCounts: Record<string, number> = {};
    visitors.forEach(v => {
      const reason = (v.reason || 'Sin motivo').trim() || 'Sin motivo';
      visitorReasonCounts[reason] = (visitorReasonCounts[reason] || 0) + 1;
    });
    const topReasons = Object.entries(visitorReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

    return {
      totalAnnounced: pickupEvents.length,
      totalCompleted: completed.length,
      avgCycleMinutes,
      avgResponseMinutes,
      gpsPct,
      gpsCount,
      manualCount: withLocationFlag.length - gpsCount,
      topDoor,
      hourCounts,
      activeHours,
      maxHourCount,
      dayCounts,
      maxDayCount,
      replacementTotal: replacementRequests.length,
      replacementApproved,
      replacementRejected,
      replacementPending,
      replacementApprovalRate,
      avisosCount: avisos.length,
      autorizacionesCount: autorizaciones.length,
      formResponsesCount: formResponses.length,
      visitorsTotal: visitors.length,
      topReasons,
    };
  }, [pickupEvents, replacementRequests, visitors, forms, formResponses]);

  return (
    <div className="min-h-screen bg-[#f1f5f9] font-sans p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-[#0f172a] rounded-xl">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-800">Estadísticas</h1>
            <p className="text-[11px] font-bold text-slate-400">Datos del colegio en el periodo seleccionado</p>
          </div>
        </div>
        <div className="flex gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm self-start">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.days}
              onClick={() => setPeriodDays(opt.days)}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                periodDays === opt.days ? 'bg-[#0f172a] text-white' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPIs principales */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={TrendingUp}
              label="Recogidas completadas"
              value={String(stats.totalCompleted)}
              sublabel={`${stats.totalAnnounced} anunciadas en total`}
            />
            <StatCard
              icon={Clock}
              label="Tiempo promedio de recogida"
              value={formatMinutes(stats.avgCycleMinutes)}
              sublabel="Desde que llega hasta que se retira"
            />
            <StatCard
              icon={Navigation}
              label="Ubicación automática"
              value={stats.gpsPct !== null ? `${stats.gpsPct}%` : '—'}
              sublabel={`${stats.manualCount} confirmaron manualmente`}
            />
            <StatCard
              icon={DoorOpen}
              label="Puerta más usada"
              value={stats.topDoor ? stats.topDoor[0] : '—'}
              sublabel={stats.topDoor ? `${stats.topDoor[1]} recogidas` : undefined}
            />
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Recogidas por hora */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider mb-5">Recogidas por hora del día</h3>
              {stats.activeHours.length === 0 ? (
                <p className="text-[11px] font-bold text-slate-300 italic text-center py-8">Sin datos en este periodo</p>
              ) : (
                <div className="space-y-2.5">
                  {stats.activeHours.map(h => (
                    <Bar key={h.hour} label={`${h.hour}:00`} value={h.count} max={stats.maxHourCount} />
                  ))}
                </div>
              )}
            </section>

            {/* Recogidas por día de la semana */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider mb-5">Recogidas por día de la semana</h3>
              <div className="space-y-2.5">
                {DAY_LABELS.map((label, i) => (
                  <Bar key={label} label={label} value={stats.dayCounts[i]} max={stats.maxDayCount} colorClass="bg-emerald-500" />
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Reemplazos */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <div className="flex items-center gap-2 mb-5">
                <UserPlus className="w-4 h-4 text-slate-400" />
                <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider">Reemplazos de recogida</h3>
              </div>
              <p className="text-2xl font-black text-slate-800 mb-1">{stats.replacementTotal}</p>
              <p className="text-[10px] font-bold text-slate-400 mb-4">solicitados en el periodo</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-emerald-50 rounded-lg py-2">
                  <p className="text-lg font-black text-emerald-600">{stats.replacementApproved}</p>
                  <p className="text-[8px] font-black text-emerald-600 uppercase">Aprobados</p>
                </div>
                <div className="bg-rose-50 rounded-lg py-2">
                  <p className="text-lg font-black text-rose-600">{stats.replacementRejected}</p>
                  <p className="text-[8px] font-black text-rose-600 uppercase">Rechazados</p>
                </div>
                <div className="bg-amber-50 rounded-lg py-2">
                  <p className="text-lg font-black text-amber-600">{stats.replacementPending}</p>
                  <p className="text-[8px] font-black text-amber-600 uppercase">Pendientes</p>
                </div>
              </div>
              {stats.replacementApprovalRate !== null && (
                <p className="text-[10px] font-bold text-slate-400 mt-3 text-center">
                  {stats.replacementApprovalRate}% de tasa de aprobación
                </p>
              )}
            </section>

            {/* Avisos y autorizaciones */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <div className="flex items-center gap-2 mb-5">
                <FileEdit className="w-4 h-4 text-slate-400" />
                <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider">Avisos y autorizaciones</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <p className="text-2xl font-black text-slate-800">{stats.avisosCount}</p>
                  <p className="text-[9px] font-black text-slate-400 uppercase">Avisos enviados</p>
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800">{stats.autorizacionesCount}</p>
                  <p className="text-[9px] font-black text-slate-400 uppercase">Autorizaciones</p>
                </div>
              </div>
              <p className="text-[11px] font-bold text-slate-500">
                {stats.formResponsesCount} respuestas recibidas en total
              </p>
            </section>

            {/* Pool Day */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <div className="flex items-center gap-2 mb-5">
                <Car className="w-4 h-4 text-slate-400" />
                <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider">Pool Day</h3>
              </div>
              <p className="text-2xl font-black text-slate-800">{carpoolCount}</p>
              <p className="text-[10px] font-bold text-slate-400">autorizaciones nuevas en el periodo</p>
            </section>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Visitantes */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 lg:col-span-2">
              <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider mb-5">Visitantes registrados</h3>
              <p className="text-2xl font-black text-slate-800 mb-4">{stats.visitorsTotal}</p>
              {stats.topReasons.length > 0 && (
                <div className="space-y-2.5">
                  {stats.topReasons.map(([reason, count]) => (
                    <Bar key={reason} label={reason.slice(0, 12)} value={count} max={stats.topReasons[0][1]} colorClass="bg-amber-500" />
                  ))}
                </div>
              )}
            </section>

            {/* Comunidad */}
            <section className="bg-[#0f172a] p-6 rounded-xl shadow-sm">
              <div className="flex items-center gap-2 mb-5">
                <Users className="w-4 h-4 text-white/60" />
                <h3 className="text-[12px] font-black text-white uppercase tracking-wider">Comunidad</h3>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-2xl font-black text-white">{community.totalStudents}</p>
                  <p className="text-[9px] font-black text-white/50 uppercase">Alumnos registrados</p>
                </div>
                <div>
                  <p className="text-2xl font-black text-white">{community.totalParents}</p>
                  <p className="text-[9px] font-black text-white/50 uppercase">Padres registrados</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
