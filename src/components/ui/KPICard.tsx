import { cn } from '@/lib/utils';
import { type ReactNode } from 'react';

type Color = 'green' | 'yellow' | 'red' | 'blue' | 'neutral';

interface Props {
  label: string;
  value: string;
  change?: number; // % vs período anterior
  icon?: ReactNode;
  color?: Color;
  loading?: boolean;
  onClick?: () => void; // si está seteado, la card es clickeable (filtro/drill-down)
  active?: boolean; // resalta la card (indica filtro activo)
}

const borderColor: Record<Color, string> = {
  green: '#22c55e',
  yellow: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
  neutral: '#9ca3af',
};

export function KPICard({
  label,
  value,
  change,
  icon,
  color = 'neutral',
  loading,
  onClick,
  active,
}: Props) {
  if (loading) {
    return (
      <div className="kpi-card animate-pulse rounded-lg border border-surface-border bg-white p-5">
        <div className="mb-4 h-3 w-24 rounded bg-gray-200" />
        <div className="h-8 w-32 rounded bg-gray-200" />
      </div>
    );
  }

  const Tag: 'button' | 'div' = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={cn(
        'kpi-card w-full rounded-lg border border-surface-border bg-white p-5 text-left',
        onClick && 'cursor-pointer transition-all hover:bg-gray-50 hover:shadow-sm',
        active && 'bg-gray-50 ring-2 ring-offset-1',
      )}
      style={{
        borderLeft: `3px solid ${borderColor[color]}`,
        ...(active ? { boxShadow: `inset 0 0 0 1px ${borderColor[color]}` } : {}),
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</span>
        {icon && <span className="text-gray-400">{icon}</span>}
      </div>
      <div className="text-kpi text-gray-900">{value}</div>
      {change !== undefined && (
        <div
          className={cn(
            'mt-1 text-xs font-medium',
            change >= 0 ? 'text-green-600' : 'text-red-500',
          )}
        >
          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% vs período anterior
        </div>
      )}
    </Tag>
  );
}
