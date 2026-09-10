/*
 * MAPA DEL ERP — une las tres capas en una sola página:
 *   1. la BASE   → qué tablas existen y cómo están protegidas   (viene de base.txt)
 *   2. el CÓDIGO → qué módulo toca cuál                          (escanea src/ acá nomás)
 *   3. el ORDEN  → cuáles respetan el local y cuáles no          (se deduce de las dos)
 *
 * PARA QUÉ SIRVE: el ERP guarda de qué local es cada fila en muchas tablas, pero en varias
 * la regla de acceso no lo mira. Este mapa las marca en ámbar. A medida que se van ordenando,
 * se vuelven verdes. Es la forma de ver el avance sin tener que acordarse de nada.
 *
 * ─── CÓMO SE REGENERA ────────────────────────────────────────────────────────
 *   1) Correr esta consulta en Supabase y pegar la única celda que devuelve en base.txt:
 *
 *        select string_agg(
 *          c.relname || ':' ||
 *          (select count(*) from pg_policy p where p.polrelid=c.oid) || ':' ||
 *          (case when exists(select 1 from information_schema.columns col
 *                where col.table_name=c.relname and col.table_schema='public'
 *                  and col.column_name='local') then 'L' else '-' end) ||
 *          (case when exists(select 1 from pg_policy p where p.polrelid=c.oid
 *                and pg_get_expr(p.polqual,p.polrelid) ilike '%local%') then 'P' else '-' end) ||
 *          (case when coalesce(has_table_privilege('anon',c.oid,'SELECT'),false) then 'R' else '-' end) ||
 *          (case when coalesce(has_table_privilege('anon',c.oid,'INSERT')
 *                or has_table_privilege('anon',c.oid,'UPDATE')
 *                or has_table_privilege('anon',c.oid,'DELETE'),false) then 'W' else '-' end) ||
 *          ':' || greatest(c.reltuples::bigint,0)
 *          , '|' order by c.relname)
 *        from pg_class c join pg_namespace n on n.oid=c.relnamespace
 *        where n.nspname='public' and c.relkind in ('r','p');
 *
 *   2) node scripts/mapa-erp/generar.cjs          → escribe mapa.html al lado
 *
 * ⚠️ OJO con la letra W (anon escribe): es el permiso a nivel TABLA, no lo que anon
 * realmente puede hacer. La regla de acceso puede cortarlo igual, fila por fila. Para saber
 * qué ve de verdad la clave pública hay que entrar COMO anon y contar — leer las reglas no
 * alcanza, y ya nos hizo dar un dato falso una vez.
 */
const fs = require('fs');
const path = require('path');

const AQUI = __dirname;
const RAIZ = path.resolve(AQUI, '..', '..');
const SRC = path.join(RAIZ, 'src');

// ─── Capa 1: la BASE ────────────────────────────────────────────────────────
const crudo = fs.readFileSync(path.join(AQUI, 'base.txt'), 'utf8').trim();
const tablas = new Map();
for (const item of crudo.split('|')) {
  const [nombre, pol, flags, filas] = item.split(':');
  if (!nombre) continue;
  tablas.set(nombre, {
    nombre,
    policies: Number(pol),
    colLocal: flags[0] === 'L',
    polLocal: flags[1] === 'P',
    anonLee: flags[2] === 'R',
    anonEscribe: flags[3] === 'W',
    filas: Number(filas),
  });
}

// ─── Capa 2: el CÓDIGO ──────────────────────────────────────────────────────
// Se escanea src/ directo en vez de usar el grafo: así el mapa no depende de que el
// grafo esté al día, y cualquiera lo puede correr en cualquier máquina.
function archivos(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) archivos(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

// El módulo es la carpeta bajo src/modules/. Lo de afuera cae en 'compartido'.
function moduloDe(archivo) {
  const rel = path.relative(SRC, archivo).split(path.sep);
  if (rel[0] === 'modules' && rel[1]) return rel[1];
  if (rel[0] === 'pages' && rel[1]) return rel[1].replace(/Page\.tsx?$/, '').toLowerCase();
  return 'compartido';
}

const modTablas = {};
const modRpc = {};
const tablaMods = {};

const reFrom = /\.from\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g;
const reRpc = /\.rpc\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g;

for (const f of archivos(SRC)) {
  const mod = moduloDe(f);
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }

  let m;
  reFrom.lastIndex = 0;
  while ((m = reFrom.exec(txt))) {
    const t = m[1];
    if (!tablas.has(t)) continue; // vistas y nombres que no son tablas reales
    (modTablas[mod] ??= new Set()).add(t);
    (tablaMods[t] ??= new Set()).add(mod);
  }
  reRpc.lastIndex = 0;
  while ((m = reRpc.exec(txt))) (modRpc[mod] ??= new Set()).add(m[1]);
}

