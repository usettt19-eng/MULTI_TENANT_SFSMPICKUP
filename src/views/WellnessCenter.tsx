import {apiFetch} from '../lib/apiFetch';
import React, { useState, useEffect } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TopNav } from '../components/TopNav';
import {
  Heart, AlertTriangle, ShieldCheck, Clock, CheckCircle2,
  Thermometer, Moon, Coffee, Plus, Loader2, Info, ChevronRight,
  Stethoscope, Activity, X, User, AlertCircle, Syringe, ToggleLeft, ToggleRight
} from 'lucide-react';
import { Medication, MedicationAlert } from '../types/database';

export function WellnessCenter() {
  const { profile } = useAuth();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [meds, setMeds] = useState<any[]>([]);
  const [criticalMeds, setCriticalMeds] = useState<Medication[]>([]);
  const [medAlerts, setMedAlerts] = useState<MedicationAlert[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [summary, setSummary] = useState({ incidents: 0, medsDone: 0, criticalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  // States for Incident Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [incidentType, setIncidentType] = useState('Caída');
  const [incidentDesc, setIncidentDesc] = useState('');
  const [isSavingIncident, setIsSavingIncident] = useState(false);

  // States for Medication Modal
  const [isMedModalOpen, setIsMedModalOpen] = useState(false);
  const [isSavingMedication, setIsSavingMedication] = useState(false);
  const [medForm, setMedForm] = useState({
    student_id: '',
    medication_name: '',
    dosage: '',
    frequency: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    is_critical: false,
    critical_reason: '',
    notes: '',
    prescribed_by: ''
  });

  // States for Medical Record Modal
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [selectedRecordStudent, setSelectedRecordStudent] = useState<any | null>(null);
  const [studentIncidents, setStudentIncidents] = useState<any[]>([]);
  const [editingIncidentId, setEditingIncidentId] = useState<string | null>(null);
  const [evolutionText, setEvolutionText] = useState('');
  const [isSavingEvolution, setIsSavingEvolution] = useState(false);

  useEffect(() => {
    fetchWellnessData();
    fetchStudents();
    fetchCriticalMedications();
  }, []);

  const fetchStudents = async () => {
    const { data } = await supabase.from('students').select('*').order('first_name');
    if (data) setStudents(data);
  };

  const fetchCriticalMedications = async () => {
    try {
      // Fetch critical medications from medication_schedule table
      const { data: criticalData, error } = await supabase
        .from('medication_schedule')
        .select(`
          *,
          students (
            id,
            first_name,
            last_name,
            grade,
            photo_url
          )
        `)
        .eq('is_critical', true);

      if (error) throw error;
      setCriticalMeds(criticalData || []);
      setSummary(prev => ({ ...prev, criticalCount: criticalData?.length || 0 }));
    } catch (err) {
      console.error('Error fetching critical medications:', err);
    }
  };

  const fetchWellnessData = async () => {
    setLoading(true);
    try {
      const { data: alertsData } = await supabase
        .from('health_alerts')
        .select('*, students(first_name, last_name, grade, photo_url)')
        .order('severity', { ascending: false });

      const today = new Date();
      today.setHours(0,0,0,0);
      const { data: medsData } = await supabase
        .from('medication_schedule')
        .select('*, students(first_name, last_name)')
        .gte('scheduled_time', today.toISOString())
        .order('scheduled_time', { ascending: true });

      // 3. Fetch Recent Wellness Logs
      const { data: logsData } = await supabase
        .from('wellness_logs')
        .select('*, students(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(5);

      // 4. Fetch Recent Incidents
      const { data: recentIncidents } = await supabase
        .from('student_incidents')
        .select('*, students(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(5);

      // Combine and sort both lists chronologically
      const combined = [
        ...(logsData || []).map(l => ({ ...l, entryType: 'log' })),
        ...(recentIncidents || []).map(i => ({ ...i, entryType: 'incident' }))
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      // 5. Totals for today
      const { count: incidentCount } = await supabase
        .from('student_incidents')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString());
      
      const medsDoneCount = medsData?.filter(m => m.status === 'administered').length || 0;
      
      setAlerts(alertsData || []);
      setMeds(medsData || []);
      setLogs(combined.slice(0, 10)); // Top 10 combined
      setSummary({ incidents: incidentCount || 0, medsDone: medsDoneCount });
    } catch (err) {
      console.error("Error loading wellness data:", err);
    } finally {
      setLoading(false);
    }
  };

  const markMedAsDone = async (medId: string) => {
    setProcessing(medId);
    const med = meds.find(m => m.id === medId);
    const { error } = await supabase
      .from('medication_schedule')
      .update({ 
        status: 'administered', 
        administered_at: new Date().toISOString() 
      })
      .eq('id', medId);

    if (error) {
      alert("Error al registrar: " + error.message);
    } else {
      await logActivity(
        'WELLNESS', 
        `MEDICAMENTO ADMINISTRADO: ${med?.medication_name} (${med?.dosage}) entregado a ${med?.students?.first_name}.`,
        'Enfermería',
        {},
        med?.students?.tenant_id
      );
      fetchWellnessData();
    }
    setProcessing(null);
  };

  const handleSaveIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId) return alert("Selecciona un alumno.");

    setIsSavingIncident(true);
    
    try {
      const response = await apiFetch('/api/wellness/incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: selectedStudentId,
          type: incidentType,
          description: incidentDesc,
          tenant_id: profile?.tenant_id
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al guardar el incidente');
      }

      setIsModalOpen(false);
      setIncidentDesc('');
      setSelectedStudentId('');
      fetchWellnessData();
    } catch (error: any) {
      console.error("Error saving incident:", error);
      alert("Error al guardar: " + error.message);
    }
    
    setIsSavingIncident(false);
  };

  const handleSaveMedication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medForm.student_id || !medForm.medication_name || !medForm.dosage) {
      return alert("Completa los campos requeridos.");
    }

    setIsSavingMedication(true);
    const student = students.find(s => s.id === medForm.student_id);

    // Insert into medication_schedule table with critical flag
    const { error } = await supabase
      .from('medication_schedule')
      .insert({
        student_id: medForm.student_id,
        medication_name: medForm.medication_name,
        dosage: medForm.dosage,
        frequency: medForm.frequency,
        scheduled_time: new Date(medForm.start_date).toISOString(),
        notes: medForm.notes,
        is_critical: medForm.is_critical,
        critical_reason: medForm.is_critical ? medForm.critical_reason : null,
        tenant_id: profile?.tenant_id
      });

    if (error) {
      alert("Error al guardar: " + error.message);
    } else {
      await logActivity(
        'WELLNESS',
        `MEDICAMENTO AGREGADO: ${medForm.medication_name} (${medForm.dosage}) para ${student?.first_name} ${student?.last_name}. ${medForm.is_critical ? 'CRÍTICO' : ''}`,
        'Enfermería',
        { critical: medForm.is_critical },
        student?.tenant_id
      );

      // Reset form and close modal
      setIsMedModalOpen(false);
      setMedForm({
        student_id: '',
        medication_name: '',
        dosage: '',
        frequency: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: '',
        is_critical: false,
        critical_reason: '',
        notes: '',
        prescribed_by: ''
      });

      fetchWellnessData();
      fetchCriticalMedications();
    }
    setIsSavingMedication(false);
  };

  const toggleMedicationCritical = async (medId: string, currentStatus: boolean) => {
    setProcessing(medId);
    const med = meds.find(m => m.id === medId);
    const newStatus = !currentStatus;

    const { error } = await supabase
      .from('medication_schedule')
      .update({
        is_critical: newStatus,
        critical_reason: newStatus ? 'Marcado como crítico por enfermería' : null
      })
      .eq('id', medId);

    if (error) {
      alert("Error al actualizar: " + error.message);
    } else {
      await logActivity(
        'WELLNESS',
        `MEDICAMENTO ${newStatus ? 'CRÍTICO' : 'NO CRÍTICO'}: ${med?.medication_name} (${med?.dosage})`,
        'Enfermería',
        { critical: newStatus },
        med?.students?.tenant_id
      );
      fetchWellnessData();
      fetchCriticalMedications();
    }
    setProcessing(null);
  };

  const fetchStudentIncidents = async (studentId: string) => {
    const { data } = await supabase
      .from('student_incidents')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });
    
    if (data) setStudentIncidents(data);
  };

  const handleStudentSelectForRecord = (studentId: string) => {
    const student = students.find(s => s.id === studentId);
    setSelectedRecordStudent(student || null);
    if (student) {
      fetchStudentIncidents(student.id);
    } else {
      setStudentIncidents([]);
    }
  };

  const handleSaveEvolution = async (incidentId: string) => {
    if (!evolutionText.trim()) return;
    setIsSavingEvolution(true);

    try {
      const response = await apiFetch(`/api/wellness/incident/${incidentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evolution: evolutionText })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al guardar la evolución');
      }

      setEvolutionText('');
      setEditingIncidentId(null);
      if (selectedRecordStudent) {
        fetchStudentIncidents(selectedRecordStudent.id);
      }
      fetchWellnessData(); // Refresh main dashboard too
    } catch (error: any) {
      alert("Error al guardar evolución: " + error.message);
    }
    
    setIsSavingEvolution(false);
  };

  return (
    <>
      <TopNav title="SmartPickup" subtitle="Centro de Bienestar Estudiantil" />

      <div className="p-6 max-w-7xl mx-auto space-y-8 w-full font-body animate-in fade-in duration-700">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              Centro de Bienestar <Activity className="w-8 h-8 text-indigo-500" />
            </h1>
            <p className="text-sm text-slate-500 font-medium">Monitorea alergias, medicamentos y registros diarios.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setIsRecordModalOpen(true)}
              className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-4 rounded-[1.5rem] font-black text-xs hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-200 active:scale-95 group"
            >
              <User className="w-5 h-5 group-hover:scale-110 transition-transform" />
              EXPEDIENTES
            </button>
            <button
              onClick={() => setIsMedModalOpen(true)}
              className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-4 rounded-[1.5rem] font-black text-xs hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-200 active:scale-95 group"
            >
              <Syringe className="w-5 h-5 group-hover:rotate-12 transition-transform" />
              AGREGAR MEDICAMENTO
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 bg-slate-900 text-white px-6 py-4 rounded-[1.5rem] font-black text-xs hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 active:scale-95 group"
            >
              <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
              REGISTRAR INCIDENTE
            </button>
          </div>
        </header>

        {loading ? (
          <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
            <p className="text-slate-400 font-bold italic animate-pulse">Sincronizando expedientes médicos...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* LEFT COLUMN: CRITICAL ALERTS & SCHEDULE */}
            <div className="lg:col-span-8 space-y-8">
              
              {/* Active Health Alerts */}
              <section className="bg-rose-50 border border-rose-100 rounded-[2.5rem] p-8 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-white rounded-xl shadow-sm">
                    <AlertTriangle className="w-5 h-5 text-rose-500" />
                  </div>
                  <h2 className="text-xl font-black text-rose-900 tracking-tight">Alertas de Salud Activas</h2>
                </div>

                <div className="space-y-4">
                  {alerts.length === 0 ? (
                    <div className="bg-white/60 p-6 rounded-3xl text-center border-2 border-dashed border-rose-200">
                      <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                      <p className="text-slate-500 font-bold">No hay alertas críticas registradas.</p>
                    </div>
                  ) : (
                    alerts.map(alert => (
                      <div key={alert.id} className="bg-white p-6 rounded-[2.2rem] shadow-sm border border-rose-100 flex items-center justify-between group hover:shadow-md transition-all">
                        <div className="flex items-center gap-4">
                          <img 
                            src={alert.students.photo_url || "https://images.unsplash.com/photo-1628157588553-5eeea00af15c?w=100"} 
                            className="w-14 h-14 rounded-2xl object-cover ring-4 ring-rose-50" 
                          />
                          <div>
                            <h4 className="font-black text-slate-800 leading-tight">
                              {alert.students.first_name} {alert.students.last_name} 
                              <span className="ml-2 text-[10px] text-slate-400 font-bold uppercase">{alert.students.grade}</span>
                            </h4>
                            <p className="text-rose-600 font-black text-sm uppercase tracking-tighter mt-0.5">{alert.title}</p>
                            <p className="text-[10px] text-slate-400 font-medium mt-1 italic">{alert.action_plan}</p>
                          </div>
                        </div>
                        <button className="bg-slate-50 text-slate-500 px-4 py-2 rounded-xl text-[10px] font-black hover:bg-slate-100 transition-all flex items-center gap-1 group-hover:bg-rose-600 group-hover:text-white">
                          VER PLAN <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Critical Medications */}
              {criticalMeds.length > 0 && (
                <section className="bg-amber-50 border border-amber-100 rounded-[2.5rem] p-8 shadow-sm">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-amber-100 rounded-xl">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                    </div>
                    <h2 className="text-xl font-black text-amber-900 tracking-tight">Medicamentos Críticos</h2>
                    <span className="ml-auto bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-[10px] font-black uppercase">
                      {criticalMeds.length} {criticalMeds.length === 1 ? 'Activo' : 'Activos'}
                    </span>
                  </div>

                  <div className="space-y-4">
                    {criticalMeds.map(med => (
                      <div key={med.id} className="bg-white p-6 rounded-[2.2rem] shadow-sm border-2 border-amber-200 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <img
                            src={med.students?.photo_url || "https://images.unsplash.com/photo-1628157588553-5eeea00af15c?w=100"}
                            className="w-14 h-14 rounded-2xl object-cover ring-4 ring-amber-50"
                          />
                          <div>
                            <h4 className="font-black text-slate-800 leading-tight">
                              {med.students?.first_name} {med.students?.last_name}
                              <span className="ml-2 text-[10px] text-slate-400 font-bold uppercase">{med.students?.grade}</span>
                            </h4>
                            <p className="text-amber-700 font-black text-sm uppercase tracking-tighter mt-0.5">
                              {med.medication_name} ({med.dosage})
                            </p>
                            <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                              {med.critical_reason || 'Requiere atención especial'} • {med.frequency}
                            </p>
                          </div>
                        </div>
                        <button
                          disabled={processing === med.id}
                          onClick={() => toggleMedicationCritical(med.id, true)}
                          className="bg-amber-100 text-amber-700 px-4 py-2 rounded-xl text-[10px] font-black hover:bg-amber-200 transition-all flex items-center gap-1 disabled:opacity-50"
                        >
                          <ToggleRight className="w-4 h-4" /> CRÍTICO
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Medication Schedule */}
              <section className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
                <div className="flex justify-between items-center mb-8">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 rounded-xl">
                      <Clock className="w-5 h-5 text-indigo-500" />
                    </div>
                    <h2 className="text-xl font-black text-slate-900 tracking-tight">Horario de Medicamentos de Hoy</h2>
                  </div>
                  <span className="bg-indigo-50 text-indigo-600 px-4 py-1.5 rounded-full text-[10px] font-black uppercase shadow-sm border border-indigo-100">
                    {meds.filter(m => m.status === 'pending').length} Pendientes
                  </span>
                </div>

                <div className="space-y-4">
                  {meds.length === 0 ? (
                    <div className="py-10 text-center text-slate-300 italic font-medium">
                      No hay medicamentos programados para hoy.
                    </div>
                  ) : (
                    meds.map(med => (
                      <div key={med.id} className={`p-6 rounded-[2.2rem] flex items-center justify-between border-2 transition-all ${med.status === 'administered' ? 'bg-slate-50 border-transparent opacity-60' : 'bg-white border-slate-50 shadow-sm'} ${med.is_critical ? 'ring-2 ring-amber-400 ring-offset-2' : ''}`}>
                        <div className="flex items-center gap-6">
                          <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center font-black transition-colors ${med.status === 'administered' ? 'bg-slate-200 text-slate-400' : 'bg-indigo-50 text-indigo-600'}`}>
                            <span className="text-xs leading-none">{new Date(med.scheduled_time).getHours()}</span>
                            <span className="text-[10px] opacity-70">HRS</span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-black text-slate-800 leading-tight">
                                {med.medication_name} ({med.dosage})
                              </h4>
                              {med.is_critical && (
                                <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-tighter flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" /> Crítico
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 font-bold mt-0.5">{med.students?.first_name} {med.students?.last_name} <span className="mx-1.5 opacity-30">•</span> Prescrito: {med.notes || 'Routine'}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {/* Toggle Critical Button */}
                          <button
                            disabled={processing === med.id}
                            onClick={() => toggleMedicationCritical(med.id, med.is_critical)}
                            className={`p-3 rounded-xl font-black text-[10px] uppercase transition-all active:scale-95 disabled:opacity-50 ${med.is_critical ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                            title={med.is_critical ? 'Quitar de críticos' : 'Marcar como crítico'}
                          >
                            {med.is_critical ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                          </button>

                          {med.status === 'administered' ? (
                            <div className="flex items-center gap-2 text-emerald-500 font-black text-[10px] uppercase">
                              <CheckCircle2 className="w-4 h-4" /> Hecho
                            </div>
                          ) : (
                            <button
                              disabled={processing === med.id}
                              onClick={() => markMedAsDone(med.id)}
                              className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase shadow-lg hover:shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50"
                            >
                              {processing === med.id ? 'Guardando...' : 'Administrar'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>

            {/* RIGHT COLUMN: DAILY SUMMARY & RECENT LOGS */}
            <div className="lg:col-span-4 space-y-8">
              
              {/* Summary Stats */}
              <div className="bg-indigo-900 rounded-[3rem] p-8 text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-3xl" />
                <h3 className="text-xl font-black mb-8 flex items-center gap-3">
                   <Activity className="w-5 h-5 text-indigo-300" /> Resumen Diario
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/10 rounded-3xl p-5 border border-white/5">
                    <p className="text-[10px] font-black uppercase text-indigo-200 mb-2">Incidentes</p>
                    <span className="text-4xl font-black">{summary.incidents}</span>
                  </div>
                  <div className="bg-white/10 rounded-3xl p-5 border border-white/5">
                    <p className="text-[10px] font-black uppercase text-indigo-200 mb-2">Meds Dados</p>
                    <span className="text-4xl font-black">{summary.medsDone}</span>
                  </div>
                  <div className="bg-amber-500/20 rounded-3xl p-5 border border-amber-400/30">
                    <p className="text-[10px] font-black uppercase text-amber-200 mb-2">Críticos</p>
                    <span className="text-4xl font-black">{summary.criticalCount}</span>
                  </div>
                  <div className="bg-white/10 rounded-3xl p-5 border border-white/5">
                    <p className="text-[10px] font-black uppercase text-indigo-200 mb-2">Alertas</p>
                    <span className="text-4xl font-black">{alerts.length}</span>
                  </div>
                </div>
              </div>

              {/* Recent Logs (Temperature, Nap, etc) */}
              <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
                <h3 className="text-lg font-black text-slate-900 mb-6 flex items-center gap-3">
                  <Stethoscope className="w-5 h-5 text-indigo-500" /> Registros Recientes
                </h3>

                <div className="space-y-6">
                  {logs.length === 0 ? (
                    <p className="text-slate-300 italic text-sm text-center py-6">No hay registros hoy.</p>
                  ) : (
                    logs.map(log => (
                      <div key={log.id} className="flex gap-4 relative">
                        <div className="absolute left-[1.125rem] top-10 bottom-0 w-0.5 bg-slate-50" />
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border ${log.entryType === 'incident' ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100'}`}>
                          {log.entryType === 'incident' ? <AlertCircle className="w-4 h-4 text-rose-500" /> : (
                            <>
                              {log.type === 'temperature' && <Thermometer className="w-4 h-4 text-orange-500" />}
                              {log.type === 'nap' && <Moon className="w-4 h-4 text-indigo-500" />}
                              {log.type === 'meal' && <Coffee className="w-4 h-4 text-emerald-500" />}
                            </>
                          )}
                        </div>
                        <div className="flex-1 pt-1">
                          <p className={`text-xs font-black leading-none mb-1 uppercase tracking-tight ${log.entryType === 'incident' ? 'text-rose-600' : 'text-slate-800'}`}>
                            {log.entryType === 'incident' ? `INCIDENTE: ${log.type}` : (
                              log.type === 'temperature' ? 'Control Térmico' : log.type === 'nap' ? 'Hora de Siesta' : 'Alimentación'
                            )}
                          </p>
                          <p className="text-[11px] text-slate-500 font-bold mb-1">
                            {log.students?.first_name}: <span className="text-slate-900 font-extrabold">{log.entryType === 'incident' ? log.description : log.value}</span>
                          </p>
                          <span className="text-[9px] text-slate-400 font-bold uppercase">{new Date(log.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                      </div>
                    ))
                  )}
                  
                  <button className="w-full bg-slate-50 text-slate-400 font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest hover:bg-indigo-50 hover:text-indigo-500 transition-all border border-slate-50 border-dashed hover:border-indigo-200 mt-4">
                    VER TODOS LOS REGISTROS
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: EXPEDIENTES MÉDICOS */}
      {isRecordModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="flex justify-between items-center p-8 bg-slate-50 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 rounded-xl">
                  <User className="w-5 h-5 text-emerald-500" />
                </div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">Expedientes de Salud</h2>
              </div>
              <button onClick={() => { setIsRecordModalOpen(false); setSelectedRecordStudent(null); setStudentIncidents([]); }} className="p-2.5 bg-white text-slate-400 hover:text-emerald-500 rounded-xl shadow-sm transition-all hover:rotate-90">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 flex-1 overflow-y-auto space-y-6">
              {/* Student Selector */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Seleccionar Alumno</label>
                <div className="relative">
                  <select 
                    value={selectedRecordStudent?.id || ''}
                    onChange={(e) => handleStudentSelectForRecord(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-12 py-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 focus:bg-white transition-all appearance-none"
                  >
                    <option value="">Selecciona un alumno...</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.grade})</option>
                    ))}
                  </select>
                  <User className="w-5 h-5 text-slate-300 absolute left-4 top-4" />
                </div>
              </div>

              {selectedRecordStudent && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-3xl border border-slate-100">
                    <img 
                      src={selectedRecordStudent.photo_url || "https://images.unsplash.com/photo-1628157588553-5eeea00af15c?w=100"} 
                      className="w-16 h-16 rounded-2xl object-cover ring-4 ring-white shadow-sm" 
                    />
                    <div>
                      <h3 className="text-lg font-black text-slate-800">{selectedRecordStudent.first_name} {selectedRecordStudent.last_name}</h3>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{selectedRecordStudent.grade}</p>
                    </div>
                  </div>

                  {/* Incidents Table */}
                  <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
                    <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-slate-500" />
                      <h4 className="font-black text-slate-700 text-sm uppercase tracking-widest">Historial de Incidentes</h4>
                    </div>
                    
                    {studentIncidents.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 font-medium text-sm italic">
                        No hay incidentes registrados para este alumno.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {studentIncidents.map(incident => (
                          <div key={incident.id} className="p-6">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex items-center gap-2">
                                <span className="bg-rose-100 text-rose-700 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest">
                                  {incident.type}
                                </span>
                                <span className="text-xs text-slate-400 font-bold">
                                  {new Date(incident.created_at).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}
                                </span>
                              </div>
                              {editingIncidentId !== incident.id && (
                                <button 
                                  onClick={() => { setEditingIncidentId(incident.id); setEvolutionText(''); }}
                                  className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase tracking-widest bg-indigo-50 px-3 py-1.5 rounded-lg transition-all"
                                >
                                  Añadir Evolución
                                </button>
                              )}
                            </div>
                            
                            <div className="text-sm text-slate-700 font-medium whitespace-pre-wrap bg-slate-50 p-4 rounded-2xl border border-slate-100 mt-3">
                              {incident.description}
                            </div>

                            {editingIncidentId === incident.id && (
                              <div className="mt-4 bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 animate-in fade-in">
                                <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-widest mb-2">Nueva Nota de Evolución</label>
                                <textarea
                                  value={evolutionText}
                                  onChange={(e) => setEvolutionText(e.target.value)}
                                  placeholder="Ej: El alumno ya no presenta dolor..."
                                  rows={3}
                                  className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-indigo-500 transition-all resize-none mb-3"
                                />
                                <div className="flex gap-2 justify-end">
                                  <button 
                                    onClick={() => setEditingIncidentId(null)}
                                    className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-200 transition-all"
                                  >
                                    Cancelar
                                  </button>
                                  <button 
                                    onClick={() => handleSaveEvolution(incident.id)}
                                    disabled={isSavingEvolution || !evolutionText.trim()}
                                    className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2"
                                  >
                                    {isSavingEvolution ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Guardar'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REGISTRAR INCIDENTE */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 flex flex-col">
            <div className="flex justify-between items-center p-8 bg-slate-50 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-50 rounded-xl">
                  <AlertCircle className="w-5 h-5 text-rose-500" />
                </div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">Reportar Incidente</h2>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-2.5 bg-white text-slate-400 hover:text-rose-500 rounded-xl shadow-sm transition-all hover:rotate-90">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveIncident} className="p-8 space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Estudiante Involucrado</label>
                <div className="relative">
                  <select 
                    required
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-12 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all appearance-none"
                  >
                    <option value="">Selecciona un alumno...</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.grade})</option>
                    ))}
                  </select>
                  <User className="w-5 h-5 text-slate-300 absolute left-4 top-4" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Tipo de Evento</label>
                <div className="grid grid-cols-2 gap-2">
                  {['Caída', 'Fiebre', 'Raspón', 'Dolor', 'Comportamiento', 'Otro'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setIncidentType(type)}
                      className={`px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${incidentType === type ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'}`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Breve Descripción</label>
                <textarea 
                  required
                  value={incidentDesc}
                  onChange={(e) => setIncidentDesc(e.target.value)}
                  placeholder="Explica qué sucedió..."
                  rows={4}
                  className="w-full bg-slate-50 border border-slate-200 rounded-3xl px-5 py-4 text-sm font-medium text-slate-600 outline-none focus:border-indigo-500 focus:bg-white transition-all resize-none"
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 bg-slate-100 text-slate-600 font-black py-4 rounded-3xl hover:bg-slate-200 transition-all text-[10px] uppercase tracking-widest"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isSavingIncident}
                  className="flex-[2] bg-slate-900 text-white font-black py-4 rounded-3xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 disabled:opacity-50 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest"
                >
                  {isSavingIncident ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Activity className="w-4 h-4" /> Guardar Reporte</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: AGREGAR MEDICAMENTO */}
      {isMedModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 flex flex-col">
            <div className="flex justify-between items-center p-8 bg-slate-50 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-xl">
                  <Syringe className="w-5 h-5 text-indigo-500" />
                </div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">Agregar Medicamento</h2>
              </div>
              <button onClick={() => setIsMedModalOpen(false)} className="p-2.5 bg-white text-slate-400 hover:text-indigo-500 rounded-xl shadow-sm transition-all hover:rotate-90">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMedication} className="p-8 space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Estudiante</label>
                <div className="relative">
                  <select
                    required
                    value={medForm.student_id}
                    onChange={(e) => setMedForm({ ...medForm, student_id: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-12 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all appearance-none"
                  >
                    <option value="">Selecciona un alumno...</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.grade})</option>
                    ))}
                  </select>
                  <User className="w-5 h-5 text-slate-300 absolute left-4 top-4" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Medicamento *</label>
                  <input
                    type="text"
                    required
                    value={medForm.medication_name}
                    onChange={(e) => setMedForm({ ...medForm, medication_name: e.target.value })}
                    placeholder="Ej: Amoxicillin"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Dosis *</label>
                  <input
                    type="text"
                    required
                    value={medForm.dosage}
                    onChange={(e) => setMedForm({ ...medForm, dosage: e.target.value })}
                    placeholder="Ej: 5ml"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Frecuencia</label>
                  <input
                    type="text"
                    value={medForm.frequency}
                    onChange={(e) => setMedForm({ ...medForm, frequency: e.target.value })}
                    placeholder="Ej: Cada 8 horas"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Fecha Inicio</label>
                  <input
                    type="date"
                    value={medForm.start_date}
                    onChange={(e) => setMedForm({ ...medForm, start_date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Notas</label>
                <textarea
                  value={medForm.notes}
                  onChange={(e) => setMedForm({ ...medForm, notes: e.target.value })}
                  placeholder="Instrucciones adicionales..."
                  rows={2}
                  className="w-full bg-slate-50 border border-slate-200 rounded-3xl px-5 py-4 text-sm font-medium text-slate-600 outline-none focus:border-indigo-500 focus:bg-white transition-all resize-none"
                />
              </div>

              {/* Critical Medication Toggle */}
              <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    <span className="text-sm font-black text-amber-900 uppercase tracking-tight">Medicamento Crítico</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMedForm({ ...medForm, is_critical: !medForm.is_critical })}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${medForm.is_critical ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-500'}`}
                  >
                    {medForm.is_critical ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    {medForm.is_critical ? 'ACTIVADO' : 'DESACTIVADO'}
                  </button>
                </div>
                {medForm.is_critical && (
                  <div className="mt-3">
                    <label className="block text-[9px] font-black text-amber-700 uppercase tracking-widest mb-2 ml-1">Razón (opcional)</label>
                    <input
                      type="text"
                      value={medForm.critical_reason}
                      onChange={(e) => setMedForm({ ...medForm, critical_reason: e.target.value })}
                      placeholder="Ej: Alergia severa, requiere monitoreo"
                      className="w-full bg-white border border-amber-200 rounded-xl px-4 py-3 text-xs font-medium text-slate-700 outline-none focus:border-amber-500 focus:bg-white transition-all"
                    />
                  </div>
                )}
                <p className="text-[9px] text-amber-700 font-bold mt-3">
                  Los medicamentos críticos aparecerán en la sección de alertas críticas y requerirán atención especial.
                </p>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setIsMedModalOpen(false)}
                  className="flex-1 bg-slate-100 text-slate-600 font-black py-4 rounded-3xl hover:bg-slate-200 transition-all text-[10px] uppercase tracking-widest"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingMedication}
                  className="flex-[2] bg-indigo-600 text-white font-black py-4 rounded-3xl hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-200 disabled:opacity-50 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest"
                >
                  {isSavingMedication ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Syringe className="w-4 h-4" /> Guardar Medicamento</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
