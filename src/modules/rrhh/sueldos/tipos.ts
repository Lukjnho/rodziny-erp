// Tipos compartidos del subsistema Sueldos
import type { Quincena } from '../utils';

export type MedioPagoSueldo = 'efectivo' | 'transferencia';

export interface Liquidacion {
  id: string;
  empleado_id: string;
  periodo: string; // 'YYYY-MM-Q1' | 'YYYY-MM-Q2'
  cobra_presentismo: boolean;
  pagado: boolean;
  medio_pago: MedioPagoSueldo | null;
  fecha_pago: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
}

export interface Adelanto {
  id: string;
  empleado_id: string;
  periodo: string;
  fecha: string;
  monto: number;
  motivo: string | null;
  created_at: string;
}

export interface Sancion {
  id: string;
  empleado_id: string;
  periodo: string;
  fecha: string;
  monto: number;
  motivo: string;
  created_at: string;
}

// Descuentos eventuales: días sin goce, licencias no remuneradas, ausencias
// justificadas que descuentan, etc. Estructura igual a Sancion pero separado
// conceptualmente — no es una penalización, es una deducción por día no trabajado.
export interface Descuento {
  id: string;
  empleado_id: string;
  periodo: string;
  fecha: string;
  monto: number;
  motivo: string;
  created_at: string;
}

export interface ImpuestoMensual {
  id: string;
  periodo: string; // 'YYYY-MM'
  f931_path: string | null;
  libro_path: string | null;
  monto_total: number;
  pagado: boolean;
  fecha_pago: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
}

export function periodoQuincena(year: number, month: number, q: Quincena): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${q.toUpperCase()}`;
}

export function periodoMes(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}
