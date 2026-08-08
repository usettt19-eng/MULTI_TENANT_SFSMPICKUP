import { supabase } from './supabase';

// ============ MEDICATIONS ============

export interface Medication {
  id: string;
  student_id: string;
  medication_name: string;
  dosage: string;
  frequency: string;
  start_date: string;
  end_date?: string;
  is_critical: boolean;
  critical_reason?: string;
  notes?: string;
  prescribed_by?: string;
  created_at: string;
  updated_at: string;
  students?: {
    id: string;
    first_name: string;
    last_name: string;
    grade: string;
    photo_url?: string;
  };
}

export async function getMedications(studentId?: string, criticalOnly?: boolean): Promise<Medication[]> {
  let query = supabase.from('medications').select(`
    *,
    students (
      id,
      first_name,
      last_name,
      grade,
      photo_url
    )
  `);

  if (studentId) {
    query = query.eq('student_id', studentId);
  }

  if (criticalOnly) {
    query = query.eq('is_critical', true);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data as any;
}

export async function getCriticalMedications(): Promise<Medication[]> {
  const { data, error } = await supabase
    .from('active_critical_medications')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data as any;
}

export async function getMedication(id: string): Promise<Medication> {
  const { data, error } = await supabase
    .from('medications')
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
    .eq('id', id)
    .single();

  if (error) throw error;
  return data as any;
}

export async function createMedication(medication: Omit<Medication, 'id' | 'created_at' | 'updated_at'>): Promise<Medication> {
  const { data, error } = await supabase
    .from('medications')
    .insert({
      ...medication,
      is_critical: medication.is_critical || false
    })
    .select()
    .single();

  if (error) throw error;
  return data as any;
}

export async function updateMedication(id: string, updateData: Partial<Medication>): Promise<Medication> {
  const dataToUpdate = { ...updateData };
  delete dataToUpdate.id;
  delete dataToUpdate.created_at;

  const { data, error } = await supabase
    .from('medications')
    .update(dataToUpdate)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as any;
}

export async function toggleMedicationCritical(
  id: string,
  isCritical: boolean,
  criticalReason?: string
): Promise<Medication> {
  const updateData: any = { is_critical: isCritical };
  if (criticalReason) {
    updateData.critical_reason = criticalReason;
  }

  const { data, error } = await supabase
    .from('medications')
    .update(updateData)
    .eq('id', id)
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
    .single();

  if (error) throw error;
  return data as any;
}

export async function deleteMedication(id: string): Promise<void> {
  const { error } = await supabase
    .from('medications')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============ CRITICAL ALERTS ============

export interface MedicationAlert {
  id: string;
  medication_id?: string;
  student_id: string;
  alert_type: string;
  title: string;
  description?: string;
  action_plan?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  is_active: boolean;
  acknowledged_by?: string;
  acknowledged_at?: string;
  resolved_at?: string;
  created_at: string;
  medications?: {
    medication_name: string;
    dosage: string;
    frequency: string;
  };
  students?: {
    first_name: string;
    last_name: string;
    grade: string;
    photo_url?: string;
  };
}

export async function getCriticalAlerts(): Promise<MedicationAlert[]> {
  const { data, error } = await supabase
    .from('wellness_critical_alerts_dashboard')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data as any;
}

export async function getMedicationAlerts(studentId?: string): Promise<MedicationAlert[]> {
  let query = supabase
    .from('medication_critical_alerts')
    .select(`
      *,
      medications (
        id,
        medication_name,
        dosage,
        frequency
      ),
      students (
        id,
        first_name,
        last_name,
        grade,
        photo_url
      )
    `)
    .eq('is_active', true);

  if (studentId) {
    query = query.eq('student_id', studentId);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data as any;
}

export async function createMedicationAlert(alert: {
  medication_id?: string;
  student_id: string;
  title: string;
  description?: string;
  action_plan?: string;
  severity?: string;
}): Promise<MedicationAlert> {
  const { data, error } = await supabase
    .from('medication_critical_alerts')
    .insert({
      ...alert,
      alert_type: 'critical_medication',
      severity: alert.severity || 'critical',
      is_active: true
    })
    .select()
    .single();

  if (error) throw error;
  return data as any;
}

export async function acknowledgeAlert(id: string, acknowledgedBy: string): Promise<MedicationAlert> {
  const { data, error } = await supabase
    .from('medication_critical_alerts')
    .update({
      acknowledged_by: acknowledgedBy,
      acknowledged_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as any;
}

export async function resolveAlert(id: string): Promise<MedicationAlert> {
  const { data, error } = await supabase
    .from('medication_critical_alerts')
    .update({
      is_active: false,
      resolved_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as any;
}

// ============ DASHBOARD ============

export interface DashboardStats {
  critical_medications: number;
  active_medication_alerts: number;
  active_health_alerts: number;
  total_critical_alerts: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  // Medicamentos críticos activos
  const { count: criticalMedsCount, error: err1 } = await supabase
    .from('medications')
    .select('*', { count: 'exact', head: true })
    .eq('is_critical', true);

  if (err1) throw err1;

  // Alertas de medicamentos activas
  const { count: activeMedAlerts, error: err2 } = await supabase
    .from('medication_critical_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  if (err2) throw err2;

  // Alertas de salud activas
  const { count: activeHealthAlerts, error: err3 } = await supabase
    .from('health_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('resolved', false);

  if (err3) throw err3;

  // Total de alertas críticas combinadas
  const { count: combinedAlerts, error: err4 } = await supabase
    .from('wellness_critical_alerts_dashboard')
    .select('*', { count: 'exact', head: true });

  if (err4) throw err4;

  return {
    critical_medications: criticalMedsCount || 0,
    active_medication_alerts: activeMedAlerts || 0,
    active_health_alerts: activeHealthAlerts || 0,
    total_critical_alerts: combinedAlerts || 0
  };
}

// ============ HEALTH CHECK ============

export async function checkApiHealth(): Promise<{ status: string; timestamp: string }> {
  return {
    status: 'ok',
    timestamp: new Date().toISOString()
  };
}
