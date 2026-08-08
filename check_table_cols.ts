import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCols(table: string) {
  const { data, error } = await supabase.from(table).select('tenant_id').limit(1);
  if (error) {
    console.error(`Error on ${table}:`, error.message);
  } else {
    console.log(`${table} has tenant_id column!`);
  }
}

async function run() {
  await checkCols('forms');
  await checkCols('form_responses');
  await checkCols('replacement_requests');
  await checkCols('pickup_events');
}
run();
