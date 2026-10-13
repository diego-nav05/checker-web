import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import CryptoJS from 'crypto-js';
import { supabase } from './supabase';
import type { Asistencia, EstadoAsistencia, FaseSesion } from './types';
import BotonCompartir from './BotonCompartir';
import { AvisoFlotante, useAviso } from './Aviso';
import { traerPorLotes, traerTodas } from './consultas';

// Cada cuántos segundos cambia el QR (el servidor acepta códigos de hasta 20 s de antigüedad)
const SEGUNDOS_QR = 5;

interface Props {
  onVolver: () => void;
}

export default function PantallaProfesor({ onVolver }: Props) {
  const [sesionId, setSesionId] = useState<string | null>(null);
  const [fase, setFase] = useState<FaseSesion>('ENTRADA');
  const [secretTotp, setSecretTotp] = useState<string>('');
  const [qrSrc, setQrSrc] = useState<string>('');
  
  const [passInput, setPassInput] = useState<string>('');
  const [mostrarModalCierre, setMostrarModalCierre] = useState<boolean>(false);
  const [cargandoCierre, setCargandoCierre] = useState<boolean>(false);
  
  const [asistencias, setAsistencias] = useState<Asistencia[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const popUpRef = useRef<Window | null>(null); // Referencia a la ventana flotante

  const [clasesHoy, setClasesHoy] = useState<any[]>([]);
  const [cargandoClases, setCargandoClases] = useState(true);

  const [diccionarioAlumnos, setDiccionarioAlumnos] = useState<Record<string, any>>({});
  const [sesionesActivasPorAsig, setSesionesActivasPorAsig] = useState<Record<string, any>>({});



  const { aviso, avisar: mostrarNotificacion, cerrar: cerrarAviso } = useAviso();
  // Diferencia entre el reloj de este ordenador y el del servidor (el QR usa la hora del servidor)
  const desfaseRelojRef = useRef(0);

  useEffect(() => {
    const arrancarDatos = async () => {
      setCargandoClases(true);
      const { data: horaServidor } = await supabase.rpc('hora_servidor');
      if (typeof horaServidor === 'number') desfaseRelojRef.current = horaServidor * 1000 - Date.now();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from('asignaturas').select('*').eq('profesor_id', user.id).order('horario', { ascending: true });
        if (data) {
          const asigIds = data.map((a: any) => a.id);
          
          let sAbiertas: any[] | null = null;
          if (asigIds.length > 0) {
            const { data: sesiones } = await supabase.from('sesiones')
              .select('id, asignatura_id, fase')
              .in('asignatura_id', asigIds)
              .in('fase', ['ENTRADA', 'SALIDA']);
            
            sAbiertas = sesiones;
            if (sAbiertas) {
               const activas: Record<string, any> = {};
               sAbiertas.forEach(s => activas[s.asignatura_id] = s);
               setSesionesActivasPorAsig(activas);
            }
          }

          const hoy = new Date().getDay();
          const sorted = [...data].sort((a, b) => {
            // Priority 1: Active sessions first
            const aActiva = asigIds.length > 0 && sAbiertas?.find(s => s.asignatura_id === a.id) ? 1 : 0;
            const bActiva = asigIds.length > 0 && sAbiertas?.find(s => s.asignatura_id === b.id) ? 1 : 0;
            if (aActiva !== bActiva) return bActiva - aActiva;

            // Priority 2: Today's classes
            const aHoy = (a.dias_semana || []).includes(hoy) ? 1 : 0;
            const bHoy = (b.dias_semana || []).includes(hoy) ? 1 : 0;
            return bHoy - aHoy;
          });
          setClasesHoy(sorted);
        }
      }
      setCargandoClases(false);
    };
    arrancarDatos();
  }, []);

  const iniciarClase = async (idAsignatura: string) => {
    if (sesionesActivasPorAsig[idAsignatura]) {
      const sesionData = sesionesActivasPorAsig[idAsignatura];
      const { data: secreto, error: errorSecreto } = await supabase.rpc('secreto_sesion', { p_sesion: sesionData.id });
      if (errorSecreto || !secreto) return mostrarNotificacion('No se pudo reanudar el aula. Recarga la página e inténtalo de nuevo.', 'error');
      setSesionId(sesionData.id);
      setFase(sesionData.fase);
      setSecretTotp(secreto);
      cargarAsistencias(sesionData.id, diccionarioAlumnos);
      mostrarNotificacion('Aula reanudada: sigues donde lo dejaste.', 'info');
      return;
    }

    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const nuevoSecret = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    setSecretTotp(nuevoSecret);

    const { data: sesionData, error: sesionError } = await supabase
      .from('sesiones')
      .insert({ fase: 'ENTRADA', secret_totp: nuevoSecret, asignatura_id: idAsignatura })
      .select('id')
      .single();

    if (sesionError || !sesionData) return mostrarNotificacion('No se pudo abrir el aula. Revisa tu conexión e inténtalo de nuevo.', 'error');
    setSesionId(sesionData.id);

    // Lista inicial: alumnos matriculados (incluye los dados de alta por el profe) y los de clases anteriores
    let alumnosDeLaAsignatura: { alumno_id: string }[] = [];
    let listaIncompleta = false;
    try {
      const matriculados = await traerTodas<{ alumno_id: string }>(() =>
        supabase.from('matriculas').select('alumno_id').eq('asignatura_id', idAsignatura).order('id'));
      const pastSesiones = await traerTodas<{ id: string }>(() =>
        supabase.from('sesiones').select('id').eq('asignatura_id', idAsignatura).neq('id', sesionData.id).order('id'));
      const pastAsistencias = await traerPorLotes<{ alumno_id: string }>(pastSesiones.map(s => s.id), (lote) =>
        supabase.from('asistencias').select('alumno_id').in('sesion_id', lote).order('id'));
      alumnosDeLaAsignatura = [...matriculados, ...pastAsistencias];
    } catch {
      listaIncompleta = true;
    }
    const uniqueIds = Array.from(new Set(alumnosDeLaAsignatura.map(a => a.alumno_id)));
    if (uniqueIds.length > 0) {
      const asistenciasIniciales = uniqueIds.map((aluId) => ({
        sesion_id: sesionData.id,
        alumno_id: aluId,
        estado: 'FALTA_INJUSTIFICADA' as EstadoAsistencia,
        manual: false
      }));
      await supabase.from('asistencias').insert(asistenciasIniciales);
    }

    cargarAsistencias(sesionData.id, diccionarioAlumnos);
    if (listaIncompleta) {
      mostrarNotificacion('El aula está abierta, pero no se pudo cargar la lista completa. Quien escanee aparecerá igualmente.', 'error');
    } else {
      mostrarNotificacion('Aula abierta: los alumnos ya pueden escanear el QR.', 'exito');
    }
  };

  const cargarAsistencias = async (idSesion: string, dict = diccionarioAlumnos) => {
    const { data } = await supabase.from('asistencias').select('*').eq('sesion_id', idSesion);
    if (data) {
      const idsFaltantes = data.map(item => item.alumno_id).filter(id => id && !dict[id]);
      let dictActualizado = { ...dict };

      if (idsFaltantes.length > 0) {
        const { data: perfilesNuevos } = await supabase.from('perfiles').select('id, nombre_completo, email, pendiente').in('id', idsFaltantes);
        if (perfilesNuevos) {
          perfilesNuevos.forEach(p => { dictActualizado[p.id] = p; });
          setDiccionarioAlumnos(dictActualizado);
        }
      }

      const datosCompletos = data.map(item => ({
        ...item,
        perfiles: dictActualizado[item.alumno_id] || { nombre_completo: 'Alumno Registrado' }
      }));
      setAsistencias(datosCompletos as Asistencia[]);
    }
  };

  useEffect(() => {
    if (!sesionId) return;
    cargarAsistencias(sesionId, diccionarioAlumnos);

    const instantChannel = supabase.channel('aula-realtime')
      .on('broadcast', { event: 'update-lista' }, () => cargarAsistencias(sesionId, diccionarioAlumnos))
      .subscribe();

    const dbChannel = supabase.channel('aula-db')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asistencias', filter: `sesion_id=eq.${sesionId}` }, () => cargarAsistencias(sesionId, diccionarioAlumnos))
      .subscribe();

    // Respaldo por si se pierde el tiempo real. Cada 15 s basta y gasta mucho menos del plan gratuito.
    const intervaloRespaldo = setInterval(() => cargarAsistencias(sesionId, diccionarioAlumnos), 15000);

    return () => { 
      supabase.removeChannel(instantChannel);
      supabase.removeChannel(dbChannel);
      clearInterval(intervaloRespaldo);
    };
  }, [sesionId, diccionarioAlumnos]);

  useEffect(() => {
    if (!sesionId || !secretTotp || fase === 'CERRADA') return;
    const actualizarQR = async () => {
      const bloqueTiempo = Math.floor((Date.now() + desfaseRelojRef.current) / 1000);
      const payload = `${sesionId}|${fase}|${bloqueTiempo}`;
      const token = CryptoJS.HmacSHA256(payload, secretTotp).toString();
      const qrPayload = JSON.stringify({ s: sesionId, f: fase, t: bloqueTiempo, token });
      
      // Renderizamos el QR a alta resolución (width 500) para máxima nitidez
      const dataUrl = await QRCode.toDataURL(qrPayload, { width: 1000, margin: 1, color: { dark: '#002b5c', light: '#ffffff' } });
      setQrSrc(dataUrl);

      // Sincronizar con la ventana emergente si existe y no se ha cerrado
      if (popUpRef.current && !popUpRef.current.closed) {
        const doc = popUpRef.current.document;
        const img = doc.getElementById('qr-img') as HTMLImageElement;
        const faseLabel = doc.getElementById('qr-fase');
        if (img) img.src = dataUrl;
        if (faseLabel) {
          faseLabel.innerText = fase === 'ENTRADA' ? '📍 ESCANEO ENTRADA' : '🚪 ESCANEO SALIDA';
          faseLabel.style.color = fase === 'ENTRADA' ? '#fbbf24' : '#38bdf8';
          faseLabel.style.backgroundColor = fase === 'ENTRADA' ? 'rgba(251, 191, 36, 0.1)' : 'rgba(56, 189, 248, 0.1)';
        }
      }
    };
    
    actualizarQR();
    timerRef.current = setInterval(actualizarQR, SEGUNDOS_QR * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sesionId, secretTotp, fase]);

  // ABRIR VENTANA FLOTANTE POP-UP (Inmersiva y limpia)
  const abrirPopUpQR = () => {
    if (popUpRef.current && !popUpRef.current.closed) {
      popUpRef.current.focus();
      return;
    }
    const win = window.open('', 'QR_PopUp', 'width=500,height=600,top=100,left=100,resizable=yes,scrollbars=no,toolbar=no,menubar=no');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>QR Asistencia</title>
            <style>
              body { margin: 0; padding: 30px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: #0f172a; color: white; font-family: system-ui, -apple-system, sans-serif; box-sizing: border-box; overflow: hidden; }
              .container { background: white; padding: 24px; border-radius: 36px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); position: relative; display: inline-block; }
              .container::after { content: ''; position: absolute; inset: -20px; background: inherit; filter: blur(40px); z-index: -1; opacity: 0.2; }
              img { width: 450px; max-width: 100vw; height: auto; display: block; border-radius: 20px; transition: width 0.1s ease-out; }
              .badge { margin-top: 32px; padding: 10px 28px; border-radius: 99px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; font-size: 14px; transition: all 0.3s ease; }
              .info { margin-top: 16px; font-size: 13px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px; }
              .dot { width: 8px; height: 8px; background-color: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; }
              .zoom-controls { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: rgba(255,255,255,0.1); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); padding: 12px 24px; border-radius: 99px; display: flex; align-items: center; gap: 12px; opacity: 0; transition: opacity 0.3s; border: 1px solid rgba(255,255,255,0.2); }
              body:hover .zoom-controls { opacity: 1; }
              input[type=range] { -webkit-appearance: none; background: rgba(255,255,255,0.2); height: 6px; border-radius: 4px; outline: none; width: 150px; }
              input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: white; border-radius: 50%; cursor: pointer; }
            </style>
          </head>
          <body>
            <div class="container"><img id="qr-img" src="${qrSrc}" alt="QR Asistencia" /></div>
            <div class="badge" id="qr-fase" style="color: ${fase === 'ENTRADA' ? '#fbbf24' : '#38bdf8'}; background: ${fase === 'ENTRADA' ? 'rgba(251, 191, 36, 0.1)' : 'rgba(56, 189, 248, 0.1)'};">
              ${fase === 'ENTRADA' ? '📍 ESCANEO ENTRADA' : '🚪 ESCANEO SALIDA'}
            </div>
            <div class="info"><div class="dot"></div> En vivo</div>
            
            <div class="zoom-controls">
              <span style="font-size:12px; font-weight:bold;">ZOOM</span>
              <input type="range" id="zoom-slider" min="100" max="1500" value="450" />
            </div>

            <script>
              const slider = document.getElementById('zoom-slider');
              const img = document.getElementById('qr-img');
              slider.addEventListener('input', (e) => {
                img.style.width = e.target.value + 'px';
              });
            </script>
          </body>
        </html>
      `);
      popUpRef.current = win;
    } else {
      mostrarNotificacion('El navegador ha bloqueado la ventana del QR. Permite las ventanas emergentes para esta web.', 'error');
    }
  };

  const pasarASalida = async () => {
    if (!sesionId) return;
    await supabase.from('sesiones').update({ fase: 'SALIDA' }).eq('id', sesionId);
    setFase('SALIDA');
    mostrarNotificacion('Salida activada: los alumnos ya pueden escanear para salir.', 'info');
  };

  const intentarCerrarAula = () => {
    setMostrarModalCierre(true);
  };

  const confirmarCierreClase = async () => {
    if (!passInput) return;
    setCargandoCierre(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Tu sesión ha caducado. Vuelve a entrar.");
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: passInput });
      if (authError) throw new Error("Contraseña incorrecta.");

      if (!sesionId) return;
      const horaCierre = new Date().toISOString();
      const ignorarFaseSalida = fase === 'ENTRADA';

      for (const item of asistencias) {
        if (item.hora_entrada && !item.hora_salida && !item.manual) {
          if (ignorarFaseSalida) {
            await supabase.from('asistencias').update({ hora_salida: horaCierre }).eq('id', item.id);
          } else {
            await supabase.from('asistencias').update({ estado: 'SE_FUE_A_MITAD' }).eq('id', item.id);
          }
        }
      }
      
      await supabase.from('sesiones').update({ fase: 'CERRADA', hora_cierre: horaCierre }).eq('id', sesionId);
      setFase('CERRADA');
      setMostrarModalCierre(false);
      setPassInput('');
      cargarAsistencias(sesionId, diccionarioAlumnos);
      mostrarNotificacion('Clase cerrada y guardada.', 'exito');
      
      // Cerramos automáticamente el pop-up al acabar la clase
      if (popUpRef.current && !popUpRef.current.closed) {
        popUpRef.current.close();
      }

    } catch (error: any) {
      mostrarNotificacion(error.message, 'error');
    } finally {
      setCargandoCierre(false);
    }
  };

  const descartarClaseSinGuardar = async () => {
    if (!passInput) return;
    setCargandoCierre(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Tu sesión ha caducado. Vuelve a entrar.");
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: passInput });
      if (authError) throw new Error("Contraseña incorrecta.");

      if (!sesionId) return;
      
      await supabase.from('asistencias').delete().eq('sesion_id', sesionId);
      await supabase.from('sesiones').delete().eq('id', sesionId);
      
      setFase('ENTRADA');
      setSesionId(null);
      setAsistencias([]);
      setMostrarModalCierre(false);
      setPassInput('');
      mostrarNotificacion('Clase eliminada sin guardar.', 'exito');
      
      if (popUpRef.current && !popUpRef.current.closed) {
        popUpRef.current.close();
      }

    } catch (error: any) {
      mostrarNotificacion(error.message, 'error');
    } finally {
      setCargandoCierre(false);
    }
  };

  const cambiarEstadoManual = async (asistenciaId: string, nuevoEstado: EstadoAsistencia) => {
    const { error } = await supabase.from('asistencias').update({ estado: nuevoEstado, manual: true }).eq('id', asistenciaId);
    if (error) mostrarNotificacion('No se pudo cambiar el estado. Revisa tu conexión.', 'error');
    cargarAsistencias(sesionId!, diccionarioAlumnos); 
  };



  return (
    <div className="min-h-[100dvh] bg-[#F0F4F8] p-4 sm:p-8 flex flex-col font-sans selection:bg-[#0090d0] selection:text-white relative overflow-hidden">
      <div className="glow-blob"></div>

      <AvisoFlotante aviso={aviso} onCerrar={cerrarAviso} />

      {/* MAIN CONTENT WRAPPER */}
      <div className="w-full flex-1 flex flex-col anim-suave relative z-10">
        {/* CABECERA FLOTANTE (Glassmorphism auténtico) */}
        <div className={`flex flex-wrap items-center justify-between gap-3 glass-container px-4 sm:px-6 py-4 rounded-[2rem] sm:rounded-[2.5rem] mb-6 mx-auto w-full transition-all ${sesionId ? 'max-w-[1700px]' : 'max-w-7xl'}`}>
        <div className="flex items-center gap-4">
          <button onClick={onVolver} className="flex items-center justify-center w-11 h-11 bg-white hover:bg-slate-50 border border-slate-100/80 rounded-full text-slate-500 shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer active:scale-90">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-xl font-black text-[#002b5c] tracking-tight leading-tight">Profesorado</h1>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mt-0.5">
              {sesionId ? (
                <span className="flex items-center gap-1.5">Fase: <span className={`font-bold ${fase === 'ENTRADA' ? 'text-amber-500' : fase === 'SALIDA' ? 'text-[#0090d0]' : 'text-slate-400'}`}>{fase}</span></span>
              ) : 'Elige una asignatura'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {sesionId && fase !== 'CERRADA' && (
            <>
              {fase === 'ENTRADA' && (
                <button onClick={pasarASalida} className="px-4 sm:px-6 py-3 bg-gradient-to-b from-[#00a8f3] to-[#0090d0] text-white text-xs font-bold rounded-full shadow-[0_8px_20px_rgba(0,144,208,0.3)] hover:shadow-[0_12px_28px_rgba(0,144,208,0.4)] transition-all duration-300 active:scale-95 cursor-pointer border border-[#0090d0]/20">
                  Activar salida
                </button>
              )}
              <button onClick={intentarCerrarAula} className="px-4 sm:px-6 py-3 bg-gradient-to-b from-rose-500 to-rose-600 text-white text-xs font-bold rounded-full shadow-[0_8px_20px_rgba(244,63,94,0.3)] hover:shadow-[0_12px_28px_rgba(244,63,94,0.4)] transition-all duration-300 active:scale-95 cursor-pointer border border-rose-500/20">
                Cerrar clase
              </button>
            </>
          )}
        </div>
      </div>

      {!sesionId ? (
        // VISTA: SELECCIÓN DE CLASE (Bento UI)
        <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full">
          {cargandoClases ? (
            <div className="flex justify-center py-20 text-slate-400 font-semibold tracking-wide animate-pulse">Cargando tus asignaturas...</div>
          ) : clasesHoy.length === 0 ? (
            <div className="glass-container rounded-[2.5rem] p-16 text-center max-w-2xl mx-auto w-full mt-10">
              <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6"><span className="text-3xl">📚</span></div>
              <p className="text-[#002b5c] font-black text-2xl tracking-tight">Aún no tienes asignaturas</p>
              <p className="text-sm text-slate-400 font-medium mt-3 leading-relaxed">Créalas en Gestión → Asignaturas y aparecerán aquí.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {clasesHoy.map((clase, i) => {
                const esHoy = (clase.dias_semana || []).includes(new Date().getDay());
                const claseActiva = sesionesActivasPorAsig[clase.id];
                return (
                <div key={clase.id} style={{ '--i': i } as React.CSSProperties} className={`glass-container rounded-[2.5rem] p-7 flex flex-col justify-between hover:-translate-y-1 transition-all duration-500 group bento-entrada ${claseActiva ? 'border-2 border-[#0090d0]/50 shadow-[0_20px_40px_-12px_rgba(0,144,208,0.3)] hover:shadow-[0_25px_50px_-12px_rgba(0,144,208,0.4)]' : esHoy ? 'border-2 border-emerald-400/50 shadow-[0_20px_40px_-12px_rgba(52,211,153,0.3)] hover:shadow-[0_25px_50px_-12px_rgba(52,211,153,0.4)]' : 'hover:shadow-[0_25px_50px_-12px_rgba(0,144,208,0.15)]'}`}>
                  <div>
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2">
                        {claseActiva && (
                          <span className="px-3 py-1 bg-[#0090d0]/10 text-[#0090d0] border border-[#0090d0]/20 text-[10px] font-black uppercase tracking-widest rounded-full flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#0090d0] animate-pulse"></span> ¡EN CURSO!</span>
                        )}
                        {!claseActiva && esHoy && (
                          <span className="px-3 py-1 bg-emerald-50 text-emerald-600 border border-emerald-100 text-[10px] font-black uppercase tracking-widest rounded-full animate-pulse">¡Hoy!</span>
                        )}
                        <span className="px-4 py-1.5 bg-slate-50 text-slate-500 border border-slate-100 text-[10px] font-bold uppercase tracking-widest rounded-full group-hover:bg-[#0090d0]/5 group-hover:text-[#0090d0] group-hover:border-[#0090d0]/10 transition-colors">{clase.aula}</span>
                      </div>
                      <span className="text-slate-400 text-[11px] font-bold tracking-wider uppercase">{clase.horario}</span>
                    </div>
                    <h3 className="text-2xl font-black text-[#002b5c] mb-6 leading-tight tracking-tight">{clase.nombre}</h3>
                  </div>
                  <button onClick={() => iniciarClase(clase.id)} className={`w-full py-4 text-sm font-bold rounded-[1.5rem] transition-all duration-300 shadow-sm active:scale-95 cursor-pointer border ${claseActiva ? 'bg-[#0090d0] text-white hover:bg-[#0070a0] border-transparent shadow-[0_10px_20px_rgba(0,144,208,0.3)]' : esHoy ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-500 hover:text-white border-emerald-100 hover:shadow-[0_10px_20px_rgba(52,211,153,0.2)]' : 'bg-slate-50 text-[#002b5c] hover:bg-[#002b5c] hover:text-white border-slate-100 hover:shadow-[0_10px_20px_rgba(0,43,92,0.15)]'}`}>
                    {claseActiva ? 'Reanudar aula' : 'Iniciar aula'}
                  </button>
                </div>
              )})}
            </div>
          )}
        </div>
      ) : (
        // VISTA: AULA ACTIVA
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 flex-1 max-w-[1700px] mx-auto w-full">
          
          {/* PANEL IZQUIERDO: QR lo más grande posible dentro de su tarjeta */}
          <div className="xl:col-span-6 glass-container rounded-[2.5rem] p-4 sm:p-6 flex flex-col items-center justify-center text-center relative overflow-hidden entra-izquierda">
            
            {/* Orbe de luz de fondo */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#0090d0] rounded-full opacity-[0.04] blur-[60px] pointer-events-none"></div>

            {fase !== 'CERRADA' ? (
              <div className="relative z-10 w-full flex flex-col items-center gap-4">
                <div className="flex items-center justify-between w-full gap-2">
                  <span key={fase} className={`text-[10px] uppercase tracking-widest font-bold px-4 py-2 rounded-full border bento-entrada ${fase === 'ENTRADA' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-[#0090d0]/5 text-[#0090d0] border-[#0090d0]/10'}`}>
                    {fase === 'ENTRADA' ? '📍 Modo entrada' : '🚪 Modo salida'}
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-50/80 px-3.5 py-2 rounded-full border border-slate-100" title="El código cambia cada pocos segundos">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      En vivo
                    </span>
                    {/* Proyectar el QR en una ventana aparte */}
                    <button onClick={abrirPopUpQR} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 hover:bg-[#0090d0] text-slate-400 hover:text-white transition-colors cursor-pointer active:scale-90 shadow-sm border border-slate-100" title="Proyectar en una ventana aparte">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </button>
                  </div>
                </div>

                {/* El QR ocupa todo el ancho de la tarjeta, sin pasarse del alto de la pantalla */}
                <div
                  className="w-full aspect-square p-3 sm:p-4 bg-white rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,43,92,0.15)] border border-slate-100"
                  style={{ maxWidth: 'min(100%, calc(100dvh - 11rem))' }}
                >
                  {qrSrc && <img key={qrSrc} src={qrSrc} alt="Código QR de asistencia" className="w-full h-full rounded-[1.25rem] object-contain select-none pointer-events-none qr-nitido qr-latido" draggable="false" />}
                </div>
              </div>
            ) : (
              <div className="text-center py-20 relative z-10 bento-entrada">
                <div className="w-24 h-24 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner"><span className="text-4xl">✓</span></div>
                <h3 className="text-2xl font-black text-[#002b5c] tracking-tight mb-2">Clase cerrada</h3>
                <p className="text-sm text-slate-400 font-medium">Los datos ya se han guardado de forma segura.</p>
              </div>
            )}
          </div>

          {/* PANEL DERECHO: Lista de Alumnos */}
          <div className="xl:col-span-6 glass-container rounded-[2.5rem] p-6 sm:p-8 flex flex-col relative overflow-hidden entra-derecha" style={{ '--i': 1 } as React.CSSProperties}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-6 sm:mb-8">
              <h2 className="text-lg sm:text-xl font-black text-[#002b5c] tracking-tight">Alumnos de la clase</h2>
              <span className="px-4 py-1.5 bg-[#002b5c] text-white text-[11px] font-bold tracking-widest uppercase rounded-full shadow-md">{asistencias.length} Alumnos</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-hidden relative z-10">
              
              {/* COLUMNA IZQUIERDA: COMPLETADOS */}
              <div className="flex flex-col h-full">
                <h3 className="text-sm font-bold text-emerald-600 mb-4 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.6)]"></span>
                  {fase === 'ENTRADA' ? 'Presentes' : 'Han Salido'} ({
                    asistencias.filter(item => fase === 'ENTRADA' ? item.estado === 'PRESENTE' : item.hora_salida !== null).length
                  })
                </h3>
                <div className="flex-1 overflow-y-auto px-1 py-2 space-y-2 scrollbar-hide">
                  {asistencias
                    .filter(item => fase === 'ENTRADA' ? item.estado === 'PRESENTE' : item.hora_salida !== null)
                    .sort((a, b) => (a.perfiles?.nombre_completo || '').localeCompare(b.perfiles?.nombre_completo || ''))
                    .map((item) => (
                      <div key={item.id} className="bento-card py-2.5 pl-3.5 pr-2 flex items-center justify-between gap-2 transition-all duration-500 animate-[fade-in-down_0.4s_ease-out]">
                        <div className="flex flex-col overflow-hidden min-w-0">
                          <p className="font-bold text-[#002b5c] text-xs tracking-tight truncate" title={item.perfiles?.nombre_completo || 'Alumno Registrado'}>
                            {item.perfiles?.nombre_completo || 'Alumno Registrado'}
                          </p>
                          {(item.perfiles as any)?.pendiente && (
                            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 whitespace-nowrap truncate" title="Dado de alta por el profesor: aún no ha activado su cuenta">Sin cuenta activa</span>
                          )}

                        </div>
                        <select
                          value={item.estado}
                          onChange={(e) => cambiarEstadoManual(item.id, e.target.value as EstadoAsistencia)}
                          style={{ textAlignLast: 'center' }}
                          className={`text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-2 rounded-full outline-none transition-all duration-500 cursor-pointer appearance-none text-center backdrop-blur-xl border-2 flex-shrink-0 w-[84px] hover:scale-105 ${
                            item.estado === 'PRESENTE' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-400/50 shadow-[0_0_15px_rgba(52,211,153,0.4),inset_0_1px_3px_rgba(255,255,255,0.7)] hover:bg-emerald-500/20 hover:shadow-[0_0_25px_rgba(52,211,153,0.7),inset_0_1px_3px_rgba(255,255,255,0.7)]' :
                            item.estado === 'RETRASO' ? 'bg-amber-500/10 text-amber-600 border-amber-400/50 shadow-[0_0_15px_rgba(251,191,36,0.4),inset_0_1px_3px_rgba(255,255,255,0.7)] hover:bg-amber-500/20 hover:shadow-[0_0_25px_rgba(251,191,36,0.7),inset_0_1px_3px_rgba(255,255,255,0.7)]' :
                            item.estado === 'SE_FUE_A_MITAD' ? 'bg-purple-500/10 text-purple-600 border-purple-400/50 shadow-[0_0_15px_rgba(192,132,252,0.4),inset_0_1px_3px_rgba(255,255,255,0.7)] hover:bg-purple-500/20 hover:shadow-[0_0_25px_rgba(192,132,252,0.7),inset_0_1px_3px_rgba(255,255,255,0.7)]' :
                            item.estado === 'FALTA_JUSTIFICADA' ? 'bg-[#0090d0]/10 text-[#0090d0] border-[#0090d0]/40 shadow-[0_0_15px_rgba(0,144,208,0.4),inset_0_1px_3px_rgba(255,255,255,0.7)] hover:bg-[#0090d0]/20 hover:shadow-[0_0_25px_rgba(0,144,208,0.7),inset_0_1px_3px_rgba(255,255,255,0.7)]' : 
                            'bg-rose-500/10 text-rose-600 border-rose-400/50 shadow-[0_0_15px_rgba(251,113,133,0.4),inset_0_1px_3px_rgba(255,255,255,0.7)] hover:bg-rose-500/20 hover:shadow-[0_0_25px_rgba(251,113,133,0.7),inset_0_1px_3px_rgba(255,255,255,0.7)]'
                          }`}
                        >
                          <option value="PRESENTE">Presente</option>
                          <option value="RETRASO">Retraso</option>
                          <option value="SE_FUE_A_MITAD">Abandono</option>
                          <option value="FALTA_JUSTIFICADA">Justificado</option>
                          <option value="FALTA_INJUSTIFICADA">Ausente</option>
                        </select>
                      </div>
                    ))}
                </div>
              </div>

              {/* COLUMNA DERECHA: PENDIENTES */}
              <div className="flex flex-col h-full border-t md:border-t-0 md:border-l border-white/40 pt-6 md:pt-0 md:pl-4">
                <h3 className="text-sm font-bold text-rose-500 mb-4 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-rose-400 rounded-full shadow-[0_0_8px_rgba(251,113,133,0.6)]"></span>
                  Pendientes ({
                    asistencias.filter(item => fase === 'ENTRADA' ? item.estado !== 'PRESENTE' : item.hora_salida === null).length
                  })
                </h3>
                <div className="flex-1 overflow-y-auto px-1 py-2 space-y-2 scrollbar-hide">
                  {asistencias
                    .filter(item => fase === 'ENTRADA' ? item.estado !== 'PRESENTE' : item.hora_salida === null)
                    .sort((a, b) => (a.perfiles?.nombre_completo || '').localeCompare(b.perfiles?.nombre_completo || ''))
                    .map((item) => (
                      <div key={item.id} className="bento-card py-2.5 pl-3.5 pr-2 flex items-center justify-between gap-2 transition-all duration-500 animate-[fade-in-down_0.4s_ease-out]">
                        <div className="flex flex-col overflow-hidden min-w-0">
                          <p className="font-bold text-[#002b5c] text-xs tracking-tight truncate" title={item.perfiles?.nombre_completo || 'Alumno Registrado'}>
                            {item.perfiles?.nombre_completo || 'Alumno Registrado'}
                          </p>
                          {(item.perfiles as any)?.pendiente && (
                            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 whitespace-nowrap truncate" title="Dado de alta por el profesor: aún no ha activado su cuenta">Sin cuenta activa</span>
                          )}

                        </div>
                        <select
                          value={item.estado}
                          onChange={(e) => cambiarEstadoManual(item.id, e.target.value as EstadoAsistencia)}
                          style={{ textAlignLast: 'center' }}
                          className={`text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-2 rounded-full outline-none transition-all duration-500 cursor-pointer appearance-none text-center backdrop-blur-xl border-2 flex-shrink-0 w-[84px] hover:scale-105 ${
                            item.estado === 'PRESENTE' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-400/50 shadow-[0_0_15px_rgba(52,211,153,0.4),inset_0_1px_3px_rgba(255,255,255,0.7)] hover:bg-emerald-500/20 hover:shadow-[0_0_25px_rgba(52,211,153,0.7),inset_0_1px_3px_rgba(255,255,255,0.7)]' :
                            item.estado === 'RETRASO' ? 'bg-amber-500/10 text-amber-600 border-amber-400/50 shadow-[0_0_15px_rgba(251,191,36,0.4),inset_0_1px_3px_rgba(255,255,255,0.7)] hover:bg-amber-500/20 hover:shadow-[0_0_25px_rgba(251,191,36,0.7),inset_0_1px_3px_rgba(255,255,255,0.7)]' :
                            item.estado === 'SE_FUE_A_MITAD' ? 'bg-purple-500/10 text-purple-600 border-purple-400/50 shadow-[0_0_15px_rgba(192,132,252,0.4),inset_0_1px_3px_rgba(255,255,255,0.7)] hover:bg-purple-500/20 hover:shadow-[0_0_25px_rgba(192,132,252,0.7),inset_0_1px_3px_rgba(255,255,255,0.7)]' :
                            item.estado === 'FALTA_JUSTIFICADA' ? 'bg-[#0090d0]/10 text-[#0090d0] border-[#0090d0]/40 shadow-[0_0_15px_rgba(0,144,208,0.4),inset_0_1px_3px_rgba(255,255,255,0.7)] hover:bg-[#0090d0]/20 hover:shadow-[0_0_25px_rgba(0,144,208,0.7),inset_0_1px_3px_rgba(255,255,255,0.7)]' : 
                            'bg-rose-500/10 text-rose-600 border-rose-400/50 shadow-[0_0_15px_rgba(251,113,133,0.4),inset_0_1px_3px_rgba(255,255,255,0.7)] hover:bg-rose-500/20 hover:shadow-[0_0_25px_rgba(251,113,133,0.7),inset_0_1px_3px_rgba(255,255,255,0.7)]'
                          }`}
                        >
                          <option value="PRESENTE">Presente</option>
                          <option value="RETRASO">Retraso</option>
                          <option value="SE_FUE_A_MITAD">Abandono</option>
                          <option value="FALTA_JUSTIFICADA">Justificado</option>
                          <option value="FALTA_INJUSTIFICADA">Ausente</option>
                        </select>
                      </div>
                    ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
      </div>

      {/* --- MODALES --- */}
      {mostrarModalCierre && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4 z-50 modal-fondo">
          <div className="glass-container rounded-[2.5rem] p-10 max-w-sm w-full text-center">
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-2">Cerrar la clase</h3>
            {fase === 'ENTRADA' && (
              <div className="text-left bg-amber-50 border border-amber-100 rounded-2xl p-4 mt-4 mb-4">
                <p className="text-xs font-black text-amber-700 uppercase tracking-wider mb-1">No has activado la salida</p>
                <p className="text-xs text-amber-700/90 font-medium leading-relaxed">
                  Si cierras ahora, se dará por buena la salida de quienes ya entraron. Quien no haya escaneado quedará como ausente.
                </p>
              </div>
            )}
            <p className="text-xs text-slate-500 font-medium mb-8">Escribe tu contraseña para confirmar.</p>
            <input type="password" placeholder="Contraseña" value={passInput} autoFocus onChange={(e) => setPassInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && passInput) confirmarCierreClase(); }} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl mb-8 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-center text-sm font-semibold transition-all"/>
            <div className="flex flex-col gap-3">
              <button onClick={confirmarCierreClase} disabled={cargandoCierre || !passInput} className="w-full py-4 rounded-2xl bg-[#0090d0] hover:bg-[#007ba8] text-white text-sm font-bold shadow-md shadow-[#0090d0]/20 active:scale-95 disabled:opacity-50 transition-all cursor-pointer">Cerrar y guardar</button>
              <button onClick={() => { setMostrarModalCierre(false); setPassInput(''); }} className="w-full py-4 rounded-2xl text-slate-500 text-sm font-bold bg-slate-50 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer">Volver</button>
              <button onClick={descartarClaseSinGuardar} disabled={cargandoCierre || !passInput} className="w-full py-3 mt-2 rounded-2xl bg-transparent text-slate-400 text-xs font-bold hover:text-rose-500 active:scale-95 disabled:opacity-50 transition-all cursor-pointer">Eliminar la clase sin guardarla</button>
            </div>
          </div>
        </div>
      )}

      <BotonCompartir mostrarNotificacion={mostrarNotificacion} lado={sesionId ? 'derecha' : 'izquierda'} />
    </div>
  );
}
