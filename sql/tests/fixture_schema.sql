-- Fixture que replica el esquema y las POLÍTICAS REALES de producción
-- (volcadas de pg_policies) para poder probar la migración antes de aplicarla.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('request.jwt.claim.role', true), 'anon') $$;

CREATE TYPE user_role AS ENUM ('parent','admin','super_admin');
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,                              -- PK real hoy: solo (id)
  tenant_id uuid REFERENCES public.tenants(id),
  email text,
  role user_role NOT NULL DEFAULT 'parent',
  additional_tutor_name text                        -- guarda {"is_staff":true}
);

CREATE TABLE public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text,
  tenant_id uuid REFERENCES public.tenants(id));

CREATE TABLE public.parent_students (              -- sin tenant_id
  parent_id uuid NOT NULL, student_id uuid NOT NULL);

-- Vinculadas por student_id
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['health_alerts','medication_schedule','wellness_logs','student_incidents'] LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nombre text, student_id uuid REFERENCES public.students(id),
      tenant_id uuid REFERENCES public.tenants(id))', t);
  END LOOP;
-- Vinculadas por parent_id
  FOREACH t IN ARRAY ARRAY['pickup_events','form_responses','vehicles','replacement_requests'] LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nombre text, parent_id uuid, tenant_id uuid REFERENCES public.tenants(id))', t);
  END LOOP;
-- Solo tenant_id
  FOREACH t IN ARRAY ARRAY['audit_logs','camera_detections','compliance_action_items',
      'compliance_resources','compliance_status','daily_visitors','exit_doors','form_questions',
      'forms','grade_doors','regulation_status','school_grades','school_settings'] LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nombre text, tenant_id uuid REFERENCES public.tenants(id))', t);
  END LOOP;
END $$;

CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text, user_id uuid, tenant_id uuid REFERENCES public.tenants(id));

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role='admin');
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Políticas REALES de producción, tal como están hoy ──────────────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs','camera_detections','compliance_action_items',
    'compliance_resources','compliance_status','daily_visitors','exit_doors','form_questions',
    'form_responses','forms','grade_doors','health_alerts','medication_schedule','notifications',
    'parent_students','pickup_events','profiles','regulation_status','replacement_requests',
    'school_grades','school_settings','student_incidents','students','tenants','vehicles',
    'wellness_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Las abiertas a `public` (= incluye anon), que son la fuga:
CREATE POLICY "Admin Read Logs"            ON public.audit_logs          FOR SELECT USING (true);
CREATE POLICY "Public Read Health Alerts"  ON public.health_alerts       FOR SELECT USING (true);
CREATE POLICY "Public Read Medication"     ON public.medication_schedule FOR SELECT USING (true);
CREATE POLICY "Update Medication Status"   ON public.medication_schedule FOR UPDATE USING (true);
CREATE POLICY "Permitir ver incidentes"    ON public.student_incidents   FOR SELECT USING (true);
CREATE POLICY "Public Read Wellness Logs"  ON public.wellness_logs       FOR SELECT USING (true);
CREATE POLICY "Admin CRUD Pickup Events"   ON public.pickup_events       FOR ALL    USING (true);
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Admin Read All Responses"   ON public.form_responses      FOR SELECT USING (true);
CREATE POLICY "Public Read Forms"          ON public.forms               FOR SELECT USING (true);
CREATE POLICY "Admin Update Forms"         ON public.forms               FOR UPDATE USING (true);
CREATE POLICY "Public Read Questions"      ON public.form_questions      FOR SELECT USING (true);
CREATE POLICY "Public Read Settings"       ON public.school_settings     FOR SELECT USING (true);
CREATE POLICY "Admin Update Settings"      ON public.school_settings     FOR ALL    USING (true);
CREATE POLICY "Permitir lectura a usuarios autenticados" ON public.camera_detections
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir inserción desde el backend" ON public.camera_detections
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Admins manage all students" ON public.students FOR ALL USING (public.is_admin());
CREATE POLICY "Parents read own students"  ON public.students FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.parent_students
  WHERE parent_students.student_id = students.id AND parent_students.parent_id = auth.uid()));
CREATE POLICY "Admins can manage all profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.is_admin());
CREATE POLICY "Users can view their own tenant" ON public.tenants FOR SELECT USING (
  id = (SELECT profiles.tenant_id FROM public.profiles WHERE profiles.id = auth.uid()));


-- Vista y funciones reales que el Security Advisor marcó
CREATE VIEW public.active_critical_medications AS
  SELECT ms.id, ms.nombre, s.id AS student_id, s.nombre AS alumno, ms.tenant_id
  FROM public.medication_schedule ms JOIN public.students s ON s.id = ms.student_id;

CREATE OR REPLACE FUNCTION public.create_critical_alert_for_med_schedule()
RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN NULL; END; $fn$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$ BEGIN NULL; END; $fn$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
BEGIN
  INSERT INTO public.profiles (id, role) VALUES (new.id, 'parent');
  RETURN new;
END; $fn$;

GRANT SELECT ON public.active_critical_medications TO anon, authenticated;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;
