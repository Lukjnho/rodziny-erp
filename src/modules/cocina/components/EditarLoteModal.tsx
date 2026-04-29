import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type Tabla =
  | 'cocina_lotes_relleno'
  | 'cocina_lotes_masa'
  | 'cocina_lotes_produccion'
  | 'cocina_lotes_pasta';

interface Props {
  id: string;
  tabla: Tabla;
  nombre: string;
  onClose: () => void;
}

interface LoteRelleno {
  cantidad_recetas: number | null;
  peso_total_kg: number | null;
  notas: string | null;
}
interface LoteMasa {
  kg_producidos: number | null;
  kg_sobrante: number | null;
  notas: string | null;
}
interface LoteProduccion {
  cantidad_producida: number | null;
  unidad: string | null;
  categoria: string | null;
  notas: string | null;
}
interface LotePasta {
  masa_kg: number | null;
  relleno_kg: number | null;
  porciones: number | null;
  cantidad_cajones: number | null;
  merma_porcionado: number | null;
  sobrante_gramos: number | null;
  responsable: string | null;
  notas: string | null;
}
type LoteCualquiera = LoteRelleno | LoteMasa | LoteProduccion | LotePasta;

function parseDecimal(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}
function parseEntero(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(',', '.'), 10);
  return isNaN(n) ? null : n;
}

