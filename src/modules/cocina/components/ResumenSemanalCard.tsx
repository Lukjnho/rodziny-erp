import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { PRODUCTOS_COCINA, normNombre } from '../DashboardTab';

// El Resumen semanal proyecta la PRODUCCIÓN PLANIFICADA esta semana
// (cocina_pizarron_items × rendimiento_porciones de la receta) vs la demanda
// Fudo 7d. Aplica solo a pastas y postres. Match por receta_id: el item del
// pizarrón vincula receta, y la pasta-producto vincula la MISMA receta en
// cocina_productos.receta_id (típicamente la del relleno).

type LocalCocina = 'vedia' | 'saavedra';

interface ProductoCat {
  id: string;
  nombre: string;
  tipo: string;
  receta_id: string | null;
  fudo_nombres: string[] | null;
}

interface ItemPlan {
  receta_id: string;
  cantidad_recetas: number;
  estado: string;
  rendimiento_porciones: number | null;
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
  planificado: number;
  demandaSemanal: number;
  estado: Estado;
}

// Solo pastas y postres entran al resumen, en ambos locales.
const TIPOS_POR_LOCAL: Record<LocalCocina, string[]> = {
  saavedra: ['pasta', 'postre'],
  vedia: ['pasta', 'postre'],
};

// Lunes de la semana de una fecha dada (semana lunes-domingo).
function lunesDeSemana(fechaIso: string): string {
  const d = new Date(fechaIso + 'T00:00:00');
  const diaSemana = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - diaSemana);
  return d.toISOString().split('T')[0];
}
function sumarDias(fechaIso: string, dias: number): string {
  const d = new Date(fechaIso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

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
  fechaReferencia,
}: {
  local: LocalCocina;
  // Fecha pivote para determinar la semana del plan a leer (lunes-domingo).
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

  // Items del pizarrón de la semana en curso (lunes-domingo).
  const semana = useMemo(() => {
    const lunes = lunesDeSemana(fechaReferencia);
    return { lunes, domingo: sumarDias(lunes, 6) };
  }, [fechaReferencia]);

  const { data: itemsPlan } = useQuery({
    queryKey: ['resumen-semanal-plan', local, semana.lunes, semana.domingo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pizarron_items')
        .select(
          'receta_id, cantidad_recetas, estado, receta:cocina_recetas(rendimiento_porciones)',
        )
        .eq('local', local)
        .gte('fecha_objetivo', semana.lunes)
        .lte('fecha_objetivo', semana.domingo)
        .neq('estado', 'cancelado')
        .not('receta_id', 'is', null);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const rec = Array.isArray(r.receta) ? r.receta[0] : r.receta;
        return {
          receta_id: r.receta_id as string,
          cantidad_recetas: Number(r.cantidad_recetas) || 0,
          estado: r.estado as string,
          rendimiento_porciones: rec?.rendimiento_porciones ?? null,
        } as ItemPlan;
      });
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

    // Proyección: items del pizarrón de la semana cuya receta coincide con
    // la receta vinculada al producto, × rinde. Si el producto no tiene
    // receta_id o la receta no tiene rinde, queda en 0 (señal de qué falta
    // cargar para que el cálculo funcione).
    function planificadoDe(prod: ProductoCat): number {
      if (!prod.receta_id) return 0;
      let total = 0;
      for (const it of itemsPlan ?? []) {
        if (it.receta_id !== prod.receta_id) continue;
        const rinde = Number(it.rendimiento_porciones) || 0;
        if (rinde <= 0) continue;
        total += it.cantidad_recetas * rinde;
      }
      return total;
    }

    const items = productos
      .filter((p) => tiposLocal.includes(p.tipo))
      .map<ResumenItem>((p) => {
        const demandaSemanal = demandaSemanalDe(p);
        const planificado = planificadoDe(p);
        let estado: Estado;
        if (demandaSemanal <= 0) {
          estado = 'sin_demanda';
        } else {
          const ratio = planificado / demandaSemanal;
          if (ratio < 0.8) estado = 'corto';
          else if (ratio < 0.95) estado = 'ajustado';
          else if (ratio <= 1.2) estado = 'cubre';
          else estado = 'sobra';
        }
        return {
          id: p.id,
          nombre: p.nombre,
          tipo: p.tipo,
          planificado,
          demandaSemanal,
          estado,
        };
      });

    return items.sort((a, b) => {
      if (ORDEN_ESTADO[a.estado] !== ORDEN_ESTADO[b.estado])
        return ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado];
      return b.demandaSemanal - a.demandaSemanal;
    });
  }, [productos, itemsPlan, fudoData, tiposLocal]);

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
            {resumen.length} producto{resumen.length === 1 ? '' : 's'} · planificado (semana) vs
            demanda Fudo (7d)
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
                      ? Math.round((r.planificado / r.demandaSemanal) * 100)
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
                            planif. ~{Math.round(r.planificado)}
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
