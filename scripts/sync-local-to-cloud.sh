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

# Nombre real del contenedor de Postgres en este stack (confirmado: el
# mismo que ya se usa para psql manual en las sesiones de mantenimiento).
LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-sfsmpickup-db}"

CLOUD_URL="postgresql://postgres:${CLOUD_DB_PASSWORD}@db.fvzhfzogigewsvcyopel.supabase.co:5432/postgres"

echo "== 1/4: vaciando las tablas destino en la nube =="
# active_critical_medications es una VISTA (sobre medication_schedule), no
# una tabla — no se puede truncar, y no hace falta: se vacía sola al
# truncar la tabla real debajo.
psql "$CLOUD_URL" <<'SQL'
TRUNCATE TABLE
  auth.identities,
  auth.users,
  public._backfill_20260808, public.audit_logs,
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

echo "== 2/4: volcando datos del local =="
# localhost:5432 en este servidor habla con Supavisor (el pooler), no
# directo con Postgres -- pg_dump necesita la conexión directa, así que
# corre DENTRO del contenedor de la base (docker exec), igual que ya se
# hacía con psql en las sesiones de mantenimiento. El stdout del exec sí
# llega normal al archivo del host.
#
# SIN --disable-triggers: el rol "postgres" de la nube no es dueño de
# auth.users/identities (son de supabase_auth_admin) ni puede desactivar
# los disparadores internos de llaves foráneas uno por uno -- el primer
# intento falló con "must be owner of table users" / "permission denied:
# ... is a system trigger" en CADA tabla, y dejó auth.users/identities en
# 0 filas (el trigger on_auth_user_created se disparó sin poder
# desactivarse, y falló porque tenants todavía no estaba cargado en ese
# punto del dump). Se desactivan TODOS los disparadores de una sola vez a
# nivel de sesión más abajo (session_replication_role), que sí está
# permitido sin ser dueño de nada.
docker exec "$LOCAL_DB_CONTAINER" pg_dump -U postgres -d postgres \
  --data-only --no-owner --no-acl \
  -t 'auth.users' -t 'auth.identities' \
  -t 'public.*' \
  > /tmp/local_to_cloud.dump

echo "== 3/4: cargando en la nube (disparadores desactivados a nivel de sesión) =="
{
  echo "SET session_replication_role = replica;"
  cat /tmp/local_to_cloud.dump
  echo "SET session_replication_role = DEFAULT;"
} | psql "$CLOUD_URL"

echo "== 4/4: arreglando columnas de token NULL en auth.users =="
# Lección ya aprendida la vez pasada (nube->local, 2026-10-01): pg_dump
# deja estas columnas en NULL en vez de '', y GoTrue no puede escanear
# NULL ahí -- rompe /admin/users con 500 ("Database error finding
# users"). Se corrige antes de que nadie intente loguearse contra la nube.
psql "$CLOUD_URL" <<'SQL'
UPDATE auth.users SET
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change = COALESCE(email_change, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, '');
SQL

echo "Listo. Verificando conteos..."
psql "$CLOUD_URL" -c "select 'auth.users' as tabla, count(*) from auth.users union all select 'auth.identities', count(*) from auth.identities union all select 'profiles', count(*) from public.profiles union all select 'tenants', count(*) from public.tenants union all select 'pickup_events', count(*) from public.pickup_events;"
