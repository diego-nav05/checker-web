import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { traerPorLotes, traerTodas } from './consultas';
import { Boton, Esqueleto, Etiqueta, Modal, Selector, Vacio, retraso } from './ui';
import FilaAlumno from './FilaAlumno';
import type { Asistencia, EstadoAsistencia } from './types';

interface Sesion {
  id: string;
  fase: string;
  hora_apertura: string;
}

interface Props {
  asignatura: { id: string; nombre: string };
  onCerrar: () => void;
  avisar: (texto: string, tipo?: 'exito' | 'error' | 'info') => void;
}

const fechaLarga = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const horaCorta = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const ASISTE = ['PRESENTE', 'RETRASO'];

// Historial de clases de una asignatura: el profesor puede corregir la asistencia de cualquier
// clase (también las ya cerradas). Los cambios se guardan al momento en la base de datos.
export default function ClasesPasadas({ asignatura, onCerrar, avisar }: Props) {
  const [sesiones, setSesiones] = useState<(Sesion & { asistentes: number; total: number })[]>([]);
  const [cargando, setCargando] = useState(true);
  const [clase, setClase] = useState<Sesion | null>(null);
  const [filas, setFilas] = useState<Asistencia[]>([]);
  const [cargandoClase, setCargandoClase] = useState(false);
  const [sinRegistro, setSinRegistro] = useState<{ id: string; nombre: string }[]>([]);
  const [nuevoAlumno, setNuevoAlumno] = useState('');
  const [nuevoEstado, setNuevoEstado] = useState<EstadoAsistencia>('PRESENTE');

  const cargarSesiones = async () => {
    setCargando(true);
    try {
      const lista = await traerTodas<Sesion>(() => supabase.from('sesiones')
        .select('id, fase, hora_apertura').eq('asignatura_id', asignatura.id)
        .order('hora_apertura', { ascending: false }).order('id'));
      const asistencias = await traerPorLotes<{ sesion_id: string; estado: string }>(lista.map(s => s.id), (lote) =>
        supabase.from('asistencias').select('sesion_id, estado').in('sesion_id', lote).order('id'));
      setSesiones(lista.map(s => {
        const deEsta = asistencias.filter(a => a.sesion_id === s.id);
        return { ...s, total: deEsta.length, asistentes: deEsta.filter(a => ASISTE.includes(a.estado)).length };
      }));
    } catch {
      avisar('No se pudieron cargar las clases. Revisa tu conexión.', 'error');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargarSesiones(); }, [asignatura.id]);

  const abrirClase = async (sesion: Sesion) => {
    setClase(sesion);
    setCargandoClase(true);
    setNuevoAlumno('');
    try {
      const registros = await traerTodas<Asistencia>(() => supabase.from('asistencias').select('*').eq('sesion_id', sesion.id).order('id'));
      const { data: matriculas } = await supabase.from('matriculas').select('alumno_id').eq('asignatura_id', asignatura.id);
      const conRegistro = new Set(registros.map(r => r.alumno_id));
      const ids = [...new Set([...registros.map(r => r.alumno_id), ...(matriculas || []).map(m => m.alumno_id)])];
      const perfiles = await traerPorLotes<{ id: string; nombre_completo: string; pendiente: boolean }>(ids, (lote) =>
        supabase.from('perfiles').select('id, nombre_completo, pendiente').in('id', lote).order('id'));
      const porId = new Map(perfiles.map(p => [p.id, p]));
      const porNombre = (a: string, b: string) => a.localeCompare(b, 'es');
      setFilas(registros
        .map(r => ({ ...r, perfiles: porId.get(r.alumno_id) as any }))
        .sort((a, b) => porNombre(a.perfiles?.nombre_completo || '', b.perfiles?.nombre_completo || '')));
      setSinRegistro(perfiles
        .filter(p => !conRegistro.has(p.id))
        .map(p => ({ id: p.id, nombre: p.nombre_completo }))
        .sort((a, b) => porNombre(a.nombre, b.nombre)));
    } catch {
      avisar('No se pudo cargar la clase. Revisa tu conexión.', 'error');
    } finally {
      setCargandoClase(false);
    }
  };

  const cambiarEstado = async (id: string, estado: EstadoAsistencia) => {
    const anterior = filas;
    setFilas(filas.map(f => f.id === id ? { ...f, estado, manual: true } : f));
    const { error } = await supabase.from('asistencias').update({ estado, manual: true }).eq('id', id);
    if (error) {
      setFilas(anterior);
      avisar('No se pudo guardar el cambio. Revisa tu conexión.', 'error');
    } else {
      avisar('Cambio guardado.', 'exito');
    }
  };

  const anadirAlumno = async () => {
    if (!clase || !nuevoAlumno) return;
    const { data, error } = await supabase.from('asistencias')
      .insert({ sesion_id: clase.id, alumno_id: nuevoAlumno, estado: nuevoEstado, manual: true })
      .select('*').single();
    if (error || !data) return avisar('No se pudo añadir al alumno a esta clase.', 'error');
    const alumno = sinRegistro.find(a => a.id === nuevoAlumno);
    setFilas([...filas, { ...data, perfiles: { nombre_completo: alumno?.nombre } as any }]
      .sort((a, b) => (a.perfiles?.nombre_completo || '').localeCompare(b.perfiles?.nombre_completo || '', 'es')));
    setSinRegistro(sinRegistro.filter(a => a.id !== nuevoAlumno));
    setNuevoAlumno('');
    avisar(`${alumno?.nombre ?? 'Alumno'} añadido a esta clase.`, 'exito');
  };

  const volverALista = () => {
    setClase(null);
    cargarSesiones(); // para que se vean los recuentos actualizados
  };

  if (clase) {
    return (
      <Modal
        ancho="md"
        titulo={fechaLarga(clase.hora_apertura).replace(/^./, c => c.toUpperCase())}
        descripcion={<>{asignatura.nombre} · {horaCorta(clase.hora_apertura)}. Los cambios se guardan al momento.</>}
        onCerrar={onCerrar}
      >
        <Boton variante="texto" onClick={volverALista} className="mb-3 -ml-2">← Todas las clases</Boton>
        {cargandoClase ? (
          <Esqueleto filas={5} alto="h-14" />
        ) : (
          <>
            {filas.length === 0 ? (
              <Vacio icono="👥" titulo="Nadie en esta clase" texto="Puedes añadir alumnos matriculados aquí abajo." />
            ) : (
              <div className="space-y-2">
                {filas.map(f => <FilaAlumno key={f.id} item={f} onCambiar={cambiarEstado} />)}
              </div>
            )}

            {sinRegistro.length > 0 && (
              <div className="mt-5 pt-5 border-t border-slate-200/60">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">Añadir alumno a esta clase</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Selector value={nuevoAlumno} onChange={(e) => setNuevoAlumno(e.target.value)} className="py-3 flex-1">
                    <option value="">Elige un alumno…</option>
                    {sinRegistro.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </Selector>
                  <Selector value={nuevoEstado} onChange={(e) => setNuevoEstado(e.target.value as EstadoAsistencia)} className="py-3 sm:w-36">
                    <option value="PRESENTE">Presente</option>
                    <option value="RETRASO">Retraso</option>
                    <option value="FALTA_JUSTIFICADA">Justificado</option>
                    <option value="FALTA_INJUSTIFICADA">Ausente</option>
                  </Selector>
                  <Boton onClick={anadirAlumno} disabled={!nuevoAlumno}>Añadir</Boton>
                </div>
              </div>
            )}
          </>
        )}
      </Modal>
    );
  }

  return (
    <Modal ancho="md" titulo="Clases pasadas" descripcion={<>{asignatura.nombre}. Elige una clase para corregir su asistencia.</>} onCerrar={onCerrar}>
      {cargando ? (
        <Esqueleto filas={4} alto="h-16" />
      ) : sesiones.length === 0 ? (
        <Vacio icono="🗓️" titulo="Aún no hay clases" texto="Las clases que abras desde Profesorado aparecerán aquí." />
      ) : (
        <div className="space-y-2">
          {sesiones.map((s, i) => (
            <button
              key={s.id}
              onClick={() => abrirClase(s)}
              style={retraso(Math.min(i, 8))}
              className="bento-entrada w-full text-left px-4 py-3.5 bg-white/70 hover:bg-white border border-white rounded-control flex items-center justify-between gap-3 transition-all duration-300 hover:-translate-y-0.5 cursor-pointer group"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-marino truncate first-letter:uppercase">{fechaLarga(s.hora_apertura)}</p>
                <p className="text-[11px] font-semibold text-slate-400 mt-0.5">{horaCorta(s.hora_apertura)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {s.fase !== 'CERRADA' && <Etiqueta tono="info">En curso</Etiqueta>}
                <Etiqueta tono={s.total > 0 && s.asistentes / s.total >= 0.8 ? 'exito' : 'neutro'}>{s.asistentes}/{s.total}</Etiqueta>
                <span className="text-slate-300 group-hover:text-azul transition-colors">›</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
