// ExtractosAlerta — alerta compartida que avisa cuándo falta importar extractos.
//
// Dos variantes:
//   - 'card':    tarjeta para Dashboard (con detalle por cuenta)
//   - 'banner':  banner compacto para ComprasPage (solo se renderiza si hay aviso/critico)

import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  useExtractosFrescura,
  hayCuentasAtrasadas,
  peorEstado,
  LABEL_CUENTA,
  type FrescuraCuenta,
  type EstadoFrescura,
} from '../hooks/useExtractosFrescura';

interface Props {
  variant: 'card' | 'banner';
  /** ruta a la que llevar al hacer click. Default: '/compras' (tab Conciliación). */
  to?: string;
}

const COLOR_ESTADO: Record<EstadoFrescura, { bg: string; border: string; text: string; chip: string }> = {
  ok:        { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-800',  chip: 'bg-green-100 text-green-800' },
  aviso:     { bg: 'bg-amber-50',  border: 'border-amber-300',  text: 'text-amber-900',  chip: 'bg-amber-100 text-amber-900' },
  critico:   { bg: 'bg-red-50',    border: 'border-red-300',    text: 'text-red-900',    chip: 'bg-red-100 text-red-900' },
  sin_datos: { bg: 'bg-gray-50',   border: 'border-gray-200',   text: 'text-gray-700',   chip: 'bg-gray-100 text-gray-700' },
};

const LABEL_ESTADO: Record<EstadoFrescura, string> = {
  ok: 'Al día',
  aviso: '⚠ Toca importar',
  critico: '🚨 Falta importar',
  sin_datos: 'Sin datos',
};

function formatDias(d: number, est: EstadoFrescura): string {
  if (est === 'sin_datos') return 'sin movimientos cargados';
  if (d === 0) return 'última transacción hoy';
  if (d === 1) return 'última transacción ayer';
  return `última transacción hace ${d} días`;
}

export function ExtractosAlerta({ variant, to = '/compras' }: Props) {
  const { data: frescura, isLoading } = useExtractosFrescura();

  if (isLoading || !frescura) return null;

  // Banner: solo renderiza si hay alguna cuenta en aviso o crítico
  if (variant === 'banner') {
    if (!hayCuentasAtrasadas(frescura)) return null;
    return <BannerCompacto frescura={frescura} to={to} />;
  }

  return <Tarjeta frescura={frescura} to={to} />;
}

function BannerCompacto({ frescura, to }: { frescura: FrescuraCuenta[]; to: string }) {
  const est = peorEstado(frescura);
  const c = COLOR_ESTADO[est];
  const atrasadas = frescura.filter((f) => f.estado === 'aviso' || f.estado === 'critico');

  return (
    <Link
      to={to}
      className={cn(
        'mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition hover:opacity-90',
        c.bg, c.border, c.text,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold">
          {est === 'critico' ? '🚨' : '⚠'} Falta importar extracto
          {atrasadas.length > 1 ? 's' : ''}:
        </span>
        <span className="flex flex-wrap gap-1.5">
          {atrasadas.map((f) => (
            <span key={f.cuenta} className={cn('rounded px-2 py-0.5 text-xs font-medium', COLOR_ESTADO[f.estado].chip)}>
              {LABEL_CUENTA[f.cuenta]} ({f.diasDesde}d)
            </span>
          ))}
        </span>
      </div>
      <span className="text-xs underline">Ir a Conciliación →</span>
    </Link>
  );
}

function Tarjeta({ frescura, to }: { frescura: FrescuraCuenta[]; to: string }) {
  const est = peorEstado(frescura);
  const c = COLOR_ESTADO[est];

  return (
    <Link
      to={to}
      className={cn(
        'block rounded-lg border p-4 transition hover:shadow-sm',
        c.bg, c.border,
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className={cn('text-sm font-semibold', c.text)}>📥 Extractos bancarios</div>
        <span className={cn('rounded px-2 py-0.5 text-xs font-medium', c.chip)}>
          {LABEL_ESTADO[est]}
        </span>
      </div>
      <div className="space-y-1.5">
        {frescura.map((f) => {
          const cf = COLOR_ESTADO[f.estado];
          return (
            <div key={f.cuenta} className="flex items-center justify-between text-xs">
              <span className="font-medium text-gray-700">{LABEL_CUENTA[f.cuenta]}</span>
              <span className={cn('rounded px-1.5 py-0.5 font-medium', cf.chip)}>
                {formatDias(f.diasDesde, f.estado)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-xs text-gray-500">
        Recordatorio quincenal: importá los días <strong>15</strong> y <strong>fin de mes</strong>.
      </div>
    </Link>
  );
}
