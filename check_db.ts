import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const dbUrl = process.env.VITE_SUPABASE_URL?.replace('https://', 'postgres://postgres:')?.replace('supabase.co', 'supabase.co:5432/postgres'); // Need real password but we only have anon and service key.
