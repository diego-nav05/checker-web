import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import CryptoJS from 'crypto-js';
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import type { FaseSesion, EstadoAsistencia, Asignatura } from './types';

interface Props {
  onVolver: () => void;
}

type TabAlumno = 'HORARIO' | 'CALENDARIO';

export default function PantallaAlumno({ onVolver }: Props) {
  const [nombre] = useState<string>(() => localStorage.getItem('checker_nombre') || 'Estudiante');
  const [alumnoId] = useState<string>(() => localStorage.getItem('checker_alumno_id') || '');
  
  const [tabActual, setTabActual] = useState<TabAlumno>('HORARIO');
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [clasesHoy, setClasesHoy] = useState<Asignatura[]>([]);
  const [cargandoClases, setCargandoClases] = useState(true);
  
  const [asistenciasActivas, setAsistenciasActivas] = useState<any[]>([]);
  const [modalSalir, setModalSalir] = useState<string | null>(null); 
  const [passConfirm, setPassConfirm] = useState('');
  const [cargandoPass, setCargandoPass] = useState(false);

  // Estados para el historial y filtro por fechas
  const [historial, setHistorial] = useState<any[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [fechaInicio, setFechaInicio] = useState<string>('');
  const [fechaFin, setFechaFin] = useState<string>('');

  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  // Consulta puntual sin canal Realtime abierto (Ahorro de cuota de sockets)
  useEffect(() => {
    const cargarAsignaturas = async () => {
      setCargandoClases(true);
      const { data, error } = await supabase
        .from('asignaturas')
        .select('*')
        .order('horario', { ascending: true });
        
      if (!error && data) {
        setClasesHoy(data as Asignatura[]);
      }
      setCargandoClases(false);
    };

    cargarAsignaturas();
  }, []);

  const cargarAsistenciasActivas = async () => {
    if (!alumnoId) return;
    const { data } = await supabase
      .from('asistencias')
      .select('id, hora_entrada, sesion_id')
      .eq('alumno_id', alumnoId)
      .eq('estado', 'PRESENTE')
      .is('hora_salida', null);
      
    if (data) setAsistenciasActivas(data);
  };

  useEffect(() => { 
    cargarAsistenciasActivas(); 
  }, [alumnoId]);

  useEffect(() => {
    const cargarHistorial = async () => {
      if (!alumnoId || tabActual !== 'CALENDARIO') return;
      setCargandoHistorial(true);
      
      const { data: asistData } = await supabase
        .from('asistencias')
        .select('id, estado, hora_entrada, hora_salida, manual, sesiones(created_at, asignatura_id)')
        .eq('alumno_id', alumnoId)
        .not('hora_entrada', 'is', null)
        .order('hora_entrada', { ascending: false });
        
      const { data: asigData } = await supabase.from('asignaturas').select('id, nombre');

      if (asistData && asigData) {
        const historialMapeado = asistData.map((registro: any) => {
          const asigId = registro.sesiones?.asignatura_id;
          const asignatura = asigData.find((a) => a.id === asigId);
          return {
            ...registro,
            asignatura_nombre: asignatura ? asignatura.nombre : 'Clase eliminada',
            fecha: registro.hora_entrada
          };
        });
        setHistorial(historialMapeado);
      }
      setCargandoHistorial(false);
    };
    
    cargarHistorial();
  }, [tabActual, alumnoId]);

  useEffect(() => {
    if (!camaraActiva) {
      if (scannerRef.current) { 
        scannerRef.current.clear().catch(() => {}); 
        scannerRef.current = null; 
      }
      return;
    }

    const scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: { width: 250, height: 250 } }, false);
    scannerRef.current = scanner;
    
    scanner.render(
      async (decodedText) => {
        try {
          const payload = JSON.parse(decodedText);
          const { s: sesionId, f: fase, t: bloqueTiempo, token } = payload as { s: string; f: FaseSesion; t: number; token: string; };

          const { data: sesion } = await supabase.from('sesiones').select('*').eq('id', sesionId).single();
          if (!sesion || sesion.fase === 'CERRADA') return setErrorMsg('La sesión no existe o está cerrada.');
          if (Math.abs(Math.floor(Date.now() / 4000) - bloqueTiempo) > 1) return setErrorMsg('Código QR caducado. Vuelve a enfocar.');

          const tokenEsperado = CryptoJS.HmacSHA256(`${sesionId}|${fase}|${bloqueTiempo}`, sesion.secret_totp).toString();
          if (token !== tokenEsperado) return setErrorMsg('Código QR no auténtico.');

          const ahora = new Date().toISOString();
          if (fase === 'ENTRADA') {
            const { error } = await supabase.from('asistencias').upsert({ 
              sesion_id: sesionId, 
              alumno_id: alumnoId, 
              estado: 'PRESENTE' as EstadoAsistencia, 
              hora_entrada: ahora 
            }, { onConflict: 'sesion_id,alumno_id' });
            
            if (error) throw error;
            setMensajeExito('¡Entrada confirmada correctamente!');
            cargarAsistenciasActivas(); 
          } else if (fase === 'SALIDA') {
            const { error } = await supabase.from('asistencias').update({ hora_salida: ahora }).match({ sesion_id: sesionId, alumno_id: alumnoId });
            if (error) throw error;
            setMensajeExito('¡Salida registrada! Asistencia completada.');
            cargarAsistenciasActivas();
          }
          
          scanner.clear().catch(() => {});
          setCamaraActiva(false);
        } catch { 
          setErrorMsg('Error al verificar el código QR.'); 
        }
      }, 
      () => {}
    );
    
    return () => { scanner.clear().catch(() => {}); };
  }, [camaraActiva, alumnoId]);

  const confirmarSalidaSegura = async () => {
    setCargandoPass(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("No se encontró tu sesión actual.");
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: passConfirm });
      if (authError) throw new Error("Contraseña incorrecta.");
      
      await supabase.from('asistencias').update({ estado: 'FALTA_INJUSTIFICADA', hora_entrada: null }).eq('id', modalSalir);
      setModalSalir(null);
      setPassConfirm('');
      cargarAsistenciasActivas();
    } catch (error: any) { 
      alert(error.message); 
    } finally { 
      setCargandoPass(false); 
    }
  };

  const historialFiltrado = historial.filter((registro) => {
    if (!fechaInicio && !fechaFin) return true;
    const fechaReg = new Date(registro.fecha).toISOString().split('T')[0];
    if (fechaInicio && fechaReg < fechaInicio) return false;
    if (fechaFin && fechaReg > fechaFin) return false;
    return true;
  });

  const exportarHistorialAlumno = () => {
    if (historialFiltrado.length === 0) return alert('No hay datos para exportar en este periodo.');
    const filas = historialFiltrado.map(reg => ({
      Fecha: new Date(reg.fecha).toLocaleDateString(),
      Asignatura: reg.asignatura_nombre,
      Estado: reg.estado.replace(/_/g, ' '),
      'Hora Entrada': reg.hora_entrada ? new Date(reg.hora_entrada).toLocaleTimeString() : '-',
      'Hora Salida': reg.hora_salida ? new Date(reg.hora_salida).toLocaleTimeString() : '-',
    }));
    
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Mi Asistencia');
    XLSX.writeFile(libro, `Mi_Reporte_Asistencia_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] p-4 sm:p-8 flex flex-col font-sans selection:bg-[#0090d0] selection:text-white relative">
      <div className="flex items-center justify-between bg-white/80 backdrop-blur-xl px-6 py-4 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-black/[0.03] mb-8 max-w-4xl mx-auto w-full">
        <div className="flex items-center gap-4">
          <button onClick={onVolver} className="flex items-center justify-center w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors cursor-pointer active:scale-95">←</button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">Espacio Alumno</h1>
            <p className="text-xs font-medium text-slate-500 truncate max-w-[150px] sm:max-w-xs">{nombre}</p>
          </div>
        </div>
        <button onClick={() => { setCamaraActiva(false); setTabActual(tabActual === 'HORARIO' ? 'CALENDARIO' : 'HORARIO'); }} className={`flex items-center justify-center w-10 h-10 rounded-full transition-all cursor-pointer active:scale-95 ${tabActual === 'CALENDARIO' ? 'bg-[#0090d0] text-white shadow-sm' : 'bg-sky-50 text-[#0090d0] hover:bg-sky-100'}`}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        </button>
      </div>

      <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col">
        {mensajeExito && (
          <div className="bg-white rounded-[2rem] p-6 mb-6 text-center shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-emerald-100 flex items-center justify-between">
            <div className="flex items-center gap-3"><span className="text-2xl">✅</span><p className="text-sm font-bold text-slate-800">{mensajeExito}</p></div>
            <button onClick={() => setMensajeExito(null)} className="text-xs font-bold text-[#0090d0] hover:underline cursor-pointer">Cerrar</button>
          </div>
        )}

        {camaraActiva && (
          <div className="bg-white rounded-[2.5rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.08)] border border-black/[0.03] p-8 mb-8 flex flex-col items-center">
            <div className="flex items-center justify-between w-full mb-6">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">Escaneando QR del Aula</h3>
              <button onClick={() => setCamaraActiva(false)} className="text-xs font-semibold px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full transition cursor-pointer">Cerrar Cámara</button>
            </div>
            <div className="w-full max-w-sm overflow-hidden rounded-[2rem] border-4 border-slate-100 shadow-inner bg-slate-50">
              <div id="qr-reader" className="w-full [&>div]:border-none [&>video]:rounded-none"></div>
            </div>
            {errorMsg && <div className="mt-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-xs font-semibold text-center w-full max-w-sm">{errorMsg}</div>}
          </div>
        )}

        {tabActual === 'HORARIO' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <button onClick={() => { setErrorMsg(null); setCamaraActiva(!camaraActiva); }} className={`md:col-span-1 rounded-[2.5rem] p-8 transition-all flex flex-col justify-between text-left cursor-pointer active:scale-[0.98] min-h-[220px] ${camaraActiva ? 'bg-rose-500 text-white shadow-[0_20px_40px_-15px_rgba(244,63,94,0.3)]' : 'bg-[#0090d0] hover:bg-[#007fb8] text-white shadow-[0_20px_40px_-15px_rgba(0,144,208,0.35)]'}`}>
              <div className="flex items-center justify-between w-full">
                <span className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                </span>
                <span className="text-xs font-bold uppercase tracking-wider bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-white">{camaraActiva ? 'En uso' : 'Escanear'}</span>
              </div>
              <div><h3 className="text-2xl font-extrabold tracking-tight text-white leading-tight">{camaraActiva ? 'Cerrar Escáner' : 'Registrar Asistencia'}</h3></div>
            </button>

            <div className="md:col-span-2 bg-white rounded-[2.5rem] p-8 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] flex flex-col">
              {asistenciasActivas.length > 0 && (
                <div className="mb-8">
                  <h4 className="text-sm font-bold text-emerald-600 mb-3 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>Estás en clase</h4>
                  <div className="space-y-3">
                    {asistenciasActivas.map((asist) => (
                      <div key={asist.id} className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl flex items-center justify-between">
                        <div>
                          <h4 className="font-bold text-slate-800 text-sm">Sesión Activa</h4>
                          <p className="text-xs text-slate-500 font-medium mt-0.5">Entrada: {new Date(asist.hora_entrada).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <button onClick={() => setModalSalir(asist.id)} className="px-4 py-2.5 bg-white text-rose-600 text-xs font-bold rounded-xl shadow-sm border border-slate-200 hover:border-rose-200 hover:bg-rose-50 transition-all cursor-pointer active:scale-95">Anular registro</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-900 tracking-tight">Mis Clases Hoy</h3>
                <span className="text-xs font-medium text-slate-400">{new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
              </div>
              {cargandoClases ? (
                <div className="flex justify-center py-8 text-slate-400 font-medium animate-pulse">Cargando horario...</div>
              ) : clasesHoy.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400"><div className="text-3xl mb-2">☕</div><p className="text-sm font-medium">No tienes clases programadas para hoy.</p></div>
              ) : (
                <div className="space-y-3">
                  {clasesHoy.map((clase) => (
                    <div key={clase.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between hover:border-[#0090d0]/20 transition-colors">
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm">{clase.nombre}</h4>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">{clase.horario}</p>
                      </div>
                      <span className="bg-white px-3 py-1 rounded-full text-xs font-bold text-slate-600 shadow-xs border border-slate-200/60">{clase.aula}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tabActual === 'CALENDARIO' && (
          <div className="bg-white rounded-[2.5rem] p-8 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02]">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-8 gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900 tracking-tight">Historial de Asistencia</h3>
                <p className="text-xs text-slate-400 font-medium mt-1">Filtra y exporta tus registros pasados</p>
              </div>
              
              <div className="flex flex-col items-end gap-3">
                <div className="flex items-center gap-2 bg-[#F5F5F7] p-1.5 rounded-[1.25rem]">
                  <input 
                    type="date" 
                    value={fechaInicio} 
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="bg-white px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 border border-transparent focus:outline-none focus:border-[#0090d0] shadow-sm transition-all"
                  />
                  <span className="text-slate-400 text-xs font-bold">-</span>
                  <input 
                    type="date" 
                    value={fechaFin} 
                    onChange={(e) => setFechaFin(e.target.value)}
                    className="bg-white px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 border border-transparent focus:outline-none focus:border-[#0090d0] shadow-sm transition-all"
                  />
                </div>
                <button 
                  onClick={exportarHistorialAlumno}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  Descargar Excel ↓
                </button>
              </div>
            </div>
            
            {cargandoHistorial ? (
              <div className="p-12 flex justify-center text-slate-400 font-medium animate-pulse">Cargando registros...</div>
            ) : historialFiltrado.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <div className="text-4xl mb-3">📅</div>
                <p className="text-sm font-medium">No hay registros en el periodo seleccionado.</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                {historialFiltrado.map((registro, idx) => (
                  <div key={idx} className="p-5 bg-slate-50 hover:bg-slate-100/50 transition-colors rounded-2xl border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className="font-bold text-slate-800 text-sm mb-1">{registro.asignatura_nombre}</h4>
                      <div className="flex items-center gap-3 text-xs font-medium text-slate-500">
                        <span className="bg-white px-2 py-1 rounded-md shadow-sm border border-slate-200">{new Date(registro.fecha).toLocaleDateString()}</span>
                        <span>In: {registro.hora_entrada ? new Date(registro.hora_entrada).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
                        <span>Out: {registro.hora_salida ? new Date(registro.hora_salida).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
                      </div>
                    </div>
                    
                    <span className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider text-center
                      ${registro.estado === 'PRESENTE' ? 'bg-emerald-100 text-emerald-700' :
                        registro.estado === 'RETRASO' ? 'bg-amber-100 text-amber-700' :
                        registro.estado === 'SE_FUE_A_MITAD' ? 'bg-purple-100 text-purple-700' : 'bg-rose-100 text-rose-700'}
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
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] border border-black/[0.05] text-center">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Anular Asistencia</h3>
            <p className="text-sm text-slate-500 mt-2 mb-6 font-medium">Introduce tu contraseña de alumno para confirmar que deseas retirarte de esta clase.</p>
            <input type="password" placeholder="Contraseña" value={passConfirm} onChange={(e) => setPassConfirm(e.target.value)} className="w-full p-4 bg-[#F5F5F7] border border-transparent rounded-[1.25rem] mb-6 focus:outline-none focus:border-[#0090d0] text-center font-medium"/>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { setModalSalir(null); setPassConfirm(''); }} className="py-3 rounded-xl text-slate-600 font-semibold hover:bg-slate-50 transition-colors cursor-pointer">Cancelar</button>
              <button onClick={confirmarSalidaSegura} disabled={cargandoPass || !passConfirm} className="py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-semibold transition-colors disabled:opacity-50 cursor-pointer">{cargandoPass ? 'Verificando...' : 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
