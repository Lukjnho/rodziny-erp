import { useState, useMemo } from 'react';
import { formatARS, cn } from '@/lib/utils';

// Calendario de pagos genérico y presentacional. Recibe una lista ya armada de
// ítems con { local, fecha_vencimiento, monto, grupo } y se encarga de todo el
// layout: bloque de atrasados, grilla de próximos 7 días, pie con totales y el
// modal de "mes completo" navegable. La fuente de datos la resuelve cada módulo
// (Compras arma su cta cte; Finanzas arma los pagos fijos), así el mismo diseño
// se comparte sin acoplar el componente a una tabla concreta.

export type LocalKey = 'vedia' | 'saavedra' | 'sas';

export const LOCAL_LABEL: Record<LocalKey, string> = {
  vedia: 'Vedia',
  saavedra: 'Saavedra',
  sas: 'Empresa',
};

export const LOCAL_DOT: Record<LocalKey, string> = {
  vedia: 'bg-blue-500',
  saavedra: 'bg-emerald-500',
  sas: 'bg-gray-400',
};

// Un ítem del calendario: lo mínimo para ubicarlo en un día y agruparlo en el
// detalle. `grupoKey` agrupa (proveedor, concepto, …) y `grupoLabel` es el texto
// que se muestra. `payload` viaja intacto para que el caller lo use al navegar
// (ej. saltar al mes/fila correspondiente) sin que este componente lo entienda.
export interface ItemCalendario<T = unknown> {
  id: string;
  local: LocalKey;
  fecha_vencimiento: string | null;
  monto: number;
  grupoKey: string;
  grupoLabel: string;
  payload?: T;
}

export interface GrupoDetalle<T = unknown> {
  key: string;
  label: string;
  local: LocalKey;
  total: number;
  cantidad: number;
  items: ItemCalendario<T>[];
}

interface BucketDetalle<T = unknown> {
  total: number;
  cantidad: number;
  porLocal: Record<LocalKey, number>;
  grupos: GrupoDetalle<T>[];
}

interface Bucket<T = unknown> {
  total: number;
  cantidad: number;
  porLocal: Record<LocalKey, number>;
  items: ItemCalendario<T>[];
}

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

// "Junio 2026" a partir de un YYYY-MM
function nombreMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return capitalizar(d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }));
}

