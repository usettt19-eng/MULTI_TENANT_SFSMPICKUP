import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_SERVICE_KEY!);

async function check() {
  const { data, error } = await supabase.from('exit_doors').insert([{name: 'Test'}]).select();
  console.log('Insert exit_doors:', data, error);
  
  const { data: d2, error: e2 } = await supabase.from('school_grades').insert([{name: 'Test', level_order: 99}]).select();
  console.log('Insert school_grades:', d2, e2);
}

check();
