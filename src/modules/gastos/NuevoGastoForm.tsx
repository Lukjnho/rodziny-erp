// NuevoGastoForm — pantalla mobile-first para que Tamara/Karina/Martin carguen un gasto
// con OCR automatico desde foto/PDF del comprobante de pago.
//
// Flujo:
//  1) Usuario sube foto/PDF
//  2) Se calcula SHA256 del archivo y se chequea duplicado exacto en `comprobantes`
//  3) Si no hay duplicado, se sube a Storage `gastos-comprobantes/{local}/{YYYY-MM}/...`
//  4) Se crea fila en `comprobantes` con ocr_status='pending'
//  5) Se invoca edge function ocr-comprobante (Claude Haiku 4.5)
//  6) Se muestra preview con datos extraidos + alerta de duplicado por OCR si lo hay
//  7) Usuario edita/confirma; se crea fila en `gastos` con FK a comprobantes
//  8) Si importe_total >= umbral_minimo de config_aprobaciones: estado_aprobacion='requiere_aprobacion'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { sha256File } from '../../lib/hashFile';
import { procesarFactura } from '../../lib/ocrFactura';
import { procesarComprobantePago } from '../../lib/ocrComprobantePago';
import { formatARS, cn } from '../../lib/utils';
import {
  MEDIO_PAGO_LABEL,
  TIPO_COMPROBANTE_LABEL,
  medioRequiereComprobante,
  type MedioPago,
  type Proveedor,
  type CategoriaGasto,
  type ItemGastoStock,
  type CondicionIVA,
} from './types';

// ----- Props -----

interface NuevoGastoFormProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (gastoId: string) => void;
}

// ----- Tipos internos -----

type TipoGasto = 'digital' | 'efectivo' | 'cuenta_corriente' | 'plan';
type Step = 'tipo' | 'upload' | 'processing' | 'preview' | 'saving' | 'done';

interface OcrExtraido {
  tipo_comprobante: string | null;
  proveedor_nombre: string | null;
  proveedor_cuit: string | null;
  monto: number | null;
  fecha: string | null;
  hora: string | null;
  n_operacion: string | null;
  medio_pago: string | null;
  banco_origen: string | null;
  banco_destino: string | null;
  cbu_destino: string | null;
  alias_destino: string | null;
  concepto: string | null;
  es_transferencia_interna?: boolean;
  confianza: number;
}

// CUITs de la propia empresa — si el OCR los detecta como receptor, es transferencia interna (no gasto)
const RODZINY_CUITS = ['30717352366', '30-71735236-6'];

function esCuitDeRodziny(cuit: string | null | undefined): boolean {
  if (!cuit) return false;
  const limpio = cuit.replace(/\D/g, '');
  return RODZINY_CUITS.some((c) => c.replace(/\D/g, '') === limpio);
}

interface DuplicadoMatch {
  id: string;
  match_type: 'n_operacion' | 'monto_fecha_cuit' | 'hash_archivo';
  gasto_id: string | null;
}

interface OcrResponse {
  ok: boolean;
  comprobante_id?: string;
  ocr_extraido?: OcrExtraido;
  duplicados?: DuplicadoMatch[];
  confianza?: number;
  error?: string;
}

// ----- Helpers de formato moneda AR -----

/** Formatea un numero como string AR sin simbolo: 285453.5 → "285.453,50" */
function formatNumeroAR(value: number): string {
  if (!isFinite(value)) return '';
  const tieneDecimales = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: tieneDecimales ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Parsea un string en formato AR: "285.453,50" → 285453.5 */
function parseNumeroAR(text: string): number | null {
  if (!text || !text.trim()) return null;
  // Quitar todo lo que no sea digito, coma, punto o signo
  let limpio = text.trim().replace(/[^\d,.\-]/g, '');
  // En formato AR: punto = miles, coma = decimal. Sacamos puntos, cambiamos coma por punto.
  limpio = limpio.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(limpio);
  return isFinite(num) ? num : null;
}

// ----- Plan de pagos (varias cuotas sobre una misma factura) -----

/** Una línea del editor de plan de pagos (transferencia + echeq, etc.) */
interface LineaPagoUI {
  key: string; // id local para el render
  medio: MedioPago;
  montoTexto: string; // monto en formato AR (editable)
  fecha: string; // YYYY-MM-DD — fecha en que sale/saldrá la plata (débito del echeq)
  numero: string; // N° de operación (transferencia) o N° de echeq
  comprobantePath: string | null; // path en Storage del comprobante ya subido (OCR)
  comprobanteNombre: string | null; // nombre del archivo para mostrar
  ocrEjecutando: boolean; // OCR en curso
  ocrInfo: string | null; // mensaje del OCR (✓ N° detectado…)
}

let _lineaSeq = 0;
function nuevaLineaPago(medio: MedioPago = 'transferencia_mp', fecha = ''): LineaPagoUI {
  _lineaSeq += 1;
  return {
    key: `lp_${_lineaSeq}`,
    medio,
    montoTexto: '',
    fecha,
    numero: '',
    comprobantePath: null,
    comprobanteNombre: null,
    ocrEjecutando: false,
    ocrInfo: null,
  };
}

// ----- Helpers de error -----

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null) {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      const detalles = (obj.details as string | undefined) || (obj.hint as string | undefined) || (obj.code as string | undefined);
      return detalles ? `${obj.message} [${detalles}]` : String(obj.message);
    }
    try { return JSON.stringify(obj).slice(0, 300); } catch { return '[error sin mensaje]'; }
  }
  return String(e);
}

// ----- Mapeo OCR → MedioPago del proyecto -----

function mapOcrMedioPago(ocrMedio: string | null): MedioPago {
  switch (ocrMedio) {
    case 'transferencia':
    case 'qr':
      return 'transferencia_mp';
    case 'cheque':
      return 'cheque_galicia';
    case 'tarjeta_credito':
    case 'tarjeta_debito':
      return 'tarjeta_icbc';
    case 'efectivo':
      return 'efectivo';
    default:
      return 'otro';
  }
}

// ----- Componente principal -----

