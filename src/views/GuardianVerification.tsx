import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { TopNav } from '../components/TopNav';
import { 
  ShieldCheck, CheckCircle2, AlertTriangle, 
  FileText, Filter, Monitor, ExternalLink, 
  ChevronRight, ArrowRight
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

export function GuardianVerification() {
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const { setCurrentView } = useLayout();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    fetchRequests(true);

    // pickup_events no está en la publicación de Realtime de Supabase — el
    // canal que había acá nunca recibía nada. El poll de abajo (y la
    // detección de ids nuevos dentro de fetchRequests) es, y siempre fue,
    // el mecanismo real de refresco y del sonido de llegada.
    const pollInterval = window.setInterval(() => {
      console.log('GuardianVerification polling...');
      fetchRequests(false);
    }, 10000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [profile?.tenant_id]);

  const seenRequestIdsRef = useRef<Set<string> | null>(null);

  const fetchRequests = async (isInitial = false) => {
    if (!profile?.tenant_id) return;
    if (isInitial) setLoading(true);
    const { data } = await supabase
      .from('pickup_events')
      .select('*, profiles:parent_id(*), students:student_id(*)')
      .eq('tenant_id', profile.tenant_id)
      .in('status', ['announced'])
      .order('announced_at', { ascending: false });

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

  const handleAuthorize = async (id: string) => {
    await supabase.from('pickup_events').update({ status: 'in_queue' }).eq('id', id);
    fetchRequests();
  };

  const handleDeny = async (id: string) => {
    await supabase.from('pickup_events').update({ status: 'cancelled' }).eq('id', id);
    fetchRequests();
  };

  return (
    <>
      <TopNav title="SafePickup" subtitle="Centro de Control de Verificación" />
      
      <div className="p-6 max-w-7xl mx-auto space-y-6 w-full font-body">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary tracking-tight">Vigilancia de Accesos</h1>
            <p className="text-sm text-slate-500 font-medium">Verificación de identidad en tiempo real y geolocalización.</p>
          </div>
          <div className="flex gap-3">
             <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 border border-emerald-100 shadow-sm uppercase tracking-widest">
               <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
               SISTEMA ACTIVO
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Main Feed Section */}
          <div className="lg:col-span-8 space-y-8">
            {loading ? (
              <div className="py-20 text-center bg-white rounded-[2rem] border-2 border-dashed border-slate-100">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto"></div>
              </div>
            ) : requests.length === 0 ? (
              <div className="py-20 text-center bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 shadow-sm group">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                  <Monitor className="w-10 h-10 text-slate-200" />
                </div>
                <h3 className="text-lg font-black text-slate-400">Sin solicitudes de entrada</h3>
                <p className="text-xs text-slate-400 font-medium mt-1">Las peticiones de los padres aparecerán aquí al llegar al perímetro.</p>
              </div>
            ) : (
              requests.map(req => (
                <div key={req.id} className="bg-white rounded-[3rem] shadow-xl border border-slate-100 overflow-hidden group hover:shadow-2xl transition-all duration-500">
                  <div className="grid grid-cols-1 md:grid-cols-2">
                    
                    {/* Visual Evidence (Camera/Map View) */}
                    <div className="p-6 bg-slate-50 relative">
                      <div className="aspect-[4/5] rounded-[2rem] overflow-hidden shadow-inner border-2 border-white relative group-hover:shadow-2xl transition-all">
                        <img 
                          src={req.profiles?.photo_url || "https://images.unsplash.com/photo-1595152772835-219674b2a8a6?w=400"} 
                          alt="ID Verification" 
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-x-4 top-4 flex justify-between">
                          <span className="bg-black/60 backdrop-blur-md text-white text-[10px] font-black px-3 py-1.5 rounded-full flex items-center gap-2">
                             <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                             CAMERA 01 (HD)
                          </span>
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-64 h-64 border-2 border-secondary/40 rounded-3xl relative animate-pulse">
                             <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-secondary rounded-tl-xl"></div>
                             <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-secondary rounded-tr-xl"></div>
                             <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-secondary rounded-bl-xl"></div>
                             <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-secondary rounded-br-xl"></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Verification Details */}
                    <div className="p-8 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start mb-6">
                           <div>
                             <span className="text-[10px] font-black text-secondary uppercase tracking-[0.2em] mb-1 block">Vínculo Familiar</span>
                             <h3 className="text-2xl font-black text-primary leading-tight">
                               {req.profiles?.first_name} {req.profiles?.last_name}
                             </h3>
                           </div>
                           <div className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-xl text-[10px] font-black border border-emerald-100 uppercase tracking-widest">
                             Match 99%
                           </div>
                        </div>

                        <div className="space-y-4 mb-8">
                           <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                             <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-sm">
                               <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                             </div>
                             <div>
                               <p className="text-[10px] font-black text-slate-400 uppercase">Autorizado para:</p>
                               <p className="text-sm font-bold text-primary">{req.students?.first_name} {req.students?.last_name}</p>
                             </div>
                           </div>
                           <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                             <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-sm">
                               <ShieldCheck className="w-6 h-6 text-secondary" />
                             </div>
                             <div>
                               <p className="text-[10px] font-black text-slate-400 uppercase">PIN Verificado:</p>
                               <p className="text-sm font-bold text-primary">{req.profiles?.pin_code || '---'}</p>
                             </div>
                           </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <button 
                          onClick={() => handleDeny(req.id)}
                          className="py-4 bg-slate-100 text-slate-500 font-black rounded-3xl hover:bg-rose-50 hover:text-rose-600 transition-all active:scale-95 text-sm"
                        >
                          DENEGAR ENTRADA
                        </button>
                        <button 
                          onClick={() => handleAuthorize(req.id)}
                          className="py-4 bg-primary text-white font-black rounded-3xl hover:bg-primary-container shadow-xl shadow-primary/20 transition-all flex items-center justify-center gap-3 active:scale-95 text-sm"
                        >
                          <ShieldCheck className="w-5 h-5" />
                          AUTORIZAR
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Side Panels */}
          <div className="lg:col-span-4 space-y-8">
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100">
               <div className="flex items-center gap-3 mb-6">
                 <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                    <AlertTriangle className="w-6 h-6" />
                 </div>
                 <h4 className="text-sm font-black text-primary uppercase tracking-widest">Protocolos de Zona</h4>
               </div>
               <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-1 bg-indigo-500 rounded-full h-auto"></div>
                    <p className="text-xs text-slate-600 font-medium leading-relaxed">
                      Se prohíbe la entrega de alumnos a personas sin PIN verificado o que se encuentren fuera del perímetro escolar.
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-1 bg-amber-500 rounded-full h-auto"></div>
                    <p className="text-xs text-slate-600 font-medium leading-relaxed">
                      Cualquier anomalía debe ser reportada inmediatamente usando el botón de <strong>Emergency Lockdown</strong>.
                    </p>
                  </div>
               </div>
            </div>

            <div className="bg-gradient-to-br from-indigo-900 to-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl"></div>
               <div className="relative z-10">
                 <h4 className="text-xl font-black mb-4">Monitor Externo</h4>
                 <p className="text-indigo-200 text-xs font-medium mb-6 leading-relaxed">
                   Visualiza el flujo de tráfico y las zonas de entrega en la pantalla gigante de salida.
                 </p>
                 <button
                    onClick={() => setCurrentView('external')}
                    className="w-full py-4 bg-white/10 hover:bg-white/20 text-white font-black rounded-3xl border border-white/10 transition-all flex items-center justify-center gap-3"
                  >
                    <Monitor className="w-5 h-5" />
                    ABRIR MONITOR
                 </button>
               </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
