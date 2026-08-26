import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { Loader2, Search, User, Printer } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function VisitorsLog() {
  const { profile } = useAuth() as any;
  const [visitors, setVisitors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchVisitors();
  }, [profile?.tenant_id]);

  const fetchVisitors = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('daily_visitors')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .order('check_in_time', { ascending: false });

    if (error) console.error('Error fetching visitors:', error);
    else setVisitors(data || []);
    setLoading(false);
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.text('Resumen de Visitantes del Día', 14, 15);
    
    const tableData = filteredVisitors.map(v => [
      v.visitor_name,
      v.id_number || '—',
      v.company || '—',
      v.visiting_whom,
      v.reason,
      new Date(v.check_in_time).toLocaleString()
    ]);

    autoTable(doc, {
      head: [['Visitante', 'Identificación', 'Empresa', 'Visita a', 'Motivo', 'Hora de Entrada']],
      body: tableData,
      startY: 20,
    });

    doc.save(`visitantes_${new Date().toLocaleDateString()}.pdf`);
  };

  const filteredVisitors = visitors.filter(v =>
    v.visitor_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.visiting_whom.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      <TopNav title="SafePickup" subtitle="Registro de Visitantes" />
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-black text-slate-800">Bitácora de Visitantes</h1>
          <div className="flex gap-3">
            <div className="relative">
              <input
                type="text"
                placeholder="Buscar visitante..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none w-64 shadow-sm"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
            <button 
              onClick={exportToPDF}
              className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary/90 transition-all"
            >
              <Printer className="w-4 h-4" /> Exportar PDF
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center"><Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" /></div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-400 font-black text-[10px] uppercase tracking-widest">
                <tr>
                  <th className="p-4">Visitante</th>
                  <th className="p-4">Identificación</th>
                  <th className="p-4">Empresa</th>
                  <th className="p-4">Visita a</th>
                  <th className="p-4">Motivo</th>
                  <th className="p-4">Hora de Entrada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredVisitors.map(v => (
                  <tr key={v.id} className="hover:bg-slate-50/50">
                    <td className="p-4 font-bold text-slate-900 flex items-center gap-2"><User className="w-4 h-4 text-slate-400" /> {v.visitor_name}</td>
                    <td className="p-4 text-slate-500 font-mono">{v.id_number || '—'}</td>
                    <td className="p-4 text-slate-600">{v.company || '—'}</td>
                    <td className="p-4 text-slate-600">{v.visiting_whom}</td>
                    <td className="p-4 text-slate-500">{v.reason}</td>
                    <td className="p-4 text-slate-500 font-mono">{new Date(v.check_in_time).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
