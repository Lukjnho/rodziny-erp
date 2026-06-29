import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { procesarComprobantePago } from '@/lib/ocrComprobantePago';
import { formatARS, cn } from '@/lib/utils';
import { MontoInput } from '@/components/ui/MontoInput';
import { type MedioPago, MEDIO_PAGO_LABEL, medioRequiereComprobante } from '@/modules/gastos/types';
import { urgenciaPago, usePagosAlertas, type UrgenciaPago } from '@/modules/finanzas/hooks/usePagosAlertas';
import { recomputarEstadoGasto } from '@/modules/gastos/recomputarEstadoGasto';
import {
  useProveedoresMap,
  resolverProveedor,
  ProveedorLabel,
} from '@/modules/gastos/proveedorDisplay';

// ── tipos ────────────────────────────────────────────────────────────────────
interface PagoFijo {
  id: string;
  periodo: string;
  concepto: string;
  categoria: string;
  categoria_gasto_id: string | null;
  monto: number | null;
  fecha_vencimiento: string | null;
  pagado: boolean;
  fecha_pago: string | null;
  medio_pago: string | null;
  gasto_id: string | null;
  notas: string | null;
  comprobante_path: string | null;
}

interface CategoriaGasto {
  id: string;
  nombre: string;
  parent_id: string | null;
  tipo_edr: string | null;
  activo: boolean;
}

// Echeq / cheque programado proveniente de pagos_gastos (modal de gasto o plan de pagos).
interface PagoProgramado {
  id: string;
  gasto_id: string;
  fecha_pago: string;
  monto: number;
  medio_pago: string | null;
  numero_operacion: string | null;
  programado: boolean;
  gastos: { proveedor: string | null; proveedor_id: string | null; local: string | null } | null;
}

// ── constantes ───────────────────────────────────────────────────────────────
const CATEGORIAS = [
  'Gastos Fijos',
  'Impuestos y Tasas',
  'Gastos administrativos',
  'Gastos de RRHH',
  'Regularizacion de impuestos',
  'Cheques',
];

const CAT_ICONS: Record<string, string> = {
  'Gastos Fijos': '🏠',
  'Impuestos y Tasas': '🏛',
  'Gastos administrativos': '💼',
  'Gastos de RRHH': '👥',
  'Regularizacion de impuestos': '📋',
  Cheques: '📝',
};

// Heurística de icono para grupos EdR (matching por substring del nombre)
function iconoGrupo(cat: string): string {
  if (CAT_ICONS[cat]) return CAT_ICONS[cat];
  const c = cat.toLowerCase();
  if (c.includes('estructura') || c.includes('servicio')) return '🏠';
  if (c.includes('impuesto') || c.includes('tasa')) return '🏛';
  if (c.includes('rrhh') || c.includes('personal') || c.includes('sueldo')) return '👥';
  if (c.includes('administ')) return '💼';
  if (c.includes('financ') || c.includes('banco')) return '💰';
  if (c.includes('marketing') || c.includes('publicidad')) return '📣';
  if (c.includes('cheque')) return '📝';
  if (c.includes('mercader') || c.includes('insumo') || c.includes('compra')) return '🛒';
  if (c.includes('regulariz')) return '📋';
  return '📂';
}

const MEDIOS: MedioPago[] = [
  'efectivo',
  'transferencia_mp',
  'cheque_galicia',
  'tarjeta_icbc',
  'otro',
];

