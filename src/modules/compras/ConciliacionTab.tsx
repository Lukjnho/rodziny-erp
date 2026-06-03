// ConciliacionTab — sub-tab del módulo Compras para conciliar el extracto bancario
// con los gastos cargados.
//
// 3 vistas:
//  1) Auto-match por N° de operación: vincula gastos manuales con su movimiento
//     del extracto cuando comparten nro_comprobante / referencia.
//  2) Cargos automáticos: genera gastos con categoría "Impuestos y comisiones
//     bancarias" (Rodziny S.A.S.) para movimientos identificados como impuestos /
//     comisiones MP / IVA bancario / etc.
//  3) Sin conciliar: lista de egresos del extracto que no matchean por N° op
//     ni son cargos automáticos. Lucas los carga manualmente desde Compras > Gastos.
//
// Toda la lógica pesada vive en RPC Postgres (auto_match_gastos_extracto y
// crear_cargos_automaticos_bancarios) para evitar saturar el browser con miles
// de UPDATE/INSERT secuenciales.

import { Fragment, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatARS, cn } from '@/lib/utils';
import { ImportarExtractoModal } from '@/modules/gastos/ImportarExtractoModal';
import { VincularPagosMovModal } from './VincularPagosMovModal';

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ymdAddDays(s: string, days: number): string {
  const d = new Date(s + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

function diffDays(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00Z').getTime();
  const db = new Date(b + 'T12:00:00Z').getTime();
  return Math.round((da - db) / 86400000);
}

interface GastoCandidato {
  id: string;
  fecha: string;
  importe_total: number;
  proveedor: string | null;
  nro_comprobante: string | null;
}

// Los errores de Supabase son PostgrestError (objetos), no Error. String() los pisa
// como "[object Object]". Esta helper extrae message/details/hint/code para que se vea útil.
function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      const detalles =
        (obj.details as string | undefined) ||
        (obj.hint as string | undefined) ||
        (obj.code as string | undefined);
      return detalles ? `${obj.message} [${detalles}]` : String(obj.message);
    }
    try {
      return JSON.stringify(obj).slice(0, 300);
    } catch {
      return '[error sin mensaje]';
    }
  }
  return String(e);
}

// ID estable de la subcategoría — ver memory/reference_categorias_clave.md
const CATEGORIA_BANCARIA_ID = 'fcb639e7-4be6-4d7b-989a-fd15d42a2534';

// Patrones de sugerencia que califican como "cargo automático" (impuestos/comisiones bancarias).
// Tiene que coincidir con el WHERE de la RPC crear_cargos_automaticos_bancarios.
// Usamos `_` (cualquier carácter) en lugar de tildes para tolerar variantes con/sin acento.
const PATRONES_CARGO_BANCARIO = [
  'Impuesto al d_bito%',
  'Impuesto al cr_dito%',
  'Comisi_n MP%',
  'Comision MP%',
  'Comisi_n%',
  'Comision%',
  'IVA bancario%',
  'IVA%',
  'Percepci_n%',
  'D_bito por liquidaci_n%',
  'Impuesto de sellos%',
  'Sellos%',
  'Retenci_n%',
  'Retenciones%',
];

interface MovimientoSinConciliar {
  id: string;
  fecha: string;
  descripcion: string | null;
  debito: number;
  cuenta: string;
  referencia: string | null;
  sugerencia: string | null; // si tiene → cargo automático listo para procesar con el bulk
}

interface MovBancario {
  id: string;
  fecha: string;
  descripcion: string | null;
  debito: number;
  cuenta: string;
  referencia: string | null;
}

interface GastoConciliado {
  gasto_id: string;
  proveedor: string | null;
  fecha: string;
  importe_total: number;
  comentario: string | null;
  nro_comprobante: string | null;
  movs: MovBancario[]; // detalle (puede ser parcial si el gasto tiene miles de movs)
  movs_total_debito: number; // total REAL (del servidor), no del detalle parcial
  n_movs: number; // cantidad REAL de movimientos vinculados
  // true si el movimiento vinculado paga VARIOS gastos (transferencia consolidada).
  // En ese caso el importe del gasto NO tiene por qué igualar el débito del mov.
  consolidado: boolean;
}

