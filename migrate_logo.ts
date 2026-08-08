import 'dotenv/config';
import { Client } from 'pg';

async function migrate() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.VITE_SUPABASE_URL?.replace('https://', 'postgres://postgres:').replace('.supabase.co', ':5432/postgres');
  
  if (!dbUrl) {
    console.error("No database URL available");
    return;
  }
  
  console.log("Database URL prefix:", dbUrl.split('@')[0]);

  try {
     const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
     await client.connect();
     console.log("Connected to PostgreSQL");
     await client.query("ALTER TABLE public.school_settings ADD COLUMN IF NOT EXISTS logo_url text;");
     console.log("Added logo_url column to school_settings table.");
     await client.end();
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

migrate();
