import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { useLanguage } from '../contexts/LanguageContext';
import { School, User, ShieldCheck, Car } from 'lucide-react';
import { getReplacementNameFromNotes, formatAnnouncedAt } from '../lib/pickupHelpers';

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
 * Pensada para el caso de un staff nuevo sin nada asignado todavía: antes
 * solo tenía Monitor Externo (que le mostraba a TODO el colegio) como única
 * opción para ver llegadas — acá no ve nada hasta que de verdad le asignen
 * un grado/sección en Ajustes → Horario de Salida.
 */
export function MyClassroom() {
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const [pickups, setPickups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('pickup_events')
      .select('*, students:student_id(*), profiles:parent_id(*, vehicles(*))')
      .in('id', eventIds)
      .in('status', ['announced', 'in_queue'])
      .order('announced_at', { ascending: true });

    if (error) console.error('Error cargando mis llegadas:', error);
    if (data) setPickups(data);
    setLoading(false);
  };

  const fetchRef = useRef(fetchMyPickups);
  fetchRef.current = fetchMyPickups;

  useEffect(() => {
    if (!profile?.tenant_id || !profile?.id) return;
    fetchMyPickups();

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

    const pollInterval = window.setInterval(() => fetchRef.current(), 10000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.tenant_id, profile?.id]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      <TopNav title={t('myClassroom.title')} subtitle={t('myClassroom.subtitle')} />

      <div className="p-6 max-w-6xl mx-auto w-full space-y-6 animate-in slide-in-from-bottom-4">
        <header>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            {t('myClassroom.title')} <School className="w-8 h-8 text-indigo-600" />
          </h1>
          <p className="text-sm text-slate-500 font-medium mt-1">{t('myClassroom.subtitle')}</p>
        </header>

        {loading ? (
          <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>
        ) : pickups.length === 0 ? (
          <div className="bg-white rounded-[2.5rem] p-16 text-center shadow-sm border border-slate-100">
            <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <School className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-xl font-black text-slate-800">{t('myClassroom.emptyTitle')}</h3>
            <p className="text-slate-400 font-medium mt-2">{t('myClassroom.emptySubtitle')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pickups.map((pickup: any) => {
              const replacementName = getReplacementNameFromNotes(pickup.notes);
              const isReplacement = !!replacementName;
              const adultName = isReplacement
                ? replacementName
                : `${pickup.profiles?.first_name || ''} ${pickup.profiles?.last_name || ''}`.trim();
              const vehicle = !isReplacement ? pickup.profiles?.vehicles?.[0] : null;

              return (
                <div key={pickup.id} className="bg-white rounded-[2rem] p-5 shadow-sm border-2 border-indigo-100 bg-indigo-50/20 relative overflow-hidden">
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
        )}
      </div>
    </div>
  );
}
