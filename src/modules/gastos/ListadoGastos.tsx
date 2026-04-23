import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import { NuevoGastoModal } from './NuevoGastoModal';
import type { Gasto } from './types';
import { TIPO_COMPROBANTE_LABEL } from './types';

const HOY = new Date();

function primerDiaDelMes(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}
function ultimoDiaDelMes(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
}

type Preset = 'mes_actual' | 'mes_pasado' | 'ultimos_30' | 'anio' | 'personalizado';

// Tipos de comprobante que exigen tener el archivo fiscal (factura_path) adjunto
const TIPOS_REQUIEREN_FACTURA = new Set(['factura_a', 'factura_c', 'remito']);
const requiereFactura = (g: Gasto) =>
  TIPOS_REQUIEREN_FACTURA.has((g.tipo_comprobante ?? '').toLowerCase()) && !g.factura_path;

export function ListadoGastos({ localExterno }: { localExterno?: 'vedia' | 'saavedra' } = {}) {
  const qc = useQueryClient();
  const [localInterno, setLocalInterno] = useState<'ambos' | 'vedia' | 'saavedra'>('vedia');
  const local = localExterno ?? localInterno;
  const [preset, setPreset] = useState<Preset>('mes_actual');
  const [desde, setDesde] = useState(() => primerDiaDelMes(HOY));
  const [hasta, setHasta] = useState(() => ultimoDiaDelMes(HOY));
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'pagado'>('todos');
  const [filtroProveedor, setFiltroProveedor] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroSinFactura, setFiltroSinFactura] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editandoGasto, setEditandoGasto] = useState<Gasto | null>(null);

  function aplicarPreset(p: Preset) {
    setPreset(p);
    const h = new Date();
    if (p === 'mes_actual') {
      setDesde(primerDiaDelMes(h));
      setHasta(ultimoDiaDelMes(h));
    } else if (p === 'mes_pasado') {
      const d = new Date(h.getFullYear(), h.getMonth() - 1, 1);
      setDesde(primerDiaDelMes(d));
      setHasta(ultimoDiaDelMes(d));
    } else if (p === 'ultimos_30') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setDesde(d.toISOString().split('T')[0]);
      setHasta(h.toISOString().split('T')[0]);
    } else if (p === 'anio') {
      setDesde(`${h.getFullYear()}-01-01`);
      setHasta(`${h.getFullYear()}-12-31`);
    }
  }

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

  // Conteo total de gastos que exigen factura y no la tienen — para el KPI
  const sinFacturaCount = useMemo(() => (gastos ?? []).filter(requiereFactura).length, [gastos]);

  const totales = useMemo(() => {
    return filtrados.reduce(
      (acc, g) => {
        acc.neto += Number(g.importe_neto ?? 0);
        acc.iva += Number(g.iva ?? 0);
        acc.total += Number(g.importe_total ?? 0);
        acc.cantidad += 1;
        if ((g.estado_pago ?? '').toLowerCase() === 'pagado')
          acc.pagado += Number(g.importe_total ?? 0);
        else acc.pendiente += Number(g.importe_total ?? 0);
        return acc;
      },
      { neto: 0, iva: 0, total: 0, cantidad: 0, pagado: 0, pendiente: 0 },
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
  }

  return (
    <div>
      {/* Filtros principales (línea 1) */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {!localExterno && (
          <LocalSelector
            value={localInterno}
            onChange={(v) => setLocalInterno(v as 'ambos' | 'vedia' | 'saavedra')}
            options={['vedia', 'saavedra', 'ambos']}
          />
        )}
        <select
          value={preset}
          onChange={(e) => aplicarPreset(e.target.value as Preset)}
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs"
        >
          <option value="mes_actual">Mes actual</option>
          <option value="mes_pasado">Mes pasado</option>
          <option value="ultimos_30">Últimos 30 días</option>
          <option value="anio">Año en curso</option>
          <option value="personalizado">Personalizado</option>
        </select>
        <input
          type="date"
          value={desde}
          onChange={(e) => {
            setDesde(e.target.value);
            setPreset('personalizado');
          }}
          className="rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
        <span className="text-xs text-gray-400">→</span>
        <input
          type="date"
          value={hasta}
          onChange={(e) => {
            setHasta(e.target.value);
            setPreset('personalizado');
          }}
          className="rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
        <button
          onClick={() => {
            setEditandoGasto(null);
            setModalOpen(true);
          }}
          className="ml-auto rounded-md bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
        >
          + Nuevo gasto
        </button>
      </div>

      {/* Filtros secundarios (línea 2) */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
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
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Cantidad</div>
          <div className="mt-0.5 text-lg font-bold text-gray-900">{totales.cantidad}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Total</div>
          <div className="mt-0.5 text-lg font-bold text-gray-900">{formatARS(totales.total)}</div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 bg-white px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-amber-700">
            Pendiente de pago
          </div>
          <div className="mt-0.5 text-lg font-bold text-amber-900">
            {formatARS(totales.pendiente)}
          </div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 bg-white px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-green-700">Pagado</div>
          <div className="mt-0.5 text-lg font-bold text-green-900">{formatARS(totales.pagado)}</div>
        </div>
        <button
          type="button"
          onClick={() => setFiltroSinFactura((v) => !v)}
          className={cn(
            'rounded-lg border px-4 py-3 text-left transition-colors',
            sinFacturaCount === 0
              ? 'cursor-default border-gray-200 bg-gray-50'
              : filtroSinFactura
                ? 'border-red-300 bg-red-100 ring-1 ring-red-200'
                : 'cursor-pointer border-red-200 bg-red-50 hover:bg-red-100',
          )}
          disabled={sinFacturaCount === 0}
          title="Gastos con tipo Factura A/C o Remito que no tienen el archivo fiscal adjunto"
        >
          <div className="text-[10px] uppercase tracking-wide text-red-700">
            ⚠ Sin factura adjunta
          </div>
          <div className="mt-0.5 text-lg font-bold text-red-900">{sinFacturaCount}</div>
          {filtroSinFactura && (
            <div className="mt-0.5 text-[9px] text-red-700">Filtro activo · click para quitar</div>
          )}
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
                        onClick={() => {
                          setEditandoGasto(g);
                          setModalOpen(true);
                        }}
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

      {modalOpen && (
        <NuevoGastoModal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setEditandoGasto(null);
          }}
          gastoEditando={editandoGasto}
        />
      )}
    </div>
  );
}
