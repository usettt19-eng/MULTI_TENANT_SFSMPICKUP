import React, { useEffect, useState } from 'react';
import { supabase, logActivity } from '../lib/supabase';
import { apiJson } from '../lib/apiFetch';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import {
  X, FileBarChart, Loader2, Download, Clock, Users, Car, Footprints,
  ShieldCheck, MessageSquare, FileEdit, AlertTriangle, History, UserX, UserCog, Sunrise,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { resolveResponsibleStaffIds } from '../lib/dismissalSchedule';

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
  const { t, language } = useLanguage();
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

  const dayLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString(language === 'es' ? 'es' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

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
      { data: pickupsUnauthorizedRaw },
      { data: selfDismissals },
      { data: visitors },
      { data: replacementRequests },
      { data: incidents },
      { data: healthAlerts },
      { data: formResponses },
      { data: pendingLoginParentsData },
      { data: inactiveTodayParentsData },
      { data: morningArrivalsRaw },
    ] = await Promise.all([
      supabase.from('school_settings').select('school_name').eq('tenant_id', profile.tenant_id).maybeSingle(),
      supabase
        .from('pickup_events')
        .select('id, announced_at, completed_at, location_verified, notes, student:students(first_name, last_name, grade, section), parent:profiles(first_name, last_name)')
        .eq('tenant_id', profile.tenant_id)
        .gte('announced_at', startIso)
        .lt('announced_at', endIso)
        .order('announced_at', { ascending: true }),
      supabase
        .from('pickup_events')
        .select('id, announced_at, completed_at, student:students(first_name, last_name, grade, section)')
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'completed')
        .gte('completed_at', startIso)
        .lt('completed_at', endIso),
      // "Sin autorizar" = se anunció la llegada pero, al momento de generar
      // este reporte, ningún maestro/staff la había autorizado todavía
      // (nunca llegó a 'released' ni a 'completed') — es una foto del
      // instante en que se genera, no del final del día: para un día ya
      // pasado, quedarse acá es una falla real; para hoy, puede que solo
      // esté en curso todavía.
      supabase
        .from('pickup_events')
        .select('id, announced_at, student:students(first_name, last_name, grade, section)')
        .eq('tenant_id', profile.tenant_id)
        .in('status', ['announced', 'in_queue'])
        .gte('announced_at', startIso)
        .lt('announced_at', endIso)
        .order('announced_at', { ascending: true }),
      supabase
        .from('self_dismissal_events')
        .select('id, method, created_at, student:students(first_name, last_name, grade, section)')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: true }),
      supabase
        .from('daily_visitors')
        .select('id, visitor_name, company, visiting_whom, reason, check_in_time, check_out_time')
        .eq('tenant_id', profile.tenant_id)
        .gte('check_in_time', startIso)
        .lt('check_in_time', endIso)
        .order('check_in_time', { ascending: true }),
      supabase
        .from('replacement_requests')
        .select('id, replacement_name, status, created_at')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: true }),
      supabase
        .from('student_incidents')
        .select('id, type, description, created_at, student:students(first_name, last_name, grade, section)')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: true }),
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
      // No es una cifra "del día" (es el estado de login a este instante),
      // pero es la sección que más ayuda al admin a decidir a quién
      // reenviarle la invitación — ver el endpoint para los criterios de
      // exclusión (cubierto por otro padre, o con hijo en bus).
      apiJson(`/api/tenants/${profile.tenant_id}/pending-login-parents`).catch(() => ({ data: { parents: [] } })),
      // Ya usaron la app alguna vez, pero no hoy — y nadie los cubrió hoy
      // (ni el otro padre ni el bus). Grupo distinto al anterior: ese es
      // "nunca ha entrado", este es "entró antes, pero hoy no hubo señal
      // de que alguien de esa familia esté al tanto".
      apiJson(`/api/tenants/${profile.tenant_id}/inactive-today-parents`).catch(() => ({ data: { parents: [] } })),
      // Llegadas matutinas (padre dejando al alumno en la mañana) — misma
      // tabla y criterio que DailyArrivals.tsx (Llegadas Diarias).
      supabase
        .from('morning_arrivals')
        .select('id, parent_id, arrived_at')
        .eq('tenant_id', profile.tenant_id)
        .gte('arrived_at', startIso)
        .lt('arrived_at', endIso)
        .order('arrived_at', { ascending: true }),
    ]);

    setSchoolName(school?.school_name || t('dailyReport.schoolFallback'));

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

    // Para cada recogida sin autorizar, a quién le tocaba autorizarla —
    // mismo criterio de "Mi Salón" (dismissal_assignments/overrides del
    // grado+sección para ese día, turno 'regular'). Se resuelve grado+
    // sección único (no por cada fila) para no repetir la misma consulta
    // decenas de veces si varios alumnos comparten salón.
    const uniqueGradeSections = new Map<string, { grade: string; section: string | null }>();
    (pickupsUnauthorizedRaw || []).forEach((p: any) => {
      const grade = p.student?.grade || '';
      const section = p.student?.section || '';
      if (!grade) return;
      const key = `${grade}::${section}`;
      if (!uniqueGradeSections.has(key)) uniqueGradeSections.set(key, { grade, section: section || null });
    });
    const reportDate = new Date(`${selectedDate}T00:00:00`);
    const staffByGradeSection = new Map<string, string[]>();
    await Promise.all(
      Array.from(uniqueGradeSections.entries()).map(async ([key, { grade, section }]) => {
        const staffIds = await resolveResponsibleStaffIds(profile.tenant_id, grade, section, 'regular', reportDate);
        staffByGradeSection.set(key, staffIds);
      }),
    );
    const allStaffIds = Array.from(new Set(Array.from(staffByGradeSection.values()).flat()));
    const { data: staffProfiles } = allStaffIds.length > 0
      ? await supabase.from('profiles').select('id, first_name, last_name').in('id', allStaffIds)
      : { data: [] as any[] };
    const staffNameById = new Map((staffProfiles || []).map((s: any) => [s.id, `${s.first_name || ''} ${s.last_name || ''}`.trim() || t('dailyReport.noName')]));

    const pickupsUnauthorized = (pickupsUnauthorizedRaw || []).map((p: any) => {
      const grade = p.student?.grade || '';
      const section = p.student?.section || '';
      const staffIds = grade ? (staffByGradeSection.get(`${grade}::${section}`) || []) : [];
      const staffNames = staffIds.map((id) => staffNameById.get(id) || t('dailyReport.noName'));
      return { ...p, responsibleStaffNames: staffNames };
    });

    // Cuenta por persona responsable, para el resumen — una recogida sin
    // asignación conocida (grado/sección sin nadie en dismissal_assignments)
    // cuenta aparte, como "Sin asignación", en vez de desaparecer del total.
    const unauthorizedByStaffMap = new Map<string, number>();
    pickupsUnauthorized.forEach((p: any) => {
      const names = p.responsibleStaffNames.length > 0 ? p.responsibleStaffNames : [t('dailyReport.noAssignment')];
      names.forEach((name: string) => unauthorizedByStaffMap.set(name, (unauthorizedByStaffMap.get(name) || 0) + 1));
    });
    const unauthorizedByStaff = Array.from(unauthorizedByStaffMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const pendingLoginParents = pendingLoginParentsData?.parents || [];
    const inactiveTodayParents = inactiveTodayParentsData?.parents || [];

    // Llegadas matutinas: una fila de morning_arrivals es un padre, pero se
    // muestra una fila por CADA hijo suyo matriculado (mismo criterio que
    // DailyArrivals.tsx), ya que el registro es "el padre llegó", no "llegó
    // por este alumno puntual".
    const arrivalParentIds = Array.from(new Set((morningArrivalsRaw || []).map((a: any) => a.parent_id)));
    const [{ data: arrivalParents }, { data: arrivalLinks }] = arrivalParentIds.length > 0
      ? await Promise.all([
          supabase.from('profiles').select('id, first_name, last_name').in('id', arrivalParentIds),
          supabase
            .from('parent_students')
            .select('parent_id, students(first_name, last_name, grade, section, tenant_id)')
            .in('parent_id', arrivalParentIds)
            .eq('students.tenant_id', profile.tenant_id),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];
    const arrivalParentNameById = new Map(
      (arrivalParents || []).map((p: any) => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || t('dailyReport.noName')]),
    );
    const arrivalStudentsByParent = new Map<string, any[]>();
    (arrivalLinks || []).forEach((l: any) => {
      if (!l.students) return;
      if (!arrivalStudentsByParent.has(l.parent_id)) arrivalStudentsByParent.set(l.parent_id, []);
      arrivalStudentsByParent.get(l.parent_id)!.push(l.students);
    });
    const morningArrivals: any[] = [];
    (morningArrivalsRaw || []).forEach((a: any) => {
      const parentName = arrivalParentNameById.get(a.parent_id) || t('dailyReport.noName');
      const students = arrivalStudentsByParent.get(a.parent_id) || [];
      if (students.length === 0) {
        morningArrivals.push({ studentName: '—', grade: '', section: '', parentName, arrivedAt: a.arrived_at });
        return;
      }
      students.forEach((s: any) => {
        morningArrivals.push({
          studentName: `${s.first_name || ''} ${s.last_name || ''}`.trim() || '—',
          grade: s.grade || '',
          section: s.section || '',
          parentName,
          arrivedAt: a.arrived_at,
        });
      });
    });

    setSummary({
      pickupsAnnounced: (pickupsAnnounced || []).length,
      pickupsCompleted: (pickupsCompleted || []).length,
      noGpsCount,
      avgMinutes,
      morningArrivals: morningArrivals.length,
      selfDismissals: (selfDismissals || []).length,
      visitors: (visitors || []).length,
      replacementRequests: repByStatus,
      incidents: (incidents || []).length,
      healthAlerts: (healthAlerts || []).length,
      formResponses: (formResponses || []).length,
      unauthorizedPickups: pickupsUnauthorized.length,
      unauthorizedByStaff,
      pendingLoginParents: pendingLoginParents.length,
      inactiveTodayParents: inactiveTodayParents.length,
    });

    setAnnexes({
      pickups: pickupsAnnounced || [],
      morningArrivals,
      selfDismissals: selfDismissals || [],
      visitors: visitors || [],
      replacementRequests: replacementRequests || [],
      pendingLoginParents,
      inactiveTodayParents,
      incidents: incidents || [],
      unauthorizedPickups: pickupsUnauthorized,
    });

    setLoading(false);
  };

  const buildPdf = () => {
    const doc = new jsPDF();
    const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

    doc.setFontSize(16);
    doc.text(t('dailyReport.pdf.titleTemplate').replace('{schoolName}', schoolName), 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1), 14, 23);
    doc.setTextColor(0);

    autoTable(doc, {
      startY: 30,
      head: [[t('dailyReport.pdf.summaryHeaderLabel'), t('dailyReport.pdf.summaryHeaderValue')]],
      body: [
        [t('dailyReport.pdf.rowAnnounced'), String(summary.pickupsAnnounced)],
        [t('dailyReport.pdf.rowCompleted'), String(summary.pickupsCompleted)],
        [t('dailyReport.pdf.rowUnauthorized'), String(summary.unauthorizedPickups)],
        [t('dailyReport.pdf.rowNoGps'), String(summary.noGpsCount)],
        [t('dailyReport.pdf.rowAvgTime'), summary.avgMinutes !== null ? `${summary.avgMinutes} min` : '—'],
        [t('dailyReport.pdf.rowMorningArrivals'), String(summary.morningArrivals)],
        [t('dailyReport.pdf.rowSelfDismissals'), String(summary.selfDismissals)],
        [t('dailyReport.pdf.rowVisitors'), String(summary.visitors)],
        [t('dailyReport.pdf.rowReplacementRequests'), `${summary.replacementRequests.pending} / ${summary.replacementRequests.approved} / ${summary.replacementRequests.rejected}`],
        [t('dailyReport.pdf.rowIncidents'), String(summary.incidents)],
        [t('dailyReport.pdf.rowHealthAlerts'), String(summary.healthAlerts)],
        [t('dailyReport.pdf.rowFormResponses'), String(summary.formResponses)],
        [t('dailyReport.pdf.rowPendingLoginParents'), String(summary.pendingLoginParents)],
        [t('dailyReport.pdf.rowInactiveTodayParents'), String(summary.inactiveTodayParents)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59] },
    });

    let nextY = (doc as any).lastAutoTable.finalY + 12;

    if (annexes.pickups.length > 0) {
      doc.setFontSize(12);
      doc.text(t('dailyReport.pdf.annex1Title'), 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [[t('dailyReport.pdf.colStudent'), t('dailyReport.pdf.colGradeSection'), t('dailyReport.pdf.colPickedUpBy'), t('dailyReport.pdf.colAnnounced'), t('dailyReport.pdf.colCompleted')]],
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
      doc.text(t('dailyReport.pdf.annex2Title'), 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [[t('dailyReport.pdf.colStudent'), t('dailyReport.pdf.colGradeSection'), t('dailyReport.pdf.colMethod'), t('dailyReport.pdf.colTime')]],
        body: annexes.selfDismissals.map((s: any) => [
          `${s.student?.first_name || ''} ${s.student?.last_name || ''}`.trim(),
          `${s.student?.grade || '—'}${s.student?.section ? ' · ' + s.student.section : ''}`,
          s.method === 'qr' ? 'QR' : t('dailyReport.pdf.methodFacial'),
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
      doc.text(t('dailyReport.pdf.annex3Title'), 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [[t('dailyReport.pdf.colVisitor'), t('dailyReport.pdf.colCompany'), t('dailyReport.pdf.colVisiting'), t('dailyReport.pdf.colReason'), t('dailyReport.pdf.colCheckIn'), t('dailyReport.pdf.colCheckOut')]],
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
      doc.text(t('dailyReport.pdf.annex4Title'), 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [[t('dailyReport.pdf.colReplacementName'), t('dailyReport.pdf.colStatus'), t('dailyReport.pdf.colTime')]],
        body: annexes.replacementRequests.map((r: any) => [r.replacement_name, r.status, fmtTime(r.created_at)]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
      nextY = (doc as any).lastAutoTable.finalY + 12;
    }

    if (annexes.incidents.length > 0) {
      if (nextY > 260) { doc.addPage(); nextY = 16; }
      doc.setFontSize(12);
      doc.text(t('dailyReport.pdf.annex5Title'), 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [[t('dailyReport.pdf.colStudent'), t('dailyReport.pdf.colType'), t('dailyReport.pdf.colDescription'), t('dailyReport.pdf.colTime')]],
        body: annexes.incidents.map((i: any) => [
          `${i.student?.first_name || ''} ${i.student?.last_name || ''}`.trim(),
          i.type || '—',
          (i.description || '').slice(0, 80),
          fmtTime(i.created_at),
        ]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
      nextY = (doc as any).lastAutoTable.finalY + 12;
    }

    if (annexes.unauthorizedPickups.length > 0) {
      if (nextY > 260) { doc.addPage(); nextY = 16; }
      doc.setFontSize(12);
      doc.text(t('dailyReport.pdf.annex6Title'), 14, nextY);
      autoTable(doc, {
        startY: nextY + 4,
        head: [[t('dailyReport.pdf.colStudent'), t('dailyReport.pdf.colGradeSection'), t('dailyReport.pdf.colRequested'), t('dailyReport.pdf.colResponsible')]],
        body: annexes.unauthorizedPickups.map((p: any) => [
          `${p.student?.first_name || ''} ${p.student?.last_name || ''}`.trim(),
          `${p.student?.grade || '—'}${p.student?.section ? ' · ' + p.student.section : ''}`,
          fmtTime(p.announced_at),
          p.responsibleStaffNames.length > 0 ? p.responsibleStaffNames.join(', ') : t('dailyReport.noAssignment'),
        ]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
      nextY = (doc as any).lastAutoTable.finalY + 12;

      if (summary.unauthorizedByStaff.length > 0) {
        if (nextY > 260) { doc.addPage(); nextY = 16; }
        doc.setFontSize(11);
        doc.text(t('dailyReport.pdf.byResponsibleTitle'), 14, nextY);
        autoTable(doc, {
          startY: nextY + 4,
          head: [[t('dailyReport.pdf.colResponsible'), t('dailyReport.pdf.colUnauthorized')]],
          body: summary.unauthorizedByStaff.map((s: any) => [s.name, String(s.count)]),
          theme: 'striped',
          styles: { fontSize: 8 },
        });
      }
    }

    if (annexes.pendingLoginParents.length > 0) {
      if (nextY > 260) { doc.addPage(); nextY = 16; }
      doc.setFontSize(12);
      doc.text(t('dailyReport.pdf.annex7Title'), 14, nextY);
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(t('dailyReport.pdf.annex7Explainer'), 14, nextY + 5);
      doc.setTextColor(0);
      autoTable(doc, {
        startY: nextY + 9,
        head: [[t('dailyReport.pdf.colParentGuardian'), t('dailyReport.pdf.colEmail'), t('dailyReport.pdf.colGradeSection')]],
        body: annexes.pendingLoginParents.map((p: any) => [
          `${p.first_name || ''} ${p.last_name || ''}`.trim() || '—',
          p.email || '—',
          (p.sections || []).join(', ') || '—',
        ]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
      nextY = (doc as any).lastAutoTable.finalY + 12;
    }

    if (annexes.inactiveTodayParents.length > 0) {
      if (nextY > 260) { doc.addPage(); nextY = 16; }
      doc.setFontSize(12);
      doc.text(t('dailyReport.pdf.annex8Title'), 14, nextY);
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(t('dailyReport.pdf.annex8Explainer'), 14, nextY + 5);
      doc.setTextColor(0);
      autoTable(doc, {
        startY: nextY + 9,
        head: [[t('dailyReport.pdf.colParentGuardian'), t('dailyReport.pdf.colEmail'), t('dailyReport.pdf.colGradeSection')]],
        body: annexes.inactiveTodayParents.map((p: any) => [
          `${p.first_name || ''} ${p.last_name || ''}`.trim() || '—',
          p.email || '—',
          (p.sections || []).join(', ') || '—',
        ]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
      nextY = (doc as any).lastAutoTable.finalY + 12;
    }

    if (annexes.morningArrivals.length > 0) {
      if (nextY > 260) { doc.addPage(); nextY = 16; }
      doc.setFontSize(12);
      doc.text(t('dailyReport.pdf.annex9Title'), 14, nextY);
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(t('dailyReport.pdf.annex9Explainer'), 14, nextY + 5);
      doc.setTextColor(0);
      autoTable(doc, {
        startY: nextY + 9,
        head: [[t('dailyReport.pdf.colStudent'), t('dailyReport.pdf.colGradeSection'), t('dailyReport.pdf.colParentGuardian'), t('dailyReport.pdf.colTime')]],
        body: annexes.morningArrivals.map((a: any) => [
          a.studentName,
          `${a.grade || '—'}${a.section ? ' · ' + a.section : ''}`,
          a.parentName,
          fmtTime(a.arrivedAt),
        ]),
        theme: 'striped',
        styles: { fontSize: 8 },
      });
      nextY = (doc as any).lastAutoTable.finalY + 12;
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
      alert(t('dailyReport.alertGenerateFailed') + (e.message || e));
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
      alert(t('dailyReport.alertDownloadFailed'));
    }
    setDownloadingId(null);
  };

  const StatCard = ({ icon: Icon, label, value, warn }: { icon: any; label: string; value: string | number; warn?: boolean }) => (
    <div className={`rounded-xl p-4 border ${warn ? 'bg-rose-50 border-rose-100' : 'bg-[#f8fafc] border-slate-100'}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${warn ? 'text-rose-500' : 'text-indigo-500'}`} />
        <p className={`text-[9px] font-black uppercase tracking-wider ${warn ? 'text-rose-400' : 'text-slate-400'}`}>{label}</p>
      </div>
      <p className={`text-xl font-black ${warn ? 'text-rose-700' : 'text-[#1e293b]'}`}>{value}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="p-6 border-b border-slate-100 flex justify-between items-start gap-4 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-black text-[#1e293b] flex items-center gap-2">
              <FileBarChart className="w-5 h-5 text-indigo-600" /> {t('dailyReport.title')}
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
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">{t('dailyReport.previewTitle')}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <StatCard icon={Clock} label={t('dailyReport.statAnnounced')} value={summary.pickupsAnnounced} />
                  <StatCard icon={Car} label={t('dailyReport.statCompleted')} value={summary.pickupsCompleted} />
                  <StatCard icon={UserX} label={t('dailyReport.statUnauthorized')} value={summary.unauthorizedPickups} warn={summary.unauthorizedPickups > 0} />
                  <StatCard icon={ShieldCheck} label={t('dailyReport.statNoGps')} value={summary.noGpsCount} />
                  <StatCard icon={Clock} label={t('dailyReport.statAvgTime')} value={summary.avgMinutes !== null ? `${summary.avgMinutes} min` : '—'} />
                  <StatCard icon={Sunrise} label={t('dailyReport.statMorningArrivals')} value={summary.morningArrivals} />
                  <StatCard icon={Footprints} label={t('dailyReport.statSelfDismissals')} value={summary.selfDismissals} />
                  <StatCard icon={Users} label={t('dailyReport.statVisitors')} value={summary.visitors} />
                  <StatCard icon={MessageSquare} label={t('dailyReport.statReplacementRequests')} value={summary.replacementRequests.pending + summary.replacementRequests.approved + summary.replacementRequests.rejected} />
                  <StatCard icon={AlertTriangle} label={t('dailyReport.statIncidents')} value={summary.incidents} />
                  <StatCard icon={FileEdit} label={t('dailyReport.statFormResponses')} value={summary.formResponses} />
                  <StatCard icon={UserCog} label={t('dailyReport.statPendingLoginParents')} value={summary.pendingLoginParents} warn={summary.pendingLoginParents > 0} />
                  <StatCard icon={UserCog} label={t('dailyReport.statInactiveTodayParents')} value={summary.inactiveTodayParents} warn={summary.inactiveTodayParents > 0} />
                </div>
              </div>

              {annexes.pendingLoginParents.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                  <h3 className="text-[10px] font-black text-amber-500 uppercase tracking-[0.2em] mb-1 flex items-center gap-1.5">
                    <UserCog className="w-3.5 h-3.5" /> {t('dailyReport.pendingLoginParentsTitleTemplate').replace('{count}', String(annexes.pendingLoginParents.length))}
                  </h3>
                  <p className="text-[10px] text-amber-600 font-medium mb-3">
                    {t('dailyReport.pendingLoginParentsExplainer')}
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {annexes.pendingLoginParents.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 text-xs bg-white/60 rounded-lg px-3 py-1.5">
                        <span className="font-bold text-amber-900 shrink-0">{`${p.first_name || ''} ${p.last_name || ''}`.trim() || '—'}</span>
                        <span className="text-amber-600 font-medium truncate">{p.email || '—'}</span>
                        <span className="text-amber-500 font-bold shrink-0">{(p.sections || []).join(', ') || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {annexes.inactiveTodayParents.length > 0 && (
                <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
                  <h3 className="text-[10px] font-black text-orange-500 uppercase tracking-[0.2em] mb-1 flex items-center gap-1.5">
                    <UserCog className="w-3.5 h-3.5" /> {t('dailyReport.inactiveTodayParentsTitleTemplate').replace('{count}', String(annexes.inactiveTodayParents.length))}
                  </h3>
                  <p className="text-[10px] text-orange-600 font-medium mb-3">
                    {t('dailyReport.inactiveTodayParentsExplainer')}
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {annexes.inactiveTodayParents.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 text-xs bg-white/60 rounded-lg px-3 py-1.5">
                        <span className="font-bold text-orange-900 shrink-0">{`${p.first_name || ''} ${p.last_name || ''}`.trim() || '—'}</span>
                        <span className="text-orange-600 font-medium truncate">{p.email || '—'}</span>
                        <span className="text-orange-500 font-bold shrink-0">{(p.sections || []).join(', ') || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {summary.unauthorizedByStaff.length > 0 && (
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4">
                  <h3 className="text-[10px] font-black text-rose-400 uppercase tracking-[0.2em] mb-3 flex items-center gap-1.5">
                    <UserX className="w-3.5 h-3.5" /> {t('dailyReport.byResponsibleTitle')}
                  </h3>
                  <div className="space-y-1.5">
                    {summary.unauthorizedByStaff.map((s: any) => (
                      <div key={s.name} className="flex items-center justify-between text-xs">
                        <span className="font-bold text-rose-800">{s.name}</span>
                        <span className="font-black text-rose-600">{s.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 text-xs text-indigo-700 font-medium">
                {t('dailyReport.pdfIncludesNote')}
              </div>

              <button
                onClick={generateAndSave}
                disabled={generating}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                {generating ? t('dailyReport.generatingBtn') : t('dailyReport.generateBtn')}
              </button>

              {pastReports.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" /> {t('dailyReport.savedReportsTitle')}
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
                          {t('dailyReport.downloadBtn')}
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
