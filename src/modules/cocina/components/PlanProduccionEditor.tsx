import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';
import { cn } from '@/lib/utils';
import { PRODUCTOS_COCINA, normNombre } from '../DashboardTab';
import {
  calcularCobertura,
  type ItemPlanCob,
  type ProductoCob,
  type ResultadoCob,
  type EstadoCobertura,
} from '../lib/cobertura';

// Etiquetas compactas para la cobertura en vivo (al lado de cada receta).
const COB_LABEL: Record<EstadoCobertura, { t: string; cls: string }> = {
  cubre: { t: '🟢 cubre', cls: 'bg-green-100 text-green-700' },
  ajustado: { t: '🟡 justo', cls: 'bg-amber-100 text-amber-700' },
  corto: { t: '🔴 falta', cls: 'bg-red-100 text-red-700' },
  sobra: { t: '🟣 sobra', cls: 'bg-purple-100 text-purple-700' },
  sin_demanda: { t: '⚪ s/vta', cls: 'bg-gray-100 text-gray-500' },
};

interface Receta {
  id: string;
  nombre: string;
  tipo: 'receta' | 'subreceta';
  rol: string | null;
  categoria: string | null;
  local: string | null;
  rendimiento_porciones: number | null;
  rendimiento_kg: number | null;
}

// Mapea el TipoItem del pizarrón (relleno/masa/salsa/postre/pasteleria/panaderia)
// a las recetas/subrecetas correspondientes en el modelo nuevo.
// `pasta_simple` no usa recetas — se planifica por producto (ver getOpcionesPasta).
function recetasDelTipoPlan(recetas: Receta[], tipoPlan: TipoItem): Receta[] {
  switch (tipoPlan) {
    case 'relleno':
      return recetas.filter((r) => r.rol === 'relleno');
    case 'masa':
      return recetas.filter((r) => r.rol === 'masa');
    case 'salsa':
      return recetas.filter((r) => r.rol === 'salsa_base' || r.categoria === 'salsa');
    case 'postre':
      return recetas.filter((r) => r.rol === 'postre_base' || r.categoria === 'postre');
    case 'panaderia':
      return recetas.filter((r) => r.rol === 'panificado' || r.categoria === 'panificado');
    case 'pasteleria':
      return recetas.filter((r) => r.rol === 'pasteleria_base');
    case 'milanesa':
      return recetas.filter((r) => r.rol === 'milanesa_base');
    case 'pasta_simple':
      return [];
  }
}

// Formatea kg con coma decimal, sin ceros sobrantes ("3" / "7,5").
function fmtKg(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '').replace('.', ',');
}

// Rinde de milanesa (kg de milanesa por kg de cuadril) cuando no hay receta
// vinculada o la receta no tiene rinde cargado. Provisorio hasta calibrar.
const RINDE_MILANESA_DEFAULT = 1.5;

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

type TipoItem =
  | 'relleno'
  | 'masa'
  | 'salsa'
  | 'postre'
  | 'pasteleria'
  | 'panaderia'
  | 'milanesa'
  | 'pasta_simple';

interface PlanItem {
  id: string;
  tipo: TipoItem;
  receta_id: string | null;
  texto_libre: string | null;
  cantidad_recetas: number;
  turno: 'mañana' | 'tarde' | null;
  notas: string | null;
  // Para rellenos que alimentan a varios vendibles (ej: pure → ñoquis rellenos
  // o simples): a qué producto vendible se imputa en el Resumen semanal.
  destino_producto_id: string | null;
  estado?: 'pendiente' | 'en_produccion' | 'en_bandejas' | 'ciclo_completo' | 'cancelado';
}

// Las masas no se planifican acá — se hacen a demanda según producción.
// Las "pastas simples" (tagliatelle, spaghetti, etc) se planifican por porciones,
// no por receta (se arman en el momento con la masa disponible).
const TIPOS_VEDIA: { tipo: TipoItem; label: string; emoji: string }[] = [
  { tipo: 'relleno', label: 'Rellenos', emoji: '🥟' },
  { tipo: 'pasta_simple', label: 'Pastas simples', emoji: '🍝' },
  { tipo: 'salsa', label: 'Salsas', emoji: '🍅' },
  { tipo: 'postre', label: 'Postres', emoji: '🍰' },
];

