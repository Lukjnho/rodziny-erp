import type { SupabaseClient } from '@supabase/supabase-js';
import type { MedioPago } from './types';

export interface Regla {
  id: string;
  nombre: string;
  patron: string;
  cuenta: string | null;
  signo: 'egreso' | 'ingreso';
  proveedor: string;
  subcategoria: string | null;
  categoria_gasto_id: string | null;
  agrupacion: 'individual' | 'mensual';
  prioridad: number;
  activo: boolean;
}

interface MovimientoMin {
  id: string;
  cuenta: string;
  fecha: string;
  descripcion: string | null;
  debito: number;
  credito: number;
  periodo: string;
}

export interface PreviewItem {
  reglaId: string;
  reglaNombre: string;
  proveedor: string;
  subcategoria: string | null;
  categoriaGastoId: string | null;
  agrupacion: 'individual' | 'mensual';
  periodo: string;
  cantidadMovs: number;
  total: number;
  movIds: string[];
  cuentaDominante: string;
  // Solo individuales
  fecha?: string;
  descripcion?: string;
}

export interface Preview {
  items: PreviewItem[];
  movsClasificados: number;
  movsSinRegla: number;
  totalGastos: number;
  totalMonto: number;
}

const MEDIO_DESDE_CUENTA: Record<string, MedioPago> = {
  mercadopago: 'transferencia_mp',
  galicia: 'cheque_galicia',
  icbc: 'tarjeta_icbc',
};

function matchea(mov: MovimientoMin, regla: Regla): boolean {
  if (regla.cuenta && mov.cuenta !== regla.cuenta) return false;
  const debito = Number(mov.debito) || 0;
  const credito = Number(mov.credito) || 0;
  if (regla.signo === 'egreso' && debito <= 0) return false;
  if (regla.signo === 'ingreso' && credito <= 0) return false;
  const desc = mov.descripcion ?? '';
  try {
    return new RegExp(regla.patron, 'i').test(desc);
  } catch {
    return desc.toLowerCase().includes(regla.patron.toLowerCase());
  }
}

function montoMov(m: MovimientoMin, signo: 'egreso' | 'ingreso'): number {
  return signo === 'egreso' ? Number(m.debito) || 0 : Number(m.credito) || 0;
}

