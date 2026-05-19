import { useState, useMemo } from 'react';
import { formatARS, cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useMenuEngineering, type ProductoME } from '../hooks/useMenuEngineering';
import { useProductosCosteoConfig } from '../hooks/useProductosCosteoConfig';

function ultimosMeses(n: number): string[] {
  const out: string[] = [];
  const hoy = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

type TipoAccion =
  | 'subir_precio_vaca'
  | 'subir_precio_margen_bajo'
  | 'eliminar_perro'
  | 'dar_visibilidad_puzzle'
  | 'sin_costo'
  | 'sin_venta';

interface AccionSugerida {
  id: string;
  tipo: TipoAccion;
  prioridad: number; // mayor = más urgente
  producto: ProductoME;
  impactoEstimadoMes: number | null; // $ ganancia/ahorro mensual estimado
  titulo: string;
  detalle: string;
  precioSugerido?: number;
}

const TIPO_LABEL: Record<TipoAccion, { label: string; icon: string; color: string }> = {
  subir_precio_vaca: { label: 'Subir precio (vaca)', icon: '📈', color: 'bg-blue-100 text-blue-900 border-blue-300' },
  subir_precio_margen_bajo: {
    label: 'Revisar precio (margen bajo)',
    icon: '⚠',
    color: 'bg-red-100 text-red-900 border-red-300',
  },
  eliminar_perro: { label: 'Eliminar (perro)', icon: '🗑', color: 'bg-red-50 text-red-800 border-red-200' },
  dar_visibilidad_puzzle: {
    label: 'Dar visibilidad (puzzle)',
    icon: '👁',
    color: 'bg-purple-100 text-purple-900 border-purple-300',
  },
  sin_costo: { label: 'Cargar costo', icon: '❓', color: 'bg-gray-100 text-gray-800 border-gray-300' },
  sin_venta: { label: 'Sin ventas', icon: '💤', color: 'bg-gray-100 text-gray-700 border-gray-300' },
};

export function PlanAccionTab() {
  const { perfil } = useAuth();
  const localRestringido = (perfil?.local_restringido ?? null) as 'vedia' | 'saavedra' | null;
  const meses = useMemo(() => ultimosMeses(1), []);
  const [local, setLocal] = useState<'vedia' | 'saavedra'>(localRestringido ?? 'vedia');
  const [tipoFiltro, setTipoFiltro] = useState<TipoAccion | 'todas'>('todas');

  const { productos, isLoading } = useMenuEngineering({ periodos: meses, local });
  const { getConfig } = useProductosCosteoConfig();

  const acciones = useMemo<AccionSugerida[]>(() => {
    const out: AccionSugerida[] = [];

    for (const p of productos) {
      const cfg = getConfig(p.tipo);

      // Acción A — Vaca: subir precio leve si no es ancla
      if (
        p.cuadrante === 'vaca' &&
        !p.esAncla &&
        p.unidadesVendidas > 0 &&
        p.precioPromedio > 0
      ) {
        // Sugerencia: subir 5% del precio promedio
        const nuevoPrecio = Math.round((p.precioPromedio * 1.05) / 100) * 100;
        const incrementoUnit = nuevoPrecio - p.precioPromedio;
        const impactoMes = incrementoUnit * p.unidadesVendidas;
        out.push({
          id: `vaca-${p.local}-${p.codigo}`,
          tipo: 'subir_precio_vaca',
          prioridad: Math.abs(impactoMes),
          producto: p,
          impactoEstimadoMes: impactoMes,
          titulo: `Subir ${p.nombre} ${formatARS(p.precioPromedio)} → ${formatARS(nuevoPrecio)}`,
          detalle: `${p.unidadesVendidas} uds/mes × +${formatARS(incrementoUnit)} = +${formatARS(impactoMes)}/mes estimado. Vaca con alta demanda absorbe subas leves.`,
          precioSugerido: nuevoPrecio,
        });
      }

      // Acción B — Margen abajo del mínimo de la categoría
      if (
        cfg &&
        p.margenPctSobrePrecio != null &&
        p.margenPctSobrePrecio < cfg.margen_min &&
        !p.esAncla
      ) {
        const diff = cfg.margen_min - p.margenPctSobrePrecio;
        out.push({
          id: `margen-${p.local}-${p.codigo}`,
          tipo: 'subir_precio_margen_bajo',
          prioridad: diff * Math.abs(p.contribucionAbsoluta ?? 0) * 10,
          producto: p,
          impactoEstimadoMes: null,
          titulo: `${p.nombre}: margen ${(p.margenPctSobrePrecio * 100).toFixed(1)}% (mínimo ${(cfg.margen_min * 100).toFixed(0)}%)`,
          detalle: `Categoría "${p.tipo}" pide al menos ${(cfg.margen_min * 100).toFixed(0)}% de margen. Faltan ${(diff * 100).toFixed(1)} puntos. Revisar costo o subir precio.`,
        });
      }

      // Acción C — Perro: candidato a eliminar
      if (p.cuadrante === 'perro' && !p.esAncla && p.unidadesVendidas < 20) {
        out.push({
          id: `perro-${p.local}-${p.codigo}`,
          tipo: 'eliminar_perro',
          prioridad: 1000 - p.unidadesVendidas, // menos ventas = más urgente
          producto: p,
          impactoEstimadoMes: -(p.contribucionAbsoluta ?? 0), // ahorro al sacarlo
          titulo: `${p.nombre}: candidato a eliminar`,
          detalle: `Solo ${p.unidadesVendidas} uds/mes y margen bajo. Si no cumple función estratégica (alérgicos, temporada, etc.) considerá sacarlo.`,
        });
      }

      // Acción D — Puzzle: visibilidad
      if (p.cuadrante === 'puzzle' && p.unidadesVendidas > 0) {
        out.push({
          id: `puzzle-${p.local}-${p.codigo}`,
          tipo: 'dar_visibilidad_puzzle',
          prioridad: (p.margenUnitario ?? 0) * 10,
          producto: p,
          impactoEstimadoMes: null,
          titulo: `${p.nombre}: dar visibilidad`,
          detalle: `Margen alto (${((p.margenPctSobrePrecio ?? 0) * 100).toFixed(1)}%) pero pocas ventas. Subir a zona destacada, recomendar desde sala.`,
        });
      }

      // Acción E — Sin costo cargado
      if (p.costoUnitario == null && p.unidadesVendidas > 0) {
        out.push({
          id: `sincosto-${p.local}-${p.codigo}`,
          tipo: 'sin_costo',
          prioridad: p.unidadesVendidas, // más vendido = más urgente
          producto: p,
          impactoEstimadoMes: null,
          titulo: `${p.nombre}: cargar receta / costo`,
          detalle: `Se vendieron ${p.unidadesVendidas} uds pero no hay costo cargado. No podemos calcular margen.`,
        });
      }
    }

    out.sort((a, b) => b.prioridad - a.prioridad);
    return out;
  }, [productos, getConfig]);

  const accionesVisibles = useMemo(() => {
    if (tipoFiltro === 'todas') return acciones;
    return acciones.filter((a) => a.tipo === tipoFiltro);
  }, [acciones, tipoFiltro]);

  const conteoPorTipo = useMemo(() => {
    const out: Record<TipoAccion, number> = {
      subir_precio_vaca: 0,
      subir_precio_margen_bajo: 0,
      eliminar_perro: 0,
      dar_visibilidad_puzzle: 0,
      sin_costo: 0,
      sin_venta: 0,
    };
    for (const a of acciones) out[a.tipo]++;
    return out;
  }, [acciones]);

  const impactoTotal = useMemo(() => {
    return acciones
      .filter((a) => a.impactoEstimadoMes != null && a.tipo === 'subir_precio_vaca')
      .reduce((s, a) => s + (a.impactoEstimadoMes ?? 0), 0);
  }, [acciones]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-rodziny-200 bg-rodziny-50 p-3 text-xs text-rodziny-900">
        <strong>Plan de acción del mes</strong> — el motor cruza ventas Fudo, costos cargados,
        margen objetivo por categoría y producto ancla para sugerirte movimientos priorizados por
        impacto en $.
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-gray-500">Local</label>
          <div className="flex gap-1">
            {(['vedia', 'saavedra'] as const).map((l) => (
              <button
                key={l}
                disabled={!!localRestringido && l !== localRestringido}
                onClick={() => setLocal(l)}
                className={cn(
                  'rounded px-3 py-1 text-xs capitalize disabled:opacity-30',
                  local === l
                    ? 'bg-rodziny-700 text-white'
                    : 'border border-gray-300 bg-white text-gray-700',
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto rounded border border-green-200 bg-green-50 p-2 text-xs text-green-800">
          Impacto potencial subas vacas: <strong>{formatARS(impactoTotal)}/mes</strong>
        </div>
      </div>

      {/* Filtro por tipo */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTipoFiltro('todas')}
          className={cn(
            'rounded border-2 px-3 py-1 text-xs',
            tipoFiltro === 'todas' ? 'border-rodziny-500 bg-rodziny-50' : 'border-gray-200 bg-white',
          )}
        >
          Todas ({acciones.length})
        </button>
        {(Object.keys(TIPO_LABEL) as TipoAccion[])
          .filter((t) => conteoPorTipo[t] > 0)
          .map((t) => {
            const cfg = TIPO_LABEL[t];
            const activo = tipoFiltro === t;
            return (
              <button
                key={t}
                onClick={() => setTipoFiltro(activo ? 'todas' : t)}
                className={cn(
                  'rounded border-2 px-3 py-1 text-xs',
                  cfg.color,
                  activo && 'ring-2 ring-rodziny-500',
                )}
              >
                {cfg.icon} {cfg.label} ({conteoPorTipo[t]})
              </button>
            );
          })}
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-400">
          Calculando acciones…
        </div>
      ) : accionesVisibles.length === 0 ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center text-sm text-green-800">
          🎉 Sin acciones pendientes según los filtros
        </div>
      ) : (
        <div className="space-y-2">
          {accionesVisibles.map((a) => (
            <AccionCard key={a.id} accion={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccionCard({ accion }: { accion: AccionSugerida }) {
  const cfg = TIPO_LABEL[accion.tipo];
  return (
    <div className={cn('rounded-lg border-l-4 bg-white p-3 shadow-sm', cfg.color)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-base">{cfg.icon}</span>
            <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
              {cfg.label}
            </span>
            {accion.producto.esAncla && (
              <span className="rounded bg-yellow-200 px-1.5 py-0.5 text-[9px] font-medium text-yellow-900">
                ⚓ ANCLA
              </span>
            )}
            <span className="ml-auto text-[10px] opacity-60">
              {accion.producto.local} · {accion.producto.tipo}
            </span>
          </div>
          <div className="text-sm font-semibold">{accion.titulo}</div>
          <div className="mt-1 text-[11px] leading-relaxed opacity-80">{accion.detalle}</div>
        </div>
        {accion.impactoEstimadoMes != null && (
          <div className="text-right">
            <div className="text-[9px] uppercase opacity-60">Impacto / mes</div>
            <div
              className={cn(
                'text-base font-bold tabular-nums',
                accion.impactoEstimadoMes >= 0 ? 'text-green-700' : 'text-red-700',
              )}
            >
              {accion.impactoEstimadoMes >= 0 ? '+' : ''}
              {formatARS(accion.impactoEstimadoMes)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
