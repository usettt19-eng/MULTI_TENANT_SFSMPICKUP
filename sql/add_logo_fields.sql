ALTER TABLE public.school_settings ADD COLUMN IF NOT EXISTS logo_url text;

-- Create the logos bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

-- A) Los usuarios pueden VER logos de cualquier lado (es público)
CREATE POLICY "Ver logos" ON storage.objects FOR SELECT USING (
  bucket_id = 'logos' 
);

-- B) Los usuarios pueden SUBIR logos (sólo si están autenticados)
CREATE POLICY "Subir logos" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'logos' 
  AND auth.role() = 'authenticated'
);

-- C) Los usuarios pueden ACTUALIZAR o BORRAR logos
CREATE POLICY "Modificar logos" ON storage.objects FOR UPDATE USING (
  bucket_id = 'logos' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Borrar logos" ON storage.objects FOR DELETE USING (
  bucket_id = 'logos' 
  AND auth.role() = 'authenticated'
);
