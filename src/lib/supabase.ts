import { createClient } from '@supabase/supabase-js';

// Captured before Supabase's client processes and strips the redirect params,
// so we can tell an invite/recovery link apart from a normal sign-in and
// prompt the user to set a password.
export const authRedirectType = (() => {
  if (typeof window === 'undefined') return null;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  return hashParams.get('type') || queryParams.get('type');
})();

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase environment variables.\n' +
    'Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your .env file.\n' +
    'See .env.example for reference.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Activity logging helper
export async function logActivity(
  type: string,
  description: string,
  name?: string,
  meta?: Record<string, unknown>,
  tenantId?: string
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      event_type: type,
      description,
      actor_name: name || 'Sistema Auto',
      metadata: meta || {},
      tenant_id: tenantId,
    });
  } catch (e) {
    console.error('Error logging activity:', e);
  }
}
