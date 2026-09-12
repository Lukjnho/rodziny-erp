/**
 * La foto del grafo, para poder atribuir los cambios.
 *
 * POR QUE EXISTE
 * --------------
 * El 11-sep-2026 los nodos colgados pasaron de 266 a 267 en una tanda. No se
 * pudo decir de donde salio el que sobraba: graphify pisa `graph.json` en cada
 * commit y la foto anterior ya no estaba. Un numero que tiene que BAJAR y no se
 * puede auditar no sirve de nada.
 *
 * Este script guarda una foto por commit en `graphify-out/fotos/` (fuera de git,
 * al lado del grafo) y sabe comparar dos.
 *
 * COMO SE USA
 * -----------
 *   node scripts/verificar/foto-grafo.mjs              # saca la foto de HEAD
 *   node scripts/verificar/foto-grafo.mjs --comparar   # HEAD contra la anterior
 *   node scripts/verificar/foto-grafo.mjs --comparar abc1234 def5678
 *
 * 💣 Sacar la foto DESPUES de que el hook de post-commit termine de rearmar el
 * grafo. Si se saca antes, la foto es del commit anterior con el sha nuevo.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const DIR = 'graphify-out/fotos';
const GRAFO = 'graphify-out/graph.json';

// ═══════════════════════════════════════════════════════════════════════════
// POR QUE LOS COLGADOS SE CLASIFICAN Y NO SE "ARREGLAN"
// ═══════════════════════════════════════════════════════════════════════════
//
// 💣 Medido el 11-sep-2026, y el resultado es al reves de lo que se creia.
// La teoria era: "el mismo nombre de tabla escrito distinto entre migraciones
// (con y sin public.) parte el nodo en dos; si todas escriben igual, se unen".
// ES FALSA. Las dos mediciones:
//
//   · 136 de los 275 colgados estan escritos EXACTAMENTE igual que su
//     definicion (`public.cocina_recetas` en la migracion y en el esquema
//     aplicado) y cuelgan lo mismo.
//   · Se le sacaron los `public.` a una migracion y se rehizo el grafo: los
//     colgados pasaron de 273 a 275. Reescribir SUMA un nodo con la grafia
//     nueva y no saca el viejo.
//
// 🔑 La causa real: graphify crea UN NODO POR (archivo, objeto referenciado) y
// solo le pone `source_file` al archivo que lo DEFINE. Una tabla nombrada en 30
// migraciones son 30 nodos, 29 colgados. No es un desprolijo nuestro: es como
// el lector de SQL modela las referencias, y no se arregla desde el repo.
//
// Por eso este comando dejo de tratar el numero como "algo que hay que bajar" y
// pasa a decir DE QUE esta hecho. Lo unico que de verdad tiene que mirarse es
// el cajon G: objetos que el lector no declara, donde se cuela lo que no existe.

/** De que esta hecho un nodo colgado. El orden importa: se toma el primero. */
function causaDelColgado(label, id, definidos) {
  const nl = String(label).toLowerCase().replace(/^public\./, '');
  if (/^(pg_|information_schema)/.test(nl)) return 'D';
  if (/^auth\./.test(nl)) return 'E';
  if (nl === 'public' || nl === 'v_tabla' || nl === 'image') return 'F';
  if (definidos.has(nl)) return /^supabase_migrations_/.test(String(id)) ? 'A' : 'B';
  return 'G';
}

const CAJONES = {
  A: 'referencias desde una migracion a un objeto definido en otro archivo',
  B: 'el mismo objeto nombrado con `public.` (nodo pelado de mas)',
  D: 'catalogo de Postgres (pg_class, pg_namespace, pg_trigger) - externo',
  E: 'esquema auth de Supabase - externo',
  F: 'artefactos del parser (una variable plpgsql, el esquema pelado)',
  G: 'funciones y vistas que EXISTEN y el lector de SQL no declara como nodo',
};

