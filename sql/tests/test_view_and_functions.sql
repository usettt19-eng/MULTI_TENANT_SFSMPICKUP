\pset pager off
GRANT SELECT ON public.active_critical_medications TO anon, authenticated;
\echo '--- la vista, tras security_invoker = on ---'
SET request.jwt.claim.sub=''; SET ROLE anon;
SELECT chk('anon NO lee la vista de medicación crítica',(SELECT count(*) FROM active_critical_medications),0);
RESET ROLE;
SET request.jwt.claim.sub='a0000000-0000-0000-0000-000000000001'; SET ROLE authenticated;
SELECT chk('padre ve en la vista solo lo de su hijo',(SELECT count(*) FROM active_critical_medications),1);
RESET ROLE;
SET request.jwt.claim.sub='a0000000-0000-0000-0000-000000000003'; SET ROLE authenticated;
SELECT chk('director de otro colegio no ve nada ajeno',(SELECT count(*) FROM active_critical_medications WHERE tenant_id='3cc8eb07-a7f8-40bd-9886-23ae86bf505f'),0);
RESET ROLE;
\echo '--- funciones ya no invocables por anon ---'
SET ROLE anon;
SELECT public.is_admin();
