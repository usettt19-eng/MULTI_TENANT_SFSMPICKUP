import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

async function getSchema() {
  const url = process.env.VITE_SUPABASE_URL + '/rest/v1/?apikey=' + process.env.VITE_SUPABASE_SERVICE_KEY;
  const res = await fetch(url);
  const json = await res.json();
  console.log(Object.keys(json.paths).filter(p => p.startsWith('/rpc')));
}
getSchema();
