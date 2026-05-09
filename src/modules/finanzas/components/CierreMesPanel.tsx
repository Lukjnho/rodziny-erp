import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { formatARS, formatFecha, cn } from '@/lib/utils';

// ── tipos ────────────────────────────────────────────────────────────────────

type StatusCheckpoint = 'ok' | 'warn' | 'fail' | 'loading' | 'na';
type LocalSel = 'ambos' | 'vedia' | 'saavedra' | 'sas';
type TabFinanzas =
  | 'ventas'
  | 'compras'
  | 'flujo'
  | 'edr'
  | 'checklist'
  | 'importar'
  | 'cierres';

interface Checkpoint {
  key: string;
  bloque: 'entrada' | 'salida' | 'verificacion';
  titulo: string;
  status: StatusCheckpoint;
  detalle: string; // texto que describe el estado actual ("4 gastos sin categorizar")
  pasos?: string[]; // pasos para resolver
  ctaLabel?: string;
  ctaTab?: TabFinanzas;
}

interface Override {
  checkpoint_key: string;
  marcado_at: string;
  marcado_por: string | null;
  motivo: string | null;
}

interface CierreRow {
  id: string;
  local: string;
  periodo: string;
  cerrado_at: string;
  cerrado_por: string | null;
  notas: string | null;
}

interface Props {
  onNavigateToTab?: (tab: TabFinanzas) => void;
}

// ── componente principal ─────────────────────────────────────────────────────

