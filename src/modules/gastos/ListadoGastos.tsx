import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import type { Gasto } from './types';
import { TIPO_COMPROBANTE_LABEL } from './types';
import { NuevoGastoModal } from './NuevoGastoModal';

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
  local: 'vedia' | 'saavedra' | 'ambos';
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
        .order('fecha', { ascending: false })
        .limit(2000);
      if (local !== 'ambos') q = q.eq('local', local);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Gasto[];
    },
  });

  const filtrados = useMemo(() => {
    let lista = gastos ?? [];
    if (filtroEstado === 'pendiente') {
      lista = lista.filter((g) => (g.estado_pago ?? '').toLowerCase() !== 'pagado');
    } else if (filtroEstado === 'pagado') {
      lista = lista.filter((g) => (g.estado_pago ?? '').toLowerCase() === 'pagado');
    }
    if (filtroProveedor) {
      const f = filtroProveedor.toLowerCase();
      lista = lista.filter((g) => (g.proveedor ?? '').toLowerCase().includes(f));
    }
    if (filtroCategoria) {
      lista = lista.filter((g) =>
        (g.categoria ?? '').toLowerCase().includes(filtroCategoria.toLowerCase()),
      );
    }
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      lista = lista.filter(
        (g) =>
          (g.nro_comprobante ?? '').toLowerCase().includes(b) ||
          (g.comentario ?? '').toLowerCase().includes(b) ||
          (g.proveedor ?? '').toLowerCase().includes(b),
      );
    }
    if (filtroSinFactura) {
      lista = lista.filter(requiereFactura);
    }
    return lista;
  }, [gastos, filtroEstado, filtroProveedor, filtroCategoria, busqueda, filtroSinFactura]);

  // Conteo total de gastos que exigen factura y no la tienen — KPI clickeable
  const sinFacturaCount = useMemo(() => (gastos ?? []).filter(requiereFactura).length, [gastos]);

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

  // Lista única de proveedores y categorías para los filtros
  const proveedoresUnicos = useMemo(() => {
    return [...new Set((gastos ?? []).map((g) => g.proveedor).filter(Boolean) as string[])].sort();
  }, [gastos]);
  const categoriasUnicas = useMemo(() => {
    return [...new Set((gastos ?? []).map((g) => g.categoria).filter(Boolean) as string[])].sort();
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
        `¿Eliminar el gasto de ${g.proveedor || 's/proveedor'} por ${formatARS(g.importe_total)}?\n\nNo se puede deshacer.`,
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
                const pagado = (g.estado_pago ?? '').toLowerCase() === 'pagado';
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
                    <td className="px-3 py-2 font-medium text-gray-900">{g.proveedor || '—'}</td>
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
                      <span
                        className={cn(
                          'inline-block rounded px-2 py-0.5 text-[10px] font-medium',
                          pagado ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800',
                        )}
                      >
                        {pagado ? 'Pagado' : 'Pendiente'}
                      </span>
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
