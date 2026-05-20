import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { PRODUCTOS_COCINA, normNombre } from '../DashboardTab';

// El Resumen semanal es un CATÁLOGO POR DEMANDA: lista todos los productos
// controlados del local con su demanda Fudo semanal vs el stock actual, para
// planificar la producción. NO depende del Plan semanal (cocina_pizarron_items).

type LocalCocina = 'vedia' | 'saavedra';

interface ProductoCat {
  id: string;
  nombre: string;
  tipo: string;
  receta_id: string | null;
  fudo_nombres: string[] | null;
}

interface LoteStock {
  receta_id: string | null;
  nombre_libre: string | null;
  cantidad_producida: number;
  merma_cantidad: number | null;
}

interface FudoResp {
  ranking: { nombre: string; cantidad: number }[];
  dias: number;
}

type Estado = 'cubre' | 'ajustado' | 'corto' | 'sobra' | 'sin_demanda';

interface ResumenItem {
  id: string;
  nombre: string;
  tipo: string;
  stockActual: number;
  demandaSemanal: number;
  estado: Estado;
}

// Tipos del catálogo por local. Saavedra controla todo por overwrite
// (cocina_lotes_produccion). Vedia controla salsas/postres por overwrite y
// pastas por cámara/traspasos (vista v_cocina_stock_pastas) — el resumen
// rutea el cálculo de stock según producto.tipo + local.
const TIPOS_POR_LOCAL: Record<LocalCocina, string[]> = {
  saavedra: ['pasta', 'milanesa', 'postre', 'panificado', 'salsa'],
  vedia: ['pasta', 'salsa', 'postre'],
};

const TIPO_EMOJI: Record<string, string> = {
  pasta: '🍝',
  milanesa: '🍖',
  salsa: '🍅',
  postre: '🍰',
  panificado: '🍞',
};

const TIPO_LABEL: Record<string, string> = {
  pasta: 'Pastas',
  milanesa: 'Milanesas',
  postre: 'Postres',
  panificado: 'Panes',
  salsa: 'Salsas',
};

const ESTADO_LABEL: Record<Estado, { texto: string; cls: string }> = {
  cubre: { texto: '🟢 cubre', cls: 'bg-green-100 text-green-800 ring-green-200' },
  ajustado: { texto: '🟡 justo', cls: 'bg-amber-100 text-amber-800 ring-amber-200' },
  corto: { texto: '🔴 falta', cls: 'bg-red-100 text-red-800 ring-red-200' },
  sobra: { texto: '🟣 sobra', cls: 'bg-purple-100 text-purple-800 ring-purple-200' },
  sin_demanda: { texto: '⚪ s/ vta.', cls: 'bg-gray-100 text-gray-600 ring-gray-200' },
};

// Resolución de nombres Fudo por prioridad: fudo_nombres del producto en DB
// (configurable) > mapa hardcodeado PRODUCTOS_COCINA (legacy) > nombre literal.
const PRODUCTO_POR_NOMBRE = new Map(
  PRODUCTOS_COCINA.map((p) => [normNombre(p.nombre), p] as const),
);

function nombresFudoDe(prod: ProductoCat): string[] {
  if (prod.fudo_nombres && prod.fudo_nombres.length > 0) return prod.fudo_nombres;
  const cfg = PRODUCTO_POR_NOMBRE.get(normNombre(prod.nombre));
  return cfg?.fudoNombres ?? [prod.nombre];
}

const ORDEN_ESTADO: Record<Estado, number> = {
  corto: 0,
  ajustado: 1,
  cubre: 2,
  sobra: 3,
  sin_demanda: 4,
};

