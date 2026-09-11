/**
 * El modelo de una receta: sus tipos y las listas que llenan los formularios.
 *
 * Esto vivía adentro de `RecetasTab.tsx`, la pantalla de recetas de Cocina. La
 * pantalla se dio de baja cuando las recetas pasaron al módulo Productos, pero
 * el modelo sigue vivo: lo usan Costeo, Menú, el editor de recetas y la
 * Calculadora. Por eso se separó en vez de borrarse con la pantalla.
 */

import { UNIDADES_RECETA, unidadParaReceta } from '@/lib/unidades';

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

// ─────────────────────────────────────────────────────────────────────────────
// EL VOCABULARIO DE CATEGORÍAS, UNA SOLA VEZ
// ─────────────────────────────────────────────────────────────────────────────
//
// Cerrado por Lucas el 11-sep-2026 contra los datos, no contra una idea. Antes
// estaba escrito CUATRO veces con cuatro resultados distintos: FichaProductoTab
// (13 valores), MenuTab (8), ProductoFormPanel y RecetaEditorInline. Se
// diferenciaban en cosas que se veían: uno decía "Pastas" y otro "Pasta", y
// `pizza` no existía en ninguna copia, así que la receta de pizza caía al fondo
// como tipo desconocido.
//
// Son TRES listas y están en tres niveles distintos. Mezclarlas es justo lo que
// generó las cuatro copias:
//
//   1. CATEGORÍA   — qué es un producto que se vende.        8 valores
//   2. SUBCATEGORÍA — solo dentro de bebida y de cafetería.
//   3. ROL          — qué es una subreceta adentro de la cocina.
//
// Los nombres van en SINGULAR: la etiqueta describe UNA cosa ("Pasta"), y el
// plural lo pone la pantalla cuando arma un grupo.

/** Las ocho categorías de un producto vendible. */
export const CATEGORIAS = [
  'pasta',
  'pizza',
  'salsa',
  'postre',
  'pasteleria',
  'panificado',
  'cafeteria',
  'bebida',
] as const;
export type RecetaCategoria = (typeof CATEGORIAS)[number];

/**
 * El cajón de lo que no cae en ninguna parte.
 *
 * 💣 NO es una categoría: es el cartel de "falta clasificar". Por eso no está
 * en `CATEGORIAS` y no se puede elegir en ningún formulario. Hasta la migración
 * 208 había UNA receta acá (la Focaccia) y 28 subrecetas; hoy quedan 7
 * subrecetas y ninguna receta.
 */
export const SIN_CLASIFICAR = 'otros';

/** Qué es una subreceta adentro de la cocina. */
export const ROLES = [
  'relleno',
  'masa',
  'masa_panaderia',
  'salsa_base',
  'postre_base',
  'panificado_base',
  'pasteleria_base',
  'bebida_base',
  'milanesa_base',
  'adicional',
  'packaging',
  'otros',
] as const;
export type SubrecetaRol = (typeof ROLES)[number];

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

export const CATEGORIA_LABEL: Record<RecetaCategoria, string> = {
  pasta: 'Pasta',
  pizza: 'Pizza',
  salsa: 'Salsa',
  postre: 'Postre',
  pasteleria: 'Pastelería',
  panificado: 'Panificado',
  cafeteria: 'Cafetería',
  bebida: 'Bebida',
};

export const ROL_LABEL: Record<SubrecetaRol, string> = {
  relleno: 'Relleno',
  masa: 'Masa de pasta',
  masa_panaderia: 'Masa de panadería',
  salsa_base: 'Salsa base',
  postre_base: 'Postre base',
  panificado_base: 'Panificado base',
  pasteleria_base: 'Pastelería base',
  bebida_base: 'Bebida base',
  milanesa_base: 'Milanesa base',
  adicional: 'Adicional de servicio',
  packaging: 'Packaging',
  otros: 'Sin clasificar',
};

// ── Subcategorías: solo bebida y cafetería tienen un nivel más ──────────────
// Si el arreglo está vacío, el editor no muestra el desplegable de subcategoría.

/** Las cuatro subcategorías de bebida. */
export const SUBCATEGORIAS_BEBIDA = ['aperitivo', 'gaseosa', 'agua', 'jugo'] as const;

/** Las seis de cafetería. */
export const SUBCATEGORIAS_CAFETERIA = [
  'cafe_caliente',
  'cafe_frio',
  'sin_cafe',
  'salado',
  'dulce',
  'combo',
] as const;

export const SUBCATEGORIAS_POR_CATEGORIA: Record<RecetaCategoria, readonly string[]> = {
  pasta: [],
  pizza: [],
  salsa: [],
  postre: [],
  pasteleria: [],
  panificado: [],
  cafeteria: SUBCATEGORIAS_CAFETERIA,
  bebida: SUBCATEGORIAS_BEBIDA,
};

export const SUBCATEGORIA_LABEL: Record<string, string> = {
  cafe_caliente: 'Café caliente',
  cafe_frio: 'Café frío',
  sin_cafe: 'Sin café',
  salado: 'Salado',
  dulce: 'Dulce',
  combo: 'Combo',
  aperitivo: 'Aperitivo',
  gaseosa: 'Gaseosa',
  agua: 'Agua',
  jugo: 'Jugo',
};

