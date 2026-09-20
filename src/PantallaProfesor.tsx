import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import * as XLSX from 'xlsx';

interface Props {
  onVolver: () => void;
}

type TabGestion = 'ALUMNOS' | 'ASIGNATURAS';

export default function PantallaGestionDocente({ onVolver }: Props) {
  const [tabActual, setTabActual] = useState<TabGestion>('ALUMNOS');
  const [cargando, setCargando] = useState(true);
  
  const [alumnos, setAlumnos] = useState<any[]>([]);
  const [asignaturas, setAsignaturas] = useState<any[]>([]);
  const [modalAsignatura, setModalAsignatura] = useState(false);
  const [formAsignatura, setFormAsignatura] = useState({ nombre: '', aula: '', horario: '' });
  const [guardandoAsig, setGuardandoAsig] = useState(false);

  const [modalEliminarAsig, setModalEliminarAsig] = useState<string | null>(null);
  const [passConfirm, setPassConfirm] = useState('');
  const [cargandoPass, setCargandoPass] = useState(false);

  const [asignaturaSeleccionada, setAsignaturaSeleccionada] = useState<any | null>(null);
  const [cargandoHistorialAsig, setCargandoHistorialAsig] = useState(false);
  
  const [fechaInicio, setFechaInicio] = useState<string>('');
  const [fechaFin, setFechaFin] = useState<string>('');

  const [editandoAulaId, setEditandoAulaId] = useState<string | null>(null);
  const [aulaTemp, setAulaTemp] = useState<string>('');

  const [notificacion, setNotificacion] = useState<{ texto: string; tipo: 'exito' | 'error' | 'info' } | null>(null);

  const mostrarNotificacion = (texto: string, tipo: 'exito' | 'error' | 'info' = 'info') => {
    setNotificacion({ texto, tipo });
    setTimeout(() => setNotificacion(null), 4000);
  };

  const cargarAlumnos = async () => {
    setCargando(true);
    try {
      const { data: perfiles } = await supabase
        .from('perfiles')
        .select('*')
        .eq('rol', 'alumno')
        .order('nombre_completo', { ascending: true });
      
      if (perfiles) setAlumnos(perfiles);
    } finally {
      setCargando(false);
    }
  };

  const cargarAsignaturas = async () => {
    setCargando(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from('asignaturas').select('*').eq('profesor_id', user.id).order('nombre', { ascending: true });
      if (data) setAsignaturas(data);
    }
    setCargando(false);
  };

  useEffect(() => {
    if (tabActual === 'ALUMNOS') cargarAlumnos();
    if (tabActual === 'ASIGNATURAS') cargarAsignaturas();
  }, [tabActual]);

  const desvincularDispositivo = async (id: string, nombre: string) => {
    const confirmar = window.confirm(`¿Desvincular dispositivo de ${nombre}?`);
    if (!confirmar) return;
    const { error } = await supabase.from('perfiles').update({ dispositivo_hash: null }).eq('id', id);
    if (error) mostrarNotificacion('Error al desvincular.', 'error');
    else {
      mostrarNotificacion('Dispositivo desvinculado.', 'exito');
      cargarAlumnos();
    }
  };

  const guardarNuevaAsignatura = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardandoAsig(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('asignaturas').insert([{ nombre: formAsignatura.nombre, aula: formAsignatura.aula, horario: formAsignatura.horario, profesor_id: user?.id }]);
    setGuardandoAsig(false);
    if (error) mostrarNotificacion('Error al crear asignatura.', 'error');
    else { 
      setFormAsignatura({ nombre: '', aula: '', horario: '' }); 
      setModalAsignatura(false); 
      mostrarNotificacion('Asignatura creada.', 'exito');
      cargarAsignaturas(); 
    }
  };

  const confirmarEliminarAsignatura = async () => {
    if (!passConfirm || !modalEliminarAsig) return;
    setCargandoPass(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Sin sesión activa.");
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: passConfirm });
      if (authError) throw new Error("Contraseña incorrecta.");

      const { data: sesiones } = await supabase.from('sesiones').select('id').eq('asignatura_id', modalEliminarAsig);
      if (sesiones && sesiones.length > 0) {
        const sesionIds = sesiones.map((s) => s.id);
        await supabase.from('asistencias').delete().in('sesion_id', sesionIds);
        await supabase.from('sesiones').delete().eq('asignatura_id', modalEliminarAsig);
      }
      await supabase.from('asignaturas').delete().eq('id', modalEliminarAsig);
      
      setModalEliminarAsig(null); 
      setPassConfirm(''); 
      mostrarNotificacion('Asignatura eliminada.', 'exito');
      cargarAsignaturas();
    } catch (error: any) { 
      mostrarNotificacion(error.message, 'error'); 
    } finally { 
      setCargandoPass(false); 
    }
  };

  const abrirDetallesAsignatura = (asig: any) => {
    setAsignaturaSeleccionada(asig);
    setFechaInicio('');
    setFechaFin('');
  };

  // --- MOTOR PIVOT ROBUSTO (Datos planos en memoria local) ---
  const generarMatrizReporte = async () => {
    if (!asignaturaSeleccionada) return null;

    // 1. Obtener todas las sesiones de esta asignatura
    const { data: sesionesDataRaw } = await supabase
      .from('sesiones')
      .select('*')
      .eq('asignatura_id', asignaturaSeleccionada.id);
    
    if (!sesionesDataRaw || sesionesDataRaw.length === 0) {
      mostrarNotificacion("No hay clases registradas en esta materia.", 'info');
      return null;
    }

    const sesionIds = sesionesDataRaw.map(s => s.id);

    // 2. Traer asistencias en crudo
    const { data: asistData } = await supabase.from('asistencias').select('*').in('sesion_id', sesionIds);
    if (!asistData || asistData.length === 0) {
      mostrarNotificacion("Ningún alumno ha registrado asistencia en esta materia.", 'info');
      return null;
    }

    // 3. Traer diccionario de nombres de alumnos
    const aluIds = [...new Set(asistData.map(a => a.alumno_id))];
    const { data: perfiles } = await supabase.from('perfiles').select('id, nombre_completo').in('id', aluIds);
    const mapPerfiles: Record<string, string> = {};
    perfiles?.forEach(p => mapPerfiles[p.id] = p.nombre_completo);

    // 4. Normalizar fechas de cada sesión (usa created_at o la hora_entrada de las asistencias)
    const sesionesConFecha = sesionesDataRaw.map(ses => {
      let fechaIso = ses.created_at;
      if (!fechaIso) {
        const primeraAsist = asistData.find(a => a.sesion_id === ses.id && a.hora_entrada);
        fechaIso = primeraAsist ? primeraAsist.hora_entrada : new Date().toISOString();
      }
      return {
        ...ses,
        fechaStr: new Date(fechaIso).toLocaleDateString(),
        fechaYMD: new Date(fechaIso).toISOString().split('T')[0]
      };
    });

    // 5. Filtrar por fechas si el usuario escogió rango
    const sesionesFiltradas = sesionesConFecha.filter(ses => {
      if (fechaInicio && ses.fechaYMD < fechaInicio) return false;
      if (fechaFin && ses.fechaYMD > fechaFin) return false;
      return true;
    });

    if (sesionesFiltradas.length === 0) {
      mostrarNotificacion("No hay clases dentro del rango de fechas seleccionado.", 'info');
      return null;
    }

    // 6. Construir la Matriz (Filas: Alumnos, Columnas: Fechas)
    const reporteAlumnos: Record<string, any> = {};

    aluIds.forEach(aluId => {
      reporteAlumnos[aluId] = {
        Alumno: mapPerfiles[aluId] || 'Estudiante'
      };
      sesionesFiltradas.forEach(ses => {
        reporteAlumnos[aluId][ses.fechaStr] = 'AUSENTE';
      });
    });

    asistData.forEach(asist => {
      const sesion = sesionesFiltradas.find(s => s.id === asist.sesion_id);
      if (sesion && reporteAlumnos[asist.alumno_id]) {
        reporteAlumnos[asist.alumno_id][sesion.fechaStr] = asist.estado.replace(/_/g, ' ');
      }
    });

    const filas = Object.values(reporteAlumnos).sort((a: any, b: any) => a.Alumno.localeCompare(b.Alumno));
    return { filas };
  };

  const exportarAExcel = async () => {
    setCargandoHistorialAsig(true);
    try {
      const data = await generarMatrizReporte();
      if (!data) return;

      const libro = XLSX.utils.book_new();
      const hoja = XLSX.utils.json_to_sheet(data.filas);
      XLSX.utils.book_append_sheet(libro, hoja, 'Asistencias');
      XLSX.writeFile(libro, `Reporte_${asignaturaSeleccionada.nombre.replace(/ /g, '_')}_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);
      mostrarNotificacion('Archivo Excel generado con éxito.', 'exito');
    } catch {
      mostrarNotificacion('Error al procesar el archivo Excel.', 'error');
    } finally {
      setCargandoHistorialAsig(false);
    }
  };

  const exportarAGoogleSheets = async () => {
    setCargandoHistorialAsig(true);
    try {
      const data = await generarMatrizReporte();
      if (!data) return;

      const cabeceras = Object.keys(data.filas[0]);
      const lineasTSV = [
        cabeceras.join('\t'),
        ...data.filas.map((fila) => cabeceras.map((campo) => `"${fila[campo] || ''}"`).join('\t'))
      ].join('\n');

      await navigator.clipboard.writeText(lineasTSV);
      window.open('https://sheets.new', '_blank');

      mostrarNotificacion('Datos copiados. Pega con Cmd+V o Ctrl+V en la celda A1.', 'exito');
    } catch {
      mostrarNotificacion('Error copiando al portapapeles.', 'error');
    } finally {
      setCargandoHistorialAsig(false);
    }
  };

  // --- EXPORTADOR GLOBAL (Todas las asignaturas en un Excel multipestaña) ---
  const exportarTodoGlobal = async () => {
    setCargando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: asigs } = await supabase.from('asignaturas').select('*').eq('profesor_id', user.id);
      if (!asigs || asigs.length === 0) return mostrarNotificacion('No tienes asignaturas registradas.', 'error');

      const asigIds = asigs.map(a => a.id);
      const { data: sesiones } = await supabase.from('sesiones').select('*').in('asignatura_id', asigIds);
      if (!sesiones || sesiones.length === 0) return mostrarNotificacion('No hay clases registradas aún.', 'info');

      const sesionIds = sesiones.map(s => s.id);
      const { data: asistencias } = await supabase.from('asistencias').select('*').in('sesion_id', sesionIds);
      if (!asistencias || asistencias.length === 0) return mostrarNotificacion('No hay asistencias registradas en ninguna materia.', 'info');

      const aluIds = [...new Set(asistencias.map(a => a.alumno_id))];
      const { data: perfiles } = await supabase.from('perfiles').select('id, nombre_completo').in('id', aluIds);
      const mapPerfiles: Record<string, string> = {};
      perfiles?.forEach(p => mapPerfiles[p.id] = p.nombre_completo);

      const libro = XLSX.utils.book_new();

      asigs.forEach(asig => {
        const sesAsig = sesiones.filter(s => s.asignatura_id === asig.id);
        if (sesAsig.length === 0) return;

        // Asignar fechas seguras a las sesiones
        const sesConFechas = sesAsig.map(ses => {
          let f = ses.created_at;
          if (!f) {
            const asistRef = asistencias.find(a => a.sesion_id === ses.id && a.hora_entrada);
            f = asistRef ? asistRef.hora_entrada : new Date().toISOString();
          }
          return { ...ses, fechaStr: new Date(f).toLocaleDateString() };
        });

        const asistsDeEstaAsig = asistencias.filter(a => sesAsig.some(s => s.id === a.sesion_id));
        if (asistsDeEstaAsig.length === 0) return;

        const reporte: Record<string, any> = {};
        const alumnosEnEstaAsig = [...new Set(asistsDeEstaAsig.map(a => a.alumno_id))];

        alumnosEnEstaAsig.forEach(idAlu => {
          reporte[idAlu] = { Alumno: mapPerfiles[idAlu] || 'Estudiante' };
          sesConFechas.forEach(ses => {
            reporte[idAlu][ses.fechaStr] = 'AUSENTE';
          });
        });

        asistsDeEstaAsig.forEach(a => {
          const sesion = sesConFechas.find(s => s.id === a.sesion_id);
          if (sesion && reporte[a.alumno_id]) {
            reporte[a.alumno_id][sesion.fechaStr] = a.estado.replace(/_/g, ' ');
          }
        });

        const filas = Object.values(reporte).sort((a: any, b: any) => a.Alumno.localeCompare(b.Alumno));
        if (filas.length > 0) {
          const hoja = XLSX.utils.json_to_sheet(filas);
          XLSX.utils.book_append_sheet(libro, hoja, asig.nombre.substring(0, 31));
        }
      });

      if (libro.SheetNames.length === 0) return mostrarNotificacion('No hay asistencias registradas para exportar.', 'info');
      
      XLSX.writeFile(libro, `Reporte_Global_Clases_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);
      mostrarNotificacion('Exportación global completada con éxito.', 'exito');
    } catch {
      mostrarNotificacion('Error durante la exportación global.', 'error');
    } finally {
      setCargando(false);
    }
  };

  const iniciarEdicionAula = (id: string, aulaActual: string) => {
    setEditandoAulaId(id);
    setAulaTemp(aulaActual);
  };

  const guardarEdicionAula = async (id: string) => {
    setEditandoAulaId(null);
    if (!aulaTemp.trim()) return;

    setAsignaturas(prev => prev.map(a => a.id === id ? { ...a, aula: aulaTemp } : a));

    const { error } = await supabase.from('asignaturas').update({ aula: aulaTemp }).eq('id', id);
    if (error) {
      mostrarNotificacion('Error actualizando aula.', 'error');
      cargarAsignaturas();
    } else {
      mostrarNotificacion('Aula actualizada.', 'exito');
    }
  };

  const handleKeyDownAula = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') guardarEdicionAula(id);
    else if (e.key === 'Escape') setEditandoAulaId(null);
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

      <div className="flex items-center justify-between bg-white/70 backdrop-blur-3xl px-6 py-4 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-white/60 mb-8 max-w-5xl mx-auto w-full animate-[fade-in_0.4s_ease-out]">
        <div className="flex items-center gap-4">
          <button onClick={onVolver} className="flex items-center justify-center w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors cursor-pointer active:scale-95">←</button>
          <div>
            <h1 className="text-xl font-black text-[#002b5c] tracking-tight leading-tight">Gestión Docente</h1>
            <p className="text-xs font-semibold text-slate-400">Panel Global</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col gap-6 animate-[fade-in_0.4s_ease-out]">
        
        <div className="flex bg-white/70 backdrop-blur-3xl p-1.5 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-white/60 max-w-xs mx-auto w-full">
          <button onClick={() => setTabActual('ALUMNOS')} className={`flex-1 py-3 text-xs font-bold rounded-full transition-all cursor-pointer ${tabActual === 'ALUMNOS' ? 'bg-[#002b5c] text-white shadow-md' : 'text-slate-500 hover:text-[#002b5c]'}`}>Alumnado</button>
          <button onClick={() => setTabActual('ASIGNATURAS')} className={`flex-1 py-3 text-xs font-bold rounded-full transition-all cursor-pointer ${tabActual === 'ASIGNATURAS' ? 'bg-[#002b5c] text-white shadow-md' : 'text-slate-500 hover:text-[#002b5c]'}`}>Asignaturas</button>
        </div>

        {tabActual === 'ALUMNOS' && (
          <div className="bg-white/70 backdrop-blur-3xl rounded-[3rem] shadow-[0_15px_40px_-15px_rgba(0,0,0,0.05)] border border-white/60 p-8 flex-1">
            <div className="flex items-center justify-between mb-8 px-2">
              <h2 className="text-2xl font-black text-[#002b5c] tracking-tight">Dispositivos</h2>
              <span className="bg-[#0090d0]/10 text-[#0090d0] px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider">{alumnos.length} Registros</span>
            </div>

            {cargando ? (
              <div className="flex justify-center py-12 text-slate-400 font-medium animate-pulse">Sincronizando...</div>
            ) : alumnos.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm font-medium">No hay alumnos registrados en la plataforma.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {alumnos.map((alumno) => (
                  <div key={alumno.id} className="p-5 bg-white/80 hover:bg-white rounded-[1.5rem] shadow-sm border border-slate-100 flex items-center justify-between transition-colors">
                    <div className="overflow-hidden pr-4">
                      <h3 className="font-bold text-[#002b5c] text-sm truncate">{alumno.nombre_completo}</h3>
                      <p className="text-[11px] font-semibold text-slate-400 mt-0.5 truncate">{alumno.email}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`w-2 h-2 rounded-full ${alumno.dispositivo_hash ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{alumno.dispositivo_hash ? 'Vinculado' : 'Sin Dispositivo'}</span>
                      </div>
                    </div>
                    <button onClick={() => desvincularDispositivo(alumno.id, alumno.nombre_completo)} disabled={!alumno.dispositivo_hash} className="shrink-0 px-4 py-2.5 bg-slate-50 text-slate-600 hover:text-rose-600 hover:bg-rose-50 text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95 disabled:opacity-50">Resetear</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tabActual === 'ASIGNATURAS' && (
          <div className="bg-white/70 backdrop-blur-3xl rounded-[3rem] shadow-[0_15px_40px_-15px_rgba(0,0,0,0.05)] border border-white/60 p-8 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 px-2 gap-4">
              <h2 className="text-2xl font-black text-[#002b5c] tracking-tight">Materias</h2>
              <div className="flex gap-3">
                <button onClick={exportarTodoGlobal} className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-full text-xs font-bold shadow-md transition-all cursor-pointer active:scale-95">
                  Exportador Global ↓
                </button>
                <button onClick={() => setModalAsignatura(true)} className="bg-[#002b5c] hover:bg-[#0090d0] text-white px-5 py-2.5 rounded-full text-xs font-bold shadow-md transition-all cursor-pointer active:scale-95">
                  Nueva +
                </button>
              </div>
            </div>

            {cargando ? (
              <div className="flex justify-center py-12 text-slate-400 font-medium animate-pulse">Cargando...</div>
            ) : asignaturas.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm font-medium">Aún no has creado asignaturas.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {asignaturas.map((asig) => (
                  <div key={asig.id} className="p-6 bg-white/80 rounded-[2rem] border border-slate-100 flex flex-col justify-between hover:shadow-[0_20px_40px_rgba(0,144,208,0.1)] transition-all relative group">
                    <button onClick={() => setModalEliminarAsig(asig.id)} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-rose-50 text-rose-400 hover:text-white hover:bg-rose-500 rounded-full transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer" title="Eliminar">✕</button>
                    <div>
                      <h3 className="font-bold text-[#002b5c] text-lg pr-8">{asig.nombre}</h3>
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mt-3">
                        <span>{asig.horario}</span>
                        
                        {editandoAulaId === asig.id ? (
                          <input 
                            autoFocus
                            type="text" 
                            value={aulaTemp}
                            onChange={(e) => setAulaTemp(e.target.value)}
                            onBlur={() => guardarEdicionAula(asig.id)}
                            onKeyDown={(e) => handleKeyDownAula(e, asig.id)}
                            className="bg-slate-50 w-20 px-3 py-1.5 rounded-full border-none focus:ring-2 focus:ring-[#0090d0]/20 text-[#002b5c] text-center font-bold outline-none"
                          />
                        ) : (
                          <span 
                            onClick={() => iniciarEdicionAula(asig.id, asig.aula)}
                            className="bg-[#0090d0]/10 text-[#0090d0] px-3 py-1.5 rounded-full uppercase tracking-wider text-[10px] font-bold cursor-pointer hover:bg-[#0090d0]/20 transition-colors"
                          >
                            {asig.aula}
                          </span>
                        )}
                        
                      </div>
                    </div>
                    <button onClick={() => abrirDetallesAsignatura(asig)} className="mt-6 w-full py-3 bg-slate-50 hover:bg-[#0090d0] text-[#002b5c] hover:text-white text-xs font-bold rounded-[1rem] transition-all cursor-pointer active:scale-95">
                      Exportar Matriz
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {modalAsignatura && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-2">Crear Asignatura</h3>
            <p className="text-xs text-slate-500 font-medium mb-6">Completa los datos base.</p>
            <form onSubmit={guardarNuevaAsignatura} className="flex flex-col gap-4">
              <input type="text" placeholder="Materia (ej. Física)" value={formAsignatura.nombre} onChange={(e) => setFormAsignatura({...formAsignatura, nombre: e.target.value})} className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-sm font-semibold text-[#002b5c]" required/>
              <input type="text" placeholder="Aula (ej. Lab 1)" value={formAsignatura.aula} onChange={(e) => setFormAsignatura({...formAsignatura, aula: e.target.value})} className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-sm font-semibold text-[#002b5c]" required/>
              <input type="text" placeholder="Horario (ej. L - 09:00)" value={formAsignatura.horario} onChange={(e) => setFormAsignatura({...formAsignatura, horario: e.target.value})} className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-sm font-semibold text-[#002b5c]" required/>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button type="button" onClick={() => setModalAsignatura(false)} className="py-3.5 rounded-2xl text-slate-500 text-sm font-bold bg-slate-100 active:scale-95 cursor-pointer">Cancelar</button>
                <button type="submit" disabled={guardandoAsig} className="py-3.5 rounded-2xl bg-[#002b5c] text-white text-sm font-bold active:scale-95 disabled:opacity-50 cursor-pointer">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalEliminarAsig && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl text-center">
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-2">Eliminar Materia</h3>
            <p className="text-xs text-slate-500 font-medium mb-6">Perderás todos los historiales. Confirma tu identidad.</p>
            <input type="password" placeholder="Contraseña docente" value={passConfirm} onChange={(e) => setPassConfirm(e.target.value)} className="w-full p-4 bg-slate-50 rounded-2xl mb-6 focus:outline-none focus:ring-2 focus:ring-rose-500/20 text-center text-sm font-semibold"/>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { setModalEliminarAsig(null); setPassConfirm(''); }} className="py-3.5 rounded-2xl text-slate-500 text-sm font-bold bg-slate-100 active:scale-95 cursor-pointer">Cancelar</button>
              <button onClick={confirmarEliminarAsignatura} disabled={cargandoPass || !passConfirm} className="py-3.5 rounded-2xl bg-rose-500 text-white text-sm font-bold active:scale-95 disabled:opacity-50 cursor-pointer">Destruir</button>
            </div>
          </div>
        </div>
      )}

      {asignaturaSeleccionada && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white/90 backdrop-blur-3xl rounded-[3rem] p-8 max-w-md w-full shadow-2xl border border-white/60 flex flex-col">
            <div className="flex items-center justify-between mb-8 shrink-0">
              <div>
                <h3 className="text-xl font-black text-[#002b5c] tracking-tight">{asignaturaSeleccionada.nombre}</h3>
                <p className="text-xs text-slate-500 font-semibold mt-1">Exportación Pivot</p>
              </div>
              <button onClick={() => setAsignaturaSeleccionada(null)} className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full cursor-pointer transition-colors active:scale-95">✕</button>
            </div>
            
            <div className="bg-slate-50/80 rounded-[2rem] p-6">
              <h4 className="font-bold text-[#002b5c] text-xs uppercase tracking-wider mb-4">Filtrar Fechas (Opcional)</h4>
              
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div>
                  <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="w-full bg-white px-4 py-3 rounded-2xl text-xs font-semibold text-slate-600 border border-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 shadow-sm transition-all cursor-pointer"/>
                </div>
                <div>
                  <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className="w-full bg-white px-4 py-3 rounded-2xl text-xs font-semibold text-slate-600 border border-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 shadow-sm transition-all cursor-pointer"/>
                </div>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={exportarAGoogleSheets}
                  disabled={cargandoHistorialAsig}
                  className="w-full py-4 bg-[#0090d0] hover:bg-[#007fb8] text-white text-sm font-bold rounded-2xl transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {cargandoHistorialAsig ? 'Generando...' : 'Abrir en Google Sheets'}
                </button>

                <button 
                  onClick={exportarAExcel}
                  disabled={cargandoHistorialAsig}
                  className="w-full py-3.5 bg-white text-[#002b5c] border border-slate-100 hover:bg-slate-50 text-xs font-bold rounded-2xl transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {cargandoHistorialAsig ? 'Generando...' : 'Descargar Excel (.xlsx)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
