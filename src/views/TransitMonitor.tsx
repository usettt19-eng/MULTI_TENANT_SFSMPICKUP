import React, { useEffect, useRef, useState } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { ParentPerimeterPanel } from '../components/ParentPerimeterPanel';
import { useLanguage } from '../contexts/LanguageContext';
import { Footprints, DoorOpen, Car, User, ShieldCheck, Bell, CheckCircle2, Loader2 } from 'lucide-react';
import { getReplacementNameFromNotes, formatAnnouncedAt } from '../lib/pickupHelpers';
import { subscribeToAudioState, enableGlobalAudio, playGlobalVoiceMessage } from '../lib/audioManager';
import { useMonitoredDoor } from '../lib/monitoredDoor';

/**
 * Alumnos ya aprobados por el profesor (status 'released') que todavía no
 * fueron confirmados por el padre en el vehículo (status 'completed'). Es
 * sobre todo guía visual para el personal en el trayecto entre el salón y
 * la puerta, pero cada tarjeta tiene un botón para que el personal que
 * físicamente entrega al alumno lo saque de tránsito sin depender de que
 * el padre confirme en su app (misma transición 'released' -> 'completed'
 * que usa `handleFinalConfirm` en ParentDashboard.tsx, filtrando por el id
 * del pickup en vez de por parent_id — esa lógica del padre no se toca).
 */
