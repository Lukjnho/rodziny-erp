// Costeo — nivel 2 (núcleo). La puerta única del módulo.
//
// ══════════════════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE ESTE MÓDULO
// ══════════════════════════════════════════════════════════════════════════════
//
// El motor de costeo vivía en `cocina` (nivel 3, operación) y lo necesitaba
// `productos` (nivel 2, núcleo). Eso son 15 flechas que van para arriba, que es
// justo lo que la arquitectura dice que no puede pasar: un módulo de núcleo
// colgado de uno de operación. Si mañana se toca la pantalla del pizarrón, el
// costeo de la carta se entera.
//
// La salida no fue romper las flechas una por una: el concepto compartido bajó
// de nivel. Ahora `productos` y `cocina` importan los dos de acá, y ninguno de
// los dos depende del otro.
//
// Qué quedó adentro: el modelo de la receta (qué es una categoría, un rol, una
// unidad), el motor que la costea, los dos hooks que traen sus datos, la regla
// del margen, y los tres componentes de pantalla que las dos pantallas comparten.
//
// Qué NO se mudó y sigue en cocina: todo lo de PRODUCIR — pizarrón, lotes,
// masas, traspasos, stock de cámara, el QR. Eso es operación y usa el costeo,
// no al revés.
//
// ══════════════════════════════════════════════════════════════════════════════
// REGLA DE IMPORTACIÓN
// ══════════════════════════════════════════════════════════════════════════════
//
// Desde afuera: `import { ... } from '@/modules/costeo'`. Siempre acá, nunca a
// un archivo de adentro — si alguien importa `@/modules/costeo/costeoEngine`,
// este archivo deja de ser la puerta y no sirve para nada.
//
// Desde adentro: solo se puede importar de `@/lib` y `@/components` (nivel 1).
// Nada de `@/modules/*`. Lo verifica `npm run arq`.

// ── El modelo de la receta: el vocabulario, una sola vez ────────────────────
//
// Las tres listas (categoría de producto vendible, subcategoría, rol de
// subreceta) y las dos preguntas que se le hacen a una receta viven acá y en
// ningún otro lado. Antes estaban copiadas en cuatro pantallas con cuatro
// resultados distintos.
export {
  CATEGORIAS,
  CATEGORIA_LABEL,
  ROLES,
  ROL_LABEL,
  SIN_CLASIFICAR,
  SUBCATEGORIAS_BEBIDA,
  SUBCATEGORIAS_CAFETERIA,
  SUBCATEGORIAS_POR_CATEGORIA,
  SUBCATEGORIA_LABEL,
  TIPO_LABEL,
  UNIDAD_LABEL,
  UNIDADES,
  GRUPO_COMERCIAL_DEL_ROL,
  ORDEN_CAJONES,
  cajonComercial,
  compararCajones,
  etiquetaDeCajon,
  mapearUnidad,
  queEsLaReceta,
} from './modelo';
export type {
  Ingrediente,
  ProductoCompras,
  Receta,
  RecetaCategoria,
  RecetaTipo,
  RendUnidad,
  SubrecetaRol,
} from './modelo';

// ── El motor ────────────────────────────────────────────────────────────────
//
// Solo lo que se usa desde afuera. `buildCosteoContext`, `costearReceta`, los
// tipos `CostoReceta` y `DetalleIngrediente`, y `formatCantidad` se sacaron de
// acá el 11-sep-2026: estaban publicados y ningún archivo de fuera del módulo
// los importaba. Siguen existiendo y se usan puertas adentro; lo que dejaron de
// ser es API pública. Una puerta que publica de más deja de decir nada.
export { costearBorrador } from './costeoEngine';
export type { CosteoContext, IngredienteRow, ProductoRow, RecetaRow } from './costeoEngine';

// ── Los datos ───────────────────────────────────────────────────────────────
export { useCostosRecetas } from './useCostosRecetas';
export { useConfigCosteo } from './useConfigCosteo';
export type { ConfigCosteo } from './useConfigCosteo';

// ── La regla del margen ─────────────────────────────────────────────────────
export {
  COLCHON_POR_DEFECTO,
  IVA_POR_DEFECTO,
  condicionesDeCobro,
  desgloseDeCobro,
  loQueRecibimos,
  margenSobreRecibido,
  precioParaMargen,
  semaforoDeMargen,
} from './margen';
export type { CondicionesDeCobro, SemaforoMargen } from './margen';

// ── Pantalla compartida ─────────────────────────────────────────────────────
export { AutocompleteIngrediente, DialogDuplicar, FichaTecnica } from './componentes';
