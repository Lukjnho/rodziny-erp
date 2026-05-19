import { Fragment, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';
import { useConfigCosteo } from '@/modules/cocina/hooks/useConfigCosteo';
import { useComisionMpConfig } from '../hooks/useComisionMpConfig';
import { CANALES_PRECIO, type CanalPrecio } from '../hooks/usePreciosCanal';

// El Menú es una PROYECCIÓN de Costeo: lista las recetas marcadas "vendible"
// (su costo sale del motor de Costeo, no se duplica) + las bebidas de reventa
// (sin receta). Acá solo se fija el precio por canal y se ve el margen. El
// armado de recetas/ingredientes y el toggle "vendible" viven en Costeo.

// Orden y etiqueta de las categorías del Menú. El grupo es el `tipo` de la
// receta (o 'bebida' para reventa). Tipos no listados van al final, alfabético.
const CATEGORIA_ORDEN = [
  'pasta',
  'salsa',
  'postre',
  'panaderia',
  'pasteleria',
  'panificado',
  'bebida',
  'otro',
];
const CATEGORIA_LABEL: Record<string, string> = {
  pasta: 'Pastas',
  salsa: 'Salsas',
  postre: 'Postres',
  panaderia: 'Panadería',
  pasteleria: 'Pastelería',
  panificado: 'Panificados',
  bebida: 'Bebidas',
  otro: 'Otros',
};

// Subcategorías de Bebidas inferidas por nombre, reproduciendo el esquema que
// usa Fudo (no hay link confiable cocina↔Fudo para bebidas: codigo no matchea,
// fudo_nombres vacío). Si en el futuro crece la carta, migrar a una columna.
const SUBCAT_BEBIDA_ORDEN = [
  'Bebidas Sin Alcohol',
  'Aguas',
  'Jugos / Jarras',
  'Vinos',
  'Cervezas',
  'Aperitivos',
  'Gin Artesanal',
  'Otras',
] as const;

function subcatBebida(nombre: string): (typeof SUBCAT_BEBIDA_ORDEN)[number] {
  const n = nombre.toLowerCase();
  if (/\bgin\b/.test(n)) return 'Gin Artesanal';
  if (/cerveza|\bipa\b|el perro|\bamber\b|dorada|nea ?pa|session/.test(n)) return 'Cervezas';
  if (/aperol|campari|cynar|fernet|vermut|branca|gancia|aperitivo/.test(n)) return 'Aperitivos';
  if (
    /malbec|cabernet|chardonn?ay|sauvignon|syrah|merlot|ros[eé]\b|tannat|bonarda|espumante|cerezo|zunino|makila|iride|abducido|huelga de amores|\(bot\)|\(copa\)|reserva|\bvino/.test(
      n,
    )
  )
    return 'Vinos';
  if (/agua/.test(n)) return 'Aguas';
  if (/jarra|limonada|naranjada|jugo|exprimido|detox|h2o/.test(n)) return 'Jugos / Jarras';
  if (/7 ?up|pepsi|mirinda|coca|sprite|fanta|paso de los toros|t[oó]nica|lata|gaseosa/.test(n))
    return 'Bebidas Sin Alcohol';
  return 'Otras';
}

function agruparBebidas(items: ItemMenu[]): { sub: string; rows: ItemMenu[] }[] {
  const m = new Map<string, ItemMenu[]>();
  for (const p of items) {
    const s = subcatBebida(p.nombre);
    (m.get(s) ?? m.set(s, []).get(s)!).push(p);
  }
  return SUBCAT_BEBIDA_ORDEN.filter((s) => m.has(s)).map((s) => ({
    sub: s,
    rows: (m.get(s) ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre)),
  }));
}

const CANAL_LABEL: Record<CanalPrecio, string> = {
  plato: 'Salón',
  vianda: 'Vianda',
  congelado: 'Congelado',
};

type FiltroLocal = 'vedia' | 'saavedra';
type Origen = 'receta' | 'reventa';

// Ítem unificado del Menú. `refId` es el receta_id (origen receta) o el
// cocina_producto_id (origen reventa). `key` = clave única para React/precios.
interface ItemMenu {
  key: string;
  origen: Origen;
  refId: string;
  nombre: string;
  tipo: string;
  local: FiltroLocal;
  costo: number | null;
  esSubreceta: boolean;
}

