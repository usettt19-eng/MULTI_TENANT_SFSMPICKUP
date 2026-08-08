import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
      .from('pickup_events')
      .select('*, student:students(first_name, tenant_id)')
      .eq('parent_id', '70a38fe6-08cb-4442-b310-17cda0693f4b')
      .eq('tenant_id', '9543ac45-f058-4596-a7ee-e29191494190')
      .in('status', ['announced', 'in_queue', 'released']);
      
  console.log(JSON.stringify(data, null, 2));
  console.log(error);
}

check();
