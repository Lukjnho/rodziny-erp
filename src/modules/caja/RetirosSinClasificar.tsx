import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';
import { normalizarDecimal, parseDecimal } from '@/lib/numero';

/**
 * Retiros de caja que nadie clasificó.
 *
 * Cuando el cajero saca plata del cajón, esa plata puede ser DOS cosas muy
 * distintas: cambio (sale y vuelve al cajón, no es un gasto) o un pago a
 * proveedor / adelanto a un empleado (sale y no vuelve, sí es un gasto). El
 * cierre guarda el total en una sola casilla y una nota escrita a mano, así que
 * mientras nadie parta ese total en dos, la plata queda en el limbo: no se sabe
 * si la caja está bien o si falta.
 *
 * La cuenta ya estaba hecha en la base (vista `v_retiros_sin_clasificar`) pero
 * no había ninguna pantalla que la mostrara: para verlos había que ir abriendo
 * cierre por cierre en Finanzas. Esto es esa pantalla.
 *
 * Solo la ve quien tiene Finanzas o Gastos, que es exactamente lo mismo que
 * pide la RLS de `cierres_caja` para estos cierres. Al cajero no se le muestra
 * un "0 pendientes" que sería mentira.
 */

export interface RetiroSinClasificar {
  id: string;
  fecha: string;
  local: string;
  turno: string;
  caja: string | null;
  total_retirado: number;
  nota: string | null;
  /** Lo que adivina la base leyendo la nota. Es una pista, no un veredicto. */
  motivo: 'sin nota' | 'menciona pago o adelanto' | 'nota ambigua';
}

const CLAVE = ['caja-retiros-sin-clasificar'];

function useRetirosSinClasificar(habilitado: boolean) {
  return useQuery({
    queryKey: CLAVE,
    enabled: habilitado,
    staleTime: 1000 * 60,
    queryFn: async (): Promise<RetiroSinClasificar[]> => {
      const { data, error } = await supabase
        .from('v_retiros_sin_clasificar')
        .select('id, fecha, local, turno, caja, total_retirado, nota, motivo');
      if (error) throw error;
      return (data ?? []) as RetiroSinClasificar[];
    },
  });
}

const pesos = (n: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);

const NOMBRE_LOCAL: Record<string, string> = {
  vedia: 'Vedia',
  saavedra: 'Saavedra',
  bienal: 'Bienal',
};

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

const ESTILO_MOTIVO: Record<RetiroSinClasificar['motivo'], string> = {
  'menciona pago o adelanto': 'bg-red-50 text-red-700 ring-red-200',
  'nota ambigua': 'bg-amber-50 text-amber-700 ring-amber-200',
  'sin nota': 'bg-gray-100 text-gray-600 ring-gray-200',
};

const POR_TANDA = 20;

