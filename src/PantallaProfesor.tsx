import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import CryptoJS from 'crypto-js';
import { supabase } from './supabase';
import type { Asistencia, EstadoAsistencia, FaseSesion } from './types';
import * as XLSX from 'xlsx';

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

  const [mostrarModalHistorial, setMostrarModalHistorial] = useState<boolean>(false);
  const [historialSesiones, setHistorialSesiones] = useState<any[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState<boolean>(false);

  const [notificacion, setNotificacion] = useState<{ texto: string; tipo: 'exito' | 'error' | 'info' } | null>(null);

  const mostrarNotificacion = (texto: string, tipo: 'exito' | 'error' | 'info' = 'info') => {
    setNotificacion({ texto, tipo });
    setTimeout(() => setNotificacion(null), 5000);
  };

  useEffect(() => {
    const arrancarDatos = async () => {
      setCargandoClases(true);
      const { data: perfilesData } = await supabase.from('perfiles').select('id, nombre_completo, email');
      if (perfilesData) {
        const dict: Record<string, any> = {};
        perfilesData.forEach(p => dict[p.id] = p);
        setDiccionarioAlumnos(dict);
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from('asignaturas').select('*').eq('profesor_id', user.id).order('horario', { ascending: true });
        if (data) setClasesHoy(data);
      }
      setCargandoClases(false);
    };
    arrancarDatos();
  }, []);

  const iniciarClase = async (idAsignatura: string) => {
    const nuevoSecret = Math.random().toString(36).substring(2, 10);
    setSecretTotp(nuevoSecret);

    const { data: sesionData, error: sesionError } = await supabase
      .from('sesiones')
      .insert({ fase: 'ENTRADA', secret_totp: nuevoSecret, asignatura_id: idAsignatura })
      .select()
      .single();

    if (sesionError || !sesionData) return mostrarNotificacion(`Error BD: ${sesionError?.message || 'Fallo al abrir'}`, 'error');
    setSesionId(sesionData.id);

    const { data: pastSesiones } = await supabase.from('sesiones').select('id').eq('asignatura_id', idAsignatura).neq('id', sesionData.id);
    if (pastSesiones && pastSesiones.length > 0) {
      const sesionIds = pastSesiones.map(s => s.id);
      const { data: pastAsistencias } = await supabase.from('asistencias').select('alumno_id').in('sesion_id', sesionIds);
      
      if (pastAsistencias && pastAsistencias.length > 0) {
        const uniqueIds = Array.from(new Set(pastAsistencias.map(a => a.alumno_id)));
        const asistenciasIniciales = uniqueIds.map((aluId) => ({
          sesion_id: sesionData.id,
          alumno_id: aluId,
          estado: 'FALTA_INJUSTIFICADA' as EstadoAsistencia,
          manual: false
        }));
        await supabase.from('asistencias').insert(asistenciasIniciales);
      }
    }

    cargarAsistencias(sesionData.id, diccionarioAlumnos);
    mostrarNotificacion('Aula iniciada correctamente.', 'exito');
  };

  const cargarAsistencias = async (idSesion: string, dict = diccionarioAlumnos) => {
    const { data } = await supabase.from('asistencias').select('*').eq('sesion_id', idSesion);
    if (data) {
      const idsFaltantes = data.map(item => item.alumno_id).filter(id => id && !dict[id]);
      let dictActualizado = { ...dict };

      if (idsFaltantes.length > 0) {
        const { data: perfilesNuevos } = await supabase.from('perfiles').select('id, nombre_completo, email').in('id', idsFaltantes);
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

    const intervaloRespaldo = setInterval(() => cargarAsistencias(sesionId, diccionarioAlumnos), 2000);

    return () => { 
      supabase.removeChannel(instantChannel);
      supabase.removeChannel(dbChannel);
      clearInterval(intervaloRespaldo);
    };
  }, [sesionId, diccionarioAlumnos]);

  useEffect(() => {
    if (!sesionId || !secretTotp || fase === 'CERRADA') return;
    const actualizarQR = async () => {
      const bloqueTiempo = Math.floor(Date.now() / 1000);
      const payload = `${sesionId}|${fase}|${bloqueTiempo}`;
      const token = CryptoJS.HmacSHA256(payload, secretTotp).toString();
      const qrPayload = JSON.stringify({ s: sesionId, f: fase, t: bloqueTiempo, token });
      
      // Renderizamos el QR a alta resolución (width 500) para máxima nitidez
      const dataUrl = await QRCode.toDataURL(qrPayload, { width: 500, margin: 1, color: { dark: '#002b5c', light: '#ffffff' } });
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
    timerRef.current = setInterval(actualizarQR, 1000);
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
              .container { background: white; padding: 24px; border-radius: 36px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); position: relative; }
              .container::after { content: ''; position: absolute; inset: -20px; background: inherit; filter: blur(40px); z-index: -1; opacity: 0.2; }
              img { width: 100%; max-width: 450px; height: auto; display: block; border-radius: 20px; }
              .badge { margin-top: 32px; padding: 10px 28px; border-radius: 99px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; font-size: 14px; transition: all 0.3s ease; }
              .info { margin-top: 16px; font-size: 13px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px; }
              .dot { width: 8px; height: 8px; background-color: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; }
            </style>
          </head>
          <body>
            <div class="container"><img id="qr-img" src="${qrSrc}" alt="QR Asistencia" /></div>
            <div class="badge" id="qr-fase" style="color: ${fase === 'ENTRADA' ? '#fbbf24' : '#38bdf8'}; background: ${fase === 'ENTRADA' ? 'rgba(251, 191, 36, 0.1)' : 'rgba(56, 189, 248, 0.1)'};">
              ${fase === 'ENTRADA' ? '📍 ESCANEO ENTRADA' : '🚪 ESCANEO SALIDA'}
            </div>
            <div class="info"><div class="dot"></div> En vivo</div>
          </body>
        </html>
      `);
      popUpRef.current = win;
    } else {
      mostrarNotificacion('Tu navegador bloqueó la ventana emergente. Permite los pop-ups.', 'error');
    }
  };

  const pasarASalida = async () => {
    if (!sesionId) return;
    await supabase.from('sesiones').update({ fase: 'SALIDA' }).eq('id', sesionId);
    setFase('SALIDA');
    mostrarNotificacion('Fase de salida activada.', 'info');
  };

  const intentarCerrarAula = () => {
    if (fase === 'ENTRADA') {
      const confirmar = window.confirm('Aviso: No activaste la salida.\nSi cierras ahora, se validará la asistencia a todos.\n¿Cerrar?');
      if (!confirmar) return;
    }
    setMostrarModalCierre(true);
  };

  const confirmarCierreClase = async () => {
    if (!passInput) return;
    setCargandoCierre(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Sin sesión activa.");
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
      mostrarNotificacion('Clase archivada.', 'exito');
      
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

  const cambiarEstadoManual = async (asistenciaId: string, nuevoEstado: EstadoAsistencia) => {
    await supabase.from('asistencias').update({ estado: nuevoEstado, manual: true }).eq('id', asistenciaId);
    cargarAsistencias(sesionId!, diccionarioAlumnos); 
  };

  const expulsarAlumno = async (asistenciaId: string, nombre: string) => {
    const confirmar = window.confirm(`¿Expulsar a ${nombre}?`);
    if (!confirmar) return;
    await supabase.from('asistencias').update({ estado: 'FALTA_INJUSTIFICADA', hora_entrada: null, hora_salida: null, manual: true }).eq('id', asistenciaId);
    cargarAsistencias(sesionId!, diccionarioAlumnos);
    mostrarNotificacion('Alumno expulsado.', 'info');
  };

  const abrirHistorial = async () => {
    setMostrarModalHistorial(true);
    setCargandoHistorial(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data: asigData } = await supabase.from('asignaturas').select('*').eq('profesor_id', user.id);
    if (asigData && asigData.length > 0) {
      const asigIds = asigData.map(a => a.id);
      const { data: sesionesData } = await supabase.from('sesiones').select('*').in('asignatura_id', asigIds).order('created_at', { ascending: false });

      if (sesionesData) {
        const mapeado = sesionesData.map(sesion => {
          const asig = asigData.find(a => a.id === sesion.asignatura_id);
          return { ...sesion, asignatura_nombre: asig ? asig.nombre : 'Clase Eliminada' };
        });
        setHistorialSesiones(mapeado);
      }
    }
    setCargandoHistorial(false);
  };

  const descargarExcelPasado = async (sesionPasadaId: string, asigNombre: string) => {
    const { data } = await supabase.from('asistencias').select('*').eq('sesion_id', sesionPasadaId);
    if (!data || data.length === 0) return mostrarNotificacion('No hay registros en esta clase.', 'error');
    
    const filas = data.map((a: any) => ({
      Alumno: diccionarioAlumnos[a.alumno_id]?.nombre_completo || 'Desconocido',
      Estado: a.estado.replace(/_/g, ' '),
      Entrada: a.hora_entrada ? new Date(a.hora_entrada).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '-',
      Salida: a.hora_salida ? new Date(a.hora_salida).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '-',
    }));
    
    const libro = XLSX.utils.book_new();
    const hoja = XLSX.utils.json_to_sheet(filas);
    XLSX.utils.book_append_sheet(libro, hoja, 'Asistencia');
    XLSX.writeFile(libro, `${asigNombre.replace(/[/\\?%*:|"<>]/g, '-')}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-4 sm:p-8 flex flex-col font-sans selection:bg-[#0090d0] selection:text-white relative">
      
      {/* NOTIFICACIONES PREMIUM */}
      {notificacion && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3.5 rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] backdrop-blur-2xl flex items-center gap-3 transition-all duration-500 cubic-bezier(0.16,1,0.3,1) animate-[fade-in-down_0.4s_ease-out] w-fit min-w-[280px] max-w-sm border ${
          notificacion.tipo === 'error' ? 'bg-rose-500/95 border-rose-400/50 text-white' : 
          notificacion.tipo === 'exito' ? 'bg-emerald-500/95 border-emerald-400/50 text-white' : 
          'bg-[#002b5c]/95 border-white/10 text-white'
        }`}>
          <span className="text-sm font-semibold tracking-wide">{notificacion.texto}</span>
        </div>
      )}

      {/* CABECERA FLOTANTE (Glassmorphism auténtico) */}
      <div className="flex items-center justify-between bg-white/60 backdrop-blur-2xl px-6 py-4 rounded-[2.5rem] shadow-[0_8px_32px_rgba(0,43,92,0.04)] border border-white/50 mb-8 max-w-7xl mx-auto w-full transition-all">
        <div className="flex items-center gap-4">
          <button onClick={onVolver} className="flex items-center justify-center w-11 h-11 bg-white hover:bg-slate-50 border border-slate-100/80 rounded-full text-slate-500 shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer active:scale-90">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-xl font-black text-[#002b5c] tracking-tight leading-tight">Profesorado</h1>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mt-0.5">
              {sesionId ? (
                <span className="flex items-center gap-1.5">Fase: <span className={`font-bold ${fase === 'ENTRADA' ? 'text-amber-500' : fase === 'SALIDA' ? 'text-[#0090d0]' : 'text-slate-400'}`}>{fase}</span></span>
              ) : 'Selección de Aula'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!sesionId ? (
            <button onClick={abrirHistorial} className="px-6 py-3 bg-white text-[#002b5c] text-xs font-bold rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] border border-slate-100 transition-all duration-300 active:scale-95 cursor-pointer">
              Ver Historial
            </button>
          ) : (
            fase !== 'CERRADA' && (
              <>
                {fase === 'ENTRADA' && (
                  <button onClick={pasarASalida} className="px-6 py-3 bg-gradient-to-b from-[#00a8f3] to-[#0090d0] text-white text-xs font-bold rounded-full shadow-[0_8px_20px_rgba(0,144,208,0.3)] hover:shadow-[0_12px_28px_rgba(0,144,208,0.4)] transition-all duration-300 active:scale-95 cursor-pointer border border-[#0090d0]/20">
                    Activar Salida
                  </button>
                )}
                <button onClick={intentarCerrarAula} className="px-6 py-3 bg-gradient-to-b from-rose-500 to-rose-600 text-white text-xs font-bold rounded-full shadow-[0_8px_20px_rgba(244,63,94,0.3)] hover:shadow-[0_12px_28px_rgba(244,63,94,0.4)] transition-all duration-300 active:scale-95 cursor-pointer border border-rose-500/20">
                  Cerrar Clase
                </button>
              </>
            )
          )}
        </div>
      </div>

      {!sesionId ? (
        // VISTA: SELECCIÓN DE CLASE (Bento UI)
        <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full">
          {cargandoClases ? (
            <div className="flex justify-center py-20 text-slate-400 font-semibold tracking-wide animate-pulse">Cargando materias del servidor...</div>
          ) : clasesHoy.length === 0 ? (
            <div className="bg-white/50 backdrop-blur-xl rounded-[3rem] p-16 shadow-[0_8px_32px_rgba(0,43,92,0.03)] border border-white/60 text-center max-w-2xl mx-auto w-full mt-10">
              <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6"><span className="text-3xl">📚</span></div>
              <p className="text-[#002b5c] font-black text-2xl tracking-tight">Cero asignaturas</p>
              <p className="text-sm text-slate-400 font-medium mt-3 leading-relaxed">No tienes asignaturas dadas de alta. Ve a "Gestión Docente" en el menú principal para configurarlas.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {clasesHoy.map((clase) => (
                <div key={clase.id} className="bg-white/70 backdrop-blur-2xl rounded-[2.5rem] p-7 shadow-[0_8px_30px_rgba(0,0,0,0.03)] border border-white/80 flex flex-col justify-between hover:shadow-[0_25px_50px_-12px_rgba(0,144,208,0.15)] hover:-translate-y-1 transition-all duration-500 group safari-border-fix">
                  <div>
                    <div className="flex items-center justify-between mb-5">
                      <span className="px-4 py-1.5 bg-slate-50 text-slate-500 border border-slate-100 text-[10px] font-bold uppercase tracking-widest rounded-full group-hover:bg-[#0090d0]/5 group-hover:text-[#0090d0] group-hover:border-[#0090d0]/10 transition-colors">{clase.aula}</span>
                      <span className="text-slate-400 text-[11px] font-bold tracking-wider uppercase">{clase.horario}</span>
                    </div>
                    <h3 className="text-2xl font-black text-[#002b5c] mb-6 leading-tight tracking-tight">{clase.nombre}</h3>
                  </div>
                  <button onClick={() => iniciarClase(clase.id)} className="w-full py-4 bg-slate-50 text-[#002b5c] hover:bg-[#002b5c] hover:text-white border border-slate-100 text-sm font-bold rounded-[1.5rem] transition-all duration-300 shadow-sm hover:shadow-[0_10px_20px_rgba(0,43,92,0.15)] active:scale-95 cursor-pointer">
                    Iniciar Aula
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        // VISTA: AULA ACTIVA
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 flex-1 max-w-7xl mx-auto w-full">
          
          {/* PANEL IZQUIERDO: Escáner QR */}
          <div className="xl:col-span-5 bg-white/60 backdrop-blur-3xl p-8 rounded-[3rem] shadow-[0_15px_40px_-15px_rgba(0,43,92,0.08)] border border-white/60 flex flex-col items-center justify-center text-center relative overflow-hidden">
            
            {/* Orbe de luz de fondo */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#0090d0] rounded-full opacity-[0.03] blur-[60px] pointer-events-none"></div>

            {fase !== 'CERRADA' ? (
              <div className="relative z-10 w-full flex flex-col items-center">
                <div className="mb-8 flex items-center justify-between w-full max-w-[320px]">
                  <span className={`text-[10px] uppercase tracking-widest font-bold px-4 py-2 rounded-full border ${fase === 'ENTRADA' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-[#0090d0]/5 text-[#0090d0] border-[#0090d0]/10'}`}>
                    {fase === 'ENTRADA' ? '📍 Modo Entrada' : '🚪 Modo Salida'}
                  </span>
                  
                  {/* BOTÓN MÁGICO: POP-UP */}
                  <button onClick={abrirPopUpQR} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 hover:bg-[#0090d0] text-slate-400 hover:text-white transition-colors cursor-pointer active:scale-90 shadow-sm border border-slate-100" title="Proyectar en ventana flotante">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </button>
                </div>

                {/* Tarjeta del QR (Más grande: w-80 h-80 = 320px) */}
                <div className="p-4 bg-white rounded-[2.5rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] border border-slate-100 group relative">
                  {/* Brillo dinámico en hover */}
                  <div className="absolute inset-0 rounded-[2.5rem] shadow-[inset_0_0_0_1px_rgba(0,144,208,0.1)] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                  {qrSrc && <img src={qrSrc} alt="QR Dinámico" className="w-72 h-72 sm:w-80 sm:h-80 rounded-[1.5rem] object-contain select-none pointer-events-none" draggable="false" />}
                </div>

                <div className="mt-10 flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-widest text-slate-400 bg-slate-50 px-5 py-2.5 rounded-full border border-slate-100">
                  <div className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </div>
                  Sincronizado en vivo
                </div>
              </div>
            ) : (
              <div className="text-center py-20 relative z-10">
                <div className="w-24 h-24 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner"><span className="text-4xl">✓</span></div>
                <h3 className="text-2xl font-black text-[#002b5c] tracking-tight mb-2">Clase Archivada</h3>
                <p className="text-sm text-slate-400 font-medium">Los datos ya se han guardado de forma segura.</p>
              </div>
            )}
          </div>

          {/* PANEL DERECHO: Lista de Alumnos */}
          <div className="xl:col-span-7 bg-white/60 backdrop-blur-3xl p-8 rounded-[3rem] shadow-[0_15px_40px_-15px_rgba(0,43,92,0.08)] border border-white/60 flex flex-col relative overflow-hidden">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-black text-[#002b5c] tracking-tight">Alumnado</h2>
              <span className="px-4 py-1.5 bg-[#002b5c] text-white text-[11px] font-bold tracking-widest uppercase rounded-full shadow-md">{asistencias.length} Registros</span>
            </div>
            
            <div className="flex-1 overflow-y-auto max-h-[550px] pr-3 space-y-3 scrollbar-hide relative z-10">
              {asistencias.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60 mt-12">
                  <span className="text-4xl mb-4">🤳</span>
                  <p className="text-sm font-medium tracking-wide">Esperando escaneos...</p>
                </div>
              ) : (
                asistencias.map((item) => (
                  <div key={item.id} className="p-4 bg-white/80 backdrop-blur-md rounded-[1.5rem] flex items-center justify-between gap-4 transition-all duration-300 border border-slate-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] hover:-translate-y-0.5">
                    <div>
                      <p className="font-bold text-[#002b5c] text-sm tracking-tight">{item.perfiles?.nombre_completo || 'Alumno Registrado'}</p>
                      <div className="flex gap-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1.5">
                        <span className="bg-slate-50 px-2 py-1 rounded-md border border-slate-100">In: {item.hora_entrada ? new Date(item.hora_entrada).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                        <span className="bg-slate-50 px-2 py-1 rounded-md border border-slate-100">Out: {item.hora_salida ? new Date(item.hora_salida).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2.5">
                      <select
                        value={item.estado}
                        onChange={(e) => cambiarEstadoManual(item.id, e.target.value as EstadoAsistencia)}
                        className={`text-[10px] font-bold uppercase tracking-widest px-3 py-2.5 rounded-xl outline-none transition-all cursor-pointer appearance-none text-center shadow-sm border ${
                          item.estado === 'PRESENTE' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                          item.estado === 'RETRASO' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                          item.estado === 'SE_FUE_A_MITAD' ? 'bg-purple-50 text-purple-600 border-purple-100' :
                          item.estado === 'FALTA_JUSTIFICADA' ? 'bg-[#0090d0]/5 text-[#0090d0] border-[#0090d0]/20' : 'bg-rose-50 text-rose-600 border-rose-100'
                        }`}
                      >
                        <option value="PRESENTE">Presente</option>
                        <option value="RETRASO">Retraso</option>
                        <option value="SE_FUE_A_MITAD">Abandono</option>
                        <option value="FALTA_JUSTIFICADA">Justificado</option>
                        <option value="FALTA_INJUSTIFICADA">Ausente</option>
                      </select>
                      
                      <button onClick={() => expulsarAlumno(item.id, item.perfiles?.nombre_completo || 'Alumno')} className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-rose-100 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer active:scale-90 shadow-sm" title="Expulsar de clase">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- MODALES --- */}
      {mostrarModalCierre && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white rounded-[3rem] p-10 max-w-sm w-full shadow-2xl text-center border border-white/20">
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-2">Finalizar Aula</h3>
            <p className="text-xs text-slate-500 font-medium mb-8">Confirma tu identidad docente.</p>
            <input type="password" placeholder="Contraseña" value={passInput} onChange={(e) => setPassInput(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl mb-8 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-center text-sm font-semibold transition-all"/>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => { setMostrarModalCierre(false); setPassInput(''); }} className="py-4 rounded-2xl text-slate-500 text-sm font-bold bg-slate-50 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer">Cancelar</button>
              <button onClick={confirmarCierreClase} disabled={cargandoCierre || !passInput} className="py-4 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold shadow-md shadow-rose-500/20 active:scale-95 disabled:opacity-50 transition-all cursor-pointer">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {mostrarModalHistorial && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white/90 backdrop-blur-3xl rounded-[3rem] p-8 max-w-lg w-full shadow-2xl border border-white/60">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black text-[#002b5c] tracking-tight">Historial Docente</h3>
              <button onClick={() => setMostrarModalHistorial(false)} className="w-10 h-10 flex items-center justify-center bg-slate-50 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors cursor-pointer active:scale-90">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            {cargandoHistorial ? (
              <div className="py-16 text-center text-slate-400 font-semibold tracking-wide animate-pulse">Buscando en la bóveda...</div>
            ) : historialSesiones.length === 0 ? (
              <div className="py-16 text-center text-slate-400 font-medium">No hay clases archivadas todavía.</div>
            ) : (
              <div className="space-y-3 max-h-[450px] overflow-y-auto pr-3 scrollbar-hide">
                {historialSesiones.map((sesion, idx) => (
                  <div key={idx} className="p-5 bg-white border border-slate-100 shadow-sm rounded-[2rem] flex items-center justify-between transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
                    <div>
                      <h4 className="font-bold text-[#002b5c] text-sm tracking-tight">{sesion.asignatura_nombre}</h4>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-1.5 flex items-center gap-2">
                        <span>{new Date(sesion.created_at).toLocaleDateString()}</span>
                        <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
                        <span>{new Date(sesion.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>
                      </p>
                    </div>
                    <button onClick={() => descargarExcelPasado(sesion.id, sesion.asignatura_nombre)} className="px-5 py-2.5 bg-slate-50 hover:bg-[#0090d0] text-[#0090d0] hover:text-white text-[10px] font-bold uppercase tracking-widest rounded-full transition-colors duration-300 active:scale-90 cursor-pointer">
                      Excel
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
