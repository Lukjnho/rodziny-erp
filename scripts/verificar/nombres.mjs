/**
 * ¿Hay dos recetas que el motor de costeo ve como una sola?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Un renglón de receta engancha su subreceta POR NOMBRE. El motor normaliza —
 * minúsculas, sin el prefijo "Subreceta ", espacios colapsados — y se queda con
 * LA PRIMERA que encuentra.
 *
 * La base, en cambio, tiene un índice único `(nombre, local)` que es sensible a
 * mayúsculas: para Postgres `Torta matilda` y `Torta Matilda` son dos nombres
 * distintos. Para el motor son el mismo. **Esa es toda la grieta.**
 *
 * Y la consulta que carga las recetas no tiene `order by`, así que cuál gana
 * puede cambiar entre una carga de página y la siguiente.
 *
 * 💣 Ya mordió: una medición de costeo cargó todas las recetas (producción
 * carga solo las activas) y el Cheesecake dio $15.503 cuando son $17.079.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LOS CUATRO CAJONES, DE PEOR A MEJOR
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   🔴 DOS SUBRECETAS ACTIVAS  el motor busca subrecetas en un índice aparte:
 *                              acá las dos entran y gana la primera. Rompe hoy.
 *   🟠 dos recetas activas     si ninguna es subreceta, el renglón las busca en
 *                              el índice general. Hoy no rompe porque todos los
 *                              renglones llevan el prefijo "Subreceta " y una
 *                              sola de las dos es subreceta — pero eso es una
 *                              casualidad, no una garantía.
 *   🟡 activa + apagada        producción filtra `activo = true` y no las ve.
 *                              Cualquier medición que cargue todas, sí.
 *   ⚪ las dos apagadas        no molestan. Igual bloquean el índice único.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · El nombre SIMPLIFICADO. El motor tiene un segundo índice de respaldo que
 *     saca los paréntesis y los tamaños: ahí `Torta matilda` y
 *     `Torta matilda (PORCION)` también chocan. No se puede hacer único sin
 *     prohibir las variantes (PACK)/(VIANDA), que es el modelo que se quiere.
 *   · Choques entre locales distintos: son legítimos y están permitidos.
 *   · Si las dos son de verdad la misma receta o dos cosas distintas.
 *
 * Sale con 1 si hay dos SUBRECETAS ACTIVAS con el mismo nombre normalizado.
 */

import { C, titulo, universo, testigos, consultar, pad, padN } from './_comun.mjs';

// El mismo normalizado que `normalizarNombre` en costeoEngine.ts.
const NORM = `regexp_replace(regexp_replace(lower(btrim(nombre)), '^subreceta\\s+', ''), '\\s+', ' ', 'g')`;

const recetas = await consultar(`
  with n as (select id, nombre, local, tipo, activo, ${NORM} as norm from cocina_recetas),
       pares as (select norm, local from n group by norm, local having count(*) > 1)
  select n.norm, n.local,
         json_agg(json_build_object('nombre', n.nombre, 'tipo', n.tipo, 'activo', n.activo,
                                    'ingredientes', (select count(*) from cocina_receta_ingredientes i
                                                      where i.receta_id = n.id),
                                    'precios', (select count(*) from cocina_recetas_precios_canal pc
                                                 where pc.receta_id = n.id))
                 order by n.activo desc, n.tipo, n.nombre) as cuales,
         count(*) filter (where n.activo and n.tipo = 'subreceta')::int as subs_activas,
         count(*) filter (where n.activo)::int as activas,
         (select count(*) from cocina_receta_ingredientes i where ${NORM.replaceAll('nombre', 'i.nombre')} = n.norm)::int as renglones
    from n join pares p on p.norm = n.norm and p.local = n.local
   group by n.norm, n.local
   order by subs_activas desc, activas desc, n.norm`);

const insumos = await consultar(`
  with n as (select nombre, local, activo, lower(btrim(nombre)) as norm from productos),
       pares as (select norm, local from n group by norm, local having count(*) > 1)
  select n.norm, n.local, count(*) filter (where n.activo)::int as activos,
         string_agg(n.nombre || (case when n.activo then '' else ' [apagado]' end), ' | ') as cuales
    from n join pares p on p.norm = n.norm and p.local = n.local
   group by n.norm, n.local order by activos desc, n.norm`);

const [{ total_recetas, total_insumos }] = await consultar(
  `select (select count(*) from cocina_recetas)::int as total_recetas,
          (select count(*) from productos)::int as total_insumos`,
);

// ─── Los testigos: del MÉTODO, no de los datos ───────────────────────────────
//
// 💣 El primer testigo de este comando nombraba un par concreto ("Torta
// matilda" / "Torta Matilda") y se puso rojo apenas se arregló ese par. Un
// testigo que se rompe cuando el problema se resuelve no sirve: hay que
// cambiarlo cada vez, y el día que haya que cambiarlo de verdad nadie lo mira.
//
// Estos dos no dependen de qué recetas existan hoy:
//   · el normalizador hace lo que dice (casos escritos a mano);
//   · una segunda consulta, escrita distinto, cuenta los mismos pares.
const [{ norm_pruebas, pares_contraste }] = await consultar(`
  select
    (select json_agg(${NORM}) from (values
        ('Torta Matilda'), ('  torta   matilda '), ('Subreceta Torta Matilda'),
        ('TORTA MATILDA')) as t(nombre)) as norm_pruebas,
    (select count(*)::int from (
       select ${NORM} as k, local from cocina_recetas
        except all
       select distinct ${NORM}, local from cocina_recetas) x) as pares_contraste`);

