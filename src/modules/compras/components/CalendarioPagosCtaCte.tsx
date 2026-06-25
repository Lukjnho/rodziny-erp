import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, cn } from '@/lib/utils';

// Vista consolidada (ambos locales + SAS) de la deuda de cuenta corriente con
// proveedores: cuánto hay que abonar atrasado y cuánto cae cada uno de los
// próximos 7 días. Es self-contained: hace su propia query de TODOS los locales,
// independiente del selector de la página, porque el objetivo es justamente el
// total "empresa" que antes había que sumar a mano.

interface GastoPend {
  id: string;
  local: string;
  proveedor: string | null;
  importe_total: number;
  fecha: string;
  fecha_vencimiento: string | null;
  comentario: string | null;
}

type LocalKey = 'vedia' | 'saavedra' | 'sas';

const LOCAL_LABEL: Record<LocalKey, string> = {
  vedia: 'Vedia',
  saavedra: 'Saavedra',
  sas: 'Empresa (SAS)',
};

const LOCAL_DOT: Record<LocalKey, string> = {
  vedia: 'bg-blue-500',
  saavedra: 'bg-emerald-500',
  sas: 'bg-gray-400',
};

// YYYY-MM-DD en hora local (no UTC) para que "hoy" coincida con el huso de AR.
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "Lunes 30/06" a partir de un YYYY-MM-DD
function etiquetaDia(fecha: string): { dia: string; fecha: string } {
  const d = new Date(fecha + 'T12:00:00');
  const dia = capitalizar(d.toLocaleDateString('es-AR', { weekday: 'long' }));
  const fechaCorta = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  return { dia, fecha: fechaCorta };
}

interface ProveedorDetalle {
  key: string;
  proveedor: string;
  local: LocalKey;
  total: number;
  cantidad: number;
  // Gastos individuales que componen el total — para el drill-down al clickear el proveedor.
  gastos: GastoPend[];
}

interface BucketDetalle {
  total: number;
  cantidad: number;
  porLocal: Record<LocalKey, number>;
  // Agrupado por proveedor para el panel de detalle (sumando importes)
  porProveedor: ProveedorDetalle[];
}

function bucketVacio(): { total: number; cantidad: number; porLocal: Record<LocalKey, number>; gastos: GastoPend[] } {
  return {
    total: 0,
    cantidad: 0,
    porLocal: { vedia: 0, saavedra: 0, sas: 0 },
    gastos: [],
  };
}

function resolverDetalle(g: { gastos: GastoPend[]; total: number; cantidad: number; porLocal: Record<LocalKey, number> }): BucketDetalle {
  const map = new Map<string, ProveedorDetalle>();
  for (const x of g.gastos) {
    const local = (x.local as LocalKey) ?? 'sas';
    const nombre = x.proveedor?.trim() || '(Sin proveedor)';
    const key = `${local}|${nombre.toLowerCase()}`;
    const prev = map.get(key);
    if (prev) {
      prev.total += Number(x.importe_total);
      prev.cantidad += 1;
      prev.gastos.push(x);
    } else {
      map.set(key, { key, proveedor: nombre, local, total: Number(x.importe_total), cantidad: 1, gastos: [x] });
    }
  }
  return {
    total: g.total,
    cantidad: g.cantidad,
    porLocal: g.porLocal,
    porProveedor: [...map.values()].sort((a, b) => b.total - a.total),
  };
}

