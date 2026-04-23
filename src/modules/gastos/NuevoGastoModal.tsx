import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { cn, formatARS } from '@/lib/utils';
import type {
  Proveedor,
  CategoriaGasto,
  Gasto,
  ItemGastoStock,
  TipoComprobante,
  MedioPago,
  EstadoPago,
} from './types';
import { TIPO_COMPROBANTE_LABEL, MEDIO_PAGO_LABEL } from './types';

export interface PrefillGasto {
  recepcion_id?: string;
  local?: 'vedia' | 'saavedra';
  proveedor_nombre?: string | null;
  comprobante_path?: string | null;
  items?: { producto_id: string; producto_nombre: string; cantidad: number; unidad: string }[];
  comentario?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  gastoEditando?: Gasto | null;
  prefill?: PrefillGasto;
  onSaved?: (gastoId: string) => void;
}

const HOY = () => new Date().toISOString().split('T')[0];

interface FormState {
  local: 'vedia' | 'saavedra';
  fecha: string; // fecha del comprobante (devengado)
  fecha_vencimiento: string;
  proveedor_id: string | null;
  proveedor_libre: string; // si no hay id, se guarda como string libre
  categoria_id: string | null;
  tipo_comprobante: TipoComprobante;
  punto_venta: string;
  nro_comprobante: string;
  importe_neto: string;
  iva_rate: number; // 0 / 10.5 / 21 / 27
  iva: string;
  iibb: string;
  importe_total: string;
  comentario: string;
  estado_pago: EstadoPago;
  fecha_pago: string;
  medio_pago: MedioPago;
  vincular_stock: boolean;
  items: ItemGastoStock[];
}

const FORM_INICIAL: FormState = {
  local: 'vedia',
  fecha: HOY(),
  fecha_vencimiento: '',
  proveedor_id: null,
  proveedor_libre: '',
  categoria_id: null,
  tipo_comprobante: 'factura_a',
  punto_venta: '',
  nro_comprobante: '',
  importe_neto: '',
  iva_rate: 21,
  iva: '',
  iibb: '',
  importe_total: '',
  comentario: '',
  estado_pago: 'pendiente',
  fecha_pago: HOY(),
  medio_pago: 'transferencia_mp',
  vincular_stock: false,
  items: [],
};

