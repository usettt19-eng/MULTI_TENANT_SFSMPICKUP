import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { useLanguage } from '../contexts/LanguageContext';
import { School, User, ShieldCheck, CheckCircle2, AlertTriangle, Bell, Clock, Car, Lock } from 'lucide-react';
import { getReplacementNameFromNotes, formatAnnouncedAt, isStaleAnnouncement } from '../lib/pickupHelpers';
import { resolveMyGradeSectionsToday } from '../lib/dismissalSchedule';

/**
 * Vista privada por staff: a diferencia de Monitor Externo (que a propósito
 * muestra la cola completa del colegio, para el personal de puerta/
 * seguridad que debe poder atender a cualquiera), acá cada quien solo ve a
 * los padres que llegaron a buscar a un alumno de SU propio grado/sección —
 * ni más ni menos que a quien ya le llegó el aviso de "X llegó" (tabla
 * notifications, vinculada por pickup_event_id). Reutiliza así el mismo
 * criterio ya corregido en /api/pickup/notify-staff, en vez de recalcular la
 * asignación por separado — si algún día cambia cómo se decide a quién
 * avisar, esta pantalla no se desalinea porque no duplica esa lógica.
 *
 * Cada tarjeta trae la misma información y el mismo botón de autorizar que
 * Monitor Externo (mismo efecto: pickup_events -> 'released', igual que
 * handleConfirmRelease ahí) — a diferencia de esa pantalla, acá puede haber
 * varias tarjetas completas a la vez en vez de una sola "en foco" con cola
 * al costado, porque un mismo staff puede tener más de un alumno propio
 * esperando al mismo tiempo.
 */
