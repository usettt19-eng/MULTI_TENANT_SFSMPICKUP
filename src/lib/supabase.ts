import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase environment variables.\n' +
    'Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your .env file.\n' +
    'See .env.example for reference.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // PKCE exige que el enlace mágico se abra en el MISMO navegador que lo
    // pidió (el "code_verifier" vive en su localStorage). Los padres piden
    // el enlace desde el navegador y lo tocan desde la app de Correo/Gmail,
    // que casi siempre lo abre en otro contexto — el intercambio fallaba en
    // silencio y los mandaba sin sesión a la página inicial. Con 'implicit'
    // el token viaja directo en la URL del enlace, sin depender de nada
    // guardado localmente, así que funciona sin importar dónde se abra.
    flowType: 'implicit',
  },
});

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
