import React, { useEffect, useState, useRef } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { GuestSignModal } from '../components/GuestSignModal';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { GoogleGenAI, Modality } from "@google/genai";
import {
  AlertTriangle, Clock, CheckCircle2, UserPlus, Users,
  BriefcaseMedical, RefreshCw, Activity, Video, Monitor,
  Fingerprint, Wifi, FileWarning, ShieldCheck,
  FileText, TrendingUp, UserCheck, XCircle, Printer,
  ChevronDown, MessageSquare, ClipboardList, FileEdit, Footprints, QrCode,
  FileBarChart, Car, Menu, X
} from 'lucide-react';

import { subscribeToAudioState, enableGlobalAudio, playGlobalVoiceMessage } from '../lib/audioManager';
import { ParentPerimeterPanel } from '../components/ParentPerimeterPanel';
import { DailyReportModal } from '../components/DailyReportModal';
import { BusRoutesPanel } from '../components/BusRoutesPanel';
import type { TranslationKey } from '../i18n/translations';

// carpool_authorizations.day_of_week: 0=domingo...6=sábado (igual que
// CARPOOL_DAY_NAMES en RequestsCenter.tsx). En la práctica siempre va a ser
// un día de colegio (1-5), pero se cubren los 7 por si acaso.
const CARPOOL_WEEKDAY_KEYS: Record<number, TranslationKey> = {
  0: 'settingsDismissal.weekdaySun',
  1: 'settingsDismissal.weekdayMon',
  2: 'settingsDismissal.weekdayTue',
  3: 'settingsDismissal.weekdayWed',
  4: 'settingsDismissal.weekdayThu',
  5: 'settingsDismissal.weekdayFri',
  6: 'settingsDismissal.weekdaySat',
};