export function RetirosSinClasificar() {
  const retirosQ = useRetirosSinClasificar(true);
  const [filtroLocal, setFiltroLocal] = useState<string>('todos');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [cuantos, setCuantos] = useState(POR_TANDA);

  const todos = useMemo(() => retirosQ.data ?? [], [retirosQ.data]);

  const locales = useMemo(() => Array.from(new Set(todos.map((r) => r.local))).sort(), [todos]);

  const lista = useMemo(() => {
    const filtrados =
      filtroLocal === 'todos' ? todos : todos.filter((r) => r.local === filtroLocal);
    // Lo más nuevo primero: es lo que el que clasifica todavía tiene fresco.
    return [...filtrados].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  }, [todos, filtroLocal]);

  const monto = useMemo(() => lista.reduce((a, r) => a + Number(r.total_retirado || 0), 0), [lista]);

  // Si no hay nada pendiente no se dibuja: no tiene sentido ocupar la pantalla
  // con un cartel de "todo al día" todos los días.
  if (!retirosQ.isLoading && todos.length === 0) return null;

  return (
    <section className="mt-4 rounded-lg border border-amber-300 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-amber-900">Retiros de caja sin clasificar</h2>
          <p className="mt-0.5 text-xs text-amber-800">
            Plata que salió del cajón y todavía no se sabe si volvió (cambio) o se fue (pago).
          </p>
        </div>
        <div className="flex items-center gap-3">
          {locales.length > 1 && (
            <select
              value={filtroLocal}
              onChange={(e) => {
                setFiltroLocal(e.target.value);
                setCuantos(POR_TANDA);
              }}
              className="rounded border border-amber-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            >
              <option value="todos">Todos los locales</option>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {NOMBRE_LOCAL[l] ?? l}
                </option>
              ))}
            </select>
          )}
          <div className="text-right leading-tight">
            <div className="text-sm font-semibold tabular-nums text-amber-900">{pesos(monto)}</div>
            <div className="text-xs text-amber-700">
              {lista.length} sin clasificar
            </div>
          </div>
        </div>
      </header>

      {retirosQ.isLoading ? (
        <p className="px-4 py-6 text-sm text-gray-500">Buscando retiros…</p>
      ) : retirosQ.isError ? (
        <p className="px-4 py-6 text-sm text-red-600">
          No se pudieron traer los retiros: {mensajeErrorAmigable(retirosQ.error, 'error')}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100">
            {lista.slice(0, cuantos).map((r) => (
              <FilaRetiro
                key={r.id}
                retiro={r}
                abierto={abierto === r.id}
                onAlternar={() => setAbierto((p) => (p === r.id ? null : r.id))}
                onListo={() => setAbierto(null)}
              />
            ))}
          </ul>
          {lista.length > cuantos && (
            <div className="border-t border-gray-100 px-4 py-3 text-center">
              <button
                onClick={() => setCuantos((c) => c + POR_TANDA)}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Mostrar {Math.min(POR_TANDA, lista.length - cuantos)} más
                <span className="ml-1 text-gray-400">
                  (quedan {lista.length - cuantos})
                </span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FilaRetiro({
  retiro,
  abierto,
  onAlternar,
  onListo,
}: {
  retiro: RetiroSinClasificar;
  abierto: boolean;
  onAlternar: () => void;
  onListo: () => void;
}) {
  const qc = useQueryClient();
  const total = Number(retiro.total_retirado || 0);
  const [cambio, setCambio] = useState('');
  const [pagos, setPagos] = useState('');
  const [error, setError] = useState('');

  const nCambio = parseDecimal(cambio);
  const nPagos = parseDecimal(pagos);
  const suma = nCambio + nPagos;
  // 1 peso de tolerancia: los cierres viejos vienen con centavos redondeados.
  const cuadra = cambio !== '' && pagos !== '' && Math.abs(suma - total) <= 1;
  const falta = total - suma;

  const guardar = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await supabase
        .from('cierres_caja')
        .update({ retiro_cambio: nCambio, retiro_pagos: nPagos })
        .eq('id', retiro.id)
        .select('id, retiro_cambio, retiro_pagos');
      if (err) throw err;
      // Un UPDATE que la RLS bloquea devuelve 0 filas y NO tira error: si no
      // volvió la fila, no se guardó, por más que no haya fallado.
      if (!data || data.length === 0) {
        throw new Error(
          'No se pudo guardar: la base no confirmó el cambio. Puede ser un problema de permisos.',
        );
      }
      return data[0];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CLAVE });
      // El desglose cambia lo que Finanzas muestra de ese cierre.
      qc.invalidateQueries({ queryKey: ['cierres-caja'] });
      onListo();
    },
    onError: (e) => setError(mensajeErrorAmigable(e, 'No se pudo guardar la clasificación')),
  });

  function repartir(todoA: 'cambio' | 'pagos') {
    setError('');
    setCambio(todoA === 'cambio' ? String(total) : '0');
    setPagos(todoA === 'pagos' ? String(total) : '0');
  }

  return (
    <li>
      <button
        onClick={onAlternar}
        className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-left hover:bg-gray-50"
      >
        <span className="w-3 text-xs text-gray-400">{abierto ? '▾' : '▸'}</span>
        <span className="text-sm font-medium tabular-nums text-gray-900">
          {pesos(total)}
        </span>
        <span className="text-sm text-gray-600">
          {fechaCorta(retiro.fecha)} · {NOMBRE_LOCAL[retiro.local] ?? retiro.local}
          {retiro.caja ? ` · ${retiro.caja}` : ''}
        </span>
        <span
          className={cn(
            'rounded px-2 py-0.5 text-xs ring-1 ring-inset',
            ESTILO_MOTIVO[retiro.motivo] ?? ESTILO_MOTIVO['sin nota'],
          )}
        >
          {retiro.motivo}
        </span>
        {retiro.nota && (
          <span className="min-w-0 flex-1 truncate text-sm italic text-gray-500" title={retiro.nota}>
            “{retiro.nota}”
          </span>
        )}
      </button>

      {abierto && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
          {retiro.nota ? (
            <p className="mb-3 rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
              <span className="mr-1 text-xs uppercase tracking-wide text-gray-400">
                Lo que anotó el cajero
              </span>
              <br />
              {retiro.nota}
            </p>
          ) : (
            <p className="mb-3 text-sm text-gray-500">
              Este retiro no tiene ninguna nota. Si no te acordás, preguntale al encargado del
              turno antes de repartirlo.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Cambio <span className="font-normal text-gray-400">(vuelve al cajón)</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={cambio}
                onChange={(e) => {
                  setCambio(normalizarDecimal(e.target.value));
                  setError('');
                }}
                placeholder="0"
                className="w-36 rounded border border-gray-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Pagos y adelantos <span className="font-normal text-gray-400">(no vuelve)</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={pagos}
                onChange={(e) => {
                  setPagos(normalizarDecimal(e.target.value));
                  setError('');
                }}
                placeholder="0"
                className="w-36 rounded border border-gray-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => repartir('cambio')}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
              >
                Todo cambio
              </button>
              <button
                onClick={() => repartir('pagos')}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
              >
                Todo pagos
              </button>
            </div>

            <button
              onClick={() => guardar.mutate()}
              disabled={!cuadra || guardar.isPending}
              className="rounded bg-rodziny-700 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-800 disabled:opacity-40"
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>

          {/* Las dos partes tienen que sumar el retiro. Si no, no se guarda:
              media clasificación deja la plata en el limbo igual que antes. */}
          <p
            className={cn(
              'mt-3 text-xs tabular-nums',
              cuadra ? 'text-green-700' : 'text-gray-500',
            )}
          >
            {cambio === '' && pagos === ''
              ? `Las dos partes tienen que sumar ${pesos(total)}.`
              : cuadra
                ? `✓ Suman ${pesos(total)}.`
                : falta > 0
                  ? `Faltan ${pesos(falta)} para llegar a ${pesos(total)}.`
                  : `Te pasaste ${pesos(-falta)} de ${pesos(total)}.`}
          </p>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      )}
    </li>
  );
}
