-- Fix: Enable Row Level Security (RLS) on tables that have it disabled
ALTER TABLE public.parent_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- Note on "RLS references user metadata" on public.profiles:
-- Supabase Security Advisor flags policies that use `auth.jwt() -> 'user_metadata'` 
-- because user metadata can sometimes be modified by the user themselves via the Auth API,
-- or because JWT claims can be stale.
-- 
-- To fix this, you should review your policies on the `profiles` table.
-- You can find the offending policy by running:
-- SELECT polname, polqual, polwithcheck FROM pg_policy WHERE polrelid = 'public.profiles'::regclass;
--
-- If you are using user_metadata for roles (e.g., checking if a user is an admin),
-- it is recommended to use Custom Claims or store the role in the `profiles` table itself
-- and use a security definer function to check it, rather than relying on user_metadata in the policy.
