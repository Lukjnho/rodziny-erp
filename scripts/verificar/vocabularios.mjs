/**
 * ¿Las listas fijas del código dicen lo mismo que los datos?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE — ESTE ES EL QUE AGARRA "LA PANTALLA QUE MIENTE"
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Una pantalla que filtra por un valor que ya no existe NO falla: muestra una
 * lista corta y se queda tan tranquila. Nadie la reporta porque nadie sabe
 * cuántos renglones tendría que haber.
 *
 *   · `panificado` ↔ `panaderia` dejó la pantalla de Panes vacía TRES MESES.
 *   · La migración 208 renombró el rol `panificado` a `panificado_base` y el
 *     editor de plan siguió filtrando por el viejo: 12 recetas se cayeron del
 *     desplegable y 47 renglones del plan de Saavedra quedaron en blanco.
 *
 * 🔑 Un error de vocabulario no se ve leyendo el código NI leyendo los datos.
 * Se ve **cruzándolos**, y por local: un valor puede tener 30 filas en Vedia y
 * cero en Saavedra, y ahí la pantalla miente en un solo local.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LOS TRES CHEQUEOS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1 · Cada lista fija de `costeo/modelo.ts` contra los datos reales, POR
 *       LOCAL. Un valor con cero filas en un local es una sección vacía.
 *   2 · Al revés: valores que están en los datos y NO en la lista del código.
 *       Ese es el que rompe en silencio, porque el código ni los contempla.
 *   3 · `productos_costeo_config`: qué piso de margen se le aplica a cada
 *       cajón, cuáles sobran y cuáles faltan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Vocabularios que coinciden en texto y significan cosas distintas. El
 *     `tipo` de `cocina_pizarron_items` y el `tipo` de `cocina_recetas` dicen
 *     los dos "salsa" y no son lo mismo.
 *   · Listas fijas escritas dentro de una pantalla en vez de en modelo.ts.
 *     Lee `costeo/modelo.ts` y nada más: si alguien copia una lista adentro de
 *     un .tsx, este comando no la ve. (Para eso está `npm run reglas`.)
 *   · Cuál de los dos vocabularios es el correcto. Eso lo decide Lucas.
 *
 * Sale con 1 si hay un valor en los datos que el código no contempla.
 */

import { readFileSync } from 'node:fs';
import { C, titulo, universo, testigos, consultar, pad, padN } from './_comun.mjs';

// ─── 1 · Las listas fijas del código ─────────────────────────────────────────
//
// Se leen de `costeo/modelo.ts` con una expresión regular porque este script es
// .mjs y no puede importar TypeScript. Los testigos verifican que la lectura
// salió bien: si alguien cambia la forma del archivo, el comando aborta en vez
// de reportar listas vacías.

const MODELO = readFileSync('src/modules/costeo/modelo.ts', 'utf8');

