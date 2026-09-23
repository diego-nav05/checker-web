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
  const [zoomActual, setZoomActual] = useState<number>(1);
  
  const [notificacion, setNotificacion] = useState<{ texto: string; tipo: 'exito' | 'error' | 'info' } | null>(null);
  const [clasesHoy, setClasesHoy] = useState<Asignatura[]>([]);
  const [cargandoClases, setCargandoClases] = useState(true);
  const [asistenciasActivas, setAsistenciasActivas] = useState<any[]>([]);
  
  const [modalSalir, setModalSalir] = useState<string | null>(null); 
  const [passConfirm, setPassConfirm] = useState('');
  const [cargandoPass, setCargandoPass] = useState(false);

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
      const { data: misAsistencias } = await supabase.from('asistencias').select('sesion_id').eq('alumno_id', alumnoId);
      if (!misAsistencias || misAsistencias.length === 0) return setClasesHoy([]);
      
      const sesionIds = [...new Set(misAsistencias.map(a => a.sesion_id))];
      const { data: sesiones } = await supabase.from('sesiones').select('asignatura_id').in('id', sesionIds);
      if (!sesiones || sesiones.length === 0) return;
      
      const asigIds = [...new Set(sesiones.map(s => s.asignatura_id))];
      const { data: asignaturas } = await supabase.from('asignaturas').select('*').in('id', asigIds).order('horario', { ascending: true });
      if (asignaturas) setClasesHoy(asignaturas as Asignatura[]);
    } finally {
      setCargandoClases(false);
    }
  };

  const cargarAsistenciasActivas = async () => {
    if (!alumnoId) return;
    const { data } = await supabase.from('asistencias').select('id, hora_entrada, sesion_id').eq('alumno_id', alumnoId).eq('estado', 'PRESENTE').is('hora_salida', null);
    if (data) setAsistenciasActivas(data);
  };

  useEffect(() => { 
    cargarAsignaturas();
    cargarAsistenciasActivas(); 
  }, [alumnoId]);

  useEffect(() => {
    const cargarHistorial = async () => {
      if (!alumnoId || tabActual !== 'CALENDARIO') return;
      setCargandoHistorial(true);
      try {
        const { data: asistData } = await supabase.from('asistencias').select('*').eq('alumno_id', alumnoId);
        if (asistData && asistData.length > 0) {
          const sesionIds = [...new Set(asistData.map(a => a.sesion_id))];
          const { data: sesionesData } = await supabase.from('sesiones').select('id, created_at, asignatura_id').in('id', sesionIds);
          const asigIds = [...new Set(sesionesData?.map(s => s.asignatura_id) || [])];
          const { data: asigData } = await supabase.from('asignaturas').select('id, nombre').in('id', asigIds);

          const historialMapeado = asistData.map((registro: any) => {
            const ses = sesionesData?.find(s => s.id === registro.sesion_id);
            const asig = asigData?.find(a => a.id === ses?.asignatura_id);
            return {
              ...registro,
              asignatura_nombre: asig ? asig.nombre : 'Clase registrada',
              fecha: registro.hora_entrada || ses?.created_at || new Date().toISOString()
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

              cargarAsistenciasActivas();
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

          await html5QrCode.start({ facingMode: "environment" }, { fps: 15, qrbox: { width: 250, height: 250 } }, onScanSuccess, () => {});
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
  const aplicarZoom = async (nivel: number) => {
    setZoomActual(nivel);
    try {
      const videoElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
      if (!videoElement) return;

      const stream = videoElement.srcObject as MediaStream;
      if (stream) {
        const track = stream.getVideoTracks()[0];
        
        // CORRECCIÓN: Forzamos el tipado a 'any' para evitar que TS bloquee la API experimental de zoom
        const capabilities = track.getCapabilities ? track.getCapabilities() as any : {};
        
        // 1. Intento por Hardware (Android / iOS 17+)
        if (capabilities.zoom) {
          const maxZoom = capabilities.zoom.max || 3;
          const targetZoom = Math.min(nivel, maxZoom);
          await track.applyConstraints({ advanced: [{ zoom: targetZoom }] } as any);
          videoElement.style.transform = `scale(1)`; // Reseteamos CSS si hay hardware
          return;
        }
      }
      // 2. Intento por Software (Fallback para iPhones antiguos y webkit estricto)
      videoElement.style.transform = `scale(${nivel})`;
      videoElement.style.transformOrigin = 'center center';
    } catch (e) {
      console.log("Fallback a zoom digital por políticas del navegador");
      const videoElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
      if (videoElement) {
        videoElement.style.transform = `scale(${nivel})`;
        videoElement.style.transformOrigin = 'center center';
      }
    }
  };

  const cerrarCamara = () => {
    if (qrScannerRef.current) qrScannerRef.current.stop().catch(()=>{});
    setCamaraActiva(false);
  };

  const confirmarSalidaSegura = async () => {
    setCargandoPass(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Sin sesión activa.");
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: passConfirm });
      if (error) throw new Error("Contraseña incorrecta.");
      
      await supabase.from('asistencias').update({ estado: 'FALTA_INJUSTIFICADA', hora_entrada: null }).eq('id', modalSalir);
      setModalSalir(null);
      setPassConfirm('');
      cargarAsistenciasActivas();
      mostrarNotificacion('Registro anulado.', 'info');
    } catch (error: any) { 
      mostrarNotificacion(error.message, 'error'); 
    } finally { 
      setCargandoPass(false); 
    }
  };

  const exportarHistorialAlumno = () => {
    if (historial.length === 0) return mostrarNotificacion('No hay datos.', 'info');
    const filas = historial.map(reg => ({
      Fecha: new Date(reg.fecha).toLocaleDateString(),
      Asignatura: reg.asignatura_nombre,
      Estado: reg.estado.replace(/_/g, ' '),
      Entrada: reg.hora_entrada ? new Date(reg.hora_entrada).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-',
      Salida: reg.hora_salida ? new Date(reg.hora_salida).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-',
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Mi_Asistencia');
    XLSX.writeFile(libro, `Mi_Asistencia_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);
  };

  return (
    <div className="min-h-[100dvh] bg-[#F0F4F8] p-4 sm:p-8 flex flex-col font-sans selection:bg-[#0090d0] selection:text-white relative">
      
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
            <div className="w-[70vw] max-w-[300px] aspect-square relative">
              {/* Esquinas Lector */}
              <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-white/80 rounded-tl-3xl shadow-[0_0_15px_rgba(255,255,255,0.2)]"></div>
              <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-white/80 rounded-tr-3xl shadow-[0_0_15px_rgba(255,255,255,0.2)]"></div>
              <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-white/80 rounded-bl-3xl shadow-[0_0_15px_rgba(255,255,255,0.2)]"></div>
              <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-white/80 rounded-br-3xl shadow-[0_0_15px_rgba(255,255,255,0.2)]"></div>
              
              {procesandoQr && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-3xl transition-all">
                  <div className="w-10 h-10 border-4 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin shadow-[0_0_20px_rgba(52,211,153,0.5)]"></div>
                </div>
              )}
            </div>
          </div>

          {/* Contenedor de Video del Escáner */}
          <div className="flex-1 w-full h-full overflow-hidden bg-black flex items-center justify-center">
            <div id="qr-reader" className="w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-cover [&>video]:transition-transform [&>video]:duration-300"></div>
          </div>

          {/* Barra Inferior (Controles de Zoom Híbrido) */}
          <div className="absolute bottom-0 left-0 right-0 p-8 pb-16 flex flex-col items-center justify-center z-50 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
            <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mb-4">Ajuste de Lente</p>
            <div className="flex items-center gap-2 bg-black/50 backdrop-blur-xl p-1.5 rounded-full border border-white/10">
              {[1, 2, 3].map((nivel) => (
                <button
                  key={nivel}
                  onClick={() => aplicarZoom(nivel)}
                  className={`w-12 h-12 rounded-full font-bold text-sm transition-all duration-300 ${zoomActual === nivel ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.3)]' : 'bg-transparent text-white/70 hover:bg-white/10 hover:text-white'}`}
                >
                  {nivel}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CABECERA (Fuera de la cámara) */}
      {!camaraActiva && (
        <div className="flex items-center justify-between bg-white/60 backdrop-blur-2xl px-6 py-4 rounded-[2.5rem] shadow-[0_8px_32px_rgba(0,43,92,0.04)] border border-white/50 mb-8 max-w-4xl mx-auto w-full transition-all">
          <div className="flex items-center gap-4">
            <button onClick={onVolver} className="flex items-center justify-center w-11 h-11 bg-white hover:bg-slate-50 border border-slate-100/80 rounded-full text-slate-500 shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer active:scale-90">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <h1 className="text-xl font-black text-[#002b5c] tracking-tight leading-tight">Estudiante</h1>
              <p className="text-xs font-semibold text-slate-400 tracking-wide mt-0.5 truncate max-w-[150px]">{nombre}</p>
            </div>
          </div>
          <button onClick={() => setTabActual(tabActual === 'HORARIO' ? 'CALENDARIO' : 'HORARIO')} className={`px-6 py-3 rounded-full text-xs font-bold transition-all duration-300 active:scale-95 border ${tabActual === 'CALENDARIO' ? 'bg-[#002b5c] text-white shadow-md border-transparent' : 'bg-white text-[#002b5c] hover:bg-slate-50 border-slate-100 shadow-sm'}`}>
            {tabActual === 'HORARIO' ? 'Ver Historial' : 'Volver a Clases'}
          </button>
        </div>
      )}

      {/* DASHBOARD PRINCIPAL */}
      <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col">
        {tabActual === 'HORARIO' && !camaraActiva && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-[fade-in_0.4s_ease-out]">
            
            {/* Botón Escáner Principal */}
            <button onClick={() => setCamaraActiva(true)} className="md:col-span-1 aspect-square sm:aspect-auto bg-gradient-to-br from-[#00a8f3] to-[#007fb8] rounded-[3rem] p-8 flex flex-col justify-between text-left cursor-pointer active:scale-[0.97] transition-all duration-500 shadow-[0_15px_40px_rgba(0,144,208,0.25)] hover:shadow-[0_20px_50px_rgba(0,144,208,0.35)] hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-40 h-40 bg-white/20 rounded-full blur-3xl -mr-10 -mt-10 transition-transform duration-700 group-hover:scale-150"></div>
              <div className="w-16 h-16 rounded-[1.5rem] bg-white/20 backdrop-blur-md flex items-center justify-center text-white mb-8 border border-white/20 shadow-inner">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
              </div>
              <h3 className="text-3xl font-black tracking-tight text-white leading-tight">Escanear<br/>Asistencia</h3>
            </button>

            {/* Panel de Asignaturas y Activas */}
            <div className="md:col-span-2 bg-white/60 backdrop-blur-3xl rounded-[3rem] p-8 shadow-[0_15px_40px_-15px_rgba(0,43,92,0.08)] border border-white/60 flex flex-col">
              
              {asistenciasActivas.length > 0 && (
                <div className="mb-10">
                  <h4 className="text-[11px] font-bold text-emerald-500 uppercase tracking-widest mb-4 flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.5)]"></span>En Clase Activa</h4>
                  <div className="space-y-3">
                    {asistenciasActivas.map((asist) => (
                      <div key={asist.id} className="p-5 bg-gradient-to-r from-emerald-50 to-white border border-emerald-100 rounded-[2rem] flex items-center justify-between shadow-sm">
                        <div>
                          <h4 className="font-bold text-emerald-900 text-sm tracking-tight">Registro Confirmado</h4>
                          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-600/70 mt-1.5 flex items-center gap-2">
                            <span>Llegada</span>
                            <span className="w-1 h-1 bg-emerald-300 rounded-full"></span>
                            <span>{new Date(asist.hora_entrada).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </p>
                        </div>
                        <button onClick={() => setModalSalir(asist.id)} className="px-5 py-2.5 bg-white border border-rose-100 text-rose-500 text-[10px] font-bold uppercase tracking-widest rounded-full shadow-[0_2px_10px_rgba(244,63,94,0.1)] hover:text-white hover:bg-rose-500 hover:border-transparent hover:shadow-[0_8px_20px_rgba(244,63,94,0.25)] transition-all duration-300 cursor-pointer active:scale-95">Anular</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-6">Mis Asignaturas</h3>
              {cargandoClases ? (
                <div className="flex justify-center py-10 text-slate-400 font-semibold tracking-wide animate-pulse">Sincronizando clases...</div>
              ) : clasesHoy.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/50 rounded-[2rem] border border-slate-100 border-dashed">
                  <p className="text-sm font-medium text-slate-400">Escanea un QR por primera vez para enlazar materias.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {clasesHoy.map((clase) => (
                    <div key={clase.id} className="p-5 bg-white/80 hover:bg-white backdrop-blur-md rounded-[2rem] flex items-center justify-between border border-slate-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-all hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] group">
                      <div>
                        <h4 className="font-bold text-[#002b5c] text-sm tracking-tight">{clase.nombre}</h4>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-1.5">{clase.horario}</p>
                      </div>
                      <span className="bg-slate-50 border border-slate-100 px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:bg-[#0090d0]/5 group-hover:text-[#0090d0] group-hover:border-[#0090d0]/10 transition-colors">{clase.aula}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* HISTORIAL */}
        {tabActual === 'CALENDARIO' && (
          <div className="bg-white/60 backdrop-blur-3xl rounded-[3rem] p-8 shadow-[0_15px_40px_-15px_rgba(0,43,92,0.08)] border border-white/60 animate-[fade-in_0.4s_ease-out]">
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
              <div className="space-y-3 max-h-[550px] overflow-y-auto pr-3 scrollbar-hide">
                {historial.map((registro, idx) => (
                  <div key={idx} className="p-5 bg-white border border-slate-100 shadow-sm rounded-[2rem] flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
                    <div>
                      <h4 className="font-bold text-[#002b5c] text-sm tracking-tight mb-1.5">{registro.asignatura_nombre}</h4>
                      <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        <span className="bg-slate-50 px-2 py-1 rounded-md border border-slate-100">{new Date(registro.fecha).toLocaleDateString()}</span>
                        <span className="bg-slate-50 px-2 py-1 rounded-md border border-slate-100">In: {registro.hora_entrada ? new Date(registro.hora_entrada).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                        <span className="bg-slate-50 px-2 py-1 rounded-md border border-slate-100">Out: {registro.hora_salida ? new Date(registro.hora_salida).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                      </div>
                    </div>
                    <span className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-center shadow-sm border
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

      {modalSalir && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4 z-[200] animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white rounded-[3rem] p-10 max-w-sm w-full shadow-2xl text-center border border-white/20">
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-2">Anular Asistencia</h3>
            <p className="text-xs text-slate-500 font-medium mb-8">Introduce tu contraseña para confirmar.</p>
            <input type="password" placeholder="Contraseña" value={passConfirm} onChange={(e) => setPassConfirm(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl mb-8 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-center text-sm font-semibold transition-all"/>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => { setModalSalir(null); setPassConfirm(''); }} className="py-4 rounded-2xl text-slate-500 text-sm font-bold bg-slate-50 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer">Cancelar</button>
              <button onClick={confirmarSalidaSegura} disabled={cargandoPass || !passConfirm} className="py-4 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold shadow-md shadow-rose-500/20 active:scale-95 disabled:opacity-50 transition-all cursor-pointer">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
