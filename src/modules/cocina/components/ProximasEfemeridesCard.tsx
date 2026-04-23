import { Link } from 'react-router-dom'
import { useProximasEfemerides, CATEGORIA_LABEL, CATEGORIA_COLOR, formatFechaEfemeride, labelDiasRestantes } from '../hooks/useEfemerides'

interface Props {
  diasAdelante?: number
  linkACalendario?: boolean
}

export function ProximasEfemeridesCard({ diasAdelante = 15, linkACalendario = true }: Props) {
  const { proximas, isLoading } = useProximasEfemerides(diasAdelante)

  return (
    <div className="bg-white rounded-lg border border-surface-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Próximas efemérides</h3>
          <p className="text-[11px] text-gray-400">Próximos {diasAdelante} días · ideas para menú, promos y redes</p>
        </div>
        {linkACalendario && (
          <Link to="/cocina" className="text-[11px] text-rodziny-700 hover:underline">
            Ver calendario →
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="text-xs text-gray-400 py-3">Cargando…</div>
      ) : proximas.length === 0 ? (
        <div className="text-xs text-gray-400 py-3 text-center italic">
          No hay efemérides en los próximos {diasAdelante} días
        </div>
      ) : (
        <ul className="space-y-2">
          {proximas.map((e, i) => (
            <li key={`${e.id}-${e.fecha.toISOString()}-${i}`} className="flex items-start gap-3 py-1.5 border-b border-gray-100 last:border-b-0">
              <div className="flex-shrink-0 w-16 text-center">
                <div className="text-xs text-gray-400 uppercase font-medium">
                  {labelDiasRestantes(e.diasRestantes)}
                </div>
                <div className="text-[10px] text-gray-400 capitalize">{formatFechaEfemeride(e.fecha)}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-800">{e.nombre}</span>
                  <span className={'text-[10px] px-1.5 py-0.5 rounded-full font-medium ' + CATEGORIA_COLOR[e.categoria]}>
                    {CATEGORIA_LABEL[e.categoria]}
                  </span>
                </div>
                {e.idea_plato && (
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                    💡 {e.idea_plato}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
