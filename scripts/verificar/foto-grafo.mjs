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

function sacarFoto() {
  if (!existsSync(GRAFO)) {
    console.error(`No encuentro ${GRAFO}. ¿Corriste /graphify?`);
    process.exit(1);
  }
  const g = JSON.parse(readFileSync(GRAFO, 'utf8'));
  const sha = execSync('git rev-parse --short HEAD').toString().trim();
  const foto = {
    commit: sha,
    asunto: execSync('git log -1 --pretty=%s').toString().trim(),
    cuando: execSync('git log -1 --pretty=%cI').toString().trim(),
    nodos: g.nodes.length,
    aristas: g.links.length,
    colgados: g.nodes.filter((n) => !n.source_file).map((n) => String(n.id ?? n.name)).sort(),
  };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `${sha}.json`), JSON.stringify(foto, null, 1));
  console.log(
    `foto ${sha}: ${foto.nodos} nodos · ${foto.aristas} aristas · ${foto.colgados.length} colgados`,
  );
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
    console.log(`\n  ⚠️ COLGADOS NUEVOS (${nuevos.length}) — este número tiene que bajar, no subir:`);
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
