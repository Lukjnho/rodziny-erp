import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import type { Gasto } from './types';
import { TIPO_COMPROBANTE_LABEL, MEDIO_PAGO_LABEL } from './types';
import { NuevoGastoModal } from './NuevoGastoModal';

// Normaliza el estado_pago para evitar mismatches por capitalización
// (datos viejos: "Pagado", "pagado", "Pendiente", "A pagar", "Parcial")
function estadoNormalizado(g: Gasto): 'pagado' | 'parcial' | 'pendiente' {
  const v = (g.estado_pago ?? '').toLowerCase().trim();
  if (v === 'pagado') return 'pagado';
  if (v === 'parcial') return 'parcial';
  return 'pendiente';
}

// Tipos de comprobante que exigen tener el archivo fiscal (factura_path) adjunto
const TIPOS_REQUIEREN_FACTURA = new Set(['factura_a', 'factura_c', 'remito']);
const requiereFactura = (g: Gasto) =>
  TIPOS_REQUIEREN_FACTURA.has((g.tipo_comprobante ?? '').toLowerCase()) && !g.factura_path;

function primerDiaDelMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}
function ultimoDiaDelMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
}

interface Props {
  local: 'vedia' | 'saavedra' | 'ambos' | 'sas';
  desde?: string;       // default: primer día del mes
  hasta?: string;       // default: último día del mes
  onEditar?: (g: Gasto) => void; // si no viene, usa modal interno (modo standalone)
}

