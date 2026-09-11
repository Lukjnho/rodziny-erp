/**
 * ¿Hay migraciones aplicadas en producción cuyo código NO está en `main`?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Vercel publica `main` y la base es UNA sola. Aplicar una migración desde una
 * rama pone el cambio en producción AL INSTANTE, corriendo contra el código
 * viejo de `main`.
 *
 * El 11-sep-2026 había 8 migraciones así. La 204 había borrado
 * `cocina_productos.costo_empaque` y el JS publicado la seguía pidiendo:
 * PostgREST devuelve HTTP 400 y la pantalla entera queda en error. Cinco
 * pantallas caídas medio día, y nadie avisó porque nadie las abrió.
 *
 * Este comando es la regla de CLAUDE.md hecha número.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CÓMO SABE SI UNA MIGRACIÓN ESTÁ APLICADA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 💣 **No le pregunta al registro de Supabase**: ese corta en la 198, porque
 * las que se aplican por la Management API no quedan anotadas ahí.
 *
 * Le pregunta A LOS OBJETOS. De cada .sql saca qué columnas, tablas, funciones,
 * disparadores e índices crea o borra, y después le pregunta a la base si están.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Las migraciones de SOLO DATOS. No crean ningún objeto: son invisibles
 *     para este método. Las cuenta aparte y lo dice.
 *   · Una función redefinida por una migración POSTERIOR hace parecer aplicada
 *     a la anterior. `create or replace` no deja huella de quién la escribió.
 *   · Cambios de tipo, de default, de check o de policy: solo mira existencia.
 *   · Si la migración se aplicó BIEN. Solo si el objeto está o no está.
 *
 * Sale con 1 si encuentra alguna huérfana.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { C, titulo, universo, testigos, consultar, pad, padN } from './_comun.mjs';

const DIR = 'supabase/migrations';

// ─── 1 · Qué declara cada .sql ───────────────────────────────────────────────

const REGLAS = [
  [/alter\s+table\s+(?:only\s+)?(?:public\.)?(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi, (m) => ['columna', `${m[1]}.${m[2]}`, true, m[1]]],
  [/alter\s+table\s+(?:only\s+)?(?:public\.)?(\w+)\s+drop\s+column\s+(?:if\s+exists\s+)?(\w+)/gi, (m) => ['columna', `${m[1]}.${m[2]}`, false, m[1]]],
  [/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi, (m) => ['tabla', m[1], true]],
  [/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi, (m) => ['tabla', m[1], false]],
  [/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)/gi, (m) => ['funcion', m[1], true]],
  [/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi, (m) => ['funcion', m[1], false]],
  [/create\s+(?:or\s+replace\s+)?trigger\s+(\w+)[\s\S]{0,240}?\son\s+(?:public\.)?(\w+)/gi, (m) => ['trigger', m[1], true, m[2]]],
  [/drop\s+trigger\s+(?:if\s+exists\s+)?(\w+)/gi, (m) => ['trigger', m[1], false]],
  [/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(\w+)\s+on\s+(?:public\.)?(\w+)/gi, (m) => ['indice', m[1], true, m[2]]],
  [/drop\s+index\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi, (m) => ['indice', m[1], false]],
];

/** Saca los comentarios: un `-- drop column x` no es una migración. */
function sinComentarios(sql) {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function objetosDe(sql) {
  const limpio = sinComentarios(sql);
  const orden = [];
  for (const [re, arma] of REGLAS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(limpio)) !== null) {
      const [clase, nombre, debeExistir, sobre] = arma(m);
      orden.push({ clase, nombre, debeExistir, sobre, pos: m.index });
    }
  }
  // Si un objeto aparece dos veces (drop + create), manda el ÚLTIMO del archivo.
  orden.sort((a, b) => a.pos - b.pos);
  const final = new Map();
  for (const o of orden) final.set(`${o.clase}|${o.nombre}`, o);
  return [...final.values()];
}

const migs = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ archivo: f, objetos: objetosDe(readFileSync(`${DIR}/${f}`, 'utf8')) }));

// ─── 2 · Qué hay de verdad en la base ────────────────────────────────────────

