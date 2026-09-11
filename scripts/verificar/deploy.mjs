/**
 * ¿Lo que hay publicado es lo que yo creo que hay publicado?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Mirar el SHA no alcanza. Hay que mirar **el JavaScript que baja el navegador**,
 * porque lo que rompe producción es una columna borrada que el bundle publicado
 * sigue pidiendo: PostgREST devuelve HTTP 400 y la pantalla queda en error.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LAS DOS TRAMPAS, LAS DOS CAÍDAS EN CABEZA PROPIA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 💣 1 · LOS CHUNKS VIENEN COMPRIMIDOS. Con `curl` sin `--compressed` bajan los
 * bytes de gzip y `grep` no encuentra NADA — ni lo que sobra ni lo que falta.
 * Di por verificado un deploy que no había verificado.
 *
 *   → Acá lo tapa el testigo: hay literales que TIENEN que aparecer. Si no
 *     aparecen, no es que se borraron: es que estás leyendo gzip.
 *
 * 💣 2 · UNA RUTA QUE NO EXISTE DEVUELVE **200 CON EL index.html**. No 404.
 * Son 1.537 bytes que parecen "el archivo está vacío". Por eso no se mira el
 * código de estado: se mira el TAMAÑO y el contenido.
 *
 * 💣 3 · Los hashes de los chunks de Vercel NO coinciden con los del
 * `npm run build` local. Los nombres salen del index.html publicado, nunca del
 * `dist/` propio.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Si la pantalla anda. Que el literal no esté no quiere decir que el
 *     reemplazo esté bien.
 *   · Un nombre de columna armado por concatenación o guardado en una variable.
 *   · Que el deploy sea el ÚLTIMO: si hay un build en vuelo, el SHA publicado
 *     es el anterior y este comando lo va a marcar. Es correcto que lo marque.
 *
 * Sale con 1 si el SHA no coincide o si aparece un literal jubilado.
 */

import { execSync } from 'node:child_process';
import { C, titulo, universo, testigos, pad, padN } from './_comun.mjs';

const SITIO = 'https://rodziny-erp.vercel.app';

// Literales que TIENEN que estar. Son el testigo de que se está leyendo texto
// y no gzip: si estos no aparecen, la búsqueda entera no vale nada.
const DEBEN_ESTAR = ['familia_stock', 'costoBasePorKg', 'margen_colchon', 'cocina_recetas'];

// Columnas que se borraron de la base. Si alguna sigue en el bundle publicado,
// la pantalla que la pide está devolviendo HTTP 400 ahora mismo.
const NO_DEBEN_ESTAR = [
  'costo_empaque', // mig 204 — tumbó 5 pantallas el 11-sep
  'ml_por_venta', // mig 213
  'tiempo_anticipacion_hs', // mig 213
  'minutos_lote', // mig 213
  'es_packaging', // mig 213
];

const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

async function bajar(ruta) {
  const r = await fetch(SITIO + ruta);
  const texto = await r.text(); // fetch de Node descomprime solo: no hay que pedirlo
  return { status: r.status, texto, bytes: Buffer.byteLength(texto, 'utf8') };
}

const home = await bajar('/');
const inexistente = await bajar('/assets/este-archivo-no-existe-' + home.bytes + '.js');

// 💣 El index.html SOLO lista los chunks de ENTRADA. El de cada pantalla se
// carga en diferido y su nombre está adentro de otro chunk, no en el HTML.
// Buscar solo en el index deja afuera justo las pantallas de costeo, que son
// las que piden las columnas que nos importan. Por eso se sigue la cadena.
const PATRON_CHUNK = /["'`](?:\.\/|\/assets\/)([A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.js)["'`]/g;
const vistos = new Set();
const cola = [...new Set([...home.texto.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]))];
const chunks = [];
while (cola.length) {
  const nombre = cola.shift();
  if (vistos.has(nombre)) continue;
  vistos.add(nombre);
  const bajado = await bajar('/assets/' + nombre);
  // Si Vercel devolvió el index.html en vez del chunk, el archivo no existe.
  if (/<div id="root"/.test(bajado.texto)) continue;
  chunks.push({ ruta: '/assets/' + nombre, ...bajado });
  for (const m of bajado.texto.matchAll(PATRON_CHUNK)) if (!vistos.has(m[1])) cola.push(m[1]);
}
chunks.sort((a, b) => b.bytes - a.bytes);