interface RecetaVendible {
  id: string;
  nombre: string;
  tipo: string;
  local: FiltroLocal;
  es_subreceta: boolean;
}

interface BebidaReventa {
  id: string;
  nombre: string;
  local: FiltroLocal;
  insumo_reventa_id: string | null;
}

export function MenuTab() {
  const qc = useQueryClient();
  const { perfil } = useAuth();
  const localRestringido = (perfil?.local_restringido ?? null) as FiltroLocal | null;

  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>(
    (localRestringido as FiltroLocal | null) ?? 'vedia',
  );
  const [busqueda, setBusqueda] = useState('');
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());

  // ─── Recetas marcadas vendible en Costeo ───────────────────────────────────
  const { data: recetas } = useQuery({
    queryKey: ['menu-recetas-vendibles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, local, es_subreceta')
        .eq('activo', true)
        .eq('vendible', true)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as RecetaVendible[];
    },
  });

  // ─── Bebidas de reventa (sin receta: latas, agua, vino) ────────────────────
  const { data: bebidas } = useQuery({
    queryKey: ['menu-bebidas-reventa'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, local, insumo_reventa_id')
        .eq('activo', true)
        .eq('tipo', 'bebida')
        .not('insumo_reventa_id', 'is', null)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as BebidaReventa[];
    },
  });

  const { data: insumosReventa } = useQuery({
    queryKey: ['menu-insumos-reventa'],
    queryFn: async () => {
      const { data, error } = await supabase.from('productos').select('id, costo_unitario');
      if (error) throw error;
      return data as Array<{ id: string; costo_unitario: number }>;
    },
  });

  // Precios por receta (modelo nuevo) y por producto de reventa (legacy).
  const { data: preciosReceta } = useQuery({
    queryKey: ['menu-precios-receta'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas_precios_canal')
        .select('receta_id, canal, precio');
      if (error) throw error;
      return data as Array<{ receta_id: string; canal: CanalPrecio; precio: number }>;
    },
  });

  const { data: preciosReventa } = useQuery({
    queryKey: ['menu-precios-reventa'],
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

  const costoInsumo = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of insumosReventa ?? []) m.set(i.id, Number(i.costo_unitario));
    return m;
  }, [insumosReventa]);

  // precios[`${origen}:${refId}`][canal] = precio
  const precios = useMemo(() => {
    const m = new Map<string, Partial<Record<CanalPrecio, number>>>();
    for (const r of preciosReceta ?? []) {
      const k = `receta:${r.receta_id}`;
      if (!m.has(k)) m.set(k, {});
      m.get(k)![r.canal] = Number(r.precio);
    }
    for (const r of preciosReventa ?? []) {
      const k = `reventa:${r.cocina_producto_id}`;
      if (!m.has(k)) m.set(k, {});
      m.get(k)![r.canal] = Number(r.precio);
    }
    return m;
  }, [preciosReceta, preciosReventa]);

  const ivaPct = configGen?.iva_pct ?? 0.21;
  const comisionPct = getComision('qr');

  // Margen sobre precio (despeje idéntico a useCostoCompleto, medio QR por
  // defecto). Costo = costo de receta; el desglose fino (packaging, servicio,
  // mano de obra) vive en el tab Costeo.
  const margenPctDe = (precio: number | null | undefined, costo: number | null): number | null => {
    if (!precio || precio <= 0 || costo == null) return null;
    const neto = precio / (1 + ivaPct);
    const comision = neto * comisionPct;
    const recibido = neto - comision;
    if (recibido <= 0) return null;
    return (recibido - costo) / recibido;
  };

  const setPrecio = useMutation({
    mutationFn: async (v: { origen: Origen; refId: string; canal: CanalPrecio; precio: number }) => {
      if (v.origen === 'receta') {
        const { error } = await supabase
          .from('cocina_recetas_precios_canal')
          .upsert(
            { receta_id: v.refId, canal: v.canal, precio: v.precio },
            { onConflict: 'receta_id,canal' },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('cocina_productos_precios_canal')
          .upsert(
            { cocina_producto_id: v.refId, canal: v.canal, precio: v.precio },
            { onConflict: 'cocina_producto_id,canal' },
          );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-precios-receta'] });
      qc.invalidateQueries({ queryKey: ['menu-precios-reventa'] });
    },
  });

  // ─── Ítems unificados ──────────────────────────────────────────────────────
  const items = useMemo<ItemMenu[]>(() => {
    const out: ItemMenu[] = [];
    for (const r of recetas ?? []) {
      const c = costos.get(r.id);
      out.push({
        key: `receta:${r.id}`,
        origen: 'receta',
        refId: r.id,
        nombre: r.nombre,
        tipo: r.tipo || 'otro',
        local: r.local,
        costo: c?.costoPorPorcion ?? c?.costoPorKg ?? null,
        esSubreceta: r.es_subreceta,
      });
    }
    for (const b of bebidas ?? []) {
      out.push({
        key: `reventa:${b.id}`,
        origen: 'reventa',
        refId: b.id,
        nombre: b.nombre,
        tipo: 'bebida',
        local: b.local,
        costo: b.insumo_reventa_id ? (costoInsumo.get(b.insumo_reventa_id) ?? null) : null,
        esSubreceta: false,
      });
    }
    return out;
  }, [recetas, bebidas, costos, costoInsumo]);

  const filtrados = useMemo(() => {
    let lista = items.filter((p) => p.local === filtroLocal);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter((p) => p.nombre.toLowerCase().includes(q));
    }
    return lista;
  }, [items, filtroLocal, busqueda]);

  // Grupos ordenados por CATEGORIA_ORDEN, el resto alfabético al final.
  const grupos = useMemo(() => {
    const m = new Map<string, ItemMenu[]>();
    for (const p of filtrados) (m.get(p.tipo) ?? m.set(p.tipo, []).get(p.tipo)!).push(p);
    return Array.from(m.entries())
      .map(([tipo, lista]) => ({
        tipo,
        items: lista.sort((a, b) => a.nombre.localeCompare(b.nombre)),
      }))
      .sort((a, b) => {
        const ia = CATEGORIA_ORDEN.indexOf(a.tipo);
        const ib = CATEGORIA_ORDEN.indexOf(b.tipo);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.tipo.localeCompare(b.tipo);
      });
  }, [filtrados]);

  const toggle = (tipo: string) =>
    setColapsadas((prev) => {
      const n = new Set(prev);
      n.has(tipo) ? n.delete(tipo) : n.add(tipo);
      return n;
    });

  const recetasVendiblesLocal = (recetas ?? []).filter((r) => r.local === filtroLocal).length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        Acá fijás <strong>precios de venta por canal</strong> de lo que se vende. El Menú{' '}
        <strong>proyecta automáticamente</strong> las recetas marcadas{' '}
        <strong>Vendible</strong> en el tab <strong>Costeo</strong> (más las bebidas de
        reventa) — el costo viene de Costeo, no se duplica. El plato = pasta + salsa (cada
        uno con su precio). El margen es sobre el <strong>costo de receta</strong>.
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex gap-1">
          {(['vedia', 'saavedra'] as const).map((l) => (
            <button
              key={l}
              disabled={!!localRestringido && l !== localRestringido}
              onClick={() => setFiltroLocal(l)}
              className={cn(
                'rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors disabled:opacity-30',
                filtroLocal === l
                  ? 'bg-rodziny-700 text-white'
                  : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <input
          placeholder="Buscar por nombre…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-64 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <div className="ml-auto text-xs text-gray-400">
          {filtrados.length} ítem{filtrados.length === 1 ? '' : 's'}
        </div>
      </div>

      <ArmarPlato
        items={items}
        filtroLocal={filtroLocal}
        precios={precios}
        margenPctDe={margenPctDe}
      />

      {recetasVendiblesLocal === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No hay recetas marcadas <strong>Vendible</strong> en {filtroLocal}. Andá al tab{' '}
          <strong>Costeo</strong>, abrí la receta que vendés y tocá{' '}
          <strong>"Marcar vendible"</strong> para que aparezca acá.
        </div>
      )}

      {grupos.map(({ tipo, items: gItems }) => {
        const colapsada = colapsadas.has(tipo);
        const fila = (p: ItemMenu) => {
          const pp = precios.get(p.key) ?? {};
          const margen = margenPctDe(pp.plato, p.costo);
          return (
            <tr key={p.key} className="hover:bg-rodziny-50/40">
              <td className="px-3 py-1.5">
                <span className="font-medium text-gray-800">{p.nombre}</span>
                <div className="font-mono text-[10px] text-gray-400">
                  <span className="capitalize">{p.local}</span>
                  {p.origen === 'reventa' ? (
                    <span className="ml-1 rounded bg-sky-100 px-1 text-sky-700">reventa</span>
                  ) : (
                    <span className="ml-1 rounded bg-green-100 px-1 capitalize text-green-700">
                      {p.tipo}
                    </span>
                  )}
                  {p.costo == null && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700">
                      sin costo
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                {p.costo != null ? formatARS(p.costo) : '—'}
              </td>
              {CANALES_PRECIO.map((c) => (
                <td key={c} className="px-3 py-1.5 text-right">
                  <PrecioInput
                    valor={pp[c] ?? null}
                    placeholder={c === 'vianda' && pp.plato != null ? pp.plato : undefined}
                    onGuardar={(precio) =>
                      setPrecio.mutate({
                        origen: p.origen,
                        refId: p.refId,
                        canal: c,
                        precio,
                      })
                    }
                  />
                </td>
              ))}
              <td className="px-3 py-1.5 text-right">
                <MargenBadge pct={margen} />
              </td>
            </tr>
          );
        };
        return (
          <section
            key={tipo}
            className="overflow-hidden rounded-lg border border-gray-200 bg-white"
          >
            <button
              onClick={() => toggle(tipo)}
              className="flex w-full items-center justify-between bg-gray-50 px-4 py-2 text-left hover:bg-gray-100"
            >
              <span className="text-sm font-semibold text-gray-800">
                {CATEGORIA_LABEL[tipo] ?? tipo}{' '}
                <span className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                  {gItems.length}
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
                    {tipo !== 'bebida'
                      ? gItems.map(fila)
                      : agruparBebidas(gItems).map(({ sub, rows }) => (
                          <Fragment key={sub}>
                            <tr className="bg-gray-50/70">
                              <td
                                colSpan={3 + CANALES_PRECIO.length}
                                className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                              >
                                {sub}{' '}
                                <span className="font-normal text-gray-400">
                                  · {rows.length}
                                </span>
                              </td>
                            </tr>
                            {rows.map(fila)}
                          </Fragment>
                        ))}
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
  items,
  filtroLocal,
  precios,
  margenPctDe,
}: {
  items: ItemMenu[];
  filtroLocal: FiltroLocal;
  precios: Map<string, Partial<Record<CanalPrecio, number>>>;
  margenPctDe: (precio: number | null | undefined, costo: number | null) => number | null;
}) {
  const [pastaKey, setPastaKey] = useState('');
  const [salsaKey, setSalsaKey] = useState('');

  const lista = (tipo: string) =>
    items
      .filter((p) => p.tipo === tipo && p.local === filtroLocal)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const pasta = items.find((p) => p.key === pastaKey) ?? null;
  const salsa = items.find((p) => p.key === salsaKey) ?? null;

  const precioPasta = pasta ? (precios.get(pasta.key)?.plato ?? null) : null;
  const precioSalsa = salsa ? (precios.get(salsa.key)?.plato ?? null) : null;
  const total = precioPasta != null && precioSalsa != null ? precioPasta + precioSalsa : null;

  const costoPlato = useMemo(() => {
    if (!pasta || !salsa) return null;
    if (pasta.costo == null || salsa.costo == null) return null;
    return pasta.costo + salsa.costo;
  }, [pasta, salsa]);

  const margenPlato = margenPctDe(total, costoPlato);

  if (lista('pasta').length === 0 && lista('salsa').length === 0) return null;

  return (
    <div className="rounded-lg border border-rodziny-200 bg-rodziny-50/40 p-3">
      <div className="mb-2 text-sm font-semibold text-gray-800">🍝 Armar plato</div>
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={pastaKey}
          onChange={(e) => setPastaKey(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Elegí pasta…</option>
          {lista('pasta').map((p) => (
            <option key={p.key} value={p.key}>
              {p.nombre}
            </option>
          ))}
        </select>
        <span className="text-gray-400">+</span>
        <select
          value={salsaKey}
          onChange={(e) => setSalsaKey(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">Elegí salsa…</option>
          {lista('salsa').map((p) => (
            <option key={p.key} value={p.key}>
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
