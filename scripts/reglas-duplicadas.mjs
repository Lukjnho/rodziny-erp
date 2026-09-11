#!/usr/bin/env node
// Busca la MISMA REGLA DE NEGOCIO escrita en más de un archivo.
//
// 💣 Por qué no alcanza con el grafo. graphify ve imports: si A importa B, hay
// flecha. Pero una copia, justamente por ser copia, NO importa a su original —
// por eso no hay flecha y el mapa no la ve. La mitad de nuestros bugs tiene esa
// forma exacta:
//
//   · 'mercadopago lucas' escrito en 4 archivos que no se conocen entre sí
//   · la conversión de subreceta copiada en 3 motores de costeo
//   · `costo_empaque` sumado a mano en 2 hooks de Productos
//   · 21/121 y 0.21 repartidos entre el EdR y la configuración
//
// 💣 Y por qué tampoco alcanza jscpd (el detector de clones estándar). jscpd
// busca BLOQUES copiados de N tokens para arriba. De los cuatro casos de arriba
// encontraría uno solo (la conversión de subreceta); los otros tres son UN
// literal repetido, que para jscpd no es un clon. Lo que nos rompe no es el
// copy-paste grande: es la misma palabra escrita en cinco lugares.
//
// Entonces esto busca otra cosa: **literales de negocio y constantes mágicas que
// aparecen en más de un archivo.** Es tosco a propósito. No prueba que haya un
// bug; dice dónde mirar.
//
//     npm run reglas              # el informe
//     npm run reglas -- --todo    # sin el corte de ruido, para auditar
//
// Al arreglar una duplicación, lo que tiene que bajar es el número de ARCHIVOS
// donde aparece el literal — no el total de líneas.

import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAIZ = process.cwd();
const VER_TODO = process.argv.includes('--todo');

const CARPETAS = ['src', 'supabase/functions', 'supabase/migrations'];
const EXTENSIONES = ['.ts', '.tsx', '.sql'];
const IGNORAR_ARCHIVO = [/\.test\.tsx?$/, /\/esquema-aplicado\.sql$/];

// El vocabulario del negocio. Un literal solo se reporta si nombra alguna de
// estas cosas — sin esto el informe es una lista de clases de Tailwind.
// Agregar una palabra acá es cómo se amplía la red.
const NEGOCIO = new RegExp(
  [
    // plata y medios de pago
    'lucas|dividendo|mercadopago|mp_lucas|efectivo|transferencia|debito|credito|posnet|arqueo|cheque',
    // fiscal y finanzas
    'iva|arca|fiscal|f931|cuit|neto|bruto|margen|markup|comision|retencion|aguinaldo|sueldo|presentismo',
    // ventas
    'ticket|comanda|cortesia|mostrador|salon|mesa|canal|vianda|congelad|combo',
    // cocina y stock
    'packaging|receta|subreceta|insumo|lote|masa|relleno|pasta|salsa|merma|conteo|traspaso|camara|porcion|rinde|rendimiento',
    // lugares y estados
    'vedia|saavedra|consolidado|cancelada|eliminada|anulada|pendiente|cerrada|aprobado|conciliad',
    // unidades (el problema de vocabulario de siempre)
    'unid\\.|kg|gramos|bulto|paquete',
  ].join('|'),
  'i',
);

// Clases de Tailwind y similares: se descartan aunque nombren algo del negocio.
const PARECE_CSS =
  /(^|\s)(flex|grid|hidden|block|inline|absolute|relative|truncate|items-|justify-|text-|bg-|border|rounded|p[xytblr]?-|m[xytblr]?-|w-|h-|gap-|space-|shadow|hover:|focus:|sm:|md:|lg:|xl:|dark:)/;

