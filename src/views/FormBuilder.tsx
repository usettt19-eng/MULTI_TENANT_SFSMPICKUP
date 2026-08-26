import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { TopNav } from '../components/TopNav';
import { useAuth } from '../contexts/AuthContext';
import { 
  FileEdit, Plus, Trash2, CheckCircle2, XCircle, 
  Send, Users, List, Loader2, ChevronRight, MessageSquare,
  AlertCircle, Save, ToggleRight, BarChart3, User, Calendar, FileText
} from 'lucide-react';

export function FormBuilder() {
  const { profile } = useAuth();
  const [forms, setForms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedForm, setSelectedForm] = useState<any>(null);
  const [responses, setResponses] = useState<any[]>([]);
  const [processing, setProcessing] = useState(false);

  // New Form State
  const [formType, setFormType] = useState<'authorization' | 'announcement'>('authorization');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetGrades, setTargetGrades] = useState<string[]>([]);
  const [questions, setQuestions] = useState<any[]>([
    { question_text: '¿Autoriza que su hijo participe en esta actividad?', question_type: 'boolean' }
  ]);

  const gradesList = ['K3', 'K4', 'K5', '1ro', '2do', '3ro', '4to', '5to', '6to', '7mo', '8vo', '9no', '10mo', '11mo', '12mo'];

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchForms();
    }
  }, [profile?.tenant_id]);

  const fetchForms = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('forms')
      .select('*, form_questions(*), form_responses(count)')
      .eq('tenant_id', profile?.tenant_id)
      .order('created_at', { ascending: false });

    if (error) console.error(error);
    else setForms(data || []);
    setLoading(false);
  };

  const fetchResults = async (form: any) => {
    setSelectedForm(form);
    setLoading(true);
    const { data, error } = await supabase
      .from('form_responses')
      .select(`
        *,
        parent:profiles!form_responses_parent_id_fkey(first_name, last_name, email),
        student:students(first_name, last_name, grade)
      `)
      .eq('form_id', form.id);

    if (error) console.error(error);
    else setResponses(data || []);
    setShowResults(true);
    setLoading(false);
  };

  const handlePrint = () => {
    const printContent = document.getElementById('printable-report');
    if (!printContent) return;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Reporte de Autorización - ${selectedForm.title}</title>
          <style>
            body { font-family: sans-serif; padding: 40px; color: #333; }
            .header { border-bottom: 3px solid #000; padding-bottom: 20px; margin-bottom: 30px; }
            h1 { margin: 0; font-size: 24px; text-transform: uppercase; }
            .stats { display: flex; gap: 40px; margin-bottom: 30px; background: #f9f9f9; padding: 20px; border-radius: 10px; }
            .stat-box { display: flex; flex-col; }
            .stat-label { font-size: 10px; font-weight: bold; color: #666; text-transform: uppercase; }
            .stat-value { font-size: 20px; font-weight: 900; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #f2f2f2; font-size: 11px; }
            td { font-size: 12px; }
            .authorized { color: green; font-weight: bold; }
            .not-authorized { color: red; font-weight: bold; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${selectedForm.form_type === 'announcement' ? 'REPORTE DE LECTURA DE AVISO' : 'REPORTE OFICIAL DE AUTORIZACIONES'}</h1>
            <p style="margin: 5px 0; font-weight: bold;">Evento: ${selectedForm.title}</p>
            <p style="margin: 0; font-size: 12px; color: #666;">Generado el: ${new Date().toLocaleString()}</p>
          </div>
          <div class="stats">
            <div class="stat-box">
              <span class="stat-label">Total Alumnos</span>
              <span class="stat-value">${responses.length}</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">${selectedForm.form_type === 'announcement' ? 'Leyeron el Aviso' : 'Autorizados (SÍ)'}</span>
              <span class="stat-value">${selectedForm.form_type === 'announcement' ? responses.length : responses.filter(r => Object.values(r.answers).includes('SI')).length}</span>
            </div>
            <div class="stat-box">
               <span class="stat-label">Grados</span>
               <span class="stat-value">${selectedForm.target_grades?.join(', ')}</span>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>ALUMNO</th>
                <th>GRADO</th>
                <th>PADRE / TUTOR</th>
                <th>${selectedForm.form_type === 'announcement' ? 'ESTADO' : 'AUTORIZACIÓN'}</th>
                <th>FECHA FIRMA</th>
              </tr>
            </thead>
            <tbody>
              ${responses.map(r => `
                <tr>
                  <td>${r.student?.first_name} ${r.student?.last_name}</td>
                  <td>${r.student?.grade}</td>
                  <td>${r.parent?.first_name} ${r.parent?.last_name}</td>
                  <td class="${selectedForm.form_type === 'announcement' || Object.values(r.answers).includes('SI') ? 'authorized' : 'not-authorized'}">
                    ${selectedForm.form_type === 'announcement' ? 'LEÍDO' : (Object.values(r.answers).includes('SI') ? 'SÍ, AUTORIZA' : 'NO AUTORIZA')}
                  </td>
                  <td>${new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="margin-top: 50px; border-top: 1px solid #ddd; padding-top: 20px; font-size: 10px; text-align: center; color: #aaa;">
            SmartPickup Security System - Reporte Digital con Validez Institucional
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (targetGrades.length === 0) return alert("Selecciona al menos un grado.");
    if (formType === 'announcement' && !description.trim()) return alert("Escribe el mensaje del aviso.");
    setProcessing(true);

    try {
      const { data: formData, error: formError } = await supabase
        .from('forms')
        .insert({
          title,
          description,
          target_grades: targetGrades,
          form_type: formType,
          tenant_id: profile?.tenant_id
        })
        .select().single();

      if (formError) throw formError;

      if (formType === 'authorization') {
        const questionsToInsert = questions.map((q, idx) => ({
          form_id: formData.id,
          question_text: q.question_text,
          question_type: q.question_type,
          order: idx
        }));

        await supabase.from('form_questions').insert(questionsToInsert);
      }
      setIsModalOpen(false);
      resetForm();
      fetchForms();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const addQuestion = () => setQuestions([...questions, { question_text: '', question_type: 'boolean' }]);
  const removeQuestion = (idx: number) => setQuestions(questions.filter((_, i) => i !== idx));
  const updateQuestion = (idx: number, text: string) => {
    const newQs = [...questions];
    newQs[idx].question_text = text;
    setQuestions(newQs);
  };

  const toggleGrade = (grade: string) => {
    setTargetGrades(prev => prev.includes(grade) ? prev.filter(g => g !== grade) : [...prev, grade]);
  };

  const resetForm = () => {
    setFormType('authorization');
    setTitle(''); setDescription(''); setTargetGrades([]);
    setQuestions([{ question_text: '¿Autoriza?', question_type: 'boolean' }]);
  };

  // Helper for stats
  const getStats = () => {
    const total = responses.length;
    const authorized = selectedForm?.form_type === 'announcement'
      ? total
      : responses.filter(r => Object.values(r.answers).includes('SI')).length;
    return { total, authorized, pending: total - authorized };
  };

  return (
    <>
      <TopNav title="SmartPickup" subtitle="Gestión de Autorizaciones" />

      <div className="p-6 max-w-7xl mx-auto space-y-8 w-full font-body animate-in fade-in duration-700">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              Constructor de Formularios <FileEdit className="w-8 h-8 text-primary" />
            </h1>
            <p className="text-sm text-slate-500 font-medium font-body">Crea autorizaciones digitales o avisos informativos, segmentados por grado.</p>
          </div>
          <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 bg-primary text-white px-6 py-4 rounded-[1.5rem] font-black text-xs hover:shadow-primary/20 transition-all shadow-xl active:scale-95 group">
            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" /> NUEVO FORMULARIO
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {forms.map(form => (
            <div key={form.id} className="bg-white rounded-[2.5rem] p-6 border border-slate-100 shadow-sm hover:shadow-xl transition-all relative overflow-hidden flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-2xl ${form.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${form.is_active ? 'bg-emerald-500 text-white' : 'bg-white text-slate-400'}`}>
                    {form.is_active ? 'Activo' : 'Cerrado'}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${form.form_type === 'announcement' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>
                    {form.form_type === 'announcement' ? 'Aviso' : 'Autorización'}
                  </span>
                </div>
              </div>
              <h3 className="text-lg font-black text-slate-900 leading-tight mb-2 truncate">{form.title}</h3>
              <div className="flex flex-wrap gap-1 mb-4">
                {form.target_grades?.map((g: string) => <span key={g} className="bg-slate-50 text-slate-400 text-[8px] font-black px-2 py-0.5 rounded border border-slate-100">{g}</span>)}
              </div>
              <div className="mt-auto pt-4 border-t border-slate-50 flex items-center justify-between">
                <div>
                   <span className="text-[10px] font-bold text-slate-400 uppercase block">Respuestas</span>
                   <span className="text-xl font-black text-primary">{form.form_responses?.[0]?.count || 0}</span>
                </div>
                <button onClick={() => fetchResults(form)} className="p-3 bg-slate-900 text-white rounded-2xl hover:bg-primary transition-all">
                   <BarChart3 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MODAL: RESULTS MONITOR */}
      {showResults && selectedForm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-[3rem] w-full max-w-5xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95">
            <div className="p-8 bg-slate-900 text-white flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-2xl font-black">{selectedForm.title}</h2>
                <div className="flex items-center gap-4 mt-1">
                  <p className="text-xs text-white/60 font-bold uppercase tracking-widest italic">{selectedForm.form_type === 'announcement' ? 'Monitor de Lectura' : 'Monitor de Autorizaciones'}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={handlePrint}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white text-white hover:text-slate-900 px-5 py-3 rounded-2xl transition-all font-black text-[10px] uppercase tracking-widest border border-white/10"
                >
                  <FileText className="w-4 h-4" /> IMPRIMIR REPORTE
                </button>
                <button onClick={() => setShowResults(false)} className="p-3 bg-white/10 hover:bg-rose-500 rounded-2xl transition-all border border-white/10 shadow-lg">
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div id="printable-report" className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50">
              {/* Stats Overview */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div className="bg-emerald-50 p-6 rounded-[2rem] border border-emerald-100">
                  <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest block mb-2">{selectedForm.form_type === 'announcement' ? 'Confirmaron Lectura' : 'Total Alumnos Autorizados'}</span>
                  <div className="flex items-end gap-2">
                    <span className="text-4xl font-black text-emerald-700">{getStats().authorized}</span>
                    <span className="text-emerald-500 font-bold mb-1">familias</span>
                  </div>
                </div>
                <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                   <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Respuestas Totales</span>
                   <div className="flex items-end gap-2">
                    <span className="text-4xl font-black text-slate-900">{getStats().total}</span>
                    <span className="text-slate-500 font-bold mb-1">registros</span>
                  </div>
                </div>
                <div className="bg-primary/5 p-6 rounded-[2rem] border border-primary/10">
                   <span className="text-[10px] font-black text-primary uppercase tracking-widest block mb-2">Tasa de Respuesta</span>
                   <div className="flex items-end gap-2">
                    <span className="text-4xl font-black text-primary">
                       {getStats().total > 0 ? Math.round((getStats().authorized / getStats().total) * 100) : 0}%
                    </span>
                    <span className="text-primary/60 font-bold mb-1 italic">exito</span>
                  </div>
                </div>
              </div>

              {/* Responder Table */}
              <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" /> Desglose de Participantes
              </h4>
              <div className="bg-white rounded-[2rem] border border-slate-100 overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Alumno / Grado</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Padre / Tutor</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 italic">{selectedForm.form_type === 'announcement' ? 'Estado' : 'Respuesta Principal'}</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {responses.map((resp, idx) => (
                      <tr key={resp.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 border-b border-slate-50">
                          <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-[10px] uppercase">{resp.student?.grade?.[0]}</div>
                             <span className="font-bold text-slate-900 text-sm">{resp.student?.first_name} {resp.student?.last_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 border-b border-slate-50">
                          <p className="font-bold text-slate-700 text-xs">{resp.parent?.first_name} {resp.parent?.last_name}</p>
                          <p className="text-[10px] text-slate-400">{resp.parent?.email}</p>
                        </td>
                        <td className="px-6 py-4 border-b border-slate-50">
                           {selectedForm.form_type === 'announcement' ? (
                             <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 w-fit">
                                <CheckCircle2 className="w-3 h-3" /> LEÍDO
                             </span>
                           ) : Object.values(resp.answers).includes('SI') ? (
                             <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 w-fit">
                                <CheckCircle2 className="w-3 h-3" /> SI, AUTORIZA
                             </span>
                           ) : (
                             <span className="bg-rose-100 text-rose-700 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 w-fit">
                                <XCircle className="w-3 h-3" /> NO AUTORIZA
                             </span>
                           )}
                        </td>
                        <td className="px-6 py-4 border-b border-slate-50 text-right">
                           <span className="text-[10px] font-bold text-slate-400">{new Date(resp.created_at).toLocaleDateString()}</span>
                        </td>
                      </tr>
                    ))}
                    {responses.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-20 text-center text-slate-400 italic">No hay respuestas registradas todavía para este formulario.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE FORM (Omitted for brevity, kept structure) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl animate-in zoom-in-95 flex flex-col">
            <div className="flex justify-between items-center p-8 bg-slate-50 border-b border-slate-100 shrink-0">
               <h2 className="text-xl font-black text-slate-900">{formType === 'announcement' ? 'Nuevo Aviso' : 'Nueva Autorización'}</h2>
               <button onClick={() => setIsModalOpen(false)} className="p-2 bg-white rounded-xl shadow-sm"><XCircle className="w-6 h-6" /></button>
            </div>
            <form onSubmit={handleSaveForm} className="p-8 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
               <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormType('authorization')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${formType === 'authorization' ? 'bg-amber-50 border-amber-400' : 'bg-slate-50 border-transparent'}`}
                  >
                    <span className="text-xs font-black text-slate-800 block">Autorización</span>
                    <span className="text-[10px] text-slate-400 font-medium">Pide una respuesta (SÍ/NO) por alumno.</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormType('announcement')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${formType === 'announcement' ? 'bg-indigo-50 border-indigo-400' : 'bg-slate-50 border-transparent'}`}
                  >
                    <span className="text-xs font-black text-slate-800 block">Aviso / Mensaje</span>
                    <span className="text-[10px] text-slate-400 font-medium">Solo informa, sin pedir respuesta.</span>
                  </button>
               </div>
               <input required placeholder="Título..." value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold shadow-inner" />
               <textarea
                 placeholder={formType === 'announcement' ? 'Escribe el mensaje que verán los padres...' : 'Descripción...'}
                 value={description}
                 onChange={e => setDescription(e.target.value)}
                 className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-medium h-24"
               />
               <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Segmentar Grados</label>
                  <div className="flex flex-wrap gap-2">
                    {gradesList.map(g => (
                      <button key={g} type="button" onClick={() => toggleGrade(g)} className={`px-3 py-1.5 rounded-xl text-[10px] font-black border-2 transition-all ${targetGrades.includes(g) ? 'bg-primary border-primary text-white shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>{g}</button>
                    ))}
                  </div>
               </div>
               {formType === 'authorization' && (
                 <div className="bg-slate-50 rounded-3xl p-6 space-y-3">
                    <div className="flex justify-between items-center mb-2"><h4 className="text-[10px] font-black text-slate-400 uppercase">Preguntas del Formulario</h4><button type="button" onClick={addQuestion} className="bg-white text-primary px-3 py-1.5 rounded-xl text-[9px] font-black border border-slate-100 shadow-sm">+ PREGUNTA</button></div>
                    {questions.map((q, idx) => (
                      <div key={idx} className="flex gap-2 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                        <input required className="flex-1 text-sm font-bold outline-none" value={q.question_text} onChange={e => updateQuestion(idx, e.target.value)} placeholder="Ej: ¿Autoriza el viaje?" />
                        {questions.length > 1 && <button type="button" onClick={() => removeQuestion(idx)} className="text-rose-500"><Trash2 className="w-4 h-4" /></button>}
                      </div>
                    ))}
                 </div>
               )}
               <button type="submit" disabled={processing} className="w-full bg-primary text-white font-black py-5 rounded-[2rem] shadow-xl text-xs uppercase tracking-widest disabled:opacity-50">
                 {formType === 'announcement' ? 'ENVIAR AVISO' : 'LANZAR FORMULARIO'}
               </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