export function ConciliacionTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [procesando, setProcesando] = useState<null | 'match' | 'cargos'>(null);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [verConciliados, setVerConciliados] = useState(false);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [bancoFiltro, setBancoFiltro] = useState<'todos' | 'mercadopago' | 'galicia' | 'icbc'>('todos');
  const [movParaVincular, setMovParaVincular] = useState<MovimientoSinConciliar | null>(null);

  function toggleExpandir(gastoId: string) {
    setExpandido((prev) => {
      const next = new Set(prev);
      if (next.has(gastoId)) next.delete(gastoId);
      else next.add(gastoId);
      return next;
    });
  }

  // ---- Período (default: mes actual) ----
  const ahora = new Date();
  const primerDelMes = useMemo(
    () => ymd(new Date(ahora.getFullYear(), ahora.getMonth(), 1)),
    [],
  );
  const ultimoDelMes = useMemo(
    () => ymd(new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0)),
    [],
  );
  const primerMesAnt = useMemo(
    () => ymd(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1)),
    [],
  );
  const ultimoMesAnt = useMemo(
    () => ymd(new Date(ahora.getFullYear(), ahora.getMonth(), 0)),
    [],
  );
  const primerDelAnio = useMemo(() => `${ahora.getFullYear()}-01-01`, []);
  const ultimoDelAnio = useMemo(() => `${ahora.getFullYear()}-12-31`, []);

  const [desde, setDesde] = useState<string>(primerDelMes);
  const [hasta, setHasta] = useState<string>(ultimoDelMes);

  function aplicarPreset(d: string, h: string) {
    setDesde(d);
    setHasta(h);
  }

  // ---- Vista 1: pagos con N° de operación pendientes de matchear con extracto ----
  // El campo correcto para conciliación es pagos_gastos.numero_operacion (N° de transferencia
  // bancaria real), NO gastos.nro_comprobante (que suele ser N° de factura del proveedor).
  const { data: pendientesMatch, isLoading: loadingMatch } = useQuery({
    queryKey: ['conciliacion', 'pendientes_match', desde, hasta, bancoFiltro],
    queryFn: async () => {
      // Pagos con N° de op no vacío en el rango. Excluimos efectivo (que no genera movimiento bancario).
      // Si hay filtro de banco, mapeamos a medio_pago equivalente.
      let q = supabase
        .from('pagos_gastos')
        .select('id, gasto_id, monto, fecha_pago, numero_operacion, medio_pago')
        .not('numero_operacion', 'is', null)
        .neq('numero_operacion', '')
        .neq('medio_pago', 'efectivo')
        .is('conciliado_movimiento_id', null) // ya conciliados 1:N (transf. consolidada) salen de pendientes
        .gte('fecha_pago', desde)
        .lte('fecha_pago', hasta);
      if (bancoFiltro === 'mercadopago') q = q.in('medio_pago', ['mercadopago', 'mp', 'transferencia_mp']);
      else if (bancoFiltro === 'galicia') q = q.in('medio_pago', ['galicia', 'transferencia_galicia']);
      else if (bancoFiltro === 'icbc') q = q.in('medio_pago', ['icbc', 'transferencia_icbc']);
      const { data: pagos, error } = await q;
      if (error) throw error;

      const gastoIds = (pagos ?? []).map((p) => p.gasto_id).filter((x): x is string => !!x);
      if (gastoIds.length === 0) return { sinConciliar: [], total: 0 };

      // Filtrar los que ya tienen un movimiento bancario apuntandolos
      const conciliadosSet = new Set<string>();
      const PAGE = 800;
      for (let i = 0; i < gastoIds.length; i += PAGE) {
        const batch = gastoIds.slice(i, i + PAGE);
        const { data: yaMatch } = await supabase
          .from('movimientos_bancarios')
          .select('gasto_id')
          .in('gasto_id', batch);
        for (const m of yaMatch ?? []) {
          if (m.gasto_id) conciliadosSet.add(m.gasto_id as string);
        }
      }
      const sinConciliar = (pagos ?? []).filter((p) => p.gasto_id && !conciliadosSet.has(p.gasto_id));
      const total = sinConciliar.reduce((s, p) => s + Number(p.monto ?? 0), 0);
      return { sinConciliar, total };
    },
  });

  // ---- Vista 2: cargos bancarios listos para crear automáticamente ----
  const { data: cargosAuto, isLoading: loadingCargos } = useQuery({
    queryKey: ['conciliacion', 'cargos_auto', desde, hasta, bancoFiltro],
    queryFn: async () => {
      const orParts = PATRONES_CARGO_BANCARIO.map((p) => `sugerencia.ilike.${p}`).join(',');
      let q = supabase
        .from('movimientos_bancarios')
        .select('id, fecha, descripcion, debito, sugerencia, cuenta')
        .is('gasto_id', null)
        .gt('debito', 0)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .or('es_transferencia_interna.is.null,es_transferencia_interna.eq.false')
        .or(orParts);
      if (bancoFiltro !== 'todos') q = q.eq('cuenta', bancoFiltro);
      const { data, error } = await q;
      if (error) throw error;
      const total = (data ?? []).reduce((s, m) => s + Number(m.debito ?? 0), 0);
      return { movs: data ?? [], total };
    },
  });

  // ---- Gastos candidatos para match manual (vinculación por monto+fecha) ----
  // Trae gastos del rango ampliado (±2 días) que NO están vinculados a ningún
  // movimiento bancario todavía. Sirve para detectar "este movimiento del extracto
  // ya está cargado como gasto pero sin N° de operación, lo vincula con click".
  const { data: gastosCandidatos } = useQuery<GastoCandidato[]>({
    queryKey: ['conciliacion', 'gastos_candidatos', desde, hasta],
    queryFn: async () => {
      const desdeAmpliado = ymdAddDays(desde, -2);
      const hastaAmpliado = ymdAddDays(hasta, 2);
      const { data: gastos, error } = await supabase
        .from('gastos')
        .select('id, fecha, importe_total, proveedor, nro_comprobante')
        .neq('cancelado', true)
        .gte('fecha', desdeAmpliado)
        .lte('fecha', hastaAmpliado);
      if (error) throw error;
      const lista = (gastos ?? []) as GastoCandidato[];
      if (lista.length === 0) return [];
      // Excluir gastos que ya tienen movimiento bancario asociado
      const ids = lista.map((g) => g.id);
      const conciliadosSet = new Set<string>();
      const PAGE = 800;
      for (let i = 0; i < ids.length; i += PAGE) {
        const batch = ids.slice(i, i + PAGE);
        const { data: vinc } = await supabase
          .from('movimientos_bancarios')
          .select('gasto_id')
          .in('gasto_id', batch);
        for (const m of vinc ?? []) {
          if (m.gasto_id) conciliadosSet.add(m.gasto_id as string);
        }
      }
      return lista.filter((g) => !conciliadosSet.has(g.id));
    },
  });

  // ---- Conciliados (agrupados por GASTO) ----
  // Cada movimiento bancario con gasto_id apunta a un gasto cargado. Pero un gasto
  // consolidado (cargos automáticos) puede tener N movimientos apuntandolo. Por eso
  // mostramos UNA fila por gasto, con detalle expandible de los movs.
  const { data: conciliados, isLoading: loadingConciliados } = useQuery<GastoConciliado[]>({
    queryKey: ['conciliacion', 'conciliados_por_gasto', desde, hasta, bancoFiltro],
    queryFn: async () => {
      // Traer movs vinculados a gastos en el rango (subimos limit a 2000 para
      // cubrir cargos automáticos consolidados).
      let q = supabase
        .from('movimientos_bancarios')
        .select('id, fecha, descripcion, debito, cuenta, referencia, gasto_id')
        .not('gasto_id', 'is', null)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: false })
        .limit(2000);
      if (bancoFiltro !== 'todos') q = q.eq('cuenta', bancoFiltro);
      const { data: movs, error } = await q;
      if (error) throw error;
      const lista = movs ?? [];
      if (lista.length === 0) return [];

      // Agrupar movs por gasto_id
      const movsByGasto = new Map<string, MovBancario[]>();
      for (const m of lista) {
        const gid = m.gasto_id as string;
        if (!movsByGasto.has(gid)) movsByGasto.set(gid, []);
        movsByGasto.get(gid)!.push({
          id: m.id as string,
          fecha: m.fecha as string,
          descripcion: (m.descripcion as string | null) ?? null,
          debito: Number(m.debito ?? 0),
          cuenta: m.cuenta as string,
          referencia: (m.referencia as string | null) ?? null,
        });
      }

      // Sumar gastos conciliados vía link 1:N (transferencias consolidadas): sus pagos
      // apuntan con conciliado_movimiento_id a un movimiento que ya está en `lista`.
      // Esos gastos NO tienen movimiento.gasto_id propio, así que sin esto no se verían.
      const movById = new Map(lista.map((m) => [m.id as string, m]));
      const movIds = Array.from(movById.keys());
      const LOTE_MOV = 300;
      for (let i = 0; i < movIds.length; i += LOTE_MOV) {
        const batch = movIds.slice(i, i + LOTE_MOV);
        const { data: pcons } = await supabase
          .from('pagos_gastos')
          .select('gasto_id, conciliado_movimiento_id')
          .in('conciliado_movimiento_id', batch);
        for (const p of pcons ?? []) {
          const gid = p.gasto_id as string | null;
          const mid = p.conciliado_movimiento_id as string | null;
          if (!gid || !mid || movsByGasto.has(gid)) continue; // ya está por link 1:1
          const m = movById.get(mid);
          if (!m) continue;
          movsByGasto.set(gid, [
            {
              id: m.id as string,
              fecha: m.fecha as string,
              descripcion: (m.descripcion as string | null) ?? null,
              debito: Number(m.debito ?? 0),
              cuenta: m.cuenta as string,
              referencia: (m.referencia as string | null) ?? null,
            },
          ]);
        }
      }

      // Totales/cantidades REALES por gasto (link 1:1) calculados en el servidor,
      // sin el límite de 2000 del fetch de detalle. Imprescindible para los cargos
      // consolidados (retenciones/comisiones MP) que tienen miles de movimientos.
      const resumenMap = new Map<string, { n: number; total: number }>();
      const { data: resumen } = await supabase.rpc('conciliados_resumen_por_gasto', {
        p_desde: desde,
        p_hasta: hasta,
        p_cuenta: bancoFiltro,
      });
      for (const r of (resumen ?? []) as { gasto_id: string; n_movs: number; total_debito: number }[]) {
        resumenMap.set(r.gasto_id, { n: Number(r.n_movs), total: Number(r.total_debito) });
        // Garantizar que el gasto aparezca aunque sus movs hayan quedado fuera del fetch
        if (!movsByGasto.has(r.gasto_id)) movsByGasto.set(r.gasto_id, []);
      }

      // Traer datos de los gastos referenciados
      const gastoIds = Array.from(movsByGasto.keys());
      const gastosById = new Map<string, { proveedor: string | null; fecha: string; importe_total: number; nro_comprobante: string | null; comentario: string | null }>();
      const PAGE = 800;
      for (let i = 0; i < gastoIds.length; i += PAGE) {
        const batch = gastoIds.slice(i, i + PAGE);
        const { data: gs } = await supabase
          .from('gastos')
          .select('id, proveedor, fecha, importe_total, nro_comprobante, comentario')
          .in('id', batch);
        for (const g of gs ?? []) {
          gastosById.set(g.id as string, {
            proveedor: (g.proveedor as string | null) ?? null,
            fecha: g.fecha as string,
            importe_total: Number(g.importe_total ?? 0),
            nro_comprobante: (g.nro_comprobante as string | null) ?? null,
            comentario: (g.comentario as string | null) ?? null,
          });
        }
      }

      // Cuántos gastos comparte cada movimiento → si >1, es transferencia consolidada.
      const gastosPorMov = new Map<string, number>();
      for (const movsDelGasto of movsByGasto.values()) {
        for (const m of movsDelGasto) {
          gastosPorMov.set(m.id, (gastosPorMov.get(m.id) ?? 0) + 1);
        }
      }

      // Armar lista final ordenada por fecha del último mov (más reciente primero)
      const result: GastoConciliado[] = [];
      for (const [gastoId, movsDelGasto] of movsByGasto.entries()) {
        const g = gastosById.get(gastoId);
        const resumenG = resumenMap.get(gastoId);
        // Total y cantidad reales: del servidor si es link 1:1; si es 1:N (transf.
        // compartida, sin gasto_id propio) usamos el mov compartido del detalle.
        const totalDebito = resumenG ? resumenG.total : movsDelGasto.reduce((s, m) => s + m.debito, 0);
        const nMovs = resumenG ? resumenG.n : movsDelGasto.length;
        const consolidado = movsDelGasto.some((m) => (gastosPorMov.get(m.id) ?? 0) > 1);
        result.push({
          gasto_id: gastoId,
          proveedor: g?.proveedor ?? null,
          fecha: g?.fecha ?? '',
          importe_total: g?.importe_total ?? 0,
          comentario: g?.comentario ?? null,
          nro_comprobante: g?.nro_comprobante ?? null,
          movs: movsDelGasto,
          movs_total_debito: totalDebito,
          n_movs: nMovs,
          consolidado,
        });
      }
      result.sort((a, b) => {
        const aLast = a.movs[0]?.fecha ?? a.fecha ?? '';
        const bLast = b.movs[0]?.fecha ?? b.fecha ?? '';
        return bLast.localeCompare(aLast);
      });
      return result;
    },
  });

  async function handleMarcarInterna(movId: string) {
    setMensaje(null);
    try {
      const { error } = await supabase
        .from('movimientos_bancarios')
        .update({ es_transferencia_interna: true })
        .eq('id', movId);
      if (error) throw error;
      setMensaje({
        tipo: 'ok',
        texto: 'Movimiento marcado como transferencia interna. Sale del listado de egresos.',
      });
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
    } catch (e: unknown) {
      console.error('[Conciliacion] marcar interna error:', e);
      setMensaje({ tipo: 'err', texto: `Error al marcar como interna: ${formatError(e)}` });
    }
  }

  async function handleDesvincular(movId: string) {
    setMensaje(null);
    try {
      const { error } = await supabase
        .from('movimientos_bancarios')
        .update({ gasto_id: null })
        .eq('id', movId);
      if (error) throw error;
      setMensaje({ tipo: 'ok', texto: 'Movimiento desvinculado del gasto.' });
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      qc.invalidateQueries({ queryKey: ['gastos_conciliados_ids'] });
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
    } catch (e: unknown) {
      console.error('[Conciliacion] desvincular error:', e);
      setMensaje({ tipo: 'err', texto: `Error al desvincular: ${formatError(e)}` });
    }
  }

  // ---- Tabla unificada: TODOS los movs pendientes de procesar ----
  // Egresos del extracto sin gasto vinculado, no marcados como transferencia interna.
  // Incluye los que tienen `sugerencia` (cargos automáticos del banco) — la columna
  // "Estado" en el render decide el badge según si tiene sugerencia, match con
  // gasto candidato, o nada.
  const { data: movsPendientes, isLoading: loadingMovs } = useQuery({
    queryKey: ['conciliacion', 'movs_pendientes', desde, hasta, bancoFiltro],
    queryFn: async () => {
      let q = supabase
        .from('movimientos_bancarios')
        .select('id, fecha, descripcion, debito, cuenta, referencia, sugerencia')
        .is('gasto_id', null)
        .gt('debito', 0)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .or('es_transferencia_interna.is.null,es_transferencia_interna.eq.false')
        .order('fecha', { ascending: false })
        .limit(500);
      if (bancoFiltro !== 'todos') q = q.eq('cuenta', bancoFiltro);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as MovimientoSinConciliar[];
    },
  });

  // ---- Estado por banco (cards arriba) ----
  // Para cada banco: total movs, fecha del último mov del extracto, fecha del primero
  const { data: estadoBancos } = useQuery({
    queryKey: ['conciliacion', 'estado_bancos'],
    queryFn: async () => {
      const cuentas = ['mercadopago', 'galicia', 'icbc'] as const;
      const result: Record<string, { total: number; ultimaFecha: string | null; primeraFecha: string | null; sinGastoCount: number }> = {};
      for (const c of cuentas) {
        const [{ count: total }, { data: ultimoMov }, { data: primerMov }, { count: sinGasto }] = await Promise.all([
          supabase.from('movimientos_bancarios').select('*', { count: 'exact', head: true }).eq('cuenta', c),
          supabase.from('movimientos_bancarios').select('fecha').eq('cuenta', c).order('fecha', { ascending: false }).limit(1),
          supabase.from('movimientos_bancarios').select('fecha').eq('cuenta', c).order('fecha', { ascending: true }).limit(1),
          supabase.from('movimientos_bancarios').select('*', { count: 'exact', head: true })
            .eq('cuenta', c).is('gasto_id', null).is('sugerencia', null).gt('debito', 0)
            .or('es_transferencia_interna.is.null,es_transferencia_interna.eq.false'),
        ]);
        result[c] = {
          total: total ?? 0,
          ultimaFecha: ultimoMov?.[0]?.fecha ?? null,
          primeraFecha: primerMov?.[0]?.fecha ?? null,
          sinGastoCount: sinGasto ?? 0,
        };
      }
      return result;
    },
  });

  // ---- Acciones ----

  async function handleAutoMatch() {
    setProcesando('match');
    setMensaje(null);
    const pendientesAntes = pendientesMatch?.sinConciliar.length ?? 0;
    try {
      const { data, error } = await supabase.rpc('auto_match_gastos_extracto', {
        p_fecha_desde: desde,
        p_fecha_hasta: hasta,
      });
      if (error) throw error;
      const res = data as { conciliados: number; por_pagos: number; por_gasto: number };
      // Segundo paso: transferencias consolidadas (1 transferencia paga N gastos).
      // Vincula los N pagos al movimiento cuando la suma del grupo = monto del retiro.
      let porConsolidado = 0;
      const { data: cons, error: errCons } = await supabase.rpc('conciliar_pagos_consolidados', {
        p_fecha_desde: desde,
        p_fecha_hasta: hasta,
      });
      if (errCons) throw errCons;
      porConsolidado = (cons as { pagos: number })?.pagos ?? 0;
      // Sueldos pagados por transferencia (consolidados: 1 transferencia paga varios empleados)
      const { data: csuel, error: errSuel } = await supabase.rpc('conciliar_sueldos_consolidados', {
        p_fecha_desde: desde,
        p_fecha_hasta: hasta,
      });
      if (errSuel) throw errSuel;
      const porSueldos = (csuel as { pagos: number })?.pagos ?? 0;
      const total = (res?.conciliados ?? 0) + porConsolidado + porSueldos;
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      qc.invalidateQueries({ queryKey: ['gastos_conciliados_ids'] });
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
      if (total > 0) {
        const detalles: string[] = [];
        if ((res?.por_pagos ?? 0) > 0) detalles.push(`${res.por_pagos} por N° de op de pago`);
        if ((res?.por_gasto ?? 0) > 0) detalles.push(`${res.por_gasto} por N° de comprobante`);
        if (porConsolidado > 0) detalles.push(`${porConsolidado} en transferencias consolidadas`);
        if (porSueldos > 0) detalles.push(`${porSueldos} sueldos por transferencia`);
        setMensaje({
          tipo: 'ok',
          texto: `${total} gasto(s) vinculado(s) con su movimiento bancario${
            detalles.length ? ` (${detalles.join(', ')})` : ''
          }.`,
        });
      } else if (pendientesAntes > 0) {
        setMensaje({
          tipo: 'ok',
          texto: `Ningún match. Los ${pendientesAntes} N° de op pendientes no aparecen en el extracto del período. Si los pagos son recientes, importá un extracto más actualizado.`,
        });
      } else {
        setMensaje({ tipo: 'ok', texto: 'No hay pagos pendientes de matchear.' });
      }
    } catch (e: unknown) {
      console.error('[Conciliacion] error:', e);
      setMensaje({ tipo: 'err', texto: `Error: ${formatError(e)}` });
    } finally {
      setProcesando(null);
    }
  }

  async function handleVincular(movId: string, gastoId: string) {
    setMensaje(null);
    try {
      const { error } = await supabase
        .from('movimientos_bancarios')
        .update({ gasto_id: gastoId })
        .eq('id', movId);
      if (error) throw error;
      setMensaje({ tipo: 'ok', texto: 'Movimiento vinculado al gasto cargado.' });
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      qc.invalidateQueries({ queryKey: ['gastos_conciliados_ids'] });
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
    } catch (e: unknown) {
      console.error('[Conciliacion] vincular error:', e);
      setMensaje({ tipo: 'err', texto: `Error al vincular: ${formatError(e)}` });
    }
  }

  // Para cada movimiento sin conciliar, busca gastos cargados con MISMO monto y fecha ±2 días
  function buscarCandidatos(mov: MovimientoSinConciliar): GastoCandidato[] {
    if (!gastosCandidatos) return [];
    return gastosCandidatos.filter((g) => {
      const diffMonto = Math.abs(Number(g.importe_total) - Number(mov.debito));
      const diffD = Math.abs(diffDays(g.fecha, mov.fecha));
      return diffMonto < 1 && diffD <= 2;
    });
  }

  async function handleCrearCargosAutomaticos() {
    setProcesando('cargos');
    setMensaje(null);
    try {
      const { data, error } = await supabase.rpc('crear_cargos_automaticos_bancarios', {
        p_categoria_id: CATEGORIA_BANCARIA_ID,
        p_creado_por: user?.id ?? null,
        p_fecha_desde: desde,
        p_fecha_hasta: hasta,
      });
      if (error) throw error;
      const res = data as { creados: number; monto_total: number };
      setMensaje({
        tipo: 'ok',
        texto: `${res.creados} cargo(s) automáticos creados (${formatARS(Number(res.monto_total ?? 0))}). Categoría: Impuestos y comisiones bancarias · Local: Rodziny S.A.S.`,
      });
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      qc.invalidateQueries({ queryKey: ['gastos'] });
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
      qc.invalidateQueries({ queryKey: ['gastos_conciliados_ids'] });
      qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
    } catch (e: unknown) {
      console.error('[Conciliacion] error:', e);
      setMensaje({ tipo: 'err', texto: `Error: ${formatError(e)}` });
    } finally {
      setProcesando(null);
    }
  }

  // ---- Render ----

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-rodziny-200 bg-rodziny-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-rodziny-900">
              Conciliación de extractos bancarios
            </h3>
            <p className="mt-1 text-xs text-rodziny-700">
              Compara los movimientos del extracto (Galicia, ICBC, MercadoPago) contra los gastos
              cargados. Detecta gastos ya pagados, cargos automáticos del banco que faltan registrar,
              y egresos sin gasto asociado.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="shrink-0 rounded bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
          >
            📥 Importar extracto
          </button>
        </div>
        <p className="mt-2 text-[11px] text-rodziny-600">
          Subí los CSV de Galicia / ICBC / MercadoPago para sumar movimientos nuevos. Después corré
          las acciones de abajo para conciliar.
        </p>
      </div>

      {/* Cards estado por banco — última fecha del extracto + pendientes sin gasto */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(['mercadopago', 'galicia', 'icbc'] as const).map((c) => {
          const e = estadoBancos?.[c];
          const label = c === 'mercadopago' ? 'Mercado Pago' : c === 'galicia' ? 'Banco Galicia' : 'ICBC';
          const emoji = c === 'mercadopago' ? '🟢' : c === 'galicia' ? '🔵' : '🟠';
          const ultima = e?.ultimaFecha;
          let semaforo: 'verde' | 'amarillo' | 'rojo' | 'gris' = 'gris';
          let dias = 0;
          if (ultima) {
            dias = diffDays(ymd(new Date()), ultima);
            if (dias <= 1) semaforo = 'verde';
            else if (dias <= 5) semaforo = 'amarillo';
            else semaforo = 'rojo';
          }
          const colorBorder =
            semaforo === 'verde' ? 'border-green-300 bg-green-50/50'
            : semaforo === 'amarillo' ? 'border-amber-300 bg-amber-50/50'
            : semaforo === 'rojo' ? 'border-red-300 bg-red-50/50'
            : 'border-gray-200 bg-gray-50';
          const isFiltrado = bancoFiltro === c;
          return (
            <button
              type="button"
              key={c}
              onClick={() => setBancoFiltro(isFiltrado ? 'todos' : c)}
              className={cn(
                'rounded-lg border-2 p-3 text-left transition-all hover:shadow-md',
                colorBorder,
                isFiltrado && 'ring-2 ring-rodziny-700 ring-offset-1',
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-semibold text-gray-700">
                    {emoji} {label}
                  </div>
                  <div className="mt-1 text-[10px] text-gray-500">
                    {e?.total ? `${e.total.toLocaleString('es-AR')} movs cargados` : 'Sin movimientos'}
                  </div>
                </div>
                {isFiltrado && (
                  <span className="rounded bg-rodziny-700 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    FILTRADO
                  </span>
                )}
              </div>
              <div className="mt-2 text-[11px] text-gray-700">
                {ultima ? (
                  <>
                    <div>
                      <strong>Último mov:</strong> {ultima}
                      <span className={cn(
                        'ml-1 rounded px-1 py-0.5 text-[9px] font-semibold',
                        semaforo === 'verde' ? 'bg-green-200 text-green-900'
                        : semaforo === 'amarillo' ? 'bg-amber-200 text-amber-900'
                        : 'bg-red-200 text-red-900',
                      )}>
                        {dias === 0 ? 'hoy' : `hace ${dias}d`}
                      </span>
                    </div>
                    {e?.sinGastoCount && e.sinGastoCount > 0 ? (
                      <div className="mt-1 text-gray-600">
                        <strong className="text-amber-800">{e.sinGastoCount}</strong> egresos sin gasto cargado
                      </div>
                    ) : null}
                  </>
                ) : (
                  <span className="italic text-gray-400">Sin extracto importado todavía</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selector de período — todas las vistas y acciones se filtran por este rango */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="ml-2 flex flex-wrap gap-1">
          {[
            { label: 'Mes actual', d: primerDelMes, h: ultimoDelMes },
            { label: 'Mes anterior', d: primerMesAnt, h: ultimoMesAnt },
            { label: 'Año actual', d: primerDelAnio, h: ultimoDelAnio },
            { label: 'Todo', d: '2020-01-01', h: '2099-12-31' },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => aplicarPreset(p.d, p.h)}
              className={cn(
                'rounded px-2 py-1 text-xs',
                desde === p.d && hasta === p.h
                  ? 'bg-rodziny-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {mensaje && (
        <div
          className={cn(
            'rounded border px-3 py-2 text-sm',
            mensaje.tipo === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800',
          )}
        >
          {mensaje.tipo === 'ok' ? '✅ ' : '⚠ '}
          {mensaje.texto}
        </div>
      )}

      {/* Conciliados — visibilidad de qué se vinculó (colapsable) */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
        <button
          type="button"
          onClick={() => setVerConciliados((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <h4 className="text-sm font-semibold text-blue-900">
              🔗 Conciliados en este período
            </h4>
            <p className="mt-1 text-xs text-blue-700">
              Gastos cargados con al menos un movimiento del extracto vinculado.
              Los cargos automáticos (impuestos, comisiones) aparecen consolidados por mes;
              click en la fila para ver los movimientos individuales.
            </p>
          </div>
          <div className="text-right">
            {loadingConciliados ? (
              <div className="h-8 w-12 animate-pulse rounded bg-blue-200" />
            ) : (
              <>
                <div className="text-2xl font-bold text-blue-900 tabular-nums">
                  {(conciliados?.length ?? 0).toLocaleString('es-AR')}
                </div>
                <div className="text-[11px] text-blue-700">
                  {verConciliados ? '▲ ocultar' : '▼ ver detalle'}
                </div>
              </>
            )}
          </div>
        </button>

        {verConciliados && (
          <div className="mt-3 max-h-[28rem] overflow-y-auto rounded border border-blue-100 bg-white">
            {(conciliados?.length ?? 0) === 0 ? (
              <div className="py-4 text-center text-xs text-gray-400">
                Todavía no hay gastos vinculados a movimientos en este período.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 border-b border-blue-100 bg-blue-50 text-blue-900">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium"></th>
                    <th className="px-2 py-1.5 text-left font-medium">Proveedor / Concepto</th>
                    <th className="px-2 py-1.5 text-left font-medium">Fecha gasto</th>
                    <th className="px-2 py-1.5 text-right font-medium">Importe</th>
                    <th className="px-2 py-1.5 text-center font-medium">Movs</th>
                    <th className="px-2 py-1.5 text-right font-medium">Σ Débito movs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-50">
                  {(conciliados ?? []).map((g) => {
                    const isExpanded = expandido.has(g.gasto_id);
                    const desfase = Math.abs(g.importe_total - g.movs_total_debito);
                    // En consolidados (1 transferencia paga varios gastos) el importe del
                    // gasto NO iguala el débito del mov a propósito → no es desfase.
                    const cuadra = g.consolidado || desfase < 1;
                    return (
                      <Fragment key={g.gasto_id}>
                        <tr
                          className="cursor-pointer hover:bg-blue-50/50"
                          onClick={() => toggleExpandir(g.gasto_id)}
                        >
                          <td className="px-2 py-1.5 text-gray-400">
                            {isExpanded ? '▼' : '▶'}
                          </td>
                          <td className="px-2 py-1.5 text-gray-800">
                            <div className="font-medium">
                              {g.proveedor ?? '(sin proveedor)'}
                              {g.consolidado && (
                                <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
                                  transf. compartida
                                </span>
                              )}
                            </div>
                            {g.comentario && (
                              <div className="text-[10px] text-gray-500">
                                {g.comentario.length > 80
                                  ? g.comentario.slice(0, 80) + '…'
                                  : g.comentario}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums text-gray-600">{g.fecha}</td>
                          <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-red-700">
                            {formatARS(g.importe_total)}
                          </td>
                          <td className="px-2 py-1.5 text-center text-gray-700 tabular-nums">
                            {g.n_movs}
                          </td>
                          <td
                            className={cn(
                              'px-2 py-1.5 text-right tabular-nums',
                              cuadra ? 'text-gray-500' : 'font-semibold text-amber-700',
                            )}
                            title={
                              g.consolidado
                                ? `Transferencia consolidada de ${formatARS(g.movs_total_debito)} que paga varios gastos (este es uno de ellos)`
                                : cuadra
                                  ? 'Importe del gasto cuadra con la suma de movimientos'
                                  : `Desfase de ${formatARS(desfase)} entre el importe del gasto y los movimientos vinculados`
                            }
                          >
                            {formatARS(g.movs_total_debito)}
                            {g.consolidado ? (
                              <span className="ml-1 text-[9px] text-blue-600">compartida</span>
                            ) : (
                              !cuadra && ' ⚠'
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-gray-50/50">
                            <td colSpan={6} className="px-2 py-2">
                              <DetalleMovsGasto
                                gastoId={g.gasto_id}
                                onDesvincular={handleDesvincular}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Tabla unificada de movimientos del extracto por procesar */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-800">Movimientos por procesar</h4>
            <p className="mt-1 text-xs text-gray-500">
              Egresos del extracto que aún no están vinculados a un gasto.
              La columna <strong>Estado</strong> dice qué hacer con cada uno:{' '}
              🔵 cargo bancario auto (procesalo con el botón global) ·{' '}
              🟡 hay un gasto cargado que matchea (vincular) ·{' '}
              ⚪ sin match (cargar gasto, pagar facturas o marcar interna).
              Mostramos los 500 más recientes.
            </p>
          </div>
          {/* Toolbar global: 2 acciones masivas */}
          <div className="flex shrink-0 flex-col gap-2">
            <button
              onClick={handleAutoMatch}
              disabled={procesando !== null || (pendientesMatch?.sinConciliar.length ?? 0) === 0}
              title="Vincula los pagos cargados con N° de operación contra los movs del extracto. Si no hay match, el extracto del banco no cubre la fecha del pago."
              className="whitespace-nowrap rounded border border-rodziny-300 bg-rodziny-50 px-3 py-1.5 text-xs font-medium text-rodziny-800 hover:bg-rodziny-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
            >
              {procesando === 'match'
                ? 'Conciliando…'
                : `🔗 Auto-match N° op${
                    loadingMatch ? '' : ` (${pendientesMatch?.sinConciliar.length ?? 0})`
                  }`}
            </button>
            <button
              onClick={handleCrearCargosAutomaticos}
              disabled={procesando !== null || (cargosAuto?.movs.length ?? 0) === 0}
              title="Crea gastos automáticos en categoría 'Impuestos y comisiones bancarias' (Rodziny S.A.S.) para todos los movs etiquetados (Ley 25.413, Comisión MP, IVA bancario, etc.)"
              className="whitespace-nowrap rounded border border-rodziny-300 bg-rodziny-50 px-3 py-1.5 text-xs font-medium text-rodziny-800 hover:bg-rodziny-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
            >
              {procesando === 'cargos'
                ? 'Creando…'
                : `💸 Crear cargos auto${
                    loadingCargos ? '' : ` (${cargosAuto?.movs.length ?? 0})`
                  }`}
            </button>
          </div>
        </div>

        <div className="max-h-[36rem] space-y-1 overflow-y-auto rounded border border-gray-100">
          {loadingMovs ? (
            <div className="py-4 text-center text-xs text-gray-400">Cargando…</div>
          ) : (movsPendientes?.length ?? 0) === 0 ? (
            <div className="py-4 text-center text-xs text-gray-400">
              No hay movimientos pendientes de procesar en este período.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-gray-200 bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Fecha</th>
                  <th className="px-2 py-1.5 text-left font-medium">Cuenta</th>
                  <th className="px-2 py-1.5 text-left font-medium">Descripción</th>
                  <th className="px-2 py-1.5 text-left font-medium">Ref.</th>
                  <th className="px-2 py-1.5 text-right font-medium">Débito</th>
                  <th className="px-2 py-1.5 text-left font-medium">Estado / Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(movsPendientes ?? []).map((m) => {
                  const candidatos = buscarCandidatos(m);
                  const tieneSugerencia = !!m.sugerencia;
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-2 py-1.5 text-gray-600 tabular-nums">{m.fecha}</td>
                      <td className="px-2 py-1.5 uppercase text-gray-500">{m.cuenta}</td>
                      <td className="px-2 py-1.5 text-gray-800">{m.descripcion}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-gray-400">
                        {m.referencia ?? ''}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-red-700">
                        {formatARS(Number(m.debito))}
                      </td>
                      <td className="px-2 py-1.5">
                        {tieneSugerencia ? (
                          <span
                            className="inline-block rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800"
                            title="Cargo automático del banco. Se procesa con 'Crear cargos auto' arriba."
                          >
                            🔵 {m.sugerencia}
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {candidatos.length === 0 ? (
                              <span className="text-[10px] text-gray-400">⚪ sin match</span>
                            ) : candidatos.length === 1 ? (
                              <button
                                type="button"
                                onClick={() => handleVincular(m.id, candidatos[0].id)}
                                className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100"
                                title={`Vincular este movimiento al gasto: ${candidatos[0].proveedor ?? '(sin proveedor)'} · ${formatARS(Number(candidatos[0].importe_total))} · ${candidatos[0].fecha}`}
                              >
                                🟡 {candidatos[0].proveedor ?? 'gasto'} · Vincular
                              </button>
                            ) : (
                              <select
                                onChange={(e) => {
                                  if (e.target.value) handleVincular(m.id, e.target.value);
                                }}
                                defaultValue=""
                                className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[11px] text-amber-900"
                              >
                                <option value="">🟡 {candidatos.length} matches…</option>
                                {candidatos.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.proveedor ?? '(sin proveedor)'} · {c.fecha} ·{' '}
                                    {formatARS(Number(c.importe_total))}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              type="button"
                              onClick={() => setMovParaVincular(m)}
                              className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-800 hover:bg-blue-100"
                              title="Vincular este movimiento a una o varias facturas pendientes (1 transferencia → N facturas)"
                            >
                              💸 Pagar facturas…
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMarcarInterna(m.id)}
                              className="rounded border border-purple-300 bg-purple-50 px-2 py-0.5 text-[11px] text-purple-800 hover:bg-purple-100"
                              title="Marcar como transferencia interna (entre cuentas propias). Lo saca del listado de egresos."
                            >
                              ↔ Interna
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal: subir CSV de extractos (Galicia / ICBC / MP). Al cerrar, refresca queries. */}
      <ImportarExtractoModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={() => {
          // El modal ya corrió aplicar_reglas_sugerencia + auto_match + crear_cargos
          // y muestra el resumen ahí mismo. Acá solo invalidamos las vistas.
          qc.invalidateQueries({ queryKey: ['conciliacion'] });
          qc.invalidateQueries({ queryKey: ['gastos'] });
          qc.invalidateQueries({ queryKey: ['gastos_listado'] });
          qc.invalidateQueries({ queryKey: ['gastos_conciliados_ids'] });
          qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
          setMensaje({ tipo: 'ok', texto: 'Extracto importado y clasificado.' });
        }}
      />

      {/* Modal: vincular un mov a varias facturas pendientes (1-mov-a-N-facturas) */}
      {movParaVincular && (
        <VincularPagosMovModal
          mov={movParaVincular}
          open={!!movParaVincular}
          onClose={() => setMovParaVincular(null)}
          onSuccess={() => {
            setMensaje({
              tipo: 'ok',
              texto: 'Facturas marcadas como pagadas y movimiento vinculado.',
            });
          }}
        />
      )}
    </div>
  );
}

// ─── Detalle de movimientos de un gasto conciliado (carga al expandir) ───────
// Se carga por gasto (sin el límite global del listado, que se llenaba con los
// miles de movs de retenciones/comisiones y dejaba sin detalle a los demás).
// Resuelve los dos modelos: link 1:1 (movimientos.gasto_id) y 1:N (transferencia
// compartida: los pagos del gasto apuntan al movimiento vía conciliado_movimiento_id).
function DetalleMovsGasto({
  gastoId,
  onDesvincular,
}: {
  gastoId: string;
  onDesvincular: (movId: string) => void;
}) {
  const { data: movs, isLoading } = useQuery<MovBancario[]>({
    queryKey: ['conciliacion', 'detalle_movs', gastoId],
    queryFn: async () => {
      // 1:1 — movimientos vinculados directamente
      const { data: directos } = await supabase
        .from('movimientos_bancarios')
        .select('id, fecha, cuenta, descripcion, referencia, debito')
        .eq('gasto_id', gastoId)
        .order('fecha', { ascending: false })
        .limit(500);
      if (directos && directos.length > 0) {
        return directos.map((m) => ({
          id: m.id as string,
          fecha: m.fecha as string,
          descripcion: (m.descripcion as string | null) ?? null,
          debito: Number(m.debito ?? 0),
          cuenta: m.cuenta as string,
          referencia: (m.referencia as string | null) ?? null,
        }));
      }
      // 1:N — transferencia compartida: el mov lo referencian los pagos del gasto
      const { data: pagos } = await supabase
        .from('pagos_gastos')
        .select('conciliado_movimiento_id')
        .eq('gasto_id', gastoId)
        .not('conciliado_movimiento_id', 'is', null);
      const movIds = (pagos ?? [])
        .map((p) => p.conciliado_movimiento_id as string | null)
        .filter((x): x is string => !!x);
      if (movIds.length === 0) return [];
      const { data: compartidos } = await supabase
        .from('movimientos_bancarios')
        .select('id, fecha, cuenta, descripcion, referencia, debito')
        .in('id', movIds);
      return (compartidos ?? []).map((m) => ({
        id: m.id as string,
        fecha: m.fecha as string,
        descripcion: (m.descripcion as string | null) ?? null,
        debito: Number(m.debito ?? 0),
        cuenta: m.cuenta as string,
        referencia: (m.referencia as string | null) ?? null,
      }));
    },
  });

  if (isLoading) {
    return <div className="px-2 py-2 text-[11px] text-gray-400">Cargando detalle…</div>;
  }
  if (!movs || movs.length === 0) {
    return <div className="px-2 py-2 text-[11px] text-gray-400">Sin detalle de movimientos.</div>;
  }

  return (
    <div className="rounded border border-gray-200 bg-white">
      <table className="w-full text-[11px]">
        <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Fecha</th>
            <th className="px-2 py-1 text-left font-medium">Cuenta</th>
            <th className="px-2 py-1 text-left font-medium">Descripción</th>
            <th className="px-2 py-1 text-left font-medium">Ref.</th>
            <th className="px-2 py-1 text-right font-medium">Débito</th>
            <th className="px-2 py-1 text-right font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {movs.map((m) => (
            <tr key={m.id} className="hover:bg-gray-50">
              <td className="px-2 py-1 text-gray-600 tabular-nums">{m.fecha}</td>
              <td className="px-2 py-1 uppercase text-gray-500">{m.cuenta}</td>
              <td className="px-2 py-1 text-gray-700">{m.descripcion}</td>
              <td className="px-2 py-1 font-mono text-[10px] text-gray-400">{m.referencia ?? ''}</td>
              <td className="px-2 py-1 text-right font-semibold tabular-nums text-red-700">
                {formatARS(m.debito)}
              </td>
              <td className="px-2 py-1 text-right">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDesvincular(m.id);
                  }}
                  className="rounded border border-gray-300 px-2 py-0.5 text-[10px] text-gray-500 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                  title="Desvincular este movimiento del gasto"
                >
                  ✕ Desvincular
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

