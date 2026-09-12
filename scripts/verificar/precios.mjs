/**
 * Precios que no cierran: sin precio, por debajo del costo, o congelados.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Tres cosas que ya pasaron y que nadie ve hasta que alguien las busca:
 *
 *   · Una receta prendida y marcada VENDIBLE sin ningún precio cargado. En la
 *     carta aparece; en la caja no se puede cobrar.
 *   · Un precio POR DEBAJO de lo que cuesta hacerlo. Cada venta pierde plata y
 *     el resumen del mes no lo distingue de una venta floja.
 *   · Un precio que no se toca hace meses mientras el costo del insumo subió.
 *     El margen se va solo, sin que nadie decida nada.
 *
 * 🔑 El margen se calcula con `margenSobreRecibido` del propio módulo, no con
 * una regla escrita acá. Del precio de lista hay que sacar el IVA y la comisión
 * antes de comparar contra el costo: comparar contra el precio bruto da un
 * margen inflado como diez puntos, y ése fue el error que dio origen a que
 * hubiera UNA sola función de margen.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Si el precio es el CORRECTO para el mercado. Eso lo decide Lucas.
 *   · Los pisos de margen por categoría: eso lo mira `vocabularios`.
 *   · Las recetas apagadas, a propósito.
 *   · Los precios del POS que no estén en `cocina_recetas_precios_canal`.
 *   · Si el costo está bien. Para eso están `costos` y `rindes`.
 *
 * Sale con 1 si algo se vende POR DEBAJO DEL COSTO, que es plata que se pierde
 * en cada venta. Lo demás se lista.
 */

import { C, titulo, universo, testigos, consultar, plata, pad, padN } from './_comun.mjs';

