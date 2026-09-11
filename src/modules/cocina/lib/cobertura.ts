// Cálculo de cobertura semanal por producto, COMPARTIDO entre el Resumen
// semanal (plan guardado) y el editor de plan (en vivo). Mantener una sola
// fuente de verdad evita que las marcas del editor y el Resumen se contradigan.
//
//   disponible = (stock actual − pedidos) + producción planificada
//   estado     = disponible / demanda semanal
//
// ⚠️ LA DEMANDA YA NO SE BUSCA POR NOMBRE (8-sep-2026, mig 195). Antes esto juntaba
// los `fudo_nombres` del producto y los comparaba contra el nombre que Fudo le puso
// a la venta; cuando faltaba un alias el producto quedaba con demanda CERO y el
// plan lo marcaba como "sobra" teniendo la cámara vacía. Medido en 7 días: la
// Mezzelune de Bondiola de Vedia daba 0 con 168 porciones vendidas. Ahora la base
// devuelve la demanda por id de producto.
import { normNombre } from '../DashboardTab';

export type EstadoCobertura = 'cubre' | 'ajustado' | 'corto' | 'sobra' | 'sin_demanda';

export interface ProductoCob {
  id: string;
  nombre: string;
  /** `cocina_productos.familia_stock` (mig 209): donde vive el producto. */
  familia_stock: string;
  receta_id: string | null;
}

// Un ítem de plan, ya sea leído del pizarrón guardado o construido en vivo
// desde el editor. rendimiento_porciones es el rinde de la receta vinculada.
export interface ItemPlanCob {
  receta_id: string | null;
  texto_libre: string | null;
  tipo: string;
  cantidad_recetas: number;
  rendimiento_porciones: number | null;
  destino_producto_id: string | null;
}

export interface FudoCob {
  /** producto_id → porciones que salieron en el rango (mig 195). */
  porProducto: Map<string, number>;
  dias: number;
}

export interface ResultadoCob {
  id: string;
  nombre: string;
  tipo: string;
  planificado: number;
  stock: number; // ya neto de pedidos
  pedidos: number;
  disponible: number;
  demandaSemanal: number;
  estado: EstadoCobertura;
}

const ORDEN_ESTADO: Record<EstadoCobertura, number> = {
  corto: 0,
  ajustado: 1,
  cubre: 2,
  sobra: 3,
  sin_demanda: 4,
};

export interface ArgsCobertura {
  productos: ProductoCob[];
  itemsPlan: ItemPlanCob[];
  fudoData: FudoCob | null | undefined;
  // Stock de pastas por producto_id; stock de postres por receta_id.
  stockPorProducto: Map<string, number>;
  stockPorReceta: Map<string, number>;
  pedidosPorProducto: Map<string, number>;
  // Promedio real de porciones por lote (QR 60d), por producto_id. Para destinos.
  rindePorLote: Map<string, number>;
  tiposIncluidos: string[];
}

export function calcularCobertura(args: ArgsCobertura): ResultadoCob[] {
  const {
    productos,
    itemsPlan,
    fudoData,
    stockPorProducto,
    stockPorReceta,
    pedidosPorProducto,
    rindePorLote,
    tiposIncluidos,
  } = args;

  function demandaSemanalDe(prod: ProductoCob): number {
    if (!fudoData || fudoData.dias <= 0) return 0;
    const total = fudoData.porProducto.get(prod.id) ?? 0;
    return (total / fudoData.dias) * 7;
  }

  function planificadoDe(prod: ProductoCob): number {
    let total = 0;
    const nombreProd = normNombre(prod.nombre);
    for (const it of itemsPlan) {
      // Pasta simple: planificada por nombre, cantidad ya en porciones.
      if (it.tipo === 'pasta_simple') {
        if (it.texto_libre && normNombre(it.texto_libre) === nombreProd) {
          total += it.cantidad_recetas;
        }
        continue;
      }
      // Imputación explícita (destino, ej: pure → ñoquis): 1 unidad de plan =
      // 1 tanda/bolsa real → promedio de porciones por lote (QR 60d); si no hay
      // datos, cae al rinde de la receta.
      if (it.destino_producto_id) {
        if (it.destino_producto_id === prod.id) {
          const rindeReal = rindePorLote.get(prod.id) ?? 0;
          const rinde = rindeReal > 0 ? rindeReal : Number(it.rendimiento_porciones) || 0;
          total += it.cantidad_recetas * rinde;
        }
        continue;
      }
      // Legacy: matchea por la receta vinculada al producto × rinde de receta.
      const rinde = Number(it.rendimiento_porciones) || 0;
      if (rinde <= 0) continue;
      if (prod.receta_id && it.receta_id === prod.receta_id) {
        total += it.cantidad_recetas * rinde;
      }
    }
    return total;
  }

  function stockDe(prod: ProductoCob): number {
    if (prod.familia_stock === 'pasta') return stockPorProducto.get(prod.id) ?? 0;
    if (!prod.receta_id) return 0;
    return stockPorReceta.get(prod.receta_id) ?? 0;
  }

  const items = productos
    .filter((p) => tiposIncluidos.includes(p.familia_stock))
    .map<ResultadoCob>((p) => {
      const demandaSemanal = demandaSemanalDe(p);
      const planificado = planificadoDe(p);
      const stockBruto = stockDe(p);
      const pedidos = pedidosPorProducto.get(p.id) ?? 0;
      const stockLibre = Math.max(0, stockBruto - pedidos);
      const disponible = stockLibre + planificado;
      let estado: EstadoCobertura;
      if (demandaSemanal <= 0) {
        estado = 'sin_demanda';
      } else {
        const ratio = disponible / demandaSemanal;
        if (ratio < 0.8) estado = 'corto';
        else if (ratio < 0.95) estado = 'ajustado';
        else if (ratio <= 1.2) estado = 'cubre';
        else estado = 'sobra';
      }
      return {
        id: p.id,
        nombre: p.nombre,
        tipo: p.familia_stock,
        planificado,
        stock: stockLibre,
        pedidos,
        disponible,
        demandaSemanal,
        estado,
      };
    });

  return items.sort((a, b) => {
    if (ORDEN_ESTADO[a.estado] !== ORDEN_ESTADO[b.estado])
      return ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado];
    return b.demandaSemanal - a.demandaSemanal;
  });
}
