import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, cn } from '@/lib/utils';
import {
  useProyeccionFlujo,
  type ProyeccionItem,
  type ProyeccionMes,
} from '../hooks/useProyeccionFlujo';

// Nombre legible del período 'YYYY-MM' → 'jun 2026'.
const MESES_ABBR = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];
function labelPeriodo(periodo: string): string {
  const [y, m] = periodo.split('-');
  return `${MESES_ABBR[Number(m) - 1]} ${y}`;
}

function pct(n: number): string {
  return `${(n * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;
}

// Mes corto para encabezados de columna: 'jun 26'.
function labelMesCorto(periodo: string): string {
  const [y, m] = periodo.split('-');
  return `${MESES_ABBR[Number(m) - 1]} ${y.slice(2)}`;
}

// Número compacto en millones para la grilla: 106,0 · −12,5.
function fmtM(n: number): string {
  const v = n / 1e6;
  const s = Math.abs(v).toLocaleString('es-AR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${v < 0 ? '−' : ''}${s}`;
}

export function ProyeccionFlujo() {
  const qc = useQueryClient();
  const { meses, cmvPct, cmvPctAuto, ingresoPromMensual, sueldosMensuales, config, items, isLoading } =
    useProyeccionFlujo();

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['proy_config'] });
    qc.invalidateQueries({ queryKey: ['proy_items'] });
  };

  // ── mutaciones config ──────────────────────────────────────────────────────
  const guardarConfig = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await supabase
        .from('proyeccion_config')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  // ── mutaciones items ───────────────────────────────────────────────────────
  const crearItem = useMutation({
    mutationFn: async (item: Omit<ProyeccionItem, 'id'>) => {
      const { error } = await supabase.from('proyeccion_flujo_items').insert(item);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
  const borrarItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('proyeccion_flujo_items')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  if (isLoading || !config) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        Calculando proyección…
      </div>
    );
  }

  const primerSaldoNegativo = meses.find((m) => m.saldoOperativa < 0);

  return (
    <div className="space-y-6">
      {/* Alerta: meses donde la caja operativa se va abajo de cero */}
      {primerSaldoNegativo && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>⚠️</span>
          <span>
            La caja operativa proyectada se va <strong>negativa en {labelPeriodo(primerSaldoNegativo.periodo)}</strong>
            {' '}({formatARS(primerSaldoNegativo.saldoOperativa)}). Ese mes no aguanta un gasto grande sin
            mover plata de la reserva.
          </span>
        </div>
      )}

      {/* KPIs base (todos dinámicos) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Ingreso prom. / mes" value={formatARS(ingresoPromMensual)} sub="varía por estacionalidad" />
        <Kpi
          label="CMV %"
          value={pct(cmvPct)}
          sub={cmvPctAuto ? 'auto (compras ÷ ventas)' : 'fijado manual'}
          badge={cmvPctAuto ? 'auto' : 'manual'}
        />
        <Kpi label="Sueldos / mes" value={formatARS(sueldosMensuales)} sub="neto activos" />
        <Kpi
          label="Saldos hoy"
          value={formatARS(config.saldo_operativa_inicial)}
          sub={`+ reserva ${formatARS(config.saldo_reserva_inicial)}`}
        />
      </div>

      <ConfigEditor config={config} onSave={(patch) => guardarConfig.mutate(patch)} saving={guardarConfig.isPending} />

      {/* Tabla de proyección — formato planilla: meses en columnas, saldos abajo */}
      <MatrizProyeccion meses={meses} />
      <p className="text-xs text-gray-400">
        Cifras en millones de $ (pasá el mouse por una celda para ver el valor exacto). Los KPIs se
        recalculan solos desde el ERP. <span className="text-amber-500">*</span> = pagos fijos estimados
        (mes sin cargar). Saldo operativa en{' '}
        <span className="rounded bg-red-50 px-1 text-red-700">rojo</span> = ese mes no se autofinancia.
      </p>

      <ItemsManuales
        items={items}
        periodos={meses.map((m) => m.periodo)}
        onCrear={(it) => crearItem.mutate(it)}
        onBorrar={(id) => borrarItem.mutate(id)}
        creando={crearItem.isPending}
      />
    </div>
  );
}

