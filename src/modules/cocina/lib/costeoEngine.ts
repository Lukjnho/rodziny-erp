// Motor de costeo de recetas — núcleo puro reutilizable.
//
// Extraído de useCostosRecetas para poder costear también un BORRADOR en memoria
// (edición inline en la ficha de Productos) con EXACTAMENTE la misma lógica que el
// costeo guardado: resolución de subrecetas, match por nombre, merma, conversión de
// unidades y detección de referencia circular. Si esto se duplicara, el costo que ve
// el usuario mientras edita divergiría del costo guardado.

export interface RecetaRow {
  id: string;
  nombre: string;
  tipo: string;
  rendimiento_kg: number | null;
  rendimiento_porciones: number | null;
  local: string | null;
}

export interface IngredienteRow {
  id: string;
  receta_id: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  orden: number;
  producto_id: string | null;
}

export interface ProductoRow {
  id: string;
  nombre: string;
  unidad: string;
  costo_unitario: number;
  merma_pct: number;
  // Líquido por unidad (ej: botella 750 ml). Permite usar el insumo en ml/oz
  // aunque la unidad de compra sea 'unid'. NULL si no aplica.
  contenido_ml: number | null;
}

export interface DetalleIngrediente {
  id: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  productoId: string | null;
  productoNombre: string | null;
  esSubreceta: boolean;
  subrecetaId: string | null;
  costoUnitario: number | null;
  costoTotal: number | null;
  error: string | null;
}

export interface CostoReceta {
  recetaId: string;
  costoBase: number;
  margenPct: number;
  costoConMargen: number;
  costoPorKg: number | null;
  costoPorPorcion: number | null;
  detalles: DetalleIngrediente[];
  advertencias: string[];
}

export function normalizarUnidad(u: string): string {
  const x = (u ?? '').toLowerCase().trim();
  if (x === 'kg' || x === 'kgs') return 'kg';
  if (x === 'g' || x === 'gr' || x === 'grs' || x === 'gramos' || x === 'gramo') return 'g';
  if (x === 'lt' || x === 'l' || x === 'lts' || x === 'litros' || x === 'litro') return 'lt';
  if (x === 'ml' || x === 'mililitros') return 'ml';
  if (x === 'oz' || x === 'onza' || x === 'onzas') return 'oz';
  if (
    x === 'unid.' ||
    x === 'unid' ||
    x === 'u' ||
    x === 'unidades' ||
    x === 'unidad' ||
    // Envases discretos: el ERP los ofrece en Compras como "unidad" funcional.
    // Para costear bebidas en ml/oz se usa contenido_ml.
    x === 'botella' ||
    x === 'botellas' ||
    x === 'lata' ||
    x === 'latas' ||
    x === 'paquete' ||
    x === 'paquetes' ||
    x === 'caja' ||
    x === 'cajas' ||
    x === 'bolsa' ||
    x === 'bolsas'
  )
    return 'unid';
  if (x === 'cda' || x === 'cdta') return x;
  return x;
}

// 1 oz redondeada a 30 ml para simplificar costeo de barra (estándar interno
// Rodziny). Si más adelante queremos el valor exacto (29.5735) cambiarlo acá.
const ML_POR_OZ = 30;

// factor de unidad → unidad base del grupo
// peso: base g; volumen: base ml; unidad: base unid
function aBase(
  cantidad: number,
  unidad: string,
): { cantidad: number; grupo: 'peso' | 'vol' | 'unid' | null } {
  const u = normalizarUnidad(unidad);
  if (u === 'kg') return { cantidad: cantidad * 1000, grupo: 'peso' };
  if (u === 'g') return { cantidad, grupo: 'peso' };
  if (u === 'lt') return { cantidad: cantidad * 1000, grupo: 'vol' };
  if (u === 'ml') return { cantidad, grupo: 'vol' };
  if (u === 'oz') return { cantidad: cantidad * ML_POR_OZ, grupo: 'vol' };
  if (u === 'unid') return { cantidad, grupo: 'unid' };
  return { cantidad, grupo: null };
}

function normalizarNombre(n: string): string {
  return (n ?? '')
    .toLowerCase()
    .trim()
    .replace(/^subreceta\s+/i, '')
    .replace(/\s+/g, ' ');
}

