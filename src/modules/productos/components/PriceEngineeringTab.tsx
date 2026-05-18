import { useState, useMemo } from 'react';
import { formatARS, cn } from '@/lib/utils';
import { usePriceEngineering } from '../hooks/usePriceEngineering';

function ultimosMeses(n: number): string[] {
  const out: string[] = [];
  const hoy = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function PriceEngineeringTab() {
  const meses = useMemo(() => ultimosMeses(3), []);
  const [local, setLocal] = useState<'todos' | 'vedia' | 'saavedra'>('todos');
  const [categoria, setCategoria] = useState<string>('todas');

  const { resultado, productos, isLoading } = usePriceEngineering(local, categoria, meses);

  const categorias = useMemo(() => {
    const set = new Set<string>();
    for (const p of productos) if (p.tipo) set.add(p.tipo);
    return Array.from(set).sort();
  }, [productos]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        <strong>Ley de Omnes</strong> (Cortijo): 4 principios para evaluar la estructura de precios
        de la carta. Esta vista calcula automáticamente los 3 primeros (el cuarto es presentación
        visual del menú, fuera del scope del ERP). Filtrá por <strong>categoría</strong> para
        analizar cada sección de la carta por separado.
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-gray-500">Local</label>
          <div className="flex gap-1">
            {(['todos', 'vedia', 'saavedra'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLocal(l)}
                className={cn(
                  'rounded px-3 py-1 text-xs capitalize',
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
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-gray-500">
            Categoría (recomendado analizar de a una)
          </label>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="todas">Todas (no recomendado)</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto text-xs text-gray-400">
          {productos.length} productos · ventas {meses[meses.length - 1]} → {meses[0]}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-400">
          Calculando…
        </div>
      ) : !resultado ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-400">
          Sin productos para los filtros seleccionados
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {/* Principio 1: Distribución */}
          <PrincipioCard
            num={1}
            titulo="Distribución de precios"
            ok={resultado.distribucionOk}
            detalle={
              <>
                Gama baja: <strong>{resultado.gamaBajaCount}</strong> (≤{' '}
                {formatARS(resultado.limiteBajaMedia)})
                <br />
                Gama media: <strong>{resultado.gamaMediaCount}</strong> (entre{' '}
                {formatARS(resultado.limiteBajaMedia)} y {formatARS(resultado.limiteMediaAlta)})
                <br />
                Gama alta: <strong>{resultado.gamaAltaCount}</strong> (&gt;{' '}
                {formatARS(resultado.limiteMediaAlta)})
              </>
            }
            criterio={
              resultado.distribucionOk
                ? 'Gama media ≥ baja + alta ✓'
                : `Falta peso en gama media (${resultado.gamaMediaCount} vs ${resultado.gamaBajaCount + resultado.gamaAltaCount})`
            }
          />

          {/* Principio 2: Amplitud */}
          <PrincipioCard
            num={2}
            titulo="Amplitud de gama"
            ok={resultado.amplitudOk}
            detalle={
              <>
                Plato más barato: <strong>{formatARS(resultado.precioMin)}</strong>
                <br />
                Plato más caro: <strong>{formatARS(resultado.precioMax)}</strong>
                <br />
                Coeficiente: <strong>{resultado.coeficiente.toFixed(2)}×</strong>
              </>
            }
            criterio={
              resultado.amplitudOk
                ? 'Coeficiente entre 2.5 y 3.5 ✓'
                : resultado.coeficiente > 3.5
                  ? 'Demasiada brecha: revisar caros o subir baratos'
                  : 'Brecha estrecha: menú monótono, falta escalonamiento'
            }
          />

          {/* Principio 3: RCP */}
          <PrincipioCard
            num={3}
            titulo="Relación calidad-precio"
            ok={resultado.rcpOk}
            detalle={
              <>
                Precio medio ofertado: <strong>{formatARS(resultado.precioMedioOfertado)}</strong>
                <br />
                Precio medio demandado: <strong>{formatARS(resultado.precioMedioDemandado)}</strong>
                <br />
                Ratio (ofertado/demandado):{' '}
                <strong>{resultado.ratioRcp.toFixed(2)}</strong>
              </>
            }
            criterio={
              resultado.rcpOk
                ? 'Ratio entre 0.95 y 1.05 ✓'
                : resultado.ratioRcp < 0.95
                  ? 'Clientes prefieren más barato de lo que ofrecés'
                  : 'Clientes prefieren más caro: oportunidad de subir baratos'
            }
          />
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-600">
        💡 Principio 4 (Promoción y presentación) es sobre diseño visual del menú: posición de
        platos estrella, tipografía, precios psicológicos (.5/.0, sin "$" ni ".99"). Eso no se
        calcula automáticamente — usá el contenido de Cortijo como guía para el menú impreso /
        digital.
      </div>
    </div>
  );
}

function PrincipioCard({
  num,
  titulo,
  ok,
  detalle,
  criterio,
}: {
  num: number;
  titulo: string;
  ok: boolean;
  detalle: React.ReactNode;
  criterio: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border-2 p-3',
        ok ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50',
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
          Principio {num}
        </span>
        <span className={cn('text-lg', ok ? 'text-green-700' : 'text-amber-700')}>
          {ok ? '✓' : '⚠'}
        </span>
      </div>
      <div className="mb-2 text-sm font-semibold text-gray-900">{titulo}</div>
      <div className="mb-2 text-xs leading-relaxed text-gray-700">{detalle}</div>
      <div className={cn('text-[11px] font-medium', ok ? 'text-green-800' : 'text-amber-800')}>
        {criterio}
      </div>
    </div>
  );
}
