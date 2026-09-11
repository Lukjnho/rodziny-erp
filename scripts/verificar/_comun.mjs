/**
 * Lo que comparten todos los comandos del arnés.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LAS DOS OBLIGACIONES DE CADA COMANDO
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 1 · DECLARAR EL UNIVERSO. En la primera línea de la salida, en castellano:
 *     qué mira y con qué filtros. Si el comando mira un universo distinto del
 *     que mira producción, el número que devuelve es otro número.
 *
 *     💣 Pasó el 11-sep-2026: una medición de costeo cargó TODAS las recetas y
 *     producción carga solo las activas. Seis pares de recetas se llaman igual
 *     salvo por una mayúscula, el motor las resuelve por nombre normalizado, y
 *     el Cheesecake dio $15.503 cuando son $17.079.
 *
 * 2 · UN CASO TESTIGO CON RESPUESTA CONOCIDA. Si el testigo falla, el comando
 *     NO reporta: aborta. Un arnés que se equivoca en silencio es peor que no
 *     tener arnés, porque lo que dice se cree.
 *
 *     💣 Pasó el mismo día: la deducción del bulto daba 1.426 para las
 *     servilletas, que vienen de a 1.000 y estaba cargado a mano. Las dos
 *     únicas filas con respuesta conocida eran justo las dos que iba a pisar.
 */

import { readFileSync, existsSync } from 'node:fs';

// ─── Salida ──────────────────────────────────────────────────────────────────

export const C = {
  gris: (s) => `\x1b[90m${s}\x1b[0m`,
  rojo: (s) => `\x1b[31m${s}\x1b[0m`,
  amar: (s) => `\x1b[33m${s}\x1b[0m`,
  verde: (s) => `\x1b[32m${s}\x1b[0m`,
  neg: (s) => `\x1b[1m${s}\x1b[0m`,
};

export function titulo(nombre, unaLinea) {
  console.log('');
  console.log(C.neg(`━━━ ${nombre} ━━━`));
  console.log(C.gris(unaLinea));
}

/** La obligación 1. `lineas` son frases, no claves técnicas. */
export function universo(...lineas) {
  console.log('');
  console.log(C.neg('UNIVERSO'));
  for (const l of lineas) console.log('  ' + l);
}

/**
 * La obligación 2. Cada testigo es `{ que, espera, obtuvo }`.
 * Si alguno falla, tira: el comando no llega a reportar nada.
 */
export function testigos(lista) {
  console.log('');
  console.log(C.neg('TESTIGOS') + C.gris('  (respuesta conocida de antemano)'));
  let fallo = 0;
  for (const t of lista) {
    const ok = String(t.obtuvo) === String(t.espera);
    if (!ok) fallo++;
    console.log(
      `  ${ok ? C.verde('✓') : C.rojo('✗')} ${t.que}` +
        (ok ? C.gris(`  → ${t.obtuvo}`) : C.rojo(`  esperaba ${t.espera}, dio ${t.obtuvo}`)),
    );
  }
  if (fallo > 0) {
    console.log('');
    console.log(C.rojo(`⛔ ${fallo} testigo(s) fallaron. El comando no reporta nada.`));
    console.log(C.gris('   Si el testigo está mal, corregilo. Si el método está mal, arreglalo.'));
    console.log(C.gris('   Lo que NO se hace es creerle a la salida.'));
    process.exit(2);
  }
}

// ─── Números en castellano ───────────────────────────────────────────────────

export const plata = (n) =>
  n == null
    ? '—'
    : '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const veces = (n) => (n == null ? '—' : Number(n).toFixed(2).replace('.', ',') + '×');
export const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
export const padN = (s, n) => String(s ?? '').padStart(n);

// ─── La base ─────────────────────────────────────────────────────────────────

function leerEnvLocal() {
  if (!existsSync('.env.local')) return {};
  return Object.fromEntries(
    readFileSync('.env.local', 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

/** El ref del proyecto sale de la URL de Supabase: no se escribe a mano. */
export function refDelProyecto() {
  const env = leerEnvLocal();
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!m) {
    console.error(C.rojo('No pude sacar el proyecto de VITE_SUPABASE_URL (.env.local).'));
    process.exit(2);
  }
  return m[1];
}

/**
 * Consulta de solo lectura por la Management API.
 *
 * 💣 Por qué no la clave anon: devuelve el costeo incompleto (margen_seguridad
 * en 0, comisión en 0, cero precios de canal) y no ve `gastos`. Un comando que
 * mide plata con la clave anon mide otra cosa.
 *
 * El token NO vive en el repo. Sale de SUPABASE_ACCESS_TOKEN (la misma variable
 * que usa el CLI de Supabase).
 */
export async function consultar(sql) {
  const env = leerEnvLocal();
  const token = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error('');
    console.error(C.amar('Este comando necesita leer la base y no hay token.'));
    console.error(C.gris('  export SUPABASE_ACCESS_TOKEN=sbp_...    (el mismo del CLI de Supabase)'));
    console.error(C.gris('  o agregarlo como una línea más en .env.local (que no se versiona).'));
    console.error(C.gris('  Por eso este comando va a mano y no en CI.'));
    process.exit(2);
  }
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${refDelProyecto()}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!r.ok) {
    console.error(C.rojo(`La base devolvió HTTP ${r.status}`));
    console.error(C.gris((await r.text()).slice(0, 500)));
    process.exit(2);
  }
  return r.json();
}
