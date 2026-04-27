import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, cn } from '@/lib/utils';
import { type MedioPago, MEDIO_PAGO_LABEL } from '@/modules/gastos/types';
import { urgenciaPago, usePagosAlertas, type UrgenciaPago } from '@/modules/finanzas/hooks/usePagosAlertas';

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
}

interface CategoriaGasto {
  id: string;
  nombre: string;
  parent_id: string | null;
  tipo_edr: string | null;
  activo: boolean;
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
  const [medioPagoModal, setMedioPagoModal] = useState<{ pagoId: string; concepto: string } | null>(
    null,
  );
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

  const updatePago = useMutation({
    mutationFn: async ({ id, ...fields }: Partial<PagoFijo> & { id: string }) => {
      const { error } = await supabase.from('pagos_fijos').update(fields).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pagos_fijos', periodo] }),
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

  // Marcar como pagado: crea gasto + pago_gasto
  async function marcarPagado(pago: PagoFijo, medioPago: string) {
    const fechaPago = hoy();
    const local = derivarLocal(pago.concepto);

    // Buscar nombre de categoría padre para el campo 'categoria' de gastos
    const subcat = subcategorias.find((c) => c.id === pago.categoria_gasto_id);
    const catPadre = subcat?.parent_id ? (padres.get(subcat.parent_id) ?? '') : '';

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
    return {
      totalEstimado,
      totalPagado,
      pendiente: totalEstimado - totalPagado,
      itemsPagados,
      itemsTotal,
    };
  }, [pagos]);

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
      {tieneItems && (
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
      {!tieneItems && !isLoading && (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <div className="mb-3 text-4xl">📋</div>
          <p className="font-medium text-gray-600">No hay pagos fijos para {labelMes(periodo)}</p>
          <p className="mt-1 text-sm text-gray-400">
            Agregá pagos manualmente o copiá desde {labelMes(periodoAnterior(periodo))}
          </p>
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
                          onUpdate={(fields) => updatePago.mutate({ id: pago.id, ...fields })}
                          onTogglePagado={() => {
                            if (pago.pagado) {
                              desmarcarPagado(pago);
                            } else if (pago.medio_pago) {
                              marcarPagado(pago, pago.medio_pago);
                            } else {
                              setMedioPagoModal({ pagoId: pago.id, concepto: pago.concepto });
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

      {/* Modal medio de pago (al marcar pagado sin medio) */}
      {medioPagoModal && (
        <ModalMedioPago
          concepto={medioPagoModal.concepto}
          onSelect={(medio) => {
            const pago = (pagos ?? []).find((p) => p.id === medioPagoModal.pagoId);
            if (pago) marcarPagado(pago, medio);
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
  const [montoLocal, setMontoLocal] = useState(pago.monto != null ? String(pago.monto) : '');
  const [notasLocal, setNotasLocal] = useState(pago.notas ?? '');

  const subcatNombre = subcategorias.find((c) => c.id === pago.categoria_gasto_id)?.nombre ?? '';
  const urg: UrgenciaPago = pago.pagado ? 'ok' : urgenciaPago(pago.fecha_vencimiento);

  return (
    <tr
      className={cn(
        'border-b border-gray-50 hover:bg-gray-50/50',
        pago.pagado && 'bg-green-50/30',
        !pago.pagado && urg === 'vencido' && 'bg-red-50',
        !pago.pagado && urg === 'hoy' && 'bg-amber-50',
        !pago.pagado && urg === 'semana' && 'bg-orange-50/60',
      )}
    >
      <td className="px-4 py-2">
        <span className={cn('text-gray-700', pago.pagado && 'text-gray-400 line-through')}>
          {pago.concepto}
        </span>
      </td>
      <td className="px-4 py-2">
        <select
          className="max-w-[140px] rounded border border-gray-200 px-1.5 py-1 text-xs focus:border-rodziny-500 focus:outline-none"
          value={pago.categoria_gasto_id ?? ''}
          onChange={(e) => onUpdate({ categoria_gasto_id: e.target.value || null })}
          disabled={pago.pagado}
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
        <input
          type="text"
          inputMode="numeric"
          className="w-full max-w-[120px] rounded border border-gray-200 px-2 py-1 text-right text-sm focus:border-rodziny-500 focus:outline-none"
          value={montoLocal}
          onChange={(e) => setMontoLocal(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            const num = parseFloat(montoLocal.replace(/\./g, '').replace(',', '.')) || 0;
            if (num !== (pago.monto ?? 0)) onUpdate({ monto: num });
          }}
          disabled={pago.pagado}
          placeholder="0"
        />
      </td>
      <td className="px-4 py-2 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <input
            type="date"
            className="rounded border border-gray-200 px-1.5 py-1 text-xs focus:border-rodziny-500 focus:outline-none"
            value={pago.fecha_vencimiento ?? ''}
            onChange={(e) => onUpdate({ fecha_vencimiento: e.target.value || null })}
            disabled={pago.pagado}
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
      <td className="px-4 py-2 text-xs text-gray-500">
        {pago.medio_pago
          ? (MEDIO_PAGO_LABEL[pago.medio_pago as MedioPago] ?? pago.medio_pago)
          : '—'}
      </td>
      <td className="px-4 py-2">
        <input
          type="text"
          className="w-full max-w-[140px] rounded border border-gray-200 px-2 py-1 text-sm focus:border-rodziny-500 focus:outline-none"
          value={notasLocal}
          onChange={(e) => setNotasLocal(e.target.value)}
          onBlur={() => {
            if (notasLocal !== (pago.notas ?? '')) onUpdate({ notas: notasLocal || null });
          }}
          placeholder="—"
        />
      </td>
      <td className="px-2 py-2">
        <button
          onClick={onDelete}
          className="text-sm text-gray-300 transition-colors hover:text-red-500"
          title="Eliminar"
        >
          🗑
        </button>
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
  const [monto, setMonto] = useState('');
  const [fechaVto, setFechaVto] = useState('');
  const [notas, setNotas] = useState('');

  function guardar() {
    if (!concepto.trim()) return;
    onSave({
      periodo,
      concepto: concepto.trim(),
      categoria,
      categoria_gasto_id: catGastoId || null,
      monto: monto ? parseFloat(monto.replace(/\./g, '').replace(',', '.')) : null,
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
              <input
                type="text"
                inputMode="numeric"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-rodziny-500 focus:outline-none"
                placeholder="$0"
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

// ── modal medio de pago ──────────────────────────────────────────────────────
function ModalMedioPago({
  concepto,
  onSelect,
  onClose,
}: {
  concepto: string;
  onSelect: (medio: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="border-b px-6 py-4">
          <h3 className="font-semibold text-gray-800">Medio de pago</h3>
          <p className="mt-1 text-xs text-gray-400">¿Cómo se pagó "{concepto}"?</p>
        </div>
        <div className="space-y-2 px-6 py-4">
          {MEDIOS.map((m) => (
            <button
              key={m}
              onClick={() => onSelect(m)}
              className="hover:border-rodziny-300 w-full rounded-lg border border-gray-200 px-4 py-2.5 text-left text-sm transition-colors hover:bg-rodziny-50"
            >
              {MEDIO_PAGO_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="border-t px-6 py-3">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
