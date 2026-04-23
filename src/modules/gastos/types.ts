// Tipos compartidos del módulo Gastos

export type CondicionIVA = 'responsable_inscripto' | 'monotributo' | 'exento' | 'consumidor_final';

export type TipoEdr =
  | 'cmv_alimentos'
  | 'cmv_bebidas'
  | 'cmv_indirectos'
  | 'gastos_op'
  | 'gastos_rrhh'
  | 'sueldos'
  | 'cargas_sociales'
  | 'impuestos_op'
  | 'intereses'
  | 'inversiones'
  | 'otros';

export type MedioPago =
  | 'efectivo'
  | 'transferencia_mp'
  | 'cheque_galicia'
  | 'tarjeta_icbc'
  | 'otro';

export const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia_mp: 'Transferencia (MercadoPago)',
  cheque_galicia: 'Cheque (Galicia)',
  tarjeta_icbc: 'Tarjeta Visa (ICBC)',
  otro: 'Otro',
};

export type TipoComprobante =
  | 'factura_a'
  | 'factura_c'
  | 'remito'
  | 'ticket'
  | 'recibo'
  | 'nota_credito'
  | 'otro';

export const TIPO_COMPROBANTE_LABEL: Record<TipoComprobante, string> = {
  factura_a: 'Factura A',
  factura_c: 'Factura C',
  remito: 'Remito',
  ticket: 'Ticket',
  recibo: 'Recibo',
  nota_credito: 'Nota de Crédito',
  otro: 'Otro',
};

export type EstadoPago = 'pendiente' | 'pagado' | 'parcial';

export interface Proveedor {
  id: string;
  razon_social: string;
  cuit: string | null;
  condicion_iva: CondicionIVA | null;
  categoria_default_id: string | null;
  medio_pago_default: MedioPago | null;
  dias_pago: number;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoriaGasto {
  id: string;
  nombre: string;
  parent_id: string | null;
  tipo_edr: TipoEdr;
  activo: boolean;
  orden: number;
  created_at: string;
}

export interface Gasto {
  id: string;
  local: 'vedia' | 'saavedra';
  fecha: string; // fecha del comprobante (devengado)
  fecha_vencimiento: string | null;
  proveedor: string | null; // legacy string libre
  proveedor_id: string | null; // FK nueva
  categoria: string | null; // legacy string libre
  subcategoria: string | null; // legacy
  categoria_id: string | null; // FK nueva
  comentario: string | null;
  importe_neto: number | null;
  iva: number | null;
  iibb: number | null;
  importe_total: number;
  medio_pago: string | null;
  tipo_comprobante: string | null;
  punto_venta: string | null;
  nro_comprobante: string | null;
  estado_pago: string | null;
  comprobante_path: string | null; // comprobante de pago (transferencia/voucher)
  factura_path: string | null; // factura fiscal del proveedor (A/C/remito/ticket)
  recepcion_id: string | null;
  creado_por: string | null;
  creado_manual: boolean;
  cancelado: boolean;
  periodo: string; // YYYY-MM
  fudo_id: string | null;
  items_json: ItemGastoStock[] | null; // ítems vinculados al stock — persistidos para poder editarlos
}

export interface PagoGasto {
  id: string;
  gasto_id: string;
  fecha_pago: string;
  monto: number;
  medio_pago: MedioPago;
  referencia: string | null;
  comprobante_pago_path: string | null;
  conciliado_movimiento_id: string | null;
  notas: string | null;
  creado_por: string | null;
  created_at: string;
}

// Item de un gasto vinculado a un producto del inventario
export interface ItemGastoStock {
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  subtotal: number;
  // Subcategoría del EdR (hoja). Se elige en el modal al cargar.
  // Permite dividir una misma factura en varios gastos según a qué línea del EdR va cada item.
  categoria_gasto_id: string | null;
}
