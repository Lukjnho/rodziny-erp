import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { PRODUCTOS_COCINA, normNombre } from '../DashboardTab';

interface Receta {
  id: string;
  nombre: string;
  tipo: string;
  local: string | null;
}

interface Sugerencia {
  key: string;
  productoNombre: string;
  recetaId: string;
  recetaNombre: string;
  tipoPlan: TipoItem;
  cantidadRecetas: number;
  porcionesFaltantes: number;
  diasRestantes: number | null;
  urgencia: 'critico' | 'bajo';
}

type TipoItem = 'relleno' | 'masa' | 'salsa' | 'postre' | 'pasteleria' | 'panaderia';

interface PlanItem {
  id: string;
  tipo: TipoItem;
  receta_id: string | null;
  texto_libre: string | null;
  cantidad_recetas: number;
  turno: 'mañana' | 'tarde' | null;
  notas: string | null;
  estado?: 'pendiente' | 'en_produccion' | 'en_bandejas' | 'ciclo_completo' | 'cancelado';
}

// Las masas no se planifican acá — se hacen a demanda según producción.
const TIPOS_VEDIA: { tipo: TipoItem; label: string; emoji: string }[] = [
  { tipo: 'relleno', label: 'Rellenos', emoji: '🥟' },
  { tipo: 'salsa', label: 'Salsas', emoji: '🍅' },
  { tipo: 'postre', label: 'Postres', emoji: '🍰' },
];

