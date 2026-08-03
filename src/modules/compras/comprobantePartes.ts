// Facturas repartidas en varias categorías.
//
// Cuando una factura toca más de un rubro (ej. alimentos + bebidas + limpieza) el
// ERP la carga como VARIOS gastos —uno por parte— con el mismo nro de comprobante,
// el mismo vencimiento y el comentario "Parte 1/2 de comprobante". Cada fila lleva
// SOLO su porción del importe: los totales del cta cte y del calendario son
// correctos y no hay doble conteo (auditado ago-2026 sobre 138 comprobantes
// partidos: 0 con vencimientos distintos, 0 con estado mixto, 0 con una parte
// fuera del cta cte).
//
// Lo que confundía era el CONTEO: el 3/8 el calendario decía "48 pagos" cuando en
// realidad eran 27 comprobantes (35 renglones eran partes de solo 14 facturas).
// Estos helpers dan la clave para agrupar las partes de una misma factura y la
// etiqueta para mostrarlas en el listado.

export interface GastoParte {
  id: string;
  local?: string | null;
  fecha?: string | null;
  proveedor?: string | null;
  proveedor_id?: string | null;
  nro_comprobante?: string | null;
  comentario?: string | null;
}

const RE_PARTE = /Parte\s+(\d+)\s*\/\s*(\d+)/i;

// "Parte 2/3 de comprobante" → { parte: 2, total: 3 }. null si el gasto no es parte
// de nada (la enorme mayoría).
export function parsearParte(
  comentario: string | null | undefined,
): { parte: number; total: number } | null {
  const m = RE_PARTE.exec(comentario ?? '');
  if (!m) return null;
  const parte = Number(m[1]);
  const total = Number(m[2]);
  if (!parte || !total || parte > total) return null;
  return { parte, total };
}

// Clave estable que comparten todas las partes de una misma factura. Sirve para
// contar comprobantes en vez de renglones.
//
// El campo `comprobante_id` de la tabla existe pero está casi vacío (6 de 326
// partes), así que la clave se arma con lo que sí está siempre: proveedor + nro de
// comprobante + fecha + local. Sin nro de comprobante (43 de 138 grupos: remitos,
// proveedores que no facturan) caemos a proveedor+fecha+local+cantidad de partes.
// Límite conocido: dos facturas SIN nro, del mismo proveedor, mismo día, mismo
// local y con la misma cantidad de partes se fusionan en una — subcuenta de a uno
// en un caso muy raro; nunca afecta importes, solo el conteo.
export function claveComprobante(g: GastoParte): string {
  const prov = (g.proveedor_id ?? g.proveedor ?? '').toString().trim().toLowerCase();
  const nro = (g.nro_comprobante ?? '').replace(/\D/g, '');
  const fecha = g.fecha ?? '';
  const local = g.local ?? '';
  if (nro) return `${prov}|${nro}|${fecha}|${local}`;
  const p = parsearParte(g.comentario);
  if (p) return `${prov}|sinnro|${fecha}|${local}|de${p.total}`;
  // No es parte de nada: cada gasto es su propio comprobante.
  return `gasto:${g.id}`;
}

// "parte 1/2" para el chip del listado. null si el gasto no está partido.
export function etiquetaParte(g: GastoParte): string | null {
  const p = parsearParte(g.comentario);
  return p ? `parte ${p.parte}/${p.total}` : null;
}

// Texto del tooltip del chip: explica por qué el importe del renglón es menor que
// el de la factura que tiene el proveedor en la mano.
export function tituloParte(g: GastoParte): string | undefined {
  const p = parsearParte(g.comentario);
  if (!p) return undefined;
  const nro = (g.nro_comprobante ?? '').trim();
  return (
    `${nro ? `Comprobante ${nro}` : 'Comprobante sin número'} dividido en ${p.total} partes ` +
    `porque toca varias categorías. Este renglón es la parte ${p.parte} de ${p.total}: ` +
    `su importe es solo esa porción, no el total de la factura.`
  );
}
