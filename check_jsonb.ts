import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/?apikey=${process.env.VITE_SUPABASE_SERVICE_KEY}`);
  const data = await res.json();
  for (const [tableName, tableDef] of Object.entries(data.definitions)) {
    const props = (tableDef as any).properties;
    for (const [colName, colDef] of Object.entries(props)) {
      if ((colDef as any).format === 'jsonb') {
        console.log(`Table ${tableName} has jsonb column ${colName}`);
      }
    }
  }
}

check();
