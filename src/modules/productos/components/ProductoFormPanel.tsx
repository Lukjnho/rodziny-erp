import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS } from '@/lib/utils';
import { useCostosRecetas } from '@/modules/cocina/hooks/useCostosRecetas';

// ABM de cocina_productos como APARTADO inline ancho (no modal): alta/edición
// de la definición del producto + vincular receta existente + activo + eliminar.
// Self-contained: trae el producto (si edita) y las recetas por su cuenta.

const TIPOS = ['pasta', 'salsa', 'postre', 'relleno', 'masa', 'panificado', 'bebida'] as const;
const TIPO_LABEL: Record<string, string> = {
  pasta: 'Pasta',
  salsa: 'Salsa',
  postre: 'Postre',
  relleno: 'Relleno',
  masa: 'Masa',
  panificado: 'Panificado',
  bebida: 'Bebida',
};
// producto.tipo → tipos de receta candidatas (igual que el QR de cocina).
const TIPOS_RECETA_POR_PRODUCTO: Record<string, string[]> = {
  pasta: ['relleno', 'masa'],
  salsa: ['salsa'],
  postre: ['postre'],
  relleno: ['relleno'],
  masa: ['masa'],
  panificado: ['pasteleria', 'panaderia'],
  bebida: ['otro'], // jarras de limonada/naranja (elaboradas)
};
const LABEL_GRUPO_RECETA: Record<string, string> = {
  relleno: 'Rellenos',
  masa: 'Masas',
  salsa: 'Salsas',
  postre: 'Postres',
  pasteleria: 'Pastelería',
  panaderia: 'Panadería',
  otro: 'Otras recetas',
};

// Código de lote auto: slug de la 1ª palabra del nombre (sin tildes/ñ, alfanum,
// 4 chars) + sufijo numérico si choca con uno existente. cocina_productos.codigo
// es NOT NULL + UNIQUE. Solo se usa al CREAR; al editar no se toca.
function generarCodigo(nombre: string, existentes: Set<string>): string {
  const base =
    nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ñ/g, 'n')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)[0]
      ?.slice(0, 4) || 'prod';
  if (!existentes.has(base)) return base;
  let i = 2;
  while (existentes.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

interface RecetaOpcion {
  id: string;
  nombre: string;
  tipo: string | null;
  local: string | null;
}

interface ProductoRow {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  unidad: string;
  minimo_produccion: number | null;
  local: string;
  activo: boolean;
  receta_id: string | null;
  insumo_reventa_id: string | null;
  fudo_nombres: string[] | null;
}

interface InsumoOpcion {
  id: string;
  nombre: string;
  marca: string | null;
  costo_unitario: number;
}

export function ProductoFormPanel({
  productoId,
  onVolver,
  onSaved,
}: {
  productoId: string | null; // null = nuevo
  onVolver: () => void;
  onSaved: () => void;
}) {
  const esEdicion = !!productoId;

  const { data: producto, isLoading: cargandoProducto } = useQuery({
    queryKey: ['producto-form', productoId],
    enabled: esEdicion,
    queryFn: async (): Promise<ProductoRow | null> => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, tipo, unidad, minimo_produccion, local, activo, receta_id, insumo_reventa_id, fudo_nombres')
        .eq('id', productoId)
        .maybeSingle();
      if (error) throw error;
      return data as ProductoRow | null;
    },
  });

  const { data: insumos } = useQuery({
    queryKey: ['producto-form-insumos'],
    queryFn: async (): Promise<InsumoOpcion[]> => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, marca, costo_unitario')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as InsumoOpcion[];
    },
  });

  const { data: recetas } = useQuery({
    queryKey: ['producto-form-recetas'],
    queryFn: async (): Promise<RecetaOpcion[]> => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, local')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as RecetaOpcion[];
    },
  });

  if (esEdicion && cargandoProducto) {
    return (
      <div className="space-y-4">
        <button
          onClick={onVolver}
          className="text-sm text-rodziny-700 hover:text-rodziny-900"
        >
          ← Volver a productos
        </button>
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-8 text-sm text-gray-500">
          Cargando producto…
        </div>
      </div>
    );
  }

  return (
    <FormInterno
      key={producto?.id ?? 'nuevo'}
      producto={producto ?? null}
      recetas={recetas ?? []}
      insumos={insumos ?? []}
      onVolver={onVolver}
      onSaved={onSaved}
    />
  );
}

