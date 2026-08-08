import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_SERVICE_KEY!);

async function checkSchema() {
  const { data, error } = await supabase.from('parent_students').select('*').limit(1);
  console.log('parent_students:', data, error);
}

checkSchema();