export function ListadoGastos({
  local,
  desde = primerDiaDelMes(),
  hasta = ultimoDiaDelMes(),
  onEditar,
}: Props) {
  const qc = useQueryClient();
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'pagado'>('todos');
  // Fallback: modal interno cuando no hay `onEditar` externo (ComprasPage embebido)
  const [modalInternoOpen, setModalInternoOpen] = useState(false);
  const [gastoEditandoInterno, setGastoEditandoInterno] = useState<Gasto | null>(null);
  const handleEditar = (g: Gasto) => {
    if (onEditar) onEditar(g);
    else {
      setGastoEditandoInterno(g);
      setModalInternoOpen(true);
    }
  };
  const [filtroProveedor, setFiltroProveedor] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroMedioPago, setFiltroMedioPago] = useState('');
  const [filtroSinFactura, setFiltroSinFactura] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  const { data: gastos, isLoading } = useQuery({
    queryKey: ['gastos_listado', local, desde, hasta],
    queryFn: async () => {
      let q = supabase
        .from('gastos')
        .select('*')
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .neq('cancelado', true)
        // Último cargado primero. Tiebreaker por fecha del comprobante para los gastos viejos
        // que fueron backfilleados con created_at = fecha::timestamptz.
        .order('created_at', { ascending: false })
        .order('fecha', { ascending: false })
        .limit(2000);
      if (local !== 'ambos') q = q.eq('local', local);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Gasto[];
    },
  });

  // Mapa proveedor_id → datos del proveedor maestro (display + todos los nombres alternativos).
  // - `display` = nombre_comercial ?? razon_social → lo que mostramos en la columna.
  // - `nombres` = razón social + nombre comercial + aliases → espacio de búsqueda.
  //   Así buscar "MACLAR" devuelve también los gastos cargados como "FRESH Dist.".
  interface ProveedorInfo {
    display: string;
    nombres: string;  // todos los nombres concatenados en minúsculas, para .includes()
  }
  const { data: proveedoresMap } = useQuery({
    queryKey: ['gastos_proveedores_display'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proveedores')
        .select('id, razon_social, nombre_comercial, aliases');
      if (error) throw error;
      const map = new Map<string, ProveedorInfo>();
      for (const p of data ?? []) {
        const display = (p.nombre_comercial?.trim() || p.razon_social?.trim() || '').trim();
        if (!display) continue;
        const nombres = [p.razon_social, p.nombre_comercial, ...((p.aliases as string[] | null) ?? [])]
          .filter(Boolean)
          .map((s) => (s as string).toLowerCase())
          .join(' | ');
        map.set(p.id as string, { display, nombres });
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Display canónico del proveedor: nombre del registro maestro si está vinculado,
  // si no, el texto crudo del campo `gastos.proveedor`.
  const proveedorDisplay = (g: Gasto): string => {
    if (g.proveedor_id) {
      const canon = proveedoresMap?.get(g.proveedor_id);
      if (canon) return canon.display;
    }
    return g.proveedor ?? '';
  };

  // Espacio de búsqueda del proveedor para un gasto: todos sus nombres alternativos.
  // Si tiene proveedor_id → incluye razón social + nombre comercial + aliases del maestro.
  // Si no → solo el texto crudo del campo.
  const proveedorSearchSpace = (g: Gasto): string => {
    const partes: string[] = [];
    if (g.proveedor) partes.push(g.proveedor.toLowerCase());
    if (g.proveedor_id) {
      const canon = proveedoresMap?.get(g.proveedor_id);
      if (canon) partes.push(canon.nombres);
    }
    return partes.join(' | ');
  };

  // IDs de gastos que ya tienen un movimiento bancario vinculado (= conciliados con extracto)
  const { data: gastosConciliadosSet } = useQuery({
    queryKey: ['gastos_conciliados_ids', local, desde, hasta, gastos?.length ?? 0],
    enabled: !!gastos && gastos.length > 0,
    queryFn: async () => {
      const ids = (gastos ?? []).map((g) => g.id);
      const set = new Set<string>();
      const PAGE = 800;
      for (let i = 0; i < ids.length; i += PAGE) {
        const batch = ids.slice(i, i + PAGE);
        const { data } = await supabase
          .from('movimientos_bancarios')
          .select('gasto_id')
          .in('gasto_id', batch);
        for (const m of data ?? []) {
          if (m.gasto_id) set.add(m.gasto_id as string);
        }
      }
      return set;
    },
  });

  // Suma de pagos por gasto — para mostrar progreso en parciales
  const { data: pagosPorGasto } = useQuery({
    queryKey: ['gastos_pagos_map', local, desde, hasta, gastos?.length ?? 0],
    enabled: !!gastos && gastos.length > 0,
    queryFn: async () => {
      const ids = (gastos ?? []).map((g) => g.id);
      const map = new Map<string, number>();
      const PAGE = 800;
      for (let i = 0; i < ids.length; i += PAGE) {
        const batch = ids.slice(i, i + PAGE);
        const { data } = await supabase
          .from('pagos_gastos')
          .select('gasto_id, monto')
          .in('gasto_id', batch);
        for (const p of data ?? []) {
          if (p.gasto_id) {
            map.set(p.gasto_id as string, (map.get(p.gasto_id as string) ?? 0) + Number(p.monto ?? 0));
          }
        }
      }
      return map;
    },
  });

  const filtrados = useMemo(() => {
    let lista = gastos ?? [];
    if (filtroEstado === 'pendiente') {
      // "Pendientes" incluye Parciales (todavía deben algo)
      lista = lista.filter((g) => estadoNormalizado(g) !== 'pagado');
    } else if (filtroEstado === 'pagado') {
      lista = lista.filter((g) => estadoNormalizado(g) === 'pagado');
    }
    if (filtroProveedor) {
      // Filtra por display canónico, así "FRESH Distribuidora" agrupa todos los textos
      lista = lista.filter((g) => proveedorDisplay(g) === filtroProveedor);
    }
    if (filtroCategoria) {
      lista = lista.filter((g) =>
        (g.categoria ?? '').toLowerCase().includes(filtroCategoria.toLowerCase()),
      );
    }
    if (filtroMedioPago) {
      lista = lista.filter((g) => (g.medio_pago ?? '') === filtroMedioPago);
    }
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      lista = lista.filter(
        (g) =>
          (g.nro_comprobante ?? '').toLowerCase().includes(b) ||
          (g.comentario ?? '').toLowerCase().includes(b) ||
          // Buscar en todos los nombres del proveedor (razón social + fantasía + aliases)
          proveedorSearchSpace(g).includes(b),
      );
    }
    if (filtroSinFactura) {
      lista = lista.filter(requiereFactura);
    }
    return lista;
    // proveedorDisplay depende de proveedoresMap (lo incluimos en deps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gastos, filtroEstado, filtroProveedor, filtroCategoria, filtroMedioPago, busqueda, filtroSinFactura, proveedoresMap]);

  // Conteo total de gastos que exigen factura y no la tienen — KPI clickeable
  const sinFacturaCount = useMemo(() => (gastos ?? []).filter(requiereFactura).length, [gastos]);

  // KPI: cantidad y saldo total de gastos pendientes (Pendiente + Parcial)
  const pendientesKpi = useMemo(() => {
    const pendientes = (gastos ?? []).filter((g) => estadoNormalizado(g) !== 'pagado');
    const saldo = pendientes.reduce((s, g) => {
      const yaPagado = pagosPorGasto?.get(g.id) ?? 0;
      return s + Math.max(0, Number(g.importe_total) - yaPagado);
    }, 0);
    return { cantidad: pendientes.length, saldo };
  }, [gastos, pagosPorGasto]);

  const totales = useMemo(() => {
    return filtrados.reduce(
      (acc, g) => {
        acc.neto += Number(g.importe_neto ?? 0);
        acc.iva += Number(g.iva ?? 0);
        acc.total += Number(g.importe_total ?? 0);
        acc.cantidad += 1;
        return acc;
      },
      { neto: 0, iva: 0, total: 0, cantidad: 0 },
    );
  }, [filtrados]);

  // Lista única de proveedores para el filtro — usando el display canónico, no el texto crudo.
  // Así el dropdown muestra "FRESH Distribuidora" una sola vez en lugar de FRESH / FRESH Dist. / MACLAR SRL.
  const proveedoresUnicos = useMemo(() => {
    const set = new Set<string>();
    for (const g of gastos ?? []) {
      const nombre = proveedorDisplay(g);
      if (nombre) set.add(nombre);
    }
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gastos, proveedoresMap]);
  const categoriasUnicas = useMemo(() => {
    return [...new Set((gastos ?? []).map((g) => g.categoria).filter(Boolean) as string[])].sort();
  }, [gastos]);
  // Solo mostramos en el dropdown los medios que aparecen en el período cargado
  const mediosPagoUnicos = useMemo(() => {
    return [...new Set((gastos ?? []).map((g) => g.medio_pago).filter(Boolean) as string[])].sort();
  }, [gastos]);

  async function abrirComprobante(g: Gasto, tipo: 'pago' | 'factura' = 'pago') {
    const path = tipo === 'factura' ? g.factura_path : g.comprobante_path;
    if (!path) return;
    // Buckets posibles según el flujo de carga:
    //  - 'gastos-comprobantes': subida desde el modal Nuevo gasto (pago o factura)
    //  - 'comprobantes': bucket histórico
    //  - 'recepciones-fotos': solo para comprobante_path cuando vino de /recepcion (típico en Saavedra)
    const BUCKETS =
      tipo === 'factura'
        ? ['gastos-comprobantes', 'comprobantes']
        : ['gastos-comprobantes', 'comprobantes', 'recepciones-fotos'];
    let signedUrl: string | null = null;
    let ultimoError: string | null = null;
    for (const bucket of BUCKETS) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
      if (!error && data?.signedUrl) {
        signedUrl = data.signedUrl;
        break;
      }
      ultimoError = error?.message ?? 'sin datos';
    }
    if (!signedUrl) {
      window.alert(`No se pudo abrir el archivo.\n\nPath: ${path}\nError: ${ultimoError}`);
      return;
    }
    window.open(signedUrl, '_blank');
  }

  async function eliminarGasto(g: Gasto) {
    if (
      !window.confirm(
        `¿Eliminar el gasto de ${proveedorDisplay(g) || 's/proveedor'} por ${formatARS(g.importe_total)}?\n\nNo se puede deshacer.`,
      )
    )
      return;
    const { error } = await supabase.from('gastos').update({ cancelado: true }).eq('id', g.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ['gastos_listado'] });
    qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
  }

  return (
    <div>
      {/* Filtros secundarios */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por proveedor, n° comprobante o comentario..."
          className="min-w-[240px] flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
        <select
          value={filtroProveedor}
          onChange={(e) => setFiltroProveedor(e.target.value)}
          className="max-w-[180px] rounded border border-gray-300 bg-white px-2 py-1.5 text-xs"
        >
          <option value="">Todos los proveedores</option>
          {proveedoresUnicos.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={filtroCategoria}
          onChange={(e) => setFiltroCategoria(e.target.value)}
          className="max-w-[180px] rounded border border-gray-300 bg-white px-2 py-1.5 text-xs"
        >
          <option value="">Todas las categorías</option>
          {categoriasUnicas.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filtroMedioPago}
          onChange={(e) => setFiltroMedioPago(e.target.value)}
          className="max-w-[180px] rounded border border-gray-300 bg-white px-2 py-1.5 text-xs"
          title="Filtrar por medio de pago (solo gastos pagados/parciales)"
        >
          <option value="">Todos los medios</option>
          {mediosPagoUnicos.map((m) => (
            <option key={m} value={m}>
              {MEDIO_PAGO_LABEL[m as keyof typeof MEDIO_PAGO_LABEL] ?? m}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {(['todos', 'pendiente', 'pagado'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFiltroEstado(s)}
              className={cn(
                'rounded border px-2 py-1 text-xs',
                filtroEstado === s
                  ? 'border-rodziny-700 bg-rodziny-700 text-white'
                  : 'border-gray-300 bg-white text-gray-600',
              )}
            >
              {s === 'todos' ? 'Todos' : s === 'pendiente' ? 'Pendientes' : 'Pagados'}
            </button>
          ))}
        </div>
        {/* KPI clickeable: a pagar */}
        <button
          type="button"
          onClick={() => setFiltroEstado(filtroEstado === 'pendiente' ? 'todos' : 'pendiente')}
          disabled={pendientesKpi.cantidad === 0}
          className={cn(
            'rounded border px-2 py-1 text-xs',
            pendientesKpi.cantidad === 0
              ? 'cursor-default border-gray-200 bg-gray-50 text-gray-400'
              : filtroEstado === 'pendiente'
                ? 'border-amber-400 bg-amber-100 text-amber-900 ring-1 ring-amber-200'
                : 'cursor-pointer border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
          )}
          title="Total a pagar (gastos Pendientes + saldo de Parciales)"
        >
          📋 A pagar: {pendientesKpi.cantidad} · {formatARS(pendientesKpi.saldo)}
        </button>
        <button
          type="button"
          onClick={() => setFiltroSinFactura((v) => !v)}
          disabled={sinFacturaCount === 0}
          className={cn(
            'rounded border px-2 py-1 text-xs',
            sinFacturaCount === 0
              ? 'cursor-default border-gray-200 bg-gray-50 text-gray-400'
              : filtroSinFactura
                ? 'border-red-300 bg-red-100 text-red-800 ring-1 ring-red-200'
                : 'cursor-pointer border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
          )}
          title="Gastos con tipo Factura A/C o Remito que no tienen el archivo fiscal adjunto"
        >
          ⚠ Sin factura: {sinFacturaCount}
        </button>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr className="uppercase text-gray-500">
                <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                <th className="px-3 py-2 text-left font-semibold">Proveedor</th>
                <th className="px-3 py-2 text-left font-semibold">Categoría</th>
                <th className="px-3 py-2 text-left font-semibold">Comprobante</th>
                <th className="px-3 py-2 text-left font-semibold">Comentario</th>
                <th className="px-3 py-2 text-right font-semibold">Neto</th>
                <th className="px-3 py-2 text-right font-semibold">IVA</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
                <th className="px-3 py-2 text-center font-semibold">Estado</th>
                <th className="px-3 py-2 text-center font-semibold">Adj.</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-gray-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!isLoading && filtrados.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-gray-400">
                    Sin gastos en este rango
                  </td>
                </tr>
              )}
              {filtrados.map((g) => {
                const estado = estadoNormalizado(g);
                const pagado = estado === 'pagado';
                const yaPagado = pagosPorGasto?.get(g.id) ?? 0;
                const saldoRestante = Math.max(0, Number(g.importe_total) - yaPagado);
                const hoyIso = new Date().toISOString().slice(0, 10);
                const vencido = !pagado && g.fecha_vencimiento && g.fecha_vencimiento < hoyIso;
                const tipoLabel = g.tipo_comprobante
                  ? (TIPO_COMPROBANTE_LABEL[
                      g.tipo_comprobante as keyof typeof TIPO_COMPROBANTE_LABEL
                    ] ?? g.tipo_comprobante)
                  : '—';
                return (
                  <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                      {formatFecha(g.fecha)}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900" title={
                      // Si el texto crudo difiere del display canónico, mostrarlo en tooltip
                      g.proveedor_id && g.proveedor && g.proveedor !== proveedorDisplay(g)
                        ? `Cargado como: ${g.proveedor}`
                        : undefined
                    }>{proveedorDisplay(g) || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{g.categoria || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">
                      <span className="text-[10px] text-gray-400">{tipoLabel}</span>
                      {g.nro_comprobante && (
                        <span className="ml-1 text-gray-700">{g.nro_comprobante}</span>
                      )}
                    </td>
                    <td
                      className="max-w-[200px] truncate px-3 py-2 text-gray-600"
                      title={g.comentario ?? ''}
                    >
                      {g.comentario || '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {g.importe_neto ? formatARS(Number(g.importe_neto)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                      {g.iva ? formatARS(Number(g.iva)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                      {formatARS(g.importe_total)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span
                          className={cn(
                            'inline-block rounded px-2 py-0.5 text-[10px] font-medium',
                            estado === 'pagado'
                              ? 'bg-green-100 text-green-800'
                              : estado === 'parcial'
                                ? 'bg-orange-100 text-orange-800'
                                : 'bg-amber-100 text-amber-800',
                          )}
                        >
                          {estado === 'pagado' ? 'Pagado' : estado === 'parcial' ? 'Parcial' : 'Pendiente'}
                        </span>
                        {estado === 'parcial' && (
                          <span className="text-[9px] tabular-nums text-orange-700" title={`Pagado ${formatARS(yaPagado)} de ${formatARS(g.importe_total)}`}>
                            {formatARS(yaPagado)} / {formatARS(g.importe_total)}
                          </span>
                        )}
                        {!pagado && g.fecha_vencimiento && (
                          <span
                            className={cn(
                              'text-[9px] font-medium',
                              vencido ? 'text-red-600' : 'text-gray-500',
                            )}
                            title={vencido ? 'Vencido — pagar ya' : 'Fecha de vencimiento'}
                          >
                            {vencido ? '⚠ Vencido ' : 'Vence '}
                            {formatFecha(g.fecha_vencimiento)}
                          </span>
                        )}
                        {gastosConciliadosSet?.has(g.id) && (
                          <span
                            className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-800"
                            title="Vinculado a su movimiento del extracto bancario"
                          >
                            🔗 Conciliado
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {g.comprobante_path ? (
                          <button
                            onClick={() => abrirComprobante(g, 'pago')}
                            className="text-xs text-blue-600 hover:text-blue-800"
                            title="Ver comprobante de pago"
                          >
                            📎
                          </button>
                        ) : null}
                        {g.factura_path ? (
                          <button
                            onClick={() => abrirComprobante(g, 'factura')}
                            className="text-xs text-emerald-600 hover:text-emerald-800"
                            title="Ver factura"
                          >
                            🧾
                          </button>
                        ) : requiereFactura(g) ? (
                          <span
                            className="cursor-help text-xs text-amber-500"
                            title={`Falta adjuntar la ${TIPO_COMPROBANTE_LABEL[(g.tipo_comprobante ?? 'factura_a') as keyof typeof TIPO_COMPROBANTE_LABEL] ?? g.tipo_comprobante}`}
                          >
                            ⚠
                          </span>
                        ) : null}
                        {!g.comprobante_path && !g.factura_path && !requiereFactura(g) && (
                          <span className="text-gray-300">—</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        onClick={() => handleEditar(g)}
                        className="mr-1 text-[10px] text-rodziny-700 hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => eliminarGasto(g)}
                        className="text-[10px] text-red-500 hover:underline"
                      >
                        Borrar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtrados.length > 0 && (
              <tfoot className="border-t border-gray-300 bg-gray-100">
                <tr className="font-semibold">
                  <td colSpan={5} className="px-3 py-2 text-right text-gray-600">
                    TOTALES ({totales.cantidad}):
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatARS(totales.neto)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatARS(totales.iva)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatARS(totales.total)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Modal interno (sólo en modo standalone — embeds como ComprasPage) */}
      {!onEditar && modalInternoOpen && (
        <NuevoGastoModal
          open={modalInternoOpen}
          onClose={() => {
            setModalInternoOpen(false);
            setGastoEditandoInterno(null);
          }}
          gastoEditando={gastoEditandoInterno}
        />
      )}

    </div>
  );
}
