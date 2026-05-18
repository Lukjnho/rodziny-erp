import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';
import { useConfigCosteo } from '@/modules/cocina/hooks/useConfigCosteo';
import { useComisionMpConfig } from '../hooks/useComisionMpConfig';
import { CANALES_PRECIO, type CanalPrecio } from '../hooks/usePreciosCanal';
import { ProductoFormPanel } from './ProductoFormPanel';
import { ProductoDetalleMenu } from './ProductoDetalleMenu';

// Solo lo que se vende. Componentes (masa, relleno, crema, subrecetas) viven
// en el tab Costeo, no acá.
const CATEGORIAS: { tipo: string; label: string }[] = [
  { tipo: 'pasta', label: 'Pastas' },
  { tipo: 'salsa', label: 'Salsas' },
  { tipo: 'postre', label: 'Postres' },
  { tipo: 'panificado', label: 'Panificados' },
  { tipo: 'bebida', label: 'Bebidas' },
];
const TIPOS_VENDIBLES = CATEGORIAS.map((c) => c.tipo);

const CANAL_LABEL: Record<CanalPrecio, string> = {
  plato: 'Salón',
  vianda: 'Vianda',
  congelado: 'Congelado',
};

interface ProductoMenu {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  unidad: string;
  local: 'vedia' | 'saavedra';
  receta_id: string | null;
  insumo_reventa_id: string | null;
}

type FiltroLocal = 'todos' | 'vedia' | 'saavedra';

