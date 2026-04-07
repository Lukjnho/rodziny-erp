import { cn } from '@/lib/utils'
import { type ReactNode } from 'react'

type Color = 'green' | 'yellow' | 'red' | 'blue' | 'neutral'

interface Props {
  label: string
  value: string
  change?: number        // % vs período anterior
  icon?: ReactNode
  color?: Color
  loading?: boolean
}

const borderColor: Record<Color, string> = {
  green:   '#22c55e',
  yellow:  '#f59e0b',
  red:     '#ef4444',
  blue:    '#3b82f6',
  neutral: '#9ca3af',
}

export function KPICard({ label, value, change, icon, color = 'neutral', loading }: Props) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg p-5 border border-surface-border animate-pulse kpi-card">
        <div className="h-3 bg-gray-200 rounded w-24 mb-4" />
        <div className="h-8 bg-gray-200 rounded w-32" />
      </div>
    )
  }

  return (
    <div
      className="bg-white rounded-lg p-5 border border-surface-border kpi-card"
      style={{ borderLeft: `3px solid ${borderColor[color]}` }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</span>
        {icon && <span className="text-gray-400">{icon}</span>}
      </div>
      <div className="text-kpi text-gray-900">{value}</div>
      {change !== undefined && (
        <div className={cn('text-xs mt-1 font-medium', change >= 0 ? 'text-green-600' : 'text-red-500')}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% vs período anterior
        </div>
      )}
    </div>
  )
}