export function ResumenSemanalCard({
  local,
}: {
  local: LocalCocina;
  // Se conserva en la firma por compatibilidad con las llamadas existentes,
  // pero el resumen ya no depende de la semana (demanda = Fudo 14d rolling).
  fechaReferencia: string;
}) {
  const [abierto, setAbierto] = useState(true);
  const tiposLocal = TIPOS_POR_LOCAL[local];

  // Catálogo de productos controlados del local.
  const { data: productos } = useQuery({
    queryKey: ['resumen-semanal-catalogo', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, tipo, receta_id, fudo_nombres')
        .eq('local', local)
        .eq('activo', true)
        .eq('controla_stock', true);
      if (error) throw error;
      return (data ?? []) as ProductoCat[];
    },
  });

  // Stock actual (modelo overwrite, igual que el catálogo de Stock). Cubre
  // salsas/postres/panificados/milanesas en ambos locales y pastas Saavedra.
  const { data: lotes } = useQuery({
    queryKey: ['resumen-semanal-stock', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('receta_id, nombre_libre, cantidad_producida, merma_cantidad')
        .eq('local', local)
        .eq('en_stock', true);
      if (error) throw error;
      return (data ?? []) as LoteStock[];
    },
  });

  // Stock de pastas VEDIA: viven en cocina_lotes_pasta (cámara/traspasos),
  // no en el modelo overwrite. La vista expone camara − traspasadas − merma.
  const { data: stockPastasVedia } = useQuery({
    queryKey: ['resumen-semanal-stock-pastas-vedia'],
    enabled: local === 'vedia',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cocina_stock_pastas')
        .select('producto_id, porciones_camara, porciones_traspasadas, porciones_merma')
        .eq('local', 'vedia');
      if (error) throw error;
      return (data ?? []) as {
        producto_id: string;
        porciones_camara: number | null;
        porciones_traspasadas: number | null;
        porciones_merma: number | null;
      }[];
    },
  });

  // Ventas Fudo (14d) para estimar la demanda semanal.
  const hace14 = useMemo(
    () => new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0],
    [],
  );
  const hoyStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  const { data: fudoData } = useQuery({
    queryKey: ['resumen-semanal-fudo', local, hace14, hoyStr],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local, fechaDesde: hace14, fechaHasta: hoyStr },
      });
      if (error || !data?.ok) return null;
      return data.data as FudoResp;
    },
    staleTime: 10 * 60 * 1000,
  });

  const resumen = useMemo<ResumenItem[]>(() => {
    if (!productos) return [];

    function demandaSemanalDe(prod: ProductoCat): number {
      if (!fudoData || fudoData.dias <= 0) return 0;
      const objetivos = nombresFudoDe(prod).map((n) => n.toLowerCase().trim());
      let total = 0;
      for (const r of fudoData.ranking) {
        if (objetivos.includes(r.nombre.toLowerCase().trim())) total += r.cantidad;
      }
      return (total / fudoData.dias) * 7;
    }

    function stockDe(prod: ProductoCat): number {
      // Pastas Vedia leen de v_cocina_stock_pastas (cámara − traspasos − merma).
      if (local === 'vedia' && prod.tipo === 'pasta') {
        const row = (stockPastasVedia ?? []).find((s) => s.producto_id === prod.id);
        if (!row) return 0;
        const camara = Number(row.porciones_camara) || 0;
        const traspasos = Number(row.porciones_traspasadas) || 0;
        const merma = Number(row.porciones_merma) || 0;
        return Math.max(0, camara - traspasos - merma);
      }
      // Resto: modelo overwrite en cocina_lotes_produccion.
      const objetivoNombre = normNombre(prod.nombre);
      let total = 0;
      for (const l of lotes ?? []) {
        const matchNombre =
          !!l.nombre_libre && normNombre(l.nombre_libre) === objetivoNombre;
        const matchReceta = !!prod.receta_id && l.receta_id === prod.receta_id;
        if (matchNombre || matchReceta) {
          total += Math.max(0, Number(l.cantidad_producida) - (Number(l.merma_cantidad) || 0));
        }
      }
      return total;
    }

    const items = productos
      .filter((p) => tiposLocal.includes(p.tipo))
      .map<ResumenItem>((p) => {
        const demandaSemanal = demandaSemanalDe(p);
        const stockActual = stockDe(p);
        let estado: Estado;
        if (demandaSemanal <= 0) {
          estado = 'sin_demanda';
        } else {
          const ratio = stockActual / demandaSemanal;
          if (ratio < 0.8) estado = 'corto';
          else if (ratio < 0.95) estado = 'ajustado';
          else if (ratio <= 1.2) estado = 'cubre';
          else estado = 'sobra';
        }
        return {
          id: p.id,
          nombre: p.nombre,
          tipo: p.tipo,
          stockActual,
          demandaSemanal,
          estado,
        };
      });

    return items.sort((a, b) => {
      if (ORDEN_ESTADO[a.estado] !== ORDEN_ESTADO[b.estado])
        return ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado];
      return b.demandaSemanal - a.demandaSemanal;
    });
  }, [productos, lotes, stockPastasVedia, fudoData, tiposLocal, local]);

  // Agrupado por tipo, respetando el orden de tipos del local. resumen ya viene
  // ordenado por estado, así que cada grupo conserva ese orden interno.
  const secciones = useMemo(
    () =>
      tiposLocal
        .map((tipo) => ({ tipo, items: resumen.filter((r) => r.tipo === tipo) }))
        .filter((s) => s.items.length > 0),
    [resumen, tiposLocal],
  );

  if (resumen.length === 0) return null;

  const cortos = resumen.filter((r) => r.estado === 'corto').length;

  return (
    <div className="rounded-lg border border-blue-200 bg-white">
      <button
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            📊 Resumen semanal{' '}
            <span className="text-xs font-normal capitalize text-gray-500">· {local}</span>
          </h3>
          <p className="text-[11px] text-gray-500">
            {resumen.length} producto{resumen.length === 1 ? '' : 's'} · demanda Fudo (7d) vs
            stock
            {cortos > 0 && (
              <span className="ml-1 font-medium text-red-700">
                · {cortos} falta{cortos === 1 ? '' : 'n'}
              </span>
            )}
          </p>
        </div>
        <span className="text-xs text-gray-500">{abierto ? '▾' : '▸'}</span>
      </button>

      {abierto && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3">
          {secciones.map(({ tipo, items }) => (
            <section key={tipo}>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <span className="text-sm">{TIPO_EMOJI[tipo] ?? '•'}</span>
                {TIPO_LABEL[tipo] ?? tipo}
                <span className="font-normal text-gray-400">· {items.length}</span>
              </h4>
              <div className="space-y-1">
                {items.map((r) => {
                  const lbl = ESTADO_LABEL[r.estado];
                  const pct =
                    r.demandaSemanal > 0
                      ? Math.round((r.stockActual / r.demandaSemanal) * 100)
                      : null;
                  return (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded bg-gray-50/40 px-2 py-1 text-xs"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-gray-900">
                            {r.nombre}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            stock ~{Math.round(r.stockActual)}
                            {r.demandaSemanal > 0 ? (
                              <>
                                {' · demanda ~'}
                                {Math.round(r.demandaSemanal)} (7d)
                              </>
                            ) : (
                              ' · sin ventas Fudo (7d)'
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="ml-2 flex items-center gap-1.5">
                        {pct !== null && (
                          <span className="text-[10px] text-gray-500">{pct}%</span>
                        )}
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
                            lbl.cls,
                          )}
                        >
                          {lbl.texto}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
