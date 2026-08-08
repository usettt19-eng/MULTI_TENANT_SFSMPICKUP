import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRLS() {
  const { data, error } = await supabase.rpc('execute_sql', {
    sql_query: `
      SELECT polname, polcmd, polroles, polqual, polwithcheck
      FROM pg_policy
      WHERE polrelid = 'form_responses'::regclass;
    `
  });
  console.log(data || error);
}
checkRLS();