export default function NuevoGastoForm({ open, onClose, onCreated }: NuevoGastoFormProps) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>('tipo');
  const [tipoGasto, setTipoGasto] = useState<TipoGasto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Upload state (solo aplica a tipo='digital')
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [comprobanteId, setComprobanteId] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);

  // Factura fiscal (opcional, en ambos caminos)
  const [facturaFile, setFacturaFile] = useState<File | null>(null);
  const facturaInputRef = useRef<HTMLInputElement>(null);
  // OCR de la factura — cuando se selecciona el archivo, dispara extracción async
  // y autocompleta tipo/nro/fecha/total/IVA/proveedor. Si falla, el archivo igual
  // quedó subido y el usuario puede seguir manual.
  const [facturaPathPreSubido, setFacturaPathPreSubido] = useState<string | null>(null);
  const [ocrFacturaEjecutando, setOcrFacturaEjecutando] = useState(false);
  const [ocrFacturaInfo, setOcrFacturaInfo] = useState<string | null>(null);
  const [ocrFacturaWarning, setOcrFacturaWarning] = useState<string | null>(null);
  // Proveedor sugerido por OCR cuando el CUIT NO matchea ningún proveedor existente
  const [crearProveedorSugerido, setCrearProveedorSugerido] = useState<
    { razon_social: string; cuit: string } | null
  >(null);

  // Importe como string formateado (asi se muestra "285.453,50" mientras se edita)
  const [importeTexto, setImporteTexto] = useState<string>('');

  // OCR result
  const [ocrData, setOcrData] = useState<OcrExtraido | null>(null);
  const [ocrConfianza, setOcrConfianza] = useState<number>(0);
  const [duplicados, setDuplicados] = useState<DuplicadoMatch[]>([]);

  // Form preview state
  const [local, setLocal] = useState<'vedia' | 'saavedra' | 'sas'>('vedia');
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  // Proveedor recien creado por el OCR (puede no estar todavia en la query cache)
  const [proveedorRecienCreado, setProveedorRecienCreado] = useState<Proveedor | null>(null);
  const [mensajeProveedor, setMensajeProveedor] = useState<string | null>(null);
  // Alta manual de proveedor desde el mismo form (cuando no está cargado y no hay OCR)
  const [nuevoProvOpen, setNuevoProvOpen] = useState(false);
  const [nuevoProvRazon, setNuevoProvRazon] = useState('');
  const [nuevoProvCuit, setNuevoProvCuit] = useState('');
  const [nuevoProvCondicion, setNuevoProvCondicion] = useState<CondicionIVA | ''>('');
  const [nuevoProvGuardando, setNuevoProvGuardando] = useState(false);
  const [nuevoProvError, setNuevoProvError] = useState<string | null>(null);
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [fecha, setFecha] = useState<string>('');
  const [nOperacion, setNOperacion] = useState<string>('');
  const [medioPago, setMedioPago] = useState<MedioPago>('transferencia_mp');
  const [comentario, setComentario] = useState<string>('');
  const [tipoComprobante, setTipoComprobante] = useState<string>('recibo');
  // N° de la factura/remito (ej: "0008-00001260"). Se guarda en gastos.nro_comprobante.
  // Es distinto del N° de operación del PAGO (nOperacion), que va a pagos_gastos.
  const [nroComprobante, setNroComprobante] = useState<string>('');

  // Discriminación de IVA — opcional, auto-activado para Factura A/B.
  // Cuando está activo: Neto e IVA se calculan a partir de Total + alícuota,
  // y se guardan en gastos.importe_neto e gastos.iva (si no, ambos quedan null).
  const [discriminaIVA, setDiscriminaIVA] = useState<boolean>(false);
  const [alicuotaIVA, setAlicuotaIVA] = useState<number>(21);

  // Estado de pago — controla si se inserta pagos_gastos.
  //  - digital: pagado=true siempre (subió comprobante)
  //  - fisico: default pagado=true (ya lo pagué a mano)
  //  - cuenta_corriente: pagado=false fijo, no se puede tildar
  const [pagado, setPagado] = useState<boolean>(true);
  // Plan de pagos: una factura saldada con varias cuotas (ej: transferencia hoy + 2 echeq
  // a 30/60 días). Cuando está activo, reemplaza el bloque de pago simple por un editor de
  // N líneas cuya suma debe dar el total. Las cuotas con fecha futura se guardan como
  // programado=true (echeq sin debitar). Solo disponible en el flujo "físico".
  const [planPagos, setPlanPagos] = useState<boolean>(false);
  const [lineasPago, setLineasPago] = useState<LineaPagoUI[]>([]);
  // Fecha del pago efectivo (puede diferir de fecha del comprobante). Solo se usa cuando pagado=true.
  const [fechaPago, setFechaPago] = useState<string>('');
  // Fecha en que vence el pago (solo cuando es cuenta corriente y aún no pagaste)
  const [fechaVencimiento, setFechaVencimiento] = useState<string>('');

  // Vincular a stock (solo si la subcategoría seleccionada tiene productos asociados)
  const [vincularStock, setVincularStock] = useState(false);
  const [items, setItems] = useState<ItemGastoStock[]>([]);
  const [busquedaProducto, setBusquedaProducto] = useState('');
  // Drafts de texto para inputs numéricos (cantidad/subtotal): si no, React machaca la coma al re-render
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({});

  // Reset al abrir/cerrar
  useEffect(() => {
    if (!open) {
      // Limpiar estado al cerrar
      setStep('tipo');
      setTipoGasto(null);
      setError(null);
      setWarning(null);
      setFile(null);
      setHash(null);
      setComprobanteId(null);
      setFilePath(null);
      setFacturaFile(null);
      setFacturaPathPreSubido(null);
      setOcrFacturaEjecutando(false);
      setOcrFacturaInfo(null);
      setOcrFacturaWarning(null);
      setCrearProveedorSugerido(null);
      setOcrData(null);
      setOcrConfianza(0);
      setDuplicados([]);
      setProveedorId(null);
      setProveedorRecienCreado(null);
      setMensajeProveedor(null);
      setNuevoProvOpen(false);
      setNuevoProvRazon('');
      setNuevoProvCuit('');
      setNuevoProvCondicion('');
      setNuevoProvGuardando(false);
      setNuevoProvError(null);
      setCategoriaId(null);
      setImporteTexto('');
      setFecha('');
      setNOperacion('');
      setMedioPago('transferencia_mp');
      setComentario('');
      setTipoComprobante('recibo');
      setNroComprobante('');
      setPagado(true);
      setPlanPagos(false);
      setLineasPago([]);
      setFechaPago('');
      setFechaVencimiento('');
      setVincularStock(false);
      setItems([]);
      setBusquedaProducto('');
      setItemDrafts({});
    }
  }, [open]);

  // Queries: proveedores y categorias
  const { data: proveedores = [] } = useQuery<Proveedor[]>({
    queryKey: ['proveedores-activos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proveedores')
        .select('*')
        .eq('activo', true)
        .order('razon_social');
      if (error) throw error;
      return (data ?? []) as Proveedor[];
    },
    enabled: open,
  });

  const { data: categorias = [] } = useQuery<CategoriaGasto[]>({
    queryKey: ['categorias-gasto-activas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categorias_gasto')
        .select('*')
        .eq('activo', true)
        .order('orden');
      if (error) throw error;
      return (data ?? []) as CategoriaGasto[];
    },
    enabled: open,
  });

  // Umbral de aprobacion
  const { data: configAprobaciones } = useQuery<{ umbral_minimo: number; activo: boolean } | null>({
    queryKey: ['config-aprobaciones'],
    queryFn: async () => {
      const { data } = await supabase
        .from('config_aprobaciones')
        .select('umbral_minimo, activo')
        .eq('id', 1)
        .maybeSingle();
      return data;
    },
    enabled: open,
  });

  const umbralAprobacion = configAprobaciones?.activo ? configAprobaciones.umbral_minimo : Infinity;
  // Derivado: el importe como numero, parseado del input texto
  const importeTotal = useMemo(() => parseNumeroAR(importeTexto) ?? 0, [importeTexto]);
  const requiereAprobacion = importeTotal >= umbralAprobacion;

  // Plan de pagos: suma de las cuotas y cuánto falta asignar contra el total.
  const totalPlan = useMemo(
    () => lineasPago.reduce((s, l) => s + (parseNumeroAR(l.montoTexto) ?? 0), 0),
    [lineasPago],
  );
  const faltaAsignar = useMemo(
    () => Math.round((importeTotal - totalPlan) * 100) / 100,
    [importeTotal, totalPlan],
  );
  const planCuadra = Math.abs(faltaAsignar) < 0.01 && lineasPago.length > 0;

  // Neto/IVA derivados del Total + alícuota cuando está activa la discriminación.
  // Neto = Total / (1 + alícuota/100); IVA = Total - Neto.
  const { importeNetoCalc, ivaCalc } = useMemo(() => {
    if (!discriminaIVA || importeTotal <= 0 || alicuotaIVA <= 0) {
      return { importeNetoCalc: 0, ivaCalc: 0 };
    }
    const neto = Math.round((importeTotal / (1 + alicuotaIVA / 100)) * 100) / 100;
    const iva = Math.round((importeTotal - neto) * 100) / 100;
    return { importeNetoCalc: neto, ivaCalc: iva };
  }, [discriminaIVA, importeTotal, alicuotaIVA]);

  // Auto-activar discriminación de IVA cuando el tipo es Factura A o Factura B
  // (en factura_c el IVA NO se discrimina porque es monotributo).
  useEffect(() => {
    if (tipoComprobante === 'factura_a' || tipoComprobante === 'factura_b') {
      setDiscriminaIVA(true);
    }
  }, [tipoComprobante]);

  // Lista del dropdown: proveedores activos + proveedor recien creado por OCR (si aun no se refresco la query)
  const proveedoresParaDropdown = useMemo(() => {
    const lista = [...proveedores];
    if (proveedorRecienCreado && !lista.find((p) => p.id === proveedorRecienCreado.id)) {
      lista.unshift(proveedorRecienCreado);
    }
    return lista;
  }, [proveedores, proveedorRecienCreado]);

  // Categorias agrupadas por padre. Solo las subcategorias (parent_id != null) son seleccionables.
  // Las categorias padre se usan como labels de optgroup (negrita por default).
  const categoriasAgrupadas = useMemo(() => {
    const padres = categorias.filter((c) => c.parent_id === null).sort((a, b) => a.orden - b.orden);
    return padres.map((padre) => ({
      padre,
      hijos: categorias
        .filter((c) => c.parent_id === padre.id)
        .sort((a, b) => a.orden - b.orden),
    }));
  }, [categorias]);

  // Subcategorías que tienen productos asociados en este local — define cuándo aparece "Vincular a stock"
  const { data: subcategoriasConProductos = [] } = useQuery<string[]>({
    queryKey: ['subcategorias-con-productos', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('categoria_gasto_id')
        .eq('local', local)
        .not('activo', 'is', false)
        .not('categoria_gasto_id', 'is', null);
      if (error) throw error;
      const ids = (data ?? [])
        .map((p: { categoria_gasto_id: string | null }) => p.categoria_gasto_id)
        .filter((x): x is string => !!x);
      return Array.from(new Set(ids));
    },
    enabled: open,
  });

  const subcategoriasConProductosSet = useMemo(
    () => new Set(subcategoriasConProductos),
    [subcategoriasConProductos],
  );

  // Solo permitimos vincular a stock si la subcategoría elegida tiene productos asociados.
  // Lucas: "que aparezcan 'vincular stock' a las categorias que tienen asociados productos unicamente"
  const puedeVincularStock = useMemo(
    () => Boolean(categoriaId && subcategoriasConProductosSet.has(categoriaId)),
    [categoriaId, subcategoriasConProductosSet],
  );

  // Si la categoría elegida ya no permite vincular stock, apagamos el checkbox y limpiamos items
  useEffect(() => {
    if (!puedeVincularStock && vincularStock) {
      setVincularStock(false);
      setItems([]);
      setItemDrafts({});
    }
  }, [puedeVincularStock, vincularStock]);

  // Productos del local (carga lazy: solo cuando se activa "Vincular a stock")
  type ProductoLite = {
    id: string;
    nombre: string;
    unidad: string;
    costo_unitario: number | null;
    stock_actual: number | null;
    categoria_gasto_id: string | null;
  };
  const { data: productosLocal = [] } = useQuery<ProductoLite[]>({
    queryKey: ['productos-para-gasto', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, unidad, costo_unitario, stock_actual, categoria_gasto_id')
        .eq('local', local)
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as ProductoLite[];
    },
    enabled: open && vincularStock,
  });

  // Buscar productos por texto (filtro normalizado, sin tildes, máx 8 resultados)
  const productosFiltrados = useMemo(() => {
    if (!productosLocal.length || !busquedaProducto.trim()) return [];
    const q = busquedaProducto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    return productosLocal
      .filter((p) => {
        const n = (p.nombre ?? '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '');
        return n.includes(q) && !items.some((it) => it.producto_id === p.id);
      })
      .slice(0, 8);
  }, [productosLocal, busquedaProducto, items]);

  // Total de items y validación de subcategoría por item
  const totalItems = useMemo(
    () => items.reduce((s, it) => s + (it.subtotal || it.precio_unitario * it.cantidad), 0),
    [items],
  );
  const itemsSinSubcat = useMemo(() => items.filter((it) => !it.categoria_gasto_id), [items]);

  // Split por subcategoría (replica del modal viejo): si los items tienen subcat distintas,
  // se crea 1 gasto por subcat con el total prorrateado proporcional al subtotal de items.
  const splitPorSubcat = useMemo(() => {
    if (!vincularStock || items.length === 0 || itemsSinSubcat.length > 0) return [];
    const totalT = importeTotal;
    const totalIt = totalItems || 1;
    const map = new Map<string, { subtotal: number; items: ItemGastoStock[] }>();
    for (const it of items) {
      const k = it.categoria_gasto_id!;
      const prev = map.get(k) ?? { subtotal: 0, items: [] };
      prev.subtotal += it.subtotal || it.precio_unitario * it.cantidad;
      prev.items.push(it);
      map.set(k, prev);
    }
    return Array.from(map.entries()).map(([catId, g]) => {
      const prop = g.subtotal / totalIt;
      const sub = categorias.find((c) => c.id === catId);
      const padre = sub?.parent_id ? categorias.find((c) => c.id === sub.parent_id) : null;
      return {
        categoria_id: catId,
        subcat_nombre: sub?.nombre ?? '—',
        padre_nombre: padre?.nombre ?? null,
        items: g.items,
        subtotal_items: +g.subtotal.toFixed(2),
        proporcion: prop,
        total: +(totalT * prop).toFixed(2),
      };
    });
  }, [vincularStock, items, importeTotal, totalItems, itemsSinSubcat, categorias]);

  const usarSplit = splitPorSubcat.length >= 1 && vincularStock;

  // ---- Handlers de items ----

  function agregarProducto(productoId: string) {
    const p = productosLocal.find((x) => x.id === productoId);
    if (!p) return;
    setItems((prev) => [
      ...prev,
      {
        producto_id: p.id,
        producto_nombre: p.nombre,
        cantidad: 1,
        unidad: p.unidad,
        precio_unitario: p.costo_unitario || 0,
        subtotal: +((p.costo_unitario || 0) * 1).toFixed(2),
        categoria_gasto_id: p.categoria_gasto_id ?? null,
      },
    ]);
    setBusquedaProducto('');
  }

  function actualizarSubcatItem(idx: number, categoria_gasto_id: string | null) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, categoria_gasto_id } : it)),
    );
  }

  function actualizarItem(idx: number, campo: 'cantidad' | 'subtotal', valor: string) {
    setItemDrafts((d) => ({ ...d, [`${idx}:${campo}`]: valor }));
    const v = parseFloat(valor.replace(',', '.')) || 0;
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        if (campo === 'cantidad') {
          // Mantengo subtotal y recalculo precio_unitario
          const next = { ...it, cantidad: v };
          next.precio_unitario = v > 0 ? +(it.subtotal / v).toFixed(4) : 0;
          return next;
        } else {
          const next = { ...it, subtotal: v };
          next.precio_unitario = it.cantidad > 0 ? +(v / it.cantidad).toFixed(4) : 0;
          return next;
        }
      }),
    );
  }

  function quitarItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
    setItemDrafts((d) => {
      const c: Record<string, string> = {};
      for (const [k, v] of Object.entries(d)) {
        if (!k.startsWith(`${idx}:`)) c[k] = v;
      }
      return c;
    });
  }

  function toggleActualizarCosto(idx: number, checked: boolean) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, actualizar_costo: checked } : it)),
    );
  }

  // Costo de referencia por producto (snapshot del catálogo). Se usa para detectar
  // si el precio_unitario del item difiere del costo_unitario guardado en productos.
  const costoPorProducto = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of productosLocal) {
      if (p.costo_unitario != null && p.costo_unitario > 0) m.set(p.id, p.costo_unitario);
    }
    return m;
  }, [productosLocal]);

  function detectarVariacion(it: ItemGastoStock) {
    const costoActual = costoPorProducto.get(it.producto_id);
    if (!costoActual || !it.precio_unitario || it.precio_unitario <= 0) return null;
    const variacion = (it.precio_unitario - costoActual) / costoActual;
    if (Math.abs(variacion) < 0.0001) return null;
    return { costoActual, variacion };
  }

  function aplicarTotalDesdeItems() {
    if (totalItems > 0) {
      setImporteTexto(formatNumeroAR(totalItems));
    }
  }

  // ---- Step 1: Upload ----

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(selected: File) {
    setError(null);
    setWarning(null);
    setFile(selected);

    try {
      // 1. Calcular hash
      const fileHash = await sha256File(selected);
      setHash(fileHash);

      // 2. Chequear duplicado exacto por hash (bloqueante).
      // Solo bloqueamos si el archivo ya fue VINCULADO a un gasto real (estado='vinculado'
      // o gasto_id != null). Comprobantes huerfanos/fallidos no bloquean — el usuario
      // debe poder reintentar el mismo archivo cuando el OCR fallo (sin creditos, timeout, etc).
      const { data: existente } = await supabase
        .from('comprobantes')
        .select('id, gasto_id')
        .eq('hash_archivo', fileHash)
        .not('gasto_id', 'is', null)
        .maybeSingle();

      if (existente) {
        setError(
          'Este archivo ya fue cargado y vinculado a un gasto. No se puede cargar dos veces el mismo comprobante.',
        );
        setStep('upload');
        return;
      }

      // Si hay filas con el mismo hash pero huerfanas/fallidas, las descartamos antes
      // de insertar la nueva (evita conflict con UNIQUE constraint en hash_archivo).
      await supabase
        .from('comprobantes')
        .delete()
        .eq('hash_archivo', fileHash)
        .is('gasto_id', null);

      // 3. Subir a Storage
      setStep('processing');
      const ext = selected.name.split('.').pop()?.toLowerCase() ?? 'bin';
      const periodo = new Date().toISOString().slice(0, 7); // YYYY-MM
      const path = `${local}/${periodo}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: errUp } = await supabase.storage
        .from('gastos-comprobantes')
        .upload(path, selected, {
          contentType: selected.type || 'application/octet-stream',
        });

      if (errUp) throw errUp;
      setFilePath(path);

      // 4. Crear fila en comprobantes
      const { data: insComp, error: errInsComp } = await supabase
        .from('comprobantes')
        .insert({
          hash_archivo: fileHash,
          file_path: path,
          mime_type: selected.type || null,
          tamano_bytes: selected.size,
          subido_por: user?.id ?? null,
          ocr_status: 'pending',
          estado: 'huerfano',
        })
        .select('id')
        .single();

      if (errInsComp) throw errInsComp;
      setComprobanteId(insComp.id);

      // 5. Invocar edge function
      const { data: ocrRes, error: errOcr } = await supabase.functions.invoke<OcrResponse>(
        'ocr-comprobante',
        { body: { comprobante_id: insComp.id } },
      );

      if (errOcr) throw new Error(`Error invocando OCR: ${errOcr.message}`);
      if (!ocrRes?.ok) throw new Error(ocrRes?.error ?? 'OCR fallo sin mensaje');

      const extraido = ocrRes.ocr_extraido!;
      setOcrData(extraido);
      setOcrConfianza(ocrRes.confianza ?? extraido.confianza ?? 0);
      setDuplicados(ocrRes.duplicados ?? []);

      // 6a. Bloquear si es transferencia interna (no es un gasto)
      const cuitEsRodziny = esCuitDeRodziny(extraido.proveedor_cuit);
      if (extraido.es_transferencia_interna || cuitEsRodziny) {
        // Limpiar el comprobante huerfano (no se va a usar)
        await supabase.from('comprobantes').delete().eq('id', insComp.id);
        setError(
          'Este comprobante es una transferencia entre cuentas propias de Rodziny — no es un gasto a un proveedor.\n\n' +
          'Las transferencias internas se concilian automáticamente al importar los extractos bancarios. ' +
          'No las cargues acá.',
        );
        setStep('upload');
        return;
      }

      // 6b. Pre-llenar form con datos del OCR
      if (extraido.monto) setImporteTexto(formatNumeroAR(extraido.monto));
      if (extraido.fecha) setFecha(extraido.fecha);
      if (extraido.n_operacion) setNOperacion(extraido.n_operacion);
      if (extraido.medio_pago) setMedioPago(mapOcrMedioPago(extraido.medio_pago));

      // Auto-match o auto-crear proveedor con datos del OCR
      await autoMatchOCrearProveedor(extraido);

      // Aviso de duplicado por OCR (no bloqueante)
      if ((ocrRes.duplicados?.length ?? 0) > 0) {
        const tipo = ocrRes.duplicados![0].match_type;
        setWarning(
          tipo === 'n_operacion'
            ? `Se encontro otro comprobante con el mismo N° de operacion. Verifica antes de confirmar.`
            : `Se encontro un gasto con monto y fecha similares. Puede ser duplicado.`,
        );
      }

      setStep('preview');
    } catch (e) {
      const msg = formatError(e);
      console.error('[NuevoGastoForm] error:', e);
      setError(`Error procesando comprobante: ${msg}`);
      setStep('upload');
    }
  }

  // ---- Auto-match o auto-crear proveedor desde OCR ----

  async function autoMatchOCrearProveedor(extraido: OcrExtraido) {
    const nombreOcr = (extraido.proveedor_nombre ?? '').trim();
    const cuitLimpio = extraido.proveedor_cuit ? extraido.proveedor_cuit.replace(/\D/g, '') : null;

    // Guard: nunca crear proveedor con CUIT de Rodziny
    if (cuitLimpio && esCuitDeRodziny(cuitLimpio)) {
      setMensajeProveedor('OCR detectó CUIT de Rodziny como receptor — eso no es un proveedor. Seleccionalo manualmente.');
      return;
    }

    // 1. Match por CUIT (mas confiable)
    if (cuitLimpio) {
      const match = proveedores.find((p) => (p.cuit ?? '').replace(/\D/g, '') === cuitLimpio);
      if (match) {
        aplicarProveedorMatch(match, null);
        return;
      }
    }

    // 2. Match por nombre exacto (case-insensitive)
    if (nombreOcr) {
      const matchNombre = proveedores.find(
        (p) => p.razon_social.trim().toLowerCase() === nombreOcr.toLowerCase(),
      );
      if (matchNombre) {
        aplicarProveedorMatch(matchNombre, null);
        return;
      }
    }

    // 3. No hay match: auto-crear si tenemos CUIT + nombre
    if (cuitLimpio && nombreOcr) {
      const { data: nuevo, error: errIns } = await supabase
        .from('proveedores')
        .insert({
          razon_social: nombreOcr,
          cuit: cuitLimpio,
          dias_pago: 0,
          activo: true,
        })
        .select('*')
        .single();

      if (errIns) {
        // Si el insert fallo por unique constraint, buscar el que ya existe
        const { data: existente } = await supabase
          .from('proveedores')
          .select('*')
          .eq('cuit', cuitLimpio)
          .maybeSingle();
        if (existente) {
          aplicarProveedorMatch(existente as Proveedor, null);
        }
        return;
      }

      const nuevoProveedor = nuevo as Proveedor;
      setProveedorRecienCreado(nuevoProveedor);
      aplicarProveedorMatch(nuevoProveedor, `Proveedor creado automáticamente: ${nuevoProveedor.razon_social}`);
      // Refrescar la lista global
      qc.invalidateQueries({ queryKey: ['proveedores-activos'] });
      return;
    }

    // 4. Solo nombre sin CUIT: no creamos automaticamente (riesgoso, podria duplicar)
    //    El usuario seleccionara manualmente del dropdown.
    if (nombreOcr) {
      setMensajeProveedor(`OCR detectó: "${nombreOcr}" — seleccionalo del listado o creá uno nuevo si no existe.`);
    }
  }

  function aplicarProveedorMatch(prov: Proveedor, mensaje: string | null) {
    setProveedorId(prov.id);
    if (prov.categoria_default_id) setCategoriaId(prov.categoria_default_id);
    if (prov.medio_pago_default) setMedioPago(prov.medio_pago_default);
    setMensajeProveedor(mensaje);
  }

  // Alta manual de proveedor desde el mismo form (botón "+ Nuevo proveedor").
  // Crea el registro en la tabla `proveedores` (la misma del tab Proveedores) y lo
  // deja seleccionado. Si el CUIT ya existe, reusa el existente en vez de duplicar.
  async function crearProveedorManual() {
    const razon = nuevoProvRazon.trim();
    if (!razon) {
      setNuevoProvError('La razón social es obligatoria');
      return;
    }
    setNuevoProvError(null);
    setNuevoProvGuardando(true);
    try {
      const cuitLimpio = nuevoProvCuit.replace(/\D/g, '') || null;
      const { data: nuevo, error: errNuevo } = await supabase
        .from('proveedores')
        .insert({
          razon_social: razon,
          cuit: cuitLimpio,
          condicion_iva: nuevoProvCondicion || null,
          activo: true,
        })
        .select('*')
        .single();
      if (errNuevo) {
        // Posible choque por CUIT único → reusar el existente
        if (cuitLimpio) {
          const { data: existente } = await supabase
            .from('proveedores')
            .select('*')
            .eq('cuit', cuitLimpio)
            .maybeSingle();
          if (existente) {
            const prov = existente as Proveedor;
            setProveedorRecienCreado(prov);
            aplicarProveedorMatch(prov, `Ya existía: ${prov.razon_social} — seleccionado`);
            qc.invalidateQueries({ queryKey: ['proveedores-activos'] });
            setNuevoProvOpen(false);
            setNuevoProvRazon('');
            setNuevoProvCuit('');
            setNuevoProvCondicion('');
            return;
          }
        }
        setNuevoProvError(`No se pudo crear: ${errNuevo.message}`);
        return;
      }
      const prov = nuevo as Proveedor;
      setProveedorRecienCreado(prov);
      aplicarProveedorMatch(prov, `✅ Proveedor creado: ${prov.razon_social}`);
      qc.invalidateQueries({ queryKey: ['proveedores-activos'] });
      setNuevoProvOpen(false);
      setNuevoProvRazon('');
      setNuevoProvCuit('');
      setNuevoProvCondicion('');
    } finally {
      setNuevoProvGuardando(false);
    }
  }

  // OCR de comprobante de pago para una cuota del plan de pagos. Sube el archivo,
  // extrae el N° de operación con Claude Haiku y lo carga en esa línea.
  async function subirComprobanteLinea(key: string, file: File | null) {
    if (!file) return;
    setLineasPago((prev) =>
      prev.map((l) =>
        l.key === key
          ? { ...l, comprobanteNombre: file.name, ocrEjecutando: true, ocrInfo: null }
          : l,
      ),
    );
    const carpeta = `${local}/${(fecha || new Date().toISOString().slice(0, 10)).substring(0, 7)}`;
    const res = await procesarComprobantePago({
      archivo: file,
      subfolder: carpeta,
      userId: user?.id ?? null,
    });
    setLineasPago((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        if (!res.ok && res.error) {
          return { ...l, ocrEjecutando: false, ocrInfo: `⚠ ${res.error}` };
        }
        const pct = Math.round((res.confianza ?? 0) * 100);
        return {
          ...l,
          ocrEjecutando: false,
          comprobantePath: res.file_path ?? l.comprobantePath,
          // Solo autocompletamos el N° si el usuario no lo había tipeado
          numero: l.numero.trim() || res.n_operacion || '',
          ocrInfo: res.n_operacion
            ? `✓ N° detectado: ${res.n_operacion}${pct ? ` (${pct}%)` : ''}`
            : 'Archivo subido. Completá el N° manualmente.',
        };
      }),
    );
  }

  // OCR de la factura: corre cuando el usuario selecciona el archivo.
  // Auto-completa los campos que vinieron en la factura, sin pisar lo que el
  // usuario ya hubiera editado (regla "no sobreescribir si NO está vacío").
  async function handleSeleccionarFactura(file: File) {
    setFacturaFile(file);
    setOcrFacturaEjecutando(true);
    setOcrFacturaInfo(null);
    setOcrFacturaWarning(null);
    setCrearProveedorSugerido(null);

    const res = await procesarFactura({
      archivo: file,
      userId: user?.id ?? null,
    });

    setOcrFacturaEjecutando(false);

    if (res.error) {
      setOcrFacturaWarning(res.error);
      return;
    }
    if (res.factura_path) setFacturaPathPreSubido(res.factura_path);

    const datos = res.datos;
    if (!datos) {
      setOcrFacturaWarning(res.warning ?? 'No se pudo leer la factura. Completá los datos a mano.');
      return;
    }

    // Autocompletar (solo si el campo está vacío para no pisar lo que el user editó)
    if (datos.tipo_comprobante && tipoComprobante === 'recibo') {
      setTipoComprobante(datos.tipo_comprobante);
    }
    // N° de la factura/remito → nroComprobante (gastos.nro_comprobante).
    // NO confundir con nOperacion (que es del pago, va a pagos_gastos).
    if (datos.nro_completo && !nroComprobante) {
      setNroComprobante(datos.nro_completo);
    } else if (datos.numero_comprobante && !nroComprobante) {
      setNroComprobante(datos.numero_comprobante);
    }
    if (datos.fecha_emision && !fecha) {
      setFecha(datos.fecha_emision);
    }
    if (datos.fecha_vencimiento && !fechaVencimiento) {
      setFechaVencimiento(datos.fecha_vencimiento);
    }
    if (datos.importe_total && !importeTexto) {
      // Format AR: el helper formatNumeroAR existe, pero lo usamos via input string
      setImporteTexto(formatNumeroAR(datos.importe_total));
    }
    // Discriminación de IVA: si la factura discrimina (neto + iva o alícuota presentes)
    if (datos.alicuota_iva && datos.alicuota_iva > 0) {
      setDiscriminaIVA(true);
      setAlicuotaIVA(datos.alicuota_iva);
    } else if (datos.iva && datos.iva > 0 && datos.importe_neto) {
      // Si OCR no devolvió alícuota explícita pero sí neto e IVA, derivamos
      const alicCalc = Math.round((datos.iva / datos.importe_neto) * 100 * 10) / 10;
      const alicValida = [21, 10.5, 27, 5, 2.5].reduce((best, v) =>
        Math.abs(v - alicCalc) < Math.abs(best - alicCalc) ? v : best, 21);
      setDiscriminaIVA(true);
      setAlicuotaIVA(alicValida);
    }

    // Proveedor: si OCR matcheó uno existente, seleccionarlo
    if (res.proveedor_match && !proveedorId) {
      const provExistente = proveedores.find((p) => p.id === res.proveedor_match!.id);
      if (provExistente) {
        aplicarProveedorMatch(provExistente, `🔗 Proveedor detectado por CUIT en la factura: ${provExistente.razon_social}`);
      } else {
        // El proveedor existe en DB pero no está en la cache local — usar el match directo
        setProveedorId(res.proveedor_match.id);
        setMensajeProveedor(`🔗 Proveedor detectado por CUIT: ${res.proveedor_match.razon_social ?? res.proveedor_match.nombre_comercial}`);
      }
    } else if (datos.emisor_cuit && datos.emisor_razon_social && !res.proveedor_match && !proveedorId) {
      // CUIT detectado pero no matchea ningún proveedor → sugerir crear uno
      setCrearProveedorSugerido({
        razon_social: datos.emisor_razon_social,
        cuit: datos.emisor_cuit.replace(/\D/g, ''),
      });
    }

    setOcrFacturaWarning(res.warning);
    if (datos.confianza >= 0.7) {
      setOcrFacturaInfo(`✅ Factura leída con ${Math.round(datos.confianza * 100)}% de confianza. Revisá los datos antes de guardar.`);
    }
  }

  // Defaults al entrar al preview, según tipo de carga:
  //  - digital: pagado=true (subió comprobante; cualquier medio)
  //  - efectivo: pagado=true, medio fijo efectivo (sin comprobante ni N° op)
  //  - cuenta_corriente: pagado=false fijo (todavía no pagaste — vence el día X)
  //  - plan: plan de pagos (varias cuotas); pagado/medio se derivan de las cuotas
  useEffect(() => {
    if (step !== 'preview') return;
    if (tipoGasto === 'efectivo') {
      setMedioPago('efectivo');
      setFecha((prev) => prev || new Date().toISOString().slice(0, 10));
      setPagado(true);
      setPlanPagos(false);
    } else if (tipoGasto === 'cuenta_corriente') {
      setFecha((prev) => prev || new Date().toISOString().slice(0, 10));
      setPagado(false);
      setPlanPagos(false);
    } else if (tipoGasto === 'digital') {
      setPagado(true);
      setPlanPagos(false);
    } else if (tipoGasto === 'plan') {
      setFecha((prev) => prev || new Date().toISOString().slice(0, 10));
      setPlanPagos(true);
      // Sembramos 2 cuotas (transferencia hoy + echeq) si no hay
      setLineasPago((prev) =>
        prev.length > 0
          ? prev
          : [
              nuevaLineaPago('transferencia_mp', new Date().toISOString().slice(0, 10)),
              nuevaLineaPago('cheque_galicia', ''),
            ],
      );
    }
  }, [step, tipoGasto]);

  // Aviso retroactivo: ¿el local + periodo derivado de la fecha tiene cierre de
  // inventario aprobado? Si sí, modificar/agregar gastos puede desfasar el snapshot.
  // No bloquea — solo avisa, igual que pidió Lucas.
  const periodoFecha = fecha ? fecha.slice(0, 7) : null;
  const { data: cierreAprobadoMes } = useQuery({
    queryKey: ['cierre_aprobado_mes', local, periodoFecha],
    queryFn: async () => {
      if (!periodoFecha || local === 'sas') return null;
      const { data } = await supabase
        .from('edr_cierres_inventario')
        .select('periodo, aprobado_at')
        .eq('local', local)
        .eq('periodo', periodoFecha)
        .eq('estado', 'aprobado')
        .maybeSingle();
      return data;
    },
    enabled: !!periodoFecha && local !== 'sas',
  });

  // Cuando se tilda "Pagado" en flujo físico, defaultear fecha de pago = fecha del comprobante
  useEffect(() => {
    if (pagado && !fechaPago && fecha) {
      setFechaPago(fecha);
    }
  }, [pagado, fecha, fechaPago]);

  // ---- Step 3: Confirmar y crear gasto ----

  async function handleConfirmar() {
    setError(null);

    // Validaciones generales (aplican a ambos caminos)
    if (importeTotal <= 0) {
      setError('El importe debe ser mayor a 0');
      return;
    }
    if (!fecha) {
      setError('Falta la fecha del gasto');
      return;
    }
    if (!proveedorId) {
      setError('Seleccioná un proveedor');
      return;
    }
    // Categoría: si hay items con stock vinculado, cada item tiene su propia subcat (split).
    // Si no, requerimos la categoría general del gasto.
    if (vincularStock && items.length > 0) {
      if (itemsSinSubcat.length > 0) {
        setError(`Faltan subcategorías en ${itemsSinSubcat.length} item(s) del stock`);
        return;
      }
    } else if (!categoriaId) {
      setError('Seleccioná una categoría');
      return;
    }
    // Validaciones del PLAN DE PAGOS (varias cuotas)
    if (planPagos) {
      // No combinamos plan de pagos con split por subcategoría (un solo gasto).
      if (usarSplit && splitPorSubcat.length > 1) {
        setError('El plan de pagos no se puede combinar con división por subcategoría. Cargá un solo rubro.');
        return;
      }
      if (lineasPago.length === 0) {
        setError('Agregá al menos un pago al plan');
        return;
      }
      if (lineasPago.some((l) => l.ocrEjecutando)) {
        setError('Esperá a que termine el análisis del comprobante de alguna cuota');
        return;
      }
      for (const [i, l] of lineasPago.entries()) {
        const monto = parseNumeroAR(l.montoTexto) ?? 0;
        if (monto <= 0) {
          setError(`El pago ${i + 1} necesita un monto mayor a 0`);
          return;
        }
        if (!l.fecha) {
          setError(`El pago ${i + 1} necesita una fecha`);
          return;
        }
        if (medioRequiereComprobante(l.medio) && !l.numero.trim()) {
          setError(`El pago ${i + 1} (${MEDIO_PAGO_LABEL[l.medio]}) necesita N° de operación / echeq`);
          return;
        }
      }
      if (!planCuadra) {
        setError(
          faltaAsignar > 0
            ? `La suma de los pagos no llega al total. Falta asignar ${formatARS(faltaAsignar)}`
            : `La suma de los pagos supera el total por ${formatARS(Math.abs(faltaAsignar))}`,
        );
        return;
      }
    }
    // Validaciones del bloque de pago simple — solo si "Pagado" y NO plan de pagos
    if (pagado && !planPagos) {
      if (medioRequiereComprobante(medioPago) && !nOperacion) {
        setError('N° de operación es obligatorio si el medio de pago no es efectivo');
        return;
      }
      if (tipoGasto !== 'digital' && !fechaPago) {
        setError('Falta la fecha de pago');
        return;
      }
    }
    // Si es cuenta corriente (no pagado), la fecha de vencimiento es obligatoria
    if (tipoGasto === 'cuenta_corriente' && !planPagos && !fechaVencimiento) {
      setError('Falta la fecha de vencimiento (cuándo hay que pagar)');
      return;
    }

    setStep('saving');

    try {
      const proveedor = proveedores.find((p) => p.id === proveedorId);
      const periodo = fecha.slice(0, 7);

      // Factura fiscal: si el OCR ya subió el archivo, reusar ese path.
      // Si no (OCR falló o el archivo se cargó manualmente sin OCR), subir ahora.
      let facturaPath: string | null = facturaPathPreSubido;
      if (facturaFile && !facturaPath) {
        const ext = facturaFile.name.split('.').pop()?.toLowerCase() ?? 'bin';
        facturaPath = `${local}/${periodo}/factura_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: errFac } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(facturaPath, facturaFile, {
            contentType: facturaFile.type || 'application/octet-stream',
          });
        if (errFac) throw errFac;
      }

      // Comprobante de pago: en digital vino con OCR (filePath). En efectivo/cta cte/plan
      // no hay comprobante único acá (el plan adjunta uno por cuota).
      const pagoComprobantePath: string | null = filePath;

      // Plan de pagos: parseamos las cuotas y derivamos estado/vencimiento del gasto.
      //  - ejecutadas (fecha <= hoy): plata que ya salió → cuentan para el "pagado real"
      //  - programadas (fecha > hoy): echeq sin debitar → programado=true, no cuentan aún
      const hoyStr = new Date().toISOString().slice(0, 10);
      const lineasParsed = planPagos
        ? lineasPago.map((l) => ({
            monto: parseNumeroAR(l.montoTexto) ?? 0,
            medio: l.medio,
            fecha: l.fecha,
            numero: l.numero.trim() || null,
            programado: !!l.fecha && l.fecha > hoyStr,
            comprobantePath: l.comprobantePath,
          }))
        : [];
      const pagadoRealPlan = lineasParsed
        .filter((l) => !l.programado)
        .reduce((s, l) => s + l.monto, 0);
      const primeraProgramada = lineasParsed
        .filter((l) => l.programado)
        .map((l) => l.fecha)
        .sort()[0];

      // Estado / vencimiento / medio a guardar en el gasto según el modo de pago.
      const estadoPagoGasto = planPagos
        ? pagadoRealPlan >= importeTotal - 0.01
          ? 'Pagado'
          : pagadoRealPlan > 0
            ? 'Parcial'
            : 'Pendiente'
        : pagado
          ? 'Pagado'
          : 'Pendiente';
      const fechaVencGasto = planPagos
        ? primeraProgramada ?? null
        : !pagado
          ? fechaVencimiento || null
          : null;
      const medioPagoGasto = planPagos ? null : pagado ? medioPago : null;

      // Builder de payload para 1 fila de gasto. Total se prorratea cuando hay split.
      const buildPayload = (
        catId: string,
        total: number,
        comentarioExtra?: string,
        itemsDelGrupo?: ItemGastoStock[],
      ) => {
        const itemsParaGuardar = vincularStock
          ? (itemsDelGrupo ?? items).filter((it) => it.producto_id)
          : null;
        const comentarioBase = comentario.trim();
        const com = [comentarioBase, comentarioExtra].filter(Boolean).join(' · ') || null;
        return {
          local,
          fecha,
          proveedor_id: proveedorId,
          proveedor: proveedor?.razon_social ?? null, // legacy mirror
          categoria_id: catId,
          importe_total: total,
          // Si discrimina IVA → guardamos neto/IVA prorrateados según el total del split.
          // Si no → null (el EdR sigue usando importe_total como antes).
          importe_neto: discriminaIVA && importeTotal > 0
            ? Math.round((importeNetoCalc * (total / importeTotal)) * 100) / 100
            : null,
          iva: discriminaIVA && importeTotal > 0
            ? Math.round((ivaCalc * (total / importeTotal)) * 100) / 100
            : null,
          iibb: null,
          medio_pago: medioPagoGasto,
          tipo_comprobante: tipoComprobante,
          // N° de la factura/remito (independiente del estado de pago).
          // Si no se cargó, fallback a nOperacion del pago (cuando hay) para compatibilidad
          // con flujos viejos donde no se diferenciaba.
          nro_comprobante: nroComprobante || (pagado && !planPagos ? nOperacion : null) || null,
          estado_pago: estadoPagoGasto,
          fecha_vencimiento: fechaVencGasto,
          comprobante_path: pagoComprobantePath, // OCR en digital, manual en físico
          comprobante_id: comprobanteId, // null en flujo fisico
          factura_path: facturaPath,
          comentario: com,
          creado_por: user?.id ?? null,
          creado_manual: true,
          cancelado: false,
          periodo,
          estado_aprobacion: requiereAprobacion ? 'requiere_aprobacion' : null,
          items_json: itemsParaGuardar && itemsParaGuardar.length > 0 ? itemsParaGuardar : null,
        };
      };

      // 1) Insertar gastos: 1 solo si no hay split, N filas si hay split por subcategoría
      const gastosCreados: string[] = [];

      if (usarSplit && splitPorSubcat.length > 1) {
        const nroLabel = nOperacion || 'comprobante';
        const rows = splitPorSubcat.map((s, i) =>
          buildPayload(
            s.categoria_id,
            s.total,
            `Parte ${i + 1}/${splitPorSubcat.length} de ${nroLabel}`,
            s.items,
          ),
        );
        const { data: ins, error: errIns } = await supabase
          .from('gastos')
          .insert(rows)
          .select('id');
        if (errIns) throw errIns;
        for (const r of ins ?? []) gastosCreados.push(r.id as string);
      } else {
        // 1 sola fila: usa la subcategoría única de items si hay split de 1, si no la categoría general
        const catId = usarSplit ? splitPorSubcat[0].categoria_id : categoriaId!;
        const payload = buildPayload(catId, importeTotal);
        const { data: ins, error: errIns } = await supabase
          .from('gastos')
          .insert(payload)
          .select('id')
          .single();
        if (errIns) throw errIns;
        gastosCreados.push(ins!.id as string);
      }

      // 2.0) Plan de pagos: insertamos 1 fila por cuota. Las futuras van programado=true
      //      (echeq sin debitar). El flujo de caja igual las imputa por fecha_pago en su mes.
      if (planPagos && gastosCreados.length === 1) {
        const filasPlan = lineasParsed.map((l) => ({
          gasto_id: gastosCreados[0],
          fecha_pago: l.fecha,
          monto: l.monto,
          medio_pago: l.medio,
          numero_operacion: l.numero,
          programado: l.programado,
          // Comprobante de pago propio de la cuota (subido con OCR en el editor).
          comprobante_pago_path: l.comprobantePath ?? null,
          creado_por: user?.id ?? null,
        }));
        await supabase.from('pagos_gastos').insert(filasPlan);
      }

      // 2) Si el gasto se cargó como Pagado, registrar el pago en pagos_gastos.
      //    Esto es lo que después matchea con el extracto bancario en Conciliación.
      //    Si hubo split por subcategoría, prorrateamos el pago entre las N filas.
      if (pagado && !planPagos && gastosCreados.length > 0) {
        const fechaDelPago = tipoGasto !== 'digital' ? fechaPago : fecha;
        if (gastosCreados.length === 1) {
          await supabase.from('pagos_gastos').insert({
            gasto_id: gastosCreados[0],
            fecha_pago: fechaDelPago,
            monto: importeTotal,
            medio_pago: medioPago,
            numero_operacion: nOperacion || null,
            comprobante_pago_path: pagoComprobantePath,
            creado_por: user?.id ?? null,
          });
        } else {
          // Split: 1 pago_gasto por cada gasto creado, con monto = total de cada parte
          const filasPagos = gastosCreados.map((gid, i) => ({
            gasto_id: gid,
            fecha_pago: fechaDelPago,
            monto: splitPorSubcat[i].total,
            medio_pago: medioPago,
            numero_operacion: nOperacion || null,
            comprobante_pago_path: pagoComprobantePath,
            creado_por: user?.id ?? null,
          }));
          await supabase.from('pagos_gastos').insert(filasPagos);
        }
      }

      // 3) Vincular comprobante OCR al PRIMER gasto creado (flujo digital)
      if (comprobanteId && gastosCreados.length > 0) {
        await supabase
          .from('comprobantes')
          .update({ gasto_id: gastosCreados[0], estado: 'vinculado' })
          .eq('id', comprobanteId);
      }

      // 4) Self-learning de categoria_gasto_id y costo en productos. NO toca stock:
      //    el inventario físico lo maneja el QR de Recepción (RPC mig 102). El gasto
      //    es solo contable; si también sumara stock contaríamos doble la entrega
      //    (la recibe el QR y la carga Martín). El costo_unitario solo se actualiza
      //    si el encargado tildó "actualizar costo" en el item (variación inline).
      if (vincularStock && items.length > 0) {
        const gastoHistorialId = gastosCreados[0] ?? null;
        for (const it of items) {
          const { data: prodActual } = await supabase
            .from('productos')
            .select('categoria_gasto_id, costo_unitario')
            .eq('id', it.producto_id)
            .single();
          if (!prodActual) continue;

          const updates: Record<string, unknown> = {};
          // Self-learning: si el producto no tenía subcat guardada, persistir la actual
          if (!prodActual.categoria_gasto_id && it.categoria_gasto_id) {
            updates.categoria_gasto_id = it.categoria_gasto_id;
          }
          // Solo actualizar costo si el encargado lo confirmó en el alerta inline
          if (it.actualizar_costo && it.precio_unitario > 0) {
            updates.costo_unitario = it.precio_unitario;
          }
          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            await supabase.from('productos').update(updates).eq('id', it.producto_id);
          }

          // Registrar en historial cuando hubo cambio de costo aprobado
          if (it.actualizar_costo && it.precio_unitario > 0) {
            const costoAnterior = prodActual.costo_unitario ?? null;
            const variacionPct =
              costoAnterior && costoAnterior > 0
                ? (it.precio_unitario - costoAnterior) / costoAnterior
                : null;
            await supabase.from('productos_costo_historial').insert({
              producto_id: it.producto_id,
              costo_anterior: costoAnterior,
              costo_nuevo: it.precio_unitario,
              variacion_pct: variacionPct,
              fuente: 'gasto_item',
              gasto_id: gastoHistorialId,
              usuario: user?.id ?? null,
              comentario: 'Aceptado inline desde Nuevo gasto',
            });
          }
        }
      }

      // 5) Invalidar caches
      qc.invalidateQueries({ queryKey: ['gastos'] });
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
      qc.invalidateQueries({ queryKey: ['gastos_vista'] });
      qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
      qc.invalidateQueries({ queryKey: ['gastos_pagos_map'] });
      qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
      qc.invalidateQueries({ queryKey: ['productos_stock'] });
      qc.invalidateQueries({ queryKey: ['productos-para-gasto'] });
      qc.invalidateQueries({ queryKey: ['subcategorias-con-productos'] });
      qc.invalidateQueries({ queryKey: ['movimientos_stock'] });

      setStep('done');
      onCreated?.(gastosCreados[0]);
    } catch (e) {
      const msg = formatError(e);
      console.error('[NuevoGastoForm] error:', e);
      setError(`No se pudo guardar el gasto: ${msg}`);
      setStep('preview');
    }
  }

  // ---- Render ----

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full flex-col bg-white shadow-xl md:max-w-2xl md:max-h-[92vh] md:rounded-lg overflow-hidden"
        style={{ maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">Nuevo gasto</h2>
            <p className="text-xs text-gray-500">
              {step === 'tipo' && 'Elegí cómo cargarlo'}
              {step === 'upload' && 'Sube una foto o PDF del comprobante'}
              {step === 'processing' && 'Analizando con IA…'}
              {step === 'preview' && (tipoGasto === 'digital' ? 'Verificá los datos antes de guardar' : tipoGasto === 'cuenta_corriente' ? 'Cargá la factura — pago pendiente' : tipoGasto === 'plan' ? 'Cargá la factura y el plan de pagos' : 'Cargá los datos del gasto')}
              {step === 'saving' && 'Guardando…'}
              {step === 'done' && 'Listo'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Stepper — varia segun tipoGasto */}
        {step !== 'tipo' && (
          <div className="flex border-b bg-gray-50 px-4 py-2 text-xs">
            {tipoGasto === 'digital' ? (
              <>
                <StepBadge n={1} active={step === 'upload' || step === 'processing'} done={['preview','saving','done'].includes(step)} label="Subir" />
                <span className="mx-2 self-center text-gray-300">─</span>
                <StepBadge n={2} active={step === 'preview'} done={['saving','done'].includes(step)} label="Verificar" />
                <span className="mx-2 self-center text-gray-300">─</span>
                <StepBadge n={3} active={step === 'saving'} done={step === 'done'} label="Confirmar" />
              </>
            ) : (
              <>
                <StepBadge n={1} active={step === 'preview'} done={['saving','done'].includes(step)} label="Cargar datos" />
                <span className="mx-2 self-center text-gray-300">─</span>
                <StepBadge n={2} active={step === 'saving'} done={step === 'done'} label="Confirmar" />
              </>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Errores y warnings comunes a todos los steps */}
          {error && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {warning && step === 'preview' && (
            <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              ⚠ {warning}
            </div>
          )}

          {/* Step 0: Elegir tipo de gasto */}
          {step === 'tipo' && (
            <div className="space-y-4">
              <p className="text-center text-sm text-gray-600">
                ¿Cómo querés cargar este gasto?
              </p>
              <button
                type="button"
                onClick={() => {
                  setTipoGasto('digital');
                  setStep('upload');
                }}
                className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-rodziny-200 bg-rodziny-50 p-6 text-center transition hover:border-rodziny-400 hover:bg-rodziny-100"
              >
                <div className="text-4xl">📷</div>
                <div className="text-base font-semibold text-rodziny-900">Gasto digital</div>
                <div className="text-xs text-gray-600">
                  Tengo foto o PDF del comprobante de pago — la IA extrae los datos automáticamente
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTipoGasto('efectivo');
                  setStep('preview');
                }}
                className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-gray-200 bg-gray-50 p-6 text-center transition hover:border-gray-400 hover:bg-gray-100"
              >
                <div className="text-4xl">💵</div>
                <div className="text-base font-semibold text-gray-800">Pago en efectivo</div>
                <div className="text-xs text-gray-600">
                  Pagué en efectivo, sin comprobante — cargo los datos a mano
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTipoGasto('cuenta_corriente');
                  setStep('preview');
                }}
                className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-amber-200 bg-amber-50 p-6 text-center transition hover:border-amber-400 hover:bg-amber-100"
              >
                <div className="text-4xl">📋</div>
                <div className="text-base font-semibold text-amber-900">Cuenta corriente</div>
                <div className="text-xs text-amber-800">
                  Todavía no lo pagué — registro la factura con fecha de vencimiento. Cuando se pague, lo concilio con el comprobante.
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTipoGasto('plan');
                  setStep('preview');
                }}
                className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-rodziny-200 bg-rodziny-50 p-6 text-center transition hover:border-rodziny-400 hover:bg-rodziny-100"
              >
                <div className="text-4xl">🧾</div>
                <div className="text-base font-semibold text-rodziny-900">Plan de pagos</div>
                <div className="text-xs text-gray-600">
                  Una factura saldada en varias cuotas (ej: transferencia + echeq a 30/60 días)
                </div>
              </button>
            </div>
          )}

          {/* Step 1: Upload (solo en flujo digital) */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Local</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setLocal('vedia')}
                    className={cn(
                      'flex-1 rounded border px-4 py-3 text-sm font-medium transition',
                      local === 'vedia'
                        ? 'border-rodziny-600 bg-rodziny-50 text-rodziny-900'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50',
                    )}
                  >
                    Vedia
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocal('saavedra')}
                    className={cn(
                      'flex-1 rounded border px-4 py-3 text-sm font-medium transition',
                      local === 'saavedra'
                        ? 'border-rodziny-600 bg-rodziny-50 text-rodziny-900'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50',
                    )}
                  >
                    Saavedra
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocal('sas')}
                    className={cn(
                      'flex-1 rounded border px-4 py-3 text-sm font-medium transition',
                      local === 'sas'
                        ? 'border-rodziny-600 bg-rodziny-50 text-rodziny-900'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50',
                    )}
                    title="Gastos de la razón social — impuestos, ARCA, comisiones bancarias"
                  >
                    SAS
                  </button>
                </div>
              </div>

              <div
                className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFileSelected(f);
                  }}
                />
                <div className="text-4xl">📷</div>
                <div className="mt-2 text-sm font-medium">Tomar foto o subir archivo</div>
                <div className="mt-1 text-xs text-gray-500">JPG, PNG o PDF · max 10 MB</div>
              </div>

              <div className="text-center text-xs text-gray-500">
                El sistema va a leer automaticamente: proveedor, monto, fecha, N° de operacion, CUIT.
              </div>
            </div>
          )}

          {/* Step 1.5: Processing */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-rodziny-200 border-t-rodziny-600"></div>
              <div className="mt-4 text-sm font-medium">Analizando comprobante con IA…</div>
              <div className="mt-1 text-xs text-gray-500">Esto tarda 3-8 segundos</div>
              {file && (
                <div className="mt-3 text-xs text-gray-400">{file.name}</div>
              )}
            </div>
          )}

          {/* Step 2: Preview & edit */}
          {step === 'preview' && (
            <div className="space-y-3">
              {/* Confianza del OCR (solo en flujo digital) */}
              {ocrData && (
                <div
                  className={cn(
                    'rounded border px-3 py-2 text-xs',
                    ocrConfianza >= 0.8
                      ? 'border-green-200 bg-green-50 text-green-800'
                      : ocrConfianza >= 0.5
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-red-200 bg-red-50 text-red-800',
                  )}
                >
                  Confianza OCR: <strong>{Math.round(ocrConfianza * 100)}%</strong>
                  {ocrConfianza < 0.7 && ' — verificá los datos con cuidado'}
                </div>
              )}

              {/* Duplicado advertencia */}
              {duplicados.length > 0 && duplicados[0].gasto_id && (
                <div className="rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                  ⚠ Hay un gasto previo con datos similares.{' '}
                  <a
                    href={`/compras?gasto=${duplicados[0].gasto_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Ver gasto
                  </a>
                </div>
              )}

              {/* Local: editable en flujo fisico, read-only en digital */}
              <Field label={tipoGasto !== 'digital' ? 'Local *' : 'Local'}>
                {tipoGasto !== 'digital' ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setLocal('vedia')}
                      className={cn(
                        'flex-1 rounded border px-3 py-2 text-sm font-medium',
                        local === 'vedia' ? 'border-rodziny-600 bg-rodziny-50 text-rodziny-900' : 'border-gray-300 text-gray-700',
                      )}
                    >
                      Vedia
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocal('saavedra')}
                      className={cn(
                        'flex-1 rounded border px-3 py-2 text-sm font-medium',
                        local === 'saavedra' ? 'border-rodziny-600 bg-rodziny-50 text-rodziny-900' : 'border-gray-300 text-gray-700',
                      )}
                    >
                      Saavedra
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocal('sas')}
                      className={cn(
                        'flex-1 rounded border px-3 py-2 text-sm font-medium',
                        local === 'sas' ? 'border-rodziny-600 bg-rodziny-50 text-rodziny-900' : 'border-gray-300 text-gray-700',
                      )}
                      title="Razón social Rodziny S.A.S. — gastos no atribuibles a un local (impuestos, ARCA, comisiones bancarias)"
                    >
                      SAS
                    </button>
                  </div>
                ) : (
                  <div className="rounded bg-gray-100 px-3 py-2 text-sm">
                    {local === 'vedia' ? 'Vedia' : local === 'saavedra' ? 'Saavedra' : 'SAS'}
                  </div>
                )}
              </Field>

              {/* Proveedor */}
              <Field label="Proveedor *">
                <select
                  value={proveedorId ?? ''}
                  onChange={(e) => setProveedorId(e.target.value || null)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">— Seleccionar —</option>
                  {proveedoresParaDropdown.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.razon_social}
                      {p.cuit ? ` (${p.cuit})` : ''}
                    </option>
                  ))}
                </select>
                {mensajeProveedor && (
                  <div className={cn(
                    'mt-1 rounded px-2 py-1 text-xs',
                    proveedorRecienCreado
                      ? 'bg-green-50 text-green-800'
                      : 'bg-blue-50 text-blue-800',
                  )}>
                    {proveedorRecienCreado ? '✓ ' : 'ℹ '}{mensajeProveedor}
                  </div>
                )}

                {/* Alta manual de proveedor nuevo (sin salir del form) */}
                {!nuevoProvOpen ? (
                  <button
                    type="button"
                    onClick={() => {
                      setNuevoProvOpen(true);
                      setNuevoProvError(null);
                    }}
                    className="mt-1.5 text-xs font-medium text-rodziny-700 hover:underline"
                  >
                    ➕ Nuevo proveedor
                  </button>
                ) : (
                  <div className="mt-1.5 space-y-2 rounded border border-rodziny-200 bg-rodziny-50/50 p-2.5">
                    <div className="text-xs font-semibold text-rodziny-900">Crear proveedor nuevo</div>
                    <input
                      type="text"
                      value={nuevoProvRazon}
                      onChange={(e) => setNuevoProvRazon(e.target.value)}
                      placeholder="Razón social *"
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={nuevoProvCuit}
                        onChange={(e) => setNuevoProvCuit(e.target.value)}
                        placeholder="CUIT (opcional)"
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-mono"
                      />
                      <select
                        value={nuevoProvCondicion}
                        onChange={(e) => setNuevoProvCondicion(e.target.value as CondicionIVA | '')}
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Cond. IVA (opcional)</option>
                        <option value="responsable_inscripto">Responsable Inscripto</option>
                        <option value="monotributo">Monotributo</option>
                        <option value="exento">Exento</option>
                        <option value="consumidor_final">Consumidor Final</option>
                      </select>
                    </div>
                    {nuevoProvError && (
                      <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{nuevoProvError}</div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={crearProveedorManual}
                        disabled={nuevoProvGuardando}
                        className="rounded bg-rodziny-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-700 disabled:opacity-50"
                      >
                        {nuevoProvGuardando ? 'Creando…' : 'Crear y seleccionar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNuevoProvOpen(false);
                          setNuevoProvError(null);
                        }}
                        className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </Field>

              {/* Categoria — solo subcategorias son seleccionables, agrupadas por padre */}
              <Field label={vincularStock && items.length > 0 ? 'Categoría' : 'Categoría *'}>
                {vincularStock && items.length > 0 ? (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Se asigna por item (abajo en "Vincular a stock"). Si los items tienen
                    subcategorías distintas, este comprobante se va a dividir en N gastos.
                  </div>
                ) : (
                  <>
                    <select
                      value={categoriaId ?? ''}
                      onChange={(e) => setCategoriaId(e.target.value || null)}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="">— Seleccionar —</option>
                      {categoriasAgrupadas.map(({ padre, hijos }) => (
                        <optgroup key={padre.id} label={padre.nombre}>
                          {hijos.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.nombre}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <div className="mt-1 text-xs text-gray-500">
                      Elegí una subcategoría (las categorías madre no son seleccionables)
                    </div>
                  </>
                )}
              </Field>

              {/* Vincular a stock — solo aparece si la subcategoría seleccionada tiene productos asociados */}
              {puedeVincularStock && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={vincularStock}
                      onChange={(e) => {
                        setVincularStock(e.target.checked);
                        if (!e.target.checked) {
                          setItems([]);
                          setItemDrafts({});
                          setBusquedaProducto('');
                        }
                      }}
                      className="rounded"
                    />
                    <span className="text-sm font-medium text-gray-700">Detallar productos</span>
                    <span className="text-[11px] text-gray-500">
                      (aprende costo y categoría; el stock lo suma Recepción)
                    </span>
                  </label>

                  {vincularStock && (
                    <div className="mt-3 space-y-3">
                      {/* Items existentes */}
                      {items.length > 0 && (
                        <>
                          {/* Desktop: tabla */}
                          <div className="hidden md:block overflow-x-auto rounded border border-gray-200 bg-white">
                            <table className="w-full text-xs">
                              <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                                <tr>
                                  <th className="px-2 py-1.5 text-left font-medium">Producto</th>
                                  <th className="px-2 py-1.5 text-right font-medium">Cant.</th>
                                  <th className="px-2 py-1.5 text-left font-medium">Un.</th>
                                  <th className="px-2 py-1.5 text-right font-medium">$/u</th>
                                  <th className="px-2 py-1.5 text-right font-medium">Subtotal</th>
                                  <th className="px-2 py-1.5 text-left font-medium">
                                    Subcategoría
                                  </th>
                                  <th className="px-2 py-1.5"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {items.map((it, idx) => {
                                  const variacion = detectarVariacion(it);
                                  return (
                                    <Fragment key={idx}>
                                  <tr>
                                    <td className="px-2 py-1.5 font-medium text-gray-800">
                                      {it.producto_nombre}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={itemDrafts[`${idx}:cantidad`] ?? String(it.cantidad)}
                                        onChange={(e) =>
                                          actualizarItem(idx, 'cantidad', e.target.value)
                                        }
                                        onBlur={() =>
                                          setItemDrafts((d) => {
                                            const c = { ...d };
                                            delete c[`${idx}:cantidad`];
                                            return c;
                                          })
                                        }
                                        className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5 text-gray-500">{it.unidad}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                                      {formatARS(it.precio_unitario || 0)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={itemDrafts[`${idx}:subtotal`] ?? String(it.subtotal)}
                                        onChange={(e) =>
                                          actualizarItem(idx, 'subtotal', e.target.value)
                                        }
                                        onBlur={() =>
                                          setItemDrafts((d) => {
                                            const c = { ...d };
                                            delete c[`${idx}:subtotal`];
                                            return c;
                                          })
                                        }
                                        className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-right font-medium tabular-nums"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <select
                                        value={it.categoria_gasto_id ?? ''}
                                        onChange={(e) =>
                                          actualizarSubcatItem(idx, e.target.value || null)
                                        }
                                        className={cn(
                                          'w-full max-w-[180px] rounded border bg-white px-1.5 py-0.5 text-[11px]',
                                          it.categoria_gasto_id
                                            ? 'border-gray-300'
                                            : 'border-amber-300 bg-amber-50 text-amber-800',
                                        )}
                                      >
                                        <option value="">⚠ Subcategoría...</option>
                                        {categoriasAgrupadas.map(({ padre, hijos }) => (
                                          <optgroup key={padre.id} label={padre.nombre}>
                                            {hijos.map((h) => (
                                              <option key={h.id} value={h.id}>
                                                {h.nombre}
                                              </option>
                                            ))}
                                          </optgroup>
                                        ))}
                                      </select>
                                    </td>
                                    <td className="px-2 py-1.5 text-right">
                                      <button
                                        type="button"
                                        onClick={() => quitarItem(idx)}
                                        className="text-red-500 hover:text-red-700"
                                        aria-label="Quitar item"
                                      >
                                        ✕
                                      </button>
                                    </td>
                                  </tr>
                                  {variacion && (
                                    <tr className="bg-amber-50">
                                      <td colSpan={7} className="px-2 py-1.5 text-[11px] text-amber-900">
                                        <label className="flex cursor-pointer items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={it.actualizar_costo ?? false}
                                            onChange={(e) =>
                                              toggleActualizarCosto(idx, e.target.checked)
                                            }
                                            className="rounded"
                                          />
                                          <span>
                                            ⚠ Era{' '}
                                            <strong>{formatARS(variacion.costoActual)}</strong> →{' '}
                                            ahora{' '}
                                            <strong>{formatARS(it.precio_unitario)}</strong>{' '}
                                            ({variacion.variacion > 0 ? '+' : ''}
                                            {(variacion.variacion * 100).toFixed(1)}%) —
                                            actualizar costo del producto
                                          </span>
                                        </label>
                                      </td>
                                    </tr>
                                  )}
                                    </Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Mobile: cards */}
                          <div className="space-y-2 md:hidden">
                            {items.map((it, idx) => (
                              <div
                                key={idx}
                                className="rounded border border-gray-200 bg-white p-2 text-xs"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-medium text-gray-800">
                                    {it.producto_nombre}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => quitarItem(idx)}
                                    className="text-red-500 hover:text-red-700"
                                    aria-label="Quitar item"
                                  >
                                    ✕
                                  </button>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] text-gray-500">
                                      Cantidad
                                    </label>
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={itemDrafts[`${idx}:cantidad`] ?? String(it.cantidad)}
                                        onChange={(e) =>
                                          actualizarItem(idx, 'cantidad', e.target.value)
                                        }
                                        onBlur={() =>
                                          setItemDrafts((d) => {
                                            const c = { ...d };
                                            delete c[`${idx}:cantidad`];
                                            return c;
                                          })
                                        }
                                        className="w-full rounded border border-gray-300 px-1.5 py-1 text-right tabular-nums"
                                      />
                                      <span className="text-[10px] text-gray-500">
                                        {it.unidad}
                                      </span>
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-gray-500">
                                      Subtotal $
                                    </label>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={itemDrafts[`${idx}:subtotal`] ?? String(it.subtotal)}
                                      onChange={(e) =>
                                        actualizarItem(idx, 'subtotal', e.target.value)
                                      }
                                      onBlur={() =>
                                        setItemDrafts((d) => {
                                          const c = { ...d };
                                          delete c[`${idx}:subtotal`];
                                          return c;
                                        })
                                      }
                                      className="w-full rounded border border-gray-300 px-1.5 py-1 text-right font-medium tabular-nums"
                                    />
                                  </div>
                                </div>
                                <div className="mt-2">
                                  <label className="block text-[10px] text-gray-500">
                                    Subcategoría
                                  </label>
                                  <select
                                    value={it.categoria_gasto_id ?? ''}
                                    onChange={(e) =>
                                      actualizarSubcatItem(idx, e.target.value || null)
                                    }
                                    className={cn(
                                      'w-full rounded border bg-white px-1.5 py-1',
                                      it.categoria_gasto_id
                                        ? 'border-gray-300'
                                        : 'border-amber-300 bg-amber-50 text-amber-800',
                                    )}
                                  >
                                    <option value="">⚠ Elegí subcategoría</option>
                                    {categoriasAgrupadas.map(({ padre, hijos }) => (
                                      <optgroup key={padre.id} label={padre.nombre}>
                                        {hijos.map((h) => (
                                          <option key={h.id} value={h.id}>
                                            {h.nombre}
                                          </option>
                                        ))}
                                      </optgroup>
                                    ))}
                                  </select>
                                </div>
                                <div className="mt-1 text-right text-[10px] text-gray-400">
                                  {formatARS(it.precio_unitario || 0)}/u
                                </div>
                                {(() => {
                                  const variacion = detectarVariacion(it);
                                  if (!variacion) return null;
                                  return (
                                    <div className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                                      <label className="flex cursor-pointer items-start gap-2">
                                        <input
                                          type="checkbox"
                                          checked={it.actualizar_costo ?? false}
                                          onChange={(e) =>
                                            toggleActualizarCosto(idx, e.target.checked)
                                          }
                                          className="mt-0.5 rounded"
                                        />
                                        <span>
                                          ⚠ Era{' '}
                                          <strong>{formatARS(variacion.costoActual)}</strong> →{' '}
                                          ahora{' '}
                                          <strong>{formatARS(it.precio_unitario)}</strong>{' '}
                                          ({variacion.variacion > 0 ? '+' : ''}
                                          {(variacion.variacion * 100).toFixed(1)}%) —
                                          actualizar costo del producto
                                        </span>
                                      </label>
                                    </div>
                                  );
                                })()}
                              </div>
                            ))}
                          </div>

                          {/* Subtotal items + Aplicar al total */}
                          <div className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2">
                            <span className="text-xs text-gray-600">Subtotal items</span>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-bold tabular-nums">
                                {formatARS(totalItems)}
                              </span>
                              <button
                                type="button"
                                onClick={aplicarTotalDesdeItems}
                                className="text-[11px] text-rodziny-700 underline hover:text-rodziny-900"
                              >
                                Aplicar al total
                              </button>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Buscador de productos */}
                      <div className="relative">
                        <input
                          value={busquedaProducto}
                          onChange={(e) => setBusquedaProducto(e.target.value)}
                          placeholder="Buscar producto para agregar…"
                          className="w-full rounded border border-gray-300 px-3 py-2 text-xs"
                        />
                        {productosFiltrados.length > 0 && (
                          <div className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
                            {productosFiltrados.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => agregarProducto(p.id)}
                                className="w-full border-b border-gray-50 px-3 py-1.5 text-left text-xs hover:bg-gray-100"
                              >
                                <div className="font-medium">{p.nombre}</div>
                                <div className="text-[10px] text-gray-500">
                                  stock {p.stock_actual ?? 0} {p.unidad} · costo{' '}
                                  {formatARS(p.costo_unitario ?? 0)}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Preview de split por subcategoría */}
                      {usarSplit && splitPorSubcat.length > 1 && (
                        <div className="rounded border border-amber-200 bg-amber-50 p-2">
                          <div className="mb-1.5 text-xs font-semibold text-amber-900">
                            ⚠ Este comprobante se va a dividir en {splitPorSubcat.length} gastos
                          </div>
                          <p className="mb-2 text-[11px] text-amber-800">
                            Los items tienen subcategorías distintas. Se crea 1 gasto por
                            subcategoría con el total prorrateado proporcional al subtotal.
                          </p>
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="border-b border-amber-200 text-amber-700">
                                <th className="py-1 text-left">Subcategoría</th>
                                <th className="py-1 text-right">Items</th>
                                <th className="py-1 text-right">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {splitPorSubcat.map((s) => (
                                <tr
                                  key={s.categoria_id}
                                  className="border-b border-amber-100 last:border-0"
                                >
                                  <td className="py-1">
                                    <div className="font-medium text-amber-900">
                                      {s.subcat_nombre}
                                    </div>
                                    {s.padre_nombre && (
                                      <div className="text-[9px] text-amber-700">
                                        {s.padre_nombre}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-1 text-right text-amber-800">
                                    {s.items.length}
                                  </td>
                                  <td className="py-1 text-right font-semibold tabular-nums text-amber-900">
                                    {formatARS(s.total)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Aviso de items sin subcategoría */}
                      {itemsSinSubcat.length > 0 && (
                        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          ⚠ Asigná una subcategoría a cada item. Faltan {itemsSinSubcat.length} de{' '}
                          {items.length}.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Importe */}
              <Field label="Importe total *">
                <div className="flex items-center rounded border border-gray-300">
                  <span className="px-3 text-sm text-gray-500">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={importeTexto}
                    onChange={(e) => setImporteTexto(e.target.value)}
                    onBlur={() => {
                      // Re-formatear al perder foco (acomoda separadores)
                      const num = parseNumeroAR(importeTexto);
                      if (num !== null) setImporteTexto(formatNumeroAR(num));
                    }}
                    placeholder="285.453,50"
                    className="w-full rounded-r px-2 py-2 text-sm tabular-nums focus:outline-none"
                  />
                </div>
                {requiereAprobacion && (
                  <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
                    ⚠ Supera el umbral de {formatARS(umbralAprobacion)}. Este gasto va a quedar
                    pendiente de aprobacion por Lucas.
                  </div>
                )}
                {/* Discriminación de IVA */}
                <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={discriminaIVA}
                      onChange={(e) => setDiscriminaIVA(e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="font-medium">Discriminar IVA</span>
                    <span className="text-gray-500">
                      (Auto para Factura A/B — se calcula desde el total)
                    </span>
                  </label>
                  {discriminaIVA && (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <label className="block text-gray-500">Neto</label>
                        <div className="rounded border border-gray-300 bg-white px-2 py-1.5 text-right tabular-nums text-gray-900">
                          $ {formatNumeroAR(importeNetoCalc)}
                        </div>
                      </div>
                      <div>
                        <label className="block text-gray-500">IVA</label>
                        <div className="rounded border border-gray-300 bg-white px-2 py-1.5 text-right tabular-nums text-gray-900">
                          $ {formatNumeroAR(ivaCalc)}
                        </div>
                      </div>
                      <div>
                        <label className="block text-gray-500">Alícuota</label>
                        <select
                          value={alicuotaIVA}
                          onChange={(e) => setAlicuotaIVA(Number(e.target.value))}
                          className="w-full rounded border border-gray-300 bg-white px-2 py-1.5"
                        >
                          <option value={21}>21 %</option>
                          <option value={10.5}>10,5 %</option>
                          <option value={27}>27 %</option>
                          <option value={5}>5 %</option>
                          <option value={2.5}>2,5 %</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </Field>

              <Field label="Fecha del comprobante *">
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
                {cierreAprobadoMes && (
                  <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
                    ⚠ El mes <strong>{cierreAprobadoMes.periodo}</strong> ya tiene cierre de
                    inventario aprobado. Si esto modifica las compras, el CMV REAL del EdR puede
                    quedar desactualizado — considerá pedir re-cierre.
                  </div>
                )}
              </Field>

              {/* Fecha de vencimiento — solo en cuenta corriente (no pagado) */}
              {tipoGasto === 'cuenta_corriente' && (
                <Field label="Fecha de vencimiento *">
                  <input
                    type="date"
                    value={fechaVencimiento}
                    onChange={(e) => setFechaVencimiento(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                  <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    📋 Queda en cuenta corriente. Cuando pagues, lo registrás desde el listado con <strong>💸 Pagar</strong>.
                  </div>
                </Field>
              )}

              {/* Plan de pagos — editor de N cuotas (transferencia + echeq, etc.) */}
              {tipoGasto === 'plan' && (
                <PlanPagosEditor
                  lineas={lineasPago}
                  setLineas={setLineasPago}
                  importeTotal={importeTotal}
                  totalPlan={totalPlan}
                  faltaAsignar={faltaAsignar}
                  planCuadra={planCuadra}
                  nuevaLinea={nuevaLineaPago}
                  onSubirComprobante={subirComprobanteLinea}
                />
              )}

              {/* Pago en efectivo — solo fecha (medio fijo efectivo, sin N° op ni comprobante) */}
              {tipoGasto === 'efectivo' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fecha de pago *">
                    <input
                      type="date"
                      value={fechaPago}
                      onChange={(e) => setFechaPago(e.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    />
                  </Field>
                  <Field label="Medio de pago">
                    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      💵 Efectivo
                    </div>
                  </Field>
                </div>
              )}

              {/* Pago digital — medio + N° de operación (el comprobante ya vino con OCR) */}
              {tipoGasto === 'digital' && (
                <>
                  <Field label="Medio de pago *">
                    <select
                      value={medioPago}
                      onChange={(e) => setMedioPago(e.target.value as MedioPago)}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    >
                      {(Object.keys(MEDIO_PAGO_LABEL) as MedioPago[]).map((m) => (
                        <option key={m} value={m}>
                          {MEDIO_PAGO_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={`N° de operacion${medioPago !== 'efectivo' ? ' *' : ''}`}>
                    <input
                      type="text"
                      value={nOperacion}
                      onChange={(e) => setNOperacion(e.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      placeholder={
                        medioPago === 'transferencia_galicia' || medioPago === 'cheque_galicia'
                          ? 'Leyenda adicional (ej: 5034490189) o N° de cheque'
                          : medioPago === 'transferencia_mp'
                            ? 'N° de op MP (ej: 156905408879)'
                            : 'Ref. bancaria / N° de transferencia'
                      }
                    />
                    {(medioPago === 'transferencia_galicia' || medioPago === 'cheque_galicia') && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        En el PDF del Galicia copiá la "Leyenda adicional" (10 dígitos).
                        En el extracto aparece sin el primer dígito.
                      </p>
                    )}
                  </Field>
                </>
              )}

              <Field label="Tipo de comprobante">
                <select
                  value={tipoComprobante}
                  onChange={(e) => setTipoComprobante(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  {Object.entries(TIPO_COMPROBANTE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="N° de comprobante (factura / remito)">
                <input
                  type="text"
                  value={nroComprobante}
                  onChange={(e) => setNroComprobante(e.target.value)}
                  placeholder="ej: 0008-00001260"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  N° impreso en la factura del proveedor (no es el N° de operación del pago). Se
                  completa solo si adjuntás la factura abajo — no hace falta tipearlo.
                </p>
              </Field>

              <Field label="Comentario (opcional)">
                <textarea
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </Field>

              {/* Factura fiscal (opcional, en ambos caminos) — con OCR automático */}
              <Field label="Factura fiscal del proveedor (opcional)">
                <input
                  ref={facturaInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSeleccionarFactura(f);
                  }}
                />
                {facturaFile ? (
                  <div className="flex items-center justify-between rounded border border-green-200 bg-green-50 px-3 py-2 text-sm">
                    <span className="truncate text-green-800">📎 {facturaFile.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFacturaFile(null);
                        setFacturaPathPreSubido(null);
                        setOcrFacturaInfo(null);
                        setOcrFacturaWarning(null);
                        setCrearProveedorSugerido(null);
                      }}
                      className="ml-2 text-xs text-red-600 hover:underline"
                      disabled={ocrFacturaEjecutando}
                    >
                      Quitar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => facturaInputRef.current?.click()}
                    className="w-full rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm text-gray-600 hover:bg-gray-100"
                  >
                    + Adjuntar factura A/B/C / remito (la IA lee los datos automáticamente)
                  </button>
                )}
                {ocrFacturaEjecutando && (
                  <div className="mt-1.5 flex items-center gap-2 rounded bg-blue-50 px-2 py-1.5 text-xs text-blue-800">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700"></div>
                    🔍 Leyendo factura con IA…
                  </div>
                )}
                {ocrFacturaInfo && !ocrFacturaEjecutando && (
                  <div className="mt-1.5 rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">
                    {ocrFacturaInfo}
                  </div>
                )}
                {ocrFacturaWarning && !ocrFacturaEjecutando && (
                  <div className="mt-1.5 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                    {ocrFacturaWarning}
                  </div>
                )}
                {crearProveedorSugerido && !proveedorId && (
                  <div className="mt-1.5 flex items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs">
                    <span className="text-blue-900">
                      ➕ <strong>{crearProveedorSugerido.razon_social}</strong> (CUIT {crearProveedorSugerido.cuit}) no está cargado.
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        const { data: nuevo, error: errNuevo } = await supabase
                          .from('proveedores')
                          .insert({
                            razon_social: crearProveedorSugerido.razon_social,
                            cuit: crearProveedorSugerido.cuit,
                            activo: true,
                          })
                          .select('*')
                          .single();
                        if (errNuevo) {
                          window.alert(`No se pudo crear: ${errNuevo.message}`);
                          return;
                        }
                        const nuevoProv = nuevo as Proveedor;
                        setProveedorRecienCreado(nuevoProv);
                        aplicarProveedorMatch(nuevoProv, `✅ Proveedor creado: ${nuevoProv.razon_social}`);
                        setCrearProveedorSugerido(null);
                        qc.invalidateQueries({ queryKey: ['proveedores-activos'] });
                      }}
                      className="whitespace-nowrap rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700"
                    >
                      Crear ahora
                    </button>
                  </div>
                )}
              </Field>
            </div>
          )}

          {/* Step: saving */}
          {step === 'saving' && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-rodziny-200 border-t-rodziny-600"></div>
              <div className="mt-4 text-sm font-medium">Guardando gasto…</div>
            </div>
          )}

          {/* Step: done */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="text-5xl">✅</div>
              <div className="mt-3 text-base font-semibold">Gasto cargado</div>
              {requiereAprobacion ? (
                <div className="mt-2 text-center text-sm text-amber-700">
                  Esta esperando aprobacion de Lucas (supera {formatARS(umbralAprobacion)}).
                </div>
              ) : (
                <div className="mt-2 text-center text-sm text-gray-600">
                  Todo en orden. Ya aparece en Compras y en el EdR.
                </div>
              )}
              <button
                onClick={onClose}
                className="mt-6 rounded bg-rodziny-600 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-700"
              >
                Cerrar
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {(step === 'tipo' || step === 'preview' || step === 'upload') && (
          <div className="flex justify-between gap-2 border-t px-4 py-3">
            {/* Boton volver (preview en efectivo/cta cte/plan → tipo; upload → tipo) */}
            {step === 'upload' && (
              <button
                onClick={() => setStep('tipo')}
                className="rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
              >
                ← Volver
              </button>
            )}
            {step === 'preview' && tipoGasto !== 'digital' && (
              <button
                onClick={() => setStep('tipo')}
                className="rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
              >
                ← Volver
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                onClick={onClose}
                className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancelar
              </button>
              {step === 'preview' && (
                <button
                  onClick={handleConfirmar}
                  disabled={ocrFacturaEjecutando}
                  className="rounded bg-rodziny-600 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-700 disabled:bg-gray-300"
                  title={ocrFacturaEjecutando ? 'Esperando que termine la lectura de la factura…' : undefined}
                >
                  {ocrFacturaEjecutando ? 'Leyendo factura…' : 'Confirmar y guardar'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ----- Subcomponentes -----

// Editor del plan de pagos: N cuotas (transferencia + echeq, etc.) cuya suma debe
// dar el total de la factura. Las cuotas con fecha futura se marcan como "echeq a
// vencer" (se guardarán con programado=true).
function PlanPagosEditor({
  lineas,
  setLineas,
  importeTotal,
  totalPlan,
  faltaAsignar,
  planCuadra,
  nuevaLinea,
  onSubirComprobante,
}: {
  lineas: LineaPagoUI[];
  setLineas: React.Dispatch<React.SetStateAction<LineaPagoUI[]>>;
  importeTotal: number;
  totalPlan: number;
  faltaAsignar: number;
  planCuadra: boolean;
  nuevaLinea: (medio?: MedioPago, fecha?: string) => LineaPagoUI;
  onSubirComprobante: (key: string, file: File | null) => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);

  const actualizar = (key: string, campo: keyof LineaPagoUI, valor: string) => {
    setLineas((prev) => prev.map((l) => (l.key === key ? { ...l, [campo]: valor } : l)));
  };
  const quitar = (key: string) => setLineas((prev) => prev.filter((l) => l.key !== key));
  const agregar = () => setLineas((prev) => [...prev, nuevaLinea('cheque_galicia', '')]);

  return (
    <div className="rounded-lg border border-rodziny-200 bg-rodziny-50/40 p-3">
      <div className="mb-2 text-xs text-gray-600">
        Cargá cada pago (transferencia, echeq, etc.). La suma debe dar el total de la factura.
        Las cuotas con <strong>fecha futura</strong> quedan agendadas como echeq a vencer e impactan
        el flujo en su mes.
      </div>

      <div className="space-y-2">
        {lineas.map((l, i) => {
          const montoNum = parseNumeroAR(l.montoTexto) ?? 0;
          const programado = !!l.fecha && l.fecha > hoy;
          const requiereNumero = medioRequiereComprobante(l.medio);
          return (
            <div key={l.key} className="rounded border border-gray-200 bg-white p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">Pago {i + 1}</span>
                <div className="flex items-center gap-2">
                  {programado && (
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                      🗓 echeq a vencer
                    </span>
                  )}
                  {lineas.length > 1 && (
                    <button
                      type="button"
                      onClick={() => quitar(l.key)}
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-gray-500">Medio</span>
                  <select
                    value={l.medio}
                    onChange={(e) => actualizar(l.key, 'medio', e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
                  >
                    {(Object.keys(MEDIO_PAGO_LABEL) as MedioPago[]).map((m) => (
                      <option key={m} value={m}>
                        {MEDIO_PAGO_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-gray-500">Monto</span>
                  <div className="flex items-center rounded border border-gray-300">
                    <span className="px-2 text-xs text-gray-500">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={l.montoTexto}
                      onChange={(e) => actualizar(l.key, 'montoTexto', e.target.value)}
                      onBlur={() => {
                        const n = parseNumeroAR(l.montoTexto);
                        if (n !== null) actualizar(l.key, 'montoTexto', formatNumeroAR(n));
                      }}
                      placeholder="0"
                      className="w-full rounded-r px-1 py-1.5 text-xs tabular-nums focus:outline-none"
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-gray-500">
                    Fecha {programado ? '(débito futuro)' : 'del pago'}
                  </span>
                  <input
                    type="date"
                    value={l.fecha}
                    onChange={(e) => actualizar(l.key, 'fecha', e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
                  />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-gray-500">
                    N° op / echeq {requiereNumero ? '' : '(opcional)'}
                  </span>
                  <input
                    type="text"
                    value={l.numero}
                    onChange={(e) => actualizar(l.key, 'numero', e.target.value)}
                    placeholder={l.medio === 'cheque_galicia' ? 'N° de echeq' : 'N° de operación'}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-mono"
                  />
                </label>
              </div>

              {/* Comprobante de pago de la cuota — con OCR (saca el N° automático) */}
              {requiereNumero && (
                <div className="mt-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] text-rodziny-700 hover:underline">
                    📎 {l.comprobanteNombre ? 'Reemplazar comprobante' : 'Adjuntar comprobante (lee el N° solo)'}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      disabled={l.ocrEjecutando}
                      onChange={(e) => onSubirComprobante(l.key, e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {l.comprobanteNombre && (
                    <div className="mt-0.5 truncate text-[11px] text-green-700">📎 {l.comprobanteNombre}</div>
                  )}
                  {l.ocrEjecutando && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-blue-700">
                      <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
                      Leyendo comprobante…
                    </div>
                  )}
                  {l.ocrInfo && !l.ocrEjecutando && (
                    <div className="mt-0.5 text-[11px] text-green-700">{l.ocrInfo}</div>
                  )}
                </div>
              )}

              {montoNum > 0 && (
                <div className="mt-1 text-right text-[11px] text-gray-500 tabular-nums">
                  {formatARS(montoNum)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={agregar}
        className="mt-2 w-full rounded border border-dashed border-rodziny-300 px-3 py-1.5 text-xs text-rodziny-700 hover:bg-rodziny-100"
      >
        + Agregar pago
      </button>

      {/* Resumen: suma vs total */}
      <div className="mt-3 space-y-1 border-t border-rodziny-200 pt-2 text-xs">
        <div className="flex justify-between text-gray-600">
          <span>Total factura</span>
          <span className="tabular-nums">{formatARS(importeTotal)}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Suma de los pagos</span>
          <span className="tabular-nums">{formatARS(totalPlan)}</span>
        </div>
        {planCuadra ? (
          <div className="flex justify-between font-semibold text-green-700">
            <span>✓ Cuadra con el total</span>
            <span className="tabular-nums">{formatARS(0)}</span>
          </div>
        ) : (
          <div className="flex justify-between font-semibold text-amber-800">
            <span>{faltaAsignar > 0 ? 'Falta asignar' : 'Te pasaste por'}</span>
            <span className="tabular-nums">{formatARS(Math.abs(faltaAsignar))}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}

function StepBadge({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
          done
            ? 'bg-green-600 text-white'
            : active
              ? 'bg-rodziny-600 text-white'
              : 'bg-gray-300 text-white',
        )}
      >
        {done ? '✓' : n}
      </div>
      <span
        className={cn(
          'font-medium',
          done || active ? 'text-gray-800' : 'text-gray-400',
        )}
      >
        {label}
      </span>
    </div>
  );
}