export function EditarLoteModal({ id, tabla, nombre, onClose }: Props) {
  const qc = useQueryClient();
  const [valores, setValores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: lote, isLoading } = useQuery({
    queryKey: ['cocina-lote-edit', tabla, id],
    queryFn: async () => {
      const { data, error } = await supabase.from(tabla).select('*').eq('id', id).single();
      if (error) throw error;
      return data as LoteCualquiera;
    },
  });

  useEffect(() => {
    if (!lote) return;
    if (tabla === 'cocina_lotes_relleno') {
      const r = lote as LoteRelleno;
      setValores({
        cantidad_recetas: r.cantidad_recetas != null ? String(r.cantidad_recetas) : '',
        peso_total_kg: r.peso_total_kg != null ? String(r.peso_total_kg) : '',
        notas: r.notas ?? '',
      });
    } else if (tabla === 'cocina_lotes_masa') {
      const m = lote as LoteMasa;
      setValores({
        kg_producidos: m.kg_producidos != null ? String(m.kg_producidos) : '',
        kg_sobrante: m.kg_sobrante != null ? String(m.kg_sobrante) : '',
        notas: m.notas ?? '',
      });
    } else if (tabla === 'cocina_lotes_produccion') {
      const p = lote as LoteProduccion;
      setValores({
        cantidad_producida: p.cantidad_producida != null ? String(p.cantidad_producida) : '',
        unidad: p.unidad ?? '',
        notas: p.notas ?? '',
      });
    } else {
      const pa = lote as LotePasta;
      setValores({
        masa_kg: pa.masa_kg != null ? String(pa.masa_kg) : '',
        relleno_kg: pa.relleno_kg != null ? String(pa.relleno_kg) : '',
        porciones: pa.porciones != null ? String(pa.porciones) : '',
        cantidad_cajones: pa.cantidad_cajones != null ? String(pa.cantidad_cajones) : '',
        merma_porcionado: pa.merma_porcionado != null ? String(pa.merma_porcionado) : '',
        sobrante_gramos: pa.sobrante_gramos != null ? String(pa.sobrante_gramos) : '',
        responsable: pa.responsable ?? '',
        notas: pa.notas ?? '',
      });
    }
  }, [lote, tabla]);

  const guardar = useMutation({
    mutationFn: async () => {
      let payload: Record<string, unknown>;
      if (tabla === 'cocina_lotes_relleno') {
        payload = {
          cantidad_recetas: parseEntero(valores.cantidad_recetas),
          peso_total_kg: parseDecimal(valores.peso_total_kg),
          notas: valores.notas?.trim() || null,
        };
      } else if (tabla === 'cocina_lotes_masa') {
        payload = {
          kg_producidos: parseDecimal(valores.kg_producidos),
          kg_sobrante: parseDecimal(valores.kg_sobrante),
          notas: valores.notas?.trim() || null,
        };
      } else if (tabla === 'cocina_lotes_produccion') {
        payload = {
          cantidad_producida: parseDecimal(valores.cantidad_producida),
          unidad: valores.unidad?.trim() || null,
          notas: valores.notas?.trim() || null,
        };
      } else {
        payload = {
          masa_kg: parseDecimal(valores.masa_kg),
          relleno_kg: parseDecimal(valores.relleno_kg),
          porciones: parseEntero(valores.porciones),
          cantidad_cajones: parseEntero(valores.cantidad_cajones),
          merma_porcionado: parseEntero(valores.merma_porcionado) ?? 0,
          sobrante_gramos: parseDecimal(valores.sobrante_gramos),
          responsable: valores.responsable?.trim() || null,
          notas: valores.notas?.trim() || null,
        };
      }
      const { error: errUpd } = await supabase.from(tabla).update(payload).eq('id', id);
      if (errUpd) throw errUpd;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-lotes-relleno'] });
      qc.invalidateQueries({ queryKey: ['cocina-lotes-masa'] });
      qc.invalidateQueries({ queryKey: ['cocina-lotes-produccion'] });
      qc.invalidateQueries({ queryKey: ['cocina-lotes-pasta'] });
      qc.invalidateQueries({ queryKey: ['cocina_stock_pastas'] });
      qc.invalidateQueries({ queryKey: ['cocina-stock-produccion'] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Editar lote</h3>
            <p className="mt-0.5 text-xs text-gray-500">{nombre}</p>
          </div>
          <button
            onClick={onClose}
            className="text-lg text-gray-400 hover:text-gray-600"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-gray-400">Cargando...</p>
        ) : (
          <div className="space-y-3">
            {tabla === 'cocina_lotes_relleno' && (
              <>
                <CampoEntero
                  label="Cantidad de recetas"
                  value={valores.cantidad_recetas ?? ''}
                  onChange={(v) =>
                    setValores((prev) => ({ ...prev, cantidad_recetas: v }))
                  }
                />
                <CampoNumero
                  label="Peso total (kg)"
                  value={valores.peso_total_kg ?? ''}
                  onChange={(v) => setValores((prev) => ({ ...prev, peso_total_kg: v }))}
                />
              </>
            )}

            {tabla === 'cocina_lotes_masa' && (
              <>
                <CampoNumero
                  label="Kg producidos"
                  value={valores.kg_producidos ?? ''}
                  onChange={(v) => setValores((prev) => ({ ...prev, kg_producidos: v }))}
                />
                <CampoNumero
                  label="Kg sobrante (deja vacío si está abierta)"
                  value={valores.kg_sobrante ?? ''}
                  onChange={(v) => setValores((prev) => ({ ...prev, kg_sobrante: v }))}
                />
              </>
            )}

            {tabla === 'cocina_lotes_produccion' && (
              <>
                <CampoNumero
                  label="Cantidad producida"
                  value={valores.cantidad_producida ?? ''}
                  onChange={(v) =>
                    setValores((prev) => ({ ...prev, cantidad_producida: v }))
                  }
                />
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Unidad</label>
                  <select
                    value={valores.unidad ?? ''}
                    onChange={(e) =>
                      setValores((prev) => ({ ...prev, unidad: e.target.value }))
                    }
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    <option value="kg">kg</option>
                    <option value="unidades">unidades</option>
                    <option value="porciones">porciones</option>
                    <option value="litros">litros</option>
                  </select>
                </div>
              </>
            )}

            {tabla === 'cocina_lotes_pasta' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <CampoNumero
                    label="Masa (kg)"
                    value={valores.masa_kg ?? ''}
                    onChange={(v) => setValores((prev) => ({ ...prev, masa_kg: v }))}
                  />
                  <CampoNumero
                    label="Relleno (kg)"
                    value={valores.relleno_kg ?? ''}
                    onChange={(v) => setValores((prev) => ({ ...prev, relleno_kg: v }))}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <CampoEntero
                    label="Porciones"
                    value={valores.porciones ?? ''}
                    onChange={(v) => setValores((prev) => ({ ...prev, porciones: v }))}
                  />
                  <CampoEntero
                    label="Bandejas"
                    value={valores.cantidad_cajones ?? ''}
                    onChange={(v) =>
                      setValores((prev) => ({ ...prev, cantidad_cajones: v }))
                    }
                  />
                  <CampoEntero
                    label="Merma porc."
                    value={valores.merma_porcionado ?? ''}
                    onChange={(v) =>
                      setValores((prev) => ({ ...prev, merma_porcionado: v }))
                    }
                  />
                </div>
                <CampoNumero
                  label="Sobrante (gramos)"
                  value={valores.sobrante_gramos ?? ''}
                  onChange={(v) =>
                    setValores((prev) => ({ ...prev, sobrante_gramos: v }))
                  }
                />
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Responsable
                  </label>
                  <input
                    type="text"
                    value={valores.responsable ?? ''}
                    onChange={(e) =>
                      setValores((prev) => ({ ...prev, responsable: e.target.value }))
                    }
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Notas</label>
              <input
                type="text"
                value={valores.notas ?? ''}
                onChange={(e) => setValores((prev) => ({ ...prev, notas: e.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => guardar.mutate()}
                disabled={guardar.isPending}
                className="rounded bg-rodziny-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rodziny-800 disabled:opacity-50"
              >
                {guardar.isPending ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CampoNumero({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9]*[.,]?[0-9]*"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm tabular-nums"
      />
    </div>
  );
}

function CampoEntero({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm tabular-nums"
      />
    </div>
  );
}
