/**
 * Lo que el motor de costeo ya sabe que está mal y nadie lee.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `costearReceta` devuelve un campo `advertencias` en CADA receta: "Sin match",
 * "no tiene rendimiento en kg", "Unidad no soportada", "Referencia circular".
 * La pantalla las muestra receta por receta, así que hay que entrar a las 274
 * de a una para verlas. Nadie hace eso.
 *
 * 🔑 Y no son cosméticas: cuando el motor no puede costear un renglón, **suma
 * cero y sigue**. La receta no falla, sale barata. Un plato que figura con 82 %
 * de margen puede tener la mitad de sus ingredientes sin costear.
 *
 * Esto junta las 274 y las ordena por lo que se pierde.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Un rendimiento CARGADO pero equivocado. Que una tanda diga 10 kg cuando
 *     son 8 es indistinguible desde acá: el motor la cree.
 *   · Un ingrediente que falta en la receta. Sólo ve lo que está escrito.
 *   · Las recetas apagadas, a propósito: mira el mismo universo que producción.
 *   · Los precios y los márgenes. Eso es `precios`.
 *
 * Sale con 1 si hay una referencia circular, que sí rompe el número.
 */

import { C, titulo, universo, testigos, consultar, plata, pad, padN } from './_comun.mjs';

// El motor de verdad, empaquetado. Mismo método que `formas`.
async function cargarMotor() {
  const { rolldown } = await import('rolldown');
  const b = await rolldown({
    input: 'src/modules/costeo/costeoEngine.ts',
    resolve: { alias: { '@': process.cwd() + '/src' } },
    platform: 'node',
    logLevel: 'silent',
  });
  const { output } = await b.generate({ format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'));
}

// 💣 La Management API devuelve `numeric` como texto. Sin esto el motor
// multiplica strings y todo sale mal sin que nada falle.
const num = (v) => (v == null ? null : Number(v));

const motor = await cargarMotor();
const [recetasRaw, ingsRaw, prodsRaw, cfg] = await Promise.all([
  consultar(`select id, nombre, tipo, rendimiento_kg, rendimiento_porciones, rendimiento_unidad,
                    local, vendible
               from cocina_recetas where activo order by nombre`),
  consultar(`select id, receta_id, nombre, cantidad, unidad, orden, producto_id
               from cocina_receta_ingredientes order by orden`),
  consultar(`select id, nombre, unidad, costo_unitario, merma_pct, contenido_ml
               from productos where activo`),
  consultar(`select valor from configuracion where clave = 'margen_seguridad_pct'`),
]);

const recetas = recetasRaw.map((r) => ({
  id: r.id,
  nombre: r.nombre,
  tipo: r.tipo,
  rendimiento_kg: num(r.rendimiento_kg),
  rendimiento_porciones: num(r.rendimiento_porciones),
  local: r.local,
}));
const crudaPorId = new Map(recetasRaw.map((r) => [r.id, r]));
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

titulo('rindes', 'Lo que el motor ya sabe que está mal y nadie lee.');
universo(
  `${recetas.length} recetas ACTIVAS — el mismo filtro que producción`,
  `${ings.length} renglones · ${prods.length} insumos activos`,
  'Las advertencias las produce el motor real (costeoEngine.ts), no una regla escrita acá',
  '🔑 Un renglón que el motor no puede costear suma CERO y sigue: la receta sale barata, no rota',
);

// ─── Los testigos: del MÉTODO ────────────────────────────────────────────────
const P = (id, n, u = 'kg') => ({ id, nombre: n, unidad: u, costo_unitario: 1000, merma_pct: 0, contenido_ml: null });
const R = (id, n, x = {}) => ({ id, nombre: n, tipo: 'receta', rendimiento_kg: null, rendimiento_porciones: null, local: 'vedia', ...x });
const I = (id, rid, n, c, u = 'kg') => ({ id, receta_id: rid, nombre: n, cantidad: c, unidad: u, orden: 0, producto_id: null });

// Una subreceta SIN rendimiento en kg, usada en kg: el motor avisa y suma cero.
const ctxSinRinde = motor.buildCosteoContext(
  [R('sub', 'Masa', { tipo: 'subreceta' }), R('top', 'Plato')],
  [I('a', 'sub', 'Harina', 1), I('b', 'top', 'Subreceta Masa', 0.5)],
  [P('p', 'Harina')],
  0,
);
const sinRinde = motor.costearReceta('top', ctxSinRinde, new Map(), new Set());

// Un ingrediente que no existe en ningún catálogo.
const ctxSinMatch = motor.buildCosteoContext(
  [R('x', 'Plato')],
  [I('c', 'x', 'Algo que no existe', 1)],
  [P('p', 'Harina')],
  0,
);
const sinMatch = motor.costearReceta('x', ctxSinMatch, new Map(), new Set());

// Dos recetas que se usan mutuamente.
//
// 💥 HALLAZGO, y salio de escribir este testigo: el motor SI corta la recursion
// circular, pero su mensaje "Referencia circular detectada" NO LLEGA A NINGUN
// LADO. El corte devuelve el aviso al que llamo, sin guardarlo en el cache, y
// el que llamo solo mira `costoBasePorKg`, que viene en null: entonces escribe
// su propio aviso, "no tiene rendimiento en kg". El texto original se pierde.
//
// 🔑 Por eso el ciclo se busca por su FIRMA y no por el texto: una subreceta
// que SI tiene rendimiento cargado y aun asi hizo que su padre se quejara de
// que no lo tiene. Eso solo pasa cuando el corte circular la dejo en cero.
// Es un metodo independiente del mensaje, que es justo lo que hay que probar.
export function firmaDeCiclo(costo, rendimientoDeLaSub) {
  return costo.detalles.some(
    (d) =>
      d.esSubreceta &&
      d.costoTotal == null &&
      /no tiene rendimiento/i.test(d.error ?? '') &&
      rendimientoDeLaSub(d.subrecetaId) > 0,
  );
}

const cacheCirc = new Map();
const ctxCirc = motor.buildCosteoContext(
  [R('a1', 'Uno', { tipo: 'subreceta', rendimiento_kg: 1 }), R('b1', 'Dos', { tipo: 'subreceta', rendimiento_kg: 1 })],
  [I('i1', 'a1', 'Subreceta Dos', 1), I('i2', 'b1', 'Subreceta Uno', 1)],
  [P('p', 'Harina')],
  0,
);
const circ = motor.costearReceta('a1', ctxCirc, cacheCirc, new Set());
// 💣 Y hay una segunda sorpresa: la receta de ARRIBA sale con costo 0 y CERO
// advertencias. Se ve impecable. La queja aparece en la del medio. Por eso el
// reporte recorre las 274 y no se para en la que uno sospecha.
const hayCircular = [...cacheCirc.values()].some((c) => firmaDeCiclo(c, () => 1));
const arribaSaleLimpia = circ.advertencias.length === 0 && circ.costoBase === 0;

// Y el control: una subreceta que de verdad NO tiene rendimiento no es un ciclo.
const noEsCiclo = firmaDeCiclo(sinRinde, () => null);

const [{ activas_contraste }] = await consultar(
  `select count(*)::int as activas_contraste from cocina_recetas where activo is true`,
);

testigos([
  {
    que: '💣 Una subreceta sin rendimiento suma CERO y el motor lo avisa (no rompe)',
    espera: '0 · 1 advertencia',
    obtuvo: `${sinRinde.costoBase} · ${sinRinde.advertencias.length} advertencia`,
  },
  {
    que: 'Un ingrediente que no existe en ningún catálogo se avisa como "Sin match"',
    espera: true,
    obtuvo: sinMatch.advertencias.some((a) => /sin match/i.test(a)),
  },
  {
    que: '💥 El ciclo se caza por su firma: la subreceta TIENE rendimiento y el padre dice que no',
    espera: true,
    obtuvo: hayCircular,
  },
  {
    que: 'Y una subreceta que de verdad no tiene rendimiento NO se confunde con un ciclo',
    espera: false,
    obtuvo: noEsCiclo,
  },
  {
    que: '💥 En un ciclo, la receta de ARRIBA sale con costo 0 y sin una sola advertencia',
    espera: true,
    obtuvo: arribaSaleLimpia,
  },
  {
    que: 'Una segunda consulta cuenta las mismas recetas activas',
    espera: activas_contraste,
    obtuvo: recetas.length,
  },
]);

// ─── El reporte ──────────────────────────────────────────────────────────────
const CAJONES = [
  { k: 'circular', re: /circular/i, etiqueta: '🔴 REFERENCIA CIRCULAR — el costo no significa nada' },
  { k: 'sin_rinde', re: /no tiene rendimiento/i, etiqueta: '🟠 SUBRECETA SIN RENDIMIENTO — el renglón suma cero' },
  { k: 'sin_match', re: /sin match|no encontrada/i, etiqueta: '🟠 INGREDIENTE SIN MATCH — el renglón suma cero' },
  { k: 'unidad', re: /unidad|convertir/i, etiqueta: '🟡 UNIDAD QUE NO SE PUEDE CONVERTIR' },
  { k: 'otra', re: /./, etiqueta: '⚪ OTRAS' },
];

// El rendimiento de cada subreceta, para poder aplicar la firma del ciclo.
const rindeDe = (id) => {
  const r = recetas.find((x) => x.id === id);
  return r ? (r.rendimiento_kg ?? r.rendimiento_porciones) : null;
};

const filas = [];
for (const r of recetas) {
  const c = cache.get(r.id);
  if (!c?.advertencias.length) continue;
  // Cuánto costo se está perdiendo: los renglones que no pudieron costearse.
  const mudos = c.detalles.filter((d) => d.costoTotal == null).length;
  filas.push({
    ciclo: firmaDeCiclo(c, rindeDe),
    nombre: r.nombre,
    local: r.local ?? '',
    tipo: r.tipo,
    vendible: crudaPorId.get(r.id)?.vendible,
    costo: c.costoBase,
    renglones: c.detalles.length,
    mudos,
    avisos: c.advertencias,
  });
}

const enCajon = (f) => {
  if (f.ciclo) return 'circular';
  return CAJONES.find((c) => f.avisos.some((a) => c.re.test(a))).k;
};
for (const f of filas) f.cajon = enCajon(f);

console.log('');
console.log(C.neg('RESUMEN'));
console.log(`  ${padN(recetas.length, 4)}  recetas activas`);
console.log(`  ${(filas.length ? C.amar : C.verde)(padN(filas.length, 4))}  con al menos una advertencia del motor`);
const mudosTotal = filas.reduce((a, f) => a + f.mudos, 0);
console.log(`  ${C.amar(padN(mudosTotal, 4))}  renglones que el motor NO pudo costear (suman cero)`);
const vendiblesRotas = filas.filter((f) => f.vendible).length;
console.log(`  ${(vendiblesRotas ? C.rojo : C.verde)(padN(vendiblesRotas, 4))}  de ésas son VENDIBLES: el precio se decide sobre un costo incompleto`);

for (const c of CAJONES) {
  const g = filas.filter((f) => f.cajon === c.k);
  if (!g.length) continue;
  console.log('');
  console.log(C.neg(c.etiqueta) + C.gris(`  (${g.length})`));
  g.sort((a, b) => b.mudos - a.mudos);
  for (const f of g.slice(0, 25)) {
    console.log(
      `  ${pad(f.local, 10)}${pad(f.nombre, 40)}${padN(plata(f.costo), 14)}` +
        C.gris(`  ${f.mudos}/${f.renglones} renglones mudos${f.vendible ? ' · SE VENDE' : ''}`),
    );
    console.log(C.gris(`      ${f.avisos[0]}${f.avisos.length > 1 ? ` (+${f.avisos.length - 1})` : ''}`));
  }
  if (g.length > 25) console.log(C.gris(`  … y ${g.length - 25} más.`));
}

console.log('');
const circulares = filas.filter((f) => f.cajon === 'circular');
if (circulares.length) {
  console.log(C.rojo(`⛔ ${circulares.length} receta(s) con referencia circular: su costo no significa nada.`));
  process.exit(1);
}
console.log(C.verde('✓ Ninguna referencia circular. Lo demás son renglones que suman cero: se ven arriba.'));
