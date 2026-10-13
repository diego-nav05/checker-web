# Checker

Web para pasar lista en clase con códigos QR.

- **Profesorado**: abre una clase y proyecta un QR que cambia cada 5 segundos. Los alumnos lo escanean al entrar y, si el profe activa la fase de salida, también al salir.
- **Alumnado**: cada alumno vincula su móvil a su cuenta y escanea el QR desde la web.
- **Gestión**: asignaturas, lista de alumnos, altas de alumnos sin cuenta, liberar móviles y exportar a Excel o Google Sheets.

Hecho con React + TypeScript + Vite + Tailwind. La base de datos y las cuentas están en Supabase y la web se publica en Vercel.

## Arrancar en local

```bash
npm install
npm run dev
```

Necesita un archivo `.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Para probar contra el proyecto de pruebas sin tocar los datos reales, crea un `.env.local` con los datos de `checker-db-pruebas` (git lo ignora y tiene prioridad sobre `.env`).

## Cómo funcionan las cuentas

- **Vinculación del móvil**: al iniciar sesión, el alumno queda vinculado a ese navegador mediante un identificador aleatorio, con la huella del navegador como respaldo. Si cambia de móvil o de navegador, un profe lo libera en *Gestión → Alumnos*.
- **Alumnos sin clase**: al final de *Gestión → Alumnos* aparecen los que tienen cuenta pero no están en ninguna clase. Suelen ser los que tienen problemas para entrar.
- **Altas forzosas**: el profe puede añadir a un alumno solo con su nombre (el correo es opcional).
  - Con correo: cuando el alumno se registre o inicie sesión con él, se le reconoce automáticamente.
  - Sin correo: el profe recibe un código de 6 letras. El alumno lo escribe al registrarse, en "¿Tu profesor te dio un código de alta?".
  - En ambos casos el alumno elige su contraseña y confirma su correo, y conserva todas sus asistencias.
- **Sesión del profe**: se mantiene en el ordenador hasta que cierra sesión o termina el día. Abrir una clase no pide nada; cerrarla y entrar en Gestión piden solo la contraseña.

## Diseño

Todas las pantallas usan las mismas piezas de `src/ui.tsx` (pantalla, cabecera, tarjeta bento, botón, campo, ventana emergente, etiqueta, pestañas y estados de carga), con los colores y radios definidos una sola vez al principio de `src/index.css` (`marino`, `azul`, `fondo`, `rounded-bento`, `rounded-control`). Para cambiar el aspecto de toda la web basta con tocar esos dos sitios. Las animaciones también están en `src/index.css` y respetan la opción de "reducir movimiento" del sistema.

## Base de datos

Los cambios de la base de datos están en `supabase/migrations/`, en orden:

1. `…_esquema_inicial.sql`: estructura original. Solo sirve para montar un proyecto de pruebas desde cero.
2. `…_cuentas_y_matriculas.sql`: columnas y funciones nuevas. Solo añade cosas.
3. `…_activar_seguridad_rls.sql`: activa la seguridad por filas (RLS). Se aplica cuando la web nueva ya está publicada.

Supabase devuelve como máximo 1000 filas por consulta: las consultas grandes usan `src/consultas.ts`, que pide los datos por páginas para no perder nada.

El plan gratuito de Supabase pausa el proyecto tras 7 días sin uso. Para evitarlo en vacaciones, Vercel ejecuta cada día `api/mantener-activo.ts` (programado en `vercel.json`).

La función del servidor `supabase/functions/cuentas` gestiona las altas forzosas y la activación de esas cuentas, porque necesita la clave de administrador de Supabase.
