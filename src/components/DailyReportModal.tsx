import React, { useEffect, useState } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  X, FileBarChart, Loader2, Download, Clock, Users, Car, Footprints,
  ShieldCheck, MessageSquare, FileEdit, AlertTriangle, History,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Formato yyyy-mm-dd en hora local (no UTC) — el mismo patrón que ya usa
// VisitorsLog.tsx para su selector de fecha.
const toDateOnlyValue = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

interface DailyReportModalProps {
  onClose: () => void;
}

/**
 * Reporte del día: junta en un resumen de cifras (y sus anexos con el
 * detalle) todo lo que pasó hoy en el colegio — recogidas, salidas
 * autónomas, visitantes, solicitudes de reemplazo e incidentes. Se puede
 * previsualizar antes de generar el PDF; al generarlo, además de bajarlo,
 * se guarda en Storage (bucket privado `daily-reports`) y queda listado en
 * `daily_reports` para volver a descargarlo después sin regenerarlo.
 */
export function DailyReportModal({ onClose }: DailyReportModalProps) {
  const { profile } = useAuth() as any;
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const [summary, setSummary] = useState<any | null>(null);
  const [annexes, setAnnexes] = useState<any | null>(null);
  const [pastReports, setPastReports] = useState<any[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Día que se está viendo/generando — por defecto hoy, pero se puede
  // cambiar a cualquier día anterior para sacar el reporte de esa fecha.
  const [selectedDate, setSelectedDate] = useState(() => toDateOnlyValue(new Date()));

  const dayLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString('es', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  useEffect(() => {
    if (!profile?.tenant_id || !selectedDate) return;
    loadData();
    fetchPastReports();
  }, [profile?.tenant_id, selectedDate]);

  const fetchPastReports = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from('daily_reports')
      .select('id, report_date, file_path, summary, created_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('report_date', selectedDate)
      .order('created_at', { ascending: false })
      .limit(10);
    setPastReports(data || []);
  };

  const loadData = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    // Límites del día elegido en hora LOCAL del navegador (no UTC) — mismo
    // patrón que el selector de fecha de VisitorsLog.tsx.
    const startOfDay = new Date(`${selectedDate}T00:00:00`);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const startIso = startOfDay.toISOString();
    const endIso = endOfDay.toISOString();

    const [
      { data: school },
      { data: pickupsAnnounced },
      { data: pickupsCompleted },
      { data: selfDismissals },
      { data: visitors },
      { data: replacementRequests },
      { data: incidents },
      { data: healthAlerts },
      { data: formResponses },
    ] = await Promise.all([
      supabase.from('school_settings').select('school_name').eq('tenant_id', profile.tenant_id).maybeSingle(),
      supabase
        .from('pickup_events')
        .select('id, announced_at, completed_at, location_verified, notes, student:students(first_name, last_name, grade, section), parent:profiles(first_name, last_name)')
        .eq('tenant_id', profile.tenant_id)
        .gte('announced_at', startIso)
        .lt('announced_at', endIso),
      supabase
        .from('pickup_events')
        .select('id, announced_at, completed_at, student:students(first_name, last_name, grade, section)')
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'completed')
        .gte('completed_at', startIso)
        .lt('completed_at', endIso),
      supabase
        .from('self_dismissal_events')
        .select('id, method, created_at, student:students(first_name, last_name, grade, section)')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', startIso)
        .lt('created_at', endIso),
      supabase
        .from('daily_visitors')
        .select('id, visitor_name, company, visiting_whom, reason, check_in_time, check_out_time')
        .eq('tenant_id', profile.tenant_id)
        .gte('check_in_time', startIso)
        .lt('check_in_time', endIso),
      supabase
        .from('replacement_requests')
        .select('id, replacement_name, status, created_at')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', startIso)
        .lt('created_at', endIso),
      supabase
        .from('student_incidents')
        .select('id, type, description, created_at, student:students(first_name, last_name, grade, section)')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', startIso)
        .lt('created_at', endIso),
      supabase
        .from('health_alerts')
        .select('id, title, severity, created_at')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', startIso)
        .lt('created_at', endIso),
      supabase
        .from('form_responses')
        .select('id')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', startIso)
        .lt('created_at', endIso),
    ]);

    setSchoolName(school?.school_name || 'Colegio');

    const completedWithDuration = (pickupsCompleted || []).filter((p: any) => p.announced_at && p.completed_at);
    const avgMinutes = completedWithDuration.length > 0
      ? Math.round(
          completedWithDuration.reduce((sum: number, p: any) => sum + (new Date(p.completed_at).getTime() - new Date(p.announced_at).getTime()), 0)
          / completedWithDuration.length / 60000
        )
      : null;

    const noGpsCount = (pickupsAnnounced || []).filter((p: any) => p.location_verified === false).length;

    const repByStatus = { pending: 0, approved: 0, rejected: 0 };
    (replacementRequests || []).forEach((r: any) => {
      if (r.status === 'pending') repByStatus.pending++;
      else if (r.status === 'approved') repByStatus.approved++;
      else if (r.status === 'rejected') repByStatus.rejected++;
    });

    setSummary({
      pickupsAnnounced: (pickupsAnnounced || []).length,
      pickupsCompleted: (pickupsCompleted || []).length,
      noGpsCount,
      avgMinutes,
      selfDismissals: (selfDismissals || []).length,
      visitors: (visitors || []).length,
      replacementRequests: repByStatus,
      incidents: (incidents || []).length,
      healthAlerts: (healthAlerts || []).length,
      formResponses: (formResponses || []).length,
    });

    setAnnexes({
      pickups: pickupsAnnounced || [],
      selfDismissals: selfDismissals || [],
      visitors: visitors || [],
      replacementRequests: replacementRequests || [],
      incidents: incidents || [],
    });

    setLoading(false);
  };

  const buildPdf = () => {
    const doc = new jsPDF();
    const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

    doc.setFontSize(16);
    doc.text(`Reporte del Día — ${schoolName}`, 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1), 14, 23);
    doc.setTextColor(0);

    autoTable(doc, {
      startY: 30,
      head: [['Resumen del día', 'Cifra']],
      body: [
        ['Recogidas anunciadas', String(summary.pickupsAnnounced)],
        ['Recogidas completadas', String(summary.pickupsCompleted)],
        ['Confirmadas sin GPS', String(summary.noGpsCount)],
        ['Tiempo promedio de recogida', summary.avgMinutes !== null ? `${summary.avgMinutes} min` : '—'],
        ['Salidas Autónomas', String(summary.selfDismissals)],
        ['Visitantes registrados', String(summary.visitors)],
        ['Solicitudes de reemplazo (pendientes / aprobadas / rechazadas)', `${summary.replacementRequests.pending} / ${summary.replacementRequests.approved} / ${summary.replacementRequests.rejected}`],
        ['Incidentes reportados', String(summary.incidents)],
        ['Alertas de salud', String(summary.healthAlerts)],
        ['Respuestas a formularios/avisos', String(summary.formResponses)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59] },
    });

    let nextY = (doc as any).lastAutoTable.finalY + 12;

    if (annexes.pickups.length > 0) {
      doc.setFontSize(12);
      doc.text('Anexo 1 — Recogidas del día', 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [['Alumno', 'Grado · Sección', 'Retirado por', 'Anunciado', 'Completado']],
        body: annexes.pickups.map((p: any) => [
          `${p.student?.first_name || ''} ${p.student?.last_name || ''}`.trim(),
          `${p.student?.grade || '—'}${p.student?.section ? ' · ' + p.student.section : ''}`,
          `${p.parent?.first_name || ''} ${p.parent?.last_name || ''}`.trim() || '—',
          fmtTime(p.announced_at),
          fmtTime(p.completed_at),
        ]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
      nextY = (doc as any).lastAutoTable.finalY + 12;
    }

    if (annexes.selfDismissals.length > 0) {
      if (nextY > 260) { doc.addPage(); nextY = 16; }
      doc.setFontSize(12);
      doc.text('Anexo 2 — Salidas Autónomas del día', 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [['Alumno', 'Grado · Sección', 'Método', 'Hora']],
        body: annexes.selfDismissals.map((s: any) => [
          `${s.student?.first_name || ''} ${s.student?.last_name || ''}`.trim(),
          `${s.student?.grade || '—'}${s.student?.section ? ' · ' + s.student.section : ''}`,
          s.method === 'qr' ? 'QR' : 'Facial',
          fmtTime(s.created_at),
        ]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
      nextY = (doc as any).lastAutoTable.finalY + 12;
    }

    if (annexes.visitors.length > 0) {
      if (nextY > 260) { doc.addPage(); nextY = 16; }
      doc.setFontSize(12);
      doc.text('Anexo 3 — Visitantes del día', 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [['Visitante', 'Empresa', 'Visita a', 'Motivo', 'Entrada', 'Salida']],
        body: annexes.visitors.map((v: any) => [
          v.visitor_name, v.company || '—', v.visiting_whom, v.reason, fmtTime(v.check_in_time), fmtTime(v.check_out_time),
        ]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
      nextY = (doc as any).lastAutoTable.finalY + 12;
    }

    if (annexes.replacementRequests.length > 0) {
      if (nextY > 260) { doc.addPage(); nextY = 16; }
      doc.setFontSize(12);
      doc.text('Anexo 4 — Solicitudes de reemplazo del día', 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [['Nombre del reemplazo', 'Estado', 'Hora']],
        body: annexes.replacementRequests.map((r: any) => [r.replacement_name, r.status, fmtTime(r.created_at)]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
      nextY = (doc as any).lastAutoTable.finalY + 12;
    }

    if (annexes.incidents.length > 0) {
      if (nextY > 260) { doc.addPage(); nextY = 16; }
      doc.setFontSize(12);
      doc.text('Anexo 5 — Incidentes del día', 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [['Alumno', 'Tipo', 'Descripción', 'Hora']],
        body: annexes.incidents.map((i: any) => [
          `${i.student?.first_name || ''} ${i.student?.last_name || ''}`.trim(),
          i.type || '—',
          (i.description || '').slice(0, 80),
          fmtTime(i.created_at),
        ]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
    }

    return doc;
  };

  const generateAndSave = async () => {
    if (!summary || !annexes || !profile?.tenant_id) return;
    setGenerating(true);
    try {
      const doc = buildPdf();
      const blob = doc.output('blob');
      const fileName = `${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.pdf`;
      const filePath = `${profile.tenant_id}/${selectedDate}/${fileName}`;

      const { error: uploadError } = await supabase.storage.from('daily-reports').upload(filePath, blob, {
        contentType: 'application/pdf',
      });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from('daily_reports').insert({
        tenant_id: profile.tenant_id,
        report_date: selectedDate,
        generated_by: profile.id,
        file_path: filePath,
        summary,
      });
      if (insertError) throw insertError;

      await logActivity(
        'SECURITY',
        `REPORTE DEL DÍA generado y guardado (${selectedDate}).`,
        profile.first_name || 'Admin',
        { file_path: filePath, summary },
        profile.tenant_id,
      );

      doc.save(`reporte-del-dia-${selectedDate}.pdf`);
      await fetchPastReports();
    } catch (e: any) {
      console.error('Error generando el reporte del día:', e);
      alert('No se pudo generar/guardar el reporte: ' + (e.message || e));
    }
    setGenerating(false);
  };

  const downloadPastReport = async (report: any) => {
    setDownloadingId(report.id);
    try {
      const { data, error } = await supabase.storage.from('daily-reports').createSignedUrl(report.file_path, 60);
      if (error || !data?.signedUrl) throw error || new Error('Sin URL firmada');
      const link = document.createElement('a');
      link.href = data.signedUrl;
      link.download = `reporte-del-dia-${report.report_date}.pdf`;
      link.click();
    } catch (e) {
      console.error('Error descargando reporte guardado:', e);
      alert('No se pudo descargar ese reporte.');
    }
    setDownloadingId(null);
  };

  const StatCard = ({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) => (
    <div className="bg-[#f8fafc] rounded-xl p-4 border border-slate-100">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-indigo-500" />
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-xl font-black text-[#1e293b]">{value}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="p-6 border-b border-slate-100 flex justify-between items-start gap-4 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-black text-[#1e293b] flex items-center gap-2">
              <FileBarChart className="w-5 h-5 text-indigo-600" /> Reporte del Día
            </h2>
            <p className="text-sm text-slate-500 font-medium capitalize">{dayLabel}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="date"
              value={selectedDate}
              max={toDateOnlyValue(new Date())}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="px-3 py-2 bg-[#f8fafc] border border-slate-200 rounded-xl text-sm outline-none"
            />
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {loading ? (
            <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>
          ) : (
            <>
              <div>
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Vista Preliminar</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <StatCard icon={Clock} label="Recogidas anunciadas" value={summary.pickupsAnnounced} />
                  <StatCard icon={Car} label="Recogidas completadas" value={summary.pickupsCompleted} />
                  <StatCard icon={ShieldCheck} label="Confirmadas sin GPS" value={summary.noGpsCount} />
                  <StatCard icon={Clock} label="Tiempo prom. de recogida" value={summary.avgMinutes !== null ? `${summary.avgMinutes} min` : '—'} />
                  <StatCard icon={Footprints} label="Salidas Autónomas" value={summary.selfDismissals} />
                  <StatCard icon={Users} label="Visitantes" value={summary.visitors} />
                  <StatCard icon={MessageSquare} label="Solicitudes de reemplazo" value={summary.replacementRequests.pending + summary.replacementRequests.approved + summary.replacementRequests.rejected} />
                  <StatCard icon={AlertTriangle} label="Incidentes" value={summary.incidents} />
                  <StatCard icon={FileEdit} label="Respuestas a formularios" value={summary.formResponses} />
                </div>
              </div>

              <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 text-xs text-indigo-700 font-medium">
                El PDF incluirá este resumen más los anexos con el detalle del día: recogidas, salidas
                autónomas, visitantes, solicitudes de reemplazo e incidentes.
              </div>

              <button
                onClick={generateAndSave}
                disabled={generating}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                {generating ? 'Generando...' : 'Generar, Guardar y Descargar PDF'}
              </button>

              {pastReports.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" /> Reportes Guardados
                  </h3>
                  <div className="space-y-2">
                    {pastReports.map(r => (
                      <div key={r.id} className="flex items-center justify-between bg-[#f8fafc] rounded-xl p-3 border border-slate-100">
                        <div>
                          <p className="text-xs font-black text-[#1e293b]">{r.report_date}</p>
                          <p className="text-[10px] text-slate-400 font-bold">
                            {new Date(r.created_at).toLocaleString()}
                          </p>
                        </div>
                        <button
                          onClick={() => downloadPastReport(r)}
                          disabled={downloadingId === r.id}
                          className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 font-bold px-3 py-2 rounded-lg text-xs disabled:opacity-50"
                        >
                          {downloadingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          Descargar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
