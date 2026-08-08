-- ============================================================================
-- AISLAMIENTO ENTRE COLEGIOS + CIERRE DE ACCESO PÚBLICO
-- ============================================================================
--
-- Estado que corrige (verificado contra la base de producción):
--
--  1. ~30 políticas con `TO public USING (true)`. En Postgres `public` incluye
--     al rol `anon`, o sea la clave que viaja en el bundle JS. Cualquiera que
--     abriera la aplicación podía leer alertas de salud, medicación, incidentes,
--     perfiles y auditoría de LOS TRES COLEGIOS — y escribir en pickup_events,
--     medication_schedule, forms y school_settings.
--
--  2. Sin aislamiento por tenant: is_admin() devuelve true si eres admin en
--     CUALQUIER colegio.
--
--  3. La política de `tenants` usa una subconsulta escalar que lanzará
--     "more than one row" en cuanto un padre tenga hijos en dos colegios.
--
-- IMPORTANTE: las políticas PERMISSIVE se combinan con OR. Por eso este script
-- ELIMINA las existentes antes de crear las nuevas: añadir una política
-- estricta junto a una `USING (true)` no cierra nada.
--
-- ORDEN DE EJECUCIÓN:  Paso 0 (pre-vuelo) -> rellenar tenant_id -> Pasos 1..8
--
-- ============================================================================


-- ============================================================================
-- PASO 0 — PRE-VUELO. Solo lectura.
-- ============================================================================
-- Con RLS activo, `tenant_id IN (...)` sobre NULL da NULL: la fila NO se ve.
-- En la última revisión había 11 pickup_events, 39 audit_logs y 1 profile sin
-- tenant_id. RELLÉNALOS ANTES DE SEGUIR o desaparecerán de la aplicación.

DO $$
DECLARE t text; n bigint;
  tablas text[] := ARRAY[
    'audit_logs','camera_detections','compliance_action_items','compliance_resources',
    'compliance_status','daily_visitors','exit_doors','form_questions','form_responses',
    'forms','grade_doors','health_alerts','medication_schedule','notifications',
    'pickup_events','profiles','regulation_status','replacement_requests','school_grades',
    'school_settings','student_incidents','students','vehicles','wellness_logs'];
BEGIN
  RAISE NOTICE '--- Filas sin tenant_id (quedarían invisibles) ---';
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', t) INTO n;
    IF n > 0 THEN RAISE NOTICE '  %  %', rpad(t,26), n; END IF;
  END LOOP;
END $$;

-- Plantilla de relleno. Los colegios existentes son:
--   3cc8eb07-a7f8-40bd-9886-23ae86bf505f  Colegio Loyola
--   11d93213-5e22-430c-beb8-2f730cba3a97  Colegio Loyola 2
--   9543ac45-f058-4596-a7ee-e29191494190  The Casco School
--
-- Los datos huérfanos son anteriores a la migración multi-tenant, así que casi
-- con seguridad pertenecen al primer colegio. VERIFÍCALO antes de ejecutar:
--
--   UPDATE public.pickup_events SET tenant_id = '<colegio>' WHERE tenant_id IS NULL;
--   UPDATE public.audit_logs    SET tenant_id = '<colegio>' WHERE tenant_id IS NULL;
--   UPDATE public.profiles      SET tenant_id = '<colegio>' WHERE tenant_id IS NULL;


-- ============================================================================
-- PASO 1 — FUNCIONES AUXILIARES
-- ============================================================================
-- SECURITY DEFINER: para poder leer `profiles` desde una política sobre
--   `profiles` sin recursión infinita.
-- STABLE: el planificador las evalúa una vez por consulta (InitPlan), no por
--   fila. Es la diferencia entre escalar y no escalar.
-- SET search_path: obligatorio en SECURITY DEFINER; sin él la función es
--   manipulable. Es el aviso del Security Advisor sobre el is_admin() actual.

CREATE OR REPLACE FUNCTION public.user_tenant_ids()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT tenant_id FROM public.profiles
  WHERE id = auth.uid() AND tenant_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'super_admin');
$$;

-- Personal del colegio: admin, super_admin, o el flag is_staff que la
-- aplicación guarda dentro de additional_tutor_name (replicado tal cual de la
-- política "Staff can manage all requests" para no romper a esos usuarios).
CREATE OR REPLACE FUNCTION public.is_staff_of(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.tenant_id = p_tenant_id
      AND (p.role IN ('admin','super_admin')
        OR ((p.additional_tutor_name)::jsonb ->> 'is_staff')::boolean IS TRUE)
  ) OR public.is_super_admin();
$$;

