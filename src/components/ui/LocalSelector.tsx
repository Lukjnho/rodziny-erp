import { cn } from '@/lib/utils'

type LocalOption = 'vedia' | 'saavedra' | 'ambos' | 'consolidado'

interface Props {
  value: string
  onChange: (v: string) => void
  options?: LocalOption[]
}

const LABELS: Record<LocalOption, string> = {
  vedia: 'Rodziny Vedia',
  saavedra: 'Rodziny Saavedra',
  ambos: 'Ambos Locales',
  consolidado: 'Consolidado',
}

export function LocalSelector({ value, onChange, options = ['vedia', 'saavedra'] }: Props) {
  return (
    <div className="flex rounded-md border border-gray-300 overflow-hidden">
      {options.map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={cn(
            'px-4 py-1.5 text-sm font-medium transition-colors',
            value === l ? 'bg-rodziny-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
          )}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  )
}
