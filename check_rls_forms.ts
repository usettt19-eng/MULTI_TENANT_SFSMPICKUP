import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_SERVICE_KEY!);

async function checkPolicies() {
  const { data, error } = await supabase.from('form_responses').select('*').limit(1);
  console.log("Admin can read:", data?.length);
  
  // Since we can't execute postgres functions directly without a function defined,
  // let's just create a quick migration file to add the missing RLS policies for form_responses.
}
checkPolicies();
