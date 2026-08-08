-- Multi-Profile Support for Parents in multiple schools
-- This script allows a single user (auth.uid) to have distinct profiles in different tenants.

-- 1. Modify Primary Key of profiles
-- Note: You might need to find the name of the constraint first, usually 'profiles_pkey'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_pkey;
ALTER TABLE public.profiles ADD PRIMARY KEY (id, tenant_id);

-- 2. Modify Unique constraint on email (if exists)
-- This allows the same email to be used in different schools
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_email_key;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_tenant_key UNIQUE (email, tenant_id);

-- 3. Update RLS policies to handle multiple profiles
-- Many policies use a subquery like (SELECT tenant_id FROM profiles WHERE id = auth.uid())
-- which will return multiple rows for a multi-school parent.

-- Example: Fix 'Users can view their own tenant' policy
DROP POLICY IF EXISTS "Users can view their own tenant" ON public.tenants;
CREATE POLICY "Users can view their own tenant" ON public.tenants FOR SELECT USING (
  id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

-- Example: Fix other tables if they use the single-row subquery logic
-- For example, if you have a policy on 'students' that looks up the tenant:
-- DROP POLICY IF EXISTS "Users can only see students in their tenant" ON public.students;
-- CREATE POLICY "Users can only see students in their tenant" ON public.students FOR ALL USING (
--   tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
-- );

-- 4. Fix is_admin() function if it's used for tenant-specific checks
-- Currently is_admin() checks if the user is admin in ANY school.
-- For stricter security, most checks should now include a tenant_id filter.
CREATE OR REPLACE FUNCTION public.is_admin_of(p_tenant_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND tenant_id = p_tenant_id AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
