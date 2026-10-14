import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import type { Asignatura } from './types';
import { AvisoFlotante, useAviso } from './Aviso';
import { traerPorLotes, traerTodas } from './consultas';
import TarjetaRacha from './Racha';
import { cargarHorarios, filasDe, horaDeHoy, resumenHorario, tramo, type FilaHorario } from './horario';
import { abrirLector, prepararLector, type Lector } from './lectorQr';
import { leerCodigo, type CodigoAsistencia } from './codigoQr';
import { Boton, Cabecera, Esqueleto, Etiqueta, Modal, Pantalla, Pestanas, Tarjeta, TituloSeccion, Vacio, retraso } from './ui';

interface Props {
  onVolver: () => void;
  onIrARegistro: () => void;
  // Código del QR con el que se ha abierto la web (escaneado con la cámara normal del móvil)
  codigoPendiente?: CodigoAsistencia | null;
}

type TabAlumno = 'HORARIO' | 'CALENDARIO';

const ESTADOS_LEGIBLES: Record<string, string> = {
  PRESENTE: 'Presente',
  RETRASO: 'Retraso',
  SE_FUE_A_MITAD: 'Abandono',
  FALTA_JUSTIFICADA: 'Falta justificada',
  FALTA_INJUSTIFICADA: 'Falta',
};

// Traduce los errores del servidor al escanear a mensajes claros
const mensajeEscaneo = (codigo: string) => {
  if (codigo.includes('NO_SESION') || codigo.toLowerCase().includes('jwt')) return 'SESION_PERDIDA';
  if (codigo.includes('SIN_PERFIL')) return 'SESION_PERDIDA';
  if (codigo.includes('AULA_CERRADA')) return 'El aula ya no admite entradas: el profesor ha cerrado la clase.';
  if (codigo.includes('QR_CADUCADO')) return 'Código caducado. Vuelve a enfocar el QR de la pantalla.';
  if (codigo.includes('QR_FALSO')) return 'Este QR no es auténtico. Escanea el de la pantalla del profesor.';
  if (codigo.includes('FASE_CAMBIADA')) return 'El profesor acaba de cambiar de fase. Vuelve a escanear el QR.';
  if (codigo.includes('BLOQUEADO')) return 'El docente ha bloqueado o modificado tu registro para esta sesión. Habla con él si crees que es un error.';
  if (codigo.includes('NO_ALUMNO')) return 'Esta cuenta es de docente: no puede registrar asistencia.';
  if (codigo.toLowerCase().includes('failed to fetch') || codigo.toLowerCase().includes('network')) return 'Sin conexión a internet. Revisa tu conexión y vuelve a escanear.';
  return 'No se pudo registrar la asistencia. Vuelve a intentarlo.';
};

// Racha: clases cerradas seguidas a las que ha asistido (presente o retraso), de la más antigua a la
// más reciente. Una falta justificada no la rompe ni la suma; faltar o irse a mitad la reinicia.
function calcularRacha(
  sesiones: { id: string; fase: string; hora_apertura: string }[],
  asistencias: { sesion_id: string; estado: string }[],
) {
  const estadoPorSesion = new Map(asistencias.map(a => [a.sesion_id, a.estado]));
  const cerradas = sesiones
    .filter(s => s.fase === 'CERRADA' && estadoPorSesion.has(s.id))
    .sort((a, b) => a.hora_apertura.localeCompare(b.hora_apertura));
  let actual = 0;
  let record = 0;
  for (const s of cerradas) {
    const estado = estadoPorSesion.get(s.id);
    if (estado === 'PRESENTE' || estado === 'RETRASO') {
      actual++;
      record = Math.max(record, actual);
    } else if (estado !== 'FALTA_JUSTIFICADA') {
      actual = 0;
    }
  }
  return { actual, record };
}