// ── Nombres de tabla y de columna ───────────────────────────────────────────
// Que `pagos_sueldos` aparezca en 9 archivos no es una regla duplicada: es una
// tabla, y cada pantalla que la consulta tiene que nombrarla. Lo que sí importa
// es el snake_case que NO es del esquema — `camara_congelado`, `mp_lucas`,
// `transferencia_mp` — porque ésos son VALORES escritos a mano en vez de salir
// de un catálogo. Se sacan de la foto del esquema real, leyendo solo la
// posición de definición (nombre de tabla y primera palabra de cada renglón),
// así un valor que aparezca dentro de un CHECK no se confunde con una columna.
const ESQUEMA = new Set();
try {
  const dump = readFileSync(join(RAIZ, 'supabase/esquema-aplicado.sql'), 'utf8');
  let dentro = false;
  for (const linea of dump.split('\n')) {
    const tabla = linea.match(/^\s*create\s+(?:table|view|materialized\s+view)\s+(?:public\.)?([a-z_][a-z0-9_]*)/i);
    if (tabla) {
      ESQUEMA.add(tabla[1].toLowerCase());
      dentro = linea.includes('(');
      continue;
    }
    if (dentro) {
      if (/^\s*\)/.test(linea)) { dentro = false; continue; }
      const col = linea.match(/^\s{2,}([a-z_][a-z0-9_]*)\s/i);
      if (col) ESQUEMA.add(col[1].toLowerCase());
    }
  }
} catch {
  console.log('⚠️  No encontré supabase/esquema-aplicado.sql: los nombres de tabla van a aparecer como si fueran reglas.');
}

const ARCHIVOS = [];
function recorrer(dir) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entradas) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) recorrer(p);
    else if (EXTENSIONES.some((x) => p.endsWith(x))) {
      const rel = relative(RAIZ, p).split(sep).join('/');
      if (!IGNORAR_ARCHIVO.some((r) => r.test('/' + rel))) ARCHIVOS.push(rel);
    }
  }
}
for (const c of CARPETAS) recorrer(join(RAIZ, c));

/** Saca comentarios para no contar lo que está escrito en prosa. */
function sinComentarios(txt, esSql) {
  let t = txt.replace(/\/\*[\s\S]*?\*\//g, ' ');
  t = t.replace(esSql ? /--[^\n]*/g : /\/\/[^\n]*/g, ' ');
  return t;
}

const literales = new Map(); // valor → Map(archivo → veces)
const numeros = new Map();

function anotar(mapa, clave, archivo) {
  if (!mapa.has(clave)) mapa.set(clave, new Map());
  const m = mapa.get(clave);
  m.set(archivo, (m.get(archivo) ?? 0) + 1);
}

for (const archivo of ARCHIVOS) {
  const esSql = archivo.endsWith('.sql');
  const crudo = readFileSync(join(RAIZ, archivo), 'utf8');
  const txt = sinComentarios(crudo, esSql);

  // ── Literales de texto ───────────────────────────────────────────────────
  // SQL usa comillas simples; TS usa simples, dobles y backticks sin ${}.
  const patrones = esSql
    ? [/'((?:[^'\\]|\\.|'')*)'/g]
    : [/'((?:[^'\\\n])*)'/g, /"((?:[^"\\\n])*)"/g, /`([^`$\\\n]*)`/g];

  for (const re of patrones) {
    for (const m of txt.matchAll(re)) {
      const v = m[1].trim();
      if (v.length < 3 || v.length > 80) continue;
      if (v.includes('/') || v.startsWith('@')) continue; // rutas e imports
      if (PARECE_CSS.test(v)) continue;
      if (!NEGOCIO.test(v)) continue;
      anotar(literales, v.toLowerCase(), archivo);
    }
  }

  // ── Constantes mágicas ───────────────────────────────────────────────────
  // Decimales (0.21, 1.21, 0.62) y enteros de 3+ cifras que no sean años ni
  // códigos HTTP. Los 0, 1, 2, 10 y 100 se ignoran: son de programar, no de
  // negocio.
  //
  // 💣 Se buscan FUERA de las comillas. Adentro viven los tonos de Tailwind
  // (`text-gray-700`, `bg-red-600`), que son 1.295 apariciones de "700" en 115
  // archivos y tapaban por completo la lista: una alícuota que aparece en tres
  // lugares quedaba en el puesto 40.
  const sinTextos = txt.replace(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g, ' ');
  for (const m of sinTextos.matchAll(/(?<![\w.-])(\d+\.\d+|\d{3,})(?![\w.])/g)) {
    const v = m[1];
    const n = Number(v);
    if (!isFinite(n)) continue;
    if (Number.isInteger(n) && (n < 100 || (n >= 1900 && n <= 2100) || [200, 201, 204, 400, 401, 403, 404, 409, 422, 500].includes(n))) continue;
    if (['0.0', '1.0', '0.5', '100.0'].includes(v)) continue;
    anotar(numeros, v, archivo);
  }
}

