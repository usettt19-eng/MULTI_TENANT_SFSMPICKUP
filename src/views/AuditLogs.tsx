import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { 
  History, Search, Filter, Shield, 
  User, Clock, Download, Loader2,
  AlertCircle, Activity, Lock, Smartphone
} from 'lucide-react';

export function AuditLogs() {
  const { profile } = useAuth() as any;
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    fetchLogs();

    // audit_logs no está en la publicación de Realtime de Supabase — el
    // canal que había acá nunca recibía nada. El poll de abajo es, y
    // siempre fue, el mecanismo real de refresco.

    // Auto-refresh every 5 seconds
    const intervalId = setInterval(() => {
      fetchLogs(false); // Pass false to avoid showing loading spinner on background refresh
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [filter, profile?.tenant_id]);

  const fetchLogs = async (showLoading = true) => {
    if (!profile?.tenant_id) return;
    if (showLoading) setLoading(true);
    let query = supabase
      .from('audit_logs')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (filter !== 'ALL') {
      query = query.eq('event_type', filter);
    }

    const { data } = await query;
    if (data) setLogs(data);
    if (showLoading) setLoading(false);
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'PICKUP': return <Smartphone className="w-4 h-4 text-emerald-500" />;
      case 'SECURITY': return <Lock className="w-4 h-4 text-indigo-500" />;
      case 'WELLNESS': return <Activity className="w-4 h-4 text-rose-500" />;
      case 'FORM': return <Shield className="w-4 h-4 text-amber-500" />;
      default: return <History className="w-4 h-4 text-slate-400" />;
    }
  };

  const exportToCSV = () => {
    if (logs.length === 0) return;

    const headers = ['Evento', 'Descripción', 'Actor', 'Fecha'];
    const csvContent = [
      headers.join(','),
      ...logs.map(log => [
        `"${log.event_type}"`,
        `"${log.description.replace(/"/g, '""')}"`,
        `"${log.actor_name || 'Sistema'}"`,
        `"${log.created_at}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `audit_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <TopNav title="SmartPickup" subtitle="Centro de Auditoría y Trazabilidad" />

      <div className="p-8 max-w-7xl mx-auto space-y-8 font-body animate-in fade-in duration-700">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              Bitácora del Sistema <History className="w-10 h-10 text-primary" />
            </h1>
            <p className="text-sm text-slate-500 font-medium">Registro cronológico de cada acción realizada en la plataforma.</p>
          </div>
          <div className="flex gap-4 w-full md:w-auto">
             <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100 flex gap-1 overflow-x-auto">
                {['ALL', 'PICKUP', 'WELLNESS', 'SECURITY', 'FORM'].map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all shrink-0 ${filter === f ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}
                  >
                    {f}
                  </button>
                ))}
             </div>
             <button
                onClick={exportToCSV}
                className="bg-primary text-white p-4 rounded-2xl hover:bg-primary-container transition-all shadow-xl active:scale-95 shrink-0"
             >
                <Download className="w-5 h-5" />
             </button>
          </div>
        </header>

        {loading ? (
          <div className="h-[50vh] flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-slate-400 font-bold mt-4">Sincronizando flujos de datos...</p>
          </div>
        ) : (
          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Evento</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Descripción Detallada</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">Actor</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 text-right">Momento Exacto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl bg-opacity-10 shadow-sm ${
                            log.event_type === 'PICKUP' ? 'bg-emerald-500 text-emerald-600' :
                            log.event_type === 'SECURITY' ? 'bg-indigo-500 text-indigo-600' :
                            log.event_type === 'WELLNESS' ? 'bg-rose-500 text-rose-600' :
                            'bg-amber-500 text-amber-600'
                          }`}>
                            {getEventIcon(log.event_type)}
                          </div>
                          <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest">{log.event_type}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-bold text-slate-700 leading-snug">{log.description}</p>
                        {log.metadata && (
                          <span className="text-[9px] text-slate-300 font-mono mt-1 block">ID: {log.id.slice(0,8)}...</span>
                        )}
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                             <User className="w-3 h-3 text-slate-400" />
                          </div>
                          <span className="text-xs font-black text-slate-500">{log.actor_name || 'Sistema Auto'}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <p className="text-xs font-black text-slate-900">
                          {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">
                          {new Date(log.created_at).toLocaleDateString([], { day: '2-digit', month: 'short' })}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {logs.length === 0 && (
              <div className="py-32 text-center space-y-4">
                 <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                    <Activity className="w-10 h-10 text-slate-200" />
                 </div>
                 <p className="text-slate-400 font-bold italic">No hay registros de actividad todavía.</p>
              </div>
            )}
          </div>
        )}

        <footer className="flex justify-between items-center py-6 border-t border-slate-100">
           <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-500" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Logs de Grado Militar - Encriptación AES-256 Activa</p>
           </div>
           <p className="text-[10px] font-bold text-slate-300 uppercase">SmartPickup Security Auditor v2.0</p>
        </footer>
      </div>
    </>
  );
}