function periodoAnterior(p: string): string {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodoSiguiente(p: string): string {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function labelMes(p: string): string {
  const [y, m] = p.split('-').map(Number);
  const meses = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  return `${meses[m - 1]} ${y}`;
}

function hoy(): string {
  return new Date().toISOString().split('T')[0];
}

// Comparador: vencimiento ASC, nulls al final
function compararPorVencimiento(a: PagoFijo, b: PagoFijo): number {
  if (!a.fecha_vencimiento && !b.fecha_vencimiento) return 0;
  if (!a.fecha_vencimiento) return 1;
  if (!b.fecha_vencimiento) return -1;
  return a.fecha_vencimiento.localeCompare(b.fecha_vencimiento);
}

// Derivar local del concepto (heurística simple)
function derivarLocal(concepto: string): 'vedia' | 'saavedra' {
  const c = concepto.toLowerCase();
  if (c.includes('saavedra') || c.includes('saveedra') || c.includes('sin gluten'))
    return 'saavedra';
  return 'vedia';
}

// ── componente ───────────────────────────────────────────────────────────────
export function ChecklistPagos() {
  const qc = useQueryClient();
  const { data: proveedoresMap } = useProveedoresMap();
  const [periodo, setPeriodo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const { data: alertas } = usePagosAlertas();

  // Urgentes en otros meses distintos al que estoy viendo (vencen en ≤7 días).
  // Si estoy en abril y hay 2 urgentes de mayo, los anuncio acá para no tener que
  // acordarme de clickear la flecha para ir a ver qué había en el período siguiente.
  const urgentesEnOtrosPeriodos = useMemo(() => {
    const pp = alertas?.porPeriodo ?? {};
    const otros = Object.entries(pp).filter(([p]) => p !== periodo);
    if (otros.length === 0) return null;
    const cantidad = otros.reduce((s, [, v]) => s + v.cantidad, 0);
    const monto = otros.reduce((s, [, v]) => s + v.monto, 0);
    // Período más cercano (ordenado lexicograficamente YYYY-MM funciona)
    const proximoPeriodo = otros.map(([p]) => p).sort()[0];
    return { cantidad, monto, proximoPeriodo, porPeriodo: Object.fromEntries(otros) };
  }, [alertas, periodo]);
  const [showModal, setShowModal] = useState(false);
  const [agruparPor, setAgruparPor] = useState<'seccion' | 'edr'>('seccion');
  // Trackear secciones cerradas (default = todas abiertas, así al cambiar modo
  // los grupos nuevos aparecen expandidos automáticamente)
  const [seccionesCerradas, setSeccionesCerradas] = useState<Set<string>>(new Set());
  const [medioPagoModal, setMedioPagoModal] = useState<{
    pagoId: string;
    concepto: string;
    medioInicial: string | null;
  } | null>(null);
  const [toast, setToast] = useState<{
    tipo: 'pagado' | 'desmarcado';
    concepto: string;
    monto: number;
  } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── queries ──────────────────────────────────────────────────────────────
  const { data: pagos, isLoading } = useQuery({
    queryKey: ['pagos_fijos', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('pagos_fijos')
        .select('*')
        .eq('periodo', periodo)
        .order('created_at');
      return (data ?? []) as PagoFijo[];
    },
  });

  // ── Echeqs / cheques programados del mes ──────────────────────────────────
  // Vienen de pagos_gastos.programado (cargados en el modal de gasto o plan de pagos).
  // Se listan en el mes de su fecha de débito y se pueden marcar como pagados.
  const rangoMes = useMemo(() => {
    const [y, m] = periodo.split('-').map(Number);
    const ultimoDiaNum = new Date(y, m, 0).getDate();
    return {
      desde: `${periodo}-01`,
      hasta: `${periodo}-${String(ultimoDiaNum).padStart(2, '0')}`,
    };
  }, [periodo]);

  const { data: programados } = useQuery({
    queryKey: ['pagos_programados', periodo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pagos_gastos')
        .select(
          'id, gasto_id, fecha_pago, monto, medio_pago, numero_operacion, programado, gastos(proveedor, proveedor_id, local)',
        )
        .or('programado.eq.true,medio_pago.eq.cheque_galicia')
        .gte('fecha_pago', rangoMes.desde)
        .lte('fecha_pago', rangoMes.hasta)
        .order('fecha_pago');
      if (error) throw error;
      // El embed `gastos` puede venir como objeto o como array de 1 según la versión
      // de supabase-js: lo normalizamos a objeto.
      return (data ?? []).map((r) => {
        const row = r as unknown as Omit<PagoProgramado, 'gastos'> & {
          gastos: PagoProgramado['gastos'] | PagoProgramado['gastos'][];
        };
        const g = Array.isArray(row.gastos) ? (row.gastos[0] ?? null) : row.gastos;
        return { ...row, gastos: g } as PagoProgramado;
      });
    },
  });

  const { data: categoriasGasto } = useQuery({
    queryKey: ['categorias_gasto_checklist'],
    queryFn: async () => {
      const { data } = await supabase
        .from('categorias_gasto')
        .select('id, nombre, parent_id, tipo_edr, activo')
        .eq('activo', true)
        .order('orden');
      return (data ?? []) as CategoriaGasto[];
    },
  });

  // Subcategorías (hijas) para el select de EdR
  const subcategorias = useMemo(
    () => (categoriasGasto ?? []).filter((c) => c.parent_id !== null),
    [categoriasGasto],
  );

  // Padres para agrupar en el select
  const padres = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categoriasGasto ?? []) {
      if (c.parent_id === null) map.set(c.id, c.nombre);
    }
    return map;
  }, [categoriasGasto]);

  // ── mutaciones ───────────────────────────────────────────────────────────
  const insertPago = useMutation({
    mutationFn: async (pago: Partial<PagoFijo>) => {
      const { error } = await supabase.from('pagos_fijos').insert(pago);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] }),
  });

  // Marcar/desmarcar pagado un echeq programado: flipea programado y recalcula el
  // estado del gasto (Parcial → Pagado cuando el cheque deja de estar "a futuro").
  const toggleProgramado = useMutation({
    mutationFn: async ({
      id,
      gasto_id,
      pagar,
    }: {
      id: string;
      gasto_id: string;
      pagar: boolean;
    }) => {
      const { error } = await supabase
        .from('pagos_gastos')
        .update({ programado: !pagar })
        .eq('id', id);
      if (error) throw error;
      await recomputarEstadoGasto(gasto_id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pagos_programados', periodo] });
      qc.invalidateQueries({ queryKey: ['proy_echeqs_programados'] });
      qc.invalidateQueries({ queryKey: ['gastos'] });
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
      qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
    },
  });

  const deletePago = useMutation({
    mutationFn: async (pago: PagoFijo) => {
      // Si tiene gasto asociado, eliminar pago_gasto y gasto
      if (pago.gasto_id) {
        await supabase.from('pagos_gastos').delete().eq('gasto_id', pago.gasto_id);
        await supabase.from('gastos').delete().eq('id', pago.gasto_id);
      }
      const { error } = await supabase.from('pagos_fijos').delete().eq('id', pago.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] });
      qc.invalidateQueries({ queryKey: ['fc_pagos'] });
    },
  });

  const copiarMesAnterior = useMutation({
    mutationFn: async () => {
      const pAnterior = periodoAnterior(periodo);
      const { data: anterior } = await supabase
        .from('pagos_fijos')
        .select('*')
        .eq('periodo', pAnterior);
      if (!anterior?.length) throw new Error(`No hay datos en ${labelMes(pAnterior)}`);

      const [y, m] = periodo.split('-').map(Number);
      const ultimoDiaNuevo = new Date(y, m, 0).getDate();

      const rows = anterior.map((a: PagoFijo) => {
        // Recalcular fecha vencimiento para el nuevo mes.
        // Si el vencimiento anterior era el último día del mes (ej. 28-feb o
        // 30-abr), preservar "último día" en el nuevo mes en vez de tomar el
        // número literal — un cheque que vence el 28-feb en marzo debería
        // vencer el 31, no el 28.
        let fechaVto: string | null = null;
        if (a.fecha_vencimiento) {
          const fOrig = new Date(a.fecha_vencimiento + 'T12:00:00');
          const diaOrig = fOrig.getDate();
          const ultimoDiaOrig = new Date(
            fOrig.getFullYear(),
            fOrig.getMonth() + 1,
            0,
          ).getDate();
          const dia =
            diaOrig === ultimoDiaOrig ? ultimoDiaNuevo : Math.min(diaOrig, ultimoDiaNuevo);
          fechaVto = `${periodo}-${String(dia).padStart(2, '0')}`;
        }
        return {
          periodo,
          concepto: a.concepto,
          categoria: a.categoria,
          categoria_gasto_id: a.categoria_gasto_id,
          monto: a.monto,
          fecha_vencimiento: fechaVto,
          pagado: false,
          fecha_pago: null,
          medio_pago: null,
          gasto_id: null,
          notas: null,
        };
      });
      const { error } = await supabase
        .from('pagos_fijos')
        .upsert(rows, { onConflict: 'periodo,concepto' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] }),
  });

  // Marcar como pagado: crea gasto + pago_gasto. Si llega numeroOperacion, se
  // guarda en pagos_gastos.referencia para que el matcher por id concilie
  // automaticamente al sincronizar MP / importar extractos. Si llega archivo
  // del comprobante, se sube a Storage y se referencia en gastos.comprobante_path
  // + pagos_gastos.comprobante_pago_path.
  async function marcarPagado(
    pago: PagoFijo,
    medioPago: string,
    numeroOperacion: string | null = null,
    archivoComprobante: File | null = null,
    comprobantePathPreSubido: string | null = null,
  ) {
    // Regla uniforme: pago bancarizado (no efectivo / cta cte) exige N° op + comprobante.
    if (
      medioRequiereComprobante(medioPago) &&
      (!numeroOperacion?.trim() || (!archivoComprobante && !comprobantePathPreSubido))
    ) {
      window.alert(
        'Pago bancarizado: el N° de operación y el comprobante de pago son obligatorios (solo el efectivo está exento). Subí la captura/PDF y cargá el N° de operación.',
      );
      return;
    }

    const fechaPago = hoy();
    const local = derivarLocal(pago.concepto);

    // Buscar nombre de categoría padre para el campo 'categoria' de gastos
    const subcat = subcategorias.find((c) => c.id === pago.categoria_gasto_id);
    const catPadre = subcat?.parent_id ? (padres.get(subcat.parent_id) ?? '') : '';

    // 0. Comprobante: si el modal ya lo subió al disparar OCR, reusamos ese path.
    //    Si no, subimos el File aquí (fallback cuando el OCR no se ejecutó).
    let pathComprobante: string | null = comprobantePathPreSubido;
    if (!pathComprobante && archivoComprobante) {
      const ext = archivoComprobante.name.split('.').pop()?.toLowerCase() || 'pdf';
      const carpeta = `${local}/${fechaPago.substring(0, 7)}`;
      const path = `${carpeta}/pago_fijo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: errUp } = await supabase.storage
        .from('gastos-comprobantes')
        .upload(path, archivoComprobante, {
          contentType: archivoComprobante.type || 'application/octet-stream',
        });
      if (errUp) {
        console.error('Error subiendo comprobante:', errUp);
        window.alert(`No se pudo subir el comprobante: ${errUp.message}`);
        return;
      }
      pathComprobante = path;
    }

    // 1. Crear gasto
    const { data: gastoData, error: e1 } = await supabase
      .from('gastos')
      .insert({
        local,
        fecha: fechaPago,
        fecha_vencimiento: pago.fecha_vencimiento,
        importe_total: pago.monto ?? 0,
        importe_neto: pago.monto ?? 0,
        iva: 0,
        iibb: 0,
        categoria_id: pago.categoria_gasto_id,
        categoria: catPadre,
        subcategoria: subcat?.nombre ?? pago.concepto,
        proveedor: pago.concepto,
        estado_pago: 'Pagado',
        medio_pago: medioPago,
        comentario: `Pago fijo: ${pago.concepto}`,
        comprobante_path: pathComprobante,
        creado_manual: true,
        cancelado: false,
        periodo,
      })
      .select('id')
      .single();

    if (e1 || !gastoData) {
      console.error('Error creando gasto:', e1);
      return;
    }

    // 2. Crear pago_gasto
    await supabase.from('pagos_gastos').insert({
      gasto_id: gastoData.id,
      fecha_pago: fechaPago,
      monto: pago.monto ?? 0,
      medio_pago: medioPago,
      referencia: numeroOperacion,
      numero_operacion: numeroOperacion,
      comprobante_pago_path: pathComprobante,
    });

    // 3. Actualizar pago_fijo
    await supabase
      .from('pagos_fijos')
      .update({
        pagado: true,
        fecha_pago: fechaPago,
        medio_pago: medioPago,
        gasto_id: gastoData.id,
      })
      .eq('id', pago.id);

    qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] });
    qc.invalidateQueries({ queryKey: ['fc_pagos'] });
    qc.invalidateQueries({ queryKey: ['edr_gastos_resumen'] });
    setToast({ tipo: 'pagado', concepto: pago.concepto, monto: pago.monto ?? 0 });
  }

  // Desmarcar pagado: elimina gasto + pago_gasto
  async function desmarcarPagado(pago: PagoFijo) {
    if (pago.gasto_id) {
      await supabase.from('pagos_gastos').delete().eq('gasto_id', pago.gasto_id);
      await supabase.from('gastos').delete().eq('id', pago.gasto_id);
    }
    await supabase
      .from('pagos_fijos')
      .update({
        pagado: false,
        fecha_pago: null,
        medio_pago: null,
        gasto_id: null,
      })
      .eq('id', pago.id);

    qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] });
    qc.invalidateQueries({ queryKey: ['fc_pagos'] });
    qc.invalidateQueries({ queryKey: ['edr_gastos_resumen'] });
    setToast({ tipo: 'desmarcado', concepto: pago.concepto, monto: pago.monto ?? 0 });
  }

  // Actualizar campos del pago fijo. Si ya esta pagado, propagar al gasto +
  // pago_gasto vinculados para que el cambio se refleje en Flujo de Caja y EdR
  // sin tener que desmarcar/marcar de nuevo.
  async function actualizarPago(pago: PagoFijo, fields: Partial<PagoFijo>) {
    await supabase.from('pagos_fijos').update(fields).eq('id', pago.id);

    if (pago.pagado && pago.gasto_id) {
      const updateGasto: Record<string, unknown> = {};
      const updatePagoGasto: Record<string, unknown> = {};

      if ('concepto' in fields && fields.concepto) {
        updateGasto.proveedor = fields.concepto;
      }
      if ('monto' in fields) {
        const m = fields.monto ?? 0;
        updateGasto.importe_total = m;
        updateGasto.importe_neto = m;
        updatePagoGasto.monto = m;
      }
      if ('fecha_vencimiento' in fields) {
        updateGasto.fecha_vencimiento = fields.fecha_vencimiento;
      }
      if ('categoria_gasto_id' in fields) {
        updateGasto.categoria_id = fields.categoria_gasto_id;
        const subcat = subcategorias.find((c) => c.id === fields.categoria_gasto_id);
        const catPadre = subcat?.parent_id ? (padres.get(subcat.parent_id) ?? '') : '';
        updateGasto.categoria = catPadre;
        updateGasto.subcategoria = subcat?.nombre ?? (fields.concepto ?? pago.concepto);
      }
      if ('medio_pago' in fields) {
        updateGasto.medio_pago = fields.medio_pago;
        updatePagoGasto.medio_pago = fields.medio_pago;
      }

      if (Object.keys(updateGasto).length > 0) {
        await supabase.from('gastos').update(updateGasto).eq('id', pago.gasto_id);
      }
      if (Object.keys(updatePagoGasto).length > 0) {
        await supabase
          .from('pagos_gastos')
          .update(updatePagoGasto)
          .eq('gasto_id', pago.gasto_id);
      }
    }

    qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] });
    qc.invalidateQueries({ queryKey: ['fc_pagos'] });
    qc.invalidateQueries({ queryKey: ['edr_gastos_resumen'] });
  }

  // ── datos derivados ──────────────────────────────────────────────────────
  const porCategoria = useMemo(() => {
    const grupos = new Map<string, PagoFijo[]>();

    if (agruparPor === 'edr') {
      // Agrupar por categoría EdR padre (gastos de estructura, impuestos y tasas, etc.)
      const subcatsById = new Map(subcategorias.map((s) => [s.id, s]));
      // Inicializar grupos en el orden de los padres para layout estable
      for (const [, padreNombre] of padres) grupos.set(padreNombre, []);
      for (const p of pagos ?? []) {
        let groupName = 'Sin categoría EdR';
        if (p.categoria_gasto_id) {
          const sub = subcatsById.get(p.categoria_gasto_id);
          if (sub?.parent_id) {
            groupName = padres.get(sub.parent_id) ?? 'Sin categoría EdR';
          }
        }
        const arr = grupos.get(groupName) ?? [];
        arr.push(p);
        grupos.set(groupName, arr);
      }
    } else {
      for (const cat of CATEGORIAS) grupos.set(cat, []);
      for (const p of pagos ?? []) {
        const arr = grupos.get(p.categoria);
        if (arr) arr.push(p);
        else {
          const existing = grupos.get(p.categoria) ?? [];
          existing.push(p);
          grupos.set(p.categoria, existing);
        }
      }
    }

    // Ordenar cada grupo por vencimiento ascendente
    for (const [, items] of grupos) {
      items.sort(compararPorVencimiento);
    }

    return grupos;
  }, [pagos, agruparPor, subcategorias, padres]);

  const resumen = useMemo(() => {
    let totalEstimado = 0,
      totalPagado = 0,
      itemsPagados = 0,
      itemsTotal = 0;
    for (const p of pagos ?? []) {
      itemsTotal++;
      const m = p.monto ?? 0;
      totalEstimado += m;
      if (p.pagado) {
        totalPagado += m;
        itemsPagados++;
      }
    }
    // Los echeqs/cheques del mes también suman al checklist: pendiente = programado.
    for (const pg of programados ?? []) {
      itemsTotal++;
      const m = Number(pg.monto ?? 0);
      totalEstimado += m;
      if (!pg.programado) {
        totalPagado += m;
        itemsPagados++;
      }
    }
    return {
      totalEstimado,
      totalPagado,
      pendiente: totalEstimado - totalPagado,
      itemsPagados,
      itemsTotal,
    };
  }, [pagos, programados]);

  const hayProgramados = (programados?.length ?? 0) > 0;

  // Alertas por urgencia (solo pagos no pagados del mes actual)
  const alertasUrgencia = useMemo(() => {
    const pendientes = (pagos ?? []).filter((p) => !p.pagado && p.fecha_vencimiento);
    const porUrgencia = {
      vencido: [] as PagoFijo[],
      hoy: [] as PagoFijo[],
      semana: [] as PagoFijo[],
    };
    for (const p of pendientes) {
      const u = urgenciaPago(p.fecha_vencimiento);
      if (u === 'vencido') porUrgencia.vencido.push(p);
      else if (u === 'hoy') porUrgencia.hoy.push(p);
      else if (u === 'semana') porUrgencia.semana.push(p);
    }
    return porUrgencia;
  }, [pagos]);

  const tieneAlertas =
    alertasUrgencia.vencido.length + alertasUrgencia.hoy.length + alertasUrgencia.semana.length > 0;

  const tieneItems = (pagos?.length ?? 0) > 0;

  function toggleSeccion(cat: string) {
    setSeccionesCerradas((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPeriodo(periodoAnterior(periodo))}
            className="relative rounded px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            ←
            {alertas?.porPeriodo?.[periodoAnterior(periodo)] && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
                {alertas.porPeriodo[periodoAnterior(periodo)].cantidad}
              </span>
            )}
          </button>
          <h3 className="min-w-[160px] text-center text-lg font-semibold text-gray-800">
            {labelMes(periodo)}
          </h3>
          <button
            onClick={() => setPeriodo(periodoSiguiente(periodo))}
            className="relative rounded px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            →
            {alertas?.porPeriodo?.[periodoSiguiente(periodo)] && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
                {alertas.porPeriodo[periodoSiguiente(periodo)].cantidad}
              </span>
            )}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 p-0.5 text-xs">
            <span className="px-2 text-gray-500">Agrupar:</span>
            <button
              onClick={() => setAgruparPor('seccion')}
              className={cn(
                'rounded px-2.5 py-1 transition-colors',
                agruparPor === 'seccion'
                  ? 'bg-white font-medium text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              )}
            >
              Sección
            </button>
            <button
              onClick={() => setAgruparPor('edr')}
              className={cn(
                'rounded px-2.5 py-1 transition-colors',
                agruparPor === 'edr'
                  ? 'bg-white font-medium text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              )}
            >
              Categoría EdR
            </button>
          </div>
          <button
            onClick={() => copiarMesAnterior.mutate()}
            disabled={copiarMesAnterior.isPending}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {copiarMesAnterior.isPending
              ? 'Copiando...'
              : `Copiar desde ${labelMes(periodoAnterior(periodo))}`}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-md bg-rodziny-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rodziny-700"
          >
            + Agregar pago
          </button>
        </div>
      </div>

      {copiarMesAnterior.isError && (
        <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">
          {(copiarMesAnterior.error as Error).message}
        </div>
      )}

      {urgentesEnOtrosPeriodos && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-amber-900">
            <span className="text-base leading-none">⚠️</span>
            <span>
              Tenés <strong>{urgentesEnOtrosPeriodos.cantidad}</strong>{' '}
              {urgentesEnOtrosPeriodos.cantidad === 1 ? 'pago urgente' : 'pagos urgentes'} en{' '}
              <strong>{labelMes(urgentesEnOtrosPeriodos.proximoPeriodo)}</strong> por{' '}
              <strong>{formatARS(urgentesEnOtrosPeriodos.monto)}</strong>
            </span>
          </div>
          <button
            onClick={() => setPeriodo(urgentesEnOtrosPeriodos.proximoPeriodo)}
            className="whitespace-nowrap rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
          >
            Ver {labelMes(urgentesEnOtrosPeriodos.proximoPeriodo)} →
          </button>
        </div>
      )}

      {/* Hint explicativo */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        <span className="text-base leading-none">ℹ️</span>
        <span>
          Al marcar un pago como <strong>Pagado</strong> se crea automáticamente un gasto que
          impacta en <strong>Flujo de Caja</strong> y <strong>EdR</strong>. Si lo desmarcás, el
          gasto se elimina.
        </span>
      </div>

      {/* KPIs */}
      {(tieneItems || hayProgramados) && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-surface-border bg-white p-4">
            <p className="mb-1 text-xs text-gray-500">Total Estimado</p>
            <p className="text-lg font-semibold text-gray-800">
              {formatARS(resumen.totalEstimado)}
            </p>
          </div>
          <div className="rounded-lg border border-surface-border bg-white p-4">
            <p className="mb-1 text-xs text-gray-500">Total Pagado</p>
            <p className="text-lg font-semibold text-green-700">{formatARS(resumen.totalPagado)}</p>
          </div>
          <div className="rounded-lg border border-surface-border bg-white p-4">
            <p className="mb-1 text-xs text-gray-500">Pendiente</p>
            <p className="text-lg font-semibold text-red-600">{formatARS(resumen.pendiente)}</p>
          </div>
          <div className="rounded-lg border border-surface-border bg-white p-4">
            <p className="mb-1 text-xs text-gray-500">Progreso</p>
            <p className="text-lg font-semibold text-gray-800">
              {resumen.itemsPagados} / {resumen.itemsTotal}
            </p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{
                  width:
                    resumen.itemsTotal > 0
                      ? `${(resumen.itemsPagados / resumen.itemsTotal) * 100}%`
                      : '0%',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Banner de alertas por urgencia */}
      {tieneAlertas && (
        <div className="space-y-2">
          {alertasUrgencia.vencido.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-3">
              <div className="text-xl">🔴</div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-900">
                  {alertasUrgencia.vencido.length} pago
                  {alertasUrgencia.vencido.length > 1 ? 's' : ''} vencido
                  {alertasUrgencia.vencido.length > 1 ? 's' : ''}
                </p>
                <p className="mt-0.5 text-xs text-red-700">
                  {alertasUrgencia.vencido.map((p) => p.concepto).join(', ')}
                </p>
              </div>
              <div className="text-sm font-bold text-red-900">
                {formatARS(alertasUrgencia.vencido.reduce((s, p) => s + (p.monto ?? 0), 0))}
              </div>
            </div>
          )}
          {alertasUrgencia.hoy.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <div className="text-xl">⚠️</div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  {alertasUrgencia.hoy.length} pago{alertasUrgencia.hoy.length > 1 ? 's' : ''} vence
                  {alertasUrgencia.hoy.length > 1 ? 'n' : ''} HOY
                </p>
                <p className="mt-0.5 text-xs text-amber-700">
                  {alertasUrgencia.hoy.map((p) => p.concepto).join(', ')}
                </p>
              </div>
              <div className="text-sm font-bold text-amber-900">
                {formatARS(alertasUrgencia.hoy.reduce((s, p) => s + (p.monto ?? 0), 0))}
              </div>
            </div>
          )}
          {alertasUrgencia.semana.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 p-3">
              <div className="text-xl">📅</div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-900">
                  {alertasUrgencia.semana.length} pago{alertasUrgencia.semana.length > 1 ? 's' : ''}{' '}
                  próximo{alertasUrgencia.semana.length > 1 ? 's' : ''} a vencer (7 días)
                </p>
                <p className="mt-0.5 text-xs text-orange-700">
                  {alertasUrgencia.semana.map((p) => p.concepto).join(', ')}
                </p>
              </div>
              <div className="text-sm font-bold text-orange-900">
                {formatARS(alertasUrgencia.semana.reduce((s, p) => s + (p.monto ?? 0), 0))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Estado vacío */}
      {!tieneItems && !hayProgramados && !isLoading && (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <div className="mb-3 text-4xl">📋</div>
          <p className="font-medium text-gray-600">No hay pagos fijos para {labelMes(periodo)}</p>
          <p className="mt-1 text-sm text-gray-400">
            Agregá pagos manualmente o copiá desde {labelMes(periodoAnterior(periodo))}
          </p>
        </div>
      )}

      {/* Echeqs y pagos programados del mes (de pagos_gastos.programado) */}
      {hayProgramados && (
        <div className="overflow-hidden rounded-lg border border-purple-200 bg-white">
          <div className="flex items-center justify-between bg-purple-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm">📝</span>
              <span className="text-sm font-semibold text-purple-900">
                Echeqs y pagos programados
              </span>
              <span className="text-xs text-purple-400">
                ({(programados ?? []).filter((p) => !p.programado).length}/
                {(programados ?? []).length})
              </span>
            </div>
            <span className="text-sm font-semibold text-purple-800">
              {formatARS((programados ?? []).reduce((s, p) => s + Number(p.monto ?? 0), 0))}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                  <th className="px-4 py-2 text-left font-medium">Proveedor</th>
                  <th className="px-4 py-2 text-center font-medium">Fecha débito</th>
                  <th className="px-4 py-2 text-left font-medium">Medio</th>
                  <th className="px-4 py-2 text-left font-medium">N° echeq/op</th>
                  <th className="px-4 py-2 text-right font-medium">Monto</th>
                  <th className="px-4 py-2 text-center font-medium">Pagado</th>
                </tr>
              </thead>
              <tbody>
                {(programados ?? []).map((pg) => {
                  const pagado = !pg.programado;
                  return (
                    <tr
                      key={pg.id}
                      className={cn('border-b border-gray-50', pagado && 'bg-green-50/40')}
                    >
                      <td className="px-4 py-2 text-gray-800">
                        <ProveedorLabel
                          value={resolverProveedor(pg.gastos ?? {}, proveedoresMap, '—')}
                        />
                      </td>
                      <td className="px-4 py-2 text-center text-gray-600">
                        {new Date(pg.fecha_pago + 'T12:00:00').toLocaleDateString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-2 text-gray-600">
                        {pg.medio_pago
                          ? (MEDIO_PAGO_LABEL[pg.medio_pago as MedioPago] ?? pg.medio_pago)
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{pg.numero_operacion ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-800">
                        {formatARS(Number(pg.monto ?? 0))}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={pagado}
                          disabled={toggleProgramado.isPending}
                          onChange={(e) =>
                            toggleProgramado.mutate({
                              id: pg.id,
                              gasto_id: pg.gasto_id,
                              pagar: e.target.checked,
                            })
                          }
                          className="h-4 w-4 cursor-pointer rounded"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabla agrupada */}
      {tieneItems &&
        [...porCategoria.entries()].map(([cat, filas]) => {
          if (!filas.length) return null;
          const abierta = !seccionesCerradas.has(cat);
          const subtotal = filas.reduce((s, p) => s + (p.monto ?? 0), 0);
          const pagados = filas.filter((p) => p.pagado).length;

          return (
            <div
              key={cat}
              className="overflow-hidden rounded-lg border border-surface-border bg-white"
            >
              <button
                onClick={() => toggleSeccion(cat)}
                className="flex w-full items-center justify-between bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{abierta ? '▼' : '▶'}</span>
                  <span className="text-sm">{iconoGrupo(cat)}</span>
                  <span className="text-sm font-semibold text-gray-800">{cat}</span>
                  <span className="text-xs text-gray-400">
                    ({pagados}/{filas.length})
                  </span>
                </div>
                <span className="text-sm font-semibold text-gray-700">{formatARS(subtotal)}</span>
              </button>

              {abierta && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                        <th className="px-4 py-2 text-left font-medium">Concepto</th>
                        <th className="px-4 py-2 text-left font-medium">Cat. EdR</th>
                        <th className="px-4 py-2 text-right font-medium">Monto</th>
                        <th className="px-4 py-2 text-center font-medium">Vto.</th>
                        <th className="px-4 py-2 text-center font-medium">Pagado</th>
                        <th className="px-4 py-2 text-left font-medium">Medio</th>
                        <th className="px-4 py-2 text-left font-medium">Notas</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((pago) => (
                        <FilaPago
                          key={pago.id}
                          pago={pago}
                          subcategorias={subcategorias}
                          padres={padres}
                          onUpdate={(fields) => actualizarPago(pago, fields)}
                          onTogglePagado={() => {
                            if (pago.pagado) {
                              desmarcarPagado(pago);
                            } else {
                              setMedioPagoModal({
                                pagoId: pago.id,
                                concepto: pago.concepto,
                                medioInicial: pago.medio_pago,
                              });
                            }
                          }}
                          onDelete={() => {
                            if (confirm(`¿Eliminar "${pago.concepto}"?`)) deletePago.mutate(pago);
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

      {/* Modal agregar pago */}
      {showModal && (
        <ModalAgregarPago
          periodo={periodo}
          subcategorias={subcategorias}
          padres={padres}
          onSave={(pago) => {
            insertPago.mutate(pago);
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Toast flotante */}
      {toast && (
        <div className="animate-in fade-in slide-in-from-bottom-4 fixed bottom-4 right-4 z-50 max-w-sm">
          <div
            className={cn(
              'flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg',
              toast.tipo === 'pagado'
                ? 'border-green-300 bg-green-50'
                : 'border-gray-300 bg-gray-50',
            )}
          >
            <span className="text-xl leading-none">{toast.tipo === 'pagado' ? '✅' : '↩️'}</span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm font-semibold',
                  toast.tipo === 'pagado' ? 'text-green-900' : 'text-gray-800',
                )}
              >
                {toast.tipo === 'pagado' ? 'Pago registrado' : 'Pago desmarcado'}
              </p>
              <p
                className={cn(
                  'mt-0.5 text-xs',
                  toast.tipo === 'pagado' ? 'text-green-700' : 'text-gray-600',
                )}
              >
                {toast.tipo === 'pagado'
                  ? `Se creó un gasto de ${formatARS(toast.monto)} por "${toast.concepto}" — impacta en Flujo de Caja y EdR.`
                  : `Se eliminó el gasto de "${toast.concepto}" de Flujo de Caja y EdR.`}
              </p>
            </div>
            <button
              onClick={() => setToast(null)}
              className="text-sm leading-none text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Modal medio de pago + N° operacion al confirmar pago */}
      {medioPagoModal && (
        <ModalMedioPago
          concepto={medioPagoModal.concepto}
          medioInicial={medioPagoModal.medioInicial}
          subfolder={`pagos-fijos/${derivarLocal(medioPagoModal.concepto)}`}
          onConfirmar={(medio, numeroOperacion, archivo, comprobantePathPreSubido) => {
            const pago = (pagos ?? []).find((p) => p.id === medioPagoModal.pagoId);
            if (pago) marcarPagado(pago, medio, numeroOperacion, archivo, comprobantePathPreSubido);
            setMedioPagoModal(null);
          }}
          onClose={() => setMedioPagoModal(null)}
        />
      )}
    </div>
  );
}

// ── fila editable ────────────────────────────────────────────────────────────
function FilaPago({
  pago,
  subcategorias,
  padres,
  onUpdate,
  onTogglePagado,
  onDelete,
}: {
  pago: PagoFijo;
  subcategorias: CategoriaGasto[];
  padres: Map<string, string>;
  onUpdate: (fields: Partial<PagoFijo>) => void;
  onTogglePagado: () => void;
  onDelete: () => void;
}) {
  const [conceptoLocal, setConceptoLocal] = useState(pago.concepto);
  const [notasLocal, setNotasLocal] = useState(pago.notas ?? '');

  // Mantener input de concepto sincronizado si llega un cambio externo
  useEffect(() => {
    setConceptoLocal(pago.concepto);
  }, [pago.concepto]);

  const urg: UrgenciaPago = pago.pagado ? 'ok' : urgenciaPago(pago.fecha_vencimiento);

  // Campo "fantasma": se ve como texto plano y solo muestra caja al hover/foco.
  const ghost =
    'w-full rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-gray-200 focus:border-rodziny-500 focus:bg-white focus:outline-none';

  // Acento de urgencia: barrita de color a la izquierda en vez de pintar la fila.
  const acento =
    !pago.pagado && urg === 'vencido'
      ? 'border-l-[3px] border-l-red-400'
      : !pago.pagado && urg === 'hoy'
        ? 'border-l-[3px] border-l-amber-400'
        : !pago.pagado && urg === 'semana'
          ? 'border-l-[3px] border-l-orange-300'
          : 'border-l-[3px] border-l-transparent';

  return (
    <tr
      className={cn(
        'group border-b border-gray-50 hover:bg-gray-50/50',
        pago.pagado && 'bg-green-50/20',
      )}
    >
      <td className={cn('px-4 py-2', acento)}>
        <input
          type="text"
          value={conceptoLocal}
          onChange={(e) => setConceptoLocal(e.target.value)}
          onBlur={() => {
            const t = conceptoLocal.trim();
            if (t && t !== pago.concepto) onUpdate({ concepto: t });
            else if (!t) setConceptoLocal(pago.concepto);
          }}
          className={cn(
            ghost,
            'max-w-[200px] text-sm font-medium text-gray-800',
            pago.pagado && 'text-gray-400 line-through',
          )}
        />
        <select
          className="mt-0.5 max-w-[200px] rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[10px] text-gray-400 opacity-0 transition-opacity hover:border-gray-200 focus:border-rodziny-500 focus:bg-white focus:opacity-100 focus:outline-none group-hover:opacity-100"
          value={pago.categoria}
          onChange={(e) => onUpdate({ categoria: e.target.value })}
        >
          {CATEGORIAS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          {!CATEGORIAS.includes(pago.categoria) && (
            <option value={pago.categoria}>{pago.categoria}</option>
          )}
        </select>
      </td>
      <td className="px-4 py-2">
        <select
          className={cn(ghost, 'max-w-[150px] text-xs text-gray-500')}
          value={pago.categoria_gasto_id ?? ''}
          onChange={(e) => onUpdate({ categoria_gasto_id: e.target.value || null })}
        >
          <option value="">Sin asignar</option>
          {[...padres.entries()].map(([padreId, padreNombre]) => (
            <optgroup key={padreId} label={padreNombre}>
              {subcategorias
                .filter((s) => s.parent_id === padreId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </td>
      <td className="px-4 py-2">
        <MontoInput
          className={cn(
            ghost,
            'max-w-[130px] text-right text-sm font-medium tabular-nums text-gray-800',
          )}
          value={pago.monto}
          onChange={() => {}}
          onCommit={(num) => {
            const limpio = num ?? 0;
            if (limpio !== (pago.monto ?? 0)) onUpdate({ monto: limpio });
          }}
        />
      </td>
      <td className="px-4 py-2 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <input
            type="date"
            className={cn(ghost, 'w-auto text-xs text-gray-600')}
            value={pago.fecha_vencimiento ?? ''}
            onChange={(e) => onUpdate({ fecha_vencimiento: e.target.value || null })}
          />
          {!pago.pagado && urg === 'vencido' && (
            <span className="rounded bg-red-200 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
              VENCIDO
            </span>
          )}
          {!pago.pagado && urg === 'hoy' && (
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
              HOY
            </span>
          )}
          {!pago.pagado && urg === 'semana' && (
            <span className="rounded bg-orange-200 px-1.5 py-0.5 text-[10px] font-bold text-orange-800">
              7 días
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2 text-center">
        <input
          type="checkbox"
          checked={pago.pagado}
          onChange={onTogglePagado}
          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-green-600 focus:ring-green-500"
        />
      </td>
      <td className="px-4 py-2">
        <select
          className={cn(ghost, 'text-xs text-gray-500')}
          value={pago.medio_pago ?? ''}
          onChange={(e) => onUpdate({ medio_pago: e.target.value || null })}
        >
          <option value="">—</option>
          {MEDIOS.map((m) => (
            <option key={m} value={m}>
              {MEDIO_PAGO_LABEL[m]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2">
        <input
          type="text"
          className={cn(ghost, 'max-w-[150px] text-sm text-gray-500')}
          value={notasLocal}
          onChange={(e) => setNotasLocal(e.target.value)}
          onBlur={() => {
            if (notasLocal !== (pago.notas ?? '')) onUpdate({ notas: notasLocal || null });
          }}
          placeholder="—"
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          {pago.comprobante_path && (
            <button
              onClick={async () => {
                const { data } = await supabase.storage
                  .from('correos-contadores')
                  .createSignedUrl(pago.comprobante_path!, 300);
                if (data) window.open(data.signedUrl, '_blank');
              }}
              className="text-xs text-blue-600 hover:underline"
              title="Ver comprobante (ej. PDF del VEP)"
            >
              📎
            </button>
          )}
          <button
            onClick={onDelete}
            className="text-sm text-gray-300 opacity-0 transition-opacity hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
            title="Eliminar"
          >
            🗑
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── modal agregar pago ───────────────────────────────────────────────────────
function ModalAgregarPago({
  periodo,
  subcategorias,
  padres,
  onSave,
  onClose,
}: {
  periodo: string;
  subcategorias: CategoriaGasto[];
  padres: Map<string, string>;
  onSave: (pago: Partial<PagoFijo>) => void;
  onClose: () => void;
}) {
  const [concepto, setConcepto] = useState('');
  const [categoria, setCategoria] = useState(CATEGORIAS[0]);
  const [catGastoId, setCatGastoId] = useState('');
  const [monto, setMonto] = useState<number | null>(null);
  const [fechaVto, setFechaVto] = useState('');
  const [notas, setNotas] = useState('');

  function guardar() {
    if (!concepto.trim()) return;
    onSave({
      periodo,
      concepto: concepto.trim(),
      categoria,
      categoria_gasto_id: catGastoId || null,
      monto,
      fecha_vencimiento: fechaVto || null,
      notas: notas || null,
      pagado: false,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h3 className="font-semibold text-gray-800">Agregar pago fijo</h3>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <div className="space-y-3 px-6 py-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Concepto</label>
            <input
              type="text"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none"
              placeholder="Ej: Alquiler Vedia"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Categoría</label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none"
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Categoría EdR</label>
              <select
                value={catGastoId}
                onChange={(e) => setCatGastoId(e.target.value)}
                className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none"
              >
                <option value="">Opcional</option>
                {[...padres.entries()].map(([padreId, padreNombre]) => (
                  <optgroup key={padreId} label={padreNombre}>
                    {subcategorias
                      .filter((s) => s.parent_id === padreId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nombre}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Monto</label>
              <MontoInput
                value={monto}
                onChange={setMonto}
                className="w-full rounded border border-gray-200 px-3 py-2 text-right text-sm focus:border-rodziny-500 focus:outline-none"
                placeholder="0"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Vencimiento</label>
              <input
                type="date"
                value={fechaVto}
                onChange={(e) => setFechaVto(e.target.value)}
                className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Notas</label>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none"
              placeholder="Opcional"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-gray-500 hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={!concepto.trim()}
            className="rounded-md bg-rodziny-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rodziny-700 disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── modal confirmar pago (medio + N° operacion + comprobante) ────────────────
function ModalMedioPago({
  concepto,
  medioInicial,
  subfolder,
  onConfirmar,
  onClose,
}: {
  concepto: string;
  medioInicial: string | null;
  subfolder: string;
  onConfirmar: (
    medio: string,
    numeroOperacion: string | null,
    archivo: File | null,
    comprobantePathPreSubido: string | null,
  ) => void;
  onClose: () => void;
}) {
  const [medio, setMedio] = useState<string>(medioInicial ?? '');
  const [numeroOp, setNumeroOp] = useState<string>('');
  const [archivo, setArchivo] = useState<File | null>(null);
  // Path del comprobante ya subido por OCR (se reusa al confirmar)
  const [comprobantePath, setComprobantePath] = useState<string | null>(null);
  const [ocrEjecutando, setOcrEjecutando] = useState(false);
  const [ocrInfo, setOcrInfo] = useState<string | null>(null);
  const [ocrWarning, setOcrWarning] = useState<string | null>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  // Para transferencias/cheque/tarjeta: N° op + archivo son obligatorios — son
  // las dos piezas que necesitamos para conciliar contra el extracto bancario.
  const requiereComprobante = !!medio && medio !== 'efectivo';

  async function onArchivoSeleccionado(file: File | null) {
    setErrorLocal(null);
    setOcrInfo(null);
    setOcrWarning(null);
    setComprobantePath(null);
    setArchivo(file);
    if (!file) return;
    setOcrEjecutando(true);
    try {
      const res = await procesarComprobantePago({ archivo: file, subfolder, userId: null });
      if (!res.ok && res.error) {
        setErrorLocal(res.error);
        return;
      }
      setComprobantePath(res.file_path);
      if (res.n_operacion && !numeroOp.trim()) {
        setNumeroOp(res.n_operacion);
        const pct = Math.round((res.confianza ?? 0) * 100);
        setOcrInfo(`✓ N° detectado: ${res.n_operacion}${pct ? ` (${pct}% confianza)` : ''}`);
      } else if (!res.n_operacion) {
        setOcrInfo('Archivo subido. Completá el N° de operación manualmente.');
      } else {
        setOcrInfo(`✓ Archivo subido. N° detectado: ${res.n_operacion} (no se sobreescribió).`);
      }
      if (res.warning) setOcrWarning(res.warning);
    } finally {
      setOcrEjecutando(false);
    }
  }

  function confirmar() {
    setErrorLocal(null);
    if (!medio) return;
    if (requiereComprobante) {
      if (!numeroOp.trim()) {
        setErrorLocal('N° de operación obligatorio para transferencias, cheques y tarjeta.');
        return;
      }
      if (!archivo && !comprobantePath) {
        setErrorLocal('Comprobante de pago obligatorio para transferencias, cheques y tarjeta.');
        return;
      }
      if (ocrEjecutando) {
        setErrorLocal('Esperá a que termine el análisis del comprobante.');
        return;
      }
    }
    // Si OCR ya subió el archivo, pasamos el path y archivo=null (no resubir).
    // Si no se ejecutó OCR (efectivo sin comprobante), pasamos el File.
    onConfirmar(
      medio,
      numeroOp.trim() || null,
      comprobantePath ? null : archivo,
      comprobantePath,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="border-b px-6 py-4">
          <h3 className="font-semibold text-gray-800">Confirmar pago</h3>
          <p className="mt-1 text-xs text-gray-500">{concepto}</p>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Medio de pago</label>
            <select
              autoFocus
              value={medio}
              onChange={(e) => setMedio(e.target.value)}
              className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none"
            >
              <option value="">— Elegir medio —</option>
              {MEDIOS.map((m) => (
                <option key={m} value={m}>
                  {MEDIO_PAGO_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              N° de operación{requiereComprobante ? ' *' : ' (opcional)'}
            </label>
            <input
              type="text"
              value={numeroOp}
              onChange={(e) => setNumeroOp(e.target.value)}
              placeholder={
                medio === 'transferencia_galicia' || medio === 'cheque_galicia'
                  ? 'Leyenda adicional (ej: 5034490189) o N° de cheque'
                  : medio === 'transferencia_mp'
                    ? 'N° op MP (ej: 157737647098)'
                    : 'Ej: 157737647098'
              }
              className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              {medio === 'transferencia_galicia' || medio === 'cheque_galicia'
                ? 'Del PDF Galicia: copiá la "Leyenda adicional" (10 dígitos). Concilia aunque el extracto trunque el primer dígito.'
                : 'Subí el comprobante y el N° de operación se completa solo. Concilia automáticamente al importar el extracto.'}
            </p>
          </div>
          {requiereComprobante && (
            <div>
              <label className="mb-1 block text-xs text-gray-500">Comprobante de pago *</label>
              <input
                type="file"
                accept="image/*,application/pdf"
                disabled={ocrEjecutando}
                onChange={(e) => onArchivoSeleccionado(e.target.files?.[0] ?? null)}
                className="block w-full text-xs file:mr-2 file:rounded file:border file:border-gray-300 file:bg-gray-50 file:px-2 file:py-1 file:text-xs file:text-gray-700 disabled:opacity-50"
              />
              {archivo && (
                <p className="mt-1 truncate text-[11px] text-green-700">📎 {archivo.name}</p>
              )}
              {ocrEjecutando && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-blue-700">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
                  Leyendo comprobante…
                </p>
              )}
              {ocrInfo && !ocrEjecutando && (
                <p className="mt-1 text-[11px] text-green-700">{ocrInfo}</p>
              )}
              {ocrWarning && (
                <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  {ocrWarning}
                </p>
              )}
            </div>
          )}
          {errorLocal && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
              {errorLocal}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-6 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={!medio || ocrEjecutando}
            className="rounded-md bg-rodziny-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rodziny-700 disabled:opacity-50"
          >
            Confirmar pago
          </button>
        </div>
      </div>
    </div>
  );
}
