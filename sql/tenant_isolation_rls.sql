-- ============================================================================
-- AISLAMIENTO ENTRE COLEGIOS (multi-tenant RLS)
-- ============================================================================
--
-- Completa lo que quedó comentado en multi_tenant_migration.sql y
-- multi_profile_support.sql: aplica las políticas de aislamiento a las tablas
-- de datos, no solo a `tenants`.
--
-- Soporta el caso de un padre con hijos en VARIOS colegios: la comprobación es
-- de PERTENENCIA (¿existe una fila en profiles que te vincule a este tenant?),
-- no de igualdad contra un único tenant. La subconsulta escalar del template
-- original —`tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())`—
-- lanzaría "more than one row returned by a subquery" en ese escenario.
--
-- ¡¡LEE EL PASO 0 ANTES DE EJECUTAR!! Aplicar esto con datos sin tenant_id
-- hace que esos datos desaparezcan de la aplicación.
--
-- ============================================================================


-- ============================================================================
-- PASO 0 — PRE-VUELO (solo lectura, no modifica nada)
-- ============================================================================
-- 0.a  Filas huérfanas: tenant_id se añadió como NULLABLE, así que las filas
--      anteriores a la migración multi-tenant lo tienen en NULL. Con RLS
--      activo, `tenant_id IN (...)` sobre NULL da NULL -> la fila NO se ve.
--      Si esta consulta devuelve conteos > 0, RELLENA tenant_id ANTES de seguir.

DO $$
DECLARE
  t text;
  n bigint;
  tablas text[] := ARRAY[
    'audit_logs','camera_detections','compliance_action_items','compliance_resources',
    'compliance_status','daily_visitors','exit_doors','form_questions','form_responses',
    'forms','grade_doors','health_alerts','medication_schedule','notifications',
    'pickup_events','profiles','regulation_status','replacement_requests','school_grades',
    'school_settings','student_incidents','students','vehicles','wellness_logs'
  ];
BEGIN
  RAISE NOTICE '--- Filas con tenant_id NULL (quedarían invisibles tras activar RLS) ---';
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', t) INTO n;
    IF n > 0 THEN
      RAISE NOTICE '  %: % filas SIN tenant_id', rpad(t, 26), n;
    END IF;
  END LOOP;
END $$;

-- 0.b  Políticas permisivas ya existentes. IMPORTANTE: las políticas PERMISSIVE
--      se combinan con OR. Añadir una política estricta NO cierra un agujero
--      abierto por otra ya existente — hay que ELIMINAR la vieja.
--      Revisa el resultado y borra a mano cualquier `qual` que sea `true`.

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;


-- ============================================================================
-- PASO 1 — FUNCIONES AUXILIARES
-- ============================================================================
-- SECURITY DEFINER: necesario para leer `profiles` desde una política sobre
--   `profiles` sin provocar recursión infinita.
-- STABLE: permite al planificador evaluarlas una vez por consulta (InitPlan)
--   en lugar de una vez por fila. Es la diferencia entre escalar y no escalar.
-- SET search_path: obligatorio en SECURITY DEFINER. Sin esto la función es
--   manipulable vía search_path — es el aviso que da el Security Advisor de
--   Supabase sobre is_admin() e is_admin_of() actuales.

-- Tenants a los que pertenece el usuario actual (0, 1 o N).
CREATE OR REPLACE FUNCTION public.user_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id
  FROM public.profiles
  WHERE id = auth.uid()
    AND tenant_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

