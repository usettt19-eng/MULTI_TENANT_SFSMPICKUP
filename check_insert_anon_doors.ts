import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

async function check() {
  const { data, error } = await supabase.from('exit_doors').insert([{name: 'Test Anon'}]).select();
  console.log('Insert exit_doors anon:', data, error);
}

check();