function listaDelCodigo(nombre) {
  const re = new RegExp(`export const ${nombre}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`, 'm');
  const m = MODELO.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function mapaDelCodigo(nombre) {
  const re = new RegExp(`export const ${nombre}[^=]*=\\s*\\{([\\s\\S]*?)\\}`, 'm');
  const m = MODELO.match(re);
  if (!m) return {};
  return Object.fromEntries([...m[1].matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map((x) => [x[1], x[2]]));
}

const LISTAS = {
  CATEGORIAS: listaDelCodigo('CATEGORIAS'),
  ROLES: listaDelCodigo('ROLES'),
  FAMILIAS_STOCK: listaDelCodigo('FAMILIAS_STOCK'),
  SUBCATEGORIAS_BEBIDA: listaDelCodigo('SUBCATEGORIAS_BEBIDA'),
  SUBCATEGORIAS_CAFETERIA: listaDelCodigo('SUBCATEGORIAS_CAFETERIA'),
};
const PUENTE_LOTE = mapaDelCodigo('CATEGORIA_DE_LOTE_POR_FAMILIA');

// Qué columna de la base guarda cada lista.
const DONDE = {
  CATEGORIAS: { tabla: 'cocina_recetas', col: 'categoria', filtro: "activo and tipo = 'receta'" },
  ROLES: { tabla: 'cocina_recetas', col: 'rol', filtro: "activo and tipo = 'subreceta'" },
  FAMILIAS_STOCK: { tabla: 'cocina_productos', col: 'familia_stock', filtro: 'true' },
  SUBCATEGORIAS_BEBIDA: { tabla: 'cocina_recetas', col: 'subcategoria', filtro: "activo and categoria = 'bebida'" },
  SUBCATEGORIAS_CAFETERIA: { tabla: 'cocina_recetas', col: 'subcategoria', filtro: "activo and categoria = 'cafeteria'" },
};

// ─── 2 · Los datos ───────────────────────────────────────────────────────────

const trozos = Object.entries(DONDE).map(
  ([lista, d]) => `
  select '${lista}' as lista, coalesce(${d.col}, '(vacío)') as valor,
         coalesce(local, '(sin local)') as local, count(*)::int as n
    from ${d.tabla} where ${d.filtro} group by 1, 2, 3`,
);
const filas = await consultar(trozos.join(' union all '));

// 💣 El puente `categoriaDeLote` NO va al pizarrón: va a los LOTES.
// `StockTab` compara `categoriaDeLote(familia)` contra
// `cocina_lotes_produccion.categoria` — ese es el cruce que dejó la sección
// "🥖 Panes" sin una fecha desde el 16-jun-2026, con 1.019 lotes cargados.
// (El `tipo` de `cocina_pizarron_items` es OTRO vocabulario, con sus propias
// secciones escritas a mano en PlanProduccionEditor.tsx. No cruza con este.)
const [{ lotes }] = await consultar(`
  select coalesce(json_agg(x), '[]'::json) as lotes from (
    select coalesce(categoria,'(vacío)') as categoria, coalesce(local,'(sin local)') as local,
           count(*)::int as n
      from cocina_lotes_produccion group by 1, 2) x`);

const cfg = await consultar(`
  select categoria, margen_min::float8 as piso, margen_colchon::float8 as franja
    from productos_costeo_config order by categoria`);

// Los cajones REALES: lo mismo que calcula cajonComercial() en modelo.ts.
const cajones = await consultar(`
  select case when tipo = 'subreceta'
              then case rol when 'salsa_base' then 'salsa' when 'postre_base' then 'postre'
                            when 'bebida_base' then 'bebida' when 'pasteleria_base' then 'pasteleria'
                            when 'panificado_base' then 'panificado' else coalesce(rol,'otros') end
              else coalesce(categoria,'otros') end as cajon,
         count(*) filter (where vendible)::int as vendibles,
         count(*) filter (where vendible and exists (
           select 1 from cocina_recetas_precios_canal pc
            where pc.receta_id = cocina_recetas.id and pc.canal = 'plato'))::int as con_precio
    from cocina_recetas where activo group by 1 order by 3 desc, 1`);

const LOCALES = [...new Set(filas.map((f) => f.local))].filter((l) => l !== '(sin local)').sort();

// ─── El universo ─────────────────────────────────────────────────────────────
titulo('vocabularios', 'Las listas fijas del código contra los datos reales, local por local.');
universo(
  `5 listas fijas leídas de src/modules/costeo/modelo.ts (${Object.values(LISTAS).flat().length} valores en total)`,
  `Datos: solo filas ACTIVAS. Locales encontrados: ${LOCALES.join(' · ')}`,
  'Categorías: solo recetas. Roles: solo subrecetas. Familias: cocina_productos entero.',
  'Lee modelo.ts y NADA más: una lista copiada adentro de un .tsx es invisible acá.',
);

// ─── Los testigos ────────────────────────────────────────────────────────────
const valoresDe = (lista) => new Set(filas.filter((f) => f.lista === lista).map((f) => f.valor));
testigos([
  {
    que: 'La lectura de modelo.ts trae las 8 categorías y "pasta" es una',
    espera: '8/sí',
    obtuvo: `${LISTAS.CATEGORIAS.length}/${LISTAS.CATEGORIAS.includes('pasta') ? 'sí' : 'no'}`,
  },
  {
    que: 'La lectura de modelo.ts trae los 12 roles',
    espera: 12,
    obtuvo: LISTAS.ROLES.length,
  },
  {
    que: 'El puente de lotes traduce panificado → panaderia',
    espera: 'panaderia',
    obtuvo: PUENTE_LOTE.panificado ?? 'NO LO ENCONTRÓ',
  },
  {
    que: 'En los datos hay recetas de categoría "pasta"',
    espera: true,
    obtuvo: valoresDe('CATEGORIAS').has('pasta'),
  },
  {
    que: 'Los lotes guardan "panaderia" donde el producto dice "panificado"',
    espera: true,
    obtuvo: lotes.some((l) => l.categoria === 'panaderia'),
  },
  {
    que: 'Y NO guardan "panificado": si lo guardaran, el puente sobraría',
    espera: false,
    obtuvo: lotes.some((l) => l.categoria === 'panificado'),
  },
]);

// ─── Chequeo 1 · cada lista contra los datos, por local ──────────────────────
console.log('');
console.log(C.neg('1 · LAS LISTAS DEL CÓDIGO CONTRA LOS DATOS, POR LOCAL'));
let vaciasEnAlgunLocal = 0;
for (const [lista, valores] of Object.entries(LISTAS)) {
  const d = DONDE[lista];
  console.log('');
  console.log(`  ${C.neg(lista)} ${C.gris(`— ${d.tabla}.${d.col}`)}`);
  console.log(C.gris(`    ${pad('valor', 24)}${LOCALES.map((l) => padN(l, 12)).join('')}`));
  for (const v of valores) {
    const porLocal = LOCALES.map(
      (l) => filas.find((f) => f.lista === lista && f.valor === v && f.local === l)?.n ?? 0,
    );
    const total = porLocal.reduce((a, b) => a + b, 0);
    // Que Vedia no tenga panadería no es un error: es el negocio. Se informa
    // en gris. La alarma es el valor que NO EXISTE EN NINGÚN LOCAL: ese es una
    // opción que la pantalla ofrece y no le corresponde ninguna fila.
    const vacioEnAlguno = total > 0 && porLocal.some((n) => n === 0);
    if (total === 0) vaciasEnAlgunLocal++;
    const soloEn = LOCALES.filter((_, i) => porLocal[i] > 0).join(' y ');
    const marca =
      total === 0
        ? C.amar('  ⚠ la pantalla lo ofrece y no hay ni una fila')
        : vacioEnAlguno
          ? C.gris(`  solo ${soloEn}`)
          : '';
    console.log(
      `    ${pad(v, 24)}${porLocal.map((n) => padN(n === 0 ? '·' : n, 12)).join('')}${marca}`,
    );
  }
}

// ─── Chequeo 2 · valores en los datos que el código no contempla ─────────────
console.log('');
console.log(C.neg('2 · VALORES EN LOS DATOS QUE LA LISTA DEL CÓDIGO NO TIENE'));
console.log(C.gris('   Este es el que rompe en silencio: el código ni los contempla.'));
const huerfanos = [];
for (const [lista, valores] of Object.entries(LISTAS)) {
  const permitidos = new Set([...valores, '(vacío)']);
  for (const f of filas.filter((x) => x.lista === lista && !permitidos.has(x.valor))) {
    huerfanos.push({ ...f });
  }
}
if (huerfanos.length === 0) console.log(C.verde('   ✓ ninguno: los datos no usan un valor que el código desconozca'));
for (const h of huerfanos) {
  console.log(C.rojo(`   ${pad(h.lista, 24)} ${pad(h.valor, 22)} ${pad(h.local, 10)} ${h.n} filas`));
}

// ─── Chequeo 3 · los cuatro vocabularios que se cruzan ───────────────────────
console.log('');
console.log(C.neg('3 · LOS VOCABULARIOS QUE SE TIENEN QUE CRUZAR'));
console.log(C.gris('   cocina_productos.familia_stock → categoriaDeLote() → cocina_lotes_produccion.categoria'));
console.log(C.gris('   Este es el cruce que dejó "🥖 Panes" sin una fecha durante tres meses.'));
console.log('');
console.log(C.gris(`   ${pad('familia del producto', 22)}${pad('busca lotes de', 18)}${padN('lotes', 8)}`));
const catLotes = new Set(lotes.map((l) => l.categoria));
let sinLotes = 0;
for (const fam of LISTAS.FAMILIAS_STOCK) {
  const destino = PUENTE_LOTE[fam] ?? fam;
  const n = lotes.filter((l) => l.categoria === destino).reduce((a, b) => a + b.n, 0);
  if (n === 0) sinLotes++;
  console.log(
    `   ${pad(fam, 22)}${pad(destino, 18)}${padN(n || '—', 8)}` +
      (destino !== fam ? C.amar('   ← traducido por el puente') : '') +
      (n === 0 ? C.amar('   ⚠ ni un lote: la sección va a salir vacía') : ''),
  );
}
const sinFamilia = [...catLotes].filter(
  (t) => t !== '(vacío)' && !LISTAS.FAMILIAS_STOCK.some((f) => (PUENTE_LOTE[f] ?? f) === t),
);
if (sinFamilia.length) {
  console.log('');
  console.log(C.amar(`   ⚠ categorías de lote que NINGUNA familia produce: ${sinFamilia.join(' · ')}`));
  console.log(C.gris('     Son lotes que ninguna sección de Stock va a encontrar.'));
}

// ─── Chequeo 4 · los pisos de margen ─────────────────────────────────────────
console.log('');
console.log(C.neg('4 · PISOS DE MARGEN — productos_costeo_config'));
console.log(C.gris('   El semáforo busca por CAJÓN (cajonComercial). Lo que no coincide, cae al default.'));
console.log('');
const porCajon = new Map(cajones.map((c) => [c.cajon, c]));
const cfgPorCat = new Map(cfg.map((c) => [c.categoria, c]));
console.log(
  C.gris(`   ${pad('cajón', 18)}${padN('piso', 7)}${padN('franja', 8)}${padN('verde desde', 13)}${padN('con precio', 12)}`),
);
const sobran = [];
for (const c of cfg) {
  const uso = porCajon.get(c.categoria);
  const esDefault = c.categoria === 'default';
  const n = uso?.con_precio ?? 0;
  if (!esDefault && n === 0) sobran.push(c.categoria);
  console.log(
    `   ${pad(c.categoria, 18)}${padN((c.piso * 100).toFixed(0) + '%', 7)}${padN((c.franja * 100).toFixed(0) + '%', 8)}` +
      `${padN(((c.piso + c.franja) * 100).toFixed(0) + '%', 13)}${padN(esDefault ? '—' : n || '·', 12)}` +
      (esDefault ? C.gris('   el que agarra a los que no tienen fila') : n === 0 ? C.amar('   ⚠ no aplica a ningún plato') : ''),
  );
}
const faltan = cajones.filter((c) => c.con_precio > 0 && !cfgPorCat.has(c.cajon));
if (faltan.length) {
  console.log('');
  console.log(C.amar('   ⚠ CAJONES CON PLATOS A LA VENTA Y SIN PISO PROPIO — caen al default:'));
  for (const f of faltan) {
    console.log(C.amar(`     ${pad(f.cajon, 18)} ${padN(f.con_precio, 4)} platos con precio`));
  }
}

console.log('');
if (huerfanos.length) {
  console.log(C.rojo(`⛔ ${huerfanos.length} valor(es) en los datos que el código no contempla.`));
  process.exit(1);
}
console.log(
  C.gris(
    `Sin valores desconocidos. ${vaciasEnAlgunLocal} valor(es) que la pantalla ofrece sin una sola fila, ${sinLotes} familia(s) sin lotes y ${sobran.length + faltan.length} desajuste(s) de piso: listas para decidir, no errores.`,
  ),
);
