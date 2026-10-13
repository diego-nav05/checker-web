import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import * as XLSX from 'xlsx';
import BotonCompartir from './BotonCompartir';
import { AvisoFlotante, useAviso } from './Aviso';
import { altaAlumno, mensajeError, tieneCorreoReal, type ResultadoAlta } from './cuentas';

const COLUMNAS_SESION = 'id, asignatura_id, fecha, fase, hora_apertura, hora_cierre';
const estaVinculado = (alumno: any) => !!(alumno?.dispositivo_hash || alumno?.dispositivo_id || alumno?.vinculado);

interface Props {
  onVolver: () => void;
}

type TabGestion = 'ALUMNOS' | 'ASIGNATURAS';

const obtenerClaveOrden = (nombreCompleto: string | undefined | null, porApellido: boolean) => {
  if (!nombreCompleto) return '';
  const str = nombreCompleto.trim().toLowerCase();
  if (!porApellido) return str;
  
  const partes = str.split(/\s+/);
  if (partes.length <= 1) return str;
  
  if (partes.length >= 3) {
    const apellidos = partes.slice(-2).join(' ');
    const nombre = partes.slice(0, -2).join(' ');
    return `${apellidos} ${nombre}`;
  } else {
    return `${partes[1]} ${partes[0]}`;
  }
};

