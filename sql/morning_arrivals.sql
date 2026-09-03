-- Registro histórico (solo agrega, nunca sobreescribe) de llegadas
-- matutinas de padres al perímetro del colegio.
--
-- A diferencia de parent_presence (una sola fila por padre, que se
-- sobreescribe en cada cambio de dentro/fuera), esta tabla conserva cada
-- llegada de la mañana como una fila permanente — necesaria para la
-- pantalla de Llegadas Diarias, que permite ver historial de días
-- anteriores por sección, no solo el estado actual.

create table if not exists public.morning_arrivals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  arrived_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists morning_arrivals_tenant_arrived_idx
  on public.morning_arrivals (tenant_id, arrived_at);

alter table public.morning_arrivals enable row level security;

-- Mismo patrón que audit_logs (ver tenant_isolation_rls.sql PASO 6): el
-- navegador del propio padre inserta su llegada, pero solo el personal
-- puede leer el registro.
create policy member_insert on public.morning_arrivals for insert to authenticated
  with check (tenant_id in (select public.user_tenant_ids()) or public.is_super_admin());
create policy staff_read on public.morning_arrivals for select to authenticated
  using (public.is_staff_of(tenant_id));
