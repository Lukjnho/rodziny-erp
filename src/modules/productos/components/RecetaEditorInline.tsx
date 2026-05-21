import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn, formatARS } from '@/lib/utils';
import {
  AutocompleteIngrediente,
  CATEGORIAS,
  CATEGORIA_LABEL,
  ROLES,
  ROL_LABEL,
  mapearUnidad,
  UNIDADES,
  UNIDAD_LABEL,
  type ProductoCompras,
  type Receta,
  type RecetaTipo,
  type RecetaCategoria,
  type SubrecetaRol,
  type Ingrediente,
  type RendUnidad,
} from '@/modules/cocina/RecetasTab';
import {
  costearBorrador,
  type CosteoContext,
  type IngredienteRow,
  type RecetaRow,
} from '@/modules/cocina/lib/costeoEngine';

interface IngredienteForm {
  tempId: string;
  dbId: string | null; // null = nuevo
  nombre: string;
  cantidad: string;
  unidad: string;
  observaciones: string;
  producto_id: string | null;
}

const TIPOS_RECETA: RecetaTipo[] = ['receta', 'subreceta'];
const TIPO_LABEL_INLINE: Record<RecetaTipo, string> = {
  receta: 'Receta',
  subreceta: 'Subreceta',
};

// Editor inline de la receta (apartado ancho, NO modal). Misma lista que
// FichaTecnica pero editable, con el costo recalculando EN VIVO. Sirve para
// EDITAR (receta existente) y CREAR (receta = null → muestra nombre/tipo/local).
export function RecetaEditorInline({
  receta,
  ingredientes,
  todasLasRecetas,
  localRestringido,
  ctx,
  onCancel,
  onSaved,
}: {
  receta: Receta | null;
  ingredientes: Ingrediente[];
  todasLasRecetas: Receta[];
  localRestringido: 'vedia' | 'saavedra' | null;
  ctx: CosteoContext | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const creando = !receta;
  // Id estable para previsualizar el costo de una receta nueva sin guardar.
  const [recetaIdLocal] = useState<string>(() => receta?.id ?? crypto.randomUUID());

  const [nombre, setNombre] = useState<string>(receta?.nombre ?? '');
  const [tipo, setTipo] = useState<RecetaTipo>(receta?.tipo ?? 'subreceta');
  const [categoria, setCategoria] = useState<RecetaCategoria | ''>(receta?.categoria ?? '');
  const [rol, setRol] = useState<SubrecetaRol | ''>(receta?.rol ?? '');
  const [localState, setLocalState] = useState<string>(
    receta?.local ?? localRestringido ?? 'vedia',
  );

  const [ings, setIngs] = useState<IngredienteForm[]>(() =>
    ingredientes.map((ing) => ({
      tempId: ing.id,
      dbId: ing.id,
      nombre: ing.nombre,
      cantidad: String(ing.cantidad),
      unidad: ing.unidad,
      observaciones: ing.observaciones ?? '',
      producto_id: ing.producto_id,
    })),
  );
  const [rendKg, setRendKg] = useState<string>(
    receta?.rendimiento_kg != null ? String(receta.rendimiento_kg) : '',
  );
  const [rendUnidad, setRendUnidad] = useState<RendUnidad>(receta?.rendimiento_unidad ?? 'kg');
  const [rendPorciones, setRendPorciones] = useState<string>(
    receta?.rendimiento_porciones != null ? String(receta.rendimiento_porciones) : '',
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  // Solo al CREAR una receta tipo Pasta: producto (pasta) al que se le vincula
  // la receta recién creada, en un solo paso (evita ir al ABM aparte).
  const [productoDestino, setProductoDestino] = useState('');

  const local = creando ? localState : (receta?.local ?? localRestringido ?? 'vedia');

  // Pastas del local sin receta vinculada (candidatas a enganchar la nueva).
  const { data: pastasSinReceta } = useQuery({
    queryKey: ['pastas-sin-receta', local],
    enabled: creando && categoria === 'pasta',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo')
        .eq('local', local)
        .eq('tipo', 'pasta')
        .eq('activo', true)
        .is('receta_id', null)
        .order('nombre');
      if (error) throw error;
      return data as { id: string; nombre: string; codigo: string }[];
    },
  });

  const { data: productosCompras } = useQuery({
    queryKey: ['productos-compras-recetas', local],
    queryFn: async () => {
      let q = supabase
        .from('productos')
        .select('id, nombre, marca, unidad, categoria, local')
        .eq('activo', true)
        .order('nombre');
      if (local === 'vedia') q = q.eq('local', 'vedia');
      else if (local === 'saavedra') q = q.eq('local', 'saavedra');
      const { data, error } = await q;
      if (error) throw error;
      return data as ProductoCompras[];
    },
  });

  function agregarIngrediente() {
    setIngs((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        dbId: null,
        nombre: '',
        cantidad: '',
        unidad: 'g',
        observaciones: '',
        producto_id: null,
      },
    ]);
  }

  function actualizarIng(tempId: string, campo: keyof IngredienteForm, valor: string) {
    setIngs((prev) => prev.map((i) => (i.tempId === tempId ? { ...i, [campo]: valor } : i)));
  }

  function seleccionarProducto(
    tempId: string,
    producto: ProductoCompras,
    tipo: 'receta' | 'producto',
  ) {
    setIngs((prev) =>
      prev.map((i) =>
        i.tempId === tempId
          ? {
              ...i,
              nombre: tipo === 'receta' ? `Subreceta ${producto.nombre}` : producto.nombre,
              producto_id: tipo === 'receta' ? null : producto.id,
              unidad: mapearUnidad(producto.unidad),
            }
          : i,
      ),
    );
  }

  function eliminarIng(tempId: string) {
    setIngs((prev) => prev.filter((i) => i.tempId !== tempId));
  }

  function moverIng(tempId: string, dir: -1 | 1) {
    setIngs((prev) => {
      const idx = prev.findIndex((i) => i.tempId === tempId);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copia = [...prev];
      [copia[idx], copia[newIdx]] = [copia[newIdx], copia[idx]];
      return copia;
    });
  }

  // Solo subrecetas del MISMO local de la receta (más null/'ambos' por las
  // dudas, hoy no hay). Evita listar masas/rellenos del otro local — y el
  // costeoEngine resuelve la subreceta por (nombre, local) igual.
  const recetasDelLocal = useMemo(
    () =>
      todasLasRecetas.filter(
        (r) => !r.local || r.local === 'ambos' || r.local === local,
      ),
    [todasLasRecetas, local],
  );

  // ─── Costo en vivo ─────────────────────────────────────────────────────────
  const costo = useMemo(() => {
    if (!ctx) return undefined;
    const draftRows: IngredienteRow[] = ings
      .filter((i) => i.nombre.trim() && String(i.cantidad).trim() !== '')
      .map((i, idx) => ({
        id: i.tempId,
        receta_id: recetaIdLocal,
        nombre: i.nombre.trim(),
        cantidad: Number(String(i.cantidad).replace(',', '.')) || 0,
        unidad: i.unidad,
        orden: idx,
        producto_id: i.producto_id || null,
      }));
    const recetaRow: RecetaRow = {
      id: recetaIdLocal,
      nombre: creando ? nombre : (receta?.nombre ?? ''),
      tipo: creando ? tipo : (receta?.tipo ?? ''),
      rendimiento_kg: rendKg !== '' ? Number(String(rendKg).replace(',', '.')) : null,
      rendimiento_porciones:
        rendPorciones !== '' ? Number(String(rendPorciones).replace(',', '.')) : null,
      local: creando ? localState : (receta?.local ?? null),
    };
    return costearBorrador(recetaRow, draftRows, ctx);
  }, [ctx, ings, rendKg, rendPorciones, recetaIdLocal, creando, nombre, tipo, localState, receta]);

  const detallePorId = useMemo(
    () => new Map(costo?.detalles.map((d) => [d.id, d]) ?? []),
    [costo],
  );

  const unidadLabel = UNIDAD_LABEL[rendUnidad];

  // ─── Guardar (rendimiento + ingredientes, en lote) ─────────────────────────
  const guardar = async () => {
    if (creando && !nombre.trim()) {
      setError('El nombre de la receta es obligatorio');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      const rendKgNum = rendKg !== '' ? Number(String(rendKg).replace(',', '.')) : null;
      const rendPorcNum =
        rendPorciones !== '' ? Number(String(rendPorciones).replace(',', '.')) : null;

      // Validación tipo↔categoria/rol (replica el CHECK de DB en cliente)
      if (tipo === 'receta' && !categoria) {
        throw new Error('Las recetas vendibles requieren categoría');
      }
      if (tipo === 'subreceta' && !rol) {
        throw new Error('Las subrecetas requieren rol');
      }
      const tipoPayload = {
        tipo,
        categoria: tipo === 'receta' ? categoria : null,
        rol: tipo === 'subreceta' ? rol : null,
      };
      let recetaId: string;
      if (creando) {
        const { data, error: errIns } = await supabase
          .from('cocina_recetas')
          .insert({
            nombre: nombre.trim(),
            ...tipoPayload,
            local: localState,
            activo: true,
            rendimiento_kg: rendKgNum,
            rendimiento_unidad: rendUnidad,
            rendimiento_porciones: rendPorcNum,
          })
          .select('id')
          .single();
        if (errIns) throw errIns;
        recetaId = data.id as string;
      } else {
        recetaId = receta!.id;
        const { error: errReceta } = await supabase
          .from('cocina_recetas')
          .update({
            ...tipoPayload,
            rendimiento_kg: rendKgNum,
            rendimiento_unidad: rendUnidad,
            rendimiento_porciones: rendPorcNum,
            updated_at: new Date().toISOString(),
          })
          .eq('id', recetaId);
        if (errReceta) throw errReceta;
      }

      // Sync ingredientes — borrar los que ya no están (solo en edición)
      const idsActuales = ings.filter((i) => i.dbId).map((i) => i.dbId!);
      const idsABorrar = ingredientes
        .map((i) => i.id)
        .filter((id) => !idsActuales.includes(id));
      if (idsABorrar.length > 0) {
        const { error: delErr } = await supabase
          .from('cocina_receta_ingredientes')
          .delete()
          .in('id', idsABorrar);
        if (delErr) throw delErr;
      }

      // Upsert (update existentes + insert nuevos)
      for (let i = 0; i < ings.length; i++) {
        const ing = ings[i];
        if (!ing.nombre.trim() || !ing.cantidad) continue;
        const payload = {
          receta_id: recetaId,
          nombre: ing.nombre.trim(),
          cantidad: Number(String(ing.cantidad).replace(',', '.')),
          unidad: ing.unidad,
          observaciones: ing.observaciones.trim() || null,
          orden: i,
          producto_id: ing.producto_id || null,
        };
        if (ing.dbId) {
          const { error: updErr } = await supabase
            .from('cocina_receta_ingredientes')
            .update(payload)
            .eq('id', ing.dbId);
          if (updErr) throw updErr;
        } else {
          const { error: insErr } = await supabase
            .from('cocina_receta_ingredientes')
            .insert(payload);
          if (insErr) throw insErr;
        }
      }

      // Vincular la receta nueva al producto pasta elegido (un solo paso).
      if (creando && productoDestino) {
        const { error: errLink } = await supabase
          .from('cocina_productos')
          .update({ receta_id: recetaId })
          .eq('id', productoDestino);
        if (errLink) throw errLink;
        // Refrescar consumidores de cocina_productos.receta_id (grid Costeo,
        // resumen semanal, dashboard, ABM).
        qc.invalidateQueries({ queryKey: ['pastas-sin-receta'] });
        qc.invalidateQueries({ queryKey: ['cocina-productos-sugerencias-plan'] });
        qc.invalidateQueries({ queryKey: ['cocina_productos_dashboard'] });
        qc.invalidateQueries({ queryKey: ['producto-form'] });
      }

      onSaved();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : ((err as { message?: string })?.message ?? 'Error desconocido');
      setError(msg);
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4">
      {creando && (
        <div className="grid gap-4 rounded-lg border border-rodziny-200 bg-white p-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Nombre de la receta
            </label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Relleno Jamón, Queso y Cebolla"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Tipo
            </label>
            <select
              value={tipo}
              onChange={(e) => {
                const next = e.target.value as RecetaTipo;
                setTipo(next);
                if (next === 'receta') setRol('');
                else setCategoria('');
              }}
              className="w-full rounded border border-gray-300 px-2 py-2 text-sm capitalize"
            >
              {TIPOS_RECETA.map((t) => (
                <option key={t} value={t}>
                  {TIPO_LABEL_INLINE[t]}
                </option>
              ))}
            </select>
          </div>
          {tipo === 'receta' ? (
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Categoría
              </label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as RecetaCategoria)}
                className="w-full rounded border border-gray-300 px-2 py-2 text-sm"
              >
                <option value="">— Elegí —</option>
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIA_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Rol
              </label>
              <select
                value={rol}
                onChange={(e) => setRol(e.target.value as SubrecetaRol)}
                className="w-full rounded border border-gray-300 px-2 py-2 text-sm"
              >
                <option value="">— Elegí —</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROL_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Local
            </label>
            <select
              value={localState}
              onChange={(e) => setLocalState(e.target.value)}
              disabled={!!localRestringido}
              className="w-full rounded border border-gray-300 px-2 py-2 text-sm capitalize disabled:bg-gray-100"
            >
              <option value="vedia">Vedia</option>
              <option value="saavedra">Saavedra</option>
            </select>
          </div>
          {tipo === 'subreceta' && (
            <p className="text-[10px] text-purple-600 sm:col-span-3">
              Marcada como <strong>subreceta</strong>: se usa como ingrediente de otras recetas,
              no es objetivo de producción standalone.
            </p>
          )}
          {categoria === 'pasta' && (
            <p className="text-[10px] text-red-600 sm:col-span-3">
              Pasta armada: agregá tu <strong>masa</strong> y tu <strong>relleno</strong> como
              ingredientes (escribí el nombre y elegilos del buscador — aparecen como receta, en
              kg) más cualquier insumo extra. Cargá el <strong>rendimiento en porciones</strong>{' '}
              para obtener el costo por porción.
            </p>
          )}
          {categoria === 'pasta' && (
            <div className="sm:col-span-3">
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Vincular a producto (opcional)
              </label>
              <select
                value={productoDestino}
                onChange={(e) => setProductoDestino(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-2 text-sm"
              >
                <option value="">— No vincular ahora —</option>
                {(pastasSinReceta ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-gray-500">
                Al guardar, esta receta queda enganchada al producto elegido (su costo/porción
                pasa a usarse en Costeo y el resumen semanal). Lista: pastas de {local} sin
                receta.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Rendimiento editable (manda el costo /kg y /porción) */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-rodziny-200 bg-rodziny-50/40 p-3">
        {!creando && (
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Tipo
            </label>
            <select
              value={tipo}
              onChange={(e) => {
                const next = e.target.value as RecetaTipo;
                setTipo(next);
                if (next === 'receta') setRol('');
                else setCategoria('');
              }}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm capitalize"
            >
              {TIPOS_RECETA.map((t) => (
                <option key={t} value={t} className="capitalize">
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Rendimiento total
          </label>
          <div className="flex gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={rendKg}
              onChange={(e) => setRendKg(e.target.value)}
              placeholder="5,5"
              className="w-24 rounded border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums"
            />
            <select
              value={rendUnidad}
              onChange={(e) => setRendUnidad(e.target.value as RendUnidad)}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              <option value="kg">kg</option>
              <option value="l">L</option>
              <option value="unidad">unid.</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Porciones
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={rendPorciones}
            onChange={(e) => setRendPorciones(e.target.value)}
            placeholder="45"
            className="w-24 rounded border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums"
          />
        </div>
        <div className="ml-auto flex gap-3 text-right">
          {costo?.costoPorKg != null && (
            <div className="rounded border border-gray-200 bg-white px-3 py-1.5">
              <div className="text-sm font-bold tabular-nums text-rodziny-700">
                {formatARS(costo.costoPorKg)}
              </div>
              <div className="text-[9px] uppercase text-gray-400">por {unidadLabel}</div>
            </div>
          )}
          {costo?.costoPorPorcion != null && (
            <div className="rounded border border-gray-200 bg-white px-3 py-1.5">
              <div className="text-sm font-bold tabular-nums text-rodziny-700">
                {formatARS(costo.costoPorPorcion)}
              </div>
              <div className="text-[9px] uppercase text-gray-400">por porción</div>
            </div>
          )}
        </div>
      </div>

      {/* Tabla editable con costo en vivo */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="grid grid-cols-[20px_minmax(0,1fr)_92px_72px_minmax(0,1fr)_110px_64px] gap-2 border-b border-gray-200 bg-gray-100 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          <span></span>
          <span>Ingrediente</span>
          <span className="text-right">Cantidad</span>
          <span>Unidad</span>
          <span>Observaciones</span>
          <span className="text-right">Costo</span>
          <span className="text-right">Acciones</span>
        </div>

        {ings.length === 0 ? (
          <p className="py-6 text-center text-xs italic text-gray-400">
            Sin ingredientes. Agregá el primero abajo.
          </p>
        ) : (
          ings.map((ing, idx) => {
            const det = detallePorId.get(ing.tempId);
            return (
              <div
                key={ing.tempId}
                className={cn(
                  'grid grid-cols-[20px_minmax(0,1fr)_92px_72px_minmax(0,1fr)_110px_64px] items-center gap-2 border-b border-gray-100 px-2 py-1 last:border-b-0 hover:bg-rodziny-50/40',
                  idx % 2 === 1 ? 'bg-gray-50/40' : 'bg-white',
                )}
              >
                {det?.error ? (
                  <span
                    title={det.error}
                    className="cursor-help text-center text-xs text-amber-500"
                  >
                    ⚠
                  </span>
                ) : det?.esSubreceta ? (
                  <span
                    title="Subreceta"
                    className="text-center text-[9px] font-semibold text-purple-600"
                  >
                    Sub
                  </span>
                ) : (
                  <span />
                )}
                <AutocompleteIngrediente
                  valor={ing.nombre}
                  productos={productosCompras ?? []}
                  recetas={recetasDelLocal}
                  recetaActualId={receta?.id ?? recetaIdLocal}
                  onChange={(v) => actualizarIng(ing.tempId, 'nombre', v)}
                  onSelect={(p, t) => seleccionarProducto(ing.tempId, p, t)}
                  tiposPrioritarios={categoria === 'pasta' ? ['masa', 'relleno'] : undefined}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={ing.cantidad}
                  onChange={(e) => actualizarIng(ing.tempId, 'cantidad', e.target.value)}
                  placeholder="0"
                  className="focus:border-rodziny-300 w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm tabular-nums outline-none placeholder:text-gray-300 focus:bg-white"
                />
                <select
                  value={ing.unidad}
                  onChange={(e) => actualizarIng(ing.tempId, 'unidad', e.target.value)}
                  className="focus:border-rodziny-300 w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm outline-none hover:bg-white focus:bg-white"
                >
                  {UNIDADES.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <input
                  value={ing.observaciones}
                  onChange={(e) => actualizarIng(ing.tempId, 'observaciones', e.target.value)}
                  placeholder="—"
                  className="focus:border-rodziny-300 w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs text-gray-600 outline-none placeholder:text-gray-300 focus:bg-white"
                />
                <span className="pr-1 text-right text-sm font-medium tabular-nums text-gray-800">
                  {det?.costoTotal != null ? (
                    formatARS(det.costoTotal)
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </span>
                <div className="flex items-center justify-end gap-0.5">
                  <button
                    onClick={() => moverIng(ing.tempId, -1)}
                    disabled={idx === 0}
                    className="px-1 text-[10px] text-gray-400 hover:text-gray-600 disabled:opacity-20"
                    title="Subir"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moverIng(ing.tempId, 1)}
                    disabled={idx === ings.length - 1}
                    className="px-1 text-[10px] text-gray-400 hover:text-gray-600 disabled:opacity-20"
                    title="Bajar"
                  >
                    ▼
                  </button>
                  <button
                    onClick={() => eliminarIng(ing.tempId)}
                    className="px-1 text-xs text-red-400 hover:text-red-600"
                    title="Eliminar"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })
        )}

        {/* Totales en vivo */}
        {costo && ings.length > 0 && (
          <div className="border-t-2 border-gray-200 bg-gray-50 px-2 py-2 text-sm">
            <div className="flex justify-between px-1 py-0.5">
              <span className="font-semibold text-gray-700">Costo base</span>
              <span className="font-semibold tabular-nums text-gray-800">
                {formatARS(costo.costoBase)}
              </span>
            </div>
            {costo.margenPct > 0 && (
              <>
                <div className="flex justify-between px-1 py-0.5 text-gray-500">
                  <span>Margen de seguridad ({(costo.margenPct * 100).toFixed(1)}%)</span>
                  <span className="tabular-nums">
                    +{formatARS(costo.costoConMargen - costo.costoBase)}
                  </span>
                </div>
                <div className="flex justify-between px-1 py-0.5">
                  <span className="font-bold text-rodziny-700">Total con margen</span>
                  <span className="font-bold tabular-nums text-rodziny-700">
                    {formatARS(costo.costoConMargen)}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <button
        onClick={agregarIngrediente}
        className="hover:border-rodziny-300 w-full rounded-lg border-2 border-dashed border-gray-300 py-2 text-sm text-gray-500 transition-colors hover:text-rodziny-700"
      >
        + Agregar ingrediente
      </button>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-200 bg-white py-3">
        <button
          onClick={onCancel}
          disabled={guardando}
          className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={guardar}
          disabled={guardando}
          className="rounded bg-rodziny-700 px-4 py-1.5 text-sm text-white hover:bg-rodziny-800 disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Guardar receta'}
        </button>
      </div>
    </div>
  );
}