export async function previewReglas(supabase: SupabaseClient): Promise<Preview> {
  const { data: reglasData, error: e1 } = await supabase
    .from('reglas_movimiento')
    .select('*')
    .eq('activo', true)
    .order('prioridad');
  if (e1) throw e1;
  const reglas = (reglasData ?? []) as Regla[];

  // Traer todos los movimientos pendientes (paginado)
  const movs: MovimientoMin[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('movimientos_bancarios')
      .select('id, cuenta, fecha, descripcion, debito, credito, periodo')
      .is('tipo', null)
      .order('fecha')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    movs.push(...(data as MovimientoMin[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const grupos = new Map<string, PreviewItem>();
  let movsSinRegla = 0;
  let movsClasificados = 0;

  for (const mov of movs) {
    const regla = reglas.find((r) => matchea(mov, r));
    if (!regla) {
      movsSinRegla++;
      continue;
    }
    movsClasificados++;
    const monto = montoMov(mov, regla.signo);

    if (regla.agrupacion === 'mensual') {
      const key = `${regla.id}::${mov.periodo}`;
      const existing = grupos.get(key);
      if (existing) {
        existing.cantidadMovs++;
        existing.total += monto;
        existing.movIds.push(mov.id);
      } else {
        grupos.set(key, {
          reglaId: regla.id,
          reglaNombre: regla.nombre,
          proveedor: regla.proveedor,
          subcategoria: regla.subcategoria,
          categoriaGastoId: regla.categoria_gasto_id,
          agrupacion: 'mensual',
          periodo: mov.periodo,
          cantidadMovs: 1,
          total: monto,
          movIds: [mov.id],
          cuentaDominante: mov.cuenta,
        });
      }
    } else {
      const key = `${regla.id}::${mov.id}`;
      grupos.set(key, {
        reglaId: regla.id,
        reglaNombre: regla.nombre,
        proveedor: regla.proveedor,
        subcategoria: regla.subcategoria,
        categoriaGastoId: regla.categoria_gasto_id,
        agrupacion: 'individual',
        periodo: mov.periodo,
        cantidadMovs: 1,
        total: monto,
        movIds: [mov.id],
        cuentaDominante: mov.cuenta,
        fecha: mov.fecha,
        descripcion: mov.descripcion ?? '',
      });
    }
  }

  const items = Array.from(grupos.values()).sort((a, b) => {
    if (a.periodo !== b.periodo) return b.periodo.localeCompare(a.periodo);
    return a.reglaNombre.localeCompare(b.reglaNombre);
  });

  return {
    items,
    movsClasificados,
    movsSinRegla,
    totalGastos: items.length,
    totalMonto: items.reduce((s, i) => s + i.total, 0),
  };
}

export async function ejecutarReglas(
  supabase: SupabaseClient,
  preview: Preview,
): Promise<{ creados: number; vinculados: number; errores: string[] }> {
  let creados = 0;
  let vinculados = 0;
  const errores: string[] = [];

  for (const item of preview.items) {
    try {
      // Para mensuales: si ya hay un gasto auto previo (regla, periodo) sin local,
      // borrarlo y desvincular sus movimientos antes de recrear. Idempotente.
      if (item.agrupacion === 'mensual') {
        const { data: prev } = await supabase
          .from('gastos')
          .select('id')
          .eq('regla_id', item.reglaId)
          .eq('periodo', item.periodo)
          .is('local', null)
          .limit(1);
        if (prev && prev.length > 0) {
          const prevId = (prev[0] as { id: string }).id;
          await supabase
            .from('movimientos_bancarios')
            .update({ tipo: null, gasto_id: null })
            .eq('gasto_id', prevId);
          await supabase.from('gastos').delete().eq('id', prevId);
        }
      }

      const fechaGasto =
        item.agrupacion === 'mensual' ? `${item.periodo}-01` : item.fecha!;
      const medioPago = MEDIO_DESDE_CUENTA[item.cuentaDominante] ?? 'transferencia_mp';
      const total = Math.round(item.total * 100) / 100;

      const { data: nuevo, error } = await supabase
        .from('gastos')
        .insert({
          local: null,
          fecha: fechaGasto,
          importe_total: total,
          importe_neto: total,
          iva: 0,
          iibb: 0,
          proveedor: item.proveedor,
          categoria: null,
          subcategoria: item.subcategoria,
          categoria_id: item.categoriaGastoId,
          estado_pago: 'Pagado',
          medio_pago: medioPago,
          comentario:
            item.agrupacion === 'mensual'
              ? `Auto · ${item.cantidadMovs} movimientos del ${item.periodo}`
              : `Auto · ${item.descripcion ?? ''}`,
          creado_manual: false,
          cancelado: false,
          periodo: item.periodo,
          regla_id: item.reglaId,
        })
        .select('id')
        .single();

      if (error || !nuevo) {
        errores.push(`${item.proveedor} (${item.periodo}): ${error?.message ?? 'sin id'}`);
        continue;
      }
      creados++;

      // Vincular los movimientos al gasto recién creado en chunks de 200
      // para evitar URLs gigantes en el filtro IN.
      const CHUNK = 200;
      for (let i = 0; i < item.movIds.length; i += CHUNK) {
        const slice = item.movIds.slice(i, i + CHUNK);
        const { error: errMov } = await supabase
          .from('movimientos_bancarios')
          .update({ tipo: 'gasto_auto', gasto_id: (nuevo as { id: string }).id })
          .in('id', slice);
        if (errMov) {
          errores.push(`Vincular movs (${item.proveedor}): ${errMov.message}`);
        } else {
          vinculados += slice.length;
        }
      }
    } catch (e) {
      errores.push(`${item.proveedor}: ${e instanceof Error ? e.message : 'error desconocido'}`);
    }
  }

  return { creados, vinculados, errores };
}
