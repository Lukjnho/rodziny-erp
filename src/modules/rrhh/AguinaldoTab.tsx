import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, cn } from '@/lib/utils';
import { KPICard } from '@/components/ui/KPICard';
import type { Empleado } from './RRHHPage';
import { parseYmd, ymd, normalizarTexto, remuneracionConPresentismo } from './utils';
import { medioRequiereComprobante } from '../gastos/types';

// ── Tipos ────────────────────────────────────────────────────────────────────
type MedioPagoGasto =
  | 'transferencia_mp'
  | 'transferencia_galicia'
  | 'transferencia_icbc'
  | 'efectivo'
  | 'debito_mp'
  | 'debito_galicia'
  | 'debito_icbc';

const MEDIO_PAGO_OPCIONES: { value: MedioPagoGasto; label: string }[] = [
  { value: 'transferencia_mp', label: 'Transferencia MP' },
  { value: 'transferencia_galicia', label: 'Transferencia Galicia' },
  { value: 'transferencia_icbc', label: 'Transferencia ICBC' },
  { value: 'efectivo', label: 'Efectivo' },
];

interface Aguinaldo {
  id: string;
  empleado_id: string;
  anio: number;
  semestre: number;
  mejor_sueldo: number;
  dias_trabajados: number;
  monto_calculado: number;
  monto_pagado: number | null;
  pagado: boolean;
  fecha_pago: string | null;
  medio_pago: MedioPagoGasto | null;
  gasto_id: string | null;
  notas: string | null;
}

interface FilaAguinaldo {
  empleado: Empleado;
  sueldoLegajo: number;
  diasTrabajados: number;
  montoCalculado: number;
  registro: Aguinaldo | null;
}

// ── Constantes legales (LCT art. 121) ───────────────────────────────────────
const DIAS_SEMESTRE_LCT = 180;

// ── Helpers ─────────────────────────────────────────────────────────────────
function rangoDelSemestre(año: number, sem: number): { inicio: Date; fin: Date } {
  const inicio = sem === 1 ? new Date(año, 0, 1) : new Date(año, 6, 1);
  const fin = sem === 1 ? new Date(año, 5, 30) : new Date(año, 11, 31);
  return { inicio, fin };
}

function diasTrabajadosEnSemestre(fechaIngreso: string, año: number, sem: number): number {
  const { inicio, fin } = rangoDelSemestre(año, sem);
  const ing = parseYmd(fechaIngreso);
  if (ing > fin) return 0;
  if (ing <= inicio) return DIAS_SEMESTRE_LCT;
  // Proporcional: días entre ingreso y fin de semestre, capeado a 180 (LCT)
  const diasReales = Math.round((fin.getTime() - ing.getTime()) / 86400000) + 1;
  return Math.min(diasReales, DIAS_SEMESTRE_LCT);
}

function vencimiento(año: number, sem: number): Date {
  return sem === 1 ? new Date(año, 5, 30) : new Date(año, 11, 18);
}

function diasAlVencimiento(año: number, sem: number): number {
  const v = vencimiento(año, sem);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((v.getTime() - hoy.getTime()) / 86400000);
}

function periodoDePago(fechaPago: string): string {
  // Devuelve 'YYYY-MM' a partir de un 'YYYY-MM-DD'
  return fechaPago.slice(0, 7);
}

