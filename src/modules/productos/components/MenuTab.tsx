import { Fragment, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';
import { useConfigCosteo } from '@/modules/cocina/hooks/useConfigCosteo';
import { useComisionMpConfig } from '../hooks/useComisionMpConfig';
import { CANALES_PRECIO, type CanalPrecio } from '../hooks/usePreciosCanal';
import { SUBCATEGORIA_LABEL } from '@/modules/cocina/RecetasTab';
import { useFudoHuerfanos } from '@/modules/productos/hooks/useFudoHuerfanos';

// El Menú es una PROYECCIÓN de Costeo: lista las recetas marcadas "vendible"
// (su costo sale del motor de Costeo, no se duplica) + las bebidas de reventa
// (sin receta). Acá solo se fija el precio por canal y se ve el margen. El
// armado de recetas/ingredientes y el toggle "vendible" viven en Costeo.

// Orden y etiqueta de las categorías del Menú. El grupo es el `tipo` de la
// receta (o 'bebida' para reventa). Tipos no listados van al final, alfabético.
// Vocabulario espejo del modelo nuevo (cocina_recetas.categoria) más el alias
// 'bebida' para reventa. Tipos no listados van al final, alfabético.
const CATEGORIA_ORDEN = [
  'pasta',
  'salsa',
  'postre',
  'pasteleria',
  'panificado',
  'cafeteria',
  'bebida',
  'otros',
];
const CATEGORIA_LABEL: Record<string, string> = {
  pasta: 'Pastas',
  salsa: 'Salsas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panificado: 'Panificados',
  cafeteria: 'Cafetería',
  bebida: 'Bebidas',
  otros: 'Otros',
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
    // Si la receta trae subcategoria explícita (modelo nuevo), respetarla;
    // sino caer a la heurística por nombre (reventa legacy sin sub cargado).
    const s = p.subcategoria
      ? (SUBCATEGORIA_LABEL[p.subcategoria] ?? p.subcategoria)
      : subcatBebida(p.nombre);
    (m.get(s) ?? m.set(s, []).get(s)!).push(p);
  }
  return Array.from(m.entries())
    .map(([sub, rows]) => ({
      sub,
      rows: rows.sort((a, b) => a.nombre.localeCompare(b.nombre)),
    }))
    .sort((a, b) => {
      const ia = SUBCAT_BEBIDA_ORDEN.indexOf(a.sub as (typeof SUBCAT_BEBIDA_ORDEN)[number]);
      const ib = SUBCAT_BEBIDA_ORDEN.indexOf(b.sub as (typeof SUBCAT_BEBIDA_ORDEN)[number]);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.sub.localeCompare(b.sub);
    });
}

// Agrupador genérico: usa el campo `subcategoria` cargado (modelo nuevo).
// Si ningún ítem trae subcategoria, devuelve un único grupo sin header.
function agruparPorSub(items: ItemMenu[]): { sub: string; rows: ItemMenu[] }[] {
  const haySub = items.some((p) => !!p.subcategoria);
  if (!haySub) {
    return [
      { sub: '', rows: [...items].sort((a, b) => a.nombre.localeCompare(b.nombre)) },
    ];
  }
  const m = new Map<string, ItemMenu[]>();
  for (const p of items) {
    const k = p.subcategoria ? (SUBCATEGORIA_LABEL[p.subcategoria] ?? p.subcategoria) : '';
    (m.get(k) ?? m.set(k, []).get(k)!).push(p);
  }
  return Array.from(m.entries())
    .map(([sub, rows]) => ({
      sub,
      rows: rows.sort((a, b) => a.nombre.localeCompare(b.nombre)),
    }))
    .sort((a, b) => {
      // Items sin sub van al final
      if (!a.sub && b.sub) return 1;
      if (a.sub && !b.sub) return -1;
      return a.sub.localeCompare(b.sub);
    });
}

const CANAL_LABEL: Record<CanalPrecio, string> = {
  plato: 'Salón',
  vianda: 'Vianda',
  congelado: 'Congelado',
};

type FiltroLocal = 'vedia' | 'saavedra';

// Ítem unificado del Menú. `refId` = receta_id. `key` = clave única para
// React/precios. Todo lo vendible es una receta (las bebidas de reventa también
// son recetas de 1 insumo).
interface ItemMenu {
  key: string;
  refId: string;
  nombre: string;
  tipo: string;
  subcategoria: string | null;
  local: FiltroLocal;
  costo: number | null;
  esSubreceta: boolean;
}

interface RecetaVendible {
  id: string;
  nombre: string;
  tipo: 'receta' | 'subreceta';
  categoria: string | null;
  subcategoria: string | null;
  rol: string | null;
  local: FiltroLocal;
}

