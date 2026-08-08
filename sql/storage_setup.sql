-- 1. Crear los buckets principales
INSERT INTO storage.buckets (id, name, public) 
VALUES 
  ('avatars', 'avatars', true),
  ('detections', 'detections', false)
ON CONFLICT (id) DO NOTHING;

-- ==========================================
-- POLÍTICAS PARA EL BUCKET 'AVATARS'
-- ==========================================

-- A) Los usuarios pueden VER avatares en su propio tenant (si el bucket fuera privado, pero al ser público esta política no restringe la lectura web, aunque es buena práctica tenerla)
CREATE POLICY "Ver avatares del mismo tenant" ON storage.objects FOR SELECT USING (
  bucket_id = 'avatars' 
  AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
);

-- B) Los usuarios pueden SUBIR avatares solo a la carpeta de su tenant
CREATE POLICY "Subir avatares al propio tenant" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'avatars' 
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
);

-- C) Los usuarios pueden ACTUALIZAR o BORRAR avatares solo en su tenant
CREATE POLICY "Modificar avatares del propio tenant" ON storage.objects FOR UPDATE USING (
  bucket_id = 'avatars' 
  AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Borrar avatares del propio tenant" ON storage.objects FOR DELETE USING (
  bucket_id = 'avatars' 
  AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
);

-- ==========================================
-- POLÍTICAS PARA EL BUCKET 'DETECTIONS' (Privado)
-- ==========================================

CREATE POLICY "Ver detecciones del propio tenant" ON storage.objects FOR SELECT USING (
  bucket_id = 'detections' 
  AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Subir detecciones al propio tenant" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'detections' 
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = (SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid())
);
