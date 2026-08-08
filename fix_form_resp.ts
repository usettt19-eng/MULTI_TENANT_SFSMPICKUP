import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixTenantIds() {
  const { data: responses, error } = await supabase.from('form_responses').select('id, form_id');
  if (error) {
    console.error(error);
    return;
  }
  
  for (const resp of responses) {
    const { data: form } = await supabase.from('forms').select('tenant_id').eq('id', resp.form_id).single();
    if (form && form.tenant_id) {
       await supabase.from('form_responses').update({ tenant_id: form.tenant_id }).eq('id', resp.id);
    }
  }
  console.log('Done fixing form_responses');
}
fixTenantIds();
