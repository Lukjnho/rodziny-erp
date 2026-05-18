import { useState } from 'react';
import { useConfigCosteo, type ConfigCosteo } from '@/modules/cocina/hooks/useConfigCosteo';
import {
  useProductosCosteoConfig,
  type ProductoCosteoConfig,
} from '../hooks/useProductosCosteoConfig';
import { useComisionMpConfig, type ComisionMpConfig } from '../hooks/useComisionMpConfig';
import { useManoObra } from '../hooks/useManoObra';
import { formatARS } from '@/lib/utils';

const MEDIO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  qr: 'QR / Mercado Pago',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  mp_lucas: 'MP Lucas (POSnet personal)',
};

export function ConfiguracionTab() {
  return (
    <div className="space-y-6">
      <SeccionGenerales />
      <SeccionManoObra />
      <SeccionCategorias />
      <SeccionComisionMp />
    </div>
  );
}

// ─── Sección Mano de obra ───────────────────────────────────────────────────
function SeccionManoObra() {
  const { pools, isLoading } = useManoObra();

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-1 text-sm font-semibold text-gray-800">👷 Mano de obra de producción</h3>
      <p className="mb-3 text-xs text-gray-600">
        Pool mensual de sueldos del equipo de producción, <strong>automático desde RRHH</strong>{' '}
        (empleados marcados como "producción"). Se reparte entre lo que cada local produjo en el
        mes, ponderado por los minutos de cada receta. Para cambiar quién entra al pool, usá el
        check <strong>"Producción"</strong> en RRHH → Legajos. Para ajustar minutos, en el tab
        Recetas.
      </p>
      {isLoading ? (
        <div className="text-xs text-gray-400">Cargando pool…</div>
      ) : pools.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          No hay empleados marcados como producción. Marcalos en RRHH → Legajos (columna
          "Producción") para que el costeo impute mano de obra.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Local</th>
                <th className="px-3 py-2 text-right">Empleados producción</th>
                <th className="px-3 py-2 text-right">Pool mensual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pools.map((p) => (
                <tr key={p.local} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium capitalize">{p.local}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.n_empleados}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatARS(p.total_sueldos)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Sección Generales (margen seguridad + IVA) ─────────────────────────────
function SeccionGenerales() {
  const { config, actualizar } = useConfigCosteo();
  const [edits, setEdits] = useState<Partial<Record<keyof ConfigCosteo, string>>>({});

  const items: { key: keyof ConfigCosteo; label: string; hint: string }[] = [
    {
      key: 'margen_seguridad_pct',
      label: 'Margen de seguridad',
      hint: 'Colchón sobre el costo base (merma extra, variación de precios)',
    },
    { key: 'iva_pct', label: 'IVA', hint: 'Para despejar precio neto del precio final' },
  ];

  function display(c: ConfigCosteo | undefined, k: keyof ConfigCosteo): string {
    if (!c) return '0.0';
    return (c[k] * 100).toFixed(1);
  }

  function guardar(k: keyof ConfigCosteo) {
    const raw = edits[k];
    if (raw == null) return;
    const num = parseFloat(raw.replace(',', '.'));
    if (isNaN(num) || num < 0) return;
    actualizar.mutate({ clave: k, valor: num / 100 });
    setEdits((s) => ({ ...s, [k]: undefined }));
  }

  return (
    <section className="rounded-lg border border-rodziny-200 bg-gradient-to-br from-rodziny-50 to-white p-4">
      <h3 className="mb-1 text-sm font-semibold text-rodziny-800">⚙ Parámetros generales</h3>
      <p className="mb-3 text-xs text-gray-600">
        Aplican a todo el costeo. La comisión por medio de pago se configura en la sección de abajo.
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {items.map((it) => {
          const actual = display(config, it.key);
          const nuevo = edits[it.key];
          const editando = nuevo != null;
          return (
            <div key={it.key} className="rounded border border-gray-200 bg-white p-2.5">
              <div className="mb-1 text-[10px] font-medium uppercase text-gray-500">{it.label}</div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={editando ? nuevo : actual}
                  onChange={(e) => setEdits((s) => ({ ...s, [it.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') guardar(it.key);
                  }}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
                />
                <span className="text-sm text-gray-500">%</span>
                {editando && (
                  <button
                    onClick={() => guardar(it.key)}
                    className="rounded bg-rodziny-700 px-2 py-1 text-xs text-white hover:bg-rodziny-800"
                    title="Guardar"
                  >
                    ✓
                  </button>
                )}
              </div>
              <div className="mt-1 text-[10px] leading-tight text-gray-400">{it.hint}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Sección Configuración por categoría ────────────────────────────────────
function SeccionCategorias() {
  const { data: configs, actualizar } = useProductosCosteoConfig();

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-1 text-sm font-semibold text-gray-800">🏷️ Markup y márgenes por categoría</h3>
      <p className="mb-3 text-xs text-gray-600">
        El <strong>markup</strong> es el % que se suma al costo para sacar el precio sugerido (70% =
        precio costo × 1,7). El <strong>margen</strong> es lo que te queda después de IVA y comisión
        sobre el precio cobrado. Si la categoría no tiene config, se usa <code>default</code>.
      </p>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2 text-right">Markup %</th>
              <th className="px-3 py-2 text-right">Margen min %</th>
              <th className="px-3 py-2 text-right">Margen max %</th>
              <th className="px-3 py-2 text-right">Redondeo $</th>
              <th className="px-3 py-2 text-right">Rango mercado</th>
              <th className="px-3 py-2">Descripción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(configs ?? []).map((c) => (
              <FilaCategoria key={c.categoria} config={c} onSave={(patch) =>
                actualizar.mutate({ categoria: c.categoria, patch })
              } />
            ))}
            {!configs?.length && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                  Sin configuraciones cargadas
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FilaCategoria({
  config,
  onSave,
}: {
  config: ProductoCosteoConfig;
  onSave: (patch: Partial<ProductoCosteoConfig>) => void;
}) {
  const [edit, setEdit] = useState<Partial<ProductoCosteoConfig>>({});
  const dirty = Object.keys(edit).length > 0;

  const val = (k: keyof ProductoCosteoConfig) =>
    (edit[k] !== undefined ? edit[k] : config[k]) as number | string | null;

  function pctInput(field: 'markup_objetivo' | 'margen_min' | 'margen_max') {
    const v = val(field);
    const display = v != null ? ((v as number) * 100).toFixed(1) : '';
    return (
      <input
        type="number"
        step="0.1"
        value={display}
        onChange={(e) => {
          const n = parseFloat(e.target.value.replace(',', '.'));
          setEdit((s) => ({ ...s, [field]: isNaN(n) ? 0 : n / 100 }));
        }}
        className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
      />
    );
  }

  function numInput(field: 'redondeo' | 'rango_mercado_min' | 'rango_mercado_max') {
    const v = val(field);
    return (
      <input
        type="number"
        step={field === 'redondeo' ? 50 : 100}
        value={v == null ? '' : String(v)}
        onChange={(e) => {
          const raw = e.target.value;
          setEdit((s) => ({
            ...s,
            [field]: raw === '' ? null : parseFloat(raw.replace(',', '.')) || 0,
          }));
        }}
        className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
      />
    );
  }

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2 font-medium capitalize">{config.categoria}</td>
      <td className="px-3 py-2 text-right">{pctInput('markup_objetivo')}</td>
      <td className="px-3 py-2 text-right">{pctInput('margen_min')}</td>
      <td className="px-3 py-2 text-right">{pctInput('margen_max')}</td>
      <td className="px-3 py-2 text-right">{numInput('redondeo')}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <div className="flex items-center justify-end gap-1">
          {numInput('rango_mercado_min')}
          <span className="text-gray-400">–</span>
          {numInput('rango_mercado_max')}
        </div>
        {config.rango_mercado_min && config.rango_mercado_max && !dirty && (
          <div className="mt-1 text-[9px] text-gray-400">
            {formatARS(config.rango_mercado_min)}–{formatARS(config.rango_mercado_max)}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={(val('descripcion') as string) ?? ''}
          onChange={(e) => setEdit((s) => ({ ...s, descripcion: e.target.value }))}
          className="w-48 rounded border border-gray-300 px-1.5 py-0.5 text-[11px]"
        />
        {dirty && (
          <button
            onClick={() => {
              onSave(edit);
              setEdit({});
            }}
            className="ml-2 rounded bg-rodziny-700 px-2 py-0.5 text-[10px] text-white hover:bg-rodziny-800"
          >
            Guardar
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Sección Comisión MP ────────────────────────────────────────────────────
function SeccionComisionMp() {
  const { data: comisiones, actualizar } = useComisionMpConfig();

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-1 text-sm font-semibold text-gray-800">💳 Comisión por medio de pago</h3>
      <p className="mb-3 text-xs text-gray-600">
        Estos valores son <strong>estimados</strong>. Se van a calibrar con los datos reales del
        extracto de Mercado Pago vs ventas Fudo en una fase posterior.
      </p>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Medio de pago</th>
              <th className="px-3 py-2 text-right">Comisión %</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2 text-right">Actualizado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(comisiones ?? []).map((c) => (
              <FilaComision key={c.medio_pago} c={c} onSave={(pct, desc) =>
                actualizar.mutate({ medio_pago: c.medio_pago, pct, descripcion: desc })
              } />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FilaComision({
  c,
  onSave,
}: {
  c: ComisionMpConfig;
  onSave: (pct: number, descripcion: string) => void;
}) {
  const [pctEdit, setPctEdit] = useState<string | null>(null);
  const [descEdit, setDescEdit] = useState<string | null>(null);
  const dirty = pctEdit !== null || descEdit !== null;

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2 font-medium">{MEDIO_LABEL[c.medio_pago] ?? c.medio_pago}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <input
          type="number"
          step="0.1"
          value={pctEdit ?? (c.pct * 100).toFixed(2)}
          onChange={(e) => setPctEdit(e.target.value)}
          className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right"
        />
        <span className="ml-1 text-gray-400">%</span>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={descEdit ?? c.descripcion ?? ''}
          onChange={(e) => setDescEdit(e.target.value)}
          className="w-72 rounded border border-gray-300 px-1.5 py-0.5 text-[11px]"
        />
        {dirty && (
          <button
            onClick={() => {
              const pct = parseFloat((pctEdit ?? String(c.pct * 100)).replace(',', '.')) / 100;
              const desc = descEdit ?? c.descripcion ?? '';
              onSave(isNaN(pct) ? c.pct : pct, desc);
              setPctEdit(null);
              setDescEdit(null);
            }}
            className="ml-2 rounded bg-rodziny-700 px-2 py-0.5 text-[10px] text-white hover:bg-rodziny-800"
          >
            Guardar
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-right text-[10px] text-gray-400">
        {new Date(c.actualizado).toLocaleDateString('es-AR')}
      </td>
    </tr>
  );
}
