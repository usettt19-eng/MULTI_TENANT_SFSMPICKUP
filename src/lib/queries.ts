import { supabase } from './supabase';
import type {
  Profile,
  Student,
  PickupEvent,
  HealthAlert,
  AuditLog,
  Notification,
  PickupStatus,
} from '../types/database';

// ============ STUDENTS ============

export async function getStudents(): Promise<Student[]> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .order('last_name', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getStudentById(id: string): Promise<Student | null> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function createStudent(student: Omit<Student, 'id' | 'created_at' | 'updated_at'>): Promise<Student> {
  const { data, error } = await supabase
    .from('students')
    .insert(student)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateStudent(id: string, updates: Partial<Student>): Promise<Student> {
  const { data, error } = await supabase
    .from('students')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteStudent(id: string): Promise<void> {
  const { error } = await supabase.from('students').delete().eq('id', id);
  if (error) throw error;
}

// ============ PROFILES ============

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) return null;
  return data;
}

export async function updateProfile(userId: string, updates: Partial<Profile>): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getParents(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['parent', 'guardian'])
    .order('full_name');

  if (error) throw error;
  return data || [];
}

// ============ PICKUP EVENTS ============

export async function getActivePickups(): Promise<PickupEvent[]> {
  const { data, error } = await supabase
    .from('pickup_events')
    .select('*, student:students(first_name, last_name, grade, photo_url), parent:profiles(first_name, last_name, pin_code, photo_url)')
    .in('status', ['announced', 'in_queue'])
    .order('announced_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getPickupById(id: string): Promise<PickupEvent | null> {
  const { data, error } = await supabase
    .from('pickup_events')
    .select('*, student:students(*), parent:profiles(*)')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function updatePickupStatus(id: string, status: PickupStatus): Promise<void> {
  const updates: Partial<PickupEvent> = { status };

  if (status === 'released') {
    updates.released_at = new Date().toISOString();
  } else if (status === 'completed') {
    updates.picked_up_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('pickup_events')
    .update(updates)
    .eq('id', id);

  if (error) throw error;
}

export async function createPickupEvent(event: {
  student_id: string;
  parent_id: string;
  pickup_type: 'parent' | 'guardian' | 'emergency';
  vehicle_info?: string;
}): Promise<PickupEvent> {
  const { data, error } = await supabase
    .from('pickup_events')
    .insert({
      ...event,
      status: 'announced',
      vehicle_info: event.vehicle_info || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============ HEALTH ALERTS ============

export async function getHealthAlerts(studentId?: string): Promise<HealthAlert[]> {
  let query = supabase.from('health_alerts').select('*');

  if (studentId) {
    query = query.eq('student_id', studentId);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createHealthAlert(alert: Omit<HealthAlert, 'id' | 'created_at' | 'resolved_at'>): Promise<HealthAlert> {
  const { data, error } = await supabase
    .from('health_alerts')
    .insert(alert)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function resolveHealthAlert(id: string): Promise<void> {
  const { error } = await supabase
    .from('health_alerts')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

// ============ NOTIFICATIONS ============

export async function getNotifications(userId: string, unreadOnly = false): Promise<Notification[]> {
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (unreadOnly) {
    query = query.eq('read', false);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id);

  if (error) throw error;
}

export async function createNotification(notification: {
  user_id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
}): Promise<Notification> {
  const { data, error } = await supabase
    .from('notifications')
    .insert(notification)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============ AUDIT LOGS ============

export async function getAuditLogs(limit = 100): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// ============ REALTIME SUBSCRIPTIONS ============

export function subscribeToPickupEvents(callback: () => void) {
  return supabase
    .channel('public:pickup_events')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_events' }, callback)
    .subscribe();
}

export function subscribeToStudents(callback: () => void) {
  return supabase
    .channel('public:students')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, callback)
    .subscribe();
}

export function subscribeToHealthAlerts(callback: () => void) {
  return supabase
    .channel('public:health_alerts')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'health_alerts' }, callback)
    .subscribe();
}
