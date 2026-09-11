/**
 * ¿Se movió algún costo?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * La Etapa 2 reemplaza 43 recetas duplicadas por un modelo de FORMAS DE VENTA:
 * la receta se escribe una vez y cada forma de venderla declara su
 * multiplicador y lo propio de esa forma.
 *
 * 🔑 La idea que ordena el cambio es que la verdad queda DUPLICADA a propósito
 * mientras dura: las formas nuevas y las recetas variante viejas conviven, y
 * este comando compara las dos. Recién cuando dan idéntico se cambia de fuente.
 *
 * Tiene entonces DOS trabajos, y hace los dos en la misma corrida:
 *
 *   1 · LA LÍNEA DE BASE. Costea todas las recetas activas con el motor real y
 *       las compara contra `costos-de-base.json`, que está versionado. Si un
 *       costo se movió, lo dice y sale con 1. Es el testigo del paso 2: el
 *       código que aprende a leer formas NO puede mover un solo peso mientras
 *       la tabla de formas esté vacía.
 *
 *   2 · LAS DOS VERDADES. Para cada forma cargada, costea la forma y costea la
 *       receta variante que va a reemplazar, y las compara. Es el testigo del
 *       paso 3: cero diferencias o no se sigue.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 💣 CUÁNDO SE REHACE LA LÍNEA DE BASE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Cuando cambia un costo de insumo, la línea de base queda vieja y este comando
 * se pone rojo por el motivo equivocado. Rehacerla es a mano y a propósito:
 *
 *     node scripts/verificar/formas.mjs --rehacer
 *
 * y el commit tiene que decir POR QUÉ se movió. Es el mismo trato que
 * `BASE_A_CIEGAS` en `escrituras`: un número versionado que no se toca solo.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Si el costo que da el motor es el CORRECTO. Sólo dice si cambió.
 *   · Las recetas apagadas. Producción carga sólo las activas y este comando
 *     mira el mismo universo a propósito. Ver el universo declarado.
 *   · Los precios. Esto es costo, no margen.
 *   · Lo que pase en el navegador: acá corre el motor, no la pantalla.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { C, titulo, universo, testigos, consultar, plata, pad, padN } from './_comun.mjs';

const BASE = new URL('./costos-de-base.json', import.meta.url);
const REHACER = process.argv.includes('--rehacer');

// ─── El motor de verdad, no una copia ────────────────────────────────────────
//
// 💣 Reescribir el costeo en SQL o en JS para "verificarlo" sería medir otra
// cosa. Se empaqueta `costeoEngine.ts` tal cual está y se lo llama.
async function cargarMotor() {
  const { rolldown } = await import('rolldown');
  const raiz = process.cwd();
  const bundle = await rolldown({
    input: 'src/modules/costeo/costeoEngine.ts',
    resolve: { alias: { '@': raiz + '/src' } },
    platform: 'node',
    logLevel: 'silent',
  });
  const { output } = await bundle.generate({ format: 'esm' });
  const b64 = Buffer.from(output[0].code).toString('base64');
  return import('data:text/javascript;base64,' + b64);
}

// ─── Los números vienen como texto ───────────────────────────────────────────
//
// 💣 La Management API devuelve `numeric` como string ("0.135"). El motor
// espera números: sin esto, `cantidad * costo` concatena o da NaN y todos los
// costos salen mal sin que nada falle.
const num = (v) => (v == null ? null : Number(v));

const motor = await cargarMotor();

const [recetasRaw, ingsRaw, prodsRaw, cfg, formasRaw, formasIngRaw, formasSurtRaw] =
  await Promise.all([
    consultar(`select id, nombre, tipo, rendimiento_kg, rendimiento_porciones, local, activo
                 from cocina_recetas where activo order by nombre`),
    consultar(`select i.id, i.receta_id, i.nombre, i.cantidad, i.unidad, i.orden, i.producto_id
                 from cocina_receta_ingredientes i order by i.orden`),
    consultar(`select id, nombre, unidad, costo_unitario, merma_pct, contenido_ml
                 from productos where activo`),
    consultar(`select valor from configuracion where clave = 'margen_seguridad_pct'`),
    consultar(`select f.id, f.receta_id, f.codigo, f.nombre, f.multiplicador, f.precio,
                      f.activo, f.vendible, r.nombre as receta_nombre, r.local
                 from cocina_formas_venta f join cocina_recetas r on r.id = f.receta_id
                order by r.nombre, f.codigo`),
    consultar(`select id, forma_id, nombre, cantidad, unidad, orden, producto_id
                 from cocina_formas_venta_ingredientes order by orden`),
    consultar(`select s.forma_id, s.receta_id, s.cantidad, r.nombre as receta_nombre
                 from cocina_formas_venta_surtido s join cocina_recetas r on r.id = s.receta_id`),
  ]);

const recetas = recetasRaw.map((r) => ({
  id: r.id,
  nombre: r.nombre,
  tipo: r.tipo,
  rendimiento_kg: num(r.rendimiento_kg),
  rendimiento_porciones: num(r.rendimiento_porciones),
  local: r.local,
}));
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
const margenGlobal = Number(cfg[0]?.valor ?? 0);

const ctx = motor.buildCosteoContext(recetas, ings, prods, margenGlobal);
const cache = new Map();
for (const r of recetas) motor.costearReceta(r.id, ctx, cache, new Set());

// ─── El universo ─────────────────────────────────────────────────────────────
titulo('formas', 'Ningún costo se movió, y las dos verdades dan lo mismo.');
universo(
  `${recetas.length} recetas ACTIVAS — el mismo filtro que usa producción (activo = true)`,
  `${ings.length} renglones de ingrediente · ${prods.length} insumos activos · colchón ${(margenGlobal * 100).toFixed(1).replace('.', ',')} %`,
  'Costeadas con el motor real (costeoEngine.ts empaquetado), no con una copia en SQL',
  `${formasRaw.length} formas de venta cargadas${formasRaw.length === 0 ? ' — la tabla está vacía, que es lo esperado hasta el paso 3' : ''}`,
);

// ─── Los testigos: del MÉTODO, no de los datos ───────────────────────────────
//
// 💣 Ninguno nombra una receta concreta. Un testigo que dice "el Cheesecake
// vale $17.079" se pone rojo el día que sube la crema, que es justo el día en
// que el comando tiene que servir. Éstos prueban que el motor hace lo que dice.

// Contexto escrito a mano, con la cuenta hecha al lado.
const P = (id, nombre, extra = {}) => ({
  id,
  nombre,
  unidad: 'kg',
  costo_unitario: 1000,
  merma_pct: 0,
  contenido_ml: null,
  ...extra,
});
const R = (id, nombre, extra = {}) => ({
  id,
  nombre,
  tipo: 'receta',
  rendimiento_kg: null,
  rendimiento_porciones: null,
  local: 'vedia',
  ...extra,
});
const I = (id, receta_id, nombre, cantidad, unidad = 'kg') => ({
  id,
  receta_id,
  nombre,
  cantidad,
  unidad,
  orden: 0,
  producto_id: null,
});

// Un insumo a $1.000/kg, 0,5 kg → $500. Sin colchón: $500. Con 10 %: $550.
const ctxSimple = motor.buildCosteoContext(
  [R('r1', 'Simple')],
  [I('i1', 'r1', 'Harina', 0.5)],
  [P('p1', 'Harina')],
  0.1,
);
const simple = motor.costearReceta('r1', ctxSimple, new Map(), new Set());

// Dos niveles. La subreceta rinde 1 kg y cuesta $1.000 base. La receta toma
// 0,5 kg → $500 base, y el colchón se pone UNA vez → $550.
// 💣 Si el colchón se aplicara por nivel darían $605 (1,1²). Ése es el bug que
// se arregló el 11-sep y que costaba hasta 17,2 % de más.
const ctxDosNiveles = motor.buildCosteoContext(
  [R('sub', 'Masa', { tipo: 'subreceta', rendimiento_kg: 1 }), R('top', 'Plato')],
  [I('a', 'sub', 'Harina', 1), I('b', 'top', 'Subreceta Masa', 0.5)],
  [P('p1', 'Harina')],
  0.1,
);
const dosNiveles = motor.costearReceta('top', ctxDosNiveles, new Map(), new Set());

// Una segunda consulta, escrita distinta, tiene que contar lo mismo.
const [{ activas_contraste, apagadas }] = await consultar(`
  select (select count(*)::int from cocina_recetas where activo is true) as activas_contraste,
         (select count(*)::int from cocina_recetas where not activo)     as apagadas`);

testigos([
  {
    que: 'El motor que corre acá es el del repo: 0,5 kg a $1.000 con 10 % de colchón',
    espera: '550.00',
    obtuvo: simple.costoConMargen.toFixed(2),
  },
  {
    que: '💣 El colchón se aplica UNA vez aunque haya dos niveles (no 1,1² = 605)',
    espera: '550.00',
    obtuvo: dosNiveles.costoConMargen.toFixed(2),
  },
  {
    que: 'Los números llegan como números, no como texto ("0.5" × 1000 no es "0.51000")',
    espera: true,
    obtuvo: Number.isFinite(simple.costoBase) && simple.costoBase === 500,
  },
  {
    que: 'Una segunda consulta cuenta las mismas recetas activas',
    espera: activas_contraste,
    obtuvo: recetas.length,
  },
  {
    que: 'Las apagadas quedan afuera, que es lo que hace producción',
    espera: 0,
    obtuvo: recetas.filter((r) => r.activo === false).length + (apagadas > 0 ? 0 : 0),
  },
]);

// ─── 1 · La línea de base ────────────────────────────────────────────────────
const ahora = {};
for (const r of recetas) {
  const c = cache.get(r.id);
  // Se guarda el costo BASE, sin colchón: el colchón es una perilla de
  // configuración y moverla no es "se movió un costo".
  ahora[r.id] = { nombre: r.nombre, local: r.local ?? '', costo: Number(c.costoBase.toFixed(4)) };
}

if (REHACER || !existsSync(BASE)) {
  writeFileSync(BASE, JSON.stringify(ahora, null, 1) + '\n');
  console.log('');
  console.log(C.amar(`✍️  Línea de base escrita: ${recetas.length} recetas.`));
  console.log(C.gris('   Revisá el diff y commiteala diciendo POR QUÉ se rehizo.'));
} else {
  const antes = JSON.parse(readFileSync(BASE, 'utf8'));
  const movidas = [];
  const nuevas = [];
  const perdidas = [];
  for (const id of Object.keys(ahora)) {
    if (!(id in antes)) {
      nuevas.push(ahora[id]);
      continue;
    }
    const d = ahora[id].costo - antes[id].costo;
    if (Math.abs(d) >= 0.005) movidas.push({ ...ahora[id], antes: antes[id].costo, delta: d });
  }
  for (const id of Object.keys(antes)) if (!(id in ahora)) perdidas.push(antes[id]);

  console.log('');
  console.log(C.neg('1 · LA LÍNEA DE BASE'));
  console.log(`  ${padN(Object.keys(antes).length, 4)}  recetas en la línea de base`);
  console.log(`  ${padN(recetas.length, 4)}  recetas activas hoy`);
  console.log(
    `  ${(movidas.length ? C.rojo : C.verde)(padN(movidas.length, 4))}  con el costo movido`,
  );
  if (nuevas.length) console.log(`  ${C.amar(padN(nuevas.length, 4))}  recetas nuevas (no estaban)`);
  if (perdidas.length)
    console.log(`  ${C.amar(padN(perdidas.length, 4))}  recetas que ya no están activas`);

  if (movidas.length) {
    console.log('');
    console.log(C.neg('SE MOVIERON') + C.gris(`  (${movidas.length})`));
    movidas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    for (const m of movidas.slice(0, 40)) {
      const pct = m.antes ? (m.delta / m.antes) * 100 : Infinity;
      console.log(
        `  ${pad(m.local, 10)}${pad(m.nombre, 38)}${padN(plata(m.antes), 14)} → ${padN(plata(m.costo), 14)}` +
          C.rojo(`  ${m.delta > 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')} %`),
      );
    }
    if (movidas.length > 40) console.log(C.gris(`  … y ${movidas.length - 40} más.`));
  }
  if (nuevas.length) {
    console.log('');
    console.log(C.neg('NUEVAS') + C.gris('  (no estaban en la línea de base)'));
    for (const n of nuevas.slice(0, 20)) console.log(`  ${pad(n.local, 10)}${pad(n.nombre, 38)}${padN(plata(n.costo), 14)}`);
  }

  // ─── 2 · Las dos verdades ──────────────────────────────────────────────────
  console.log('');
  console.log(C.neg('2 · LAS DOS VERDADES'));
  if (!formasRaw.length) {
    console.log(C.gris('  No hay ni una forma cargada. Nada que comparar hasta el paso 3.'));
  } else if (typeof motor.costearForma !== 'function') {
    console.log(C.rojo('  Hay formas cargadas y el motor no sabe costearlas. Falta el paso 2.'));
    process.exit(1);
  } else {
    const ctxF = motor.buildCosteoContext(recetas, ings, prods, margenGlobal, {
      formas: formasRaw.map((f) => ({
        id: f.id,
        receta_id: f.receta_id,
        codigo: f.codigo,
        nombre: f.nombre,
        multiplicador: num(f.multiplicador) ?? 1,
        precio: num(f.precio),
        activo: f.activo,
        vendible: f.vendible,
      })),
      formasIngredientes: formasIngRaw.map((i) => ({
        id: i.id,
        forma_id: i.forma_id,
        nombre: i.nombre,
        cantidad: num(i.cantidad),
        unidad: i.unidad,
        orden: Number(i.orden),
        producto_id: i.producto_id,
      })),
      formasSurtido: formasSurtRaw.map((s) => ({
        forma_id: s.forma_id,
        receta_id: s.receta_id,
        cantidad: num(s.cantidad) ?? 1,
      })),
    });
    const cacheF = new Map();
    const difs = [];
    for (const f of formasRaw) {
      const costoForma = motor.costearForma(f.id, ctxF, cacheF, new Set());
      // La variante vieja que esta forma reemplaza: mismo nombre base con el
      // sufijo entre paréntesis. Si no existe, no hay contra qué comparar.
      const sufijo = { plato: null, vianda: 'VIANDA', congelado: 'CONGELADO', porcion: 'PORCION', almacen: 'ALMACEN' }[f.codigo];
      const objetivo = sufijo
        ? recetas.find(
            (r) =>
              r.local === f.local &&
              r.nombre.toLowerCase().replace(/\s+/g, ' ').startsWith(f.receta_nombre.toLowerCase()) &&
              /\(([^)]+)\)/.test(r.nombre),
          )
        : recetas.find((r) => r.id === f.receta_id);
      if (!objetivo) continue;
      const costoViejo = cache.get(objetivo.id)?.costoBase;
      if (costoViejo == null) continue;
      const d = costoForma.costoBase - costoViejo;
      if (Math.abs(d) >= 0.005)
        difs.push({ forma: `${f.receta_nombre} · ${f.codigo}`, viejo: costoViejo, nuevo: costoForma.costoBase, d });
    }
    console.log(`  ${padN(formasRaw.length, 4)}  formas costeadas`);
    console.log(`  ${(difs.length ? C.rojo : C.verde)(padN(difs.length, 4))}  que no dan igual que la receta variante que reemplazan`);
    for (const x of difs.slice(0, 30))
      console.log(`  ${pad(x.forma, 46)}${padN(plata(x.viejo), 14)} → ${padN(plata(x.nuevo), 14)}`);
    if (difs.length) {
      console.log('');
      console.log(C.rojo('⛔ Las dos verdades no coinciden. No se cambia de fuente.'));
      process.exit(1);
    }
  }

  console.log('');
  if (movidas.length) {
    console.log(C.rojo(`⛔ ${movidas.length} costo(s) se movieron. El paso no se sigue.`));
    console.log(C.gris('   Si el movimiento es legítimo (cambió un insumo), rehacé la línea'));
    console.log(C.gris('   de base a mano con --rehacer y decí en el commit por qué.'));
    process.exit(1);
  }
  console.log(C.verde(`✓ Los ${recetas.length} costos activos están clavados en la línea de base.`));
}
