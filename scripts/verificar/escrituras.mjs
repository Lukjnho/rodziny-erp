/**
 * ¿Qué escrituras a la base no cuentan las filas que tocaron?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Un UPDATE o un DELETE que la RLS bloquea devuelve CERO FILAS Y NINGÚN ERROR.
 * Compila, corre, no falla, y no hace nada. La pantalla se refresca como si
 * hubiera funcionado.
 *
 * Mordió tres veces, y las tres costaron plata o confianza:
 *   · el candado de local que no se borraba;
 *   · el sync de sueldos que pisaba el comprobante;
 *   · el aviso entre ventanas de Caja que nunca llegaba.
 *
 * La regla está escrita en CLAUDE.md desde entonces. Este comando es esa regla
 * hecha número, porque una regla que no se mide no se cumple.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ CUENTA COMO "CUENTA LAS FILAS"
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * El patrón aceptado en este repo es pedirle a PostgREST las filas afectadas y
 * mirar cuántas volvieron:
 *
 *     const { data, error } = await supabase
 *       .from('cocina_productos').update({ activo }).eq('id', id)
 *       .select('id');                                  ← esto
 *     if (!data || data.length === 0) throw new Error('No se guardó: …');
 *
 * También vale `{ count: 'exact' }`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Escrituras dentro de funciones de la base (RPC): las ve como una llamada
 *     y no puede mirar adentro.
 *   · Si la tabla tiene RLS restrictiva o no: eso exigiría credenciales y este
 *     comando corre en CI sin ninguna. Reporta TODAS las escrituras a ciegas,
 *     y varias van a ser inofensivas.
 *   · Si el `.length` que encuentra cerca es realmente del resultado de esa
 *     escritura. Por eso hay dos cajones y no uno.
 *   · INSERT: un insert bloqueado por RLS **sí** devuelve error (42501). No es
 *     el modo de falla silencioso y queda afuera a propósito.
 *
 * Sale con 1 si el número sube respecto de la línea de base.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { C, titulo, universo, testigos, pad, padN } from './_comun.mjs';

// La línea de base: medida el 11-sep-2026 sobre el repo entero.
// Baja cuando alguien arregla una. NUNCA sube sin discutirlo.
const BASE_A_CIEGAS = 160;

const RAIZ = 'src';
const CHAIN = /\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/g;

function archivos(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** Desde el `.from(` hasta el `;` que cierra la sentencia (tope: 900 caracteres). */
function cadenaDesde(txt, i) {
  const fin = txt.indexOf(';', i);
  return txt.slice(i, fin === -1 || fin - i > 900 ? i + 900 : fin + 1);
}

const hallazgos = [];
const lista = archivos(RAIZ);