const TIPOS_SAAVEDRA: { tipo: TipoItem; label: string; emoji: string }[] = [
  { tipo: 'relleno', label: 'Rellenos', emoji: '🥟' },
  { tipo: 'salsa', label: 'Salsas', emoji: '🍅' },
  { tipo: 'pasteleria', label: 'Pastelería', emoji: '🥐' },
  { tipo: 'panaderia', label: 'Panadería', emoji: '🍞' },
];

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function sumarDias(fecha: string, dias: number) {
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function formatFecha(fecha: string) {
  const d = new Date(fecha + 'T12:00:00');
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' });
}

function nuevoId() {
  return `tmp-${crypto.randomUUID()}`;
}

export function PlanProduccionEditor({
  local,
  onClose,
}: {
  local: 'vedia' | 'saavedra';
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fechas = useMemo(() => [hoy(), sumarDias(hoy(), 1), sumarDias(hoy(), 2)], []);
  const [fechaActiva, setFechaActiva] = useState(fechas[0]);

  const tipos = local === 'vedia' ? TIPOS_VEDIA : TIPOS_SAAVEDRA;

  // Catálogo de recetas activas del local
  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas-plan', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, local')
        .eq('activo', true)
        .or(`local.eq.${local},local.is.null`)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as Receta[];
    },
  });

  // Items existentes del plan (3 días)
  const { data: itemsExistentes } = useQuery({
    queryKey: ['cocina-pizarron-editor', local, fechas[0], fechas[2]],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pizarron_items')
        .select(
          'id, fecha_objetivo, local, turno, tipo, receta_id, texto_libre, cantidad_recetas, estado, notas',
        )
        .eq('local', local)
        .gte('fecha_objetivo', fechas[0])
        .lte('fecha_objetivo', fechas[2]);
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Datos para sugerencias (mismo cálculo que el dashboard, simplificado) ──
  const hace14 = useMemo(
    () => new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0],
    [],
  );
  const hoyStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Catálogo de productos con receta vinculada
  type ProductoBD = {
    nombre: string;
    tipo: string;
    receta_id: string | null;
    minimo_produccion: number | null;
    receta: {
      id: string;
      nombre: string;
      tipo: string | null;
      rendimiento_porciones: number | null;
      rendimiento_kg: number | null;
    } | null;
  };

  const { data: productosBD } = useQuery({
    queryKey: ['cocina-productos-sugerencias-plan', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select(
          'nombre, tipo, receta_id, minimo_produccion, receta:cocina_recetas(id, nombre, tipo, rendimiento_porciones, rendimiento_kg)',
        )
        .eq('local', local)
        .eq('activo', true);
      if (error) throw error;
      const m = new Map<string, ProductoBD>();
      for (const r of (data ?? []) as unknown as ProductoBD[]) m.set(normNombre(r.nombre), r);
      return m;
    },
  });

  // Stock vendible de pastas (cámara − traspasos − merma)
  const { data: stockPastas } = useQuery({
    queryKey: ['cocina-stock-pastas-sugerencias-plan', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cocina_stock_pastas')
        .select('nombre, porciones_camara, porciones_traspasadas, porciones_merma')
        .eq('local', local);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as Array<{
        nombre: string;
        porciones_camara: number | null;
        porciones_traspasadas: number | null;
        porciones_merma: number | null;
      }>) {
        const camara = Number(r.porciones_camara) || 0;
        const traspasos = Number(r.porciones_traspasadas) || 0;
        const merma = Number(r.porciones_merma) || 0;
        m.set(normNombre(r.nombre), Math.max(0, camara - traspasos - merma));
      }
      return m;
    },
  });

  // Último conteo manual de stock por producto (para salsas/postres)
  const { data: conteos } = useQuery({
    queryKey: ['cocina-conteo-stock-sugerencias-plan', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_conteo_stock')
        .select('producto, cantidad, fecha')
        .eq('local', local)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const m = new Map<string, { cantidad: number; fecha: string }>();
      for (const r of (data ?? []) as Array<{ producto: string; cantidad: number; fecha: string }>) {
        if (!m.has(r.producto)) m.set(r.producto, { cantidad: r.cantidad, fecha: r.fecha });
      }
      return m;
    },
  });

  // Ventas Fudo últimos 14 días (promedio diario por producto)
  type FudoRanking = { nombre: string; cantidad: number };
  type FudoResp = { ranking: FudoRanking[]; dias: number };
  const { data: fudoData } = useQuery({
    queryKey: ['cocina-fudo-sugerencias-plan', local, hace14, hoyStr],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local, fechaDesde: hace14, fechaHasta: hoyStr },
      });
      if (error || !data?.ok) return null;
      return data.data as FudoResp;
    },
    staleTime: 10 * 60 * 1000,
  });

  // Estado local: map fecha -> items
  const [items, setItems] = useState<Record<string, PlanItem[]>>({});

  // Hidratar estado cuando carga itemsExistentes
  useEffect(() => {
    if (!itemsExistentes) return;
    const porFecha: Record<string, PlanItem[]> = {
      [fechas[0]]: [],
      [fechas[1]]: [],
      [fechas[2]]: [],
    };
    for (const row of itemsExistentes) {
      const r = row as {
        id: string;
        fecha_objetivo: string;
        tipo: TipoItem;
        receta_id: string | null;
        texto_libre: string | null;
        cantidad_recetas: number;
        turno: 'mañana' | 'tarde' | null;
        notas: string | null;
        estado: 'pendiente' | 'en_produccion' | 'en_bandejas' | 'ciclo_completo' | 'cancelado';
      };
      if (!porFecha[r.fecha_objetivo]) porFecha[r.fecha_objetivo] = [];
      porFecha[r.fecha_objetivo].push({
        id: r.id,
        tipo: r.tipo,
        receta_id: r.receta_id,
        texto_libre: r.texto_libre,
        cantidad_recetas: r.cantidad_recetas,
        turno: r.turno,
        notas: r.notas,
        estado: r.estado,
      });
    }
    setItems(porFecha);
  }, [itemsExistentes, fechas]);

  // ── Sugerencias derivadas (estilo dashboard pero simplificado) ──
  const PISO_PORCIONES_PASTA = 100;
  const tiposPlan = useMemo(() => new Set(tipos.map((t) => t.tipo)), [tipos]);

  const sugerencias = useMemo<Sugerencia[]>(() => {
    if (!productosBD || !fudoData) return [];

    const out: Sugerencia[] = [];
    // Recorremos el catálogo del dashboard (los productos que el chef controla)
    const productosLocal = PRODUCTOS_COCINA.filter((p) => !p.local || p.local === local);

    for (const prod of productosLocal) {
      const prodDB = productosBD.get(normNombre(prod.nombre));
      if (!prodDB?.receta) continue;
      const receta = prodDB.receta;
      const tipoReceta = (receta.tipo ?? '') as TipoItem;
      // Solo sugerimos para tipos que el plan acepta (masas no se planifican)
      if (!tiposPlan.has(tipoReceta)) continue;

      // Stock actual en porciones
      let porcionesStock = 0;
      let stockConocido = false;
      if (prod.tipo === 'pasta') {
        const v = stockPastas?.get(normNombre(prod.nombre)) ?? 0;
        if (v > 0) {
          porcionesStock = v;
          stockConocido = true;
        }
      }
      const conteo = conteos?.get(prod.nombre);
      if (conteo) {
        if (prod.tipo === 'salsa') {
          porcionesStock = Math.ceil((conteo.cantidad * 1000) / prod.gramosporcion);
        } else if (prod.tipo === 'postre') {
          porcionesStock = Math.ceil(conteo.cantidad * prod.porcionesporunidad);
        } else {
          porcionesStock = Math.ceil(conteo.cantidad);
        }
        stockConocido = true;
      }
      if (!stockConocido) continue;

      // Demanda diaria promedio (Fudo)
      const nombres = prod.fudoNombres ?? [prod.nombre];
      let ventasTotal = 0;
      for (const n of nombres) {
        const f = fudoData.ranking.find((r) => r.nombre.toLowerCase() === n.toLowerCase());
        if (f) ventasTotal += f.cantidad;
      }
      const ventasDiarias = fudoData.dias > 0 ? ventasTotal / fudoData.dias : 0;
      if (ventasDiarias <= 0) continue;

      // Objetivo de cobertura
      const minimoBD = prodDB.minimo_produccion ?? null;
      let porcionesObjetivo = ventasDiarias * prod.diasObjetivo;
      if (prod.tipo === 'pasta') {
        const piso = minimoBD ?? PISO_PORCIONES_PASTA;
        porcionesObjetivo = Math.max(porcionesObjetivo, piso);
      } else if (minimoBD != null && minimoBD > 0) {
        porcionesObjetivo = Math.max(porcionesObjetivo, minimoBD);
      }

      const porcionesFaltantes = Math.max(0, porcionesObjetivo - porcionesStock);
      if (porcionesFaltantes <= 0) continue;

      const rendPorciones = receta.rendimiento_porciones ?? null;
      let cantidadRecetas = 0;
      if (rendPorciones && rendPorciones > 0) {
        cantidadRecetas = Math.ceil(porcionesFaltantes / rendPorciones);
      } else if (receta.rendimiento_kg && prod.tipo === 'salsa' && prod.gramosporcion > 0) {
        const kgFaltantes = (porcionesFaltantes * prod.gramosporcion) / 1000;
        cantidadRecetas = Math.ceil(kgFaltantes / receta.rendimiento_kg);
      } else {
        // Sin rendimiento configurado → no podemos sugerir cantidad de recetas
        continue;
      }

      const diasRestantes = ventasDiarias > 0 ? porcionesStock / ventasDiarias : null;
      const urgencia: Sugerencia['urgencia'] =
        diasRestantes !== null && diasRestantes < 1 ? 'critico' : 'bajo';

      out.push({
        key: `${prod.nombre}::${receta.id}`,
        productoNombre: prod.nombre,
        recetaId: receta.id,
        recetaNombre: receta.nombre,
        tipoPlan: tipoReceta,
        cantidadRecetas,
        porcionesFaltantes: Math.ceil(porcionesFaltantes),
        diasRestantes: diasRestantes !== null ? Math.round(diasRestantes * 10) / 10 : null,
        urgencia,
      });
    }
    // Críticos primero, después por porciones faltantes desc
    out.sort((a, b) => {
      if (a.urgencia !== b.urgencia) return a.urgencia === 'critico' ? -1 : 1;
      return b.porcionesFaltantes - a.porcionesFaltantes;
    });
    return out;
  }, [productosBD, stockPastas, conteos, fudoData, local, tiposPlan]);

  // Sugerencias ya cargadas en el día activo (para marcar el chip como "ya en plan")
  const recetasYaEnDia = useMemo(() => {
    const set = new Set<string>();
    for (const it of items[fechaActiva] ?? []) {
      if (it.receta_id) set.add(it.receta_id);
    }
    return set;
  }, [items, fechaActiva]);

  function agregarSugerencia(s: Sugerencia) {
    setItems((prev) => ({
      ...prev,
      [fechaActiva]: [
        ...(prev[fechaActiva] ?? []),
        {
          id: nuevoId(),
          tipo: s.tipoPlan,
          receta_id: s.recetaId,
          texto_libre: null,
          cantidad_recetas: s.cantidadRecetas,
          turno: s.tipoPlan === 'salsa' || s.tipoPlan === 'postre' ? 'tarde' : 'mañana',
          notas: `Sugerido: cubre ${s.porcionesFaltantes} porc.`,
        },
      ],
    }));
  }

  function agregarItem(fecha: string, tipo: TipoItem) {
    setItems((prev) => ({
      ...prev,
      [fecha]: [
        ...(prev[fecha] ?? []),
        {
          id: nuevoId(),
          tipo,
          receta_id: null,
          texto_libre: null,
          cantidad_recetas: 1,
          turno: tipo === 'salsa' || tipo === 'postre' ? 'tarde' : 'mañana',
          notas: null,
        },
      ],
    }));
  }

  function actualizarItem(fecha: string, itemId: string, patch: Partial<PlanItem>) {
    setItems((prev) => ({
      ...prev,
      [fecha]: (prev[fecha] ?? []).map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
    }));
  }

  function eliminarItem(fecha: string, itemId: string) {
    setItems((prev) => ({
      ...prev,
      [fecha]: (prev[fecha] ?? []).filter((it) => it.id !== itemId),
    }));
  }

  // Guardar: para cada fecha del plan, borrar los 'pendiente' existentes y re-insertar
  // los que el chef dejó. Los items ya iniciados (en_produccion / en_bandejas / ciclo_completo) no se tocan.
  const guardar = useMutation({
    mutationFn: async () => {
      for (const fecha of fechas) {
        const itemsFecha = items[fecha] ?? [];

        // 1) Borrar pendientes/cancelados existentes de esta fecha+local
        const { error: errDel } = await supabase
          .from('cocina_pizarron_items')
          .delete()
          .eq('fecha_objetivo', fecha)
          .eq('local', local)
          .in('estado', ['pendiente', 'cancelado']);
        if (errDel) throw errDel;

        // 2) Items editables (los iniciados/cumplidos se mantienen intactos)
        const nuevos = itemsFecha
          .filter((it) => !it.estado || it.estado === 'pendiente' || it.estado === 'cancelado')
          .filter((it) => it.receta_id || (it.texto_libre && it.texto_libre.trim()))
          .map((it) => ({
            fecha_objetivo: fecha,
            local,
            turno: it.turno,
            tipo: it.tipo,
            receta_id: it.receta_id,
            texto_libre: it.texto_libre?.trim() || null,
            cantidad_recetas: it.cantidad_recetas,
            notas: it.notas?.trim() || null,
            estado: 'pendiente',
          }));

        if (nuevos.length > 0) {
          const { error: errIns } = await supabase
            .from('cocina_pizarron_items')
            .insert(nuevos);
          if (errIns) throw errIns;
        }
      }
    },
    onSuccess: () => {
      // Cerrar el modal primero para que el feedback al usuario sea inmediato;
      // las invalidaciones disparan refetches en background.
      onClose();
      qc.invalidateQueries({ queryKey: ['cocina-pizarron-editor'] });
      qc.invalidateQueries({ queryKey: ['cocina-pizarron-hoy'] });
      qc.invalidateQueries({ queryKey: ['plan-semanal-pizarron'] });
    },
  });

  const itemsDelDia = items[fechaActiva] ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Definir plan de producción</h2>
            <p className="text-xs text-gray-500 capitalize">
              Local: {local} · Cargá lo que hay que hacer en los próximos 3 días
            </p>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        {/* Tabs por día */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          {fechas.map((f, i) => {
            const cant = (items[f] ?? []).length;
            return (
              <button
                key={f}
                onClick={() => setFechaActiva(f)}
                className={cn(
                  'flex-1 px-4 py-3 text-sm font-medium transition',
                  fechaActiva === f
                    ? 'border-b-2 border-rodziny-600 bg-white text-rodziny-700'
                    : 'text-gray-500 hover:text-gray-700',
                )}
              >
                <div className="capitalize">
                  {i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : 'Pasado'}
                </div>
                <div className="text-[10px] capitalize text-gray-400">{formatFecha(f)}</div>
                {cant > 0 && (
                  <span className="ml-1 inline-block rounded-full bg-rodziny-100 px-1.5 text-[10px] text-rodziny-700">
                    {cant}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body: secciones por tipo */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Banner de sugerencias del dashboard */}
          {sugerencias.length > 0 && (
            <div className="border-rodziny-200 mb-5 rounded-lg border bg-rodziny-50 p-3">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-rodziny-800">
                  Sugerencias para hoy
                </h3>
                <span className="text-[10px] text-rodziny-600">
                  Basado en ventas Fudo (14d) y stock actual · clickeá para sumar al plan
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {sugerencias.map((s) => {
                  const yaEnPlan = recetasYaEnDia.has(s.recetaId);
                  return (
                    <button
                      key={s.key}
                      onClick={() => agregarSugerencia(s)}
                      disabled={yaEnPlan}
                      title={
                        yaEnPlan
                          ? 'Ya cargado en este día'
                          : `Hacer ${s.cantidadRecetas} receta${s.cantidadRecetas !== 1 ? 's' : ''} de ${s.recetaNombre} para cubrir ${s.porcionesFaltantes} porciones de ${s.productoNombre}`
                      }
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
                        yaEnPlan
                          ? 'cursor-not-allowed bg-gray-100 text-gray-400 ring-1 ring-gray-200'
                          : s.urgencia === 'critico'
                            ? 'bg-red-100 text-red-800 ring-1 ring-red-300 hover:bg-red-200'
                            : 'bg-amber-100 text-amber-800 ring-1 ring-amber-300 hover:bg-amber-200',
                      )}
                    >
                      {yaEnPlan ? (
                        <span className="text-[10px]">✓</span>
                      ) : (
                        <span className="text-[10px] font-bold">+</span>
                      )}
                      <span className="font-bold">
                        {s.cantidadRecetas}× {s.recetaNombre}
                      </span>
                      <span className="text-[10px] opacity-80">
                        ({s.productoNombre}
                        {s.diasRestantes !== null ? ` · ${s.diasRestantes}d` : ''})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tipos.map(({ tipo, label, emoji }) => {
            const itemsTipo = itemsDelDia.filter((it) => it.tipo === tipo);
            const recetasTipo = (recetas ?? []).filter((r) => r.tipo === tipo);
            return (
              <section key={tipo} className="mb-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">
                    {emoji} {label}
                    {itemsTipo.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        ({itemsTipo.length})
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => agregarItem(fechaActiva, tipo)}
                    className="rounded border border-rodziny-300 bg-white px-2 py-1 text-xs text-rodziny-700 hover:bg-rodziny-50"
                  >
                    + Agregar
                  </button>
                </div>

                {itemsTipo.length === 0 ? (
                  <p className="rounded border border-dashed border-gray-200 py-3 text-center text-xs text-gray-400">
                    Sin items para {label.toLowerCase()}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {itemsTipo.map((it) => {
                      const bloqueado =
                        it.estado === 'en_produccion' ||
                        it.estado === 'en_bandejas' ||
                        it.estado === 'ciclo_completo';
                      const etiquetaEstado =
                        it.estado === 'ciclo_completo'
                          ? '✓ Ciclo completo'
                          : it.estado === 'en_bandejas'
                            ? '🧊 En bandejas'
                            : it.estado === 'en_produccion'
                              ? '🥣 En producción'
                              : null;
                      return (
                        <div
                          key={it.id}
                          className={cn(
                            'grid grid-cols-12 items-center gap-2 rounded border px-2 py-2 text-sm',
                            bloqueado
                              ? 'border-green-200 bg-green-50'
                              : 'border-gray-200 bg-white',
                          )}
                        >
                          {/* Receta */}
                          <div className="col-span-5">
                            <select
                              value={it.receta_id ?? ''}
                              onChange={(e) =>
                                actualizarItem(fechaActiva, it.id, {
                                  receta_id: e.target.value || null,
                                })
                              }
                              disabled={bloqueado}
                              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm disabled:bg-gray-100"
                            >
                              <option value="">Elegí receta…</option>
                              {recetasTipo.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.nombre}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Cantidad */}
                          <div className="col-span-2">
                            <div className="flex items-center rounded border border-gray-300 bg-white">
                              <button
                                onClick={() =>
                                  actualizarItem(fechaActiva, it.id, {
                                    cantidad_recetas: Math.max(0.5, it.cantidad_recetas - 0.5),
                                  })
                                }
                                disabled={bloqueado}
                                className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                              >
                                −
                              </button>
                              <span className="flex-1 text-center text-sm font-semibold tabular-nums">
                                ×{it.cantidad_recetas}
                              </span>
                              <button
                                onClick={() =>
                                  actualizarItem(fechaActiva, it.id, {
                                    cantidad_recetas: it.cantidad_recetas + 0.5,
                                  })
                                }
                                disabled={bloqueado}
                                className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {/* Turno */}
                          <div className="col-span-2">
                            <select
                              value={it.turno ?? ''}
                              onChange={(e) =>
                                actualizarItem(fechaActiva, it.id, {
                                  turno: (e.target.value || null) as PlanItem['turno'],
                                })
                              }
                              disabled={bloqueado}
                              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:bg-gray-100"
                            >
                              <option value="">Sin turno</option>
                              <option value="mañana">🌅 Mañana</option>
                              <option value="tarde">🌇 Tarde</option>
                            </select>
                          </div>

                          {/* Estado + acciones */}
                          <div className="col-span-3 flex items-center justify-end gap-2">
                            {bloqueado ? (
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                  it.estado === 'ciclo_completo' &&
                                    'bg-green-200 text-green-800',
                                  it.estado === 'en_bandejas' && 'bg-blue-200 text-blue-800',
                                  it.estado === 'en_produccion' &&
                                    'bg-amber-200 text-amber-800',
                                )}
                              >
                                {etiquetaEstado}
                              </span>
                            ) : (
                              <button
                                onClick={() => eliminarItem(fechaActiva, it.id)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                Eliminar
                              </button>
                            )}
                          </div>

                          {/* Notas opcionales */}
                          <div className="col-span-12">
                            <input
                              type="text"
                              placeholder="Notas (opcional): ej. para sábado, urgente…"
                              value={it.notas ?? ''}
                              onChange={(e) =>
                                actualizarItem(fechaActiva, it.id, { notas: e.target.value })
                              }
                              disabled={bloqueado}
                              className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs disabled:bg-gray-100"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
          {guardar.isError && (
            <span className="mr-auto text-xs text-red-600">
              Error: {(guardar.error as Error)?.message ?? 'desconocido'}
            </span>
          )}
          <button
            onClick={onClose}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => guardar.mutate()}
            disabled={guardar.isPending}
            className="rounded bg-rodziny-700 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-rodziny-800 disabled:opacity-50"
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
