import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, cn } from '@/lib/utils';
import { usePackagingProducto, type CanalPackaging } from '../hooks/usePackagingProducto';
import {
  useAdicionalesProducto,
  type CanalAdicional,
  type OrigenAdicional,
} from '../hooks/useAdicionalesProducto';
import { useCostoCompleto, type Canal } from '../hooks/useCostoCompleto';
import { useComisionMpConfig } from '../hooks/useComisionMpConfig';

interface InsumoOpcion {
  id: string;
  nombre: string;
  unidad: string;
  costo_unitario: number | null;
  es_packaging: boolean;
}

export const CANALES: { value: Canal; label: string; icon: string }[] = [
  { value: 'plato', label: 'Plato (servicio)', icon: '🍝' },
  { value: 'vianda', label: 'Vianda', icon: '🥡' },
  { value: 'congelado', label: 'Congelado', icon: '❄️' },
];

// ─── Card Waterfall ─────────────────────────────────────────────────────────
export function WaterfallCard({
  costo,
  medio,
  setMedio,
  soloCosto = false,
}: {
  costo: ReturnType<typeof useCostoCompleto>;
  medio: string;
  setMedio: (m: string) => void;
  // En el tab Costeo solo interesa el costo de la receta. El precio/margen
  // (despeje, sugerido, comisión, alertas de precio) vive en el tab Menú.
  soloCosto?: boolean;
}) {
  const { data: comisiones } = useComisionMpConfig();
  if (!costo) return null;

  const colorAlerta = (n: 'rojo' | 'amarillo' | 'info') =>
    n === 'rojo'
      ? 'border-red-200 bg-red-50 text-red-800'
      : n === 'amarillo'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-blue-200 bg-blue-50 text-blue-800';

  return (
    <section className="rounded-lg border border-rodziny-200 bg-gradient-to-br from-rodziny-50 to-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-rodziny-800">📊 Costo total (waterfall)</h3>
          <p className="text-[11px] text-gray-600">
            Categoría: <strong className="capitalize">{costo.categoria}</strong> · Canal:{' '}
            <strong>{costo.canal}</strong>
          </p>
        </div>
        {!soloCosto && (
          <div>
            <label className="mr-1 text-[10px] uppercase text-gray-500">Comisión estimada</label>
            <select
              value={medio}
              onChange={(e) => setMedio(e.target.value)}
              className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px]"
            >
              {(comisiones ?? []).map((c) => (
                <option key={c.medio_pago} value={c.medio_pago}>
                  {c.medio_pago} ({(c.pct * 100).toFixed(1)}%)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {costo.isLoading && <div className="text-xs text-gray-400">Calculando costos…</div>}

      <div className={cn('grid gap-3', !soloCosto && 'md:grid-cols-2')}>
        <div className="rounded border border-gray-200 bg-white p-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            De materia prima a costo total
          </div>
          <table className="w-full text-xs">
            <tbody>
              {costo.capas.map((c) => (
                <tr
                  key={c.id}
                  className={cn('border-b border-gray-100', c.esResultado && 'bg-rodziny-50')}
                >
                  <td className={cn('px-2 py-1.5', c.esResultado && 'font-semibold')}>
                    {c.label}
                    {c.detalle && (
                      <div className="text-[9px] font-normal text-gray-400">{c.detalle}</div>
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right tabular-nums',
                      c.esResultado && 'font-bold text-rodziny-900',
                    )}
                  >
                    {formatARS(c.monto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!soloCosto && (
        <div className="space-y-2">
          <div className="rounded border border-rodziny-300 bg-white p-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Precio sugerido (markup {(costo.markup * 100).toFixed(0)}%)
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-600">
                Costo × {(1 + costo.markup).toFixed(2)} →{' '}
                {formatARS(costo.precioSugeridoSinRedondeo)}
              </span>
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-rodziny-700">
              {formatARS(costo.precioSugerido)}
            </div>
            <div className="mt-1 text-[10px] text-gray-400">
              Redondeado a múltiplos por config de categoría
            </div>
          </div>

          {costo.precioActual ? (
            <div className="rounded border border-gray-200 bg-white p-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Despeje del precio actual ({formatARS(costo.precioActual)})
              </div>
              <table className="w-full text-xs">
                <tbody>
                  <tr className="border-b border-gray-100">
                    <td className="px-2 py-1">Precio facturado</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatARS(costo.precioActual)}
                    </td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-2 py-1 text-gray-500">− IVA contenido (21/121)</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-500">
                      −{formatARS(costo.ivaContenido ?? 0)}
                    </td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-2 py-1 text-gray-500">= Precio neto</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatARS(costo.precioNeto ?? 0)}
                    </td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-2 py-1 text-gray-500">− Comisión MP ({medio})</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-500">
                      −{formatARS(costo.comisionMp ?? 0)}
                    </td>
                  </tr>
                  <tr className="border-b border-gray-100 bg-blue-50/40">
                    <td className="px-2 py-1 font-medium">= Te queda neto</td>
                    <td className="px-2 py-1 text-right font-medium tabular-nums">
                      {formatARS(costo.precioRecibido ?? 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-2 py-1 text-gray-500">− Costo total</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-500">
                      −{formatARS(costo.costoTotal)}
                    </td>
                  </tr>
                  <tr className="bg-rodziny-50">
                    <td className="px-2 py-1 font-semibold">= Margen ($)</td>
                    <td
                      className={cn(
                        'px-2 py-1 text-right font-bold tabular-nums',
                        (costo.margenAbs ?? 0) > 0 ? 'text-green-700' : 'text-red-700',
                      )}
                    >
                      {formatARS(costo.margenAbs ?? 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-2 py-1 text-gray-500">Margen sobre precio</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {costo.margenPctSobrePrecio != null
                        ? `${(costo.margenPctSobrePrecio * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-2 py-1 text-gray-500">Markup real sobre costo</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {costo.markupRealSobreCosto != null
                        ? `${(costo.markupRealSobreCosto * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Producto sin precio de venta cargado. El precio se carga en el tab Menú.
            </div>
          )}
        </div>
        )}
      </div>

      {!soloCosto && costo.alertas.length > 0 && (
        <div className="mt-3 space-y-1">
          {costo.alertas.map((a, i) => (
            <div key={i} className={cn('rounded border px-3 py-2 text-xs', colorAlerta(a.nivel))}>
              {a.mensaje}
            </div>
          ))}
        </div>
      )}

      {costo.warnings.length > 0 && (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-2 text-[10px] text-gray-500">
          <div className="mb-1 font-medium text-gray-600">Notas de cálculo:</div>
          <ul className="list-inside list-disc space-y-0.5">
            {costo.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ─── Card Packaging ─────────────────────────────────────────────────────────
export function PackagingCard({
  cocinaProductoId,
  canalFiltro,
}: {
  cocinaProductoId: string;
  canalFiltro: CanalPackaging;
}) {
  const { data: items, agregar, actualizar, eliminar } = usePackagingProducto(cocinaProductoId);
  const [agregando, setAgregando] = useState(false);

  const { data: insumos } = useQuery({
    queryKey: ['insumos-packaging-opciones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, unidad, costo_unitario, es_packaging')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as InsumoOpcion[];
    },
  });

  const itemsVisibles = useMemo(() => {
    return (items ?? []).filter((i) => i.canal === 'todos' || i.canal === canalFiltro);
  }, [items, canalFiltro]);

  const subtotal = useMemo(() => {
    return itemsVisibles.reduce((acc, i) => acc + i.cantidad * (i.insumo_costo_unitario ?? 0), 0);
  }, [itemsVisibles]);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">📦 Packaging</h3>
          <p className="text-[11px] text-gray-500">
            Insumos no comestibles que se usan al vender este producto en{' '}
            <strong>{CANALES.find((c) => c.value === canalFiltro)?.label.toLowerCase()}</strong>.
            Los marcados como "todos" aplican a cualquier canal.
          </p>
        </div>
        <button
          onClick={() => setAgregando(true)}
          className="rounded bg-rodziny-700 px-3 py-1.5 text-xs text-white hover:bg-rodziny-800"
        >
          + Agregar
        </button>
      </div>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Insumo</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2">Canal</th>
              <th className="px-3 py-2 text-right">Costo unit.</th>
              <th className="px-3 py-2 text-right">Subtotal</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {itemsVisibles.map((i) => (
              <tr key={i.id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <div className="font-medium">{i.insumo_nombre}</div>
                  <div className="text-[10px] text-gray-400">{i.insumo_unidad}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <input
                    type="number"
                    step="0.5"
                    value={i.cantidad}
                    onChange={(e) =>
                      actualizar.mutate({
                        id: i.id,
                        patch: { cantidad: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="w-16 rounded border border-gray-300 px-2 py-0.5 text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={i.canal}
                    onChange={(e) =>
                      actualizar.mutate({
                        id: i.id,
                        patch: { canal: e.target.value as CanalPackaging },
                      })
                    }
                    className="rounded border border-gray-300 px-1 py-0.5 text-[11px]"
                  >
                    <option value="todos">Todos</option>
                    <option value="plato">Plato</option>
                    <option value="vianda">Vianda</option>
                    <option value="congelado">Congelado</option>
                  </select>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                  {formatARS(i.insumo_costo_unitario)}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {formatARS(i.cantidad * i.insumo_costo_unitario)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => eliminar.mutate(i.id)}
                    className="text-red-500 hover:text-red-700"
                    title="Eliminar"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {agregando && insumos && (
              <FormAgregarPackaging
                insumos={insumos}
                canalDefault={canalFiltro}
                onCancel={() => setAgregando(false)}
                onAdd={async (payload) => {
                  await agregar.mutateAsync(payload);
                  setAgregando(false);
                }}
              />
            )}
            {!itemsVisibles.length && !agregando && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-gray-400">
                  Sin packaging cargado para este canal
                </td>
              </tr>
            )}
          </tbody>
          {itemsVisibles.length > 0 && (
            <tfoot className="bg-gray-50 text-xs">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right font-medium text-gray-600">
                  Subtotal packaging:
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {formatARS(subtotal)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

function FormAgregarPackaging({
  insumos,
  canalDefault,
  onCancel,
  onAdd,
}: {
  insumos: InsumoOpcion[];
  canalDefault: CanalPackaging;
  onCancel: () => void;
  onAdd: (payload: {
    insumo_id: string;
    cantidad: number;
    canal: CanalPackaging;
  }) => Promise<void>;
}) {
  const [insumoId, setInsumoId] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [canal, setCanal] = useState<CanalPackaging>(canalDefault);
  const [filtroPackaging, setFiltroPackaging] = useState(true);

  const opciones = useMemo(() => {
    let lista = insumos;
    if (filtroPackaging) lista = lista.filter((i) => i.es_packaging);
    return lista.slice(0, 200);
  }, [insumos, filtroPackaging]);

  return (
    <tr className="bg-rodziny-50/50">
      <td className="px-3 py-2">
        <select
          value={insumoId}
          onChange={(e) => setInsumoId(e.target.value)}
          className="w-full rounded border border-rodziny-400 px-2 py-1 text-xs"
        >
          <option value="">Elegir insumo…</option>
          {opciones.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nombre}
            </option>
          ))}
        </select>
        <label className="mt-1 flex items-center gap-1 text-[10px] text-gray-500">
          <input
            type="checkbox"
            checked={filtroPackaging}
            onChange={(e) => setFiltroPackaging(e.target.checked)}
            className="h-3 w-3"
          />
          Solo packaging
        </label>
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          step="0.5"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          className="w-16 rounded border border-rodziny-400 px-2 py-0.5 text-right text-xs"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={canal}
          onChange={(e) => setCanal(e.target.value as CanalPackaging)}
          className="rounded border border-rodziny-400 px-1 py-0.5 text-[11px]"
        >
          <option value="todos">Todos</option>
          <option value="plato">Plato</option>
          <option value="vianda">Vianda</option>
          <option value="congelado">Congelado</option>
        </select>
      </td>
      <td colSpan={2} className="px-3 py-2 text-right">
        <button
          disabled={!insumoId}
          onClick={() => onAdd({ insumo_id: insumoId, cantidad: parseFloat(cantidad) || 1, canal })}
          className="mr-1 rounded bg-rodziny-700 px-2 py-1 text-[10px] text-white hover:bg-rodziny-800 disabled:opacity-40"
        >
          Agregar
        </button>
        <button onClick={onCancel} className="text-[10px] text-gray-500 hover:text-gray-700">
          Cancelar
        </button>
      </td>
      <td></td>
    </tr>
  );
}

// ─── Card Adicionales ───────────────────────────────────────────────────────
export function AdicionalesCard({
  cocinaProductoId,
  canalFiltro,
}: {
  cocinaProductoId: string;
  canalFiltro: CanalAdicional;
}) {
  const { data: items, agregar, actualizar, eliminar } = useAdicionalesProducto(cocinaProductoId);
  const [agregando, setAgregando] = useState(false);

  const { data: insumos } = useQuery({
    queryKey: ['insumos-adicional-opciones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, unidad, costo_unitario')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as InsumoOpcion[];
    },
  });

  const { data: elaborados } = useQuery({
    queryKey: ['elaborados-adicional-opciones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, unidad')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as { id: string; nombre: string; unidad: string }[];
    },
  });

  const itemsVisibles = useMemo(() => {
    return (items ?? []).filter((i) => i.canal === 'todos' || i.canal === canalFiltro);
  }, [items, canalFiltro]);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">🍞 Adicionales del servicio</h3>
          <p className="text-[11px] text-gray-500">
            Queso sardo, pan, aceite saborizado, servilletas y demás extras del servicio. Pueden
            venir de un <strong>insumo</strong> comprado o de un{' '}
            <strong>producto elaborado</strong> propio (ej: pan de Saavedra).
          </p>
        </div>
        <button
          onClick={() => setAgregando(true)}
          className="rounded bg-rodziny-700 px-3 py-1.5 text-xs text-white hover:bg-rodziny-800"
        >
          + Agregar
        </button>
      </div>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Origen</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Canal</th>
              <th className="px-3 py-2 text-right">Costo unit.</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {itemsVisibles.map((i) => (
              <tr key={i.id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <div className="font-medium">{i.origen_nombre}</div>
                  <div className="text-[10px] text-gray-400">
                    {i.origen === 'insumo' ? 'Insumo comprado' : 'Producto elaborado'}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <input
                    type="number"
                    step="0.5"
                    value={i.cantidad}
                    onChange={(e) =>
                      actualizar.mutate({
                        id: i.id,
                        patch: { cantidad: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="w-16 rounded border border-gray-300 px-2 py-0.5 text-right"
                  />
                </td>
                <td className="px-3 py-2 text-[11px]">{i.unidad}</td>
                <td className="px-3 py-2">
                  <select
                    value={i.canal}
                    onChange={(e) =>
                      actualizar.mutate({
                        id: i.id,
                        patch: { canal: e.target.value as CanalAdicional },
                      })
                    }
                    className="rounded border border-gray-300 px-1 py-0.5 text-[11px]"
                  >
                    <option value="todos">Todos</option>
                    <option value="plato">Plato</option>
                    <option value="vianda">Vianda</option>
                  </select>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                  {i.origen === 'insumo' ? (
                    formatARS(i.origen_costo_unitario)
                  ) : (
                    <span className="text-gray-300">(de receta)</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => eliminar.mutate(i.id)}
                    className="text-red-500 hover:text-red-700"
                    title="Eliminar"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {agregando && insumos && elaborados && (
              <FormAgregarAdicional
                insumos={insumos}
                elaborados={elaborados}
                canalDefault={canalFiltro}
                onCancel={() => setAgregando(false)}
                onAdd={async (payload) => {
                  await agregar.mutateAsync(payload);
                  setAgregando(false);
                }}
              />
            )}
            {!itemsVisibles.length && !agregando && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-gray-400">
                  Sin adicionales cargados para este canal
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FormAgregarAdicional({
  insumos,
  elaborados,
  canalDefault,
  onCancel,
  onAdd,
}: {
  insumos: InsumoOpcion[];
  elaborados: { id: string; nombre: string; unidad: string }[];
  canalDefault: CanalAdicional;
  onCancel: () => void;
  onAdd: (payload: {
    origen: OrigenAdicional;
    origen_id: string;
    cantidad: number;
    unidad: string;
    canal: CanalAdicional;
  }) => Promise<void>;
}) {
  const [origen, setOrigen] = useState<OrigenAdicional>('insumo');
  const [origenId, setOrigenId] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [unidad, setUnidad] = useState('unid.');
  const [canal, setCanal] = useState<CanalAdicional>(canalDefault);

  function onChangeOrigenId(id: string) {
    setOrigenId(id);
    if (origen === 'insumo') {
      const i = insumos.find((x) => x.id === id);
      if (i) setUnidad(i.unidad);
    } else {
      const e = elaborados.find((x) => x.id === id);
      if (e) setUnidad(e.unidad);
    }
  }

  return (
    <tr className="bg-rodziny-50/50">
      <td className="px-3 py-2">
        <div className="mb-1 flex gap-1">
          <button
            onClick={() => {
              setOrigen('insumo');
              setOrigenId('');
            }}
            className={cn(
              'rounded px-2 py-0.5 text-[10px]',
              origen === 'insumo' ? 'bg-rodziny-700 text-white' : 'border border-gray-300 bg-white',
            )}
          >
            Insumo
          </button>
          <button
            onClick={() => {
              setOrigen('elaborado');
              setOrigenId('');
            }}
            className={cn(
              'rounded px-2 py-0.5 text-[10px]',
              origen === 'elaborado'
                ? 'bg-rodziny-700 text-white'
                : 'border border-gray-300 bg-white',
            )}
          >
            Elaborado
          </button>
        </div>
        <select
          value={origenId}
          onChange={(e) => onChangeOrigenId(e.target.value)}
          className="w-full rounded border border-rodziny-400 px-2 py-1 text-xs"
        >
          <option value="">Elegir…</option>
          {origen === 'insumo'
            ? insumos.slice(0, 300).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))
            : elaborados.slice(0, 300).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
        </select>
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          step="0.5"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          className="w-16 rounded border border-rodziny-400 px-2 py-0.5 text-right text-xs"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={unidad}
          onChange={(e) => setUnidad(e.target.value)}
          className="w-16 rounded border border-rodziny-400 px-2 py-0.5 text-xs"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={canal}
          onChange={(e) => setCanal(e.target.value as CanalAdicional)}
          className="rounded border border-rodziny-400 px-1 py-0.5 text-[11px]"
        >
          <option value="todos">Todos</option>
          <option value="plato">Plato</option>
          <option value="vianda">Vianda</option>
        </select>
      </td>
      <td colSpan={2} className="px-3 py-2 text-right">
        <button
          disabled={!origenId}
          onClick={() =>
            onAdd({
              origen,
              origen_id: origenId,
              cantidad: parseFloat(cantidad) || 1,
              unidad,
              canal,
            })
          }
          className="mr-1 rounded bg-rodziny-700 px-2 py-1 text-[10px] text-white hover:bg-rodziny-800 disabled:opacity-40"
        >
          Agregar
        </button>
        <button onClick={onCancel} className="text-[10px] text-gray-500 hover:text-gray-700">
          Cancelar
        </button>
      </td>
    </tr>
  );
}
