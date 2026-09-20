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

  const [mostrarModalHistorial, setMostrarModalHistorial] = useState<boolean>(false);
  const [historialSesiones, setHistorialSesiones] = useState<any[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState<boolean>(false);

  useEffect(() => {
    const cargarAsignaturas = async () => {
      setCargandoClases(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from('asignaturas').select('*').eq('profesor_id', user.id).order('horario', { ascending: true });
        if (data) setClasesHoy(data);
      }
      setCargandoClases(false);
    };
    cargarAsignaturas();
  }, []);

  const iniciarClase = async (idAsignatura: string) => {
    const nuevoSecret = Math.random().toString(36).substring(2, 10);
    setSecretTotp(nuevoSecret);

    const { data: sesionData, error: sesionError } = await supabase
      .from('sesiones')
      .insert({ fase: 'ENTRADA', secret_totp: nuevoSecret, asignatura_id: idAsignatura })
      .select().single();

    if (sesionError || !sesionData) return alert('Error creando la sesión: ' + sesionError?.message);

    setSesionId(sesionData.id);

    const { data: pastSesiones } = await supabase
      .from('sesiones')
      .select('id')
      .eq('asignatura_id', idAsignatura)
      .neq('id', sesionData.id);
    
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
        
        await supabase.from('asistencias').upsert(asistenciasIniciales, { onConflict: 'sesion_id,alumno_id' });
      }
    }

    cargarAsistencias(sesionData.id);
  };

  const cargarAsistencias = async (id: string) => {
    const { data } = await supabase.from('asistencias').select('*, perfiles(nombre_completo, email)').eq('sesion_id', id);
    if (data) setAsistencias(data as Asistencia[]);
  };

  useEffect(() => {
    if (!sesionId) return;
    const channel = supabase.channel('cambios-asistencia')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asistencias', filter: `sesion_id=eq.${sesionId}` }, () => cargarAsistencias(sesionId))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sesionId]);

  useEffect(() => {
    if (!sesionId || !secretTotp || fase === 'CERRADA') return;
    const actualizarQR = async () => {
      const bloqueTiempo = Math.floor(Date.now() / 4000);
      const payload = `${sesionId}|${fase}|${bloqueTiempo}`;
      const token = CryptoJS.HmacSHA256(payload, secretTotp).toString();
      const qrPayload = JSON.stringify({ s: sesionId, f: fase, t: bloqueTiempo, token });
      const dataUrl = await QRCode.toDataURL(qrPayload, { width: 320, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
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
  };

  const intentarCerrarAula = () => {
    if (fase === 'ENTRADA') {
      const confirmar = window.confirm(
        'Aviso: No has activado el QR de salida.\n\nSi cierras la clase ahora, se validará la asistencia completa a todos los que entraron.\n\n¿Cerrar aula de todos modos?'
      );
      if (!confirmar) return;
    }
    setMostrarModalCierre(true);
  };

  const confirmarCierreClase = async () => {
    if (!passInput) return;
    setCargandoCierre(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("No se encontró sesión activa.");
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
      cargarAsistencias(sesionId);

    } catch (error: any) {
      alert(error.message);
    } finally {
      setCargandoCierre(false);
    }
  };

  const cambiarEstadoManual = async (asistenciaId: string, nuevoEstado: EstadoAsistencia) => {
    await supabase.from('asistencias').update({ estado: nuevoEstado, manual: true }).eq('id', asistenciaId);
    setAsistencias((prev) => prev.map((a) => (a.id === asistenciaId ? { ...a, estado: nuevoEstado, manual: true } : a)));
  };

  const expulsarAlumno = async (asistenciaId: string, nombre: string) => {
    const confirmar = window.confirm(`¿Expulsar a ${nombre} de la clase? Se anulará su registro de entrada.`);
    if (!confirmar) return;
    await supabase.from('asistencias').update({ estado: 'FALTA_INJUSTIFICADA', hora_entrada: null, hora_salida: null, manual: true }).eq('id', asistenciaId);
    if (sesionId) cargarAsistencias(sesionId);
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
    const { data } = await supabase.from('asistencias').select('*, perfiles(nombre_completo)').eq('sesion_id', sesionPasadaId);
    if (!data) return;
    
    const filas = data.map((a: any) => ({
      Alumno: a.perfiles?.nombre_completo || 'Sin nombre',
      Estado: a.estado,
      'Hora Entrada': a.hora_entrada ? new Date(a.hora_entrada).toLocaleTimeString() : '-',
      'Hora Salida': a.hora_salida ? new Date(a.hora_salida).toLocaleTimeString() : '-',
    }));
    
    const libro = XLSX.utils.book_new();
    const hoja = XLSX.utils.json_to_sheet(filas);
    XLSX.utils.book_append_sheet(libro, hoja, 'Asistencia');
    XLSX.writeFile(libro, `Asistencia_${asigNombre}_${new Date(fecha).toLocaleDateString().replace(/\//g, '-')}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] p-4 sm:p-8 flex flex-col font-sans selection:bg-[#0090d0] selection:text-white">
      <div className="flex items-center justify-between bg-white/80 backdrop-blur-xl px-6 py-4 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-black/[0.03] mb-8 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-4">
          <button onClick={onVolver} className="flex items-center justify-center w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors cursor-pointer active:scale-95">←</button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">Panel Docente</h1>
            <p className="text-xs font-medium text-slate-500">
              {sesionId ? (
                <>Fase actual: <span className={fase === 'ENTRADA' ? 'text-amber-500' : fase === 'SALIDA' ? 'text-[#0090d0]' : 'text-slate-400'}>{fase}</span></>
              ) : (
                new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!sesionId ? (
            <button onClick={abrirHistorial} className="px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-full transition-all active:scale-95 cursor-pointer">
              Historial Global
            </button>
          ) : (
            fase !== 'CERRADA' && (
              <>
                {fase === 'ENTRADA' && (
                  <button onClick={pasarASalida} className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-full transition-all shadow-sm active:scale-95 cursor-pointer">
                    Cambiar a Salida
                  </button>
                )}
                <button onClick={intentarCerrarAula} className="px-5 py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-full transition-all shadow-sm active:scale-95 cursor-pointer">
                  Cerrar Aula
                </button>
              </>
            )
          )}
        </div>
      </div>

      {!sesionId ? (
        <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-6 px-2">Tus Clases</h2>
          {cargandoClases ? (
            <div className="flex justify-center py-12 text-slate-400 font-medium animate-pulse">Cargando materias...</div>
          ) : clasesHoy.length === 0 ? (
            <div className="bg-white rounded-[2rem] p-12 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] text-center">
              <p className="text-slate-500 font-medium">No has creado asignaturas todavía.</p>
              <p className="text-xs text-slate-400 mt-2">Accede a "Gestión Docente" para dar de alta tus materias.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {clasesHoy.map((clase) => (
                <div key={clase.id} className="bg-white rounded-[2rem] p-6 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] flex flex-col justify-between hover:shadow-[0_20px_40px_-15px_rgba(0,144,208,0.1)] transition-shadow">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="px-3 py-1 bg-sky-50 text-[#0090d0] text-xs font-bold rounded-full">{clase.aula}</span>
                      <span className="text-slate-400 text-sm font-medium">{clase.horario}</span>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-6">{clase.nombre}</h3>
                  </div>
                  <button onClick={() => iniciarClase(clase.id)} className="w-full py-3.5 bg-[#0090d0] hover:bg-[#007fb8] text-white text-sm font-bold rounded-2xl transition-all shadow-[0_8px_20px_-6px_rgba(0,144,208,0.4)] cursor-pointer active:scale-[0.98]">
                    Iniciar Clase
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 max-w-7xl mx-auto w-full">
          <div className="lg:col-span-5 bg-white p-8 rounded-[2.5rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] flex flex-col items-center justify-center text-center">
            {fase !== 'CERRADA' ? (
              <>
                <div className="mb-8">
                  <span className="text-xs uppercase tracking-widest font-bold text-[#0090d0] bg-sky-50 px-4 py-2 rounded-full">
                    {fase === 'ENTRADA' ? '📍 Escaneo de Entrada' : '🚪 Escaneo de Salida'}
                  </span>
                </div>
                <div className="p-5 bg-white border border-slate-100 rounded-[2rem] shadow-[0_0_40px_-10px_rgba(0,0,0,0.08)]">
                  {qrSrc && <img src={qrSrc} alt="QR Dinámico" className="w-64 h-64 rounded-xl" />}
                </div>
                <div className="mt-8 flex items-center gap-2 text-xs font-medium text-slate-400 bg-slate-50 px-4 py-2 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Actualización en tiempo real
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-4xl">✓</span></div>
                <h3 className="text-xl font-bold text-slate-900 tracking-tight">Sesión Archivada</h3>
              </div>
            )}
          </div>

          <div className="lg:col-span-7 bg-white p-8 rounded-[2.5rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] flex flex-col">
            <div className="flex items-center justify-between mb-6 px-2">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Alumnos <span className="text-slate-400 font-medium ml-1">({asistencias.length})</span></h2>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[550px] pr-2 space-y-3">
              {asistencias.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 font-medium"><p>Esperando primer escaneo...</p></div>
              ) : (
                asistencias.map((item) => (
                  <div key={item.id} className="p-4 bg-slate-50/50 hover:bg-slate-50 rounded-2xl flex items-center justify-between gap-4 transition-colors">
                    <div>
                      <p className="font-bold text-slate-800 text-sm">{item.perfiles?.nombre_completo || 'Alumno'}</p>
                      <div className="flex gap-4 text-[11px] font-medium text-slate-400 mt-2">
                        <span>In: {item.hora_entrada ? new Date(item.hora_entrada).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
                        <span>Out: {item.hora_salida ? new Date(item.hora_salida).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <select
                        value={item.estado}
                        onChange={(e) => cambiarEstadoManual(item.id, e.target.value as EstadoAsistencia)}
                        className={`text-xs font-bold px-4 py-2.5 rounded-full appearance-none text-center cursor-pointer outline-none transition-all ${
                          item.estado === 'PRESENTE' ? 'bg-emerald-100 text-emerald-800' :
                          item.estado === 'RETRASO' ? 'bg-amber-100 text-amber-800' :
                          item.estado === 'SE_FUE_A_MITAD' ? 'bg-purple-100 text-purple-800' :
                          item.estado === 'FALTA_JUSTIFICADA' ? 'bg-blue-100 text-blue-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        <option value="PRESENTE">Presente</option>
                        <option value="RETRASO">Retraso</option>
                        <option value="SE_FUE_A_MITAD">Abandono</option>
                        <option value="FALTA_JUSTIFICADA">Justificado</option>
                        <option value="FALTA_INJUSTIFICADA">Ausente</option>
                      </select>
                      
                      <button onClick={() => expulsarAlumno(item.id, item.perfiles?.nombre_completo || 'Alumno')} className="w-8 h-8 flex items-center justify-center rounded-full bg-rose-50 text-rose-500 hover:bg-rose-100 transition-colors cursor-pointer active:scale-95" title="Expulsar de la clase">
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
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] border border-black/[0.05] text-center">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Autorizar Cierre</h3>
            <p className="text-sm text-slate-500 mt-2 mb-6 font-medium leading-relaxed">
              Introduce tu contraseña de profesor para cerrar la sesión de forma segura.
            </p>
            <input 
              type="password" 
              placeholder="Contraseña" 
              value={passInput} 
              onChange={(e) => setPassInput(e.target.value)} 
              className="w-full p-4 bg-[#F5F5F7] border border-transparent rounded-[1.25rem] mb-6 focus:outline-none focus:border-[#0090d0] text-center font-medium"
            />
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => { setMostrarModalCierre(false); setPassInput(''); }} 
                className="py-3 rounded-xl text-slate-600 font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmarCierreClase} 
                disabled={cargandoCierre || !passInput} 
                className="py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
              >
                {cargandoCierre ? 'Verificando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarModalHistorial && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-lg w-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] border border-black/[0.05]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-900 tracking-tight">Historial Global</h3>
              <button onClick={() => setMostrarModalHistorial(false)} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">✕</button>
            </div>
            
            {cargandoHistorial ? (
              <div className="p-12 text-center text-slate-400 font-medium animate-pulse">Buscando clases anteriores...</div>
            ) : historialSesiones.length === 0 ? (
              <div className="p-12 text-center text-slate-400 font-medium">Aún no hay clases finalizadas en tus materias.</div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {historialSesiones.map((sesion, idx) => (
                  <div key={idx} className="p-4 bg-slate-50 hover:bg-slate-100/50 rounded-2xl border border-slate-100 flex items-center justify-between transition-colors">
                    <div>
                      <h4 className="font-bold text-slate-800 text-sm">{sesion.asignatura_nombre}</h4>
                      <p className="text-xs text-slate-400 font-medium mt-0.5">{new Date(sesion.created_at).toLocaleDateString()} · {new Date(sesion.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <button 
                      onClick={() => descargarExcelPasado(sesion.id, sesion.asignatura_nombre, sesion.created_at)}
                      className="px-4 py-2 bg-white text-[#0090d0] border border-slate-200 hover:border-[#0090d0]/30 hover:bg-sky-50 text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95 shadow-sm"
                    >
                      Descargar Excel
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
