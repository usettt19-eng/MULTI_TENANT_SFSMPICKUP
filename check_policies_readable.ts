import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function getPolicies() {
  const { data, error } = await supabase.rpc('execute_sql', {
    sql_query: `
      SELECT 
        polname, 
        pg_get_expr(polqual, polrelid) as qual, 
        pg_get_expr(polwithcheck, polrelid) as with_check 
      FROM pg_policy 
      WHERE polrelid = 'public.profiles'::regclass;
    `
  });

  if (error) {
    console.error('Error fetching policies:', error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

getPolicies();
