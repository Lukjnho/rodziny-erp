import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import { NuevoGastoModal, type PrefillGasto } from './NuevoGastoModal';
import { ImportarExtractoModal } from './ImportarExtractoModal';
import { AplicarReglasModal } from './AplicarReglasModal';
import { VincularGastoModal } from './VincularGastoModal';
import { TransferenciaInternaModal } from './TransferenciaInternaModal';
import type { Gasto, MedioPago } from './types';

type TipoMov =
  | 'pago_de_gasto'
  | 'gasto_auto'
  | 'transferencia_interna'
  | 'ingreso_venta'
  | 'dividendo'
  | 'ignorado';

interface Movimiento {
  id: string;
  cuenta: string;
  fecha: string;
  descripcion: string | null;
  debito: number;
  credito: number;
  saldo: number | null;
  categoria: string | null;
  local: string | null;
  referencia: string | null;
  fuente: string | null;
  tipo: TipoMov | null;
  gasto_id: string | null;
  transferencia_par_id: string | null;
  sugerencia: string | null;
  gasto?: Pick<Gasto, 'id' | 'proveedor' | 'categoria' | 'importe_total' | 'fecha'> | null;
}

const TIPO_LABEL: Record<TipoMov, string> = {
  pago_de_gasto: 'Pago de gasto',
  gasto_auto: 'Gasto auto',
  transferencia_interna: 'Transf. interna',
  ingreso_venta: 'Ingreso venta',
  dividendo: 'Dividendo',
  ignorado: 'Ignorado',
};

const TIPO_COLOR: Record<TipoMov, string> = {
  pago_de_gasto: 'bg-blue-100 text-blue-800',
  gasto_auto: 'bg-purple-100 text-purple-800',
  transferencia_interna: 'bg-cyan-100 text-cyan-800',
  ingreso_venta: 'bg-green-100 text-green-800',
  dividendo: 'bg-amber-100 text-amber-800',
  ignorado: 'bg-gray-100 text-gray-600',
};

const CUENTA_LABEL: Record<string, string> = {
  mercadopago: 'MercadoPago',
  galicia: 'Galicia',
  icbc: 'ICBC',
};

// Mapeo cuenta bancaria → medio_pago default cuando se crea gasto desde mov.
const MEDIO_DESDE_CUENTA: Record<string, MedioPago> = {
  mercadopago: 'transferencia_mp',
  galicia: 'cheque_galicia',
  icbc: 'tarjeta_icbc',
};

interface Props {
  desde: string;
  hasta: string;
}

type FiltroEstado = 'pendiente' | 'clasificado' | 'todos';
type FiltroSigno = 'egresos' | 'ingresos' | 'todos';

