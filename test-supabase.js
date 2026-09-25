import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  const { data, error } = await supabase.from('asignaturas').select('id, nombre').limit(1);
  if (error) {
    console.error("Select error:", error);
    return;
  }
  if (!data || data.length === 0) {
    console.log("No data");
    return;
  }
  console.log("Found:", data[0]);
  const asigId = data[0].id;
  
  const { error: updError } = await supabase.from('asignaturas').update({ dias_semana: [1, 2] }).eq('id', asigId);
  if (updError) {
    console.error("Update error:", updError);
  } else {
    console.log("Update success!");
  }
}
test();