export function MyClassroom() {
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const [pickups, setPickups] = useState<any[]>([]);
  const [doors, setDoors] = useState<any[]>([]);
  const [notifiedStaffByPickup, setNotifiedStaffByPickup] = useState<Record<string, { id: string; first_name: string; last_name: string }[]>>({});
  const [loading, setLoading] = useState(true);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);
  const [lockdownActive, setLockdownActive] = useState(false);
  // Solo para MOSTRAR a qué grado/sección está asignado el staff hoy — la
  // lista de quién llegó (pickups) sigue armándose aparte, desde
  // notifications, así que esto nunca decide a quién se le muestra un
  // padre, solo evita la duda de "¿no tengo nada asignado, o es que
  // todavía no llegó nadie?".
  const [myAssignments, setMyAssignments] = useState<Array<{ gradeName: string; section: string }>>([]);
  const channelRef = useRef<any>(null);

  const fetchDoors = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase.from('exit_doors').select('*').eq('tenant_id', profile.tenant_id).order('name');
    if (data) setDoors(data);
  };

  const fetchMyPickups = async () => {
    if (!profile?.tenant_id || !profile?.id) return;

    const { data: notifRows, error: notifError } = await supabase
      .from('notifications')
      .select('pickup_event_id')
      .eq('user_id', profile.id)
      .eq('tenant_id', profile.tenant_id)
      .not('pickup_event_id', 'is', null);

    if (notifError) {
      console.error('Error cargando mis avisos:', notifError);
      setLoading(false);
      return;
    }

    const eventIds = Array.from(new Set((notifRows || []).map(r => r.pickup_event_id).filter(Boolean)));
    if (eventIds.length === 0) {
      setPickups([]);
      setNotifiedStaffByPickup({});
      setLoading(false);
      return;
    }

    const [{ data, error }, { data: allNotifRows }] = await Promise.all([
      supabase
        .from('pickup_events')
        .select('*, students:student_id(*), profiles:parent_id(*, vehicles(*))')
        .in('id', eventIds)
        .in('status', ['announced', 'in_queue'])
        .order('announced_at', { ascending: true }),
      // Quién más (no solo yo) fue avisado de cada uno de estos pickups —
      // mismo dato que ya muestra Monitor Externo ("Avisado: ..."), para no
      // perder esa información acá.
      supabase
        .from('notifications')
        .select('pickup_event_id, user_id')
        .in('pickup_event_id', eventIds)
        .not('pickup_event_id', 'is', null),
    ]);

    if (error) console.error('Error cargando mis llegadas:', error);

    if (allNotifRows && allNotifRows.length > 0) {
      const staffIds = Array.from(new Set(allNotifRows.map(r => r.user_id).filter(Boolean)));
      const { data: staffProfiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', staffIds);
      const byId: Record<string, { id: string; first_name: string; last_name: string }> = {};
      (staffProfiles || []).forEach(p => { byId[p.id] = p; });
      const map: Record<string, { id: string; first_name: string; last_name: string }[]> = {};
      allNotifRows.forEach(row => {
        if (!row.pickup_event_id || !byId[row.user_id]) return;
        if (!map[row.pickup_event_id]) map[row.pickup_event_id] = [];
        map[row.pickup_event_id].push(byId[row.user_id]);
      });
      setNotifiedStaffByPickup(map);
    } else {
      setNotifiedStaffByPickup({});
    }

    if (data) setPickups(data);
    setLoading(false);
  };

  const fetchRef = useRef(fetchMyPickups);
  fetchRef.current = fetchMyPickups;

  useEffect(() => {
    if (!profile?.tenant_id || !profile?.id) return;
    fetchDoors();
    fetchMyPickups();
    resolveMyGradeSectionsToday(profile.tenant_id, profile.id, 'regular').then(setMyAssignments);

    const channel = supabase
      .channel(`my_classroom_${profile.id}_${Math.random()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${profile.id}`,
      }, () => fetchRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_events' }, () => fetchRef.current())
      .subscribe();

    // Mismo canal de bloqueo de emergencia que usan Sidebar/Monitor
    // Externo/En Tránsito — si el colegio está en lockdown, tampoco se debe
    // poder autorizar salidas desde acá.
    channelRef.current = supabase.channel('system_state')
      .on('broadcast', { event: 'lockdown' }, (payload) => {
        setLockdownActive(!!payload.payload.active);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && channelRef.current) {
          channelRef.current.send({ type: 'broadcast', event: 'request_lockdown_status', payload: {} });
        }
      });

    if (profile.tenant_id) {
      supabase
        .from('school_settings')
        .select('lockdown_mode')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle()
        .then(({ data }) => setLockdownActive(!!data?.lockdown_mode));
    }

    const settingsChannel = supabase
      .channel(`my_classroom_settings_${Math.random()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'school_settings' }, (payload: any) => {
        if (payload.new && 'lockdown_mode' in payload.new) {
          setLockdownActive(!!payload.new.lockdown_mode);
        }
      })
      .subscribe();

    const pollInterval = window.setInterval(() => fetchRef.current(), 10000);

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(settingsChannel);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenant_id, profile?.id]);

  // Mismo efecto que handleConfirmRelease en VerificationDisplay.tsx
  // (pickup_events -> 'released', log de auditoría, aviso al padre) — se
  // reusa el criterio, no el código, porque acá se autoriza una tarjeta
  // puntual de una lista, no "la actual" de una cola con un solo foco.
  const handleAuthorize = async (pickup: any) => {
    setAuthorizingId(pickup.id);
    const studentName = pickup.students?.first_name;
    try {
      const { error: updateError } = await supabase
        .from('pickup_events')
        .update({ status: 'released' })
        .eq('id', pickup.id);
      if (updateError) throw updateError;

      await supabase.from('audit_logs').insert({
        event_type: 'SECURITY',
        description: `AUTORIZACIÓN (Mi Salón): ${profile?.first_name || 'Personal'} validó la salida de ${studentName || 'el alumno'}.`,
        actor_name: profile?.first_name || 'Personal',
        metadata: { pickup_id: pickup.id },
        tenant_id: pickup.tenant_id,
      });

      await supabase.from('notifications').insert({
        user_id: pickup.parent_id,
        title: '¡Saliendo por Puerta!',
        message: `El Personal ha validado la salida de ${studentName || 'tu hijo'}. Reúnete con él en el vehículo.`,
        type: 'success',
        tenant_id: pickup.tenant_id,
      });

      setPickups(prev => prev.filter(p => p.id !== pickup.id));
    } catch (error: any) {
      console.error('Error authorizing pickup:', error);
      alert(t('monitor.releaseErrorPrefix') + error.message);
      fetchMyPickups();
    } finally {
      setAuthorizingId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 relative">
      <TopNav title={t('myClassroom.title')} subtitle={t('myClassroom.subtitle')} />

      {lockdownActive && (
        <div className="absolute inset-0 z-[100] bg-red-600/95 backdrop-blur-2xl flex flex-col items-center justify-center p-8 text-center overflow-hidden">
          <div className="animate-pulse flex flex-col items-center gap-8">
            <div className="bg-white p-8 rounded-[2rem] shadow-[0_0_50px_rgba(255,255,255,0.3)]">
              <Lock className="w-32 h-32 text-red-600 animate-bounce" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white uppercase tracking-tighter drop-shadow-2xl px-4">
                {t('monitor.restrictedExit')}
              </h1>
              <p className="text-sm sm:text-lg lg:text-xl font-bold text-white/90 uppercase tracking-[0.2em] sm:tracking-[0.3em] bg-black/20 px-4 sm:px-6 py-3 rounded-xl backdrop-blur-sm">
                {t('monitor.emergencyProtocolActive')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 max-w-6xl mx-auto w-full space-y-6 animate-in slide-in-from-bottom-4">
        <header>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            {t('myClassroom.title')} <School className="w-8 h-8 text-indigo-600" />
          </h1>
          <p className="text-sm text-slate-500 font-medium mt-1">{t('myClassroom.subtitle')}</p>
          <div className={`inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-wider ${myAssignments.length > 0 ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}>
            <School className="w-3.5 h-3.5 shrink-0" />
            {myAssignments.length > 0 ? (
              <span>
                {t('myClassroom.assignedTodayLabel')}: {myAssignments.map(a => `${a.gradeName}${a.section ? ' - ' + a.section : ''}`).join(', ')}
              </span>
            ) : (
              <span>{t('myClassroom.noAssignmentTodayLabel')}</span>
            )}
          </div>
        </header>

        {loading ? (
          <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>
        ) : pickups.length === 0 ? (
          <div className="bg-white rounded-[2.5rem] p-16 text-center shadow-sm border border-slate-100">
            <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <School className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-xl font-black text-slate-800">
              {myAssignments.length > 0 ? t('myClassroom.emptyTitle') : t('myClassroom.emptyNoAssignmentTitle')}
            </h3>
            <p className="text-slate-400 font-medium mt-2">
              {myAssignments.length > 0 ? t('myClassroom.emptySubtitle') : t('myClassroom.emptyNoAssignmentSubtitle')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {pickups.map((pickup: any) => {
              const notesReplacementName = getReplacementNameFromNotes(pickup.notes);
              const isReplacement = !!notesReplacementName;
              const displayName = notesReplacementName || `${pickup.profiles?.first_name || ''} ${pickup.profiles?.last_name || ''}`.trim();
              const subLabel = notesReplacementName
                ? `${t('monitor.requestedBy')}: ${pickup.profiles?.first_name || ''} ${pickup.profiles?.last_name || ''}`.trim()
                : (pickup.profiles?.phone || t('monitor.verifiedContact'));
              const notifiedStaff = notifiedStaffByPickup[pickup.id] || [];
              const vehicle = !isReplacement ? pickup.profiles?.vehicles?.[0] : null;

              return (
                <div key={pickup.id} className="bg-white rounded-[2rem] p-4 md:p-6 shadow-sm border border-slate-100">
                  <div className="flex flex-col md:flex-row gap-6">
                    {/* Child Info */}
                    <div className="flex-shrink-0 w-full md:w-1/4 text-center md:text-left">
                      <div className="relative inline-block">
                        <div className="w-24 h-24 md:w-32 md:h-32 rounded-[1.5rem] overflow-hidden mx-auto md:mx-0 border-4 border-surface-container shadow-md">
                          <img
                            src={pickup.students?.photo_url || "https://images.unsplash.com/photo-1595152772835-219674b2a8a6?auto=format&fit=crop&q=80&w=300"}
                            alt="Alumno"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="absolute -bottom-2 -right-2 bg-secondary text-white px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest">
                          {pickup.students?.grade || 'N/A'}
                        </div>
                      </div>
                      <h3 className="mt-4 text-lg font-black text-primary leading-tight">{pickup.students?.first_name} {pickup.students?.last_name}</h3>
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">{t('monitor.section')}: {pickup.students?.section || 'A'}</p>
                      {pickup.door_id && (
                        <p className="text-xs font-black uppercase tracking-wider mt-1 text-indigo-600">
                          Puerta: {doors.find(d => d.id === pickup.door_id)?.name || '—'}
                        </p>
                      )}
                      {formatAnnouncedAt(pickup.announced_at) && (
                        <p className={`text-xs font-black uppercase tracking-wider mt-1 flex items-center justify-center md:justify-start gap-1 ${isStaleAnnouncement(pickup.announced_at) ? 'text-rose-600' : 'text-slate-400'}`}>
                          <Clock className="w-3 h-3" />
                          Anunciado: {formatAnnouncedAt(pickup.announced_at)}
                          {isStaleAnnouncement(pickup.announced_at) && ' · Atrasado'}
                        </p>
                      )}
                    </div>

                    {/* Verification Interface */}
                    <div className="flex-1 space-y-4">
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {isReplacement ? t('monitor.authorizedReplacement') : t('monitor.mainGuardian')}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-tighter ${isReplacement ? 'bg-amber-100 text-amber-800' : 'bg-cyan-100 text-cyan-800'}`}>
                            {isReplacement ? t('monitor.replacementBadge') : t('monitor.holderBadge')}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-slate-200 border border-slate-200">
                            <img
                              src={pickup.profiles?.photo_url || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100"}
                              alt="Adulto"
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-base font-black text-primary truncate leading-tight">
                              {displayName}
                            </h4>
                            <p className="text-xs text-slate-500 font-medium">
                              {subLabel}
                            </p>
                            <div className="flex gap-2 mt-2 flex-wrap">
                              <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg font-black uppercase">
                                <ShieldCheck className="w-3 h-3" /> {isReplacement ? t('monitor.qrValid') : t('monitor.pinOk')}
                              </span>
                              {!isReplacement && (
                                <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg font-black uppercase">
                                  <CheckCircle2 className="w-3 h-3" /> {t('monitor.biometryOk')}
                                </span>
                              )}
                              {pickup.location_verified === false && (
                                <span className="inline-flex items-center gap-1 text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-lg font-black uppercase">
                                  <AlertTriangle className="w-3 h-3" /> Sin GPS
                                </span>
                              )}
                            </div>
                            {notifiedStaff.length > 0 && (
                              <p className="text-[10px] text-slate-400 font-bold mt-2">
                                <Bell className="w-3 h-3 inline -mt-0.5 mr-1" />
                                Avisado: {notifiedStaff.map(s => `${s.first_name} ${s.last_name}`).join(', ')}
                              </p>
                            )}
                          </div>
                        </div>
                        {vehicle && (
                          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 text-xs font-bold text-slate-600">
                            <Car className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="font-black text-slate-800">{vehicle.license_plate}</span>
                            {vehicle.description && (
                              <span className="text-slate-400 font-medium truncate">— {vehicle.description}</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="pt-2 flex flex-col sm:flex-row gap-3 items-center">
                        <div className="flex-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{t('monitor.verifyBeforeAuthorize')}</p>
                        </div>
                        <button
                          onClick={() => handleAuthorize(pickup)}
                          disabled={authorizingId === pickup.id}
                          className="w-full sm:w-auto px-6 py-3 rounded-2xl font-black text-sm shadow-lg transition-all bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-emerald-500/20 hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {t('monitor.authorizeBtn')}
                        </button>
                      </div>
                    </div>
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