export default function PantallaGestionDocente({ onVolver }: Props) {
  const [tabActual, setTabActual] = useState<TabGestion>('ALUMNOS');
  const [cargando, setCargando] = useState(true);
  
  const [alumnos, setAlumnos] = useState<any[]>([]);
  const [asignaturas, setAsignaturas] = useState<any[]>([]);
  const [modalAsignatura, setModalAsignatura] = useState(false);
  const [formAsignatura, setFormAsignatura] = useState({ nombre: '', aula: '', horario: '', dias_semana: [] as number[] });
  const [guardandoAsig, setGuardandoAsig] = useState(false);

  const [modalEliminarAsig, setModalEliminarAsig] = useState<string | null>(null);
  const [passConfirm, setPassConfirm] = useState('');
  const [cargandoPass, setCargandoPass] = useState(false);

  const [asignaturaSeleccionada, setAsignaturaSeleccionada] = useState<any | null>(null);
  const [cargandoHistorialAsig, setCargandoHistorialAsig] = useState(false);
  const [modalExportadorGlobal, setModalExportadorGlobal] = useState(false);
  const [exportacionBinaria, setExportacionBinaria] = useState(false);
  const [ordenarPorApellido, setOrdenarPorApellido] = useState(true);
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

  const { aviso, avisar: mostrarNotificacion, cerrar: cerrarAviso } = useAviso();

  // Alumnos con cuenta que no están en ninguna clase (de ningún profe)
  const [alumnosSinClase, setAlumnosSinClase] = useState<any[]>([]);
  const [misAsignaturas, setMisAsignaturas] = useState<{ id: string; nombre: string }[]>([]);
  // Alta forzosa de alumnos
  const [modalAlta, setModalAlta] = useState(false);
  const [formAlta, setFormAlta] = useState({ nombre: '', email: '', asignatura_id: '' });
  const [guardandoAlta, setGuardandoAlta] = useState(false);
  const [resultadoAlta, setResultadoAlta] = useState<ResultadoAlta | null>(null);
  const [asignandoClase, setAsignandoClase] = useState<{ alumno: any; asignatura_id: string } | null>(null);

  const cargarAlumnos = async () => {
    setCargando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: sinClase } = await supabase.rpc('alumnos_sin_clase');
      setAlumnosSinClase(sinClase || []);

      const { data: asigs } = await supabase.from('asignaturas').select('id, nombre').eq('profesor_id', user.id).order('nombre', { ascending: true });
      setMisAsignaturas(asigs || []);
      if (!asigs || asigs.length === 0) return setAlumnos([]);

      // Alumnos de mis clases = matriculados + los que tienen alguna asistencia
      const asigIds = asigs.map(a => a.id);
      const { data: matriculas } = await supabase.from('matriculas').select('alumno_id, asignatura_id').in('asignatura_id', asigIds);
      const { data: sesiones } = await supabase.from('sesiones').select('id, asignatura_id, fase').in('asignatura_id', asigIds);
      const sesionIds = (sesiones || []).map(s => s.id);
      const sesionesCerradas = new Set((sesiones || []).filter(s => s.fase === 'CERRADA').map(s => s.id));
      const { data: asistencias } = sesionIds.length > 0
        ? await supabase.from('asistencias').select('alumno_id, sesion_id, estado').in('sesion_id', sesionIds)
        : { data: [] as { alumno_id: string; sesion_id: string; estado: string }[] };

      const aluIds = [...new Set([...(matriculas || []), ...(asistencias || [])].map(a => a.alumno_id))];
      if (aluIds.length === 0) return setAlumnos([]);

      const { data: perfiles } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, email, rol, dispositivo_hash, dispositivo_id, pendiente, codigo_alta')
        .in('id', aluIds)
        .eq('rol', 'alumno')
        .order('nombre_completo', { ascending: true });
      if (perfiles) {
        const perfilesConStats = perfiles.map(perfil => {
          // Las clases aún abiertas no cuentan: el alumno todavía puede escanear
          const asistsAlumno = (asistencias || []).filter(a => a.alumno_id === perfil.id && sesionesCerradas.has(a.sesion_id));
          // Solo cuentan las clases en las que el alumno ya estaba en la lista (no las anteriores a su alta)
          const totalSesionesPosibles = asistsAlumno.length;
          
          const asistenciasValidas = asistsAlumno.filter(a => {
            const st = a.estado?.toUpperCase() || '';
            return !(st.includes('AUSENTE') || st.includes('INJUSTIFICADA') || st === 'FALTA');
          }).length;
          
          const faltas = totalSesionesPosibles - asistenciasValidas;
          const porcentajeFaltas = totalSesionesPosibles > 0 ? Math.round((faltas / totalSesionesPosibles) * 100) : 0;
          
          return {
            ...perfil,
            statsFaltas: {
              faltas,
              total: totalSesionesPosibles,
              porcentaje: porcentajeFaltas
            }
          };
        });
        setAlumnos(perfilesConStats);
      }
    } finally {
      setCargando(false);
    }
  };

  const abrirModalAlta = () => {
    setFormAlta({ nombre: '', email: '', asignatura_id: misAsignaturas[0]?.id || '' });
    setResultadoAlta(null);
    setModalAlta(true);
  };

  const guardarAlta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formAlta.asignatura_id) return mostrarNotificacion('Primero crea una asignatura en la pestaña "Asignaturas".', 'error');
    setGuardandoAlta(true);
    try {
      const resultado = await altaAlumno({
        nombre: formAlta.nombre,
        email: formAlta.email.trim() || undefined,
        asignatura_id: formAlta.asignatura_id,
      });
      setResultadoAlta(resultado);
      cargarAlumnos();
    } catch (error: any) {
      mostrarNotificacion(mensajeError(error.message), 'error');
    } finally {
      setGuardandoAlta(false);
    }
  };

  // Mete en una de mis asignaturas a un alumno que ya tiene cuenta (desde la lista "sin clase")
  const confirmarAsignarClase = async () => {
    if (!asignandoClase?.asignatura_id) return;
    const { alumno, asignatura_id } = asignandoClase;
    const { error } = await supabase.from('matriculas').upsert({ asignatura_id, alumno_id: alumno.id }, { onConflict: 'asignatura_id,alumno_id', ignoreDuplicates: true });
    if (error) return mostrarNotificacion('No se pudo añadir el alumno a la asignatura.', 'error');
    // Si hay una clase abierta de esa asignatura, aparece ya en la lista
    const { data: abiertas } = await supabase.from('sesiones').select('id').eq('asignatura_id', asignatura_id).in('fase', ['ENTRADA', 'SALIDA']);
    if (abiertas && abiertas.length > 0) {
      await supabase.from('asistencias').upsert(
        abiertas.map(s => ({ sesion_id: s.id, alumno_id: alumno.id, estado: 'FALTA_INJUSTIFICADA', manual: false })),
        { onConflict: 'sesion_id,alumno_id', ignoreDuplicates: true },
      );
    }
    const nombreAsig = misAsignaturas.find(a => a.id === asignatura_id)?.nombre || 'la asignatura';
    mostrarNotificacion(`${alumno.nombre_completo} añadido a ${nombreAsig}.`, 'exito');
    setAsignandoClase(null);
    cargarAlumnos();
  };

  const copiarCodigo = async (codigo: string) => {
    try {
      await navigator.clipboard.writeText(codigo);
      mostrarNotificacion('Código copiado.', 'exito');
    } catch {
      mostrarNotificacion(`Apunta el código: ${codigo}`, 'info');
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
      const { data: matriculas } = await supabase.from('matriculas').select('asignatura_id').eq('alumno_id', alumno.id).in('asignatura_id', asigIds);
      const { data: sesiones } = await supabase.from('sesiones').select('id, asignatura_id').in('asignatura_id', asigIds);
      let asigIdsAsistidas: string[] = [];
      if (sesiones && sesiones.length > 0) {
        const { data: asists } = await supabase.from('asistencias').select('sesion_id').eq('alumno_id', alumno.id).in('sesion_id', sesiones.map((s: any) => s.id));
        const attendedSesionIds = (asists || []).map((a: any) => a.sesion_id);
        asigIdsAsistidas = sesiones.filter((s: any) => attendedSesionIds.includes(s.id)).map((s: any) => s.asignatura_id);
      }
      const asigIdsAlumno = new Set([...(matriculas || []).map(m => m.asignatura_id), ...asigIdsAsistidas]);
      setAsignaturasAlumno(asigs.filter((a: any) => asigIdsAlumno.has(a.id)));
    } else {
      setAsignaturasAlumno([]);
    }
    setCargandoAlumno(false);
  };

  const [alumnoALiberar, setAlumnoALiberar] = useState<any | null>(null);
  const desvincularDispositivo = (alumno: any) => setAlumnoALiberar(alumno);

  const confirmarLiberarMovil = async () => {
    const alumno = alumnoALiberar;
    if (!alumno) return;
    setAlumnoALiberar(null);
    const { error } = await supabase.rpc('desvincular_dispositivo', { p_alumno: alumno.id });
    if (error) mostrarNotificacion('Error al desvincular. Inténtalo de nuevo.', 'error');
    else {
      mostrarNotificacion(`Móvil liberado. ${alumno.nombre_completo} ya puede iniciar sesión desde su nuevo dispositivo.`, 'exito');
      cargarAlumnos();
      if (alumnoGestion?.id === alumno.id) setAlumnoGestion({ ...alumnoGestion, dispositivo_hash: null, dispositivo_id: null, vinculado: false });
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
      await supabase.from('matriculas').delete().eq('alumno_id', aluId).eq('asignatura_id', asigId);
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
        await supabase.from('matriculas').delete().eq('alumno_id', aluId).in('asignatura_id', asigIds);
      }
      mostrarNotificacion('Alumno eliminado de todas tus materias.', 'exito');
      setAlumnoGestion(null);
    }
    cargarAlumnos();
    setModalExpulsion(null);
  };

  const toggleDiaSemana = (dia: number) => {
    setFormAsignatura(prev => {
      const dias = prev.dias_semana.includes(dia) 
        ? prev.dias_semana.filter(d => d !== dia) 
        : [...prev.dias_semana, dia];
      return { ...prev, dias_semana: dias };
    });
  };

  const guardarNuevaAsignatura = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardandoAsig(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('asignaturas').insert([{ 
      nombre: formAsignatura.nombre, 
      aula: formAsignatura.aula, 
      horario: formAsignatura.horario, 
      profesor_id: user?.id,
      dias_semana: formAsignatura.dias_semana
    }]);
    setGuardandoAsig(false);
    if (error) mostrarNotificacion('Error al crear asignatura.', 'error');
    else { 
      setFormAsignatura({ nombre: '', aula: '', horario: '', dias_semana: [] }); 
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
        fechaStr = `${d.toLocaleDateString('es-ES')} ${d.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' })}`;
      }

      return {
        ...ses,
        fechaIso: f || new Date(0).toISOString(),
        fechaYMD: localYMD,
        fechaStr
      };
    });
  };

  const formatTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' }) : '--:--';

  const generarMatrizReporte = async () => {
    if (!asignaturaSeleccionada) return null;

    const { data: sesionesDataRaw } = await supabase.from('sesiones').select(COLUMNAS_SESION).eq('asignatura_id', asignaturaSeleccionada.id);
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
    const totalSesiones = sesionesFiltradas.length;

    aluIds.forEach(aluId => {
      reporteAlumnos[aluId] = { Alumno: mapPerfiles[aluId] || 'Estudiante Desconocido', '% Faltas': '' };
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

    if (totalSesiones > 0) {
      Object.keys(reporteAlumnos).forEach(aluId => {
        let faltas = 0;
        sesionesFiltradas.forEach(ses => {
           const val = reporteAlumnos[aluId][ses.fechaStr];
           if (val === 0 || (typeof val === 'string' && (val.includes('AUSENTE') || val.includes('INJUSTIFICADA') || val === 'FALTA'))) {
              faltas++;
           }
        });
        const porcentaje = Math.round((faltas / totalSesiones) * 100);
        reporteAlumnos[aluId]['% Faltas'] = `${porcentaje}% (${faltas}/${totalSesiones})`;
      });
    }

    const filas = Object.values(reporteAlumnos).sort((a: any, b: any) => 
      obtenerClaveOrden(a.Alumno, ordenarPorApellido).localeCompare(obtenerClaveOrden(b.Alumno, ordenarPorApellido))
    );
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
    const { data: sesiones } = await supabase.from('sesiones').select(COLUMNAS_SESION).in('asignatura_id', asigIds);
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
      const totalSesionesAsig = sesionesFiltradas.length;
      const alumnosEnEstaAsig = [...new Set(asistsDeEstaAsig.map(a => a.alumno_id))];

      alumnosEnEstaAsig.forEach(idAlu => {
        reporte[idAlu] = { Alumno: mapPerfiles[idAlu] || 'Estudiante Desconocido', '% Faltas': '' };
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

      if (totalSesionesAsig > 0) {
        Object.keys(reporte).forEach(idAlu => {
          let faltas = 0;
          sesionesFiltradas.forEach(ses => {
             const val = reporte[idAlu][ses.fechaStr];
             if (val === 0 || (typeof val === 'string' && (val.includes('AUSENTE') || val.includes('INJUSTIFICADA') || val === 'FALTA'))) {
                faltas++;
             }
          });
          const porcentaje = Math.round((faltas / totalSesionesAsig) * 100);
          reporte[idAlu]['% Faltas'] = `${porcentaje}% (${faltas}/${totalSesionesAsig})`;
        });
      }

      const filas = Object.values(reporte).sort((a: any, b: any) => 
        obtenerClaveOrden(a.Alumno, ordenarPorApellido).localeCompare(obtenerClaveOrden(b.Alumno, ordenarPorApellido))
      );
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
      
      XLSX.writeFile(libro, `Reporte_Global_${new Date().toLocaleDateString('es-ES').replace(/\//g, '-')}.xlsx`);
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

  const toggleDiaDirecto = async (asig: any, diaId: number) => {
    const diasActuales = asig.dias_semana || [];
    const nuevosDias = diasActuales.includes(diaId)
      ? diasActuales.filter((d: number) => d !== diaId)
      : [...diasActuales, diaId];

    setAsignaturas(prev => prev.map(a => a.id === asig.id ? { ...a, dias_semana: nuevosDias } : a));

    const { error } = await supabase.from('asignaturas').update({ dias_semana: nuevosDias }).eq('id', asig.id);
    if (error) {
      mostrarNotificacion('Error actualizando días.', 'error');
      cargarAsignaturas();
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F5F5F9] p-4 sm:p-8 flex flex-col font-sans selection:bg-[#0090d0] selection:text-white relative overflow-hidden">
      <div className="glow-blob"></div>

      <AvisoFlotante aviso={aviso} onCerrar={cerrarAviso} />

      <div className="flex items-center justify-between glass-container px-6 py-4 rounded-[2.5rem] mb-8 max-w-5xl mx-auto w-full animate-[fade-in_0.4s_ease-out]">
        <div className="flex items-center gap-4">
          <button onClick={onVolver} className="flex items-center justify-center w-11 h-11 bg-white hover:bg-slate-50 border border-slate-100/80 rounded-full text-slate-500 shadow-sm transition-all duration-300 hover:shadow-md cursor-pointer active:scale-90">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-xl font-black text-[#002b5c] tracking-tight leading-tight">Gestión Docente</h1>
            <p className="text-xs font-semibold text-slate-400">Panel Global</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col gap-6 animate-[fade-in_0.4s_ease-out]">
        
        <div className="flex glass-container p-1.5 rounded-full max-w-xs mx-auto w-full">
          <button onClick={() => setTabActual('ALUMNOS')} className={`flex-1 py-3 text-xs font-bold rounded-full transition-all cursor-pointer ${tabActual === 'ALUMNOS' ? 'bg-[#002b5c] text-white shadow-md' : 'text-slate-500 hover:text-[#002b5c]'}`}>Alumnado</button>
          <button onClick={() => setTabActual('ASIGNATURAS')} className={`flex-1 py-3 text-xs font-bold rounded-full transition-all cursor-pointer ${tabActual === 'ASIGNATURAS' ? 'bg-[#002b5c] text-white shadow-md' : 'text-slate-500 hover:text-[#002b5c]'}`}>Asignaturas</button>
        </div>

        {tabActual === 'ALUMNOS' && (
          <div className="glass-container rounded-[2.5rem] p-8 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 px-2 gap-4">
              <div>
                <h2 className="text-2xl font-black text-[#002b5c] tracking-tight">Estudiantes Inscritos</h2>
                <p className="text-xs font-semibold text-slate-400 mt-1">{alumnos.length} en tus clases</p>
              </div>
              <button onClick={abrirModalAlta} className="bg-[#002b5c] hover:bg-[#0090d0] text-white px-5 py-2.5 rounded-full text-xs font-bold shadow-md transition-all cursor-pointer active:scale-95 self-start sm:self-auto">
                Añadir alumno +
              </button>
            </div>

            {cargando ? (
              <div className="flex justify-center py-12 text-slate-400 font-medium animate-pulse">Sincronizando...</div>
            ) : alumnos.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm font-medium">No hay alumnos en tus clases todavía.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {alumnos.map((alumno) => (
                  <div key={alumno.id} className="p-5 glass-container hover:bg-white/40 rounded-[1.5rem] flex items-center justify-between transition-colors">
                    <div className="overflow-hidden pr-4">
                      <h3 className="font-bold text-[#002b5c] text-sm truncate">{alumno.nombre_completo}</h3>
                      <p className="text-[11px] font-semibold text-slate-400 mt-0.5 truncate">{tieneCorreoReal(alumno.email) ? alumno.email : 'Sin correo'}</p>
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        {alumno.pendiente ? (
                          <div className="flex items-center gap-1.5" title="Dado de alta por un profesor: aún no ha activado su cuenta">
                            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                            <span className="text-[10px] uppercase tracking-wider font-bold text-amber-600 whitespace-nowrap">Pendiente · {alumno.codigo_alta}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${estaVinculado(alumno) ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{estaVinculado(alumno) ? 'Vinculado' : 'Sin Disp.'}</span>
                          </div>
                        )}
                        {alumno.statsFaltas && (
                          <div className={`flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md border ${
                            alumno.statsFaltas.porcentaje >= 30 ? 'bg-rose-50 text-rose-600 border-rose-100' : 
                            alumno.statsFaltas.porcentaje >= 15 ? 'bg-amber-50 text-amber-600 border-amber-100' : 
                            'bg-emerald-50 text-emerald-600 border-emerald-100'
                          }`}>
                            <span>{alumno.statsFaltas.porcentaje}% Faltas ({alumno.statsFaltas.faltas}/{alumno.statsFaltas.total})</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <button onClick={() => abrirGestionAlumno(alumno)} className="shrink-0 px-4 py-2.5 bg-slate-50 text-[#002b5c] hover:text-white hover:bg-[#0090d0] text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95 shadow-sm">
                      Gestionar
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!cargando && alumnosSinClase.length > 0 && (
              <div className="mt-12 pt-8 border-t border-slate-200/60">
                <div className="px-2 mb-6">
                  <h3 className="text-lg font-black text-[#002b5c] tracking-tight flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]"></span>
                    Con cuenta pero sin ninguna clase ({alumnosSinClase.length})
                  </h3>
                  <p className="text-xs font-semibold text-slate-400 mt-1 leading-relaxed">
                    Se registraron pero nunca han fichado en ninguna clase. Suelen ser alumnos con problemas: libera su móvil si no pueden entrar o añádelos a tu clase.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {alumnosSinClase.map((alumno) => (
                    <div key={alumno.id} className="p-5 bg-amber-50/40 border border-amber-100/80 rounded-[1.5rem] flex flex-col gap-3">
                      <div className="overflow-hidden">
                        <h4 className="font-bold text-[#002b5c] text-sm truncate">{alumno.nombre_completo}</h4>
                        <p className="text-[11px] font-semibold text-slate-400 mt-0.5 truncate">{tieneCorreoReal(alumno.email) ? alumno.email : 'Sin correo'}</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {!alumno.confirmado && !alumno.pendiente && (
                            <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-100" title="No ha pulsado el enlace del correo de activación: no puede iniciar sesión">Correo sin confirmar</span>
                          )}
                          {alumno.pendiente && (
                            <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-100">Pendiente de activar</span>
                          )}
                          <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md border ${alumno.vinculado ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                            {alumno.vinculado ? 'Móvil vinculado' : 'Sin móvil'}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {alumno.vinculado && (
                          <button onClick={() => desvincularDispositivo(alumno)} className="flex-1 px-3 py-2 bg-white text-rose-500 hover:bg-rose-50 text-[11px] font-bold rounded-xl border border-slate-200 shadow-sm transition-all cursor-pointer active:scale-95">
                            Liberar móvil
                          </button>
                        )}
                        <button
                          onClick={() => setAsignandoClase({ alumno, asignatura_id: misAsignaturas[0]?.id || '' })}
                          disabled={misAsignaturas.length === 0}
                          className="flex-1 px-3 py-2 bg-white text-[#002b5c] hover:bg-[#0090d0] hover:text-white text-[11px] font-bold rounded-xl border border-slate-200 shadow-sm transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                        >
                          Añadir a una clase
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tabActual === 'ASIGNATURAS' && (
          <div className="glass-container rounded-[2.5rem] p-8 flex-1">
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
                  <div key={asig.id} className="p-6 glass-container rounded-[2rem] flex flex-col justify-between hover:shadow-[0_20px_40px_rgba(0,144,208,0.1)] transition-all relative group">
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

                      <div className="mt-4 border-t border-slate-100 pt-4 flex flex-wrap gap-1.5 justify-center">
                        {[
                          { id: 1, label: 'L' }, { id: 2, label: 'M' }, { id: 3, label: 'X' },
                          { id: 4, label: 'J' }, { id: 5, label: 'V' }, { id: 6, label: 'S' }, { id: 0, label: 'D' }
                        ].map(dia => {
                          const seleccionado = (asig.dias_semana || []).includes(dia.id);
                          return (
                            <button
                              key={dia.id}
                              onClick={() => toggleDiaDirecto(asig, dia.id)}
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all cursor-pointer ${
                                seleccionado 
                                  ? 'bg-[#0090d0] text-white shadow-md shadow-[#0090d0]/20 scale-110' 
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                              }`}
                            >
                              {dia.label}
                            </button>
                          );
                        })}
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
          <div className="glass-container rounded-[2.5rem] p-8 max-w-md w-full shadow-2xl flex flex-col">
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

              <div className="mb-6 flex flex-col gap-3">
                <div className="flex items-center gap-3 bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer shadow-sm hover:shadow-md transition-all active:scale-[0.98]" onClick={() => setExportacionBinaria(!exportacionBinaria)}>
                  <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${exportacionBinaria ? 'bg-[#0090d0] border-[#0090d0]' : 'border-slate-300 bg-slate-50'}`}>
                    {exportacionBinaria && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#002b5c]">Exportar forma simplificada en binario</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer shadow-sm hover:shadow-md transition-all active:scale-[0.98]" onClick={() => setOrdenarPorApellido(!ordenarPorApellido)}>
                  <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${ordenarPorApellido ? 'bg-[#0090d0] border-[#0090d0]' : 'border-slate-300 bg-slate-50'}`}>
                    {ordenarPorApellido && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#002b5c]">Ordenar alumnos por Apellidos</p>
                  </div>
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
          <div className="glass-container rounded-[2.5rem] p-8 max-w-md w-full shadow-2xl flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-xl font-black text-[#002b5c] tracking-tight truncate pr-4">{alumnoGestion.nombre_completo}</h3>
                <p className="text-xs text-slate-500 font-semibold mt-1">{tieneCorreoReal(alumnoGestion.email) ? alumnoGestion.email : 'Sin correo'}</p>
              </div>
              <button onClick={() => setAlumnoGestion(null)} className="w-8 h-8 flex shrink-0 items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full cursor-pointer transition-colors active:scale-95">✕</button>
            </div>

            <div className="space-y-6 overflow-y-auto max-h-[60vh] pr-2">
              {alumnoGestion.pendiente && alumnoGestion.codigo_alta && (
                <div className="bg-amber-50/80 border border-amber-100 rounded-[2rem] p-5">
                  <h4 className="font-bold text-amber-700 text-xs uppercase tracking-wider mb-3">Cuenta pendiente de activar</h4>
                  <button onClick={() => copiarCodigo(alumnoGestion.codigo_alta)} className="w-full py-3 bg-white rounded-2xl text-2xl font-black tracking-[0.3em] text-[#002b5c] border border-amber-100 cursor-pointer active:scale-95" title="Copiar código">
                    {alumnoGestion.codigo_alta}
                  </button>
                  <p className="text-[11px] text-amber-700/80 font-semibold mt-3 leading-snug">
                    {tieneCorreoReal(alumnoGestion.email)
                      ? `Se activará cuando el alumno entre con ${alumnoGestion.email} y pulse el enlace del correo de activación que le llegará (que mire en spam). También puede usar este código al registrarse.`
                      : 'Dale este código al alumno: al crear su cuenta, que pulse "¿Tu profesor te dio un código de alta?" y lo escriba.'}
                  </p>
                </div>
              )}
              <div className="bg-slate-50/80 rounded-[2rem] p-5">
                <h4 className="font-bold text-[#002b5c] text-xs uppercase tracking-wider mb-4">Dispositivo de Fichaje</h4>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${estaVinculado(alumnoGestion) ? 'bg-emerald-400' : 'bg-slate-300'}`}></span>
                    <span className="text-xs font-bold text-slate-600">{estaVinculado(alumnoGestion) ? 'Móvil Vinculado' : 'Sin Vincular'}</span>
                  </div>
                  <button 
                    onClick={() => desvincularDispositivo(alumnoGestion)} 
                    disabled={!estaVinculado(alumnoGestion)}
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
          <div className="glass-container rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight mb-2">Crear Asignatura</h3>
            <p className="text-xs text-slate-500 font-medium mb-6">Completa los datos base y días de clase.</p>
            <form onSubmit={guardarNuevaAsignatura} className="flex flex-col gap-4">
              <input type="text" placeholder="Materia" value={formAsignatura.nombre} onChange={(e) => setFormAsignatura({...formAsignatura, nombre: e.target.value})} className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-sm font-semibold text-[#002b5c]" required/>
              <input type="text" placeholder="Aula" value={formAsignatura.aula} onChange={(e) => setFormAsignatura({...formAsignatura, aula: e.target.value})} className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-sm font-semibold text-[#002b5c]" required/>
              <input type="text" placeholder="Horario" value={formAsignatura.horario} onChange={(e) => setFormAsignatura({...formAsignatura, horario: e.target.value})} className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-sm font-semibold text-[#002b5c]" required/>
              
              <div className="mt-2">
                <p className="text-xs font-bold text-[#002b5c] uppercase tracking-wider mb-3">Días de la semana</p>
                <div className="flex justify-between gap-1">
                  {[
                    { id: 1, label: 'L' }, { id: 2, label: 'M' }, { id: 3, label: 'X' },
                    { id: 4, label: 'J' }, { id: 5, label: 'V' }, { id: 6, label: 'S' }, { id: 0, label: 'D' }
                  ].map(dia => {
                    const seleccionado = formAsignatura.dias_semana.includes(dia.id);
                    return (
                      <button
                        key={dia.id}
                        type="button"
                        onClick={() => toggleDiaSemana(dia.id)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                          seleccionado ? 'bg-[#0090d0] text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {dia.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <button type="button" onClick={() => { setModalAsignatura(false); setFormAsignatura({ nombre: '', aula: '', horario: '', dias_semana: [] }); }} className="py-3.5 rounded-2xl text-slate-500 text-sm font-bold bg-slate-100 active:scale-95 cursor-pointer">Cancelar</button>
                <button type="submit" disabled={guardandoAsig || formAsignatura.dias_semana.length === 0} className="py-3.5 rounded-2xl bg-[#002b5c] text-white text-sm font-bold active:scale-95 disabled:opacity-50 cursor-pointer">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalEliminarAsig && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="glass-container rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl text-center">
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
          <div className="glass-container rounded-[2.5rem] p-8 max-w-md w-full shadow-2xl flex flex-col">
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

              <div className="mb-6 flex flex-col gap-3">
                <div className="flex items-center gap-3 bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer shadow-sm hover:shadow-md transition-all active:scale-[0.98]" onClick={() => setExportacionBinaria(!exportacionBinaria)}>
                  <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${exportacionBinaria ? 'bg-[#0090d0] border-[#0090d0]' : 'border-slate-300 bg-slate-50'}`}>
                    {exportacionBinaria && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#002b5c]">Exportar forma simplificada en binario</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer shadow-sm hover:shadow-md transition-all active:scale-[0.98]" onClick={() => setOrdenarPorApellido(!ordenarPorApellido)}>
                  <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${ordenarPorApellido ? 'bg-[#0090d0] border-[#0090d0]' : 'border-slate-300 bg-slate-50'}`}>
                    {ordenarPorApellido && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#002b5c]">Ordenar alumnos por Apellidos</p>
                  </div>
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

      {/* --- MODAL: AÑADIR ALUMNO (ALTA FORZOSA) --- */}
      {modalAlta && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="glass-container rounded-[2.5rem] p-8 max-w-md w-full shadow-2xl flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-black text-[#002b5c] tracking-tight">Añadir alumno</h3>
                <p className="text-xs text-slate-500 font-semibold mt-1">Aunque todavía no tenga cuenta</p>
              </div>
              <button onClick={() => setModalAlta(false)} className="w-8 h-8 flex shrink-0 items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full cursor-pointer transition-colors active:scale-95">✕</button>
            </div>

            {resultadoAlta ? (
              <div className="flex flex-col gap-4 text-center">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto"><span className="text-3xl">✓</span></div>
                {resultadoAlta.tipo === 'EXISTENTE' && !resultadoAlta.pendiente ? (
                  <p className="text-sm text-slate-600 font-semibold leading-relaxed">
                    <span className="text-[#002b5c] font-black">{resultadoAlta.nombre}</span> ya tenía cuenta con ese correo: lo hemos añadido a la asignatura.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-slate-600 font-semibold leading-relaxed">
                      Hemos creado la cuenta de <span className="text-[#002b5c] font-black">{resultadoAlta.nombre}</span>. Ya aparece en tu clase y puedes marcarle la asistencia.
                    </p>
                    {resultadoAlta.codigo && (
                      <button onClick={() => copiarCodigo(resultadoAlta.codigo!)} className="w-full py-4 bg-white rounded-2xl text-3xl font-black tracking-[0.3em] text-[#002b5c] border border-slate-100 shadow-sm cursor-pointer active:scale-95" title="Copiar código">
                        {resultadoAlta.codigo}
                      </button>
                    )}
                    <p className="text-xs text-slate-500 font-semibold leading-relaxed bg-slate-50/80 rounded-2xl p-4 text-left">
                      {resultadoAlta.email
                        ? `Cuando se registre o inicie sesión con ${resultadoAlta.email}, se le reconocerá automáticamente y conservará sus asistencias. Si se registra con otro correo, que use el código de arriba.`
                        : 'Dale este código al alumno. Al crear su cuenta, que pulse "¿Tu profesor te dio un código de alta?" y lo escriba: así conservará sus asistencias. Lo puedes volver a ver en "Gestionar".'}
                    </p>
                  </>
                )}
                <div className="flex gap-3 mt-2">
                  <button onClick={() => { setResultadoAlta(null); setFormAlta(f => ({ ...f, nombre: '', email: '' })); }} className="flex-1 py-3.5 rounded-2xl text-[#002b5c] text-sm font-bold bg-slate-50 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer">Añadir otro</button>
                  <button onClick={() => setModalAlta(false)} className="flex-1 py-3.5 rounded-2xl bg-[#002b5c] hover:bg-[#0090d0] text-white text-sm font-bold active:scale-95 transition-all cursor-pointer">Listo</button>
                </div>
              </div>
            ) : misAsignaturas.length === 0 ? (
              <p className="text-sm text-slate-500 font-semibold text-center py-6">Primero crea una asignatura en la pestaña "Asignaturas".</p>
            ) : (
              <form onSubmit={guardarAlta} className="flex flex-col gap-4">
                <input type="text" placeholder="Nombre y apellidos *" value={formAlta.nombre} onChange={(e) => setFormAlta({ ...formAlta, nombre: e.target.value })} className="w-full p-4 bg-white/60 border border-white rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-sm font-semibold text-[#002b5c]" required minLength={3} autoFocus />
                <div>
                  <input type="email" placeholder="Correo del alumno (opcional)" value={formAlta.email} onChange={(e) => setFormAlta({ ...formAlta, email: e.target.value })} className="w-full p-4 bg-white/60 border border-white rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-sm font-semibold text-[#002b5c]" />
                  <p className="text-[11px] text-slate-400 font-semibold mt-2 px-2 leading-snug">Si lo pones, el alumno se reconocerá solo al registrarse con ese correo. Si no, te daremos un código para dárselo.</p>
                </div>
                <select value={formAlta.asignatura_id} onChange={(e) => setFormAlta({ ...formAlta, asignatura_id: e.target.value })} className="w-full p-4 bg-white/60 border border-white rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-sm font-semibold text-[#002b5c] cursor-pointer">
                  {misAsignaturas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
                <button type="submit" disabled={guardandoAlta} className="w-full mt-2 py-4 rounded-2xl bg-[#002b5c] hover:bg-[#0090d0] text-white text-sm font-bold shadow-md active:scale-95 disabled:opacity-50 transition-all cursor-pointer">
                  {guardandoAlta ? 'Creando...' : 'Añadir a la clase'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* --- MODAL: AÑADIR A UNA CLASE (alumnos sin clase) --- */}
      {asignandoClase && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fade-in_0.2s_ease-out]">
          <div className="glass-container rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl flex flex-col gap-4">
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight">Añadir a una clase</h3>
            <p className="text-sm text-slate-500 font-semibold">{asignandoClase.alumno.nombre_completo}</p>
            <select value={asignandoClase.asignatura_id} onChange={(e) => setAsignandoClase({ ...asignandoClase, asignatura_id: e.target.value })} className="w-full p-4 bg-white/60 border border-white rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#0090d0]/20 text-sm font-semibold text-[#002b5c] cursor-pointer">
              {misAsignaturas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            <div className="flex gap-3 mt-2">
              <button onClick={() => setAsignandoClase(null)} className="flex-1 py-3.5 rounded-2xl text-slate-500 text-sm font-bold bg-slate-50 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer">Cancelar</button>
              <button onClick={confirmarAsignarClase} className="flex-1 py-3.5 rounded-2xl bg-[#002b5c] hover:bg-[#0090d0] text-white text-sm font-bold active:scale-95 transition-all cursor-pointer">Añadir</button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: CONFIRMAR LIBERAR MÓVIL --- */}
      {alumnoALiberar && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-[fade-in_0.2s_ease-out]">
          <div className="glass-container rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl text-center flex flex-col gap-4">
            <h3 className="text-xl font-black text-[#002b5c] tracking-tight">¿Liberar el móvil?</h3>
            <p className="text-sm text-slate-500 font-medium leading-relaxed">
              <span className="font-bold text-[#002b5c]">{alumnoALiberar.nombre_completo}</span> podrá vincular su cuenta a otro móvil o navegador la próxima vez que inicie sesión.
            </p>
            <div className="flex gap-3 mt-2">
              <button onClick={() => setAlumnoALiberar(null)} className="flex-1 py-3.5 rounded-2xl text-slate-500 text-sm font-bold bg-slate-50 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer">Cancelar</button>
              <button onClick={confirmarLiberarMovil} className="flex-1 py-3.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold active:scale-95 transition-all cursor-pointer">Liberar</button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: CONFIRMAR EXPULSIÓN --- */}
      {modalExpulsion && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-[100] animate-[fade-in_0.2s_ease-out]">
          <div className="glass-container rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl text-center border border-rose-100">
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

      <BotonCompartir mostrarNotificacion={mostrarNotificacion} />
    </div>
  );
}
