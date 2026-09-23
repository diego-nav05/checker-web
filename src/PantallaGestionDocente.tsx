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
  const [modalExportadorGlobal, setModalExportadorGlobal] = useState(false);
  const [exportacionBinaria, setExportacionBinaria] = useState(false);
  const [modalExpulsion, setModalExpulsion] = useState<{tipo: 'UNA'|'TODAS', aluId: string, asigId?: string} | null>(null);

  const [fechaInicioGlobal, setFechaInicioGlobal] = useState<string>('');
  const [fechaFinGlobal, setFechaFinGlobal] = useState<string>('');
  const [fechaInicio, setFechaInicio] = useState<string>('');
  const [fechaFin, setFechaFin] = useState<string>('');

  const [editandoAulaId, setEditandoAulaId] = useState<string | null>(null);
  const [aulaTemp, setAulaTemp] = useState<string>('');

  const [alumnoGestion, setAlumnoGestion] = useState<any | null>(null);
  const [asignaturasAlumno, setAsignaturasAlumno] = useState<any[]>([]);
  const [cargandoAlumno, setCargandoAlumno] = useState(false);

  const [notificacion, setNotificacion] = useState<{ texto: string; tipo: 'exito' | 'error' | 'info' } | null>(null);

  const mostrarNotificacion = (texto: string, tipo: 'exito' | 'error' | 'info' = 'info') => {
    setNotificacion({ texto, tipo });
    setTimeout(() => setNotificacion(null), 5000);
  };

  const cargarAlumnos = async () => {
    setCargando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: asigs } = await supabase.from('asignaturas').select('id').eq('profesor_id', user.id);
      if (!asigs || asigs.length === 0) return setAlumnos([]);
      
      const asigIds = asigs.map(a => a.id);
      const { data: sesiones } = await supabase.from('sesiones').select('id').in('asignatura_id', asigIds);
      if (!sesiones || sesiones.length === 0) return setAlumnos([]);
      
      const sesionIds = sesiones.map(s => s.id);
      const { data: asistencias } = await supabase.from('asistencias').select('alumno_id').in('sesion_id', sesionIds);
      if (!asistencias || asistencias.length === 0) return setAlumnos([]);

      const aluIds = [...new Set(asistencias.map(a => a.alumno_id))];

      const { data: perfiles } = await supabase
        .from('perfiles')
        .select('*')
        .in('id', aluIds)
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

  const abrirGestionAlumno = async (alumno: any) => {
    setAlumnoGestion(alumno);
    setCargandoAlumno(true);
    
    const { data: { user } } = await supabase.auth.getUser();
    const { data: asigs } = await supabase.from('asignaturas').select('*').eq('profesor_id', user?.id);

    if (asigs && asigs.length > 0) {
      const asigIds = asigs.map((a: any) => a.id);
      const { data: sesiones } = await supabase.from('sesiones').select('id, asignatura_id').in('asignatura_id', asigIds);

      if (sesiones && sesiones.length > 0) {
        const sesionIds = sesiones.map((s: any) => s.id);
        const { data: asists } = await supabase.from('asistencias').select('sesion_id').eq('alumno_id', alumno.id).in('sesion_id', sesionIds);

        if (asists && asists.length > 0) {
          const attendedSesionIds = asists.map((a: any) => a.sesion_id);
          const attendedAsigIds = [...new Set(sesiones.filter((s: any) => attendedSesionIds.includes(s.id)).map((s: any) => s.asignatura_id))];
          const asigsActivas = asigs.filter((a: any) => attendedAsigIds.includes(a.id));
          setAsignaturasAlumno(asigsActivas);
        } else {
          setAsignaturasAlumno([]);
        }
      } else {
        setAsignaturasAlumno([]);
      }
    }
    setCargandoAlumno(false);
  };

  const desvincularDispositivo = async (id: string) => {
    const confirmar = window.confirm(`¿Seguro que quieres desvincular el móvil de este alumno?`);
    if (!confirmar) return;
    const { error } = await supabase.from('perfiles').update({ dispositivo_hash: null }).eq('id', id);
    if (error) mostrarNotificacion('Error al desvincular.', 'error');
    else {
      mostrarNotificacion('Dispositivo liberado.', 'exito');
      cargarAlumnos();
      if (alumnoGestion) setAlumnoGestion({ ...alumnoGestion, dispositivo_hash: null });
    }
  };

  const expulsarDeAsignatura = (alumnoId: string, asigId: string) => {
    setModalExpulsion({ tipo: 'UNA', aluId: alumnoId, asigId });
  };

  const expulsarDeTodas = (alumnoId: string) => {
    setModalExpulsion({ tipo: 'TODAS', aluId: alumnoId });
  };

  const ejecutarExpulsion = async () => {
    if (!modalExpulsion) return;
    const { tipo, aluId, asigId } = modalExpulsion;
    
    if (tipo === 'UNA' && asigId) {
      const { data: sesiones } = await supabase.from('sesiones').select('id').eq('asignatura_id', asigId);
      if (sesiones && sesiones.length > 0) {
        const sIds = sesiones.map((s: any) => s.id);
        await supabase.from('asistencias')
          .delete()
          .eq('alumno_id', aluId)
          .in('sesion_id', sIds);
      }
      mostrarNotificacion('Alumno eliminado de la materia.', 'exito');
      setAsignaturasAlumno(prev => prev.filter(a => a.id !== asigId));
      if (asignaturasAlumno.length <= 1) setAlumnoGestion(null); 
    } else if (tipo === 'TODAS') {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: asigs } = await supabase.from('asignaturas').select('id').eq('profesor_id', user?.id);
      if (asigs && asigs.length > 0) {
        const asigIds = asigs.map((a: any) => a.id);
        const { data: sesiones } = await supabase.from('sesiones').select('id').in('asignatura_id', asigIds);
        if (sesiones && sesiones.length > 0) {
          const sIds = sesiones.map((s: any) => s.id);
          await supabase.from('asistencias')
            .delete()
            .eq('alumno_id', aluId)
            .in('sesion_id', sIds);
        }
      }
      mostrarNotificacion('Alumno eliminado de todas tus materias.', 'exito');
      setAlumnoGestion(null);
    }
    cargarAlumnos();
    setModalExpulsion(null);
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

  // --- MOTOR PIVOT (Orden Cronológico y Horas Incluidas) ---
  const procesarFechasSesiones = (sesionesDataRaw: any[], asistData: any[]) => {
    return sesionesDataRaw.map(ses => {
      let f = ses.created_at || ses.hora_cierre;
      if (!f) {
        const asistRef = asistData.find(a => a.sesion_id === ses.id && a.hora_entrada);
        f = asistRef ? asistRef.hora_entrada : null;
      }

      let localYMD = '';
      let fechaStr = `Clase sin fecha (${ses.id.substring(0,4)})`;

      if (f) {
        const d = new Date(f);
        const pad = (n: number) => n.toString().padStart(2, '0');
        localYMD = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        fechaStr = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
      }

      return {
        ...ses,
        fechaIso: f || new Date(0).toISOString(),
        fechaYMD: localYMD,
        fechaStr
      };
    });
  };

  const formatTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '--:--';

  const generarMatrizReporte = async () => {
    if (!asignaturaSeleccionada) return null;

    const { data: sesionesDataRaw } = await supabase.from('sesiones').select('*').eq('asignatura_id', asignaturaSeleccionada.id);
    if (!sesionesDataRaw || sesionesDataRaw.length === 0) {
      mostrarNotificacion("La materia no tiene clases registradas.", 'info');
      return null;
    }
    const sesionIds = sesionesDataRaw.map(s => s.id);

    const { data: asistData } = await supabase.from('asistencias').select('*').in('sesion_id', sesionIds);
    if (!asistData || asistData.length === 0) {
      mostrarNotificacion("Ningún alumno ha registrado asistencia.", 'info');
      return null;
    }

    const aluIds = [...new Set(asistData.map(a => a.alumno_id))];
    const { data: perfiles } = await supabase.from('perfiles').select('id, nombre_completo').in('id', aluIds);
    const mapPerfiles: Record<string, string> = {};
    perfiles?.forEach(p => mapPerfiles[p.id] = p.nombre_completo);

    const sesionesConFecha = procesarFechasSesiones(sesionesDataRaw, asistData);

    const sesionesFiltradas = sesionesConFecha.filter(ses => {
      if (fechaInicio && (!ses.fechaYMD || ses.fechaYMD < fechaInicio)) return false;
      if (fechaFin && (!ses.fechaYMD || ses.fechaYMD > fechaFin)) return false;
      return true;
    });

    if (sesionesFiltradas.length === 0) {
      mostrarNotificacion("No hay clases en ese rango de fechas.", 'info');
      return null;
    }

    // ORDENAR CRONOLÓGICAMENTE: De más antigua a más nueva
    sesionesFiltradas.sort((a, b) => new Date(a.fechaIso).getTime() - new Date(b.fechaIso).getTime());

    const reporteAlumnos: Record<string, any> = {};

    aluIds.forEach(aluId => {
      reporteAlumnos[aluId] = { Alumno: mapPerfiles[aluId] || 'Estudiante Desconocido' };
      sesionesFiltradas.forEach(ses => { reporteAlumnos[aluId][ses.fechaStr] = exportacionBinaria ? 0 : 'AUSENTE'; });
    });

    asistData.forEach(asist => {
      const sesion = sesionesFiltradas.find(s => s.id === asist.sesion_id);
      if (sesion && reporteAlumnos[asist.alumno_id]) {
        if (exportacionBinaria) {
          const st = asist.estado?.toUpperCase() || '';
          if (st.includes('AUSENTE') || st.includes('INJUSTIFICADA') || st === 'FALTA') {
            reporteAlumnos[asist.alumno_id][sesion.fechaStr] = 0;
          } else {
            reporteAlumnos[asist.alumno_id][sesion.fechaStr] = 1;
          }
        } else {
          const inTime = formatTime(asist.hora_entrada);
          const outTime = formatTime(asist.hora_salida);
          const estadoLimpio = asist.estado.replace(/_/g, ' ');
          reporteAlumnos[asist.alumno_id][sesion.fechaStr] = `${estadoLimpio} (In: ${inTime} | Out: ${outTime})`;
        }
      }
    });

    const filas = Object.values(reporteAlumnos).sort((a: any, b: any) => a.Alumno.localeCompare(b.Alumno));
    return { filas };
  };

  const exportarAExcel = async () => {
    setCargandoHistorialAsig(true);
    try {
      const data = await generarMatrizReporte();
      if (!data || data.filas.length === 0) return;

      const libro = XLSX.utils.book_new();
      const hoja = XLSX.utils.json_to_sheet(data.filas);
      XLSX.utils.book_append_sheet(libro, hoja, 'Asistencias');
      
      const nombreClaseLimpiado = asignaturaSeleccionada.nombre.replace(/[/\\?%*:|"<>]/g, '-');
      XLSX.writeFile(libro, `${nombreClaseLimpiado}.xlsx`);
      
      mostrarNotificacion(`Excel de ${nombreClaseLimpiado} descargado.`, 'exito');
    } catch {
      mostrarNotificacion('Error generando el archivo.', 'error');
    } finally {
      setCargandoHistorialAsig(false);
    }
  };

  const exportarAGoogleSheets = async () => {
    setCargandoHistorialAsig(true);
    try {
      const data = await generarMatrizReporte();
      if (!data || data.filas.length === 0) return;

      const cabeceras = Object.keys(data.filas[0]);
      const lineasTSV = [
        cabeceras.join('\t'),
        ...data.filas.map((fila) => cabeceras.map((campo) => `${fila[campo] ?? ''}`).join('\t'))
      ].join('\n');

      const textArea = document.createElement("textarea");
      textArea.value = lineasTSV;
      textArea.style.position = "fixed";
      textArea.style.top = "50%";
      textArea.style.left = "50%";
      textArea.style.width = "10px";
      textArea.style.height = "10px";
      textArea.style.opacity = "0.01";
      document.body.appendChild(textArea);
      
      textArea.focus();
      textArea.select();

      let exito = false;
      try {
        exito = document.execCommand('copy');
      } catch (err) {}
      document.body.removeChild(textArea);

      if (!exito && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(lineasTSV);
          exito = true;
        } catch (e) {}
      }

      if (exito) {
        mostrarNotificacion('¡Datos en el portapapeles! Abriendo Sheets...', 'exito');
        setTimeout(() => {
          window.open('https://sheets.new', '_blank');
        }, 1200);
      } else {
        mostrarNotificacion('Tu navegador bloquea el portapapeles. Usa descargar Excel.', 'error');
      }

    } catch (e) {
      mostrarNotificacion('Error procesando los datos.', 'error');
    } finally {
      setCargandoHistorialAsig(false);
    }
  };

  const generarDatosGlobales = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: asigs } = await supabase.from('asignaturas').select('*').eq('profesor_id', user.id);
    if (!asigs || asigs.length === 0) {
      mostrarNotificacion('No tienes asignaturas registradas.', 'error');
      return null;
    }

    const asigIds = asigs.map(a => a.id);
    const { data: sesiones } = await supabase.from('sesiones').select('*').in('asignatura_id', asigIds);
    if (!sesiones || sesiones.length === 0) {
      mostrarNotificacion('Ninguna clase ha sido registrada aún.', 'info');
      return null;
    }

    const sesionIds = sesiones.map(s => s.id);
    const { data: asistencias } = await supabase.from('asistencias').select('*').in('sesion_id', sesionIds);
    if (!asistencias || asistencias.length === 0) {
      mostrarNotificacion('No hay asistencias registradas.', 'info');
      return null;
    }

    const aluIds = [...new Set(asistencias.map(a => a.alumno_id))];
    const { data: perfiles } = await supabase.from('perfiles').select('id, nombre_completo').in('id', aluIds);
    const mapPerfiles: Record<string, string> = {};
    perfiles?.forEach(p => mapPerfiles[p.id] = p.nombre_completo);

    const resultadosGlobales: { nombre: string, filas: any[] }[] = [];

    asigs.forEach(asig => {
      const sesAsig = sesiones.filter(s => s.asignatura_id === asig.id);
      if (sesAsig.length === 0) return;

      const sesionesConFecha = procesarFechasSesiones(sesAsig, asistencias);

      const sesionesFiltradas = sesionesConFecha.filter(ses => {
        if (fechaInicioGlobal && (!ses.fechaYMD || ses.fechaYMD < fechaInicioGlobal)) return false;
        if (fechaFinGlobal && (!ses.fechaYMD || ses.fechaYMD > fechaFinGlobal)) return false;
        return true;
      });

      if (sesionesFiltradas.length === 0) return;

      // ORDENAR CRONOLÓGICAMENTE: De más antigua a más nueva
      sesionesFiltradas.sort((a, b) => new Date(a.fechaIso).getTime() - new Date(b.fechaIso).getTime());

      const asistsDeEstaAsig = asistencias.filter(a => sesionesFiltradas.some(s => s.id === a.sesion_id));
      if (asistsDeEstaAsig.length === 0) return;

      const reporte: Record<string, any> = {};
      const alumnosEnEstaAsig = [...new Set(asistsDeEstaAsig.map(a => a.alumno_id))];

      alumnosEnEstaAsig.forEach(idAlu => {
        reporte[idAlu] = { Alumno: mapPerfiles[idAlu] || 'Estudiante Desconocido' };
        sesionesFiltradas.forEach(ses => { reporte[idAlu][ses.fechaStr] = exportacionBinaria ? 0 : 'AUSENTE'; });
      });

      asistsDeEstaAsig.forEach(a => {
        const sesion = sesionesFiltradas.find(s => s.id === a.sesion_id);
        if (sesion && reporte[a.alumno_id]) {
          if (exportacionBinaria) {
            const st = a.estado?.toUpperCase() || '';
            if (st.includes('AUSENTE') || st.includes('INJUSTIFICADA') || st === 'FALTA') {
              reporte[a.alumno_id][sesion.fechaStr] = 0;
            } else {
              reporte[a.alumno_id][sesion.fechaStr] = 1;
            }
          } else {
            const inTime = formatTime(a.hora_entrada);
            const outTime = formatTime(a.hora_salida);
            const estadoLimpio = a.estado.replace(/_/g, ' ');
            reporte[a.alumno_id][sesion.fechaStr] = `${estadoLimpio} (In: ${inTime} | Out: ${outTime})`;
          }
        }
      });

      const filas = Object.values(reporte).sort((a: any, b: any) => a.Alumno.localeCompare(b.Alumno));
      if (filas.length > 0) {
        resultadosGlobales.push({ nombre: asig.nombre, filas });
      }
    });

    if (resultadosGlobales.length === 0) {
      mostrarNotificacion('No hay clases en ese rango de fechas para ninguna materia.', 'info');
      return null;
    }

    return resultadosGlobales;
  };

  const exportarGlobalExcel = async () => {
    setCargandoHistorialAsig(true);
    try {
      const datos = await generarDatosGlobales();
      if (!datos || datos.length === 0) return;

      const libro = XLSX.utils.book_new();
      datos.forEach(asig => {
        const hoja = XLSX.utils.json_to_sheet(asig.filas);
        XLSX.utils.book_append_sheet(libro, hoja, asig.nombre.substring(0, 31));
      });
      
      XLSX.writeFile(libro, `Reporte_Global_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);
      mostrarNotificacion('Descarga completada.', 'exito');
      setModalExportadorGlobal(false);
    } catch {
      mostrarNotificacion('Error durante la exportación a Excel.', 'error');
    } finally {
      setCargandoHistorialAsig(false);
    }
  };

  const exportarGlobalSheets = async () => {
    setCargandoHistorialAsig(true);
    try {
      const datos = await generarDatosGlobales();
      if (!datos || datos.length === 0) return;

      let lineasTSV = "";

      datos.forEach((asig, index) => {
        if (index > 0) lineasTSV += "\n\n"; 
        lineasTSV += `[ MATERIA: ${asig.nombre.toUpperCase()} ]\n`;
        const cabeceras = Object.keys(asig.filas[0]);
        lineasTSV += cabeceras.join('\t') + '\n';
        lineasTSV += asig.filas.map(fila => cabeceras.map(campo => `${fila[campo] ?? ''}`).join('\t')).join('\n');
      });

      const textArea = document.createElement("textarea");
      textArea.value = lineasTSV;
      textArea.style.position = "fixed";
      textArea.style.top = "50%";
      textArea.style.left = "50%";
      textArea.style.width = "10px";
      textArea.style.height = "10px";
      textArea.style.opacity = "0.01";
      document.body.appendChild(textArea);
      
      textArea.focus();
      textArea.select();

      let exito = false;
      try { exito = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(textArea);

      if (!exito && navigator.clipboard) {
        try { await navigator.clipboard.writeText(lineasTSV); exito = true; } catch (e) {}
      }

      if (exito) {
        mostrarNotificacion('¡Datos en el portapapeles! Abriendo Sheets...', 'exito');
        setModalExportadorGlobal(false);
        setTimeout(() => {
          window.open('https://sheets.new', '_blank');
        }, 1200);
      } else {
        mostrarNotificacion('Tu navegador bloquea el copiado. Usa descargar Excel.', 'error');
      }

    } catch (e) {
      mostrarNotificacion('Error procesando los datos.', 'error');
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
              <h2 className="text-2xl font-black text-[#002b5c] tracking-tight">Estudiantes Inscritos</h2>
              <span className="bg-[#0090d0]/10 text-[#0090d0] px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider">{alumnos.length} Registros</span>
            </div>

            {cargando ? (
              <div className="flex justify-center py-12 text-slate-400 font-medium animate-pulse">Sincronizando...</div>
            ) : alumnos.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm font-medium">No hay alumnos vinculados a tus clases.</div>
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
                    <button onClick={() => abrirGestionAlumno(alumno)} className="shrink-0 px-4 py-2.5 bg-slate-50 text-[#002b5c] hover:text-white hover:bg-[#0090d0] text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95 shadow-sm">
                      Gestionar
                    </button>
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
                <button 
                  onClick={() => {
                    setModalExportadorGlobal(true);
                    setFechaInicioGlobal('');
                    setFechaFinGlobal('');
                  }} 
                  className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-full text-xs font-bold shadow-md transition-all cursor-pointer active:scale-95"
                >
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

      {/* --- MODAL: EXPORTADOR GLOBAL --- */}
      {modalExportadorGlobal && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white/90 backdrop-blur-3xl rounded-[3rem] p-8 max-w-md w-full shadow-2xl border border-white/60 flex flex-col">
            <div className="flex items-center justify-between mb-8 shrink-0">
              <div>
                <h3 className="text-xl font-black text-[#002b5c] tracking-tight">Exportación Global</h3>
                <p className="text-xs text-slate-500 font-semibold mt-1">Descarga todas tus asignaturas</p>
              </div>
              <button onClick={() => setModalExportadorGlobal(false)} className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full cursor-pointer transition-colors active:scale-95">✕</button>
            </div>
            
            <div className="bg-slate-50/80 rounded-[2rem] p-6">
              <h4 className="font-bold text-[#002b5c] text-xs uppercase tracking-wider mb-4">Filtrar Fechas (Opcional)</h4>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <input type="date" value={fechaInicioGlobal} onChange={(e) => setFechaInicioGlobal(e.target.value)} className="w-full bg-white px-4 py-3 rounded-2xl text-xs font-semibold text-slate-600 border border-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 shadow-sm transition-all cursor-pointer"/>
                </div>
                <div>
                  <input type="date" value={fechaFinGlobal} onChange={(e) => setFechaFinGlobal(e.target.value)} className="w-full bg-white px-4 py-3 rounded-2xl text-xs font-semibold text-slate-600 border border-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 shadow-sm transition-all cursor-pointer"/>
                </div>
              </div>

              <div className="mb-6 flex items-center gap-3 bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer shadow-sm hover:shadow-md transition-all active:scale-[0.98]" onClick={() => setExportacionBinaria(!exportacionBinaria)}>
                <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${exportacionBinaria ? 'bg-[#0090d0] border-[#0090d0]' : 'border-slate-300 bg-slate-50'}`}>
                  {exportacionBinaria && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                </div>
                <div>
                  <p className="text-sm font-bold text-[#002b5c]">Exportar forma simplificada en binario</p>
                </div>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={exportarGlobalSheets}
                  disabled={cargandoHistorialAsig}
                  className="w-full py-4 bg-[#0090d0] hover:bg-[#007fb8] text-white text-sm font-bold rounded-2xl transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {cargandoHistorialAsig ? 'Procesando...' : 'Copiar para Google Sheets'}
                </button>

                <button 
                  onClick={exportarGlobalExcel}
                  disabled={cargandoHistorialAsig}
                  className="w-full py-3.5 bg-white text-[#002b5c] border border-slate-100 hover:bg-slate-50 text-xs font-bold rounded-2xl transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {cargandoHistorialAsig ? 'Procesando...' : 'Descargar Excel (.xlsx)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: GESTIÓN DE ALUMNO --- */}
      {alumnoGestion && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white/90 backdrop-blur-3xl rounded-[3rem] p-8 max-w-md w-full shadow-2xl border border-white/60 flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-xl font-black text-[#002b5c] tracking-tight truncate pr-4">{alumnoGestion.nombre_completo}</h3>
                <p className="text-xs text-slate-500 font-semibold mt-1">{alumnoGestion.email}</p>
              </div>
              <button onClick={() => setAlumnoGestion(null)} className="w-8 h-8 flex shrink-0 items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full cursor-pointer transition-colors active:scale-95">✕</button>
            </div>

            <div className="space-y-6 overflow-y-auto max-h-[60vh] pr-2">
              <div className="bg-slate-50/80 rounded-[2rem] p-5">
                <h4 className="font-bold text-[#002b5c] text-xs uppercase tracking-wider mb-4">Dispositivo de Fichaje</h4>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${alumnoGestion.dispositivo_hash ? 'bg-emerald-400' : 'bg-slate-300'}`}></span>
                    <span className="text-xs font-bold text-slate-600">{alumnoGestion.dispositivo_hash ? 'Móvil Vinculado' : 'Sin Vincular'}</span>
                  </div>
                  <button 
                    onClick={() => desvincularDispositivo(alumnoGestion.id)} 
                    disabled={!alumnoGestion.dispositivo_hash}
                    className="px-4 py-2 bg-white text-rose-500 hover:bg-rose-50 text-xs font-bold rounded-xl border border-slate-200 shadow-sm transition-all disabled:opacity-50"
                  >
                    Desvincular
                  </button>
                </div>
              </div>

              <div className="bg-slate-50/80 rounded-[2rem] p-5">
                <h4 className="font-bold text-[#002b5c] text-xs uppercase tracking-wider mb-4">Matriculado en tus materias</h4>
                {cargandoAlumno ? (
                  <div className="text-xs text-slate-400 animate-pulse">Buscando materias...</div>
                ) : asignaturasAlumno.length === 0 ? (
                  <div className="text-xs text-slate-400">No hay registros del alumno en tus clases.</div>
                ) : (
                  <div className="space-y-3">
                    {asignaturasAlumno.map(asig => (
                      <div key={asig.id} className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-100">
                        <span className="text-xs font-bold text-[#002b5c] truncate pr-2">{asig.nombre}</span>
                        <button onClick={() => expulsarDeAsignatura(alumnoGestion.id, asig.id)} className="shrink-0 px-3 py-1.5 bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-colors">
                          Expulsar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button 
                onClick={() => expulsarDeTodas(alumnoGestion.id)}
                className="w-full py-4 bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold rounded-2xl transition-all shadow-md active:scale-95"
              >
                Expulsar de TODAS mis materias
              </button>

            </div>
          </div>
        </div>
      )}

      {/* --- OTROS MODALES (Crear, Eliminar, Exportar Individual) --- */}
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
              </div>
              <button onClick={() => setAsignaturaSeleccionada(null)} className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full cursor-pointer transition-colors active:scale-95">✕</button>
            </div>
            
            <div className="bg-slate-50/80 rounded-[2rem] p-6">
              <h4 className="font-bold text-[#002b5c] text-xs uppercase tracking-wider mb-4">Filtrar Fechas (Opcional)</h4>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="w-full bg-white px-4 py-3 rounded-2xl text-xs font-semibold text-slate-600 border border-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 shadow-sm transition-all cursor-pointer"/>
                </div>
                <div>
                  <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className="w-full bg-white px-4 py-3 rounded-2xl text-xs font-semibold text-slate-600 border border-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 shadow-sm transition-all cursor-pointer"/>
                </div>
              </div>

              <div className="mb-6 flex items-center gap-3 bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer shadow-sm hover:shadow-md transition-all active:scale-[0.98]" onClick={() => setExportacionBinaria(!exportacionBinaria)}>
                <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${exportacionBinaria ? 'bg-[#0090d0] border-[#0090d0]' : 'border-slate-300 bg-slate-50'}`}>
                  {exportacionBinaria && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                </div>
                <div>
                  <p className="text-sm font-bold text-[#002b5c]">Exportar forma simplificada en binario</p>
                </div>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={exportarAGoogleSheets}
                  disabled={cargandoHistorialAsig}
                  className="w-full py-4 bg-[#0090d0] hover:bg-[#007fb8] text-white text-sm font-bold rounded-2xl transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {cargandoHistorialAsig ? 'Procesando...' : 'Abrir en Google Sheets'}
                </button>

                <button 
                  onClick={exportarAExcel}
                  disabled={cargandoHistorialAsig}
                  className="w-full py-3.5 bg-white text-[#002b5c] border border-slate-100 hover:bg-slate-50 text-xs font-bold rounded-2xl transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {cargandoHistorialAsig ? 'Procesando...' : 'Descargar Excel (.xlsx)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: CONFIRMAR EXPULSIÓN --- */}
      {modalExpulsion && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-[100] animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl text-center border border-rose-100">
            <div className="w-16 h-16 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-2">
              {modalExpulsion.tipo === 'UNA' ? 'Expulsar de la materia' : 'Expulsar de todas las materias'}
            </h3>
            <p className="text-sm text-slate-500 font-medium mb-6">
              Esta acción eliminará <strong className="text-rose-500">todos los registros de asistencia</strong> de este alumno en las asignaturas afectadas.<br/><br/>
              Si quieres conservar los datos, por favor, cierra esta ventana y <strong className="text-[#002b5c]">descarga un reporte</strong> (Excel o Sheets) antes de continuar.
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={() => setModalExpulsion(null)} className="py-3.5 rounded-2xl text-slate-500 text-sm font-bold bg-slate-100 hover:bg-slate-200 active:scale-95 cursor-pointer transition-all">Cancelar y volver</button>
              <button onClick={ejecutarExpulsion} className="py-3.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold active:scale-95 shadow-md shadow-rose-500/20 cursor-pointer transition-all">Lo entiendo, borrar datos</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
