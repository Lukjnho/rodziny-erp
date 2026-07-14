import { formatARS } from '@/lib/utils';
import type { GastoDuplicado, PagoDuplicado } from './useDuplicados';

// Aviso, no confirmación: informa y deja seguir. Ver useDuplicados.ts.

export function AvisoDuplicadosGasto({ duplicados }: { duplicados: GastoDuplicado[] }) {
  if (duplicados.length === 0) return null;

  const porComprobante = duplicados.filter((d) => d.motivo === 'comprobante');
  const grave = porComprobante.length > 0;

  return (
    <div
      className={
        grave
          ? 'rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900'
          : 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900'
      }
    >
      <p className="font-semibold">
        {grave
          ? '🔴 Este comprobante ya está cargado'
          : '🟡 Revisá: puede estar cargado dos veces'}
      </p>
      <ul className="mt-1 space-y-0.5">
        {duplicados.map((d) => (
          <li key={d.id} className="tabular-nums">
            {d.fecha} · {d.proveedor ?? 'sin proveedor'} · {formatARS(d.importe_total)}
            {d.nro_comprobante ? ` · ${d.nro_comprobante}` : ''}
            {d.local ? ` · ${d.local}` : ''}
            <span className="ml-1 opacity-70">
              {d.motivo === 'comprobante' ? '(mismo N° de comprobante)' : '(mismo monto)'}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 opacity-80">
        Si es otra factura distinta, seguí normalmente. Si es la misma, cancelá y editá la que ya
        existe.
      </p>
    </div>
  );
}

export function AvisoDuplicadosPago({ duplicados }: { duplicados: PagoDuplicado[] }) {
  if (duplicados.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="font-semibold">🟡 Este N° ya figura en otro pago</p>
      <ul className="mt-1 space-y-0.5">
        {duplicados.map((d) => (
          <li key={d.id} className="tabular-nums">
            {d.fecha_pago ?? 'sin fecha'} · {d.proveedor ?? 'sin proveedor'} ·{' '}
            {formatARS(d.monto)}
          </li>
        ))}
      </ul>
      <p className="mt-1 opacity-80">
        Es válido si una misma transferencia o echeq pagó varias facturas. Si no, estás cargando el
        pago dos veces.
      </p>
    </div>
  );
}
