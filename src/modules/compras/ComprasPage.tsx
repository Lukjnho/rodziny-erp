import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PageContainer } from '@/components/layout/PageContainer';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { formatARS, cn } from '@/lib/utils';
import { parseDecimal, normalizarDecimal, equivalenteKgGramos } from '@/lib/numero';
import {
  parseFudoGastos,
  type DetalleRow,
  type GastoRow,
} from '@/modules/finanzas/parsers/parseFudoGastos';
import { type PrefillGasto } from '@/modules/gastos/NuevoGastoModal';
import NuevoGastoForm from '@/modules/gastos/NuevoGastoForm';
import { ProveedoresPanel } from '@/modules/gastos/ProveedoresPanel';
import { ListadoGastos, type ResumenListadoGastos } from '@/modules/gastos/ListadoGastos';
import {
  useProveedoresMap,
  nombreProveedor,
  proveedorSearchSpace as proveedorSearchSpaceShared,
} from '@/modules/gastos/proveedorDisplay';
import { ExtractosAlerta } from '@/modules/finanzas/components/ExtractosAlerta';
import { CierreInventarioBanner } from './components/CierreInventarioBanner';
import { CierreInventarioModal } from './components/CierreInventarioModal';
import { PastasTerminadasPanel } from './components/PastasTerminadasPanel';
import { CalendarioPagosCtaCte } from './components/CalendarioPagosCtaCte';
import { ConciliacionTab } from './ConciliacionTab';
import type { MedioPago, Gasto } from '@/modules/gastos/types';
import { MEDIO_PAGO_LABEL, medioRequiereComprobante } from '@/modules/gastos/types';
import { PagarGastoModal } from '@/modules/gastos/PagarGastoModal';

type Tab = 'gastos' | 'stock' | 'movimientos' | 'recepcion' | 'pagos' | 'proveedores' | 'conciliacion';
type FiltroEstado = 'todos' | 'bajo_minimo' | 'sin_stock' | 'inactivos';

interface Producto {
  id: string;
  nombre: string;
  marca: string | null;
  categoria: string;
  unidad: string;
  stock_actual: number;
  stock_minimo: number;
  proveedor: string;
  costo_unitario: number;
  contenido_ml: number | null;
  activo: boolean;
  local: string;
}

interface Movimiento {
  id: string;
  producto_id: string | null;
  producto_nombre: string;
  tipo: string;
  cantidad: number;
  unidad: string;
  motivo: string;
  observacion: string | null;
  registrado_por: string | null;
  created_at: string;
}

// ── Panel de ayuda contextual ────────────────────────────────────────────────
const ayudaPorTab: Record<Tab, { titulo: string; pasos: string[] }> = {
  gastos: {
    titulo: 'Gastos',
    pasos: [
      'Acá se cargan todos los gastos del negocio: compras a proveedores, servicios, alquiler, sueldos, etc.',
      'Hacé clic en "+ Nuevo gasto" para cargar un comprobante.',
      'Completá proveedor, categoría, importes y adjuntá el comprobante (PDF o foto).',
      'Si el gasto ya se pagó, marcalo como "Pagado" y elegí fecha + medio de pago.',
      'Si todavía no se pagó, dejalo como "Pendiente" y después usá el botón "Pagar" del listado.',
    ],
  },
  stock: {
    titulo: 'Stock actual',
    pasos: [
      'Acá ves todos los productos cargados y su stock actual.',
      'Usá los filtros arriba para buscar por nombre, proveedor o categoría.',
      'Hacé clic en los KPIs de colores para filtrar rápido (bajo mínimo, sin stock, etc.).',
      'Para cambiar el stock mínimo de un producto, hacé clic en el número de la columna "Mín." y escribí el nuevo valor.',
    ],
  },
  movimientos: {
    titulo: 'Historial de movimientos',
    pasos: [
      'Acá se registran todas las entradas y salidas de mercadería.',
      'Cada vez que confirmás una recepción, se crean movimientos de entrada automáticamente.',
      'Podés ver quién registró cada movimiento, la fecha y el motivo.',
    ],
  },
  recepcion: {
    titulo: 'Recepción de mercadería',
    pasos: [
      'Paso 1: Exportá el archivo de GASTOS desde Fudo (no el de ventas).',
      'Paso 2: Seleccioná el local correcto arriba a la izquierda.',
      'Paso 3: Arrastrá el archivo o hacé clic para seleccionarlo.',
      'El sistema lee la hoja "Detalle" y cruza cada item con tus productos.',
      'Paso 4: Revisá los matches — los verdes son automáticos, los amarillos necesitan que elijas el producto correcto del desplegable.',
      'Paso 5: Tildá los items que querés confirmar y hacé clic en "Confirmar recepción".',
      'Esto actualiza el stock Y guarda los gastos para el tab de Pagos.',
    ],
  },
  conciliacion: {
    titulo: 'Conciliación de extractos',
    pasos: [
      'Compara los movimientos del extracto bancario (Galicia, ICBC, MercadoPago) con los gastos cargados.',
      'Vista 1 — Auto-match: vincula gastos manuales con su movimiento del extracto cuando coinciden por N° de operación.',
      'Vista 2 — Cargos automáticos: genera gastos de "Impuestos y comisiones bancarias" (Rodziny S.A.S.) para impuestos Ley 25.413, comisiones MP, IVA bancario, etc.',
      'Vista 3 — Sin conciliar: muestra los egresos del extracto que no matchean por N° op ni son cargos automáticos. Cargalos a mano desde Gastos.',
      'Recomendado: ejecutar "Conciliar ahora" después de cada carga de gastos nuevos, y "Crear cargos automáticos" una vez por mes.',
    ],
  },
  pagos: {
    titulo: 'Pagos a proveedores',
    pasos: [
      'Arriba ves el resumen mensual: total comprado, pagado y lo que resta. Cambiá el mes con el selector.',
      'Los colores indican el estado: 🔴 Vencido — 🟠 Vence esta semana — 🔵 A pagar — 🟢 Pagado.',
      'Hacé clic en los KPIs de estado para filtrar rápido.',
      'Cuando pagues a un proveedor, hacé clic en "Marcar pagado" en esa fila.',
      'Los gastos se cargan automáticamente cuando subís un export en Recepción.',
      'Los que aparecen "Sin fecha" son gastos viejos — marcalos como pagados si ya se pagaron.',
    ],
  },
  proveedores: {
    titulo: 'Proveedores',
    pasos: [
      'Listado completo de proveedores con datos fiscales (CUIT, condición IVA, contacto).',
      'Usá "+ Nuevo proveedor" para crear uno desde cero.',
      'El botón "📥 Importar desde histórico" rastrea los gastos viejos y crea los proveedores que falten.',
      'Cada proveedor tiene categoría y medio de pago default — eso se autocompleta al cargar un gasto suyo.',
      'Activá/desactivá un proveedor con el toggle. Los inactivos no aparecen en el modal de Nuevo gasto.',
    ],
  },
};

function AyudaPanel({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const info = ayudaPorTab[tab];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4" onClick={onClose}>
      <div
        className="animate-in slide-in-from-right mr-2 mt-16 w-80 rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h4 className="text-sm font-semibold text-gray-900">{info.titulo}</h4>
          <button
            onClick={onClose}
            className="text-lg leading-none text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>
        <ol className="space-y-2 px-4 py-3">
          {info.pasos.map((paso, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-gray-600">
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-rodziny-100 text-[10px] font-bold text-rodziny-700">
                {i + 1}
              </span>
              <span>{paso}</span>
            </li>
          ))}
        </ol>
        <div className="border-t border-gray-100 px-4 py-2">
          <p className="text-[10px] text-gray-400">Dudas → consultá a Lucas o administración</p>
        </div>
      </div>
    </div>
  );
}

const TAB_IDS: Tab[] = [
  'gastos',
  'stock',
  'movimientos',
  'recepcion',
  'pagos',
  'proveedores',
  'conciliacion',
];

