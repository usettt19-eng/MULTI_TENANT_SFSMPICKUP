import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkOperationsPickups() {
  // Let's pretend to execute exactly what OperationsDashboard executes, but with anon key? No, OperationsDashboard uses the user's auth key. Let's look up an admin user.
  const { data: profiles } = await supabase.from('profiles').select('*').eq('role', 'admin').limit(1);
  console.log('Admin:', profiles?.[0]);
}
checkOperationsPickups();
