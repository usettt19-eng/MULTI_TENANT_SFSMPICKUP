import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Car, MapPin, DoorOpen } from 'lucide-react';
import type { ParentPresence } from '../types/database';
import { useMonitoredDoor } from '../lib/monitoredDoor';
import { useLanguage } from '../contexts/LanguageContext';
import { PICKUP_WINDOW_START_HOUR } from '../lib/dismissalSchedule';

// No se guarda ni se muestra ninguna coordenada GPS real: esto es una
// representación estilizada (tarjetas de vehículo), no un mapa. Solo usamos
// el booleano dentro/fuera + hace cuánto entró.
const STALE_AFTER_MS = 5 * 60 * 1000; // si no se actualiza en 5 min, se considera que ya no está
const NO_DOOR_KEY = '__none__';

function minutesAgo(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

interface PerimeterCard {
  key: string;
  parentId: string;
  doorId: string | null;
  parentName: string;
  studentName: string | null;
  studentGradeSection: string | null;
  vehicle: { license_plate: string; description: string | null } | null;
  enteredAt: string | null;
}

export function ParentPerimeterPanel() {
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const [cards, setCards] = useState<PerimeterCard[]>([]);
  const [doors, setDoors] = useState<any[]>([]);
  // Adopta la puerta que se esté monitoreando en Monitor Externo o En
  // Tránsito, sin importar en cuál de las tres pantallas se esté viendo el
  // "carritos" — es un valor compartido (ver lib/monitoredDoor.ts), no un
  // filtro independiente de este panel.
  const [sharedDoorId, setSharedDoorId] = useMonitoredDoor(profile?.tenant_id);
  // "Sin puerta asignada" es un filtro exclusivo de este panel (no existe
  // como puerta real en Monitor Externo / Tránsito), así que se maneja como
  // anulación local en vez de propagarse al valor compartido.
  const [localDoorOverride, setLocalDoorOverride] = useState<string | null>(null);
  const selectedDoorId = localDoorOverride !== null ? localDoorOverride : sharedDoorId;

  useEffect(() => {
    // Si la puerta compartida cambia desde Monitor Externo o Tránsito, se
    // adopta automáticamente acá, descartando cualquier anulación local.
    setLocalDoorOverride(null);
  }, [sharedDoorId]);

  const handleDoorChange = (value: string) => {
    if (value === NO_DOOR_KEY) {
      setLocalDoorOverride(value);
    } else {
      setLocalDoorOverride(null);
      setSharedDoorId(value);
    }
  };

  const [, forceTick] = useState(0);

  const fetchDoors = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase.from('exit_doors').select('*').eq('tenant_id', profile.tenant_id).order('name');
    if (data) setDoors(data);
  };

  // Mismo tratamiento que En Tránsito: se arma una tarjeta por cada
  // vehículo/alumno esperado (no solo por padre), agrupable y filtrable por
  // puerta de salida, ordenada por hora de llegada al perímetro. Un padre
  // sin recogida anunciada todavía (o sin puerta asignada) igual aparece,
  // en el grupo "Sin puerta asignada".
  const fetchPresences = async () => {
    if (!profile?.tenant_id) return;
    const staleThreshold = new Date(Date.now() - STALE_AFTER_MS).toISOString();
    const { data: presences, error } = await supabase
      .from('parent_presence')
      .select('*, parent:profiles(first_name, last_name, photo_url)')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_inside', true)
      .gte('updated_at', staleThreshold)
      .order('entered_at', { ascending: true });

    if (error || !presences || presences.length === 0) {
      if (!error) setCards([]);
      return;
    }

    // En la mañana los padres también entran al perímetro para dejar a sus
    // hijos — eso también prende parent_presence, pero no es una recogida.
    // Sin este filtro aparecían acá mezclados con los que sí esperan la
    // salida, confundiendo al staff. Mismo criterio que usa el botón
    // "Anunciar Llegada" del padre (PICKUP_WINDOW_START_HOUR).
    const dismissalPresences = presences.filter((p: ParentPresence) =>
      !p.entered_at || new Date(p.entered_at).getHours() >= PICKUP_WINDOW_START_HOUR
    );

    if (dismissalPresences.length === 0) {
      setCards([]);
      return;
    }

    const parentIds = dismissalPresences.map((p: ParentPresence) => p.parent_id);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [{ data: pickups }, { data: vehicles }, { data: completedToday }] = await Promise.all([
      supabase
        .from('pickup_events')
        .select('id, parent_id, door_id, students:student_id(first_name, last_name, grade, section)')
        .eq('tenant_id', profile.tenant_id)
        .in('parent_id', parentIds)
        .in('status', ['announced', 'in_queue', 'released']),
      supabase
        .from('vehicles')
        .select('parent_id, license_plate, description')
        .in('parent_id', parentIds),
      // Un padre que ya completó el ciclo de recogida hoy (confirmó que ya
      // tiene al alumno) sale del registro visual de vehículos aunque el
      // GPS todavía lo marque "dentro" mientras se retira — ya fue
      // atendido, no tiene sentido seguir mostrándolo en la cola.
      supabase
        .from('pickup_events')
        .select('parent_id')
        .eq('tenant_id', profile.tenant_id)
        .in('parent_id', parentIds)
        .eq('status', 'completed')
        .gte('completed_at', startOfDay.toISOString()),
    ]);

    const vehicleByParent = new Map((vehicles || []).map((v: any) => [v.parent_id, v]));
    const pickupsByParent = new Map<string, any[]>();
    (pickups || []).forEach((pk: any) => {
      if (!pickupsByParent.has(pk.parent_id)) pickupsByParent.set(pk.parent_id, []);
      pickupsByParent.get(pk.parent_id)!.push(pk);
    });
    const completedTodaySet = new Set((completedToday || []).map((r: any) => r.parent_id));

    const built: PerimeterCard[] = [];
    dismissalPresences.forEach((p: ParentPresence) => {
      const parentName = `${p.parent?.first_name || ''} ${p.parent?.last_name || ''}`.trim() || t('perimeter.parentFallback');
      const vehicle = (vehicleByParent.get(p.parent_id) as any) || null;
      const activePickups = pickupsByParent.get(p.parent_id) || [];

      if (activePickups.length === 0) {
        // Ya completó el ciclo hoy y no le queda ninguna recogida activa:
        // se retira del visual de vehículos, ya fue atendido.
        if (completedTodaySet.has(p.parent_id)) return;
        built.push({
          key: p.parent_id,
          parentId: p.parent_id,
          doorId: null,
          parentName,
          studentName: null,
          studentGradeSection: null,
          vehicle,
          enteredAt: p.entered_at,
        });
      } else {
        activePickups.forEach(pk => {
          const studentName = `${pk.students?.first_name || ''} ${pk.students?.last_name || ''}`.trim() || null;
          // Puede haber más de un alumno con el mismo nombre en el colegio
          // — el grado y la sección son los que dicen de qué salón es cada
          // uno, para no confundirlos.
          const grade = pk.students?.grade || '';
          const section = pk.students?.section || '';
          const studentGradeSection = grade || section ? `${grade}${grade && section ? ' · ' : ''}${section}` : null;
          built.push({
            key: pk.id,
            parentId: p.parent_id,
            doorId: pk.door_id,
            parentName,
            studentName,
            studentGradeSection,
            vehicle,
            enteredAt: p.entered_at,
          });
        });
      }
    });

    setCards(built);
  };

  useEffect(() => {
    if (!profile?.tenant_id) return;
    fetchDoors();
    fetchPresences();

    // parent_presence es la única tabla que de verdad está en la publicación
    // de Realtime de Supabase — este canal sí funciona. pickup_events no lo
    // está, así que ese segundo canal que había acá nunca recibía nada, solo
    // sumaba una conexión sin beneficio (el polling de abajo ya cubre su
    // única función real, que era refrescar por cambios de pickup_events).
    const presenceChannel = supabase
      .channel('public:parent_presence_dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parent_presence' }, () => {
        fetchPresences();
      })
      .subscribe();

    // Refresca cada 10s (igual que el resto del Dashboard) — también sirve
    // para que los que se quedaron "atascados" por más de 5 min se retiren
    // solos de la lista, sin depender de que el padre avise que se fue.
    const pollInterval = window.setInterval(fetchPresences, 10000);
    // Repinta cada 20s solo para refrescar el texto "hace X min" en pantalla.
    const tickInterval = window.setInterval(() => forceTick(t => t + 1), 20000);

    return () => {
      supabase.removeChannel(presenceChannel);
      clearInterval(pollInterval);
      clearInterval(tickInterval);
    };
  }, [profile?.tenant_id]);

  // Mismo tratamiento de prioridad que En Tránsito: dentro de cada puerta,
  // los 5 que llegaron primero en rojo, los 5 siguientes en naranja, el
  // resto en verde — banda por posición, no global entre puertas.
  const priorityClass = (index: number) => {
    if (index < 5) return { ring: 'border-rose-300 bg-rose-50', icon: 'text-rose-600' };
    if (index < 10) return { ring: 'border-amber-300 bg-amber-50', icon: 'text-amber-600' };
    return { ring: 'border-emerald-300 bg-emerald-50', icon: 'text-emerald-600' };
  };

  const doorName = (doorId: string | null) => doors.find(d => d.id === doorId)?.name || t('transit.noDoor');

  const filtered = selectedDoorId ? cards.filter(c => (c.doorId || NO_DOOR_KEY) === selectedDoorId) : cards;

  const groups: { doorKey: string; doorLabel: string; items: PerimeterCard[] }[] = selectedDoorId
    ? [{ doorKey: selectedDoorId, doorLabel: doorName(selectedDoorId === NO_DOOR_KEY ? null : selectedDoorId), items: filtered }]
    : (() => {
        const byDoor = new Map<string, PerimeterCard[]>();
        filtered.forEach(c => {
          const key = c.doorId || NO_DOOR_KEY;
          if (!byDoor.has(key)) byDoor.set(key, []);
          byDoor.get(key)!.push(c);
        });
        return Array.from(byDoor.entries()).map(([doorKey, items]) => ({
          doorKey,
          doorLabel: doorKey === NO_DOOR_KEY ? t('transit.noDoor') : doorName(doorKey),
          items,
        }));
      })();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-slate-100">
        <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider flex items-center gap-2">
          <MapPin className="w-4 h-4 text-indigo-500" /> {t('perimeter.title')}
          <span className="bg-indigo-50 text-indigo-600 text-[10px] font-black px-3 py-1 rounded-full">
            {cards.length}
          </span>
        </h3>
        <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 self-start sm:self-auto">
          <DoorOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            value={selectedDoorId}
            onChange={e => handleDoorChange(e.target.value)}
            className="bg-transparent text-[10px] font-black uppercase tracking-widest text-slate-600 outline-none"
          >
            <option value="">{t('transit.allDoors')}</option>
            {doors.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
            <option value={NO_DOOR_KEY}>{t('transit.noDoor')}</option>
          </select>
        </div>
      </div>

      <div className="bg-gradient-to-b from-emerald-50 to-slate-50 min-h-[160px] px-6 py-6">
        {cards.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-xs text-slate-400 font-medium">
            {t('perimeter.empty')}
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map(group => (
              <div key={group.doorKey}>
                {!selectedDoorId && (
                  <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                    <DoorOpen className="w-3 h-3" /> {group.doorLabel}
                    <span className="bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full">{group.items.length}</span>
                  </h4>
                )}
                <div className="flex flex-wrap gap-4">
                  {group.items.map((c, i) => {
                    const mins = minutesAgo(c.enteredAt);
                    const priority = priorityClass(i);
                    return (
                      <div
                        key={c.key}
                        className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-500 w-[92px]"
                        style={{ animationDelay: `${i * 60}ms` }}
                      >
                        <div className={`w-14 h-14 rounded-2xl shadow-md border-2 flex items-center justify-center ${priority.ring}`}>
                          <Car className={`w-7 h-7 ${priority.icon}`} />
                        </div>
                        <p className="text-[10px] font-black text-slate-700 mt-1.5 max-w-[92px] truncate text-center">
                          {c.studentName || c.parentName}
                        </p>
                        {c.studentGradeSection && (
                          <p className="text-[9px] font-black text-indigo-400 max-w-[92px] truncate text-center">{c.studentGradeSection}</p>
                        )}
                        {c.studentName && (
                          <p className="text-[9px] font-bold text-slate-400 max-w-[92px] truncate text-center">{c.parentName}</p>
                        )}
                        {c.vehicle?.license_plate && (
                          <p className="text-[9px] font-black text-indigo-500 max-w-[92px] truncate text-center">{c.vehicle.license_plate}</p>
                        )}
                        <p className="text-[9px] font-bold text-slate-400">
                          {mins <= 0 ? t('perimeter.justArrived') : t('perimeter.minutesAgoTemplate').replace('{min}', String(mins))}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
