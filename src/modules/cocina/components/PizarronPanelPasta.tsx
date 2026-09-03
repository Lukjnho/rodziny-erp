import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabaseAnon } from '@/lib/supabaseAnon';
import { supabase } from '@/lib/supabase';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';
import { hoyAR } from '@/lib/fechaAR';
import { cn } from '@/lib/utils';
import { vendibleHoy, type StockPastaRow } from '../lib/stockPastas';
import { ResponsableBotones } from './ResponsableBotones';

/**
 * El panel de UNA pasta en el pizarrón del depósito: qué hay, de qué lotes, y
 * las dos cosas que se pueden hacer de parado — CONTAR y SACAR.
 *
 * POR QUÉ EXISTE. La primera versión abría directo el teclado para contar y no
 * mostraba nada más. Lucas: *"cuando yo hago click en la pasta, solo me aparece
 * para contabilizar, pero no me aparece ninguna otra información, como cuántos
 * lotes hay en ese total, tipo FIFO"*. Y aparte: *"cómo hacemos para descontar
 * cuando sacamos"*.
 *
 * ⚠️ LA HONESTIDAD DEL NÚMERO. El total de la cámara arranca del último conteo
 * físico y le suma lo posterior. O sea que los lotes que se pueden identificar
 * uno por uno son SOLO los que entraron después del conteo: lo anterior quedó
 * absorbido en un solo número y no se puede desglosar. Entonces la lista de
 * lotes casi nunca suma exactamente el total, y eso NO es un error — pero si no
 * se explica, la pantalla parece contradecirse sola. Por eso hay un renglón que
 * dice de dónde viene la diferencia.
 *
 * ⚠️ Los lotes salen de `v_cocina_lote_pasta_saldo`, que NO usa el conteo físico
 * (da el saldo histórico de cada lote). Se usa para LISTAR y ordenar por
 * antigüedad, y su suma NUNCA se muestra como si fuera el stock: el stock sale
 * de la cuenta única, como en todas las demás pantallas.
 */

type Modo = 'info' | 'contar' | 'sacar';
type Destino = 'mostrador' | 'merma';

interface LoteEnCamara {
  lote_pasta_id: string;
  fecha_armado: string;
  fecha_porcionado: string | null;
  saldo_camara: number;
  porciones_iniciales: number | null;
}

function diasDesdeFecha(fechaISO: string): number {
  const d = new Date(fechaISO + 'T00:00:00');
  const hoy = new Date(hoyAR() + 'T00:00:00');
  return Math.max(0, Math.round((hoy.getTime() - d.getTime()) / 86_400_000));
}