// Mueve un YYYY-MM `delta` meses (±1).
function mesShift(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function bucketVacio<T>(): Bucket<T> {
  return { total: 0, cantidad: 0, porLocal: { vedia: 0, saavedra: 0, sas: 0 }, items: [] };
}

function resolverDetalle<T>(b: Bucket<T>): BucketDetalle<T> {
  const map = new Map<string, GrupoDetalle<T>>();
  for (const x of b.items) {
    const key = `${x.local}|${x.grupoKey}`;
    const prev = map.get(key);
    if (prev) {
      prev.total += x.monto;
      prev.cantidad += 1;
      prev.items.push(x);
    } else {
      map.set(key, {
        key,
        label: x.grupoLabel,
        local: x.local,
        total: x.monto,
        cantidad: 1,
        items: [x],
      });
    }
  }
  return {
    total: b.total,
    cantidad: b.cantidad,
    porLocal: b.porLocal,
    grupos: [...map.values()].sort((a, b) => b.total - a.total),
  };
}

// Cuerpo del detalle (split por local + lista de grupos clickeable). Se usa tanto
// en el panel inline del calendario como en el modal de mes completo.
function DetalleGruposBody<T>({
  detalle,
  onSelectGrupo,
  ctaAyuda,
}: {
  detalle: BucketDetalle<T>;
  onSelectGrupo?: (grupo: GrupoDetalle<T>) => void;
  ctaAyuda?: string;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-gray-50 px-4 py-2 text-[11px]">
        {(['vedia', 'saavedra', 'sas'] as LocalKey[])
          .filter((l) => detalle.porLocal[l] > 0)
          .map((l) => (
            <span key={l} className="inline-flex items-center gap-1 text-gray-600">
              <span className={cn('h-2 w-2 rounded-full', LOCAL_DOT[l])} />
              {LOCAL_LABEL[l]}:{' '}
              <strong className="text-gray-800">{formatARS(detalle.porLocal[l])}</strong>
            </span>
          ))}
      </div>
      <div className="max-h-72 overflow-y-auto text-xs">
        {detalle.grupos.map((g) => {
          const clickeable = !!onSelectGrupo;
          return (
            <button
              key={g.key}
              onClick={() => onSelectGrupo?.(g)}
              disabled={!clickeable}
              title={clickeable ? `${g.label} — ${ctaAyuda ?? 'ver detalle'}` : g.label}
              className={cn(
                'group flex w-full items-center justify-between gap-2 border-b border-gray-50 px-4 py-1.5 text-left last:border-0',
                clickeable ? 'hover:bg-rodziny-50/60' : 'cursor-default',
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn('h-2 w-2 rounded-full', LOCAL_DOT[g.local])}
                  title={LOCAL_LABEL[g.local]}
                />
                <span
                  className={cn(
                    'font-medium text-gray-800',
                    clickeable && 'group-hover:text-rodziny-700',
                  )}
                >
                  {g.label}
                </span>
                {g.cantidad > 1 && <span className="text-[10px] text-gray-400">×{g.cantidad}</span>}
                {clickeable && ctaAyuda && (
                  <span className="text-[10px] text-rodziny-500 opacity-0 transition-opacity group-hover:opacity-100">
                    {ctaAyuda}
                  </span>
                )}
              </span>
              <span className="font-semibold tabular-nums text-gray-900">{formatARS(g.total)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function CalendarioPagos<T = unknown>({
  items,
  itemsMesCompleto,
  titulo,
  subtitulo,
  totalLabel = 'Total a pagar (toda la deuda)',
  isLoading = false,
  onSelectGrupo,
  ctaAyuda,
}: {
  // Ítems que alimentan el TOTAL, el bloque de atrasados y la grilla de 7 días.
  // Deben ser "lo que hay que pagar ahora" (para que el total sea fiable).
  items: ItemCalendario<T>[];
  // Ítems para el modal "Ver mes completo" — puede ser un universo más amplio que
  // `items` (ej. incluir meses futuros que NO cuentan al total pero sí se navegan
  // mes a mes). Si no se pasa, el modal usa `items`.
  itemsMesCompleto?: ItemCalendario<T>[];
  titulo: string;
  subtitulo: string;
  totalLabel?: string;
  isLoading?: boolean;
  // Al clickear un grupo del detalle. Si no se pasa, el detalle es solo lectura.
  onSelectGrupo?: (grupo: GrupoDetalle<T>) => void;
  // Texto del "call to action" que aparece al hover de cada grupo (ej. "ver en lista ↓").
  ctaAyuda?: string;
}) {
  // Bucket seleccionado para el panel de detalle: 'atrasado', 'sinvenc', o un
  // YYYY-MM-DD de los próximos 7. null = ninguno abierto.
  const [abierto, setAbierto] = useState<string | null>(null);

  // Modal de mes completo: ver más allá de los 7 días, mes a mes.
  const [mesModalAbierto, setMesModalAbierto] = useState(false);
  const [mesVista, setMesVista] = useState(() => ymdLocal(new Date()).slice(0, 7));
  const [diaModalSel, setDiaModalSel] = useState<string | null>(null);

  function seleccionarBucket(key: string) {
    setAbierto((prev) => (prev === key ? null : key));
  }

  function abrirModalMes() {
    setMesVista(ymdLocal(new Date()).slice(0, 7));
    setDiaModalSel(null);
    setMesModalAbierto(true);
  }

  function navegarMes(delta: number) {
    setMesVista((prev) => mesShift(prev, delta));
    setDiaModalSel(null);
  }

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

  const { atrasado, porDia, masAdelante, sinVenc, totalDeuda, deudaPorLocal } = useMemo(() => {
    const atrasado = bucketVacio<T>();
    const masAdelante = bucketVacio<T>();
    const sinVenc = bucketVacio<T>();
    const porDia = new Map<string, Bucket<T>>();
    for (const d of dias7) porDia.set(d, bucketVacio<T>());
    const dias7Set = new Set(dias7);

    let totalDeuda = 0;
    const deudaPorLocal: Record<LocalKey, number> = { vedia: 0, saavedra: 0, sas: 0 };

    for (const g of items) {
      const local = g.local ?? 'sas';
      const monto = Number(g.monto);
      totalDeuda += monto;
      if (local in deudaPorLocal) deudaPorLocal[local] += monto;

      // Sin fecha de vencimiento: suma al total pero no cae en ningún día. Va a su
      // propio bucket para que el total cierre contra atrasado + días + más adelante.
      let bucket: Bucket<T>;
      if (!g.fecha_vencimiento) bucket = sinVenc;
      else if (g.fecha_vencimiento < hoy) bucket = atrasado;
      else if (dias7Set.has(g.fecha_vencimiento)) bucket = porDia.get(g.fecha_vencimiento)!;
      else bucket = masAdelante;

      bucket.total += monto;
      bucket.cantidad += 1;
      if (local in bucket.porLocal) bucket.porLocal[local] += monto;
      bucket.items.push(g);
    }

    return { atrasado, porDia, masAdelante, sinVenc, totalDeuda, deudaPorLocal };
  }, [items, dias7, hoy]);

  const totalProx7 = useMemo(
    () => dias7.reduce((s, d) => s + (porDia.get(d)?.total ?? 0), 0),
    [porDia, dias7],
  );

  const detalleAbierto = useMemo(() => {
    if (!abierto) return null;
    if (abierto === 'atrasado') return resolverDetalle(atrasado);
    if (abierto === 'sinvenc') return resolverDetalle(sinVenc);
    const b = porDia.get(abierto);
    return b ? resolverDetalle(b) : null;
  }, [abierto, atrasado, sinVenc, porDia]);

  // Todos los vencimientos agrupados por fecha exacta — alimenta el modal de mes
  // completo. Usa `itemsMesCompleto` (universo ampliado, ej. meses futuros) si se
  // pasó; si no, los mismos `items` del total.
  const itemsModal = itemsMesCompleto ?? items;
  const porFecha = useMemo(() => {
    const map = new Map<string, Bucket<T>>();
    for (const g of itemsModal) {
      if (!g.fecha_vencimiento) continue;
      let b = map.get(g.fecha_vencimiento);
      if (!b) {
        b = bucketVacio<T>();
        map.set(g.fecha_vencimiento, b);
      }
      const local = g.local ?? 'sas';
      const monto = Number(g.monto);
      b.total += monto;
      b.cantidad += 1;
      if (local in b.porLocal) b.porLocal[local] += monto;
      b.items.push(g);
    }
    return map;
  }, [itemsModal]);

  // Grilla del mes en vista (semana arranca lunes) + total del mes.
  const mesGrid = useMemo(() => {
    const [yy, mm] = mesVista.split('-').map(Number);
    const primero = new Date(yy, mm - 1, 1);
    const diasEnMes = new Date(yy, mm, 0).getDate();
    const offset = (primero.getDay() + 6) % 7; // lunes = 0
    const celdas: (string | null)[] = [];
    for (let i = 0; i < offset; i++) celdas.push(null);
    let totalMes = 0;
    let cantMes = 0;
    for (let d = 1; d <= diasEnMes; d++) {
      const fecha = `${mesVista}-${String(d).padStart(2, '0')}`;
      celdas.push(fecha);
      const b = porFecha.get(fecha);
      if (b) {
        totalMes += b.total;
        cantMes += b.cantidad;
      }
    }
    return { celdas, totalMes, cantMes };
  }, [mesVista, porFecha]);

  const detalleMesSel = useMemo(() => {
    if (!diaModalSel) return null;
    const b = porFecha.get(diaModalSel);
    return b ? resolverDetalle(b) : null;
  }, [diaModalSel, porFecha]);

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
      {/* Cabecera: total consolidado */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rodziny-100 bg-rodziny-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-rodziny-900">{titulo}</h3>
          <p className="mt-0.5 text-[11px] text-rodziny-600">{subtitulo}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-gray-500">{totalLabel}</p>
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
                <p className="text-[11px] text-red-600">Vencimiento pasado — pagar cuanto antes</p>
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
            {sinVenc.total > 0 && (
              <button
                onClick={() => seleccionarBucket('sinvenc')}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
                  abierto === 'sinvenc'
                    ? 'bg-amber-100 text-amber-800'
                    : 'text-amber-700 hover:bg-amber-50',
                )}
                title="Deuda cargada sin fecha de vencimiento — no cae en ningún día del calendario"
              >
                ⚠ Sin fecha de vto: <strong>{formatARS(sinVenc.total)}</strong> ({sinVenc.cantidad})
              </button>
            )}
          </div>
          <button
            onClick={abrirModalMes}
            className="whitespace-nowrap rounded-md border border-rodziny-300 bg-white px-2.5 py-1 text-xs font-medium text-rodziny-700 transition-colors hover:bg-rodziny-50"
          >
            🗓 Ver mes completo
          </button>
        </div>

        {/* Panel de detalle del día/bucket seleccionado */}
        {detalleAbierto && (
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
              <p className="text-xs font-semibold text-gray-700">
                {abierto === 'atrasado'
                  ? 'Detalle de atrasados'
                  : abierto === 'sinvenc'
                    ? 'Detalle — sin fecha de vencimiento'
                    : `Detalle — ${capitalizar(etiquetaDia(abierto!).dia)} ${etiquetaDia(abierto!).fecha}`}
              </p>
              <button
                onClick={() => setAbierto(null)}
                className="text-sm leading-none text-gray-400 hover:text-gray-600"
              >
                &times;
              </button>
            </div>

            <DetalleGruposBody
              detalle={detalleAbierto}
              onSelectGrupo={onSelectGrupo}
              ctaAyuda={ctaAyuda}
            />
          </div>
        )}
      </div>

      {/* Modal de mes completo */}
      {mesModalAbierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setMesModalAbierto(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: navegación de mes + total */}
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => navegarMes(-1)}
                  className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
                >
                  ←
                </button>
                <h3 className="min-w-[150px] text-center text-sm font-semibold text-gray-800">
                  {nombreMes(mesVista)}
                </h3>
                <button
                  onClick={() => navegarMes(1)}
                  className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
                >
                  →
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  A pagar en el mes:{' '}
                  <strong className="text-gray-900">{formatARS(mesGrid.totalMes)}</strong>{' '}
                  <span className="text-gray-400">({mesGrid.cantMes})</span>
                </span>
                <button
                  onClick={() => setMesModalAbierto(false)}
                  className="text-lg leading-none text-gray-400 hover:text-gray-600"
                >
                  &times;
                </button>
              </div>
            </div>

            {/* Cuerpo scrolleable: grilla + detalle del día */}
            <div className="overflow-y-auto p-4">
              {/* Encabezado de días de la semana */}
              <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-gray-400">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>

              {/* Grilla del mes */}
              <div className="grid grid-cols-7 gap-1">
                {mesGrid.celdas.map((fecha, idx) => {
                  if (!fecha) return <div key={`v${idx}`} />;
                  const b = porFecha.get(fecha);
                  const conMonto = !!b && b.total > 0;
                  const dia = Number(fecha.slice(8, 10));
                  const esHoy = fecha === hoy;
                  const pasado = fecha < hoy;
                  const sel = diaModalSel === fecha;
                  return (
                    <button
                      key={fecha}
                      onClick={() => conMonto && setDiaModalSel(sel ? null : fecha)}
                      disabled={!conMonto}
                      className={cn(
                        'flex min-h-[58px] flex-col rounded-md border p-1.5 text-left transition-colors',
                        sel
                          ? 'border-rodziny-500 bg-rodziny-50 ring-1 ring-rodziny-200'
                          : conMonto
                            ? pasado
                              ? 'border-red-200 bg-red-50/60 hover:bg-red-50'
                              : 'border-gray-200 bg-white hover:border-rodziny-300 hover:bg-rodziny-50/40'
                            : 'border-gray-100 bg-gray-50/40',
                        esHoy && !sel && 'border-rodziny-400',
                      )}
                    >
                      <span
                        className={cn(
                          'text-[11px] font-semibold',
                          esHoy ? 'text-rodziny-700' : 'text-gray-500',
                        )}
                      >
                        {dia}
                      </span>
                      {conMonto && (
                        <>
                          <span
                            className={cn(
                              'mt-auto text-[11px] font-bold tabular-nums',
                              pasado ? 'text-red-700' : 'text-gray-900',
                            )}
                          >
                            {formatARS(b!.total, 0)}
                          </span>
                          <span className="text-[9px] text-gray-400">
                            {b!.cantidad} pago{b!.cantidad !== 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Detalle del día seleccionado dentro del modal */}
              {detalleMesSel && diaModalSel && (
                <div className="mt-3 rounded-lg border border-gray-200">
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
                    <p className="text-xs font-semibold text-gray-700">
                      Detalle — {capitalizar(etiquetaDia(diaModalSel).dia)}{' '}
                      {etiquetaDia(diaModalSel).fecha}
                    </p>
                    <button
                      onClick={() => setDiaModalSel(null)}
                      className="text-sm leading-none text-gray-400 hover:text-gray-600"
                    >
                      &times;
                    </button>
                  </div>
                  <DetalleGruposBody
                    detalle={detalleMesSel}
                    ctaAyuda={ctaAyuda}
                    onSelectGrupo={
                      onSelectGrupo
                        ? (g) => {
                            setMesModalAbierto(false);
                            onSelectGrupo(g);
                          }
                        : undefined
                    }
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
