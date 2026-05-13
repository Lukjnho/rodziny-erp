import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface LoteSaldo {
  lote_pasta_id: string;
  producto_id: string;
  local: string;
  fecha_armado: string;
  fecha_porcionado: string | null;
  porciones_iniciales: number;
  porciones_a_mostrador: number;
  porciones_merma_camara: number;
  porciones_ajuste_camara: number;
  saldo_camara: number;
  responsable_armado: string | null;
  responsable_porcionado: string | null;
  ubicacion: 'camara_congelado' | 'freezer_produccion';
}

interface Producto {
  id: string;
  nombre: string;
  local: string;
}

function diasDesde(fecha: string): number {
  const d = new Date(fecha + 'T12:00:00');
  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);
  return Math.max(0, Math.floor((hoy.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

function ddmm(fecha: string): string {
  const [, mm, dd] = fecha.split('-');
  return `${dd}/${mm}`;
}

export function StockPorLoteSection({
  filtroLocal,
}: {
  filtroLocal: 'todos' | 'vedia' | 'saavedra';
}) {
  const [abierto, setAbierto] = useState(false);

  const { data: lotes, isLoading } = useQuery({
    queryKey: ['cocina-stock-por-lote', filtroLocal],
    queryFn: async () => {
      let q = supabase
        .from('v_cocina_lote_pasta_saldo')
        .select(
          'lote_pasta_id, producto_id, local, fecha_armado, fecha_porcionado, porciones_iniciales, porciones_a_mostrador, porciones_merma_camara, porciones_ajuste_camara, saldo_camara, responsable_armado, responsable_porcionado, ubicacion',
        )
        .order('fecha_armado', { ascending: true });
      if (filtroLocal !== 'todos') q = q.eq('local', filtroLocal);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LoteSaldo[];
    },
    enabled: abierto,
  });

  const { data: productos } = useQuery({
    queryKey: ['cocina-productos-nombres'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, local')
        .eq('activo', true);
      if (error) throw error;
      const m = new Map<string, Producto>();
      for (const p of (data ?? []) as Producto[]) m.set(`${p.id}|${p.local}`, p);
      return m;
    },
    enabled: abierto,
  });

  // Agrupar por producto. Solo lotes con algo "vivo" (saldo cámara > 0 o ya en mostrador).
  const agrupado = useMemo(() => {
    if (!lotes) return [];
    const map = new Map<string, { producto: Producto | null; key: string; lotes: LoteSaldo[] }>();
    for (const l of lotes) {
      if (l.saldo_camara <= 0 && l.porciones_a_mostrador <= 0) continue;
      const key = `${l.producto_id}|${l.local}`;
      let grupo = map.get(key);
      if (!grupo) {
        grupo = { producto: productos?.get(key) ?? null, key, lotes: [] };
        map.set(key, grupo);
      }
      grupo.lotes.push(l);
    }
    return Array.from(map.values()).sort((a, b) => {
      const an = a.producto?.nombre ?? '';
      const bn = b.producto?.nombre ?? '';
      return an.localeCompare(bn);
    });
  }, [lotes, productos]);

  const totalLotes = agrupado.reduce((s, g) => s + g.lotes.length, 0);

  return (
    <div className="rounded-lg border border-surface-border bg-white">
      <button
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Stock por lote <span className="text-xs font-normal text-gray-500">· FIFO</span>
          </h3>
          <p className="text-[11px] text-gray-500">
            Lotes activos en cámara o ya trasladados al mostrador. El primero de la lista por
            producto es el que saldrá primero (más antiguo).
          </p>
        </div>
        <span className="text-xs text-gray-500">
          {abierto ? '▾' : '▸'}
          {abierto && totalLotes > 0 && ` ${totalLotes} lotes`}
        </span>
      </button>

      {abierto && (
        <div className="border-t border-gray-100 px-4 py-3">
          {isLoading ? (
            <div className="text-center text-xs text-gray-400">Cargando…</div>
          ) : agrupado.length === 0 ? (
            <div className="text-center text-xs text-gray-400">
              Sin lotes activos para este filtro.
            </div>
          ) : (
            <div className="space-y-3">
              {agrupado.map((grupo) => {
                const totalSaldo = grupo.lotes.reduce((s, l) => s + Number(l.saldo_camara), 0);
                const totalMostrador = grupo.lotes.reduce(
                  (s, l) => s + Number(l.porciones_a_mostrador),
                  0,
                );
                return (
                  <div key={grupo.key} className="rounded border border-gray-100 bg-gray-50/40 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">
                        {grupo.producto?.nombre ?? '(producto sin nombre)'}
                        <span className="ml-2 text-[10px] font-normal capitalize text-gray-500">
                          {grupo.lotes[0].local}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-600">
                        ❄️ {totalSaldo} cámara · 🛒 {totalMostrador} mostrador
                      </div>
                    </div>
                    <div className="space-y-0.5">
                      {grupo.lotes.map((l, idx) => {
                        const dias = diasDesde(l.fecha_armado);
                        const pctAMostrador = Math.min(
                          100,
                          Math.round(
                            (Number(l.porciones_a_mostrador) / Number(l.porciones_iniciales)) * 100,
                          ),
                        );
                        return (
                          <div
                            key={l.lote_pasta_id}
                            className="flex items-center justify-between rounded border-l-2 border-gray-200 bg-white px-2 py-1 text-[11px]"
                          >
                            <div className="flex-1">
                              <div className="text-gray-700">
                                {idx === 0 && Number(l.saldo_camara) > 0 && (
                                  <span className="mr-1 rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase text-amber-800">
                                    Sale primero
                                  </span>
                                )}
                                Lote del {ddmm(l.fecha_armado)}
                                <span className="ml-1 text-[10px] text-gray-400">
                                  · {dias === 0 ? 'hoy' : `${dias}d`}
                                </span>
                                {l.responsable_armado && (
                                  <span className="ml-1 text-[10px] text-gray-400">
                                    · {l.responsable_armado}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-gray-100">
                                <div
                                  className={cn(
                                    'h-full transition-all',
                                    pctAMostrador === 100 ? 'bg-emerald-500' : 'bg-emerald-400',
                                  )}
                                  style={{ width: `${pctAMostrador}%` }}
                                />
                              </div>
                            </div>
                            <div className="ml-2 text-right text-[10px] text-gray-600">
                              <div>
                                {Number(l.porciones_iniciales)} armadas
                              </div>
                              <div className="text-emerald-700">
                                {Number(l.porciones_a_mostrador)} mostrador
                              </div>
                              <div className="text-blue-700">
                                {Number(l.saldo_camara)} cámara
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
