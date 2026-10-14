import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import CryptoJS from 'crypto-js';
import { supabase } from './supabase';
import type { Asistencia, EstadoAsistencia, FaseSesion } from './types';
import BotonCompartir from './BotonCompartir';
import { AvisoFlotante, useAviso } from './Aviso';
import { traerPorLotes, traerTodas } from './consultas';
import { Boton, Cabecera, Esqueleto, Etiqueta, Modal, Pantalla, Tarjeta, Vacio } from './ui';
import FilaAlumno from './FilaAlumno';
import { cargarHorarios, filasDe, horaDeHoy, resumenHorario, tramo, type FilaHorario } from './horario';
import { crearCodigo } from './codigoQr';

// Cada cuántos segundos cambia el QR (el servidor acepta códigos de hasta 45 s de antigüedad)
const SEGUNDOS_QR = 15;

interface Props {
  onVolver: () => void;
}

export default function PantallaProfesor({ onVolver }: Props) {
  const [sesionId, setSesionId] = useState<string | null>(null);
  const [fase, setFase] = useState<FaseSesion>('ENTRADA');
  const [secretTotp, setSecretTotp] = useState<string>('');
  const [qrSrc, setQrSrc] = useState<string>('');
  
  const [confirmarEliminar, setConfirmarEliminar] = useState<boolean>(false);
  const [mostrarModalCierre, setMostrarModalCierre] = useState<boolean>(false);
  const [cargandoCierre, setCargandoCierre] = useState<boolean>(false);
  
  const [asistencias, setAsistencias] = useState<Asistencia[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const popUpRef = useRef<Window | null>(null); // Referencia a la ventana flotante

  const [clasesHoy, setClasesHoy] = useState<any[]>([]);
  const [cargandoClases, setCargandoClases] = useState(true);

  const [diccionarioAlumnos, setDiccionarioAlumnos] = useState<Record<string, any>>({});
  const [sesionesActivasPorAsig, setSesionesActivasPorAsig] = useState<Record<string, any>>({});
  const [horarios, setHorarios] = useState<FilaHorario[]>([]);



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

          const filasHorario = await cargarHorarios(asigIds);
          setHorarios(filasHorario);
          const sorted = [...data].sort((a, b) => {
            // Primero, las clases que están abiertas ahora mismo
            const aActiva = asigIds.length > 0 && sAbiertas?.find(s => s.asignatura_id === a.id) ? 1 : 0;
            const bActiva = asigIds.length > 0 && sAbiertas?.find(s => s.asignatura_id === b.id) ? 1 : 0;
            if (aActiva !== bActiva) return bActiva - aActiva;

            // Después, las que tienen clase hoy, ordenadas por la hora de hoy
            const aHoy = horaDeHoy(filasHorario, a.id);
            const bHoy = horaDeHoy(filasHorario, b.id);
            if (!!aHoy !== !!bHoy) return aHoy ? -1 : 1;
            if (aHoy && bHoy) return aHoy.hora_inicio.localeCompare(bHoy.hora_inicio);
            return 0;
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
      const firma = CryptoJS.HmacSHA256(payload, secretTotp).toString();
      const contenido = crearCodigo({ fase, t: bloqueTiempo, firma });

      // Negro puro sobre blanco y con margen blanco de 4 cuadraditos: lo que mejor leen las cámaras,
      // sobre todo con proyector o pizarra (poco contraste y reflejos)
      const dataUrl = await QRCode.toDataURL(contenido, { errorCorrectionLevel: 'M', width: 1000, margin: 4, color: { dark: '#000000', light: '#ffffff' } });
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
    setConfirmarEliminar(false);
    setMostrarModalCierre(true);
  };

  const confirmarCierreClase = async () => {
    if (!sesionId) return;
    setCargandoCierre(true);
    try {
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
      
      const { error } = await supabase.from('sesiones').update({ fase: 'CERRADA', hora_cierre: horaCierre }).eq('id', sesionId);
      if (error) throw new Error('No se pudo cerrar la clase. Revisa tu conexión e inténtalo de nuevo.');
      setFase('CERRADA');
      setMostrarModalCierre(false);
      cargarAsistencias(sesionId, diccionarioAlumnos);
      mostrarNotificacion('Clase cerrada y guardada. Volviendo al inicio...', 'exito');
      // Tras un momento para leer el aviso, el profe vuelve solo al menú de inicio
      setTimeout(onVolver, 1500);
      
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
    if (!sesionId) return;
    // Borrar es irreversible: el primer clic solo pide confirmación
    if (!confirmarEliminar) {
      setConfirmarEliminar(true);
      return;
    }
    setCargandoCierre(true);
    try {
      // Al borrar la clase, la base de datos borra también sus asistencias
      const { error } = await supabase.from('sesiones').delete().eq('id', sesionId);
      if (error) throw new Error('No se pudo eliminar la clase. Revisa tu conexión e inténtalo de nuevo.');

      setFase('ENTRADA');
      setSesionId(null);
      setAsistencias([]);
      setMostrarModalCierre(false);
      setConfirmarEliminar(false);
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
    <Pantalla ancho={sesionId ? 'grande' : 'normal'} fija={!!sesionId} esquinas={<BotonCompartir mostrarNotificacion={mostrarNotificacion} />}>
      <AvisoFlotante aviso={aviso} onCerrar={cerrarAviso} />

      <Cabecera
        titulo="Profesorado"
        onVolver={onVolver}
        subtitulo={sesionId ? (
          <span className="flex items-center gap-1.5 uppercase tracking-widest">
            Fase: <span className={`font-black ${fase === 'ENTRADA' ? 'text-amber-500' : fase === 'SALIDA' ? 'text-azul' : 'text-slate-400'}`}>{fase}</span>
          </span>
        ) : 'Elige una asignatura'}
        acciones={sesionId && fase !== 'CERRADA' ? (
          <>
            {fase === 'ENTRADA' && <Boton variante="acento" tamano="pequeno" onClick={pasarASalida}>Activar salida</Boton>}
            <Boton variante="peligro" tamano="pequeno" onClick={intentarCerrarAula}>Cerrar clase</Boton>
          </>
        ) : undefined}
      />

      {!sesionId ? (
        // VISTA: SELECCIÓN DE ASIGNATURA
        cargandoClases ? (
          <Esqueleto filas={3} alto="h-[230px]" columnas={3} />
        ) : clasesHoy.length === 0 ? (
          <Tarjeta indice={1} className="max-w-2xl w-full mx-auto mt-6 p-6">
            <Vacio icono="📚" titulo="Aún no tienes asignaturas" texto="Créalas en Gestión → Asignaturas y aparecerán aquí." />
          </Tarjeta>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {clasesHoy.map((clase, i) => {
              const hoyHay = horaDeHoy(horarios, clase.id);
              const esHoy = !!hoyHay;
              const claseActiva = sesionesActivasPorAsig[clase.id];
              return (
                <Tarjeta
                  key={clase.id}
                  indice={i + 1}
                  interactiva
                  className={`p-7 flex flex-col justify-between group ${claseActiva ? 'ring-2 ring-azul/50' : esHoy ? 'ring-2 ring-emerald-400/50' : ''}`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-5">
                      <div className="flex items-center gap-2">
                        {claseActiva && (
                          <Etiqueta tono="info"><span className="w-1.5 h-1.5 rounded-full bg-azul animate-pulse"></span>En curso</Etiqueta>
                        )}
                        {!claseActiva && esHoy && <Etiqueta tono="exito" className="animate-pulse">Hoy</Etiqueta>}
                        <Etiqueta>{clase.aula}</Etiqueta>
                      </div>
                      <span className={`text-[11px] font-bold tracking-wider text-right ${esHoy ? 'text-emerald-600' : 'text-slate-400'}`}>{hoyHay ? tramo(hoyHay) : resumenHorario(filasDe(horarios, clase.id), clase.horario)}</span>
                    </div>
                    <h3 className="text-2xl font-black text-marino mb-6 leading-tight tracking-tight">{clase.nombre}</h3>
                  </div>
                  <Boton
                    ancho
                    variante={claseActiva ? 'acento' : esHoy ? 'exito' : 'principal'}
                    onClick={() => iniciarClase(clase.id)}
                    className="py-4"
                  >
                    {claseActiva ? 'Reanudar aula' : 'Iniciar aula'}
                  </Boton>
                </Tarjeta>
              );
            })}
          </div>
        )
      ) : (
        // VISTA: AULA ACTIVA
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-6 flex-1 min-h-0">
          
          {/* PANEL IZQUIERDO: QR */}
          <div className="xl:col-span-5 xl:min-h-0 glass-container rounded-bento p-6 sm:p-8 xl:p-6 flex flex-col items-center justify-center text-center relative overflow-hidden entra-izquierda">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-azul rounded-full opacity-[0.04] blur-[60px] pointer-events-none"></div>

            {fase !== 'CERRADA' ? (
              <div className="relative z-10 w-full flex flex-col items-center">
                <div className="mb-5 flex items-center justify-between w-full max-w-[32rem] xl:max-w-[min(32rem,calc(100dvh-24rem))]">
                  <span key={fase} className={`text-[10px] uppercase tracking-widest font-bold px-4 py-2 rounded-full border bento-entrada ${fase === 'ENTRADA' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-azul/5 text-azul border-azul/10'}`}>
                    {fase === 'ENTRADA' ? '📍 Modo entrada' : '🚪 Modo salida'}
                  </span>
                  <button onClick={abrirPopUpQR} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 hover:bg-azul text-slate-400 hover:text-white transition-colors cursor-pointer active:scale-90 shadow-sm border border-slate-100" title="Proyectar en una ventana aparte">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </button>
                </div>

                {/* Sin animación al cambiar: un QR a medio animar no lo lee ninguna cámara */}
                <div className="w-full max-w-[32rem] xl:max-w-[min(32rem,calc(100dvh-24rem))] aspect-square p-2 bg-white rounded-bento shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] border border-slate-100">
                  {qrSrc && <img src={qrSrc} alt="Código QR de asistencia" className="w-full h-full rounded-control object-contain select-none pointer-events-none qr-nitido" draggable="false" />}
                </div>

                {/* Para quien no tiene Checker guardado: el QR también se abre con la cámara normal del móvil */}
                <div className="mt-5 flex flex-col items-center gap-1.5">
                  <p className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-500">
                    <span className="relative flex h-2.5 w-2.5 shrink-0" title="En vivo">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                    Escanéalo desde Checker o con la cámara del móvil
                  </p>
                  <p className="text-sm sm:text-base font-black text-marino tracking-tight select-all">{window.location.host}</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-20 relative z-10 bento-entrada">
                <div className="w-24 h-24 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner"><span className="text-4xl">✓</span></div>
                <h3 className="text-2xl font-black text-marino tracking-tight mb-2">Clase cerrada</h3>
                <p className="text-sm text-slate-400 font-medium">Los datos ya se han guardado de forma segura.</p>
              </div>
            )}
          </div>

          {/* PANEL DERECHO: Lista de Alumnos */}
          <div className="xl:col-span-7 max-h-[85dvh] xl:max-h-none xl:min-h-0 glass-container rounded-bento p-6 sm:p-8 flex flex-col relative overflow-hidden entra-derecha" style={{ '--i': 1 } as React.CSSProperties}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-6 sm:mb-8">
              <h2 className="text-lg sm:text-xl font-black text-marino tracking-tight">Alumnos de la clase</h2>
              <Etiqueta tono="oscuro" className="px-4 py-1.5">{asistencias.length} {asistencias.length === 1 ? 'alumno' : 'alumnos'}</Etiqueta>
            </div>
            
            <div className="flex flex-col md:grid md:grid-cols-2 gap-4 flex-1 min-h-0 overflow-hidden relative z-10">
              
              {/* COLUMNA IZQUIERDA: COMPLETADOS */}
              <div className="flex flex-col flex-1 min-h-0">
                <h3 className="text-sm font-bold text-emerald-600 mb-4 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.6)]"></span>
                  {fase === 'ENTRADA' ? 'Presentes' : 'Han salido'} ({
                    asistencias.filter(item => fase === 'ENTRADA' ? item.estado === 'PRESENTE' : item.hora_salida !== null).length
                  })
                </h3>
                <div className="flex-1 overflow-y-auto px-1 py-2 space-y-2 scrollbar-hide">
                  {asistencias
                    .filter(item => fase === 'ENTRADA' ? item.estado === 'PRESENTE' : item.hora_salida !== null)
                    .sort((a, b) => (a.perfiles?.nombre_completo || '').localeCompare(b.perfiles?.nombre_completo || ''))
                    .map((item) => (
                      <FilaAlumno key={item.id} item={item} onCambiar={cambiarEstadoManual} />
                    ))}
                </div>
              </div>

              {/* COLUMNA DERECHA: PENDIENTES */}
              <div className="flex flex-col flex-1 min-h-0 border-t md:border-t-0 md:border-l border-white/40 pt-6 md:pt-0 md:pl-4">
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
                      <FilaAlumno key={item.id} item={item} onCambiar={cambiarEstadoManual} />
                    ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* --- MODALES --- */}
      {mostrarModalCierre && (
        <Modal centrado titulo="Cerrar la clase" descripcion="Se guardará la asistencia de esta clase.">
          {fase === 'ENTRADA' && (
            <div className="text-left bg-amber-50 border border-amber-100 rounded-control p-4 mb-5">
              <p className="text-xs font-black text-amber-700 uppercase tracking-wider mb-1">No has activado la salida</p>
              <p className="text-xs text-amber-700/90 font-medium leading-relaxed">
                Si cierras ahora, se dará por buena la salida de quienes ya entraron. Quien no haya escaneado quedará como ausente.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-3">
            <Boton variante="acento" ancho onClick={confirmarCierreClase} disabled={cargandoCierre} className="py-4">{cargandoCierre ? 'Guardando...' : 'Cerrar y guardar'}</Boton>
            <Boton variante="secundario" ancho onClick={() => { setMostrarModalCierre(false); setConfirmarEliminar(false); }}>Volver</Boton>
            <Boton
              variante={confirmarEliminar ? 'peligro' : 'texto'}
              ancho={confirmarEliminar}
              onClick={descartarClaseSinGuardar}
              disabled={cargandoCierre}
              className={confirmarEliminar ? 'mt-1' : 'mt-1 hover:!text-rose-500'}
            >
              {confirmarEliminar ? 'Sí, eliminar esta clase para siempre' : 'Eliminar la clase sin guardarla'}
            </Boton>
          </div>
        </Modal>
      )}
    </Pantalla>
  );
}
