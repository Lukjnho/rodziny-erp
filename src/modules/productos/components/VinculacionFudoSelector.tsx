import { useMemo, useState } from 'react';
import { formatARS } from '@/lib/utils';
import { useFudoHuerfanos } from '@/modules/productos/hooks/useFudoHuerfanos';

// Selector de nombres Fudo para vincular a una receta vendible
// (cocina_recetas.fudo_productos[]) o a un cocina_producto (fudo_nombres[]).
//
// UX en 2 modos:
//  - Si el item YA tiene nombres vinculados: muestra chips compactos con ✕
//    para desmarcar, y un botón "+ Agregar otro nombre Fudo" que despliega
//    el modo lista.
//  - Si el item NO tiene nada vinculado (o tocó "+ Agregar"): buscador +
//    checklist con los nombres Fudo DISPONIBLES del local (huérfanos). Los
//    que ya están tomados por otra receta/producto se esconden — para robar
//    uno, hay que desvincularlo desde su ficha.
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
  // que un nombre vinculado a "mí mismo" igual aparezca como disponible.
  ownerKey?: string;
}) {
  const { data: huerfanos, isLoading } = useFudoHuerfanos(local);
  const [filtro, setFiltro] = useState('');
  const [agregando, setAgregando] = useState(false);

  const valueSet = useMemo(() => new Set(value.map((s) => s.trim())), [value]);

  const huerfanosByNombre = useMemo(() => {
    const m = new Map<string, { uds: number; total: number }>();
    for (const h of huerfanos ?? []) m.set(h.nombre, { uds: h.uds, total: h.total });
    return m;
  }, [huerfanos]);

  const filtroLower = filtro.trim().toLowerCase();

  // Nombres Fudo DISPONIBLES = huérfanos sin vinculación, o vinculados al
  // propio ownerKey (porque "mi" nombre debe poder volver a aparecer si lo
  // desmarco y quiero re-tildarlo en la misma sesión).
  const disponibles = useMemo(() => {
    if (!huerfanos) return [];
    const ownerKeyNorm = (ownerKey ?? '').trim();
    const rows = huerfanos.filter((h) => {
      // Ya tildados en value → los maneja el bloque de chips, no la lista.
      if (valueSet.has(h.nombre)) return false;
      if (!h.vinculadoA) return true;
      // Si está vinculado a mí mismo, lo considero disponible para re-tildar.
      return `${h.vinculadoA.tipo}:${h.vinculadoA.id}` === ownerKeyNorm;
    });
    if (!filtroLower) return rows;
    return rows.filter((r) => r.nombre.toLowerCase().includes(filtroLower));
  }, [huerfanos, valueSet, ownerKey, filtroLower]);

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

  const hayVinculados = value.length > 0;
  const mostrarLista = !hayVinculados || agregando;

  return (
    <div className="space-y-2">
      {hayVinculados && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            Vinculado a {value.length === 1 ? 'este nombre Fudo' : 'estos nombres Fudo'}
          </div>
          <ul className="space-y-1">
            {value.map((nombre) => {
              const info = huerfanosByNombre.get(nombre);
              const historico = !info;
              return (
                <li
                  key={nombre}
                  className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs"
                >
                  <span
                    className={`flex-1 truncate ${
                      historico ? 'text-gray-400 line-through' : 'text-emerald-900'
                    }`}
                    title={nombre}
                  >
                    ✓ {nombre}
                  </span>
                  {historico ? (
                    <span className="text-[9px] italic text-gray-400">
                      no se vendió últ. 2 meses
                    </span>
                  ) : (
                    <span className="whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[10px] tabular-nums text-emerald-700">
                      {info!.uds} uds · {formatARS(info!.total)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(nombre)}
                    title="Desvincular este nombre"
                    className="rounded px-1 text-sm leading-none text-emerald-700 hover:bg-emerald-100"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          {!mostrarLista && (
            <button
              type="button"
              onClick={() => setAgregando(true)}
              className="text-[11px] text-rodziny-700 hover:text-rodziny-800 hover:underline"
            >
              + Agregar otro nombre Fudo
            </button>
          )}
        </div>
      )}

      {mostrarLista && (
        <div className={hayVinculados ? 'rounded border border-gray-200 bg-gray-50 p-2' : ''}>
          {!hayVinculados && (
            <div className="mb-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              ⚠ <strong>Sin vincular aún.</strong> Elegí abajo el/los nombre(s) con los que
              este producto aparece en Fudo. Si no lo vinculás, las ventas no se descuentan ni
              entran al Menu Engineering.
            </div>
          )}
          {hayVinculados && (
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">
                Agregar otro nombre Fudo
              </span>
              <button
                type="button"
                onClick={() => {
                  setAgregando(false);
                  setFiltro('');
                }}
                className="text-[10px] text-gray-500 hover:text-gray-700"
              >
                cancelar
              </button>
            </div>
          )}
          <input
            type="text"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar nombre Fudo…"
            className="mb-1.5 w-full max-w-md rounded border border-gray-300 px-3 py-1.5 text-xs"
          />
          <div className="max-h-72 overflow-y-auto rounded border border-gray-200 bg-white">
            {disponibles.length === 0 ? (
              <p className="py-3 text-center text-[10px] italic text-gray-400">
                {filtroLower
                  ? 'Sin nombres Fudo libres que coincidan.'
                  : 'No hay nombres Fudo libres en los últimos 2 meses para este local.'}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {disponibles.map((h) => (
                  <li
                    key={h.nombre}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => {
                        toggle(h.nombre);
                        // Al tildar uno, volvemos al modo "chips" si vino de
                        // "+ Agregar"; queda visible para tildar varios.
                      }}
                      className="h-4 w-4 cursor-pointer"
                    />
                    <span className="flex-1 truncate text-gray-800" title={h.nombre}>
                      {h.nombre}
                    </span>
                    <span className="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-600">
                      {h.uds} uds · {formatARS(h.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-1 text-[10px] italic text-gray-400">
            Solo se listan nombres Fudo <strong>libres</strong> (no vinculados aún). Para robar
            un nombre de otra receta/producto, andá a su ficha y desmarcalo desde ahí.
          </p>
        </div>
      )}
    </div>
  );
}