// Simplifica un nombre quitando sufijos de tamaño/envase comunes al final.
// Usado como FALLBACK cuando el match exacto por nombre normalizado falla.
// Ejemplos:
//   "Aji molido 1 kg"      → "aji molido"
//   "Queso parmesano 500g" → "queso parmesano"
//   "Vino Blanco x ud.(COCINA)" → "vino blanco"
//   "Aceite 1L"            → "aceite"
function simplificarNombre(n: string): string {
  let s = normalizarNombre(n);
  let prev = '';
  // Iterar para cubrir varios sufijos apilados en un mismo nombre
  while (prev !== s && s.length > 0) {
    prev = s;
    s = s
      // paréntesis con contenido al final: "(COCINA)", "(500g)"
      .replace(/\s*\([^)]*\)\s*$/, '')
      // "x ud", "x 500g", "x unidad" al final
      .replace(/\s+x\s+\S+\.?$/i, '')
      // cantidad + unidad al final: "1 kg", "500g", "2.5 lt"
      .replace(/\s+\d+([.,]\d+)?\s*(kg|kgs|gr?|gramos?|ml|lts?|l|litros?|cc|unid|u|uds?)\.?$/i, '')
      .trim();
  }
  return s;
}

function calcularCostoProducto(
  prod: ProductoRow,
  cantidad: number,
  unidadIng: string,
): { costo: number | null; error: string | null } {
  if (!prod.costo_unitario || prod.costo_unitario <= 0) {
    return { costo: null, error: 'Sin costo cargado' };
  }
  const base = aBase(cantidad, unidadIng);
  const baseProd = aBase(1, prod.unidad);
  if (base.grupo === null || baseProd.grupo === null) {
    return { costo: null, error: `Unidad "${unidadIng}" desconocida` };
  }
  const merma = prod.merma_pct ?? 0;
  const factorMerma = merma > 0 && merma < 1 ? 1 / (1 - merma) : 1;
  // Puente unidad↔volumen: si el insumo se compra como "unid" pero la receta
  // lo pide en ml/oz/lt, usamos contenido_ml (ej: botella 750 ml). 1 unidad =
  // contenido_ml ml. Requiere el campo cargado en el insumo.
  if (base.grupo === 'vol' && baseProd.grupo === 'unid') {
    if (!prod.contenido_ml || prod.contenido_ml <= 0) {
      return {
        costo: null,
        error: `"${prod.nombre}" está en unidad, falta cargar "Contenido (ml)" en el insumo para usarlo en ml/oz`,
      };
    }
    // costo por ml = costo de 1 unidad / ml por unidad
    const costoPorMl = (prod.costo_unitario * factorMerma) / prod.contenido_ml;
    return { costo: base.cantidad * costoPorMl, error: null };
  }
  if (base.grupo !== baseProd.grupo) {
    return { costo: null, error: `No se puede convertir ${unidadIng} → ${prod.unidad}` };
  }
  // costo_unitario es por 1 unidad base del producto convertida a su forma original
  // ej: si producto está en kg con costo 800, 1kg = 1000g → costo por g = 800/1000
  // Aplicamos merma del insumo: si pelar la cebolla pierde 15%, para "tener" 1kg
  // útil hay que comprar 1/(1-0.15)≈1.176kg. Equivalente: el costo efectivo del
  // kg útil es costo × 1/(1-merma). Usamos esta forma.
  const costoPorBase = (prod.costo_unitario * factorMerma) / baseProd.cantidad;
  const costo = base.cantidad * costoPorBase;
  return { costo, error: null };
}

export interface CosteoContext {
  recetas: RecetaRow[];
  margenGlobal: number;
  prodById: Map<string, ProductoRow>;
  prodByNombre: Map<string, ProductoRow>;
  prodByNombreSimpl: Map<string, ProductoRow>;
  recetaByNombreLocal: Map<string, RecetaRow>;
  recetaByNombre: Map<string, RecetaRow>;
  recetaByNombreSimplLocal: Map<string, RecetaRow>;
  recetaByNombreSimpl: Map<string, RecetaRow>;
  ingsPorReceta: Map<string, IngredienteRow[]>;
}