const todoElJs = chunks.map((c) => c.texto).join('\n');
const cuenta = (lit) => (todoElJs.match(new RegExp(lit, 'g')) ?? []).length;

const publicado = JSON.parse((await bajar('/version.json')).texto).version;
const local = sh('git rev-parse main');
const sinPushear = sh('git rev-list --count origin/main..main');

// ─── El universo ─────────────────────────────────────────────────────────────
titulo('deploy', 'Lo que baja el navegador, no lo que dice el SHA.');
universo(
  `${SITIO} — ${chunks.length} chunks de JavaScript, ${(todoElJs.length / 1024).toFixed(0)} KB de texto`,
  'Los nombres salen del index.html publicado: los hashes de Vercel NO son los del build local',
  `Se buscan ${DEBEN_ESTAR.length} literales que tienen que estar y ${NO_DEBEN_ESTAR.length} que no`,
  'No mira la base ni prueba ninguna pantalla: solo qué texto contiene el bundle',
);

// ─── Los testigos ────────────────────────────────────────────────────────────
const faltanDeLosQueDeben = DEBEN_ESTAR.filter((l) => cuenta(l) === 0);
testigos([
  {
    que: 'El JS se está leyendo como TEXTO (si esto falla, estás grepeando gzip)',
    espera: 0,
    obtuvo: faltanDeLosQueDeben.length,
  },
  {
    que: 'Una ruta inexistente devuelve 200 — por eso no se mira el código de estado',
    espera: 200,
    obtuvo: inexistente.status,
  },
  {
    que: '…y lo que devuelve es el index.html, no un archivo vacío',
    espera: true,
    obtuvo: /<div id="root"/.test(inexistente.texto),
  },
  {
    que: 'Ninguno de los chunks bajados es en realidad el index.html disfrazado',
    espera: 0,
    obtuvo: chunks.filter((c) => /<div id="root"/.test(c.texto)).length,
  },
  {
    que: 'La cadena de chunks llegó hasta el de costeo (el que no está en el index.html)',
    espera: true,
    obtuvo: chunks.some((c) => /costeo/.test(c.ruta)),
  },
]);

// ─── El reporte ──────────────────────────────────────────────────────────────
console.log('');
console.log(C.neg('EL SHA'));
const coincide = publicado === local;
console.log(`  publicado (version.json)   ${publicado.slice(0, 12)}`);
console.log(`  local (git rev-parse main) ${local.slice(0, 12)}   ${coincide ? C.verde('coinciden') : C.rojo('NO COINCIDEN')}`);
console.log(`  commits sin pushear        ${sinPushear}${sinPushear !== '0' ? C.rojo('  ← tu código no está arriba') : ''}`);
if (!coincide) {
  const detras = sh(`git rev-list --count ${publicado}..${local} 2>/dev/null || echo ?`);
  console.log(C.amar(`  el publicado está ${detras} commit(s) atrás. Puede ser un build en vuelo: volvé a correrlo en un minuto.`));
}

console.log('');
console.log(C.neg('LOS CHUNKS PUBLICADOS'));
for (const c of chunks) {
  console.log(`  ${pad(c.ruta, 46)} ${padN((c.bytes / 1024).toFixed(0) + ' KB', 9)}  HTTP ${c.status}`);
}

console.log('');
console.log(C.neg('LITERALES QUE TIENEN QUE ESTAR'));
for (const l of DEBEN_ESTAR) {
  const n = cuenta(l);
  console.log(`  ${n > 0 ? C.verde('✓') : C.rojo('✗')} ${pad(l, 26)} ${padN(n, 4)} apariciones`);
}

console.log('');
console.log(C.neg('LITERALES JUBILADOS — no tienen que estar'));
const colados = [];
for (const l of NO_DEBEN_ESTAR) {
  const n = cuenta(l);
  if (n > 0) colados.push({ l, n });
  console.log(`  ${n === 0 ? C.verde('✓') : C.rojo('✗')} ${pad(l, 26)} ${padN(n, 4)} apariciones`);
}

console.log('');
if (colados.length) {
  console.log(C.rojo(`⛔ ${colados.length} literal(es) jubilado(s) siguen en el bundle publicado.`));
  console.log(C.gris('   Cada uno es una pantalla devolviendo HTTP 400 ahora mismo.'));
  process.exit(1);
}
if (!coincide) {
  console.log(C.rojo('⛔ El SHA publicado no es el de main.'));
  process.exit(1);
}
console.log(C.verde('✓ Publicado lo que corresponde, y sin una sola columna jubilada en el bundle.'));