const TIPOS_SAAVEDRA: { tipo: TipoItem; label: string; emoji: string }[] = [
  { tipo: 'relleno', label: 'Rellenos', emoji: '🥟' },
  { tipo: 'pasta_simple', label: 'Pastas simples', emoji: '🍝' },
  { tipo: 'salsa', label: 'Salsas', emoji: '🍅' },
  { tipo: 'milanesa', label: 'Milanesas', emoji: '🍖' },
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

// Lunes de la semana que contiene `fecha`. Usa convención ISO (lunes = inicio).
function lunesDeLaSemana(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

const DIAS_CORTOS = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

function diaCorto(fecha: string): string {
  const d = new Date(fecha + 'T12:00:00');
  return DIAS_CORTOS[d.getDay()];
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
  semanaRef,
  onClose,
}: {
  local: 'vedia' | 'saavedra';
  // Fecha cualquiera dentro de la semana a editar. Por defecto hoy.
  // Permite planificar la semana entrante (o cualquier semana) desde el tab.
  semanaRef?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fechaHoy = hoy();
  // Lunes de la semana de referencia (fecha seleccionada en el tab, o hoy).
  const lunesBase = useMemo(() => lunesDeLaSemana(semanaRef || hoy()), [semanaRef]);
  // Offset en semanas respecto a la semana base. ◀ ▶ lo mueven, así se puede
  // planificar la semana entrante (o cualquiera) sin cerrar el modal.
  const [semanaOffset, setSemanaOffset] = useState(0);
  const fechas = useMemo(() => {
    const lunes = sumarDias(lunesBase, semanaOffset * 7);
    return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  }, [lunesBase, semanaOffset]);
  const [fechaActiva, setFechaActiva] = useState(() => {
    // Si la semana de referencia contiene hoy, abrimos en hoy. Si no (semana
    // entrante o pasada), abrimos en el primer día (lunes) de esa semana.
    const fechasSemana = Array.from({ length: 7 }, (_, i) => sumarDias(lunesBase, i));
    return fechasSemana.includes(fechaHoy) ? fechaHoy : fechasSemana[0];
  });

  // Cambiar de semana sin cerrar el modal. Reposiciona el día activo dentro de
  // la semana nueva (hoy si cae ahí, si no el lunes).
  function cambiarSemana(delta: number) {
    const nuevoOffset = semanaOffset + delta;
    const lunes = sumarDias(lunesBase, nuevoOffset * 7);
    const nuevas = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
    setSemanaOffset(nuevoOffset);
    setFechaActiva(nuevas.includes(fechaHoy) ? fechaHoy : nuevas[0]);
  }

  const tipos = local === 'vedia' ? TIPOS_VEDIA : TIPOS_SAAVEDRA;

  // Catálogo de recetas activas del local
  const { data: recetas } = useQuery({
    queryKey: ['cocina-recetas-plan', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, rol, categoria, local, rendimiento_porciones, rendimiento_kg')
        .eq('activo', true)
        .or(`local.eq.${local},local.is.null`)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as Receta[];
    },
  });

  // receta_id → rinde en kg (kg de milanesa por kg de cuadril). Usado para
  // mostrar/editar el plan de milanesa en kg de milanesa terminada, no en
  // "recetas". El dato guardado sigue siendo recetas (= kg de cuadril).
  const rindeKgPorReceta = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of recetas ?? []) {
      if (r.rendimiento_kg && r.rendimiento_kg > 0) m.set(r.id, r.rendimiento_kg);
    }
    return m;
  }, [recetas]);

  // Mapa receta → vendibles que la usan (cocina_pasta_recetas). Habilita el
  // selector "Destino" cuando un relleno alimenta a VARIOS vendibles (ej: pure
  // de papa → ñoquis rellenos o simples) para desambiguar la imputación en el
  // Resumen semanal. Solo recetas que mapean a ≥2 vendibles del local.
  const { data: destinoPorReceta } = useQuery({
    queryKey: ['plan-destino-por-receta', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pasta_recetas')
        .select('receta_id, pasta:cocina_productos!inner(id, nombre, local, activo)')
        .eq('pasta.local', local)
        .eq('pasta.activo', true);
      if (error) throw error;
      const m = new Map<string, { id: string; nombre: string }[]>();
      for (const row of (data ?? []) as unknown as {
        receta_id: string;
        pasta: { id: string; nombre: string } | { id: string; nombre: string }[] | null;
      }[]) {
        const p = Array.isArray(row.pasta) ? row.pasta[0] : row.pasta;
        if (!p) continue;
        const arr = m.get(row.receta_id) ?? [];
        if (!arr.some((x) => x.id === p.id)) arr.push({ id: p.id, nombre: p.nombre });
        m.set(row.receta_id, arr);
      }
      const out = new Map<string, { id: string; nombre: string }[]>();
      for (const [k, v] of m) {
        if (v.length >= 2) out.set(k, v.sort((a, b) => a.nombre.localeCompare(b.nombre)));
      }
      return out;
    },
  });

  // Catálogo de pastas (productos tipo='pasta') del local. Se usa solo en la
  // sección "Pastas simples" — el select muestra nombres de productos, y el plan
  // se guarda como texto_libre (sin receta_id) porque tagliatelles/spaghetti se
  // hacen en el momento con la masa disponible.
  const { data: productosPasta } = useQuery({
    queryKey: ['cocina-productos-pasta-plan', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('nombre')
        .eq('local', local)
        .eq('activo', true)
        .eq('tipo', 'pasta')
        .order('nombre');
      if (error) throw error;
      return ((data ?? []) as { nombre: string }[]).map((r) => r.nombre);
    },
  });

  // Items existentes del plan (semana completa)
  const { data: itemsExistentes, isFetching: cargandoItemsSemana } = useQuery({
    queryKey: ['cocina-pizarron-editor', local, fechas[0], fechas[6]],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_pizarron_items')
        .select(
          'id, fecha_objetivo, local, turno, tipo, receta_id, texto_libre, cantidad_recetas, estado, notas, destino_producto_id',
        )
        .eq('local', local)
        .gte('fecha_objetivo', fechas[0])
        .lte('fecha_objetivo', fechas[6]);
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

  // ── Datos para la cobertura semanal EN VIVO (mismo cálculo que el Resumen) ──
  const hace60 = useMemo(
    () => new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0],
    [],
  );
  const { data: vendiblesCob } = useQuery({
    queryKey: ['plan-cob-vendibles', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, tipo, receta_id, fudo_nombres')
        .eq('local', local)
        .eq('activo', true)
        .eq('controla_stock', true);
      if (error) throw error;
      return (data ?? []) as ProductoCob[];
    },
  });
  const { data: stockPastasCob } = useQuery({
    queryKey: ['plan-cob-stock-pastas', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cocina_stock_pastas')
        .select(
          'producto_id, porciones_camara, porciones_fresco, porciones_traspasadas, porciones_merma',
        )
        .eq('local', local);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as Array<{
        producto_id: string;
        porciones_camara: number | null;
        porciones_fresco: number | null;
        porciones_traspasadas: number | null;
        porciones_merma: number | null;
      }>) {
        const camara = Number(r.porciones_camara) || 0;
        const fresco = Number(r.porciones_fresco) || 0;
        const traspasos = Number(r.porciones_traspasadas) || 0;
        const merma = Number(r.porciones_merma) || 0;
        m.set(r.producto_id, Math.max(0, camara - traspasos - merma) + Math.max(0, fresco));
      }
      return m;
    },
  });
  const { data: stockPostresCob } = useQuery({
    queryKey: ['plan-cob-stock-postres', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('receta_id, cantidad_producida, merma_cantidad')
        .eq('local', local)
        .eq('en_stock', true)
        .not('receta_id', 'is', null);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as Array<{
        receta_id: string;
        cantidad_producida: number | null;
        merma_cantidad: number | null;
      }>) {
        const neto = Math.max(0, (Number(r.cantidad_producida) || 0) - (Number(r.merma_cantidad) || 0));
        m.set(r.receta_id, (m.get(r.receta_id) ?? 0) + neto);
      }
      return m;
    },
  });
  const { data: pedidosCob } = useQuery({
    queryKey: ['plan-cob-pedidos', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('almacen_pedidos')
        .select('producto_id, cantidad, estado')
        .eq('local', local)
        .not('producto_id', 'is', null)
        .not('estado', 'in', '(entregado,cancelado)');
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as Array<{ producto_id: string; cantidad: number | null }>) {
        m.set(r.producto_id, (m.get(r.producto_id) ?? 0) + (Number(r.cantidad) || 0));
      }
      return m;
    },
  });
  const { data: rindePorLoteCob } = useQuery({
    queryKey: ['plan-cob-rinde-lote', local, hace60],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('producto_id, porciones')
        .eq('local', local)
        .gte('fecha', hace60)
        .not('porciones', 'is', null);
      if (error) throw error;
      const acc = new Map<string, { suma: number; n: number }>();
      for (const r of (data ?? []) as Array<{ producto_id: string; porciones: number | null }>) {
        const p = Number(r.porciones) || 0;
        if (p <= 0) continue;
        const a = acc.get(r.producto_id) ?? { suma: 0, n: 0 };
        a.suma += p;
        a.n += 1;
        acc.set(r.producto_id, a);
      }
      const m = new Map<string, number>();
      for (const [id, a] of acc) if (a.n > 0) m.set(id, a.suma / a.n);
      return m;
    },
    staleTime: 10 * 60 * 1000,
  });

  // Estado local: map fecha -> items
  const [items, setItems] = useState<Record<string, PlanItem[]>>({});

  // Hidratar estado cuando carga itemsExistentes
  useEffect(() => {
    if (!itemsExistentes) return;
    const porFecha: Record<string, PlanItem[]> = {};
    for (const f of fechas) porFecha[f] = [];
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
        destino_producto_id: string | null;
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
        destino_producto_id: r.destino_producto_id,
        estado: r.estado,
      });
    }
    setItems(porFecha);
  }, [itemsExistentes, fechas]);

  // ── Sugerencias derivadas (estilo dashboard pero simplificado) ──
  const PISO_PORCIONES_PASTA = 100;
  const tiposPlan = useMemo(() => new Set(tipos.map((t) => t.tipo)), [tipos]);

  // Total de recetas ya agregadas a la pizarra en toda la semana, por receta_id.
  // Usado para descontar de la sugerencia: si ya planificaste lo suficiente, no
  // se sugiere más.
  const recetasPlanificadasSemana = useMemo(() => {
    const m = new Map<string, number>();
    for (const fecha of fechas) {
      for (const it of items[fecha] ?? []) {
        if (!it.receta_id) continue;
        m.set(it.receta_id, (m.get(it.receta_id) ?? 0) + (it.cantidad_recetas ?? 0));
      }
    }
    return m;
  }, [items, fechas]);

  // Cuántas porciones produce 1 receta dada (según rendimiento del catálogo).
  // Misma lógica que se usa al sugerir cuántas recetas hacer; centralizada
  // acá para descontar del objetivo.
  function porcionesPorReceta(
    prod: (typeof PRODUCTOS_COCINA)[number],
    receta: { rendimiento_porciones: number | null; rendimiento_kg: number | null },
  ): number {
    if (receta.rendimiento_porciones && receta.rendimiento_porciones > 0) {
      return receta.rendimiento_porciones;
    }
    if (receta.rendimiento_kg && prod.tipo === 'salsa' && prod.gramosporcion > 0) {
      return (receta.rendimiento_kg * 1000) / prod.gramosporcion;
    }
    return 0;
  }

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

      // Descontar lo que el chef ya planificó en cualquier día de la semana
      // (cualquier receta_id idéntica suma al pozo, sea lunes o sábado).
      const recetasYaPlanif = recetasPlanificadasSemana.get(receta.id) ?? 0;
      const porcionesYaPlanificadas = recetasYaPlanif * porcionesPorReceta(prod, receta);

      const porcionesFaltantes = Math.max(
        0,
        porcionesObjetivo - porcionesStock - porcionesYaPlanificadas,
      );
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
  }, [productosBD, stockPastas, conteos, fudoData, local, tiposPlan, recetasPlanificadasSemana]);

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
          destino_producto_id: null,
        },
      ],
    }));
  }

  function agregarItem(fecha: string, tipo: TipoItem) {
    // Pasta simple se carga por porciones (no por recetas) y arranca en 100.
    const cantidadInicial = tipo === 'pasta_simple' ? 100 : 1;
    setItems((prev) => ({
      ...prev,
      [fecha]: [
        ...(prev[fecha] ?? []),
        {
          id: nuevoId(),
          tipo,
          receta_id: null,
          texto_libre: null,
          cantidad_recetas: cantidadInicial,
          turno: tipo === 'salsa' || tipo === 'postre' ? 'tarde' : 'mañana',
          notas: null,
          destino_producto_id: null,
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

  // ── Cobertura semanal EN VIVO: recalcula con los items que estás editando ──
  const recetaRindeMap = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of recetas ?? []) m.set(r.id, r.rendimiento_porciones);
    return m;
  }, [recetas]);

  const planItemsLive = useMemo<ItemPlanCob[]>(() => {
    const out: ItemPlanCob[] = [];
    for (const fecha of Object.keys(items)) {
      for (const it of items[fecha] ?? []) {
        if (it.estado === 'cancelado') continue;
        out.push({
          receta_id: it.receta_id,
          texto_libre: it.texto_libre,
          tipo: it.tipo,
          cantidad_recetas: it.cantidad_recetas,
          rendimiento_porciones: it.receta_id ? (recetaRindeMap.get(it.receta_id) ?? null) : null,
          destino_producto_id: it.destino_producto_id,
        });
      }
    }
    return out;
  }, [items, recetaRindeMap]);

  const coberturaPorProducto = useMemo(() => {
    const m = new Map<string, ResultadoCob>();
    if (!vendiblesCob) return m;
    const res = calcularCobertura({
      productos: vendiblesCob,
      itemsPlan: planItemsLive,
      fudoData,
      stockPorProducto: stockPastasCob ?? new Map(),
      stockPorReceta: stockPostresCob ?? new Map(),
      pedidosPorProducto: pedidosCob ?? new Map(),
      rindePorLote: rindePorLoteCob ?? new Map(),
      tiposIncluidos: ['pasta', 'postre'],
    });
    for (const r of res) m.set(r.id, r);
    return m;
  }, [
    vendiblesCob,
    planItemsLive,
    fudoData,
    stockPastasCob,
    stockPostresCob,
    pedidosCob,
    rindePorLoteCob,
  ]);

  // Resolver a qué vendible apunta un ítem (para mostrar su cobertura al lado).
  const vendiblePorNombre = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of vendiblesCob ?? []) m.set(normNombre(p.nombre), p.id);
    return m;
  }, [vendiblesCob]);
  const vendiblePorReceta = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of vendiblesCob ?? [])
      if (p.receta_id && !m.has(p.receta_id)) m.set(p.receta_id, p.id);
    return m;
  }, [vendiblesCob]);

  function coberturaDeItem(it: PlanItem): ResultadoCob | null {
    let vid: string | null = null;
    if (it.destino_producto_id) vid = it.destino_producto_id;
    else if (it.tipo === 'pasta_simple' && it.texto_libre)
      vid = vendiblePorNombre.get(normNombre(it.texto_libre)) ?? null;
    else if (it.receta_id) vid = vendiblePorReceta.get(it.receta_id) ?? null;
    return vid ? (coberturaPorProducto.get(vid) ?? null) : null;
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
            destino_producto_id: it.destino_producto_id ?? null,
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
      // El Resumen semanal lee el plan aparte: sin esto, el destino recién
      // elegido no se refleja hasta refrescar la página.
      qc.invalidateQueries({ queryKey: ['resumen-semanal-plan'] });
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
              Local: {local} · Editá la planificación de toda la semana
            </p>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        {/* Navegación de semana */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-2">
          <button
            onClick={() => cambiarSemana(-1)}
            className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
          >
            ◀ Semana anterior
          </button>
          <div className="text-center">
            <span className="text-sm font-semibold text-gray-800">
              Semana del {formatFecha(fechas[0])} al {formatFecha(fechas[6])}
            </span>
            {semanaOffset !== 0 && (
              <button
                onClick={() => cambiarSemana(-semanaOffset)}
                className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-200"
              >
                volver a la actual
              </button>
            )}
          </div>
          <button
            onClick={() => cambiarSemana(1)}
            className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
          >
            Semana siguiente ▶
          </button>
        </div>

        {/* Tabs por día */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          {fechas.map((f) => {
            const cant = (items[f] ?? []).length;
            const esHoy = f === fechaHoy;
            const esPasado = f < fechaHoy;
            const activo = fechaActiva === f;
            return (
              <button
                key={f}
                onClick={() => setFechaActiva(f)}
                className={cn(
                  'flex-1 px-2 py-2 text-xs font-medium transition',
                  activo
                    ? 'border-b-2 border-rodziny-600 bg-white text-rodziny-700'
                    : esPasado
                      ? 'text-gray-400 hover:text-gray-600'
                      : 'text-gray-600 hover:text-gray-800',
                )}
              >
                <div className={cn('font-semibold', esHoy && 'text-rodziny-700')}>
                  {esHoy ? 'HOY' : diaCorto(f)}
                </div>
                <div className="text-[10px] text-gray-400">{formatFecha(f)}</div>
                {cant > 0 && (
                  <span
                    className={cn(
                      'mt-0.5 inline-block rounded-full px-1.5 text-[10px]',
                      activo ? 'bg-rodziny-100 text-rodziny-700' : 'bg-gray-200 text-gray-600',
                    )}
                  >
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
            const recetasTipo = recetasDelTipoPlan(recetas ?? [], tipo);
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
                          {/* Receta o producto (pasta simple usa texto_libre con el nombre del producto) */}
                          <div className="col-span-5">
                            {it.tipo === 'pasta_simple' ? (
                              <select
                                value={it.texto_libre ?? ''}
                                onChange={(e) =>
                                  actualizarItem(fechaActiva, it.id, {
                                    texto_libre: e.target.value || null,
                                  })
                                }
                                disabled={bloqueado}
                                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm disabled:bg-gray-100"
                              >
                                <option value="">Elegí pasta…</option>
                                {(productosPasta ?? []).map((nombre) => (
                                  <option key={nombre} value={nombre}>
                                    {nombre}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <select
                                value={it.receta_id ?? ''}
                                onChange={(e) =>
                                  actualizarItem(fechaActiva, it.id, {
                                    receta_id: e.target.value || null,
                                    destino_producto_id: null,
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
                            )}
                            {(() => {
                              const cob = coberturaDeItem(it);
                              if (!cob) return null;
                              const lbl = COB_LABEL[cob.estado];
                              const pct =
                                cob.demandaSemanal > 0
                                  ? Math.round((cob.disponible / cob.demandaSemanal) * 100)
                                  : null;
                              return (
                                <div
                                  className="mt-1 flex items-center gap-1 text-[10px]"
                                  title={`${cob.nombre}: stock ${Math.round(cob.stock)} + plan ${Math.round(cob.planificado)} = ${Math.round(cob.disponible)} · demanda ${Math.round(cob.demandaSemanal)} (7d)`}
                                >
                                  <span className={cn('rounded px-1 py-0.5 font-medium', lbl.cls)}>
                                    {lbl.t}
                                  </span>
                                  <span className="truncate text-gray-500">
                                    {cob.nombre}
                                    {pct !== null ? ` · ${pct}%` : ''}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Cantidad: pasta simple va por porciones (paso de 10, mínimo 10);
                              milanesa va por kg de milanesa terminada (paso 0.5 kg);
                              el resto por recetas (paso de 0.5, mínimo 0.5). */}
                          <div className="col-span-2">
                            {(() => {
                              // Milanesa: se planifica en kg de milanesa terminada. Por dentro
                              // guardamos recetas (= kg de cuadril); convertimos con el rinde.
                              if (it.tipo === 'milanesa') {
                                const rinde =
                                  (it.receta_id ? rindeKgPorReceta.get(it.receta_id) : null) ??
                                  RINDE_MILANESA_DEFAULT;
                                const kgActual = it.cantidad_recetas * rinde;
                                const pasoKg = 0.5;
                                const minKg = 0.5;
                                return (
                                  <div className="flex items-center rounded border border-gray-300 bg-white">
                                    <button
                                      onClick={() =>
                                        actualizarItem(fechaActiva, it.id, {
                                          cantidad_recetas:
                                            Math.max(minKg, kgActual - pasoKg) / rinde,
                                        })
                                      }
                                      disabled={bloqueado}
                                      className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                                    >
                                      −
                                    </button>
                                    <span className="flex-1 text-center text-sm font-semibold tabular-nums">
                                      {fmtKg(kgActual)} kg
                                    </span>
                                    <button
                                      onClick={() =>
                                        actualizarItem(fechaActiva, it.id, {
                                          cantidad_recetas: (kgActual + pasoKg) / rinde,
                                        })
                                      }
                                      disabled={bloqueado}
                                      className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                                    >
                                      +
                                    </button>
                                  </div>
                                );
                              }
                              const esPastaSimple = it.tipo === 'pasta_simple';
                              const paso = esPastaSimple ? 10 : 0.5;
                              const minimo = esPastaSimple ? 10 : 0.5;
                              return (
                                <div className="flex items-center rounded border border-gray-300 bg-white">
                                  <button
                                    onClick={() =>
                                      actualizarItem(fechaActiva, it.id, {
                                        cantidad_recetas: Math.max(
                                          minimo,
                                          it.cantidad_recetas - paso,
                                        ),
                                      })
                                    }
                                    disabled={bloqueado}
                                    className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                                  >
                                    −
                                  </button>
                                  <span className="flex-1 text-center text-sm font-semibold tabular-nums">
                                    {esPastaSimple
                                      ? `${it.cantidad_recetas} porc.`
                                      : `×${it.cantidad_recetas}`}
                                  </span>
                                  <button
                                    onClick={() =>
                                      actualizarItem(fechaActiva, it.id, {
                                        cantidad_recetas: it.cantidad_recetas + paso,
                                      })
                                    }
                                    disabled={bloqueado}
                                    className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                                  >
                                    +
                                  </button>
                                </div>
                              );
                            })()}
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

                          {/* Destino: solo cuando la receta alimenta a ≥2 vendibles
                              (ej: pure de papa → ñoquis rellenos o simples). */}
                          {it.receta_id &&
                            (destinoPorReceta?.get(it.receta_id)?.length ?? 0) >= 2 && (
                              <div className="col-span-12 flex items-center gap-2">
                                <span className="shrink-0 text-[11px] font-medium text-gray-500">
                                  🎯 Destino
                                </span>
                                <select
                                  value={it.destino_producto_id ?? ''}
                                  onChange={(e) =>
                                    actualizarItem(fechaActiva, it.id, {
                                      destino_producto_id: e.target.value || null,
                                    })
                                  }
                                  disabled={bloqueado}
                                  className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:bg-gray-100"
                                >
                                  <option value="">— Sin destino (cuenta para todos)</option>
                                  {(destinoPorReceta?.get(it.receta_id) ?? []).map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.nombre}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

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
              {mensajeErrorAmigable(guardar.error, 'No se pudo guardar el plan')}
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
            disabled={guardar.isPending || cargandoItemsSemana}
            className="rounded bg-rodziny-700 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-rodziny-800 disabled:opacity-50"
          >
            {guardar.isPending
              ? 'Guardando…'
              : cargandoItemsSemana
                ? 'Cargando semana…'
                : 'Guardar plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