// Construye los índices de búsqueda una sola vez. El resultado es inmutable y
// se puede reusar para costear muchas recetas (o un borrador) sin recalcular.
export function buildCosteoContext(
  recetas: RecetaRow[],
  ings: IngredienteRow[],
  prods: ProductoRow[],
  margenGlobal: number,
): CosteoContext {
  const prodById = new Map<string, ProductoRow>();
  for (const p of prods) prodById.set(p.id, p);

  const prodByNombre = new Map<string, ProductoRow>();
  const prodByNombreSimpl = new Map<string, ProductoRow>();
  for (const p of prods) {
    const k = normalizarNombre(p.nombre);
    if (!prodByNombre.has(k)) prodByNombre.set(k, p);
    const ks = simplificarNombre(p.nombre);
    if (ks && !prodByNombreSimpl.has(ks)) prodByNombreSimpl.set(ks, p);
  }

  const recetaByNombreLocal = new Map<string, RecetaRow>();
  const recetaByNombre = new Map<string, RecetaRow>();
  const recetaByNombreSimplLocal = new Map<string, RecetaRow>();
  const recetaByNombreSimpl = new Map<string, RecetaRow>();
  for (const r of recetas) {
    const k = normalizarNombre(r.nombre);
    const kl = `${k}|${r.local ?? ''}`;
    if (!recetaByNombreLocal.has(kl)) recetaByNombreLocal.set(kl, r);
    if (!recetaByNombre.has(k)) recetaByNombre.set(k, r);
    const ks = simplificarNombre(r.nombre);
    if (ks) {
      const ksl = `${ks}|${r.local ?? ''}`;
      if (!recetaByNombreSimplLocal.has(ksl)) recetaByNombreSimplLocal.set(ksl, r);
      if (!recetaByNombreSimpl.has(ks)) recetaByNombreSimpl.set(ks, r);
    }
  }

  const ingsPorReceta = new Map<string, IngredienteRow[]>();
  for (const ing of ings) {
    if (!ingsPorReceta.has(ing.receta_id)) ingsPorReceta.set(ing.receta_id, []);
    ingsPorReceta.get(ing.receta_id)!.push(ing);
  }

  return {
    recetas,
    margenGlobal,
    prodById,
    prodByNombre,
    prodByNombreSimpl,
    recetaByNombreLocal,
    recetaByNombre,
    recetaByNombreSimplLocal,
    recetaByNombreSimpl,
    ingsPorReceta,
  };
}