// ── Matriz estilo planilla (meses en columnas, saldos abajo) ────────────────────
function MatrizProyeccion({ meses }: { meses: ProyeccionMes[] }) {
  // Celda numérica genérica de la grilla.
  const Celda = ({
    valor,
    clase,
    title,
    estrella,
    placeholder,
  }: {
    valor: number;
    clase?: string;
    title?: string;
    estrella?: boolean;
    placeholder?: boolean;
  }) => (
    <td
      className={cn('px-3 py-1.5 text-right tabular-nums', clase)}
      title={title ?? formatARS(valor)}
    >
      {placeholder ? <span className="text-gray-300">—</span> : fmtM(valor)}
      {estrella && <span className="ml-0.5 text-amber-500">*</span>}
    </td>
  );

  const labelCls =
    'sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 text-left';

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <th className={cn(labelCls, 'bg-gray-50 font-medium')}>Concepto</th>
            {meses.map((m) => (
              <th key={m.periodo} className="min-w-[68px] px-3 py-2 text-right font-medium">
                {labelMesCorto(m.periodo)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Ingresos */}
          <tr className="border-b border-gray-100 hover:bg-gray-50/60">
            <td className={cn(labelCls, 'font-medium text-gray-700')}>Ingreso</td>
            {meses.map((m) => (
              <Celda key={m.periodo} valor={m.ingreso} clase="text-gray-700" />
            ))}
          </tr>

          {/* Egresos */}
          <tr className="border-b border-gray-100 hover:bg-gray-50/60">
            <td className={cn(labelCls, 'text-gray-600')}>CMV</td>
            {meses.map((m) => (
              <Celda key={m.periodo} valor={-m.cmv} clase="text-gray-500" />
            ))}
          </tr>
          <tr className="border-b border-gray-100 hover:bg-gray-50/60">
            <td className={cn(labelCls, 'text-gray-600')}>Pagos fijos</td>
            {meses.map((m) => (
              <Celda
                key={m.periodo}
                valor={-m.pagosFijos}
                clase="text-gray-500"
                estrella={m.pagosFijosEstimado}
                title={
                  m.pagosFijosEstimado
                    ? `${formatARS(m.pagosFijos)} — estimado (mes sin cargar): promedio de los últimos 3 cargados`
                    : formatARS(m.pagosFijos)
                }
              />
            ))}
          </tr>
          <tr className="border-b border-gray-100 hover:bg-gray-50/60">
            <td className={cn(labelCls, 'text-gray-600')}>Sueldos</td>
            {meses.map((m) => (
              <Celda key={m.periodo} valor={-m.sueldos} clase="text-gray-500" />
            ))}
          </tr>
          <tr className="border-b border-gray-100 hover:bg-gray-50/60">
            <td className={cn(labelCls, 'text-gray-600')}>Aguinaldo</td>
            {meses.map((m) => (
              <Celda
                key={m.periodo}
                valor={-m.aguinaldo}
                clase="font-medium text-orange-600"
                placeholder={m.aguinaldo === 0}
              />
            ))}
          </tr>
          <tr className="border-b border-gray-100 hover:bg-gray-50/60">
            <td className={cn(labelCls, 'text-gray-600')}>Echeqs / cheques</td>
            {meses.map((m) => (
              <Celda
                key={m.periodo}
                valor={-m.echeqs}
                clase="font-medium text-purple-600"
                placeholder={m.echeqs === 0}
              />
            ))}
          </tr>
          <tr className="border-b border-gray-100 hover:bg-gray-50/60">
            <td className={cn(labelCls, 'text-gray-600')}>Items</td>
            {meses.map((m) => {
              const val = m.itemsOperativa + m.itemsReserva;
              return (
                <Celda
                  key={m.periodo}
                  valor={val}
                  clase={val < 0 ? 'text-red-500' : 'text-green-700'}
                  placeholder={val === 0}
                />
              );
            })}
          </tr>

          {/* Neto operativo */}
          <tr className="border-b-2 border-gray-300 bg-gray-50/60">
            <td className={cn(labelCls, 'bg-gray-50 font-semibold text-gray-700')}>Neto operativo</td>
            {meses.map((m) => (
              <Celda
                key={m.periodo}
                valor={m.netoOperativo}
                clase={cn('font-semibold', m.netoOperativo < 0 ? 'text-red-600' : 'text-green-700')}
              />
            ))}
          </tr>

          {/* Saldos — abajo de todo, destacados */}
          <tr className="bg-rodziny-50/40">
            <td className={cn(labelCls, 'bg-rodziny-50/40 font-semibold text-rodziny-800')}>
              Saldo operativa
            </td>
            {meses.map((m) => (
              <Celda
                key={m.periodo}
                valor={m.saldoOperativa}
                clase={cn(
                  'font-semibold',
                  m.saldoOperativa < 0 ? 'bg-red-100 text-red-700' : 'text-rodziny-800',
                )}
              />
            ))}
          </tr>
          <tr className="bg-blue-50/40">
            <td className={cn(labelCls, 'bg-blue-50/40 font-semibold text-blue-800')}>
              Saldo reserva
            </td>
            {meses.map((m) => (
              <Celda key={m.periodo} valor={m.saldoReserva} clase="font-semibold text-blue-800" />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── KPI card ───────────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, badge }: { label: string; value: string; sub?: string; badge?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
        {badge && (
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', badge === 'auto' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
            {badge}
          </span>
        )}
      </div>
      <div className="mt-1 text-lg font-semibold text-gray-800">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

// ── Editor de config (saldos ancla + supuestos) ─────────────────────────────────
function ConfigEditor({
  config,
  onSave,
  saving,
}: {
  config: { saldo_operativa_inicial: number; saldo_reserva_inicial: number; fecha_saldo: string; cmv_pct_override: number | null; meses_promedio: number };
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [oper, setOper] = useState(String(config.saldo_operativa_inicial));
  const [res, setRes] = useState(String(config.saldo_reserva_inicial));
  const [fecha, setFecha] = useState(config.fecha_saldo);
  const [meses, setMeses] = useState(String(config.meses_promedio));
  const [cmvAuto, setCmvAuto] = useState(config.cmv_pct_override == null);
  const [cmvPctManual, setCmvPctManual] = useState(
    config.cmv_pct_override == null ? '' : String((config.cmv_pct_override * 100).toFixed(1)),
  );

  function guardar() {
    onSave({
      saldo_operativa_inicial: Number(oper) || 0,
      saldo_reserva_inicial: Number(res) || 0,
      fecha_saldo: fecha,
      meses_promedio: Math.max(1, Number(meses) || 3),
      cmv_pct_override: cmvAuto ? null : (Number(cmvPctManual) || 0) / 100,
    });
    setAbierto(false);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700"
      >
        <span>⚙️ Saldos y supuestos</span>
        <span className="text-gray-400">{abierto ? '▲' : '▼'}</span>
      </button>
      {abierto && (
        <div className="space-y-4 border-t border-gray-100 px-4 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo label="Caja operativa hoy (MP + efectivo + bancos)">
              <input type="number" value={oper} onChange={(e) => setOper(e.target.value)} className={inputCls} />
            </Campo>
            <Campo label="Reserva hoy (comitente)">
              <input type="number" value={res} onChange={(e) => setRes(e.target.value)} className={inputCls} />
            </Campo>
            <Campo label="Fecha de los saldos">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
            </Campo>
            <Campo label="Meses para promediar">
              <input type="number" min={1} value={meses} onChange={(e) => setMeses(e.target.value)} className={inputCls} />
            </Campo>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={cmvAuto} onChange={(e) => setCmvAuto(e.target.checked)} />
              CMV % automático (compras ÷ ventas)
            </label>
            {!cmvAuto && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={cmvPctManual}
                  onChange={(e) => setCmvPctManual(e.target.value)}
                  className={cn(inputCls, 'w-24')}
                  placeholder="34"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            )}
          </div>
          <button
            onClick={guardar}
            disabled={saving}
            className="rounded-md bg-rodziny-600 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Items manuales (inversiones / eventos / transferencias) ─────────────────────
function ItemsManuales({
  items,
  periodos,
  onCrear,
  onBorrar,
  creando,
}: {
  items: ProyeccionItem[];
  periodos: string[];
  onCrear: (it: Omit<ProyeccionItem, 'id'>) => void;
  onBorrar: (id: string) => void;
  creando: boolean;
}) {
  const [periodo, setPeriodo] = useState(periodos[0] ?? '');
  const [concepto, setConcepto] = useState('');
  const [tipo, setTipo] = useState<ProyeccionItem['tipo']>('egreso');
  const [cuenta, setCuenta] = useState<ProyeccionItem['cuenta']>('reserva');
  const [monto, setMonto] = useState('');
  const [nota, setNota] = useState('');

  function agregar() {
    if (!concepto.trim() || !monto || !periodo) return;
    onCrear({
      periodo,
      concepto: concepto.trim(),
      tipo,
      cuenta,
      monto: Number(monto) || 0,
      nota: nota.trim() || null,
    });
    setConcepto('');
    setMonto('');
    setNota('');
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-700">
        📌 Inversiones y eventos puntuales
      </div>

      {/* Form de alta */}
      <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-6">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className={inputCls}>
          {periodos.map((p) => (
            <option key={p} value={p}>{labelPeriodo(p)}</option>
          ))}
        </select>
        <input
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          placeholder="Concepto (ej: Extrusora)"
          className={cn(inputCls, 'sm:col-span-2')}
        />
        <select value={tipo} onChange={(e) => setTipo(e.target.value as ProyeccionItem['tipo'])} className={inputCls}>
          <option value="egreso">Egreso</option>
          <option value="ingreso">Ingreso</option>
          <option value="transferencia">Transferencia</option>
        </select>
        <select value={cuenta} onChange={(e) => setCuenta(e.target.value as ProyeccionItem['cuenta'])} className={inputCls}>
          <option value="reserva">{tipo === 'transferencia' ? '→ a Reserva' : 'Reserva'}</option>
          <option value="operativa">{tipo === 'transferencia' ? '→ a Operativa' : 'Operativa'}</option>
        </select>
        <input
          type="number"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          placeholder="Monto"
          className={inputCls}
        />
      </div>
      <div className="flex items-center gap-2 px-4 pb-3">
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Nota (opcional)"
          className={cn(inputCls, 'flex-1')}
        />
        <button
          onClick={agregar}
          disabled={creando || !concepto.trim() || !monto}
          className="whitespace-nowrap rounded-md bg-rodziny-600 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-700 disabled:opacity-50"
        >
          Agregar
        </button>
      </div>

      {/* Listado */}
      {items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-gray-400">
          Sin items. Cargá acá la extrusora, la Bienal, una futura sucursal, etc.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-gray-700">{labelPeriodo(it.periodo)}</span>
                <span className="mx-2 text-gray-400">·</span>
                <span className="text-gray-700">{it.concepto}</span>
                {it.nota && <span className="ml-2 text-xs text-gray-400">({it.nota})</span>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">
                  {it.tipo === 'transferencia' ? `transf → ${it.cuenta}` : `${it.tipo} · ${it.cuenta}`}
                </span>
                <span className={cn('font-medium', it.tipo === 'egreso' ? 'text-red-600' : 'text-green-700')}>
                  {it.tipo === 'egreso' ? '−' : '+'}{formatARS(it.monto)}
                </span>
                <button onClick={() => onBorrar(it.id)} className="text-gray-300 hover:text-red-500" title="Borrar">
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const inputCls =
  'rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500';

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}
