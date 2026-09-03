/**
 * El modelo de una receta: sus tipos y las listas que llenan los formularios.
 *
 * Esto vivía adentro de `RecetasTab.tsx`, la pantalla de recetas de Cocina. La
 * pantalla se dio de baja cuando las recetas pasaron al módulo Productos, pero
 * el modelo sigue vivo: lo usan Costeo, Menú, el editor de recetas y la
 * Calculadora. Por eso se separó en vez de borrarse con la pantalla.
 */

export interface Ingrediente {
  id: string;
  receta_id: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  observaciones: string | null;
  orden: number;
  producto_id: string | null;
}

export type RendUnidad = 'kg' | 'l' | 'unidad';

export type RecetaTipo = 'receta' | 'subreceta';
export type RecetaCategoria =
  | 'pasta'
  | 'pizza'
  | 'salsa'
  | 'postre'
  | 'pasteleria'
  | 'panificado'
  | 'cafeteria'
  | 'bebida'
  | 'otros';
export type SubrecetaRol =
  | 'relleno'
  | 'masa'
  | 'masa_panaderia'
  | 'salsa_base'
  | 'postre_base'
  | 'panificado'
  | 'pasteleria_base'
  | 'bebida_base'
  | 'adicional'
  | 'packaging'
  | 'otros';

export interface Receta {
  id: string;
  nombre: string;
  tipo: RecetaTipo;
  categoria: RecetaCategoria | null;
  subcategoria: string | null;
  rol: SubrecetaRol | null;
  rendimiento_kg: number | null;
  rendimiento_unidad: RendUnidad;
  rendimiento_porciones: number | null;
  instrucciones: string | null;
  activo: boolean;
  margen_seguridad_pct: number | null;
  local: string | null;
  gramos_por_porcion: number | null;
  fudo_productos: string[] | null;
  created_at: string;
}

export const UNIDAD_LABEL: Record<RendUnidad, string> = {
  kg: 'kg',
  l: 'L',
  unidad: 'unid.',
};
/** Etiqueta visible de cada tipo. */
export const TIPO_LABEL: Record<RecetaTipo, string> = {
  receta: 'Receta',
  subreceta: 'Subreceta',
};

export const CATEGORIAS: RecetaCategoria[] = [
  'pasta',
  'pizza',
  'salsa',
  'postre',
  'pasteleria',
  'panificado',
  'cafeteria',
  'bebida',
  'otros',
];
export const CATEGORIA_LABEL: Record<RecetaCategoria, string> = {
  pasta: 'Pasta',
  pizza: 'Pizza',
  salsa: 'Salsa',
  postre: 'Postre',
  pasteleria: 'Pastelería',
  panificado: 'Panificado',
  cafeteria: 'Cafetería',
  bebida: 'Bebida',
  otros: 'Otros',
};
// Mapping categoría → subcategorías permitidas. Solo cafeteria y bebida tienen
// jerarquía hoy. Si el array está vacío, el editor no muestra select de sub.
export const SUBCATEGORIAS_POR_CATEGORIA: Record<RecetaCategoria, string[]> = {
  pasta: [],
  pizza: [],
  salsa: [],
  postre: [],
  pasteleria: [],
  panificado: [],
  cafeteria: ['cafe_caliente', 'cafe_frio', 'sin_cafe', 'salado', 'dulce', 'combo'],
  bebida: ['gaseosa', 'agua', 'jugo', 'vino', 'aperitivo'],
  otros: [],
};

export const SUBCATEGORIA_LABEL: Record<string, string> = {
  cafe_caliente: 'Café caliente',
  cafe_frio: 'Café frío',
  sin_cafe: 'Sin café',
  salado: 'Salado',
  dulce: 'Dulce',
  combo: 'Combo',
  gaseosa: 'Gaseosa',
  agua: 'Agua',
  jugo: 'Jugo',
  vino: 'Vino',
  aperitivo: 'Aperitivo',
};

export const ROLES: SubrecetaRol[] = [
  'relleno',
  'masa',
  'masa_panaderia',
  'salsa_base',
  'postre_base',
  'panificado',
  'pasteleria_base',
  'bebida_base',
  'adicional',
  'packaging',
  'otros',
];
export const ROL_LABEL: Record<SubrecetaRol, string> = {
  relleno: 'Relleno',
  masa: 'Masa (pasta)',
  masa_panaderia: 'Masa de panadería',
  salsa_base: 'Salsa (base)',
  postre_base: 'Postre (base)',
  panificado: 'Panificado',
  pasteleria_base: 'Pastelería',
  bebida_base: 'Bebida (base)',
  adicional: 'Adicional servicio',
  packaging: 'Packaging',
  otros: 'Otros',
};

export const UNIDADES = ['g', 'kg', 'ml', 'lt', 'oz', 'unid', 'cdta', 'cda'] as const;

/** Un producto del módulo Compras, tal como lo ofrece el buscador de ingredientes. */
export interface ProductoCompras {
  id: string;
  nombre: string;
  marca: string | null;
  unidad: string;
  categoria: string | null;
  local: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
export function mapearUnidad(unidadCompras: string): string {
  const u = unidadCompras.toLowerCase().trim();
  if (u === 'kg' || u === 'kgs') return 'kg';
  if (u === 'g' || u === 'gr' || u === 'grs' || u === 'gramos') return 'g';
  if (u === 'lt' || u === 'l' || u === 'lts' || u === 'litros' || u === 'litro') return 'lt';
  if (u === 'ml' || u === 'mililitros') return 'ml';
  if (u === 'unid.' || u === 'unid' || u === 'u' || u === 'unidades' || u === 'unidad')
    return 'unid';
  return 'g'; // default
}

export function formatCantidad(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}