for (const k of Object.keys(modTablas)) modTablas[k] = [...modTablas[k]].sort();
for (const k of Object.keys(modRpc)) modRpc[k] = [...modRpc[k]].sort();
for (const k of Object.keys(tablaMods)) tablaMods[k] = [...tablaMods[k]].sort();

// ─── Capa 3: el ORDEN ───────────────────────────────────────────────────────
// 'ordenada' → respeta el local, o no tiene local que respetar
// 'suelta'   → guarda de qué local es cada fila y la regla NO lo mira
// 'cerrada'  → sin reglas: no entra nadie salvo el sistema
for (const t of tablas.values()) {
  t.estado = t.policies === 0 ? 'cerrada' : t.colLocal && !t.polLocal ? 'suelta' : 'ordenada';
  t.modulos = tablaMods[t.nombre] || [];
  t.compartida = t.modulos.length > 1;
  t.huerfana = t.modulos.length === 0;
}

const AREAS = [
  ['Fábrica y cocina', (n) => n.startsWith('cocina_')],
  ['Ventas y caja', (n) => /^(ventas_|caja_|cierres_caja)/.test(n)],
  ['Plata: gastos, bancos, pagos', (n) => /^(gastos|pagos_|movimientos_bancarios|comprobantes|proveedores|categorias_gasto|extractos|saldos|reglas_mov|medios_pago|mp_|veps|impuestos|dividendos|amortizaciones|descuentos|convenios|edr_|cierres_mes|proyeccion|comision|arca_)/.test(n)],
  ['Gente', (n) => /^(empleados|fichadas|sueldos|aguinaldos|adelantos|bonos|vacaciones|sanciones|recibos_sueldo|liquidaciones|cronograma)/.test(n)],
  ['Catálogo y stock', (n) => /^(productos|movimientos_stock|almacen_pedidos|recepciones)/.test(n)],
  ['Sistema y accesos', () => true],
];
const areaDe = (n) => (AREAS.find(([, t]) => t(n)) || AREAS[AREAS.length - 1])[0];

const porArea = new Map(AREAS.map(([a]) => [a, []]));
const ordenPorTamano = (a, b) => b.filas - a.filas || a.nombre.localeCompare(b.nombre);
for (const t of [...tablas.values()].sort(ordenPorTamano)) porArea.get(areaDe(t.nombre)).push(t);

const todas = [...tablas.values()];
const sueltas = todas.filter((t) => t.estado === 'suelta');
const sueltasCocina = sueltas.filter((t) => t.nombre.startsWith('cocina_'));
const compartidas = todas.filter((t) => t.compartida);
const huerfanas = todas.filter((t) => t.huerfana).sort(ordenPorTamano);
const modulos = Object.keys(modTablas).filter((m) => modTablas[m].length).sort();

// ─── Render ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n) => n.toLocaleString('es-AR');
const ETIQ = { ordenada: ['ok', 'respeta el local'], suelta: ['pend', 'sabe el local y no lo usa'], cerrada: ['cerr', 'cerrada: solo el sistema'] };

const filaTabla = (t) => {
  const [cls, titulo] = ETIQ[t.estado];
  return `<li class="t ${cls}"><span class="marca" title="${titulo}"></span><code>${esc(t.nombre)}</code>` +
    (t.filas > 0 ? `<span class="filas">${num(t.filas)}</span>` : '<span class="filas vacia">—</span>') +
    (t.compartida ? `<span class="chip comp" title="${esc(t.modulos.join(', '))}">${t.modulos.length} módulos</span>` : '') +
    (t.estado === 'suelta' ? '<span class="chip falta">falta el local</span>' : '') +
    '</li>';
};