function sacarFoto() {
  if (!existsSync(GRAFO)) {
    console.error(`No encuentro ${GRAFO}. ¿Corriste /graphify?`);
    process.exit(1);
  }
  const g = JSON.parse(readFileSync(GRAFO, 'utf8'));
  const sha = execSync('git rev-parse --short HEAD').toString().trim();
  const sueltos = g.nodes.filter((n) => !n.source_file);
  const definidos = new Set(
    g.nodes
      .filter((n) => n.source_file)
      .map((n) => String(n.label).toLowerCase().replace(/^public\./, '')),
  );
  const porCausa = {};
  for (const n of sueltos) {
    const c = causaDelColgado(n.label, n.id, definidos);
    (porCausa[c] ??= []).push(String(n.label));
  }
  const foto = {
    commit: sha,
    asunto: execSync('git log -1 --pretty=%s').toString().trim(),
    cuando: execSync('git log -1 --pretty=%cI').toString().trim(),
    nodos: g.nodes.length,
    aristas: g.links.length,
    colgados: sueltos.map((n) => String(n.id ?? n.name)).sort(),
    porCausa: Object.fromEntries(Object.entries(porCausa).map(([k, v]) => [k, v.length])),
  };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `${sha}.json`), JSON.stringify(foto, null, 1));
  console.log(
    `foto ${sha}: ${foto.nodos} nodos · ${foto.aristas} aristas · ${foto.colgados.length} colgados`,
  );
  console.log('');
  console.log('DE QUE ESTAN HECHOS LOS COLGADOS');
  for (const k of ['A', 'B', 'G', 'E', 'F', 'D']) {
    const n = porCausa[k]?.length ?? 0;
    if (!n) continue;
    console.log(`  ${String(n).padStart(4)}  ${k} · ${CAJONES[k]}`);
  }
  const revisar = [...new Set(porCausa.G ?? [])];
  if (revisar.length) {
    console.log('');
    console.log('  ⚠️ Del cajon G hay que chequear a mano que todos existan en la base.');
    console.log('     Ahi se cuela lo unico que de verdad importa: un objeto que ya no esta.');
    console.log('     ' + revisar.join(' · '));
  }
  return foto;
}

function fotos() {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')))
    .sort((a, b) => a.cuando.localeCompare(b.cuando));
}

function comparar(shaA, shaB) {
  const todas = fotos();
  if (todas.length < 2) {
    console.error('Hacen falta al menos dos fotos. Corré el script sin argumentos en cada tanda.');
    process.exit(1);
  }
  const a = shaA ? todas.find((f) => f.commit === shaA) : todas[todas.length - 2];
  const b = shaB ? todas.find((f) => f.commit === shaB) : todas[todas.length - 1];
  if (!a || !b) {
    console.error('No encuentro alguna de las dos fotos. Las que hay:', todas.map((f) => f.commit).join(', '));
    process.exit(1);
  }
  const d = (x, y) => (y - x >= 0 ? `+${y - x}` : `${y - x}`);
  console.log(`\n${a.commit} → ${b.commit}`);
  console.log(`  ${a.asunto}`);
  console.log(`  ${b.asunto}\n`);
  console.log(`  nodos     ${a.nodos} → ${b.nodos}  (${d(a.nodos, b.nodos)})`);
  console.log(`  aristas   ${a.aristas} → ${b.aristas}  (${d(a.aristas, b.aristas)})`);
  console.log(`  colgados  ${a.colgados.length} → ${b.colgados.length}  (${d(a.colgados.length, b.colgados.length)})`);

  const antes = new Set(a.colgados);
  const despues = new Set(b.colgados);
  const nuevos = b.colgados.filter((x) => !antes.has(x));
  const idos = a.colgados.filter((x) => !despues.has(x));
  if (nuevos.length) {
    console.log(`\n  ⚠️ COLGADOS NUEVOS (${nuevos.length}) — mirá de qué cajón salieron:`);
    nuevos.forEach((x) => console.log(`     + ${x}`));
  }
  if (idos.length) {
    console.log(`\n  ✅ colgados que se fueron (${idos.length}):`);
    idos.forEach((x) => console.log(`     − ${x}`));
  }
  if (!nuevos.length && !idos.length) console.log('\n  Los colgados son exactamente los mismos.');
}

const args = process.argv.slice(2);
if (args[0] === '--comparar') comparar(args[1], args[2]);
else sacarFoto();
