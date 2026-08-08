\pset pager off
-- super_admin registrado en Loyola, pero debe administrar TODOS los colegios
INSERT INTO profiles(id,tenant_id,email,role)
  VALUES ('a0000000-0000-0000-0000-0000000000ff','3cc8eb07-a7f8-40bd-9886-23ae86bf505f','sa@x','super_admin');
SET request.jwt.claim.sub='a0000000-0000-0000-0000-0000000000ff'; SET ROLE authenticated;
SELECT chk('super_admin ve los 3 alumnos de ambos colegios',(SELECT count(*) FROM students),3);
SELECT chk('super_admin ve toda la medicación',             (SELECT count(*) FROM medication_schedule),3);
SELECT chk('super_admin ve los 2 colegios',                 (SELECT count(*) FROM tenants),2);
SELECT chk('super_admin ve todos los perfiles',             (SELECT count(*) FROM profiles),4);
INSERT INTO audit_logs(nombre,tenant_id) VALUES ('soporte','9543ac45-f058-4596-a7ee-e29191494190');
SELECT chk('registra auditoría en colegio del que NO es miembro',
  (SELECT count(*) FROM audit_logs WHERE nombre='soporte'),1);
UPDATE students SET nombre='corregido' WHERE tenant_id='9543ac45-f058-4596-a7ee-e29191494190';
SELECT chk('puede corregir datos de otro colegio (mantenimiento)',
  (SELECT count(*) FROM students WHERE nombre='corregido'),1);
RESET ROLE;