-- Reemplaza a is_admin(): aquel devolvía true si el usuario era admin en
-- CUALQUIER colegio, lo que permitía a un admin del Colegio A operar sobre
-- los datos del Colegio B.
CREATE OR REPLACE FUNCTION public.is_admin_of(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND tenant_id = p_tenant_id
      AND role IN ('admin', 'super_admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_tenant_ids()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin()       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_of(uuid)      FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_tenant_ids()      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_super_admin()       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_admin_of(uuid)      TO authenticated;


-- ============================================================================
-- PASO 2 — POLÍTICAS PELIGROSAS QUE HAY QUE ELIMINAR PRIMERO
-- ============================================================================

-- camera_detections: hoy cualquier usuario autenticado de CUALQUIER colegio
-- puede leer todas las fotos de las puertas de TODOS los colegios (USING true),
-- y cualquiera con la clave anon —que viaja en el bundle público— puede
-- insertar registros arbitrarios (TO anon WITH CHECK true).
DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados" ON public.camera_detections;
DROP POLICY IF EXISTS "Permitir inserción desde el backend"      ON public.camera_detections;

-- profiles: is_admin() no comprueba tenant.
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins read all profiles"       ON public.profiles;


-- ============================================================================
-- PASO 3 — AISLAMIENTO EN LAS TABLAS DE DATOS (23 tablas)
-- ============================================================================
-- `profiles` se trata aparte en el paso 4.

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'audit_logs','camera_detections','compliance_action_items','compliance_resources',
    'compliance_status','daily_visitors','exit_doors','form_questions','form_responses',
    'forms','grade_doors','health_alerts','medication_schedule','notifications',
    'pickup_events','regulation_status','replacement_requests','school_grades',
    'school_settings','student_incidents','students','vehicles','wellness_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         FOR ALL TO authenticated
         USING      (tenant_id IN (SELECT public.user_tenant_ids()) OR public.is_super_admin())
         WITH CHECK (tenant_id IN (SELECT public.user_tenant_ids()) OR public.is_super_admin())',
      t);

    -- Sin este índice, RLS fuerza escaneos que crecen con el total GLOBAL de
    -- filas, no con el tamaño del colegio.
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)',
                   'idx_' || t || '_tenant_id', t);
  END LOOP;
END $$;


-- ============================================================================
-- PASO 4 — profiles
-- ============================================================================
-- Con PK (id, tenant_id), un mismo usuario tiene una fila por colegio. El
-- admin del Colegio A debe ver SOLO la fila de su tenant: no debe enterarse
-- de que ese padre también tiene hijos en el Colegio B (son responsables de
-- datos distintos).
--
-- Las políticas "Users can read/update/insert own profile" de
-- add_user_profile_policies.sql se conservan: son las que permiten el cambio
-- de colegio en la interfaz y el flujo de reclamar cuentas pre-creadas.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage profiles of their tenant" ON public.profiles;
CREATE POLICY "Admins manage profiles of their tenant" ON public.profiles
  FOR ALL TO authenticated
  USING      (public.is_admin_of(tenant_id) OR public.is_super_admin())
  WITH CHECK (public.is_admin_of(tenant_id) OR public.is_super_admin());

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id ON public.profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_id        ON public.profiles (id);


-- ============================================================================
-- PASO 5 — VERIFICACIÓN
-- ============================================================================

-- 5.a  Ninguna tabla con tenant_id debe quedarse sin RLS.
SELECT c.relname AS tabla, c.relrowsecurity AS rls_activo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = c.relname AND column_name = 'tenant_id'
  )
  AND c.relrowsecurity = false;

-- 5.b  Políticas que siguen abiertas de par en par (qual = true).
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true');

-- 5.c  Políticas que todavía usan la función sin tenant.
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual ILIKE '%is_admin()%' OR with_check ILIKE '%is_admin()%');


-- ============================================================================
-- PENDIENTE (requiere las columnas de parent_students)
-- ============================================================================
-- El aislamiento por colegio NO basta para los padres: un padre del Colegio A
-- tampoco debe ver a TODOS los alumnos del Colegio A, solo a sus hijos.
-- Falta una segunda capa sobre parent_students, del estilo:
--
--   CREATE POLICY students_parent_scope ON public.students
--     FOR SELECT TO authenticated
--     USING (
--       public.is_admin_of(tenant_id)                 -- personal: todo su colegio
--       OR EXISTS (                                   -- padre: solo sus hijos
--         SELECT 1 FROM public.parent_students ps
--         WHERE ps.student_id = students.id AND ps.parent_id = auth.uid()
--       )
--     );
--
-- Y entonces `tenant_isolation` en `students` debería pasar de FOR ALL a los
-- comandos de escritura, dejando el SELECT a la política de arriba.