export function NuevoGastoModal({ open, onClose, gastoEditando, prefill, onSaved }: Props) {
  const qc = useQueryClient();
  const { perfil } = useAuth();
  const [form, setForm] = useState<FormState>(FORM_INICIAL);
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [comprobantePath, setComprobantePath] = useState<string | null>(null);
  const [factura, setFactura] = useState<File | null>(null);
  const [facturaPath, setFacturaPath] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busquedaProducto, setBusquedaProducto] = useState('');
  // Drafts de texto crudo para los inputs numéricos de items. Sin esto
  // React re-render machaca la coma/punto que estás tipeando porque
  // it.cantidad/subtotal son number y parseFloat("10500,") => 10500.
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({});

  // Queries
  const { data: proveedores } = useQuery({
    queryKey: ['proveedores_activos'],
    queryFn: async () => {
      const { data } = await supabase
        .from('proveedores')
        .select('*')
        .eq('activo', true)
        .order('razon_social');
      return (data ?? []) as Proveedor[];
    },
    enabled: open,
  });

  const { data: categorias } = useQuery({
    queryKey: ['categorias_gasto_activas'],
    queryFn: async () => {
      const { data } = await supabase
        .from('categorias_gasto')
        .select('*')
        .eq('activo', true)
        .order('orden');
      return (data ?? []) as CategoriaGasto[];
    },
    enabled: open,
  });

  const { data: productos } = useQuery({
    queryKey: ['productos_para_gasto', form.local],
    queryFn: async () => {
      const { data } = await supabase
        .from('productos')
        .select('id, nombre, unidad, costo_unitario, stock_actual, categoria_gasto_id')
        .eq('local', form.local)
        .not('activo', 'is', false)
        .order('nombre');
      return data ?? [];
    },
    enabled: open && form.vincular_stock,
  });

  // Cargar al abrir
  useEffect(() => {
    if (!open) return;
    if (gastoEditando) {
      setForm({
        local: gastoEditando.local,
        fecha: gastoEditando.fecha,
        fecha_vencimiento: gastoEditando.fecha_vencimiento ?? '',
        proveedor_id: gastoEditando.proveedor_id,
        proveedor_libre: gastoEditando.proveedor ?? '',
        categoria_id: gastoEditando.categoria_id,
        tipo_comprobante: (gastoEditando.tipo_comprobante as TipoComprobante) || 'factura_a',
        punto_venta: gastoEditando.punto_venta ?? '',
        nro_comprobante: gastoEditando.nro_comprobante ?? '',
        importe_neto: String(gastoEditando.importe_neto ?? ''),
        iva_rate: (() => {
          const n = Number(gastoEditando.importe_neto ?? 0);
          const i = Number(gastoEditando.iva ?? 0);
          if (n > 0 && i > 0) {
            const r = (i / n) * 100;
            if (Math.abs(r - 10.5) < 1) return 10.5;
            if (Math.abs(r - 27) < 1) return 27;
          }
          return 21;
        })(),
        iva: String(gastoEditando.iva ?? ''),
        iibb: String(gastoEditando.iibb ?? ''),
        importe_total: String(gastoEditando.importe_total ?? ''),
        comentario: gastoEditando.comentario ?? '',
        estado_pago: (gastoEditando.estado_pago?.toLowerCase() === 'pagado'
          ? 'pagado'
          : 'pendiente') as EstadoPago,
        fecha_pago: gastoEditando.fecha_vencimiento ?? HOY(),
        medio_pago: 'transferencia_mp',
        // Cargar ítems guardados del gasto (si los tiene). Se mantienen editables para corregir errores.
        vincular_stock: !!gastoEditando.items_json?.length,
        items: (gastoEditando.items_json ?? []).map((it) => ({
          producto_id: it.producto_id,
          producto_nombre: it.producto_nombre,
          cantidad: it.cantidad,
          unidad: it.unidad,
          precio_unitario: it.precio_unitario ?? 0,
          subtotal: it.subtotal ?? (it.precio_unitario ?? 0) * it.cantidad,
          categoria_gasto_id: it.categoria_gasto_id ?? null,
        })),
      });
      setComprobantePath(gastoEditando.comprobante_path);
      setFacturaPath(gastoEditando.factura_path ?? null);
    } else {
      setForm({
        ...FORM_INICIAL,
        local: prefill?.local ?? 'vedia',
        proveedor_libre: prefill?.proveedor_nombre ?? '',
        comentario: prefill?.comentario ?? '',
        vincular_stock: !!prefill?.items?.length,
        items: (prefill?.items ?? []).map((it) => ({
          producto_id: it.producto_id,
          producto_nombre: it.producto_nombre,
          cantidad: it.cantidad,
          unidad: it.unidad,
          precio_unitario: 0,
          subtotal: 0,
          categoria_gasto_id: null,
        })),
      });
      setComprobantePath(prefill?.comprobante_path ?? null);
      setFacturaPath(null);
    }
    setComprobante(null);
    setFactura(null);
    setError(null);
    setBusquedaProducto('');
    setItemDrafts({});
  }, [open, gastoEditando, prefill]);

  // Cuando productos termina de cargar, completar categoria_gasto_id de items
  // que vinieron de prefill (recepción) con el valor guardado del producto.
  useEffect(() => {
    if (!open || !productos || form.items.length === 0) return;
    setForm((f) => {
      let cambio = false;
      const nuevos = f.items.map((it) => {
        if (it.categoria_gasto_id) return it;
        const p: any = productos.find((x: any) => x.id === it.producto_id);
        if (p?.categoria_gasto_id) {
          cambio = true;
          return { ...it, categoria_gasto_id: p.categoria_gasto_id };
        }
        return it;
      });
      return cambio ? { ...f, items: nuevos } : f;
    });
  }, [open, productos]);

  // Categorías padre (raíz) y derivación del padre desde la subcat elegida
  const padresCat = useMemo(
    () => (categorias ?? []).filter((c) => c.parent_id == null),
    [categorias],
  );
  const padreSeleccionado = useMemo(() => {
    if (!form.categoria_id || !categorias) return null;
    const sub = categorias.find((c) => c.id === form.categoria_id);
    if (!sub?.parent_id) return null;
    return categorias.find((c) => c.id === sub.parent_id) ?? null;
  }, [categorias, form.categoria_id]);

  // Auto-match proveedor: si vino prefill con string, intentar matchear
  useEffect(() => {
    if (!open || gastoEditando || form.proveedor_id || !form.proveedor_libre || !proveedores)
      return;
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    const objetivo = norm(form.proveedor_libre);
    const match = proveedores.find((p) => norm(p.razon_social) === objetivo);
    if (match) {
      setForm((f) => ({
        ...f,
        proveedor_id: match.id,
        categoria_id: f.categoria_id ?? match.categoria_default_id,
        medio_pago: (match.medio_pago_default as MedioPago) ?? f.medio_pago,
      }));
    }
  }, [open, gastoEditando, form.proveedor_libre, form.proveedor_id, proveedores]);

  // Cuando se elige proveedor, autocompletar categoría default y vencimiento
  function elegirProveedor(id: string) {
    const p = proveedores?.find((x) => x.id === id);
    if (!p) return;
    setForm((f) => {
      let venc = f.fecha_vencimiento;
      if (!venc && f.fecha && p.dias_pago) {
        const d = new Date(f.fecha);
        d.setDate(d.getDate() + p.dias_pago);
        venc = d.toISOString().split('T')[0];
      }
      return {
        ...f,
        proveedor_id: id,
        proveedor_libre: p.razon_social,
        categoria_id: f.categoria_id ?? p.categoria_default_id,
        medio_pago: (p.medio_pago_default as MedioPago) ?? f.medio_pago,
        fecha_vencimiento: venc,
      };
    });
  }

  // Calcular totales automáticamente
  function calcularDesdeNeto(neto: string, rate: number = form.iva_rate) {
    const n = parseFloat(neto.replace(',', '.')) || 0;
    const iva = +((n * rate) / 100).toFixed(2);
    const total = +(n + iva + (parseFloat(form.iibb.replace(',', '.')) || 0)).toFixed(2);
    setForm((f) => ({
      ...f,
      importe_neto: neto,
      iva_rate: rate,
      iva: String(iva),
      importe_total: String(total),
    }));
  }

  function calcularDesdeTotal(total: string, rate: number = form.iva_rate) {
    const t = parseFloat(total.replace(',', '.')) || 0;
    // Desglosamos IVA siempre que la alícuota sea > 0, sin importar el tipo de
    // comprobante: el tipo es solo documental, el cálculo depende de la alícuota.
    // Si el comprobante no discrimina IVA, el usuario pone alícuota 0.
    if (rate > 0) {
      const factor = 1 + rate / 100;
      const neto = +(t / factor).toFixed(2);
      const iva = +(t - neto).toFixed(2);
      setForm((f) => ({
        ...f,
        importe_total: total,
        iva_rate: rate,
        importe_neto: String(neto),
        iva: String(iva),
      }));
    } else {
      setForm((f) => ({
        ...f,
        importe_total: total,
        iva_rate: rate,
        importe_neto: String(t),
        iva: '0',
      }));
    }
  }

  function cambiarIvaRate(rate: number) {
    // Recalcular desde el total existente si lo hay, si no desde el neto
    if (form.importe_total) {
      calcularDesdeTotal(form.importe_total, rate);
    } else if (form.importe_neto) {
      calcularDesdeNeto(form.importe_neto, rate);
    } else {
      setForm((f) => ({ ...f, iva_rate: rate }));
    }
  }

  // Items del stock
  const totalItems = useMemo(
    () => form.items.reduce((s, it) => s + (it.subtotal || it.precio_unitario * it.cantidad), 0),
    [form.items],
  );

  // Items faltantes de subcategoría
  const itemsSinSubcat = useMemo(
    () => form.items.filter((it) => !it.categoria_gasto_id),
    [form.items],
  );

  // Split del gasto en subcategorías del EdR. Prorratea neto/iva/iibb/total
  // proporcional al subtotal de items que caen en cada subcat.
  const splitPorSubcat = useMemo(() => {
    if (!form.vincular_stock || form.items.length === 0 || itemsSinSubcat.length > 0) return [];
    const netoT = parseFloat(form.importe_neto.replace(',', '.')) || 0;
    const ivaT = parseFloat(form.iva.replace(',', '.')) || 0;
    const iibbT = parseFloat(form.iibb.replace(',', '.')) || 0;
    const totalT = parseFloat(form.importe_total.replace(',', '.')) || 0;
    const totalIt = totalItems || 1;

    const map = new Map<string, { subtotal: number; items: typeof form.items }>();
    for (const it of form.items) {
      const k = it.categoria_gasto_id!;
      const prev = map.get(k) ?? { subtotal: 0, items: [] };
      prev.subtotal += it.subtotal || it.precio_unitario * it.cantidad;
      prev.items.push(it);
      map.set(k, prev);
    }
    return Array.from(map.entries()).map(([catId, g]) => {
      const prop = g.subtotal / totalIt;
      const sub = categorias?.find((c) => c.id === catId);
      const padre = sub?.parent_id ? categorias?.find((c) => c.id === sub.parent_id) : null;
      return {
        categoria_id: catId,
        subcat_nombre: sub?.nombre ?? '—',
        padre_nombre: padre?.nombre ?? null,
        items: g.items,
        subtotal_items: +g.subtotal.toFixed(2),
        proporcion: prop,
        neto: +(netoT * prop).toFixed(2),
        iva: +(ivaT * prop).toFixed(2),
        iibb: +(iibbT * prop).toFixed(2),
        total: +(totalT * prop).toFixed(2),
      };
    });
  }, [
    form.vincular_stock,
    form.items,
    form.importe_neto,
    form.iva,
    form.iibb,
    form.importe_total,
    totalItems,
    itemsSinSubcat,
    categorias,
  ]);

  const usarSplit = splitPorSubcat.length >= 1 && form.vincular_stock && !gastoEditando;

  function agregarProducto(productoId: string) {
    const p = productos?.find((x: any) => x.id === productoId);
    if (!p) return;
    setForm((f) => ({
      ...f,
      items: [
        ...f.items,
        {
          producto_id: p.id,
          producto_nombre: p.nombre,
          cantidad: 1,
          unidad: p.unidad,
          precio_unitario: p.costo_unitario || 0,
          subtotal: +((p.costo_unitario || 0) * 1).toFixed(2),
          categoria_gasto_id: (p as any).categoria_gasto_id ?? null,
        },
      ],
    }));
    setBusquedaProducto('');
  }

  function actualizarSubcatItem(idx: number, categoria_id: string | null) {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, categoria_gasto_id: categoria_id } : it)),
    }));
  }

  function actualizarItem(idx: number, campo: 'cantidad' | 'subtotal', valor: string) {
    setItemDrafts((d) => ({ ...d, [`${idx}:${campo}`]: valor }));
    const v = parseFloat(valor.replace(',', '.')) || 0;
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== idx) return it;
        if (campo === 'cantidad') {
          // Al cambiar cantidad: mantengo el subtotal y recalculo precio_unitario
          const next = { ...it, cantidad: v };
          next.precio_unitario = v > 0 ? +(it.subtotal / v).toFixed(4) : 0;
          return next;
        } else {
          // Al cambiar subtotal: recalculo precio_unitario
          const next = { ...it, subtotal: v };
          next.precio_unitario = it.cantidad > 0 ? +(v / it.cantidad).toFixed(4) : 0;
          return next;
        }
      }),
    }));
  }

  function quitarItem(idx: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  function aplicarTotalDesdeItems() {
    if (form.tipo_comprobante === 'factura_a') {
      calcularDesdeTotal(String(totalItems));
    } else {
      setForm((f) => ({
        ...f,
        importe_total: String(totalItems),
        importe_neto: String(totalItems),
        iva: '0',
      }));
    }
  }

  // Buscar productos por texto
  const productosFiltrados = useMemo(() => {
    if (!productos || !busquedaProducto.trim()) return [];
    const b = busquedaProducto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return (productos as any[])
      .filter((p) => {
        const n = (p.nombre ?? '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        return n.includes(b) && !form.items.some((it) => it.producto_id === p.id);
      })
      .slice(0, 8);
  }, [productos, busquedaProducto, form.items]);

  async function guardar() {
    setError(null);
    if (!form.fecha) {
      setError('Fecha del comprobante requerida');
      return;
    }
    if (!form.importe_total || parseFloat(form.importe_total) <= 0) {
      setError('Importe total requerido');
      return;
    }
    if (!form.proveedor_id && !form.proveedor_libre.trim()) {
      setError('Proveedor requerido');
      return;
    }

    // Validación de subcategoría según el modo:
    //  - Si vinculás stock, cada item tiene que tener subcategoría asignada.
    //  - Si no, tiene que estar el select general lleno.
    if (usarSplit) {
      if (itemsSinSubcat.length > 0) {
        setError(`Faltan subcategorías en ${itemsSinSubcat.length} item(s) del stock`);
        return;
      }
    } else {
      if (!form.categoria_id) {
        setError('Subcategoría requerida');
        return;
      }
    }

    setGuardando(true);
    try {
      // 1) Subir comprobante de pago si hay uno nuevo
      let pathComprobante = comprobantePath;
      if (comprobante) {
        const ext = comprobante.name.split('.').pop()?.toLowerCase() || 'pdf';
        const path = `${form.local}/${form.fecha.substring(0, 7)}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: errUp } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(path, comprobante, {
            contentType: comprobante.type || 'application/octet-stream',
          });
        if (errUp) throw errUp;
        pathComprobante = path;
      }

      // 1b) Subir factura fiscal si hay una nueva.
      // Usamos la misma estructura de carpetas que el comprobante de pago
      // (`local/YYYY-MM/...`) para no chocar con las políticas RLS del bucket,
      // y diferenciamos con el prefijo "factura_" en el nombre del archivo.
      let pathFactura = facturaPath;
      if (factura) {
        const ext = factura.name.split('.').pop()?.toLowerCase() || 'pdf';
        const path = `${form.local}/${form.fecha.substring(0, 7)}/factura_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: errUp } = await supabase.storage
          .from('gastos-comprobantes')
          .upload(path, factura, { contentType: factura.type || 'application/octet-stream' });
        if (errUp) throw errUp;
        pathFactura = path;
      }

      const proveedorObj = proveedores?.find((p) => p.id === form.proveedor_id);
      const periodo = form.fecha.substring(0, 7); // YYYY-MM
      const nroCompleto = [form.punto_venta.trim(), form.nro_comprobante.trim()]
        .filter(Boolean)
        .join('-');
      const proveedorNombre = proveedorObj?.razon_social ?? form.proveedor_libre.trim();

      // Helper: construye el payload base de un gasto (montos se pisan después)
      const buildPayload = (
        categoria_id: string,
        neto: number,
        iva: number,
        iibb: number,
        total: number,
        comentarioExtra?: string,
        itemsDelGrupo?: ItemGastoStock[],
      ) => {
        const sub = categorias?.find((c) => c.id === categoria_id);
        const padre = sub?.parent_id ? categorias?.find((c) => c.id === sub.parent_id) : null;
        const comentarioBase = form.comentario.trim();
        const comentario = [comentarioBase, comentarioExtra].filter(Boolean).join(' · ') || null;
        const itemsParaGuardar = form.vincular_stock
          ? (itemsDelGrupo ?? form.items).filter((it) => it.producto_id)
          : null;
        return {
          local: form.local,
          fecha: form.fecha,
          fecha_vencimiento: form.fecha_vencimiento || null,
          proveedor: proveedorNombre,
          proveedor_id: form.proveedor_id,
          categoria: padre?.nombre ?? sub?.nombre ?? null,
          subcategoria: sub?.nombre ?? null,
          categoria_id,
          comentario,
          importe_neto: neto,
          iva,
          iibb,
          importe_total: total,
          medio_pago: form.estado_pago === 'pagado' ? form.medio_pago : null,
          tipo_comprobante: form.tipo_comprobante,
          punto_venta: form.punto_venta.trim() || null,
          nro_comprobante: form.nro_comprobante.trim() || null,
          estado_pago: form.estado_pago === 'pagado' ? 'Pagado' : 'Pendiente',
          comprobante_path: pathComprobante,
          factura_path: pathFactura,
          recepcion_id: prefill?.recepcion_id ?? null,
          creado_por: perfil?.nombre ?? null,
          creado_manual: true,
          cancelado: false,
          periodo,
          items_json: itemsParaGuardar && itemsParaGuardar.length > 0 ? itemsParaGuardar : null,
        };
      };

      // 2) Insertar gastos (1 solo si no hay split; N si lo hay)
      const gastosCreados: string[] = [];
      if (gastoEditando) {
        // Edición: siempre 1 fila, sin split
        const catId = form.categoria_id!;
        const payload = buildPayload(
          catId,
          parseFloat(form.importe_neto.replace(',', '.')) || 0,
          parseFloat(form.iva.replace(',', '.')) || 0,
          parseFloat(form.iibb.replace(',', '.')) || 0,
          parseFloat(form.importe_total.replace(',', '.')) || 0,
        );
        const { error: errUp } = await supabase
          .from('gastos')
          .update(payload)
          .eq('id', gastoEditando.id);
        if (errUp) throw errUp;
        gastosCreados.push(gastoEditando.id);
      } else if (usarSplit && splitPorSubcat.length > 1) {
        // Split: una fila por subcategoría, cada una con sus propios items
        const nroLabel = nroCompleto || 'comprobante';
        const rows = splitPorSubcat.map((s, i) =>
          buildPayload(
            s.categoria_id,
            s.neto,
            s.iva,
            s.iibb,
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
        // Caso normal: una sola fila
        const catId = usarSplit ? splitPorSubcat[0].categoria_id : form.categoria_id!;
        const payload = buildPayload(
          catId,
          parseFloat(form.importe_neto.replace(',', '.')) || 0,
          parseFloat(form.iva.replace(',', '.')) || 0,
          parseFloat(form.iibb.replace(',', '.')) || 0,
          parseFloat(form.importe_total.replace(',', '.')) || 0,
        );
        const { data: ins, error: errIns } = await supabase
          .from('gastos')
          .insert(payload)
          .select('id')
          .single();
        if (errIns) throw errIns;
        gastosCreados.push(ins!.id as string);
      }

      // 3) Pagos: si está marcado como pagado, crear un row por cada gasto creado
      if (form.estado_pago === 'pagado' && !gastoEditando) {
        const rowsPago = gastosCreados.map((gid, i) => ({
          gasto_id: gid,
          fecha_pago: form.fecha_pago,
          monto:
            usarSplit && splitPorSubcat.length > 1
              ? splitPorSubcat[i].total
              : parseFloat(form.importe_total.replace(',', '.')) || 0,
          medio_pago: form.medio_pago,
          creado_por: perfil?.nombre ?? null,
        }));
        const { error: errPago } = await supabase.from('pagos_gastos').insert(rowsPago);
        if (errPago) throw errPago;
      }

      // 4) Stock + movimientos + self-learning de categoria_gasto_id en productos
      if (form.vincular_stock && form.items.length > 0 && !gastoEditando) {
        for (const it of form.items) {
          const { data: prodActual } = await supabase
            .from('productos')
            .select('stock_actual, categoria_gasto_id')
            .eq('id', it.producto_id)
            .single();
          if (prodActual) {
            const updates: Record<string, unknown> = {
              stock_actual: (prodActual.stock_actual ?? 0) + it.cantidad,
              costo_unitario: it.precio_unitario,
              updated_at: new Date().toISOString(),
            };
            // Self-learning: si el producto no tenía subcat guardada, persistir la actual
            if (!prodActual.categoria_gasto_id && it.categoria_gasto_id) {
              updates.categoria_gasto_id = it.categoria_gasto_id;
            }
            await supabase.from('productos').update(updates).eq('id', it.producto_id);
          }
          await supabase.from('movimientos_stock').insert({
            local: form.local,
            producto_id: it.producto_id,
            producto_nombre: it.producto_nombre,
            tipo: 'entrada',
            cantidad: it.cantidad,
            unidad: it.unidad,
            motivo: 'Compra a proveedor',
            observacion: `Gasto ${proveedorNombre} · ${form.tipo_comprobante.toUpperCase()} ${nroCompleto}`,
            registrado_por: perfil?.nombre ?? null,
          });
        }
      }

      // 5) Si vino de una recepción pendiente, linkearla al PRIMER gasto
      if (prefill?.recepcion_id && gastosCreados.length > 0) {
        await supabase
          .from('recepciones_pendientes')
          .update({
            estado: 'validada',
            gasto_id: gastosCreados[0],
            validada_en: new Date().toISOString(),
            validada_por: perfil?.nombre ?? null,
          })
          .eq('id', prefill.recepcion_id);
      }

      const gastoId = gastosCreados[0];

      qc.invalidateQueries({ queryKey: ['gastos'] });
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
      qc.invalidateQueries({ queryKey: ['gastos_pagos'] });
      qc.invalidateQueries({ queryKey: ['gastos_vista'] });
      qc.invalidateQueries({ queryKey: ['recepciones_pendientes'] });
      qc.invalidateQueries({ queryKey: ['productos_stock'] });
      qc.invalidateQueries({ queryKey: ['productos_para_gasto'] });
      qc.invalidateQueries({ queryKey: ['pagos_gastos'] });
      onSaved?.(gastoId);
      onClose();
    } catch (e: any) {
      const partes = [e?.message ?? 'Error al guardar'];
      if (e?.code) partes.push(`(${e.code})`);
      if (e?.details) partes.push(`· ${e.details}`);
      if (e?.hint) partes.push(`· ${e.hint}`);
      const mensaje = partes.join(' ');
      // Log detallado en consola para diagnosticar errores de RLS / check constraints
      console.error('[NuevoGasto] Error al guardar:', e);
      setError(mensaje);
    } finally {
      setGuardando(false);
    }
  }

  async function verComprobanteExistente() {
    if (!comprobantePath) return;
    // Intentar 3 buckets — el path puede vivir en cualquiera según el flujo de carga
    const BUCKETS = ['gastos-comprobantes', 'comprobantes', 'recepciones-fotos'];
    for (const bucket of BUCKETS) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(comprobantePath, 60);
      if (!error && data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
        return;
      }
    }
    window.alert('No se pudo abrir el comprobante');
  }

  async function verFacturaExistente() {
    if (!facturaPath) return;
    const BUCKETS = ['gastos-comprobantes', 'comprobantes'];
    for (const bucket of BUCKETS) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(facturaPath, 60);
      if (!error && data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
        return;
      }
    }
    window.alert('No se pudo abrir la factura');
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div>
            <h3 className="font-semibold text-gray-900">
              {gastoEditando ? 'Editar gasto' : 'Nuevo gasto'}
            </h3>
            {prefill?.recepcion_id && (
              <p className="mt-0.5 text-xs text-amber-700">📥 Cargando desde recepción pendiente</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-2xl leading-none text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Sección 1: Datos del comprobante */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Comprobante
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Local *</label>
                <select
                  value={form.local}
                  onChange={(e) =>
                    setForm({ ...form, local: e.target.value as 'vedia' | 'saavedra' })
                  }
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="vedia">Rodziny Vedia</option>
                  <option value="saavedra">Rodziny Saavedra</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Tipo de comprobante *</label>
                <select
                  value={form.tipo_comprobante}
                  onChange={(e) =>
                    setForm({ ...form, tipo_comprobante: e.target.value as TipoComprobante })
                  }
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  {Object.entries(TIPO_COMPROBANTE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Punto de venta</label>
                <input
                  value={form.punto_venta}
                  onChange={(e) => setForm({ ...form, punto_venta: e.target.value })}
                  placeholder="0001"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">N° comprobante</label>
                <input
                  value={form.nro_comprobante}
                  onChange={(e) => setForm({ ...form, nro_comprobante: e.target.value })}
                  placeholder="00001234"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Fecha del comprobante *</label>
                <input
                  type="date"
                  value={form.fecha}
                  onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Vencimiento</label>
                <input
                  type="date"
                  value={form.fecha_vencimiento}
                  onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Sección 2: Proveedor + Categoría */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Proveedor & categoría
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Proveedor *</label>
                <select
                  value={form.proveedor_id ?? ''}
                  onChange={(e) =>
                    e.target.value
                      ? elegirProveedor(e.target.value)
                      : setForm({ ...form, proveedor_id: null })
                  }
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— Seleccionar —</option>
                  {(proveedores ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.razon_social}
                    </option>
                  ))}
                </select>
                {form.proveedor_libre && !form.proveedor_id && (
                  <div className="mt-1 text-[11px] text-amber-600">
                    "{form.proveedor_libre}" no está en la lista. Se va a guardar como texto libre.
                    <button
                      type="button"
                      onClick={async () => {
                        const { data, error } = await supabase
                          .from('proveedores')
                          .insert({
                            razon_social: form.proveedor_libre.trim(),
                            activo: true,
                          })
                          .select('id')
                          .single();
                        if (error) {
                          window.alert(error.message);
                          return;
                        }
                        qc.invalidateQueries({ queryKey: ['proveedores_activos'] });
                        setForm((f) => ({ ...f, proveedor_id: data!.id as string }));
                      }}
                      className="ml-1 text-rodziny-700 underline"
                    >
                      Crear ahora
                    </button>
                  </div>
                )}
              </div>
              {form.vincular_stock && form.items.length > 0 ? (
                <div>
                  <label className="mb-1 block text-xs text-gray-600">Subcategoría</label>
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Cargada por item (abajo en "Vincular a stock"). Este comprobante se va a dividir
                    según las subcategorías de los productos.
                  </div>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs text-gray-600">Subcategoría *</label>
                  <select
                    value={form.categoria_id ?? ''}
                    onChange={(e) => setForm({ ...form, categoria_id: e.target.value || null })}
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— Seleccionar —</option>
                    {padresCat.map((p) => {
                      const hijos = (categorias ?? []).filter((c) => c.parent_id === p.id);
                      if (hijos.length === 0) return null;
                      return (
                        <optgroup key={p.id} label={p.nombre}>
                          {hijos.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.nombre}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <p className="mt-1 text-[11px] text-gray-500">
                    Categoría:{' '}
                    <strong className="text-gray-700">{padreSeleccionado?.nombre ?? '—'}</strong>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Sección 3: Importes */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Importes
            </h4>
            <div className="grid grid-cols-5 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Neto</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.importe_neto}
                  onChange={(e) => calcularDesdeNeto(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-right text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Alícuota IVA</label>
                <select
                  value={form.iva_rate}
                  onChange={(e) => cambiarIvaRate(parseFloat(e.target.value))}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm"
                >
                  <option value={0}>0%</option>
                  <option value={10.5}>10,5%</option>
                  <option value={21}>21%</option>
                  <option value={27}>27%</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">IVA $</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.iva}
                  onChange={(e) => setForm({ ...form, iva: e.target.value })}
                  className="w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-right text-sm"
                  readOnly
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">IIBB</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.iibb}
                  onChange={(e) => setForm({ ...form, iibb: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-right text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Total *</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.importe_total}
                  onChange={(e) => calcularDesdeTotal(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded border border-rodziny-400 px-3 py-2 text-right text-sm font-semibold"
                />
              </div>
            </div>
            <p className="mt-1 text-[10px] text-gray-400">
              Cargá Neto o Total y se autocalcula según la alícuota. Si el comprobante no discrimina
              IVA, poné alícuota 0%.
            </p>
          </div>

          {/* Sección 4: Vincular a stock */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.vincular_stock}
                onChange={(e) => setForm({ ...form, vincular_stock: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm font-medium text-gray-700">Vincular a stock</span>
              <span className="text-[11px] text-gray-500">
                (suma los productos al inventario y crea movimiento de entrada)
              </span>
            </label>

            {form.vincular_stock && (
              <div className="mt-3 space-y-2">
                {gastoEditando && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    Si modificás cantidades o productos acá, el{' '}
                    <strong>stock actual no se ajusta automáticamente</strong>. Los cambios quedan
                    guardados en el gasto; si necesitás corregir el stock, hacelo manualmente desde
                    Movimientos.
                  </div>
                )}
                {/* Items cargados */}
                {form.items.length > 0 && (
                  <div className="divide-y divide-gray-100 rounded border border-gray-200 bg-white">
                    {form.items.map((it, idx) => (
                      <div key={idx} className="space-y-1.5 px-3 py-2 text-xs">
                        <div className="grid grid-cols-12 items-center gap-2">
                          <div className="col-span-4 truncate font-medium">
                            {it.producto_nombre}
                          </div>
                          <div className="col-span-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={itemDrafts[`${idx}:cantidad`] ?? String(it.cantidad)}
                              onChange={(e) => actualizarItem(idx, 'cantidad', e.target.value)}
                              onBlur={() =>
                                setItemDrafts((d) => {
                                  const { [`${idx}:cantidad`]: _, ...rest } = d;
                                  return rest;
                                })
                              }
                              className="w-full rounded border border-gray-300 px-2 py-1 text-right text-xs"
                            />
                          </div>
                          <div className="col-span-1 text-gray-500">{it.unidad}</div>
                          <div className="col-span-2 text-right text-[10px] text-gray-500">
                            {formatARS(it.precio_unitario)}/u
                          </div>
                          <div className="col-span-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={itemDrafts[`${idx}:subtotal`] ?? String(it.subtotal)}
                              onChange={(e) => actualizarItem(idx, 'subtotal', e.target.value)}
                              onBlur={() =>
                                setItemDrafts((d) => {
                                  const { [`${idx}:subtotal`]: _, ...rest } = d;
                                  return rest;
                                })
                              }
                              placeholder="Total $"
                              className="w-full rounded border border-gray-300 px-2 py-1 text-right text-xs font-medium"
                            />
                          </div>
                          <div className="col-span-1 text-right">
                            <button
                              onClick={() => quitarItem(idx)}
                              className="text-xs text-red-500"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        <div className="pl-1">
                          <select
                            value={it.categoria_gasto_id ?? ''}
                            onChange={(e) => actualizarSubcatItem(idx, e.target.value || null)}
                            className={cn(
                              'w-full rounded border bg-white px-2 py-1 text-[11px]',
                              it.categoria_gasto_id
                                ? 'border-gray-200 text-gray-700'
                                : 'border-amber-300 bg-amber-50 text-amber-800',
                            )}
                          >
                            <option value="">⚠ Elegí subcategoría del EdR...</option>
                            {padresCat.map((p) => {
                              const hijos = (categorias ?? []).filter((c) => c.parent_id === p.id);
                              if (hijos.length === 0) return null;
                              return (
                                <optgroup key={p.id} label={p.nombre}>
                                  {hijos.map((h) => (
                                    <option key={h.id} value={h.id}>
                                      {h.nombre}
                                    </option>
                                  ))}
                                </optgroup>
                              );
                            })}
                          </select>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
                      <span className="text-xs text-gray-600">Subtotal items</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{formatARS(totalItems)}</span>
                        <button
                          type="button"
                          onClick={aplicarTotalDesdeItems}
                          className="text-[11px] text-rodziny-700 underline"
                        >
                          Aplicar al total
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Buscar producto para agregar */}
                <div className="relative">
                  <input
                    value={busquedaProducto}
                    onChange={(e) => setBusquedaProducto(e.target.value)}
                    placeholder="Buscar producto para agregar..."
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs"
                  />
                  {productosFiltrados.length > 0 && (
                    <div className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
                      {productosFiltrados.map((p: any) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => agregarProducto(p.id)}
                          className="w-full border-b border-gray-50 px-3 py-1.5 text-left text-xs hover:bg-gray-100"
                        >
                          <div className="font-medium">{p.nombre}</div>
                          <div className="text-[10px] text-gray-500">
                            stock {p.stock_actual} {p.unidad} · costo{' '}
                            {formatARS(p.costo_unitario || 0)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sección 5: Estado del pago */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Estado del pago
            </h4>
            <div className="mb-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, estado_pago: 'pendiente' })}
                className={cn(
                  'rounded border px-3 py-1.5 text-xs font-medium',
                  form.estado_pago === 'pendiente'
                    ? 'border-amber-400 bg-amber-100 text-amber-800'
                    : 'border-gray-300 bg-white text-gray-600',
                )}
              >
                Pendiente
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, estado_pago: 'pagado' })}
                className={cn(
                  'rounded border px-3 py-1.5 text-xs font-medium',
                  form.estado_pago === 'pagado'
                    ? 'border-green-400 bg-green-100 text-green-800'
                    : 'border-gray-300 bg-white text-gray-600',
                )}
              >
                Pagado
              </button>
            </div>
            {form.estado_pago === 'pagado' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-600">Fecha de pago</label>
                  <input
                    type="date"
                    value={form.fecha_pago}
                    onChange={(e) => setForm({ ...form, fecha_pago: e.target.value })}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">Medio de pago</label>
                  <select
                    value={form.medio_pago}
                    onChange={(e) => setForm({ ...form, medio_pago: e.target.value as MedioPago })}
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    {Object.entries(MEDIO_PAGO_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Sección 6: Adjuntos + comentario */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Adjuntos y notas
            </h4>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  Comprobante de pago (transferencia / voucher)
                </label>
                {comprobantePath && !comprobante ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={verComprobanteExistente}
                      className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                    >
                      📎 Ver actual
                    </button>
                    <label className="cursor-pointer rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300">
                      Reemplazar
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
                    className="text-xs"
                  />
                )}
                {comprobante && (
                  <div className="mt-1 text-[11px] text-green-700">📎 {comprobante.name}</div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  Factura A / C / Remito (comprobante fiscal del proveedor)
                </label>
                {facturaPath && !factura ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={verFacturaExistente}
                      className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                    >
                      🧾 Ver factura
                    </button>
                    <label className="cursor-pointer rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300">
                      Reemplazar
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => setFactura(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setFactura(e.target.files?.[0] ?? null)}
                    className="text-xs"
                  />
                )}
                {factura && (
                  <div className="mt-1 text-[11px] text-emerald-700">🧾 {factura.name}</div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">Comentario</label>
                <textarea
                  value={form.comentario}
                  onChange={(e) => setForm({ ...form, comentario: e.target.value })}
                  rows={2}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Preview del split en N gastos */}
          {form.vincular_stock && form.items.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                División por subcategoría del EdR
              </h4>
              {itemsSinSubcat.length > 0 ? (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⚠ Asigná una subcategoría a cada item para poder dividir el gasto. Faltan{' '}
                  {itemsSinSubcat.length} de {form.items.length}.
                </div>
              ) : splitPorSubcat.length === 1 ? (
                <div className="text-xs text-gray-600">
                  Todos los items van a{' '}
                  <strong className="text-gray-800">{splitPorSubcat[0].subcat_nombre}</strong>. Se
                  crea 1 gasto con el total completo.
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-[11px] text-gray-500">
                    Este comprobante se va a dividir en{' '}
                    <strong>{splitPorSubcat.length} gastos</strong> — todos con el mismo proveedor,
                    nro de comprobante, fecha y foto. IVA e IIBB se prorratean proporcional al
                    subtotal de items.
                  </p>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-gray-200 uppercase text-gray-500">
                        <th className="py-1 text-left">Subcategoría</th>
                        <th className="py-1 text-right">Items</th>
                        <th className="py-1 text-right">Neto</th>
                        <th className="py-1 text-right">IVA</th>
                        <th className="py-1 text-right">IIBB</th>
                        <th className="py-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {splitPorSubcat.map((s) => (
                        <tr key={s.categoria_id} className="border-b border-gray-100">
                          <td className="py-1">
                            <div className="font-medium text-gray-800">{s.subcat_nombre}</div>
                            {s.padre_nombre && (
                              <div className="text-[9px] text-gray-400">{s.padre_nombre}</div>
                            )}
                          </td>
                          <td className="py-1 text-right text-gray-600">{s.items.length}</td>
                          <td className="py-1 text-right tabular-nums">{formatARS(s.neto)}</td>
                          <td className="py-1 text-right tabular-nums text-gray-500">
                            {formatARS(s.iva)}
                          </td>
                          <td className="py-1 text-right tabular-nums text-gray-500">
                            {formatARS(s.iibb)}
                          </td>
                          <td className="py-1 text-right font-semibold tabular-nums">
                            {formatARS(s.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-300 font-semibold">
                        <td className="py-1 text-gray-600">TOTAL</td>
                        <td className="py-1 text-right text-gray-600">{form.items.length}</td>
                        <td className="py-1 text-right tabular-nums">
                          {formatARS(splitPorSubcat.reduce((s, x) => s + x.neto, 0))}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {formatARS(splitPorSubcat.reduce((s, x) => s + x.iva, 0))}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {formatARS(splitPorSubcat.reduce((s, x) => s + x.iibb, 0))}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {formatARS(splitPorSubcat.reduce((s, x) => s + x.total, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-200 bg-white px-5 py-3">
          <button
            onClick={onClose}
            disabled={guardando}
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded bg-rodziny-700 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-800 disabled:bg-gray-300"
          >
            {guardando ? 'Guardando…' : gastoEditando ? 'Guardar cambios' : 'Crear gasto'}
          </button>
        </div>
      </div>
    </div>
  );
}