async function cargarModulo(entrada) {
  const { rolldown } = await import('rolldown');
  const b = await rolldown({
    input: entrada,
    resolve: { alias: { '@': process.cwd() + '/src' } },
    platform: 'node',
    logLevel: 'silent',
  });
  const { output } = await b.generate({ format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'));
}

// 💣 La Management API devuelve `numeric` como texto.
const num = (v) => (v == null ? null : Number(v));

const motor = await cargarModulo('src/modules/costeo/costeoEngine.ts');
const margen = await cargarModulo('src/modules/costeo/margen.ts');

const [recetasRaw, ingsRaw, prodsRaw, cfg, preciosRaw, comisiones, ivaCfg] = await Promise.all([
  consultar(`select id, nombre, tipo, rendimiento_kg, rendimiento_porciones, local, vendible, categoria
               from cocina_recetas where activo order by nombre`),
  consultar(`select id, receta_id, nombre, cantidad, unidad, orden, producto_id
               from cocina_receta_ingredientes order by orden`),
  consultar(`select id, nombre, unidad, costo_unitario, merma_pct, contenido_ml
               from productos where activo`),
  consultar(`select valor from configuracion where clave = 'margen_seguridad_pct'`),
  consultar(`select p.receta_id, p.canal, p.precio, p.updated_at,
                    (current_date - p.updated_at::date) as dias_sin_tocar
               from cocina_recetas_precios_canal p`),
  consultar(`select pct from comision_mp_config`),
  consultar(`select valor from configuracion where clave = 'iva_pct'`),
]);

const recetas = recetasRaw.map((r) => ({
  id: r.id,
  nombre: r.nombre,
  tipo: r.tipo,
  rendimiento_kg: num(r.rendimiento_kg),
  rendimiento_porciones: num(r.rendimiento_porciones),
  local: r.local,
}));
const meta = new Map(recetasRaw.map((r) => [r.id, r]));
const ings = ingsRaw.map((i) => ({
  id: i.id,
  receta_id: i.receta_id,
  nombre: i.nombre,
  cantidad: num(i.cantidad),
  unidad: i.unidad,
  orden: Number(i.orden),
  producto_id: i.producto_id,
}));
const prods = prodsRaw.map((p) => ({
  id: p.id,
  nombre: p.nombre,
  unidad: p.unidad,
  costo_unitario: num(p.costo_unitario) ?? 0,
  merma_pct: num(p.merma_pct) ?? 0,
  contenido_ml: num(p.contenido_ml),
}));

const ctx = motor.buildCosteoContext(recetas, ings, prods, Number(cfg[0]?.valor ?? 0));
const cache = new Map();
for (const r of recetas) motor.costearReceta(r.id, ctx, cache, new Set());

const cond = margen.condicionesDeCobro({
  ivaPct: ivaCfg.length ? Number(ivaCfg[0].valor) : null,
  comisiones: comisiones.map((c) => ({ pct: c.pct })),
});

const preciosPorReceta = new Map();
for (const p of preciosRaw) {
  if (!preciosPorReceta.has(p.receta_id)) preciosPorReceta.set(p.receta_id, []);
  preciosPorReceta.get(p.receta_id).push({ canal: p.canal, precio: num(p.precio), dias: Number(p.dias_sin_tocar) });
}

titulo('precios', 'Precios que no cierran: sin precio, bajo el costo, o congelados.');
universo(
  `${recetas.length} recetas ACTIVAS · ${recetasRaw.filter((r) => r.vendible).length} marcadas vendibles`,
  `${preciosRaw.length} precios de canal cargados en cocina_recetas_precios_canal`,
  `IVA ${(cond.ivaPct * 100).toFixed(0)} % · comisión ${(cond.comisionPct * 100).toFixed(2).replace('.', ',')} % (la más alta de comision_mp_config)`,
  '🔑 El margen se mide sobre LO QUE QUEDA EN LA MANO: del precio se sacan primero el IVA y la comisión',
  'No se miran los precios del POS ni los pisos por categoría (eso es vocabularios)',
);

// ─── Los testigos: cuentas hechas a mano ─────────────────────────────────────
const condPrueba = margen.condicionesDeCobro({ ivaPct: 0.21, comisiones: [{ pct: 0 }] });
const condConComision = margen.condicionesDeCobro({ ivaPct: 0.21, comisiones: [{ pct: 0.05 }] });

// $1.210 con IVA 21 % y sin comisión → $1.000 en la mano.
const recibido = margen.loQueRecibimos(1210, condPrueba);
// Con costo $500 sobre $1.000 recibidos, el margen es 50 %.
const m50 = margen.margenSobreRecibido(1210, 500, condPrueba);
// 💣 Y contra el precio BRUTO daría (1210−500)/1210 = 58,7 %: nueve puntos de más.
const inflado = (1210 - 500) / 1210;
// Con comisión del 5 %: $1.000 × 0,95 = $950 en la mano.
const conCom = margen.loQueRecibimos(1210, condConComision);

testigos([
  {
    que: 'Lo que queda en la mano sale del módulo, no de una cuenta escrita acá',
    espera: '1000.00',
    obtuvo: recibido.toFixed(2),
  },
  {
    que: '🔑 El margen se mide sobre lo recibido: $500 de costo sobre $1.000 es 50 %',
    espera: '50.0',
    obtuvo: (m50 * 100).toFixed(1),
  },
  {
    que: '💣 Medido contra el precio bruto daría casi 9 puntos más. Ése es el error viejo',
    espera: true,
    obtuvo: inflado - m50 > 0.08,
  },
  {
    que: 'La comisión se descuenta después del IVA',
    espera: '950.00',
    obtuvo: conCom.toFixed(2),
  },
  {
    que: 'Sin precio no hay margen: devuelve nada, no cero',
    espera: null,
    obtuvo: margen.margenSobreRecibido(null, 500, condPrueba),
  },
]);

// ─── El reporte ──────────────────────────────────────────────────────────────
const sinPrecio = [];
const enCero = [];
const bajoCosto = [];
const congelados = [];
const huerfanos = [];

for (const r of recetas) {
  const m = meta.get(r.id);
  const costo = cache.get(r.id)?.costoConMargen ?? null;
  const lista = preciosPorReceta.get(r.id) ?? [];

  if (m.vendible && !lista.length) {
    sinPrecio.push({ nombre: r.nombre, local: r.local, categoria: m.categoria, costo });
    continue;
  }
  if (!m.vendible && lista.length) {
    huerfanos.push({ nombre: r.nombre, local: r.local, canales: lista.map((x) => x.canal).join('/') });
  }
  for (const p of lista) {
    // 💣 Un precio en CERO no es lo mismo que no tener precio: la fila existe,
    // la pantalla la muestra cargada, y el margen no se puede calcular. Pasa
    // desapercibido entre los que si tienen numero.
    if (p.precio === 0) {
      enCero.push({ nombre: r.nombre, local: r.local, canal: p.canal, costo, vendible: m.vendible });
      continue;
    }
    const mg = margen.margenSobreRecibido(p.precio, costo, cond);
    if (mg != null && mg < 0) {
      bajoCosto.push({ nombre: r.nombre, local: r.local, canal: p.canal, precio: p.precio, costo, mg });
    }
    if (p.dias >= 90) {
      congelados.push({ nombre: r.nombre, local: r.local, canal: p.canal, precio: p.precio, dias: p.dias, mg });
    }
  }
}

console.log('');
console.log(C.neg('RESUMEN'));
console.log(`  ${(bajoCosto.length ? C.rojo : C.verde)(padN(bajoCosto.length, 4))}  🔴 se venden POR DEBAJO del costo`);
console.log(`  ${(enCero.length ? C.rojo : C.verde)(padN(enCero.length, 4))}  🔴 con el precio cargado en CERO`);
console.log(`  ${(sinPrecio.length ? C.amar : C.verde)(padN(sinPrecio.length, 4))}  🟠 vendibles SIN ningún precio cargado`);
console.log(`  ${C.amar(padN(congelados.length, 4))}  🟡 con el precio sin tocar hace 90 días o más`);
console.log(`  ${C.gris(padN(huerfanos.length, 4))}  ⚪ tienen precio y NO están marcadas vendibles`);

const tabla = (titulo2, lista, render) => {
  if (!lista.length) return;
  console.log('');
  console.log(C.neg(titulo2) + C.gris(`  (${lista.length})`));
  for (const x of lista.slice(0, 30)) console.log('  ' + render(x));
  if (lista.length > 30) console.log(C.gris(`  … y ${lista.length - 30} más.`));
};

bajoCosto.sort((a, b) => a.mg - b.mg);
tabla('🔴 POR DEBAJO DEL COSTO', bajoCosto, (x) =>
  `${pad(x.local, 10)}${pad(x.nombre, 38)}${pad(x.canal, 11)}${padN(plata(x.precio), 13)} vs ${padN(plata(x.costo), 13)}` +
  C.rojo(`  ${(x.mg * 100).toFixed(1).replace('.', ',')} %`),
);

tabla('🔴 PRECIO CARGADO EN CERO', enCero, (x) =>
  `${pad(x.local, 10)}${pad(x.nombre, 38)}${pad(x.canal, 11)}` +
  C.gris(`cuesta ${plata(x.costo)}${x.vendible ? ' · SE VENDE' : ''}`),
);

sinPrecio.sort((a, b) => (b.costo ?? 0) - (a.costo ?? 0));
tabla('🟠 VENDIBLES SIN PRECIO', sinPrecio, (x) =>
  `${pad(x.local, 10)}${pad(x.nombre, 38)}${pad(x.categoria ?? '—', 14)}${C.gris('cuesta ' + plata(x.costo))}`,
);

congelados.sort((a, b) => b.dias - a.dias);
tabla('🟡 PRECIO SIN TOCAR HACE 90 DÍAS O MÁS', congelados, (x) =>
  `${pad(x.local, 10)}${pad(x.nombre, 38)}${pad(x.canal, 11)}${padN(plata(x.precio), 13)}` +
  C.gris(`  ${x.dias} días${x.mg != null ? ` · margen ${(x.mg * 100).toFixed(0)} %` : ''}`),
);

tabla('⚪ CON PRECIO Y NO SON VENDIBLES', huerfanos, (x) =>
  `${pad(x.local, 10)}${pad(x.nombre, 44)}${C.gris(x.canales)}`,
);

console.log('');
if (bajoCosto.length || enCero.length) {
  if (bajoCosto.length)
    console.log(C.rojo(`⛔ ${bajoCosto.length} precio(s) por debajo del costo: cada venta pierde plata.`));
  if (enCero.length)
    console.log(C.rojo(`⛔ ${enCero.length} precio(s) cargados en CERO: la fila existe y no se puede cobrar.`));
  process.exit(1);
}
console.log(C.verde('✓ Ningún precio queda en cero ni por debajo del costo.'));