export function TransitMonitor() {
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const [pickups, setPickups] = useState<any[]>([]);
  const [doors, setDoors] = useState<any[]>([]);
  const [completingId, setCompletingId] = useState<string | null>(null);
  // Compartida con Monitor Externo y con el widget de "carritos" (Padres en
  // el Perímetro): la puerta elegida en cualquiera de las tres se adopta
  // automáticamente en las otras.
  const [selectedDoorId, setSelectedDoorId] = useMonitoredDoor(profile?.tenant_id);
  const [loading, setLoading] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(false);
  // Para avisar al personal de entrega final (voz, en español e inglés) en
  // cuanto un alumno entra a la lista — solo una vez por alumno, y nunca
  // para lo que ya estaba en tránsito al abrir la pantalla (si no, cada
  // recarga anunciaría de nuevo a todos los que ya estaban esperando).
  const announcedTransitIds = useRef<Set<string>>(new Set());
  const isFirstFetch = useRef(true);
  // doorsRef porque fetchTransit se dispara antes de que fetchDoors termine
  // de traer los nombres — sin la referencia, el anuncio de voz podría
  // salir sin nombre de puerta la primera vez.
  const doorsRef = useRef<any[]>([]);
  // fetchTransit se invoca desde el poll/la suscripción de realtime, que se
  // arman una sola vez en el useEffect de abajo (deps: solo tenant_id) — sin
  // esta referencia, ese cierre se quedaría con la puerta seleccionada al
  // montar la pantalla y el anuncio de voz ignoraría cualquier cambio de
  // puerta posterior hasta recargar la página.
  const selectedDoorIdRef = useRef(selectedDoorId);
  useEffect(() => {
    selectedDoorIdRef.current = selectedDoorId;
  }, [selectedDoorId]);

  useEffect(() => {
    const unsubscribe = subscribeToAudioState(setAudioEnabled);
    return unsubscribe;
  }, []);

  const enableAudio = () => {
    enableGlobalAudio();
  };

  useEffect(() => {
    if (!profile?.tenant_id) return;
    fetchDoors();
    fetchTransit();

    // pickup_events nunca estuvo en la publicación de Realtime de Supabase
    // (solo parent_presence lo está) — el .on('postgres_changes', ...) que
    // había acá nunca recibía nada, solo sumaba una conexión sin beneficio.
    // El polling de abajo es, y siempre fue, el mecanismo real de refresco.
    const pollInterval = window.setInterval(fetchTransit, 10000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [profile?.tenant_id]);

  const fetchDoors = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase.from('exit_doors').select('*').eq('tenant_id', profile.tenant_id).order('name');
    if (data) {
      setDoors(data);
      doorsRef.current = data;
    }
  };

  const fetchTransit = async () => {
    if (!profile?.tenant_id) return;
    const { data, error } = await supabase
      .from('pickup_events')
      .select('*, students:student_id(*), profiles:parent_id(*, vehicles(*))')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'released')
      .order('announced_at', { ascending: true });

    if (error) console.error('Error cargando en tránsito:', error);
    if (data) {
      setPickups(data);

      if (isFirstFetch.current) {
        data.forEach(p => announcedTransitIds.current.add(p.id));
        isFirstFetch.current = false;
      } else {
        data.forEach(pickup => {
          if (announcedTransitIds.current.has(pickup.id)) return;
          announcedTransitIds.current.add(pickup.id);

          // Si el personal de esta pantalla está monitoreando una puerta
          // específica, solo se le anuncia lo que sale por esa puerta — lo
          // de otras puertas lo atiende otro personal. Se marca igual como
          // "ya visto" arriba para que, si luego cambia el filtro, no se
          // pongan a sonar de golpe los que ya habían entrado a la lista.
          if (selectedDoorIdRef.current && pickup.door_id !== selectedDoorIdRef.current) return;

          const fullName = `${pickup.students?.first_name || ''} ${pickup.students?.last_name || ''}`.trim();
          const gradeName = pickup.students?.grade || '—';
          const sectionName = pickup.students?.section || '—';
          const door = doorsRef.current.find(d => d.id === pickup.door_id)?.name;

          // Aviso para el personal de entrega final (puerta de salida): el
          // alumno ya fue aprobado por el profesor y viene en camino. En
          // español y después en inglés, igual que el anuncio del profesor.
          const esDoor = door ? `, hacia la puerta ${door}` : '';
          const enDoor = door ? `, heading to door ${door}` : '';
          playGlobalVoiceMessage(`Alumno en tránsito: ${fullName}, grado ${gradeName}, sección ${sectionName}${esDoor}.`, 'es');
          playGlobalVoiceMessage(`Student in transit: ${fullName}, grade ${gradeName}, section ${sectionName}${enDoor}.`, 'en');
        });
      }
    }
    setLoading(false);
  };

  // Confirmación manual del personal que entrega al alumno — mismo efecto
  // que el botón del padre en su app (pickup_events pasa de 'released' a
  // 'completed'), pero disparada desde acá para cuando el padre no
  // confirma (sin señal, sin batería, etc.). Se filtra por el id del
  // pickup, no por parent_id, así que no interfiere con
  // handleFinalConfirm en ParentDashboard.tsx.
  const handleStaffComplete = async (pickup: any) => {
    setCompletingId(pickup.id);
    const { error } = await supabase
      .from('pickup_events')
      .update({ status: 'completed', completed_at: new Date() })
      .eq('id', pickup.id)
      .eq('status', 'released');

    if (error) {
      alert(t('transit.staffCompleteError'));
    } else {
      const fullName = `${pickup.students?.first_name || ''} ${pickup.students?.last_name || ''}`.trim();
      await logActivity(
        'PICKUP',
        `CICLO COMPLETADO (personal): ${profile?.first_name || 'Personal'} confirmó la entrega de ${fullName} directamente desde En Tránsito, sin esperar la confirmación del padre.`,
        profile?.first_name || 'Personal',
        { student_id: pickup.student_id, pickup_event_id: pickup.id, staff_confirmed: true },
        profile?.tenant_id
      );
      setPickups(prev => prev.filter(p => p.id !== pickup.id));
    }
    setCompletingId(null);
  };

  // Prioridad por orden de espera: sin released_at en la base, announced_at
  // es la mejor señal disponible de cuánto lleva esperando cada familia.
  // Los primeros 5 en rojo (más urgente), los siguientes 5 en naranja, el
  // resto en verde — es una banda por posición DENTRO DE CADA PUERTA (no
  // global), ya que cada puerta tiene su propia fila de espera.
  const priorityClass = (index: number) => {
    if (index < 5) return { badge: 'bg-rose-500', card: 'border-rose-200 bg-rose-50/40' };
    if (index < 10) return { badge: 'bg-amber-500', card: 'border-amber-200 bg-amber-50/40' };
    return { badge: 'bg-emerald-500', card: 'border-emerald-200 bg-emerald-50/40' };
  };

  const doorName = (doorId: string | null) => doors.find(d => d.id === doorId)?.name || t('transit.noDoor');

  const filtered = selectedDoorId ? pickups.filter(p => p.door_id === selectedDoorId) : pickups;

  const groups: { doorId: string; doorLabel: string; items: any[] }[] = selectedDoorId
    ? [{ doorId: selectedDoorId, doorLabel: doorName(selectedDoorId), items: filtered }]
    : (() => {
        const byDoor = new Map<string, any[]>();
        filtered.forEach(p => {
          const key = p.door_id || '__none__';
          if (!byDoor.has(key)) byDoor.set(key, []);
          byDoor.get(key)!.push(p);
        });
        return Array.from(byDoor.entries()).map(([doorId, items]) => ({
          doorId,
          doorLabel: doorId === '__none__' ? t('transit.noDoor') : doorName(doorId),
          items,
        }));
      })();

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      <TopNav title={t('transit.title')} subtitle={t('transit.subtitle')} />

      {!audioEnabled && (
        <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl p-8 max-w-sm w-full text-center space-y-5">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto">
              <Bell className="w-8 h-8 text-indigo-600 animate-pulse" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-black text-slate-900">{t('monitor.audioActivationRequired')}</h2>
              <p className="text-sm text-slate-500 font-medium">{t('transit.audioActivationDesc')}</p>
            </div>
            <button
              onClick={enableAudio}
              className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-200"
            >
              {t('monitor.activateSpeakers')}
            </button>
          </div>
        </div>
      )}

      <div className="p-6 max-w-6xl mx-auto w-full space-y-6 animate-in slide-in-from-bottom-4">
        <header className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              {t('transit.title')} <Footprints className="w-8 h-8 text-indigo-600" />
            </h1>
            <p className="text-sm text-slate-500 font-medium mt-1">{t('transit.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 bg-white px-4 py-3 rounded-2xl shadow-sm border border-slate-100">
            <DoorOpen className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={selectedDoorId}
              onChange={e => setSelectedDoorId(e.target.value)}
              className="bg-transparent text-xs font-black uppercase tracking-widest text-slate-600 outline-none"
            >
              <option value="">{t('transit.allDoors')}</option>
              {doors.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </header>

        <ParentPerimeterPanel />

        {loading ? (
          <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-[2.5rem] p-16 text-center shadow-sm border border-slate-100">
            <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Footprints className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-xl font-black text-slate-800">{t('transit.emptyTitle')}</h3>
            <p className="text-slate-400 font-medium mt-2">{t('transit.emptySubtitle')}</p>
          </div>
        ) : (
          groups.map(group => (
            <section key={group.doorId} className="space-y-3">
              {!selectedDoorId && (
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2 flex items-center gap-2">
                  <DoorOpen className="w-3.5 h-3.5" /> {group.doorLabel}
                  <span className="bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full">{group.items.length}</span>
                </h3>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {group.items.map((pickup: any) => {
                  const doorIndex = group.items.findIndex(p => p.id === pickup.id);
                  const priority = priorityClass(doorIndex);
                  const replacementName = getReplacementNameFromNotes(pickup.notes);
                  const isReplacement = !!replacementName;
                  const adultName = isReplacement
                    ? replacementName
                    : `${pickup.profiles?.first_name || ''} ${pickup.profiles?.last_name || ''}`.trim();
                  const vehicle = !isReplacement ? pickup.profiles?.vehicles?.[0] : null;

                  return (
                    <div key={pickup.id} className={`bg-white rounded-[2rem] p-5 shadow-sm border-2 ${priority.card} relative overflow-hidden`}>
                      <span className={`absolute top-0 right-0 ${priority.badge} text-white text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-bl-2xl`}>
                        {t('transit.badge')}
                      </span>

                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-16 h-16 rounded-2xl overflow-hidden shrink-0 border border-slate-100 bg-slate-50">
                          <img
                            src={pickup.students?.photo_url || "https://images.unsplash.com/photo-1595152772835-219674b2a8a6?auto=format&fit=crop&q=80&w=200"}
                            alt="Alumno"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-black text-slate-900 text-base leading-tight truncate">
                            {pickup.students?.first_name} {pickup.students?.last_name}
                          </h4>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                            {t('transit.gradeLabel')} {pickup.students?.grade || '—'} · {t('transit.sectionLabel')} {pickup.students?.section || '—'}
                          </p>
                          {formatAnnouncedAt(pickup.announced_at) && (
                            <p className="text-[10px] text-slate-400 font-bold mt-0.5">{formatAnnouncedAt(pickup.announced_at)}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 bg-slate-50 rounded-2xl p-3">
                        <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-slate-200 flex items-center justify-center">
                          {pickup.profiles?.photo_url && !isReplacement ? (
                            <img src={pickup.profiles.photo_url} alt="Adulto" className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-slate-800 truncate">
                            {adultName}{isReplacement && <span className="text-amber-600"> ({t('transit.authorizedTag')})</span>}
                          </p>
                          {!isReplacement && pickup.profiles?.pin_code && (
                            <p className="text-[10px] text-slate-500 font-bold flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 text-indigo-400" /> PIN {pickup.profiles.pin_code}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleStaffComplete(pickup)}
                          disabled={completingId === pickup.id}
                          title={t('transit.staffCompleteBtn')}
                          className="shrink-0 w-8 h-8 rounded-xl bg-white border border-emerald-200 text-emerald-600 hover:bg-emerald-500 hover:text-white hover:border-emerald-500 transition-all active:scale-90 disabled:opacity-50 flex items-center justify-center"
                        >
                          {completingId === pickup.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      {vehicle && (
                        <div className="flex items-center gap-2 mt-3 text-xs font-bold text-slate-600">
                          <Car className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-black text-slate-800">{vehicle.license_plate}</span>
                          {vehicle.description && <span className="text-slate-400 font-medium truncate">— {vehicle.description}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
