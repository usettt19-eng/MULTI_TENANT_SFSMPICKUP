import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_SERVICE_KEY!);

async function checkSchema() {
  const { data, error } = await supabase.rpc('get_schema', { table_name: 'notifications' });
  if (error) {
    console.error('RPC Error:', error.message);
    // Fallback: insert a dummy record and see the error
    const { error: insertError } = await supabase.from('notifications').insert({ dummy: 'data' });
    console.log('Insert error:', insertError);
  } else {
    console.log('Schema:', data);
  }
}

checkSchema();
