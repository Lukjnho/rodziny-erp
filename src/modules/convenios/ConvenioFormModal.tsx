import { useState } from 'react';
import { useGuardarConvenio } from './useConvenios';
import {
  ESTADO_LABEL,
  LOCAL_LABEL,
  type Convenio,
  type ConvenioInput,
  type EstadoConvenio,
  type LocalConv,
} from './types';

export function ConvenioFormModal({
  convenio,
  onClose,
}: {
  convenio: Convenio | null;
  onClose: () => void;
}) {
  const guardar = useGuardarConvenio();
  const [error, setError] = useState<string | null>(null);

  const [f, setF] = useState<ConvenioInput>({
    local: convenio?.local ?? 'vedia',
    fudo_customer_id: convenio?.fudo_customer_id ?? null,
    nombre: convenio?.nombre ?? '',
    descuento_pct: convenio?.descuento_pct ?? null,
    tipo: convenio?.tipo ?? null,
    contacto: convenio?.contacto ?? null,
    beneficios_extra: convenio?.beneficios_extra ?? null,
    vigencia_desde: convenio?.vigencia_desde ?? null,
    vigencia_hasta: convenio?.vigencia_hasta ?? null,
    estado: convenio?.estado ?? 'activo',
    notas: convenio?.notas ?? null,
    activo: convenio?.activo ?? true,
  });

  function set<K extends keyof ConvenioInput>(k: K, v: ConvenioInput[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.nombre.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    try {
      await guardar.mutateAsync({ id: convenio?.id, input: { ...f, nombre: f.nombre.trim() } });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-bold text-gray-800">
          {convenio ? 'Editar convenio' : 'Nuevo convenio'}
        </h3>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Nombre">
              <input
                value={f.nombre}
                onChange={(e) => set('nombre', e.target.value)}
                placeholder="APEX"
                className={inputCls}
              />
            </Campo>
            <Campo label="Local">
              <select
                value={f.local}
                onChange={(e) => set('local', e.target.value as LocalConv)}
                className={inputCls}
              >
                {(['vedia', 'saavedra'] as LocalConv[]).map((l) => (
                  <option key={l} value={l}>
                    {LOCAL_LABEL[l]}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Campo label="ID cliente en Fudo" hint="el # del cliente que se elige al cobrar">
              <input
                value={f.fudo_customer_id ?? ''}
                onChange={(e) => set('fudo_customer_id', e.target.value.trim() || null)}
                placeholder="712"
                className={inputCls}
              />
            </Campo>
            <Campo label="Descuento %">
              <input
                type="number"
                step="0.1"
                value={f.descuento_pct ?? ''}
                onChange={(e) =>
                  set('descuento_pct', e.target.value === '' ? null : Number(e.target.value))
                }
                placeholder="15"
                className={inputCls}
              />
            </Campo>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Campo label="Tipo">
              <select
                value={f.tipo ?? ''}
                onChange={(e) => set('tipo', e.target.value || null)}
                className={inputCls}
              >
                <option value="">—</option>
                <option value="institucional">Institucional</option>
                <option value="empresa">Empresa</option>
                <option value="club">Club</option>
                <option value="otro">Otro</option>
              </select>
            </Campo>
            <Campo label="Estado">
              <select
                value={f.estado}
                onChange={(e) => set('estado', e.target.value as EstadoConvenio)}
                className={inputCls}
              >
                {(Object.keys(ESTADO_LABEL) as EstadoConvenio[]).map((es) => (
                  <option key={es} value={es}>
                    {ESTADO_LABEL[es]}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <Campo label="Contacto">
            <input
              value={f.contacto ?? ''}
              onChange={(e) => set('contacto', e.target.value || null)}
              placeholder="Referente / teléfono"
              className={inputCls}
            />
          </Campo>

          <Campo label="Beneficios extra" hint="lo no monetario (ej: uso del salón)">
            <input
              value={f.beneficios_extra ?? ''}
              onChange={(e) => set('beneficios_extra', e.target.value || null)}
              placeholder="Uso del salón para reuniones"
              className={inputCls}
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo label="Vigencia desde">
              <input
                type="date"
                value={f.vigencia_desde ?? ''}
                onChange={(e) => set('vigencia_desde', e.target.value || null)}
                className={inputCls}
              />
            </Campo>
            <Campo label="Vigencia hasta">
              <input
                type="date"
                value={f.vigencia_hasta ?? ''}
                onChange={(e) => set('vigencia_hasta', e.target.value || null)}
                className={inputCls}
              />
            </Campo>
          </div>

          <Campo label="Notas">
            <textarea
              value={f.notas ?? ''}
              onChange={(e) => set('notas', e.target.value || null)}
              rows={2}
              className={inputCls}
            />
          </Campo>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={f.activo}
              onChange={(e) => set('activo', e.target.checked)}
            />
            Activo
          </label>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardar.isPending}
              className="rounded bg-rodziny-700 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500';

function Campo({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">
        {label}
        {hint && <span className="ml-1 font-normal text-gray-400">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