-- ¿El usuario actual es tutor de este alumno? (vía parent_students)
CREATE OR REPLACE FUNCTION public.is_parent_of(p_student_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.parent_students
                 WHERE student_id = p_student_id AND parent_id = auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.user_tenant_ids(), public.is_super_admin(),
                           public.is_staff_of(uuid), public.is_parent_of(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_tenant_ids(), public.is_super_admin(),
                           public.is_staff_of(uuid), public.is_parent_of(uuid) TO authenticated;


-- ============================================================================
-- PASO 2 — ELIMINAR TODAS LAS POLÍTICAS EXISTENTES DE LAS TABLAS AFECTADAS
-- ============================================================================
-- Necesario: con OR entre políticas permisivas, dejar una `USING (true)` viva
-- anula todo lo demás.

DO $$
DECLARE r record; t text;
  tablas text[] := ARRAY[
    'audit_logs','camera_detections','compliance_action_items','compliance_resources',
    'compliance_status','daily_visitors','exit_doors','form_questions','form_responses',
    'forms','grade_doors','health_alerts','medication_schedule','notifications',
    'parent_students','pickup_events','profiles','regulation_status','replacement_requests',
    'school_grades','school_settings','student_incidents','students','tenants',
    'vehicles','wellness_logs'];
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies
           WHERE schemaname='public' AND tablename = ANY(tablas)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;

  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;


-- ============================================================================
-- PASO 3 — CONFIGURACIÓN DEL COLEGIO
-- ============================================================================
-- Lee cualquier miembro del colegio; escribe solo el personal.

DO $$
DECLARE t text;
  tablas text[] := ARRAY[
    'exit_doors','grade_doors','school_grades','school_settings','forms','form_questions',
    'compliance_action_items','compliance_resources','compliance_status','regulation_status'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format(
      'CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated
         USING (tenant_id IN (SELECT public.user_tenant_ids()))', t);
    EXECUTE format(
      'CREATE POLICY staff_write ON public.%I FOR ALL TO authenticated
         USING (public.is_staff_of(tenant_id)) WITH CHECK (public.is_staff_of(tenant_id))', t);
  END LOOP;
END $$;


-- ============================================================================
-- PASO 4 — DATOS DE ALUMNOS (vinculados por student_id)
-- ============================================================================
-- El personal ve todo su colegio; el padre SOLO a sus hijos. El aislamiento por
-- colegio no basta: un padre del Colegio A tampoco debe ver la medicación de
-- los demás alumnos del Colegio A.

DO $$
DECLARE t text;
  tablas text[] := ARRAY['health_alerts','medication_schedule','wellness_logs','student_incidents'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format(
      'CREATE POLICY parent_read_own_children ON public.%I FOR SELECT TO authenticated
         USING (tenant_id IN (SELECT public.user_tenant_ids())
                AND public.is_parent_of(student_id))', t);
    EXECUTE format(
      'CREATE POLICY staff_manage ON public.%I FOR ALL TO authenticated
         USING (public.is_staff_of(tenant_id)) WITH CHECK (public.is_staff_of(tenant_id))', t);
  END LOOP;
END $$;


-- ============================================================================
-- PASO 5 — DATOS PROPIOS DEL PADRE (vinculados por parent_id / user_id)
-- ============================================================================

DO $$
DECLARE t text;
  tablas text[] := ARRAY['pickup_events','form_responses','vehicles','replacement_requests'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format(
      'CREATE POLICY parent_own_rows ON public.%I FOR ALL TO authenticated
         USING (parent_id = auth.uid() AND tenant_id IN (SELECT public.user_tenant_ids()))
         WITH CHECK (parent_id = auth.uid() AND tenant_id IN (SELECT public.user_tenant_ids()))', t);
    EXECUTE format(
      'CREATE POLICY staff_manage ON public.%I FOR ALL TO authenticated
         USING (public.is_staff_of(tenant_id)) WITH CHECK (public.is_staff_of(tenant_id))', t);
  END LOOP;
END $$;

CREATE POLICY own_notifications ON public.notifications FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY staff_manage ON public.notifications FOR ALL TO authenticated
  USING (public.is_staff_of(tenant_id)) WITH CHECK (public.is_staff_of(tenant_id));


-- ============================================================================
-- PASO 6 — SOLO PERSONAL
-- ============================================================================
-- camera_detections guarda fotos de las puertas: nunca debe ser legible por
-- padres ni por anon. El webhook de las cámaras debe escribir con service_role
-- (que salta RLS), no con la clave anon.

CREATE POLICY staff_only ON public.camera_detections FOR ALL TO authenticated
  USING (public.is_staff_of(tenant_id)) WITH CHECK (public.is_staff_of(tenant_id));

CREATE POLICY staff_only ON public.daily_visitors FOR ALL TO authenticated
  USING (public.is_staff_of(tenant_id)) WITH CHECK (public.is_staff_of(tenant_id));

-- audit_logs: la aplicación escribe desde el navegador (logActivity), así que
-- cualquier miembro del colegio puede INSERTAR, pero solo el personal LEE.
-- El super_admin no es miembro de todos los colegios, pero debe poder registrar
-- actividad en cualquiera cuando entra a dar soporte.
CREATE POLICY member_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.user_tenant_ids()) OR public.is_super_admin());
CREATE POLICY staff_read ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_staff_of(tenant_id));


-- ============================================================================
-- PASO 7 — students, parent_students, profiles, tenants
-- ============================================================================

CREATE POLICY parent_read_own_children ON public.students FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.user_tenant_ids()) AND public.is_parent_of(id));
CREATE POLICY staff_manage ON public.students FOR ALL TO authenticated
  USING (public.is_staff_of(tenant_id)) WITH CHECK (public.is_staff_of(tenant_id));

-- parent_students no tiene tenant_id: el colegio se deduce del alumno.
CREATE POLICY parent_read_own_links ON public.parent_students FOR SELECT TO authenticated
  USING (parent_id = auth.uid());
CREATE POLICY staff_manage ON public.parent_students FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s
                 WHERE s.id = parent_students.student_id AND public.is_staff_of(s.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.students s
                 WHERE s.id = parent_students.student_id AND public.is_staff_of(s.tenant_id)));

-- profiles: el admin del Colegio A ve SOLO la fila de su tenant. No debe
-- enterarse de que ese padre también tiene hijos en el Colegio B (son
-- responsables de datos distintos).
CREATE POLICY own_profile ON public.profiles FOR ALL TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY staff_manage_tenant_profiles ON public.profiles FOR ALL TO authenticated
  USING (public.is_staff_of(tenant_id)) WITH CHECK (public.is_staff_of(tenant_id));

-- tenants: sustituye la subconsulta escalar por pertenencia (IN), que es lo que
-- permite al padre con hijos en varios colegios ver ambos sin que reviente.
CREATE POLICY member_read ON public.tenants FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_tenant_ids()));
CREATE POLICY super_admin_manage ON public.tenants FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


-- ============================================================================
-- PASO 8 — ÍNDICES
-- ============================================================================
-- Sin índice por tenant_id, RLS fuerza escaneos que crecen con el total GLOBAL
-- de filas, no con el tamaño del colegio.

DO $$
DECLARE t text;
  tablas text[] := ARRAY[
    'audit_logs','camera_detections','compliance_action_items','compliance_resources',
    'compliance_status','daily_visitors','exit_doors','form_questions','form_responses',
    'forms','grade_doors','health_alerts','medication_schedule','notifications',
    'pickup_events','profiles','regulation_status','replacement_requests','school_grades',
    'school_settings','student_incidents','students','vehicles','wellness_logs'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)',
                   'idx_'||t||'_tenant_id', t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_parent_students_parent  ON public.parent_students (parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_student ON public.parent_students (student_id);
CREATE INDEX IF NOT EXISTS idx_health_alerts_student       ON public.health_alerts (student_id);
CREATE INDEX IF NOT EXISTS idx_medication_schedule_student ON public.medication_schedule (student_id);
CREATE INDEX IF NOT EXISTS idx_wellness_logs_student       ON public.wellness_logs (student_id);
CREATE INDEX IF NOT EXISTS idx_student_incidents_student   ON public.student_incidents (student_id);


-- ============================================================================
-- PASO 9 — VERIFICACIÓN
-- ============================================================================

-- 9.a  No debe quedar NINGUNA política abierta a `public`/anon.
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND ('public' = ANY(roles) OR 'anon' = ANY(roles));

-- 9.b  No debe quedar ninguna con USING(true) o WITH CHECK(true).
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND (qual='true' OR with_check='true');

-- 9.c  Ninguna tabla con tenant_id sin RLS.
SELECT c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=false
  AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name=c.relname AND column_name='tenant_id');

-- 9.d  Ninguna política usando todavía is_admin() (sin comprobación de tenant).
SELECT tablename, policyname FROM pg_policies
WHERE schemaname='public' AND (qual ILIKE '%is_admin()%' OR with_check ILIKE '%is_admin()%');


-- ============================================================================
-- PASO 10 — OPCIONAL: habilitar de verdad el padre multi-colegio
-- ============================================================================
-- Hoy profiles tiene PRIMARY KEY (id), así que un usuario NO PUEDE tener una
-- fila por colegio: la funcionalidad multi-colegio que contempla AuthContext
-- no existe en la base. Esto lo habilita.
--
-- EJECUTAR SOLO DESPUÉS de rellenar el profile con tenant_id NULL: las
-- columnas de una PK son implícitamente NOT NULL y el ALTER fallaría.
--
--   ALTER TABLE public.profiles DROP CONSTRAINT profiles_pkey;
--   ALTER TABLE public.profiles ADD PRIMARY KEY (id, tenant_id);
--   ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_email_key;
--   ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_tenant_key UNIQUE (email, tenant_id);
