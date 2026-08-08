\pset pager off
CREATE OR REPLACE FUNCTION chk(d text, got bigint, want bigint) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN $2=$3 THEN '  PASA  ' ELSE '  FALLA ' END||rpad($1,58)||' got='||$2||' want='||$3 $$;

INSERT INTO tenants(id,name) VALUES
 ('3cc8eb07-a7f8-40bd-9886-23ae86bf505f','Colegio Loyola'),
 ('9543ac45-f058-4596-a7ee-e29191494190','The Casco School');
INSERT INTO profiles(id,tenant_id,email,role) VALUES
 ('a0000000-0000-0000-0000-000000000001','3cc8eb07-a7f8-40bd-9886-23ae86bf505f','papa@x','parent'),
 ('a0000000-0000-0000-0000-000000000002','3cc8eb07-a7f8-40bd-9886-23ae86bf505f','dir@x','admin'),
 ('a0000000-0000-0000-0000-000000000003','9543ac45-f058-4596-a7ee-e29191494190','otro@x','admin');
INSERT INTO students(id,nombre,tenant_id) VALUES
 ('50000000-0000-0000-0000-000000000001','Hijo del papa','3cc8eb07-a7f8-40bd-9886-23ae86bf505f'),
 ('50000000-0000-0000-0000-000000000002','Otro nino Loyola','3cc8eb07-a7f8-40bd-9886-23ae86bf505f'),
 ('50000000-0000-0000-0000-000000000003','Nino de Casco','9543ac45-f058-4596-a7ee-e29191494190');
INSERT INTO parent_students VALUES ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001');
INSERT INTO medication_schedule(nombre,student_id,tenant_id) VALUES
 ('Med hijo propio','50000000-0000-0000-0000-000000000001','3cc8eb07-a7f8-40bd-9886-23ae86bf505f'),
 ('Med otro nino','50000000-0000-0000-0000-000000000002','3cc8eb07-a7f8-40bd-9886-23ae86bf505f'),
 ('Med Casco','50000000-0000-0000-0000-000000000003','9543ac45-f058-4596-a7ee-e29191494190');
INSERT INTO health_alerts(nombre,student_id,tenant_id) VALUES ('Alergia','50000000-0000-0000-0000-000000000001','3cc8eb07-a7f8-40bd-9886-23ae86bf505f');
INSERT INTO pickup_events(nombre,parent_id,tenant_id) VALUES ('Recogida','a0000000-0000-0000-0000-000000000001','3cc8eb07-a7f8-40bd-9886-23ae86bf505f');

\echo ''
\echo '===== anon (la clave pública del bundle JS) ====='
SET request.jwt.claim.sub=''; SET ROLE anon;
SELECT chk('anon NO lee medicación de menores', (SELECT count(*) FROM medication_schedule),0);
SELECT chk('anon NO lee alertas de salud',      (SELECT count(*) FROM health_alerts),0);
SELECT chk('anon NO lee perfiles',              (SELECT count(*) FROM profiles),0);
SELECT chk('anon NO lee eventos de recogida',   (SELECT count(*) FROM pickup_events),0);
SELECT chk('anon NO lee alumnos',               (SELECT count(*) FROM students),0);
RESET ROLE;
\echo '  --- anon intenta MODIFICAR medicación: ---'
SET ROLE anon; UPDATE medication_schedule SET nombre='ALTERADO'; RESET ROLE;
SELECT chk('la medicación NO fue alterada', (SELECT count(*) FROM medication_schedule WHERE nombre='ALTERADO'),0);

\echo ''
\echo '===== padre del Colegio Loyola ====='
SET request.jwt.claim.sub='a0000000-0000-0000-0000-000000000001'; SET ROLE authenticated;
SELECT chk('padre ve SOLO la medicación de su hijo',(SELECT count(*) FROM medication_schedule),1);
SELECT chk('padre ve solo a su hijo',               (SELECT count(*) FROM students),1);
SELECT chk('padre ve su recogida',                  (SELECT count(*) FROM pickup_events),1);
SELECT chk('padre NO ve alumnos de otro colegio',
  (SELECT count(*) FROM students WHERE tenant_id='9543ac45-f058-4596-a7ee-e29191494190'),0);
RESET ROLE;

\echo ''
\echo '===== director del Colegio Loyola ====='
SET request.jwt.claim.sub='a0000000-0000-0000-0000-000000000002'; SET ROLE authenticated;
SELECT chk('director ve los 2 alumnos de SU colegio',(SELECT count(*) FROM students),2);
SELECT chk('director ve la medicación de su colegio',(SELECT count(*) FROM medication_schedule),2);
SELECT chk('director NO ve nada de The Casco School',
  (SELECT count(*) FROM students WHERE tenant_id='9543ac45-f058-4596-a7ee-e29191494190'),0);
RESET ROLE;

\echo ''
\echo '===== director de The Casco School ====='
SET request.jwt.claim.sub='a0000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT chk('solo ve su alumno',(SELECT count(*) FROM students),1);
UPDATE students SET nombre='HACKEADO' WHERE tenant_id='3cc8eb07-a7f8-40bd-9886-23ae86bf505f';
RESET ROLE;
SELECT chk('no pudo escribir en Loyola',(SELECT count(*) FROM students WHERE nombre='HACKEADO'),0);