function aFilas(mapa, minArchivos) {
  return [...mapa.entries()]
    .map(([valor, porArchivo]) => ({
      valor,
      archivos: [...porArchivo.keys()],
      veces: [...porArchivo.values()].reduce((a, b) => a + b, 0),
    }))
    .filter((f) => f.archivos.length >= minArchivos)
    .sort((a, b) => b.archivos.length - a.archivos.length || b.veces - a.veces);
}

function listar(titulo, nota, filas, tope) {
  console.log(`\n${'═'.repeat(78)}\n${titulo}  —  ${filas.length}\n${'═'.repeat(78)}`);
  if (nota) console.log(nota);
  const mostrar = VER_TODO ? filas : filas.slice(0, tope);
  for (const f of mostrar) {
    console.log(`\n  ${f.archivos.length} archivos · ${f.veces} veces   «${f.valor}»`);
    for (const a of f.archivos.slice(0, VER_TODO ? 99 : 6)) console.log(`      ${a}`);
    if (!VER_TODO && f.archivos.length > 6) console.log(`      … y ${f.archivos.length - 6} más`);
  }
  if (!VER_TODO && filas.length > mostrar.length) {
    console.log(`\n  … y ${filas.length - mostrar.length} más. Corré con --todo para verlas.`);
  }
}

console.log(`Revisados ${ARCHIVOS.length} archivos en ${CARPETAS.join(', ')}`);

// Un literal de UNA sola palabra ('vedia', 'pasta', 'efectivo') es un valor del
// dominio: que esté en 130 archivos es normal, son los dos locales. Lo que
// delata una regla COPIADA es la frase: 'mercadopago lucas', 'sin especificar',
// 'Packaging De Vianda'. Por eso van separadas y el corte es distinto.
const todas = aFilas(literales, 2);
const esEsquema = (v) => ESQUEMA.has(v) || v.split('.').every((p) => ESQUEMA.has(p));
const frases = todas.filter((f) => /[\s_]/.test(f.valor) && !esEsquema(f.valor));
const sueltos = todas.filter(
  (f) => !/[\s_]/.test(f.valor) && !esEsquema(f.valor) && f.archivos.length >= 8,
);

listar(
  'FRASES DE NEGOCIO EN 2+ ARCHIVOS  (acá viven las reglas copiadas)',
  '  Una misma frase en varios archivos que no se importan entre sí es, casi\n' +
    '  siempre, la misma decisión escrita dos veces.',
  frases,
  30,
);

listar(
  'VALORES DEL DOMINIO EN 8+ ARCHIVOS  (esperable, pero conviene mirarlos)',
  "  Una sola palabra: 'vedia', 'pasta', 'efectivo'. Que estén repartidos es\n" +
    '  normal — son los valores con los que trabaja el ERP. Vale la pena cuando\n' +
    '  el valor debería salir de un catálogo y no estar escrito a mano.',
  sueltos,
  12,
);

const nums = aFilas(numeros, 3);
listar(
  'CONSTANTES MÁGICAS EN 3+ ARCHIVOS',
  '  Un número con decimales o de tres cifras para arriba, repetido. Suele ser\n' +
    '  una alícuota, un rinde o un precio que alguien fijó y después copió.',
  nums,
  15,
);

console.log(`\n${'─'.repeat(78)}`);
console.log(
  `TOTAL: ${frases.length} frases de negocio repetidas, ${sueltos.length} valores muy repartidos, ` +
    `${nums.length} constantes.`,
);
console.log('Esto no prueba que haya un bug: dice dónde mirar. La métrica que tiene');
console.log('que bajar es la cantidad de ARCHIVOS por regla, no el total de líneas.');
console.log(`${'─'.repeat(78)}\n`);
