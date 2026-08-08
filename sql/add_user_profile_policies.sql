-- 1. Permitir a los usuarios leer su propio perfil o el perfil que coincida con su email (para reclamar cuentas pre-creadas)
CREATE POLICY "Users can read own profile" 
ON public.profiles 
FOR SELECT 
TO authenticated 
USING (
  id = auth.uid() OR 
  email = (auth.jwt() ->> 'email')
);

-- 2. Permitir a los usuarios actualizar su propio perfil o el perfil que coincida con su email
CREATE POLICY "Users can update own profile" 
ON public.profiles 
FOR UPDATE 
TO authenticated 
USING (
  id = auth.uid() OR 
  email = (auth.jwt() ->> 'email')
)
WITH CHECK (
  id = auth.uid() OR 
  email = (auth.jwt() ->> 'email')
);

-- 3. Permitir a los usuarios insertar su propio perfil (necesario para el registro de nuevos usuarios)
CREATE POLICY "Users can insert own profile" 
ON public.profiles 
FOR INSERT 
TO authenticated 
WITH CHECK (id = auth.uid());

