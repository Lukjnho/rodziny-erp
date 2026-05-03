import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PageContainer } from '@/components/layout/PageContainer';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { KPICard } from '@/components/ui/KPICard';
import { cn, formatARS } from '@/lib/utils';
import { ListadoGastos } from './ListadoGastos';
import { PagosPanel } from './PagosPanel';
import { AnalisisGastos } from './AnalisisGastos';
import { CategoriasPanel } from './CategoriasPanel';
import { NuevoGastoModal } from './NuevoGastoModal';
import type { Gasto } from './types';

type Tab = 'listado' | 'pagos' | 'analisis' | 'categorias';
type Local = 'vedia' | 'saavedra' | 'ambos';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'listado', label: 'Listado', icon: '📋' },
  { id: 'pagos', label: 'Pagos', icon: '💳' },
  { id: 'analisis', label: 'Análisis', icon: '📊' },
  { id: 'categorias', label: 'Categorías', icon: '🏷' },
];

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function diasEntre(desde: string, hasta: string): number {
  const d1 = new Date(desde + 'T12:00:00Z').getTime();
  const d2 = new Date(hasta + 'T12:00:00Z').getTime();
  return Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
}

function periodoAnterior(desde: string, hasta: string): { d: string; h: string } {
  const dias = diasEntre(desde, hasta);
  const dHasta = new Date(desde + 'T12:00:00Z');
  dHasta.setUTCDate(dHasta.getUTCDate() - 1);
  const dDesde = new Date(dHasta.getTime());
  dDesde.setUTCDate(dDesde.getUTCDate() - (dias - 1));
  return { d: ymd(dDesde), h: ymd(dHasta) };
}

interface ResumenGastos {
  total: number;
  cantidad: number;
  pagado: number;
  pendiente: number;
}

function resumir(rows: { importe_total: number; estado_pago: string | null }[]): ResumenGastos {
  let total = 0;
  let pagado = 0;
  let pendiente = 0;
  for (const r of rows) {
    const v = Number(r.importe_total ?? 0);
    total += v;
    if ((r.estado_pago ?? '').toLowerCase() === 'pagado') pagado += v;
    else pendiente += v;
  }
  return { total, cantidad: rows.length, pagado, pendiente };
}

