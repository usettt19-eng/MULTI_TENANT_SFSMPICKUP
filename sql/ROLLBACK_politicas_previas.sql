-- ============================================================================
-- ROLLBACK — políticas RLS tal como estaban ANTES de tenant_isolation_rls.sql
-- ============================================================================
-- Volcado de pg_policies del proyecto fvzhfzogigewsvcyopel el 2026-08-08,
-- justo antes de aplicar el aislamiento entre colegios.
--
-- ADVERTENCIA: restaurar esto REABRE la fuga. Muchas de estas políticas están
-- definidas TO public (que incluye al rol anon, la clave del bundle JS) con
-- USING(true), dejando legibles por cualquiera la medicación, las alertas de
-- salud, los incidentes y los perfiles de todos los colegios.
--
-- Uso previsto: emergencia, si la aplicación queda inutilizable tras la
-- migración y hace falta volver atrás mientras se diagnostica. Restaurar solo
-- lo estrictamente necesario, no el archivo entero.
--
-- Antes de aplicar esto hay que eliminar las políticas nuevas:
--   DO $$ DECLARE r record; BEGIN
--     FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'
--     LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
--     END LOOP; END $$;
-- ============================================================================

CREATE POLICY "Admin Read Logs" ON public.audit_logs AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Solo administradores pueden ver logs" ON public.audit_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))));
CREATE POLICY "System Insert Logs" ON public.audit_logs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);
CREATE POLICY "Permitir inserción desde el backend" ON public.camera_detections AS PERMISSIVE FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Permitir lectura a usuarios autenticados" ON public.camera_detections AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Permitir inserción de visitantes al personal" ON public.daily_visitors AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "Permitir lectura de visitantes al personal" ON public.daily_visitors AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "Permitir escritura a usuarios autenticados" ON public.exit_doors AS PERMISSIVE FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Permitir lectura a usuarios autenticados" ON public.exit_doors AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admin Insert Questions" ON public.form_questions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);
CREATE POLICY "Public Read Questions" ON public.form_questions AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Admin Read All Responses" ON public.form_responses AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Parents Insert Responses" ON public.form_responses AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);
CREATE POLICY "Parents Read Own Responses" ON public.form_responses AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = parent_id));
CREATE POLICY "Admin Insert Forms" ON public.forms AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);
CREATE POLICY "Admin Update Forms" ON public.forms AS PERMISSIVE FOR UPDATE TO public
  USING (true);
CREATE POLICY "Public Read Forms" ON public.forms AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Permitir escritura a usuarios autenticados" ON public.grade_doors AS PERMISSIVE FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Permitir lectura a usuarios autenticados" ON public.grade_doors AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Public Read Health Alerts" ON public.health_alerts AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Permitir actualización a usuarios autenticados" ON public.medication_schedule AS PERMISSIVE FOR UPDATE TO authenticated
  USING (true);
CREATE POLICY "Permitir eliminación a usuarios autenticados" ON public.medication_schedule AS PERMISSIVE FOR DELETE TO authenticated
  USING (true);
CREATE POLICY "Permitir inserción a usuarios autenticados" ON public.medication_schedule AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Permitir lectura a usuarios autenticados" ON public.medication_schedule AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Public Read Medication" ON public.medication_schedule AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Update Medication Status" ON public.medication_schedule AS PERMISSIVE FOR UPDATE TO public
  USING (true);
CREATE POLICY "System can insert notifications" ON public.notifications AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);
CREATE POLICY "Users can delete their own notifications" ON public.notifications AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can read own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "Admins manage all parent_students" ON public.parent_students AS PERMISSIVE FOR ALL TO public
  USING (is_admin());
CREATE POLICY "Admins pueden gestionar todos los vínculos" ON public.parent_students AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::user_role)))));
CREATE POLICY "Padres pueden ver sus propios vínculos" ON public.parent_students AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = parent_id));
CREATE POLICY "Parents read own parent_students" ON public.parent_students AS PERMISSIVE FOR SELECT TO public
  USING ((parent_id = auth.uid()));
CREATE POLICY "Admin CRUD Pickup Events" ON public.pickup_events AS PERMISSIVE FOR ALL TO public
  USING (true);
CREATE POLICY "Admins manage all pickups" ON public.pickup_events AS PERMISSIVE FOR ALL TO public
  USING (is_admin());
CREATE POLICY "Parents manage own pickups" ON public.pickup_events AS PERMISSIVE FOR ALL TO public
  USING ((parent_id = auth.uid()));
CREATE POLICY "Admins can manage all profiles" ON public.profiles AS PERMISSIVE FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admins read all profiles" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Users can read own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = id));
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = id));
CREATE POLICY "Parents can manage their own requests" ON public.replacement_requests AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = parent_id));
CREATE POLICY "Staff can manage all requests" ON public.replacement_requests AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.role = 'admin'::user_role) OR ((((profiles.additional_tutor_name)::jsonb ->> 'is_staff'::text))::boolean = true))))));
CREATE POLICY "Permitir escritura a usuarios autenticados" ON public.school_grades AS PERMISSIVE FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Permitir lectura a usuarios autenticados" ON public.school_grades AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admin Update Settings" ON public.school_settings AS PERMISSIVE FOR ALL TO public
  USING (true);
CREATE POLICY "Public Read Settings" ON public.school_settings AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Permitir insercion de incidentes" ON public.student_incidents AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);
CREATE POLICY "Permitir ver incidentes" ON public.student_incidents AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Admins manage all students" ON public.students AS PERMISSIVE FOR ALL TO public
  USING (is_admin());
CREATE POLICY "Parents read own students" ON public.students AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM parent_students WHERE ((parent_students.student_id = students.id) AND (parent_students.parent_id = auth.uid())))));
CREATE POLICY "Super admins can manage tenants" ON public.tenants AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'super_admin'::user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'super_admin'::user_role)))));
CREATE POLICY "Users can view their own tenant" ON public.tenants AS PERMISSIVE FOR SELECT TO public
  USING ((id = ( SELECT profiles.tenant_id FROM profiles WHERE (profiles.id = auth.uid()))));
CREATE POLICY "Admins can manage all vehicles" ON public.vehicles AS PERMISSIVE FOR ALL TO authenticated
  USING (true);
CREATE POLICY "Admins manage all vehicles" ON public.vehicles AS PERMISSIVE FOR ALL TO public
  USING (is_admin());
CREATE POLICY "Parents manage own vehicles" ON public.vehicles AS PERMISSIVE FOR ALL TO public
  USING ((parent_id = auth.uid()));
CREATE POLICY "Permitir insercion de registros de bienestar" ON public.wellness_logs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (true);
CREATE POLICY "Public Read Wellness Logs" ON public.wellness_logs AS PERMISSIVE FOR SELECT TO public
  USING (true);