// ── Componente principal ────────────────────────────────────────────────────
export function AguinaldoTab() {
  const qc = useQueryClient();
  const hoy = new Date();
  const [año, setAño] = useState(hoy.getFullYear());
  const [semestre, setSemestre] = useState<1 | 2>(hoy.getMonth() < 6 ? 1 : 2);
  const [filtroLocal, setFiltroLocal] = useState<'todos' | 'vedia' | 'saavedra'>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [modalFila, setModalFila] = useState<FilaAguinaldo | null>(null);

  const { data: empleados } = useQuery({
    // Trae TODOS (incl. bajas: pueden tener aguinaldo pendiente). Key propia para no
    // chocar con los tabs que filtran solo activos.
    queryKey: ['empleados', 'todos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('empleados').select('*').order('apellido');
      if (error) throw error;
      return data as Empleado[];
    },
  });

  const { data: aguinaldos } = useQuery({
    queryKey: ['aguinaldos', año, semestre],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('aguinaldos')
        .select('*')
        .eq('anio', año)
        .eq('semestre', semestre);
      if (error) throw error;
      return data as Aguinaldo[];
    },
  });

  // Categoría 'Aguinaldo' (subcategoría dentro de 'Gastos de RRHH').
  // Sembrada en migración 003.
  const { data: categoriaAguinaldo } = useQuery({
    queryKey: ['categoria_aguinaldo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categorias_gasto')
        .select('id')
        .eq('nombre', 'Aguinaldo')
        .not('parent_id', 'is', null)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string } | null)?.id ?? null;
    },
  });

  const eliminar = useMutation({
    mutationFn: async (registro: Aguinaldo) => {
      // Si tenía gasto vinculado, lo cancelamos también
      if (registro.gasto_id) {
        await supabase.from('gastos').update({ cancelado: true }).eq('id', registro.gasto_id);
      }
      const { error } = await supabase.from('aguinaldos').delete().eq('id', registro.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aguinaldos'] });
      qc.invalidateQueries({ queryKey: ['gastos'] });
    },
    onError: (e: Error) => window.alert(`Error: ${e.message}`),
  });

  const cargando = !empleados || !aguinaldos;

  const filas = useMemo<FilaAguinaldo[]>(() => {
    if (!empleados || !aguinaldos) return [];
    const activos = empleados.filter((e) => e.activo && e.estado_laboral !== 'baja');
    const filtrados = activos.filter((e) => {
      if (filtroLocal === 'vedia' && e.local !== 'vedia') return false;
      if (filtroLocal === 'saavedra' && e.local !== 'saavedra') return false;
      if (busqueda.trim()) {
        const q = normalizarTexto(busqueda);
        const txt = normalizarTexto(`${e.nombre} ${e.apellido} ${e.dni ?? ''}`);
        if (!txt.includes(q)) return false;
      }
      return true;
    });

    return filtrados
      .map((emp) => {
        // sueldo_neto en el legajo es el base SIN presentismo; la mejor remuneración
        // del semestre (base del SAC) incluye el presentismo +10%.
        const sueldoLegajo = remuneracionConPresentismo(Number(emp.sueldo_neto || 0));
        const diasTrab = diasTrabajadosEnSemestre(emp.fecha_ingreso, año, semestre);
        // Fórmula LCT art. 121 simplificada: (sueldo del legajo / 2) × (días / 180)
        const montoCalculado =
          sueldoLegajo > 0 ? (sueldoLegajo / 2) * (diasTrab / DIAS_SEMESTRE_LCT) : 0;
        const registro = aguinaldos.find((a) => a.empleado_id === emp.id) || null;
        return {
          empleado: emp,
          sueldoLegajo,
          diasTrabajados: diasTrab,
          montoCalculado,
          registro,
        };
      })
      .sort((a, b) => b.montoCalculado - a.montoCalculado);
  }, [empleados, aguinaldos, año, semestre, filtroLocal, busqueda]);

  const kpis = useMemo(() => {
    const con = filas.filter((f) => f.montoCalculado > 0);
    const total = con.reduce((s, f) => s + f.montoCalculado, 0);
    const pagado = filas
      .filter((f) => f.registro?.pagado)
      .reduce((s, f) => s + (f.registro?.monto_pagado ?? f.montoCalculado), 0);
    const pendientes = con.length - filas.filter((f) => f.registro?.pagado).length;
    return {
      total,
      pagado,
      pendientes,
      diasVenc: diasAlVencimiento(año, semestre),
      elegibles: con.length,
    };
  }, [filas, año, semestre]);

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KPICard label="Elegibles" value={String(kpis.elegibles)} color="blue" loading={cargando} />
        <KPICard
          label="Total a pagar"
          value={formatARS(kpis.total)}
          color="neutral"
          loading={cargando}
        />
        <KPICard
          label="Ya pagado"
          value={formatARS(kpis.pagado)}
          color="green"
          loading={cargando}
        />
        <KPICard
          label="Pendientes"
          value={String(kpis.pendientes)}
          color={kpis.pendientes > 0 ? 'yellow' : 'green'}
          loading={cargando}
        />
        <KPICard
          label={`Vence ${semestre === 1 ? '30/06' : '18/12'}`}
          value={
            kpis.diasVenc > 0 ? `${kpis.diasVenc} días` : kpis.diasVenc === 0 ? 'hoy' : 'vencido'
          }
          color={kpis.diasVenc < 0 ? 'red' : kpis.diasVenc <= 15 ? 'yellow' : 'neutral'}
          loading={cargando}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-white p-3">
        <input
          type="text"
          placeholder="Buscar empleado..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="min-w-[200px] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select
          value={año}
          onChange={(e) => setAño(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          {[hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>
              Año {y}
            </option>
          ))}
        </select>
        <div className="flex items-center overflow-hidden rounded-md border border-gray-300">
          <button
            onClick={() => setSemestre(1)}
            className={cn(
              'px-3 py-1.5 text-sm',
              semestre === 1 ? 'bg-rodziny-600 text-white' : 'text-gray-600 hover:bg-gray-50',
            )}
          >
            1° (ene–jun)
          </button>
          <button
            onClick={() => setSemestre(2)}
            className={cn(
              'border-l border-gray-300 px-3 py-1.5 text-sm',
              semestre === 2 ? 'bg-rodziny-600 text-white' : 'text-gray-600 hover:bg-gray-50',
            )}
          >
            2° (jul–dic)
          </button>
        </div>
        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as any)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Empleado</th>
              <th className="px-2 py-2 text-right">Sueldo legajo</th>
              <th className="px-2 py-2 text-center">Días trabajados</th>
              <th className="px-2 py-2 text-right">SAC teórico</th>
              <th className="px-2 py-2 text-center">Estado</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!cargando && filas.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
                  Sin empleados
                </td>
              </tr>
            )}
            {!cargando &&
              filas.map((f) => {
                const pagado = !!f.registro?.pagado;
                const sinDatos = f.montoCalculado === 0;
                return (
                  <tr
                    key={f.empleado.id}
                    className={cn(
                      'border-t border-gray-100 hover:bg-gray-50',
                      sinDatos && 'opacity-40',
                    )}
                  >
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">
                        {f.empleado.apellido}, {f.empleado.nombre}
                      </div>
                      <div className="text-[11px] capitalize text-gray-400">
                        {f.empleado.puesto} · {f.empleado.local}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right text-gray-700">
                      {f.sueldoLegajo > 0 ? formatARS(f.sueldoLegajo) : '—'}
                    </td>
                    <td className="px-2 py-2 text-center text-xs text-gray-500">
                      {f.diasTrabajados} / {DIAS_SEMESTRE_LCT}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold text-gray-900">
                      {sinDatos ? '—' : formatARS(f.montoCalculado)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {pagado ? (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                          ✓ Pagado
                        </span>
                      ) : sinDatos ? (
                        <span className="text-[10px] text-gray-400">sin sueldo en legajo</span>
                      ) : (
                        <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="space-x-1 whitespace-nowrap px-4 py-2 text-right">
                      {!sinDatos && (
                        <button
                          onClick={() => setModalFila(f)}
                          className="rounded bg-rodziny-600 px-2 py-1 text-[10px] text-white hover:bg-rodziny-700"
                        >
                          {pagado ? 'Editar' : 'Marcar pagado'}
                        </button>
                      )}
                      {f.registro && (
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                f.registro!.gasto_id
                                  ? '¿Borrar el registro? El gasto asociado se cancelará.'
                                  : '¿Borrar el registro de aguinaldo?',
                              )
                            )
                              eliminar.mutate(f.registro!);
                          }}
                          className="text-[10px] text-red-500 hover:text-red-700"
                        >
                          Borrar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
          {!cargando && filas.some((f) => f.montoCalculado > 0) && (
            <tfoot className="bg-gray-50 text-sm">
              <tr className="border-t border-gray-200">
                <td colSpan={3} className="px-4 py-2 text-right font-semibold text-gray-700">
                  TOTAL
                </td>
                <td className="px-2 py-2 text-right font-bold text-rodziny-700">
                  {formatARS(kpis.total)}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {modalFila && (
        <ModalAguinaldo
          fila={modalFila}
          año={año}
          semestre={semestre}
          categoriaAguinaldoId={categoriaAguinaldo ?? null}
          onClose={() => setModalFila(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['aguinaldos'] });
            qc.invalidateQueries({ queryKey: ['gastos'] });
            setModalFila(null);
          }}
        />
      )}
    </div>
  );
}

// ── Modal de edición ─────────────────────────────────────────────────────────
function ModalAguinaldo({
  fila,
  año,
  semestre,
  categoriaAguinaldoId,
  onClose,
  onSaved,
}: {
  fila: FilaAguinaldo;
  año: number;
  semestre: number;
  categoriaAguinaldoId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const r = fila.registro;
  const [montoPagado, setMontoPagado] = useState(r?.monto_pagado ?? fila.montoCalculado);
  const [pagado, setPagado] = useState(r?.pagado ?? true); // default true: abrir el modal ya implica querer marcar
  const [fechaPago, setFechaPago] = useState(r?.fecha_pago ?? ymd(new Date()));
  const [medioPago, setMedioPago] = useState<MedioPagoGasto>(
    (r?.medio_pago as MedioPagoGasto) ?? 'transferencia_mp',
  );
  const [notas, setNotas] = useState(r?.notas ?? '');
  const [numeroOperacion, setNumeroOperacion] = useState('');
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [comprobantePath, setComprobantePath] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El N° de operación vive en pagos_gastos y el comprobante en gastos.comprobante_path;
  // el registro de aguinaldo no los guarda, así que los traemos del gasto vinculado
  // para poder prefilllearlos al editar un aguinaldo ya pagado.
  const { data: pagoExistente } = useQuery({
    queryKey: ['aguinaldo_pago', r?.gasto_id ?? null],
    enabled: !!r?.gasto_id,
    queryFn: async () => {
      const gid = r!.gasto_id!;
      const [{ data: g }, { data: p }] = await Promise.all([
        supabase.from('gastos').select('comprobante_path').eq('id', gid).maybeSingle(),
        supabase
          .from('pagos_gastos')
          .select('id, numero_operacion')
          .eq('gasto_id', gid)
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        comprobante_path: (g as { comprobante_path: string | null } | null)?.comprobante_path ?? null,
        pago: p as { id: string; numero_operacion: string | null } | null,
      };
    },
  });

  useEffect(() => {
    if (!pagoExistente) return;
    setComprobantePath(pagoExistente.comprobante_path);
    if (pagoExistente.pago?.numero_operacion) setNumeroOperacion(pagoExistente.pago.numero_operacion);
  }, [pagoExistente]);

  const bancarizado = medioRequiereComprobante(medioPago);

  async function guardar() {
    setError(null);

    // Regla del comprobante bancarizado: transferencia/cheque exigen N° de operación
    // + comprobante para poder conciliar 1:1 con el extracto. Efectivo queda exento.
    if (pagado && bancarizado) {
      if (!numeroOperacion.trim()) {
        setError(
          'N° de operación requerido para transferencias. Es lo que permite conciliar el pago con el extracto del banco. Para pagos en efectivo, cambiá el medio de pago.',
        );
        return;
      }
      if (!comprobante && !comprobantePath) {
        setError('Comprobante de pago obligatorio para transferencias. Subí la captura o PDF.');
        return;
      }
    }

    setGuardando(true);
    try {
      let gastoIdFinal: string | null = r?.gasto_id ?? null;

      // Subir el comprobante nuevo si hay uno (mismo bucket que el resto de gastos).
      let pathComprobante = comprobantePath;
      if (comprobante) {
        const ext = comprobante.name.split('.').pop()?.toLowerCase() || 'pdf';
        const path = `aguinaldos/${fechaPago.substring(0, 7)}/${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`;
        const { error: errUp } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(path, comprobante, {
            contentType: comprobante.type || 'application/octet-stream',
          });
        if (errUp) throw errUp;
        pathComprobante = path;
      }

      // ── Sincronizar gasto en Finanzas ────────────────────────────────────
      if (pagado) {
        if (!categoriaAguinaldoId) {
          throw new Error("No se encontró la categoría 'Aguinaldo' en categorías_gasto.");
        }
        const periodoGasto = periodoDePago(fechaPago);
        const proveedorTxt = `${fila.empleado.apellido}, ${fila.empleado.nombre}`;
        const comentarioTxt = `Aguinaldo ${semestre}° sem ${año} · ${proveedorTxt}`;
        const payloadGasto = {
          local: null as string | null, // 'Ambos' / empresa
          fecha: fechaPago,
          importe_total: montoPagado,
          importe_neto: montoPagado,
          iva: 0,
          iibb: 0,
          proveedor: proveedorTxt,
          categoria: 'Aguinaldo',
          subcategoria: 'Aguinaldo',
          categoria_id: categoriaAguinaldoId,
          estado_pago: 'Pagado',
          medio_pago: medioPago,
          comprobante_path: pathComprobante,
          comentario: comentarioTxt,
          creado_manual: true,
          cancelado: false,
          periodo: periodoGasto,
        };

        if (gastoIdFinal) {
          // Actualizar gasto existente
          const { error: errUpd } = await supabase
            .from('gastos')
            .update(payloadGasto)
            .eq('id', gastoIdFinal);
          if (errUpd) throw errUpd;
        } else {
          // Crear gasto nuevo
          const { data: nuevo, error: errIns } = await supabase
            .from('gastos')
            .insert(payloadGasto)
            .select('id')
            .single();
          if (errIns) throw errIns;
          gastoIdFinal = (nuevo as { id: string }).id;
        }

        // ── Pago en pagos_gastos ───────────────────────────────────────────
        // Es lo que la conciliación matchea contra el extracto (por numero_operacion).
        // Sin esto, el gasto de aguinaldo queda flotando y no se puede conciliar.
        const pagoRow = {
          gasto_id: gastoIdFinal,
          fecha_pago: fechaPago,
          monto: montoPagado,
          medio_pago: medioPago,
          numero_operacion: numeroOperacion.trim() || null,
        };
        const pagoIdExist = pagoExistente?.pago?.id ?? null;
        if (pagoIdExist) {
          const { error: errPago } = await supabase
            .from('pagos_gastos')
            .update(pagoRow)
            .eq('id', pagoIdExist);
          if (errPago) throw errPago;
        } else {
          const { error: errPago } = await supabase.from('pagos_gastos').insert(pagoRow);
          if (errPago) throw errPago;
        }
      } else if (gastoIdFinal) {
        // Se desmarca pagado → cancelar gasto vinculado (no lo borramos para mantener
        // historial) y quitar su pago para que no aparezca como conciliable.
        const { error: errCancel } = await supabase
          .from('gastos')
          .update({ cancelado: true })
          .eq('id', gastoIdFinal);
        if (errCancel) throw errCancel;
        await supabase.from('pagos_gastos').delete().eq('gasto_id', gastoIdFinal);
        gastoIdFinal = null;
      }

      // ── Upsert del aguinaldo ─────────────────────────────────────────────
      const { error: errAg } = await supabase.from('aguinaldos').upsert(
        {
          empleado_id: fila.empleado.id,
          anio: año,
          semestre,
          mejor_sueldo: fila.sueldoLegajo,
          dias_trabajados: fila.diasTrabajados,
          monto_calculado: fila.montoCalculado,
          monto_pagado: pagado ? montoPagado : null,
          pagado,
          fecha_pago: pagado ? fechaPago : null,
          medio_pago: pagado ? medioPago : null,
          gasto_id: gastoIdFinal,
          notas: notas || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'empleado_id,anio,semestre' },
      );
      if (errAg) throw errAg;

      onSaved();
    } catch (e: any) {
      setError(e.message || 'Error al guardar.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="font-semibold text-gray-900">
            Aguinaldo {semestre === 1 ? '1° semestre' : '2° semestre'} {año}
          </h3>
          <div className="text-xs text-gray-500">
            {fila.empleado.apellido}, {fila.empleado.nombre}
          </div>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div className="space-y-1 rounded bg-gray-50 p-3 text-xs text-gray-600">
            <div>
              Sueldo del legajo:{' '}
              <span className="font-semibold text-gray-900">{formatARS(fila.sueldoLegajo)}</span>
            </div>
            <div>
              Días trabajados:{' '}
              <span className="font-semibold text-gray-900">
                {fila.diasTrabajados} / {DIAS_SEMESTRE_LCT}
              </span>
            </div>
            <div>
              SAC teórico:{' '}
              <span className="font-semibold text-rodziny-700">
                {formatARS(fila.montoCalculado)}
              </span>
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={pagado}
                onChange={(e) => setPagado(e.target.checked)}
                className="h-4 w-4"
              />
              Pagado{' '}
              <span className="text-[11px] text-gray-400">
                (al guardar crea un gasto en Finanzas)
              </span>
            </label>
          </div>
          {pagado && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Monto real pagado
                </label>
                <input
                  type="number"
                  value={montoPagado}
                  onChange={(e) => setMontoPagado(Number(e.target.value))}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Medio de pago
                </label>
                <select
                  value={medioPago}
                  onChange={(e) => setMedioPago(e.target.value as MedioPagoGasto)}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                >
                  {MEDIO_PAGO_OPCIONES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Fecha de pago
                </label>
                <input
                  type="date"
                  value={fechaPago}
                  onChange={(e) => setFechaPago(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              {bancarizado && (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      N° de operación <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={numeroOperacion}
                      onChange={(e) => setNumeroOperacion(e.target.value)}
                      placeholder="N° de la transferencia (para conciliar)"
                      className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      Comprobante de pago <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
                      className="w-full text-xs text-gray-600 file:mr-2 file:rounded file:border-0 file:bg-rodziny-50 file:px-2 file:py-1 file:text-rodziny-700"
                    />
                    {comprobantePath && !comprobante && (
                      <p className="mt-1 text-[11px] text-green-600">
                        ✓ Ya hay un comprobante cargado. Subí uno nuevo solo si querés reemplazarlo.
                      </p>
                    )}
                  </div>
                </>
              )}
            </>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Notas</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
          {error && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          {r?.gasto_id && (
            <div className="rounded bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
              Hay un gasto vinculado en Finanzas — se actualizará al guardar.
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || (pagado && !categoriaAguinaldoId)}
            className="rounded bg-rodziny-600 px-4 py-1.5 text-sm text-white hover:bg-rodziny-700 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
