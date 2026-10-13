// Supabase devuelve como máximo 1000 filas por consulta y, si hay más, las corta sin avisar.
// Estas funciones piden los datos por páginas (y las listas de ids por lotes, para no generar
// direcciones demasiado largas), así las estadísticas y los Excel siempre salen completos.

const FILAS_POR_PAGINA = 1000;
const IDS_POR_LOTE = 100;

interface ConsultaPaginable {
  range(desde: number, hasta: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

interface Borrado {
  then: PromiseLike<{ error: unknown }>['then'];
}

// Importante: la consulta debe llevar un .order(...) para que las páginas no se solapen
export async function traerTodas<T>(crearConsulta: () => ConsultaPaginable): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += FILAS_POR_PAGINA) {
    const { data, error } = await crearConsulta().range(desde, desde + FILAS_POR_PAGINA - 1);
    if (error) throw error;
    filas.push(...((data ?? []) as T[]));
    if (!data || data.length < FILAS_POR_PAGINA) return filas;
  }
}

export async function traerPorLotes<T>(ids: string[], crearConsulta: (lote: string[]) => ConsultaPaginable): Promise<T[]> {
  const filas: T[] = [];
  for (let i = 0; i < ids.length; i += IDS_POR_LOTE) {
    const lote = ids.slice(i, i + IDS_POR_LOTE);
    filas.push(...(await traerTodas<T>(() => crearConsulta(lote))));
  }
  return filas;
}

export async function borrarPorLotes(ids: string[], borrar: (lote: string[]) => Borrado): Promise<void> {
  for (let i = 0; i < ids.length; i += IDS_POR_LOTE) {
    const { error } = await borrar(ids.slice(i, i + IDS_POR_LOTE));
    if (error) throw error;
  }
}