const caja = (clase, titulo, items, extra = '') => {
  if (!items.length) return '';
  const pend = items.filter((t) => t.estado === 'suelta').length;
  return `<section class="${clase}"><h3>${esc(titulo)}<span class="cuenta">${items.length} tabla${items.length === 1 ? '' : 's'}${extra}${pend ? ` · <b>${pend} sin ordenar</b>` : ''}</span></h3>` +
    `<ul class="tablas">${items.map(filaTabla).join('')}</ul></section>`;
};

const seccionesBase = AREAS.map(([a]) => caja('area', a, porArea.get(a))).join('');

const seccionesModulo = modulos.map((m) => {
  const ts = modTablas[m].map((n) => tablas.get(n)).filter(Boolean).sort(ordenPorTamano);
  const rpc = modRpc[m] || [];
  return caja('modulo', m, ts, rpc.length ? ` · ${rpc.length} función${rpc.length === 1 ? '' : 'es'}` : '');
}).join('');

const filasCruce = compartidas
  .sort((a, b) => b.modulos.length - a.modulos.length || b.filas - a.filas)
  .slice(0, 18)
  .map((t) => `<tr class="${t.estado}"><td><code>${esc(t.nombre)}</code></td><td class="n">${t.modulos.length}</td>` +
    `<td class="mm">${esc(t.modulos.join(' · '))}</td><td class="n">${t.filas > 0 ? num(t.filas) : '—'}</td>` +
    `<td>${t.estado === 'suelta' ? '<span class="chip falta">falta el local</span>' : '<span class="chip ok">ordenada</span>'}</td></tr>`)
  .join('');

