-- Ejecute este script en el SQL Editor de Supabase
-- Habilitar RLS en tenants si no está habilitado
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Evitar posibles errores de políticas duplicadas
DROP POLICY IF EXISTS "Super admins can manage tenants" ON public.tenants;
DROP POLICY IF EXISTS "Users can view their own tenant" ON public.tenants;

-- Permitir a los super_admin realizar TODAS las operaciones (INSERT, SELECT, UPDATE, DELETE) sobre los tenants
CREATE POLICY "Super admins can manage tenants" ON public.tenants FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'super_admin'
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'super_admin'
  )
);

-- Permitir a los usuarios regulares ver solo el tenant al que pertenecen
CREATE POLICY "Users can view their own tenant" ON public.tenants FOR SELECT USING (
  id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);
