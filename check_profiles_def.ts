import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/?apikey=${process.env.VITE_SUPABASE_SERVICE_KEY}`);
  const data = await res.json();
  console.log(data.definitions.profiles.properties);
}

check();
