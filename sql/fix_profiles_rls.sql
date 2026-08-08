-- 1. Crear una función segura para verificar si el usuario es administrador
-- Usamos SECURITY DEFINER para que la función pueda leer la tabla profiles sin causar un bucle infinito
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Eliminar las políticas actuales que usan user_metadata
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;

-- 3. Recrear las políticas usando la nueva función segura
CREATE POLICY "Admins can manage all profiles" 
ON public.profiles 
FOR ALL 
TO authenticated 
USING (public.is_admin()) 
WITH CHECK (public.is_admin());

CREATE POLICY "Admins read all profiles" 
ON public.profiles 
FOR SELECT 
TO authenticated 
USING (public.is_admin());
