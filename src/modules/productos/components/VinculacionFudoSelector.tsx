import { useMemo, useState } from 'react';
import { formatARS } from '@/lib/utils';
import { useFudoHuerfanos } from '@/modules/productos/hooks/useFudoHuerfanos';

// Selector inteligente de nombres Fudo para vincular a una receta vendible
// (cocina_recetas.fudo_productos[]) o a un cocina_producto (fudo_nombres[]).
//
// UX: input filtro + checklist con badges (uds + $ últimos 2 meses). Pre-tilda
// lo que ya estaba vinculado (prop `value`). Los nombres vinculados al ítem
// actual que NO aparecen en huérfanos (vendidos hace >2 meses) se listan al
// final, tachados, para poder desmarcarlos. Los vinculados a OTRA receta o
// producto se muestran deshabilitados con la referencia al "dueño".
//
// onChange devuelve el array nuevo de nombres seleccionados → el form padre
// los guarda en su submit.
export function VinculacionFudoSelector({
  local,
  value,
  onChange,
  ownerKey,
}: {
  local: 'vedia' | 'saavedra';
  value: string[];
  onChange: (next: string[]) => void;
  // Identifica al item actual (`receta:<id>` o `producto:<id>`). Sirve para
  // que un nombre vinculado a "mí mismo" no aparezca como deshabilitado.
  ownerKey?: string;
}) {
  const { data: huerfanos, isLoading } = useFudoHuerfanos(local);
  const [filtro, setFiltro] = useState('');

  const valueSet = useMemo(() => new Set(value.map((s) => s.trim())), [value]);

  const filtroLower = filtro.trim().toLowerCase();

  // Lista principal: huérfanos del local + nombres vinculados al item actual.
  // Cada fila trae el estado de "tomado por otro" para deshabilitar.
  const filas = useMemo(() => {
    if (!huerfanos) return [];
    const ownerKeyNorm = (ownerKey ?? '').trim();
    type Fila = {
      nombre: string;
      uds: number;
      total: number;
      tomadoPor: { tipo: 'receta' | 'producto'; id: string; nombre: string } | null;
      historico: boolean; // vinculado al item actual pero sin ventas en últ. 2m
    };
    const rows: Fila[] = huerfanos.map((h) => {
      const tomado = h.vinculadoA;
      const esMio =
        tomado &&
        ownerKeyNorm &&
        `${tomado.tipo}:${tomado.id}` === ownerKeyNorm;
      return {
        nombre: h.nombre,
        uds: h.uds,
        total: h.total,
        tomadoPor: !tomado || esMio ? null : tomado,
        historico: false,
      };
    });
    // Añadir nombres vinculados al item actual que NO aparecen en huérfanos.
    const huerfanosSet = new Set(huerfanos.map((h) => h.nombre));
    for (const nombre of value) {
      if (!huerfanosSet.has(nombre.trim()) && nombre.trim()) {
        rows.push({
          nombre: nombre.trim(),
          uds: 0,
          total: 0,
          tomadoPor: null,
          historico: true,
        });
      }
    }
    if (!filtroLower) return rows;
    return rows.filter((r) => r.nombre.toLowerCase().includes(filtroLower));
  }, [huerfanos, value, ownerKey, filtroLower]);

  function toggle(nombre: string) {
    const next = new Set(value);
    if (next.has(nombre)) next.delete(nombre);
    else next.add(nombre);
    onChange(Array.from(next));
  }

  if (isLoading) {
    return (
      <p className="text-[10px] italic text-gray-400">Cargando productos Fudo del local…</p>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar nombre Fudo…"
        className="w-full max-w-md rounded border border-gray-300 px-3 py-1.5 text-xs"
      />
      <div className="max-h-72 overflow-y-auto rounded border border-gray-200 bg-white">
        {filas.length === 0 ? (
          <p className="py-3 text-center text-[10px] italic text-gray-400">
            {filtroLower
              ? 'Sin nombres Fudo que coincidan.'
              : 'No hay nombres Fudo en los últimos 2 meses para este local.'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filas.map((r) => {
              const checked = valueSet.has(r.nombre);
              const disabled = !!r.tomadoPor;
              return (
                <li
                  key={r.nombre}
                  className={`flex items-center gap-2 px-2 py-1.5 text-xs ${
                    disabled ? 'opacity-60' : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(r.nombre)}
                    className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span
                    className={`flex-1 truncate ${
                      r.historico ? 'text-gray-400 line-through' : 'text-gray-800'
                    }`}
                    title={r.nombre}
                  >
                    {r.nombre}
                  </span>
                  {r.historico ? (
                    <span className="text-[9px] italic text-gray-400">
                      no se vendió últ. 2 meses
                    </span>
                  ) : r.tomadoPor ? (
                    <span className="text-[9px] italic text-amber-600">
                      vinculado a {r.tomadoPor.tipo === 'receta' ? 'receta' : 'producto'} «
                      {r.tomadoPor.nombre}»
                    </span>
                  ) : (
                    <span className="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-600">
                      {r.uds} uds · {formatARS(r.total)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-[10px] italic text-gray-400">
        Marcá los nombres con los que este producto aparece en Fudo (últ. 2 meses). Los que
        ya están vinculados a otra receta/producto se ven en gris. Si vendiste algo hace más
        de 2 meses y lo querés desvincular, aparece tachado al final.
      </p>
    </div>
  );
}
