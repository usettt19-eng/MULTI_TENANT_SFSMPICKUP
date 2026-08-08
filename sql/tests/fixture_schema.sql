-- Fixture que imita el esquema de SFSMPICKUP lo suficiente para probar RLS.
CREATE SCHEMA IF NOT EXISTS auth;

-- auth.uid() de Supabase: lee el claim `sub` del JWT de la sesión.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TYPE user_role AS ENUM ('parent','staff','admin','super_admin');

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

-- PK compuesta (id, tenant_id): un usuario, una fila por colegio.
CREATE TABLE public.profiles (
  id        uuid NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  email     text,
  role      user_role NOT NULL DEFAULT 'parent',
  PRIMARY KEY (id, tenant_id)
);

-- Las 23 tablas de datos restantes.
DO $$
DECLARE t text;
  tablas text[] := ARRAY[
    'audit_logs','camera_detections','compliance_action_items','compliance_resources',
    'compliance_status','daily_visitors','exit_doors','form_questions','form_responses',
    'forms','grade_doors','health_alerts','medication_schedule','notifications',
    'pickup_events','regulation_status','replacement_requests','school_grades',
    'school_settings','student_incidents','students','vehicles','wellness_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format(
      'CREATE TABLE public.%I (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         nombre text,
         tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE)', t);
  END LOOP;
END $$;

-- Estado ACTUAL del repo: las políticas peligrosas que hay que eliminar.
ALTER TABLE public.camera_detections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir lectura a usuarios autenticados" ON public.camera_detections
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir inserción desde el backend" ON public.camera_detections
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- is_admin() sin comprobación de tenant, tal como está hoy.
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage all profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR email = (current_setting('request.jwt.claim.email', true)));

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;
