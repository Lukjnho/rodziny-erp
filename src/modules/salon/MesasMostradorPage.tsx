import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { cn, formatARS } from '@/lib/utils';
import { useMediosPagoCaja, useTurnosAbiertos, type LocalCaja } from '@/modules/caja/useCaja';
import type { LocalSalon } from './useSalon';
import {
  usePlano,
  useSesionesAbiertas,
  useCobrarMesa,
  importeDeLinea,
  type LineaMesa,
} from './useMesas';

/**
 * Las mesas, vistas desde el MOSTRADOR: acá se cobran.
 *
 * Vive aparte del punto de venta y no adentro, a propósito: `CajaPage` son ~1200
 * líneas y es lo único del POS que hoy anda con plata de verdad. Meterle el
 * salón adentro es el cambio con más chances de romperlo.
 *
 * 💣 La fecha y la hora se calculan con UTC−3 pelado, **no** con `hoyAR()`.
 * `hoyAR()` corta la jornada a las 5 de la mañana (la madrugada cuenta como el
 * día anterior), que es la convención de Cocina. Un ticket tiene que llevar la
 * MISMA fecha que le pondría Fudo, porque los dos se comparan mientras corran en
 * paralelo. Es la misma cuenta que hace `ahoraAR()` adentro de CajaPage.
 */
function ahoraAR(): { fecha: string; hora: string } {
  const arg = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return { fecha: arg.toISOString().slice(0, 10), hora: arg.toISOString().slice(11, 16) };
}

interface Cobro {
  medioId: string;
  monto: string;
}

