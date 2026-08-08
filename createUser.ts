import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xvghravnzfcqkigsvefu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2Z2hyYXZuemZjcWtpZ3N2ZWZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjA4ODQsImV4cCI6MjA5MDg5Njg4NH0.z_HZjGFA9gmJaG-HNn4QUMp1XdkJmpuLJ15AaIFlPIg';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Creando usuario admin@smartpickup.com...");
  const { data, error } = await supabase.auth.signUp({
    email: 'admin@smartpickup.com',
    password: 'password123',
    options: {
      data: {
        first_name: 'Admin',
        last_name: 'SmartPickup'
      }
    }
  });

  if (error) {
    console.error("Error creating user:", error);
  } else {
    console.log("User created successfully. ID:", data.user?.id);
  }
}

main();
