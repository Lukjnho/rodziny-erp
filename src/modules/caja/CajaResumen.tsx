import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { abrirVentanaCaja, RUTA_POS } from '@/lib/ventanaCaja';
import { TURNOS } from '@/lib/turnosCaja';
import {
  efectivoEsperadoEnCaja,
  useTurnosAbiertos,
  useVentasDelTurno,
  type LocalCaja,
  type TurnoAbiertoResumen,
  type VentaTurno,
} from './useCaja';

const pesos = (n: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);

const NOMBRE_LOCAL: Record<string, string> = { vedia: 'Vedia', saavedra: 'Saavedra' };

/** "manana" → "Mañana", tal como está escrito en la lista de turnos del local. */
function etiquetaTurno(local: string, clave: string): string {
  const lista = TURNOS[local as LocalCaja] ?? [];
  return lista.find((t) => t.key === clave)?.label ?? clave;
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

/**
 * Lo que se ve en el ERP cuando entrás a Caja: el **arqueo en curso**.
 *
 * El punto de venta en sí vive en su propia ventana (RUTA_POS, a pantalla
 * completa). Acá queda el tablero: quién tiene la caja abierta, desde qué hora,
 * cuánto lleva cobrado. Administración lo mira sin entrar al POS.
 */
export function CajaResumen() {
  const { perfil, tienePermiso } = useAuth();
  const navigate = useNavigate();
  const localForzado = (perfil?.local_restringido as LocalCaja | null) ?? null;
  const turnosQ = useTurnosAbiertos(localForzado);
  const [bloqueada, setBloqueada] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  // Mismo criterio que el POS: el cajero no ve lo que debería haber en la caja
  // (arqueo a ciegas). Administración sí.
  const veEsperado = tienePermiso('finanzas') || tienePermiso('gastos');

  const turnos = turnosQ.data ?? [];

  function abrir() {
    if (abrirVentanaCaja()) {
      setBloqueada(false);
      return;
    }
    // El navegador bloqueó la ventana: se entra al POS en esta misma pestaña.
    setBloqueada(true);
    navigate(RUTA_POS);
  }

  return (
    <PageContainer
      title="Caja"
      subtitle="El punto de venta se abre en su propia ventana"
      actions={
        <button
          onClick={abrir}
          className="rounded bg-rodziny-700 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-800"
        >
          Abrir la caja ⧉
        </button>
      }
    >
      {bloqueada && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          El navegador bloqueó la ventana aparte. Habilitá las ventanas emergentes para este sitio
          si la querés separada; mientras tanto la caja se abre en esta misma pestaña.
        </div>
      )}

      <section className="rounded-lg border border-surface-border bg-white">
        <header className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Arqueo en curso</h2>
          <span className="text-xs text-gray-400">
            {turnosQ.isLoading
              ? 'Buscando…'
              : turnos.length === 0
                ? 'Ninguna caja abierta'
                : `${turnos.length} caja${turnos.length === 1 ? '' : 's'} abierta${turnos.length === 1 ? '' : 's'}`}
          </span>
        </header>

        {turnosQ.isLoading ? (
          <p className="px-4 py-6 text-sm text-gray-500">Buscando turnos abiertos…</p>
        ) : turnos.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="mb-2 text-3xl">🧮</div>
            <p className="mb-1 text-sm font-medium text-gray-700">
              No hay ningún turno abierto ahora mismo
            </p>
            <p className="text-sm text-gray-500">
              Tocá <strong>Abrir la caja</strong> para arrancar un turno y empezar a cobrar.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {turnos.map((t) => (
              <FilaTurno
                key={t.id}
                turno={t}
                abierto={abierto === t.id}
                onAlternar={() => setAbierto((p) => (p === t.id ? null : t.id))}
                veEsperado={veEsperado}
                onAbrir={abrir}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="mt-3 text-xs text-gray-400">
        Acá se ven <strong>solo los turnos abiertos</strong>, en vivo. Cuando el cajero cierra el
        arqueo, el turno pasa a Finanzas → Cierre de Caja para que administración lo controle. Las
        ventas cobradas por este punto de venta todavía <strong>no</strong> entran en Ventas, EdR ni
        Flujo: se están corriendo en paralelo con Fudo para poder compararlas.
      </p>
    </PageContainer>
  );
}

function FilaTurno({
  turno,
  abierto,
  onAlternar,
  veEsperado,
  onAbrir,
}: {
  turno: TurnoAbiertoResumen;
  abierto: boolean;
  onAlternar: () => void;
  veEsperado: boolean;
  onAbrir: () => void;
}) {
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        {/* Todo el renglón es el botón que despliega el detalle en vivo. */}
        <button
          onClick={onAlternar}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-1 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="w-3 text-xs text-gray-400">{abierto ? '▾' : '▸'}</span>
            {/* punto verde titilando: se ve de reojo que hay una caja trabajando */}
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            <span className="text-sm font-medium text-gray-900">
              {NOMBRE_LOCAL[turno.local] ?? turno.local} · {turno.caja}
            </span>
          </span>

          <span className="text-sm text-gray-600">
            Turno {etiquetaTurno(turno.local, turno.turno).toLowerCase()} · {fechaCorta(turno.fecha)}
          </span>

          <span className="text-sm text-gray-600">
            {turno.cajeroNombre ? (
              <span className="capitalize">{turno.cajeroNombre}</span>
            ) : (
              'Sin cajero'
            )}
            {turno.horaInicio ? ` desde las ${turno.horaInicio.slice(0, 5)}` : ''}
          </span>
        </button>

        <span className="flex items-center gap-5">
          {/* ⚠️ ARQUEO A CIEGAS: fondo + efectivo cobrado ES el esperado. Si el
              cajero los ve acá, cuenta hasta llegar y el arqueo no prueba nada.
              Solo se le muestra cuántas ventas lleva, que no le sirve para eso. */}
          {veEsperado && (
            <>
              <span className="text-right leading-tight">
                <span className="block text-xs text-gray-400">Fondo</span>
                <span className="block text-sm text-gray-700">{pesos(turno.fondoApertura)}</span>
              </span>
              <span className="text-right leading-tight">
                <span className="block text-xs text-gray-400">
                  {turno.tickets} venta{turno.tickets === 1 ? '' : 's'}
                </span>
                <span className="block text-sm font-semibold text-gray-900">
                  {pesos(turno.cobrado)}
                </span>
              </span>
            </>
          )}
          {!veEsperado && (
            <span className="text-right text-sm text-gray-500">
              {turno.tickets} venta{turno.tickets === 1 ? '' : 's'}
            </span>
          )}
          <button
            onClick={onAbrir}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Ir a la caja
          </button>
        </span>
      </div>

      {abierto && <DetalleEnVivo turno={turno} veEsperado={veEsperado} />}
    </li>
  );
}

/**
 * Cómo viene esa caja, ahora mismo: cuánto lleva cobrado con cada medio, cuánto
 * tendría que haber en el cajón y las últimas ventas.
 *
 * Se arma con las mismas ventas que ve el cajero en su pantalla, así que los dos
 * miran exactamente el mismo número.
 */
function DetalleEnVivo({
  turno,
  veEsperado,
}: {
  turno: TurnoAbiertoResumen;
  veEsperado: boolean;
}) {
  const ventasQ = useVentasDelTurno(turno.id);
  const ventas = ventasQ.data ?? [];

  const resumen = useMemo(() => {
    let efectivo = 0;
    const porMedio = new Map<string, number>();
    for (const v of ventas) {
      for (const p of v.pagos) {
        if (p.esEfectivo) efectivo += p.monto;
        porMedio.set(p.medio, (porMedio.get(p.medio) ?? 0) + p.monto);
      }
    }
    return {
      efectivo,
      medios: [...porMedio.entries()].sort((a, b) => b[1] - a[1]),
      total: ventas.reduce((s, v) => s + v.total, 0),
    };
  }, [ventas]);

  // Los retiros todavía no se conocen: se cargan al cerrar. Por eso lo de acá es
  // "si no sacaste nada del cajón".
  const enCaja = efectivoEsperadoEnCaja({
    fondoApertura: turno.fondoApertura,
    efectivoCobrado: resumen.efectivo,
    retiros: 0,
  });

  const ultimas = [...ventas].reverse().slice(0, 5);

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3">
      {ventasQ.isLoading ? (
        <p className="text-sm text-gray-500">Buscando las ventas del turno…</p>
      ) : ventas.length === 0 ? (
        <p className="text-sm text-gray-500">Este turno todavía no cobró nada.</p>
      ) : !veEsperado ? (
        /* ⚠️ ARQUEO A CIEGAS: el desglose por medio de pago incluye el efectivo,
           y efectivo + fondo es exactamente lo que el cajero no tiene que ver.
           Se le muestran las últimas ventas —que le sirven si vuelve un
           cliente— y nada de totales. */
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Últimas ventas
          </h3>
          <UltimasVentas ventas={ventas} />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Cobrado por medio de pago
            </h3>
            <dl className="space-y-1 text-sm">
              {resumen.medios.map(([nombre, monto]) => (
                <div key={nombre} className="flex justify-between gap-4">
                  <dt className="text-gray-600">{nombre}</dt>
                  <dd className="tabular-nums text-gray-900">{pesos(monto)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-gray-200 pt-1 font-semibold">
                <dt className="text-gray-700">Total del turno</dt>
                <dd className="tabular-nums text-gray-900">{pesos(resumen.total)}</dd>
              </div>
              <div className="flex justify-between gap-4 pt-1">
                <dt className="text-gray-600">
                  Tendría que haber en el cajón
                  <span className="block text-[11px] text-gray-400">
                    fondo {pesos(turno.fondoApertura)} + efectivo, si no sacaron nada
                  </span>
                </dt>
                <dd className="tabular-nums font-semibold text-gray-900">{pesos(enCaja)}</dd>
              </div>
            </dl>
          </div>

          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Últimas ventas
            </h3>
            <UltimasVentas ventas={ventas} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Las últimas 5 ventas del turno: hora, llamador, medios y monto. */
function UltimasVentas({ ventas }: { ventas: VentaTurno[] }) {
  const ultimas = [...ventas].reverse().slice(0, 5);
  return (
    <>
      <ul className="divide-y divide-gray-200 text-sm">
        {ultimas.map((v) => (
          <li key={v.ticketId} className="flex items-center gap-2 py-1">
            <span className="w-11 shrink-0 tabular-nums text-gray-500">
              {v.hora?.slice(0, 5) ?? '—'}
            </span>
            {v.cliente ? (
              <span className="shrink-0 rounded bg-rodziny-50 px-1.5 py-0.5 text-xs font-semibold text-rodziny-700">
                #{v.cliente}
              </span>
            ) : (
              <span className="w-6 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-gray-500">
              {v.pagos.map((p) => p.medio).join(' + ')}
            </span>
            <span className="shrink-0 tabular-nums text-gray-900">{pesos(v.total)}</span>
          </li>
        ))}
      </ul>
      {ventas.length > ultimas.length && (
        <p className="mt-1.5 text-xs text-gray-400">
          Mostrando las últimas {ultimas.length} de {ventas.length}.
        </p>
      )}
    </>
  );
}