for (const ruta of lista) {
  const txt = readFileSync(ruta, 'utf8');
  const nl = [];
  for (let k = 0; k < txt.length; k++) if (txt[k] === '\n') nl.push(k);
  const lineaDe = (i) => nl.findIndex((p) => p > i) + 1 || nl.length + 1;

  CHAIN.lastIndex = 0;
  let m;
  while ((m = CHAIN.exec(txt)) !== null) {
    const cadena = cadenaDesde(txt, m.index);
    const op = /\.update\(/.test(cadena)
      ? 'update'
      : /\.delete\(/.test(cadena)
        ? 'delete'
        : /\.upsert\(/.test(cadena)
          ? 'upsert'
          : null;
    if (!op) continue;

    const pideFilas = /\.select\(/.test(cadena) || /count:\s*['"]exact['"]/.test(cadena);
    // ¿alguien mira cuántas volvieron? Se busca en la cadena y en lo que sigue.
    const fin = m.index + cadena.length;
    const despues = txt.slice(fin, fin + 400);
    const lasMira = /\.length|rowCount|\?\.\[0\]|\bdata\b\s*&&/.test(cadena + despues);

    hallazgos.push({
      ruta: ruta.replace(/\\/g, '/'),
      linea: lineaDe(m.index),
      tabla: m[1],
      op,
      estado: !pideFilas ? 'ciegas' : lasMira ? 'cuenta' : 'pide_no_mira',
    });
  }
}

// ── El universo, antes que cualquier número ─────────────────────────────────
titulo(
  'escrituras',
  'Toda escritura a la base tiene que contar las filas que tocó (CLAUDE.md).',
);
universo(
  `${lista.length} archivos .ts/.tsx bajo ${RAIZ}/ — se excluyen los .test.*`,
  'Solo UPDATE, DELETE y UPSERT desde el cliente. Los INSERT quedan afuera: fallan con error.',
  'No mira la base: no sabe qué tabla tiene RLS restrictiva. Corre sin credenciales.',
);

// ── Los testigos ────────────────────────────────────────────────────────────
const enArchivo = (frag, linea) =>
  hallazgos.find((h) => h.ruta.endsWith(frag) && Math.abs(h.linea - linea) <= 3);

const bueno = enArchivo('cocina/StockTab.tsx', 253);
const malo = enArchivo('rrhh/AguinaldoTab.tsx', 159);
testigos([
  {
    que: 'StockTab: el update de cocina_productos pide .select(\'id\') y mira data.length',
    espera: 'cuenta',
    obtuvo: bueno?.estado ?? 'NO LO ENCONTRÓ',
  },
  {
    que: 'AguinaldoTab:159: el update de gastos no pide nada de vuelta',
    espera: 'ciegas',
    obtuvo: malo?.estado ?? 'NO LO ENCONTRÓ',
  },
]);

// ── El reporte ───────────────────────────────────────────────────────────────
const ciegas = hallazgos.filter((h) => h.estado === 'ciegas');
const tibias = hallazgos.filter((h) => h.estado === 'pide_no_mira');
const bien = hallazgos.filter((h) => h.estado === 'cuenta');

const porTabla = new Map();
for (const h of ciegas) porTabla.set(h.tabla, (porTabla.get(h.tabla) ?? 0) + 1);
const ranking = [...porTabla].sort((a, b) => b[1] - a[1]);

console.log('');
console.log(C.neg('RESUMEN'));
console.log(`  ${padN(hallazgos.length, 4)}  escrituras en total`);
console.log(`  ${C.verde(padN(bien.length, 4))}  cuentan las filas`);
console.log(`  ${C.amar(padN(tibias.length, 4))}  piden las filas pero nadie las mira`);
console.log(`  ${C.rojo(padN(ciegas.length, 4))}  ${C.rojo('a ciegas')}`);

console.log('');
console.log(C.neg('LAS 12 TABLAS CON MÁS ESCRITURAS A CIEGAS'));
for (const [tabla, n] of ranking.slice(0, 12)) {
  console.log(`  ${padN(n, 4)}  ${tabla}`);
}

console.log('');
console.log(C.neg('A CIEGAS, UNA POR UNA') + C.gris(`  (${ciegas.length})`));
for (const h of ciegas.sort((a, b) => a.ruta.localeCompare(b.ruta) || a.linea - b.linea)) {
  console.log(`  ${pad(h.ruta + ':' + h.linea, 62)} ${pad(h.op, 7)} ${h.tabla}`);
}

if (process.argv.includes('--todo')) {
  console.log('');
  console.log(C.neg('LAS QUE SÍ CUENTAN') + C.gris(`  (${bien.length}) — para poder auditarlas`));
  for (const h of bien) console.log(`  ${pad(h.ruta + ':' + h.linea, 62)} ${pad(h.op, 7)} ${h.tabla}`);
}

if (tibias.length) {
  console.log('');
  console.log(C.neg('PIDEN LAS FILAS Y NO LAS MIRAN') + C.gris('  (revisar a mano)'));
  for (const h of tibias) console.log(`  ${pad(h.ruta + ':' + h.linea, 62)} ${pad(h.op, 7)} ${h.tabla}`);
}

console.log('');
if (ciegas.length > BASE_A_CIEGAS) {
  console.log(
    C.rojo(`⛔ Subió: ${ciegas.length} a ciegas, la línea de base es ${BASE_A_CIEGAS}.`),
  );
  console.log(C.gris('   Una escritura nueva tiene que contar sus filas. Ver CLAUDE.md.'));
  process.exit(1);
}
if (ciegas.length < BASE_A_CIEGAS) {
  console.log(
    C.verde(`✓ Bajó a ${ciegas.length} (la base era ${BASE_A_CIEGAS}). Actualizá BASE_A_CIEGAS.`),
  );
} else {
  console.log(C.gris(`Sin cambios: ${ciegas.length}, igual que la línea de base.`));
}