export function ComprasPage() {
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia');
  // Tab activo sincronizado con ?tab=... para linkear desde las alertas del Dashboard.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as Tab | null;
  const tab: Tab = tabFromUrl && TAB_IDS.includes(tabFromUrl) ? tabFromUrl : 'gastos';
  const setTab = (nuevo: Tab) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', nuevo);
    setSearchParams(sp, { replace: true });
  };
  // Período del listado de gastos (mes en formato YYYY-MM). Default: mes actual.
  const [gastosPeriodo, setGastosPeriodo] = useState(() =>
    new Date().toISOString().substring(0, 7),
  );
  // Filtro de local específico para el tab Gastos. Se inicializa en "empresa"
  // (todos los locales) y se sincroniza con el LocalSelector global: cuando
  // cambiás el global a Vedia/Saavedra, este filtro se mueve también. El
  // listado interno acepta el modelo legacy ('ambos'), así que mapeamos
  // 'empresa' → 'ambos' al pasarlo (ambos = no filtra por local).
  type GastosLocal = 'vedia' | 'saavedra' | 'empresa';
  const [gastosLocal, setGastosLocal] = useState<GastosLocal>('empresa');
  // Sincronizar con el selector global: si cambiás arriba, se replica acá.
  // Si querés ver "Empresa" tenés que clickearlo manualmente en el filtro
  // del listado (no hay equivalente en el global).
  useEffect(() => {
    setGastosLocal(local);
  }, [local]);
  const { gastosDesde, gastosHasta } = useMemo(() => {
    const [y, m] = gastosPeriodo.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return {
      gastosDesde: `${gastosPeriodo}-01`,
      gastosHasta: `${gastosPeriodo}-${String(last).padStart(2, '0')}`,
    };
  }, [gastosPeriodo]);

  // KPIs del listado de gastos. Los alimenta ListadoGastos vía onResumen con los
  // agregados YA filtrados (categoría, proveedor, medio, estado, búsqueda), así las
  // tarjetas reflejan exactamente lo que se ve en la tabla y no el total del período.
  const [gastosKpis, setGastosKpis] = useState<ResumenListadoGastos | null>(null);

  // Filtro de fechas para historial de movimientos (default: últimos 30 días)
  const [movDesde, setMovDesde] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [movHasta, setMovHasta] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos');
  const [editandoMin, setEditandoMin] = useState<string | null>(null); // producto id
  const [valorMin, setValorMin] = useState('');
  const qc = useQueryClient();

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: productos, isLoading } = useQuery({
    queryKey: ['productos_stock', local],
    queryFn: async () => {
      const { data } = await supabase
        .from('productos')
        .select('*')
        .eq('local', local)
        .order('categoria')
        .order('nombre');
      return (data ?? []) as Producto[];
    },
  });

  const { data: movimientos } = useQuery({
    queryKey: ['movimientos_stock', local, movDesde, movHasta],
    queryFn: async () => {
      const { data } = await supabase
        .from('movimientos_stock')
        .select('*')
        .eq('local', local)
        .gte('created_at', `${movDesde}T00:00:00`)
        .lte('created_at', `${movHasta}T23:59:59`)
        .order('created_at', { ascending: false })
        .limit(2000);
      return (data ?? []) as Movimiento[];
    },
    enabled: tab === 'movimientos',
  });

  const { data: gastosPagos } = useQuery({
    queryKey: ['gastos_pagos', local],
    queryFn: async () => {
      // Ordenamos por venc ASC con nulls al final (los pendientes urgentes
      // arriba), y como tie-breaker created_at DESC para que entre los gastos
      // sin venc los más recientes aparezcan primero. Subimos el limit a 1500
      // para evitar que pendientes recientes queden truncados (Vedia tiene
      // ~700 gastos activos al cierre de mes).
      const { data } = await supabase
        .from('gastos')
        .select('*')
        .eq('local', local)
        .eq('cancelado', false)
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1500);
      // Excluir pagos fijos del tab Pagos. Esos tienen su propio flujo en
      // Finanzas > Pagos Fijos y aparecen acá como ruido. Se identifican
      // por el prefijo "Pago fijo:" que pone el checklist al generarlos.
      return ((data ?? []) as Gasto[]).filter(
        (g) => !(g.comentario ?? '').startsWith('Pago fijo:'),
      );
    },
    enabled: tab === 'pagos',
  });

  interface PagoGastoRow {
    id: string;
    gasto_id: string;
    fecha_pago: string;
    monto: number;
    medio_pago: string;
    created_at: string;
  }

  // Query independiente: trae TODOS los pagos cuyos gastos son del local,
  // sin depender de la lista de gastosPagos (que tenía un problema de
  // sincronización entre dos queries que dejaba pagosGastosMap vacío y por
  // eso el KPI "Pagado" salía siempre en $0). Usa PostgREST embedding con
  // !inner para forzar el filtro por local del gasto.
  const { data: pagosGastosData } = useQuery({
    queryKey: ['pagos_gastos_compras', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pagos_gastos')
        .select(
          'id, gasto_id, fecha_pago, monto, medio_pago, created_at, gasto:gastos!inner(local, cancelado)',
        )
        .eq('gasto.local', local)
        .eq('gasto.cancelado', false)
        .limit(5000);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id as string,
        gasto_id: p.gasto_id as string,
        fecha_pago: p.fecha_pago as string,
        monto: Number(p.monto),
        medio_pago: p.medio_pago as string,
        created_at: p.created_at as string,
      })) as PagoGastoRow[];
    },
    enabled: tab === 'pagos',
  });

  // Map gasto_id → pago más reciente (por fecha_pago).
  // Se usa para mostrar la fecha/medio del último pago y para filtrar
  // el listado "Pagados" por el mes en que efectivamente salió la plata.
  const pagosGastosMap = useMemo(() => {
    const m = new Map<string, PagoGastoRow>();
    for (const p of pagosGastosData ?? []) {
      const previo = m.get(p.gasto_id);
      if (!previo || p.fecha_pago > previo.fecha_pago) m.set(p.gasto_id, p);
    }
    return m;
  }, [pagosGastosData]);

  // Mapa proveedor_id → display canónico + espacio de búsqueda (hook compartido).
  // Agrupa "FRESH", "FRESH Dist." y "MACLAR SRL" en una sola fila "FRESH Distribuidora"
  // cuando comparten proveedor_id.
  const { data: proveedoresMap } = useProveedoresMap({ enabled: tab === 'pagos' });

  // Nombre canónico (string) del proveedor — para agrupar/filtrar.
  function proveedorDisplay(g: Gasto): string {
    return nombreProveedor(g, proveedoresMap);
  }

  // Espacio de búsqueda: texto crudo + razón + comercial + aliases del maestro.
  function proveedorSearchSpace(g: Gasto): string {
    return proveedorSearchSpaceShared(g, proveedoresMap);
  }

  interface ItemRecepcion {
    producto_id: string;
    producto_nombre: string;
    cantidad: number;
    unidad: string;
  }
  interface RecepcionPendiente {
    id: string;
    local: string;
    proveedor: string | null;
    items: ItemRecepcion[];
    registrado_por: string | null;
    notas: string | null;
    estado: string;
    created_at: string;
    foto_path: string | null;
  }

  async function verFotoRecepcion(path: string) {
    const { data, error } = await supabase.storage
      .from('recepciones-fotos')
      .createSignedUrl(path, 60);
    if (error || !data) {
      window.alert(`Error: ${error?.message ?? 'sin URL'}`);
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  const { data: recepcionesPendientes } = useQuery({
    queryKey: ['recepciones_pendientes', local],
    queryFn: async () => {
      const { data } = await supabase
        .from('recepciones_pendientes')
        .select('*')
        .eq('local', local)
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false });
      return (data ?? []) as RecepcionPendiente[];
    },
  });

  // Prefill del gasto cuando se entra por "Cargar gasto" de un remito pendiente.
  const [prefillGasto, setPrefillGasto] = useState<PrefillGasto | undefined>(undefined);

  // Pantalla nueva: Nuevo gasto con OCR (flujo simple, mobile-first)
  const [nuevoGastoFormOpen, setNuevoGastoFormOpen] = useState(false);

  // Modal único de pago — delegado a PagarGastoModal (canónico)
  const [gastoAPagar, setGastoAPagar] = useState<Gasto | null>(null);

  // Modal del cierre de inventario (botón en tab Stock — Martín lo dispara)
  const [cierreInventarioModalAbierto, setCierreInventarioModalAbierto] = useState(false);

  function abrirModalPagoCompra(g: Gasto) {
    setGastoAPagar(g);
  }

  // Click en un proveedor del calendario consolidado → saltar a su fila en la
  // lista de abajo: cambia de local si hace falta, filtra por el proveedor y lo
  // marca como objetivo (la lista lo auto-expande y resalta; el scroll lo hace
  // un effect cuando la fila ya existe en el DOM tras el refetch del local).
  function irAProveedor(proveedor: string, localProv: 'vedia' | 'saavedra' | 'sas') {
    if ((localProv === 'vedia' || localProv === 'saavedra') && localProv !== local) {
      setLocal(localProv);
    }
    setFiltroProveedor(proveedor);
    setProveedorObjetivo(proveedor.toLowerCase());
    scrollObjetivoPendiente.current = true;
  }

  function abrirGastoDesdeRecepcion(r: RecepcionPendiente) {
    setPrefillGasto({
      recepcion_id: r.id,
      local: r.local as 'vedia' | 'saavedra',
      proveedor_nombre: r.proveedor,
      comprobante_path: r.foto_path,
      items: r.items.map((it) => ({
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre,
        cantidad: it.cantidad,
        unidad: it.unidad,
      })),
      comentario: r.notas
        ? `Recepción del ${new Date(r.created_at).toLocaleDateString('es-AR')} · ${r.notas}`
        : null,
    });
    // Abre el chooser (Gasto digital / Efectivo / Cuenta corriente / Plan de pagos)
    // con los datos del remito ya cargados, en vez del modal de Factura A directo.
    setNuevoGastoFormOpen(true);
  }

  async function descartarRecepcion(id: string) {
    if (!window.confirm('¿Descartar esta recepción? El stock NO se revierte automáticamente.'))
      return;
    const { error } = await supabase
      .from('recepciones_pendientes')
      .update({
        estado: 'descartada',
        validada_en: new Date().toISOString(),
        validada_por: 'Martín',
      })
      .eq('id', id);
    if (error) {
      window.alert(`Error: ${error.message}`);
      return;
    }
    qc.invalidateQueries({ queryKey: ['recepciones_pendientes'] });
  }

  // Modo conteo de inventario
  const [modoConteo, setModoConteo] = useState(false);
  const [conteos, setConteos] = useState<Record<string, string>>({}); // producto_id → valor ingresado
  const [conteoResponsable, setConteoResponsable] = useState('');
  const [conteoGuardando, setConteoGuardando] = useState(false);
  const [conteoResultado, setConteoResultado] = useState<string | null>(null);
  const [filtroConteo, setFiltroConteo] = useState('');
  const [filtroCatConteo, setFiltroCatConteo] = useState('todas');

  // Modal ajuste individual (legacy)
  const [modalAjuste, setModalAjuste] = useState(false);

  // Modal crear/editar producto
  const [productoModal, setProductoModal] = useState<Producto | 'nuevo' | null>(null);

  // Modal fusión de productos duplicados
  const [fusionando, setFusionando] = useState<Producto | null>(null);

  // El calendario consolidado de arriba ya ordena qué pagar y cuándo, así que la
  // lista de proveedores se muestra siempre completa (todos los pendientes). Se
  // mantiene la unión de tipos por compatibilidad con el resto de los useMemo.
  const [filtroPagos] = useState<
    'todos' | 'pendientes' | 'pagados' | 'vencidos' | 'hoy' | 'semana'
  >('todos');
  const [filtroProveedor, setFiltroProveedor] = useState('');
  // Proveedor al que se "saltó" desde el calendario: se resalta y auto-expande en
  // la lista. scrollObjetivoPendiente difiere el scroll hasta que el cambio de
  // local refetchee y la fila exista en el DOM.
  const [proveedorObjetivo, setProveedorObjetivo] = useState<string | null>(null);
  const scrollObjetivoPendiente = useRef(false);

  // Vista agrupada por proveedor: selección de gastos para pago bulk
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [proveedoresExpandidos, setProveedoresExpandidos] = useState<Set<string>>(new Set());
  // Sección colapsable de proveedores que solo tienen pagos del mes (saldo $0).
  const [pagadosExpandido, setPagadosExpandido] = useState(false);

  // Modal de pago bulk
  const [bulkPagoOpen, setBulkPagoOpen] = useState(false);
  const [bulkFecha, setBulkFecha] = useState(() => new Date().toISOString().split('T')[0]);
  const [bulkMedio, setBulkMedio] = useState<MedioPago>('efectivo');
  const [bulkReferencia, setBulkReferencia] = useState('');
  const [bulkNotas, setBulkNotas] = useState('');
  const [bulkComprobante, setBulkComprobante] = useState<File | null>(null);
  const [bulkFactura, setBulkFactura] = useState<File | null>(null);
  const [bulkGuardando, setBulkGuardando] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Mes seleccionado para el resumen (default: mes actual)
  const [mesPagos, setMesPagos] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Lista única de proveedores para el dropdown
  const proveedoresPagos = useMemo(() => {
    const todos = gastosPagos ?? [];
    const unicos = [
      ...new Set(todos.map((g) => g.proveedor).filter((p): p is string => !!p)),
    ].sort();
    return unicos;
  }, [gastosPagos]);

  const pagosFiltrados = useMemo(() => {
    const hoy = new Date().toISOString().split('T')[0];
    const en7dias = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    let lista = gastosPagos ?? [];

    // Filtro por proveedor
    if (filtroProveedor) {
      const fp = filtroProveedor
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      lista = lista.filter((g) =>
        g.proveedor
          ?.toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .includes(fp),
      );
    }

    if (filtroPagos === 'pendientes')
      lista = lista.filter((g) => g.estado_pago?.toLowerCase() !== 'pagado');
    else if (filtroPagos === 'pagados') {
      // Filtrar por el mes en que efectivamente se pagó (fecha del pago real,
      // no la fecha del gasto), para que coincida con el flujo de caja.
      // Además se restringe a cuenta corriente: solo pagos donde el gasto se
      // registró antes y se pagó después (fecha_pago > fecha). Pagos fijos y
      // compras al contado del mismo día quedan fuera de este tab y solo
      // aparecen en el listado de gastos.
      lista = lista.filter((g) => {
        if (g.estado_pago?.toLowerCase() !== 'pagado') return false;
        const pago = pagosGastosMap.get(g.id);
        if (!pago) return false;
        if (pago.fecha_pago <= g.fecha) return false;
        return pago.fecha_pago.startsWith(mesPagos);
      });
      // Ordenar por fecha de pago descendente (último pago arriba); cuando
      // hay empate, usar created_at del pago como tiebreaker para reflejar
      // el orden real de carga.
      lista = [...lista].sort((a, b) => {
        const pa = pagosGastosMap.get(a.id);
        const pb = pagosGastosMap.get(b.id);
        const cmp = (pb?.fecha_pago ?? '').localeCompare(pa?.fecha_pago ?? '');
        if (cmp !== 0) return cmp;
        return (pb?.created_at ?? '').localeCompare(pa?.created_at ?? '');
      });
    } else if (filtroPagos === 'vencidos')
      lista = lista.filter(
        (g) =>
          g.estado_pago?.toLowerCase() !== 'pagado' &&
          g.fecha_vencimiento &&
          g.fecha_vencimiento < hoy,
      );
    else if (filtroPagos === 'hoy')
      // "Vence hoy" incluye atrasados: todo lo urgente que hay que pagar ya.
      lista = lista.filter(
        (g) =>
          g.estado_pago?.toLowerCase() !== 'pagado' &&
          g.fecha_vencimiento &&
          g.fecha_vencimiento <= hoy,
      );
    else if (filtroPagos === 'semana')
      lista = lista.filter(
        (g) =>
          g.estado_pago?.toLowerCase() !== 'pagado' &&
          g.fecha_vencimiento &&
          g.fecha_vencimiento >= hoy &&
          g.fecha_vencimiento <= en7dias,
      );

    return lista;
  }, [gastosPagos, filtroPagos, filtroProveedor, pagosGastosMap, mesPagos]);

  const [vistaResumenProv, setVistaResumenProv] = useState<'mes' | 'año'>('mes');

  // Resumen por proveedor filtrado (cuánto se le debe)
  const resumenProveedor = useMemo(() => {
    if (!filtroProveedor) return null;
    const fp = filtroProveedor
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    // Filtra usando todos los nombres del proveedor (raz\u00f3n social + comercial + aliases)
    // \u2014 as\u00ed "fresh", "maclar" y aliases devuelven los mismos gastos
    const todosDelProveedor = (gastosPagos ?? []).filter((g) =>
      proveedorSearchSpace(g)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .includes(fp),
    );

    // Filtro temporal según vista (mes o año del mesPagos seleccionado)
    const año = mesPagos.split('-')[0];
    const delProveedor =
      vistaResumenProv === 'mes'
        ? todosDelProveedor.filter((g) => g.fecha?.startsWith(mesPagos))
        : todosDelProveedor.filter((g) => g.fecha?.startsWith(año));

    // Pendiente: SIEMPRE total (lo que se debe no depende del período seleccionado)
    const pendientesTotal = todosDelProveedor.filter(
      (g) => g.estado_pago?.toLowerCase() !== 'pagado',
    );
    const pagados = delProveedor.filter((g) => g.estado_pago?.toLowerCase() === 'pagado');

    return {
      nombre: todosDelProveedor[0] ? proveedorDisplay(todosDelProveedor[0]) : filtroProveedor,
      totalCompras: delProveedor.reduce((s, g) => s + g.importe_total, 0),
      cantCompras: delProveedor.length,
      totalPendiente: pendientesTotal.reduce((s, g) => s + g.importe_total, 0),
      cantPendientes: pendientesTotal.length,
      totalPagado: pagados.reduce((s, g) => s + g.importe_total, 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gastosPagos, filtroProveedor, vistaResumenProv, mesPagos, proveedoresMap]);

  // Agrupación de PENDIENTES por proveedor para vista bulk.
  // También adjunta los gastos PAGADOS del mes seleccionado por proveedor,
  // así el expand muestra el historial reciente sin perderlos.
  const pendientesPorProveedor = useMemo(() => {
    const hoy = new Date().toISOString().split('T')[0];
    const en7dias = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    let lista = (gastosPagos ?? []).filter((g) => g.estado_pago?.toLowerCase() !== 'pagado');

    if (filtroPagos === 'vencidos') {
      lista = lista.filter((g) => g.fecha_vencimiento && g.fecha_vencimiento < hoy);
    } else if (filtroPagos === 'hoy') {
      lista = lista.filter((g) => g.fecha_vencimiento && g.fecha_vencimiento <= hoy);
    } else if (filtroPagos === 'semana') {
      lista = lista.filter(
        (g) =>
          g.fecha_vencimiento && g.fecha_vencimiento >= hoy && g.fecha_vencimiento <= en7dias,
      );
    }

    if (filtroProveedor) {
      const fp = filtroProveedor
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      // Buscar contra todos los nombres del proveedor (razón social + comercial + aliases)
      lista = lista.filter((g) =>
        proveedorSearchSpace(g)
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .includes(fp),
      );
    }

    // Agrupamos por el DISPLAY canónico del proveedor (nombre_comercial ?? razon_social)
    // cuando hay proveedor_id, para que "FRESH", "FRESH Dist." y "MACLAR SRL" caigan
    // en una sola fila "FRESH Distribuidora" si comparten el mismo registro maestro.

    // Pagados del mes seleccionado: por proveedor, filtrados por la fecha
    // del pago real (no la del gasto). Mismo criterio que el KPI Pagado.
    const pagadosMesPorProveedor = new Map<string, Gasto[]>();
    for (const g of gastosPagos ?? []) {
      if (g.estado_pago?.toLowerCase() !== 'pagado') continue;
      const pago = pagosGastosMap.get(g.id);
      if (!pago || !pago.fecha_pago.startsWith(mesPagos)) continue;
      const key = proveedorDisplay(g) || '(Sin proveedor)';
      if (!pagadosMesPorProveedor.has(key)) pagadosMesPorProveedor.set(key, []);
      pagadosMesPorProveedor.get(key)!.push(g);
    }

    const grupos = new Map<string, Gasto[]>();
    for (const g of lista) {
      const key = proveedorDisplay(g) || '(Sin proveedor)';
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key)!.push(g);
    }

    interface GrupoProveedor {
      proveedor: string;
      gastos: Gasto[];
      total: number;
      cantPendientes: number;
      cantVencidos: number;
      totalVencido: number;
      proxVenc: string | null;
      pagadosMes: Gasto[];
      cantPagadosMes: number;
      totalPagadoMes: number;
    }
    const grupoMain: GrupoProveedor[] = [...grupos.entries()].map(([proveedor, gastos]) => {
      const total = gastos.reduce((s, g) => s + g.importe_total, 0);
      const venc = gastos.filter(
        (g) => g.fecha_vencimiento && g.fecha_vencimiento < hoy,
      );
      const totalVencido = venc.reduce((s, g) => s + g.importe_total, 0);
      const proxVenc =
        gastos
          .map((g) => g.fecha_vencimiento)
          .filter((f): f is string => !!f)
          .sort()[0] ?? null;
      const sortedGastos = [...gastos].sort((a, b) => {
        const fa = a.fecha_vencimiento ?? '9999-99-99';
        const fb = b.fecha_vencimiento ?? '9999-99-99';
        return fa.localeCompare(fb);
      });
      const pagadosMes = (pagadosMesPorProveedor.get(proveedor) ?? []).sort((a, b) => {
        const pa = pagosGastosMap.get(a.id)?.fecha_pago ?? '';
        const pb = pagosGastosMap.get(b.id)?.fecha_pago ?? '';
        return pb.localeCompare(pa); // más recientes primero
      });
      const totalPagadoMes = pagadosMes.reduce((s, g) => s + g.importe_total, 0);
      // Una vez que usamos los pagados de este proveedor, los removemos del map
      // para que al final podamos saber qué proveedores SOLO tienen pagos y
      // no aparecen como pendientes (los agregamos como grupos extras).
      pagadosMesPorProveedor.delete(proveedor);
      return {
        proveedor,
        gastos: sortedGastos,
        total,
        cantPendientes: gastos.length,
        cantVencidos: venc.length,
        totalVencido,
        proxVenc,
        pagadosMes,
        cantPagadosMes: pagadosMes.length,
        totalPagadoMes,
      };
    });
    return grupoMain
      // Sumar los proveedores que SOLO tienen pagos del mes (no tienen pendientes)
      // como grupos sin gastos pendientes pero con historial visible.
      .concat(
        [...pagadosMesPorProveedor.entries()].map(([proveedor, pagados]) => {
          const sorted = [...pagados].sort((a, b) => {
            const pa = pagosGastosMap.get(a.id)?.fecha_pago ?? '';
            const pb = pagosGastosMap.get(b.id)?.fecha_pago ?? '';
            return pb.localeCompare(pa);
          });
          return {
            proveedor,
            gastos: [] as Gasto[],
            total: 0,
            cantPendientes: 0,
            cantVencidos: 0,
            totalVencido: 0,
            proxVenc: null as string | null,
            pagadosMes: sorted,
            cantPagadosMes: sorted.length,
            totalPagadoMes: sorted.reduce((s, g) => s + g.importe_total, 0),
          };
        }),
      )
      .sort((a, b) => {
        if (a.totalVencido !== b.totalVencido) return b.totalVencido - a.totalVencido;
        if (a.total !== b.total) return b.total - a.total;
        return b.totalPagadoMes - a.totalPagadoMes;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gastosPagos, filtroPagos, filtroProveedor, pagosGastosMap, mesPagos, proveedoresMap]);

  // Proveedores con deuda viva vs. los que solo tienen pagos del mes (saldo $0).
  // Estos últimos se colapsan en una sola sección "✓ Pagados en el mes" al final
  // para no inflar la lista con filas de saldo cero.
  const gruposPendientes = useMemo(
    () => pendientesPorProveedor.filter((g) => g.cantPendientes > 0),
    [pendientesPorProveedor],
  );
  const gruposSoloPagados = useMemo(
    () => pendientesPorProveedor.filter((g) => g.cantPendientes === 0),
    [pendientesPorProveedor],
  );
  const resumenSoloPagados = useMemo(
    () => ({
      cantPagos: gruposSoloPagados.reduce((s, g) => s + g.cantPagadosMes, 0),
      total: gruposSoloPagados.reduce((s, g) => s + g.totalPagadoMes, 0),
    }),
    [gruposSoloPagados],
  );

  // Scroll a la fila del proveedor objetivo cuando aparece (tras cambiar de local
  // el listado refetchea, por eso esperamos a que el nodo exista en vez de hacer
  // scroll inmediato). Una sola vez por salto (lo apaga el ref).
  useEffect(() => {
    if (!scrollObjetivoPendiente.current || !proveedorObjetivo) return;
    const el = document.getElementById('lista-pagos-objetivo');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrollObjetivoPendiente.current = false;
    }
  }, [proveedorObjetivo, local, gruposPendientes]);

  // Selección bulk: cálculos derivados
  const seleccionInfo = useMemo(() => {
    if (seleccionados.size === 0)
      return { gastos: [] as Gasto[], total: 0, proveedores: [] as string[] };
    const gastos = (gastosPagos ?? []).filter((g) => seleccionados.has(g.id));
    const total = gastos.reduce((s, g) => s + g.importe_total, 0);
    const proveedores = [...new Set(gastos.map((g) => proveedorDisplay(g) || '(Sin proveedor)'))];
    return { gastos, total, proveedores };
  }, [seleccionados, gastosPagos]);

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleProveedorExpandido(prov: string) {
    setProveedoresExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(prov)) next.delete(prov);
      else next.add(prov);
      return next;
    });
  }
  function toggleSeleccionarTodosProveedor(prov: string, gastos: Gasto[]) {
    const ids = gastos.map((g) => g.id);
    const todosSeleccionados = ids.every((id) => seleccionados.has(id));
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (todosSeleccionados) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
    if (!proveedoresExpandidos.has(prov))
      toggleProveedorExpandido(prov);
  }

  function abrirBulkPago() {
    if (seleccionInfo.gastos.length === 0) return;
    setBulkFecha(new Date().toISOString().split('T')[0]);
    setBulkMedio('efectivo');
    setBulkReferencia('');
    setBulkNotas('');
    setBulkComprobante(null);
    setBulkFactura(null);
    setBulkError(null);
    setBulkPagoOpen(true);
  }

  function cerrarBulkPago() {
    setBulkPagoOpen(false);
    setBulkComprobante(null);
    setBulkFactura(null);
    setBulkReferencia('');
    setBulkNotas('');
    setBulkError(null);
  }

  async function confirmarBulkPago() {
    if (seleccionInfo.gastos.length === 0) return;
    setBulkError(null);
    // Mismo criterio que el pago individual: si el medio no es efectivo,
    // exigimos referencia y comprobante para poder conciliar y respaldar.
    if (medioRequiereComprobante(bulkMedio)) {
      if (!bulkReferencia.trim()) {
        setBulkError(
          'N° de operación requerido para transferencias, cheques y tarjeta. Copialo del comprobante.',
        );
        return;
      }
      if (!bulkComprobante) {
        setBulkError(
          'Comprobante de pago requerido para transferencias, cheques y tarjeta. Subí la captura o PDF.',
        );
        return;
      }
    }
    setBulkGuardando(true);
    try {
      const carpeta = `${local}/${bulkFecha.substring(0, 7)}`;

      // Subir comprobante de pago una sola vez
      let pathComprobantePago: string | null = null;
      if (bulkComprobante) {
        const ext = bulkComprobante.name.split('.').pop()?.toLowerCase() || 'pdf';
        const path = `${carpeta}/pago_bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(path, bulkComprobante, {
            contentType: bulkComprobante.type || 'application/octet-stream',
          });
        if (error) throw error;
        pathComprobantePago = path;
      }

      // Subir factura una sola vez (si la hay)
      let pathFactura: string | null = null;
      if (bulkFactura) {
        const ext = bulkFactura.name.split('.').pop()?.toLowerCase() || 'pdf';
        const path = `${carpeta}/factura_bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(path, bulkFactura, {
            contentType: bulkFactura.type || 'application/octet-stream',
          });
        if (error) throw error;
        pathFactura = path;
      }

      // Insertar 1 fila en pagos_gastos por cada gasto seleccionado.
      // IMPORTANTE: el N° de operación va a numero_operacion (no referencia,
      // que es el campo legacy). Es el que usa la conciliación para matchear
      // contra el extracto.
      const filasPago = seleccionInfo.gastos.map((g) => ({
        gasto_id: g.id,
        fecha_pago: bulkFecha,
        monto: g.importe_total,
        descuento: 0,
        medio_pago: bulkMedio,
        numero_operacion: bulkReferencia.trim() || null,
        notas: bulkNotas.trim() || null,
        comprobante_pago_path: pathComprobantePago,
      }));
      const { error: errIns } = await supabase.from('pagos_gastos').insert(filasPago);
      if (errIns) throw errIns;

      // Marcar todos los gastos como Pagado y, si subimos factura, asignarla a los que no la tenían
      const idsTodos = seleccionInfo.gastos.map((g) => g.id);
      const { error: errUpd1 } = await supabase
        .from('gastos')
        .update({ estado_pago: 'Pagado', fecha_vencimiento: bulkFecha })
        .in('id', idsTodos);
      if (errUpd1) throw errUpd1;

      if (pathFactura) {
        const idsSinFactura = seleccionInfo.gastos
          .filter((g) => !g.factura_path)
          .map((g) => g.id);
        if (idsSinFactura.length > 0) {
          const { error: errUpd2 } = await supabase
            .from('gastos')
            .update({ factura_path: pathFactura })
            .in('id', idsSinFactura);
          if (errUpd2) throw errUpd2;
        }
      }

      // Sincronizar el comprobante de pago al gasto si éste no tenía uno.
      // El listado de Gastos lee gasto.comprobante_path, así que sin esto el
      // pago bulk queda invisible desde la vista de gastos (aunque sí esté
      // en pagos_gastos.comprobante_pago_path).
      if (pathComprobantePago) {
        const idsSinComprob = seleccionInfo.gastos
          .filter((g) => !g.comprobante_path)
          .map((g) => g.id);
        if (idsSinComprob.length > 0) {
          const { error: errUpd3 } = await supabase
            .from('gastos')
            .update({ comprobante_path: pathComprobantePago })
            .in('id', idsSinComprob);
          if (errUpd3) throw errUpd3;
        }
      }

      // También fijar el medio_pago en el gasto si no lo tenía (para que el
      // tab Gastos muestre "Transferencia MP" en vez de "—").
      const idsSinMedio = seleccionInfo.gastos
        .filter((g) => !g.medio_pago)
        .map((g) => g.id);
      if (idsSinMedio.length > 0) {
        const { error: errUpd4 } = await supabase
          .from('gastos')
          .update({ medio_pago: bulkMedio })
          .in('id', idsSinMedio);
        if (errUpd4) throw errUpd4;
      }

      setSeleccionados(new Set());
      cerrarBulkPago();
      qc.invalidateQueries({ queryKey: ['gastos_pagos'] });
      qc.invalidateQueries({ queryKey: ['pagos_gastos_compras'] });
      qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
    } catch (e) {
      setBulkError((e as Error).message ?? 'Error al guardar el pago');
    } finally {
      setBulkGuardando(false);
    }
  }

  const pagosKpis = useMemo(() => {
    const hoy = new Date().toISOString().split('T')[0];
    const en7dias = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const todos = gastosPagos ?? [];
    const pendientes = todos.filter((g) => g.estado_pago?.toLowerCase() !== 'pagado');
    const vencidos = pendientes.filter((g) => g.fecha_vencimiento && g.fecha_vencimiento < hoy);
    const venceHoy = pendientes.filter((g) => g.fecha_vencimiento === hoy);
    const proxSemana = pendientes.filter(
      (g) => g.fecha_vencimiento && g.fecha_vencimiento >= hoy && g.fecha_vencimiento <= en7dias,
    );

    // Total gastado del mes seleccionado (todos los gastos, pagados o no)
    const delMes = todos.filter((g) => g.fecha?.startsWith(mesPagos));
    // Pagados del mes: de los gastos DEL mes (fecha del gasto en el mes),
    // cuántos ya están pagados. Así "Comprado - Pagado = Resta pagar"
    // siempre cierra positivo y el corte es coherente con el período.
    const pagadosDelMes = delMes.filter(
      (g) => g.estado_pago?.toLowerCase() === 'pagado',
    );
    // Pagados cta cte: pagos hechos en el mes sobre gastos cargados antes
    // (cuenta corriente real). Filtra por la fecha del PAGO en el mes y
    // que el pago haya sido posterior al gasto. Sirve para ver cuánta
    // plata real salió en el mes por cta cte, independiente de cuándo se
    // compró.
    const pagadosCtaCteDelMes = todos.filter((g) => {
      if (g.estado_pago?.toLowerCase() !== 'pagado') return false;
      const pago = pagosGastosMap.get(g.id);
      if (!pago) return false;
      if (!pago.fecha_pago.startsWith(mesPagos)) return false;
      return pago.fecha_pago > g.fecha;
    });

    return {
      totalPendiente: pendientes.reduce((s, g) => s + g.importe_total, 0),
      cantPendientes: pendientes.length,
      totalVencido: vencidos.reduce((s, g) => s + g.importe_total, 0),
      cantVencidos: vencidos.length,
      totalHoy: venceHoy.reduce((s, g) => s + g.importe_total, 0),
      cantHoy: venceHoy.length,
      totalSemana: proxSemana.reduce((s, g) => s + g.importe_total, 0),
      cantSemana: proxSemana.length,
      totalMes: delMes.reduce((s, g) => s + g.importe_total, 0),
      cantMes: delMes.length,
      pagadoMes: pagadosDelMes.reduce((s, g) => s + g.importe_total, 0),
      cantPagadoMes: pagadosDelMes.length,
      pagadoCtaCteMes: pagadosCtaCteDelMes.reduce((s, g) => s + g.importe_total, 0),
      cantPagadoCtaCteMes: pagadosCtaCteDelMes.length,
    };
  }, [gastosPagos, mesPagos, pagosGastosMap]);

  // ── Filtrar productos ──────────────────────────────────────────────────────
  const productosFiltrados = useMemo(() => {
    let lista = productos ?? [];

    // Filtro por estado
    if (filtroEstado === 'inactivos') lista = lista.filter((p) => !p.activo);
    else {
      lista = lista.filter((p) => p.activo); // por defecto solo activos
      if (filtroEstado === 'sin_stock') lista = lista.filter((p) => p.stock_actual <= 0);
      else if (filtroEstado === 'bajo_minimo')
        lista = lista.filter((p) => p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo);
    }

    // Filtro por texto
    if (filtro) {
      const f = filtro
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      lista = lista.filter((p) => {
        const n = (p.nombre + ' ' + p.categoria + ' ' + p.proveedor)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        return n.includes(f);
      });
    }

    return lista;
  }, [productos, filtro, filtroEstado]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const todos = productos ?? [];
    const activos = todos.filter((p) => p.activo);
    const inactivos = todos.filter((p) => !p.activo);
    const bajoMinimo = activos.filter(
      (p) => p.stock_actual <= p.stock_minimo && p.stock_minimo > 0,
    );
    const sinStock = activos.filter((p) => p.stock_actual <= 0);
    const valorTotal = activos.reduce((s, p) => s + p.stock_actual * p.costo_unitario, 0);
    return {
      total: activos.length,
      bajoMinimo: bajoMinimo.length,
      sinStock: sinStock.length,
      valorTotal,
      inactivos: inactivos.length,
    };
  }, [productos]);

  const categoriasExistentes = useMemo(
    () => [...new Set((productos ?? []).map((p) => p.categoria).filter(Boolean))].sort(),
    [productos],
  );
  const proveedoresExistentes = useMemo(
    () => [...new Set((productos ?? []).map((p) => p.proveedor).filter(Boolean))].sort(),
    [productos],
  );

  // ── Recepción de mercadería ──────────────────────────────────────────────
  interface DetalleConMatch extends DetalleRow {
    proveedor: string;
    productoMatch: Producto | null;
    confirmado: boolean;
  }
  const recepcionRef = useRef<HTMLInputElement>(null);
  const [recItems, setRecItems] = useState<DetalleConMatch[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [recPeriodo, setRecPeriodo] = useState('');
  const [recConfirmando, setRecConfirmando] = useState(false);
  const [recResultado, setRecResultado] = useState<string | null>(null);

  // Similitud simple por palabras compartidas
  const similitud = useCallback((a: string, b: string) => {
    const normStr = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, '');
    const wordsA = normStr(a).split(/\s+/).filter(Boolean);
    const wordsB = normStr(b).split(/\s+/).filter(Boolean);
    if (!wordsA.length || !wordsB.length) return 0;
    let matches = 0;
    for (const w of wordsA) {
      if (wordsB.some((wb) => wb.includes(w) || w.includes(wb))) matches++;
    }
    return matches / Math.max(wordsA.length, wordsB.length);
  }, []);

  async function cargarRecepcion(file: File) {
    setRecLoading(true);
    setRecError(null);
    setRecItems([]);
    setRecResultado(null);
    try {
      const buffer = await file.arrayBuffer();
      const { gastos, detalle, periodo } = parseFudoGastos(buffer, local);
      if (!detalle.length)
        throw new Error('No se encontró hoja "Detalle" en el archivo o está vacía');

      setRecPeriodo(periodo);

      // Guardar gastos en Supabase (alimenta tab Pagos)
      const gastosRows = gastos
        .filter((g) => g.fecha && !g.cancelado)
        .map((g) => ({ local, periodo, ...g }));
      if (gastosRows.length) {
        await supabase.from('gastos').upsert(gastosRows, { onConflict: 'local,fudo_id' });
        qc.invalidateQueries({ queryKey: ['gastos_pagos'] });
      }

      // Mapa gasto_id → proveedor
      const provMap = new Map<string, string>();
      for (const g of gastos) {
        if (!g.cancelado) provMap.set(g.fudo_id, g.proveedor);
      }

      // Solo items de gastos no cancelados
      const itemsValidos = detalle.filter((d) => provMap.has(d.gasto_id));

      // Buscar match con productos existentes
      const prods = productos ?? [];
      const items: DetalleConMatch[] = itemsValidos.map((d) => {
        let mejorMatch: Producto | null = null;
        let mejorScore = 0;
        for (const p of prods) {
          const score = similitud(d.descripcion, p.nombre);
          if (score > mejorScore) {
            mejorScore = score;
            mejorMatch = p;
          }
        }
        return {
          ...d,
          proveedor: provMap.get(d.gasto_id) ?? '',
          productoMatch: mejorScore >= 0.4 ? mejorMatch : null,
          confirmado: mejorScore >= 0.6, // auto-confirmar si match alto
        };
      });

      setRecItems(items);
    } catch (e) {
      setRecError((e as Error).message);
    } finally {
      setRecLoading(false);
    }
  }

  function cambiarMatchRecepcion(idx: number, productoId: string | null) {
    setRecItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const prod = productoId
          ? ((productos ?? []).find((p) => p.id === productoId) ?? null)
          : null;
        return { ...item, productoMatch: prod, confirmado: !!prod };
      }),
    );
  }

  function toggleConfirmado(idx: number) {
    setRecItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, confirmado: !item.confirmado } : item)),
    );
  }

  async function confirmarRecepcion() {
    const confirmados = recItems.filter((it) => it.confirmado && it.productoMatch);
    if (!confirmados.length) return;

    setRecConfirmando(true);
    setRecResultado(null);
    try {
      // Agrupar cantidades por producto (puede haber varios items del mismo producto)
      const porProducto = new Map<
        string,
        { prod: Producto; totalCantidad: number; items: DetalleConMatch[] }
      >();
      for (const it of confirmados) {
        const p = it.productoMatch!;
        const existing = porProducto.get(p.id);
        if (existing) {
          existing.totalCantidad += it.cantidad;
          existing.items.push(it);
        } else {
          porProducto.set(p.id, { prod: p, totalCantidad: it.cantidad, items: [it] });
        }
      }

      // Crear movimientos de entrada y actualizar stock
      for (const [, { prod, totalCantidad, items }] of porProducto) {
        // Movimiento de entrada
        await supabase.from('movimientos_stock').insert({
          local,
          producto_id: prod.id,
          producto_nombre: prod.nombre,
          tipo: 'entrada',
          cantidad: totalCantidad,
          unidad: items[0].unidad || prod.unidad,
          motivo: 'Recepción mercadería',
          observacion: `Proveedor: ${items[0].proveedor} | ${items.length} item(s) del export Fudo (${recPeriodo})`,
        });

        // Actualizar stock
        await supabase
          .from('productos')
          .update({
            stock_actual: prod.stock_actual + totalCantidad,
            updated_at: new Date().toISOString(),
          })
          .eq('id', prod.id);
      }

      setRecResultado(
        `${confirmados.length} items recepcionados (${porProducto.size} productos actualizados)`,
      );
      setRecItems([]);
      qc.invalidateQueries({ queryKey: ['productos_stock'] });
      qc.invalidateQueries({ queryKey: ['productos_activos'] });
      qc.invalidateQueries({ queryKey: ['movimientos_stock'] });
    } catch (e) {
      setRecResultado(`Error: ${(e as Error).message}`);
    } finally {
      setRecConfirmando(false);
    }
  }

  // ── Import stock ───────────────────────────────────────────────────────────

  return (
    <PageContainer title="Gastos-Compras" subtitle="Gastos, stock, proveedores y pagos">
      {/* Banner: avisa si hace >15 días que no importás algún extracto */}
      <ExtractosAlerta variant="banner" to="/compras" />

      {/* Banner del cierre mensual de inventario (en ventana del cierre o feedback aprobado) */}
      <CierreInventarioBanner local={local} />

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {/* El tab Gastos tiene su propio filtro con opción "Empresa"
            (vedia + saavedra + sas), que el global no puede expresar.
            Para evitar dos filtros que se pisan, escondemos el global acá. */}
        {tab !== 'gastos' && (
          <LocalSelector
            value={local}
            onChange={(v) => {
              const l = v as 'vedia' | 'saavedra';
              setLocal(l);
            }}
          />
        )}

        <div className="flex gap-1 border-b border-gray-200">
          {(
            [
              ['stock', '📦 Stock'],
              ['gastos', '🧾 Gastos'],
              ['movimientos', '📋 Movimientos'],
              ['recepcion', '📬 Recepción'],
              ['pagos', '💰 Pagos'],
              ['conciliacion', '🔗 Conciliación'],
              ['proveedores', '🏢 Proveedores'],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'relative border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                tab === t
                  ? 'border-rodziny-600 text-rodziny-800'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              )}
            >
              {label}
              {t === 'recepcion' && (recepcionesPendientes?.length ?? 0) > 0 && (
                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {recepcionesPendientes!.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={() => setAyudaAbierta(true)}
          className="hover:bg-rodziny-200 ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-rodziny-100 text-sm font-bold text-rodziny-700 transition-colors"
          title="Ayuda"
        >
          ?
        </button>
      </div>

      {ayudaAbierta && <AyudaPanel tab={tab} onClose={() => setAyudaAbierta(false)} />}

      {/* ═══ TAB: GASTOS ═══ */}
      {tab === 'gastos' && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-600">
              Cargá un gasto sacando una foto del comprobante. La IA lee automáticamente proveedor, monto, fecha y N° de operación.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Filtro de local del tab Gastos. "Empresa" = todos los gastos
                  sin filtrar por local (incluye los cargados con local='sas',
                  o sea de la razón social — afectan a ambos locales por igual). */}
              <div className="flex gap-1 rounded-md border border-gray-300 bg-white p-0.5">
                {(
                  [
                    { id: 'empresa', label: 'Empresa' },
                    { id: 'vedia', label: 'Vedia' },
                    { id: 'saavedra', label: 'Saavedra' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setGastosLocal(o.id)}
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                      gastosLocal === o.id
                        ? 'bg-rodziny-700 text-white'
                        : 'text-gray-600 hover:bg-gray-100',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <label className="text-xs font-medium text-gray-500">Período</label>
              <input
                type="month"
                value={gastosPeriodo}
                onChange={(e) => setGastosPeriodo(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
              />
              <button
                onClick={() => {
                  setPrefillGasto(undefined);
                  setNuevoGastoFormOpen(true);
                }}
                className="rounded-lg bg-rodziny-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-rodziny-700"
              >
                + Nuevo gasto
              </button>
            </div>
          </div>

          {/* KPIs del período */}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-surface-border bg-white p-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Gastos del mes
              </p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">
                {gastosKpis?.cantidad ?? '—'}
              </p>
            </div>
            <div className="rounded-lg border border-surface-border bg-white p-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Total $
              </p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">
                {gastosKpis ? formatARS(gastosKpis.total) : '—'}
              </p>
            </div>
            <div className="rounded-lg border border-surface-border bg-white p-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Pagados
              </p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">
                {gastosKpis ? `${gastosKpis.pagados} / ${gastosKpis.cantidad}` : '—'}
              </p>
            </div>
            <div className="rounded-lg border border-surface-border bg-white p-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Con factura
              </p>
              <p
                className={cn(
                  'mt-0.5 text-lg font-bold',
                  gastosKpis && gastosKpis.cantidad > 0 && gastosKpis.conFactura / gastosKpis.cantidad < 0.7
                    ? 'text-amber-600'
                    : 'text-gray-900',
                )}
              >
                {gastosKpis
                  ? `${gastosKpis.conFactura} / ${gastosKpis.cantidad}`
                  : '—'}
              </p>
            </div>
            <div className="rounded-lg border border-surface-border bg-white p-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Sin categoría
              </p>
              <p
                className={cn(
                  'mt-0.5 text-lg font-bold',
                  gastosKpis && gastosKpis.sinCategoria > 0 ? 'text-red-600' : 'text-green-600',
                )}
              >
                {gastosKpis?.sinCategoria ?? '—'}
              </p>
            </div>
          </div>

          <ListadoGastos
            local={gastosLocal === 'empresa' ? 'consolidado' : gastosLocal}
            desde={gastosDesde}
            hasta={gastosHasta}
            onResumen={setGastosKpis}
          />
        </>
      )}

      {/* ═══ TAB: STOCK ═══ */}
      {tab === 'stock' && (
        <>
          {/* KPIs clickeables */}
          <div className="mb-4 grid grid-cols-4 gap-3">
            <button
              onClick={() => setFiltroEstado('todos')}
              className={cn(
                'rounded-lg border bg-white p-4 text-left transition-colors',
                filtroEstado === 'todos'
                  ? 'ring-rodziny-200 border-rodziny-500 ring-1'
                  : 'border-surface-border hover:border-gray-300',
              )}
            >
              <p className="mb-1 text-xs text-gray-500">Productos</p>
              <p className="text-lg font-semibold text-gray-900">{kpis.total}</p>
            </button>
            <button
              onClick={() =>
                setFiltroEstado(filtroEstado === 'bajo_minimo' ? 'todos' : 'bajo_minimo')
              }
              className={cn(
                'rounded-lg border bg-white p-4 text-left transition-colors',
                filtroEstado === 'bajo_minimo'
                  ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-200'
                  : 'border-surface-border hover:border-gray-300',
              )}
            >
              <p className="mb-1 text-xs text-gray-500">Bajo mínimo</p>
              <p
                className={cn(
                  'text-lg font-semibold',
                  kpis.bajoMinimo > 0 ? 'text-orange-600' : 'text-green-600',
                )}
              >
                {kpis.bajoMinimo}
              </p>
            </button>
            <button
              onClick={() => setFiltroEstado(filtroEstado === 'sin_stock' ? 'todos' : 'sin_stock')}
              className={cn(
                'rounded-lg border bg-white p-4 text-left transition-colors',
                filtroEstado === 'sin_stock'
                  ? 'border-red-500 bg-red-50 ring-1 ring-red-200'
                  : 'border-surface-border hover:border-gray-300',
              )}
            >
              <p className="mb-1 text-xs text-gray-500">Sin stock</p>
              <p
                className={cn(
                  'text-lg font-semibold',
                  kpis.sinStock > 0 ? 'text-red-600' : 'text-green-600',
                )}
              >
                {kpis.sinStock}
              </p>
            </button>
            <div className="rounded-lg border border-surface-border bg-white p-4">
              <p className="mb-1 text-xs text-gray-500">Valor inventario</p>
              <p className="text-lg font-semibold text-gray-900">{formatARS(kpis.valorTotal)}</p>
            </div>
          </div>
          {kpis.inactivos > 0 && (
            <div className="mb-3">
              <button
                onClick={() =>
                  setFiltroEstado(filtroEstado === 'inactivos' ? 'todos' : 'inactivos')
                }
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-colors',
                  filtroEstado === 'inactivos'
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                )}
              >
                {filtroEstado === 'inactivos'
                  ? `Mostrando ${kpis.inactivos} inactivos ✕`
                  : `Ver ${kpis.inactivos} inactivos`}
              </button>
            </div>
          )}

          {/* Búsqueda + filtro activo */}
          <div className="mb-3 flex items-center gap-3">
            <input
              type="text"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar producto, categoría o proveedor..."
              className="max-w-md flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
            />
            {filtroEstado !== 'todos' && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium',
                  filtroEstado === 'bajo_minimo'
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-red-100 text-red-700',
                )}
              >
                {filtroEstado === 'bajo_minimo' ? 'Bajo mínimo' : 'Sin stock'}
                <button onClick={() => setFiltroEstado('todos')} className="ml-1 hover:opacity-70">
                  ✕
                </button>
              </span>
            )}
            <span className="text-xs text-gray-400">{productosFiltrados.length} productos</span>
            {!modoConteo ? (
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => setProductoModal('nuevo')}
                  className="rounded bg-rodziny-700 px-3 py-1.5 text-sm text-white hover:bg-rodziny-800"
                >
                  + Nuevo producto
                </button>
                <button
                  onClick={() => {
                    setModoConteo(true);
                    setConteos({});
                    setConteoResultado(null);
                  }}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >
                  Conteo de inventario
                </button>
                <button
                  onClick={() => setCierreInventarioModalAbierto(true)}
                  className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800"
                  title="Genera el cierre mensual de inventario para que entre al EdR"
                >
                  🔒 Cierre de mes
                </button>
              </div>
            ) : (
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => {
                    setModoConteo(false);
                    setConteos({});
                    setConteoResultado(null);
                  }}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancelar conteo
                </button>
              </div>
            )}
          </div>

          {modalAjuste && (
            <ModalAjusteInventario
              productos={(productos ?? []).filter((p) => p.activo)}
              local={local}
              onClose={() => setModalAjuste(false)}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['productos_stock'] });
                qc.invalidateQueries({ queryKey: ['movimientos_stock'] });
                setModalAjuste(false);
              }}
            />
          )}

          {/* ── Modo conteo de inventario ─────────────────────────────────── */}
          {modoConteo &&
            (() => {
              const activos = (productos ?? []).filter((p) => p.activo);
              const categorias = [
                ...new Set(activos.map((p) => p.categoria).filter(Boolean)),
              ].sort();
              let listaConteo = activos;
              if (filtroCatConteo !== 'todas')
                listaConteo = listaConteo.filter((p) => p.categoria === filtroCatConteo);
              if (filtroConteo.trim()) {
                const q = filtroConteo
                  .toLowerCase()
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '');
                listaConteo = listaConteo.filter((p) =>
                  (p.nombre + ' ' + p.categoria)
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .includes(q),
                );
              }
              const conteosCompletados = listaConteo.filter(
                (p) => conteos[p.id] !== undefined && conteos[p.id] !== '',
              ).length;
              const conDiferencia = listaConteo.filter((p) => {
                const v = conteos[p.id];
                if (v === undefined || v === '') return false;
                return parseDecimal(v) !== p.stock_actual;
              }).length;

              return (
                <div className="mb-4 space-y-3">
                  {/* Toolbar conteo */}
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-blue-900">
                          Conteo de inventario
                        </h3>
                        <p className="mt-0.5 text-xs text-blue-700">
                          Ingresá la cantidad real contada de cada producto. Al finalizar, confirmá
                          para ajustar todo junto.
                        </p>
                      </div>
                      <div className="text-right text-xs text-blue-800">
                        <div>
                          <span className="font-semibold">{conteosCompletados}</span> /{' '}
                          {listaConteo.length} contados
                        </div>
                        {conDiferencia > 0 && (
                          <div className="font-medium text-amber-700">
                            {conDiferencia} con diferencia
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={filtroCatConteo}
                        onChange={(e) => setFiltroCatConteo(e.target.value)}
                        className="rounded border border-blue-300 bg-white px-2 py-1.5 text-sm"
                      >
                        <option value="todas">Todas las categorías</option>
                        {categorias.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <input
                        value={filtroConteo}
                        onChange={(e) => setFiltroConteo(e.target.value)}
                        placeholder="Buscar producto..."
                        className="w-56 rounded border border-blue-300 bg-white px-3 py-1.5 text-sm"
                      />
                      <input
                        value={conteoResponsable}
                        onChange={(e) => setConteoResponsable(e.target.value)}
                        placeholder="Responsable del conteo"
                        className="ml-auto w-48 rounded border border-blue-300 bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                  </div>

                  {conteoResultado && (
                    <div
                      className={cn(
                        'rounded-md p-3 text-sm',
                        conteoResultado.startsWith('Error')
                          ? 'bg-red-50 text-red-700'
                          : 'bg-green-50 text-green-800',
                      )}
                    >
                      {conteoResultado}
                    </div>
                  )}

                  {/* Tabla de conteo */}
                  <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                              Categoría
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                              Producto
                            </th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">
                              Stock sistema
                            </th>
                            <th className="w-32 px-4 py-2.5 text-center text-xs font-semibold text-gray-600">
                              Conteo
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                              Unidad
                            </th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">
                              Diferencia
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {listaConteo.map((p) => {
                            const val = conteos[p.id] ?? '';
                            const diff = val !== '' ? parseDecimal(val) - p.stock_actual : null;
                            const equiv =
                              val !== '' && /kg|gr|gramo|kilo/i.test(p.unidad ?? '')
                                ? equivalenteKgGramos(parseDecimal(val))
                                : null;
                            return (
                              <tr
                                key={p.id}
                                className={cn(
                                  'border-b border-gray-50 hover:bg-gray-50',
                                  diff !== null && diff !== 0 && 'bg-amber-50/50',
                                  val !== '' && diff === 0 && 'bg-green-50/50',
                                )}
                              >
                                <td className="px-4 py-1.5 text-xs text-gray-500">{p.categoria}</td>
                                <td className="px-4 py-1.5 font-medium text-gray-900">
                                  {p.nombre}
                                </td>
                                <td className="px-4 py-1.5 text-right text-gray-600">
                                  {p.stock_actual}
                                </td>
                                <td className="px-4 py-1.5 text-center">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={val}
                                    onChange={(e) =>
                                      setConteos((prev) => ({
                                        ...prev,
                                        [p.id]: normalizarDecimal(e.target.value),
                                      }))
                                    }
                                    className="w-24 rounded border border-gray-300 px-2 py-1 text-center text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="—"
                                  />
                                  {equiv && (
                                    <div className="mt-0.5 text-[10px] leading-tight text-gray-400">
                                      {equiv}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-1.5 text-xs text-gray-500">{p.unidad}</td>
                                <td className="px-4 py-1.5 text-center">
                                  {diff === null ? (
                                    <span className="text-gray-300">—</span>
                                  ) : diff === 0 ? (
                                    <span className="text-xs font-medium text-green-600">OK</span>
                                  ) : (
                                    <span
                                      className={cn(
                                        'text-xs font-medium',
                                        diff > 0 ? 'text-blue-600' : 'text-red-600',
                                      )}
                                    >
                                      {diff > 0 ? '+' : ''}
                                      {Math.round(diff * 100) / 100}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Barra de confirmación */}
                  <div className="flex items-center justify-between rounded-lg border border-surface-border bg-white p-4">
                    <div className="text-xs text-gray-500">
                      {conteosCompletados} productos contados · {conDiferencia} con diferencia
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setModoConteo(false);
                          setConteos({});
                          setConteoResultado(null);
                        }}
                        className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={async () => {
                          // Solo ajusta los productos cuyo conteo difiere del stock.
                          // parseDecimal acepta coma decimal (es-AR) y un valor
                          // inválido NUNCA se interpreta como 0: se descarta para no
                          // pisar el stock real con basura.
                          const itemsAjustar = listaConteo.filter((p) => {
                            const v = conteos[p.id];
                            if (v === undefined || v === '') return false;
                            return parseDecimal(v) !== p.stock_actual;
                          });
                          if (!itemsAjustar.length) {
                            setConteoResultado('No hay diferencias para ajustar');
                            return;
                          }
                          if (!conteoResponsable.trim()) {
                            setConteoResultado('Error: Ingresá el responsable del conteo');
                            return;
                          }
                          if (!confirm(`¿Confirmar ajuste de ${itemsAjustar.length} productos?`))
                            return;

                          setConteoGuardando(true);
                          setConteoResultado(null);
                          // No cortar todo si un producto falla: se siguen los demás
                          // y al final se reporta cuáles no se pudieron guardar.
                          const fallidos: string[] = [];
                          let okCount = 0;
                          for (const p of itemsAjustar) {
                            try {
                              const nuevoStock = parseDecimal(conteos[p.id]);
                              const diferencia = nuevoStock - p.stock_actual;
                              const { error: errMov } = await supabase
                                .from('movimientos_stock')
                                .insert({
                                  local,
                                  producto_id: p.id,
                                  producto_nombre: p.nombre,
                                  tipo: diferencia >= 0 ? 'entrada' : 'salida',
                                  cantidad: Math.abs(diferencia),
                                  unidad: p.unidad,
                                  motivo: 'Inventario físico',
                                  observacion: `Conteo: ${p.stock_actual} → ${nuevoStock} (dif: ${diferencia > 0 ? '+' : ''}${diferencia})`,
                                  registrado_por: conteoResponsable.trim(),
                                });
                              if (errMov) throw errMov;
                              const { error: errProd } = await supabase
                                .from('productos')
                                .update({
                                  stock_actual: nuevoStock,
                                  updated_at: new Date().toISOString(),
                                })
                                .eq('id', p.id);
                              if (errProd) throw errProd;
                              okCount++;
                            } catch {
                              fallidos.push(p.nombre);
                            }
                          }
                          qc.invalidateQueries({ queryKey: ['productos_stock'] });
                          qc.invalidateQueries({ queryKey: ['movimientos_stock'] });
                          setConteoGuardando(false);
                          if (fallidos.length) {
                            // Conservar los conteos para reintentar; no cerrar el modo.
                            setConteoResultado(
                              `Error: se guardaron ${okCount} de ${itemsAjustar.length}. ` +
                                `NO se pudieron guardar (${fallidos.length}): ${fallidos.join(', ')}. ` +
                                `Revisá esos productos y volvé a confirmar.`,
                            );
                          } else {
                            setConteoResultado(`${okCount} productos ajustados correctamente`);
                            setConteos({});
                            setTimeout(() => {
                              setModoConteo(false);
                              setConteoResultado(null);
                            }, 2000);
                          }
                        }}
                        disabled={conteoGuardando || conDiferencia === 0}
                        className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {conteoGuardando ? 'Guardando...' : `Confirmar ajuste (${conDiferencia})`}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

          {/* Panel read-only de pastas terminadas (viene de Cocina) */}
          {!modoConteo && <PastasTerminadasPanel local={local} filtro={filtro} />}

          {/* Tabla de stock (oculta en modo conteo) */}
          {!modoConteo && (
            <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
              {isLoading ? (
                <div className="animate-pulse p-8 text-center text-sm text-gray-400">
                  Cargando...
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                          Producto
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                          Marca
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                          Categoría
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">
                          Stock
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">
                          Mínimo
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                          Proveedor
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">
                          Costo unit.
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">
                          Valor
                        </th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">
                          Estado
                        </th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">
                          Activo
                        </th>
                        <th className="w-10 px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {productosFiltrados.map((p) => {
                        const bajoMin =
                          p.activo && p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo;
                        const sinStock = p.activo && p.stock_actual <= 0;
                        return (
                          <tr
                            key={p.id}
                            className={cn(
                              'border-b border-gray-50 hover:bg-gray-50',
                              !p.activo && 'opacity-50',
                              sinStock && 'bg-red-50',
                              bajoMin && !sinStock && 'bg-orange-50',
                            )}
                          >
                            <td className="px-4 py-2 font-medium text-gray-900">{p.nombre}</td>
                            <td className="px-4 py-2 text-xs text-gray-500">
                              {p.marca || <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-2 text-gray-600">{p.categoria}</td>
                            <td className="px-4 py-2 text-right font-medium">
                              <span
                                className={
                                  sinStock
                                    ? 'text-red-600'
                                    : bajoMin
                                      ? 'text-orange-600'
                                      : 'text-gray-900'
                                }
                              >
                                {p.stock_actual} {p.unidad}
                              </span>
                            </td>
                            <td
                              className="cursor-pointer px-4 py-2 text-right text-gray-500 hover:bg-blue-50"
                              onClick={() => {
                                setEditandoMin(p.id);
                                setValorMin(p.stock_minimo > 0 ? String(p.stock_minimo) : '');
                              }}
                            >
                              {editandoMin === p.id ? (
                                <input
                                  type="number"
                                  step="any"
                                  autoFocus
                                  value={valorMin}
                                  onChange={(e) => setValorMin(e.target.value)}
                                  onKeyDown={async (e) => {
                                    if (e.key === 'Enter') {
                                      const val = parseFloat(valorMin.replace(',', '.')) || 0;
                                      await supabase
                                        .from('productos')
                                        .update({ stock_minimo: val })
                                        .eq('id', p.id);
                                      qc.invalidateQueries({ queryKey: ['productos_stock'] });
                                      setEditandoMin(null);
                                    }
                                    if (e.key === 'Escape') setEditandoMin(null);
                                  }}
                                  onBlur={async () => {
                                    const val = parseFloat(valorMin.replace(',', '.')) || 0;
                                    await supabase
                                      .from('productos')
                                      .update({ stock_minimo: val })
                                      .eq('id', p.id);
                                    qc.invalidateQueries({ queryKey: ['productos_stock'] });
                                    setEditandoMin(null);
                                  }}
                                  className="w-20 rounded border border-blue-400 bg-blue-50 px-1 py-0.5 text-right text-sm outline-none"
                                />
                              ) : (
                                <span className="text-xs">
                                  {p.stock_minimo > 0 ? (
                                    `${p.stock_minimo} ${p.unidad}`
                                  ) : (
                                    <span className="text-gray-300">editar</span>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-600">
                              {p.proveedor || '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600">
                              {p.costo_unitario > 0 ? formatARS(p.costo_unitario) : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-700">
                              {p.costo_unitario > 0
                                ? formatARS(p.stock_actual * p.costo_unitario)
                                : '—'}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {!p.activo ? (
                                <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                                  Inactivo
                                </span>
                              ) : sinStock ? (
                                <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                  Sin stock
                                </span>
                              ) : bajoMin ? (
                                <span className="inline-block rounded bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                                  Bajo mínimo
                                </span>
                              ) : (
                                <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                  OK
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button
                                onClick={async () => {
                                  await supabase
                                    .from('productos')
                                    .update({ activo: !p.activo })
                                    .eq('id', p.id);
                                  qc.invalidateQueries({ queryKey: ['productos_stock'] });
                                  qc.invalidateQueries({ queryKey: ['productos_activos'] });
                                }}
                                className={cn(
                                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                                  p.activo ? 'bg-rodziny-600' : 'bg-gray-300',
                                )}
                              >
                                <span
                                  className={cn(
                                    'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                                    p.activo ? 'translate-x-4' : 'translate-x-1',
                                  )}
                                />
                              </button>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={() => setProductoModal(p)}
                                  className="text-gray-400 transition-colors hover:text-rodziny-700"
                                  title="Editar producto"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    className="h-4 w-4"
                                  >
                                    <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => setFusionando(p)}
                                  className="text-gray-400 transition-colors hover:text-purple-600"
                                  title="Fusionar con otro producto (eliminar este duplicado)"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    className="h-4 w-4"
                                  >
                                    <path d="M10 2a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 110-2h3V3a1 1 0 011-1zm0 16a1 1 0 01-1-1v-5a1 1 0 011-1h5a1 1 0 110 2h-3v3a1 1 0 01-1 1z" />
                                    <path d="M3 10a1 1 0 011-1h5a1 1 0 010 2H5v3a1 1 0 11-2 0v-4zm14 0a1 1 0 01-1 1h-5a1 1 0 110-2h3V6a1 1 0 112 0v4z" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {fusionando && (
            <ModalFusionarProducto
              duplicado={fusionando}
              candidatos={(productos ?? []).filter(
                (x) => x.id !== fusionando.id && (x.local ?? '') === (fusionando.local ?? ''),
              )}
              onClose={() => setFusionando(null)}
              onDone={() => {
                qc.invalidateQueries({ queryKey: ['productos_stock'] });
                qc.invalidateQueries({ queryKey: ['productos_activos'] });
                qc.invalidateQueries({ queryKey: ['productos-compras-recetas'] });
                qc.invalidateQueries({ queryKey: ['cocina-receta-ingredientes'] });
                setFusionando(null);
              }}
            />
          )}

          {/* Modal crear/editar producto */}
          {productoModal && (
            <ModalProducto
              producto={productoModal === 'nuevo' ? null : productoModal}
              local={local}
              categoriasExistentes={categoriasExistentes}
              proveedoresExistentes={proveedoresExistentes}
              onClose={() => setProductoModal(null)}
              onSaved={() => {
                setProductoModal(null);
                qc.invalidateQueries({ queryKey: ['productos_stock'] });
                qc.invalidateQueries({ queryKey: ['productos_activos'] });
              }}
            />
          )}
        </>
      )}

      {/* ═══ TAB: MOVIMIENTOS ═══ */}
      {tab === 'movimientos' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-white p-3 text-sm">
            <span className="text-xs text-gray-500">Desde</span>
            <input
              type="date"
              value={movDesde}
              onChange={(e) => setMovDesde(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <span className="text-xs text-gray-500">Hasta</span>
            <input
              type="date"
              value={movHasta}
              onChange={(e) => setMovHasta(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 7);
                setMovDesde(d.toISOString().slice(0, 10));
                setMovHasta(new Date().toISOString().slice(0, 10));
              }}
              className="hover:border-rodziny-300 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:text-rodziny-700"
            >
              7 días
            </button>
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 30);
                setMovDesde(d.toISOString().slice(0, 10));
                setMovHasta(new Date().toISOString().slice(0, 10));
              }}
              className="hover:border-rodziny-300 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:text-rodziny-700"
            >
              30 días
            </button>
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 90);
                setMovDesde(d.toISOString().slice(0, 10));
                setMovHasta(new Date().toISOString().slice(0, 10));
              }}
              className="hover:border-rodziny-300 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:text-rodziny-700"
            >
              90 días
            </button>
            <button
              onClick={() => {
                setMovDesde('2026-01-01');
                setMovHasta(new Date().toISOString().slice(0, 10));
              }}
              className="hover:border-rodziny-300 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:text-rodziny-700"
            >
              Año actual
            </button>
            <span className="ml-auto text-xs text-gray-500">
              {movimientos?.length ?? 0} movimientos
              {(movimientos?.length ?? 0) >= 2000 && ' (máx alcanzado, achicá el rango)'}
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                      Fecha
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                      Producto
                    </th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">
                      Tipo
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">
                      Cantidad
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                      Motivo
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                      Observación
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                      Registrado por
                    </th>
                    <th className="w-8 px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {!movimientos || movimientos.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                        No hay movimientos registrados
                      </td>
                    </tr>
                  ) : (
                    movimientos.map((m) => (
                      <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2 text-xs text-gray-600">
                          {new Date(m.created_at).toLocaleDateString('es-AR', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-2 font-medium text-gray-900">{m.producto_nombre}</td>
                        <td className="px-4 py-2 text-center">
                          <span
                            className={cn(
                              'inline-block rounded px-2 py-0.5 text-xs font-medium',
                              m.tipo === 'entrada'
                                ? 'bg-green-100 text-green-700'
                                : m.tipo === 'salida'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-blue-100 text-blue-700',
                            )}
                          >
                            {m.tipo === 'entrada'
                              ? '↑ Entrada'
                              : m.tipo === 'salida'
                                ? '↓ Salida'
                                : '⟳ Ajuste'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="font-medium text-gray-800">
                            {m.cantidad} {m.unidad}
                          </span>
                          {m.producto_id &&
                            (() => {
                              const prod = (productos ?? []).find((p) => p.id === m.producto_id);
                              if (!prod) return null;
                              const stockActual = prod.stock_actual;
                              const stockAnterior =
                                m.tipo === 'entrada'
                                  ? stockActual - m.cantidad
                                  : stockActual + m.cantidad;
                              return (
                                <div className="mt-0.5 text-[10px] text-gray-400">
                                  {Math.max(0, Math.round(stockAnterior * 100) / 100)} →{' '}
                                  <span className="font-medium text-gray-600">
                                    {Math.round(stockActual * 100) / 100}
                                  </span>
                                </div>
                              );
                            })()}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-600">{m.motivo || '—'}</td>
                        <td className="max-w-[200px] truncate px-4 py-2 text-xs text-gray-500">
                          {m.observacion || '—'}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {m.registrado_por || '—'}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            onClick={async () => {
                              if (
                                !confirm(
                                  `¿Eliminar este movimiento y revertir el stock de ${m.producto_nombre}?`,
                                )
                              )
                                return;
                              // Revertir stock: si fue salida sumamos, si fue entrada restamos
                              if (m.producto_id) {
                                const { data: prod } = await supabase
                                  .from('productos')
                                  .select('stock_actual')
                                  .eq('id', m.producto_id)
                                  .single();
                                if (prod) {
                                  const nuevoStock =
                                    m.tipo === 'salida'
                                      ? prod.stock_actual + m.cantidad
                                      : Math.max(0, prod.stock_actual - m.cantidad);
                                  await supabase
                                    .from('productos')
                                    .update({ stock_actual: nuevoStock })
                                    .eq('id', m.producto_id);
                                }
                              }
                              await supabase.from('movimientos_stock').delete().eq('id', m.id);
                              qc.invalidateQueries({ queryKey: ['movimientos_stock'] });
                              qc.invalidateQueries({ queryKey: ['productos_stock'] });
                              qc.invalidateQueries({ queryKey: ['productos_activos'] });
                            }}
                            className="text-xs text-gray-300 transition-colors hover:text-red-500"
                            title="Eliminar y revertir stock"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: IMPORTAR ═══ */}
      {/* ═══ TAB: RECEPCIÓN (solo Saavedra) ═══ */}
      {tab === 'recepcion' && (
        <div>
          {/* Pagos pendientes de cargar (mercadería ya recibida desde la PWA) */}
          {recepcionesPendientes && recepcionesPendientes.length > 0 && (
            <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-amber-900">
                    💰 Pagos pendientes de cargar ({recepcionesPendientes.length})
                  </h3>
                  <p className="mt-0.5 text-xs text-amber-700">
                    Estas recepciones ya entraron al stock desde la PWA. Falta cargar el gasto
                    (monto, fecha de pago, IVA) en Fudo o en la sección de Pagos.
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {recepcionesPendientes.map((r) => {
                  const fechaStr = new Date(r.created_at).toLocaleString('es-AR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  });
                  return (
                    <div key={r.id} className="rounded border border-amber-200 bg-white p-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900">
                            {r.proveedor || 'Sin proveedor indicado'}
                          </div>
                          <div className="text-xs text-gray-500">
                            {fechaStr} · Recibió:{' '}
                            <span className="font-medium">{r.registrado_por || '—'}</span>
                          </div>
                          {r.notas && (
                            <div className="mt-1 text-xs italic text-gray-600">"{r.notas}"</div>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {r.foto_path && (
                            <button
                              onClick={() => verFotoRecepcion(r.foto_path!)}
                              className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                            >
                              📷 Ver remito
                            </button>
                          )}
                          <button
                            onClick={() => abrirGastoDesdeRecepcion(r)}
                            className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                            title="Cargar gasto en el sistema"
                          >
                            💰 Cargar gasto
                          </button>
                          <button
                            onClick={() => descartarRecepcion(r.id)}
                            className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300"
                          >
                            Descartar
                          </button>
                        </div>
                      </div>
                      <div className="space-y-0.5 rounded bg-gray-50 p-2 text-xs">
                        {r.items.map((it, idx) => (
                          <div key={idx} className="flex justify-between text-gray-700">
                            <span>{it.producto_nombre}</span>
                            <span className="font-medium">
                              {it.cantidad} {it.unidad}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upload */}
          {recItems.length === 0 && (
            <div className="max-w-xl">
              <div className="rounded-lg border border-surface-border bg-white p-6">
                <h3 className="mb-1 font-semibold text-gray-900">Recepción de mercadería</h3>
                <p className="mb-3 text-xs text-gray-400">
                  Subí el export de <strong>gastos</strong> de Fudo (.xls/.xlsx). Se leerá la hoja
                  "Detalle" para matchear los items con tu inventario.
                </p>
                <div className="border-rodziny-200 mb-4 rounded-lg border bg-rodziny-50 p-3 text-sm">
                  Recibiendo en:{' '}
                  <span className="font-semibold text-rodziny-800">
                    {local === 'vedia' ? 'Rodziny Vedia' : 'Rodziny Saavedra'}
                  </span>
                </div>

                <div
                  className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-8 text-center transition-colors hover:border-rodziny-500"
                  onClick={() => recepcionRef.current?.click()}
                >
                  <div className="mb-2 text-2xl">📬</div>
                  <p className="text-sm text-gray-600">
                    Arrastrá el export de <strong>gastos</strong> de Fudo
                  </p>
                  <input
                    ref={recepcionRef}
                    type="file"
                    className="hidden"
                    accept=".xls,.xlsx"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) cargarRecepcion(f);
                    }}
                  />
                </div>

                {recLoading && (
                  <p className="mt-3 animate-pulse text-sm text-blue-600">Procesando archivo...</p>
                )}
                {recError && (
                  <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                    {recError}
                  </div>
                )}
                {recResultado && (
                  <div
                    className={cn(
                      'mt-3 rounded-md p-3 text-sm',
                      recResultado.startsWith('Error')
                        ? 'bg-red-50 text-red-700'
                        : 'bg-green-50 text-green-800',
                    )}
                  >
                    {recResultado}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tabla de matching */}
          {recItems.length > 0 && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">Items del export — {recPeriodo}</h3>
                  <p className="text-xs text-gray-500">
                    {recItems.filter((i) => i.confirmado && i.productoMatch).length} de{' '}
                    {recItems.length} items matcheados. Confirmá o corregí el match de cada item
                    antes de recepcionar.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setRecItems([]);
                      setRecResultado(null);
                    }}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmarRecepcion}
                    disabled={
                      recConfirmando || !recItems.some((i) => i.confirmado && i.productoMatch)
                    }
                    className={cn(
                      'rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors',
                      recConfirmando ? 'bg-gray-400' : 'bg-rodziny-600 hover:bg-rodziny-700',
                      !recItems.some((i) => i.confirmado && i.productoMatch) &&
                        'cursor-not-allowed opacity-50',
                    )}
                  >
                    {recConfirmando
                      ? 'Procesando...'
                      : `Recepcionar (${recItems.filter((i) => i.confirmado && i.productoMatch).length})`}
                  </button>
                </div>
              </div>

              {recResultado && (
                <div
                  className={cn(
                    'mb-3 rounded-md p-3 text-sm',
                    recResultado.startsWith('Error')
                      ? 'bg-red-50 text-red-700'
                      : 'bg-green-50 text-green-800',
                  )}
                >
                  {recResultado}
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="w-10 px-3 py-2.5 text-center text-xs font-semibold text-gray-600">
                          OK
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                          Descripción (Fudo)
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">
                          Cantidad
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                          Unidad
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                          Proveedor
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">
                          Precio
                        </th>
                        <th className="min-w-[220px] px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                          Match producto
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recItems.map((item, idx) => (
                        <tr
                          key={idx}
                          className={cn(
                            'border-b border-gray-50 hover:bg-gray-50',
                            item.confirmado && item.productoMatch ? 'bg-green-50/50' : '',
                            !item.productoMatch ? 'bg-yellow-50/50' : '',
                          )}
                        >
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={item.confirmado && !!item.productoMatch}
                              disabled={!item.productoMatch}
                              onChange={() => toggleConfirmado(idx)}
                              className="h-4 w-4 rounded border-gray-300 text-rodziny-600 focus:ring-rodziny-500"
                            />
                          </td>
                          <td className="px-4 py-2 font-medium text-gray-900">
                            {item.descripcion}
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-gray-800">
                            {item.cantidad}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-600">{item.unidad}</td>
                          <td className="px-4 py-2 text-xs text-gray-600">{item.proveedor}</td>
                          <td className="px-4 py-2 text-right text-gray-600">
                            {item.precio > 0 ? formatARS(item.precio) : '—'}
                          </td>
                          <td className="px-4 py-2">
                            <select
                              value={item.productoMatch?.id ?? ''}
                              onChange={(e) => cambiarMatchRecepcion(idx, e.target.value || null)}
                              className={cn(
                                'w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500',
                                item.productoMatch
                                  ? 'border-green-300 bg-green-50'
                                  : 'border-orange-300 bg-orange-50',
                              )}
                            >
                              <option value="">— Sin match —</option>
                              {(productos ?? [])
                                .filter((p) => p.activo)
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.nombre} ({p.stock_actual} {p.unidad})
                                  </option>
                                ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ TAB: PAGOS ═══ */}
      {tab === 'pagos' && (
        <div>
          {/* Calendario consolidado de cuenta corriente: qué hay que abonar
              atrasado + cuánto cae cada uno de los próximos 7 días, sumando
              ambos locales. Self-contained: ignora el selector de local. */}
          <CalendarioPagosCtaCte onIrAProveedor={irAProveedor} />

          {/* Resumen mensual — compacto (1 línea). El detalle de qué pagar y
              cuándo ya vive en el calendario de arriba; esto es solo el pulso
              del mes de compra del local seleccionado. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-border bg-white px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-semibold text-gray-700">
                {local === 'vedia' ? 'Rodziny Vedia' : 'Rodziny Saavedra'}
              </span>
              <span className="text-gray-500">
                Comprado{' '}
                <strong className="text-gray-900">{formatARS(pagosKpis.totalMes)}</strong>{' '}
                <span className="text-gray-400">({pagosKpis.cantMes})</span>
              </span>
              <span className="text-gray-500">
                Pagado <strong className="text-green-600">{formatARS(pagosKpis.pagadoMes)}</strong>
              </span>
              <span className="text-gray-500">
                Resta{' '}
                <strong
                  className={cn(
                    pagosKpis.totalMes - pagosKpis.pagadoMes > 0
                      ? 'text-red-600'
                      : 'text-green-600',
                  )}
                >
                  {formatARS(pagosKpis.totalMes - pagosKpis.pagadoMes)}
                </strong>
              </span>
            </div>
            <input
              type="month"
              value={mesPagos}
              onChange={(e) => setMesPagos(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-rodziny-500"
            />
          </div>

          {/* Buscador por proveedor */}
          <div className="mb-4 flex items-center gap-3">
            <div className="relative max-w-sm flex-1">
              <input
                type="text"
                placeholder="Buscar proveedor..."
                value={filtroProveedor}
                onChange={(e) => {
                  setFiltroProveedor(e.target.value);
                  setProveedorObjetivo(null);
                }}
                list="proveedores-pagos-list"
                className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-8 text-sm focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                🔍
              </span>
              {filtroProveedor && (
                <button
                  onClick={() => {
                    setFiltroProveedor('');
                    setProveedorObjetivo(null);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 hover:text-gray-600"
                >
                  &times;
                </button>
              )}
              <datalist id="proveedores-pagos-list">
                {proveedoresPagos.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            {filtroProveedor && pagosFiltrados.length > 0 && (
              <p className="text-xs text-gray-500">
                {pagosFiltrados.length} resultado{pagosFiltrados.length !== 1 ? 's' : ''}
              </p>
            )}
            {/* Volver a ver toda la lista tras filtrar/saltar desde el calendario */}
            {filtroProveedor && (
              <button
                onClick={() => {
                  setFiltroProveedor('');
                  setProveedorObjetivo(null);
                }}
                className="flex items-center gap-1 whitespace-nowrap rounded-full border border-rodziny-300 bg-rodziny-50 px-3 py-1.5 text-xs font-medium text-rodziny-700 transition-colors hover:bg-rodziny-100"
              >
                ← Ver todos
              </button>
            )}
          </div>

          {/* Resumen del proveedor filtrado */}
          {resumenProveedor && (
            <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-purple-900">
                    {resumenProveedor.nombre}
                  </h4>
                  <p className="text-[10px] text-purple-600">
                    {vistaResumenProv === 'mes'
                      ? `Vista mensual (${mesPagos})`
                      : `Vista anual (${mesPagos.split('-')[0]})`}
                  </p>
                </div>
                <div className="flex overflow-hidden rounded-md border border-purple-300 bg-white text-xs">
                  <button
                    onClick={() => setVistaResumenProv('mes')}
                    className={cn(
                      'px-3 py-1 transition-colors',
                      vistaResumenProv === 'mes'
                        ? 'bg-purple-600 text-white'
                        : 'text-purple-700 hover:bg-purple-100',
                    )}
                  >
                    Mensual
                  </button>
                  <button
                    onClick={() => setVistaResumenProv('año')}
                    className={cn(
                      'px-3 py-1 transition-colors',
                      vistaResumenProv === 'año'
                        ? 'bg-purple-600 text-white'
                        : 'text-purple-700 hover:bg-purple-100',
                    )}
                  >
                    Anual
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="mb-0.5 text-xs text-purple-600">
                    Total comprado ({resumenProveedor.cantCompras})
                  </p>
                  <p className="text-lg font-bold text-purple-900">
                    {formatARS(resumenProveedor.totalCompras)}
                  </p>
                </div>
                <div>
                  <p className="mb-0.5 text-xs text-purple-600">Pagado en período</p>
                  <p className="text-lg font-bold text-green-600">
                    {formatARS(resumenProveedor.totalPagado)}
                  </p>
                </div>
                <div>
                  <p className="mb-0.5 text-xs text-purple-600">
                    Deuda total ({resumenProveedor.cantPendientes})
                  </p>
                  <p
                    className={cn(
                      'text-lg font-bold',
                      resumenProveedor.totalPendiente > 0 ? 'text-red-600' : 'text-green-600',
                    )}
                  >
                    {formatARS(resumenProveedor.totalPendiente)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Vista de pagos: agrupada por proveedor (pendientes) o tabla flat (pagados) */}
          {filtroPagos === 'pagados' ? (
          <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                      Vencimiento
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                      Proveedor
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">
                      Categoría
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">
                      Importe
                    </th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">
                      Estado
                    </th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">
                      Medio pago
                    </th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600">
                      Fecha pago
                    </th>
                    <th className="w-28 px-4 py-2.5 text-center text-xs font-semibold text-gray-600">
                      Acción
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                        No hay pagos registrados
                      </td>
                    </tr>
                  ) : (
                    pagosFiltrados.map((g) => {
                      const hoy = new Date().toISOString().split('T')[0];
                      const en7dias = new Date(Date.now() + 7 * 86400000)
                        .toISOString()
                        .split('T')[0];
                      const pagado = g.estado_pago?.toLowerCase() === 'pagado';
                      const vencido = !pagado && g.fecha_vencimiento && g.fecha_vencimiento < hoy;
                      const proxSemana =
                        !pagado &&
                        !vencido &&
                        g.fecha_vencimiento &&
                        g.fecha_vencimiento <= en7dias;
                      const pagoInfo = pagosGastosMap.get(g.id);
                      return (
                        <tr
                          key={g.id}
                          className={cn(
                            'border-b border-gray-50 hover:bg-gray-50',
                            pagado && 'bg-green-50/40',
                            vencido && 'bg-red-50',
                            proxSemana && 'bg-orange-50',
                          )}
                        >
                          <td className="px-4 py-2 font-medium">
                            {g.fecha_vencimiento ? (
                              <span
                                className={cn(
                                  vencido
                                    ? 'text-red-600'
                                    : proxSemana
                                      ? 'text-orange-600'
                                      : 'text-gray-900',
                                )}
                              >
                                {new Date(g.fecha_vencimiento + 'T12:00:00').toLocaleDateString(
                                  'es-AR',
                                  { day: '2-digit', month: 'short' },
                                )}
                              </span>
                            ) : (
                              <span className="text-gray-300">Sin fecha</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-gray-900">{g.proveedor || '—'}</td>
                          <td className="px-4 py-2 text-xs text-gray-600">
                            {g.subcategoria || g.categoria}
                          </td>
                          <td className="px-4 py-2 text-right font-medium text-gray-900">
                            {formatARS(g.importe_total)}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {pagado ? (
                              <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                Pagado
                              </span>
                            ) : vencido ? (
                              <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                Vencido
                              </span>
                            ) : proxSemana ? (
                              <span className="inline-block rounded bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                                Próximo
                              </span>
                            ) : (
                              <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                A pagar
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-center text-xs text-gray-600">
                            {pagoInfo
                              ? (MEDIO_PAGO_LABEL[pagoInfo.medio_pago as MedioPago] ??
                                pagoInfo.medio_pago)
                              : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-center text-xs text-gray-600">
                            {pagoInfo
                              ? new Date(pagoInfo.fecha_pago + 'T12:00:00').toLocaleDateString(
                                  'es-AR',
                                  { day: '2-digit', month: 'short' },
                                )
                              : '—'}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {!pagado ? (
                              <button
                                onClick={() => abrirModalPagoCompra(g)}
                                className="rounded border border-green-300 px-2 py-1 text-xs text-green-700 transition-colors hover:bg-green-50"
                              >
                                Registrar pago
                              </button>
                            ) : (
                              <button
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      `¿Revertir el pago de ${g.proveedor || 'sin proveedor'} por ${formatARS(g.importe_total)}?\n\nEl gasto vuelve a Pendiente para poder pagarlo de nuevo con el medio correcto.`,
                                    )
                                  )
                                    return;
                                  // Volver el gasto a Pendiente, manteniendo la fecha_vencimiento
                                  // original (si la tenía). Resetearla a null hacía que el gasto
                                  // cayera al final del query (ordenado por venc ASC, limit 500)
                                  // y "desapareciera" del listado.
                                  await supabase
                                    .from('gastos')
                                    .update({ estado_pago: 'Pendiente' })
                                    .eq('id', g.id);
                                  // Liberar el movimiento bancario que se haya auto-conciliado
                                  // con este pago para que pueda matchearse contra el pago
                                  // correcto cuando se vuelva a registrar.
                                  await supabase
                                    .from('movimientos_bancarios')
                                    .update({ gasto_id: null })
                                    .eq('gasto_id', g.id);
                                  await supabase.from('pagos_gastos').delete().eq('gasto_id', g.id);
                                  qc.invalidateQueries({ queryKey: ['gastos_pagos'] });
                                  qc.invalidateQueries({ queryKey: ['pagos_gastos_compras'] });
                                  qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
                                  qc.invalidateQueries({ queryKey: ['gastos_listado'] });
                                  qc.invalidateQueries({ queryKey: ['movimientos_bancarios'] });
                                }}
                                className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50"
                              >
                                Revertir
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          ) : gruposPendientes.length === 0 && gruposSoloPagados.length === 0 ? (
            <div className="rounded-lg border border-surface-border bg-white p-8 text-center text-sm text-gray-400">
              {filtroPagos === 'vencidos'
                ? 'Sin gastos vencidos 🎉'
                : filtroPagos === 'hoy'
                  ? 'Nada que pagar hoy 🎉'
                  : filtroPagos === 'semana'
                    ? 'Sin vencimientos en los próximos 7 días'
                    : filtroProveedor
                      ? `Sin gastos pendientes para "${filtroProveedor}"`
                      : 'Sin gastos pendientes de pago'}
            </div>
          ) : (
            <div className="space-y-2">
              {gruposPendientes.map((grupo) => {
                // Grupo "objetivo": al que se saltó desde el calendario. Se matchea
                // por el nombre crudo del gasto (mismo string que usa el calendario).
                const esObjetivo =
                  !!proveedorObjetivo &&
                  grupo.gastos.some(
                    (g) => (g.proveedor ?? '').trim().toLowerCase() === proveedorObjetivo,
                  );
                const expandido = proveedoresExpandidos.has(grupo.proveedor) || esObjetivo;
                const idsGrupo = grupo.gastos.map((g) => g.id);
                const todosTildados = idsGrupo.every((id) => seleccionados.has(id));
                const algunoTildado = idsGrupo.some((id) => seleccionados.has(id));
                return (
                  <div
                    key={grupo.proveedor}
                    id={esObjetivo ? 'lista-pagos-objetivo' : undefined}
                    className={cn(
                      'overflow-hidden rounded-lg border bg-white transition-colors',
                      esObjetivo
                        ? 'border-rodziny-400 ring-2 ring-rodziny-300'
                        : grupo.cantVencidos > 0
                          ? 'border-red-200'
                          : 'border-surface-border',
                    )}
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={todosTildados}
                        ref={(el) => {
                          if (el) el.indeterminate = !todosTildados && algunoTildado;
                        }}
                        onChange={() =>
                          toggleSeleccionarTodosProveedor(grupo.proveedor, grupo.gastos)
                        }
                        className="h-4 w-4 cursor-pointer accent-rodziny-500"
                        title="Tildar/destildar todos del proveedor"
                      />
                      <button
                        onClick={() => toggleProveedorExpandido(grupo.proveedor)}
                        className="flex flex-1 items-center justify-between gap-3 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-gray-400">{expandido ? '▼' : '▶'}</span>
                          <span className="font-medium text-gray-900">{grupo.proveedor}</span>
                          {grupo.cantPendientes > 0 && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                              {grupo.cantPendientes} pendiente
                              {grupo.cantPendientes !== 1 ? 's' : ''}
                            </span>
                          )}
                          {grupo.cantVencidos > 0 && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                              {grupo.cantVencidos} vencido
                              {grupo.cantVencidos !== 1 ? 's' : ''}
                            </span>
                          )}
                          {grupo.cantPagadosMes > 0 && (
                            <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                              {grupo.cantPagadosMes} pagado
                              {grupo.cantPagadosMes !== 1 ? 's' : ''} en el mes
                            </span>
                          )}
                          {grupo.proxVenc && (
                            <span className="text-xs text-gray-500">
                              Próx. vto:{' '}
                              {new Date(
                                grupo.proxVenc + 'T12:00:00',
                              ).toLocaleDateString('es-AR', {
                                day: '2-digit',
                                month: 'short',
                              })}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-gray-500">Saldo total</p>
                          <p
                            className={cn(
                              'text-base font-bold',
                              grupo.cantVencidos > 0 ? 'text-red-600' : 'text-gray-900',
                            )}
                          >
                            {formatARS(grupo.total)}
                          </p>
                        </div>
                      </button>
                    </div>

                    {expandido && (
                      <div className="border-t border-gray-100 bg-gray-50/50">
                        {grupo.cantPendientes > 0 && (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100 text-xs text-gray-500">
                              <th className="w-10 px-4 py-1.5"></th>
                              <th className="px-3 py-1.5 text-left font-medium">
                                Vencimiento
                              </th>
                              <th className="px-3 py-1.5 text-left font-medium">Categoría</th>
                              <th className="px-3 py-1.5 text-right font-medium">Importe</th>
                              <th className="px-3 py-1.5 text-center font-medium">Estado</th>
                              <th className="w-28 px-3 py-1.5 text-center font-medium">
                                Pagar solo
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {grupo.gastos.map((g) => {
                              const hoy = new Date().toISOString().split('T')[0];
                              const en7dias = new Date(Date.now() + 7 * 86400000)
                                .toISOString()
                                .split('T')[0];
                              const vencido =
                                g.fecha_vencimiento && g.fecha_vencimiento < hoy;
                              const proxSemana =
                                !vencido &&
                                g.fecha_vencimiento &&
                                g.fecha_vencimiento <= en7dias;
                              const tildado = seleccionados.has(g.id);
                              return (
                                <tr
                                  key={g.id}
                                  className={cn(
                                    'border-b border-gray-100 last:border-0',
                                    tildado ? 'bg-rodziny-50/60' : 'hover:bg-white',
                                  )}
                                >
                                  <td className="px-4 py-1.5">
                                    <input
                                      type="checkbox"
                                      checked={tildado}
                                      onChange={() => toggleSeleccion(g.id)}
                                      className="h-4 w-4 cursor-pointer accent-rodziny-500"
                                    />
                                  </td>
                                  <td className="px-3 py-1.5">
                                    {g.fecha_vencimiento ? (
                                      <span
                                        className={cn(
                                          vencido
                                            ? 'font-medium text-red-600'
                                            : proxSemana
                                              ? 'text-orange-600'
                                              : 'text-gray-700',
                                        )}
                                      >
                                        {new Date(
                                          g.fecha_vencimiento + 'T12:00:00',
                                        ).toLocaleDateString('es-AR', {
                                          day: '2-digit',
                                          month: 'short',
                                        })}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-gray-400">Sin fecha</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-xs text-gray-600">
                                    {g.subcategoria || g.categoria}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-medium text-gray-900">
                                    {formatARS(g.importe_total)}
                                  </td>
                                  <td className="px-3 py-1.5 text-center">
                                    {vencido ? (
                                      <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                                        Vencido
                                      </span>
                                    ) : proxSemana ? (
                                      <span className="inline-block rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                                        Próximo
                                      </span>
                                    ) : (
                                      <span className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                                        A pagar
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-center">
                                    <button
                                      onClick={() => abrirModalPagoCompra(g)}
                                      className="rounded border border-green-300 px-2 py-0.5 text-xs text-green-700 transition-colors hover:bg-green-50"
                                    >
                                      Pagar
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        )}

                        {/* Historial: pagados del mes de este proveedor.
                            No desaparecen al pagarse, quedan visibles para
                            control. Para revertir un pago se usa el botón
                            "Revertir" desde el listado de Gastos. */}
                        {grupo.cantPagadosMes > 0 && (
                          <div className={cn(grupo.cantPendientes > 0 && 'border-t border-gray-200')}>
                            <div className="flex items-center justify-between bg-green-50/50 px-4 py-1.5 text-xs">
                              <span className="font-medium text-green-800">
                                ✓ Pagados del mes ({grupo.cantPagadosMes})
                              </span>
                              <span className="tabular-nums font-semibold text-green-900">
                                {formatARS(grupo.totalPagadoMes)}
                              </span>
                            </div>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-gray-100 text-xs text-gray-500">
                                  <th className="w-10 px-4 py-1.5"></th>
                                  <th className="px-3 py-1.5 text-left font-medium">Fecha pago</th>
                                  <th className="px-3 py-1.5 text-left font-medium">Categoría</th>
                                  <th className="px-3 py-1.5 text-right font-medium">Importe</th>
                                  <th className="px-3 py-1.5 text-center font-medium">Medio</th>
                                  <th className="w-28 px-3 py-1.5"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {grupo.pagadosMes.map((g) => {
                                  const pago = pagosGastosMap.get(g.id);
                                  return (
                                    <tr key={g.id} className="border-b border-gray-100 bg-green-50/20 last:border-0">
                                      <td className="px-4 py-1.5"></td>
                                      <td className="px-3 py-1.5 text-gray-700">
                                        {pago
                                          ? new Date(pago.fecha_pago + 'T12:00:00').toLocaleDateString('es-AR', {
                                              day: '2-digit',
                                              month: 'short',
                                            })
                                          : '—'}
                                      </td>
                                      <td className="px-3 py-1.5 text-xs text-gray-600">
                                        {g.subcategoria || g.categoria}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-medium text-gray-700 tabular-nums">
                                        {formatARS(g.importe_total)}
                                      </td>
                                      <td className="px-3 py-1.5 text-center text-xs text-gray-600">
                                        {pago
                                          ? (MEDIO_PAGO_LABEL[pago.medio_pago as MedioPago] ??
                                            pago.medio_pago)
                                          : '—'}
                                      </td>
                                      <td className="px-3 py-1.5"></td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Proveedores con saldo $0 (solo pagados del mes) — colapsados en
                  una sola línea para no ensuciar la lista de deuda viva. */}
              {gruposSoloPagados.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-green-200 bg-white">
                  <button
                    onClick={() => setPagadosExpandido((v) => !v)}
                    className="flex w-full items-center justify-between gap-3 bg-green-50/60 px-4 py-3 text-left transition-colors hover:bg-green-50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-gray-400">{pagadosExpandido ? '▼' : '▶'}</span>
                      <span className="font-medium text-green-900">✓ Pagados en el mes</span>
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                        {gruposSoloPagados.length} proveedor
                        {gruposSoloPagados.length !== 1 ? 'es' : ''} · {resumenSoloPagados.cantPagos}{' '}
                        pago{resumenSoloPagados.cantPagos !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-gray-500">Total pagado</p>
                      <p className="text-base font-bold text-green-700">
                        {formatARS(resumenSoloPagados.total)}
                      </p>
                    </div>
                  </button>

                  {pagadosExpandido && (
                    <div className="divide-y divide-gray-100 border-t border-gray-100">
                      {gruposSoloPagados.map((grupo) => (
                        <div
                          key={grupo.proveedor}
                          className="flex items-center justify-between gap-3 px-4 py-2"
                        >
                          <span className="font-medium text-gray-800">{grupo.proveedor}</span>
                          <span className="flex items-center gap-3">
                            <span className="text-xs text-gray-400">
                              {grupo.cantPagadosMes} pago{grupo.cantPagadosMes !== 1 ? 's' : ''}
                            </span>
                            <span className="tabular-nums font-semibold text-gray-700">
                              {formatARS(grupo.totalPagadoMes)}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {seleccionInfo.gastos.length > 0 && (
            <div className="sticky bottom-4 z-10 mt-4 flex justify-center">
              <div className="flex items-center gap-3 rounded-full border border-rodziny-200 bg-white px-4 py-2 shadow-lg">
                <span className="text-sm text-gray-600">
                  {seleccionInfo.gastos.length} pago
                  {seleccionInfo.gastos.length !== 1 ? 's' : ''} ·{' '}
                  <span className="font-bold text-gray-900">
                    {formatARS(seleccionInfo.total)}
                  </span>
                  {seleccionInfo.proveedores.length > 1 && (
                    <span className="ml-1 text-xs text-orange-600">
                      ⚠ {seleccionInfo.proveedores.length} proveedores distintos
                    </span>
                  )}
                </span>
                <button
                  onClick={() => setSeleccionados(new Set())}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Limpiar
                </button>
                <button
                  onClick={abrirBulkPago}
                  className="rounded-full bg-green-600 px-4 py-1.5 text-sm font-semibold text-white shadow hover:bg-green-700"
                >
                  Pagar selección
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: PROVEEDORES ═══ */}
      {tab === 'conciliacion' && <ConciliacionTab />}

      {tab === 'proveedores' && <ProveedoresPanel />}

      {/* Pantalla nueva: Nuevo gasto con OCR (flujo simple para los 3 admins).
          Sirve también para "Cargar gasto" de un remito: recibe el prefill con
          local/proveedor/items/recepcion_id y muestra el chooser de tipo de pago. */}
      <NuevoGastoForm
        open={nuevoGastoFormOpen}
        prefill={prefillGasto}
        onClose={() => {
          setNuevoGastoFormOpen(false);
          setPrefillGasto(undefined);
        }}
        onCreated={() => {
          // Invalidar la query del listado para refrescar después de crear
          // (no necesita acción extra: el modal se queda en step="done" y el usuario cierra)
        }}
      />

      {/* Modal único de pago — canónico */}
      <PagarGastoModal
        open={!!gastoAPagar}
        gasto={gastoAPagar}
        onClose={() => setGastoAPagar(null)}
      />

      {/* Modal de pago BULK (varios gastos juntos) */}
      {bulkPagoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-4 w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-xl">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                Pagar {seleccionInfo.gastos.length} gasto
                {seleccionInfo.gastos.length !== 1 ? 's' : ''} juntos
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {seleccionInfo.proveedores.length === 1
                  ? seleccionInfo.proveedores[0]
                  : `${seleccionInfo.proveedores.length} proveedores`}{' '}
                — Total{' '}
                <span className="font-semibold text-gray-800">
                  {formatARS(seleccionInfo.total)}
                </span>
              </p>
            </div>

            {/* Detalle de gastos a pagar */}
            <div className="max-h-32 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
              {seleccionInfo.gastos.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="truncate">
                    {g.fecha_vencimiento
                      ? new Date(g.fecha_vencimiento + 'T12:00:00').toLocaleDateString(
                          'es-AR',
                          { day: '2-digit', month: 'short' },
                        )
                      : '—'}{' '}
                    · {g.proveedor || 'Sin prov.'} · {g.subcategoria || g.categoria}
                  </span>
                  <span className="shrink-0 font-medium">{formatARS(g.importe_total)}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Fecha de pago
                </label>
                <input
                  type="date"
                  value={bulkFecha}
                  onChange={(e) => setBulkFecha(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Medio de pago
                </label>
                <select
                  value={bulkMedio}
                  onChange={(e) => setBulkMedio(e.target.value as MedioPago)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                >
                  {Object.entries(MEDIO_PAGO_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                N° de operación{' '}
                {bulkMedio === 'efectivo' ? (
                  <span className="text-gray-400">(opcional)</span>
                ) : (
                  <span className="text-red-600">*</span>
                )}
              </label>
              <input
                type="text"
                value={bulkReferencia}
                onChange={(e) => setBulkReferencia(e.target.value)}
                placeholder="Nº transferencia, cheque, etc."
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-mono"
              />
              {bulkMedio !== 'efectivo' && (
                <p className="mt-1 text-[11px] text-gray-500">
                  Una sola operación cubre todo el bulk. Copiala del comprobante.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Comprobante de pago{' '}
                {bulkMedio === 'efectivo' ? (
                  <span className="text-gray-400">(opcional)</span>
                ) : (
                  <span className="text-red-600">* (voucher único)</span>
                )}
              </label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setBulkComprobante(e.target.files?.[0] ?? null)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-rodziny-50 file:px-2 file:py-1 file:text-rodziny-700"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Factura del proveedor{' '}
                <span className="text-gray-400">
                  (opcional, se asigna a los gastos sin factura)
                </span>
              </label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setBulkFactura(e.target.files?.[0] ?? null)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-rodziny-50 file:px-2 file:py-1 file:text-rodziny-700"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Notas <span className="text-gray-400">(opcional)</span>
              </label>
              <textarea
                value={bulkNotas}
                onChange={(e) => setBulkNotas(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>

            {bulkError && (
              <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
                {bulkError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={cerrarBulkPago}
                disabled={bulkGuardando}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarBulkPago}
                disabled={bulkGuardando}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {bulkGuardando
                  ? 'Guardando...'
                  : `Confirmar pago · ${formatARS(seleccionInfo.total)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {cierreInventarioModalAbierto && (
        <CierreInventarioModal
          local={local}
          onClose={() => setCierreInventarioModalAbierto(false)}
        />
      )}
    </PageContainer>
  );
}

// ── Modal: Crear / Editar producto ─────────────────────────────────────────

function ModalProducto({
  producto,
  local,
  categoriasExistentes,
  proveedoresExistentes,
  onClose,
  onSaved,
}: {
  producto: Producto | null; // null = nuevo
  local: string;
  categoriasExistentes: string[];
  proveedoresExistentes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(producto?.nombre ?? '');
  const [marca, setMarca] = useState(producto?.marca ?? '');
  const [categoria, setCategoria] = useState(producto?.categoria ?? '');
  const [unidad, setUnidad] = useState(producto?.unidad ?? 'unidad');
  const [stockMinimo, setStockMinimo] = useState(producto ? String(producto.stock_minimo) : '0');
  const [proveedor, setProveedor] = useState(producto?.proveedor ?? '');
  const [costoUnitario, setCostoUnitario] = useState(
    producto ? String(producto.costo_unitario) : '0',
  );
  // Contenido en ml por unidad: solo aplica cuando la unidad de compra es un
  // envase discreto (botella/lata/etc). Permite costear copas/shots y recetas
  // que usen el insumo en ml/oz.
  const [contenidoMl, setContenidoMl] = useState(
    producto?.contenido_ml != null ? String(producto.contenido_ml) : '',
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // El campo aparece para envases discretos. "kg" y "litro" no lo necesitan
  // porque ya están en una unidad medible.
  const unidadEsEnvase = [
    'unidad',
    'paquete',
    'caja',
    'bolsa',
    'botella',
    'lata',
  ].includes(unidad);

  async function guardar() {
    if (!nombre.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    if (!categoria.trim()) {
      setError('La categoría es obligatoria');
      return;
    }
    setGuardando(true);
    setError('');

    const contenidoMlNum = (() => {
      if (!unidadEsEnvase) return null;
      const raw = contenidoMl.trim().replace(',', '.');
      if (raw === '') return null;
      const n = parseFloat(raw);
      return isFinite(n) && n > 0 ? n : null;
    })();

    const payload = {
      nombre: nombre.trim(),
      marca: marca.trim() || null,
      categoria: categoria.trim(),
      unidad: unidad.trim() || 'unidad',
      stock_minimo: parseFloat(stockMinimo.replace(',', '.')) || 0,
      proveedor: proveedor.trim() || '',
      costo_unitario: parseFloat(costoUnitario.replace(',', '.')) || 0,
      contenido_ml: contenidoMlNum,
      local,
      updated_at: new Date().toISOString(),
    };

    try {
      if (producto) {
        const { error: err } = await supabase
          .from('productos')
          .update(payload)
          .eq('id', producto.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from('productos')
          .insert({ ...payload, stock_actual: 0, activo: true });
        if (err) throw err;
      }
      onSaved();
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar');
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-gray-800">
          {producto ? 'Editar producto' : 'Nuevo producto'}
        </h3>

        {error && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">Nombre *</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Marca</label>
            <input
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              placeholder="Ej: La Salteña"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Categoría *</label>
            <input
              list="cats-list"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <datalist id="cats-list">
              {categoriasExistentes.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Unidad</label>
            <select
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="unidad">unidad</option>
              <option value="kg">kg</option>
              <option value="litro">litro</option>
              <option value="paquete">paquete</option>
              <option value="caja">caja</option>
              <option value="bolsa">bolsa</option>
              <option value="botella">botella</option>
              <option value="lata">lata</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Stock mínimo</label>
            <input
              type="number"
              step="any"
              value={stockMinimo}
              onChange={(e) => setStockMinimo(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Proveedor</label>
            <input
              list="provs-list"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <datalist id="provs-list">
              {proveedoresExistentes.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Costo unitario ($)
            </label>
            <input
              type="number"
              step="any"
              value={costoUnitario}
              onChange={(e) => setCostoUnitario(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>

          {unidadEsEnvase && (
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Contenido (ml) — opcional
              </label>
              <input
                type="number"
                step="any"
                value={contenidoMl}
                onChange={(e) => setContenidoMl(e.target.value)}
                placeholder="Ej: 750 (botella de vino), 354 (lata)"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
              <p className="mt-1 text-[10px] text-gray-500">
                Cargá esto si vendés el insumo en copas/shots o lo usás en tragos.
                Permite costear en ml/oz. Dejá vacío si no aplica.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded-md bg-rodziny-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : producto ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Ajuste de inventario ─────────────────────────────────────────────

function ModalAjusteInventario({
  productos,
  local,
  onClose,
  onSaved,
}: {
  productos: Producto[];
  local: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [productoId, setProductoId] = useState('');
  const [stockReal, setStockReal] = useState('');
  const [motivo, setMotivo] = useState('Inventario físico');
  const [responsable, setResponsable] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [resultados, setResultados] = useState<
    { nombre: string; anterior: number; nuevo: number; diff: number }[]
  >([]);

  const prodSel = productos.find((p) => p.id === productoId);
  const diff = prodSel && stockReal !== '' ? Number(stockReal) - prodSel.stock_actual : null;

  async function guardar() {
    if (!productoId || stockReal === '') {
      setError('Seleccioná un producto e ingresá el stock real');
      return;
    }
    const nuevoStock = Number(stockReal);
    if (isNaN(nuevoStock) || nuevoStock < 0) {
      setError('Stock inválido');
      return;
    }
    if (!prodSel) return;

    setGuardando(true);
    setError('');

    const diferencia = nuevoStock - prodSel.stock_actual;

    // Registrar movimiento de ajuste
    const { error: errMov } = await supabase.from('movimientos_stock').insert({
      local,
      producto_id: prodSel.id,
      producto_nombre: prodSel.nombre,
      tipo: diferencia >= 0 ? 'entrada' : 'salida',
      cantidad: Math.abs(diferencia),
      unidad: prodSel.unidad,
      motivo: motivo || 'Inventario físico',
      observacion: `Ajuste: stock ${prodSel.stock_actual} → ${nuevoStock} (dif: ${diferencia > 0 ? '+' : ''}${diferencia})`,
      registrado_por: responsable.trim() || null,
    });
    if (errMov) {
      setError(errMov.message);
      setGuardando(false);
      return;
    }

    // Actualizar stock del producto
    const { error: errProd } = await supabase
      .from('productos')
      .update({ stock_actual: nuevoStock, updated_at: new Date().toISOString() })
      .eq('id', prodSel.id);
    if (errProd) {
      setError(errProd.message);
      setGuardando(false);
      return;
    }

    setResultados((prev) => [
      ...prev,
      {
        nombre: prodSel.nombre,
        anterior: prodSel.stock_actual,
        nuevo: nuevoStock,
        diff: diferencia,
      },
    ]);

    // Limpiar para el próximo producto
    setProductoId('');
    setStockReal('');
    setGuardando(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-bold text-gray-800">Ajuste de inventario</h3>
        <p className="mb-4 text-xs text-gray-500">
          Ingresá el stock real contado. El sistema calcula la diferencia y registra el movimiento.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Producto</label>
            <select
              value={productoId}
              onChange={(e) => {
                setProductoId(e.target.value);
                setStockReal('');
              }}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="">Seleccionar producto...</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} (stock actual: {p.stock_actual} {p.unidad})
                </option>
              ))}
            </select>
          </div>

          {prodSel && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Stock en sistema</label>
                <div className="rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium">
                  {prodSel.stock_actual} {prodSel.unidad}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Stock real (contado)</label>
                <input
                  type="number"
                  step="any"
                  value={stockReal}
                  onChange={(e) => setStockReal(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                  placeholder="Cantidad real"
                  autoFocus
                />
              </div>
            </div>
          )}

          {diff !== null && stockReal !== '' && (
            <div
              className={cn(
                'rounded p-3 text-center text-sm font-medium',
                diff === 0
                  ? 'bg-green-50 text-green-700'
                  : diff > 0
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-red-50 text-red-700',
              )}
            >
              {diff === 0
                ? 'Sin diferencia — stock correcto'
                : diff > 0
                  ? `+${diff} ${prodSel?.unidad} (faltaban en el sistema)`
                  : `${diff} ${prodSel?.unidad} (sobraban en el sistema)`}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Motivo</label>
              <select
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="Inventario físico">Inventario físico</option>
                <option value="Corrección de stock">Corrección de stock</option>
                <option value="Conteo de cierre">Conteo de cierre</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Responsable</label>
              <input
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                placeholder="Nombre"
              />
            </div>
          </div>
        </div>

        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

        {/* Resultados de ajustes ya hechos en esta sesión */}
        {resultados.length > 0 && (
          <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
            <p className="mb-2 text-xs font-semibold text-gray-600">
              Ajustes realizados ({resultados.length}):
            </p>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {resultados.map((r, i) => (
                <div key={i} className="flex justify-between text-xs text-gray-700">
                  <span>{r.nombre}</span>
                  <span
                    className={cn(
                      'font-medium',
                      r.diff > 0 ? 'text-blue-600' : r.diff < 0 ? 'text-red-600' : 'text-green-600',
                    )}
                  >
                    {r.anterior} → {r.nuevo} ({r.diff > 0 ? '+' : ''}
                    {r.diff})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => {
              if (resultados.length > 0) onSaved();
              else onClose();
            }}
            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            {resultados.length > 0 ? 'Listo' : 'Cancelar'}
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !productoId || stockReal === '' || diff === 0}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Ajustar y siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Fusionar producto duplicado en otro ──────────────────────────────
function ModalFusionarProducto({
  duplicado,
  candidatos,
  onClose,
  onDone,
}: {
  duplicado: Producto;
  candidatos: Producto[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [masterId, setMasterId] = useState<string>('');
  const [confirmando, setConfirmando] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);
  const [error, setError] = useState('');
  const [resumen, setResumen] = useState<{
    ingredientes_reasignados: number;
    movimientos_reasignados: number;
    stock_transferido: number;
  } | null>(null);

  const opciones = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    const base = candidatos.filter((c) => c.activo);
    if (!q) return base.slice(0, 50);
    return base
      .filter(
        (c) =>
          c.nombre.toLowerCase().includes(q) ||
          (c.marca ?? '').toLowerCase().includes(q) ||
          (c.categoria ?? '').toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [candidatos, busqueda]);

  // Auto-pre-select: si hay una coincidencia obvia (nombre similar)
  useMemo(() => {
    if (masterId || !duplicado) return;
    const nombreLower = duplicado.nombre.toLowerCase().trim();
    const match = candidatos.find((c) => {
      const n = c.nombre.toLowerCase().trim();
      return n !== nombreLower && (n.startsWith(nombreLower) || nombreLower.startsWith(n));
    });
    if (match) setMasterId(match.id);
  }, [duplicado, candidatos, masterId]);

  const master = candidatos.find((c) => c.id === masterId);

  async function fusionar() {
    if (!masterId) {
      setError('Elegí con qué producto fusionar');
      return;
    }
    setEjecutando(true);
    setError('');
    const { data, error: err } = await supabase.rpc('fusionar_producto', {
      p_duplicado_id: duplicado.id,
      p_master_id: masterId,
    });
    setEjecutando(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (!data?.ok) {
      setError('Error desconocido');
      return;
    }
    setResumen({
      ingredientes_reasignados: data.ingredientes_reasignados,
      movimientos_reasignados: data.movimientos_reasignados,
      stock_transferido: data.stock_transferido,
    });
  }

  if (resumen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={onDone} />
        <div className="relative w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
          <h3 className="mb-2 text-base font-semibold text-gray-900">Fusión exitosa</h3>
          <p className="mb-3 text-sm text-gray-600">
            "{duplicado.nombre}" se fusionó en "{master?.nombre}" y se eliminó.
          </p>
          <ul className="space-y-1 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            <li>• {resumen.ingredientes_reasignados} ingredientes de recetas reasignados</li>
            <li>• {resumen.movimientos_reasignados} movimientos de stock reasignados</li>
            <li>
              •{' '}
              {resumen.stock_transferido > 0
                ? `${resumen.stock_transferido} ${duplicado.unidad} de stock transferidos`
                : 'Sin stock que transferir'}
            </li>
          </ul>
          <div className="mt-4 flex justify-end">
            <button
              onClick={onDone}
              className="rounded bg-rodziny-700 px-4 py-1.5 text-sm text-white hover:bg-rodziny-800"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">Fusionar producto duplicado</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Esto elimina "<strong>{duplicado.nombre}</strong>" y reasigna todas sus referencias al
            producto que elijas.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="rounded border border-red-100 bg-red-50 p-3 text-xs text-red-700">
            <p className="mb-1 font-semibold">Se va a eliminar:</p>
            <p>
              {duplicado.nombre} ·{' '}
              <span className="text-red-500">
                {duplicado.stock_actual} {duplicado.unidad}
              </span>{' '}
              · {duplicado.categoria}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">
              Buscar producto master (ganador)
            </label>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, marca o categoría..."
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-[10px] text-gray-400">
              Solo aparecen productos del mismo local ({duplicado.local || 'sin local'}).
            </p>
          </div>

          <div className="max-h-56 overflow-y-auto rounded border border-gray-200">
            {opciones.length === 0 && (
              <p className="p-3 text-center text-xs text-gray-400">Sin resultados</p>
            )}
            {opciones.map((o) => (
              <button
                key={o.id}
                onClick={() => setMasterId(o.id)}
                className={cn(
                  'w-full border-b border-gray-50 px-3 py-2 text-left text-sm last:border-0 hover:bg-gray-50',
                  masterId === o.id && 'bg-rodziny-50 hover:bg-rodziny-50',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800">{o.nombre}</span>
                  <span className="text-[10px] text-gray-500">
                    {o.stock_actual} {o.unidad}
                  </span>
                </div>
                {(o.marca || o.categoria) && (
                  <p className="text-[10px] text-gray-400">
                    {[o.marca, o.categoria].filter(Boolean).join(' · ')}
                  </p>
                )}
              </button>
            ))}
          </div>

          {master && (
            <div className="rounded border border-green-100 bg-green-50 p-3 text-xs text-green-700">
              <p className="mb-1 font-semibold">Producto ganador:</p>
              <p>
                {master.nombre} · {master.stock_actual} {master.unidad} · {master.categoria}
              </p>
              {duplicado.stock_actual > 0 && (
                <p className="mt-1 text-green-600">
                  Stock final: {master.stock_actual + duplicado.stock_actual} {master.unidad} (
                  {master.stock_actual} + {duplicado.stock_actual})
                </p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          {confirmando && masterId && !ejecutando && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <p className="mb-1 font-semibold">⚠ Confirmación</p>
              <p>Esta acción no se puede deshacer. Click "Sí, fusionar" para continuar.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            disabled={ejecutando}
          >
            Cancelar
          </button>
          {!confirmando ? (
            <button
              onClick={() => setConfirmando(true)}
              disabled={!masterId}
              className="rounded bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
            >
              Fusionar...
            </button>
          ) : (
            <button
              onClick={fusionar}
              disabled={ejecutando}
              className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
            >
              {ejecutando ? 'Fusionando...' : 'Sí, fusionar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