const [{ foto }] = await consultar(`
select json_build_object(
  'columnas', (select coalesce(json_agg(lower(table_name || '.' || column_name)), '[]'::json)
               from information_schema.columns where table_schema = 'public'),
  'tablas',   (select coalesce(json_agg(lower(table_name)), '[]'::json)
               from information_schema.tables where table_schema = 'public'),
  'funciones',(select coalesce(json_agg(distinct lower(p.proname)), '[]'::json)
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  'triggers', (select coalesce(json_agg(distinct lower(t.tgname)), '[]'::json)
               from pg_trigger t join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and not t.tgisinternal),
  'indices',  (select coalesce(json_agg(lower(indexname)), '[]'::json)
               from pg_indexes where schemaname = 'public')
) as foto
`);

const EN_BASE = {
  columna: new Set(foto.columnas),
  tabla: new Set(foto.tablas),
  funcion: new Set(foto.funciones),
  trigger: new Set(foto.triggers),
  indice: new Set(foto.indices),
};
const existe = (o) => EN_BASE[o.clase].has(o.nombre.toLowerCase());

// ─── 3 · Qué está en main ────────────────────────────────────────────────────

const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const enMain = (archivo) => sh(`git log origin/main --format=%H -1 -- "${DIR}/${archivo}"`) !== '';

// ─── 4 · El cruce ────────────────────────────────────────────────────────────

// 💣 Este método lee el estado de HOY, así que una migración que una migración
// POSTERIOR deshizo se ve igual que una que nunca se aplicó. La 209 creó el
// puente `cocina_productos.tipo` y la 211 lo retiró: la columna no está, pero
// la 209 se aplicó perfecto.
//
// Por eso de cada objeto manda el ÚLTIMO .sql que lo nombra. Una migración a la
// que no le queda ningún objeto propio quedó SUPERADA, que no es lo mismo que
// sin aplicar.
const ultimoDeclarante = new Map();
for (const m of migs) for (const o of m.objetos) ultimoDeclarante.set(`${o.clase}|${o.nombre}`, m.archivo);

// Un índice o un disparador sobre una tabla que ya no existe se fue con ella:
// no es un objeto que falte, es un objeto que dejó de tener sentido.
const sinSuTabla = (o) => o.sobre && !EN_BASE.tabla.has(o.sobre.toLowerCase());

for (const m of migs) {
  m.propios = m.objetos
    .filter((o) => ultimoDeclarante.get(`${o.clase}|${o.nombre}`) === m.archivo)
    .filter((o) => !sinSuTabla(o));
  m.total = m.propios.length;
  m.ok = m.propios.filter((o) => existe(o) === o.debeExistir).length;
  m.faltan = m.propios.filter((o) => existe(o) !== o.debeExistir);
  m.estado =
    m.objetos.length === 0
      ? 'solo_datos'
      : m.total === 0
        ? 'superada'
        : m.ok === m.total
          ? 'aplicada'
          : m.ok === 0
            ? 'sin_aplicar'
            : 'parcial';
  m.main = enMain(m.archivo);
}

// ─── El universo ─────────────────────────────────────────────────────────────
titulo('huerfanas', 'Ninguna migración se aplica si su código no está mergeado Y publicado.');
universo(
  `${migs.length} archivos en ${DIR}/ — se leen todos, viejos incluidos`,
  'Estado real: se le pregunta A LOS OBJETOS de la base, no al registro de migraciones',
  '(el registro de Supabase corta en la 198: las aplicadas por Management API no quedan anotadas)',
  '"En main" = el archivo aparece en el historial de origin/main',
);

// ─── Los testigos ────────────────────────────────────────────────────────────
const m213 = migs.find((m) => m.archivo.startsWith('213'));
testigos([
  {
    que: 'La foto de la base trae cocina_recetas.nombre',
    espera: true,
    obtuvo: EN_BASE.columna.has('cocina_recetas.nombre'),
  },
  {
    que: 'cocina_productos.costo_empaque YA NO está (la borró la 204)',
    espera: false,
    obtuvo: EN_BASE.columna.has('cocina_productos.costo_empaque'),
  },
  {
    que: 'La 213 (borró 6 columnas muertas) figura aplicada',
    espera: 'aplicada',
    obtuvo: m213?.estado ?? 'NO ESTÁ',
  },
  {
    que: 'La 209 (creó el puente que la 211 retiró) figura superada, no sin aplicar',
    espera: 'superada',
    obtuvo: migs.find((m) => m.archivo.startsWith('209'))?.estado ?? 'NO ESTÁ',
  },
  {
    que: 'La 100 no reclama el índice de correo_remitentes: la 178 borró esa tabla',
    espera: 'aplicada',
    obtuvo: migs.find((m) => m.archivo.startsWith('100'))?.estado ?? 'NO ESTÁ',
  },
  {
    que: 'La 026 (tabla que borró la 042) figura superada, no sin aplicar',
    espera: 'superada',
    obtuvo: migs.find((m) => m.archivo.startsWith('026'))?.estado ?? 'NO ESTÁ',
  },
  {
    que: 'Un comentario "-- drop column x" no cuenta como objeto',
    espera: 0,
    obtuvo: objetosDe('-- alter table foo drop column bar;\n/* create table zzz(); */').length,
  },
]);