export function OperationsDashboard({ setCurrentView }: { setCurrentView: (view: string) => void }) {
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const { toggleMenu, isMenuOpen } = useLayout();
  const [pickups, setPickups] = useState<any[]>([]);
  const isFirstFetch = useRef(true);
  const announcedPickupIds = useRef<Set<string>>(new Set());
  const [latestDetections, setLatestDetections] = useState<Record<string, any>>({});
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [healthAlerts, setHealthAlerts] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const seenPendingRequestIdsRef = useRef<Set<string> | null>(null);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [selectedDoor, setSelectedDoor] = useState('puerta_1');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalChildren: 0, totalParents: 0, topGrade: '' });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  // Interruptor temporal para desactivar el límite de las 11am de
  // ParentDashboard.tsx durante una implementación/prueba (ej. cuando el
  // colegio todavía está ajustando la geocerca y no quieren que ese límite
  // adicional se sume a la confusión). Vive en school_settings, por colegio,
  // y sincroniza en vivo con la app del padre.
  const [announceRestrictionEnabled, setAnnounceRestrictionEnabled] = useState(true);
  const [togglingAnnounceRestriction, setTogglingAnnounceRestriction] = useState(false);
  // Salidas ya completadas hoy (status 'completed', el padre ya confirmó
  // reunión con el alumno), agrupadas por grado/sección — se acumula en
  // tiempo real durante el día vía el mismo canal de pickup_events.
  const [dailyDepartures, setDailyDepartures] = useState<{ grade: string; section: string; count: number }[]>([]);
  // Alumnos que reportaron su propia salida hoy (Salida Autónoma, ver
  // Students.tsx/SmartCheckIn.tsx) — tabla separada de pickup_events (no
  // hay padre ni vehículo), así que se muestra en su propio panel para no
  // mezclarla con las recogidas normales.
  const [selfDismissalsToday, setSelfDismissalsToday] = useState<any[]>([]);
  const [showDailyReportModal, setShowDailyReportModal] = useState(false);
  // Car pools activos (recurrentes, tabla carpool_authorizations) — antes
  // solo se veían de pasada en Solicitudes, mezclados en el feed de
  // actividad y limitados a los últimos 50 creados, así que uno viejo podía
  // desaparecer de la vista aunque siguiera activo. Acá se listan TODOS los
  // configurados ahora mismo, sin límite de fecha de creación.
  const [configuredCarpools, setConfiguredCarpools] = useState<any[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToAudioState((enabled) => {
      setAudioEnabled(enabled);
    });
    return unsubscribe;
  }, []);

  const enableAudio = () => {
    enableGlobalAudio().then(() => {
      playGlobalVoiceMessage("Audio activado correctamente");
    });
  };

  useEffect(() => {
    fetchPickups();
    fetchLatestDetections();
    fetchAuditLogs();
    fetchHealthAlerts();
    fetchPendingRequests();
    fetchStats();
    fetchSchoolSettings();
    fetchDailyDepartures();
    fetchSelfDismissalsToday();
    fetchConfiguredCarpools();

    // pickup_events, self_dismissal_events, replacement_requests,
    // camera_detections, audit_logs, health_alerts, carpool_authorizations y
    // school_settings nunca estuvieron en la publicación de Realtime de
    // Supabase (solo parent_presence lo está) — los .on('postgres_changes',
    // ...) que había acá para esas tablas nunca recibían nada, solo sumaban
    // conexiones sin beneficio. El polling de abajo es, y siempre fue, el
    // mecanismo real que refresca este dashboard.

    // Polling every 10 seconds — mecanismo real de refresco de este dashboard
    const pollInterval = window.setInterval(() => {
      console.log('Dashboard polling...');
      fetchPickups();
      fetchLatestDetections();
      fetchAuditLogs();
      fetchHealthAlerts();
      fetchPendingRequests();
      fetchStats();
      fetchDailyDepartures();
      fetchSelfDismissalsToday();
      fetchConfiguredCarpools();
      fetchSchoolSettings();
    }, 10000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [profile?.tenant_id]);

  const handleQuickScan = () => {
    localStorage.setItem('openAddGuardianModal', 'true');
    setCurrentView('guardians');
  };

  const fetchPickups = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('pickup_events')
      .select('*, student:students(first_name, last_name, grade, tenant_id), parent:profiles(first_name, last_name, pin_code)')
      .eq('tenant_id', profile.tenant_id)
      .in('status', ['announced', 'in_queue'])
      .order('announced_at', { ascending: true });
    
    if (data) {
      setPickups(data);
      
      if (isFirstFetch.current) {
        data.forEach(p => announcedPickupIds.current.add(p.id));
        isFirstFetch.current = false;
      } else {
        data.forEach(async (pickup) => {
          if (pickup.status === 'announced' && !announcedPickupIds.current.has(pickup.id)) {
            announcedPickupIds.current.add(pickup.id);
            
            // Fetch relationship
            const { data: relData } = await supabase
              .from('parent_students')
              .select('relationship')
              .eq('parent_id', pickup.parent_id)
              .eq('student_id', pickup.student_id)
              .maybeSingle();

            const fullName = `${pickup.student?.first_name} ${pickup.student?.last_name}`;
            let relLabel = "el representante";
            if (relData) {
              if (relData.relationship === 'father') relLabel = "el papá";
              else if (relData.relationship === 'mother') relLabel = "la mamá";
              else if (relData.relationship === 'guardian') relLabel = "el tutor";
            }

            console.log(`OperationsDashboard Auto-announcing: ${fullName} (${relLabel})`);
            playGlobalVoiceMessage(`Atención, ${relLabel} de ${fullName} ha llegado.`);
          }
        });
      }
    }
    setLoading(false);
  };

  // Cuenta las salidas ya completadas hoy (el padre confirmó reunión con el
  // alumno), agrupadas por grado/sección — el acumulado del día que pidió
  // el colegio. Se recalcula en cada cambio de pickup_events, así que crece
  // en tiempo real conforme se van completando ciclos.
  const fetchDailyDepartures = async () => {
    if (!profile?.tenant_id) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('pickup_events')
      .select('student:students(grade, section)')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'completed')
      .gte('completed_at', startOfDay.toISOString());

    if (error) {
      console.error('Error cargando salidas del día:', error);
      return;
    }

    const counts = new Map<string, { grade: string; section: string; count: number }>();
    (data || []).forEach((row: any) => {
      const grade = row.student?.grade || '—';
      const section = row.student?.section || '—';
      const key = `${grade}|${section}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { grade, section, count: 1 });
    });

    setDailyDepartures(
      Array.from(counts.values()).sort((a, b) =>
        a.grade.localeCompare(b.grade, 'es', { numeric: true }) || a.section.localeCompare(b.section, 'es', { numeric: true })
      )
    );
  };

  const fetchSelfDismissalsToday = async () => {
    if (!profile?.tenant_id) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('self_dismissal_events')
      .select('id, method, created_at, student:students(first_name, last_name, grade, section, photo_url)')
      .eq('tenant_id', profile.tenant_id)
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error cargando salidas autónomas del día:', error);
      return;
    }

    setSelfDismissalsToday(data || []);
  };

  const fetchConfiguredCarpools = async () => {
    if (!profile?.tenant_id) return;
    const parentFields = 'first_name, last_name';
    const { data, error } = await supabase
      .from('carpool_authorizations')
      .select(`id, day_of_week, student:students(first_name, last_name, grade, section), authorizing:profiles!carpool_authorizations_authorizing_parent_id_fkey(${parentFields}), driver:profiles!carpool_authorizations_driver_parent_id_fkey(${parentFields})`)
      .eq('tenant_id', profile.tenant_id)
      .order('day_of_week', { ascending: true });

    if (error) {
      console.error('Error cargando car pools configurados:', error);
      return;
    }

    setConfiguredCarpools(data || []);
  };

  const fetchLatestDetections = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('camera_detections')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('detected_at', { ascending: false });
    
    if (data) {
      const latest: Record<string, any> = {};
      data.forEach(d => {
        if (!latest[d.door_id]) latest[d.door_id] = d;
      });
      setLatestDetections(latest);
    }
  };

  const fetchAuditLogs = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(5);

    if (data) setAuditLogs(data);
  };

  const fetchHealthAlerts = async () => {
    if (!profile?.tenant_id) return;
    // health_alerts no tiene columna `status` (id, student_id, title, severity,
    // action_plan, created_at, tenant_id) — nunca la tuvo. El .eq('status',
    // 'active') hacía que PostgREST rechazara la consulta con 400 en cada
    // carga, y el panel de alertas quedaba siempre vacío en silencio.
    const { data } = await supabase
      .from('health_alerts')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false });

    if (data) setHealthAlerts(data);
  };

  const fetchPendingRequests = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('replacement_requests')
      .select('id')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'pending');

    if (data) {
      // Aviso de voz a recepción cuando llega una solicitud nueva — se
      // detecta comparando contra los ids ya vistos, igual que el resto de
      // las pantallas que dependen del polling en vez de Realtime.
      const seen = seenPendingRequestIdsRef.current;
      if (seen && data.some(r => !seen.has(r.id))) {
        playGlobalVoiceMessage('Atención, tienen un nuevo mensaje de los padres.');
      }
      seenPendingRequestIdsRef.current = new Set(data.map(r => r.id));
      setPendingRequests(data);
    }
  };

  const fetchStats = async () => {
    if (!profile?.tenant_id) return;
    const { count: childrenCount } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', profile.tenant_id);
    const { count: parentsCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', profile.tenant_id)
      .eq('role', 'parent');

    const { data: gradeData } = await supabase.from('students').select('grade').eq('tenant_id', profile.tenant_id);

    let topGrade = 'N/A';
    if (gradeData) {
      const counts: Record<string, number> = {};
      gradeData.forEach(s => counts[s.grade] = (counts[s.grade] || 0) + 1);
      let max = 0;
      for (const grade in counts) {
        if (counts[grade] > max) {
          max = counts[grade];
          topGrade = grade;
        }
      }
    }

    setStats({ totalChildren: childrenCount || 0, totalParents: parentsCount || 0, topGrade });
  };

  const fetchSchoolSettings = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('school_settings')
      .select('logo_url, announce_arrival_restriction_enabled')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle();

    if (data) {
      setLogoUrl(data.logo_url);
      // Columna nueva (2026-09-01): en colegios que todavía no corrieron la
      // migración puede venir null/undefined — se trata como "activo"
      // (el comportamiento de siempre), no como "desactivado".
      setAnnounceRestrictionEnabled(data.announce_arrival_restriction_enabled !== false);
    }
  };

  const toggleAnnounceRestriction = async () => {
    if (!profile?.tenant_id || togglingAnnounceRestriction) return;
    const next = !announceRestrictionEnabled;
    setTogglingAnnounceRestriction(true);
    const { error } = await supabase
      .from('school_settings')
      .update({ announce_arrival_restriction_enabled: next })
      .eq('tenant_id', profile.tenant_id);

    if (error) {
      console.error('Error al cambiar el límite de hora para anunciar llegada:', error);
      alert(t('dashboard.announceRestrictionToggleError'));
    } else {
      setAnnounceRestrictionEnabled(next);
      await logActivity(
        'SECURITY',
        next
          ? `${profile?.first_name || 'Admin'} reactivó el límite de las 11:00 am para anunciar llegada.`
          : `${profile?.first_name || 'Admin'} DESACTIVÓ temporalmente el límite de las 11:00 am para anunciar llegada.`,
        profile?.first_name || 'Admin',
        { announce_arrival_restriction_enabled: next },
        profile?.tenant_id
      );
    }
    setTogglingAnnounceRestriction(false);
  };

  const acknowledgeAlert = async (id: string) => {
    await supabase
      .from('health_alerts')
      .update({ status: 'acknowledged' })
      .eq('id', id);
    fetchHealthAlerts();
  };

  const updateStatus = async (id: string, newStatus: string) => {
    const pickup = pickups.find(p => p.id === id);
    const { error } = await supabase.from('pickup_events')
      .update({ status: newStatus, picked_up_at: new Date() })
      .eq('id', id);

    if (!error && newStatus === 'released') {
      // 1. Audit Log
      await logActivity(
        'PICKUP', 
        `ALUMNO EN TRÁNSITO: ${pickup?.student?.first_name} ${pickup?.student?.last_name} autorizado para salir al encuentro de su tutor.`,
        'Administrador de Salida',
        {},
        pickup?.student?.tenant_id
      );

      // 2. Persistent Notification for Parent
      await supabase.from('notifications').insert({
        user_id: pickup.parent_id,
        title: '¡Alumno en camino!',
        message: `El maestro ha autorizado la salida de ${pickup?.student?.first_name}. Reúnete con él en el vehículo y confirma la recepción en tu App.`,
        type: 'success',
        tenant_id: pickup?.tenant_id
      });
    }
    fetchPickups();
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] font-sans">
      {/* Audio Activation Banner */}
      {!audioEnabled && (
        <div className="bg-indigo-600 text-white px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in slide-in-from-top duration-500">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 animate-pulse shrink-0" />
            <p className="text-xs font-bold uppercase tracking-widest">El sistema de anuncios por voz requiere activación manual</p>
          </div>
          <button
            onClick={enableAudio}
            className="bg-white text-indigo-600 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase hover:bg-indigo-50 transition-colors shadow-lg shrink-0"
          >
            Activar Altavoces
          </button>
        </div>
      )}
      {/* Top Urgent Alert Banner */}
      {healthAlerts.length > 0 && (
        <section className="bg-[#fee2e2] border-l-[6px] border-[#dc2626] p-3 mx-4 mt-4 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm animate-bounce-short">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle className="w-5 h-5 text-[#dc2626] shrink-0" />
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-black text-[11px] text-[#dc2626] uppercase tracking-tighter shrink-0">{healthAlerts.length} Urgent Health Alert{healthAlerts.length > 1 ? 's' : ''}</span>
              <span className="text-[11px] text-[#7f1d1d] font-medium">{healthAlerts[0].message}</span>
            </div>
          </div>
          <button
            onClick={() => acknowledgeAlert(healthAlerts[0].id)}
            className="bg-[#dc2626] text-white px-4 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest hover:bg-[#b91c1c] transition-all shrink-0"
          >
            ACKNOWLEDGE
          </button>
        </section>
      )}

      <div className="p-4 grid grid-cols-12 gap-5">
        
        {/* Left Column (Queue) */}
        <div className="col-span-12 lg:col-span-8 space-y-5">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-4 min-w-0">
              <button
                onClick={toggleMenu}
                className="p-2 -ml-1 rounded-xl hover:bg-slate-100 transition-colors md:hidden text-slate-700 shrink-0 border border-slate-200"
              >
                {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              {logoUrl && <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-lg object-cover shrink-0" />}
              <h1 className="text-xl font-black text-slate-800 truncate">{t('dashboard.title')}</h1>
            </div>
            <button
              onClick={() => setShowDailyReportModal(true)}
              className="flex items-center justify-center gap-2 bg-[#1e293b] hover:bg-[#334155] text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-colors shrink-0 self-start sm:self-auto"
            >
              <FileBarChart className="w-4 h-4" /> Reporte del Día
            </button>
          </div>

          {showDailyReportModal && <DailyReportModal onClose={() => setShowDailyReportModal(false)} />}

          {profile?.role === 'admin' && (
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-xl shrink-0 ${announceRestrictionEnabled ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-600'}`}>
                  <Clock className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-800 uppercase tracking-wider truncate">
                    {t('dashboard.announceRestrictionTitle')}
                  </p>
                  <p className="text-[10px] font-bold text-slate-400 truncate">
                    {announceRestrictionEnabled ? t('dashboard.announceRestrictionActiveSubtitle') : t('dashboard.announceRestrictionDisabledSubtitle')}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleAnnounceRestriction}
                disabled={togglingAnnounceRestriction}
                className={`shrink-0 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 ${
                  announceRestrictionEnabled
                    ? 'bg-slate-800 text-white hover:bg-slate-700'
                    : 'bg-amber-500 text-white hover:bg-amber-600 animate-pulse'
                }`}
              >
                {togglingAnnounceRestriction
                  ? '...'
                  : announceRestrictionEnabled
                    ? t('dashboard.announceRestrictionDeactivateBtn')
                    : t('dashboard.announceRestrictionReactivateBtn')}
              </button>
            </div>
          )}

          <ParentPerimeterPanel />

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[400px]">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-[#1e293b]" />
                <h2 className="text-[13px] font-black text-[#1e293b] uppercase tracking-wider">{t('dashboard.liveQueue')}</h2>
              </div>
              <span className="flex items-center gap-2 bg-[#f1f5f9] px-3 py-1.5 rounded-full border border-slate-200">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                <span className="text-[9px] font-black text-[#64748b] uppercase tracking-widest">{t('dashboard.realtimeSync')}</span>
              </span>
            </div>

            <div className="p-6">
              {pickups.length === 0 ? (
                <div className="h-[250px] flex items-center justify-center">
                  <p className="text-[11px] font-bold text-slate-300 italic uppercase tracking-widest">{t('dashboard.noPickups')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pickups.map(item => (
                    <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-primary/30 transition-all group">
                       <div className="flex items-center gap-4 min-w-0">
                          <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center font-black text-primary border border-slate-200 shrink-0">
                            {item.student?.first_name?.[0]}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight truncate">{item.student?.first_name} {item.student?.last_name}</h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase truncate">{item.student?.grade} • {t('dashboard.pickedUpBy')}: {item.parent?.first_name}</p>
                          </div>
                       </div>
                       <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0">
                          <div className="text-right sm:mr-4">
                            <span className="block text-[8px] font-black text-slate-400 uppercase">PIN</span>
                            <span className="text-lg font-black text-slate-900 tracking-widest">{item.parent?.pin_code}</span>
                          </div>
                          <button
                            onClick={() => updateStatus(item.id, 'released')}
                            className="bg-[#1e293b] text-white px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all active:scale-95 shadow-lg shrink-0"
                          >
                            {t('dashboard.confirmRelease')}
                          </button>
                       </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Daily Departures by Grade/Section */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[#1e293b]" />
                <h2 className="text-[13px] font-black text-[#1e293b] uppercase tracking-wider">{t('dashboard.dailyDepartures')}</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 bg-[#f1f5f9] px-3 py-1.5 rounded-full border border-slate-200">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                  <span className="text-[9px] font-black text-[#64748b] uppercase tracking-widest">{t('dashboard.realtimeSync')}</span>
                </span>
                <span className="bg-[#1e293b] text-white px-4 py-1.5 rounded-full text-xs font-black">
                  {dailyDepartures.reduce((sum, d) => sum + d.count, 0)}
                </span>
              </div>
            </div>
            <div className="p-5">
              {dailyDepartures.length === 0 ? (
                <p className="text-[11px] font-bold text-slate-300 italic uppercase tracking-widest text-center py-6">
                  {t('dashboard.noDeparturesToday')}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {dailyDepartures.map(d => (
                    <div key={`${d.grade}|${d.section}`} className="bg-[#f8fafc] rounded-xl p-3 border border-slate-100 text-center">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider truncate">
                        {d.grade}{d.section !== '—' ? ` · ${d.section}` : ''}
                      </p>
                      <p className="text-xl font-black text-[#1e293b] mt-1">{d.count}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Salidas Autónomas de Hoy */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Footprints className="w-5 h-5 text-indigo-600" />
                <h2 className="text-[13px] font-black text-[#1e293b] uppercase tracking-wider">Salidas Autónomas de Hoy</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 bg-[#f1f5f9] px-3 py-1.5 rounded-full border border-slate-200">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                  <span className="text-[9px] font-black text-[#64748b] uppercase tracking-widest">{t('dashboard.realtimeSync')}</span>
                </span>
                <span className="bg-indigo-600 text-white px-4 py-1.5 rounded-full text-xs font-black">
                  {selfDismissalsToday.length}
                </span>
              </div>
            </div>
            <div className="p-5">
              {selfDismissalsToday.length === 0 ? (
                <p className="text-[11px] font-bold text-slate-300 italic uppercase tracking-widest text-center py-6">
                  Sin salidas autónomas hoy
                </p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {selfDismissalsToday.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-3 bg-[#f8fafc] rounded-xl p-3 border border-slate-100">
                      <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-slate-200 flex items-center justify-center">
                        {ev.student?.photo_url ? (
                          <img src={ev.student.photo_url} alt={ev.student.first_name} className="w-full h-full object-cover" />
                        ) : (
                          <Footprints className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-[#1e293b] truncate">
                          {ev.student?.first_name} {ev.student?.last_name}
                        </p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase truncate">
                          {ev.student?.grade || '—'}{ev.student?.section ? ` · ${ev.student.section}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="flex items-center gap-1 bg-indigo-50 text-indigo-600 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full">
                          {ev.method === 'qr' ? <QrCode className="w-3 h-3" /> : <Fingerprint className="w-3 h-3" />}
                          {ev.method === 'qr' ? 'QR' : 'Facial'}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">
                          {new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <BusRoutesPanel />

          {/* Car Pools Configurados */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Car className="w-5 h-5 text-[#1e293b]" />
                <h2 className="text-[13px] font-black text-[#1e293b] uppercase tracking-wider">{t('dashboard.carpoolsTitle')}</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 bg-[#f1f5f9] px-3 py-1.5 rounded-full border border-slate-200">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                  <span className="text-[9px] font-black text-[#64748b] uppercase tracking-widest">{t('dashboard.realtimeSync')}</span>
                </span>
                <span className="bg-[#1e293b] text-white px-4 py-1.5 rounded-full text-xs font-black">
                  {configuredCarpools.length}
                </span>
              </div>
            </div>
            <div className="p-5">
              {configuredCarpools.length === 0 ? (
                <p className="text-[11px] font-bold text-slate-300 italic uppercase tracking-widest text-center py-6">
                  {t('dashboard.noCarpools')}
                </p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {configuredCarpools.map((cp) => (
                    <div key={cp.id} className="flex items-center gap-3 bg-[#f8fafc] rounded-xl p-3 border border-slate-100">
                      <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                        <Car className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-[#1e293b] truncate">
                          {cp.student?.first_name} {cp.student?.last_name}
                          <span className="text-slate-400 font-bold"> · {cp.student?.grade || '—'}{cp.student?.section ? ` ${cp.student.section}` : ''}</span>
                        </p>
                        <p className="text-[10px] font-bold text-slate-400 truncate">
                          {cp.authorizing?.first_name} {cp.authorizing?.last_name} → {cp.driver?.first_name} {cp.driver?.last_name}
                        </p>
                      </div>
                      <span className="shrink-0 bg-indigo-50 text-indigo-600 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full">
                        {CARPOOL_WEEKDAY_KEYS[cp.day_of_week] ? t(CARPOOL_WEEKDAY_KEYS[cp.day_of_week]) : cp.day_of_week}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Pickup Zone Analysis */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 flex justify-between items-center">
              <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider">{t('dashboard.pickupZone')}</h3>
              <select
                className="bg-slate-50 px-3 py-1 rounded-lg border border-slate-200 text-[10px] font-black uppercase"
                onChange={(e) => setSelectedDoor(e.target.value)}
                value={selectedDoor}
              >
                <option value="puerta_1">{t('dashboard.mainEntrance')}</option>
                <option value="puerta_2">{t('dashboard.sideEntrance')}</option>
              </select>
            </div>
            <div className="px-5 pb-5">
              <div className="relative aspect-video rounded-xl bg-slate-900 overflow-hidden">
                {latestDetections[selectedDoor] ? (
                  <img
                    src={latestDetections[selectedDoor].image_url}
                    alt={`Detección en ${selectedDoor}`}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Video className="w-12 h-12 text-white/20" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-px bg-slate-100 mt-2 rounded-xl overflow-hidden border border-slate-100 shadow-sm">
                <div className="bg-[#f8fafc] p-3 text-center">
                   <p className="text-[9px] font-black text-slate-400 uppercase mb-1">{t('dashboard.lastDetection')}</p>
                   <p className="text-[10px] font-black text-[#1e293b]">
                     {latestDetections[selectedDoor]
                       ? new Date(latestDetections[selectedDoor].detected_at).toLocaleTimeString()
                       : t('dashboard.noData')}
                   </p>
                </div>
                <div className="bg-[#f8fafc] p-3 text-center border-l border-slate-100">
                   <p className="text-[9px] font-black text-slate-400 uppercase mb-1">{t('dashboard.door')}</p>
                   <p className="text-sm font-black text-[#1e293b]">{selectedDoor === 'puerta_1' ? t('dashboard.main') : t('dashboard.side')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (Speed/Ratios/Activity) */}
        <div className="col-span-12 lg:col-span-4 space-y-5">
          
          {/* Pending Requests Alert */}
          {pendingRequests.length > 0 && (
            <section 
              onClick={() => setCurrentView('requests')}
              className="bg-orange-500 p-6 rounded-xl shadow-xl relative overflow-hidden cursor-pointer hover:bg-orange-600 transition-all group"
            >
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                <MessageSquare className="w-20 h-20 text-white" />
              </div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-2 h-2 bg-white rounded-full animate-ping"></div>
                <h3 className="text-white text-[15px] font-black uppercase tracking-wider">{t('dashboard.pendingRequests')}</h3>
              </div>
              <p className="text-white/80 text-[11px] font-bold">
                {t('dashboard.pendingRequestsPrefix')} {pendingRequests.length} {t('dashboard.pendingRequestsSuffix')}
              </p>
              <div className="mt-4 flex items-center gap-2 text-[10px] font-black text-white uppercase tracking-widest">
                {t('dashboard.viewInbox')} <ChevronDown className="w-4 h-4 -rotate-90" />
              </div>
            </section>
          )}

          {/* Operational Speed */}
          <section className="bg-[#0f172a] p-6 rounded-xl shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <RefreshCw className="w-20 h-20 text-white" />
            </div>
            <h3 className="text-white text-[15px] font-black uppercase tracking-wider mb-6">{t('dashboard.operationalSpeed')}</h3>

            {/* Orden por uso, misma lógica que el sidebar (2026-08-30):
                flujo de salida primero, luego frente de recepción, bienestar,
                registro puntual, y comunicación al final. */}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setCurrentView('external')} className="bg-indigo-600 hover:bg-indigo-500 p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <Monitor className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('dashboard.externalMonitor')}</span>
              </button>
              <button onClick={() => setCurrentView('transit')} className="bg-indigo-600 hover:bg-indigo-500 p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <Footprints className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('nav.transit')}</span>
              </button>
              <button onClick={() => setActiveModal('GUEST_SIGN')} className="bg-indigo-600 hover:bg-indigo-500 p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <Users className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('dashboard.guestSign')}</span>
              </button>
              <button onClick={() => setCurrentView('visitors')} className="bg-indigo-600 hover:bg-indigo-500 p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <ClipboardList className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('dashboard.visitorLog')}</span>
              </button>
              <button onClick={() => setCurrentView('wellness')} className="bg-indigo-600 hover:bg-indigo-500 p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <BriefcaseMedical className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('dashboard.medLog')}</span>
              </button>
              <button onClick={handleQuickScan} className="bg-indigo-600 hover:bg-indigo-500 p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <UserPlus className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('dashboard.addParent')}</span>
              </button>
              <button onClick={() => setCurrentView('forms')} className="bg-indigo-600 hover:bg-indigo-500 p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <FileEdit className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('dashboard.forms')}</span>
              </button>
              <button onClick={() => setCurrentView('requests')} className="bg-indigo-600 hover:bg-indigo-500 p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <MessageSquare className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('nav.requests')}</span>
              </button>
            </div>
          </section>

          {/* Quick Stats */}
          <section className="grid grid-cols-3 gap-3">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase">{t('dashboard.children')}</p>
              <p className="text-xl font-black text-slate-800">{stats.totalChildren}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase">{t('dashboard.parents')}</p>
              <p className="text-xl font-black text-slate-800">{stats.totalParents}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase">{t('dashboard.topGrade')}</p>
              <p className="text-xl font-black text-slate-800">{stats.topGrade}</p>
            </div>
          </section>

          {/* Verification Activity */}
          <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 min-h-[300px]">
            <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider mb-6">{t('dashboard.recentActivity')}</h3>
            <div className="space-y-5">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex justify-between group">
                  <div className="flex gap-4">
                     <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${log.event_type === 'SECURITY' ? 'bg-[#fef2f2]' : 'bg-[#f1f5f9]'}`}>
                       {log.event_type === 'SECURITY' ? <FileWarning className="w-4 h-4 text-rose-400" /> : <Activity className="w-4 h-4 text-slate-400" />}
                     </div>
                     <div>
                       <p className="text-[11px] font-black text-slate-800 uppercase tracking-tight">{log.description}</p>
                       <p className="text-[9px] text-slate-400 font-medium">{log.actor_name}</p>
                     </div>
                  </div>
                  <span className="text-[9px] font-black text-slate-300">
                    {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      {activeModal && activeModal !== 'GUEST_SIGN' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-black text-slate-800 uppercase mb-4">{activeModal.replace('_', ' ')}</h2>
            <p className="text-slate-600 mb-6">Esta funcionalidad está en desarrollo. Pronto podrás gestionar {activeModal.toLowerCase().replace('_', ' ')} desde aquí.</p>
            <button 
              onClick={() => setActiveModal(null)}
              className="w-full bg-[#1e293b] text-white py-2 rounded-lg font-black uppercase tracking-widest hover:bg-slate-800"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
      {activeModal === 'GUEST_SIGN' && (
        <GuestSignModal onClose={() => setActiveModal(null)} onSuccess={() => setActiveModal(null)} />
      )}
    </div>
  );
}