export function CalendarioPagosCtaCte({
  onIrAProveedor,
}: {
  // Al clickear un proveedor del detalle, saltamos a su fila en el listado de
  // abajo (lo resuelve ComprasPage: cambia de local, filtra y hace scroll).
  onIrAProveedor?: (proveedor: string, local: LocalKey) => void;
}) {
  // Día seleccionado para mostrar el panel de detalle (clave de bucket: 'atrasado',
  // o un YYYY-MM-DD de los próximos 7). null = ninguno abierto.
  const [abierto, setAbierto] = useState<string | null>(null);

  function seleccionarBucket(key: string) {
    setAbierto((prev) => (prev === key ? null : key));
  }

  const { data: gastos, isLoading } = useQuery({
    queryKey: ['cta_cte_calendario_consolidado'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gastos')
        .select('id, local, proveedor, importe_total, fecha, fecha_vencimiento, comentario, estado_pago')
        .eq('cancelado', false)
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
        .limit(5000);
      if (error) throw error;
      // Solo deuda viva (no pagada) y, como en el resto del tab Pagos, excluimos
      // los "Pago fijo:" que tienen su propio flujo en Finanzas.
      return ((data ?? []) as (GastoPend & { estado_pago?: string })[])
        .filter((g) => (g.estado_pago ?? '').toLowerCase() !== 'pagado')
        .filter((g) => !(g.comentario ?? '').startsWith('Pago fijo:'));
    },
    staleTime: 60_000,
  });

  const hoy = useMemo(() => ymdLocal(new Date()), []);
  const dias7 = useMemo(() => {
    const out: string[] = [];
    const base = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      out.push(ymdLocal(d));
    }
    return out;
  }, []);

  const { atrasado, porDia, masAdelante, totalDeuda, deudaPorLocal } = useMemo(() => {
    const atrasado = bucketVacio();
    const masAdelante = bucketVacio();
    const porDia = new Map<string, ReturnType<typeof bucketVacio>>();
    for (const d of dias7) porDia.set(d, bucketVacio());
    const dias7Set = new Set(dias7);

    let totalDeuda = 0;
    const deudaPorLocal: Record<LocalKey, number> = { vedia: 0, saavedra: 0, sas: 0 };

    for (const g of gastos ?? []) {
      const local = (g.local as LocalKey) ?? 'sas';
      const monto = Number(g.importe_total);
      totalDeuda += monto;
      if (local in deudaPorLocal) deudaPorLocal[local] += monto;

      // Sin fecha de vencimiento: cuenta en el total de deuda pero no se imputa a
      // ningún día del calendario.
      if (!g.fecha_vencimiento) continue;

      let bucket: ReturnType<typeof bucketVacio>;
      if (g.fecha_vencimiento < hoy) bucket = atrasado;
      else if (dias7Set.has(g.fecha_vencimiento)) bucket = porDia.get(g.fecha_vencimiento)!;
      else bucket = masAdelante;

      bucket.total += monto;
      bucket.cantidad += 1;
      if (local in bucket.porLocal) bucket.porLocal[local] += monto;
      bucket.gastos.push(g);
    }

    return { atrasado, porDia, masAdelante, totalDeuda, deudaPorLocal };
  }, [gastos, dias7, hoy]);

  const totalProx7 = useMemo(
    () => dias7.reduce((s, d) => s + (porDia.get(d)?.total ?? 0), 0),
    [porDia, dias7],
  );

  const detalleAbierto = useMemo(() => {
    if (!abierto) return null;
    if (abierto === 'atrasado') return resolverDetalle(atrasado);
    const b = porDia.get(abierto);
    return b ? resolverDetalle(b) : null;
  }, [abierto, atrasado, porDia]);

  if (isLoading) {
    return (
      <div className="mb-4 rounded-lg border border-surface-border bg-white p-8 text-center text-sm text-gray-400">
        Cargando calendario de pagos...
      </div>
    );
  }

  const localesConDeuda = (['vedia', 'saavedra', 'sas'] as LocalKey[]).filter(
    (l) => deudaPorLocal[l] > 0,
  );

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-rodziny-200 bg-white">
      {/* Cabecera: total consolidado de cuenta corriente */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rodziny-100 bg-rodziny-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-rodziny-900">
            🗓 Calendario de pagos — Cuenta corriente (consolidado)
          </h3>
          <p className="mt-0.5 text-[11px] text-rodziny-600">
            Total empresa, sumando Vedia + Saavedra + SAS. Toda la deuda viva con proveedores.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-gray-500">Total a pagar (toda la deuda)</p>
          <p className="text-2xl font-bold text-rodziny-900">{formatARS(totalDeuda)}</p>
          {localesConDeuda.length > 0 && (
            <div className="mt-1 flex flex-wrap justify-end gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
              {localesConDeuda.map((l) => (
                <span key={l} className="inline-flex items-center gap-1">
                  <span className={cn('h-2 w-2 rounded-full', LOCAL_DOT[l])} />
                  {LOCAL_LABEL[l]}: <strong>{formatARS(deudaPorLocal[l])}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4">
        {/* Bucket de atrasados */}
        {atrasado.total > 0 && (
          <button
            onClick={() => seleccionarBucket('atrasado')}
            className={cn(
              'flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
              abierto === 'atrasado'
                ? 'border-red-400 bg-red-50 ring-1 ring-red-200'
                : 'border-red-200 bg-red-50/60 hover:bg-red-50',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg leading-none">🔴</span>
              <div>
                <p className="text-sm font-semibold text-red-900">
                  Atrasado ({atrasado.cantidad})
                </p>
                <p className="text-[11px] text-red-600">
                  Vencimiento pasado — pagar cuanto antes
                </p>
              </div>
            </div>
            <span className="text-lg font-bold text-red-700">{formatARS(atrasado.total)}</span>
          </button>
        )}

        {/* Calendario de 7 días */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {dias7.map((d, i) => {
            const b = porDia.get(d)!;
            const { dia, fecha } = etiquetaDia(d);
            const esHoy = d === hoy;
            const sel = abierto === d;
            const conMonto = b.total > 0;
            return (
              <button
                key={d}
                onClick={() => seleccionarBucket(d)}
                disabled={!conMonto}
                className={cn(
                  'flex flex-col rounded-lg border px-2.5 py-2 text-left transition-colors',
                  sel
                    ? 'border-rodziny-500 bg-rodziny-50 ring-1 ring-rodziny-200'
                    : conMonto
                      ? 'border-gray-200 bg-white hover:border-rodziny-300 hover:bg-rodziny-50/40'
                      : 'border-gray-100 bg-gray-50/60',
                  esHoy && !sel && 'border-rodziny-300',
                )}
              >
                <div className="flex items-baseline justify-between">
                  <span
                    className={cn(
                      'text-[11px] font-semibold',
                      esHoy ? 'text-rodziny-700' : 'text-gray-500',
                    )}
                  >
                    {i === 0 ? 'Hoy' : dia}
                  </span>
                  <span className="text-[10px] text-gray-400">{fecha}</span>
                </div>
                <span
                  className={cn(
                    'mt-1.5 text-sm font-bold tabular-nums',
                    conMonto ? 'text-gray-900' : 'text-gray-300',
                  )}
                >
                  {conMonto ? formatARS(b.total) : '—'}
                </span>
                <span className="mt-0.5 text-[10px] text-gray-400">
                  {conMonto ? `${b.cantidad} pago${b.cantidad !== 1 ? 's' : ''}` : 'sin pagos'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Resumen pie del calendario */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <span>
            Próximos 7 días: <strong className="text-gray-900">{formatARS(totalProx7)}</strong>
          </span>
          {masAdelante.total > 0 && (
            <span>
              Después de los 7 días:{' '}
              <strong className="text-gray-700">{formatARS(masAdelante.total)}</strong> (
              {masAdelante.cantidad})
            </span>
          )}
        </div>

        {/* Panel de detalle del día/bucket seleccionado */}
        {detalleAbierto && (
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
              <p className="text-xs font-semibold text-gray-700">
                {abierto === 'atrasado'
                  ? 'Detalle de atrasados'
                  : `Detalle — ${capitalizar(etiquetaDia(abierto!).dia)} ${etiquetaDia(abierto!).fecha}`}
              </p>
              <button
                onClick={() => setAbierto(null)}
                className="text-sm leading-none text-gray-400 hover:text-gray-600"
              >
                &times;
              </button>
            </div>

            {/* Split por local */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-gray-50 px-4 py-2 text-[11px]">
              {(['vedia', 'saavedra', 'sas'] as LocalKey[])
                .filter((l) => detalleAbierto.porLocal[l] > 0)
                .map((l) => (
                  <span key={l} className="inline-flex items-center gap-1 text-gray-600">
                    <span className={cn('h-2 w-2 rounded-full', LOCAL_DOT[l])} />
                    {LOCAL_LABEL[l]}:{' '}
                    <strong className="text-gray-800">{formatARS(detalleAbierto.porLocal[l])}</strong>
                  </span>
                ))}
            </div>

            {/* Lista por proveedor — clic lleva a su fila en el listado de abajo */}
            <div className="max-h-72 overflow-y-auto text-xs">
              {detalleAbierto.porProveedor.map((p) => (
                <button
                  key={p.key}
                  onClick={() => onIrAProveedor?.(p.proveedor, p.local)}
                  title={`Ver ${p.proveedor} en el listado`}
                  className="group flex w-full items-center justify-between gap-2 border-b border-gray-50 px-4 py-1.5 text-left last:border-0 hover:bg-rodziny-50/60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cn('h-2 w-2 rounded-full', LOCAL_DOT[p.local])}
                      title={LOCAL_LABEL[p.local]}
                    />
                    <span className="font-medium text-gray-800 group-hover:text-rodziny-700">
                      {p.proveedor}
                    </span>
                    {p.cantidad > 1 && (
                      <span className="text-[10px] text-gray-400">×{p.cantidad}</span>
                    )}
                    <span className="text-[10px] text-rodziny-500 opacity-0 transition-opacity group-hover:opacity-100">
                      ver en lista ↓
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums text-gray-900">
                    {formatARS(p.total)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