// Mapea rol operativo → categoría comercial equivalente. Subrecetas vendibles
// (ej. salsas base que también se venden por separado) caían en "Otros" porque
// tenían categoria=null; ahora se proyectan al grupo comercial correcto.
function rolToCategoria(rol: string | null): string {
  switch (rol) {
    case 'salsa_base':
      return 'salsa';
    case 'postre_base':
      return 'postre';
    case 'bebida_base':
      return 'bebida';
    case 'pasteleria_base':
      return 'pasteleria';
    case 'panificado':
      return 'panificado';
    default:
      return 'otros';
  }
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
        .select('id, nombre, tipo, categoria, subcategoria, rol, local')
        .eq('activo', true)
        .eq('vendible', true)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as RecetaVendible[];
    },
  });

  // Precios por receta (incluye bebidas, que ahora son recetas de 1 insumo).
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

  const { costos } = useCostosRecetas();
  const { config: configGen } = useConfigCosteo();
  const { data: comisiones, getComision } = useComisionMpConfig();

  // precios[`receta:${refId}`][canal] = precio
  const precios = useMemo(() => {
    const m = new Map<string, Partial<Record<CanalPrecio, number>>>();
    for (const r of preciosReceta ?? []) {
      const k = `receta:${r.receta_id}`;
      if (!m.has(k)) m.set(k, {});
      m.get(k)![r.canal] = Number(r.precio);
    }
    return m;
  }, [preciosReceta]);

  const ivaPct = configGen?.iva_pct ?? 0.21;
  // Comisión más alta configurada (criterio conservador, pedido de Lucas): se
  // usa para los escenarios Lista y Convenio (que se pagan con tarjeta). El
  // escenario Efectivo usa la comisión de 'efectivo' (0%).
  const comisionMax = Math.max(0, ...(comisiones ?? []).map((c) => Number(c.pct)));
  const comisionEfectivo = getComision('efectivo');
  const descEfectivo = configGen?.descuento_efectivo_pct ?? 0.25;
  const descConvenio = configGen?.descuento_convenio_pct ?? 0.15;

  // Margen real sobre el precio cobrado, contemplando: descuento del escenario,
  // IVA y comisión bancaria. precioBruto = precio de lista (IVA incluido).
  // margen = (recibido − costo) / recibido.
  const margenEscenario = (
    precioBruto: number | null | undefined,
    costo: number | null,
    descuentoPct: number,
    comisionPct: number,
  ): number | null => {
    if (!precioBruto || precioBruto <= 0 || costo == null) return null;
    const precioCobrado = precioBruto * (1 - descuentoPct);
    const neto = precioCobrado / (1 + ivaPct);
    const recibido = neto - neto * comisionPct;
    if (recibido <= 0) return null;
    return (recibido - costo) / recibido;
  };
  // Atajos por escenario (no acumulables entre sí).
  const margenLista = (p: number | null | undefined, c: number | null) =>
    margenEscenario(p, c, 0, comisionMax);
  const margenEfectivo = (p: number | null | undefined, c: number | null) =>
    margenEscenario(p, c, descEfectivo, comisionEfectivo);
  const margenConvenio = (p: number | null | undefined, c: number | null) =>
    margenEscenario(p, c, descConvenio, comisionMax);

  const setPrecio = useMutation({
    mutationFn: async (v: { refId: string; canal: CanalPrecio; precio: number }) => {
      const { error } = await supabase
        .from('cocina_recetas_precios_canal')
        .upsert(
          { receta_id: v.refId, canal: v.canal, precio: v.precio },
          { onConflict: 'receta_id,canal' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-precios-receta'] });
    },
  });

  // ─── Ítems unificados ──────────────────────────────────────────────────────
  const items = useMemo<ItemMenu[]>(() => {
    const out: ItemMenu[] = [];
    for (const r of recetas ?? []) {
      const c = costos.get(r.id);
      // Receta vendible: usa su categoria. Subreceta vendible: deriva del rol
      // operativo (ej. salsa_base → "Salsas") para no caer en "Otros".
      const tipoCat =
        r.tipo === 'subreceta'
          ? rolToCategoria(r.rol)
          : (r.categoria ?? 'otros');
      out.push({
        key: `receta:${r.id}`,
        refId: r.id,
        nombre: r.nombre,
        tipo: tipoCat,
        subcategoria: r.subcategoria,
        local: r.local,
        costo: c?.costoPorPorcion ?? c?.costoPorKg ?? null,
        esSubreceta: r.tipo === 'subreceta',
      });
    }
    return out;
  }, [recetas, costos]);

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
        Acá fijás <strong>precios de venta</strong> de lo que se vende. El Menú{' '}
        <strong>proyecta automáticamente</strong> las recetas marcadas{' '}
        <strong>Vendible</strong> en el tab <strong>Costeo</strong> — el costo viene de Costeo,
        no se duplica. Las <strong>3 columnas de margen</strong> ya descuentan IVA y comisión
        bancaria (la más alta): <strong>Lista</strong> = precio pleno;{' '}
        <strong>Efvo −{Math.round(descEfectivo * 100)}%</strong> = pago en efectivo (sin
        comisión); <strong>Conv −{Math.round(descConvenio * 100)}%</strong> = convenio con
        empresas. No son acumulables. Los % se editan en{' '}
        <strong>Configuración</strong>.
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
        margenPctDe={margenLista}
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
        // Todas las categorías van con 1 sola columna 'Precio'. Las pastas
        // que se venden en distintos canales (Salón/Vianda/Congelado) viven
        // como recetas separadas con su sufijo en el nombre — cada una con
        // su propio precio y costo.
        const canales: CanalPrecio[] = ['plato'];
        const fila = (p: ItemMenu) => {
          const pp = precios.get(p.key) ?? {};
          return (
            <tr key={p.key} className="hover:bg-rodziny-50/40">
              <td className="px-3 py-1.5">
                <span className="font-medium text-gray-800">{p.nombre}</span>
                <div className="font-mono text-[10px] text-gray-400">
                  <span className="capitalize">{p.local}</span>
                  <span className="ml-1 rounded bg-green-100 px-1 capitalize text-green-700">
                    {p.tipo}
                  </span>
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
              {canales.map((c) => (
                <td key={c} className="px-3 py-1.5 text-right">
                  <PrecioInput
                    valor={pp[c] ?? null}
                    placeholder={c === 'vianda' && pp.plato != null ? pp.plato : undefined}
                    onGuardar={(precio) =>
                      setPrecio.mutate({
                        refId: p.refId,
                        canal: c,
                        precio,
                      })
                    }
                  />
                </td>
              ))}
              <td className="px-3 py-1.5 text-right">
                <MargenBadge pct={margenLista(pp.plato, p.costo)} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <MargenBadge pct={margenEfectivo(pp.plato, p.costo)} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <MargenBadge pct={margenConvenio(pp.plato, p.costo)} />
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
                      {canales.map((c) => (
                        <th key={c} className="px-3 py-1.5 text-right font-medium">
                          Precio
                        </th>
                      ))}
                      <th className="px-3 py-1.5 text-right font-medium">M. Lista</th>
                      <th className="px-3 py-1.5 text-right font-medium">
                        M. Efvo −{Math.round(descEfectivo * 100)}%
                      </th>
                      <th className="px-3 py-1.5 text-right font-medium">
                        M. Conv −{Math.round(descConvenio * 100)}%
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(tipo === 'bebida' ? agruparBebidas(gItems) : agruparPorSub(gItems)).map(
                      ({ sub, rows }) => (
                        <Fragment key={sub || '__sin_sub__'}>
                          {sub && (
                            <tr className="bg-gray-50/70">
                              <td
                                colSpan={5 + canales.length}
                                className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                              >
                                {sub}{' '}
                                <span className="font-normal text-gray-400">
                                  · {rows.length}
                                </span>
                              </td>
                            </tr>
                          )}
                          {rows.map(fila)}
                        </Fragment>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <HuerfanosSinCandidato local={filtroLocal} />
    </div>
  );
}

// Sección informativa al pie del Menú: lista nombres Fudo (últ. 2 meses) que
// NO están vinculados a ninguna receta vendible ni cocina_producto del local.
// Sin acción inline: Lucas crea la receta desde Costeo y al guardarla con el
// nombre en fudo_productos, desaparece de la lista (reactivo via React Query).
function HuerfanosSinCandidato({ local }: { local: FiltroLocal }) {
  const { data, isLoading } = useFudoHuerfanos(local);
  const sinCandidato = useMemo(
    () => (data ?? []).filter((h) => !h.vinculadoA),
    [data],
  );
  if (isLoading || sinCandidato.length === 0) return null;
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-amber-900">
          ⚠ Productos vendidos en Fudo sin contraparte en el catálogo
        </h3>
        <span className="text-[10px] text-amber-700">
          {sinCandidato.length} ítem{sinCandidato.length === 1 ? '' : 's'} · últ. 2 meses
        </span>
      </header>
      <p className="mb-2 text-[10px] text-amber-700">
        Estos nombres aparecen en ventas de Fudo pero no están vinculados a ninguna receta
        vendible ni producto del catálogo. Crealos desde el tab <strong>Costeo</strong> y al
        marcarlos vendibles con su nombre Fudo, desaparecen de esta lista.
      </p>
      <ul className="divide-y divide-amber-100 rounded bg-white">
        {sinCandidato.map((h) => (
          <li
            key={h.nombre}
            className="flex items-center justify-between gap-2 px-2 py-1 text-xs"
          >
            <span className="flex-1 truncate text-gray-800" title={h.nombre}>
              {h.nombre}
            </span>
            <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] tabular-nums text-amber-900">
              {h.uds} uds · {formatARS(h.total)}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