// ─── El reporte ──────────────────────────────────────────────────────────────
const huerfanas = migs.filter((m) => m.estado === 'aplicada' && !m.main);
const sinAplicar = migs.filter((m) => m.estado === 'sin_aplicar');
const parciales = migs.filter((m) => m.estado === 'parcial');
const soloDatos = migs.filter((m) => m.estado === 'solo_datos');
const superadas = migs.filter((m) => m.estado === 'superada');

console.log('');
console.log(C.neg('RESUMEN'));
console.log(`  ${padN(migs.length, 4)}  migraciones en el repo`);
console.log(`  ${C.verde(padN(migs.filter((m) => m.estado === 'aplicada' && m.main).length, 4))}  aplicadas y en main`);
console.log(`  ${C.rojo(padN(huerfanas.length, 4))}  ${C.rojo('HUÉRFANAS: aplicadas y su código NO está en main')}`);
console.log(`  ${C.amar(padN(sinAplicar.length, 4))}  escritas y sin aplicar`);
console.log(`  ${C.amar(padN(parciales.length, 4))}  a medio aplicar`);
console.log(`  ${C.gris(padN(superadas.length, 4))}  superadas: todo lo suyo lo redefinió una migración posterior`);
console.log(`  ${C.gris(padN(soloDatos.length, 4))}  solo datos: este método no las puede ver`);

const detalle = (grupo, titu, color) => {
  if (!grupo.length) return;
  console.log('');
  console.log(color(titu) + C.gris(`  (${grupo.length})`));
  for (const m of grupo) {
    console.log(`  ${pad(m.archivo, 58)} ${m.ok}/${m.total} objetos   ${m.main ? 'en main' : C.rojo('NO está en main')}`);
    for (const o of m.faltan.slice(0, 4)) {
      console.log(C.gris(`      ${o.debeExistir ? 'falta' : 'sigue estando'}: ${o.clase} ${o.nombre}`));
    }
  }
};

detalle(huerfanas, '🔴 HUÉRFANAS', C.rojo);
detalle(sinAplicar, '🟡 ESCRITAS Y SIN APLICAR', C.amar);
detalle(parciales, '🟠 A MEDIO APLICAR', C.amar);

if (soloDatos.length) {
  console.log('');
  console.log(C.gris('⚪ SOLO DATOS — sin objetos que preguntar, hay que mirarlas a mano:'));
  console.log(C.gris('   ' + soloDatos.map((m) => m.archivo.slice(0, 3)).join(' · ')));
}

// ─── La regla de CLAUDE.md, los tres comandos ────────────────────────────────
console.log('');
console.log(C.neg('¿LO QUE ESTÁ ARRIBA ES LO QUE TENGO ACÁ?'));
const local = sh('git rev-parse main');
const pendientes = sh('git rev-list --count origin/main..main') || '0';
let publicado = '(no pude consultar)';
try {
  const r = await fetch('https://rodziny-erp.vercel.app/version.json');
  publicado = (await r.json()).version;
} catch {
  /* sin red: se dice y sigue */
}
const coincide = publicado === local;
console.log(`  version.json publicado   ${publicado.slice(0, 12)}`);
console.log(`  git rev-parse main       ${local.slice(0, 12)}   ${coincide ? C.verde('coinciden') : C.rojo('NO COINCIDEN')}`);
console.log(`  commits sin pushear      ${pendientes}${pendientes !== '0' ? C.rojo('  ← tu código NO está arriba') : ''}`);

console.log('');
if (huerfanas.length) {
  console.log(C.rojo(`⛔ ${huerfanas.length} migración(es) huérfana(s): están en la base y su código no está publicado.`));
  process.exit(1);
}
console.log(C.verde('✓ Ninguna migración aplicada quedó sin su código en main.'));
