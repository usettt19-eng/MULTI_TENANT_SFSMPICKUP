// Database Types for SafePickup

export interface Tenant {
  id: string;
  name: string;
  domain?: string | null;
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  first_name?: string;
  last_name?: string;
  role: 'super_admin' | 'admin' | 'parent' | 'guardian' | 'staff';
  phone: string | null;
  photo_url: string | null;
  pin_code: string | null;
  tenant_id?: string | null;
  tenant?: Tenant; // Join property
  created_at: string;
  updated_at: string;
}

export interface Student {
  id: string;
  first_name: string;
  last_name: string;
  grade: string | null;
  section: string | null;
  class_name?: string | null;
  photo_url: string | null;
  allergies: string | null;
  medical_notes: string | null;
  authorized_forms: string[];
  created_at: string;
  updated_at: string;
}

export interface PickupEvent {
  id: string;
  student_id: string;
  parent_id: string;
  status: PickupStatus;
  pickup_type: 'parent' | 'guardian' | 'emergency';
  vehicle_info: string | null;
  estimated_arrival: string | null;
  actual_arrival: string | null;
  announced_at?: string;
  picked_up_at?: string | null;
  released_at?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Relations
  student?: Pick<Student, 'first_name' | 'last_name' | 'grade' | 'photo_url'>;
  parent?: Pick<Profile, 'first_name' | 'last_name' | 'pin_code' | 'photo_url'>;
}

export type PickupStatus = 'announced' | 'in_queue' | 'released' | 'completed' | 'cancelled';

export interface HealthAlert {
  id: string;
  student_id: string;
  alert_type: 'allergy' | 'medication' | 'incident' | 'wellness';
  title: string;
  description: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
}

export interface MedicationSchedule {
  id: string;
  student_id: string;
  medication_name: string;
  dosage: string;
  frequency: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  created_at: string;
}

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

export interface StudentIncident {
  id: string;
  student_id: string;
  incident_type: string;
  description: string;
  reported_by: string;
  created_at: string;
}

export interface WellnessLog {
  id: string;
  student_id: string;
  log_type: 'mood' | 'sleep' | 'nutrition' | 'general';
  notes: string | null;
  created_at: string;
}

export interface Form {
  id: string;
  title: string;
  description: string | null;
  form_type: 'authorization' | 'medical' | 'emergency' | 'general';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FormQuestion {
  id: string;
  form_id: string;
  question_type: 'text' | 'number' | 'boolean' | 'select' | 'date';
  question_text: string;
  options: string[] | null;
  required: boolean;
  order: number;
}

export interface FormResponse {
  id: string;
  form_id: string;
  student_id: string | null;
  respondent_id: string;
  responses: Record<string, unknown>;
  submitted_at: string;
}

export interface AuditLog {
  id: string;
  event_type: string;
  description: string;
  actor_name: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  read: boolean;
  created_at: string;
}

export interface Vehicle {
  id: string;
  plate_number: string;
  make: string | null;
  model: string | null;
  color: string | null;
  owner_name: string;
  created_at: string;
}

export interface SchoolSettings {
  id: string;
  school_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  geofence_radius: number;
  geofence_lat: number;
  geofence_lng: number;
  created_at: string;
  updated_at: string;
}

export interface ParentStudent {
  id: string;
  parent_id: string;
  student_id: string;
  relationship: 'mother' | 'father' | 'guardian' | 'other';
  is_authorized: boolean;
  created_at: string;
}

export interface ExitDoor {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type SchoolStage = 'primaria' | 'secundaria';

export interface SchoolGrade {
  id: string;
  name: string;
  level_order: number;
  stage: SchoolStage;
  exit_time: string | null; // "HH:MM:SS"
  created_at: string;
  updated_at: string;
}

export interface GradeDoor {
  id: string;
  grade_id: string;
  door_id: string;
  created_at: string;
}

export type DismissalScheduleType = 'regular' | 'post_school';

export interface DismissalAssignment {
  id: string;
  tenant_id: string;
  grade_id: string;
  section: string;
  schedule_type: DismissalScheduleType;
  day_of_week: number; // 0=domingo ... 6=sábado
  staff_id: string;
  created_at: string;
  updated_at: string;
  staff?: Pick<Profile, 'first_name' | 'last_name'>;
}

export interface DismissalOverride {
  id: string;
  tenant_id: string;
  grade_id: string;
  section: string;
  schedule_type: DismissalScheduleType;
  override_date: string; // "YYYY-MM-DD"
  staff_id: string;
  created_by: string | null;
  created_at: string;
  staff?: Pick<Profile, 'first_name' | 'last_name'>;
}

// Constants
export const PICKUP_STATUSES: PickupStatus[] = ['announced', 'in_queue', 'released', 'completed', 'cancelled'];

export const USER_ROLES = ['super_admin', 'admin', 'parent', 'guardian', 'staff'] as const;
export type UserRole = typeof USER_ROLES[number];
