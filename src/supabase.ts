import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan las variables de entorno de Supabase en el archivo .env');
}

// Los enlaces de los correos (confirmar cuenta, cambiar contraseña) llegan con datos tras el "#".
// Supabase los borra de la barra de direcciones al arrancar, así que los guardamos antes.
export const hashInicial = window.location.hash;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