export function MenuTab() {
  const qc = useQueryClient();
  const { perfil } = useAuth();
  const localRestringido = (perfil?.local_restringido ?? null) as 'vedia' | 'saavedra' | null;

  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>(
    (localRestringido as FiltroLocal) ?? 'todos',
  );
  const [busqueda, setBusqueda] = useState('');
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());
  const [detalleId, setDetalleId] = useState<string | null>(null);
  // null = cerrado · {id:null} = nuevo · {id:'x'} = editar definición
  const [formProducto, setFormProducto] = useState<{ id: string | null } | null>(null);

  const invalidarMenu = () => {
    qc.invalidateQueries({ queryKey: ['menu-productos'] });
    qc.invalidateQueries({ queryKey: ['menu-precios-canal'] });
    qc.invalidateQueries({ queryKey: ['menu-detalle-producto'] });
    qc.invalidateQueries({ queryKey: ['ficha-productos'] });
    qc.invalidateQueries({ queryKey: ['cocina-producto-detalle'] });
    qc.invalidateQueries({ queryKey: ['productos-costeo'] });
  };

  const { data: productos } = useQuery({
    queryKey: ['menu-productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, tipo, unidad, local, receta_id, insumo_reventa_id')
        .eq('activo', true)
        .in('tipo', TIPOS_VENDIBLES)
        .order('nombre');
      if (error) throw error;
      return data as ProductoMenu[];
    },
  });

  // Costo de los insumos de reventa (bebidas de lata/agua/vino sin receta).
  const { data: insumosReventa } = useQuery({
    queryKey: ['menu-insumos-reventa'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, costo_unitario');
      if (error) throw error;
      return data as Array<{ id: string; costo_unitario: number }>;
    },
  });

  const { data: preciosRaw } = useQuery({
    queryKey: ['menu-precios-canal'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos_precios_canal')
        .select('cocina_producto_id, canal, precio');
      if (error) throw error;
      return data as Array<{ cocina_producto_id: string; canal: CanalPrecio; precio: number }>;
    },
  });

  const { costos } = useCostosRecetas();
  const { config: configGen } = useConfigCosteo();
  const { getComision } = useComisionMpConfig();

  // precios[productoId][canal] = precio
  const precios = useMemo(() => {
    const m = new Map<string, Partial<Record<CanalPrecio, number>>>();
    for (const r of preciosRaw ?? []) {
      if (!m.has(r.cocina_producto_id)) m.set(r.cocina_producto_id, {});
      m.get(r.cocina_producto_id)![r.canal] = Number(r.precio);
    }
    return m;
  }, [preciosRaw]);

  const costoInsumo = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of insumosReventa ?? []) m.set(i.id, Number(i.costo_unitario));
    return m;
  }, [insumosReventa]);

  // Costo del producto. Elaborado → costo de receta (incluye merma+subrecetas
  // +margen seguridad, criterio de useCostoCompleto). Reventa (bebida sin
  // receta) → costo_unitario del insumo vinculado.
  const costoDe = (p: ProductoMenu): number | null => {
    if (!p.receta_id) {
      if (p.insumo_reventa_id) return costoInsumo.get(p.insumo_reventa_id) ?? null;
      return null;
    }
    const c = costos.get(p.receta_id);
    if (!c) return null;
    const u = (p.unidad ?? '').toLowerCase();
    const esPeso = u === 'kg' || u === 'litros' || u === 'lt' || u === 'l';
    if (esPeso && c.costoPorKg != null) return c.costoPorKg;
    if (!esPeso && c.costoPorPorcion != null) return c.costoPorPorcion;
    return c.costoPorPorcion ?? c.costoPorKg ?? null;
  };

  const ivaPct = configGen?.iva_pct ?? 0.21;
  const comisionPct = getComision('qr');

  // Margen sobre precio para un precio dado (despeje idéntico a useCostoCompleto,
  // medio QR por defecto). Costo = costo de receta (el desglose fino —packaging,
  // servicio, MO— está en el tab Costeo).
  const margenPctDe = (precio: number | null | undefined, costo: number | null): number | null => {
    if (!precio || precio <= 0 || costo == null) return null;
    const neto = precio / (1 + ivaPct);
    const comision = neto * comisionPct;
    const recibido = neto - comision;
    if (recibido <= 0) return null;
    return (recibido - costo) / recibido;
  };

  const setPrecio = useMutation({
    mutationFn: async (v: { productoId: string; canal: CanalPrecio; precio: number }) => {
      const { error } = await supabase.from('cocina_productos_precios_canal').upsert(
        { cocina_producto_id: v.productoId, canal: v.canal, precio: v.precio },
        { onConflict: 'cocina_producto_id,canal' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-precios-canal'] });
      // El canal 'plato' se espeja a cocina_productos.precio_venta (trigger).
      qc.invalidateQueries({ queryKey: ['ficha-productos'] });
      qc.invalidateQueries({ queryKey: ['productos-costeo'] });
      qc.invalidateQueries({ queryKey: ['historial-precio'] });
    },
  });

  const filtrados = useMemo(() => {
    let lista = productos ?? [];
    if (filtroLocal !== 'todos') lista = lista.filter((p) => p.local === filtroLocal);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(
        (p) => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q),
      );
    }
    return lista;
  }, [productos, filtroLocal, busqueda]);

  const porCategoria = useMemo(() => {
    const m = new Map<string, ProductoMenu[]>();
    for (const c of CATEGORIAS) m.set(c.tipo, []);
    for (const p of filtrados) m.get(p.tipo)?.push(p);
    return m;
  }, [filtrados]);

  const toggle = (tipo: string) =>
    setColapsadas((prev) => {
      const n = new Set(prev);
      n.has(tipo) ? n.delete(tipo) : n.add(tipo);
      return n;
    });

  // Alta / edición de definición del producto (apartado ancho)
  if (formProducto) {
    return (
      <ProductoFormPanel
        productoId={formProducto.id}
        onVolver={() => setFormProducto(null)}
        onSaved={() => {
          setFormProducto(null);
          invalidarMenu();
        }}
      />
    );
  }

  // Detalle del producto vendible (packaging, adicionales, costo+margen)
  if (detalleId) {
    return (
      <ProductoDetalleMenu
        productoId={detalleId}
        onVolver={() => setDetalleId(null)}
        onEditarDefinicion={() => setFormProducto({ id: detalleId })}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        Acá fijás <strong>precios de venta por canal</strong> de lo que se vende. El{' '}
        <strong>Salón</strong> y la <strong>Vianda</strong> suelen ir al mismo precio; el{' '}
        <strong>Congelado</strong> tiene el suyo. El plato = pasta + salsa (cada uno con su
        precio). El margen mostrado es sobre el <strong>costo de receta</strong> — el desglose
        fino (packaging, servicio, mano de obra) está en <strong>Costeo</strong>.
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex gap-1">
          {(['todos', 'vedia', 'saavedra'] as const).map((l) => (
            <button
              key={l}
              disabled={!!localRestringido && l !== localRestringido && l !== 'todos'}
              onClick={() => setFiltroLocal(l)}
              className={cn(
                'rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors disabled:opacity-30',
                filtroLocal === l
                  ? 'bg-rodziny-700 text-white'
                  : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
              )}
            >
              {l === 'todos' ? 'Ambos locales' : l}
            </button>
          ))}
        </div>
        <input
          placeholder="Buscar por nombre o código…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-64 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => setFormProducto({ id: null })}
          className="ml-auto rounded bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
        >
          + Nuevo producto
        </button>
        <div className="text-xs text-gray-400">
          {filtrados.length} de {productos?.length ?? 0} vendibles
        </div>
      </div>

      <ArmarPlato
        productos={productos ?? []}
        filtroLocal={filtroLocal}
        precios={precios}
        costoDe={costoDe}
        margenPctDe={margenPctDe}
      />

      {CATEGORIAS.map((cat) => {
        const items = porCategoria.get(cat.tipo) ?? [];
        if (items.length === 0) return null;
        const colapsada = colapsadas.has(cat.tipo);
        return (
          <section
            key={cat.tipo}
            className="overflow-hidden rounded-lg border border-gray-200 bg-white"
          >
            <button
              onClick={() => toggle(cat.tipo)}
              className="flex w-full items-center justify-between bg-gray-50 px-4 py-2 text-left hover:bg-gray-100"
            >
              <span className="text-sm font-semibold text-gray-800">
                {cat.label}{' '}
                <span className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                  {items.length}
                </span>
              </span>
              <span className="text-xs text-gray-400">{colapsada ? '▸' : '▾'}</span>
            </button>

            {!colapsada && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 bg-white text-[10px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Producto</th>
                      <th className="px-3 py-1.5 text-right font-medium">Costo receta</th>
                      {CANALES_PRECIO.map((c) => (
                        <th key={c} className="px-3 py-1.5 text-right font-medium">
                          {CANAL_LABEL[c]}
                        </th>
                      ))}
                      <th className="px-3 py-1.5 text-right font-medium">Margen Salón</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map((p) => {
                      const costo = costoDe(p);
                      const pp = precios.get(p.id) ?? {};
                      const margen = margenPctDe(pp.plato, costo);
                      return (
                        <tr key={p.id} className="hover:bg-rodziny-50/40">
                          <td className="px-3 py-1.5">
                            <button
                              onClick={() => setDetalleId(p.id)}
                              className="text-left font-medium text-gray-800 hover:text-rodziny-700 hover:underline"
                              title="Ver packaging, adicionales y margen"
                            >
                              {p.nombre}
                            </button>
                            <div className="font-mono text-[10px] text-gray-400">
                              {p.codigo} · {p.local}
                              {p.insumo_reventa_id ? (
                                <span className="ml-1 rounded bg-sky-100 px-1 text-sky-700">
                                  reventa
                                </span>
                              ) : (
                                !p.receta_id && (
                                  <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700">
                                    sin receta
                                  </span>
                                )
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                            {costo != null ? formatARS(costo) : '—'}
                          </td>
                          {CANALES_PRECIO.map((c) => (
                            <td key={c} className="px-3 py-1.5 text-right">
                              <PrecioInput
                                valor={pp[c] ?? null}
                                placeholder={
                                  c === 'vianda' && pp.plato != null ? pp.plato : undefined
                                }
                                onGuardar={(precio) =>
                                  setPrecio.mutate({ productoId: p.id, canal: c, precio })
                                }
                              />
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-right">
                            <MargenBadge pct={margen} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ─── Bloque "Armar plato" (pasta + salsa) ────────────────────────────────────
function ArmarPlato({
  productos,
  filtroLocal,
  precios,
  costoDe,
  margenPctDe,
}: {
  productos: ProductoMenu[];
  filtroLocal: FiltroLocal;
  precios: Map<string, Partial<Record<CanalPrecio, number>>>;
  costoDe: (p: ProductoMenu) => number | null;
  margenPctDe: (precio: number | null | undefined, costo: number | null) => number | null;
}) {
  const [pastaId, setPastaId] = useState('');
  const [salsaId, setSalsaId] = useState('');

  const lista = (tipo: string) =>
    productos
      .filter((p) => p.tipo === tipo && (filtroLocal === 'todos' || p.local === filtroLocal))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const pasta = productos.find((p) => p.id === pastaId) ?? null;
  const salsa = productos.find((p) => p.id === salsaId) ?? null;

  const precioPasta = pasta ? (precios.get(pasta.id)?.plato ?? null) : null;
  const precioSalsa = salsa ? (precios.get(salsa.id)?.plato ?? null) : null;
  const total =
    precioPasta != null && precioSalsa != null ? precioPasta + precioSalsa : null;

  // Margen del plato: costo pasta + costo salsa vs precio combinado.
  // El servicio (pan/queso/aceite) se imputa a la pasta — se ve en el tab Costeo.
  const costoPlato = useMemo(() => {
    if (!pasta || !salsa) return null;
    const cp = costoDe(pasta);
    const cs = costoDe(salsa);
    if (cp == null || cs == null) return null;
    return cp + cs;
  }, [pasta, salsa, costoDe]);

  const margenPlato = margenPctDe(total, costoPlato);

  return (
    <div className="rounded-lg border border-rodziny-200 bg-rodziny-50/40 p-3">
      <div className="mb-2 text-sm font-semibold text-gray-800">🍝 Armar plato</div>
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={pastaId}
          onChange={(e) => setPastaId(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Elegí pasta…</option>
          {lista('pasta').map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <span className="text-gray-400">+</span>
        <select
          value={salsaId}
          onChange={(e) => setSalsaId(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Elegí salsa…</option>
          {lista('salsa').map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <span className="text-gray-400">=</span>
        <div className="rounded border border-gray-200 bg-white px-3 py-1.5">
          <span className="text-base font-bold tabular-nums text-rodziny-700">
            {total != null ? formatARS(total) : '—'}
          </span>
          {precioPasta != null && precioSalsa != null && (
            <span className="ml-2 text-[10px] text-gray-400">
              {formatARS(precioPasta)} + {formatARS(precioSalsa)}
            </span>
          )}
        </div>
        {margenPlato != null && (
          <div className="text-xs text-gray-600">
            margen plato <MargenBadge pct={margenPlato} />
          </div>
        )}
      </div>
      {(pasta && precioPasta == null) || (salsa && precioSalsa == null) ? (
        <p className="mt-1.5 text-[11px] text-amber-600">
          ⚠ Falta cargar el precio Salón de {precioPasta == null ? pasta?.nombre : ''}
          {precioPasta == null && precioSalsa == null ? ' y ' : ''}
          {precioSalsa == null ? salsa?.nombre : ''}.
        </p>
      ) : null}
    </div>
  );
}

// ─── Input de precio inline (commit en blur/Enter) ───────────────────────────
function PrecioInput({
  valor,
  placeholder,
  onGuardar,
}: {
  valor: number | null;
  placeholder?: number;
  onGuardar: (precio: number) => void;
}) {
  const [raw, setRaw] = useState(valor != null ? String(valor) : '');

  // Sincronizar si cambia desde afuera (otra edición / refetch)
  const [ultimoValor, setUltimoValor] = useState(valor);
  if (valor !== ultimoValor) {
    setUltimoValor(valor);
    setRaw(valor != null ? String(valor) : '');
  }

  const commit = () => {
    const t = raw.trim().replace(/\./g, '').replace(',', '.');
    if (t === '') return;
    const num = parseFloat(t);
    if (!isNaN(num) && num >= 0 && num !== valor) onGuardar(num);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={raw}
      placeholder={placeholder != null ? `= ${placeholder}` : 'sin precio'}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setRaw(valor != null ? String(valor) : '');
      }}
      className="w-24 rounded border border-gray-200 px-2 py-1 text-right text-sm tabular-nums focus:border-rodziny-400 focus:outline-none"
    />
  );
}

// ─── Badge de margen con semáforo ────────────────────────────────────────────
function MargenBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-gray-300">—</span>;
  const color =
    pct < 0.5
      ? 'bg-red-100 text-red-700'
      : pct < 0.65
      ? 'bg-amber-100 text-amber-700'
      : 'bg-emerald-100 text-emerald-700';
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums', color)}>
      {(pct * 100).toFixed(0)}%
    </span>
  );
}
