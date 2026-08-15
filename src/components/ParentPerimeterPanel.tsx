import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Car, MapPin } from 'lucide-react';
import type { ParentPresence } from '../types/database';

// No se guarda ni se muestra ninguna coordenada GPS real: esto es una
// representación estilizada (una "escena" del colegio con carritos), no un
// mapa. Solo usamos el booleano dentro/fuera + hace cuánto entró.
const STALE_AFTER_MS = 5 * 60 * 1000; // si no se actualiza en 5 min, se considera que ya no está

function minutesAgo(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export function ParentPerimeterPanel() {
  const { profile } = useAuth() as any;
  const [presences, setPresences] = useState<ParentPresence[]>([]);
  const [, forceTick] = useState(0);

  const fetchPresences = async () => {
    if (!profile?.tenant_id) return;
    const staleThreshold = new Date(Date.now() - STALE_AFTER_MS).toISOString();
    const { data, error } = await supabase
      .from('parent_presence')
      .select('*, parent:profiles(first_name, last_name, photo_url)')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_inside', true)
      .gte('updated_at', staleThreshold)
      .order('entered_at', { ascending: true });
    if (!error) setPresences(data || []);
  };

  useEffect(() => {
    fetchPresences();

    const channel = supabase
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
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
      clearInterval(tickInterval);
    };
  }, [profile?.tenant_id]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-5 flex justify-between items-center border-b border-slate-100">
        <h3 className="text-[12px] font-black text-[#1e293b] uppercase tracking-wider flex items-center gap-2">
          <MapPin className="w-4 h-4 text-indigo-500" /> Padres en el Perímetro
        </h3>
        <span className="bg-indigo-50 text-indigo-600 text-[10px] font-black px-3 py-1 rounded-full">
          {presences.length}
        </span>
      </div>

      <div className="relative bg-gradient-to-b from-emerald-50 to-slate-50 min-h-[160px] px-6 py-6 overflow-hidden">
        {/* Escena estilizada del colegio -- no es un mapa real */}
        <div className="absolute inset-x-0 bottom-0 h-10 bg-slate-300/40" />
        <div className="absolute inset-x-0 bottom-4 border-t-2 border-dashed border-white/70" />
        <div className="absolute left-1/2 -translate-x-1/2 bottom-6 bg-slate-800 text-white text-[9px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full shadow-lg">
          Entrada del Colegio
        </div>

        {presences.length === 0 ? (
          <div className="relative flex items-center justify-center h-24 text-xs text-slate-400 font-medium">
            No hay padres dentro del perímetro por ahora.
          </div>
        ) : (
          <div className="relative flex flex-wrap gap-4 justify-center pt-2 pb-14">
            {presences.map((p, i) => {
              const name = `${p.parent?.first_name || ''} ${p.parent?.last_name || ''}`.trim() || 'Padre/Tutor';
              const mins = minutesAgo(p.entered_at);
              return (
                <div
                  key={p.parent_id}
                  className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-500"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="w-14 h-14 rounded-2xl bg-white shadow-md border border-slate-100 flex items-center justify-center">
                    <Car className="w-7 h-7 text-indigo-500" />
                  </div>
                  <p className="text-[10px] font-black text-slate-700 mt-1.5 max-w-[80px] truncate text-center">{name}</p>
                  <p className="text-[9px] font-bold text-slate-400">
                    {mins <= 0 ? 'recién llegó' : `hace ${mins} min`}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
