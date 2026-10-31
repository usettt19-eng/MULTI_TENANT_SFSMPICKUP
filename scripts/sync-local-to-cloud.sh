#!/bin/bash
# Homologa la nube con el local (el local manda). Corre esto EN EL SERVIDOR
# de respaldo (donde vive el Postgres local), no en tu computadora.
#
# Uso:
#   CLOUD_DB_PASSWORD='la-contraseña-real' bash scripts/sync-local-to-cloud.sh
#
# La contraseña se pasa por variable de entorno a propósito — así este
# archivo, que SÍ queda en git, nunca contiene ni un hueco para pegarla por
# error y comitearla sin querer. Sácala de Supabase Dashboard del proyecto
# -> Project Settings -> Database -> Connection string ("URI"), o
# restablécela ahí si no la tienes a mano.
set -euo pipefail

: "${CLOUD_DB_PASSWORD:?Falta CLOUD_DB_PASSWORD. Corre: CLOUD_DB_PASSWORD='...' bash $0}"

CLOUD_URL="postgresql://postgres:${CLOUD_DB_PASSWORD}@db.fvzhfzogigewsvcyopel.supabase.co:5432/postgres"

echo "== 1/3: vaciando las tablas destino en la nube =="
psql "$CLOUD_URL" <<'SQL'
TRUNCATE TABLE
  auth.identities,
  auth.users,
  public._backfill_20260808, public.active_critical_medications, public.audit_logs,
  public.bus_daily_exclusions, public.bus_routes, public.camera_detections,
  public.carpool_authorizations, public.carpool_overrides, public.compliance_action_items,
  public.compliance_resources, public.compliance_status, public.daily_reports,
  public.daily_visitors, public.dismissal_assignments, public.dismissal_overrides,
  public.early_withdrawals, public.exit_doors, public.form_questions, public.form_responses,
  public.forms, public.grade_doors, public.health_alerts, public.medication_schedule,
  public.morning_arrivals, public.notifications, public.parent_presence,
  public.parent_school_access, public.parent_students, public.pickup_events,
  public.profiles, public.regulation_status, public.replacement_requests,
  public.school_grades, public.school_settings, public.self_dismissal_events,
  public.staff_school_access, public.student_incidents, public.students,
  public.tenants, public.vehicles, public.wellness_logs
CASCADE;
SQL

echo "== 2/3: volcando datos del local =="
pg_dump -h localhost -U postgres -d postgres \
  --data-only --no-owner --no-acl --disable-triggers \
  -t 'auth.users' -t 'auth.identities' \
  -t 'public.*' \
  -f /tmp/local_to_cloud.dump

echo "== 3/3: cargando en la nube =="
psql "$CLOUD_URL" -f /tmp/local_to_cloud.dump

echo "Listo. Verificando conteos..."
psql "$CLOUD_URL" -c "select 'auth.users' as tabla, count(*) from auth.users union all select 'profiles', count(*) from public.profiles union all select 'tenants', count(*) from public.tenants union all select 'pickup_events', count(*) from public.pickup_events;"