const CSS = `
:root{--harina:#E8DDC7;--harina-alta:#F4EDE0;--papel:#FBF7F0;--madera:#412C1B;--madera-sua:#6B5342;
--tenue:#9C8977;--salsa:#BD3220;--linea:#DCCFB8;
--ok:#5F6B3A;--ok-f:#EDEFE0;--falta:#A06A12;--falta-f:#F7EDD9;--cerr:#7A6A9C;--cerr-f:#EFEBF5}
:root:not([data-theme="light"]){color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;
--harina:#2A2118;--harina-alta:#342A1F;--papel:#1E1811;--madera:#EFE4D2;--madera-sua:#BFAE99;
--tenue:#8A7A68;--salsa:#E8705C;--linea:#453728;
--ok:#AFBE7E;--ok-f:#2C3220;--falta:#E0AC5B;--falta-f:#3A2E1B;--cerr:#B3A6D0;--cerr-f:#2B2536}}
:root[data-theme="dark"]{color-scheme:dark;
--harina:#2A2118;--harina-alta:#342A1F;--papel:#1E1811;--madera:#EFE4D2;--madera-sua:#BFAE99;
--tenue:#8A7A68;--salsa:#E8705C;--linea:#453728;
--ok:#AFBE7E;--ok-f:#2C3220;--falta:#E0AC5B;--falta-f:#3A2E1B;--cerr:#B3A6D0;--cerr-f:#2B2536}
*{box-sizing:border-box}
body{margin:0;background:var(--papel);color:var(--madera);
font:400 15px/1.55 Karla,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.hoja{max-width:1000px;margin:0 auto;padding:38px 20px 70px;display:flex;flex-direction:column;gap:32px}
.marcaTop{font:500 11px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.16em;
text-transform:uppercase;color:var(--salsa)}
h1{margin:0;font:700 32px/1.15 Bitter,Georgia,serif;letter-spacing:-.015em;text-wrap:balance}
.bajada{margin:0;max-width:66ch;color:var(--madera-sua);font-size:16px}
.cabecera{display:flex;flex-direction:column;gap:11px}
.cifras{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--linea);
border:1px solid var(--linea);border-radius:8px;overflow:hidden}
.cifra{background:var(--papel);padding:14px 15px;display:flex;flex-direction:column;gap:2px}
.cifra dt{font:500 10px/1.3 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.1em;
text-transform:uppercase;color:var(--tenue)}
.cifra dd{margin:0;font:700 26px/1.1 Bitter,Georgia,serif;font-variant-numeric:tabular-nums}
.cifra .pie{font-size:12px;color:var(--madera-sua);line-height:1.35}
.cifra.alerta dd{color:var(--falta)}
h2{margin:0 0 4px;font:700 21px/1.25 Bitter,Georgia,serif;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
h2 .sub{font:400 13px/1.4 Karla,sans-serif;color:var(--tenue)}
.capa{display:flex;flex-direction:column;gap:14px}
.capa>.nota{margin:0;color:var(--madera-sua);max-width:70ch;font-size:14.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:12px}
.area,.modulo{border:1px solid var(--linea);border-radius:8px;background:var(--harina-alta);
padding:12px 13px;display:flex;flex-direction:column;gap:8px}
.area h3,.modulo h3{margin:0;font:700 15px/1.3 Bitter,Georgia,serif;display:flex;flex-direction:column;gap:1px}
.modulo h3{text-transform:capitalize}
.cuenta{font:400 11.5px/1.3 "IBM Plex Mono",ui-monospace,monospace;color:var(--tenue);
text-transform:none;letter-spacing:0}
.cuenta b{color:var(--falta);font-weight:600}
ul.tablas{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
ul.huerfanas{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:3px}
li.t{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:3px 6px;border-radius:4px;background:var(--papel)}
li.t code{font:400 12px/1.5 "IBM Plex Mono",ui-monospace,monospace;color:var(--madera);flex:1;min-width:0;overflow-wrap:anywhere}
.marca{width:3px;align-self:stretch;min-height:15px;border-radius:2px;background:var(--ok);flex:none}
li.pend .marca{background:var(--falta)}
li.cerr .marca{background:var(--cerr)}
.filas{font:400 11px/1 "IBM Plex Mono",ui-monospace,monospace;color:var(--tenue);
font-variant-numeric:tabular-nums;white-space:nowrap}
.filas.vacia{opacity:.45}
.chip{font:500 9.5px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.04em;
padding:3px 5px;border-radius:3px;white-space:nowrap;text-transform:uppercase}
.chip.falta{background:var(--falta-f);color:var(--falta)}
.chip.ok{background:var(--ok-f);color:var(--ok)}
.chip.comp{background:var(--harina);color:var(--madera-sua)}
.tablaWrap{overflow-x:auto;border:1px solid var(--linea);border-radius:8px}
table{border-collapse:collapse;width:100%;min-width:640px;background:var(--papel)}
th{text-align:left;font:500 10px/1.3 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.09em;
text-transform:uppercase;color:var(--tenue);padding:9px 11px;border-bottom:1px solid var(--linea)}
td{padding:7px 11px;border-bottom:1px solid var(--linea);font-size:13px;vertical-align:middle}
tr:last-child td{border-bottom:0}
td code{font:400 12px/1.4 "IBM Plex Mono",ui-monospace,monospace}
td.n{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;color:var(--madera-sua)}
td.mm{color:var(--madera-sua);font-size:12px}
tr.suelta{background:var(--falta-f)}
.leyenda{display:flex;flex-wrap:wrap;gap:14px;padding:11px 13px;border:1px solid var(--linea);
border-radius:8px;background:var(--harina-alta);font-size:13px}
.leyenda span{display:flex;align-items:center;gap:6px;color:var(--madera-sua)}
.leyenda i{width:3px;height:15px;border-radius:2px;display:inline-block}
footer{border-top:1px solid var(--linea);padding-top:16px;color:var(--tenue);font-size:13px;
display:flex;flex-direction:column;gap:5px}
footer code{font:400 12px/1.4 "IBM Plex Mono",ui-monospace,monospace;color:var(--madera-sua)}
@media (max-width:640px){h1{font-size:26px}.cifras{grid-template-columns:repeat(2,1fr)}}`;

