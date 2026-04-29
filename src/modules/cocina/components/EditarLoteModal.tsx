import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type Tabla = 'cocina_lotes_relleno' | 'cocina_lotes_masa' | 'cocina_lotes_produccion';

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
type LoteCualquiera = LoteRelleno | LoteMasa | LoteProduccion;

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
    } else {
      const p = lote as LoteProduccion;
      setValores({
        cantidad_producida: p.cantidad_producida != null ? String(p.cantidad_producida) : '',
        unidad: p.unidad ?? '',
        notas: p.notas ?? '',
      });
    }
  }, [lote, tabla]);

  const guardar = useMutation({
    mutationFn: async () => {
      let payload: Record<string, unknown>;
      if (tabla === 'cocina_lotes_relleno') {
        payload = {
          cantidad_recetas: valores.cantidad_recetas
            ? Number(valores.cantidad_recetas)
            : null,
          peso_total_kg: valores.peso_total_kg
            ? Number(valores.peso_total_kg.replace(',', '.'))
            : null,
          notas: valores.notas?.trim() || null,
        };
      } else if (tabla === 'cocina_lotes_masa') {
        payload = {
          kg_producidos: valores.kg_producidos
            ? Number(valores.kg_producidos.replace(',', '.'))
            : null,
          kg_sobrante: valores.kg_sobrante
            ? Number(valores.kg_sobrante.replace(',', '.'))
            : null,
          notas: valores.notas?.trim() || null,
        };
      } else {
        payload = {
          cantidad_producida: valores.cantidad_producida
            ? Number(valores.cantidad_producida.replace(',', '.'))
            : null,
          unidad: valores.unidad?.trim() || null,
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
                <CampoNumero
                  label="Cantidad de recetas"
                  value={valores.cantidad_recetas ?? ''}
                  onChange={(v) =>
                    setValores((prev) => ({ ...prev, cantidad_recetas: v }))
                  }
                  step="1"
                />
                <CampoNumero
                  label="Peso total (kg)"
                  value={valores.peso_total_kg ?? ''}
                  onChange={(v) => setValores((prev) => ({ ...prev, peso_total_kg: v }))}
                  step="0.01"
                />
              </>
            )}

            {tabla === 'cocina_lotes_masa' && (
              <>
                <CampoNumero
                  label="Kg producidos"
                  value={valores.kg_producidos ?? ''}
                  onChange={(v) => setValores((prev) => ({ ...prev, kg_producidos: v }))}
                  step="0.01"
                />
                <CampoNumero
                  label="Kg sobrante (deja vacío si está abierta)"
                  value={valores.kg_sobrante ?? ''}
                  onChange={(v) => setValores((prev) => ({ ...prev, kg_sobrante: v }))}
                  step="0.01"
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
                  step="0.01"
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
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step={step ?? '0.01'}
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm tabular-nums"
      />
    </div>
  );
}
