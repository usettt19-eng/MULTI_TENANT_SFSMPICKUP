-- Retiro anticipado de un alumno, iniciado por recepción/admin (ej. el niño
-- se siente mal, o el colegio pide que lo retiren por alguna situación
-- puntual) — no por el padre desde su app como el flujo normal.
--
-- Al crearse una fila, el backend (POST /api/tenants/:tenantId/early-withdrawals,
-- service_role) en un solo paso:
--   1. Avisa al/los encargado(s) de salida del salón del alumno hoy, para que
--      no lo esperen en la fila de salida regular.
--   2. Si el alumno va en una ruta de bus, lo excluye del bus de hoy
--      (bus_daily_exclusions, igual que "Hoy no va en bus" del padre) y avisa
--      al encargado de esa ruta.
--   3. Avisa al padre/tutor de que debe recogerlo ahora.
--
-- El registro de la fila (GET /api/parents/early-withdrawals-today) es lo que
-- usa ParentDashboard.tsx para saltarse el límite de las 11:00 am
-- (ANNOUNCE_ARRIVAL_MIN_HOUR) SOLO para este alumno puntual ese día — no
-- desactiva el límite para todo el colegio como el interruptor de Ajustes.
--
-- Sin políticas de lectura/escritura para `authenticated`: toda la tabla se
-- lee y escribe exclusivamente desde el backend con la clave service_role,
-- igual que bus_routes.profile_id o carpool_* en varios puntos — ni el padre
-- ni el staff tienen acceso directo por RLS, todo pasa por los endpoints
-- de arriba que ya validan quién puede hacer qué.
create table if not exists public.early_withdrawals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  reason text not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  bus_excluded boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists early_withdrawals_tenant_created_idx
  on public.early_withdrawals (tenant_id, created_at);
create index if not exists early_withdrawals_student_created_idx
  on public.early_withdrawals (student_id, created_at);

alter table public.early_withdrawals enable row level security;