export function GastosPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<Tab>('listado');

  // Estado global del módulo (compartido por sub-tabs)
  const ahora = new Date();
  const hoy = ymd(ahora);
  const hace7 = ymd(new Date(Date.now() - 7 * 86400000));
  const hace30 = ymd(new Date(Date.now() - 30 * 86400000));
  const primerDelMes = ymd(new Date(ahora.getFullYear(), ahora.getMonth(), 1));
  const primerMesAnt = ymd(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1));
  const ultimoMesAnt = ymd(new Date(ahora.getFullYear(), ahora.getMonth(), 0));

  const [local, setLocal] = useState<Local>('vedia');
  const [desde, setDesde] = useState(primerDelMes);
  const [hasta, setHasta] = useState(hoy);

  // Modal de nuevo gasto centralizado (botón siempre disponible en el header)
  const [modalOpen, setModalOpen] = useState(false);
  const [gastoEditando, setGastoEditando] = useState<Gasto | null>(null);

  const localActivo: 'vedia' | 'saavedra' | null = local === 'ambos' ? null : local;
  const ocultarHeader = tab === 'categorias';

  // Período anterior (mismo nro de días, justo antes)
  const periodoAnt = useMemo(() => periodoAnterior(desde, hasta), [desde, hasta]);

  // Resumen actual: total, cantidad, pagado, pendiente
  const { data: resumenActual } = useQuery({
    queryKey: ['gastos_resumen_kpis', local, desde, hasta],
    queryFn: async () => {
      let q = supabase
        .from('gastos')
        .select('importe_total, estado_pago')
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .neq('cancelado', true);
      if (localActivo) q = q.eq('local', localActivo);
      const { data, error } = await q;
      if (error) throw error;
      return resumir(data ?? []);
    },
    enabled: !ocultarHeader,
  });

  // Resumen período anterior — sólo para Δ% de "Total comprado"
  const { data: resumenAnt } = useQuery({
    queryKey: ['gastos_resumen_kpis', local, periodoAnt.d, periodoAnt.h],
    queryFn: async () => {
      let q = supabase
        .from('gastos')
        .select('importe_total, estado_pago')
        .gte('fecha', periodoAnt.d)
        .lte('fecha', periodoAnt.h)
        .neq('cancelado', true);
      if (localActivo) q = q.eq('local', localActivo);
      const { data, error } = await q;
      if (error) throw error;
      return resumir(data ?? []);
    },
    enabled: !ocultarHeader,
  });

  // Ventas del período (para ratio gasto/venta) — paginado
  const { data: ventasPeriodo } = useQuery({
    queryKey: ['ventas_para_ratio_compras', local, desde, hasta],
    queryFn: async () => {
      const PAGE = 1000;
      let total = 0;
      let from = 0;
      while (true) {
        let q = supabase
          .from('ventas_tickets')
          .select('total_bruto')
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .neq('estado', 'Cancelada')
          .neq('estado', 'Eliminada')
          .or('es_dividendo.is.null,es_dividendo.eq.false')
          .range(from, from + PAGE - 1);
        if (localActivo) q = q.eq('local', localActivo);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data) total += Number(r.total_bruto ?? 0);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return total;
    },
    enabled: !ocultarHeader,
  });

  const promedio = resumenActual && resumenActual.cantidad > 0
    ? resumenActual.total / resumenActual.cantidad
    : 0;
  const ratioGV = resumenActual && ventasPeriodo && ventasPeriodo > 0
    ? (resumenActual.total / ventasPeriodo) * 100
    : null;
  const deltaTotal = resumenActual && resumenAnt && resumenAnt.total > 0
    ? ((resumenActual.total - resumenAnt.total) / resumenAnt.total) * 100
    : undefined;

  function aplicarPreset(d: string, h: string) {
    setDesde(d);
    setHasta(h);
  }

  const inner = (
    <>
      {!ocultarHeader && (
        <>
          {/* Toolbar — patrón unificado con Resumen de Ventas */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-surface-border bg-white p-3">
            <LocalSelector
              value={local}
              onChange={(v) => setLocal(v as Local)}
              options={['vedia', 'saavedra', 'ambos']}
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Desde</label>
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Hasta</label>
              <input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </div>
            <div className="ml-2 flex flex-wrap gap-1">
              {[
                { label: 'Hoy', d: hoy, h: hoy },
                { label: 'Semana', d: hace7, h: hoy },
                { label: 'Mes', d: primerDelMes, h: hoy },
                { label: 'Mes anterior', d: primerMesAnt, h: ultimoMesAnt },
                { label: '30 días', d: hace30, h: hoy },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => aplicarPreset(p.d, p.h)}
                  className={cn(
                    'rounded px-2 py-1 text-xs',
                    desde === p.d && hasta === p.h
                      ? 'bg-rodziny-800 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setGastoEditando(null);
                setModalOpen(true);
              }}
              className="ml-auto rounded-md bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
            >
              + Nuevo gasto
            </button>
          </div>

          {/* KPIs comunes */}
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <KPICard
              label="Total comprado"
              value={formatARS(resumenActual?.total ?? 0)}
              color="blue"
              change={deltaTotal}
            />
            <KPICard
              label="Facturas"
              value={(resumenActual?.cantidad ?? 0).toLocaleString('es-AR')}
              color="neutral"
            />
            <KPICard
              label="Promedio / factura"
              value={formatARS(promedio)}
              color="yellow"
            />
            <KPICard
              label="Pagado"
              value={formatARS(resumenActual?.pagado ?? 0)}
              color="green"
            />
            <KPICard
              label="Pendiente"
              value={formatARS(resumenActual?.pendiente ?? 0)}
              color="red"
            />
            <KPICard
              label="Gasto / Venta"
              value={ratioGV !== null ? `${ratioGV.toFixed(1)}%` : '—'}
              color={ratioGV === null ? 'neutral' : ratioGV > 90 ? 'red' : ratioGV > 75 ? 'yellow' : 'green'}
            />
          </div>
        </>
      )}

      {/* Sub-tabs */}
      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.id
                ? 'border-rodziny-700 text-rodziny-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            <span className="mr-1">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'listado' && (
        <ListadoGastos
          local={local}
          desde={desde}
          hasta={hasta}
          onEditar={(g) => {
            setGastoEditando(g);
            setModalOpen(true);
          }}
        />
      )}
      {tab === 'pagos' && <PagosPanel local={local} desde={desde} hasta={hasta} />}
      {tab === 'analisis' && <AnalisisGastos local={local} />}
      {tab === 'categorias' && <CategoriasPanel />}

      {modalOpen && (
        <NuevoGastoModal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setGastoEditando(null);
          }}
          gastoEditando={gastoEditando}
        />
      )}
    </>
  );

  if (embedded) return inner;
  return (
    <PageContainer title="Gastos" subtitle="Compras, pagos y análisis">
      {inner}
    </PageContainer>
  );
}
