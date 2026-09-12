/**
 * ¿Qué columnas existen en la base y ningún `select` del frontend nombra?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Una columna que quedó de una idea vieja no molesta hasta que alguien la ve en
 * una lista y cree que significa algo. Peor: la migración 213 borró seis
 * columnas después de comprobar a mano que nadie las leía, y comprobarlo a mano
 * son 96 tablas × todos los `select` del repo.
 *
 * 💣 PERO ESTE COMANDO NO DICE "MUERTA". DICE "NINGÚN SELECT PLANO LA NOMBRA".
 * No es lo mismo, y la diferencia ya costó un susto:
 *
 *   · `es_ancla` no aparecía en ningún select y NO estaba muerta: es una
 *     palanca real del menú, y entraba por un `select('*')`.
 *   · Una columna puede leerla la BASE —un trigger, una función, una policy—
 *     sin que el frontend la nombre nunca.
 *   · Puede leerla una Edge Function, un script, o el importador de Fudo.
 *
 * 🔑 Por eso la salida son TRES cajones y sólo el primero es accionable, y aun
 * así sólo como candidato a revisar. Borrar necesita las tres evidencias:
 * cero lecturas en el repo, cero filas con dato, y cero referencias desde la
 * base. Este comando da la primera.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Lo que entra por `select('*')`. Se listan aparte las tablas que lo usan:
 *     ahí adentro no se puede saber qué se lee.
 *   · Lo que lee la base (triggers, funciones, policies) ni las Edge Functions.
 *   · Las columnas que se ESCRIBEN pero no se leen. Un `insert` las nombra y
 *     este comando las cuenta como leídas, a propósito: si algo las escribe,
 *     alguien las quiso.
 *   · Si la columna tiene datos. Eso es la segunda evidencia y va aparte.
 *
 * Sale con 0 siempre: es una lista para mirar, no un semáforo.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { C, titulo, universo, testigos, pad, padN, columnasDelEsquema } from './_comun.mjs';

const ESQUEMA = 'supabase/esquema-aplicado.sql';

// ─── Las columnas que existen, según la foto del esquema aplicado ────────────
//
// Se lee el archivo versionado y no la base: así el comando corre en CI sin
// credenciales. La foto se rehace con scripts/graphify/esquema_aplicado.py
// después de cada migración, y el git diff de ese archivo es el registro.
// La lectura del esquema aplicado vive en _comun.mjs: la usa tambien
// `vocabularios`, para cazar el filtro que pide una columna que ya no existe.
export { columnasDelEsquema };

// ─── Los nombres que el código nombra ────────────────────────────────────────
//
// A propósito NO se intenta saber a qué tabla pertenece cada nombre: eso exige
// seguir el `.from()` a través de cadenas, variables y helpers, y falla en
// silencio justo donde importa. Se junta el CONJUNTO de identificadores que el
// código menciona, y una columna se da por leída si aparece en ese conjunto.
//
// ⚠️ Eso hace el comando CONSERVADOR: una columna que se llama igual en dos
// tablas queda marcada como leída en las dos. Prefiere el falso negativo (no
// avisar) antes que el falso positivo (decir que algo está muerto y no lo está).
// Convertir falsos positivos en falsos negativos es la dirección segura acá.
export function nombresQueUsaElCodigo(fuentes) {
  const vistos = new Set();
  const planos = [];
  const conEstrella = new Set();
  for (const { ruta, txt } of fuentes) {
    // 1 · Los select planos: .select('a, b, tabla(c)')
    for (const m of txt.matchAll(/\.select\(\s*'([^']*)'/g)) {
      const cuerpo = m[1];
      if (cuerpo.trim() === '*') {
        // Qué tabla, para poder avisar que ahí no se puede saber.
        const antes = txt.slice(Math.max(0, m.index - 200), m.index);
        const f = [...antes.matchAll(/\.from\(\s*'(\w+)'/g)].pop();
        conEstrella.add(f ? f[1].toLowerCase() : '(no pude ver la tabla)');
        continue;
      }
      planos.push({ ruta, cuerpo });
      for (const id of cuerpo.matchAll(/[A-Za-z_]\w*/g)) vistos.add(id[0].toLowerCase());
    }
    // 2 · Todo el resto del archivo: .eq('col', ...), .order('col'), un objeto
    //     de insert { col: valor }, una propiedad leída x.col. Con juntar los
    //     identificadores alcanza, por lo que dice el comentario de arriba.
    for (const id of txt.matchAll(/[A-Za-z_]\w*/g)) vistos.add(id[0].toLowerCase());
  }
  return { vistos, planos, conEstrella };
}

