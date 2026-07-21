import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { comprimirImagen } from '@/lib/comprimirImagen';
import { formatARS, formatFecha, cn } from '@/lib/utils';
import { procesarComprobantePago } from '@/lib/ocrComprobantePago';
import { useAuth } from '@/lib/auth';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useProveedoresMap, nombreProveedor } from '@/modules/gastos/proveedorDisplay';
import { hoyAR } from '@/lib/fechaAR';
import { parseDecimal } from '@/lib/numero';
import {
  esPagoEjecutado,
  clasificarDebito,
  esVentaMP,
  tipoIngresoMPNoVenta,
  CLASE_DEBITO_LABEL,
  type ClaseDebito,
} from '@/lib/flujoCaja';

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
  // `programado` marca echeq/tarjeta con fecha futura. No se usa para decidir si
  // el pago ya salió (nadie apaga el flag al debitarse) — solo para etiquetarlo
  // en la UI. La decisión la toma la fecha. Ver src/lib/flujoCaja.ts.
  programado: boolean | null;
  // datos del gasto asociado
  gasto: {
    local: string;
    proveedor: string | null;
    proveedor_id: string | null;
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

// Los débitos bancarios ya no se agrupan por cuenta sino por naturaleza
// (costo financiero / sin registrar). Agruparlos por banco mezclaba plata que se
// fue de verdad con plata que ya estaba contada por otro lado. Ver src/lib/flujoCaja.ts.

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

// Texto "hace X min" / "hace X h" / "hace X días" para la última sync de MP.
function tiempoRelativoSync(iso: string | null): string {
  if (!iso) return 'sin sincronizar';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString('es-AR');
}

// Cobros de POSnet personal de Lucas que entran como dividendo automático.
// Son 1 fila por cobro → en la tabla se colapsan en una sola línea total.
function esMpLucasAuto(d: Dividendo): boolean {
  const medio = (d.medio_pago ?? '').toLowerCase();
  const concepto = (d.concepto ?? '').toLowerCase();
  return (
    medio === 'mercadopago lucas' ||
    medio === 'mp' ||
    concepto.includes('posnet') ||
    concepto.includes('autoasignado')
  );
}

// ── componente principal ─────────────────────────────────────────────────────

export function FlujoCaja({ onNavigateToTab }: { onNavigateToTab?: (tab: string) => void } = {}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: proveedoresMap } = useProveedoresMap();
  // El flujo de caja es a nivel empresa (Rodziny SAS) — los movimientos bancarios
  // son de la SAS, no del local. Filtrar por local daba una vista parcial confusa.
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().substring(0, 7));
  const [ingresosOpen, setIngresosOpen] = useState(true);
  const [bannerCerrado, setBannerCerrado] = useState(false);
  const [egresosOpen, setEgresosOpen] = useState(true);
  const [comprometidoOpen, setComprometidoOpen] = useState(false);
  const [masIndicadoresOpen, setMasIndicadoresOpen] = useState(false);
  // Saldo de MercadoPago a mano: la API devuelve 403 al pedir el balance (el
  // access token no tiene ese scope), y el export de MP tampoco trae saldo. Es la
  // única cuenta que no se puede automatizar, y sin ella la liquidez no cierra.
  // El sync sigue intentando traerlo: si algún día se habilita el permiso, pisa
  // este valor con fuente 'api' y el input deja de hacer falta.
  const [saldoMPInput, setSaldoMPInput] = useState('');
  const [dividendosOpen, setDividendosOpen] = useState(false);
  const [noOperativoOpen, setNoOperativoOpen] = useState(false);
  const [showDivForm, setShowDivForm] = useState(false);
  // Filtro por socio en la tabla de dividendos (click en tarjeta o nombre)
  const [filtroSocio, setFiltroSocio] = useState<string | null>(null);

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

  // Saldo actual de cada cuenta. Galicia e ICBC lo traen en el extracto (la
  // columna `saldo` del último movimiento). MercadoPago no lo trae nunca, así que
  // sale de saldos_cuentas, que puebla el sync vía API. Ver migración 129.
  const { data: saldosCuentas } = useQuery({
    queryKey: ['fc_saldos_cuentas'],
    queryFn: async () => {
      const out: { cuenta: string; fecha: string; saldo: number; fuente: string }[] = [];

      for (const cuenta of ['galicia', 'icbc'] as const) {
        const { data } = await supabase
          .from('movimientos_bancarios')
          .select('fecha, saldo')
          .eq('cuenta', cuenta)
          .not('saldo', 'is', null)
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.saldo != null) {
          out.push({
            cuenta,
            fecha: data.fecha as string,
            saldo: Number(data.saldo),
            fuente: 'extracto',
          });
        }
      }

      const { data: mp } = await supabase
        .from('saldos_cuentas')
        .select('cuenta, fecha, saldo, fuente')
        .eq('cuenta', 'mercadopago')
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (mp) {
        out.push({
          cuenta: 'mercadopago',
          fecha: mp.fecha as string,
          saldo: Number(mp.saldo),
          fuente: mp.fuente as string,
        });
      }

      return out;
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
          'id, gasto_id, fecha_pago, monto, medio_pago, programado, gasto:gastos!inner(local, proveedor, proveedor_id, categoria, subcategoria, categoria_id, cancelado)',
        )
        .gte('fecha_pago', `${periodo}-01`)
        .lte('fecha_pago', `${periodo}-${lastDay}`)
        .neq('gasto.cancelado', true);
      return (data ?? []) as unknown as PagoRealizado[];
    },
  });

  // Movimientos bancarios que YA están contados por el lado del ERP.
  // Las 3 tablas tienen `conciliado_movimiento_id` desde hace rato; el Flujo solo
  // miraba `gasto_id` y por eso los sueldos por transferencia y los dividendos
  // conciliados se contaban dos veces (una por el ERP, otra por el extracto).
  const { data: movsYaContados } = useQuery({
    queryKey: ['fc_movs_ya_contados', periodo],
    queryFn: async () => {
      const [pg, ps, dv] = await Promise.all([
        supabase
          .from('pagos_gastos')
          .select('conciliado_movimiento_id')
          .not('conciliado_movimiento_id', 'is', null),
        supabase
          .from('pagos_sueldos')
          .select('conciliado_movimiento_id')
          .not('conciliado_movimiento_id', 'is', null),
        supabase
          .from('dividendos')
          .select('conciliado_movimiento_id')
          .not('conciliado_movimiento_id', 'is', null),
      ]);
      const ids = new Set<string>();
      for (const row of [...(pg.data ?? []), ...(ps.data ?? []), ...(dv.data ?? [])]) {
        const id = (row as { conciliado_movimiento_id: string | null }).conciliado_movimiento_id;
        if (id) ids.add(id);
      }
      return ids;
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

  // Última sincronización de MP del período (max sincronizado_at)
  const { data: ultimaSyncMP } = useQuery({
    queryKey: ['fc_ultima_sync_mp', periodo],
    queryFn: async () => {
      const { data } = await supabase
        .from('pagos_mp')
        .select('sincronizado_at')
        .eq('periodo', periodo)
        .order('sincronizado_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.sincronizado_at ?? null) as string | null;
    },
    refetchInterval: 60_000, // refresca el "hace X min" cada minuto
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
      qc.invalidateQueries({ queryKey: ['fc_ultima_sync_mp'] });
      qc.invalidateQueries({ queryKey: ['fc_saldos_cuentas'] });
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
          .upload(comprobantePath, await comprimirImagen(divComprobante), {
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

  const guardarSaldoMP = useMutation({
    mutationFn: async () => {
      const saldo = parseDecimal(saldoMPInput);
      if (saldo === null) throw new Error('Saldo inválido');
      const { error } = await supabase
        .from('saldos_cuentas')
        .upsert(
          { cuenta: 'mercadopago', fecha: hoyAR(), saldo, fuente: 'manual' },
          { onConflict: 'cuenta,fecha' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fc_saldos_cuentas'] });
      setSaldoMPInput('');
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
  const divsFiltrados = dividendos ?? [];

  // Ejecutado vs comprometido. Un echeq con fecha 23/07 o un consumo que se
  // debita con el resumen de la tarjeta el 22/07 NO son egresos de hoy: la plata
  // sigue en la cuenta. Contarlos como salida hundía el saldo del mes en curso
  // ($4,5M solo en julio-2026) y metía días futuros en el gráfico.
  const hoy = hoyAR();
  const pagosFiltrados = useMemo(
    () => (pagosRealizados ?? []).filter((p) => esPagoEjecutado(p.fecha_pago, hoy)),
    [pagosRealizados, hoy],
  );
  const pagosComprometidos = useMemo(
    () => (pagosRealizados ?? []).filter((p) => !esPagoEjecutado(p.fecha_pago, hoy)),
    [pagosRealizados, hoy],
  );

  // Filas a mostrar en la tabla de dividendos: aplica el filtro por socio y
  // colapsa todos los cobros de POSnet de Lucas en una única línea total.
  type FilaDiv = Dividendo & { _agg?: boolean };
  const filasDividendos = useMemo<FilaDiv[]>(() => {
    const base = filtroSocio
      ? divsFiltrados.filter((d) => d.socio === filtroSocio)
      : divsFiltrados;
    const autos = base.filter(esMpLucasAuto);
    const filas: FilaDiv[] = base.filter((d) => !esMpLucasAuto(d));
    if (autos.length > 0) {
      const total = autos.reduce((s, d) => s + Number(d.monto), 0);
      const maxFecha = autos.reduce((a, d) => (d.fecha > a ? d.fecha : a), autos[0].fecha);
      filas.push({
        id: '__mp_lucas_agg__',
        socio: 'lucas',
        fecha: maxFecha,
        monto: total,
        medio_pago: 'Mercadopago Lucas',
        concepto: `${autos.length} cobros POSnet (autoasignado)`,
        local: null,
        periodo,
        numero_operacion: null,
        comprobante_path: null,
        _agg: true,
      });
    }
    return filas.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  }, [divsFiltrados, filtroSocio, periodo]);
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
    const yaContados = movsYaContados ?? new Set<string>();

    // ── DÉBITOS ──
    // Antes se sumaba como egreso TODO débito sin gasto_id. Eso contaba dos veces
    // los sueldos por transferencia ("ACRED. HABERES", ya en pagos_sueldos), el
    // pago del resumen de la tarjeta (sus consumos ya son gastos) y las
    // transferencias entre cuentas propias (que ni siquiera son un egreso).
    // Solo en junio-2026 eso inflaba los egresos en ~$17M.
    // Ahora cada débito se clasifica y solo suman los que son plata que se fue de
    // verdad y nadie más contó. Ver src/lib/flujoCaja.ts.
    const porClase: Record<ClaseDebito, MovBancario[]> = {
      interna: [],
      ya_registrado: [],
      costo_bancario: [],
      sin_registrar: [],
    };
    for (const m of movs) {
      if (Number(m.debito) <= 0) continue;
      porClase[clasificarDebito(m, yaContados)].push(m);
    }

    // ── CRÉDITOS ──
    // Los créditos del extracto MP se ignoran: son los cobros individuales, que ya
    // vienen por la API en pagos_mp. EXCEPCIÓN: retiros desde la cuenta comitente
    // (IOL) directo a MP — se muestran como no operativo para no perderles el rastro.
    const creditosMPCapital = movs.filter(
      (m) => m.cuenta === 'mercadopago' && Number(m.credito) > 0 && esMovCapital(m),
    );
    const creditosGalICBC = movs.filter(
      (m) => (m.cuenta === 'galicia' || m.cuenta === 'icbc') && Number(m.credito) > 0,
    );

    const capital: MovBancario[] = [...creditosMPCapital, ...porClase.interna.filter(esMovCapital)];
    const transferenciasInternas: MovBancario[] = porClase.interna.filter((m) => !esMovCapital(m));
    const creditosOperativos: MovBancario[] = []; // dev. impuestos, cheques rechazados, etc.

    for (const m of creditosGalICBC) {
      if (esMovCapital(m)) capital.push(m);
      else if (esTransfInterna(m)) transferenciasInternas.push(m);
      else creditosOperativos.push(m); // ingreso operativo menor (dev. impuesto, etc.)
    }

    return {
      creditosOperativos,
      // Suman al egreso: costos financieros + salidas que el ERP no conoce.
      debitosCostoBancario: porClase.costo_bancario,
      debitosSinRegistrar: porClase.sin_registrar,
      // No suman: ya los contó el ERP, o es plata entre cuentas propias.
      debitosYaRegistrados: porClase.ya_registrado,
      transferenciasInternas,
      capital,
    };
  }, [movimientos, movsYaContados]);

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

    // Ventas MP — cuenta única SAS, no se desglosa por local.
    // Solo los cobros que son VENTAS. Lo que entra a la cuenta MP y no pasó por
    // el POS (retiros de InvertirOnline, transferencias entre cuentas propias) no
    // es ingreso del negocio: eran $22,4M de los "ingresos" de julio-2026.
    const ventasMP = pagosMPFiltrados.filter(esVentaMP);
    const ventasMPBruto = ventasMP.reduce((s, p) => s + Number(p.monto), 0);
    const ventasMPPorMedio = new Map<string, number>();
    for (const p of ventasMP) {
      ventasMPPorMedio.set(
        p.medio_pago,
        (ventasMPPorMedio.get(p.medio_pago) ?? 0) + Number(p.monto),
      );
    }
    const cantVentasMP = ventasMP.length;

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
      cantVentasMP,
      otrosIngresos,
      total,
    };
  }, [cierresFiltrados, movimientosClasificados, pagosMPFiltrados]);

  // Plata que entró a MercadoPago pero NO es una venta: retiros de la cuenta
  // comitente (InvertirOnline) y transferencias entre cuentas propias. Se muestra
  // en "no operativo" para no perderle el rastro, pero no suma al ingreso.
  const ingresosMPNoVenta = useMemo(() => {
    const noVenta = pagosMPFiltrados.filter((p) => !esVentaMP(p));
    const capital = noVenta.filter((p) => tipoIngresoMPNoVenta(p) === 'capital');
    const propias = noVenta.filter((p) => tipoIngresoMPNoVenta(p) === 'transferencia_propia');
    const sum = (arr: PagoMP[]) => arr.reduce((s, p) => s + Number(p.monto), 0);
    return {
      capital,
      propias,
      totalCapital: sum(capital),
      totalPropias: sum(propias),
      total: sum(noVenta),
    };
  }, [pagosMPFiltrados]);

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
      const label =
        g?.categoria ||
        g?.subcategoria ||
        (g ? nombreProveedor(g, proveedoresMap, '') : '') ||
        'Sin categoría';
      const existing = entry.items.find((i) => i.nombre === label);
      if (existing) existing.monto += Number(p.monto);
      else entry.items.push({ nombre: label, monto: Number(p.monto) });
    }

    // 2) Egresos que vienen del banco y NO están ya contados por el ERP:
    //    (a) costos financieros — comisiones MP (API) + impuesto al débito, IVA, intereses
    //    (b) débitos sin registrar — salió plata y no hay gasto/sueldo/dividendo detrás
    const { debitosCostoBancario, debitosSinRegistrar } = movimientosClasificados;
    const bancarios: {
      nombre: string;
      monto: number;
      items: { nombre: string; monto: number }[];
    }[] = [];

    const agruparPorDescripcion = (movs: MovBancario[]) => {
      const acc = new Map<string, number>();
      for (const m of movs) {
        const key = m.descripcion?.trim() || 'Sin descripción';
        acc.set(key, (acc.get(key) ?? 0) + Number(m.debito));
      }
      return [...acc.entries()]
        .map(([nombre, monto]) => ({ nombre, monto }))
        .sort((a, b) => b.monto - a.monto);
    };

    // Costos financieros: comisiones/retenciones sobre cobros (pagos_mp, vía API)
    // + cargos bancarios del extracto (impuesto al débito, IVA, mantenimiento).
    const comisionesMPCobros = pagosMPFiltrados.reduce((s, p) => s + Number(p.comision_mp), 0);
    const impuestosMPCobros = pagosMPFiltrados.reduce((s, p) => s + Number(p.impuestos), 0);
    const cargosExtracto = debitosCostoBancario.reduce((s, m) => s + Number(m.debito), 0);
    const totalCostosFin = comisionesMPCobros + impuestosMPCobros + cargosExtracto;
    if (totalCostosFin > 0) {
      const items: { nombre: string; monto: number }[] = [];
      if (comisionesMPCobros > 0)
        items.push({ nombre: 'Comisiones MP (sobre ventas)', monto: comisionesMPCobros });
      if (impuestosMPCobros > 0)
        items.push({ nombre: 'Retenciones impositivas MP', monto: impuestosMPCobros });
      items.push(...agruparPorDescripcion(debitosCostoBancario));
      bancarios.push({
        nombre: 'Costos bancarios y financieros',
        monto: totalCostosFin,
        items: items.sort((a, b) => b.monto - a.monto),
      });
    }

    // Débitos que el ERP no conoce. Son egresos reales (la plata salió) pero hay
    // que cargarlos o conciliarlos — se muestran aparte con un CTA, no escondidos
    // dentro de "otros", para que no queden como un agujero permanente.
    const totalSinRegistrar = debitosSinRegistrar.reduce((s, m) => s + Number(m.debito), 0);
    if (totalSinRegistrar > 0) {
      bancarios.push({
        nombre: CLASE_DEBITO_LABEL.sin_registrar,
        monto: totalSinRegistrar,
        items: agruparPorDescripcion(debitosSinRegistrar),
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
    proveedoresMap,
  ]);

  // ── COMPROMETIDO (todavía no salió) ────────────────────────────────────────
  // Echeq, cheques diferidos y consumos de tarjeta con fecha futura. La plata
  // sigue en la cuenta, así que NO son egresos del mes — pero están vendidos:
  // se restan de la liquidez disponible para saber con cuánto contás de verdad.
  const comprometido = useMemo(() => {
    const items = pagosComprometidos
      .map((p) => ({
        id: p.id,
        fecha: p.fecha_pago,
        proveedor: p.gasto ? nombreProveedor(p.gasto, proveedoresMap, 'Sin proveedor') : '—',
        categoria: p.gasto?.categoria ?? null,
        medio: p.medio_pago,
        monto: Number(p.monto),
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    return { items, total: items.reduce((s, i) => s + i.monto, 0) };
  }, [pagosComprometidos, proveedoresMap]);

  // ── LIQUIDEZ REAL ──────────────────────────────────────────────────────────
  // Lo que el módulo llamaba "liquidez" era en realidad el resultado de caja del
  // mes (ingresos − egresos). Eso no dice cuánta plata HAY. Un mes puede cerrar
  // negativo con la cuenta llena, o positivo estando en rojo. La liquidez es un
  // stock, no un flujo: hay que partir de los saldos.
  const liquidez = useMemo(() => {
    const porCuenta = new Map<string, { saldo: number; fecha: string; fuente: string }>();
    for (const s of saldosCuentas ?? []) {
      porCuenta.set(s.cuenta, { saldo: Number(s.saldo), fecha: s.fecha, fuente: s.fuente });
    }
    const bancos = [...porCuenta.values()].reduce((s, c) => s + c.saldo, 0);
    // El efectivo en custodia es plata de la empresa tanto como la del banco.
    const efectivo = ingresos.cajaChica + ingresos.cajaFuerte;
    const total = bancos + efectivo;
    // Libre = lo que queda después de honrar los cheques y consumos ya emitidos.
    const libre = total - comprometido.total;
    // La liquidez vale lo que valga el dato más viejo que la compone.
    const fechas = [...porCuenta.values()].map((c) => c.fecha).sort();
    return {
      porCuenta,
      bancos,
      efectivo,
      total,
      libre,
      desactualizada: fechas.length === 0 || fechas[0] < hoy,
      fechaMasVieja: fechas[0] ?? null,
      faltanCuentas: (['galicia', 'icbc', 'mercadopago'] as const).filter(
        (c) => !porCuenta.has(c),
      ),
    };
  }, [saldosCuentas, ingresos.cajaChica, ingresos.cajaFuerte, comprometido.total, hoy]);

  // ── NO OPERATIVO ───────────────────────────────────────────────────────────

  const noOperativo = useMemo(() => {
    const { transferenciasInternas, capital } = movimientosClasificados;
    // Ahora la lista trae las dos patas: la salida de una cuenta (débito) y la
    // entrada en la otra (crédito). Antes solo se veían los créditos y los débitos
    // se colaban como egreso ($6,79M en junio-2026).
    const totalTransf = transferenciasInternas.reduce(
      (s, m) => s + Math.max(Number(m.credito), Number(m.debito)),
      0,
    );
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

    // Burn rate y días de caja se miden sobre los días TRANSCURRIDOS, no sobre el
    // mes entero. En el mes en curso, dividir por 31 cuando van 12 días subestima
    // el burn y da una falsa sensación de holgura.
    const esMesEnCurso = periodo === hoy.substring(0, 7);
    const diasTranscurridos = esMesEnCurso ? Number(hoy.substring(8, 10)) : diasMes;
    const burnRate = egresos.total / Math.max(1, diasTranscurridos);

    // Días de caja = con la plata que HAY hoy, cuántos días de egresos aguantás.
    // Antes se calculaba sobre el saldo del mes (ingresos − egresos), que no es
    // plata disponible: daba "—" apenas el mes tenía resultado negativo.
    const diasCaja = burnRate > 0 ? liquidez.libre / burnRate : 0;

    const divsPctIngreso = ingresos.total > 0 ? (egresos.totalDivs / ingresos.total) * 100 : 0;
    const cmvPctVentas =
      ingresos.total > 0 ? ((egresos.grupos.get('cmv')?.total ?? 0) / ingresos.total) * 100 : 0;

    // Arqueo: si no hay cierres con monto_esperado, no hay dato — no es que el
    // desvío sea cero. Antes mostraba "$0 / 0,00%" en verde con 21 cierres sin
    // verificar, que es justo la lectura opuesta a la real.
    const cierresConArqueo = cierresFiltrados.filter((c) => c.monto_esperado != null);
    const hayArqueo = cierresConArqueo.length > 0;
    const difArqueo = cierresConArqueo.reduce((s, c) => s + (c.diferencia ?? 0), 0);
    const totalEsperado = cierresConArqueo.reduce((s, c) => s + (c.monto_esperado ?? 0), 0);
    const difArqueoPct = totalEsperado > 0 ? Math.abs(difArqueo / totalEsperado) * 100 : 0;

    return {
      hayArqueo,
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
  }, [ingresos, egresos, periodo, cierresFiltrados, liquidez, hoy]);

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
      // Solo las ventas suman al saldo. Los retiros de InvertirOnline y las
      // transferencias entre cuentas propias entran a MP pero no son ingresos —
      // si se acumulan acá, la curva termina muy por encima de la plata real.
      if (esVentaMP(p)) d.ingresos += Number(p.monto);
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
      ...movimientosClasificados.debitosCostoBancario,
      ...movimientosClasificados.debitosSinRegistrar,
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

    // Anclar el gráfico al saldo real. Antes acumulaba desde cero, así que el
    // primer día ya aparecía en -$11M (los pagos de cierre de mes caen el día 1) y
    // la curva no significaba nada: no era el saldo, era el flujo acumulado.
    //
    // El saldo de apertura se deriva hacia atrás desde la liquidez de hoy:
    //   apertura = liquidez_hoy − (lo que entró − lo que salió en el mes)
    // Así la curva termina exactamente en la plata que hay. Solo tiene sentido en
    // el mes en curso: para meses cerrados no guardamos el saldo histórico, y ahí
    // el gráfico sigue siendo flujo acumulado (etiquetado como tal).
    const esMesEnCurso = periodo === hoy.substring(0, 7);
    const anclado = esMesEnCurso && (saldosCuentas?.length ?? 0) > 0;
    const flujoDelMes = ingresos.total - egresos.total;
    const apertura = anclado ? liquidez.total - flujoDelMes : 0;

    let acum = apertura;
    const data = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, vals]) => {
        acum += vals.ingresos - vals.egresos;
        return { fecha: fecha.substring(8), saldo: acum };
      });
    return { data, anclado };
  }, [
    cierresFiltrados,
    movimientosClasificados,
    pagosMPFiltrados,
    pagosFiltrados,
    sueldosFiltrados,
    divsFiltrados,
    periodo,
    hoy,
    saldosCuentas,
    liquidez.total,
    ingresos.total,
    egresos.total,
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
          {(() => {
            const min = ultimaSyncMP
              ? Math.floor((Date.now() - new Date(ultimaSyncMP).getTime()) / 60_000)
              : null;
            // Verde si es de hoy (<24h), ámbar si es más viejo o nunca
            const reciente = min !== null && min < 24 * 60;
            return (
              <span
                className={cn(
                  'flex items-center gap-1 text-[11px] font-medium',
                  reciente ? 'text-green-700' : 'text-amber-700',
                )}
                title={
                  ultimaSyncMP
                    ? `Última sincronización MP: ${new Date(ultimaSyncMP).toLocaleString('es-AR')}`
                    : 'Sin pagos MP sincronizados en este período'
                }
              >
                {reciente ? '✅' : '⚠️'} Sync {tiempoRelativoSync(ultimaSyncMP ?? null)}
              </span>
            );
          })()}
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

      {/* ═══ NIVEL 1 — LA PREGUNTA: ¿cuánta plata hay? ═══
          Va sola y grande. Antes competía con otras 11 tarjetas del mismo tamaño,
          así que el dato que decide (liquidez) pesaba igual que "Dividendos/Ingreso". */}
      <div className="rounded-lg border border-surface-border bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Liquidez libre
              </span>
              {liquidez.desactualizada && (
                <span
                  className="text-[10px] font-medium text-amber-700"
                  title={
                    liquidez.faltanCuentas.length
                      ? `Sin saldo de: ${liquidez.faltanCuentas.join(', ')}`
                      : `El saldo más viejo es del ${formatFecha(liquidez.fechaMasVieja ?? '')}`
                  }
                >
                  ⚠️ saldos desactualizados
                </span>
              )}
            </div>
            <p
              className={cn(
                'mt-1 text-3xl font-bold tabular-nums',
                liquidez.libre >= 0 ? 'text-gray-900' : 'text-red-600',
              )}
            >
              {formatARS(liquidez.libre)}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Disponible después de honrar cheques y tarjeta ya emitidos
            </p>
          </div>
          <div className="text-right">
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Días de caja
            </span>
            <p
              className={cn(
                'text-2xl font-bold tabular-nums',
                kpis.diasCaja >= 30
                  ? 'text-green-600'
                  : kpis.diasCaja >= 15
                    ? 'text-amber-600'
                    : 'text-red-600',
              )}
            >
              {kpis.diasCaja > 0 ? `${kpis.diasCaja.toFixed(0)} días` : '—'}
            </p>
            <p className="text-[10px] text-gray-400">al ritmo de gasto actual</p>
          </div>
        </div>

        {/* De dónde sale el número y qué tan fresco es cada pedazo */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-[11px]">
          {(['galicia', 'icbc', 'mercadopago'] as const).map((c) => {
            const s = liquidez.porCuenta.get(c);
            const nombre = c === 'mercadopago' ? 'MercadoPago' : c === 'icbc' ? 'ICBC' : 'Galicia';
            if (!s) {
              return (
                <span key={c} className="text-amber-700">
                  {nombre}: <strong>sin saldo</strong>
                </span>
              );
            }
            return (
              <span key={c} className="text-gray-600">
                {nombre}:{' '}
                <strong className={s.saldo < 0 ? 'text-red-600' : 'text-gray-800'}>
                  {formatARS(s.saldo)}
                </strong>
                <span className="ml-1 text-gray-400">
                  ({s.fuente} · {formatFecha(s.fecha)})
                </span>
              </span>
            );
          })}
          <span className="text-gray-600">
            Efectivo: <strong className="text-gray-800">{formatARS(liquidez.efectivo)}</strong>
            <span className="ml-1 text-gray-400">(caja chica + caja fuerte)</span>
          </span>
          {comprometido.total > 0 && (
            <button
              onClick={() => setComprometidoOpen(!comprometidoOpen)}
              className="text-gray-600 underline decoration-dotted underline-offset-2 hover:text-gray-900"
            >
              Comprometido:{' '}
              <strong className="text-red-600">− {formatARS(comprometido.total)}</strong>
              <span className="ml-1 text-gray-400">
                ({comprometido.items.length} pago{comprometido.items.length !== 1 ? 's' : ''})
              </span>
            </button>
          )}
        </div>

        {/* MercadoPago no se puede automatizar: la API rechaza el pedido de balance
            (403 — el access token no tiene ese scope) y el export tampoco trae saldo.
            Es la cuenta principal de salida, así que sin este dato la liquidez no
            cierra. Se carga a mano; el sync sigue intentando y lo pisa si algún día
            se habilita el permiso. */}
        {!liquidez.porCuenta.has('mercadopago') && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px]">
            <span className="text-amber-800">
              Falta el saldo de MercadoPago (la API no lo expone). Copialo de la app y pegalo acá:
            </span>
            <input
              value={saldoMPInput}
              onChange={(e) => setSaldoMPInput(e.target.value)}
              placeholder="1.234.567,89"
              className="w-32 rounded border border-amber-300 px-2 py-1 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            <button
              onClick={() => guardarSaldoMP.mutate()}
              disabled={!saldoMPInput.trim() || guardarSaldoMP.isPending}
              className="rounded bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-40"
            >
              {guardarSaldoMP.isPending ? 'Guardando…' : 'Guardar'}
            </button>
            {guardarSaldoMP.isError && (
              <span className="text-red-600">{(guardarSaldoMP.error as Error).message}</span>
            )}
          </div>
        )}
      </div>

      {/* ═══ NIVEL 2 — el mes ═══ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPILiquidez
          label="Ingresos del mes"
          value={formatARS(ingresos.total)}
          desc="Ventas cobradas (efectivo + MercadoPago)"
          color="neutral"
        />
        <KPILiquidez
          label="Egresos del mes"
          value={formatARS(egresos.total)}
          desc="Plata que ya salió (no incluye lo comprometido)"
          color="neutral"
        />
        <KPILiquidez
          label="Saldo del período"
          value={formatARS(kpis.saldoNeto)}
          desc="Ingresos − Egresos del mes (no es la plata que hay)"
          color={kpis.saldoNeto >= 0 ? 'green' : 'red'}
        />
        <KPILiquidez
          label="Burn rate diario"
          value={formatARS(kpis.burnRate)}
          desc="Egresos / días transcurridos del mes"
          color="neutral"
        />
      </div>

      {/* ═══ NIVEL 3 — el resto, a un clic ═══
          Son ratios de gestión, no de caja: se consultan, no se vigilan. Tenerlos
          siempre a la vista hacía que el número que importa se perdiera entre ellos. */}
      <div>
        <button
          onClick={() => setMasIndicadoresOpen(!masIndicadoresOpen)}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
        >
          <span className={cn('transition-transform', masIndicadoresOpen && 'rotate-90')}>▸</span>
          {masIndicadoresOpen ? 'Ocultar indicadores' : 'Ver más indicadores'}
        </button>
        {masIndicadoresOpen && (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
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
          </div>
        )}
      </div>

      {/* El arqueo es una alerta, no un KPI: si no hay desvío no hay nada que mirar.
          Antes ocupaba una tarjeta fija mostrando "$0 / 0,00%" en verde. */}
      {kpis.hayArqueo && Math.abs(kpis.difArqueo) > 0 && (
        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          <span>⚠️</span>
          <span>
            Diferencia de arqueo: <strong>{formatARS(kpis.difArqueo)}</strong> (
            {kpis.difArqueoPct.toFixed(2)}% de desvío vs lo esperado en los cierres de caja)
          </span>
        </div>
      )}

      {/* Gráfico evolución diaria */}
      {chartData.data.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">
            {chartData.anclado
              ? `Evolución del saldo de caja — ${periodo}`
              : `Flujo acumulado del mes — ${periodo}`}
            {!chartData.anclado && (
              <span className="ml-2 font-normal text-[10px] text-gray-400">
                arranca en cero — no hay saldo de apertura para este período
              </span>
            )}
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData.data}>
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
            label={`Ventas digitales — MercadoPago (${ingresos.cantVentasMP} pagos)`}
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

      {/* ═══ COMPROMETIDO ═══
          Plata que ya tiene fecha y dueño pero todavía está en la cuenta. Antes se
          restaba como si hubiera salido y hundía el saldo del mes en curso. */}
      {comprometido.items.length > 0 && (
        <SeccionExpandible
          titulo="COMPROMETIDO (todavía no salió)"
          total={-comprometido.total}
          open={comprometidoOpen}
          onToggle={() => setComprometidoOpen(!comprometidoOpen)}
          color="blue"
        >
          <div className="p-4">
            <p className="mb-3 text-[10px] text-gray-500">
              Cheques, echeq y consumos de tarjeta con fecha de débito futura. La plata sigue en la
              cuenta: no son egresos del mes, pero se descuentan de la liquidez libre.
            </p>
            <div className="overflow-hidden rounded-lg bg-gray-50">
              <table className="w-full text-xs">
                <tbody>
                  {comprometido.items.map((i) => (
                    <tr key={i.id} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-500">
                        {formatFecha(i.fecha)}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-1.5 text-gray-700">
                        {i.proveedor}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500">{i.categoria ?? '—'}</td>
                      <td className="px-3 py-1.5 text-gray-500">{i.medio}</td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-700">
                        {formatARS(i.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SeccionExpandible>
      )}

      {/* ═══ NO OPERATIVO ═══ */}
      {(noOperativo.transferenciasInternas.length > 0 ||
        noOperativo.capital.length > 0 ||
        ingresosMPNoVenta.total > 0) && (
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

            {/* Plata que entró a MercadoPago y NO es una venta. Antes se sumaba como
                "Ventas digitales" e inflaba el ingreso ($22,4M en julio-2026). */}
            {ingresosMPNoVenta.total > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold text-gray-700">
                  Entradas a MercadoPago que no son ventas
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-blue-50 p-2.5 text-center">
                    <p className="text-[10px] text-gray-500">
                      Cuenta comitente (InvertirOnline) — {ingresosMPNoVenta.capital.length} mov.
                    </p>
                    <p className="text-base font-bold text-blue-700">
                      {formatARS(ingresosMPNoVenta.totalCapital)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-blue-50 p-2.5 text-center">
                    <p className="text-[10px] text-gray-500">
                      Transferencias de cuentas propias — {ingresosMPNoVenta.propias.length} mov.
                    </p>
                    <p className="text-base font-bold text-blue-700">
                      {formatARS(ingresosMPNoVenta.totalPropias)}
                    </p>
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-gray-400">
                  No pasaron por el POS (sin caja asignada). Se excluyen de "Ventas digitales" para
                  no inflar el ingreso ni el ticket promedio.
                </p>
              </div>
            )}

            {/* Transferencias internas */}
            {noOperativo.transferenciasInternas.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold text-gray-700">
                  Transferencias entre cuentas propias
                </h4>
                <div className="overflow-hidden rounded-lg bg-gray-50">
                  <table className="w-full text-xs">
                    <tbody>
                      {noOperativo.transferenciasInternas.map((m) => {
                        // Ahora se listan las dos patas: la salida (débito) y la
                        // entrada (crédito). Antes solo se veían los créditos y los
                        // débitos se colaban como egreso del negocio.
                        const esSalida = Number(m.debito) > 0;
                        const monto = esSalida ? Number(m.debito) : Number(m.credito);
                        const cuentaLabel =
                          m.cuenta === 'galicia'
                            ? 'Galicia'
                            : m.cuenta === 'icbc'
                              ? 'ICBC'
                              : 'MercadoPago';
                        return (
                          <tr key={m.id} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 text-gray-500">{formatFecha(m.fecha)}</td>
                            <td className="px-3 py-1.5 text-gray-600">
                              {esSalida ? `↑ sale de ${cuentaLabel}` : `↓ entra a ${cuentaLabel}`}
                            </td>
                            <td className="max-w-[200px] truncate px-3 py-1.5 text-gray-500">
                              {m.descripcion}
                            </td>
                            <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-700">
                              {formatARS(monto)}
                            </td>
                          </tr>
                        );
                      })}
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
              const activo = filtroSocio === s;
              return (
                <button
                  key={s}
                  onClick={() => setFiltroSocio(activo ? null : s)}
                  className={cn(
                    'rounded-lg p-3 text-center transition-colors',
                    activo
                      ? 'bg-blue-100 ring-2 ring-blue-400'
                      : 'bg-gray-50 hover:bg-gray-100',
                  )}
                  title={activo ? 'Quitar filtro' : `Ver solo ${SOCIO_LABEL[s]}`}
                >
                  <p className="mb-1 text-xs text-gray-500">{SOCIO_LABEL[s]}</p>
                  <p className="text-lg font-bold text-gray-900">{formatARS(total)}</p>
                </button>
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

          {filtroSocio && (
            <p className="mt-3 text-xs text-gray-500">
              Mostrando solo <span className="font-medium text-gray-700">{SOCIO_LABEL[filtroSocio]}</span> ·{' '}
              <button
                onClick={() => setFiltroSocio(null)}
                className="text-blue-600 underline hover:text-blue-800"
              >
                quitar filtro
              </button>
            </p>
          )}

          {filasDividendos.length > 0 && (
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
                {filasDividendos.map((d) => (
                  <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600">{formatFecha(d.fecha)}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      <button
                        onClick={() =>
                          setFiltroSocio(filtroSocio === d.socio ? null : d.socio)
                        }
                        className="hover:text-blue-700 hover:underline"
                        title={
                          filtroSocio === d.socio ? 'Quitar filtro' : `Ver solo ${SOCIO_LABEL[d.socio] ?? d.socio}`
                        }
                      >
                        {SOCIO_LABEL[d.socio] ?? d.socio}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {MEDIOS_PAGO_DIV.find((m) => m.value === d.medio_pago)?.label ?? d.medio_pago}
                    </td>
                    <td className="px-3 py-2 text-gray-500">
                      {d._agg ? (
                        <span className="italic text-gray-400">{d.concepto}</span>
                      ) : (
                        d.concepto || '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-red-700">
                      {formatARS(Number(d.monto))}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {!d._agg && (
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
                      )}
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
    sas: 'Empresa',
    ambos: 'Empresa',
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