function fechaCorta(fechaISO: string): string {
  const [a, m, d] = fechaISO.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

function conMiles(n: number): string {
  return n.toLocaleString('es-AR');
}

/** Cuántos días se considera "viejo" un lote en la cámara de congelado. */
const DIAS_LOTE_VIEJO = 30;

export function PizarronPanelPasta({
  fila,
  local,
  nombreSesion,
  haySesion,
  onCerrar,
  onGuardado,
}: {
  fila: StockPastaRow & { ultimo_conteo_at: string | null };
  local: 'vedia' | 'saavedra';
  nombreSesion: string | null;
  /** null = todavía no se sabe si hay sesión. */
  haySesion: boolean | null;
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const qc = useQueryClient();
  const [modo, setModo] = useState<Modo>('info');
  const [cantidad, setCantidad] = useState('');
  const [quien, setQuien] = useState('');
  const [destino, setDestino] = useState<Destino>('mostrador');
  const [error, setError] = useState('');

  const total = vendibleHoy(fila);

  // ── Los lotes que se pueden identificar, del más viejo al más nuevo ────────
  const { data: lotes, isLoading: cargandoLotes } = useQuery({
    queryKey: ['pizarron-lotes', fila.producto_id, local],
    queryFn: async () => {
      const { data, error: e } = await supabaseAnon
        .from('v_cocina_lote_pasta_saldo')
        .select('lote_pasta_id, fecha_armado, fecha_porcionado, saldo_camara, porciones_iniciales')
        .eq('producto_id', fila.producto_id)
        .eq('local', local)
        .eq('ubicacion', 'camara_congelado')
        .gt('saldo_camara', 0)
        // FIFO: en congelado se saca lo más viejo primero.
        .order('fecha_armado', { ascending: true });
      if (e) throw e;
      return (data ?? []) as unknown as LoteEnCamara[];
    },
  });

  const sumaLotes = useMemo(
    () => (lotes ?? []).reduce((s, l) => s + (Number(l.saldo_camara) || 0), 0),
    [lotes],
  );
  const diferencia = total - sumaLotes;
  const conteoCorto = fila.ultimo_conteo_at ? fechaCorta(fila.ultimo_conteo_at.slice(0, 10)) : null;

  const limpiar = () => {
    setCantidad('');
    setQuien(''); // pantalla compartida: no se recuerda a nadie
    setError('');
  };

  const cerrarTodo = () => {
    limpiar();
    setModo('info');
    onCerrar();
  };

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['pizarron-stock'] });
    qc.invalidateQueries({ queryKey: ['pizarron-movimientos'] });
    qc.invalidateQueries({ queryKey: ['pizarron-lotes'] });
  };

  // ── Contar: guarda un BASELINE nuevo, no un ajuste ────────────────────────
  const guardarConteo = useMutation({
    mutationFn: async (p: { cantidad_real: number; responsable: string }) => {
      const { error: e } = await supabase.from('cocina_cierre_camara').insert({
        producto_id: fila.producto_id,
        local,
        // ⚠️ Explícita: el default de la columna es CURRENT_DATE, que es UTC.
        fecha: hoyAR(),
        cantidad_real: p.cantidad_real,
        responsable: p.responsable,
        notas: 'Conteo desde el pizarrón del depósito',
      });
      if (e) throw e;
    },
    onSuccess: (_d, p) => {
      onGuardado(`${fila.nombre}: quedaron ${conMiles(p.cantidad_real)} porciones`);
      refrescar();
      cerrarTodo();
    },
    onError: (e: Error) => setError(mensajeErrorAmigable(e, 'No se pudo guardar el conteo')),
  });

  // ── Sacar: al mostrador (traspaso) o perdido (merma) ──────────────────────
  const guardarSalida = useMutation({
    mutationFn: async (p: { porciones: number; responsable: string; destino: Destino }) => {
      if (p.destino === 'mostrador') {
        const { error: e } = await supabase.from('cocina_traspasos').insert({
          producto_id: fila.producto_id,
          local,
          fecha: hoyAR(),
          hora: new Date().toTimeString().slice(0, 8),
          porciones: p.porciones,
          responsable: p.responsable,
          notas: 'Salida desde el pizarrón del depósito',
        });
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from('cocina_merma').insert({
          producto_id: fila.producto_id,
          local,
          fecha: hoyAR(),
          porciones: p.porciones,
          motivo: 'Perdido en cámara',
          responsable: p.responsable,
          notas: 'Cargado desde el pizarrón del depósito',
        });
        if (e) throw e;
      }
    },
    onSuccess: (_d, p) => {
      onGuardado(
        p.destino === 'mostrador'
          ? `${fila.nombre}: bajaron ${conMiles(p.porciones)} porciones al mostrador`
          : `${fila.nombre}: se dieron de baja ${conMiles(p.porciones)} porciones`,
      );
      refrescar();
      cerrarTodo();
    },
    onError: (e: Error) => setError(mensajeErrorAmigable(e, 'No se pudo registrar la salida')),
  });

  const guardando = guardarConteo.isPending || guardarSalida.isPending;
  const num = Number(cantidad);
  const dif = num - total;
  const sacaDeMas = modo === 'sacar' && cantidad !== '' && num > total;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900 px-6 py-6">
      <div className="mx-auto max-w-2xl pb-10">
        <button type="button" onClick={cerrarTodo} className="mb-6 text-lg text-slate-400 underline">
          ← Volver
        </button>

        <h2 className="text-3xl font-bold leading-tight">{fila.nombre}</h2>
        <p className="mt-2 text-2xl">
          <span className="font-bold text-teal-300">{conMiles(total)}</span>{' '}
          <span className="text-slate-400">porciones en cámara</span>
        </p>

        {/* ── De qué lotes está hecho ese número ───────────────────────── */}
        {modo === 'info' && (
          <>
            <h3 className="mt-8 text-base uppercase tracking-wider text-slate-500">
              Lotes anotados · del más viejo al más nuevo
            </h3>
            <p className="mt-1 text-base text-slate-500">
              Sirve para saber qué sacar primero. La suma no tiene por qué dar el total — abajo
              está por qué.
            </p>

            {cargandoLotes ? (
              <p className="mt-3 text-lg text-slate-400">Buscando los lotes…</p>
            ) : (lotes ?? []).length === 0 ? (
              <p className="mt-3 text-lg text-slate-400">
                No hay lotes identificados. Todo lo que hay viene del conteo físico.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-800 rounded-2xl bg-slate-800/60">
                {(lotes ?? []).map((l, i) => {
                  const dias = diasDesdeFecha(l.fecha_armado);
                  const viejo = dias >= DIAS_LOTE_VIEJO;
                  return (
                    <li key={l.lote_pasta_id} className="flex items-center gap-4 px-5 py-4">
                      <span
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold',
                          i === 0 ? 'bg-teal-400 text-slate-900' : 'bg-slate-700 text-slate-300',
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xl font-semibold">
                          {conMiles(Number(l.saldo_camara))}{' '}
                          <span className="text-base font-normal text-slate-400">porc.</span>
                        </p>
                        <p className={cn('text-base', viejo ? 'text-amber-300' : 'text-slate-400')}>
                          armado el {fechaCorta(l.fecha_armado)} · hace {dias}{' '}
                          {dias === 1 ? 'día' : 'días'}
                          {viejo && ' ⚠'}
                        </p>
                      </div>
                      {i === 0 && (
                        <span className="shrink-0 rounded-lg bg-teal-400/20 px-3 py-1.5 text-base font-medium text-teal-200">
                          el primero
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* La diferencia entre los lotes y el total, explicada. Sin esto la
                pantalla parece contradecirse sola. */}
            {!cargandoLotes && diferencia !== 0 && (
              <p className="mt-3 rounded-xl bg-slate-800/60 px-5 py-4 text-base leading-relaxed text-slate-400">
                Los lotes anotados suman <strong>{conMiles(sumaLotes)}</strong> y en la cámara hay{' '}
                <strong>{conMiles(total)}</strong>.{' '}
                {diferencia > 0 ? (
                  <>
                    Las {conMiles(diferencia)} de diferencia vienen del conteo físico
                    {conteoCorto ? ` del ${conteoCorto}` : ''}, que da un número total y no se
                    reparte lote por lote.
                  </>
                ) : (
                  <>
                    Manda el conteo físico
                    {conteoCorto ? ` del ${conteoCorto}` : ''}: encontró{' '}
                    {conMiles(Math.abs(diferencia))} menos de lo que decía el detalle por lote. El
                    detalle quedó viejo y no se corrige solo — usalo para ver antigüedad, no para
                    sumar.
                  </>
                )}
              </p>
            )}

            {/* ── Las dos acciones ──────────────────────────────────────── */}
            <div className="mt-8 grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => {
                  setModo('sacar');
                  setCantidad('');
                  setError('');
                }}
                className="min-h-[88px] rounded-2xl bg-slate-700 text-2xl font-bold transition hover:bg-slate-600"
              >
                📤 Sacar
              </button>
              <button
                type="button"
                onClick={() => {
                  setModo('contar');
                  setCantidad(String(total));
                  setError('');
                }}
                className="min-h-[88px] rounded-2xl bg-teal-400 text-2xl font-bold text-slate-900 transition hover:bg-teal-300"
              >
                🔢 Contar
              </button>
            </div>
          </>
        )}

        {/* ── Contar o sacar: mismo teclado, distinta pregunta ──────────── */}
        {modo !== 'info' && (
          <>
            <button
              type="button"
              onClick={() => {
                setModo('info');
                limpiar();
              }}
              className="mt-6 text-lg text-slate-400 underline"
            >
              ← Ver los lotes
            </button>

            <p className="mt-6 text-2xl font-semibold">
              {modo === 'contar' ? '¿Cuántas contaste?' : '¿Cuántas porciones sacás?'}
            </p>
            {modo === 'contar' && (
              <p className="mt-1 text-lg text-slate-400">
                El sistema cree que hay {conMiles(total)}
              </p>
            )}

            <div className="mt-3 rounded-2xl bg-slate-800 px-6 py-5 text-center text-6xl font-bold tabular-nums">
              {cantidad === '' ? (
                <span className="text-slate-600">0</span>
              ) : (
                conMiles(num)
              )}
            </div>

            {modo === 'contar' && cantidad !== '' && dif !== 0 && (
              <p
                className={cn(
                  'mt-3 text-center text-xl font-medium',
                  dif < 0 ? 'text-amber-300' : 'text-teal-300',
                )}
              >
                {dif < 0
                  ? `${conMiles(Math.abs(dif))} menos de lo que decía el sistema`
                  : `${conMiles(dif)} más de lo que decía el sistema`}
              </p>
            )}
            {sacaDeMas && (
              <p className="mt-3 text-center text-xl font-medium text-amber-300">
                En cámara hay {conMiles(total)}. Si igual hay más, primero contá.
              </p>
            )}

            {/* Teclado propio: el del sistema tapa media pantalla en una tablet
                y hay que apuntar a teclas chicas. */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCantidad((v) => (v === '0' ? d : v + d))}
                  className="min-h-[72px] rounded-xl bg-slate-700 text-3xl font-semibold hover:bg-slate-600"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCantidad((v) => (v === '' || v === '0' ? '0' : v + '0'))}
                className="min-h-[72px] rounded-xl bg-slate-700 text-3xl font-semibold hover:bg-slate-600"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setCantidad('')}
                className="min-h-[72px] rounded-xl bg-slate-700 text-xl font-semibold text-slate-300 hover:bg-slate-600"
              >
                Borrar
              </button>
              <button
                type="button"
                onClick={() => setCantidad((v) => v.slice(0, -1))}
                className="min-h-[72px] rounded-xl bg-slate-700 text-3xl font-semibold hover:bg-slate-600"
              >
                ⌫
              </button>
            </div>

            {/* A dónde va lo que sale. Son dos tablas distintas y dos hechos
                distintos: bajar al mostrador es una venta que va a pasar,
                perderlo es merma. */}
            {modo === 'sacar' && (
              <>
                <p className="mt-8 text-2xl font-semibold">¿A dónde va?</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDestino('mostrador')}
                    className={cn(
                      'min-h-[72px] rounded-xl px-4 text-xl font-semibold transition',
                      destino === 'mostrador'
                        ? 'bg-teal-400 text-slate-900 ring-4 ring-teal-200'
                        : 'bg-slate-700 text-slate-100 hover:bg-slate-600',
                    )}
                  >
                    Al mostrador
                  </button>
                  <button
                    type="button"
                    onClick={() => setDestino('merma')}
                    className={cn(
                      'min-h-[72px] rounded-xl px-4 text-xl font-semibold transition',
                      destino === 'merma'
                        ? 'bg-amber-400 text-slate-900 ring-4 ring-amber-200'
                        : 'bg-slate-700 text-slate-100 hover:bg-slate-600',
                    )}
                  >
                    Se perdió
                  </button>
                </div>
              </>
            )}

            <p className="mt-8 text-2xl font-semibold">
              {modo === 'contar' ? '¿Quién contó?' : '¿Quién lo saca?'}
            </p>
            <div className="mt-3">
              <ResponsableBotones
                local={local}
                value={quien}
                onChange={setQuien}
                nombreSesion={nombreSesion}
              />
            </div>

            {haySesion === false && (
              <div className="mt-6 rounded-xl border-2 border-amber-500/60 bg-amber-500/10 px-5 py-4 text-lg text-amber-200">
                Esta tablet no tiene la sesión iniciada, así que todavía no puede guardar. Entrá una
                vez al ERP desde este mismo navegador y queda lista.
              </div>
            )}

            {error && (
              <div className="mt-6 rounded-xl bg-red-500/20 px-5 py-4 text-lg text-red-200">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={
                cantidad === '' || num <= 0 || !quien || haySesion === false || guardando
              }
              onClick={() => {
                setError('');
                if (modo === 'contar') {
                  guardarConteo.mutate({ cantidad_real: num, responsable: quien });
                } else {
                  guardarSalida.mutate({ porciones: num, responsable: quien, destino });
                }
              }}
              className={cn(
                'mt-8 min-h-[80px] w-full rounded-2xl text-2xl font-bold transition disabled:bg-slate-700 disabled:text-slate-500',
                modo === 'contar'
                  ? 'bg-teal-400 text-slate-900 hover:bg-teal-300'
                  : destino === 'merma'
                    ? 'bg-amber-400 text-slate-900 hover:bg-amber-300'
                    : 'bg-teal-400 text-slate-900 hover:bg-teal-300',
              )}
            >
              {guardando
                ? 'Guardando…'
                : modo === 'contar'
                  ? 'Guardar el conteo'
                  : destino === 'mostrador'
                    ? 'Bajar al mostrador'
                    : 'Dar de baja'}
            </button>

            <p className="mt-4 text-base text-slate-500">
              {modo === 'contar'
                ? 'El conteo no borra nada: queda con tu nombre y la hora, aparece abajo en los movimientos, y el número arranca de ahí.'
                : 'Queda registrado con tu nombre y la hora, y se descuenta del número de la cámara.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
