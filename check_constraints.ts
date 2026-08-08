import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkConstraints() {
  const { data, error } = await supabase.rpc('execute_sql', {
    sql_query: `
      SELECT
          conname as constraint_name,
          contype as constraint_type,
          pg_get_constraintdef(c.oid) as constraint_definition
      FROM
          pg_constraint c
      JOIN
          pg_namespace n ON n.oid = c.connamespace
      WHERE
          contype IN ('p', 'u')
          AND conrelid = 'public.profiles'::regclass;
    `
  });

  if (error) {
    console.error('Error fetching constraints:', error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

checkConstraints();
