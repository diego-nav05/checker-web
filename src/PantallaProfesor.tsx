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

  const [clasesHoy, setClasesHoy] = useState<any[]>([]);
  const [cargandoClases, setCargandoClases] = useState(true);

  // NUEVO: Diccionario local para no depender del JOIN relacional de Postgres
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
      
      // 1. Descargamos todos los perfiles a la memoria local
      const { data: perfilesData } = await supabase.from('perfiles').select('id, nombre_completo, email');
      if (perfilesData) {
        const dict: Record<string, any> = {};
        perfilesData.forEach(p => dict[p.id] = p);
        setDiccionarioAlumnos(dict);
      }

      // 2. Cargamos las asignaturas del profesor
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

  // SISTEMA A PRUEBA DE FALLOS: Petición plana y mapeo en React
  const cargarAsistencias = async (idSesion: string, dict = diccionarioAlumnos) => {
    // Pedimos solo los datos puros sin JOIN (nunca fallará si hay conexión)
    const { data } = await supabase.from('asistencias').select('*').eq('sesion_id', idSesion);
    
    if (data) {
      // Unimos los nombres usando el diccionario local de React
      const datosCompletos = data.map(item => ({
        ...item,
        perfiles: dict[item.alumno_id] || { nombre_completo: 'Alumno Registrado' }
      }));
      setAsistencias(datosCompletos as Asistencia[]);
    }
  };

  useEffect(() => {
    if (!sesionId) return;

    cargarAsistencias(sesionId, diccionarioAlumnos);

    const instantChannel = supabase.channel('aula-realtime')
      .on('broadcast', { event: 'update-lista' }, () => {
        cargarAsistencias(sesionId, diccionarioAlumnos);
      })
      .subscribe();

    const dbChannel = supabase.channel('aula-db')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asistencias', filter: `sesion_id=eq.${sesionId}` }, () => {
        cargarAsistencias(sesionId, diccionarioAlumnos);
      })
      .subscribe();

    const intervaloRespaldo = setInterval(() => {
      cargarAsistencias(sesionId, diccionarioAlumnos);
    }, 2000);

    return () => { 
      supabase.removeChannel(instantChannel);
      supabase.removeChannel(dbChannel);
      clearInterval(intervaloRespaldo);
    };
  }, [sesionId, diccionarioAlumnos]);

  useEffect(() => {
    if (!sesionId || !secretTotp || fase === 'CERRADA') return;
    const actualizarQR = async () => {
      const bloqueTiempo = Math.floor(Date.now() / 4000);
      const payload = `${sesionId}|${fase}|${bloqueTiempo}`;
      const token = CryptoJS.HmacSHA256(payload, secretTotp).toString();
      const qrPayload = JSON.stringify({ s: sesionId, f: fase, t: bloqueTiempo, token });
      const dataUrl = await QRCode.toDataURL(qrPayload, { width: 320, margin: 1, color: { dark: '#002b5c', light: '#ffffff' } });
      setQrSrc(dataUrl);
    };
    actualizarQR();
    timerRef.current = setInterval(actualizarQR, 4000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sesionId, secretTotp, fase]);

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

  const descargarExcelPasado = async (sesionPasadaId: string, asigNombre: string, fecha: string) => {
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
    XLSX.writeFile(libro, `Asistencia_${asigNombre}_${new Date(fecha).toLocaleDateString().replace(/\//g, '-')}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F9] p-4 sm:p-8 flex flex-col font-sans selection:bg-[#0090d0] selection:text-white relative">
      
      {notificacion && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3.5 rounded-full shadow-2xl backdrop-blur-2xl flex items-center gap-3 transition-all duration-300 animate-[fade-in_0.3s_ease-out] w-fit min-w-[280px] max-w-sm border ${
          notificacion.tipo === 'error' ? 'bg-rose-500/90 border-rose-400 text-white' : 
          notificacion.tipo === 'exito' ? 'bg-emerald-500/90 border-emerald-400 text-white' : 
          'bg-[#002b5c]/90 border-[#0090d0]/50 text-white'
        }`}>
          <span className="text-sm font-semibold tracking-tight">{notificacion.texto}</span>
        </div>
      )}

      <div className="flex items-center justify-between bg-white/70 backdrop-blur-3xl px-6 py-4 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-white/60 mb-8 max-w-7xl mx-auto w-full animate-[fade-in_0.4s_ease-out]">
        <div className="flex items-center gap-4">
          <button onClick={onVolver} className="flex items-center justify-center w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors cursor-pointer active:scale-95">←</button>
          <div>
            <h1 className="text-xl font-black text-[#002b5c] tracking-tight leading-tight">Profesorado</h1>
            <p className="text-xs font-semibold text-slate-400">
              {sesionId ? (
                <>Fase: <span className={fase === 'ENTRADA' ? 'text-amber-500' : fase === 'SALIDA' ? 'text-[#0090d0]' : 'text-slate-400'}>{fase}</span></>
              ) : 'Selecciona una asignatura'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!sesionId ? (
            <button onClick={abrirHistorial} className="px-5 py-2.5 bg-white text-[#002b5c] text-xs font-bold rounded-full shadow-sm hover:shadow-md border border-slate-100 transition-all active:scale-95 cursor-pointer">
              Historial
            </button>
          ) : (
            fase !== 'CERRADA' && (
              <>
                {fase === 'ENTRADA' && (
                  <button onClick={pasarASalida} className="px-5 py-2.5 bg-[#0090d0] text-white text-xs font-bold rounded-full shadow-md transition-all active:scale-95 cursor-pointer">
                    Salida
                  </button>
                )}
                <button onClick={intentarCerrarAula} className="px-5 py-2.5 bg-rose-500 text-white text-xs font-bold rounded-full shadow-md transition-all active:scale-95 cursor-pointer">
                  Cerrar
                </button>
              </>
            )
          )}
        </div>
      </div>

      {!sesionId ? (
        <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full animate-[fade-in_0.4s_ease-out]">
          {cargandoClases ? (
            <div className="flex justify-center py-12 text-slate-400 font-medium animate-pulse">Cargando materias...</div>
          ) : clasesHoy.length === 0 ? (
            <div className="bg-white/70 backdrop-blur-3xl rounded-[2.5rem] p-12 shadow-[0_15px_40px_-15px_rgba(0,0,0,0.05)] border border-white/60 text-center">
              <p className="text-[#002b5c] font-black text-lg">No tienes asignaturas asignadas.</p>
              <p className="text-xs text-slate-400 font-medium mt-2">Usa "Gestión Docente" en el menú principal para darlas de alta.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {clasesHoy.map((clase) => (
                <div key={clase.id} className="bg-white/70 backdrop-blur-3xl rounded-[2.5rem] p-6 shadow-[0_15px_40px_-15px_rgba(0,0,0,0.05)] border border-white/60 flex flex-col justify-between hover:shadow-[0_20px_40px_rgba(0,144,208,0.1)] transition-all">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="px-3 py-1.5 bg-[#0090d0]/10 text-[#0090d0] text-[10px] font-bold uppercase tracking-wider rounded-full">{clase.aula}</span>
                      <span className="text-slate-400 text-xs font-semibold">{clase.horario}</span>
                    </div>
                    <h3 className="text-xl font-black text-[#002b5c] mb-6 leading-tight">{clase.nombre}</h3>
                  </div>
                  <button onClick={() => iniciarClase(clase.id)} className="w-full py-3.5 bg-[#002b5c] hover:bg-[#0090d0] text-white text-sm font-bold rounded-2xl transition-all shadow-md active:scale-95 cursor-pointer">
                    Iniciar Aula
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 max-w-7xl mx-auto w-full animate-[fade-in_0.4s_ease-out]">
          
          <div className="lg:col-span-5 bg-white/70 backdrop-blur-3xl p-8 rounded-[3rem] shadow-[0_15px_40px_-15px_rgba(0,0,0,0.05)] border border-white/60 flex flex-col items-center justify-center text-center">
            {fase !== 'CERRADA' ? (
              <>
                <div className="mb-8">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-[#0090d0] bg-[#0090d0]/10 px-4 py-2 rounded-full">
                    {fase === 'ENTRADA' ? '📍 Escaneo Entrada' : '🚪 Escaneo Salida'}
                  </span>
                </div>
                <div className="p-4 bg-white rounded-[2rem] shadow-xl border border-slate-100">
                  {qrSrc && <img src={qrSrc} alt="QR Dinámico" className="w-64 h-64 rounded-xl" />}
                </div>
                <div className="mt-8 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Sincronizado en tiempo real
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <div className="w-20 h-20 bg-emerald-100/50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">✓</span></div>
                <h3 className="text-xl font-black text-[#002b5c] tracking-tight">Clase Archivada</h3>
              </div>
            )}
          </div>

          <div className="lg:col-span-7 bg-white/70 backdrop-blur-3xl p-8 rounded-[3rem] shadow-[0_15px_40px_-15px_rgba(0,0,0,0.05)] border border-white/60 flex flex-col">
            <h2 className="text-xl font-black text-[#002b5c] tracking-tight mb-6">Alumnos ({asistencias.length})</h2>
            
            <div className="flex-1 overflow-y-auto max-h-[500px] pr-2 space-y-3">
              {asistencias.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm font-medium">Esperando alumnos...</div>
              ) : (
                asistencias.map((item) => (
                  <div key={item.id} className="p-4 bg-slate-50/50 hover:bg-white rounded-[1.5rem] flex items-center justify-between gap-4 transition-colors border border-transparent hover:border-slate-100">
                    <div>
                      <p className="font-bold text-[#002b5c] text-sm">{item.perfiles?.nombre_completo || 'Alumno Registrado'}</p>
                      <div className="flex gap-4 text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">
                        <span>In: {item.hora_entrada ? new Date(item.hora_entrada).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                        <span>Out: {item.hora_salida ? new Date(item.hora_salida).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <select
                        value={item.estado}
                        onChange={(e) => cambiarEstadoManual(item.id, e.target.value as EstadoAsistencia)}
                        className={`text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-full outline-none transition-all cursor-pointer ${
                          item.estado === 'PRESENTE' ? 'bg-emerald-100/50 text-emerald-700' :
                          item.estado === 'RETRASO' ? 'bg-amber-100/50 text-amber-700' :
                          item.estado === 'SE_FUE_A_MITAD' ? 'bg-purple-100/50 text-purple-700' :
                          item.estado === 'FALTA_JUSTIFICADA' ? 'bg-[#0090d0]/10 text-[#0090d0]' : 'bg-rose-100/50 text-rose-700'
                        }`}
                      >
                        <option value="PRESENTE">Presente</option>
                        <option value="RETRASO">Retraso</option>
                        <option value="SE_FUE_A_MITAD">Abandono</option>
                        <option value="FALTA_JUSTIFICADA">Justificado</option>
                        <option value="FALTA_INJUSTIFICADA">Ausente</option>
                      </select>
                      
                      <button onClick={() => expulsarAlumno(item.id, item.perfiles?.nombre_completo || 'Alumno')} className="w-8 h-8 flex items-center justify-center rounded-full bg-rose-50 text-rose-500 hover:bg-rose-100 transition-colors cursor-pointer active:scale-95" title="Expulsar">
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {mostrarModalCierre && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl text-center">
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-2">Finalizar Aula</h3>
            <p className="text-xs text-slate-500 font-medium mb-6">Confirma tu identidad docente.</p>
            <input type="password" placeholder="Contraseña" value={passInput} onChange={(e) => setPassInput(e.target.value)} className="w-full p-4 bg-slate-50 rounded-2xl mb-6 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-center text-sm font-semibold"/>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { setMostrarModalCierre(false); setPassInput(''); }} className="py-3.5 rounded-2xl text-slate-500 text-sm font-bold bg-slate-100 active:scale-95 cursor-pointer">Cancelar</button>
              <button onClick={confirmarCierreClase} disabled={cargandoCierre || !passInput} className="py-3.5 rounded-2xl bg-rose-500 text-white text-sm font-bold active:scale-95 disabled:opacity-50 cursor-pointer">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {mostrarModalHistorial && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white/90 backdrop-blur-3xl rounded-[3rem] p-8 max-w-lg w-full shadow-2xl border border-white/60">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-black text-[#002b5c] tracking-tight">Historial Docente</h3>
              <button onClick={() => setMostrarModalHistorial(false)} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">✕</button>
            </div>
            
            {cargandoHistorial ? (
              <div className="py-12 text-center text-slate-400 font-medium animate-pulse">Buscando...</div>
            ) : historialSesiones.length === 0 ? (
              <div className="py-12 text-center text-slate-400 font-medium">No hay historial disponible.</div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {historialSesiones.map((sesion, idx) => (
                  <div key={idx} className="p-4 bg-slate-50/50 rounded-[1.5rem] flex items-center justify-between transition-colors border border-transparent hover:border-slate-100">
                    <div>
                      <h4 className="font-bold text-[#002b5c] text-sm">{sesion.asignatura_nombre}</h4>
                      <p className="text-[11px] font-semibold text-slate-400 mt-1">{new Date(sesion.created_at).toLocaleDateString()} · {new Date(sesion.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</p>
                    </div>
                    <button onClick={() => descargarExcelPasado(sesion.id, sesion.asignatura_nombre, sesion.created_at)} className="px-4 py-2 bg-white text-[#0090d0] text-[10px] font-bold uppercase tracking-wider rounded-full shadow-sm border border-slate-100 active:scale-95 cursor-pointer">
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
