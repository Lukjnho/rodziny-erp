import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { useAuth } from '@/lib/auth';
import { abrirVentanaCaja, RUTA_POS } from '@/lib/ventanaCaja';
import { TURNOS } from '@/lib/turnosCaja';
import { useTurnosAbiertos, type LocalCaja, type TurnoAbiertoResumen } from './useCaja';

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
  const { perfil } = useAuth();
  const navigate = useNavigate();
  const localForzado = (perfil?.local_restringido as LocalCaja | null) ?? null;
  const turnosQ = useTurnosAbiertos(localForzado);
  const [bloqueada, setBloqueada] = useState(false);

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
              <FilaTurno key={t.id} turno={t} onAbrir={abrir} />
            ))}
          </ul>
        )}
      </section>

      <p className="mt-3 text-xs text-gray-400">
        Los turnos cerrados se controlan en Finanzas → Cierre de Caja. Las ventas cobradas por este
        punto de venta todavía <strong>no</strong> entran en Ventas, EdR ni Flujo: se están corriendo
        en paralelo con Fudo para poder compararlas.
      </p>
    </PageContainer>
  );
}

function FilaTurno({ turno, onAbrir }: { turno: TurnoAbiertoResumen; onAbrir: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <span className="flex items-center gap-2">
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
        {turno.cajeroNombre ? <span className="capitalize">{turno.cajeroNombre}</span> : 'Sin cajero'}
        {turno.horaInicio ? ` desde las ${turno.horaInicio.slice(0, 5)}` : ''}
      </span>

      <span className="ml-auto flex items-center gap-5">
        <span className="text-right leading-tight">
          <span className="block text-xs text-gray-400">Fondo</span>
          <span className="block text-sm text-gray-700">{pesos(turno.fondoApertura)}</span>
        </span>
        <span className="text-right leading-tight">
          <span className="block text-xs text-gray-400">
            {turno.tickets} venta{turno.tickets === 1 ? '' : 's'}
          </span>
          <span className="block text-sm font-semibold text-gray-900">{pesos(turno.cobrado)}</span>
        </span>
        <button
          onClick={onAbrir}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Ir a la caja
        </button>
      </span>
    </li>
  );
}
