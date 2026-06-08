import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useConvenios, useMedicionConvenios } from './useConvenios';
import { LOCAL_LABEL, type LocalConv, type MedicionConvenio } from './types';

const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const fmt = (n: number) => ARS.format(n);

function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 'YYYY-MM' -> { desde: 'YYYY-MM-01', hasta: 'YYYY-MM-<último>' }
function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number);
  const ultimoDia = new Date(y, m, 0).getDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimoDia).padStart(2, '0')}` };
}

interface Fila {
  nombre: string;
  descuentoPct: number | null;
  consumos: number;
  facturacion: number;
  descuento: number;
  ultimaFecha: string | null;
  registrado: boolean;
}

export function MedicionTab() {
  const [local, setLocal] = useState<LocalConv>('vedia');
  const [mes, setMes] = useState<string>(mesActual());
  const { desde, hasta } = useMemo(() => rangoDelMes(mes), [mes]);

  const { data: convenios } = useConvenios();
  const { data: medicion, isLoading, error, isFetching } = useMedicionConvenios(local, desde, hasta);

  const { registrados, otros } = useMemo(() => {
    const delLocal = (convenios ?? []).filter((c) => c.local === local && c.activo);
    const medidos = new Map<string, MedicionConvenio>();
    for (const m of medicion?.convenios ?? []) medidos.set(m.customerId, m);

    const idsRegistrados = new Set(
      delLocal.map((c) => c.fudo_customer_id).filter((x): x is string => !!x),
    );

    const registrados: Fila[] = delLocal.map((c) => {
      const m = c.fudo_customer_id ? medidos.get(c.fudo_customer_id) : undefined;
      return {
        nombre: c.nombre,
        descuentoPct: c.descuento_pct,
        consumos: m?.consumos ?? 0,
        facturacion: m?.facturacion ?? 0,
        descuento: m?.descuento ?? 0,
        ultimaFecha: m?.ultimaFecha ?? null,
        registrado: true,
      };
    });

    const otros: Fila[] = (medicion?.convenios ?? [])
      .filter((m) => !idsRegistrados.has(m.customerId))
      .map((m) => ({
        nombre: m.nombre,
        descuentoPct: null,
        consumos: m.consumos,
        facturacion: m.facturacion,
        descuento: m.descuento,
        ultimaFecha: m.ultimaFecha,
        registrado: false,
      }));

    registrados.sort((a, b) => b.facturacion - a.facturacion);
    return { registrados, otros };
  }, [convenios, medicion, local]);

  const totalFact = registrados.reduce((s, f) => s + f.facturacion, 0);
  const totalDesc = registrados.reduce((s, f) => s + f.descuento, 0);
  const totalConsumos = registrados.reduce((s, f) => s + f.consumos, 0);

  return (
    <div>
      {/* Controles */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {(['vedia', 'saavedra'] as LocalConv[]).map((l) => (
            <button
              key={l}
              onClick={() => setLocal(l)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                local === l ? 'bg-white text-rodziny-700 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {LOCAL_LABEL[l]}
            </button>
          ))}
        </div>
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500"
        />
        {isFetching && <span className="text-xs text-gray-400">Consultando Fudo…</span>}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Consultando ventas en Fudo… (puede tardar unos segundos)
        </div>
      ) : (
        <>
          {/* KPIs del período */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label="Facturación convenios" valor={fmt(totalFact)} />
            <Kpi label="Descuento otorgado" valor={fmt(totalDesc)} acento="amber" />
            <Kpi label="Consumos" valor={String(totalConsumos)} />
          </div>

          {/* Tabla de convenios registrados */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <th className="px-4 py-2.5 font-medium">Convenio</th>
                  <th className="px-4 py-2.5 text-center font-medium">Desc.</th>
                  <th className="px-4 py-2.5 text-right font-medium">Consumos</th>
                  <th className="px-4 py-2.5 text-right font-medium">Facturación</th>
                  <th className="px-4 py-2.5 text-right font-medium">Descuento otorgado</th>
                  <th className="px-4 py-2.5 text-right font-medium">Último</th>
                  <th className="px-4 py-2.5 text-center font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {registrados.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                      No hay convenios cargados para {LOCAL_LABEL[local]}. Cargalos en el tab Convenios.
                    </td>
                  </tr>
                )}
                {registrados.map((f) => (
                  <FilaConvenio key={f.nombre} f={f} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Otros clientes con consumo (no registrados como convenio) */}
          {otros.length > 0 && (
            <details className="mt-4 rounded-lg border border-gray-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-600">
                Otros clientes con consumo en el período ({otros.length}) — no registrados como
                convenio
              </summary>
              <div className="border-t border-gray-100 px-4 py-2">
                <p className="mb-2 text-xs text-gray-400">
                  Incluye cuentas de personal (CP), vianda y consumos sueltos. Si alguno es un
                  convenio real, cargalo en el tab Convenios.
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {otros.map((f) => (
                      <tr key={f.nombre} className="border-b border-gray-50 last:border-0">
                        <td className="py-1.5 text-gray-600">{f.nombre}</td>
                        <td className="py-1.5 text-right text-gray-500">{f.consumos} cons.</td>
                        <td className="py-1.5 text-right text-gray-700">{fmt(f.facturacion)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* Nota de calidad de dato */}
          {medicion && (
            <p className="mt-4 text-xs text-gray-400">
              {medicion.conCliente} de {medicion.ventasEscaneadas} ventas del período tienen un
              cliente asignado en Fudo. Si un convenio aparece con 0 consumos pero sabés que
              consumió, es que en caja no se eligió el cliente al cobrar.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function FilaConvenio({ f }: { f: Fila }) {
  const sinConsumo = f.consumos === 0;
  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
      <td className="px-4 py-2.5 font-medium text-gray-800">{f.nombre}</td>
      <td className="px-4 py-2.5 text-center text-gray-500">
        {f.descuentoPct != null ? `${f.descuentoPct}%` : '—'}
      </td>
      <td className="px-4 py-2.5 text-right text-gray-700">{f.consumos}</td>
      <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmt(f.facturacion)}</td>
      <td className="px-4 py-2.5 text-right text-amber-600">{fmt(f.descuento)}</td>
      <td className="px-4 py-2.5 text-right text-xs text-gray-400">
        {f.ultimaFecha ? f.ultimaFecha.substring(0, 10) : '—'}
      </td>
      <td className="px-4 py-2.5 text-center">
        {sinConsumo ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            Sin consumo
          </span>
        ) : (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Activo</span>
        )}
      </td>
    </tr>
  );
}

function Kpi({
  label,
  valor,
  acento,
}: {
  label: string;
  valor: string;
  acento?: 'amber';
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={cn(
          'mt-1 text-lg font-bold',
          acento === 'amber' ? 'text-amber-600' : 'text-gray-800',
        )}
      >
        {valor}
      </div>
    </div>
  );
}