export function MovimientosPanel({ desde, hasta }: Props) {
  const qc = useQueryClient();
  const [cuenta, setCuenta] = useState<string>('todas');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('pendiente');
  const [filtroSigno, setFiltroSigno] = useState<FiltroSigno>('egresos');
  const [busqueda, setBusqueda] = useState('');

  // Modales
  const [vincularMov, setVincularMov] = useState<Movimiento | null>(null);
  const [crearGastoPrefill, setCrearGastoPrefill] = useState<{
    mov: Movimiento;
    prefill: PrefillGasto;
  } | null>(null);
  const [transferenciaMov, setTransferenciaMov] = useState<Movimiento | null>(null);
  const [importarOpen, setImportarOpen] = useState(false);
  const [reglasOpen, setReglasOpen] = useState(false);

  const { data: movs, isLoading } = useQuery({
    queryKey: ['movimientos_bandeja', desde, hasta, cuenta, filtroEstado, filtroSigno],
    queryFn: async () => {
      let q = supabase
        .from('movimientos_bancarios')
        .select(
          'id, cuenta, fecha, descripcion, debito, credito, saldo, categoria, local, referencia, fuente, tipo, gasto_id, transferencia_par_id, sugerencia, gasto:gastos(id, proveedor, categoria, importe_total, fecha)',
        )
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: false })
        .limit(2000);
      if (cuenta !== 'todas') q = q.eq('cuenta', cuenta);
      if (filtroEstado === 'pendiente') q = q.is('tipo', null);
      else if (filtroEstado === 'clasificado') q = q.not('tipo', 'is', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Movimiento[];
    },
  });

  const filtrados = useMemo(() => {
    let lista = movs ?? [];
    if (filtroSigno === 'egresos') lista = lista.filter((m) => Number(m.debito) > 0);
    else if (filtroSigno === 'ingresos') lista = lista.filter((m) => Number(m.credito) > 0);
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      lista = lista.filter(
        (m) =>
          (m.descripcion ?? '').toLowerCase().includes(b) ||
          (m.referencia ?? '').toLowerCase().includes(b),
      );
    }
    return lista;
  }, [movs, filtroSigno, busqueda]);

  const totales = useMemo(() => {
    let pend = 0;
    let clasificados = 0;
    let totalEgreso = 0;
    let totalIngreso = 0;
    for (const m of movs ?? []) {
      if (m.tipo) clasificados++;
      else pend++;
      totalEgreso += Number(m.debito);
      totalIngreso += Number(m.credito);
    }
    return { pend, clasificados, totalEgreso, totalIngreso };
  }, [movs]);

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['movimientos_bandeja'] });
    qc.invalidateQueries({ queryKey: ['gastos_listado'] });
    qc.invalidateQueries({ queryKey: ['gastos_pagos_pendientes'] });
    qc.invalidateQueries({ queryKey: ['gastos_pagos_rango'] });
    qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
  }

  async function setTipo(mov: Movimiento, tipo: TipoMov | null) {
    const updates: Record<string, unknown> = { tipo };
    if (tipo === null) {
      updates.gasto_id = null;
      updates.transferencia_par_id = null;
    }
    const { error } = await supabase.from('movimientos_bancarios').update(updates).eq('id', mov.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    refrescar();
  }

  function abrirCrearGasto(mov: Movimiento) {
    const monto = Number(mov.debito) > 0 ? Number(mov.debito) : Number(mov.credito);
    const prefill: PrefillGasto = {
      fecha: mov.fecha,
      importe_total: monto,
      comentario: [mov.descripcion, mov.referencia].filter(Boolean).join(' · ') || null,
      medio_pago: MEDIO_DESDE_CUENTA[mov.cuenta] ?? 'transferencia_mp',
      estado_pago: 'pagado',
      fecha_pago: mov.fecha,
      // Pre-llena el N° con la referencia del mov: la conciliación queda
      // automática porque el mov ya queda vinculado abajo (`gasto_id`) y el
      // pago_gasto guarda el mismo N°.
      numero_operacion: mov.referencia ?? '',
    };
    setCrearGastoPrefill({ mov, prefill });
  }

  async function onGastoCreado(gastoId: string) {
    const mov = crearGastoPrefill?.mov;
    setCrearGastoPrefill(null);
    if (!mov) return;
    // Vincular el movimiento al gasto recién creado
    const { error } = await supabase
      .from('movimientos_bancarios')
      .update({ tipo: 'gasto_auto', gasto_id: gastoId })
      .eq('id', mov.id);
    if (error) {
      window.alert(`Gasto creado pero no se pudo vincular el movimiento: ${error.message}`);
      return;
    }
    // El pago_gasto ya lo creó NuevoGastoModal con el numero_operacion.
    // Sólo nos falta marcar el pago como conciliado contra este movimiento.
    await supabase
      .from('pagos_gastos')
      .update({ conciliado_movimiento_id: mov.id })
      .eq('gasto_id', gastoId);
    refrescar();
  }

  return (
    <div>
      {/* Toolbar superior */}
      <div className="mb-2 flex items-center justify-end gap-2">
        <button
          onClick={() => setReglasOpen(true)}
          className="rounded-md border border-rodziny-700 px-3 py-1.5 text-xs font-medium text-rodziny-700 hover:bg-rodziny-50"
          title="Generar gastos automáticos con las reglas configuradas"
        >
          🤖 Aplicar reglas
        </button>
        <button
          onClick={() => setImportarOpen(true)}
          className="rounded-md bg-rodziny-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800"
          title="Subir CSV de MercadoPago, Galicia o ICBC"
        >
          📥 Importar extracto
        </button>
      </div>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select
          value={cuenta}
          onChange={(e) => setCuenta(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs"
        >
          <option value="todas">Todas las cuentas</option>
          <option value="mercadopago">MercadoPago</option>
          <option value="galicia">Galicia</option>
          <option value="icbc">ICBC</option>
        </select>

        <div className="flex gap-1">
          {(['pendiente', 'clasificado', 'todos'] as FiltroEstado[]).map((s) => (
            <button
              key={s}
              onClick={() => setFiltroEstado(s)}
              className={cn(
                'rounded border px-2 py-1 text-xs',
                filtroEstado === s
                  ? 'border-rodziny-700 bg-rodziny-700 text-white'
                  : 'border-gray-300 bg-white text-gray-600',
              )}
            >
              {s === 'pendiente' ? 'Pendientes' : s === 'clasificado' ? 'Clasificados' : 'Todos'}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {(['egresos', 'ingresos', 'todos'] as FiltroSigno[]).map((s) => (
            <button
              key={s}
              onClick={() => setFiltroSigno(s)}
              className={cn(
                'rounded border px-2 py-1 text-xs',
                filtroSigno === s
                  ? 'border-gray-800 bg-gray-800 text-white'
                  : 'border-gray-300 bg-white text-gray-600',
              )}
            >
              {s === 'egresos' ? 'Egresos' : s === 'ingresos' ? 'Ingresos' : 'Todo'}
            </button>
          ))}
        </div>

        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar descripción o referencia..."
          className="min-w-[220px] flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs"
        />

        <span className="text-xs text-gray-400">
          {totales.pend} pendientes · {totales.clasificados} clasificados ·{' '}
          E:{formatARS(totales.totalEgreso)} I:{formatARS(totales.totalIngreso)}
        </span>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr className="uppercase text-gray-500">
                <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                <th className="px-3 py-2 text-left font-semibold">Cuenta</th>
                <th className="px-3 py-2 text-left font-semibold">Descripción</th>
                <th className="px-3 py-2 text-right font-semibold">Débito</th>
                <th className="px-3 py-2 text-right font-semibold">Crédito</th>
                <th className="px-3 py-2 text-center font-semibold">Tipo</th>
                <th className="px-3 py-2 text-left font-semibold">Vinculado a</th>
                <th className="px-3 py-2 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                    Cargando...
                  </td>
                </tr>
              )}
              {!isLoading && filtrados.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                    Sin movimientos en el rango y filtros actuales
                  </td>
                </tr>
              )}
              {filtrados.map((m) => {
                const esEgreso = Number(m.debito) > 0;
                return (
                  <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                      {formatFecha(m.fecha)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {CUENTA_LABEL[m.cuenta] ?? m.cuenta}
                    </td>
                    <td
                      className="max-w-[280px] px-3 py-2 text-gray-700"
                      title={`${m.descripcion ?? ''} · ${m.referencia ?? ''}`}
                    >
                      <div className="truncate">{m.descripcion || m.referencia || '—'}</div>
                      {m.sugerencia && !m.tipo && (
                        <div className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          💡 {m.sugerencia}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">
                      {Number(m.debito) > 0 ? formatARS(Number(m.debito)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700">
                      {Number(m.credito) > 0 ? formatARS(Number(m.credito)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {m.tipo ? (
                        <span
                          className={cn(
                            'inline-block rounded px-2 py-0.5 text-[10px] font-medium',
                            TIPO_COLOR[m.tipo],
                          )}
                        >
                          {TIPO_LABEL[m.tipo]}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">pendiente</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {m.gasto ? (
                        <span title={`Gasto ${m.gasto.id}`}>
                          {m.gasto.proveedor ?? 's/proveedor'} · {formatARS(m.gasto.importe_total)}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {m.tipo ? (
                        <button
                          onClick={() => setTipo(m, null)}
                          className="text-[10px] text-gray-500 hover:text-red-600 hover:underline"
                          title="Devolver a pendiente"
                        >
                          Resetear
                        </button>
                      ) : esEgreso ? (
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            onClick={() => setVincularMov(m)}
                            className="rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700"
                            title="Vincular este movimiento a un gasto que ya cargaste"
                          >
                            Vincular gasto
                          </button>
                          <button
                            onClick={() => abrirCrearGasto(m)}
                            className="rounded bg-purple-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-purple-700"
                            title="Crear un gasto nuevo desde este movimiento (sin factura previa)"
                          >
                            Crear gasto
                          </button>
                          <button
                            onClick={() => setTransferenciaMov(m)}
                            className="rounded bg-cyan-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan-700"
                            title="Transferencia entre cuentas propias"
                          >
                            Transf. interna
                          </button>
                          <button
                            onClick={() => setTipo(m, 'ignorado')}
                            className="rounded border border-gray-300 px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-50"
                          >
                            Ignorar
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            onClick={() => setTipo(m, 'ingreso_venta')}
                            className="rounded bg-green-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-green-700"
                          >
                            Ingreso venta
                          </button>
                          <button
                            onClick={() => setTransferenciaMov(m)}
                            className="rounded bg-cyan-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan-700"
                          >
                            Transf. interna
                          </button>
                          <button
                            onClick={() => setTipo(m, 'ignorado')}
                            className="rounded border border-gray-300 px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-50"
                          >
                            Ignorar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Vincular a gasto existente */}
      {vincularMov && (
        <VincularGastoModal
          movimiento={vincularMov}
          onClose={() => setVincularMov(null)}
          onVinculado={refrescar}
        />
      )}

      {/* Modal: Transferencia interna con auto-match */}
      {transferenciaMov && (
        <TransferenciaInternaModal
          movimiento={transferenciaMov}
          onClose={() => setTransferenciaMov(null)}
          onConfirmado={refrescar}
        />
      )}

      {/* Modal: Crear gasto desde movimiento (reusa NuevoGastoModal con prefill) */}
      {crearGastoPrefill && (
        <NuevoGastoModal
          open
          onClose={() => setCrearGastoPrefill(null)}
          prefill={crearGastoPrefill.prefill}
          onSaved={onGastoCreado}
        />
      )}

      {/* Modal: Importar extracto bancario. Tras el upsert + matcher por ID,
          encadenamos AplicarReglasModal para limpiar gastos ocultos
          (impuestos / comisiones) que no matchean por ID. */}
      <ImportarExtractoModal
        open={importarOpen}
        onClose={() => setImportarOpen(false)}
        onSuccess={() => {
          refrescar();
          setImportarOpen(false);
          setReglasOpen(true);
        }}
      />

      {/* Modal: Aplicar reglas automáticas */}
      <AplicarReglasModal
        open={reglasOpen}
        onClose={() => setReglasOpen(false)}
        onSuccess={refrescar}
      />
    </div>
  );
}

