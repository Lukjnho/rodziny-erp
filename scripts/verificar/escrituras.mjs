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
const BASE_A_CIEGAS = 82;

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

/**
 * Tapa los comentarios con espacios, dejando las posiciones intactas para que
 * los números de línea sigan siendo los de verdad.
 *
 * 💣 Hace falta: el ejemplo de uso que está en el comentario de cabecera de
 * `src/lib/escribir.ts` se contaba como una escritura más. Un comando que
 * cuenta comentarios miente con la misma seguridad que si contara código.
 */
const BARRA_INVERTIDA = String.fromCharCode(92);
const SALTO = String.fromCharCode(10);

function taparComentarios(txt) {
  const out = txt.split('');
  let i = 0;
  let comilla = null; // ' " o `  mientras estamos adentro de un texto
  while (i < txt.length) {
    const c = txt[i];
    if (comilla) {
      if (c === BARRA_INVERTIDA) { i += 2; continue; } // escape: se salta el par
      if (c === comilla) comilla = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { comilla = c; i++; continue; }
    if (c === '/' && txt[i + 1] === '/') {
      while (i < txt.length && txt[i] !== SALTO) { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && txt[i + 1] === '*') {
      while (i < txt.length && !(txt[i] === '*' && txt[i + 1] === '/')) {
        if (txt[i] !== SALTO) out[i] = ' ';
        i++;
      }
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Desde el `.from(` hasta el `;` que cierra la sentencia (tope: 900 caracteres). */
function cadenaDesde(txt, i) {
  const fin = txt.indexOf(';', i);
  return txt.slice(i, fin === -1 || fin - i > 900 ? i + 900 : fin + 1);
}

/**
 * Clasifica las escrituras de UN texto. Es una función y no un bucle suelto
 * para que los testigos le puedan dar código escrito a mano.
 */
function escanear(fuente, ruta = 'testigo') {
  const hallazgos = [];
  const txt = taparComentarios(fuente);
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

    // ¿Está envuelta en el helper? El `.select()` lo pone `guardarContando`, así
    // que la cadena no lo tiene: hay que mirar lo que viene ANTES del .from(.
    const antes = txt.slice(Math.max(0, m.index - 140), m.index);
    const usaHelper = /guardarContando\s*\(\s*$/.test(antes.replace(/\s+$/, ' ').replace(/supabase\s*$/, ''))
      || /guardarContando\s*\([^;]*$/.test(antes);

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
      estado: usaHelper ? 'helper' : !pideFilas ? 'ciegas' : lasMira ? 'cuenta' : 'pide_no_mira',
    });
  }
  return hallazgos;
}

const lista = archivos(RAIZ);
const hallazgos = lista.flatMap((ruta) => escanear(readFileSync(ruta, 'utf8'), ruta));

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
//
// 💣 Todos SINTÉTICOS, a propósito. Los primeros nombraban un archivo y una
// línea ("AguinaldoTab:159 está a ciegas") y se pusieron rojos apenas se
// arregló esa línea. Un testigo que se rompe cuando el problema se resuelve
// obliga a editarlo cada vez, y el día que se rompa de verdad nadie lo mira.
//
// Estos prueban el CLASIFICADOR con código escrito a mano: valen igual el día
// que las 153 estén migradas.
const EJEMPLOS = {
  ciegas: "await supabase.from('gastos').update({ cancelado: true }).eq('id', x);",
  cuenta:
    "const { data } = await supabase.from('gastos').update(v).eq('id', x).select('id'); if (!data || data.length === 0) throw new Error('no');",
  pide_no_mira: "await supabase.from('gastos').delete().eq('id', x).select('id');",
  helper: "await guardarContando(supabase.from('gastos').update(v).eq('id', x), 'mensaje');",
};
const clasifica = (fuente) => escanear(fuente)[0]?.estado ?? 'NO ENCONTRÓ NINGUNA';

testigos([
  {
    que: 'Un update pelado, sin pedir nada de vuelta, es "a ciegas"',
    espera: 'ciegas',
    obtuvo: clasifica(EJEMPLOS.ciegas),
  },
  {
    que: 'El patrón viejo de la casa (.select + data.length) es "cuenta"',
    espera: 'cuenta',
    obtuvo: clasifica(EJEMPLOS.cuenta),
  },
  {
    que: 'Pedir las filas y no mirarlas NO cuenta como contar',
    espera: 'pide_no_mira',
    obtuvo: clasifica(EJEMPLOS.pide_no_mira),
  },
  {
    que: 'Envuelta en guardarContando() es "helper", aunque no tenga .select()',
    espera: 'helper',
    obtuvo: clasifica(EJEMPLOS.helper),
  },
  {
    que: 'Un SELECT no es una escritura',
    espera: 0,
    obtuvo: escanear("const { data } = await supabase.from('gastos').select('id');").length,
  },
  {
    que: 'Una escritura comentada no cuenta',
    espera: 0,
    obtuvo: escanear('// ' + EJEMPLOS.ciegas).length,
  },
  {
    que: 'Tapar comentarios no se come una URL adentro de un texto',
    espera: 'https://ok',
    obtuvo: taparComentarios("const u = 'https://ok'; // un comentario").match(/'([^']+)'/)?.[1],
  },
]);

// ── El reporte ───────────────────────────────────────────────────────────────
const ciegas = hallazgos.filter((h) => h.estado === 'ciegas');
const tibias = hallazgos.filter((h) => h.estado === 'pide_no_mira');
const bien = hallazgos.filter((h) => h.estado === 'cuenta');
const conElHelper = hallazgos.filter((h) => h.estado === 'helper');

const porTabla = new Map();
for (const h of ciegas) porTabla.set(h.tabla, (porTabla.get(h.tabla) ?? 0) + 1);
const ranking = [...porTabla].sort((a, b) => b[1] - a[1]);

console.log('');
console.log(C.neg('RESUMEN'));
console.log(`  ${padN(hallazgos.length, 4)}  escrituras en total`);
console.log(`  ${C.verde(padN(conElHelper.length, 4))}  usan guardarContando() ${C.gris('— la forma nueva: el .select() no se puede olvidar')}`);
console.log(`  ${C.verde(padN(bien.length, 4))}  cuentan las filas a mano ${C.gris('— andan bien; migrar cuando se toque el archivo')}`);
console.log(`  ${C.amar(padN(tibias.length, 4))}  piden las filas pero nadie las mira`);
console.log(`  ${C.rojo(padN(ciegas.length, 4))}  ${C.rojo('a ciegas')}`);

console.log('');
const sinHelper = hallazgos.length - conElHelper.length;
console.log(
  `  ${C.gris('→')} ${C.neg(sinHelper)} escrituras todavía NO usan el helper (${((conElHelper.length / hallazgos.length) * 100).toFixed(0)} % migrado)`,
);

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
