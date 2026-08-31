-- Las políticas de storage_setup.sql para el bucket 'avatars' (y
-- 'detections') solo comparaban la carpeta del archivo contra el
-- tenant_id del PROPIO perfil de quien sube — nunca se les agregó la
-- excepción `is_super_admin()` que sí tienen el resto de tablas desde
-- tenant_isolation_rls.sql. Un super_admin "configurando" otro colegio
-- (perfil propio sin tenant_id, o de un tenant distinto) no podía subir
-- fotos de alumnos/staff de ningún otro colegio: "new row violates
-- row-level security policy" al subir en TCS Costa del Este.

DROP POLICY IF EXISTS "Ver avatares del mismo tenant" ON storage.objects;
CREATE POLICY "Ver avatares del mismo tenant" ON storage.objects FOR SELECT USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
    OR public.is_super_admin()
  )
);

DROP POLICY IF EXISTS "Subir avatares al propio tenant" ON storage.objects;
CREATE POLICY "Subir avatares al propio tenant" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
  AND (
    (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
    OR public.is_super_admin()
  )
);

DROP POLICY IF EXISTS "Modificar avatares del propio tenant" ON storage.objects;
CREATE POLICY "Modificar avatares del propio tenant" ON storage.objects FOR UPDATE USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
    OR public.is_super_admin()
  )
);

DROP POLICY IF EXISTS "Borrar avatares del propio tenant" ON storage.objects;
CREATE POLICY "Borrar avatares del propio tenant" ON storage.objects FOR DELETE USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
    OR public.is_super_admin()
  )
);

DROP POLICY IF EXISTS "Ver detecciones del propio tenant" ON storage.objects;
CREATE POLICY "Ver detecciones del propio tenant" ON storage.objects FOR SELECT USING (
  bucket_id = 'detections'
  AND (
    (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
    OR public.is_super_admin()
  )
);

DROP POLICY IF EXISTS "Subir detecciones al propio tenant" ON storage.objects;
CREATE POLICY "Subir detecciones al propio tenant" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'detections'
  AND auth.role() = 'authenticated'
  AND (
    (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
    OR public.is_super_admin()
  )
);
