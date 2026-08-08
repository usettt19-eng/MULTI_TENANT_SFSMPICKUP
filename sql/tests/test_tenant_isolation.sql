\set ON_ERROR_STOP on
\pset pager off

-- ── Datos de prueba ─────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Colegio A'),
  ('22222222-2222-2222-2222-222222222222', 'Colegio B');

-- p1: padre solo en A.  p2: padre en A y B (el caso multi-colegio).
-- a1: admin de A.       sa: super_admin.
INSERT INTO public.profiles (id, tenant_id, email, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','p1@x.com','parent'),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','p2@x.com','parent'),
  ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','p2@x.com','parent'),
  ('aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','a1@x.com','admin'),
  ('aaaaaaaa-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','sa@x.com','super_admin');

INSERT INTO public.students (nombre, tenant_id) VALUES
  ('Alumno de A', '11111111-1111-1111-1111-111111111111'),
  ('Alumno de B', '22222222-2222-2222-2222-222222222222');

INSERT INTO public.camera_detections (nombre, tenant_id) VALUES
  ('Foto puerta A', '11111111-1111-1111-1111-111111111111'),
  ('Foto puerta B', '22222222-2222-2222-2222-222222222222');

CREATE OR REPLACE FUNCTION chk(descripcion text, obtenido bigint, esperado bigint)
RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN $2 = $3 THEN '  PASA  ' ELSE '  FALLA ' END
      || rpad($1, 62) || ' obtenido=' || $2 || ' esperado=' || $3;
$$;

\echo ''
\echo '=========== AISLAMIENTO ENTRE COLEGIOS ==========='

-- ── p1: padre SOLO en el Colegio A ──────────────────────────────────────────
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT chk('p1 (padre de A) ve alumnos', (SELECT count(*) FROM public.students), 1);
SELECT chk('p1 NO ve alumnos del Colegio B',
       (SELECT count(*) FROM public.students WHERE tenant_id='22222222-2222-2222-2222-222222222222'), 0);
SELECT chk('p1 NO ve fotos de cámara de B',
       (SELECT count(*) FROM public.camera_detections WHERE tenant_id='22222222-2222-2222-2222-222222222222'), 0);
RESET ROLE;

-- ── p2: padre con hijos en AMBOS colegios (el caso que motivó todo) ─────────
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT chk('p2 (hijos en A y B) ve alumnos de LOS DOS', (SELECT count(*) FROM public.students), 2);
RESET ROLE;

-- ── a1: admin del Colegio A ─────────────────────────────────────────────────
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
SET ROLE authenticated;
SELECT chk('admin de A ve alumnos solo de A', (SELECT count(*) FROM public.students), 1);
SELECT chk('admin de A NO ve perfiles del Colegio B',
       (SELECT count(*) FROM public.profiles WHERE tenant_id='22222222-2222-2222-2222-222222222222'), 0);
RESET ROLE;

-- ── super_admin ─────────────────────────────────────────────────────────────
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000004';
SET ROLE authenticated;
SELECT chk('super_admin ve los dos colegios', (SELECT count(*) FROM public.students), 2);
RESET ROLE;

-- ── anon: la clave pública que viaja en el bundle ───────────────────────────
SET request.jwt.claim.sub = '';
SET ROLE anon;
SELECT chk('anon NO lee fotos de cámara', (SELECT count(*) FROM public.camera_detections), 0);
SELECT chk('anon NO lee alumnos', (SELECT count(*) FROM public.students), 0);
RESET ROLE;

-- anon ya no puede insertar detecciones falsas (antes: WITH CHECK true).
SET ROLE anon;
\echo '  --- anon intentando insertar en camera_detections: ---'
INSERT INTO public.camera_detections (nombre, tenant_id)
  VALUES ('inyectada', '11111111-1111-1111-1111-111111111111');

-- ── admin de A intentando escribir en el Colegio B ──────────────────────────
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
SET ROLE authenticated;
UPDATE public.students SET nombre='HACKEADO' WHERE tenant_id='22222222-2222-2222-2222-222222222222';
RESET ROLE;
SELECT chk('el alumno de B sigue intacto',
  (SELECT count(*) FROM public.students WHERE nombre='HACKEADO'), 0);
