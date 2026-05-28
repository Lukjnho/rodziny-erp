import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import { procesarComprobantePago } from '@/lib/ocrComprobantePago';
import { useAuth } from '@/lib/auth';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// ── tipos ────────────────────────────────────────────────────────────────────

interface MovBancario {
  id: string;
  cuenta: string;
  fecha: string;
  descripcion: string;
  debito: number;
  credito: number;
  saldo: number | null;
  categoria: string | null;
  local: string;
  referencia: string;
  es_transferencia_interna: boolean;
  tipo: string | null;
  gasto_id: string | null;
}

interface CierreVerificado {
  id: string;
  local: string;
  fecha: string;
  turno: string;
  caja: string | null;
  monto_contado: number;
  monto_esperado: number | null;
  diferencia: number | null;
  retiro: number;
  fudo_efectivo: number;
  otros_retiros: number | null;
  fondo_apertura: number;
  fondo_siguiente: number;
  verificado: boolean;
  verificado_por: string | null;
  monto_llevado_caja_fuerte: number | null;
}

const FONDO_CAMBIO_DEFAULT = 12000;

// Ingreso real en efectivo del turno = lo que entró por ventas, no lo que
// quedó al final. monto_contado refleja lo que QUEDA en el cajón después de
// retiros, así que undercuenta el efectivo cobrado. fudo_efectivo es la
// fuente de verdad cuando está cargado; sino derivamos por la ecuación
// monto_contado + otros_retiros - fondo_apertura.
function efectivoTurno(c: {
  fudo_efectivo: number;
  monto_contado: number;
  otros_retiros: number | null;
  fondo_apertura: number;
}): number {
  if (Number(c.fudo_efectivo) > 0) return Number(c.fudo_efectivo);
  return (
    Number(c.monto_contado ?? 0) +
    Number(c.otros_retiros ?? 0) -
    Number(c.fondo_apertura ?? 0)
  );
}

interface GastoPagado {
  id: string;
  local: string;
  fecha: string;
  proveedor: string | null;
  categoria: string | null;
  subcategoria: string | null;
  importe_total: number;
  medio_pago: string | null;
  categoria_id: string | null;
}

interface PagoRealizado {
  id: string;
  gasto_id: string;
  fecha_pago: string;
  monto: number;
  medio_pago: string;
  // datos del gasto asociado
  gasto: {
    local: string;
    proveedor: string | null;
    categoria: string | null;
    subcategoria: string | null;
    categoria_id: string | null;
  } | null;
}

interface CategoriaGasto {
  id: string;
  nombre: string;
  parent_id: string | null;
  tipo_edr: string;
}

interface Dividendo {
  id: string;
  socio: string;
  fecha: string;
  monto: number;
  medio_pago: string;
  concepto: string | null;
  local: string | null;
  periodo: string;
  numero_operacion: string | null;
  comprobante_path: string | null;
}

interface PagoMP {
  id: number;
  fecha: string;
  monto: number;
  monto_neto: number;
  comision_mp: number;
  impuestos: number;
  medio_pago: string;
  local: string;
  periodo: string;
}

interface PagoSueldo {
  id: string;
  empleado_id: string;
  periodo: string;
  fecha_pago: string;
  monto: number;
  medio_pago: string;
  local: string;
  empleado_nombre: string | null;
}

const MEDIO_PAGO_MP_LABEL: Record<string, string> = {
  account_money: 'QR / Saldo MP',
  debit_card: 'Tarjeta débito',
  credit_card: 'Tarjeta crédito',
  bank_transfer: 'Transferencia bancaria',
  prepaid_card: 'Tarjeta prepaga',
};

// ── constantes ───────────────────────────────────────────────────────────────

const SOCIOS = ['lucas', 'karina', 'francisco'] as const;
const SOCIO_LABEL: Record<string, string> = {
  lucas: 'Lucas',
  karina: 'Karina',
  francisco: 'Francisco',
};

const MEDIOS_PAGO_DIV = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia_mp', label: 'Transferencia (MP)' },
  { value: 'cheque_galicia', label: 'Cheque (Galicia)' },
  { value: 'tarjeta_icbc', label: 'Tarjeta (ICBC)' },
];

const GRUPO_EGRESO_LABEL: Record<string, string> = {
  cmv: 'Costos de mercadería (CMV)',
  gastos_op: 'Gastos operativos',
  rrhh: 'RRHH (sueldos y cargas)',
  impuestos: 'Impuestos y Tasas',
  inversiones: 'Inversiones',
  intereses: 'Intereses / Comisiones financieras',
  dividendos: 'Dividendos (retiros de socios)',
  otros: 'Otros egresos',
};

// Sub-labels para débitos bancarios
const GRUPO_DEBITO_LABEL: Record<string, string> = {
  mercadopago: 'MercadoPago (comisiones y retenciones)',
  galicia: 'Galicia (cheques, débitos automáticos, impuestos)',
  icbc: 'ICBC (Visa, impuestos, comisiones)',
};

function tipoEdrAGrupo(tipo: string | null): string {
  if (!tipo) return 'otros';
  if (tipo.startsWith('cmv_')) return 'cmv';
  if (tipo === 'gastos_op') return 'gastos_op';
  if (tipo === 'sueldos' || tipo === 'cargas_sociales' || tipo === 'gastos_rrhh') return 'rrhh';
  if (tipo === 'impuestos_op') return 'impuestos';
  if (tipo === 'inversiones') return 'inversiones';
  if (tipo === 'intereses') return 'intereses';
  return 'otros';
}

// Patrones para movimientos de capital (cuenta comitente)
const PATRONES_CAPITAL = [
  /invertironline/i,
  /invertir\s*online/i,
  /cuenta\s*comitente/i,
  /bull\s*market/i,
  /iol\s*inversiones/i,
];

function esMovCapital(m: MovBancario): boolean {
  return PATRONES_CAPITAL.some((p) => p.test(m.descripcion ?? ''));
}

// ── componente principal ─────────────────────────────────────────────────────

