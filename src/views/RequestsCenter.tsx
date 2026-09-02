import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { useLanguage } from '../contexts/LanguageContext';
import {
  UserPlus, Check, X, Loader2, MessageSquare,
  Clock, Shield, UserCheck, Trash2, Bell, Car
} from 'lucide-react';

const CARPOOL_DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function RequestsCenter() {
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const [requests, setRequests] = useState<any[]>([]);
  // Pool day no pasa por aprobación (se activa solo al configurarse), así
  // que se trae aparte y se muestra como tarjetas informativas, sin botones
  // de aprobar/rechazar — solo para que recepción/admin tengan visibilidad.
  const [carpoolEvents, setCarpoolEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const playArrivalSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.error("Audio failed", e);
    }
  };

  const fetchCarpoolEvents = async () => {
    if (!profile?.tenant_id) return;
    const parentFields = 'first_name, last_name';
    const studentFields = 'first_name, last_name';
    const [weekly, overrides] = await Promise.all([
      supabase
        .from('carpool_authorizations')
        .select(`id, created_at, day_of_week, student:students(${studentFields}), authorizing:profiles!carpool_authorizations_authorizing_parent_id_fkey(${parentFields}), driver:profiles!carpool_authorizations_driver_parent_id_fkey(${parentFields})`)
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('carpool_overrides')
        .select(`id, created_at, override_date, student:students(${studentFields}), authorizing:profiles!carpool_overrides_authorizing_parent_id_fkey(${parentFields}), driver:profiles!carpool_overrides_driver_parent_id_fkey(${parentFields})`)
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const events = [
      ...(weekly.data ?? []).map((r: any) => ({ ...r, _kind: 'carpool_weekly' })),
      ...(overrides.data ?? []).map((r: any) => ({ ...r, _kind: 'carpool_override' })),
    ];
    const seen = seenCarpoolIdsRef.current;
    if (seen && events.some(e => !seen.has(e.id))) {
      playArrivalSound();
    }
    seenCarpoolIdsRef.current = new Set(events.map(e => e.id));
    setCarpoolEvents(events);
  };
  const seenCarpoolIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    fetchRequests(true);
    fetchCarpoolEvents();

    // replacement_requests, carpool_authorizations y carpool_overrides no
    // están en la publicación de Realtime de Supabase — el canal que había
    // acá nunca recibía nada. El poll de abajo (con detección de ids nuevos
    // dentro de fetchRequests/fetchCarpoolEvents) es, y siempre fue, el
    // mecanismo real de refresco y del sonido de llegada.
    const pollInterval = window.setInterval(() => {
      console.log('RequestsCenter polling...');
      fetchRequests(false);
      fetchCarpoolEvents();
    }, 10000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [profile?.tenant_id]);

  // Une reemplazos/mensajes con pool day en un solo feed ordenado por fecha,
  // para que recepción/admin revisen todo en un único lugar.
  const combinedFeed = useMemo(() => {
    const a = requests.map((r) => ({ ...r, _kind: r._kind ?? 'replacement' }));
    return [...a, ...carpoolEvents].sort(
      (x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime(),
    );
  }, [requests, carpoolEvents]);

  const fetchRequests = async (isInitial = false) => {
    if (!profile?.tenant_id) return;
    if (isInitial) setLoading(true);
    const { data } = await supabase
      .from('replacement_requests')
      .select('*, parent:profiles(first_name, last_name, tenant_id, parent_students(students(first_name, last_name)))')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false });

    if (data) {
      const seen = seenRequestIdsRef.current;
      if (seen && data.some(r => !seen.has(r.id))) {
        playArrivalSound();
      }
      seenRequestIdsRef.current = new Set(data.map(r => r.id));
      setRequests(data);
    }
    setLoading(false);
  };
  const seenRequestIdsRef = useRef<Set<string> | null>(null);

  const handleProcessRequest = async (req: any, status: 'approved' | 'rejected') => {
    setProcessingId(req.id);
    try {
      const parentId = req.parent_id;

      if (status === 'approved' && parentId) {
        // 1. Fetch parent profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('additional_tutor_name')
          .eq('id', parentId)
          .single();

        if (profile) {
          let additionalData: any = {};
          try {
            additionalData = JSON.parse(profile.additional_tutor_name || '{}');
          } catch (e) {
            additionalData = { is_staff: false, replacements: [] };
          }

          if (!additionalData.replacements) additionalData.replacements = [];

          // Add the new replacement
          const newReplacement = {
            name: req.replacement_name,
            phone: req.replacement_phone,
            photo_url: req.photo_url ?? null,
            token: crypto.randomUUID().slice(0, 8),
            created_at: new Date().toISOString()
          };

          additionalData.replacements.push(newReplacement);

          // 2. Update profile
          await supabase
            .from('profiles')
            .update({ additional_tutor_name: JSON.stringify(additionalData) })
            .eq('id', parentId);

          // 3. Notify parent
          await supabase.from('notifications').insert({
            user_id: parentId,
            title: 'Reemplazo Autorizado',
            message: `Tu solicitud para ${req.replacement_name} ha sido aprobada. El código QR ya está disponible en tu panel.`,
            type: 'success'
          });
        }
      } else if (status === 'rejected' && parentId) {
        // Notify parent of rejection
        await supabase.from('notifications').insert({
          user_id: parentId,
          title: 'Solicitud de Reemplazo Rechazada',
          message: `Tu solicitud para ${req.replacement_name} no pudo ser procesada en este momento. Por favor contacta a recepción.`,
          type: 'error'
        });
      }

      // 4. Update request status
      await supabase
        .from('replacement_requests')
        .update({ status: status })
        .eq('id', req.id);

      // 5. Log the action
      await logActivity(
        'SECURITY',
        `${status === 'approved' ? 'APROBACIÓN' : 'RECHAZO'} DE REEMPLAZO: Solicitud de ${req.parent?.first_name} para ${req.replacement_name}.`,
        'Recepcionista',
        {},
        req.parent?.tenant_id
      );

      fetchRequests();
    } catch (error) {
      console.error('Error processing request:', error);
      alert(t('requests.processErrorAlert'));
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      <TopNav title={t('requests.title')} subtitle={t('requests.subtitle')} />

      <div className="p-6 max-w-5xl mx-auto w-full space-y-8 animate-in slide-in-from-bottom-4">
        <header className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              {t('requests.inbox')} <MessageSquare className="w-8 h-8 text-indigo-600" />
            </h1>
            <p className="text-sm text-slate-500 font-medium mt-1">{t('requests.processDesc')}</p>
          </div>
          <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl shadow-sm border border-slate-100 self-start">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('requests.liveMonitoring')}</span>
          </div>
        </header>

        {loading && combinedFeed.length === 0 ? (
          <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
        ) : combinedFeed.length === 0 ? (
          <div className="bg-white rounded-[2.5rem] p-16 text-center shadow-sm border border-slate-100">
            <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-xl font-black text-slate-800">{t('requests.allCaughtUp')}</h3>
            <p className="text-slate-400 font-medium mt-2">{t('requests.noPending')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {combinedFeed.map((req) => {
              if (req._kind === 'carpool_weekly' || req._kind === 'carpool_override') {
                const studentName = req.student ? `${req.student.first_name} ${req.student.last_name}` : 'un alumno';
                const driverName = req.driver ? `${req.driver.first_name} ${req.driver.last_name}` : 'otro padre';
                const authName = req.authorizing ? `${req.authorizing.first_name} ${req.authorizing.last_name}` : 'un padre';
                const whenLabel = req._kind === 'carpool_weekly'
                  ? `todos los ${CARPOOL_DAY_NAMES[req.day_of_week]}`
                  : `el ${req.override_date} (excepción de un día)`;
                return (
                  <div key={`carpool-${req._kind}-${req.id}`} className="bg-white rounded-[2rem] p-6 shadow-sm border border-emerald-100">
                    <div className="flex items-start gap-5">
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 bg-emerald-50 text-emerald-600">
                        <Car className="w-7 h-7" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="font-black text-slate-800 text-lg">{authName}</h3>
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-lg uppercase tracking-widest bg-emerald-100 text-emerald-700">
                            Pool Day · Activo
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 font-medium leading-relaxed">
                          Autorizó a <span className="text-slate-900 font-bold">{driverName}</span> a recoger a{' '}
                          <span className="text-slate-900 font-bold">{studentName}</span> {whenLabel}.
                        </p>
                        <div className="flex items-center gap-4 mt-3">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(req.created_at).toLocaleString()}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase">
                            <Shield className="w-3.5 h-3.5" />
                            ID: {req.id.slice(0, 8)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              const isPending = req.status === 'pending';
              const isApproved = req.status === 'approved';
              const isRejected = req.status === 'rejected';

              return (
                <div
                  key={req.id}
                  className={`bg-white rounded-[2rem] p-6 shadow-sm border transition-all ${isPending ? 'border-indigo-100 hover:border-indigo-300' : 'border-slate-100 opacity-75'}`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-start gap-5">
                      {req.photo_url && !req.replacement_name?.startsWith('[MENSAJE]') ? (
                        <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 border border-slate-100">
                          <img src={req.photo_url} alt={req.replacement_name} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${isPending ? 'bg-indigo-50 text-indigo-600' : isApproved ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                          {isPending && !req.replacement_name?.startsWith('[MENSAJE]') && <UserPlus className="w-7 h-7" />}
                          {isPending && req.replacement_name?.startsWith('[MENSAJE]') && <MessageSquare className="w-7 h-7" />}
                          {isApproved && <UserCheck className="w-7 h-7" />}
                          {isRejected && <X className="w-7 h-7" />}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="font-black text-slate-800 text-lg">{req.parent?.first_name} {req.parent?.last_name}</h3>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg uppercase tracking-widest ${isPending ? 'bg-amber-100 text-amber-700' : isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {isPending ? t('requests.pending') : isApproved ? t('requests.approvedRead') : t('requests.rejectedArchived')}
                          </span>
                        </div>
                        {req.replacement_name?.startsWith('[MENSAJE]') ? (
                          <div className="text-sm text-slate-500 font-medium leading-relaxed">
                            <span className="inline-block bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[10px] font-black tracking-widest mb-1">{t('requests.messageLabel')}</span><br/>
                            <p className="whitespace-pre-wrap">{req.replacement_name.replace('[MENSAJE] ', '')}</p>
                            {req.replacement_phone && req.replacement_phone !== 'N/A' && (
                              <p className="mt-2"><a href={req.replacement_phone} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{req.replacement_phone}</a></p>
                            )}
                          </div>
                        ) : (
                          <>
                            <p className="text-sm text-slate-500 font-medium leading-relaxed">
                              {t('requests.requestsAuthPrefix')} <span className="text-slate-900 font-bold">{req.replacement_name}</span> {t('requests.withPhone')} <span className="text-slate-900 font-bold">{req.replacement_phone}</span> {t('requests.forTodayPickup')}
                            </p>
                            <p className="text-xs font-bold mt-1">
                              {t('requests.forChildren')}{' '}
                              {req.parent?.parent_students?.length > 0 ? (
                                <span className="text-indigo-600">
                                  {req.parent.parent_students
                                    .map((ps: any) => ps.students ? `${ps.students.first_name} ${ps.students.last_name || ''}`.trim() : null)
                                    .filter(Boolean)
                                    .join(', ')}
                                </span>
                              ) : (
                                <span className="text-amber-600">{t('requests.noChildrenLinked')}</span>
                              )}
                            </p>
                          </>
                        )}
                        <div className="flex items-center gap-4 mt-3">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(req.created_at).toLocaleString()}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase">
                            <Shield className="w-3.5 h-3.5" />
                            ID: {req.id.slice(0, 8)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {isPending && (
                      <div className="flex items-center gap-3 shrink-0">
                        {req.replacement_name?.startsWith('[MENSAJE]') ? (
                          <button 
                            onClick={() => handleProcessRequest(req, 'approved')}
                            disabled={processingId === req.id}
                            className="px-6 py-3 bg-amber-600 text-white font-black text-xs rounded-xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-100 flex items-center gap-2"
                          >
                            {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            {t('requests.markAsRead')}
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleProcessRequest(req, 'rejected')}
                              disabled={processingId === req.id}
                              className="px-6 py-3 bg-slate-100 text-slate-600 font-black text-xs rounded-xl hover:bg-rose-50 hover:text-rose-600 transition-all flex items-center gap-2"
                            >
                              {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                              {t('requests.reject')}
                            </button>
                            <button
                              onClick={() => handleProcessRequest(req, 'approved')}
                              disabled={processingId === req.id}
                              className="px-6 py-3 bg-indigo-600 text-white font-black text-xs rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
                            >
                              {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                              {t('requests.approveGenerateQR')}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