function FormInterno({
  producto,
  recetas,
  insumos,
  onVolver,
  onSaved,
}: {
  producto: ProductoRow | null;
  recetas: RecetaOpcion[];
  insumos: InsumoOpcion[];
  onVolver: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(producto?.nombre ?? '');
  const [tipo, setTipo] = useState<string>(producto?.tipo ?? 'pasta');
  const [unidad, setUnidad] = useState(producto?.unidad ?? 'porciones');
  const [local, setLocal] = useState(producto?.local ?? 'vedia');
  const [recetaId, setRecetaId] = useState<string>(producto?.receta_id ?? '');
  const [insumoReventaId, setInsumoReventaId] = useState<string>(
    producto?.insumo_reventa_id ?? '',
  );
  const [activo, setActivo] = useState<boolean>(producto?.activo ?? true);
  const [fudoNombres, setFudoNombres] = useState<string>(
    (producto?.fudo_nombres ?? []).join('\n'),
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const { costos } = useCostosRecetas();

  // Para generar un código único al crear (no se usa al editar).
  const { data: codigosExistentes } = useQuery({
    queryKey: ['producto-form-codigos'],
    enabled: !producto,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from('cocina_productos').select('codigo');
      if (error) throw error;
      return (data ?? []).map((r: { codigo: string }) => (r.codigo ?? '').toLowerCase());
    },
  });

  const recetasFiltradas = useMemo(() => {
    const tiposPermitidos = TIPOS_RECETA_POR_PRODUCTO[tipo] ?? [];
    const filtradas = recetas.filter(
      (r) => r.local === local && tiposPermitidos.includes(r.tipo ?? ''),
    );
    if (recetaId && !filtradas.some((r) => r.id === recetaId)) {
      const actual = recetas.find((r) => r.id === recetaId);
      if (actual) return [actual, ...filtradas];
    }
    return filtradas;
  }, [recetas, local, tipo, recetaId]);

  const costoPreview = useMemo(() => {
    if (!recetaId) return null;
    const c = costos.get(recetaId);
    if (!c) return null;
    const u = unidad.toLowerCase();
    const esPeso = u === 'kg' || u === 'litros' || u === 'lt';
    if (esPeso && c.costoPorKg != null) return { costo: c.costoPorKg, base: 'kg' };
    if (!esPeso && c.costoPorPorcion != null) return { costo: c.costoPorPorcion, base: 'porción' };
    return null;
  }, [recetaId, unidad, costos]);

  const guardar = async () => {
    if (!nombre.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    setGuardando(true);
    setError('');
    // Campos comunes. NO incluye `codigo` ni `minimo_produccion`:
    //  - código: se autogenera SOLO al crear; al editar no se toca (UNIQUE + atado a lotes).
    //  - minimo_produccion: fuera del form; usa el default de la base (100).
    const row = {
      nombre: nombre.trim(),
      tipo,
      unidad,
      local,
      activo,
      receta_id: recetaId || null,
      // Reventa y receta son excluyentes: si hay receta, manda receta.
      insumo_reventa_id: recetaId ? null : insumoReventaId || null,
      fudo_nombres: fudoNombres
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const { error: err } = producto
      ? await supabase.from('cocina_productos').update(row).eq('id', producto.id)
      : await supabase.from('cocina_productos').insert({
          ...row,
          codigo: generarCodigo(nombre, new Set(codigosExistentes ?? [])),
        });
    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onSaved();
  };

  const eliminar = async () => {
    if (!producto) return;
    if (!window.confirm(`¿Eliminar "${producto.nombre}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    setGuardando(true);
    setError('');
    const { error: err } = await supabase
      .from('cocina_productos')
      .delete()
      .eq('id', producto.id);
    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onSaved();
  };

  const labelCls = 'mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500';
  const inputCls = 'w-full rounded border border-gray-300 px-3 py-2 text-sm';

  return (
    <div className="space-y-4">
      <button
        onClick={onVolver}
        className="text-sm text-rodziny-700 hover:text-rodziny-900"
      >
        ← Volver a productos
      </button>

      <section className="rounded-lg border border-rodziny-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">
          {producto ? `Editar definición · ${producto.nombre}` : 'Nuevo producto'}
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Definición del producto y receta vinculada. El precio de venta se carga en el tab{' '}
          <strong>Menú</strong>.
        </p>
      </section>

      <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className={labelCls}>Nombre</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={inputCls}
            placeholder="Sorrentino Jamón y Queso"
            autoFocus
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Tipo</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className={inputCls}
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {TIPO_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Unidad</label>
            <select
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              className={inputCls}
            >
              <option value="porciones">Porciones</option>
              <option value="unidades">Unidades</option>
              <option value="kg">Kg</option>
              <option value="litros">Litros</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Local</label>
            <select
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              className={inputCls}
            >
              <option value="vedia">Vedia</option>
              <option value="saavedra">Saavedra</option>
            </select>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <label className={labelCls}>Receta vinculada</label>
          <select
            value={recetaId}
            onChange={(e) => setRecetaId(e.target.value)}
            className={`${inputCls} max-w-md`}
          >
            <option value="">— Sin receta —</option>
            {(TIPOS_RECETA_POR_PRODUCTO[tipo] ?? []).map((tipoReceta) => {
              const recetasGrupo = recetasFiltradas.filter((r) => r.tipo === tipoReceta);
              if (recetasGrupo.length === 0) return null;
              return (
                <optgroup key={tipoReceta} label={LABEL_GRUPO_RECETA[tipoReceta] ?? tipoReceta}>
                  {recetasGrupo.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nombre}
                    </option>
                  ))}
                </optgroup>
              );
            })}
            {recetasFiltradas
              .filter((r) => !(TIPOS_RECETA_POR_PRODUCTO[tipo] ?? []).includes(r.tipo ?? ''))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre} (vínculo previo)
                </option>
              ))}
            {recetasFiltradas.length === 0 && (
              <option disabled>
                (No hay recetas {TIPO_LABEL[tipo]?.toLowerCase()} cargadas en {local})
              </option>
            )}
          </select>
          {costoPreview && (
            <div className="mt-2 inline-flex gap-2 rounded bg-gray-50 px-3 py-1.5 text-xs">
              <span className="text-gray-500">Costo calculado:</span>
              <span className="font-medium tabular-nums text-gray-800">
                {formatARS(costoPreview.costo)} / {costoPreview.base}
              </span>
            </div>
          )}
          <p className="mt-2 text-[10px] italic text-gray-400">
            Elaborado (ej. jarra de limonada) → vinculá su receta. Si no tiene receta, no aparece
            en el grid de Costeo hasta vincularle una.
          </p>
        </div>

        {tipo === 'bebida' && (
          <div className="border-t border-gray-100 pt-4">
            <label className={labelCls}>Insumo de reventa (bebida comprada)</label>
            <select
              value={insumoReventaId}
              onChange={(e) => setInsumoReventaId(e.target.value)}
              disabled={!!recetaId}
              className={`${inputCls} max-w-md disabled:bg-gray-100 disabled:text-gray-400`}
            >
              <option value="">— Sin insumo de reventa —</option>
              {insumos.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.marca ? `${i.nombre} ${i.marca}` : i.nombre}
                </option>
              ))}
            </select>
            {recetaId ? (
              <p className="mt-2 text-[10px] italic text-amber-600">
                Tiene receta vinculada → es elaborada (jarra), no reventa. Sacá la receta para
                marcarla como reventa.
              </p>
            ) : (
              (() => {
                const ins = insumos.find((i) => i.id === insumoReventaId);
                return ins ? (
                  <div className="mt-2 inline-flex gap-2 rounded bg-gray-50 px-3 py-1.5 text-xs">
                    <span className="text-gray-500">Costo de compra:</span>
                    <span className="font-medium tabular-nums text-gray-800">
                      {formatARS(ins.costo_unitario)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] italic text-gray-400">
                    Reventa: comprás esta bebida terminada y la vendés. El costo sale del insumo
                    (se actualiza solo con las compras). El precio de venta va en el tab Menú.
                  </p>
                );
              })()
            )}
          </div>
        )}

        <div className="border-t border-gray-100 pt-4">
          <label className={labelCls}>
            Nombres en Fudo <span className="normal-case text-gray-400">(uno por línea)</span>
          </label>
          <textarea
            value={fudoNombres}
            onChange={(e) => setFudoNombres(e.target.value)}
            rows={3}
            className={`${inputCls} max-w-md font-mono text-xs`}
            placeholder={'Sorrentino Jamón, Queso y Cebollas\nSorrentino Jamón, Cebollas y Quesos VIANDA'}
          />
          <p className="mt-1 text-[10px] italic text-gray-400">
            Cómo aparece este producto en el reporte de Fudo. Si está vacío, no se descuenta del
            stock por venta. Copialo tal cual aparece en Fudo (con tildes y mayúsculas).
          </p>
        </div>

        <label className="flex items-center gap-2 border-t border-gray-100 pt-4 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
            className="h-4 w-4"
          />
          Producto activo
        </label>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-4">
          {producto ? (
            <button
              onClick={eliminar}
              disabled={guardando}
              className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              Eliminar producto
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onVolver}
              disabled={guardando}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando}
              className="rounded bg-rodziny-700 px-5 py-2 text-sm font-semibold text-white hover:bg-rodziny-800 disabled:opacity-50"
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
