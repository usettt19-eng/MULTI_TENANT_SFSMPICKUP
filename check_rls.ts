import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_SERVICE_KEY!);

async function check() {
  const { data, error } = await supabase.rpc('exec_sql', { sql: 'SELECT relname, relrowsecurity FROM pg_class WHERE relname IN (\'exit_doors\', \'school_grades\', \'grade_doors\');' });
  console.log(data, error);
}

check();
