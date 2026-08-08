import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_SERVICE_KEY!);

async function checkSchema() {
  const { data, error } = await supabase.from('student_incidents').select('*').limit(1);
  console.log('student_incidents:', data, error);
}

checkSchema();
