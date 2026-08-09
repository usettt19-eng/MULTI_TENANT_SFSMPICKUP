import {createClient} from '@supabase/supabase-js';
// supabase-js construye su RealtimeClient al llamar createClient(), aunque
// este servicio nunca abra un canal. Sin WebSocket nativo (Node < 22) eso
// lanza "Node.js detected but native WebSocket not found" y tumba el proceso
// antes de que Express llegue a escuchar. Mismo workaround que
// CRM-whatsapp-Softphone/server-db.ts.
import ws from 'ws';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Sin ellas el servicio no puede operar. Ver server/.env.example',
  );
  process.exit(1);
}

/**
 * Cliente con `service_role`: SALTA TODAS LAS POLÍTICAS RLS.
 *
 * Por eso cada endpoint comprueba por su cuenta quién llama y a qué colegio
 * pertenece (ver auth.ts). Esta clave no debe salir nunca de este proceso.
 */
export const admin = createClient(url, serviceKey, {
  auth: {autoRefreshToken: false, persistSession: false},
  realtime: {transport: ws as any},
});
