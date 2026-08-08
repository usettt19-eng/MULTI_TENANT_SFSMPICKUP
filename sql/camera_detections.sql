-- 1. Crear tabla para almacenar los eventos de detección
CREATE TABLE IF NOT EXISTS camera_detections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  door_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Habilitar RLS (Seguridad a nivel de fila)
ALTER TABLE camera_detections ENABLE ROW LEVEL SECURITY;

-- 3. Crear política para permitir lectura a usuarios autenticados
CREATE POLICY "Permitir lectura a usuarios autenticados" ON camera_detections
  FOR SELECT
  TO authenticated
  USING (true);

-- 4. Crear política para permitir inserción desde el backend (webhook)
-- Nota: Si el webhook usa la anon key, asegúrate de que esta política sea correcta
CREATE POLICY "Permitir inserción desde el backend" ON camera_detections
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 5. Nota sobre el Bucket:
-- Debes crear manualmente el bucket 'camera_detections' en Supabase Storage
-- y configurar las políticas de acceso (Storage Policies) para permitir:
-- SELECT (lectura) a usuarios autenticados
-- INSERT (escritura) a usuarios autenticados/anon (según tu configuración de webhook)