export function CierreMesPanel({ onNavigateToTab }: Props) {
  const qc = useQueryClient();
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().substring(0, 7));
  const [local, setLocal] = useState<LocalSel>('ambos');
  const [showCerrar, setShowCerrar] = useState(false);
  const [notasCierre, setNotasCierre] = useState('');
  const [overrideModal, setOverrideModal] = useState<{ key: string; titulo: string } | null>(null);
  const [overrideMotivo, setOverrideMotivo] = useState('');

  // ── cierre actual ──────────────────────────────────────────────────────────
  const { data: cierre } = useQuery({
    queryKey: ['cierre_mes', local, periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('cierres_mes')
        .select('*')
        .eq('local', local)
        .eq('periodo', periodo)
        .maybeSingle();
      return data as CierreRow | null;
    },
  });

  const { data: overrides } = useQuery({
    queryKey: ['cierre_overrides', local, periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('cierres_mes_overrides')
        .select('*')
        .eq('local', local)
        .eq('periodo', periodo);
      return (data ?? []) as Override[];
    },
  });

  const overrideMap = useMemo(() => {
    const m = new Map<string, Override>();
    for (const o of overrides ?? []) m.set(o.checkpoint_key, o);
    return m;
  }, [overrides]);

  // ── queries por checkpoint ─────────────────────────────────────────────────
  // Cada query trae el dato crudo necesario para calcular un checkpoint.

  // Ventas Fudo (por local, una sola query agrupada)
  const { data: ventasFudo, isLoading: lVentas } = useQuery({
    queryKey: ['cmes_ventas_fudo', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('ventas_tickets')
        .select('local, total_bruto, iva, es_fiscal')
        .eq('periodo', periodo);
      return data ?? [];
    },
  });

  // Cierres de caja del mes
  const { data: cierresCaja, isLoading: lCierres } = useQuery({
    queryKey: ['cmes_cierres_caja', periodo],
    queryFn: async () => {
      const [y, m] = periodo.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      const { data } = await supabase
        .from('cierres_caja')
        .select('id, local, fecha, verificado, diferencia, monto_esperado')
        .gte('fecha', `${periodo}-01`)
        .lte('fecha', `${periodo}-${String(last).padStart(2, '0')}`);
      return data ?? [];
    },
  });

  // Movimientos bancarios del mes
  const { data: movs, isLoading: lMovs } = useQuery({
    queryKey: ['cmes_movs', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('movimientos_bancarios')
        .select('id, cuenta, fecha, debito, credito, saldo, gasto_id, tipo, es_transferencia_interna')
        .eq('periodo', periodo)
        .order('fecha', { ascending: true });
      return data ?? [];
    },
  });

  // Gastos del mes (por periodo del comprobante = devengado)
  const { data: gastosMes, isLoading: lGastos } = useQuery({
    queryKey: ['cmes_gastos', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('gastos')
        .select('id, local, proveedor, proveedor_id, categoria_id, factura_path, importe_total, cancelado, estado_pago')
        .eq('periodo', periodo)
        .neq('cancelado', true);
      return data ?? [];
    },
  });

  // Pagos de gastos del mes (por fecha_pago = percibido). Excluimos pagos cuyo
  // gasto fue cancelado: en ese caso el pago quedó huérfano y no debe contar.
  const { data: pagos, isLoading: lPagos } = useQuery({
    queryKey: ['cmes_pagos', periodo],
    queryFn: async () => {
      const [y, m] = periodo.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      const { data } = await supabase
        .from('pagos_gastos')
        .select(
          'id, gasto_id, fecha_pago, monto, medio_pago, conciliado_movimiento_id, gasto:gastos!inner(cancelado)',
        )
        .gte('fecha_pago', `${periodo}-01`)
        .lte('fecha_pago', `${periodo}-${String(last).padStart(2, '0')}`)
        .neq('gasto.cancelado', true);
      return data ?? [];
    },
  });

  // Sueldos pagados del mes
  const { data: sueldos, isLoading: lSueldos } = useQuery({
    queryKey: ['cmes_sueldos', periodo],
    queryFn: async () => {
      const [y, m] = periodo.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      const { data } = await supabase
        .from('pagos_sueldos')
        .select('id, periodo, monto, local, fecha_pago')
        .gte('fecha_pago', `${periodo}-01`)
        .lte('fecha_pago', `${periodo}-${String(last).padStart(2, '0')}`);
      return data ?? [];
    },
  });

  // Dividendos del mes
  const { data: dividendos, isLoading: lDivs } = useQuery({
    queryKey: ['cmes_divs', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('dividendos')
        .select('id, monto, socio, fecha')
        .eq('periodo', periodo);
      return data ?? [];
    },
  });

  // ── helpers de filtrado por local ──────────────────────────────────────────
  function filtrarPorLocal<T extends { local?: string | null }>(items: T[]): T[] {
    if (local === 'ambos') return items;
    return items.filter((i) => i.local === local || !i.local);
  }

  // ── computar checkpoints ───────────────────────────────────────────────────
  const checkpoints: Checkpoint[] = useMemo(() => {
    const list: Checkpoint[] = [];

    // === ENTRADAS ===

    // Ventas Fudo Vedia
    if (local === 'ambos' || local === 'vedia') {
      const tickets = (ventasFudo ?? []).filter((t) => t.local === 'vedia');
      const conIva = tickets.filter((t) => Number(t.iva ?? 0) > 0 || t.es_fiscal).length;
      list.push({
        key: 'ventas_fudo_vedia',
        bloque: 'entrada',
        titulo: 'Ventas Fudo Vedia (Excel cargado)',
        status: lVentas
          ? 'loading'
          : tickets.length === 0
            ? 'fail'
            : conIva > 0
              ? 'ok'
              : 'fail',
        detalle: lVentas
          ? 'Cargando…'
          : tickets.length === 0
            ? 'No hay tickets cargados para el mes'
            : conIva > 0
              ? `${tickets.length} tickets · ${conIva} con IVA discriminado`
              : `${tickets.length} tickets pero ninguno con IVA — falta subir el Excel de Fudo (la API no trae IVA)`,
        pasos: [
          'Entrar a Fudo y exportar el Excel de "Ventas Vedia <mes>"',
          'En el ERP ir al tab "Importar"',
          'Arrastrar el archivo y confirmar tipo "Ventas" + local "Vedia"',
        ],
        ctaLabel: 'Ir a Importar',
        ctaTab: 'importar',
      });
    }

    // Ventas Fudo Saavedra
    if (local === 'ambos' || local === 'saavedra') {
      const tickets = (ventasFudo ?? []).filter((t) => t.local === 'saavedra');
      const conIva = tickets.filter((t) => Number(t.iva ?? 0) > 0 || t.es_fiscal).length;
      list.push({
        key: 'ventas_fudo_saavedra',
        bloque: 'entrada',
        titulo: 'Ventas Fudo Saavedra (Excel cargado)',
        status: lVentas
          ? 'loading'
          : tickets.length === 0
            ? 'fail'
            : conIva > 0
              ? 'ok'
              : 'fail',
        detalle: lVentas
          ? 'Cargando…'
          : tickets.length === 0
            ? 'No hay tickets cargados para el mes'
            : conIva > 0
              ? `${tickets.length} tickets · ${conIva} con IVA discriminado`
              : `${tickets.length} tickets pero ninguno con IVA — falta subir el Excel de Fudo`,
        pasos: [
          'Entrar a Fudo y exportar el Excel de "Ventas Saavedra <mes>"',
          'En el ERP ir al tab "Importar"',
          'Arrastrar el archivo y confirmar tipo "Ventas" + local "Saavedra"',
        ],
        ctaLabel: 'Ir a Importar',
        ctaTab: 'importar',
      });
    }

    // Cierres de caja verificados
    {
      const cc = filtrarPorLocal(cierresCaja ?? []);
      const total = cc.length;
      const pendientes = cc.filter((c) => !c.verificado).length;
      list.push({
        key: 'cierres_caja_verificados',
        bloque: 'entrada',
        titulo: 'Cierres de caja verificados',
        status: lCierres
          ? 'loading'
          : total === 0
            ? 'warn'
            : pendientes === 0
              ? 'ok'
              : 'fail',
        detalle: lCierres
          ? 'Cargando…'
          : total === 0
            ? 'No hay cierres de caja cargados para el mes'
            : pendientes === 0
              ? `${total} cierres del mes, todos verificados`
              : `${pendientes} cierres pendientes de verificar (de ${total} totales)`,
        pasos: [
          'Ir al tab "Cierres de caja"',
          `Filtrar por mes ${periodo}`,
          'Revisar cada cierre pendiente y marcarlo como verificado',
        ],
        ctaLabel: 'Ir a Cierres de caja',
        ctaTab: 'cierres',
      });
    }

    // Extractos bancarios — uno por banco
    for (const cuenta of ['mercadopago', 'galicia', 'icbc'] as const) {
      const movsCuenta = (movs ?? []).filter((m) => m.cuenta === cuenta);
      const cantidad = movsCuenta.length;
      const label =
        cuenta === 'mercadopago' ? 'MercadoPago' : cuenta === 'galicia' ? 'Galicia' : 'ICBC';
      list.push({
        key: `extracto_${cuenta}`,
        bloque: 'entrada',
        titulo: `Extracto ${label} importado`,
        status: lMovs ? 'loading' : cantidad > 0 ? 'ok' : 'warn',
        detalle: lMovs
          ? 'Cargando…'
          : cantidad > 0
            ? `${cantidad} movimientos del mes cargados`
            : `Sin movimientos cargados para el mes — verificá si subiste el extracto o si efectivamente no hubo movimiento`,
        pasos: [
          `Descargar extracto ${label} del mes desde el home banking`,
          'Ir al tab "Importar" del ERP',
          'Arrastrar el archivo (CSV/TXT) — el sistema autodetecta el banco',
        ],
        ctaLabel: 'Ir a Importar',
        ctaTab: 'importar',
      });
    }

    // === SALIDAS ===

    // Gastos con factura adjunta
    {
      const g = filtrarPorLocal(gastosMes ?? []);
      const total = g.length;
      const conFactura = g.filter((x) => x.factura_path && x.factura_path.length > 0).length;
      const pct = total > 0 ? Math.round((conFactura / total) * 100) : 0;
      list.push({
        key: 'gastos_con_factura',
        bloque: 'salida',
        titulo: 'Gastos con factura adjunta',
        status: lGastos
          ? 'loading'
          : total === 0
            ? 'na'
            : pct >= 90
              ? 'ok'
              : pct >= 70
                ? 'warn'
                : 'fail',
        detalle: lGastos
          ? 'Cargando…'
          : total === 0
            ? 'No hay gastos cargados para el mes'
            : `${conFactura} de ${total} gastos con factura adjunta (${pct}%)`,
        pasos: [
          'Ir a Compras → Listado de Gastos',
          `Filtrar por mes ${periodo}`,
          'Adjuntar la factura faltante en cada gasto que no la tenga',
        ],
        ctaLabel: 'Ir a Compras',
        ctaTab: 'compras',
      });
    }

    // Gastos sin categorizar
    {
      const g = filtrarPorLocal(gastosMes ?? []);
      const sinCat = g.filter((x) => !x.categoria_id).length;
      list.push({
        key: 'gastos_sin_categoria',
        bloque: 'salida',
        titulo: 'Gastos sin categorizar',
        status: lGastos ? 'loading' : sinCat === 0 ? 'ok' : 'fail',
        detalle: lGastos
          ? 'Cargando…'
          : sinCat === 0
            ? 'Todos los gastos del mes tienen categoría'
            : `${sinCat} gasto${sinCat > 1 ? 's' : ''} sin categoría — no van a entrar bien al EdR`,
        pasos: [
          'Ir a Compras → Listado de Gastos',
          `Filtrar por mes ${periodo}`,
          'Editar cada gasto sin categoría y asignarla',
        ],
        ctaLabel: 'Ir a Compras',
        ctaTab: 'compras',
      });
    }

    // Gastos sin proveedor
    {
      const g = filtrarPorLocal(gastosMes ?? []);
      const sinProv = g.filter(
        (x) => !x.proveedor_id && (!x.proveedor || x.proveedor.trim().length === 0),
      ).length;
      list.push({
        key: 'gastos_sin_proveedor',
        bloque: 'salida',
        titulo: 'Gastos sin proveedor',
        status: lGastos ? 'loading' : sinProv === 0 ? 'ok' : 'warn',
        detalle: lGastos
          ? 'Cargando…'
          : sinProv === 0
            ? 'Todos los gastos del mes tienen proveedor'
            : `${sinProv} gasto${sinProv > 1 ? 's' : ''} sin proveedor — dificulta la conciliación`,
        pasos: [
          'Ir a Compras → Listado de Gastos',
          `Filtrar por mes ${periodo}`,
          'Editar cada gasto y asignar el proveedor correspondiente',
        ],
        ctaLabel: 'Ir a Compras',
        ctaTab: 'compras',
      });
    }

    // Pagos no-efectivo conciliados
    {
      const noEfectivo = (pagos ?? []).filter((p) => p.medio_pago !== 'efectivo');
      const total = noEfectivo.length;
      const conc = noEfectivo.filter((p) => p.conciliado_movimiento_id).length;
      const pct = total > 0 ? Math.round((conc / total) * 100) : 0;
      list.push({
        key: 'pagos_conciliados',
        bloque: 'salida',
        titulo: 'Pagos no-efectivo conciliados con extracto',
        status: lPagos
          ? 'loading'
          : total === 0
            ? 'na'
            : pct >= 90
              ? 'ok'
              : pct >= 50
                ? 'warn'
                : 'fail',
        detalle: lPagos
          ? 'Cargando…'
          : total === 0
            ? 'No hay pagos no-efectivo este mes'
            : `${conc} de ${total} pagos conciliados (${pct}%)`,
        pasos: [
          'Ir a Compras → Pagos / Conciliación',
          'Buscar el movimiento del extracto que corresponde a cada pago pendiente',
          'Vincularlos uno a uno (o por lote si tienen el mismo n° de operación)',
        ],
        ctaLabel: 'Ir a Compras',
        ctaTab: 'compras',
      });
    }

    // Débitos del extracto sin gasto vinculado
    {
      // Filtramos los débitos relevantes: descartamos cargos automáticos (tipo='cargo_mp')
      // y transferencias internas — esos no son gastos pendientes de cargar.
      const debitos = (movs ?? []).filter(
        (m) =>
          Number(m.debito) > 0 &&
          !m.gasto_id &&
          m.tipo !== 'cargo_mp' &&
          !m.es_transferencia_interna,
      );
      list.push({
        key: 'debitos_sin_gasto',
        bloque: 'salida',
        titulo: 'Débitos del extracto sin gasto vinculado',
        status: lMovs ? 'loading' : debitos.length === 0 ? 'ok' : 'warn',
        detalle: lMovs
          ? 'Cargando…'
          : debitos.length === 0
            ? 'Todos los débitos del mes tienen gasto vinculado'
            : `${debitos.length} débito${debitos.length > 1 ? 's' : ''} del extracto sin gasto cargado en el ERP`,
        pasos: [
          'Ir a Flujo de caja',
          'Buscar la sección "Débitos sin clasificar" (Galicia / ICBC / MP)',
          'Por cada uno, decidir: crear el gasto correspondiente, o marcar como cargo bancario',
        ],
        ctaLabel: 'Ir a Flujo de caja',
        ctaTab: 'flujo',
      });
    }

    // Sueldos del mes pagados (Q1 + Q2)
    {
      const s = filtrarPorLocal(sueldos ?? []);
      const total = s.reduce((sum, x) => sum + Number(x.monto), 0);
      list.push({
        key: 'sueldos_pagados',
        bloque: 'salida',
        titulo: 'Sueldos del mes pagados',
        status: lSueldos ? 'loading' : s.length === 0 ? 'fail' : 'ok',
        detalle: lSueldos
          ? 'Cargando…'
          : s.length === 0
            ? 'No hay pagos de sueldos cargados — Q1 y Q2 deben aparecer'
            : `${s.length} pagos por ${formatARS(total)}`,
        pasos: [
          'Ir al módulo RRHH → Liquidaciones',
          `Marcar como pagados los sueldos de ${periodo} (Q1 y Q2)`,
          'Adjuntar comprobante de transferencia si corresponde',
        ],
      });
    }

    // Dividendos del mes (informativo)
    {
      const d = dividendos ?? [];
      const total = d.reduce((sum, x) => sum + Number(x.monto), 0);
      list.push({
        key: 'dividendos_registrados',
        bloque: 'salida',
        titulo: 'Dividendos del mes registrados (informativo)',
        status: lDivs ? 'loading' : 'ok',
        detalle: lDivs
          ? 'Cargando…'
          : d.length === 0
            ? 'No hay retiros de socios registrados este mes'
            : `${d.length} retiros por ${formatARS(total)}`,
        pasos: [
          'Ir a Flujo de caja → Sección Dividendos',
          'Si hubo retiros que no están cargados, agregarlos con "Registrar retiro"',
        ],
        ctaLabel: 'Ir a Flujo de caja',
        ctaTab: 'flujo',
      });
    }

    // === VERIFICACIÓN ===

    // Cuadre por banco
    {
      const cuentas = ['mercadopago', 'galicia', 'icbc'] as const;
      const desvios: { cuenta: string; desvio: number }[] = [];
      let totalCuentasConDatos = 0;

      for (const cuenta of cuentas) {
        const m = (movs ?? [])
          .filter((x) => x.cuenta === cuenta && x.saldo !== null)
          .sort((a, b) => a.fecha.localeCompare(b.fecha));
        if (m.length < 2) continue;
        totalCuentasConDatos++;

        const saldoIni = Number(m[0].saldo) - Number(m[0].credito) + Number(m[0].debito);
        const saldoFin = Number(m[m.length - 1].saldo);
        const sumCred = m.reduce((s, x) => s + Number(x.credito), 0);
        const sumDeb = m.reduce((s, x) => s + Number(x.debito), 0);
        const esperado = saldoIni + sumCred - sumDeb;
        const desvio = saldoFin - esperado;
        if (Math.abs(desvio) > 1) {
          desvios.push({ cuenta, desvio });
        }
      }

      list.push({
        key: 'cuadre_bancos',
        bloque: 'verificacion',
        titulo: 'Cuadre por banco (saldos del extracto)',
        status: lMovs
          ? 'loading'
          : totalCuentasConDatos === 0
            ? 'na'
            : desvios.length === 0
              ? 'ok'
              : 'warn',
        detalle: lMovs
          ? 'Cargando…'
          : totalCuentasConDatos === 0
            ? 'No hay saldos cargados — el cuadre se calcula con la columna "saldo" del extracto'
            : desvios.length === 0
              ? `Saldos consistentes en ${totalCuentasConDatos} cuenta${totalCuentasConDatos > 1 ? 's' : ''}`
              : desvios
                  .map(
                    (d) =>
                      `${d.cuenta.toUpperCase()}: desvío ${formatARS(d.desvio)} entre saldo final y suma de movimientos`,
                  )
                  .join(' · '),
        pasos: [
          'Abrir el extracto del banco con desvío',
          'Ordenar por fecha y verificar que cada saldo cuadre con el anterior +/− el movimiento',
          'Si falta un movimiento, importar el extracto completo de nuevo',
        ],
        ctaLabel: 'Ir a Flujo de caja',
        ctaTab: 'flujo',
      });
    }

    return list;
  }, [
    local,
    periodo,
    ventasFudo,
    cierresCaja,
    movs,
    gastosMes,
    pagos,
    sueldos,
    dividendos,
    lVentas,
    lCierres,
    lMovs,
    lGastos,
    lPagos,
    lSueldos,
    lDivs,
  ]);

  // ── status global del cierre ───────────────────────────────────────────────
  // Un checkpoint cuenta como "OK" si: status='ok' || status='na' || tiene override.
  const todoOK = useMemo(() => {
    if (!checkpoints.length) return false;
    return checkpoints.every((c) => {
      if (c.status === 'loading') return false;
      if (c.status === 'ok' || c.status === 'na') return true;
      return overrideMap.has(c.key);
    });
  }, [checkpoints, overrideMap]);

  // ── mutations ──────────────────────────────────────────────────────────────
  const guardarOverride = useMutation({
    mutationFn: async ({ key, motivo }: { key: string; motivo: string }) => {
      const { error } = await supabase.from('cierres_mes_overrides').upsert(
        {
          local,
          periodo,
          checkpoint_key: key,
          motivo: motivo.trim() || null,
          marcado_por: 'Admin',
        },
        { onConflict: 'local,periodo,checkpoint_key' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cierre_overrides'] });
      setOverrideModal(null);
      setOverrideMotivo('');
    },
  });

  const quitarOverride = useMutation({
    mutationFn: async (key: string) => {
      const { error } = await supabase
        .from('cierres_mes_overrides')
        .delete()
        .eq('local', local)
        .eq('periodo', periodo)
        .eq('checkpoint_key', key);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cierre_overrides'] }),
  });

  const cerrarMes = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('cierres_mes').insert({
        local,
        periodo,
        notas: notasCierre.trim() || null,
        cerrado_por: 'Admin',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cierre_mes'] });
      setShowCerrar(false);
      setNotasCierre('');
    },
  });

  const reabrirMes = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('cierres_mes')
        .delete()
        .eq('local', local)
        .eq('periodo', periodo);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cierre_mes'] }),
  });

  // ── render ─────────────────────────────────────────────────────────────────
  const bloques: { id: 'entrada' | 'salida' | 'verificacion'; titulo: string; emoji: string }[] = [
    { id: 'entrada', titulo: 'ENTRADAS', emoji: '💰' },
    { id: 'salida', titulo: 'SALIDAS', emoji: '💸' },
    { id: 'verificacion', titulo: 'VERIFICACIÓN', emoji: '✅' },
  ];

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-4">
        <LocalSelector
          value={local}
          onChange={(v) => setLocal(v as LocalSel)}
          options={['vedia', 'saavedra', 'sas', 'ambos']}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Período</label>
          <input
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
          />
        </div>
      </div>

      {/* Banner: mes ya cerrado */}
      {cierre && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-green-900">
              ✓ Mes revisado el {formatFecha(cierre.cerrado_at.substring(0, 10))} por{' '}
              {cierre.cerrado_por ?? 'desconocido'}
            </p>
            {cierre.notas && (
              <p className="mt-0.5 text-xs italic text-green-700">"{cierre.notas}"</p>
            )}
          </div>
          <button
            onClick={() => {
              if (window.confirm('¿Reabrir el mes? Esto borra la marca de revisión.'))
                reabrirMes.mutate();
            }}
            disabled={reabrirMes.isPending}
            className="rounded border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
          >
            Reabrir
          </button>
        </div>
      )}

      {/* Bloques de checkpoints */}
      {bloques.map((b) => {
        const items = checkpoints.filter((c) => c.bloque === b.id);
        if (!items.length) return null;
        return (
          <div key={b.id} className="overflow-hidden rounded-lg border border-surface-border bg-white">
            <div className="border-b border-gray-200 bg-gray-50 px-5 py-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-700">
                {b.emoji} {b.titulo}
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {items.map((c) => (
                <CheckpointRow
                  key={c.key}
                  checkpoint={c}
                  override={overrideMap.get(c.key)}
                  onMarkOverride={() => setOverrideModal({ key: c.key, titulo: c.titulo })}
                  onQuitarOverride={() => quitarOverride.mutate(c.key)}
                  onCta={c.ctaTab && onNavigateToTab ? () => onNavigateToTab(c.ctaTab!) : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Botón "Cerrar mes" / status */}
      {!cierre && (
        <div className="rounded-lg border border-rodziny-200 bg-rodziny-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-rodziny-900">
                {todoOK
                  ? '✓ Todos los checkpoints en orden — listo para cerrar'
                  : 'Faltan checkpoints por completar o aceptar'}
              </p>
              <p className="mt-0.5 text-xs text-rodziny-700">
                {todoOK
                  ? 'Marcá el mes como revisado para dejarlo registrado en el histórico.'
                  : 'Resolvé los items en rojo / amarillo, o marcalos como revisados manualmente con motivo.'}
              </p>
            </div>
            <button
              onClick={() => setShowCerrar(true)}
              disabled={!todoOK}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                todoOK
                  ? 'bg-rodziny-700 text-white hover:bg-rodziny-800'
                  : 'cursor-not-allowed bg-gray-200 text-gray-400',
              )}
            >
              Marcar mes como revisado
            </button>
          </div>
        </div>
      )}

      {/* Modal: marcar checkpoint como revisado manualmente */}
      {overrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="mb-1 text-sm font-semibold text-gray-900">Marcar como revisado</h3>
            <p className="mb-3 text-xs text-gray-500">"{overrideModal.titulo}"</p>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Motivo (opcional)
            </label>
            <textarea
              value={overrideMotivo}
              onChange={(e) => setOverrideMotivo(e.target.value)}
              rows={3}
              placeholder="Ej: ICBC no tuvo movimientos este mes, lo verifiqué en el home banking."
              className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-rodziny-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setOverrideModal(null);
                  setOverrideMotivo('');
                }}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900"
              >
                Cancelar
              </button>
              <button
                onClick={() =>
                  guardarOverride.mutate({ key: overrideModal.key, motivo: overrideMotivo })
                }
                disabled={guardarOverride.isPending}
                className="rounded bg-rodziny-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: cerrar mes */}
      {showCerrar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="mb-1 text-sm font-semibold text-gray-900">Marcar mes como revisado</h3>
            <p className="mb-3 text-xs text-gray-500">
              {periodo} · {local}
            </p>
            <label className="mb-1 block text-xs font-medium text-gray-600">Notas (opcional)</label>
            <textarea
              value={notasCierre}
              onChange={(e) => setNotasCierre(e.target.value)}
              rows={3}
              placeholder="Ej: cerrado tras conciliar pagos pendientes con MP."
              className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-rodziny-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCerrar(false);
                  setNotasCierre('');
                }}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900"
              >
                Cancelar
              </button>
              <button
                onClick={() => cerrarMes.mutate()}
                disabled={cerrarMes.isPending}
                className="rounded bg-rodziny-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
              >
                Confirmar cierre
              </button>
            </div>
            {cerrarMes.isError && (
              <p className="mt-2 text-xs text-red-600">
                {(cerrarMes.error as Error).message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── sub-componentes ──────────────────────────────────────────────────────────

function CheckpointRow({
  checkpoint,
  override,
  onMarkOverride,
  onQuitarOverride,
  onCta,
}: {
  checkpoint: Checkpoint;
  override?: Override;
  onMarkOverride: () => void;
  onQuitarOverride: () => void;
  onCta?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const c = checkpoint;
  const tieneOverride = !!override;

  // Status efectivo: si tiene override, queda OK manualmente
  const effective = tieneOverride ? 'override' : c.status;
  const colorPill: Record<string, string> = {
    ok: 'bg-green-100 text-green-700',
    warn: 'bg-amber-100 text-amber-700',
    fail: 'bg-red-100 text-red-700',
    loading: 'bg-gray-100 text-gray-500',
    na: 'bg-gray-100 text-gray-500',
    override: 'bg-blue-100 text-blue-700',
  };
  const labelPill: Record<string, string> = {
    ok: 'OK',
    warn: 'Atención',
    fail: 'Falta',
    loading: '…',
    na: 'N/A',
    override: 'Revisado manual',
  };

  const puedeMostrarOverride =
    !tieneOverride && c.status !== 'ok' && c.status !== 'loading' && c.status !== 'na';

  return (
    <div className="px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                colorPill[effective],
              )}
            >
              {labelPill[effective]}
            </span>
            <span className="text-sm font-medium text-gray-900">{c.titulo}</span>
          </div>
          <p
            className={cn(
              'mt-1 text-xs',
              effective === 'ok' || effective === 'override'
                ? 'text-gray-500'
                : effective === 'warn'
                  ? 'text-amber-700'
                  : effective === 'fail'
                    ? 'text-red-700'
                    : 'text-gray-400',
            )}
          >
            {c.detalle}
          </p>
          {tieneOverride && override.motivo && (
            <p className="mt-1 text-xs italic text-blue-700">"{override.motivo}"</p>
          )}

          {/* Pasos (colapsables) */}
          {c.pasos && c.pasos.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1.5 text-[11px] text-gray-500 hover:text-gray-800"
            >
              {expanded ? '▼ ocultar pasos' : '▶ ver paso a paso'}
            </button>
          )}
          {expanded && c.pasos && (
            <ol className="ml-1 mt-2 list-inside list-decimal space-y-1 text-xs text-gray-600">
              {c.pasos.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          )}
        </div>

        {/* Acciones */}
        <div className="flex shrink-0 flex-col gap-1.5">
          {onCta && c.ctaLabel && (
            <button
              onClick={onCta}
              className="whitespace-nowrap rounded border border-rodziny-300 bg-rodziny-50 px-2.5 py-1 text-[11px] font-medium text-rodziny-700 hover:bg-rodziny-100"
            >
              → {c.ctaLabel}
            </button>
          )}
          {puedeMostrarOverride && (
            <button
              onClick={onMarkOverride}
              className="whitespace-nowrap rounded border border-gray-300 bg-white px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              ✓ Marcar revisado
            </button>
          )}
          {tieneOverride && (
            <button
              onClick={onQuitarOverride}
              className="whitespace-nowrap rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] text-blue-700 hover:bg-blue-100"
            >
              Quitar revisión manual
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