// ─── El universo ─────────────────────────────────────────────────────────────
titulo('nombres', 'Dos recetas que el motor ve como una sola.');
universo(
  `${total_recetas} recetas y ${total_insumos} insumos — ACTIVAS Y APAGADAS, a propósito`,
  'Una apagada no rompe hoy, pero bloquea el índice único y vuelve el día que se prenda',
  'Normalizado igual que el motor: minúsculas, sin "Subreceta ", espacios colapsados',
  'Los choques ENTRE locales no cuentan: están permitidos y son legítimos',
);

// ─── Los testigos ────────────────────────────────────────────────────────────
const busca = (norm, local) => recetas.find((r) => r.norm === norm && r.local === local);
// Cuántas recetas de más hay respecto de los nombres normalizados distintos.
const sobrantes = recetas.reduce((a, r) => a + r.cuales.length - 1, 0);
testigos([
  {
    que: 'El normalizador colapsa mayúsculas, espacios de más y el prefijo "Subreceta "',
    espera: 'torta matilda ×4',
    obtuvo: `${norm_pruebas[0]} ×${new Set(norm_pruebas).size === 1 ? norm_pruebas.length : '✗'}`,
  },
  {
    que: 'Una segunda consulta, escrita distinto, cuenta los mismos choques',
    espera: pares_contraste,
    obtuvo: sobrantes,
  },
  {
    que: 'Una receta sin gemela NO aparece en la lista',
    espera: undefined,
    obtuvo: busca('pizza de especial sg', 'saavedra')?.norm,
  },
]);

// ─── El reporte ──────────────────────────────────────────────────────────────
const cajon = (r) =>
  r.subs_activas >= 2 ? 'rojo' : r.activas >= 2 ? 'naranja' : r.activas === 1 ? 'amarillo' : 'apagadas';

for (const r of recetas) r.cajon = cajon(r);
const de = (c) => recetas.filter((r) => r.cajon === c);

console.log('');
console.log(C.neg('RESUMEN'));
console.log(`  ${C.rojo(padN(de('rojo').length, 4))}  🔴 dos SUBRECETAS activas — el motor elige la primera`);
console.log(`  ${C.amar(padN(de('naranja').length, 4))}  🟠 dos recetas activas`);
console.log(`  ${C.amar(padN(de('amarillo').length, 4))}  🟡 una activa y una apagada`);
console.log(`  ${C.gris(padN(de('apagadas').length, 4))}  ⚪ las dos apagadas`);
console.log(`  ${padN(recetas.length, 4)}  pares en total — el índice único no se puede crear hasta resolverlos`);

const ETQ = { rojo: '🔴 DOS SUBRECETAS ACTIVAS', naranja: '🟠 DOS RECETAS ACTIVAS', amarillo: '🟡 ACTIVA + APAGADA', apagadas: '⚪ LAS DOS APAGADAS' };
for (const c of ['rojo', 'naranja', 'amarillo', 'apagadas']) {
  const g = de(c);
  if (!g.length) continue;
  console.log('');
  console.log(C.neg(ETQ[c]) + C.gris(`  (${g.length})`));
  for (const r of g) {
    console.log(
      `  ${pad(r.local, 10)}${C.neg(pad(r.norm, 30))}${C.gris(`${r.renglones} renglón(es) lo nombran`)}`,
    );
    for (const x of r.cuales) {
      console.log(
        `      ${x.activo ? C.verde('●') : C.gris('○')} ${pad(x.nombre, 34)} ${pad(x.tipo, 10)}` +
          C.gris(`${padN(x.ingredientes, 3)} ing.  ${x.precios ? `${x.precios} precio(s)` : ''}`),
      );
    }
  }
}

if (insumos.length) {
  console.log('');
  console.log(C.neg('INSUMOS CON EL MISMO NOMBRE EN EL MISMO LOCAL') + C.gris(`  (${insumos.length})`));
  console.log(C.gris('  El motor también busca insumos por nombre cuando el renglón no trae producto_id.'));
  for (const i of insumos) console.log(`  ${pad(i.local, 10)} ${i.cuales}`);
} else {
  console.log('');
  console.log(C.verde('✓ Ningún insumo repite nombre dentro de su local.'));
}

console.log('');
if (de('rojo').length) {
  console.log(C.rojo(`⛔ ${de('rojo').length} par(es) de subrecetas activas: el costeo depende de cuál cargue primero.`));
  process.exit(1);
}
console.log(C.verde('✓ Ninguna subreceta activa choca con otra. Lo que queda son bombas de tiempo, no incendios.'));
