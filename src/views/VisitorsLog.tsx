import React, { useState, useEffect } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import { Loader2, Search, User, Printer, LogOut, Pencil, Check, X } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Formato que espera <input type="datetime-local">, en hora local (no UTC).
const toDatetimeLocalValue = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// Formato que espera <input type="date">, en hora local.
const toDateOnlyValue = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export function VisitorsLog() {
  const { profile } = useAuth() as any;
  const [visitors, setVisitors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  // Día que se está viendo/exportando — por defecto hoy. Antes la bitácora
  // traía TODO el historial sin filtro de fecha, lo que además de no dejar
  // elegir un día para el PDF, iba a crecer sin límite en la pantalla.
  const [selectedDate, setSelectedDate] = useState(() => toDateOnlyValue(new Date()));
  // Edición de la hora de salida: se puede registrar de un clic (hora
  // actual) o corregir a mano si el personal olvidó marcarla al momento.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    fetchVisitors();
  }, [profile?.tenant_id, selectedDate]);

  const fetchVisitors = async () => {
    if (!profile?.tenant_id || !selectedDate) return;
    setLoading(true);
    // Límites del día elegido en hora LOCAL del navegador (no UTC), para que
    // "el 13 de agosto" filtre por el día real que vivió el colegio.
    const dayStart = new Date(`${selectedDate}T00:00:00`);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const { data, error } = await supabase
      .from('daily_visitors')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .gte('check_in_time', dayStart.toISOString())
      .lt('check_in_time', dayEnd.toISOString())
      .order('check_in_time', { ascending: false });

    if (error) console.error('Error fetching visitors:', error);
    else setVisitors(data || []);
    setLoading(false);
  };

  const saveCheckOutTime = async (visitorId: string, isoValue: string, visitorName: string) => {
    setSavingId(visitorId);
    const { error } = await supabase
      .from('daily_visitors')
      .update({ check_out_time: isoValue })
      .eq('id', visitorId);

    if (error) {
      console.error('Error registrando hora de salida:', error);
      alert('No se pudo guardar la hora de salida.');
    } else {
      setVisitors(prev => prev.map(v => (v.id === visitorId ? { ...v, check_out_time: isoValue } : v)));
      await logActivity(
        'VISITOR',
        `Hora de salida registrada para el visitante ${visitorName}.`,
        profile?.first_name,
        { visitor_id: visitorId },
        profile?.tenant_id
      );
    }
    setSavingId(null);
    setEditingId(null);
  };

  // Un clic registra "ahora" como hora de salida — el caso normal, cuando el
  // visitante se está retirando en ese momento.
  const handleRegisterCheckoutNow = (v: any) => {
    saveCheckOutTime(v.id, new Date().toISOString(), v.visitor_name);
  };

  const handleStartEdit = (v: any) => {
    setEditingId(v.id);
    setEditValue(toDatetimeLocalValue(v.check_out_time ? new Date(v.check_out_time) : new Date()));
  };

  const handleSaveEdit = (v: any) => {
    if (!editValue) return;
    saveCheckOutTime(v.id, new Date(editValue).toISOString(), v.visitor_name);
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    const dayLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString();
    doc.text(`Resumen de Visitantes — ${dayLabel}`, 14, 15);

    const tableData = filteredVisitors.map(v => [
      v.visitor_name,
      v.id_number || '—',
      v.company || '—',
      v.visiting_whom,
      v.reason,
      new Date(v.check_in_time).toLocaleString(),
      v.check_out_time ? new Date(v.check_out_time).toLocaleString() : '—'
    ]);

    autoTable(doc, {
      head: [['Visitante', 'Identificación', 'Empresa', 'Visita a', 'Motivo', 'Hora de Entrada', 'Hora de Salida']],
      body: tableData,
      startY: 20,
    });

    doc.save(`visitantes_${selectedDate}.pdf`);
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
          <div className="flex flex-wrap gap-3">
            <input
              type="date"
              value={selectedDate}
              max={toDateOnlyValue(new Date())}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none shadow-sm"
            />
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
                  <th className="p-4">Hora de Salida</th>
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
                    <td className="p-4 text-slate-500 font-mono">
                      {editingId === v.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="datetime-local"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none"
                          />
                          <button
                            onClick={() => handleSaveEdit(v)}
                            disabled={savingId === v.id}
                            className="p-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
                            title="Guardar"
                          >
                            {savingId === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
                            title="Cancelar"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : v.check_out_time ? (
                        <div className="flex items-center gap-2">
                          <span>{new Date(v.check_out_time).toLocaleString()}</span>
                          <button
                            onClick={() => handleStartEdit(v)}
                            className="p-1 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-100"
                            title="Corregir hora de salida"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleRegisterCheckoutNow(v)}
                          disabled={savingId === v.id}
                          className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-3 py-1.5 rounded-lg text-xs disabled:opacity-50"
                        >
                          {savingId === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                          Registrar salida
                        </button>
                      )}
                    </td>
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