// Costea una receta (recursivo para subrecetas). `cache` y `enProgreso` los provee
// el llamador para reusar resultados y cortar referencias circulares.
//
// `override`: si se pasa y su recetaId coincide con la receta que se está costeando,
// se usan ESOS ingredientes en lugar de los guardados. Permite previsualizar un
// borrador sin guardar. Las subrecetas siguen saliendo del contexto (datos guardados).
export function costearReceta(
  recetaId: string,
  ctx: CosteoContext,
  cache: Map<string, CostoReceta>,
  enProgreso: Set<string>,
  override?: { recetaId: string; ingredientes: IngredienteRow[] },
): CostoReceta {
  const cached = cache.get(recetaId);
  if (cached) return cached;

  const receta = ctx.recetas.find((r) => r.id === recetaId);
  if (!receta) {
    return {
      recetaId,
      costoBase: 0,
      margenPct: 0,
      costoConMargen: 0,
      costoPorKg: null,
      costoPorPorcion: null,
      detalles: [],
      advertencias: ['Receta no encontrada'],
    };
  }

  if (enProgreso.has(recetaId)) {
    // Recursión circular — cortar
    return {
      recetaId,
      costoBase: 0,
      margenPct: 0,
      costoConMargen: 0,
      costoPorKg: null,
      costoPorPorcion: null,
      detalles: [],
      advertencias: [`Referencia circular detectada en "${receta.nombre}"`],
    };
  }
  enProgreso.add(recetaId);

  const misIngs =
    override && override.recetaId === recetaId
      ? override.ingredientes
      : (ctx.ingsPorReceta.get(recetaId) ?? []);
  const detalles: DetalleIngrediente[] = [];
  const advertencias: string[] = [];
  let costoBase = 0;

  for (const ing of misIngs) {
    const esSubrecetaPrefijo = /^subreceta\s+/i.test(ing.nombre ?? '');
    const nombreNorm = normalizarNombre(ing.nombre);
    const nombreSimpl = simplificarNombre(ing.nombre);

    // 1) intentar resolver como subreceta: primero por (nombre, local) para respetar el local de la receta padre
    //    Fallbacks: nombre normalizado → nombre simplificado con local → nombre simplificado sin local
    let subrecetaMatch: RecetaRow | null = null;
    if (esSubrecetaPrefijo || ing.producto_id == null) {
      const localPadre = receta.local ?? '';
      subrecetaMatch =
        ctx.recetaByNombreLocal.get(`${nombreNorm}|${localPadre}`) ??
        ctx.recetaByNombre.get(nombreNorm) ??
        (nombreSimpl ? ctx.recetaByNombreSimplLocal.get(`${nombreSimpl}|${localPadre}`) : null) ??
        (nombreSimpl ? ctx.recetaByNombreSimpl.get(nombreSimpl) : null) ??
        null;
    }

    if (subrecetaMatch) {
      const sub = costearReceta(subrecetaMatch.id, ctx, cache, enProgreso, override);
      // usar costo por kg o por porcion según unidad del ingrediente
      const u = normalizarUnidad(ing.unidad);
      let costoUnit: number | null = null;
      let error: string | null = null;
      if (u === 'kg' || u === 'g') {
        if (sub.costoPorKg != null) {
          const cantKg = u === 'kg' ? ing.cantidad : ing.cantidad / 1000;
          costoUnit = sub.costoPorKg;
          const costoTotal = cantKg * sub.costoPorKg;
          costoBase += costoTotal;
          detalles.push({
            id: ing.id,
            nombre: ing.nombre,
            cantidad: ing.cantidad,
            unidad: ing.unidad,
            productoId: null,
            productoNombre: subrecetaMatch.nombre,
            esSubreceta: true,
            subrecetaId: subrecetaMatch.id,
            costoUnitario: costoUnit,
            costoTotal,
            error: null,
          });
          continue;
        }
        error = `Subreceta "${subrecetaMatch.nombre}" no tiene rendimiento en kg`;
      } else if (u === 'unid') {
        if (sub.costoPorPorcion != null) {
          costoUnit = sub.costoPorPorcion;
          const costoTotal = ing.cantidad * sub.costoPorPorcion;
          costoBase += costoTotal;
          detalles.push({
            id: ing.id,
            nombre: ing.nombre,
            cantidad: ing.cantidad,
            unidad: ing.unidad,
            productoId: null,
            productoNombre: subrecetaMatch.nombre,
            esSubreceta: true,
            subrecetaId: subrecetaMatch.id,
            costoUnitario: costoUnit,
            costoTotal,
            error: null,
          });
          continue;
        }
        error = `Subreceta "${subrecetaMatch.nombre}" no tiene rendimiento en porciones`;
      } else {
        error = `Unidad "${ing.unidad}" no soportada para subreceta`;
      }

      advertencias.push(error);
      detalles.push({
        id: ing.id,
        nombre: ing.nombre,
        cantidad: ing.cantidad,
        unidad: ing.unidad,
        productoId: null,
        productoNombre: subrecetaMatch.nombre,
        esSubreceta: true,
        subrecetaId: subrecetaMatch.id,
        costoUnitario: null,
        costoTotal: null,
        error,
      });
      continue;
    }

    // Si el nombre trae prefijo "Subreceta" pero no matcheó con ninguna receta, NO caer a producto:
    // el usuario explícitamente marcó que es una subreceta. Caer a producto daría matches falsos
    // (ej. "Subreceta Pomodoro" matcheando con un producto lata "Pomodoro" y disparando "No se puede convertir").
    if (esSubrecetaPrefijo) {
      const msg = `Subreceta "${ing.nombre.replace(/^subreceta\s+/i, '')}" no encontrada en el catálogo de recetas`;
      advertencias.push(msg);
      detalles.push({
        id: ing.id,
        nombre: ing.nombre,
        cantidad: ing.cantidad,
        unidad: ing.unidad,
        productoId: null,
        productoNombre: null,
        esSubreceta: true,
        subrecetaId: null,
        costoUnitario: null,
        costoTotal: null,
        error: msg,
      });
      continue;
    }

    // 2) resolver como producto
    let prod: ProductoRow | null = null;
    if (ing.producto_id) {
      prod = ctx.prodById.get(ing.producto_id) ?? null;
    }
    if (!prod) {
      // fallback por nombre normalizado → por nombre simplificado (sin sufijos de tamaño)
      prod =
        ctx.prodByNombre.get(nombreNorm) ??
        (nombreSimpl ? ctx.prodByNombreSimpl.get(nombreSimpl) : null) ??
        null;
    }

    if (!prod) {
      const msg = `Sin match: "${ing.nombre}"`;
      advertencias.push(msg);
      detalles.push({
        id: ing.id,
        nombre: ing.nombre,
        cantidad: ing.cantidad,
        unidad: ing.unidad,
        productoId: null,
        productoNombre: null,
        esSubreceta: false,
        subrecetaId: null,
        costoUnitario: null,
        costoTotal: null,
        error: msg,
      });
      continue;
    }

    const { costo, error } = calcularCostoProducto(prod, ing.cantidad, ing.unidad);
    if (costo == null) {
      if (error) advertencias.push(`${ing.nombre}: ${error}`);
      detalles.push({
        id: ing.id,
        nombre: ing.nombre,
        cantidad: ing.cantidad,
        unidad: ing.unidad,
        productoId: prod.id,
        productoNombre: prod.nombre,
        esSubreceta: false,
        subrecetaId: null,
        costoUnitario: prod.costo_unitario || null,
        costoTotal: null,
        error,
      });
      continue;
    }

    costoBase += costo;
    detalles.push({
      id: ing.id,
      nombre: ing.nombre,
      cantidad: ing.cantidad,
      unidad: ing.unidad,
      productoId: prod.id,
      productoNombre: prod.nombre,
      esSubreceta: false,
      subrecetaId: null,
      costoUnitario: prod.costo_unitario,
      costoTotal: costo,
      error: null,
    });
  }

  const margenPct = ctx.margenGlobal;
  const costoConMargen = costoBase * (1 + margenPct);
  const costoPorKg =
    receta.rendimiento_kg && receta.rendimiento_kg > 0
      ? costoConMargen / receta.rendimiento_kg
      : null;
  const costoPorPorcion =
    receta.rendimiento_porciones && receta.rendimiento_porciones > 0
      ? costoConMargen / receta.rendimiento_porciones
      : null;

  const resultado: CostoReceta = {
    recetaId,
    costoBase,
    margenPct,
    costoConMargen,
    costoPorKg,
    costoPorPorcion,
    detalles,
    advertencias,
  };
  cache.set(recetaId, resultado);
  enProgreso.delete(recetaId);
  return resultado;
}

// Costea un BORRADOR de receta (ingredientes en memoria, sin guardar) reusando un
// contexto ya construido. Devuelve el mismo CostoReceta que vería tras guardar.
export function costearBorrador(
  receta: RecetaRow,
  ingredientes: IngredienteRow[],
  ctx: CosteoContext,
): CostoReceta {
  // El borrador puede cambiar rendimiento/local respecto al guardado: usamos un ctx
  // con la receta editada pisada para que costoPorKg / costoPorPorcion salgan bien.
  // Si la receta es NUEVA (todavía no está en el contexto), la agregamos: así el
  // editor inline puede previsualizar el costo de una receta que aún no se guardó.
  const existe = ctx.recetas.some((r) => r.id === receta.id);
  const recetasParche = existe
    ? ctx.recetas.map((r) => (r.id === receta.id ? receta : r))
    : [...ctx.recetas, receta];
  const ctxParche: CosteoContext = { ...ctx, recetas: recetasParche };
  return costearReceta(receta.id, ctxParche, new Map(), new Set(), {
    recetaId: receta.id,
    ingredientes,
  });
}
