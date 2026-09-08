import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { cn, formatARS } from '@/lib/utils';
import { useCatalogoCaja, ORDEN_GRUPOS, ordenGrupo, type ItemCatalogo } from '@/modules/caja/useCaja';
import type { LocalSalon } from './useSalon';
import {
  usePlano,
  useSesionesAbiertas,
  useAbrirMesa,
  useAgregarPlato,
  useSacarPlato,
  useMandarACocina,
  usePedirLaCuenta,
  importeDeLinea,
  type LineaMesa,
  type SesionMesa,
} from './useMesas';

/**
 * La pantalla del mozo, pensada para el TELÉFONO.
 *
 * El mozo entra con su propio usuario (no hay PIN: lo decidió Lucas el
 * 7-sep-2026) y desde acá abre la mesa, carga los platos, los manda a la cocina
 * y avisa que piden la cuenta. **No cobra**: la plata se toca en el mostrador.
 *
 * 💣 Todo va por las funciones de la base. Acá no se manda ningún precio: se
 * manda el plato y la cantidad, y el precio lo pone la base leyendo la carta.
 */
export function SalonMozoPage() {
  const { perfil } = useAuth();
  const navigate = useNavigate();
  const local = ((perfil?.local_restringido as LocalSalon | null) ?? 'saavedra') as LocalSalon;

  const [salaSel, setSalaSel] = useState<string | null>(null);
  const [mesaAbierta, setMesaAbierta] = useState<string | null>(null); // id de la sesión
  const [error, setError] = useState<string | null>(null);

  const planoQ = usePlano(local);
  const mesasQ = useSesionesAbiertas(local);

  const abrirMesa = useAbrirMesa(local);

  const salas = planoQ.data?.salas ?? [];
  const salaVigente = salas.some((s) => s.id === salaSel) ? salaSel : (salas[0]?.id ?? null);
  const mesas = (planoQ.data?.mesas ?? []).filter((m) => m.sala_id === salaVigente);

  const sesiones = useMemo(() => mesasQ.data?.sesiones ?? [], [mesasQ.data]);
  const lineas = mesasQ.data?.lineas ?? [];

  const porMesa = useMemo(() => {
    const m = new Map<string, SesionMesa>();
    for (const s of sesiones) m.set(s.mesa_id, s);
    return m;
  }, [sesiones]);

  const totalDe = (sesionId: string) =>
    lineas
      .filter((l) => l.sesion_id === sesionId && l.estado === 'activa')
      .reduce((a, l) => a + importeDeLinea(l), 0);

  async function correr(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo hacer');
    }
  }

  const sesionAbierta = sesiones.find((s) => s.id === mesaAbierta) ?? null;

  if (sesionAbierta) {
    const mesa = (planoQ.data?.mesas ?? []).find((m) => m.id === sesionAbierta.mesa_id);
    return (
      <DetalleMesa
        local={local}
        sesion={sesionAbierta}
        numero={mesa?.numero ?? '?'}
        lineas={lineas.filter((l) => l.sesion_id === sesionAbierta.id)}
        onVolver={() => setMesaAbierta(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-8">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Salón</h1>
          <p className="text-xs text-gray-500">
            {local === 'saavedra' ? 'Rodziny Saavedra' : 'Rodziny Vedia'} · {perfil?.nombre}
          </p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600"
        >
          Salir
        </button>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {salas.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-3">
          {salas.map((s) => (
            <button
              key={s.id}
              onClick={() => setSalaSel(s.id)}
              className={cn(
                'whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium',
                s.id === salaVigente ? 'bg-rodziny-800 text-white' : 'bg-white text-gray-600',
              )}
            >
              {s.nombre}
            </button>
          ))}
        </div>
      )}

      {planoQ.isLoading && <p className="px-4 text-sm text-gray-500">Cargando el plano…</p>}

      {!planoQ.isLoading && mesas.length === 0 && (
        <p className="px-4 text-sm text-gray-500">
          Este espacio no tiene mesas cargadas. Las carga administración desde el ERP.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:grid-cols-4">
        {mesas.map((m) => {
          const s = porMesa.get(m.id);
          const total = s ? totalDe(s.id) : 0;
          return (
            <button
              key={m.id}
              onClick={() => {
                if (s) {
                  setMesaAbierta(s.id);
                  return;
                }
                const cuantos = window.prompt(`Mesa ${m.numero}: ¿cuántas personas se sientan?`);
                if (cuantos === null) return;
                const n = Number(cuantos);
                if (!Number.isFinite(n) || n < 1) {
                  setError('Poné cuántas personas son, con un número.');
                  return;
                }
                void correr(() => abrirMesa.mutateAsync({ mesaId: m.id, comensales: n }));
              }}
              className={cn(
                'flex min-h-[5.5rem] flex-col items-center justify-center gap-1 border-2 p-3 text-center shadow-sm',
                m.forma === 'redonda' ? 'rounded-full' : 'rounded-lg',
                !s && 'border-dashed border-gray-300 bg-white text-gray-400',
                s?.estado === 'abierta' && 'border-rodziny-700 bg-rodziny-50 text-rodziny-900',
                s?.estado === 'cuenta_pedida' && 'border-amber-500 bg-amber-50 text-amber-900',
              )}
            >
              <span className="text-xl font-bold">{m.numero}</span>
              {!s && <span className="text-xs">libre</span>}
              {s && (
                <>
                  <span className="text-xs">
                    {s.comensales} {s.comensales === 1 ? 'persona' : 'personas'}
                  </span>
                  <span className="text-sm font-semibold">{formatARS(total)}</span>
                  {s.estado === 'cuenta_pedida' && (
                    <span className="text-xs font-medium">piden la cuenta</span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Una mesa abierta ────────────────────────────────────────────────────────

function DetalleMesa({
  local,
  sesion,
  numero,
  lineas,
  onVolver,
}: {
  local: LocalSalon;
  sesion: SesionMesa;
  numero: string;
  lineas: LineaMesa[];
  onVolver: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  const agregar = useAgregarPlato(local);
  const sacar = useSacarPlato(local);
  const mandar = useMandarACocina(local);
  const pedirCuenta = usePedirLaCuenta(local);

  const activas = lineas.filter((l) => l.estado === 'activa');
  const sinMandar = activas.filter((l) => l.envio_id === null);
  const total = activas.reduce((a, l) => a + importeDeLinea(l), 0);

  async function correr(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo hacer');
    }
  }

  if (buscando) {
    return (
      <Carta
        local={local}
        onElegir={(item) => {
          void correr(async () => {
            await agregar.mutateAsync({
              sesionId: sesion.id,
              recetaId: item.refId,
              cantidad: 1,
            });
          });
        }}
        onVolver={() => setBuscando(false)}
        error={error}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-40">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <button onClick={onVolver} className="text-sm text-gray-500">
          ← Mesas
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-gray-800">Mesa {numero}</h1>
          <p className="text-xs text-gray-500">
            {sesion.comensales} {sesion.comensales === 1 ? 'persona' : 'personas'}
            {sesion.estado === 'cuenta_pedida' && ' · piden la cuenta'}
          </p>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="space-y-2 p-4">
        {activas.length === 0 && (
          <p className="text-sm text-gray-500">Todavía no cargaste nada en esta mesa.</p>
        )}
        {activas.map((l) => (
          <div
            key={l.id}
            className={cn(
              'flex items-center gap-3 rounded-lg border bg-white p-3',
              l.padre_id && 'ml-6',
              l.envio_id === null ? 'border-dashed border-amber-400' : 'border-gray-200',
            )}
          >
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">
                {Number(l.cantidad)}× {l.nombre}
              </p>
              <p className="text-xs text-gray-500">
                {formatARS(Number(l.precio_unitario))} c/u
                {l.envio_id === null && ' · sin mandar a la cocina'}
              </p>
            </div>
            <span className="text-sm font-semibold text-gray-800">{formatARS(importeDeLinea(l))}</span>
            <button
              onClick={() => {
                const motivo = window.prompt(`¿Por qué se saca ${l.nombre}?`);
                if (motivo === null) return;
                void correr(() => sacar.mutateAsync({ lineaId: l.id, motivo }));
              }}
              className="text-gray-400"
              title="Sacar el plato"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 space-y-2 border-t border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Total de la mesa</span>
          <span className="text-xl font-bold text-gray-900">{formatARS(total)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setBuscando(true)}
            className="rounded-lg bg-rodziny-700 py-3 text-sm font-semibold text-white"
          >
            + Agregar plato
          </button>
          <button
            onClick={() => void correr(() => mandar.mutateAsync(sesion.id))}
            disabled={sinMandar.length === 0}
            className={cn(
              'rounded-lg py-3 text-sm font-semibold',
              sinMandar.length === 0
                ? 'bg-gray-200 text-gray-400'
                : 'bg-amber-500 text-white',
            )}
          >
            Mandar a cocina{sinMandar.length > 0 ? ` (${sinMandar.length})` : ''}
          </button>
        </div>
        <button
          onClick={() => void correr(() => pedirCuenta.mutateAsync(sesion.id))}
          disabled={sesion.estado === 'cuenta_pedida'}
          className={cn(
            'w-full rounded-lg border py-3 text-sm font-semibold',
            sesion.estado === 'cuenta_pedida'
              ? 'border-gray-200 text-gray-400'
              : 'border-rodziny-700 text-rodziny-800',
          )}
        >
          {sesion.estado === 'cuenta_pedida' ? 'Ya avisaste que piden la cuenta' : 'Piden la cuenta'}
        </button>
        <p className="text-center text-xs text-gray-400">
          La mesa la cobra el mostrador, no el teléfono.
        </p>
      </div>
    </div>
  );
}

// ── La carta ────────────────────────────────────────────────────────────────

function Carta({
  local,
  onElegir,
  onVolver,
  error,
}: {
  local: LocalSalon;
  onElegir: (item: ItemCatalogo) => void;
  onVolver: () => void;
  error: string | null;
}) {
  const [busca, setBusca] = useState('');
  const { data: catalogo = [], isLoading } = useCatalogoCaja(local);

  const filtrado = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const items = q ? catalogo.filter((i) => i.nombre.toLowerCase().includes(q)) : catalogo;
    return [...items].sort(
      (a, b) => ordenGrupo(a.grupo) - ordenGrupo(b.grupo) || a.nombre.localeCompare(b.nombre, 'es'),
    );
  }, [catalogo, busca]);

  return (
    <div className="min-h-screen bg-gray-100 pb-8">
      <header className="sticky top-0 z-10 space-y-2 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onVolver} className="text-sm text-gray-500">
            ← Volver
          </button>
          <h1 className="text-lg font-semibold text-gray-800">Carta</h1>
        </div>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar un plato…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
        />
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {isLoading && <p className="px-4 pt-4 text-sm text-gray-500">Cargando la carta…</p>}

      {!isLoading && filtrado.length === 0 && (
        <p className="px-4 pt-4 text-sm text-gray-500">
          No hay platos con ese nombre en la carta de esta casa.
        </p>
      )}

      <div className="space-y-2 p-4">
        {ORDEN_GRUPOS.map((g) => {
          const delGrupo = filtrado.filter((i) => i.grupo === g);
          if (delGrupo.length === 0) return null;
          return (
            <div key={g}>
              <h2 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {g}
              </h2>
              <div className="space-y-2">
                {delGrupo.map((i) => (
                  <button
                    key={i.key}
                    onClick={() => onElegir(i)}
                    className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white p-3 text-left"
                  >
                    <span className="text-sm font-medium text-gray-800">{i.nombre}</span>
                    <span className="text-sm text-gray-500">{formatARS(i.precio)}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