export function MesasMostradorPage() {
  const { perfil } = useAuth();
  const local = ((perfil?.local_restringido as LocalSalon | null) ?? 'saavedra') as LocalSalon;

  const [sesionSel, setSesionSel] = useState<string | null>(null);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // ⚠️ La llave del intento NO se regenera si el cobro falla: es lo único que
  // impide que un reintento tras un corte de red cobre la mesa dos veces.
  const [intento, setIntento] = useState<string>(() => crypto.randomUUID());

  const planoQ = usePlano(local);
  const mesasQ = useSesionesAbiertas(local);
  const mediosQ = useMediosPagoCaja();
  const turnosQ = useTurnosAbiertos(local as LocalCaja);
  const cobrar = useCobrarMesa(local);

  const turno = (turnosQ.data ?? [])[0] ?? null;
  const sesiones = useMemo(() => mesasQ.data?.sesiones ?? [], [mesasQ.data]);
  const lineas = mesasQ.data?.lineas ?? [];
  const mesas = planoQ.data?.mesas ?? [];

  const numeroDe = (mesaId: string) => mesas.find((m) => m.id === mesaId)?.numero ?? '?';

  // Las que piden la cuenta van primero: es lo que el cajero tiene que atender.
  const ordenadas = useMemo(
    () =>
      [...sesiones].sort((a, b) => {
        if (a.estado !== b.estado) return a.estado === 'cuenta_pedida' ? -1 : 1;
        return a.abierta_en.localeCompare(b.abierta_en);
      }),
    [sesiones],
  );

  const sesion = sesiones.find((s) => s.id === sesionSel) ?? null;
  const suyas: LineaMesa[] = sesion
    ? lineas.filter((l) => l.sesion_id === sesion.id && l.estado === 'activa' && !l.ticket_id)
    : [];
  const total = suyas.reduce((a, l) => a + importeDeLinea(l), 0);
  const cobrado = cobros.reduce((a, c) => a + (Number(c.monto) || 0), 0);
  const falta = Math.round((total - cobrado) * 100) / 100;

  function elegirMesa(id: string) {
    setSesionSel(id);
    setError(null);
    setAviso(null);
    setIntento(crypto.randomUUID());
    const efectivo = (mediosQ.data ?? []).find((m) => m.es_efectivo);
    setCobros(efectivo ? [{ medioId: efectivo.id, monto: '' }] : []);
  }

  async function cobrarLaMesa() {
    if (!sesion || !turno) return;
    setError(null);
    const { fecha, hora } = ahoraAR();
    try {
      const r = await cobrar.mutateAsync({
        idempotencia: intento,
        sesionId: sesion.id,
        turnoId: turno.id,
        caja: turno.caja,
        fecha,
        hora,
        pagos: cobros
          .filter((c) => Number(c.monto) > 0)
          .map((c) => ({ medio_pago_id: c.medioId, monto: Number(c.monto) })),
      });
      setAviso(
        `Mesa ${numeroDe(sesion.mesa_id)} cobrada: ${formatARS(r.total)} · venta ${r.numero}` +
          (r.ya_estaba ? ' (ya estaba cobrada, no se cobró de nuevo)' : ''),
      );
      setSesionSel(null);
      setCobros([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cobrar la mesa');
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-bg">
      <header className="flex items-center justify-between gap-4 border-b border-surface-border bg-white px-5 py-3">
        <div>
          <span className="text-lg font-semibold text-gray-900">Mesas del salón</span>
          <p className="text-xs text-gray-500">
            {local === 'saavedra' ? 'Rodziny Saavedra' : 'Rodziny Vedia'}
            {turno ? ` · turno ${turno.turno} en ${turno.caja}` : ''}
          </p>
        </div>
        <Link
          to="/caja/pos"
          className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          ← Volver a la caja
        </Link>
      </header>

      <main className="flex-1 p-4">
        {!turno && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>No hay ningún turno abierto en esta casa.</strong> Abrí el turno en la caja
            antes de cobrar una mesa: la venta tiene que caer adentro de un arqueo.
          </div>
        )}

        {aviso && (
          <div className="mb-4 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
            {aviso}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">
              Mesas ocupadas ({ordenadas.length})
            </h2>
            {mesasQ.isLoading && <p className="text-sm text-gray-400">Cargando…</p>}
            {!mesasQ.isLoading && ordenadas.length === 0 && (
              <p className="text-sm text-gray-500">No hay ninguna mesa ocupada ahora mismo.</p>
            )}
            {ordenadas.map((s) => {
              const suTotal = lineas
                .filter((l) => l.sesion_id === s.id && l.estado === 'activa' && !l.ticket_id)
                .reduce((a, l) => a + importeDeLinea(l), 0);
              return (
                <button
                  key={s.id}
                  onClick={() => elegirMesa(s.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg border p-3 text-left',
                    sesionSel === s.id
                      ? 'border-rodziny-700 bg-rodziny-50'
                      : s.estado === 'cuenta_pedida'
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-gray-200 bg-white',
                  )}
                >
                  <div>
                    <p className="font-semibold text-gray-900">Mesa {numeroDe(s.mesa_id)}</p>
                    <p className="text-xs text-gray-500">
                      {s.comensales} {s.comensales === 1 ? 'persona' : 'personas'}
                      {s.estado === 'cuenta_pedida' && ' · piden la cuenta'}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{formatARS(suTotal)}</span>
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            {!sesion && (
              <p className="text-sm text-gray-500">
                Elegí una mesa de la izquierda para ver lo que consumió y cobrarla.
              </p>
            )}

            {sesion && (
              <>
                <h2 className="mb-3 text-lg font-semibold text-gray-900">
                  Mesa {numeroDe(sesion.mesa_id)}
                </h2>

                <div className="mb-4 space-y-1">
                  {suyas.map((l) => (
                    <div
                      key={l.id}
                      className={cn('flex items-center justify-between text-sm', l.padre_id && 'pl-5')}
                    >
                      <span className="text-gray-700">
                        {l.padre_id && <span className="text-gray-400">› </span>}
                        {Number(l.cantidad)}× {l.nombre}
                      </span>
                      <span className="tabular-nums text-gray-900">{formatARS(importeDeLinea(l))}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-base font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatARS(total)}</span>
                  </div>
                </div>

                <h3 className="mb-2 text-sm font-semibold text-gray-700">Con qué paga</h3>
                <div className="space-y-2">
                  {cobros.map((c, i) => (
                    <div key={i} className="flex gap-2">
                      <select
                        value={c.medioId}
                        onChange={(e) =>
                          setCobros((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, medioId: e.target.value } : x)),
                          )
                        }
                        className="flex-1 rounded border border-gray-300 px-2 py-2 text-sm"
                      >
                        {(mediosQ.data ?? []).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nombre}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        value={c.monto}
                        placeholder={i === 0 ? String(total) : ''}
                        onChange={(e) =>
                          setCobros((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)),
                          )
                        }
                        className="w-32 rounded border border-gray-300 px-2 py-2 text-right text-sm tabular-nums"
                      />
                      {cobros.length > 1 && (
                        <button
                          onClick={() => setCobros((prev) => prev.filter((_, j) => j !== i))}
                          className="px-2 text-gray-400 hover:text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setCobros((prev) => [
                        ...prev,
                        { medioId: (mediosQ.data ?? [])[0]?.id ?? '', monto: '' },
                      ])
                    }
                    className="text-sm text-rodziny-700"
                  >
                    + Otro medio de pago
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-gray-500">
                    {falta > 0 ? 'Falta' : falta < 0 ? 'Se pasó' : 'Cierra justo'}
                  </span>
                  <span
                    className={cn(
                      'tabular-nums font-semibold',
                      falta === 0 ? 'text-green-700' : 'text-amber-700',
                    )}
                  >
                    {formatARS(Math.abs(falta))}
                  </span>
                </div>

                <button
                  onClick={() => void cobrarLaMesa()}
                  disabled={!turno || falta !== 0 || total <= 0 || cobrar.isPending}
                  className={cn(
                    'mt-3 w-full rounded-lg py-3 text-sm font-semibold text-white',
                    !turno || falta !== 0 || total <= 0 || cobrar.isPending
                      ? 'bg-gray-300'
                      : 'bg-rodziny-700 hover:bg-rodziny-800',
                  )}
                >
                  {cobrar.isPending ? 'Cobrando…' : `Cobrar ${formatARS(total)}`}
                </button>
                <p className="mt-2 text-xs text-gray-400">
                  Los cobros tienen que cerrar exacto con la mesa: la base no guarda una venta a la
                  que le falte o le sobre un peso.
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
