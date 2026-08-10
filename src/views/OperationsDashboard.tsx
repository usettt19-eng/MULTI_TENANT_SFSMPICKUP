import React, { useEffect, useState, useRef } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { TopNav } from '../components/TopNav';
import { GuestSignModal } from '../components/GuestSignModal';
import { useLanguage } from '../contexts/LanguageContext';
import { GoogleGenAI, Modality } from "@google/genai";
import {
  AlertTriangle, Clock, CheckCircle2, UserPlus, Users,
  BriefcaseMedical, RefreshCw, Activity, Video, Monitor,
  Fingerprint, Wifi, FileWarning, ShieldCheck,
  FileText, TrendingUp, UserCheck, XCircle, Printer,
  ChevronDown, MessageSquare
} from 'lucide-react';

import { subscribeToAudioState, enableGlobalAudio, playGlobalVoiceMessage } from '../lib/audioManager';

export function OperationsDashboard({ setCurrentView }: { setCurrentView: (view: string) => void }) {
  const { t } = useLanguage();
  const [pickups, setPickups] = useState<any[]>([]);
  const isFirstFetch = useRef(true);
  const announcedPickupIds = useRef<Set<string>>(new Set());
  const [latestDetections, setLatestDetections] = useState<Record<string, any>>({});
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [healthAlerts, setHealthAlerts] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [selectedDoor, setSelectedDoor] = useState('puerta_1');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalChildren: 0, totalParents: 0, topGrade: '' });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);

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
    
    const pickupChannel = supabase
      .channel('public:pickup_events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_events' }, async (payload: any) => {
        console.log('Pickup event change detected:', payload);
        fetchPickups();
      })
      .subscribe();

    const requestChannel = supabase
      .channel('public:replacement_requests_dashboard')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'replacement_requests'
      }, () => {
        fetchPendingRequests();
      })
      .subscribe();

    const detectionChannel = supabase
      .channel('public:camera_detections')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'camera_detections' }, (payload) => {
        setLatestDetections(prev => ({
          ...prev,
          [payload.new.door_id]: payload.new
        }));
      })
      .subscribe();

    const auditChannel = supabase
      .channel('public:audit_logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, (payload) => {
        setAuditLogs(prev => [payload.new, ...prev].slice(0, 5));
      })
      .subscribe();

    const alertChannel = supabase
      .channel('public:health_alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'health_alerts' }, () => {
        fetchHealthAlerts();
      })
      .subscribe();

    // Fallback polling every 10 seconds to ensure data consistency
    const pollInterval = window.setInterval(() => {
      console.log('Dashboard fallback polling...');
      fetchPickups();
      fetchLatestDetections();
      fetchAuditLogs();
      fetchHealthAlerts();
      fetchPendingRequests();
      fetchStats();
    }, 10000);

    return () => { 
      supabase.removeChannel(pickupChannel);
      supabase.removeChannel(requestChannel);
      supabase.removeChannel(detectionChannel);
      supabase.removeChannel(auditChannel);
      supabase.removeChannel(alertChannel);
      clearInterval(pollInterval);
    };
  }, []);

  const handleQuickScan = () => {
    localStorage.setItem('openAddGuardianModal', 'true');
    setCurrentView('guardians');
  };

  const fetchPickups = async () => {
    const { data } = await supabase
      .from('pickup_events')
      .select('*, student:students(first_name, last_name, grade, tenant_id), parent:profiles(first_name, last_name, pin_code)')
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

  const fetchLatestDetections = async () => {
    const { data } = await supabase
      .from('camera_detections')
      .select('*')
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
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (data) setAuditLogs(data);
  };

  const fetchHealthAlerts = async () => {
    // health_alerts no tiene columna `status` (id, student_id, title, severity,
    // action_plan, created_at, tenant_id) — nunca la tuvo. El .eq('status',
    // 'active') hacía que PostgREST rechazara la consulta con 400 en cada
    // carga, y el panel de alertas quedaba siempre vacío en silencio.
    const { data } = await supabase
      .from('health_alerts')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) setHealthAlerts(data);
  };

  const fetchPendingRequests = async () => {
    const { data } = await supabase
      .from('replacement_requests')
      .select('id')
      .eq('status', 'pending');
    
    if (data) {
      setPendingRequests(data);
    }
  };

  const fetchStats = async () => {
    const { count: childrenCount } = await supabase.from('students').select('*', { count: 'exact', head: true });
    const { count: parentsCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
    
    const { data: gradeData } = await supabase.from('students').select('grade');
    
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
    const { data } = await supabase
      .from('school_settings')
      .select('logo_url')
      .single();
    
    if (data) setLogoUrl(data.logo_url);
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
        tenant_id: pickup?.student?.tenant_id
      });
    }
    fetchPickups();
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] font-sans">
      {/* Audio Activation Banner */}
      {!audioEnabled && (
        <div className="bg-indigo-600 text-white px-6 py-3 flex items-center justify-between animate-in slide-in-from-top duration-500">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 animate-pulse" />
            <p className="text-xs font-bold uppercase tracking-widest">El sistema de anuncios por voz requiere activación manual</p>
          </div>
          <button 
            onClick={enableAudio}
            className="bg-white text-indigo-600 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase hover:bg-indigo-50 transition-colors shadow-lg"
          >
            Activar Altavoces
          </button>
        </div>
      )}
      {/* Top Urgent Alert Banner */}
      {healthAlerts.length > 0 && (
        <section className="bg-[#fee2e2] border-l-[6px] border-[#dc2626] p-3 mx-4 mt-4 rounded-lg flex items-center justify-between shadow-sm animate-bounce-short">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-[#dc2626]" />
            <div className="flex items-center gap-2">
              <span className="font-black text-[11px] text-[#dc2626] uppercase tracking-tighter">{healthAlerts.length} Urgent Health Alert{healthAlerts.length > 1 ? 's' : ''}</span>
              <span className="text-[11px] text-[#7f1d1d] font-medium">{healthAlerts[0].message}</span>
            </div>
          </div>
          <button 
            onClick={() => acknowledgeAlert(healthAlerts[0].id)}
            className="bg-[#dc2626] text-white px-4 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest hover:bg-[#b91c1c] transition-all"
          >
            ACKNOWLEDGE
          </button>
        </section>
      )}

      <div className="p-4 grid grid-cols-12 gap-5">
        
        {/* Left Column (Queue) */}
        <div className="col-span-12 lg:col-span-8 space-y-5">
          {logoUrl && (
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
              <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-lg object-cover" />
              <h1 className="text-xl font-black text-slate-800">{t('dashboard.title')}</h1>
            </div>
          )}
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
                    <div key={item.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-primary/30 transition-all group">
                       <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center font-black text-primary border border-slate-200">
                            {item.student?.first_name?.[0]}
                          </div>
                          <div>
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">{item.student?.first_name} {item.student?.last_name}</h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">{item.student?.grade} • {t('dashboard.pickedUpBy')}: {item.parent?.first_name}</p>
                          </div>
                       </div>
                       <div className="flex items-center gap-6">
                          <div className="text-right mr-4">
                            <span className="block text-[8px] font-black text-slate-400 uppercase">PIN</span>
                            <span className="text-lg font-black text-slate-900 tracking-widest">{item.parent?.pin_code}</span>
                          </div>
                          <button
                            onClick={() => updateStatus(item.id, 'released')}
                            className="bg-[#1e293b] text-white px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all active:scale-95 shadow-lg"
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
              className="bg-indigo-600 p-6 rounded-xl shadow-xl relative overflow-hidden cursor-pointer hover:bg-indigo-700 transition-all group"
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
            <h3 className="text-white text-[15px] font-black uppercase tracking-wider mb-2">{t('dashboard.operationalSpeed')}</h3>
            {/* TODO: "94%" es un valor de ejemplo fijo en el código, no se calcula de datos reales. */}
            <p className="text-white/60 text-[10px] mb-6 font-medium">{t('dashboard.throughputStatus')}</p>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={handleQuickScan} className="bg-[#1e293b] hover:bg-[#334155] p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <UserPlus className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('dashboard.addParent')}</span>
              </button>
              <button onClick={() => setActiveModal('GUEST_SIGN')} className="bg-[#1e293b] hover:bg-[#334155] p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <Users className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('dashboard.guestSign')}</span>
              </button>
              <button onClick={() => setCurrentView('wellness')} className="bg-[#1e293b] hover:bg-[#334155] p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <BriefcaseMedical className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('dashboard.medLog')}</span>
              </button>
              <button onClick={() => setCurrentView('external')} className="bg-[#1e293b] hover:bg-[#334155] p-5 rounded-lg flex flex-col items-center gap-2 transition-all border border-white/5">
                <Monitor className="w-5 h-5 text-white/80" />
                <span className="text-[9px] font-black text-white/80 uppercase tracking-widest">{t('dashboard.externalMonitor')}</span>
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

          {/* Ratios */}
          {/* TODO: Las filas de abajo (Toddler Wing/Pre-K/Infant Care y sus
              proporciones) son datos de ejemplo fijos en el código, no salen
              de la base de datos — no reflejan la situación real del colegio. */}
          <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider mb-6 flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#0f172a]" /> {t('dashboard.ratios')}
            </h3>
            <div className="space-y-5">
              {[
                { label: 'Toddler Wing (1:4)', ratio: '3:11 (Optimal)', percent: '75', color: '#1e293b' },
                { label: 'Pre-K Section (1:10)', ratio: '2:18 (Optimal)', percent: '45', color: '#1e293b' },
                { label: 'Infant Care (1:3)', ratio: '2:6 (Critical)', percent: '95', color: '#7c2d12' }
              ].map(r => (
                <div key={r.label}>
                  <div className="flex justify-between items-end mb-1.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">{r.label}</span>
                    <span className="text-[10px] font-black text-slate-800">{r.ratio}</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-slate-800 rounded-full" style={{ width: `${r.percent}%`, backgroundColor: r.color }}></div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 pt-4 border-t border-slate-50 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{t('dashboard.stateComplianceActive')}</span>
              </div>
              <button className="text-[9px] font-black text-slate-800 uppercase hover:underline">{t('dashboard.reassignStaff')}</button>
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