export function FlujoCaja({ onNavigateToTab }: { onNavigateToTab?: (tab: string) => void } = {}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  // El flujo de caja es a nivel empresa (Rodziny SAS) — los movimientos bancarios
  // son de la SAS, no del local. Filtrar por local daba una vista parcial confusa.
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().substring(0, 7));
  const [ingresosOpen, setIngresosOpen] = useState(true);
  const [bannerCerrado, setBannerCerrado] = useState(false);
  const [egresosOpen, setEgresosOpen] = useState(true);
  const [dividendosOpen, setDividendosOpen] = useState(false);
  const [noOperativoOpen, setNoOperativoOpen] = useState(false);
  const [showDivForm, setShowDivForm] = useState(false);

  // Sync MP state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    ok: boolean;
    sincronizados?: number;
    error?: string;
  } | null>(null);

  // Form dividendo
  const [divSocio, setDivSocio] = useState<string>('lucas');
  const [divFecha, setDivFecha] = useState(() => new Date().toISOString().split('T')[0]);
  const [divMonto, setDivMonto] = useState('');
  const [divMedio, setDivMedio] = useState('efectivo');
  const [divConcepto, setDivConcepto] = useState('');
  const [divLocal, setDivLocal] = useState<string>('');
  // N° de operación + comprobante de pago. Obligatorios cuando medio ≠ efectivo
  // para que cada retiro tenga trazabilidad bancaria igual que el resto de pagos.
  const [divNumOp, setDivNumOp] = useState('');
  const [divComprobante, setDivComprobante] = useState<File | null>(null);
  // Path en Storage devuelto por el helper de OCR — si está seteado, guardarDiv
  // lo reusa en vez de re-subir el archivo.
  const [divComprobantePath, setDivComprobantePath] = useState<string | null>(null);
  const [divOcrEjecutando, setDivOcrEjecutando] = useState(false);
  const [divOcrInfo, setDivOcrInfo] = useState<string | null>(null);
  const [divOcrWarning, setDivOcrWarning] = useState<string | null>(null);

  // ── queries ──────────────────────────────────────────────────────────────────

  const { data: movimientos } = useQuery({
    queryKey: ['fc_movimientos', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('movimientos_bancarios')
        .select('*')
        .eq('periodo', periodo)
        .order('fecha', { ascending: true });
      return (data ?? []) as MovBancario[];
    },
  });

  // Última fecha de movimiento por cuenta (para el banner de "exports
  // desactualizados"). 3 queries paralelas con limit 1 — no agrega migración
  // y soporta gaps grandes en cualquiera de las cuentas.
  const { data: ultimasFechasBancos } = useQuery({
    queryKey: ['fc_ultimas_fechas_bancos'],
    queryFn: async () => {
      const cuentas = ['galicia', 'icbc', 'mercadopago'] as const;
      const results = await Promise.all(
        cuentas.map(async (c) => {
          const { data } = await supabase
            .from('movimientos_bancarios')
            .select('fecha')
            .eq('cuenta', c)
            .order('fecha', { ascending: false })
            .limit(1)
            .maybeSingle();
          return { cuenta: c, fecha: data?.fecha as string | undefined };
        }),
      );
      return results;
    },
  });

  const { data: cierres } = useQuery({
    queryKey: ['fc_cierres', periodo],
    queryFn: async () => {
      const [y, m] = periodo.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const { data } = await supabase
        .from('cierres_caja')
        .select('*')
        .gte('fecha', `${periodo}-01`)
        .lte('fecha', `${periodo}-${lastDay}`)
        .order('fecha', { ascending: true });
      return (data ?? []) as CierreVerificado[];
    },
  });

  // Pagos reales: fecha de pago es cuando salió la plata (no la fecha del comprobante).
  // El !inner + neq cancelado descartan pagos cuyo gasto fue cancelado después
  // (ej: gasto cargado por error y luego anulado, pero el pago quedó huérfano).
  const { data: pagosRealizados } = useQuery({
    queryKey: ['fc_pagos', periodo],
    queryFn: async () => {
      const [y, m] = periodo.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const { data } = await supabase
        .from('pagos_gastos')
        .select(
          'id, gasto_id, fecha_pago, monto, medio_pago, gasto:gastos!inner(local, proveedor, categoria, subcategoria, categoria_id, cancelado)',
        )
        .gte('fecha_pago', `${periodo}-01`)
        .lte('fecha_pago', `${periodo}-${lastDay}`)
        .neq('gasto.cancelado', true);
      return (data ?? []) as unknown as PagoRealizado[];
    },
  });

  const { data: categorias } = useQuery({
    queryKey: ['categorias_gasto_fc'],
    queryFn: async () => {
      const { data } = await supabase
        .from('categorias_gasto')
        .select('id, nombre, parent_id, tipo_edr');
      return (data ?? []) as CategoriaGasto[];
    },
  });

  const { data: dividendos } = useQuery({
    queryKey: ['fc_dividendos', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('dividendos')
        .select('*')
        .eq('periodo', periodo)
        .order('fecha', { ascending: false });
      return (data ?? []) as Dividendo[];
    },
  });

  // Pagos MP (API sync)
  const { data: pagosMP } = useQuery({
    queryKey: ['fc_pagos_mp', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('pagos_mp')
        .select('id, fecha, monto, monto_neto, comision_mp, impuestos, medio_pago, local, periodo')
        .eq('periodo', periodo)
        .eq('estado', 'approved');
      return (data ?? []) as PagoMP[];
    },
  });

  // Pagos de sueldos (RRHH)
  const { data: pagosSueldos } = useQuery({
    queryKey: ['fc_pagos_sueldos', periodo],
    queryFn: async () => {
      const [y, m] = periodo.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const { data } = await supabase
        .from('pagos_sueldos')
        .select('id, empleado_id, periodo, fecha_pago, monto, medio_pago, local, empleado_nombre')
        .gte('fecha_pago', `${periodo}-01`)
        .lte('fecha_pago', `${periodo}-${lastDay}`);
      return (data ?? []) as PagoSueldo[];
    },
  });

  // ── sync MP ────────────────────────────────────────────────────────────────
  const sincronizarMP = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('sync-mercadopago', {
        body: { periodo },
      });
      if (error) throw error;
      setSyncResult(data);
      qc.invalidateQueries({ queryKey: ['fc_pagos_mp'] });
    } catch (e) {
      setSyncResult({ ok: false, error: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  // ── OCR comprobante dividendo ─────────────────────────────────────────────
  // Mismo patrón que PagarGastoModal / ChecklistPagos: al seleccionar el
  // archivo lo subimos por el helper, que extrae el N° de operación con
  // Claude Haiku 4.5 para conciliar contra el export de MercadoPago.

  async function handleSelectDivComprobante(file: File | null) {
    setDivComprobante(file);
    setDivComprobantePath(null);
    setDivOcrInfo(null);
    setDivOcrWarning(null);
    if (!file) return;
    setDivOcrEjecutando(true);
    try {
      const res = await procesarComprobantePago({
        archivo: file,
        subfolder: `dividendos/${divFecha.substring(0, 7)}`,
        userId: user?.id ?? null,
      });
      if (!res.ok && res.error) {
        setDivOcrWarning(res.error);
        return;
      }
      setDivComprobantePath(res.file_path);
      if (res.n_operacion) {
        // Solo autocompletamos si el usuario aún no había tipeado nada.
        if (!divNumOp.trim()) setDivNumOp(res.n_operacion);
        const pct = Math.round((res.confianza ?? 0) * 100);
        setDivOcrInfo(`✓ N° detectado: ${res.n_operacion}${pct ? ` (${pct}% confianza)` : ''}`);
      } else {
        setDivOcrInfo('Archivo subido. Completá el N° de operación manualmente.');
      }
      if (res.warning) setDivOcrWarning(res.warning);
    } finally {
      setDivOcrEjecutando(false);
    }
  }

  // ── mutation: dividendo ────────────────────────────────────────────────────

  const guardarDiv = useMutation({
    mutationFn: async () => {
      const monto = parseFloat(divMonto.replace(/\./g, '').replace(',', '.'));
      if (!monto || monto <= 0) throw new Error('Monto inválido');
      // Validación uniforme: para medios distintos de efectivo, exigimos N° op
      // y archivo del comprobante. Permite conciliar contra el extracto.
      if (divMedio !== 'efectivo') {
        if (!divNumOp.trim()) {
          throw new Error('N° de operación obligatorio para transferencias y cheques.');
        }
        if (!divComprobante) {
          throw new Error('Comprobante de pago obligatorio para transferencias y cheques.');
        }
      }

      // El comprobante ya quedó subido por el helper de OCR al seleccionar
      // el archivo. Si por algún motivo no se subió (OCR falló pero hay file),
      // hacemos fallback al upload manual para no perder el archivo del usuario.
      let comprobantePath: string | null = divComprobantePath;
      if (divComprobante && !comprobantePath) {
        const ext = divComprobante.name.split('.').pop()?.toLowerCase() || 'pdf';
        const carpeta = `dividendos/${divFecha.substring(0, 7)}`;
        comprobantePath = `${carpeta}/${divSocio}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: errUp } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(comprobantePath, divComprobante, {
            contentType: divComprobante.type || 'application/octet-stream',
          });
        if (errUp) throw errUp;
      }

      const { error } = await supabase.from('dividendos').insert({
        socio: divSocio,
        fecha: divFecha,
        monto,
        medio_pago: divMedio,
        concepto: divConcepto || null,
        local: divLocal || null,
        numero_operacion: divNumOp.trim() || null,
        comprobante_path: comprobantePath,
        periodo,
        creado_por: 'Admin',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fc_dividendos'] });
      setShowDivForm(false);
      setDivMonto('');
      setDivConcepto('');
      setDivNumOp('');
      setDivComprobante(null);
      setDivComprobantePath(null);
      setDivOcrInfo(null);
      setDivOcrWarning(null);
    },
  });

  const eliminarDiv = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('dividendos').delete().eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fc_dividendos'] }),
  });

  // ── data consolidada (sin filtro de local) ────────────────────────────────
  const cierresFiltrados = cierres ?? [];
  const pagosFiltrados = pagosRealizados ?? [];
  const divsFiltrados = dividendos ?? [];
  const sueldosFiltrados = pagosSueldos ?? [];
  const pagosMPFiltrados = pagosMP ?? [];

  // Mapa de categoría ID → tipo_edr
  const catMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categorias ?? []) m.set(c.id, c.tipo_edr);
    return m;
  }, [categorias]);

  // ── clasificación de movimientos bancarios ─────────────────────────────────
  // Regla de negocio:
  // - Ingresos reales = créditos MP (ventas) + efectivo verificado (cierres)
  // - Créditos Galicia/ICBC que son transferencias internas → no operativo
  // - Créditos Galicia/ICBC que son capital (InvertirOnline) → no operativo
  // - Créditos Galicia/ICBC operativos (dev. impuestos, cheques rechazados) → ingreso operativo menor

  const PATRONES_TRANSF_INTERNA = [
    /credito inmediato/i, // ICBC: transferencia desde MP
    /transf\.?\s*ctas?\s*propias?/i, // Galicia: entre cuentas propias
    /transferencia\s*de\s*cuenta\s*propia/i,
    /credito\s*transferencia\s*coelsa/i, // Galicia: transferencia recibida vía COELSA (desde MP)
  ];

  function esTransfInterna(m: MovBancario): boolean {
    return PATRONES_TRANSF_INTERNA.some((p) => p.test(m.descripcion ?? ''));
  }

  const movimientosClasificados = useMemo(() => {
    const movs = movimientos ?? [];

    // Créditos del extracto MP — son los cobros individuales que ya tenemos
    // duplicados en pagos_mp (API MP). No los mostramos para no confundir.
    // Si en el futuro necesitamos ver las liquidaciones reales (MP → banco),
    // habría que filtrar por descripción específica del extracto.

    // Egresos bancarios SOLO los que NO tienen gasto vinculado — sino se duplica
    // con pagos_gastos. Aplicamos !gasto_id en las 3 cuentas (Galicia, ICBC, MP).
    // En MP además requerimos tipo='cargo_mp' para limitar a impuesto al débito y
    // comisiones (los débitos MP por venta-cobro son liquidaciones, no egresos).
    const debitosGalicia = movs.filter(
      (m) => m.cuenta === 'galicia' && Number(m.debito) > 0 && !m.gasto_id,
    );
    const debitosICBC = movs.filter(
      (m) => m.cuenta === 'icbc' && Number(m.debito) > 0 && !m.gasto_id,
    );
    const debitosMP = movs.filter(
      (m) =>
        m.cuenta === 'mercadopago' &&
        Number(m.debito) > 0 &&
        m.tipo === 'cargo_mp' &&
        !m.gasto_id,
    );

    // Créditos Galicia/ICBC: clasificar cada uno
    const creditosGalICBC = movs.filter(
      (m) => (m.cuenta === 'galicia' || m.cuenta === 'icbc') && Number(m.credito) > 0,
    );

    // Créditos del extracto MP por defecto se ignoran (cobros ya cubiertos por
    // pagos_mp API). EXCEPCIÓN: créditos con patrón capital (retiros desde IOL
    // directo a MP) — los sumamos a "no operativo" para no perder trazabilidad.
    const creditosMPCapital = movs.filter(
      (m) => m.cuenta === 'mercadopago' && Number(m.credito) > 0 && esMovCapital(m),
    );

    const capital: MovBancario[] = [...creditosMPCapital];
    const transferenciasInternas: MovBancario[] = [];
    const creditosOperativos: MovBancario[] = []; // dev. impuestos, cheques rechazados, etc.

    for (const m of creditosGalICBC) {
      if (esMovCapital(m)) {
        capital.push(m);
      } else if (esTransfInterna(m)) {
        transferenciasInternas.push(m);
      } else {
        creditosOperativos.push(m); // es un ingreso operativo menor (dev. impuesto, etc.)
      }
    }

    return {
      creditosOperativos,
      debitosGalicia,
      debitosICBC,
      debitosMP,
      transferenciasInternas,
      capital,
    };
  }, [movimientos]);

  // ── INGRESOS ─────────────────────────────────────────────────────────────────

  const ingresos = useMemo(() => {
    // Efectivo desglosado por local (los cajones físicos son por local).
    // Usamos efectivoTurno = fudo_efectivo, no monto_contado (post-retiros).
    const efectivoVedia = cierresFiltrados
      .filter((c) => c.local === 'vedia')
      .reduce((s, c) => s + efectivoTurno(c), 0);
    const efectivoSaavedra = cierresFiltrados
      .filter((c) => c.local === 'saavedra')
      .reduce((s, c) => s + efectivoTurno(c), 0);
    const cantPendientes = cierresFiltrados.filter((c) => !c.verificado).length;

    // Custodia del efectivo: separamos lo que está en los locales (caja chica)
    // de lo que ya fue retirado y está en casa (caja fuerte). La suma de ambos
    // NO es el ingreso total — es solo la porción que aún se rastrea como
    // custodia física. Sirve como referencia operativa, no contable.
    let cajaChica = 0;
    let cajaFuerte = 0;
    for (const c of cierresFiltrados) {
      if (c.verificado) {
        cajaFuerte += Number(c.monto_llevado_caja_fuerte ?? 0);
      } else {
        cajaChica += Math.max(0, (c.monto_contado ?? 0) - FONDO_CAMBIO_DEFAULT);
      }
    }

    // Ventas MP — cuenta única SAS, no se desglosa por local
    const ventasMPBruto = pagosMPFiltrados.reduce((s, p) => s + Number(p.monto), 0);
    const ventasMPPorMedio = new Map<string, number>();
    for (const p of pagosMPFiltrados) {
      ventasMPPorMedio.set(
        p.medio_pago,
        (ventasMPPorMedio.get(p.medio_pago) ?? 0) + Number(p.monto),
      );
    }

    // Otros ingresos: créditos operativos de Galicia/ICBC (devoluciones, cheques)
    const otrosIngresos = movimientosClasificados.creditosOperativos.reduce(
      (s, m) => s + Number(m.credito),
      0,
    );
    const total = efectivoVedia + efectivoSaavedra + ventasMPBruto + otrosIngresos;

    return {
      efectivoVedia,
      efectivoSaavedra,
      cantPendientes,
      cajaChica,
      cajaFuerte,
      ventasMPBruto,
      ventasMPPorMedio,
      otrosIngresos,
      total,
    };
  }, [cierresFiltrados, movimientosClasificados, pagosMPFiltrados]);

  // ── EGRESOS ──────────────────────────────────────────────────────────────────

  const egresos = useMemo(() => {
    // 1) Pagos realizados agrupados por tipo EdR del gasto asociado.
    // Para CMV / gastos_op / rrhh agregamos desglose por local; el resto va consolidado.
    const grupos = new Map<
      string,
      {
        total: number;
        porLocal: Map<string, number>;
        items: { nombre: string; monto: number }[];
      }
    >();
    for (const p of pagosFiltrados) {
      const g = p.gasto;
      const tipoEdr = g?.categoria_id ? (catMap.get(g.categoria_id) ?? null) : null;
      const grupo = tipoEdrAGrupo(tipoEdr);
      const localGasto = g?.local ?? 'sas';
      if (!grupos.has(grupo)) grupos.set(grupo, { total: 0, porLocal: new Map(), items: [] });
      const entry = grupos.get(grupo)!;
      entry.total += Number(p.monto);
      entry.porLocal.set(localGasto, (entry.porLocal.get(localGasto) ?? 0) + Number(p.monto));
      const label = g?.categoria || g?.subcategoria || g?.proveedor || 'Sin categoría';
      const existing = entry.items.find((i) => i.nombre === label);
      if (existing) existing.monto += Number(p.monto);
      else entry.items.push({ nombre: label, monto: Number(p.monto) });
    }

    // 2) Costos financieros (comisiones MP desde API + débitos Galicia/ICBC desde extractos
    //    + cargos MP sobre pagos egresos: impuesto al débito, comisiones por enviar plata).
    const { debitosGalicia, debitosICBC, debitosMP } = movimientosClasificados;
    const bancarios: {
      nombre: string;
      monto: number;
      items: { nombre: string; monto: number }[];
    }[] = [];

    // Comisiones e impuestos MP: combinamos costos sobre cobros (pagos_mp) con costos
    // sobre pagos egresos (cargo_mp en movimientos_bancarios). Todo va al mismo grupo
    // bancario para no fragmentar la vista.
    const comisionesMPCobros = pagosMPFiltrados.reduce((s, p) => s + Number(p.comision_mp), 0);
    const impuestosMPCobros = pagosMPFiltrados.reduce((s, p) => s + Number(p.impuestos), 0);
    const cargosMPPagos = debitosMP.reduce((s, m) => s + Number(m.debito), 0);
    const totalCostosMP = comisionesMPCobros + impuestosMPCobros + cargosMPPagos;
    if (totalCostosMP > 0) {
      const mpItems: { nombre: string; monto: number }[] = [];
      if (comisionesMPCobros > 0)
        mpItems.push({ nombre: 'Comisiones MP (sobre ventas)', monto: comisionesMPCobros });
      if (impuestosMPCobros > 0)
        mpItems.push({ nombre: 'Retenciones impositivas MP', monto: impuestosMPCobros });
      if (debitosMP.length > 0) {
        const cargosByDescr = new Map<string, number>();
        for (const m of debitosMP) {
          const key = m.descripcion?.trim() || 'Impuesto al débito MP';
          cargosByDescr.set(key, (cargosByDescr.get(key) ?? 0) + Number(m.debito));
        }
        for (const [nombre, monto] of cargosByDescr) {
          mpItems.push({ nombre, monto });
        }
      }
      bancarios.push({
        nombre: GRUPO_DEBITO_LABEL.mercadopago,
        monto: totalCostosMP,
        items: mpItems.sort((a, b) => b.monto - a.monto),
      });
    }

    if (debitosGalicia.length > 0) {
      const totalGal = debitosGalicia.reduce((s, m) => s + Number(m.debito), 0);
      // Agrupar por descripción
      const galItems = new Map<string, number>();
      for (const m of debitosGalicia) {
        const key = m.descripcion ?? 'Otros';
        galItems.set(key, (galItems.get(key) ?? 0) + Number(m.debito));
      }
      bancarios.push({
        nombre: GRUPO_DEBITO_LABEL.galicia,
        monto: totalGal,
        items: [...galItems.entries()]
          .map(([nombre, monto]) => ({ nombre, monto }))
          .sort((a, b) => b.monto - a.monto),
      });
    }

    if (debitosICBC.length > 0) {
      const totalICBC = debitosICBC.reduce((s, m) => s + Number(m.debito), 0);
      const icbcItems = new Map<string, number>();
      for (const m of debitosICBC) {
        const key = m.descripcion ?? 'Otros';
        icbcItems.set(key, (icbcItems.get(key) ?? 0) + Number(m.debito));
      }
      bancarios.push({
        nombre: GRUPO_DEBITO_LABEL.icbc,
        monto: totalICBC,
        items: [...icbcItems.entries()]
          .map(([nombre, monto]) => ({ nombre, monto }))
          .sort((a, b) => b.monto - a.monto),
      });
    }

    const totalDebitosBanc = bancarios.reduce((s, b) => s + b.monto, 0);

    // 3) Sueldos (RRHH) — individual por empleado, se suma al grupo existente
    const totalSueldos = sueldosFiltrados.reduce((s, p) => s + Number(p.monto), 0);
    if (totalSueldos > 0) {
      if (!grupos.has('rrhh')) grupos.set('rrhh', { total: 0, porLocal: new Map(), items: [] });
      const entry = grupos.get('rrhh')!;
      // Agrupar por medio de pago para el resumen
      const sueldoEfectivo = sueldosFiltrados
        .filter((p) => p.medio_pago === 'efectivo')
        .reduce((s, p) => s + Number(p.monto), 0);
      const sueldoTransf = sueldosFiltrados
        .filter((p) => p.medio_pago === 'transferencia')
        .reduce((s, p) => s + Number(p.monto), 0);
      if (sueldoEfectivo > 0)
        entry.items.push({ nombre: 'Sueldos en efectivo', monto: sueldoEfectivo });
      if (sueldoTransf > 0)
        entry.items.push({ nombre: 'Sueldos por transferencia', monto: sueldoTransf });
      entry.total += totalSueldos;
      // Desglose de sueldos por local
      for (const s of sueldosFiltrados) {
        const loc = s.local && s.local !== 'ambos' ? s.local : 'sas';
        entry.porLocal.set(loc, (entry.porLocal.get(loc) ?? 0) + Number(s.monto));
      }
    }

    // 4) Dividendos (sin desglose por local — son retiros del SAS)
    const totalDivs = divsFiltrados.reduce((s, d) => s + Number(d.monto), 0);
    if (totalDivs > 0) {
      const divItems = SOCIOS.map((s) => ({
        nombre: SOCIO_LABEL[s],
        monto: divsFiltrados
          .filter((d) => d.socio === s)
          .reduce((sum, d) => sum + Number(d.monto), 0),
      })).filter((i) => i.monto > 0);
      grupos.set('dividendos', { total: totalDivs, porLocal: new Map(), items: divItems });
    }

    const totalPagos = pagosFiltrados.reduce((s, p) => s + Number(p.monto), 0);
    const total = totalPagos + totalDebitosBanc + totalDivs + totalSueldos;

    return { grupos, bancarios, totalPagos, totalDebitosBanc, totalDivs, totalSueldos, total };
  }, [
    pagosFiltrados,
    movimientosClasificados,
    pagosMPFiltrados,
    divsFiltrados,
    sueldosFiltrados,
    catMap,
  ]);

  // ── NO OPERATIVO ───────────────────────────────────────────────────────────

  const noOperativo = useMemo(() => {
    const { transferenciasInternas, capital } = movimientosClasificados;
    const totalTransf = transferenciasInternas.reduce((s, m) => s + Number(m.credito), 0);
    const capitalIn = capital
      .filter((m) => Number(m.credito) > 0)
      .reduce((s, m) => s + Number(m.credito), 0);
    const capitalOut = capital
      .filter((m) => Number(m.debito) > 0)
      .reduce((s, m) => s + Number(m.debito), 0);
    return {
      transferenciasInternas,
      capital,
      totalTransf,
      capitalIn,
      capitalOut,
    };
  }, [movimientosClasificados]);

  // ── KPIs de liquidez ───────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const saldoNeto = ingresos.total - egresos.total;
    const margenCaja = ingresos.total > 0 ? (saldoNeto / ingresos.total) * 100 : 0;
    const ratioCobertura = egresos.total > 0 ? ingresos.total / egresos.total : 0;
    const [y, m] = periodo.split('-').map(Number);
    const diasMes = new Date(y, m, 0).getDate();
    const burnRate = egresos.total / diasMes;
    const diasCaja = burnRate > 0 ? saldoNeto / burnRate : 0;
    const divsPctIngreso = ingresos.total > 0 ? (egresos.totalDivs / ingresos.total) * 100 : 0;
    const cmvPctVentas =
      ingresos.total > 0 ? ((egresos.grupos.get('cmv')?.total ?? 0) / ingresos.total) * 100 : 0;

    const difArqueo = cierresFiltrados.reduce((s, c) => s + (c.diferencia ?? 0), 0);
    const totalEsperado = cierresFiltrados
      .filter((c) => c.monto_esperado != null)
      .reduce((s, c) => s + (c.monto_esperado ?? 0), 0);
    const difArqueoPct = totalEsperado > 0 ? Math.abs(difArqueo / totalEsperado) * 100 : 0;

    return {
      saldoNeto,
      margenCaja,
      ratioCobertura,
      burnRate,
      diasCaja,
      divsPctIngreso,
      cmvPctVentas,
      difArqueo,
      difArqueoPct,
    };
  }, [ingresos, egresos, periodo, cierresFiltrados]);

  // ── gráfico ────────────────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    const byDay = new Map<string, { ingresos: number; egresos: number }>();

    // Ingresos: TODOS los cierres del mes (verificados o pendientes) + MP API (bruto) + otros bancarios
    for (const c of cierresFiltrados) {
      const d = byDay.get(c.fecha) ?? { ingresos: 0, egresos: 0 };
      d.ingresos += efectivoTurno(c);
      byDay.set(c.fecha, d);
    }
    for (const p of pagosMPFiltrados) {
      const fecha = p.fecha.substring(0, 10);
      const d = byDay.get(fecha) ?? { ingresos: 0, egresos: 0 };
      d.ingresos += Number(p.monto);
      d.egresos += Number(p.comision_mp) + Number(p.impuestos);
      byDay.set(fecha, d);
    }
    for (const m of movimientosClasificados.creditosOperativos) {
      const d = byDay.get(m.fecha) ?? { ingresos: 0, egresos: 0 };
      d.ingresos += Number(m.credito);
      byDay.set(m.fecha, d);
    }

    // Egresos: pagos realizados + sueldos + débitos bancarios (Galicia/ICBC) + dividendos
    for (const p of pagosFiltrados) {
      const d = byDay.get(p.fecha_pago) ?? { ingresos: 0, egresos: 0 };
      d.egresos += Number(p.monto);
      byDay.set(p.fecha_pago, d);
    }
    for (const p of sueldosFiltrados) {
      const d = byDay.get(p.fecha_pago) ?? { ingresos: 0, egresos: 0 };
      d.egresos += Number(p.monto);
      byDay.set(p.fecha_pago, d);
    }
    for (const m of [
      ...movimientosClasificados.debitosGalicia,
      ...movimientosClasificados.debitosICBC,
      ...movimientosClasificados.debitosMP,
    ]) {
      const d = byDay.get(m.fecha) ?? { ingresos: 0, egresos: 0 };
      d.egresos += Number(m.debito);
      byDay.set(m.fecha, d);
    }
    for (const dv of divsFiltrados) {
      const d = byDay.get(dv.fecha) ?? { ingresos: 0, egresos: 0 };
      d.egresos += Number(dv.monto);
      byDay.set(dv.fecha, d);
    }

    let acum = 0;
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, vals]) => {
        acum += vals.ingresos - vals.egresos;
        return { fecha: fecha.substring(8), saldo: acum };
      });
  }, [
    cierresFiltrados,
    movimientosClasificados,
    pagosMPFiltrados,
    pagosFiltrados,
    sueldosFiltrados,
    divsFiltrados,
  ]);

  // ── banner exports desactualizados ─────────────────────────────────────────

  const avisoExports = useMemo(() => {
    if (!ultimasFechasBancos) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    type AvisoItem = { cuenta: 'galicia' | 'icbc' | 'mercadopago'; diasGap: number | null };
    const desact: AvisoItem[] = [];
    for (const u of ultimasFechasBancos) {
      if (!u.fecha) {
        desact.push({ cuenta: u.cuenta, diasGap: null });
        continue;
      }
      const f = new Date(u.fecha + 'T00:00:00');
      const diasGap = Math.floor((hoy.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
      if (diasGap > 5) desact.push({ cuenta: u.cuenta, diasGap });
    }
    return desact.length > 0 ? desact : null;
  }, [ultimasFechasBancos]);

  // ── semáforo ───────────────────────────────────────────────────────────────

  function semaforoColor(
    valor: number,
    verde: [number, number],
    ambar: [number, number],
  ): 'green' | 'yellow' | 'red' {
    if (valor >= verde[0] && valor <= verde[1]) return 'green';
    if (valor >= ambar[0] && valor <= ambar[1]) return 'yellow';
    return 'red';
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <label className="mr-2 text-xs font-medium text-gray-500">Período</label>
          <input
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={sincronizarMP}
            disabled={syncing}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              syncing
                ? 'cursor-wait bg-gray-100 text-gray-400'
                : 'bg-blue-600 text-white hover:bg-blue-700',
            )}
          >
            {syncing ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />{' '}
                Sincronizando...
              </>
            ) : (
              <>
                <span>🔄</span> Sync MercadoPago
              </>
            )}
          </button>
          {pagosMPFiltrados.length > 0 && (
            <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
              {pagosMPFiltrados.length} pagos MP
            </span>
          )}
        </div>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div
          className={cn(
            'rounded-md px-3 py-2 text-xs',
            syncResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700',
          )}
        >
          {syncResult.ok
            ? `Sincronización exitosa: ${syncResult.sincronizados} pagos de ${periodo}`
            : `Error: ${syncResult.error}`}
          <button
            onClick={() => setSyncResult(null)}
            className="ml-2 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* Banner exports desactualizados — discreto, una línea, cerrable */}
      {avisoExports && !bannerCerrado && (
        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          <span>⚠️</span>
          <span>
            Exports desactualizados:{' '}
            {avisoExports.map((a, i) => (
              <span key={a.cuenta}>
                {i > 0 && ' · '}
                <strong className="capitalize">
                  {a.cuenta === 'mercadopago' ? 'MP' : a.cuenta}
                </strong>
                {a.diasGap === null ? ' (sin datos)' : ` (${a.diasGap}d sin mov.)`}
              </span>
            ))}
          </span>
          <Link
            to="/compras"
            className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 hover:bg-amber-200"
          >
            Importar →
          </Link>
          <button
            onClick={() => setBannerCerrado(true)}
            className="text-amber-600 hover:text-amber-800"
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {/* KPIs de liquidez y solvencia */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPILiquidez
          label="Saldo neto del período"
          value={formatARS(kpis.saldoNeto)}
          desc="Ingresos - Egresos totales del mes"
          color={kpis.saldoNeto >= 0 ? 'green' : 'red'}
        />
        <KPILiquidez
          label="Margen de caja"
          value={`${kpis.margenCaja.toFixed(1)}%`}
          desc="% de ingresos que queda después de egresos"
          color={semaforoColor(kpis.margenCaja, [15, 999], [5, 15])}
        />
        <KPILiquidez
          label="Ratio de cobertura"
          value={kpis.ratioCobertura.toFixed(2)}
          desc="Cuántos $ de ingreso por cada $ de egreso"
          color={semaforoColor(kpis.ratioCobertura, [1.2, 999], [1.0, 1.2])}
        />
        <KPILiquidez
          label="Burn rate diario"
          value={formatARS(kpis.burnRate)}
          desc="Egresos totales / días del mes"
          color="neutral"
        />
        <KPILiquidez
          label="Días de caja"
          value={kpis.diasCaja > 0 ? `${kpis.diasCaja.toFixed(0)} días` : '—'}
          desc="Cuántos días se cubre con el saldo actual"
          color={semaforoColor(kpis.diasCaja, [30, 999], [15, 30])}
        />
        <KPILiquidez
          label="Dividendos / Ingreso"
          value={`${kpis.divsPctIngreso.toFixed(1)}%`}
          desc="% de ingresos que se retiran como dividendos"
          color={semaforoColor(100 - kpis.divsPctIngreso, [85, 100], [75, 85])}
        />
        <KPILiquidez
          label="CMV / Ventas"
          value={`${kpis.cmvPctVentas.toFixed(1)}%`}
          desc="% de ingresos destinado a materia prima"
          color={semaforoColor(100 - kpis.cmvPctVentas, [60, 100], [55, 60])}
        />
        <KPILiquidez
          label="Diferencia de arqueo"
          value={formatARS(kpis.difArqueo)}
          desc={`${kpis.difArqueoPct.toFixed(2)}% desvío vs esperado`}
          color={semaforoColor(100 - kpis.difArqueoPct, [99, 100], [98, 99])}
        />
      </div>

      {/* Gráfico evolución diaria */}
      {chartData.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">
            Evolución diaria del saldo operativo — {periodo}
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="saldoGradFC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#65a832" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#65a832" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
              />
              <Tooltip
                formatter={(v) => [formatARS(Number(v)), 'Saldo acumulado']}
                labelFormatter={(l) => `Día ${l}`}
              />
              <Area
                type="monotone"
                dataKey="saldo"
                stroke="#4f8828"
                fill="url(#saldoGradFC)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ═══ INGRESOS ═══ */}
      <SeccionExpandible
        titulo="INGRESOS"
        total={ingresos.total}
        open={ingresosOpen}
        onToggle={() => setIngresosOpen(!ingresosOpen)}
        color="green"
      >
        <div className="divide-y divide-gray-100">
          <LineaDetalle
            label="Efectivo Vedia (cierres de caja)"
            monto={ingresos.efectivoVedia}
          />
          <LineaDetalle
            label="Efectivo Saavedra (cierres de caja)"
            monto={ingresos.efectivoSaavedra}
          />

          {/* Custodia del efectivo (informativo — no suma al total) */}
          <div className="px-3 py-2 text-xs bg-rodziny-50/40 border-y border-rodziny-100">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">
              Custodia del efectivo
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] text-gray-500">💵 Caja chica (locales)</div>
                <div className="font-semibold text-amber-700">{formatARS(ingresos.cajaChica)}</div>
                {ingresos.cantPendientes > 0 && (
                  <div className="text-[10px] text-amber-600">
                    {ingresos.cantPendientes} pendiente{ingresos.cantPendientes !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] text-gray-500">🏦 Caja fuerte (casa)</div>
                <div className="font-semibold text-green-700">{formatARS(ingresos.cajaFuerte)}</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-500">Total custodia</div>
                <div className="font-semibold text-gray-800">
                  {formatARS(ingresos.cajaChica + ingresos.cajaFuerte)}
                </div>
              </div>
            </div>
          </div>
          <GrupoEgreso
            label={`Ventas digitales — MercadoPago (${pagosMPFiltrados.length} pagos)`}
            total={ingresos.ventasMPBruto}
            items={[...ingresos.ventasMPPorMedio.entries()]
              .map(([medio, monto]) => ({ nombre: MEDIO_PAGO_MP_LABEL[medio] || medio, monto }))
              .sort((a, b) => b.monto - a.monto)}
            tipo="ingreso"
          />
          <LineaDetalle
            label="Otros ingresos bancarios (dev. impuestos, cheques rechazados)"
            monto={ingresos.otrosIngresos}
          />
        </div>
      </SeccionExpandible>

      {/* ═══ EGRESOS ═══ */}
      <SeccionExpandible
        titulo="EGRESOS"
        total={-egresos.total}
        open={egresosOpen}
        onToggle={() => setEgresosOpen(!egresosOpen)}
        color="red"
      >
        <div className="divide-y divide-gray-100">
          {/* Gastos pagados por categoría EdR. CMV / gastos_op / rrhh se
              desglosan por local (sub-línea con totales Vedia/Saavedra/SAS).
              El resto va consolidado porque son de la SAS o no tienen local. */}
          {[
            'cmv',
            'gastos_op',
            'rrhh',
            'impuestos',
            'inversiones',
            'intereses',
            'dividendos',
            'otros',
          ].map((grupo) => {
            const data = egresos.grupos.get(grupo);
            if (!data || data.total === 0) return null;
            const conDesglose = grupo === 'cmv' || grupo === 'gastos_op' || grupo === 'rrhh';
            return (
              <GrupoEgreso
                key={grupo}
                label={GRUPO_EGRESO_LABEL[grupo]}
                total={data.total}
                items={data.items}
                porLocal={conDesglose ? data.porLocal : undefined}
              />
            );
          })}
          {/* Débitos bancarios por cuenta */}
          {egresos.bancarios.map((banco) => (
            <GrupoEgreso
              key={banco.nombre}
              label={banco.nombre}
              total={banco.monto}
              items={banco.items}
            />
          ))}
        </div>
      </SeccionExpandible>

      {/* ═══ NO OPERATIVO ═══ */}
      {(noOperativo.transferenciasInternas.length > 0 || noOperativo.capital.length > 0) && (
        <SeccionExpandible
          titulo="MOVIMIENTOS NO OPERATIVOS"
          total={0}
          open={noOperativoOpen}
          onToggle={() => setNoOperativoOpen(!noOperativoOpen)}
          color="blue"
        >
          <div className="space-y-4 p-4">
            <p className="text-[10px] text-gray-500">
              Movimientos entre cuentas propias y cuenta comitente. No son ingresos ni egresos del
              negocio — no afectan los KPIs.
            </p>

            {/* Transferencias internas */}
            {noOperativo.transferenciasInternas.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold text-gray-700">
                  Transferencias internas (MP → Galicia / ICBC)
                </h4>
                <div className="overflow-hidden rounded-lg bg-gray-50">
                  <table className="w-full text-xs">
                    <tbody>
                      {noOperativo.transferenciasInternas.map((m) => (
                        <tr key={m.id} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 text-gray-500">{formatFecha(m.fecha)}</td>
                          <td className="px-3 py-1.5 text-gray-600">
                            {m.cuenta === 'galicia' ? 'Galicia' : 'ICBC'}
                          </td>
                          <td className="max-w-[200px] truncate px-3 py-1.5 text-gray-500">
                            {m.descripcion}
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-700">
                            {formatARS(Number(m.credito))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-right text-[10px] text-gray-400">
                  Total: {formatARS(noOperativo.totalTransf)}
                </p>
              </div>
            )}

            {/* Capital (InvertirOnline) */}
            {noOperativo.capital.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold text-gray-700">
                  Cuenta comitente (InvertirOnline)
                </h4>
                <div className="mb-2 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-green-50 p-2.5 text-center">
                    <p className="text-[10px] text-gray-500">Ingreso de capital</p>
                    <p className="text-base font-bold text-green-700">
                      {formatARS(noOperativo.capitalIn)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-red-50 p-2.5 text-center">
                    <p className="text-[10px] text-gray-500">Salida a inversión</p>
                    <p className="text-base font-bold text-red-700">
                      {formatARS(noOperativo.capitalOut)}
                    </p>
                  </div>
                </div>
                <div className="overflow-hidden rounded-lg bg-gray-50">
                  <table className="w-full text-xs">
                    <tbody>
                      {noOperativo.capital.map((m) => {
                        const esIngreso = Number(m.credito) > 0;
                        return (
                          <tr key={m.id} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 text-gray-500">{formatFecha(m.fecha)}</td>
                            <td className="max-w-[200px] truncate px-3 py-1.5 text-gray-500">
                              {m.descripcion}
                            </td>
                            <td
                              className={cn(
                                'px-3 py-1.5 text-right font-medium tabular-nums',
                                esIngreso ? 'text-green-700' : 'text-red-700',
                              )}
                            >
                              {esIngreso ? '+' : '-'}
                              {formatARS(esIngreso ? Number(m.credito) : Number(m.debito))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </SeccionExpandible>
      )}

      {/* ═══ DIVIDENDOS ═══ */}
      <SeccionExpandible
        titulo="DIVIDENDOS — Registro de retiros"
        total={-egresos.totalDivs}
        open={dividendosOpen}
        onToggle={() => setDividendosOpen(!dividendosOpen)}
        color="blue"
      >
        <div className="p-4">
          <div className="mb-4 grid grid-cols-3 gap-3">
            {SOCIOS.map((s) => {
              const total = divsFiltrados
                .filter((d) => d.socio === s)
                .reduce((sum, d) => sum + Number(d.monto), 0);
              return (
                <div key={s} className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className="mb-1 text-xs text-gray-500">{SOCIO_LABEL[s]}</p>
                  <p className="text-lg font-bold text-gray-900">{formatARS(total)}</p>
                </div>
              );
            })}
          </div>

          {!showDivForm && (
            <button
              onClick={() => setShowDivForm(true)}
              className="w-full rounded-lg border-2 border-dashed border-gray-300 py-2 text-sm text-gray-500 transition-colors hover:border-rodziny-400 hover:text-rodziny-700"
            >
              + Registrar retiro
            </button>
          )}

          {showDivForm && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Socio</label>
                  <select
                    value={divSocio}
                    onChange={(e) => setDivSocio(e.target.value)}
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    {SOCIOS.map((s) => (
                      <option key={s} value={s}>
                        {SOCIO_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Fecha</label>
                  <input
                    type="date"
                    value={divFecha}
                    onChange={(e) => setDivFecha(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Monto *</label>
                  <input
                    type="text"
                    value={divMonto}
                    onChange={(e) => setDivMonto(e.target.value)}
                    placeholder="500000"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Medio de pago
                  </label>
                  <select
                    value={divMedio}
                    onChange={(e) => setDivMedio(e.target.value)}
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    {MEDIOS_PAGO_DIV.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    De qué caja sale
                  </label>
                  <select
                    value={divLocal}
                    onChange={(e) => setDivLocal(e.target.value)}
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">General</option>
                    <option value="vedia">Vedia</option>
                    <option value="saavedra">Saavedra</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Concepto</label>
                  <input
                    type="text"
                    value={divConcepto}
                    onChange={(e) => setDivConcepto(e.target.value)}
                    placeholder="Retiro mensual"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {divMedio !== 'efectivo' && (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      N° de operación *
                    </label>
                    <input
                      type="text"
                      value={divNumOp}
                      onChange={(e) => setDivNumOp(e.target.value)}
                      placeholder="Ej: 157737647098"
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      Comprobante de pago *
                    </label>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      disabled={divOcrEjecutando}
                      onChange={(e) => handleSelectDivComprobante(e.target.files?.[0] ?? null)}
                      className="block w-full text-xs file:mr-2 file:rounded file:border file:border-gray-300 file:bg-white file:px-2 file:py-1 file:text-xs file:text-gray-700 disabled:opacity-50"
                    />
                    {divComprobante && (
                      <p className="mt-1 truncate text-[11px] text-green-700">📎 {divComprobante.name}</p>
                    )}
                    {divOcrEjecutando && (
                      <p className="mt-1 text-[11px] text-gray-500">Leyendo N° de operación…</p>
                    )}
                    {divOcrInfo && !divOcrEjecutando && (
                      <p className="mt-1 text-[11px] text-green-700">{divOcrInfo}</p>
                    )}
                    {divOcrWarning && !divOcrEjecutando && (
                      <p className="mt-1 text-[11px] text-amber-700">{divOcrWarning}</p>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowDivForm(false);
                    setDivComprobante(null);
                    setDivComprobantePath(null);
                    setDivOcrInfo(null);
                    setDivOcrWarning(null);
                  }}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => guardarDiv.mutate()}
                  disabled={guardarDiv.isPending || divOcrEjecutando || !divMonto}
                  className="rounded bg-rodziny-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800 disabled:bg-gray-300"
                >
                  {guardarDiv.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
              {guardarDiv.isError && (
                <p className="mt-2 text-xs text-red-600">{(guardarDiv.error as Error).message}</p>
              )}
            </div>
          )}

          {divsFiltrados.length > 0 && (
            <table className="mt-4 w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Fecha</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Socio</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Medio</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Concepto</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-500">Monto</th>
                  <th className="w-8 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {divsFiltrados.map((d) => (
                  <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600">{formatFecha(d.fecha)}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {SOCIO_LABEL[d.socio] ?? d.socio}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {MEDIOS_PAGO_DIV.find((m) => m.value === d.medio_pago)?.label ?? d.medio_pago}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{d.concepto || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-red-700">
                      {formatARS(Number(d.monto))}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `¿Eliminar retiro de ${SOCIO_LABEL[d.socio]} por ${formatARS(Number(d.monto))}?`,
                            )
                          )
                            eliminarDiv.mutate(d.id);
                        }}
                        className="text-xs text-gray-300 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SeccionExpandible>
    </div>
  );
}

// ── sub-componentes ──────────────────────────────────────────────────────────

function KPILiquidez({
  label,
  value,
  desc,
  color,
}: {
  label: string;
  value: string;
  desc: string;
  color: 'green' | 'yellow' | 'red' | 'neutral';
}) {
  const borderColors = {
    green: 'border-l-green-500',
    yellow: 'border-l-amber-500',
    red: 'border-l-red-500',
    neutral: 'border-l-gray-300',
  };
  return (
    <div
      className={cn(
        'rounded-lg border border-l-[3px] border-surface-border bg-white p-4',
        borderColors[color],
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-[10px] leading-tight text-gray-400">{desc}</p>
    </div>
  );
}

function SeccionExpandible({
  titulo,
  total,
  open,
  onToggle,
  color,
  children,
}: {
  titulo: string;
  total: number;
  open: boolean;
  onToggle: () => void;
  color: 'green' | 'red' | 'blue';
  children: React.ReactNode;
}) {
  const headerColors = {
    green: 'bg-green-900 text-green-50',
    red: 'bg-red-900 text-red-50',
    blue: 'bg-blue-900 text-blue-50',
  };
  return (
    <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
      <button
        onClick={onToggle}
        className={cn('flex w-full items-center justify-between px-5 py-3', headerColors[color])}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{open ? '▼' : '▶'}</span>
          <span className="text-sm font-bold tracking-wide">{titulo}</span>
        </div>
        <span className="text-base font-bold tabular-nums">
          {total === 0 ? '—' : formatARS(Math.abs(total))}
        </span>
      </button>
      {open && children}
    </div>
  );
}

function LineaDetalle({ label, monto, nota }: { label: string; monto: number; nota?: string }) {
  if (monto === 0) return null;
  return (
    <div className="flex items-center justify-between px-5 py-2.5">
      <div>
        <span className="text-sm text-gray-700">{label}</span>
        {nota && <span className="ml-2 text-[10px] text-amber-600">{nota}</span>}
      </div>
      <span className="text-sm font-semibold tabular-nums text-gray-900">{formatARS(monto)}</span>
    </div>
  );
}

function GrupoEgreso({
  label,
  total,
  items,
  porLocal,
  tipo = 'egreso',
}: {
  label: string;
  total: number;
  items: { nombre: string; monto: number }[];
  porLocal?: Map<string, number>;
  tipo?: 'ingreso' | 'egreso';
}) {
  const [open, setOpen] = useState(false);
  const sorted = [...items].sort((a, b) => b.monto - a.monto);
  const localLabel: Record<string, string> = {
    vedia: 'Vedia',
    saavedra: 'Saavedra',
    sas: 'SAS',
    ambos: 'Ambos',
    general: 'General',
  };
  const localesSorted = porLocal
    ? [...porLocal.entries()].filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-2.5 transition-colors hover:bg-gray-50"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">{open ? '▼' : '▶'}</span>
          <span className="text-sm text-gray-700">{label}</span>
        </div>
        <span
          className={`text-sm font-semibold tabular-nums ${
            tipo === 'ingreso' ? 'text-green-700' : 'text-red-700'
          }`}
        >
          {tipo === 'ingreso' ? '' : '-'}
          {formatARS(total)}
        </span>
      </button>
      {/* Desglose por local — visible siempre, no requiere expandir */}
      {localesSorted.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-2 text-[11px] text-gray-500">
          {localesSorted.map(([loc, monto]) => (
            <span key={loc}>
              <span className="font-medium text-gray-600">{localLabel[loc] ?? loc}:</span>{' '}
              <span className="tabular-nums">{formatARS(monto)}</span>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="border-t border-gray-100 bg-gray-50">
          {sorted.map((item, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-1.5 pl-10 text-xs">
              <span className="text-gray-500">
                <span className="mr-1.5 text-gray-300">└</span>
                {item.nombre}
              </span>
              <span className="tabular-nums text-gray-700">{formatARS(item.monto)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
