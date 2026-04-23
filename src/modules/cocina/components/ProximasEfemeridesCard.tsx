import { Link } from 'react-router-dom';
import {
  useProximasEfemerides,
  CATEGORIA_LABEL,
  CATEGORIA_COLOR,
  formatFechaEfemeride,
  labelDiasRestantes,
} from '../hooks/useEfemerides';

interface Props {
  diasAdelante?: number;
  linkACalendario?: boolean;
}

export function ProximasEfemeridesCard({ diasAdelante = 15, linkACalendario = true }: Props) {
  const { proximas, isLoading } = useProximasEfemerides(diasAdelante);

  return (
    <div className="rounded-lg border border-surface-border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Próximas efemérides</h3>
          <p className="text-[11px] text-gray-400">
            Próximos {diasAdelante} días · ideas para menú, promos y redes
          </p>
        </div>
        {linkACalendario && (
          <Link to="/cocina" className="text-[11px] text-rodziny-700 hover:underline">
            Ver calendario →
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="py-3 text-xs text-gray-400">Cargando…</div>
      ) : proximas.length === 0 ? (
        <div className="py-3 text-center text-xs italic text-gray-400">
          No hay efemérides en los próximos {diasAdelante} días
        </div>
      ) : (
        <ul className="space-y-2">
          {proximas.map((e, i) => (
            <li
              key={`${e.id}-${e.fecha.toISOString()}-${i}`}
              className="flex items-start gap-3 border-b border-gray-100 py-1.5 last:border-b-0"
            >
              <div className="w-16 flex-shrink-0 text-center">
                <div className="text-xs font-medium uppercase text-gray-400">
                  {labelDiasRestantes(e.diasRestantes)}
                </div>
                <div className="text-[10px] capitalize text-gray-400">
                  {formatFechaEfemeride(e.fecha)}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-800">{e.nombre}</span>
                  <span
                    className={
                      'rounded-full px-1.5 py-0.5 text-[10px] font-medium ' +
                      CATEGORIA_COLOR[e.categoria]
                    }
                  >
                    {CATEGORIA_LABEL[e.categoria]}
                  </span>
                </div>
                {e.idea_plato && (
                  <p className="mt-0.5 text-[11px] leading-snug text-gray-500">💡 {e.idea_plato}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