const html = `<title>El mapa del ERP</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bitter:wght@500;700&family=Karla:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>${CSS}</style>
<div class="hoja">
  <header class="cabecera">
    <div class="marcaTop">Rodziny · Mapa del sistema</div>
    <h1>El mapa del ERP</h1>
    <p class="bajada">Las tres capas juntas: la <strong>base</strong> (qué tablas existen y cómo
    están protegidas), el <strong>código</strong> (qué módulo toca cuál) y el
    <strong>estado de orden</strong> de cada una. Se lee de abajo hacia arriba: primero la base,
    después los módulos que la usan.</p>
  </header>
  <dl class="cifras">
    <div class="cifra"><dt>Tablas</dt><dd>${todas.length}</dd><div class="pie">todas con candado puesto</div></div>
    <div class="cifra"><dt>Módulos</dt><dd>${modulos.length}</dd><div class="pie">que tocan la base</div></div>
    <div class="cifra alerta"><dt>Sin ordenar</dt><dd>${sueltas.length}</dd><div class="pie">saben de qué local es cada fila y la regla no lo mira</div></div>
    <div class="cifra"><dt>Compartidas</dt><dd>${compartidas.length}</dd><div class="pie">las toca más de un módulo</div></div>
  </dl>
  <div class="leyenda">
    <span><i style="background:var(--ok)"></i> respeta el local, o no tiene local que respetar</span>
    <span><i style="background:var(--falta)"></i> guarda el local y la regla lo ignora</span>
    <span><i style="background:var(--cerr)"></i> cerrada: solo entra el sistema</span>
  </div>
  <div class="capa">
    <h2>1 · La base <span class="sub">${todas.length} tablas por área — de la que más datos tiene a la que menos</span></h2>
    <p class="nota"><strong>${sueltas.length} tablas guardan de qué local es cada fila y ninguna regla lo mira</strong>,
    y ${sueltasCocina.length} son de cocina. Ese es el desorden concreto: el dato está, no se usa.</p>
    <div class="grid">${seccionesBase}</div>
  </div>
  <div class="capa">
    <h2>2 · Los módulos <span class="sub">qué toca cada uno</span></h2>
    <div class="grid">${seccionesModulo}</div>
  </div>
  <div class="capa">
    <h2>3 · Dónde se cruzan <span class="sub">las ${Math.min(18, compartidas.length)} tablas que más módulos comparten</span></h2>
    <p class="nota">Una tabla que tocan varios módulos es donde un cambio se propaga sin que se note.
    Si además está en ámbar, el cruce pasa por encima de los dos locales.</p>
    <div class="tablaWrap"><table>
      <thead><tr><th>Tabla</th><th class="n">Módulos</th><th>Cuáles</th><th class="n">Filas</th><th>Estado</th></tr></thead>
      <tbody>${filasCruce}</tbody></table></div>
  </div>
  <div class="capa">
    <h2>4 · Las que ninguna pantalla toca <span class="sub">${huerfanas.length} tablas</span></h2>
    <p class="nota"><strong>Ojo: esto NO quiere decir que estén muertas.</strong> Acá se lista lo que
    no aparece llamado desde <code>src/</code>, y estas se usan desde otro lado: disparadores de la
    base, el cron de la noche, las funciones que hablan con Fudo o con ARCA. Antes de borrar una hay
    que abrirla y mirar — ya nos pasó de dar por muerto algo que andaba.</p>
    <ul class="tablas huerfanas">${huerfanas.map(filaTabla).join('')}</ul>
  </div>
  <footer>
    <div>El conteo de filas es el estimado de Postgres, no un conteo exacto: sirve para comparar
    tamaños, no para contabilidad.</div>
    <div>La marca de «anon escribe» de la consulta es el permiso a nivel tabla, no lo que la clave
    pública puede hacer de verdad: la regla la puede cortar igual, fila por fila.</div>
    <div>Se regenera con <code>node scripts/mapa-erp/generar.cjs</code> después de actualizar
    <code>base.txt</code> con la consulta que está documentada arriba del script.</div>
  </footer>
</div>`;

fs.writeFileSync(path.join(AQUI, 'mapa.html'), html);

console.log('OK  scripts/mapa-erp/mapa.html  (' + Math.round(html.length / 1024) + ' KB)');
console.log('    tablas ................ ' + todas.length);
console.log('    modulos ............... ' + modulos.length + '  (' + modulos.join(', ') + ')');
console.log('    sin ordenar ........... ' + sueltas.length + '  (cocina: ' + sueltasCocina.length + ')');
console.log('    compartidas ........... ' + compartidas.length);
console.log('    sin pantalla que las toque ... ' + huerfanas.length);
