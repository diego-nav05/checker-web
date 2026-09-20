import { useState, useEffect } from 'react';
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
  
  const [notificacion, setNotificacion] = useState<{ texto: string; tipo: 'exito' | 'error' | 'info' } | null>(null);
  const [clasesHoy, setClasesHoy] = useState<Asignatura[]>([]);
  const [cargandoClases, setCargandoClases] = useState(true);
  const [asistenciasActivas, setAsistenciasActivas] = useState<any[]>([]);
  
  const [modalSalir, setModalSalir] = useState<string | null>(null); 
  const [passConfirm, setPassConfirm] = useState('');
  const [cargandoPass, setCargandoPass] = useState(false);

  const [historial, setHistorial] = useState<any[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const mostrarNotificacion = (texto: string, tipo: 'exito' | 'error' | 'info' = 'info') => {
    setNotificacion({ texto, tipo });
    setTimeout(() => setNotificacion(null), 4000);
  };

  const cargarAsignaturas = async () => {
    if (!alumnoId) return;
    setCargandoClases(true);
    try {
      const { data: misAsistencias } = await supabase.from('asistencias').select('sesion_id').eq('alumno_id', alumnoId);
      if (!misAsistencias || misAsistencias.length === 0) {
        setClasesHoy([]);
        return;
      }
      const sesionIds = [...new Set(misAsistencias.map(a => a.sesion_id))];
      const { data: sesiones } = await supabase.from('sesiones').select('asignatura_id').in('id', sesionIds);
      if (!sesiones || sesiones.length === 0) return;
      
      const asigIds = [...new Set(sesiones.map(s => s.asignatura_id))];
      const { data: asignaturas } = await supabase.from('asignaturas').select('*').in('id', asigIds).order('horario', { ascending: true });
      if (asignaturas) setClasesHoy(asignaturas as Asignatura[]);
    } catch (err) {
      console.error(err);
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
        const { data: asistData } = await supabase.from('asistencias').select('id, estado, hora_entrada, hora_salida, sesiones(created_at, asignatura_id)').eq('alumno_id', alumnoId);
        const { data: asigData } = await supabase.from('asignaturas').select('id, nombre');

        if (asistData && asigData) {
          const historialMapeado = asistData.map((registro: any) => {
            const asigId = registro.sesiones?.asignatura_id;
            const asignatura = asigData.find((a) => a.id === asigId);
            const fechaBase = registro.hora_entrada || registro.sesiones?.created_at || new Date().toISOString();
            
            return {
              ...registro,
              asignatura_nombre: asignatura ? asignatura.nombre : 'Clase archivada',
              fecha: fechaBase
            };
          }).sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
          setHistorial(historialMapeado);
        }
      } finally {
        setCargandoHistorial(false);
      }
    };
    cargarHistorial();
  }, [tabActual, alumnoId]);

  // --- MOTOR DE ESCÁNER ANTI-CRASHEOS ---
  useEffect(() => {
    let isMounted = true;
    let html5QrCode: Html5Qrcode | null = null;
    let scannerActivo = false;

    const arrancar = async () => {
      if (!camaraActiva) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        stream.getTracks().forEach(track => track.stop());
      } catch (err) {
        if (!isMounted) return;
        mostrarNotificacion('Permite la cámara en tu navegador.', 'error');
        setCamaraActiva(false);
        return;
      }

      setTimeout(async () => {
        if (!isMounted || !camaraActiva) return;
        html5QrCode = new Html5Qrcode('qr-reader');
        
        const onScanSuccess = async (decodedText: string) => {
          if (!scannerActivo) return; // Evita doble lectura y crasheo
          scannerActivo = false;
          
          // Ocultar cámara de inmediato (el useEffect limpiará la instancia nativa)
          setCamaraActiva(false);

          try {
            const payload = JSON.parse(decodedText);
            const { s: sesionId, f: fase, t: bloqueTiempo, token } = payload;

            const { data: sesion } = await supabase.from('sesiones').select('*').eq('id', sesionId).single();
            if (!sesion || sesion.fase === 'CERRADA') return mostrarNotificacion('Código caducado.', 'error');
            
            if (Math.abs(Math.floor(Date.now() / 4000) - bloqueTiempo) > 1) return mostrarNotificacion('QR caducado.', 'error');
            
            const tokenEsperado = CryptoJS.HmacSHA256(`${sesionId}|${fase}|${bloqueTiempo}`, sesion.secret_totp).toString();
            if (token !== tokenEsperado) return mostrarNotificacion('QR inválido.', 'error');

            const ahora = new Date().toISOString();
            
            // Inserción Blindada (2 Pasos)
            if (fase === 'ENTRADA') {
               const { data: existe } = await supabase.from('asistencias').select('id').match({ sesion_id: sesionId, alumno_id: alumnoId }).maybeSingle();
               if (existe) {
                 await supabase.from('asistencias').update({ estado: 'PRESENTE', hora_entrada: ahora }).eq('id', existe.id);
               } else {
                 await supabase.from('asistencias').insert({ sesion_id: sesionId, alumno_id: alumnoId, estado: 'PRESENTE', hora_entrada: ahora });
               }
               mostrarNotificacion('Entrada registrada.', 'exito');
            } else {
               await supabase.from('asistencias').update({ hora_salida: ahora }).match({ sesion_id: sesionId, alumno_id: alumnoId });
               mostrarNotificacion('Salida completada.', 'exito');
            }

            cargarAsistenciasActivas();
            cargarAsignaturas();
          } catch (e) {
            mostrarNotificacion('Error procesando QR.', 'error');
          }
        };

        try {
          await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, () => {});
          scannerActivo = true;
        } catch (err) {
          if (isMounted) {
            mostrarNotificacion('Fallo al cargar lente.', 'error');
            setCamaraActiva(false);
          }
        }
      }, 50);
    };

    if (camaraActiva) arrancar();

    return () => {
      isMounted = false;
      if (html5QrCode && scannerActivo) {
        // Limpieza segura silenciosa
        html5QrCode.stop().catch(() => {});
      }
    };
  }, [camaraActiva, alumnoId]);

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
    if (historial.length === 0) return mostrarNotificacion('No hay datos para exportar.', 'info');
    const filas = historial.map(reg => ({
      Fecha: new Date(reg.fecha).toLocaleDateString(),
      Asignatura: reg.asignatura_nombre,
      Estado: reg.estado.replace(/_/g, ' '),
      Entrada: reg.hora_entrada ? new Date(reg.hora_entrada).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-',
      Salida: reg.hora_salida ? new Date(reg.hora_salida).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-',
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Asistencia');
    XLSX.writeFile(libro, `Mi_Asistencia_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);
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

      <div className="flex items-center justify-between bg-white/70 backdrop-blur-3xl px-6 py-4 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-white/60 mb-8 max-w-4xl mx-auto w-full">
        <div className="flex items-center gap-4">
          <button onClick={onVolver} className="flex items-center justify-center w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors cursor-pointer active:scale-95">←</button>
          <div>
            <h1 className="text-xl font-black text-[#002b5c] tracking-tight leading-tight">Alumno</h1>
            <p className="text-xs font-semibold text-slate-400 truncate max-w-[150px]">{nombre}</p>
          </div>
        </div>
        <button onClick={() => { setCamaraActiva(false); setTabActual(tabActual === 'HORARIO' ? 'CALENDARIO' : 'HORARIO'); }} className={`px-5 py-2.5 rounded-full text-xs font-bold transition-all cursor-pointer active:scale-95 ${tabActual === 'CALENDARIO' ? 'bg-[#002b5c] text-white shadow-md' : 'bg-slate-100 text-[#002b5c] hover:bg-slate-200'}`}>
          {tabActual === 'HORARIO' ? 'Historial' : 'Escanear'}
        </button>
      </div>

      <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col">
        {camaraActiva && (
          <div className="bg-white/70 backdrop-blur-3xl rounded-[2.5rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-white/60 p-6 mb-8 flex flex-col items-center animate-[fade-in_0.3s_ease-out]">
            <div className="w-full max-w-sm overflow-hidden rounded-[2rem] bg-black relative min-h-[350px] flex items-center justify-center shadow-inner">
              <div id="qr-reader" className="w-full h-full [&>video]:object-cover [&>video]:w-full [&>video]:h-full rounded-[2rem]"></div>
            </div>
            <button onClick={() => setCamaraActiva(false)} className="mt-6 px-6 py-3 bg-rose-100 text-rose-600 text-sm font-bold rounded-full transition-colors active:scale-95">Cancelar Escaneo</button>
          </div>
        )}

        {tabActual === 'HORARIO' && !camaraActiva && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-[fade-in_0.4s_ease-out]">
            <button onClick={() => setCamaraActiva(true)} className="md:col-span-1 aspect-square sm:aspect-auto bg-[#0090d0] rounded-[2.5rem] p-8 flex flex-col justify-between text-left cursor-pointer active:scale-[0.97] transition-transform shadow-[0_15px_30px_rgb(0,144,208,0.25)] hover:shadow-[0_20px_40px_rgb(0,144,208,0.35)] relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10 transition-transform group-hover:scale-150"></div>
              <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white mb-8">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
              </div>
              <h3 className="text-3xl font-black tracking-tight text-white leading-none">Registrar<br/>Asistencia</h3>
            </button>

            <div className="md:col-span-2 bg-white/70 backdrop-blur-3xl rounded-[2.5rem] p-8 shadow-[0_15px_40px_-15px_rgba(0,0,0,0.05)] border border-white/60 flex flex-col">
              {asistenciasActivas.length > 0 && (
                <div className="mb-8">
                  <h4 className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-4 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>En Clase</h4>
                  <div className="space-y-3">
                    {asistenciasActivas.map((asist) => (
                      <div key={asist.id} className="p-5 bg-emerald-50 border border-emerald-100 rounded-[1.5rem] flex items-center justify-between">
                        <div>
                          <h4 className="font-bold text-emerald-900 text-sm">Registro Activo</h4>
                          <p className="text-xs text-emerald-600/70 font-semibold mt-1">Llegada: {new Date(asist.hora_entrada).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <button onClick={() => setModalSalir(asist.id)} className="px-4 py-2 bg-white text-rose-500 text-xs font-bold rounded-full shadow-sm hover:text-white hover:bg-rose-500 transition-colors cursor-pointer">Anular</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h3 className="text-lg font-black text-[#002b5c] tracking-tight mb-6">Mis Asignaturas</h3>
              {cargandoClases ? (
                <div className="flex justify-center py-8 text-slate-400 font-medium animate-pulse">Sincronizando...</div>
              ) : clasesHoy.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center"><p className="text-sm font-medium text-slate-400">Escanea un QR para unirte a tu primera clase.</p></div>
              ) : (
                <div className="space-y-3">
                  {clasesHoy.map((clase) => (
                    <div key={clase.id} className="p-5 bg-slate-50/50 rounded-[1.5rem] flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-[#002b5c] text-sm">{clase.nombre}</h4>
                        <p className="text-xs text-slate-400 font-semibold mt-1">{clase.horario}</p>
                      </div>
                      <span className="bg-white px-4 py-1.5 rounded-full text-[11px] font-bold text-[#0090d0] shadow-sm">{clase.aula}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tabActual === 'CALENDARIO' && (
          <div className="bg-white/70 backdrop-blur-3xl rounded-[2.5rem] p-8 shadow-[0_15px_40px_-15px_rgba(0,0,0,0.05)] border border-white/60 animate-[fade-in_0.4s_ease-out]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
              <h3 className="text-xl font-black text-[#002b5c] tracking-tight">Historial</h3>
              <button onClick={exportarHistorialAlumno} className="px-5 py-2.5 bg-[#002b5c] text-white text-xs font-bold rounded-full shadow-md active:scale-95 cursor-pointer">Descargar Reporte</button>
            </div>
            
            {cargandoHistorial ? (
              <div className="py-12 flex justify-center text-slate-400 font-medium animate-pulse">Cargando registros...</div>
            ) : historial.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm font-medium">No hay registros de asistencia previos.</div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                {historial.map((registro, idx) => (
                  <div key={idx} className="p-5 bg-slate-50/50 rounded-[1.5rem] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className="font-bold text-[#002b5c] text-sm mb-1">{registro.asignatura_nombre}</h4>
                      <p className="text-[11px] font-semibold text-slate-400">
                        {new Date(registro.fecha).toLocaleDateString()} · {registro.hora_entrada ? new Date(registro.hora_entrada).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : '--:--'}
                      </p>
                    </div>
                    <span className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-center
                      ${registro.estado === 'PRESENTE' ? 'bg-emerald-100/50 text-emerald-600' :
                        registro.estado === 'RETRASO' ? 'bg-amber-100/50 text-amber-600' :
                        registro.estado === 'SE_FUE_A_MITAD' ? 'bg-purple-100/50 text-purple-600' : 'bg-rose-100/50 text-rose-600'}
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
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl text-center">
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-2">Anular Asistencia</h3>
            <p className="text-xs text-slate-500 font-medium mb-6">Introduce tu contraseña para confirmar.</p>
            <input type="password" placeholder="Contraseña" value={passConfirm} onChange={(e) => setPassConfirm(e.target.value)} className="w-full p-4 bg-slate-50 rounded-2xl mb-6 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-center text-sm font-semibold"/>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { setModalSalir(null); setPassConfirm(''); }} className="py-3.5 rounded-2xl text-slate-500 text-sm font-bold bg-slate-100 active:scale-95">Cancelar</button>
              <button onClick={confirmarSalidaSegura} disabled={cargandoPass || !passConfirm} className="py-3.5 rounded-2xl bg-rose-500 text-white text-sm font-bold active:scale-95 disabled:opacity-50">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
