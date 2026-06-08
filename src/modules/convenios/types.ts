export type LocalConv = 'vedia' | 'saavedra';
export type EstadoConvenio = 'activo' | 'proximo' | 'vencido' | 'negociacion';

export interface Convenio {
  id: string;
  local: LocalConv;
  // ID del Customer en Fudo. Llave para cruzar las ventas con el convenio.
  fudo_customer_id: string | null;
  nombre: string;
  descuento_pct: number | null;
  tipo: string | null;
  contacto: string | null;
  beneficios_extra: string | null;
  vigencia_desde: string | null;
  vigencia_hasta: string | null;
  estado: EstadoConvenio;
  notas: string | null;
  activo: boolean;
  created_at: string;
}

export type ConvenioInput = Omit<Convenio, 'id' | 'created_at'>;

// Lo que devuelve la edge function fudo-convenios por cada cliente con consumo.
export interface MedicionConvenio {
  customerId: string;
  nombre: string;
  consumos: number;
  facturacion: number; // lo que pagaron (neto de descuento)
  descuento: number; // lo bonificado = "lo que damos"
  ultimaFecha: string | null;
}

export interface MedicionResp {
  local: LocalConv;
  desde: string;
  hasta: string;
  ventasEscaneadas: number;
  conCliente: number;
  convenios: MedicionConvenio[];
}

export const ESTADO_LABEL: Record<EstadoConvenio, string> = {
  activo: 'Activo',
  proximo: 'Próximo',
  vencido: 'Vencido',
  negociacion: 'En negociación',
};

export const LOCAL_LABEL: Record<LocalConv, string> = {
  vedia: 'Vedia',
  saavedra: 'Saavedra',
};
