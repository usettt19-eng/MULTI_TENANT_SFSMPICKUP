-- Segunda vuelta del fix de RLS en Storage (ver fix_storage_super_admin.sql):
-- ese fix solo agregó la excepción `is_super_admin()`, pero dejó el mismo
-- problema para personal con acceso CONCEDIDO a otro colegio (tabla
-- staff_school_access) — su perfil "de casa" nunca va a tener el
-- tenant_id del colegio al que se le dio acceso, así que seguía bloqueado
-- al subir fotos ahí.
--
-- En vez de seguir agregando excepciones sueltas, se reemplaza la
-- comparación manual por `public.is_staff_of(tenant_id)` — la misma
-- función que ya usan las políticas de `students`/`profiles`
-- (tenant_isolation_rls.sql) y que YA contempla las tres situaciones:
-- personal nativo del colegio, acceso concedido vía staff_school_access,
-- y super_admin. Deja las políticas de Storage consistentes con el resto
-- de la base en vez de duplicar la lógica.

DROP POLICY IF EXISTS "Ver avatares del mismo tenant" ON storage.objects;
CREATE POLICY "Ver avatares del mismo tenant" ON storage.objects FOR SELECT USING (
  bucket_id = 'avatars'
  AND public.is_staff_of((storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "Subir avatares al propio tenant" ON storage.objects;
CREATE POLICY "Subir avatares al propio tenant" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
  AND public.is_staff_of((storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "Modificar avatares del propio tenant" ON storage.objects;
CREATE POLICY "Modificar avatares del propio tenant" ON storage.objects FOR UPDATE USING (
  bucket_id = 'avatars'
  AND public.is_staff_of((storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "Borrar avatares del propio tenant" ON storage.objects;
CREATE POLICY "Borrar avatares del propio tenant" ON storage.objects FOR DELETE USING (
  bucket_id = 'avatars'
  AND public.is_staff_of((storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "Ver detecciones del propio tenant" ON storage.objects;
CREATE POLICY "Ver detecciones del propio tenant" ON storage.objects FOR SELECT USING (
  bucket_id = 'detections'
  AND public.is_staff_of((storage.foldername(name))[1]::uuid)
);

DROP POLICY IF EXISTS "Subir detecciones al propio tenant" ON storage.objects;
CREATE POLICY "Subir detecciones al propio tenant" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'detections'
  AND auth.role() = 'authenticated'
  AND public.is_staff_of((storage.foldername(name))[1]::uuid)
);
