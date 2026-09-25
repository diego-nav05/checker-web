import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import CryptoJS from 'crypto-js';
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import type { Asignatura } from './types';

interface Props {
  onVolver: () => void;
}

type TabAlumno = 'HORARIO' | 'CALENDARIO';

export default function PantallaAlumno({ onVolver }: Props) {
  const [nombre] = useState<string>(() => localStorage.getItem('checker_nombre') || 'Estudiante');
  const [alumnoId] = useState<string>(() => localStorage.getItem('checker_alumno_id') || '');
  
  const [tabActual, setTabActual] = useState<TabAlumno>('HORARIO');
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [procesandoQr, setProcesandoQr] = useState(false);
  const [zoomActual, setZoomActual] = useState<number | string>(1);
  
  const [notificacion, setNotificacion] = useState<{ texto: string; tipo: 'exito' | 'error' | 'info' } | null>(null);
  const [clasesHoy, setClasesHoy] = useState<Asignatura[]>([]);
  const [cargandoClases, setCargandoClases] = useState(true);


  const [historial, setHistorial] = useState<any[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const qrScannerRef = useRef<Html5Qrcode | null>(null);

  const mostrarNotificacion = (texto: string, tipo: 'exito' | 'error' | 'info' = 'info') => {
    setNotificacion({ texto, tipo });
    setTimeout(() => setNotificacion(null), 4000);
  };

  const cargarAsignaturas = async () => {
    if (!alumnoId) return;
    setCargandoClases(true);
    try {
      const { data: misAsistencias } = await supabase.from('asistencias').select('sesion_id, estado').eq('alumno_id', alumnoId);
      if (!misAsistencias || misAsistencias.length === 0) return setClasesHoy([]);
      
      const sesionIdsAlumno = [...new Set(misAsistencias.map(a => a.sesion_id))];
      const { data: sesiones } = await supabase.from('sesiones').select('id, asignatura_id');
      if (!sesiones || sesiones.length === 0) return;
      
      const asigIdsAlumno = [...new Set(sesiones.filter(s => sesionIdsAlumno.includes(s.id)).map(s => s.asignatura_id))].filter(Boolean);
      let asignaturas: any[] = [];
      if (asigIdsAlumno.length > 0) {
        const res = await supabase.from('asignaturas').select('*').in('id', asigIdsAlumno).order('horario', { ascending: true });
        if (res.data) asignaturas = res.data;
      }
      
      if (asignaturas) {
        const asigsConStats = asignaturas.map(asig => {
           const sesionesDeAsig = sesiones.filter(s => s.asignatura_id === asig.id);
           const totalSesionesPosibles = sesionesDeAsig.length;
           
           const asistsDeEstaAsig = misAsistencias.filter(a => sesionesDeAsig.some(s => s.id === a.sesion_id));
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
        
        const hoy = new Date().getDay();
        const sorted = (asigsConStats as Asignatura[]).sort((a, b) => {
          const aHoy = (a.dias_semana || []).includes(hoy) ? 1 : 0;
          const bHoy = (b.dias_semana || []).includes(hoy) ? 1 : 0;
          return bHoy - aHoy;
        });

        setClasesHoy(sorted);
      }
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
        const { data: asistData } = await supabase.from('asistencias').select('*').eq('alumno_id', alumnoId);
        if (asistData && asistData.length > 0) {
          const sesionIds = [...new Set(asistData.map(a => a.sesion_id))].filter(Boolean);
          
          let sesionesData: any[] = [];
          if (sesionIds.length > 0) {
            const { data, error } = await supabase.from('sesiones').select('id, fecha, asignatura_id').in('id', sesionIds);
            if (error) console.error("Error cargando sesiones:", error);
            if (data) sesionesData = data;
          }
          
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
      } finally {
        setCargandoHistorial(false);
      }
    };
    cargarHistorial();
  }, [tabActual, alumnoId]);

  useEffect(() => {
    let isMounted = true;
    let isProcessingLocally = false;

    const inicializarCamara = async () => {
      if (!camaraActiva) return;
      setProcesandoQr(false);
      setZoomActual(1);
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        stream.getTracks().forEach(track => track.stop());
      } catch {
        if (isMounted) {
          mostrarNotificacion('Activa la cámara en los ajustes de tu móvil.', 'error');
          setCamaraActiva(false);
        }
        return;
      }

      setTimeout(async () => {
        if (!isMounted || !camaraActiva) return;
        
        try {
          const html5QrCode = new Html5Qrcode('qr-reader');
          qrScannerRef.current = html5QrCode;
          
          const onScanSuccess = async (decodedText: string) => {
            if (isProcessingLocally) return;
            isProcessingLocally = true;
            const tiempoEscaneo = Date.now();
            if (html5QrCode.getState() === 2) html5QrCode.pause();
            setProcesandoQr(true);

            try {
              const payload = JSON.parse(decodedText);
              const { s: sesionId, f: fase, t: bloqueTiempo, token } = payload;

              const { data: sesion, error: sesionErr } = await supabase.from('sesiones').select('*').eq('id', sesionId).single();
              if (sesionErr || !sesion || sesion.fase === 'CERRADA') throw new Error('El aula ya no admite entradas.');
              
              if (Math.abs(Math.floor(tiempoEscaneo / 1000) - bloqueTiempo) > 4) throw new Error('Código caducado. Vuelve a enfocar.');
              
              const tokenEsperado = CryptoJS.HmacSHA256(`${sesionId}|${fase}|${bloqueTiempo}`, sesion.secret_totp).toString();
              if (token !== tokenEsperado) throw new Error('El QR no es auténtico.');

              const ahora = new Date().toISOString();
              
              const { data: existe } = await supabase.from('asistencias').select('*').eq('sesion_id', sesionId).eq('alumno_id', alumnoId).maybeSingle();

              if (existe && existe.manual) {
                throw new Error('El docente ha bloqueado o modificado tu registro para esta sesión.');
              }

              if (fase === 'ENTRADA') {
                if (existe) {
                  await supabase.from('asistencias').update({ estado: 'PRESENTE', hora_entrada: ahora }).eq('id', existe.id);
                } else {
                  await supabase.from('asistencias').insert({ sesion_id: sesionId, alumno_id: alumnoId, estado: 'PRESENTE', hora_entrada: ahora });
                }
                mostrarNotificacion('¡Entrada registrada!', 'exito');
              } else {
                if (existe) {
                  const nuevoEstado = existe.hora_entrada ? existe.estado : 'RETRASO';
                  await supabase.from('asistencias').update({ hora_salida: ahora, estado: nuevoEstado }).eq('id', existe.id);
                } else {
                  await supabase.from('asistencias').insert({ sesion_id: sesionId, alumno_id: alumnoId, estado: 'RETRASO', hora_salida: ahora });
                }
                mostrarNotificacion('¡Salida completada!', 'exito');
              }

              try {
                const pingChannel = supabase.channel('aula-realtime');
                pingChannel.subscribe((status) => {
                  if (status === 'SUBSCRIBED') {
                    pingChannel.send({ type: 'broadcast', event: 'update-lista', payload: { action: 'refresh' } });
                    setTimeout(() => supabase.removeChannel(pingChannel), 1000);
                  }
                });
              } catch (e) {}


              cargarAsignaturas();
              
              if (html5QrCode.getState() !== 1) await html5QrCode.stop();
              html5QrCode.clear();
              setCamaraActiva(false);
              
            } catch (e: any) {
              mostrarNotificacion(e.message || 'Error procesando código.', 'error');
              setProcesandoQr(false);
              isProcessingLocally = false;
              if (html5QrCode.getState() === 3) html5QrCode.resume();
            }
          };

          await html5QrCode.start({ facingMode: "environment" }, { fps: 15 }, onScanSuccess, () => {});
        } catch {
          if (isMounted) {
            mostrarNotificacion('Error conectando con la cámara.', 'error');
            setCamaraActiva(false);
          }
        }
      }, 100);
    };

    inicializarCamara();

    return () => {
      isMounted = false;
      if (qrScannerRef.current && qrScannerRef.current.getState() !== 1) {
        qrScannerRef.current.stop().catch(() => {});
        qrScannerRef.current.clear();
      }
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
          videoElement.style.transform = `scale(${softwareZoom})`;
          videoElement.style.transformOrigin = 'center center';
          return;
        }
      }
      // 2. Intento por Software (Fallback para iPhones antiguos y webkit estricto)
      videoElement.style.transform = `scale(${targetNivel})`;
      videoElement.style.transformOrigin = 'center center';
    } catch (e) {
      console.log("Fallback a zoom digital por políticas del navegador");
      const videoElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
      if (videoElement) {
        const targetNivel = typeof nivel === 'number' ? nivel : 5;
        videoElement.style.transform = `scale(${targetNivel})`;
        videoElement.style.transformOrigin = 'center center';
      }
    }
  };

  const cerrarCamara = () => {
    if (qrScannerRef.current) qrScannerRef.current.stop().catch(()=>{});
    setCamaraActiva(false);
  };



  const exportarHistorialAlumno = () => {
    if (historial.length === 0) return mostrarNotificacion('No hay datos.', 'info');
    
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
      const fechaStr = new Date(reg.fecha).toLocaleDateString();
      if (!registrosPorFecha[fechaStr]) {
        registrosPorFecha[fechaStr] = { Fecha: fechaStr };
        fechasOrdenadas.push(fechaStr); // Como el historial viene ordenado desc, esto mantiene el orden
      }
      
      const estadoLimpio = reg.estado.replace(/_/g, ' ');
      const horaStr = reg.hora_entrada 
        ? new Date(reg.hora_entrada).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) 
        : (reg.hora_salida ? new Date(reg.hora_salida).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '');
      
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
    XLSX.writeFile(libro, `Mi_Asistencia_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);
  };

  return (
    <div className="min-h-[100dvh] bg-[#F0F4F8] p-4 sm:p-8 flex flex-col font-sans selection:bg-[#0090d0] selection:text-white relative overflow-hidden">
      <div className="glow-blob"></div>
      
      {/* NOTIFICACIONES */}
      {notificacion && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3.5 rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] backdrop-blur-2xl flex items-center gap-3 transition-all duration-500 cubic-bezier(0.16,1,0.3,1) animate-[fade-in-down_0.4s_ease-out] w-fit min-w-[280px] max-w-sm border ${
          notificacion.tipo === 'error' ? 'bg-rose-500/95 border-rose-400/50 text-white' : 
          notificacion.tipo === 'exito' ? 'bg-emerald-500/95 border-emerald-400/50 text-white' : 
          'bg-[#002b5c]/95 border-white/10 text-white'
        }`}>
          <span className="text-sm font-semibold tracking-wide">{notificacion.texto}</span>
        </div>
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
            <div className="w-[72vw] max-w-[280px] aspect-square relative rounded-[2rem] border-2 border-white/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
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
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-[2rem] transition-all">
                  <div className="w-10 h-10 border-4 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin shadow-[0_0_20px_rgba(52,211,153,0.5)]"></div>
                </div>
              )}
            </div>
          </div>

          {/* Contenedor de Video del Escáner */}
          <div className="flex-1 w-full h-full overflow-hidden bg-black flex items-center justify-center">
            <div id="qr-reader" className="w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-cover [&>video]:transition-transform [&>video]:duration-300 [&_#qr-shaded-region]:hidden"></div>
          </div>

          {/* Barra Inferior (Controles de Zoom Híbrido) */}
          <div className="absolute bottom-0 left-0 right-0 p-8 pb-16 flex flex-col items-center justify-center z-50 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
            <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mb-4">Ajuste de Lente</p>
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

      {/* MAIN CONTENT WRAPPER */}
      <div className="w-full flex-1 flex flex-col anim-suave relative z-10">
        {/* CABECERA (Fuera de la cámara) */}
        {!camaraActiva && (
          <div className="flex items-center justify-between glass-container px-6 py-4 rounded-[2.5rem] mb-8 max-w-4xl mx-auto w-full transition-all">
          <div className="flex items-center gap-4">
            <button onClick={onVolver} className="flex items-center justify-center w-11 h-11 bg-white hover:bg-slate-50 border border-slate-100/80 rounded-full text-slate-500 shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer active:scale-90">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <h1 className="text-xl font-black text-[#002b5c] tracking-tight leading-tight">Estudiante</h1>
              <p className="text-xs font-semibold text-slate-400 tracking-wide mt-0.5 truncate max-w-[150px]">{nombre}</p>
            </div>
          </div>
          <button onClick={() => setTabActual(tabActual === 'HORARIO' ? 'CALENDARIO' : 'HORARIO')} className={`px-6 py-3 rounded-full text-xs font-bold transition-all duration-300 active:scale-95 border ${tabActual === 'CALENDARIO' ? 'bg-[#002b5c] text-white shadow-md border-transparent' : 'glass-button text-[#002b5c] hover:text-[#0090d0] hover:bg-white/40'}`}>
            {tabActual === 'HORARIO' ? 'Ver Historial' : 'Volver a Clases'}
          </button>
        </div>
      )}

      {/* DASHBOARD PRINCIPAL */}
      <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col">
        {tabActual === 'HORARIO' && !camaraActiva && (
          <div className="flex flex-col md:flex-row gap-6 animate-[fade-in_0.4s_ease-out]">
            
            {/* Columna Izquierda: Escanear */}
            <button onClick={() => setCamaraActiva(true)} className="w-full md:w-1/3 aspect-square sm:aspect-auto sm:min-h-[380px] bg-gradient-to-br from-[#0090d0]/90 to-[#002b5c]/90 backdrop-blur-xl border border-white/20 shadow-[0_8px_32px_rgba(0,144,208,0.2)] rounded-[3rem] p-6 flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group">
              {/* Background glowing orbs */}
              <div className="absolute top-0 right-0 w-48 h-48 bg-[#00d2ff]/30 rounded-full blur-[40px] transition-transform duration-700 group-hover:scale-150 group-hover:bg-[#00d2ff]/40"></div>
              <div className="absolute bottom-0 left-0 w-56 h-56 bg-white/10 rounded-full blur-[40px] transition-transform duration-700 group-hover:scale-150 group-hover:bg-white/20"></div>
              
              <div className="z-10 relative flex flex-col items-center justify-center gap-5 my-auto">
                <div className="w-24 h-24 rounded-full bg-white/20 backdrop-blur-xl flex items-center justify-center text-white border border-white/30 shadow-[0_4px_20px_rgba(0,0,0,0.15),inset_0_1px_4px_rgba(255,255,255,0.5)] transition-all duration-500 group-hover:scale-110 group-hover:bg-white/30">
                  <svg className="w-12 h-12 drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                </div>
                
                <div className="flex flex-col items-center">
                  <h3 className="text-3xl font-black tracking-tight text-white drop-shadow-md transition-all duration-500 group-hover:-translate-y-1">Escanear</h3>
                  <div className="h-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-hover:h-8 transition-all duration-300 overflow-hidden">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#002b5c] bg-white px-3.5 py-1.5 rounded-full shadow-lg">Abrir cámara</span>
                  </div>
                </div>
              </div>
            </button>

            {/* Columna Derecha: Clases */}
            <div className="w-full md:w-2/3 flex flex-col gap-6">
              


              {/* Mis Asignaturas */}
              <div className="bg-white/30 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.03)] rounded-[3rem] p-6 sm:p-8 flex-1 flex flex-col relative overflow-hidden group">
                <div className="absolute bottom-0 right-0 w-64 h-64 bg-[#0090d0]/10 rounded-full blur-[60px] -mr-20 -mb-20 transition-transform duration-700 group-hover:scale-110"></div>
                <div className="absolute top-0 left-0 w-40 h-40 bg-white/40 rounded-full blur-[40px] -ml-10 -mt-10"></div>
                
                <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-6 relative z-10 flex items-center gap-3">
                  Mis Asignaturas
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0090d0]/10 text-[#0090d0] text-xs font-bold">
                    {clasesHoy.length}
                  </span>
                </h3>
                
                {cargandoClases ? (
                  <div className="flex-1 flex justify-center items-center py-10 text-[#0090d0]/60 font-semibold tracking-wide animate-pulse relative z-10">Sincronizando clases...</div>
                ) : clasesHoy.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white/40 backdrop-blur-sm rounded-[2rem] border border-[#0090d0]/20 border-dashed relative z-10">
                    <p className="text-sm font-medium text-[#002b5c]/50">Escanea un QR por primera vez para enlazar materias.</p>
                  </div>
                ) : (
                  <div className="space-y-4 relative z-10">
                    {clasesHoy.map((clase: any) => {
                      const esHoy = (clase.dias_semana || []).includes(new Date().getDay());
                      return (
                      <div key={clase.id} className={`p-5 flex items-center justify-between gap-4 backdrop-blur-lg border hover:shadow-[0_8px_30px_rgba(0,144,208,0.08)] hover:-translate-y-1 transition-all duration-300 rounded-[2rem] group/card cursor-default ${esHoy ? 'bg-emerald-50/80 border-emerald-300/60 shadow-[0_4px_20px_rgba(52,211,153,0.15)]' : 'bg-white/60 border-white hover:bg-white'}`}>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2 mb-1.5">
                            {esHoy && (
                              <span className="px-2 py-0.5 bg-emerald-500 text-white text-[9px] font-black uppercase tracking-widest rounded-md animate-pulse shadow-sm">
                                Hoy
                              </span>
                            )}
                            <h4 className="font-bold text-[#002b5c] text-[15px] tracking-tight leading-snug">{clase.nombre}</h4>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2">
                              <svg className={`w-3.5 h-3.5 ${esHoy ? 'text-emerald-500' : 'text-[#0090d0]/60'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                              <span className={`text-[11px] font-bold tracking-widest ${esHoy ? 'text-emerald-700' : 'text-[#0090d0]/80'}`}>{clase.horario}</span>
                            </div>
                            {clase.statsFaltas && (
                              <div className={`flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md border ${
                                clase.statsFaltas.porcentaje >= 30 ? 'bg-rose-50 text-rose-600 border-rose-100' : 
                                clase.statsFaltas.porcentaje >= 15 ? 'bg-amber-50 text-amber-600 border-amber-100' : 
                                'bg-emerald-50 text-emerald-600 border-emerald-100'
                              }`}>
                                <span>{clase.statsFaltas.porcentaje}% Faltas ({clase.statsFaltas.faltas}/{clase.statsFaltas.total})</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className={`border px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest group-hover/card:bg-gradient-to-r group-hover/card:from-[#0090d0] group-hover/card:to-[#002b5c] group-hover/card:text-white group-hover/card:border-transparent transition-colors duration-500 shadow-sm flex-shrink-0 ${esHoy ? 'bg-emerald-100 border-emerald-200 text-emerald-800' : 'bg-[#F0F4F8] border-slate-200/60 text-[#002b5c]'}`}>
                          {clase.aula}
                        </div>
                      </div>
                    )})}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* HISTORIAL */}
        {tabActual === 'CALENDARIO' && (
          <div className="glass-container rounded-[2.5rem] p-8 animate-[fade-in_0.4s_ease-out]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
              <h3 className="text-2xl font-black text-[#002b5c] tracking-tight">Historial</h3>
              <button onClick={exportarHistorialAlumno} className="px-6 py-3 bg-gradient-to-b from-[#00a8f3] to-[#0090d0] text-white text-xs font-bold rounded-full shadow-[0_8px_20px_rgba(0,144,208,0.3)] hover:shadow-[0_12px_28px_rgba(0,144,208,0.4)] transition-all duration-300 active:scale-95 cursor-pointer border border-[#0090d0]/20">
                Descargar Reporte
              </button>
            </div>
            
            {cargandoHistorial ? (
              <div className="py-16 flex justify-center text-slate-400 font-semibold tracking-wide animate-pulse">Cargando registros...</div>
            ) : historial.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-sm font-medium bg-slate-50/50 rounded-[2rem] border border-slate-100 border-dashed">No hay registros de asistencia previos.</div>
            ) : (
              <div className="space-y-4 max-h-[550px] overflow-y-auto pr-3 scrollbar-hide">
                {historial.map((registro, idx) => (
                  <div key={idx} className="bento-card p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
                    <div>
                      <h4 className="font-bold text-[#002b5c] text-[15px] tracking-tight mb-2">{registro.asignatura_nombre}</h4>
                      <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        <span className="bg-slate-50/80 px-2.5 py-1.5 rounded-md border border-slate-100">{new Date(registro.fecha).toLocaleDateString()}</span>
                        <span className="bg-slate-50/80 px-2.5 py-1.5 rounded-md border border-slate-100">In: {registro.hora_entrada ? new Date(registro.hora_entrada).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                        <span className="bg-slate-50/80 px-2.5 py-1.5 rounded-md border border-slate-100">Out: {registro.hora_salida ? new Date(registro.hora_salida).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                      </div>
                    </div>
                    <span className={`px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest text-center shadow-sm border transition-transform duration-300 group-hover:scale-105
                      ${registro.estado === 'PRESENTE' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                        registro.estado === 'RETRASO' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                        registro.estado === 'SE_FUE_A_MITAD' ? 'bg-purple-50 text-purple-600 border-purple-100' : 'bg-rose-50 text-rose-600 border-rose-100'}
                    `}>
                      {registro.estado.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </div>


    </div>
  );
}
