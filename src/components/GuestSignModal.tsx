import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { X, Loader2, User, Users, Calendar, Clock } from 'lucide-react';

interface GuestSignModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function GuestSignModal({ onClose, onSuccess }: GuestSignModalProps) {
  const { profile } = useAuth();
  const [visitorName, setVisitorName] = useState('');
  const [visitingWhom, setVisitingWhom] = useState('');
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);

    try {
      const { error } = await supabase.from('daily_visitors').insert({
        visitor_name: visitorName,
        visiting_whom: visitingWhom,
        reason: reason,
        check_in_time: new Date().toISOString(),
        tenant_id: profile?.tenant_id
      });

      if (error) throw error;
      onSuccess();
      onClose();
    } catch (error: any) {
      alert("Error al registrar visitante: " + error.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-black text-slate-800 uppercase">Registro de Visitante</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Nombre del Visitante</label>
            <input required value={visitorName} onChange={e => setVisitorName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">¿A quién visita?</label>
            <input required value={visitingWhom} onChange={e => setVisitingWhom(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Motivo</label>
            <input required value={reason} onChange={e => setReason(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button type="submit" disabled={processing} className="w-full bg-[#1e293b] text-white py-2 rounded-lg font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50">
            {processing ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Registrar Entrada'}
          </button>
        </form>
      </div>
    </div>
  );
}
