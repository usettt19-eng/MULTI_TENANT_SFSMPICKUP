\pset pager off
-- PASO 10: habilitar de verdad el padre con hijos en varios colegios
ALTER TABLE public.profiles DROP CONSTRAINT profiles_pkey;
ALTER TABLE public.profiles ADD PRIMARY KEY (id, tenant_id);

-- El mismo padre ahora también en The Casco School
INSERT INTO profiles(id,tenant_id,email,role) VALUES
 ('a0000000-0000-0000-0000-000000000001','9543ac45-f058-4596-a7ee-e29191494190','papa@x','parent');
INSERT INTO parent_students VALUES ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003');

SET request.jwt.claim.sub='a0000000-0000-0000-0000-000000000001'; SET ROLE authenticated;
SELECT chk('padre multi-colegio ve sus 2 hijos (uno por colegio)',(SELECT count(*) FROM students),2);
SELECT chk('padre multi-colegio ve los 2 colegios',(SELECT count(*) FROM tenants),2);
SELECT chk('sigue SIN ver al otro nino de Loyola',
  (SELECT count(*) FROM students WHERE nombre='Otro nino Loyola'),0);
SELECT chk('ve la medicación de sus 2 hijos, no la del resto',(SELECT count(*) FROM medication_schedule),2);
RESET ROLE;
