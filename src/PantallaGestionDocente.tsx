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

  // Estados Historial y Calendario Docente
  const [asignaturaSeleccionada, setAsignaturaSeleccionada] = useState<any | null>(null);
  const [cargandoHistorialAsig, setCargandoHistorialAsig] = useState(false);
  
  const [fechaInicio, setFechaInicio] = useState<string>('');
  const [fechaFin, setFechaFin] = useState<string>('');

  // Estados para edición en tiempo real del aula
  const [editandoAulaId, setEditandoAulaId] = useState<string | null>(null);
  const [aulaTemp, setAulaTemp] = useState<string>('');

  const cargarAlumnos = async () => {
    setCargando(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: asigs } = await supabase.from('asignaturas').select('id').eq('profesor_id', user.id);
    if (!asigs || asigs.length === 0) { setAlumnos([]); setCargando(false); return; }
    
    const asigIds = asigs.map(a => a.id);
    const { data: sesiones } = await supabase.from('sesiones').select('id').in('asignatura_id', asigIds);
    if (!sesiones || sesiones.length === 0) { setAlumnos([]); setCargando(false); return; }
    
    const sesionIds = sesiones.map(s => s.id);
    const { data: asistencias } = await supabase.from('asistencias').select('alumno_id').in('sesion_id', sesionIds);
    if (!asistencias || asistencias.length === 0) { setAlumnos([]); setCargando(false); return; }
    
    const uniqueAlumnosIds = Array.from(new Set(asistencias.map(a => a.alumno_id)));
    const { data: perfiles } = await supabase.from('perfiles').select('*').in('id', uniqueAlumnosIds).order('nombre_completo', { ascending: true });
    
    if (perfiles) setAlumnos(perfiles);
    setCargando(false);
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
    const confirmar = window.confirm(`¿Estás seguro de que quieres desvincular el dispositivo de ${nombre}?`);
    if (!confirmar) return;
    const { error } = await supabase.from('perfiles').update({ dispositivo_hash: null }).eq('id', id);
    if (error) alert('Error: ' + error.message);
    else cargarAlumnos();
  };

  const guardarNuevaAsignatura = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardandoAsig(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('asignaturas').insert([{ nombre: formAsignatura.nombre, aula: formAsignatura.aula, horario: formAsignatura.horario, profesor_id: user?.id }]);
    setGuardandoAsig(false);
    if (error) alert('Error al crear la asignatura: ' + error.message);
    else { setFormAsignatura({ nombre: '', aula: '', horario: '' }); setModalAsignatura(false); cargarAsignaturas(); }
  };

  const confirmarEliminarAsignatura = async () => {
    if (!passConfirm || !modalEliminarAsig) return;
    setCargandoPass(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("No se encontró sesión activa.");
      const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: passConfirm });
      if (authError) throw new Error("Contraseña incorrecta.");

      const { data: sesiones, error: sesError } = await supabase.from('sesiones').select('id').eq('asignatura_id', modalEliminarAsig);
      if (sesError) throw sesError;

      if (sesiones && sesiones.length > 0) {
        const sesionIds = sesiones.map((s) => s.id);
        const { error: asistError } = await supabase.from('asistencias').delete().in('sesion_id', sesionIds);
        if (asistError) throw asistError;
        const { error: sesDeleteError } = await supabase.from('sesiones').delete().eq('asignatura_id', modalEliminarAsig);
        if (sesDeleteError) throw sesDeleteError;
      }
      const { error: asigDeleteError } = await supabase.from('asignaturas').delete().eq('id', modalEliminarAsig);
      if (asigDeleteError) throw asigDeleteError;
      
      setModalEliminarAsig(null); setPassConfirm(''); cargarAsignaturas();
    } catch (error: any) { alert(error.message); } finally { setCargandoPass(false); }
  };

  const abrirDetallesAsignatura = async (asig: any) => {
    setAsignaturaSeleccionada(asig);
    setFechaInicio(''); setFechaFin('');
  };

  // Generador de matriz tabular en formato pivot (Filas = Alumnos, Columnas = Fechas)
  const generarMatrizReporte = async () => {
    if (!asignaturaSeleccionada) return null;

    let querySesiones = supabase.from('sesiones').select('id, created_at').eq('asignatura_id', asignaturaSeleccionada.id).eq('fase', 'CERRADA').order('created_at', { ascending: true });
    if (fechaInicio) querySesiones = querySesiones.gte('created_at', `${fechaInicio}T00:00:00Z`);
    if (fechaFin) querySesiones = querySesiones.lte('created_at', `${fechaFin}T23:59:59Z`);

    const { data: sesionesData } = await querySesiones;
    
    if (!sesionesData || sesionesData.length === 0) {
      alert("No hay clases finalizadas en el periodo seleccionado.");
      return null;
    }

    const sesionIds = sesionesData.map(s => s.id);
    const { data: asistData } = await supabase.from('asistencias').select('*, perfiles(nombre_completo)').in('sesion_id', sesionIds);

    if (!asistData || asistData.length === 0) {
      alert("No hay datos de alumnos en el periodo seleccionado.");
      return null;
    }

    const reporteAlumnos: Record<string, any> = {};
    
    asistData.forEach((asist: any) => {
      const aluId = asist.alumno_id;
      if (!reporteAlumnos[aluId]) {
        reporteAlumnos[aluId] = { Alumno: asist.perfiles?.nombre_completo || 'Desconocido' };
        sesionesData.forEach(ses => {
          const fechaCol = new Date(ses.created_at).toLocaleDateString();
          reporteAlumnos[aluId][fechaCol] = 'AUSENTE';
        });
      }
    });

    asistData.forEach((asist: any) => {
      const sesion = sesionesData.find(s => s.id === asist.sesion_id);
      if (sesion) {
        const fechaCol = new Date(sesion.created_at).toLocaleDateString();
        reporteAlumnos[asist.alumno_id][fechaCol] = asist.estado.replace(/_/g, ' ');
      }
    });

    const filas = Object.values(reporteAlumnos).sort((a: any, b: any) => a.Alumno.localeCompare(b.Alumno));
    return { filas, sesionesData };
  };

  const exportarAExcel = async () => {
    setCargandoHistorialAsig(true);
    try {
      const data = await generarMatrizReporte();
      if (!data) return;

      const libro = XLSX.utils.book_new();
      const hoja = XLSX.utils.json_to_sheet(data.filas);
      XLSX.utils.book_append_sheet(libro, hoja, 'Asistencias Periodo');
      XLSX.writeFile(libro, `Reporte_${asignaturaSeleccionada.nombre.replace(/ /g, '_')}_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);
    } catch (error) {
      console.error(error);
      alert("Ocurrió un error al generar el archivo Excel.");
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
      const ventana = window.open('https://sheets.new', '_blank');

      alert(
        '📋 ¡Datos copiados al portapapeles!\n\nSe ha abierto una hoja nueva de Google Sheets. Pulsa "Ctrl + V" (o "Cmd + V") en la celda A1 para pegar toda la matriz de asistencia.'
      );

      if (!ventana) {
        alert('Por favor, permite las ventanas emergentes en tu navegador para abrir Google Sheets de forma automática.');
      }
    } catch (err) {
      console.error(err);
      alert('Hubo un problema al transferir los datos a Google Sheets.');
    } finally {
      setCargandoHistorialAsig(false);
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
      alert("Error al actualizar el aula.");
      cargarAsignaturas();
    }
  };

  const handleKeyDownAula = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      guardarEdicionAula(id);
    } else if (e.key === 'Escape') {
      setEditandoAulaId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] p-4 sm:p-8 flex flex-col font-sans selection:bg-[#0090d0] selection:text-white">
      
      <div className="flex items-center justify-between bg-white/80 backdrop-blur-xl px-6 py-4 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-black/[0.03] mb-8 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-4">
          <button onClick={onVolver} className="flex items-center justify-center w-10 h-10 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors cursor-pointer active:scale-95">←</button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">Administración</h1>
            <p className="text-xs font-medium text-slate-500">Panel Global Docente</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col gap-6">
        
        <div className="flex bg-white p-2 rounded-[2rem] shadow-sm border border-slate-100 max-w-sm mx-auto w-full">
          <button onClick={() => setTabActual('ALUMNOS')} className={`flex-1 py-3 text-sm font-bold rounded-[1.5rem] transition-all cursor-pointer ${tabActual === 'ALUMNOS' ? 'bg-[#0090d0] text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>Alumnado</button>
          <button onClick={() => setTabActual('ASIGNATURAS')} className={`flex-1 py-3 text-sm font-bold rounded-[1.5rem] transition-all cursor-pointer ${tabActual === 'ASIGNATURAS' ? 'bg-[#0090d0] text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>Asignaturas</button>
        </div>

        {tabActual === 'ALUMNOS' && (
          <div className="bg-white rounded-[2.5rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] p-8 flex-1">
            <div className="flex items-center justify-between mb-8 px-2">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Control de Dispositivos</h2>
              <span className="bg-sky-50 text-[#0090d0] px-4 py-2 rounded-full text-xs font-bold">{alumnos.length} Alumnos</span>
            </div>

            {cargando ? (
              <div className="flex justify-center py-12 text-slate-400 font-medium animate-pulse">Cargando alumnos de tus clases...</div>
            ) : alumnos.length === 0 ? (
              <div className="text-center py-12 text-slate-400 font-medium">No hay alumnos vinculados a tus clases todavía.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {alumnos.map((alumno) => (
                  <div key={alumno.id} className="p-5 bg-slate-50 hover:bg-slate-100/50 rounded-[1.5rem] border border-slate-100 flex items-center justify-between transition-colors">
                    <div className="overflow-hidden pr-4">
                      <h3 className="font-bold text-slate-800 text-sm truncate">{alumno.nombre_completo}</h3>
                      <p className="text-xs text-slate-400 font-medium mt-0.5 truncate">{alumno.email}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`w-2 h-2 rounded-full ${alumno.dispositivo_hash ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{alumno.dispositivo_hash ? 'Móvil Vinculado' : 'Sin Dispositivo'}</span>
                      </div>
                    </div>
                    <button onClick={() => desvincularDispositivo(alumno.id, alumno.nombre_completo)} disabled={!alumno.dispositivo_hash} className="shrink-0 px-4 py-2.5 bg-white border border-slate-200 hover:border-rose-200 hover:bg-rose-50 text-slate-600 hover:text-rose-600 text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">Desvincular</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tabActual === 'ASIGNATURAS' && (
          <div className="bg-white rounded-[2.5rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-black/[0.02] p-8 flex-1">
            <div className="flex items-center justify-between mb-8 px-2">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Mis Asignaturas</h2>
              <button onClick={() => setModalAsignatura(true)} className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-full text-sm font-bold shadow-sm transition-all cursor-pointer active:scale-95">+ Nueva Asignatura</button>
            </div>

            {cargando ? (
              <div className="flex justify-center py-12 text-slate-400 font-medium animate-pulse">Cargando materias...</div>
            ) : asignaturas.length === 0 ? (
              <div className="text-center py-12 text-slate-400 font-medium">Aún no has creado ninguna asignatura.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {asignaturas.map((asig) => (
                  <div key={asig.id} className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100 flex flex-col justify-between hover:shadow-md transition-shadow relative group">
                    <button onClick={() => setModalEliminarAsig(asig.id)} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white text-rose-300 hover:text-rose-600 hover:bg-rose-50 rounded-full shadow-sm transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer" title="Eliminar Asignatura">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                    <div>
                      <h3 className="font-bold text-slate-900 text-lg pr-8">{asig.nombre}</h3>
                      <div className="flex items-center justify-between text-sm font-medium text-slate-500 mt-3">
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#0090d0]"></span>{asig.horario}</span>
                        
                        {editandoAulaId === asig.id ? (
                          <input 
                            autoFocus
                            type="text" 
                            value={aulaTemp}
                            onChange={(e) => setAulaTemp(e.target.value)}
                            onBlur={() => guardarEdicionAula(asig.id)}
                            onKeyDown={(e) => handleKeyDownAula(e, asig.id)}
                            className="bg-white w-20 px-3 py-1 rounded-full shadow-inner border border-[#0090d0] text-slate-900 text-center text-xs font-bold outline-none"
                            title="Presiona Enter para guardar"
                          />
                        ) : (
                          <span 
                            onClick={() => iniciarEdicionAula(asig.id, asig.aula)}
                            className="bg-white px-3 py-1 rounded-full shadow-sm border border-slate-200/60 text-slate-600 cursor-pointer hover:border-[#0090d0] hover:text-[#0090d0] transition-colors"
                            title="Click para editar aula"
                          >
                            {asig.aula}
                          </span>
                        )}
                        
                      </div>
                    </div>
                    <button onClick={() => abrirDetallesAsignatura(asig)} className="mt-5 w-full py-2.5 bg-white border border-slate-200 text-[#0090d0] hover:bg-sky-50 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm active:scale-95">
                      Exportar Reportes
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {modalAsignatura && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] border border-black/[0.05]">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight mb-2">Nueva Asignatura</h3>
            <p className="text-sm text-slate-500 mb-6 font-medium">Configura los detalles de la nueva materia.</p>
            <form onSubmit={guardarNuevaAsignatura} className="flex flex-col gap-4">
              <input type="text" placeholder="Nombre (ej. Ingeniería)" value={formAsignatura.nombre} onChange={(e) => setFormAsignatura({...formAsignatura, nombre: e.target.value})} className="w-full p-4 bg-[#F5F5F7] border border-transparent rounded-[1.25rem] focus:outline-none focus:border-[#0090d0] font-medium" required/>
              <input type="text" placeholder="Aula (ej. Aula 2.4)" value={formAsignatura.aula} onChange={(e) => setFormAsignatura({...formAsignatura, aula: e.target.value})} className="w-full p-4 bg-[#F5F5F7] border border-transparent rounded-[1.25rem] focus:outline-none focus:border-[#0090d0] font-medium" required/>
              <input type="text" placeholder="Horario (ej. 09:00 - 11:00)" value={formAsignatura.horario} onChange={(e) => setFormAsignatura({...formAsignatura, horario: e.target.value})} className="w-full p-4 bg-[#F5F5F7] border border-transparent rounded-[1.25rem] focus:outline-none focus:border-[#0090d0] font-medium" required/>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button type="button" onClick={() => setModalAsignatura(false)} className="py-3 rounded-xl text-slate-600 font-semibold hover:bg-slate-50 transition-colors cursor-pointer">Cancelar</button>
                <button type="submit" disabled={guardandoAsig} className="py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-colors disabled:opacity-50 cursor-pointer">{guardandoAsig ? 'Guardando...' : 'Crear'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalEliminarAsig && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] border border-black/[0.05] text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Eliminar Asignatura</h3>
            <p className="text-sm text-slate-500 mt-2 mb-6 font-medium">Esta acción es irreversible. Introduce tu contraseña de docente para confirmar.</p>
            <input type="password" placeholder="Contraseña" value={passConfirm} onChange={(e) => setPassConfirm(e.target.value)} className="w-full p-4 bg-[#F5F5F7] border border-transparent rounded-[1.25rem] mb-6 focus:outline-none focus:border-rose-500 text-center font-medium"/>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { setModalEliminarAsig(null); setPassConfirm(''); }} className="py-3 rounded-xl text-slate-600 font-semibold hover:bg-slate-50 transition-colors cursor-pointer">Cancelar</button>
              <button onClick={confirmarEliminarAsignatura} disabled={cargandoPass || !passConfirm} className="py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-semibold transition-colors disabled:opacity-50 cursor-pointer">{cargandoPass ? 'Borrando...' : 'Eliminar'}</button>
            </div>
          </div>
        </div>
      )}

      {asignaturaSeleccionada && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-lg w-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] border border-black/[0.05] flex flex-col">
            <div className="flex items-center justify-between mb-8 shrink-0">
              <div>
                <h3 className="text-xl font-bold text-slate-900 tracking-tight">{asignaturaSeleccionada.nombre}</h3>
                <p className="text-sm text-slate-500 font-medium mt-1">Exportador Integral de Asistencias</p>
              </div>
              <button onClick={() => setAsignaturaSeleccionada(null)} className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full cursor-pointer transition-colors active:scale-95">✕</button>
            </div>
            
            <div className="bg-slate-50 rounded-[1.5rem] p-6 border border-slate-100">
              <h4 className="font-bold text-slate-800 text-sm mb-4">Filtrar por Periodo (Opcional)</h4>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Desde</label>
                  <input 
                    type="date" 
                    value={fechaInicio} 
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full bg-white px-4 py-3 rounded-xl text-sm font-semibold text-slate-600 border border-transparent focus:outline-none focus:border-[#0090d0] shadow-sm transition-all cursor-pointer"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Hasta</label>
                  <input 
                    type="date" 
                    value={fechaFin} 
                    onChange={(e) => setFechaFin(e.target.value)}
                    className="w-full bg-white px-4 py-3 rounded-xl text-sm font-semibold text-slate-600 border border-transparent focus:outline-none focus:border-[#0090d0] shadow-sm transition-all cursor-pointer"
                  />
                </div>
              </div>

              <p className="text-xs text-slate-500 font-medium mb-6 leading-relaxed">
                El reporte organiza a los alumnos en filas y las fechas de las sesiones impartidas en columnas (Tabla Pivot).
              </p>

              <div className="space-y-3">
                <button 
                  onClick={exportarAGoogleSheets}
                  disabled={cargandoHistorialAsig}
                  className="w-full py-4 bg-[#0090d0] hover:bg-[#007fb8] text-white text-sm font-bold rounded-2xl transition-all shadow-[0_8px_20px_-6px_rgba(0,144,208,0.4)] active:scale-95 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H7v-2h5v2zm5-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                  </svg>
                  {cargandoHistorialAsig ? 'Procesando...' : 'Abrir en Google Sheets'}
                </button>

                <button 
                  onClick={exportarAExcel}
                  disabled={cargandoHistorialAsig}
                  className="w-full py-3.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-2xl transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  Descargar archivo .xlsx (Excel)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
