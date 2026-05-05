import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import { NuevoGastoModal, type PrefillGasto } from './NuevoGastoModal';
import { ImportarExtractoModal } from './ImportarExtractoModal';
import { AplicarReglasModal } from './AplicarReglasModal';
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

// ─────────────────────────────────────────────────────────────────────────────
// Modal: Vincular movimiento a gasto existente
// ─────────────────────────────────────────────────────────────────────────────

interface PagoExistente {
  id: string;
  conciliado_movimiento_id: string | null;
  monto: number;
  fecha_pago: string;
}

interface GastoCandidato extends Gasto {
  pagos?: PagoExistente[];
}

function VincularGastoModal({
  movimiento,
  onClose,
  onVinculado,
}: {
  movimiento: Movimiento;
  onClose: () => void;
  onVinculado: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [guardando, setGuardando] = useState(false);
  const monto = Number(movimiento.debito) > 0 ? Number(movimiento.debito) : Number(movimiento.credito);

  // Buscar candidatos con monto similar (±20%) y fecha dentro de 60 días previos:
  //   1) Gastos pendientes de pago (caso clásico: factura cargada antes del débito).
  //   2) Gastos ya pagados pero con pagos_gastos SIN conciliar a un movimiento bancario
  //      (caso ChecklistPagos: el pago se marcó pagado en la checklist, ahora aparece
  //      el débito real en el extracto y necesitamos reconciliarlo, NO duplicar).
  const { data: candidatos, isLoading } = useQuery({
    queryKey: ['vincular_gasto_candidatos', movimiento.id],
    queryFn: async () => {
      const tolerancia = monto * 0.2;
      const desdeFecha = new Date(movimiento.fecha + 'T12:00:00Z');
      desdeFecha.setUTCDate(desdeFecha.getUTCDate() - 60);
      const { data, error } = await supabase
        .from('gastos')
        .select(
          'id, fecha, proveedor, categoria, importe_total, estado_pago, local, pagos:pagos_gastos(id, conciliado_movimiento_id, monto, fecha_pago)',
        )
        .neq('cancelado', true)
        .gte('importe_total', monto - tolerancia)
        .lte('importe_total', monto + tolerancia)
        .gte('fecha', desdeFecha.toISOString().split('T')[0])
        .lte('fecha', movimiento.fecha)
        .order('fecha', { ascending: false })
        .limit(100);
      if (error) throw error;
      // Excluir pagados que ya están todos conciliados — no aportan al modal
      const lista = (data ?? []) as unknown as GastoCandidato[];
      return lista.filter((g) => {
        if (g.estado_pago !== 'Pagado') return true;
        return (g.pagos ?? []).some((p) => p.conciliado_movimiento_id === null);
      });
    },
  });

  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return candidatos ?? [];
    const b = busqueda.toLowerCase();
    return (candidatos ?? []).filter(
      (g) =>
        (g.proveedor ?? '').toLowerCase().includes(b) ||
        (g.categoria ?? '').toLowerCase().includes(b),
    );
  }, [candidatos, busqueda]);

  async function vincular(gasto: GastoCandidato) {
    if (guardando) return;
    setGuardando(true);
    try {
      // 1. Marcar el movimiento como pago_de_gasto vinculado al gasto
      const { error: e1 } = await supabase
        .from('movimientos_bancarios')
        .update({ tipo: 'pago_de_gasto', gasto_id: gasto.id })
        .eq('id', movimiento.id);
      if (e1) throw e1;

      // 2. Decidir: reconciliar pago existente o registrar pago nuevo
      const pagosSinConciliar = (gasto.pagos ?? []).filter(
        (p) => p.conciliado_movimiento_id === null,
      );

      if (pagosSinConciliar.length > 0) {
        // Reconciliación: el gasto ya está pagado (típicamente desde ChecklistPagos).
        // Buscar el pago cuyo monto más se acerque al del movimiento; vincular sin
        // crear pago nuevo (evita duplicar el egreso en Flujo de Caja).
        const tol = monto * 0.2;
        const pagoTarget =
          pagosSinConciliar.find((p) => Math.abs(Number(p.monto) - monto) <= tol) ??
          pagosSinConciliar[0];
        const { error } = await supabase
          .from('pagos_gastos')
          .update({ conciliado_movimiento_id: movimiento.id })
          .eq('id', pagoTarget.id);
        if (error) throw error;
      } else {
        // Pago nuevo: el gasto era Pendiente, lo marcamos pagado e insertamos pago_gasto.
        const { error: e2 } = await supabase
          .from('gastos')
          .update({ estado_pago: 'Pagado' })
          .eq('id', gasto.id);
        if (e2) throw e2;
        const { error: e3 } = await supabase.from('pagos_gastos').insert({
          gasto_id: gasto.id,
          fecha_pago: movimiento.fecha,
          monto: monto,
          medio_pago: MEDIO_DESDE_CUENTA[movimiento.cuenta] ?? 'transferencia_mp',
          referencia: movimiento.referencia,
          conciliado_movimiento_id: movimiento.id,
        });
        if (e3) throw e3;
      }

      onVinculado();
      onClose();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800">Vincular movimiento a gasto</h3>
          <p className="mt-1 text-xs text-gray-500">
            {formatFecha(movimiento.fecha)} · {CUENTA_LABEL[movimiento.cuenta] ?? movimiento.cuenta} ·{' '}
            <span className="font-semibold">{formatARS(monto)}</span>
            <span className="ml-1 text-gray-400">— {movimiento.descripcion ?? '—'}</span>
          </p>
          <p className="mt-1 text-[11px] text-gray-400">
            Mostramos gastos <span className="font-medium text-gray-600">pendientes</span> con monto
            similar (±20%) en los últimos 60 días, y pagos ya marcados como pagados (ej. desde Pagos
            fijos) que aún no se vincularon a este débito —{' '}
            <span className="font-medium text-amber-700">reconciliar evita duplicar el egreso</span>
            .
          </p>
        </div>
        <input
          autoFocus
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Filtrar por proveedor o categoría..."
          className="mb-3 w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <div className="overflow-hidden rounded border border-gray-200">
          <table className="w-full text-xs">
            <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-left">Categoría</th>
                <th className="px-3 py-2 text-center">Estado</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                    Buscando...
                  </td>
                </tr>
              )}
              {!isLoading && filtrados.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                    No hay gastos compatibles con monto similar.
                    <br />
                    Probá "Crear gasto" en su lugar.
                  </td>
                </tr>
              )}
              {filtrados.map((g) => {
                const yaPagado = g.estado_pago === 'Pagado';
                return (
                  <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                      {formatFecha(g.fecha)}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">{g.proveedor || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{g.categoria || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {yaPagado ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          Pagado · sin conciliar
                        </span>
                      ) : (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                      {formatARS(g.importe_total)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        disabled={guardando}
                        onClick={() => vincular(g)}
                        className="rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        title={yaPagado ? 'Reconciliar pago existente con este movimiento' : 'Marcar como pagado y vincular'}
                      >
                        {yaPagado ? 'Reconciliar' : 'Vincular'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal: Marcar como transferencia interna con auto-match del gemelo
// ─────────────────────────────────────────────────────────────────────────────

function TransferenciaInternaModal({
  movimiento,
  onClose,
  onConfirmado,
}: {
  movimiento: Movimiento;
  onClose: () => void;
  onConfirmado: () => void;
}) {
  const monto =
    Number(movimiento.debito) > 0 ? Number(movimiento.debito) : Number(movimiento.credito);
  const esEgreso = Number(movimiento.debito) > 0;
  const [guardando, setGuardando] = useState(false);

  // Buscar gemelos: en otra cuenta, signo opuesto, monto igual, ±2 días, sin par
  const { data: gemelos, isLoading } = useQuery({
    queryKey: ['transf_gemelos', movimiento.id],
    queryFn: async () => {
      const fmin = new Date(movimiento.fecha + 'T12:00:00Z');
      fmin.setUTCDate(fmin.getUTCDate() - 2);
      const fmax = new Date(movimiento.fecha + 'T12:00:00Z');
      fmax.setUTCDate(fmax.getUTCDate() + 2);
      let q = supabase
        .from('movimientos_bancarios')
        .select(
          'id, cuenta, fecha, descripcion, debito, credito, saldo, categoria, local, referencia, fuente, tipo, gasto_id, transferencia_par_id',
        )
        .neq('cuenta', movimiento.cuenta)
        .neq('id', movimiento.id)
        .is('transferencia_par_id', null)
        .gte('fecha', fmin.toISOString().split('T')[0])
        .lte('fecha', fmax.toISOString().split('T')[0])
        .or(`tipo.is.null,tipo.eq.transferencia_interna`);
      if (esEgreso) q = q.eq('credito', monto).eq('debito', 0);
      else q = q.eq('debito', monto).eq('credito', 0);
      const { data, error } = await q.limit(20);
      if (error) throw error;
      return (data ?? []) as Movimiento[];
    },
  });

  async function emparejar(gemelo: Movimiento | null) {
    if (guardando) return;
    setGuardando(true);
    try {
      if (gemelo) {
        // Empareja ambos
        const { error: e1 } = await supabase
          .from('movimientos_bancarios')
          .update({ tipo: 'transferencia_interna', transferencia_par_id: gemelo.id })
          .eq('id', movimiento.id);
        if (e1) throw e1;
        const { error: e2 } = await supabase
          .from('movimientos_bancarios')
          .update({ tipo: 'transferencia_interna', transferencia_par_id: movimiento.id })
          .eq('id', gemelo.id);
        if (e2) throw e2;
      } else {
        // Solo este lado, queda esperando que aparezca el gemelo
        const { error } = await supabase
          .from('movimientos_bancarios')
          .update({ tipo: 'transferencia_interna' })
          .eq('id', movimiento.id);
        if (error) throw error;
      }
      onConfirmado();
      onClose();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800">Transferencia interna</h3>
          <p className="mt-1 text-xs text-gray-500">
            {esEgreso ? 'Sale' : 'Entra'} {formatARS(monto)} de{' '}
            {CUENTA_LABEL[movimiento.cuenta] ?? movimiento.cuenta} el{' '}
            {formatFecha(movimiento.fecha)}
          </p>
          <p className="mt-2 text-[11px] text-gray-500">
            Buscamos el gemelo en otra cuenta (mismo monto, ±2 días). Al emparejar, ninguno de los
            dos cuenta como egreso/ingreso del flujo.
          </p>
        </div>

        {isLoading ? (
          <div className="py-6 text-center text-xs text-gray-400">Buscando gemelos...</div>
        ) : (gemelos ?? []).length === 0 ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            No encontramos gemelo en las otras cuentas dentro de ±2 días. Puede ser que el otro
            extracto aún no se importó. Si querés podés marcarlo como transferencia interna sólo
            por este lado y emparejarlo cuando importes el otro.
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-gray-200">
            <table className="w-full text-xs">
              <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Cuenta</th>
                  <th className="px-3 py-2 text-left">Descripción</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(gemelos ?? []).map((g) => (
                  <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                      {formatFecha(g.fecha)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {CUENTA_LABEL[g.cuenta] ?? g.cuenta}
                    </td>
                    <td
                      className="max-w-[220px] truncate px-3 py-2 text-gray-700"
                      title={g.descripcion ?? ''}
                    >
                      {g.descripcion ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                      {formatARS(Number(g.debito) > 0 ? Number(g.debito) : Number(g.credito))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        disabled={guardando}
                        onClick={() => emparejar(g)}
                        className="rounded bg-cyan-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
                      >
                        Emparejar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            disabled={guardando}
            onClick={() => emparejar(null)}
            className="rounded border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs text-cyan-800 hover:bg-cyan-100 disabled:opacity-50"
          >
            Marcar solo este lado
          </button>
        </div>
      </div>
    </div>
  );
}