export default function PantallaAlumno({ onVolver, onIrARegistro, codigoPendiente }: Props) {
  const [nombre] = useState<string>(() => localStorage.getItem('checker_nombre') || 'Estudiante');
  const [alumnoId] = useState<string>(() => localStorage.getItem('checker_alumno_id') || '');
  
  const [tabActual, setTabActual] = useState<TabAlumno>('HORARIO');
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [procesandoQr, setProcesandoQr] = useState(false);
  const [zoomActual, setZoomActual] = useState<number | string>(1);
  
  const { aviso, avisar: mostrarNotificacion, cerrar: cerrarAviso } = useAviso();
  const [sesionPerdida, setSesionPerdida] = useState(false);
  const [clasesHoy, setClasesHoy] = useState<Asignatura[]>([]);
  const [horarios, setHorarios] = useState<FilaHorario[]>([]);
  const [racha, setRacha] = useState({ actual: 0, record: 0 });
  const [cargandoClases, setCargandoClases] = useState(true);


  const [historial, setHistorial] = useState<any[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lectorRef = useRef<Lector | null>(null);
  const [procesandoEnlace, setProcesandoEnlace] = useState(false);

  // Con la seguridad activada, el móvil necesita su sesión de Supabase además del id guardado
  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) return; // sin conexión: no echamos a nadie por eso
      if (!data.session || data.session.user.id !== alumnoId) {
        localStorage.removeItem('checker_alumno_id');
        setSesionPerdida(true);
      }
    });
  }, [alumnoId]);

  const cargarAsignaturas = async () => {
    if (!alumnoId) return;
    setCargandoClases(true);
    try {
      const misAsistencias = await traerTodas<{ sesion_id: string; estado: string }>(() =>
        supabase.from('asistencias').select('sesion_id, estado').eq('alumno_id', alumnoId).order('id'));
      if (misAsistencias.length === 0) return setClasesHoy([]);
      
      const sesionIdsAlumno = [...new Set(misAsistencias.map(a => a.sesion_id))];
      const sesiones = await traerTodas<{ id: string; asignatura_id: string; fase: string; hora_apertura: string }>(() =>
        supabase.from('sesiones').select('id, asignatura_id, fase, hora_apertura').order('id'));
      if (sesiones.length === 0) return;
      setRacha(calcularRacha(sesiones, misAsistencias));
      
      const asigIdsAlumno = [...new Set(sesiones.filter(s => sesionIdsAlumno.includes(s.id)).map(s => s.asignatura_id))].filter(Boolean);
      let asignaturas: any[] = [];
      if (asigIdsAlumno.length > 0) {
        const res = await supabase.from('asignaturas').select('*').in('id', asigIdsAlumno).order('horario', { ascending: true });
        if (res.data) asignaturas = res.data;
      }
      
      if (asignaturas) {
        const asigsConStats = asignaturas.map(asig => {
           const sesionesDeAsig = sesiones.filter(s => s.asignatura_id === asig.id);
           // Las clases aún abiertas no cuentan: todavía puede escanear
           const asistsDeEstaAsig = misAsistencias.filter(a => sesionesDeAsig.some(s => s.id === a.sesion_id && s.fase === 'CERRADA'));
           // Solo cuentan las clases en las que el alumno ya estaba en la lista (no las anteriores a su alta)
           const totalSesionesPosibles = asistsDeEstaAsig.length;
           const asistenciasValidas = asistsDeEstaAsig.filter(a => {
              const st = a.estado?.toUpperCase() || '';
              return !(st.includes('AUSENTE') || st.includes('INJUSTIFICADA') || st === 'FALTA');
           }).length;
           
           const faltas = totalSesionesPosibles - asistenciasValidas;
           const porcentajeFaltas = totalSesionesPosibles > 0 ? Math.round((faltas / totalSesionesPosibles) * 100) : 0;
           
           return {
             ...asig,
             statsFaltas: {
                faltas,
                total: totalSesionesPosibles,
                porcentaje: porcentajeFaltas
             }
           }
        });
        
        const filasHorario = await cargarHorarios(asignaturas.map(a => a.id));
        setHorarios(filasHorario);
        const sorted = (asigsConStats as Asignatura[]).sort((a, b) => {
          // Después, las que tienen clase hoy, ordenadas por la hora de hoy
          const aHoy = horaDeHoy(filasHorario, a.id);
          const bHoy = horaDeHoy(filasHorario, b.id);
          if (!!aHoy !== !!bHoy) return aHoy ? -1 : 1;
          if (aHoy && bHoy) return aHoy.hora_inicio.localeCompare(bHoy.hora_inicio);
          return 0;
        });

        setClasesHoy(sorted);
      }
    } catch {
      mostrarNotificacion('No se pudieron cargar tus asignaturas. Revisa tu conexión.', 'error');
    } finally {
      setCargandoClases(false);
    }
  };

  useEffect(() => {
    cargarAsignaturas();
  }, [alumnoId]);

  useEffect(() => {
    const cargarHistorial = async () => {
      if (!alumnoId || tabActual !== 'CALENDARIO') return;
      setCargandoHistorial(true);
      try {
        const asistData = await traerTodas<any>(() =>
          supabase.from('asistencias').select('*').eq('alumno_id', alumnoId).order('id'));
        if (asistData.length > 0) {
          const sesionIds = [...new Set(asistData.map(a => a.sesion_id))].filter(Boolean);
          
          const sesionesData = await traerPorLotes<{ id: string; fecha: string; asignatura_id: string }>(sesionIds, (lote) =>
            supabase.from('sesiones').select('id, fecha, asignatura_id').in('id', lote).order('id'));
          
          const asigIds = [...new Set(sesionesData.map(s => s.asignatura_id))].filter(Boolean);
          
          let asigData: any[] = [];
          if (asigIds.length > 0) {
            const { data } = await supabase.from('asignaturas').select('id, nombre').in('id', asigIds);
            if (data) asigData = data;
          }

          const historialMapeado = asistData.map((registro: any) => {
            const ses = sesionesData.find(s => s.id === registro.sesion_id);
            const asig = asigData.find(a => a.id === ses?.asignatura_id);
            return {
              ...registro,
              asignatura_nombre: asig?.nombre || 'Clase registrada',
              fecha: registro.hora_entrada || ses?.fecha || new Date().toISOString()
            };
          }).sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

          setHistorial(historialMapeado);
        } else {
          setHistorial([]);
        }
      } catch {
        mostrarNotificacion('No se pudo cargar tu historial. Revisa tu conexión.', 'error');
      } finally {
        setCargandoHistorial(false);
      }
    };
    cargarHistorial();
  }, [tabActual, alumnoId]);

  // Manda un código leído al servidor, que lo comprueba y guarda la asistencia (la clave del QR nunca
  // llega al móvil). Devuelve el error del servidor traducido, o null si ha ido bien.
  const registrarCodigo = async (codigo: CodigoAsistencia): Promise<string | null> => {
    try {
      const { data: resultado, error } = await supabase.rpc('registrar_asistencia', {
        p_sesion: codigo.sesion, p_fase: codigo.fase, p_t: codigo.t, p_token: codigo.firma,
      });
      if (error) return mensajeEscaneo(error.message);
      mostrarNotificacion(resultado === 'SALIDA_OK' ? '¡Salida completada!' : '¡Entrada registrada!', 'exito');
      try {
        // Aviso instantáneo a la pantalla del profesor para que te vea en la lista
        const pingChannel = supabase.channel('aula-realtime');
        pingChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            pingChannel.send({ type: 'broadcast', event: 'update-lista', payload: { action: 'refresh' } });
            setTimeout(() => supabase.removeChannel(pingChannel), 1000);
          }
        });
      } catch { /* la lista del profe se refresca sola igualmente */ }
      cargarAsignaturas();
      return null;
    } catch (e: any) {
      return mensajeEscaneo(e?.message || '');
    }
  };

  const perderSesion = () => {
    localStorage.removeItem('checker_alumno_id');
    setCamaraActiva(false);
    setSesionPerdida(true);
  };

  // Precarga el motor del lector para que la cámara lea al instante
  useEffect(() => { prepararLector().catch(() => {}); }, []);

  // Si ha llegado escaneando el QR con la cámara normal del móvil, registramos ese código directamente
  const codigoUsadoRef = useRef(false);
  useEffect(() => {
    if (!codigoPendiente || codigoUsadoRef.current) return;
    codigoUsadoRef.current = true;
    (async () => {
      setProcesandoEnlace(true);
      const error = await registrarCodigo(codigoPendiente);
      setProcesandoEnlace(false);
      if (!error) return;
      if (error === 'SESION_PERDIDA') return perderSesion();
      if (error.startsWith('Código caducado') || error.startsWith('El profesor acaba')) {
        // Ha tardado en abrirse la web y el QR ya ha cambiado: abrimos la cámara para leerlo desde aquí
        mostrarNotificacion('El código ya había cambiado. Apunta al QR otra vez desde aquí.', 'info');
        setCamaraActiva(true);
      } else {
        mostrarNotificacion(error, 'error');
      }
    })();
  }, [codigoPendiente]);

  useEffect(() => {
    if (!camaraActiva) return;
    let cerrado = false;
    let lector: Lector | null = null;
    let ultimoAviso = { texto: '', hora: 0 };
    setProcesandoQr(false);
    setZoomActual(1);

    // Si el mismo QR inválido se sigue viendo, no repetimos el aviso cada medio segundo
    const avisarUnaVez = (texto: string) => {
      if (texto === ultimoAviso.texto && Date.now() - ultimoAviso.hora < 4000) return;
      ultimoAviso = { texto, hora: Date.now() };
      mostrarNotificacion(texto, 'error');
    };

    const alLeer = async (texto: string) => {
      const codigo = leerCodigo(texto);
      if (!codigo) {
        avisarUnaVez('Ese código QR no es de Checker. Escanea el de la pantalla del profesor.');
        return true;
      }
      setProcesandoQr(true);
      const error = await registrarCodigo(codigo);
      if (cerrado) return false;
      if (!error) {
        setCamaraActiva(false);
        return false;
      }
      if (error === 'SESION_PERDIDA') {
        perderSesion();
        return false;
      }
      setProcesandoQr(false);
      avisarUnaVez(error);
      return true;
    };

    (async () => {
      try {
        // Esperamos a que exista el <video> (se pinta en este mismo cambio de estado)
        await new Promise(r => requestAnimationFrame(r));
        if (cerrado || !videoRef.current) return;
        const abierto = await abrirLector(videoRef.current, alLeer);
        if (cerrado) return abierto.parar();
        lector = abierto;
        lectorRef.current = abierto;
      } catch (e: any) {
        if (cerrado) return;
        const sinPermiso = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
        mostrarNotificacion(sinPermiso
          ? 'Necesitamos la cámara para escanear el QR. Dale permiso en los ajustes del navegador.'
          : 'No se pudo abrir la cámara. Cierra otras apps que la estén usando y vuelve a intentarlo.', 'error');
        setCamaraActiva(false);
      }
    })();

    return () => {
      cerrado = true;
      lector?.parar();
      lectorRef.current = null;
    };
  }, [camaraActiva, alumnoId]);

  // SISTEMA DE ZOOM HÍBRIDO CON TYPESCRIPT CORREGIDO
  const aplicarZoom = async (nivel: number | string) => {
    setZoomActual(nivel);
    try {
      const videoElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
      if (!videoElement) return;

      const stream = videoElement.srcObject as MediaStream;
      let targetNivel = typeof nivel === 'number' ? nivel : 5; // fallback
      
      if (stream) {
        const track = stream.getVideoTracks()[0];
        
        // CORRECCIÓN: Forzamos el tipado a 'any' para evitar que TS bloquee la API experimental de zoom
        const capabilities = track.getCapabilities ? track.getCapabilities() as any : {};
        
        // 1. Intento por Hardware (Android / iOS 17+)
        if (capabilities.zoom) {
          const maxZoom = capabilities.zoom.max || 5;
          if (nivel === 'MAX') {
            targetNivel = maxZoom;
          }
          
          const targetZoom = Math.min(targetNivel, maxZoom);
          await track.applyConstraints({ advanced: [{ zoom: targetZoom }] } as any);
          
          const softwareZoom = (nivel !== 'MAX' && targetNivel > targetZoom) ? (targetNivel / targetZoom) : 1;
          lectorRef.current?.setZoom(softwareZoom);
          videoElement.style.transform = `scale(${softwareZoom})`;
          videoElement.style.transformOrigin = 'center center';
          return;
        }
      }
      // 2. Intento por Software (Fallback para iPhones antiguos y webkit estricto)
      lectorRef.current?.setZoom(targetNivel);
      videoElement.style.transform = `scale(${targetNivel})`;
      videoElement.style.transformOrigin = 'center center';
    } catch (e) {
      console.log("Fallback a zoom digital por políticas del navegador");
      const videoElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
      if (videoElement) {
        const targetNivel = typeof nivel === 'number' ? nivel : 5;
        lectorRef.current?.setZoom(targetNivel);
        videoElement.style.transform = `scale(${targetNivel})`;
        videoElement.style.transformOrigin = 'center center';
      }
    }
  };

  const cerrarCamara = () => setCamaraActiva(false);



  const exportarHistorialAlumno = () => {
    if (historial.length === 0) return mostrarNotificacion('Aún no tienes asistencias para descargar.', 'info');
    
    // Obtener nombres de asignaturas únicas
    const asignaturasUnicas = Array.from(new Set(historial.map(reg => reg.asignatura_nombre)));
    
    // Fila 1: Porcentajes
    const filaStats: Record<string, string> = { Fecha: '% Faltas' };
    asignaturasUnicas.forEach(asigNombre => {
      const asigObj = clasesHoy.find(a => a.nombre === asigNombre) as any;
      if (asigObj && asigObj.statsFaltas) {
        filaStats[asigNombre] = `${asigObj.statsFaltas.porcentaje}% (${asigObj.statsFaltas.faltas}/${asigObj.statsFaltas.total})`;
      } else {
        filaStats[asigNombre] = 'N/A';
      }
    });

    // Agrupar asistencias por fecha
    const registrosPorFecha: Record<string, Record<string, string>> = {};
    const fechasOrdenadas: string[] = [];

    historial.forEach(reg => {
      const fechaStr = new Date(reg.fecha).toLocaleDateString('es-ES');
      if (!registrosPorFecha[fechaStr]) {
        registrosPorFecha[fechaStr] = { Fecha: fechaStr };
        fechasOrdenadas.push(fechaStr); // Como el historial viene ordenado desc, esto mantiene el orden
      }
      
      const estadoLimpio = reg.estado.replace(/_/g, ' ');
      const horaStr = reg.hora_entrada 
        ? new Date(reg.hora_entrada).toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'}) 
        : (reg.hora_salida ? new Date(reg.hora_salida).toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'}) : '');
      
      const valor = horaStr ? `${estadoLimpio} (${horaStr})` : estadoLimpio;
      
      // Si ya hay un registro de esa asignatura ese día, lo concatenamos
      if (registrosPorFecha[fechaStr][reg.asignatura_nombre]) {
        registrosPorFecha[fechaStr][reg.asignatura_nombre] += ` | ${valor}`;
      } else {
        registrosPorFecha[fechaStr][reg.asignatura_nombre] = valor;
      }
    });

    const filasData = fechasOrdenadas.map(f => registrosPorFecha[f]);
    const filasFinales = [filaStats, ...filasData];

    const hoja = XLSX.utils.json_to_sheet(filasFinales);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Mi_Asistencia');
    XLSX.writeFile(libro, `Mi_Asistencia_${new Date().toLocaleDateString('es-ES').replace(/\//g, '-')}.xlsx`);
  };

  // Asistencia media de todas sus asignaturas (para la tarjeta de resumen)
  const resumen = clasesHoy.reduce((acc, c: any) => ({
    total: acc.total + (c.statsFaltas?.total || 0),
    faltas: acc.faltas + (c.statsFaltas?.faltas || 0),
  }), { total: 0, faltas: 0 });
  const porcentajeAsistencia = resumen.total > 0 ? Math.round(((resumen.total - resumen.faltas) / resumen.total) * 100) : null;

  return (
    <Pantalla>
      <AvisoFlotante aviso={aviso} onCerrar={cerrarAviso} />

      {procesandoEnlace && (
        <Modal centrado titulo="Registrando tu asistencia…" descripcion="Un segundo, estamos comprobando el código.">
          <div className="flex justify-center py-2">
            <div className="w-10 h-10 border-4 border-azul/20 border-t-azul rounded-full animate-spin"></div>
          </div>
        </Modal>
      )}

      {sesionPerdida && (
        <Modal
          centrado
          titulo="Vuelve a iniciar sesión"
          descripcion="Por seguridad necesitamos que vuelvas a entrar con tu correo y contraseña. Tu móvil sigue vinculado y no pierdes ninguna asistencia."
        >
          <Boton variante="acento" ancho onClick={onIrARegistro} className="mt-2 py-4">Iniciar sesión</Boton>
        </Modal>
      )}

      {/* CÁMARA INMERSIVA A PANTALLA COMPLETA (TIPO iOS) */}
      {camaraActiva && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-[fade-in_0.3s_ease-out] h-[100dvh]">
          {/* Barra Superior */}
          <div className="absolute top-0 left-0 right-0 p-6 pt-12 flex justify-between items-center z-50 bg-gradient-to-b from-black/80 to-transparent">
            <button onClick={cerrarCamara} className="w-12 h-12 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white flex items-center justify-center transition-colors active:scale-90">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="px-4 py-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10">
              <span className="text-xs font-bold text-white tracking-widest uppercase flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Escaneando
              </span>
            </div>
            <div className="w-12"></div> {/* Espaciador para centrar el titulo */}
          </div>

          {/* Visor UI (Cuadrado central) */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
            <div className="w-[72vw] max-w-[280px] aspect-square relative rounded-bento border-2 border-white/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
              {/* Esquinas guía del escáner */}
              <div className="absolute -top-[1px] -left-[1px] w-14 h-14 border-t-4 border-l-4 border-[#00d2ff] rounded-tl-[2rem]"></div>
              <div className="absolute -top-[1px] -right-[1px] w-14 h-14 border-t-4 border-r-4 border-[#00d2ff] rounded-tr-[2rem]"></div>
              <div className="absolute -bottom-[1px] -left-[1px] w-14 h-14 border-b-4 border-l-4 border-[#00d2ff] rounded-bl-[2rem]"></div>
              <div className="absolute -bottom-[1px] -right-[1px] w-14 h-14 border-b-4 border-r-4 border-[#00d2ff] rounded-br-[2rem]"></div>

              {/* Indicador de ayuda */}
              <div className="absolute -bottom-10 inset-x-0 flex justify-center text-center">
                <span className="text-white/80 text-[11px] font-semibold tracking-wide drop-shadow-md bg-black/40 backdrop-blur-md px-3.5 py-1 rounded-full border border-white/10">
                  Enfoca el código QR aquí
                </span>
              </div>
              
              {procesandoQr && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-bento transition-all">
                  <div className="w-10 h-10 border-4 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin shadow-[0_0_20px_rgba(52,211,153,0.5)]"></div>
                </div>
              )}
            </div>
          </div>

          {/* Contenedor de Video del Escáner */}
          <div className="flex-1 w-full h-full overflow-hidden bg-black flex items-center justify-center">
            <div id="qr-reader" className="w-full h-full">
              <video ref={videoRef} muted playsInline className="w-full h-full object-cover transition-transform duration-300"></video>
            </div>
          </div>

          {/* Barra Inferior (Controles de Zoom Híbrido) */}
          <div className="absolute bottom-0 left-0 right-0 p-8 pb-16 flex flex-col items-center justify-center z-50 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
            <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mb-4">Zoom</p>
            <div className="flex items-center gap-2 bg-black/50 backdrop-blur-xl p-1.5 rounded-full border border-white/10">
              {[1, 2, 3, 5, 'MAX'].map((nivel) => (
                <button
                  key={nivel}
                  onClick={() => aplicarZoom(nivel)}
                  className={`w-12 h-12 rounded-full font-bold transition-all duration-300 ${nivel === 'MAX' ? 'text-[11px]' : 'text-sm'} ${zoomActual === nivel ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.3)]' : 'bg-transparent text-white/70 hover:bg-white/10 hover:text-white'}`}
                >
                  {typeof nivel === 'number' ? `${nivel}x` : nivel}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!camaraActiva && (
        <>
          <Cabecera
            titulo="Estudiante"
            subtitulo={<span className="block truncate max-w-[180px] sm:max-w-none">{nombre}</span>}
            onVolver={onVolver}
            acciones={
              <Pestanas<TabAlumno>
                className="w-[230px]"
                opciones={[{ valor: 'HORARIO', texto: 'Asignaturas' }, { valor: 'CALENDARIO', texto: 'Historial' }]}
                valor={tabActual}
                onCambiar={setTabActual}
              />
            }
          />

          {tabActual === 'HORARIO' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 contenido-pestana">
              {/* Escanear: la acción principal, en la tarjeta más llamativa */}
              <button
                onClick={() => setCamaraActiva(true)}
                style={retraso(1)}
                className="bento-entrada md:row-span-2 min-h-[220px] md:min-h-[400px] bg-gradient-to-br from-azul to-marino border border-white/20 shadow-[0_16px_40px_-12px_rgba(0,144,208,0.5)] rounded-bento p-6 flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group transition-all duration-500 hover:-translate-y-1 active:scale-[0.98]"
              >
                <div className="absolute top-0 right-0 w-48 h-48 bg-[#00d2ff]/30 rounded-full blur-[40px] transition-transform duration-700 group-hover:scale-150"></div>
                <div className="absolute bottom-0 left-0 w-56 h-56 bg-white/10 rounded-full blur-[40px] transition-transform duration-700 group-hover:scale-150"></div>
                <div className="relative flex flex-col items-center gap-5">
                  <div className="w-24 h-24 rounded-full bg-white/20 backdrop-blur-xl flex items-center justify-center text-white border border-white/30 shadow-[0_4px_20px_rgba(0,0,0,0.15),inset_0_1px_4px_rgba(255,255,255,0.5)] transition-transform duration-500 group-hover:scale-110">
                    <svg className="w-12 h-12 drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                  </div>
                  <div className="text-center">
                    <h3 className="text-3xl font-black tracking-tight text-white drop-shadow-md">Escanear</h3>
                    <p className="text-xs font-semibold text-white/75 mt-1.5">Toca para abrir la cámara</p>
                  </div>
                </div>
              </button>

              {/* Resumen: asistencia y racha */}
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <Tarjeta indice={2} className="p-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Tu asistencia</p>
                  <p className="text-sm font-semibold text-slate-500 mt-1">
                    {porcentajeAsistencia === null ? 'Aún no hay clases cerradas' : `${resumen.total} ${resumen.total === 1 ? 'clase' : 'clases'} · ${resumen.faltas} ${resumen.faltas === 1 ? 'falta' : 'faltas'}`}
                  </p>
                </div>
                <p className={`text-4xl font-black tracking-tighter ${porcentajeAsistencia === null ? 'text-slate-300' : porcentajeAsistencia >= 85 ? 'text-emerald-500' : porcentajeAsistencia >= 70 ? 'text-amber-500' : 'text-rose-500'}`}>
                  {porcentajeAsistencia === null ? '—' : `${porcentajeAsistencia}%`}
                </p>
              </Tarjeta>
              <TarjetaRacha racha={racha.actual} record={racha.record} indice={3} />
              </div>

              {/* Mis asignaturas */}
              <Tarjeta indice={3} className="md:col-span-2 p-6 sm:p-8 flex flex-col">
                <h3 className="text-xl font-black text-marino tracking-tight mb-6 flex items-center gap-3">
                  Mis asignaturas
                  <Etiqueta tono="info">{clasesHoy.length}</Etiqueta>
                </h3>

                {cargandoClases ? (
                  <Esqueleto filas={2} alto="h-[88px]" />
                ) : clasesHoy.length === 0 ? (
                  <Vacio icono="📚" titulo="Aún no tienes asignaturas" texto="Aparecerán aquí cuando escanees el QR de tu primera clase." />
                ) : (
                  <div className="space-y-3">
                    {clasesHoy.map((clase: any, i: number) => {
                      const hoyHay = horaDeHoy(horarios, clase.id);
                      const esHoy = !!hoyHay;
                      return (
                        <div key={clase.id} style={retraso(i + 4)} className={`bento-entrada p-5 flex items-center justify-between gap-4 border rounded-control transition-all duration-300 hover:-translate-y-0.5 ${esHoy ? 'bg-emerald-50/80 border-emerald-200 shadow-[0_4px_20px_rgba(52,211,153,0.12)]' : 'bg-white/70 border-white hover:bg-white'}`}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              {esHoy && <Etiqueta tono="exito" className="animate-pulse">Hoy</Etiqueta>}
                              <h4 className="font-bold text-marino text-[15px] tracking-tight leading-snug truncate">{clase.nombre}</h4>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`flex items-center gap-1.5 text-[11px] font-bold tracking-wider ${esHoy ? 'text-emerald-700' : 'text-azul/80'}`}>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                {hoyHay ? tramo(hoyHay) : resumenHorario(filasDe(horarios, clase.id), clase.horario)}
                              </span>
                              {clase.statsFaltas && clase.statsFaltas.total > 0 && (
                                <Etiqueta tono={clase.statsFaltas.porcentaje >= 30 ? 'peligro' : clase.statsFaltas.porcentaje >= 15 ? 'aviso' : 'exito'}>
                                  {clase.statsFaltas.porcentaje}% faltas ({clase.statsFaltas.faltas}/{clase.statsFaltas.total})
                                </Etiqueta>
                              )}
                            </div>
                          </div>
                          <Etiqueta tono={esHoy ? 'exito' : 'neutro'} className="shrink-0 px-3.5 py-2">{clase.aula}</Etiqueta>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Tarjeta>
            </div>
          )}

          {tabActual === 'CALENDARIO' && (
            <Tarjeta indice={1} className="p-6 sm:p-8 contenido-pestana">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
                <TituloSeccion>Historial</TituloSeccion>
                <Boton variante="acento" tamano="pequeno" onClick={exportarHistorialAlumno}>Descargar informe</Boton>
              </div>

              {cargandoHistorial ? (
                <Esqueleto filas={4} alto="h-[92px]" />
              ) : historial.length === 0 ? (
                <Vacio icono="🗓️" titulo="Aún no tienes asistencias registradas" texto="Cuando escanees el QR en clase, aparecerán aquí." />
              ) : (
                <div className="space-y-3 max-h-[60dvh] overflow-y-auto pr-1 scrollbar-hide">
                  {historial.map((registro, idx) => (
                    <div key={idx} style={retraso(Math.min(idx, 10))} className="bento-entrada p-5 bg-white/70 border border-white rounded-control flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all duration-300 hover:bg-white hover:-translate-y-0.5">
                      <div className="min-w-0">
                        <h4 className="font-bold text-marino text-[15px] tracking-tight mb-2 truncate">{registro.asignatura_nombre}</h4>
                        <div className="flex flex-wrap gap-2">
                          <Etiqueta>{new Date(registro.fecha).toLocaleDateString('es-ES')}</Etiqueta>
                          <Etiqueta>Entrada: {registro.hora_entrada ? new Date(registro.hora_entrada).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</Etiqueta>
                          <Etiqueta>Salida: {registro.hora_salida ? new Date(registro.hora_salida).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '--:--'}</Etiqueta>
                        </div>
                      </div>
                      <Etiqueta
                        className="self-start sm:self-auto px-4 py-2"
                        tono={registro.estado === 'PRESENTE' ? 'exito' : registro.estado === 'RETRASO' ? 'aviso' : registro.estado === 'FALTA_JUSTIFICADA' ? 'info' : 'peligro'}
                      >
                        {ESTADOS_LEGIBLES[registro.estado] || registro.estado.replace(/_/g, ' ')}
                      </Etiqueta>
                    </div>
                  ))}
                </div>
              )}
            </Tarjeta>
          )}
        </>
      )}
    </Pantalla>
  );
}
