// Vercel ejecuta esta función una vez al día (ver vercel.json). Hace una consulta mínima a Supabase
// para que el plan gratuito no pause el proyecto por inactividad (lo pausa tras 7 días sin uso,
// por ejemplo en vacaciones, y la web dejaría de funcionar hasta reactivarlo a mano).

// Son los mismos datos públicos que usa la web en el navegador (ver .env): no dan acceso a nada
// que no permitan las reglas de seguridad de la base de datos.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://rqjsjzteeolosbgqfwhp.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxanNqenRlZW9sb3NiZ3Fmd2hwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NTA1MjgsImV4cCI6MjEwNTIyNjUyOH0.iMKRcUQXljsppVHY38Q4P0Sq-bSEkYuLKYuB8FKSk5E';

export async function GET() {
  const respuesta = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hora_servidor`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  return Response.json({ ok: respuesta.ok, estado: respuesta.status });
}