// ─────────────────────────────────────────────────────────────────────────────
// LOS `*_base` SON UN MECANISMO, NO SEIS VALORES SUELTOS
// ─────────────────────────────────────────────────────────────────────────────
//
// Un rol que termina en `_base` significa: "esta subreceta, cuando se vende
// sola, va en el grupo comercial X". Una salsa base es un componente de un
// plato, pero también se vende en frasco, y en el menú tiene que aparecer entre
// las salsas — no en un cajón aparte que diga "salsa_base".
//
// 💣 `milanesa_base` NO está en este mapa a propósito: no hay categoría
// "milanesa" y Lucas decidió el 11-sep-2026 que milanesa es un ROL, no una
// categoría. Es un componente, como el relleno o la masa: no se proyecta.

/** A qué grupo del menú se proyecta cada rol que se vende solo. */
export const GRUPO_COMERCIAL_DEL_ROL: Partial<Record<SubrecetaRol, RecetaCategoria>> = {
  salsa_base: 'salsa',
  postre_base: 'postre',
  bebida_base: 'bebida',
  pasteleria_base: 'pasteleria',
  panificado_base: 'panificado',
};

/**
 * EN QUÉ CAJÓN DEL MENÚ VA. Proyecta los `*_base` a su grupo comercial.
 *
 * 💣 Esto estaba escrito dos veces con dos resultados distintos: `tipoEfectivo`
 * (FichaProductoTab) devolvía el rol crudo para lo que no proyectaba, y
 * `rolToCategoria` (MenuTab) mandaba TODO lo desconocido a "otros" —así que un
 * relleno vendible aparecía en "Rellenos" en una pantalla y en "Otros" en la de
 * al lado. Gana el criterio de FichaProductoTab: el rol dice más que "otros".
 */
export function cajonComercial(r: {
  tipo: string;
  categoria?: string | null;
  rol?: string | null;
}): string {
  if (r.tipo === 'subreceta') {
    const grupo = GRUPO_COMERCIAL_DEL_ROL[r.rol as SubrecetaRol];
    return grupo ?? r.rol ?? SIN_CLASIFICAR;
  }
  return r.categoria ?? SIN_CLASIFICAR;
}

/**
 * QUÉ ES, sin proyectar: la categoría si es receta, el rol si es subreceta.
 *
 * ⚠️ Parece lo mismo que `cajonComercial` y NO lo es. Acá "Salsa base" tiene
 * que quedar separada de "Salsa": la usa el selector que vincula una receta a
 * un producto, donde elegir la base o el plato terminado son cosas distintas.
 * Antes era `catEfectivaReceta`, en ProductoFormPanel.
 */
export function queEsLaReceta(r: {
  tipo?: string | null;
  categoria?: string | null;
  rol?: string | null;
}): string {
  return (r.tipo === 'subreceta' ? r.rol : r.categoria) ?? SIN_CLASIFICAR;
}

/**
 * El nombre visible de un cajón, venga de una categoría o de un rol.
 *
 * Antes cada pantalla tenía su tabla: "Pastas" en una, "Pasta" en otra,
 * "Pastelería" y "Pastelería base" mezcladas. Si no lo conoce devuelve la
 * llave cruda, que es información — no un cartel vacío.
 */
export function etiquetaDeCajon(cajon: string): string {
  return (
    CATEGORIA_LABEL[cajon as RecetaCategoria] ??
    ROL_LABEL[cajon as SubrecetaRol] ??
    cajon
  );
}

/**
 * El orden en que se muestran los cajones. Primero los componentes de cocina,
 * después lo que se vende, y al final lo auxiliar. Lo que no esté acá va al
 * fondo, alfabético.
 */
export const ORDEN_CAJONES: readonly string[] = [
  'masa',
  'masa_panaderia',
  'relleno',
  'salsa',
  'pasta',
  'pizza',
  'milanesa_base',
  'postre',
  'pasteleria',
  'panificado',
  'cafeteria',
  'bebida',
  'adicional',
  'packaging',
  SIN_CLASIFICAR,
];

/** Ordena por `ORDEN_CAJONES` y manda lo desconocido al final, alfabético. */
export function compararCajones(a: string, b: string): number {
  const ia = ORDEN_CAJONES.indexOf(a);
  const ib = ORDEN_CAJONES.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

/**
 * Unidades que ofrece el renglón de receta. Vienen del vocabulario único.
 *
 * Antes esta lista era propia y tenía 'lt' y 'unid' (las formas que el almacén NO
 * usa) más 'cdta' y 'cda', que estaban ofrecidas pero no las eligió nadie nunca y
 * además el costeo no sabía convertirlas: elegirlas daba "unidad desconocida".
 */
export const UNIDADES = UNIDADES_RECETA;

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
/**
 * Unidad con la que se guarda un renglón de receta cuando se trae un insumo del
 * almacén. Delega en el vocabulario único (@/lib/unidades).
 *
 * ⚠️ ANTES ESTA FUNCIÓN TENÍA DOS DEFECTOS, y los dos dejaban rastro en la base:
 *   1. Devolvía 'lt' y 'unid' donde el almacén guarda 'L' y 'unid.'. Como el
 *      único que la llama es el selector de ingredientes, venía fabricando la
 *      divergencia de a un renglón por vez (53 en 'lt', 196 en 'unid').
 *   2. Para cualquier unidad que no reconociera devolvía 'g'. Un insumo comprado
 *      en "botella" se convertía en gramos, sin un solo error en pantalla.
 * Ahora, si no la reconoce, deja la unidad del insumo tal cual: es la verdad, y
 * el costeo la marca como desconocida en vez de inventar un peso.
 */
export function mapearUnidad(unidadCompras: string): string {
  return unidadParaReceta(unidadCompras) ?? (unidadCompras ?? '').trim();
}

export function formatCantidad(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}