function archivos(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) archivos(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

// ─── Lo que se mira ──────────────────────────────────────────────────────────
const sql = readFileSync(ESQUEMA, 'utf8');
const tablas = columnasDelEsquema(sql);
const rutas = [...archivos('src'), ...archivos('supabase/functions').filter((r) => /\.ts$/.test(r))];
const fuentes = rutas.map((ruta) => ({ ruta, txt: readFileSync(ruta, 'utf8') }));
const { vistos, planos, conEstrella } = nombresQueUsaElCodigo(fuentes);

// Las columnas que están en TODAS las tablas y no dicen nada por sí solas.
const DE_OFICIO = new Set(['id', 'created_at', 'updated_at']);

const totalCols = [...tablas.values()].reduce((a, c) => a + c.length, 0);

titulo('columnas', 'Columnas que existen y ningún select del código nombra.');
universo(
  `${tablas.size} tablas y ${totalCols} columnas, leídas de ${ESQUEMA} (la foto del esquema APLICADO)`,
  `${rutas.length} archivos .ts/.tsx de src/ y de las Edge Functions · ${planos.length} select planos`,
  'Una columna cuenta como LEÍDA si su nombre aparece en cualquier parte del código, no sólo en un select',
  `⚠️ ${conEstrella.size} tablas se piden con select('*'): ahí adentro no se puede saber qué se lee`,
  'NO se miran las policies, los triggers ni las funciones de la base: esos también leen',
);

// ─── Los testigos: del MÉTODO ────────────────────────────────────────────────
const SQL_DE_PRUEBA = `
create table public.prueba_testigo (
  id uuid primary key default gen_random_uuid(),
  se_usa text not null,
  no_se_usa_en_ningun_lado numeric,
  constraint prueba_testigo_unica unique (se_usa),
  primary key (id)
);
create view public.no_es_tabla as select 1;
`;
const CODIGO_DE_PRUEBA = [
  {
    ruta: 'testigo.ts',
    txt: `
      const a = await supabase.from('prueba_testigo').select('id, se_usa');
      const b = await supabase.from('otra_cosa').select('*');
      const c = await supabase.from('tercera').update({ marcado_a_mano: true }).eq('id', x);
    `,
  },
];
const tablasPrueba = columnasDelEsquema(SQL_DE_PRUEBA);
const usoPrueba = nombresQueUsaElCodigo(CODIGO_DE_PRUEBA);

testigos([
  {
    que: 'Lee las columnas de un create table escrito a mano y saltea las restricciones',
    espera: 'id,se_usa,no_se_usa_en_ningun_lado',
    obtuvo: (tablasPrueba.get('prueba_testigo') ?? []).join(','),
  },
  {
    que: 'Una vista no es una tabla: no aporta columnas',
    espera: false,
    obtuvo: tablasPrueba.has('no_es_tabla'),
  },
  {
    que: 'Una columna nombrada en un select plano figura como leída',
    espera: true,
    obtuvo: usoPrueba.vistos.has('se_usa'),
  },
  {
    que: '💣 Una columna que sólo se ESCRIBE (en un update) también figura como leída',
    espera: true,
    obtuvo: usoPrueba.vistos.has('marcado_a_mano'),
  },
  {
    que: 'La que no aparece en ningún lado NO figura como leída',
    espera: false,
    obtuvo: usoPrueba.vistos.has('no_se_usa_en_ningun_lado'),
  },
  {
    que: "Anota la tabla que se pide con select('*'), que es donde no se puede saber",
    espera: 'otra_cosa',
    obtuvo: [...usoPrueba.conEstrella].join(','),
  },
  {
    que: '🔑 `es_ancla` NO puede figurar como sin leer: es la palanca que casi borramos',
    espera: true,
    obtuvo: vistos.has('es_ancla'),
  },
  {
    que: 'Una columna que se usa en todos lados sí figura leída (costo_unitario)',
    espera: true,
    obtuvo: vistos.has('costo_unitario'),
  },
]);

// ─── El reporte ──────────────────────────────────────────────────────────────
const candidatas = [];
for (const [tabla, cols] of tablas) {
  const sinLeer = cols.filter((c) => !DE_OFICIO.has(c) && !vistos.has(c));
  if (sinLeer.length) candidatas.push({ tabla, sinLeer, total: cols.length, estrella: conEstrella.has(tabla) });
}
candidatas.sort((a, b) => b.sinLeer.length - a.sinLeer.length);

const nCand = candidatas.reduce((a, c) => a + c.sinLeer.length, 0);
const nConEstrella = candidatas.filter((c) => c.estrella).reduce((a, c) => a + c.sinLeer.length, 0);

console.log('');
console.log(C.neg('RESUMEN'));
console.log(`  ${padN(totalCols, 5)}  columnas en total`);
console.log(`  ${padN(totalCols - nCand, 5)}  el código las nombra en algún lado`);
console.log(`  ${C.amar(padN(nCand, 5))}  ${C.amar('ningún archivo del repo las nombra')}`);
console.log(
  `  ${C.gris(padN(nConEstrella, 5))}  ${C.gris("…de ésas, están en una tabla que se pide con select('*'): no se puede saber")}`,
);
console.log('');
console.log(C.gris('  ⚠️ "Ningún archivo las nombra" NO es "muerta". Falta mirar si tienen datos y'));
console.log(C.gris('     si las lee la base. Acuérdense de es_ancla.'));

console.log('');
console.log(C.neg('CANDIDATAS A REVISAR') + C.gris('  (por tabla, las que más tienen primero)'));
for (const c of candidatas) {
  const marca = c.estrella ? C.gris(" · la tabla se pide con select('*')") : '';
  console.log(`  ${C.neg(pad(c.tabla, 34))}${padN(`${c.sinLeer.length}/${c.total}`, 7)}${marca}`);
  console.log(`      ${C.amar(c.sinLeer.join(' · '))}`);
}

console.log('');
console.log(C.neg('LA SEGUNDA EVIDENCIA') + C.gris('  (correr a mano, con el token)'));
console.log(C.gris('  Para cada candidata, cuántas filas tienen dato. Cero filas con dato +'));
console.log(C.gris('  cero lecturas + cero referencias desde la base = recién ahí se puede borrar.'));
const muestra = candidatas.slice(0, 3);
for (const c of muestra) {
  const sel = c.sinLeer.slice(0, 4).map((x) => `count(${x}) as ${x}`).join(', ');
  console.log(C.gris(`    select count(*) as filas, ${sel} from ${c.tabla};`));
}

console.log('');
console.log(C.verde(`✓ ${nCand} columnas para mirar. Ninguna se toca sin las otras dos evidencias.`));
