import React, { useEffect, useState, useRef } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { ParentPerimeterPanel } from '../components/ParentPerimeterPanel';
import { useLanguage } from '../contexts/LanguageContext';
import { ShieldCheck, AlertTriangle, QrCode, CheckCircle2, Lock, Unlock, X, User, Bell, Video, Zap, Clock, Car } from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

import { subscribeToAudioState, enableGlobalAudio, playGlobalVoiceMessage, getAudioContext } from '../lib/audioManager';
import { getReplacementNameFromNotes, formatAnnouncedAt, isStaleAnnouncement } from '../lib/pickupHelpers';
import { useMonitoredDoor } from '../lib/monitoredDoor';

export function VerificationDisplay() {
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const [pickups, setPickups] = useState<any[]>([]);
  const [doors, setDoors] = useState<any[]>([]);
  // Compartida con En Tránsito y con el widget de "carritos" (Padres en el
  // Perímetro): la puerta que se elige acá se adopta automáticamente en
  // esas otras pantallas, sin tener que volver a elegirla en cada una.
  const [selectedDoorId, setSelectedDoorId] = useMonitoredDoor(profile?.tenant_id);
  // Deja atender a alguien de más atrás en la fila (ej. su papá ya está en la
  // puerta aunque haya anunciado después que otros) sin perder el orden real
  // de llegada de los demás — solo cambia a quién se muestra para verificar.
  const [selectedPickupId, setSelectedPickupId] = useState<string | null>(null);
  const doorGradesMapping = useRef<Record<string, string[]>>({});
  const isFirstFetch = useRef(true);
  const hasInitializedFrontQueue = useRef(false);
  const announcedPickupIds = useRef<Set<string>>(new Set());
  const currentlyDisplayedId = useRef<string | null>(null);
  const [lockdownActive, setLockdownActive] = useState(false);
  const [replacementData, setReplacementData] = useState<any | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [manualQRData, setManualQRData] = useState('');
  const [showArrivalToast, setShowArrivalToast] = useState<string | null>(null);
  const [notifiedStaff, setNotifiedStaff] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [latestDetections, setLatestDetections] = useState<any[]>([]);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const channelRef = React.useRef<any>(null);

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
    console.log('VerificationDisplay: lockdownActive changed to:', lockdownActive);
  }, [lockdownActive]);

  useEffect(() => {
    fetchDoorsAndGrades();
    fetchPickups();

    // Use a unique channel name for postgres_changes to avoid conflicts with other components
    const pickupChannel = supabase
      .channel(`verification_display_pickups_${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_events' }, async (payload: any) => {
        console.log('Pickup event change detected:', payload);
        fetchPickups();
      })
      .subscribe();

    // Broadcast channel for lockdown sync - must share the same name 'system_state'
    channelRef.current = supabase.channel('system_state')
      .on('broadcast', { event: 'lockdown' }, (payload) => {
        console.log('Monitor received lockdown broadcast:', payload);
        setLockdownActive(payload.payload.active);
      })
      .subscribe((status) => {
        console.log('Monitor channel status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('Requesting initial lockdown status...');
          channelRef.current.send({
            type: 'broadcast',
            event: 'request_lockdown_status',
            payload: {}
          });
        }
      });

    // Separate unique channel for school_settings changes
    const settingsChannel = supabase
      .channel(`monitor_settings_sync_${Math.random()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'school_settings' }, (payload) => {
        console.log('Monitor received DB update on school_settings:', payload);
        if (payload.new && 'lockdown_mode' in payload.new) {
          setLockdownActive(!!payload.new.lockdown_mode);
        }
      })
      .subscribe();

    const detectionChannel = supabase
      .channel(`monitor_detections_${Math.random()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'camera_detections' }, (payload) => {
        console.log('New camera detection:', payload.new);
        setLatestDetections(prev => [payload.new, ...prev].slice(0, 3));
      })
      .subscribe();

    const logsChannel = supabase
      .channel(`monitor_logs_${Math.random()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, (payload) => {
        console.log('New log detected, refreshing queue:', payload.new);
        fetchPickups();
      })
      .subscribe();

    // Fallback polling every 10 seconds
    const pollInterval = window.setInterval(() => {
      console.log('VerificationDisplay fallback polling...');
      fetchPickups();
    }, 10000);

    return () => {
      supabase.removeChannel(pickupChannel);
      supabase.removeChannel(settingsChannel);
      supabase.removeChannel(detectionChannel);
      supabase.removeChannel(logsChannel);
      clearInterval(pollInterval);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [profile?.tenant_id]);

  const fetchDoorsAndGrades = async () => {
    if (!profile?.tenant_id) return;
    const [doorsRes, gradesRes, gradeDoorsRes] = await Promise.all([
      supabase.from('exit_doors').select('*').eq('tenant_id', profile.tenant_id).order('name'),
      supabase.from('school_grades').select('*').eq('tenant_id', profile.tenant_id),
      supabase.from('grade_doors').select('*')
    ]);

    if (doorsRes.data) setDoors(doorsRes.data);
    
    if (gradesRes.data && gradeDoorsRes.data) {
      const mapping: Record<string, string[]> = {};
      gradeDoorsRes.data.forEach(gd => {
        if (!mapping[gd.door_id]) mapping[gd.door_id] = [];
        const grade = gradesRes.data.find(g => g.id === gd.grade_id);
        if (grade) {
          mapping[gd.door_id].push(grade.name);
        }
      });
      doorGradesMapping.current = mapping;
    }
  };

  const fetchPickups = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('pickup_events')
      .select('*, profiles:parent_id(*, vehicles(*)), students:student_id(*)')
      .eq('tenant_id', profile.tenant_id)
      .in('status', ['announced', 'in_queue'])
      .order('announced_at', { ascending: true })
      .limit(300);


    if (data) {
      setPickups(data);
      
      if (isFirstFetch.current) {
        data.forEach(p => announcedPickupIds.current.add(p.id));
        // Initialize currentlyDisplayedId so we don't announce the existing front of queue later
        if (data.length > 0) {
          currentlyDisplayedId.current = data[0].id;
        }
        isFirstFetch.current = false;
      } else {
        data.forEach(async (pickup) => {
          if (pickup.status === 'announced' && !announcedPickupIds.current.has(pickup.id)) {
            // Check if this pickup should be announced on this door
            let shouldAnnounce = true;
            if (selectedDoorId && doorGradesMapping.current[selectedDoorId]) {
              const allowedGrades = doorGradesMapping.current[selectedDoorId];
              const studentGrade = pickup.students?.grade;
              if (!allowedGrades.includes(studentGrade)) {
                shouldAnnounce = false;
              }
            }

            if (shouldAnnounce) {
              announcedPickupIds.current.add(pickup.id);

              const fullName = `${pickup.students?.first_name} ${pickup.students?.last_name}`;
              // Si vino un reemplazo autorizado (ver REPLACEMENT_NOTE_PREFIX),
              // NO es el papá/mamá/tutor quien llegó — decirlo así sería
              // engañoso para el personal en la puerta.
              const replacementName = getReplacementNameFromNotes(pickup.notes);
              let relLabel: string;
              if (replacementName) {
                relLabel = `${replacementName} (autorizado)`;
              } else {
                // Fetch relationship
                const { data: relData } = await supabase
                  .from('parent_students')
                  .select('relationship')
                  .eq('parent_id', pickup.parent_id)
                  .eq('student_id', pickup.student_id)
                  .maybeSingle();

                relLabel = "el representante";
                if (relData) {
                  if (relData.relationship === 'father') relLabel = "el papá";
                  else if (relData.relationship === 'mother') relLabel = "la mamá";
                  else if (relData.relationship === 'guardian') relLabel = "el tutor";
                }
              }

              const gradeName = pickup.students?.grade || '—';
              const sectionName = pickup.students?.section || '—';
              console.log(`VerificationDisplay Auto-announcing: ${fullName} (${relLabel})`);
              // Pedido explícito del colegio: el anuncio por voz (para las
              // bocinas del salón, no para el padre) dice el alumno, su
              // grado y su sección, no quién lo retira — eso ya se ve en la
              // tarjeta y en el toast, que sí siguen mostrando quién llegó.
              // Se anuncia en español y después en inglés, más despacio que
              // antes (ver audioManager.ts) para que se entienda bien.
              playGlobalVoiceMessage(`Salida de ${fullName}, grado ${gradeName}, sección ${sectionName}, solicitada.`, 'es');
              playGlobalVoiceMessage(`Dismissal requested for ${fullName}, grade ${gradeName}, section ${sectionName}.`, 'en');
              setShowArrivalToast(`${relLabel.charAt(0).toUpperCase() + relLabel.slice(1)} de ${fullName}`);
              setTimeout(() => setShowArrivalToast(null), 4000);
            } else {
              // Even if we don't announce it here, we mark it as announced so we don't keep checking
              announcedPickupIds.current.add(pickup.id);
            }
          }
        });
      }
    }
  };

  const handleProcessQR = () => {
    try {
      const data = JSON.parse(manualQRData);
      if (data.type === 'replacement_pickup') {
        setReplacementData(data);
        setShowQRScanner(false);
        setManualQRData('');
        // We could also trigger a pickup event here if needed, 
        // but for now we'll just show the verification UI for this replacement.
      } else {
        alert(t('monitor.invalidQR'));
      }
    } catch (e) {
      alert(t('monitor.qrProcessError'));
    }
  };

  const filteredPickups = pickups.filter(pickup => {
    if (!selectedDoorId) return true;
    // El padre eligió puerta al anunciar su llegada: eso manda sobre el
    // mapeo grado→puerta (que no aplica, por ejemplo, a hermanos de
    // distinto grado que salen juntos por la misma puerta).
    if (pickup.door_id) return pickup.door_id === selectedDoorId;
    const allowedGrades = doorGradesMapping.current[selectedDoorId];
    if (!allowedGrades) return true;
    return allowedGrades.includes(pickup.students?.grade);
  });

  const currentPickup =
    (selectedPickupId && pickups.find(p => p.id === selectedPickupId)) || filteredPickups[0];
  // La cola debe respetar el mismo filtro de puerta que la tarjeta principal
  // — antes se armaba de `pickups` sin filtrar, así que con una puerta
  // seleccionada la tarjeta sí filtraba pero la lista de "En cola" mostraba
  // igual alumnos de todas las puertas.
  const queue = filteredPickups.filter(p => p.id !== currentPickup?.id);

  // Quién recibió el aviso de "llegó" para este pickup puntual (profesores
  // encargados de esa sección + quien tenga activado "recibir todos los
  // avisos"), para que recepción/admin lo vea directo en la tarjeta sin
  // tener que preguntar.
  useEffect(() => {
    if (!currentPickup?.id) {
      setNotifiedStaff([]);
      return;
    }
    (async () => {
      const { data: rows } = await supabase
        .from('notifications')
        .select('user_id')
        .eq('pickup_event_id', currentPickup.id);
      const userIds = Array.from(new Set((rows || []).map(r => r.user_id).filter(Boolean)));
      if (userIds.length === 0) {
        setNotifiedStaff([]);
        return;
      }
      const { data: staff } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', userIds);
      setNotifiedStaff(staff || []);
    })();
  }, [currentPickup?.id]);

  // Announce when a pickup reaches the front of the queue
  useEffect(() => {
    if (!hasInitializedFrontQueue.current) {
      if (currentPickup) {
         currentlyDisplayedId.current = currentPickup.id; // Initialize silently
      }
      if (pickups.length > 0) {
        hasInitializedFrontQueue.current = true;
      }
      return; 
    }
    
    if (currentPickup && currentPickup.id !== currentlyDisplayedId.current) {
      currentlyDisplayedId.current = currentPickup.id;
      
      const announceFrontOfQueue = async () => {
        const fullName = `${currentPickup.students?.first_name} ${currentPickup.students?.last_name}`;
        const replacementName = getReplacementNameFromNotes(currentPickup.notes);
        let relLabel: string;
        if (replacementName) {
          relLabel = `${replacementName} (autorizado)`;
        } else {
          // Fetch relationship
          const { data: relData } = await supabase
            .from('parent_students')
            .select('relationship')
            .eq('parent_id', currentPickup.parent_id)
            .eq('student_id', currentPickup.student_id)
            .maybeSingle();

          relLabel = "El representante";
          if (relData) {
            if (relData.relationship === 'father') relLabel = "El papá";
            else if (relData.relationship === 'mother') relLabel = "La mamá";
            else if (relData.relationship === 'guardian') relLabel = "El tutor";
          }
        }

        playGlobalVoiceMessage(`Atención, es el turno para ${relLabel} de ${fullName}. Por favor acérquese.`);
      };

      announceFrontOfQueue();
    } else if (!currentPickup) {
      currentlyDisplayedId.current = null;
    }
  }, [currentPickup]);

  const handleConfirmRelease = async () => {
    if (currentPickup) {
      // Optimistic update for instant UI feedback
      const pickupIdToRelease = currentPickup.id;
      setPickups(prev => prev.filter(p => p.id !== pickupIdToRelease));
      setSelectedPickupId(null);

      try {
        const studentName = currentPickup.students?.first_name;
        
        // 1. Update pickup event
        const { error: updateError } = await supabase
          .from('pickup_events')
          .update({ status: 'released' })
          .eq('id', pickupIdToRelease);

        if (updateError) throw updateError;

        // 2. Audit Log
        await supabase.from('audit_logs').insert({
          event_type: 'SECURITY',
          description: `AUTORIZACIÓN EXTERNA: Salida validada desde monitor de puerta para ${studentName || 'el alumno'}.`,
          actor_name: 'Personal de Puerta',
          metadata: { pickup_id: pickupIdToRelease },
          tenant_id: currentPickup?.tenant_id
        });

        // 3. Notification for Parent
        await supabase.from('notifications').insert({
          user_id: currentPickup.parent_id,
          title: '¡Saliendo por Puerta!',
          message: `El Personal de Puerta ha validado la salida de ${studentName || 'tu hijo'}. Reúnete con él en el vehículo.`,
          type: 'success'
        });

        // Background refresh to ensure sync
        fetchPickups();
      } catch (error: any) {
        console.error("Error releasing pickup:", error);
        alert(t('monitor.releaseErrorPrefix') + error.message);
        // Revert optimistic update on error
        fetchPickups();
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Usamos el TopNav estándar en lugar del header embebido para mantener consistencia */}
      <TopNav title="SafePickup" subtitle={t('monitor.pageSubtitle')} />

      {/* Audio Activation Prompt — Monitor Externo depende de los anuncios
          por voz, así que en vez de una barra discreta que se puede pasar
          por alto, se pide de entrada con un modal que bloquea la pantalla
          hasta que se active (o se descarte a propósito). */}
      {!audioEnabled && (
        <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl p-8 max-w-sm w-full text-center space-y-5">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto">
              <Bell className="w-8 h-8 text-indigo-600 animate-pulse" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-black text-slate-900">{t('monitor.audioActivationRequired')}</h2>
              <p className="text-sm text-slate-500 font-medium">{t('monitor.audioActivationModalDesc')}</p>
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

      {/* Arrival Toast Notification */}
      {showArrivalToast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[110] animate-in slide-in-from-top-8 duration-300">
          <div className="bg-emerald-600 text-white px-8 py-4 rounded-3xl shadow-2xl flex items-center gap-4 border-4 border-white">
            <div className="bg-white/20 p-2 rounded-xl">
              <Bell className="w-6 h-6 text-white animate-bounce" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-widest opacity-80">{t('monitor.arrivalNotice')}</p>
              <p className="text-lg font-bold">{showArrivalToast}</p>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 md:p-8 flex-1 animate-in fade-in duration-500 relative overflow-y-auto">
        {/* Door Selector */}
        <div className="mb-6 bg-white rounded-3xl p-4 shadow-sm border border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-50 p-2 rounded-xl">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">{t('monitor.doorToMonitor')}</h3>
              <p className="text-xs text-slate-500">{t('monitor.selectDoorFilter')}</p>
            </div>
          </div>
          <select
            value={selectedDoorId}
            onChange={(e) => setSelectedDoorId(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-xl focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 font-medium outline-none"
          >
            <option value="">{t('monitor.allDoors')}</option>
            {doors.map((door) => (
              <option key={door.id} value={door.id}>
                {door.name}
              </option>
            ))}
          </select>
        </div>

        {/* Lockdown Overlay - Ahora contenido dentro del área de trabajo para permitir navegación */}
        {lockdownActive && (
          <div className="absolute inset-0 z-[100] bg-red-600/95 backdrop-blur-2xl flex flex-col items-center justify-center p-8 text-center overflow-hidden">
            <div className="animate-pulse flex flex-col items-center gap-8">
              <div className="bg-white p-8 rounded-[2rem] shadow-[0_0_50px_rgba(255,255,255,0.3)]">
                <Lock className="w-32 h-32 text-red-600 animate-bounce" />
              </div>
              <div className="space-y-2">
                <h1 className="text-6xl font-black text-white uppercase tracking-tighter drop-shadow-2xl">
                  {t('monitor.restrictedExit')}
                </h1>
                <p className="text-xl font-bold text-white/90 uppercase tracking-[0.3em] bg-black/20 px-6 py-3 rounded-xl backdrop-blur-sm">
                  {t('monitor.emergencyProtocolActive')}
                </p>
              </div>
              <div className="mt-8 flex gap-3">
                <div className="w-3 h-3 rounded-full bg-white animate-ping"></div>
                <div className="w-3 h-3 rounded-full bg-white animate-ping delay-150"></div>
                <div className="w-3 h-3 rounded-full bg-white animate-ping delay-300"></div>
              </div>
            </div>
          </div>
        )}

        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight text-primary">{t('security.title')}</h2>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-2.5 h-2.5 rounded-full bg-secondary shadow-[0_0_0_rgba(43,103,103,0.4)] animate-[pulse_2s_infinite]"></div>
                <span className="text-sm font-medium text-secondary">{t('monitor.realtimeLinkActive')}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (currentPickup) {
                    const studentName = `${currentPickup.students?.first_name} ${currentPickup.students?.last_name}`;
                    playGlobalVoiceMessage(`Atención, el representante de ${studentName} ha llegado.`);
                  } else {
                    playGlobalVoiceMessage("Atención, el papá de Arantxa Suarez ha llegado.");
                  }
                }}
                className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-emerald-200 active:scale-95 transition-all"
              >
                <Bell className="w-5 h-5" />
                {t('monitor.testVoice')}
              </button>
              <button
                onClick={() => setShowQRScanner(true)}
                className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-indigo-200 active:scale-95 transition-all"
              >
                <QrCode className="w-5 h-5" />
                {t('monitor.scanReplacement')}
              </button>
              <button className="bg-error text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-error/20 active:scale-95 transition-all">
                <AlertTriangle className="w-5 h-5" />
                {t('monitor.discreteAlert')}
              </button>
            </div>
          </div>

          <ParentPerimeterPanel />

          {!currentPickup ? (
            <div className="bg-surface-container-lowest rounded-[2rem] p-12 text-center shadow-lg border border-outline-variant/10">
              <h3 className="text-2xl font-bold text-slate-400">{t('monitor.waitingForScan')}</h3>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Primary Verification Card */}
              <div className="lg:col-span-8 flex flex-col gap-6">
                {selectedPickupId && filteredPickups[0]?.id !== currentPickup?.id && (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl px-5 py-3 flex items-center justify-between gap-3 text-xs font-bold">
                    <span className="flex items-center gap-2">
                      <Zap className="w-4 h-4 shrink-0" />
                      Atendiendo fuera de orden — elegido manualmente de la fila.
                    </span>
                    <button
                      onClick={() => setSelectedPickupId(null)}
                      className="underline hover:text-emerald-900 shrink-0"
                    >
                      Volver al orden normal
                    </button>
                  </div>
                )}
                <div className="bg-surface-container-lowest rounded-[2rem] p-4 md:p-6 shadow-sm border border-slate-100">
                  <div className="flex flex-col md:flex-row gap-6">
                    {/* Child Info */}
                    <div className="flex-shrink-0 w-full md:w-1/4 text-center md:text-left">
                      <div className="relative inline-block">
                        <div className="w-32 h-32 rounded-[1.5rem] overflow-hidden mx-auto border-4 border-surface-container shadow-md">
                          <img 
                            src={currentPickup.students?.photo_url || "https://images.unsplash.com/photo-1595152772835-219674b2a8a6?auto=format&fit=crop&q=80&w=300"} 
                            alt="Child Profile" 
                            className="w-full h-full object-cover" 
                          />
                        </div>
                        <div className="absolute -bottom-2 -right-2 bg-secondary text-white px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest">
                          {currentPickup.students?.grade || 'N/A'}
                        </div>
                      </div>
                      <h3 className="mt-4 text-xl font-black text-primary leading-tight">{currentPickup.students?.first_name} {currentPickup.students?.last_name}</h3>
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">{t('monitor.section')}: {currentPickup.students?.section || 'A'}</p>
                      {currentPickup.door_id && (
                        <p className="text-xs font-black uppercase tracking-wider mt-1 text-indigo-600">
                          Puerta: {doors.find(d => d.id === currentPickup.door_id)?.name || '—'}
                        </p>
                      )}
                      {formatAnnouncedAt(currentPickup.announced_at) && (
                        <p className={`text-xs font-black uppercase tracking-wider mt-1 flex items-center justify-center md:justify-start gap-1 ${isStaleAnnouncement(currentPickup.announced_at) ? 'text-rose-600' : 'text-slate-400'}`}>
                          <Clock className="w-3 h-3" />
                          Anunciado: {formatAnnouncedAt(currentPickup.announced_at)}
                          {isStaleAnnouncement(currentPickup.announced_at) && ' · Atrasado'}
                        </p>
                      )}
                    </div>

                    {/* Verification Interface */}
                    <div className="flex-1 space-y-4">
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        {(() => {
                          // El nombre real de quien llegó puede venir de dos
                          // fuentes: el QR pegado a mano en este monitor
                          // (replacementData), o el nombre guardado en
                          // pickup_events.notes cuando se anunció desde el
                          // lector QR de recepción (SmartCheckIn). Sin esto,
                          // esta tarjeta seguía mostrando al papá/mamá como
                          // si hubiera llegado él, aunque haya sido un
                          // reemplazo autorizado.
                          const notesReplacementName = getReplacementNameFromNotes(currentPickup.notes);
                          const isReplacement = !!(replacementData || notesReplacementName);
                          const displayName = replacementData
                            ? replacementData.replacement_name
                            : notesReplacementName || `${currentPickup.profiles?.first_name} ${currentPickup.profiles?.last_name}`;
                          const subLabel = replacementData
                            ? `${t('monitor.requestedBy')}: ${replacementData.parent_name}`
                            : notesReplacementName
                              ? `${t('monitor.requestedBy')}: ${currentPickup.profiles?.first_name} ${currentPickup.profiles?.last_name}`
                              : (currentPickup.profiles?.phone || t('monitor.verifiedContact'));
                          return (
                            <>
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                  {isReplacement ? t('monitor.authorizedReplacement') : t('monitor.mainGuardian')}
                                </span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-tighter ${isReplacement ? 'bg-amber-100 text-amber-800' : 'bg-cyan-100 text-cyan-800'}`}>
                                  {isReplacement ? t('monitor.replacementBadge') : t('monitor.holderBadge')}
                                </span>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-slate-200 border border-slate-200">
                                  {isReplacement ? (
                                    replacementData?.photo_url ? (
                                      <img
                                        src={replacementData.photo_url}
                                        alt={displayName}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center bg-amber-50">
                                        <User className="w-10 h-10 text-amber-400" />
                                      </div>
                                    )
                                  ) : (
                                    <img
                                      src={currentPickup.profiles?.photo_url || "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100"}
                                      alt="Adult Profile"
                                      className="w-full h-full object-cover"
                                    />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h4 className="text-lg font-black text-primary truncate leading-tight">
                                    {displayName}
                                  </h4>
                                  <p className="text-xs text-slate-500 font-medium">
                                    {subLabel}
                                  </p>
                                  <div className="flex gap-2 mt-2">
                                    <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg font-black uppercase">
                                      <ShieldCheck className="w-3 h-3" /> {isReplacement ? t('monitor.qrValid') : t('monitor.pinOk')}
                                    </span>
                                    {!isReplacement && (
                                      <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg font-black uppercase">
                                        <CheckCircle2 className="w-3 h-3" /> {t('monitor.biometryOk')}
                                      </span>
                                    )}
                                    {currentPickup.location_verified === false && (
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
                              {!isReplacement && currentPickup.profiles?.vehicles?.[0] && (
                                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 text-xs font-bold text-slate-600">
                                  <Car className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="font-black text-slate-800">{currentPickup.profiles.vehicles[0].license_plate}</span>
                                  {currentPickup.profiles.vehicles[0].description && (
                                    <span className="text-slate-400 font-medium truncate">— {currentPickup.profiles.vehicles[0].description}</span>
                                  )}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>

                      {/* Final Action CTA */}
                      <div className="pt-4 border-t border-slate-100 flex flex-col md:flex-row gap-4 items-center">
                        <div className="flex-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{t('monitor.verifyBeforeAuthorize')}</p>
                        </div>
                        <button
                          onClick={handleConfirmRelease}
                          className="w-full md:w-auto px-8 py-4 rounded-2xl font-black text-lg shadow-lg transition-all bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-emerald-500/20 hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3 uppercase tracking-widest"
                        >
                          <CheckCircle2 className="w-5 h-5" />
                          {t('monitor.authorizeBtn')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Side Utility Panel - Queue */}
              <div className="lg:col-span-4 space-y-6 flex flex-col h-[calc(100vh-12rem)]">
                <div className="bg-slate-50 rounded-[2rem] p-6 border border-slate-200 shadow-sm flex-1 flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      {t('monitor.exitQueue')}
                    </h4>
                    <span className="bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {filteredPickups.length} {t('monitor.totalSuffix')}
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {queue.length === 0 ? (
                      <div className="text-center text-slate-400 text-xs py-4">
                        {t('monitor.noMoreInQueue')}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2">
                        {queue.map((pickup) => {
                          const position = filteredPickups.findIndex(p => p.id === pickup.id) + 1;
                          return (
                            <div key={pickup.id} className="bg-white p-2 rounded-xl shadow-sm border border-slate-100 flex items-center gap-3 hover:border-indigo-200 transition-all">
                              <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex-shrink-0 border border-slate-200">
                                <img
                                  src={pickup.students?.photo_url || "https://images.unsplash.com/photo-1595152772835-219674b2a8a6?auto=format&fit=crop&q=80&w=100"}
                                  alt="Child"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h5 className="font-bold text-xs text-slate-800 truncate flex items-center gap-1">
                                  {pickup.students?.first_name} {pickup.students?.last_name}
                                  {pickup.location_verified === false && (
                                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                                  )}
                                </h5>
                                <p className="text-[10px] text-slate-500 truncate leading-tight">
                                  {pickup.students?.grade} • {pickup.profiles?.first_name}
                                  {pickup.door_id && ` • ${doors.find(d => d.id === pickup.door_id)?.name || '—'}`}
                                  {formatAnnouncedAt(pickup.announced_at) && (
                                    <span className={isStaleAnnouncement(pickup.announced_at) ? 'text-rose-600 font-bold' : ''}>
                                      {' '}• {formatAnnouncedAt(pickup.announced_at)}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <button
                                onClick={() => setSelectedPickupId(pickup.id)}
                                title={t('monitor.attendNow')}
                                className="shrink-0 flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2 py-1.5 rounded-lg transition-colors"
                              >
                                <Zap className="w-3 h-3" />
                                <span className="text-[9px] font-black uppercase tracking-wide">{t('monitor.attendNow')}</span>
                              </button>
                              <div className="text-[10px] font-black text-indigo-400 bg-indigo-50 w-6 h-6 rounded-lg flex items-center justify-center shrink-0">
                                {position}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-red-50 rounded-[2rem] p-6 border border-red-100 flex-shrink-0">
                  <div className="flex items-center gap-3 mb-4">
                    <ShieldCheck className="w-6 h-6 text-error" />
                    <h4 className="font-bold text-primary text-sm">{t('monitor.discreteAlertProtocol')}</h4>
                  </div>
                  <ul className="space-y-2 text-[10px]">
                    <li className="flex gap-2">
                      <span className="font-bold text-error">01.</span>
                      <span className="text-slate-600">{t('monitor.stayCalm')}</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-bold text-error">02.</span>
                      <span className="text-slate-600">{t('monitor.contactSecurity')}</span>
                    </li>
                  </ul>
                </div>

                {/* Camera Detections - Proactive Notice */}
                {latestDetections.length > 0 && (
                  <div className="bg-indigo-50 rounded-[2rem] p-6 border border-indigo-100 flex-shrink-0">
                    <div className="flex items-center gap-3 mb-4">
                      <Video className="w-5 h-5 text-indigo-600" />
                      <h4 className="font-bold text-indigo-900 text-xs uppercase tracking-wider">{t('monitor.approaching')}</h4>
                    </div>
                    <div className="space-y-2">
                      {latestDetections.map((det, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] bg-white/50 p-2 rounded-xl border border-indigo-100">
                          <span className="font-bold text-indigo-700">{det.plate_number || t('monitor.vehicleDetected')}</span>
                          <span className="text-indigo-400 font-medium">{new Date(det.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* QR SCANNER MODAL (SIMULATED) */}
      {showQRScanner && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in">
          <div className="bg-white w-full max-w-sm rounded-[3rem] overflow-hidden shadow-2xl animate-in zoom-in-95">
             <div className="p-8 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
               <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">{t('monitor.scanReplacementQR')}</h3>
               <button onClick={() => setShowQRScanner(false)} className="p-2.5 bg-white text-slate-400 rounded-xl shadow-sm"><X className="w-5 h-5" /></button>
             </div>
             <div className="p-8 space-y-6 text-center">
                <div className="w-48 h-48 bg-slate-100 rounded-3xl mx-auto flex items-center justify-center border-4 border-dashed border-slate-200">
                  <QrCode className="w-20 h-20 text-slate-300" />
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  {t('monitor.demoQRNote')}
                </p>
                <textarea
                  value={manualQRData}
                  onChange={e => setManualQRData(e.target.value)}
                  placeholder='{"type":"replacement_pickup",...}'
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-[10px] font-mono outline-none focus:border-indigo-500 h-24"
                />
                <button
                  onClick={handleProcessQR}
                  className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 text-xs uppercase tracking-widest"
                >
                  {t('monitor.validateCode')}
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
