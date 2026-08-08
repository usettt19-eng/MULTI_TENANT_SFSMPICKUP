import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_SERVICE_KEY!);

async function checkRLS() {
  const { data } = await supabase.rpc('execute_sql', {
    sql_query: `SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'form_responses';`
  });
  console.log(data);
}
checkRLS();
