/**
 * ¿Las listas fijas del código dicen lo mismo que los datos?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE — ESTE ES EL QUE AGARRA "LA PANTALLA QUE MIENTE"
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Una pantalla que filtra por un valor que ya no existe NO falla: muestra una
 * lista corta y se queda tan tranquila. Nadie la reporta porque nadie sabe
 * cuántos renglones tendría que haber.
 *
 *   · `panificado` ↔ `panaderia` dejó la pantalla de Panes vacía TRES MESES.
 *   · La migración 208 renombró el rol `panificado` a `panificado_base` y el
 *     editor de plan siguió filtrando por el viejo: 12 recetas se cayeron del
 *     desplegable y 47 renglones del plan de Saavedra quedaron en blanco.
 *
 * 🔑 Un error de vocabulario no se ve leyendo el código NI leyendo los datos.
 * Se ve **cruzándolos**, y por local: un valor puede tener 30 filas en Vedia y
 * cero en Saavedra, y ahí la pantalla miente en un solo local.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LOS CUATRO CHEQUEOS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1 · Cada lista fija de `costeo/modelo.ts` contra los datos reales, POR
 *       LOCAL. Un valor con cero filas en un local es una sección vacía.
 *   2 · Al revés: valores que están en los datos y NO en la lista del código.
 *       Ese es el que rompe en silencio, porque el código ni los contempla.
 *   3 · `productos_costeo_config`: qué piso de margen se le aplica a cada
 *       cajón, cuáles sobran y cuáles faltan.
 *   4 · 💥 LOS FILTROS ESCRITOS A MANO ADENTRO DE UNA PANTALLA — agregado el
 *       12-sep-2026, con producción rota. Cada `.from('tabla').eq('col','val')`
 *       del repo, cruzado contra el esquema APLICADO y contra los datos.
 *       Ver el bloque del chequeo 4 más abajo para la historia completa.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Vocabularios que coinciden en texto y significan cosas distintas. El
 *     `tipo` de `cocina_pizarron_items` y el `tipo` de `cocina_recetas` dicen
 *     los dos "salsa" y no son lo mismo.
 *   · Una lista fija copiada adentro de un .tsx que NO se use como filtro de
 *     una consulta: los chequeos 1 a 3 leen `costeo/modelo.ts` y nada más, y
 *     el 4 mira los filtros, no las listas. (Para eso está `npm run reglas`.)
 *   · Cuál de los dos vocabularios es el correcto. Eso lo decide Lucas.
 *
 * Sale con 1 si un filtro pide una columna que no existe (eso es HTTP 400 en
 * producción) o si hay un valor en los datos que el código no contempla.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { C, titulo, universo, testigos, consultar, pad, padN, columnasDelEsquema } from './_comun.mjs';

// ─── 1 · Las listas fijas del código ─────────────────────────────────────────
//
// Se leen de `costeo/modelo.ts` con una expresión regular porque este script es
// .mjs y no puede importar TypeScript. Los testigos verifican que la lectura
// salió bien: si alguien cambia la forma del archivo, el comando aborta en vez
// de reportar listas vacías.

const MODELO = readFileSync('src/modules/costeo/modelo.ts', 'utf8');

function listaDelCodigo(nombre) {
  const re = new RegExp(`export const ${nombre}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`, 'm');
  const m = MODELO.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function mapaDelCodigo(nombre) {
  const re = new RegExp(`export const ${nombre}[^=]*=\\s*\\{([\\s\\S]*?)\\}`, 'm');
  const m = MODELO.match(re);
  if (!m) return {};
  return Object.fromEntries([...m[1].matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map((x) => [x[1], x[2]]));
}

const LISTAS = {
  CATEGORIAS: listaDelCodigo('CATEGORIAS'),
  ROLES: listaDelCodigo('ROLES'),
  FAMILIAS_STOCK: listaDelCodigo('FAMILIAS_STOCK'),
  SUBCATEGORIAS_BEBIDA: listaDelCodigo('SUBCATEGORIAS_BEBIDA'),
  SUBCATEGORIAS_CAFETERIA: listaDelCodigo('SUBCATEGORIAS_CAFETERIA'),
};
const PUENTE_LOTE = mapaDelCodigo('CATEGORIA_DE_LOTE_POR_FAMILIA');

// Qué columna de la base guarda cada lista.
const DONDE = {
  CATEGORIAS: { tabla: 'cocina_recetas', col: 'categoria', filtro: "activo and tipo = 'receta'" },
  ROLES: { tabla: 'cocina_recetas', col: 'rol', filtro: "activo and tipo = 'subreceta'" },
  FAMILIAS_STOCK: { tabla: 'cocina_productos', col: 'familia_stock', filtro: 'true' },
  SUBCATEGORIAS_BEBIDA: { tabla: 'cocina_recetas', col: 'subcategoria', filtro: "activo and categoria = 'bebida'" },
  SUBCATEGORIAS_CAFETERIA: { tabla: 'cocina_recetas', col: 'subcategoria', filtro: "activo and categoria = 'cafeteria'" },
};

// ─── 2 · Los datos ───────────────────────────────────────────────────────────

const trozos = Object.entries(DONDE).map(
  ([lista, d]) => `
  select '${lista}' as lista, coalesce(${d.col}, '(vacío)') as valor,
         coalesce(local, '(sin local)') as local, count(*)::int as n
    from ${d.tabla} where ${d.filtro} group by 1, 2, 3`,
);
const filas = await consultar(trozos.join(' union all '));

// 💣 El puente `categoriaDeLote` NO va al pizarrón: va a los LOTES.
// `StockTab` compara `categoriaDeLote(familia)` contra
// `cocina_lotes_produccion.categoria` — ese es el cruce que dejó la sección
// "🥖 Panes" sin una fecha desde el 16-jun-2026, con 1.019 lotes cargados.
// (El `tipo` de `cocina_pizarron_items` es OTRO vocabulario, con sus propias
// secciones escritas a mano en PlanProduccionEditor.tsx. No cruza con este.)
const [{ lotes }] = await consultar(`
  select coalesce(json_agg(x), '[]'::json) as lotes from (
    select coalesce(categoria,'(vacío)') as categoria, coalesce(local,'(sin local)') as local,
           count(*)::int as n
      from cocina_lotes_produccion group by 1, 2) x`);

const cfg = await consultar(`
  select categoria, margen_min::float8 as piso, margen_colchon::float8 as franja
    from productos_costeo_config order by categoria`);

// Los cajones REALES: lo mismo que calcula cajonComercial() en modelo.ts.
const cajones = await consultar(`
  select case when tipo = 'subreceta'
              then case rol when 'salsa_base' then 'salsa' when 'postre_base' then 'postre'
                            when 'bebida_base' then 'bebida' when 'pasteleria_base' then 'pasteleria'
                            when 'panificado_base' then 'panificado' else coalesce(rol,'otros') end
              else coalesce(categoria,'otros') end as cajon,
         count(*) filter (where vendible)::int as vendibles,
         count(*) filter (where vendible and exists (
           select 1 from cocina_recetas_precios_canal pc
            where pc.receta_id = cocina_recetas.id and pc.canal = 'plato'))::int as con_precio
    from cocina_recetas where activo group by 1 order by 3 desc, 1`);

const LOCALES = [...new Set(filas.map((f) => f.local))].filter((l) => l !== '(sin local)').sort();

// ─── El universo ─────────────────────────────────────────────────────────────
titulo('vocabularios', 'Las listas fijas del código contra los datos reales, local por local.');
universo(
  `5 listas fijas leídas de src/modules/costeo/modelo.ts (${Object.values(LISTAS).flat().length} valores en total)`,
  `Datos: solo filas ACTIVAS. Locales encontrados: ${LOCALES.join(' · ')}`,
  'Categorías: solo recetas. Roles: solo subrecetas. Familias: cocina_productos entero.',
  'Chequeos 1 a 3: sólo modelo.ts. El 4 mira los filtros escritos adentro de cualquier .tsx.',
  'El 4 lee el esquema APLICADO (supabase/esquema-aplicado.sql): vistas y RPC quedan afuera.',
);

// ─── 4 · LOS FILTROS ESCRITOS A MANO ADENTRO DE UNA PANTALLA ─────────────────
//
// 💥 POR QUÉ SE AGREGÓ, el 12-sep-2026, con producción rota
//
// El Conteo de cámara (`/mostrador`) no mostró un solo producto en NINGUNO de
// los dos locales, y el cartel decía "No hay postres cargadas". No era un vacío:
//
//     GET /cocina_productos?...&tipo=eq.postre
//     → HTTP 400  "column cocina_productos.tipo does not exist"
//
// La migración 211 había retirado `cocina_productos.tipo` el día anterior, y
// cinco consultas en cuatro pantallas seguían pidiéndola. Y este comando —que
// existe justo para esto— NO lo agarró, porque leía `costeo/modelo.ts` y nada
// más, que es exactamente lo que declaraba no ver.
//
// 🔑 Dos razones por las que nada lo frenó antes:
//   · `tsc` no puede: el cliente de Supabase de este proyecto se crea sin el
//     genérico `Database`, así que `.eq('columna_que_no_existe', x)` compila.
//   · El vocabulario estaba escrito a mano adentro del .tsx, no en modelo.ts.
//
// QUÉ MIRA AHORA: cada `.from('tabla')` del código y los `.eq/.neq/.in` que le
// cuelgan, cruzados contra el esquema APLICADO y contra los datos.
//
//   🔴 la columna no existe en esa tabla  → la consulta devuelve HTTP 400
//   🟡 la columna existe y el valor no    → la pantalla filtra y queda vacía
//
// QUÉ **NO** MIRA, a propósito:
//   · El valor que llega por variable (`.eq('local', local)`): se juzga la
//     columna, nunca el valor. No se puede saber qué trae.
//   · Vistas y RPC: sólo conoce las tablas del volcado `create table`. Una
//     `.from('v_algo')` se saltea entera. Avisa de menos, nunca de más.
//   · Columnas de texto libre (nombre, código, notas…) y las `*_id`: el valor
//     no es vocabulario y contarlo sería ruido.
//   · Un filtro armado por un helper (como `porFamilia`) ya no tiene el nombre
//     de la columna escrito acá — y ése es el punto: convergido, no hay nada
//     que cazar.

const VENTANA_CADENA = 25;

// Columnas cuyo VALOR no es vocabulario: se chequea que existan, no qué dicen.
const NO_ES_VOCABULARIO =
  /^(id|.*_id|nombre|descripcion|detalle|notas|observaciones|codigo|email|telefono|direccion|url|fecha|periodo|hash.*|.*_at|texto_libre|responsable|cuil|cuit|dni)$/;

/**
 * Borra los comentarios dejando los saltos de línea, para que los números de
 * línea del reporte sigan apuntando al archivo de verdad.
 *
 * Un filtro escrito adentro de un comentario NO se ejecuta, así que no puede
 * romper nada. Mirarlo sólo produce ruido — y el ruido es lo que hace que un
 * comando del arnés se deje de leer.
 */
export function sinComentarios(txt) {
  let out = '';
  let i = 0;
  let comilla = null; // ' " ` cuando estamos adentro de un texto
  while (i < txt.length) {
    const c = txt[i];
    const d = txt[i + 1];
    if (comilla) {
      if (c === '\\') { out += txt.slice(i, i + 2); i += 2; continue; }
      if (c === comilla) comilla = null;
      out += c;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { comilla = c; out += c; i++; continue; }
    if (c === '/' && d === '/') {
      while (i < txt.length && txt[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < txt.length && !(txt[i] === '*' && txt[i + 1] === '/')) {
        out += txt[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Los filtros literales que cuelgan de cada `.from('tabla')` de un archivo.
 *
 * La cadena de Supabase se puede partir en varias líneas y hasta reasignarse a
 * una variable (`let q = supabase.from(...)` … `q = q.eq('tipo','postre')`),
 * que es JUSTO la forma que tenía el bug real. Por eso no se sigue la cadena
 * de llamadas: se toma la ventana de texto que va desde el `.from()` hasta el
 * `.from()` siguiente (o 25 líneas, lo que pase primero).
 *
 * Exportada para que los testigos la corran sobre código escrito a mano.
 */
export function filtrosDelArchivo(txt, ruta = 'testigo') {
  // 💣 Los comentarios se borran ANTES de mirar. En la primera corrida el
  // detector se marcó a sí mismo: el comentario que dejé en MostradorPage
  // explicando el bug cita `pq.eq('tipo', 'postre')`, y lo leyó como código.
  // Se reemplazan por espacios para no correr los números de línea.
  txt = sinComentarios(txt);
  const lineas = txt.split('\n');

  const arranques = [];
  for (let i = 0; i < lineas.length; i++) {
    for (const m of lineas[i].matchAll(/\.from\(\s*'([a-z0-9_]+)'\s*\)/gi)) {
      arranques.push({ tabla: m[1].toLowerCase(), desde: i });
    }
  }

  // 💣 Una consulta se puede guardar en una variable y USARSE MÁS ABAJO, ya
  // pasado otro `.from()`. La ventana sola se la atribuía a la tabla
  // equivocada: `marcasQuery.eq('evento','bienal')` en FicharPage es de
  // `fichadas`, y la ventana lo leía como `cronograma`, que no tiene esa
  // columna → un rojo inventado. Por eso primero se anota qué tabla tiene
  // cada variable, y eso le gana a la ventana.
  //
  // 💣 Y la ligadura es POR POSICIÓN, no por archivo. Un archivo reusa el
  // nombre `q` en cinco consultas distintas: quedarse con la última hacía que
  // `q.eq('local', …)` de la consulta de `gastos` se juzgara contra
  // `pagos_gastos`, que no tiene `local` → otro rojo inventado. Vale la
  // ligadura MÁS CERCANA HACIA ARRIBA.
  const ligaduras = new Map(); // nombre → [{ linea, tabla }]
  //
  // 💣 El puente entre el `=` y el `supabase` no puede ser `[\s\S]{0,80}?`: con
  // eso, un `let q2 = null;` alcanzaba el `supabase.from()` del renglón
  // siguiente y se quedaba con la ligadura ajena. Sólo se admite espacio, un
  // `await` y llamadas encadenadas.
  for (const m of txt.matchAll(
    /(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?supabase\s*(?:\.\w+\([^()]*\)\s*)*?\.from\(\s*'([a-z0-9_]+)'\s*\)/gi,
  )) {
    const linea = txt.slice(0, m.index).split('\n').length;
    if (!ligaduras.has(m[1])) ligaduras.set(m[1], []);
    ligaduras.get(m[1]).push({ linea, tabla: m[2].toLowerCase() });
  }

  // Qué tabla le corresponde a un filtro: manda la variable que lo invoca; si
  // no hay variable, la ventana. Si la variable existe pero no se sabe de qué
  // tabla es, no se juzga — avisar de menos antes que inventar un rojo.
  const tablaDelFiltro = (prefijo, tablaVentana, linea) => {
    if (!prefijo) return tablaVentana;
    const previas = (ligaduras.get(prefijo) ?? []).filter((x) => x.linea <= linea);
    return previas.length ? previas[previas.length - 1].tabla : null;
  };

  const out = [];
  for (let k = 0; k < arranques.length; k++) {
    const { tabla, desde } = arranques[k];
    const corte = arranques[k + 1]?.desde ?? lineas.length;
    const hasta = Math.min(corte, desde + VENTANA_CADENA);
    for (let i = desde; i < hasta; i++) {
      const l = lineas[i];
      // .eq('col', 'valor') — columna y valor, los dos literales.
      for (const m of l.matchAll(
        /(?:\b([A-Za-z_$][\w$]*))?\.(eq|neq)\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*\)/gi,
      )) {
        const t = tablaDelFiltro(m[1], tabla, i + 1);
        if (t) out.push({ ruta, linea: i + 1, tabla: t, columna: m[3].toLowerCase(), valor: m[4] });
      }
      // .in('col', ['a', 'b']) — cada elemento es un valor.
      for (const m of l.matchAll(
        /(?:\b([A-Za-z_$][\w$]*))?\.in\(\s*'([a-z0-9_]+)'\s*,\s*\[([^\]]*)\]/gi,
      )) {
        const t = tablaDelFiltro(m[1], tabla, i + 1);
        if (!t) continue;
        const col = m[2].toLowerCase();
        for (const v of m[3].matchAll(/'([^']*)'/g)) {
          out.push({ ruta, linea: i + 1, tabla: t, columna: col, valor: v[1] });
        }
      }
      // .eq('col', variable) y el resto de los operadores: la columna se puede
      // juzgar, el valor no. Se guarda con valor null.
      //
      // 💣 Acá había un lookahead NEGATIVO —`(?!['[])`— y contaba dos veces el
      // mismo filtro: `\s*` retrocedía hasta consumir cero espacios y entonces
      // el lookahead miraba el espacio, que no es comilla, y pasaba. Con un
      // lookahead POSITIVO que exige un carácter que no sea espacio, retroceder
      // no lo salva. Lo cazó el testigo antes de que el comando reportara nada.
      for (const m of l.matchAll(
        /(?:\b([A-Za-z_$][\w$]*))?\.(eq|neq|in|is|gt|gte|lt|lte|like|ilike|contains)\(\s*'([a-z0-9_]+)'\s*,\s*(?=[^\s'[])/gi,
      )) {
        const t = tablaDelFiltro(m[1], tabla, i + 1);
        if (t) out.push({ ruta, linea: i + 1, tabla: t, columna: m[3].toLowerCase(), valor: null });
      }
    }
  }
  return out;
}

function archivosDeSrc(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e).replace(/\\/g, '/');
    if (statSync(p).isDirectory()) archivosDeSrc(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const TABLAS_APLICADAS = columnasDelEsquema(readFileSync('supabase/esquema-aplicado.sql', 'utf8'));
const ARCHIVOS_SRC = archivosDeSrc('src');

const TODOS_LOS_FILTROS = [];
for (const ruta of ARCHIVOS_SRC) {
  TODOS_LOS_FILTROS.push(...filtrosDelArchivo(readFileSync(ruta, 'utf8'), ruta));
}

// 🔴 La columna no existe en esa tabla. La consulta devuelve HTTP 400 y la
// pantalla, si no distingue el error del vacío, lo muestra como "no hay nada".
const COLUMNAS_ROTAS = TODOS_LOS_FILTROS.filter(
  (f) => TABLAS_APLICADAS.has(f.tabla) && !TABLAS_APLICADAS.get(f.tabla).includes(f.columna),
);

// Las que sí existen y filtran por un valor de vocabulario: hay que ver si ese
// valor tiene filas, y en qué local.
const CANDIDATOS_VALOR = TODOS_LOS_FILTROS.filter(
  (f) =>
    f.valor !== null &&
    TABLAS_APLICADAS.has(f.tabla) &&
    TABLAS_APLICADAS.get(f.tabla).includes(f.columna) &&
    !NO_ES_VOCABULARIO.test(f.columna),
);

const PARES = [...new Set(CANDIDATOS_VALOR.map((f) => `${f.tabla}.${f.columna}`))].sort();

let datosPorPar = new Map();
if (PARES.length) {
  const trozos = PARES.map((par) => {
    const [tabla, columna] = par.split('.');
    const tieneLocal = TABLAS_APLICADAS.get(tabla).includes('local');
    const col = tieneLocal ? "coalesce(local, '(sin local)')" : "'(sin local)'";
    return `
      select '${par}' as par, coalesce(${columna}::text, '(sin valor)') as valor,
             ${col} as local, count(*)::int as n
        from ${tabla} group by 1, 2, 3`;
  });
  for (const f of await consultar(trozos.join(' union all '))) {
    if (!datosPorPar.has(f.par)) datosPorPar.set(f.par, []);
    datosPorPar.get(f.par).push(f);
  }
}

// 🟡 El valor no aparece en ninguna fila, o no aparece en un local. Se saltean
// los pares con muchísimos valores distintos: ahí el valor no es vocabulario.
const VALORES_HUERFANOS = [];
const VALORES_SIN_UN_LOCAL = [];
for (const f of CANDIDATOS_VALOR) {
  const par = `${f.tabla}.${f.columna}`;
  const filasDelPar = datosPorPar.get(par);
  if (!filasDelPar) continue;
  const distintos = new Set(filasDelPar.map((x) => x.valor)).size;
  if (distintos > 60) continue;
  const conEseValor = filasDelPar.filter((x) => x.valor === f.valor);
  const total = conEseValor.reduce((a, b) => a + b.n, 0);
  if (total === 0) {
    VALORES_HUERFANOS.push({ ...f, hay: [...new Set(filasDelPar.map((x) => x.valor))].sort() });
  } else if (f.columna !== 'local') {
    // La columna `local` queda afuera de esta comparación: filtrar por
    // `local = 'saavedra'` no tiene filas en Vedia POR DEFINICIÓN. Informarlo
    // es ruido, y el ruido es lo que hace que un comando se deje de leer.
    const locales = [...new Set(filasDelPar.map((x) => x.local))].filter((l) => l !== '(sin local)');
    const vacios = locales.filter((l) => !conEseValor.some((x) => x.local === l && x.n > 0));
    if (locales.length > 1 && vacios.length) VALORES_SIN_UN_LOCAL.push({ ...f, vacios, total });
  }
}

// ─── Los ejemplos de los testigos: código escrito a mano, no datos ──────────
//
// Reproducen el bug del 12-sep-2026 tal cual estaba escrito, en sus dos formas.
const ESQUEMA_TESTIGO = columnasDelEsquema(`
create table public.cocina_productos (
  id uuid not null,
  nombre text not null,
  familia_stock text not null,
  local text not null,
  activo boolean not null
);
create table public.cocina_recetas (
  id uuid not null,
  rol text,
  local text
);
`);

// La forma simple: el filtro en la cadena.
const EJEMPLO_ROTO = `
  const { data } = await supabase
    .from('cocina_productos')
    .select('id, nombre')
    .eq('activo', true)
    .eq('tipo', 'postre')
    .order('nombre');
`;

// 💣 La forma que tenía DE VERDAD en MostradorPage: la cadena se guarda en una
// variable y el filtro roto se agrega después, en un if. Si el detector sólo
// mirara la cadena pegada, éste se le escapaba — que es el caso que importa.
const EJEMPLO_ROTO_VARIABLE = `
  let pq = supabase
    .from('cocina_productos')
    .select('id, nombre, receta_id')
    .eq('activo', true)
    .eq('local', local);
  if (tipo === 'postre') {
    pq = pq.eq('tipo', 'postre');
  }
`;

const EJEMPLO_SANO = `
  const { data } = await supabase
    .from('cocina_productos')
    .select('id, nombre')
    .eq('activo', true)
    .eq('familia_stock', 'postre');
`;

// Dos consultas seguidas: el filtro de la segunda no es de la tabla de la primera.
const DOS_CONSULTAS = `
  const a = await supabase.from('cocina_productos').select('id').eq('familia_stock', 'pasta');
  const b = await supabase.from('cocina_recetas').select('id').eq('rol', 'salsa_base');
`;

// 💣 El detector se marcó a sí mismo en la primera corrida: el comentario que
// quedó en MostradorPage explicando el bug CITA el filtro roto.
const EJEMPLO_EN_COMENTARIO = `
  const q = supabase.from('cocina_productos').select('id');
  // 💥 Acá decía \`pq.eq('tipo', 'postre')\` y la 211 borró esa columna.
  /* También así: .eq('tipo', 'pasta') */
`;

// 💣 El otro falso positivo: la consulta se guarda arriba y se usa DESPUÉS de
// otro .from(). Tal cual está escrito en FicharPage: `marcasQuery` es de
// `fichadas`, pero entre su definición y su uso hay un .from('cronograma').
const EJEMPLO_VARIABLE_LEJOS = `
  const marcasQuery = supabase
    .from('fichadas')
    .select('id, tipo')
    .eq('empleado_id', empleado.id);
  const cronoDia = (fecha) =>
    supabase
      .from('cronograma')
      .select('hora_entrada')
      .eq('fecha', fecha)
      .maybeSingle();
  const [a, b] = await Promise.all([
    marcasQuery.eq('evento', 'bienal').order('timestamp'),
    cronoDia(hoy),
  ]);
`;

// 💣 Y el tercero: el mismo nombre `q` para dos consultas distintas del mismo
// archivo. Quedarse con la última ligadura le achacaba a `pagos_gastos` un
// filtro que era de `gastos`. Tal cual está en ComprasPage y ConciliacionTab.
const EJEMPLO_Q_REUSADA = `
  function unaConsulta() {
    let q = supabase.from('gastos').select('*');
    q = q.eq('local', 'vedia');
    return q;
  }
  function otraConsulta() {
    let vacio = null;
    let q = supabase.from('pagos_gastos').select('id');
    q = q.neq('medio_pago', 'efectivo');
    return q;
  }
`;

// ─── Los testigos ────────────────────────────────────────────────────────────
const valoresDe = (lista) => new Set(filas.filter((f) => f.lista === lista).map((f) => f.valor));
testigos([
  {
    que: 'La lectura de modelo.ts trae las 8 categorías y "pasta" es una',
    espera: '8/sí',
    obtuvo: `${LISTAS.CATEGORIAS.length}/${LISTAS.CATEGORIAS.includes('pasta') ? 'sí' : 'no'}`,
  },
  {
    que: 'La lectura de modelo.ts trae los 12 roles',
    espera: 12,
    obtuvo: LISTAS.ROLES.length,
  },
  {
    que: 'El puente de lotes traduce panificado → panaderia',
    espera: 'panaderia',
    obtuvo: PUENTE_LOTE.panificado ?? 'NO LO ENCONTRÓ',
  },
  {
    que: 'En los datos hay recetas de categoría "pasta"',
    espera: true,
    obtuvo: valoresDe('CATEGORIAS').has('pasta'),
  },
  {
    que: 'Los lotes guardan "panaderia" donde el producto dice "panificado"',
    espera: true,
    obtuvo: lotes.some((l) => l.categoria === 'panaderia'),
  },
  {
    que: 'Y NO guardan "panificado": si lo guardaran, el puente sobraría',
    espera: false,
    obtuvo: lotes.some((l) => l.categoria === 'panificado'),
  },
  // ── Los filtros escritos adentro de una pantalla ──────────────────────────
  // Código escrito a mano, no datos: prueban el MÉTODO. El esquema de prueba
  // dice que `cocina_productos` tiene `familia_stock` y NO tiene `tipo`, que
  // es exactamente lo que pasó el 11-sep con la migración 211.
  {
    que: '💣 ESTE caso: .eq(\'tipo\', \'postre\') sobre una tabla que ya no tiene esa columna',
    espera: 'tipo',
    obtuvo:
      filtrosDelArchivo(EJEMPLO_ROTO)
        .filter((f) => !ESQUEMA_TESTIGO.get(f.tabla).includes(f.columna))
        .map((f) => f.columna)
        .join(',') || 'NO LO VIO',
  },
  {
    que: '💣 Y en la forma REAL que tenía: la cadena reasignada a una variable',
    espera: 'tipo',
    obtuvo:
      filtrosDelArchivo(EJEMPLO_ROTO_VARIABLE)
        .filter((f) => !ESQUEMA_TESTIGO.get(f.tabla).includes(f.columna))
        .map((f) => f.columna)
        .join(',') || 'NO LO VIO',
  },
  {
    que: '🔑 El mismo filtro ya arreglado no reporta nada',
    espera: 0,
    obtuvo: filtrosDelArchivo(EJEMPLO_SANO).filter(
      (f) => !ESQUEMA_TESTIGO.get(f.tabla).includes(f.columna),
    ).length,
  },
  {
    que: 'Un valor que llega por variable se mira la columna, pero el valor queda en null',
    espera: 'local/null',
    obtuvo: (() => {
      const f = filtrosDelArchivo("supabase.from('cocina_productos').eq('local', local)")[0];
      return f ? `${f.columna}/${f.valor === null ? 'null' : f.valor}` : 'NO LO VIO';
    })(),
  },
  {
    que: 'Un .in() aporta un valor por elemento de la lista',
    espera: 2,
    obtuvo: filtrosDelArchivo(
      "supabase.from('cocina_recetas').in('rol', ['salsa_base', 'milanesa_base'])",
    ).filter((f) => f.valor !== null).length,
  },
  {
    que: '🔑 El .eq() de la segunda consulta NO se le atribuye a la tabla de la primera',
    espera: 'cocina_recetas',
    obtuvo:
      filtrosDelArchivo(DOS_CONSULTAS).find((f) => f.valor === 'salsa_base')?.tabla ??
      'NO LO VIO',
  },
  {
    que: 'Una tabla que el esquema no conoce (una vista) no se juzga: avisa de menos',
    espera: 0,
    obtuvo: filtrosDelArchivo("supabase.from('v_cocina_stock_pastas').eq('inventado', 'x')").filter(
      (f) => ESQUEMA_TESTIGO.has(f.tabla),
    ).length,
  },
  {
    que: 'En el repo de verdad, cocina_productos ya NO tiene la columna tipo',
    espera: false,
    obtuvo: (TABLAS_APLICADAS.get('cocina_productos') ?? []).includes('tipo'),
  },
  // ── Los dos falsos positivos que tiró la primera corrida sobre el repo ────
  {
    que: '💣 Un filtro escrito adentro de un COMENTARIO no se cuenta: no se ejecuta',
    espera: 0,
    obtuvo: filtrosDelArchivo(EJEMPLO_EN_COMENTARIO).length,
  },
  {
    que: '💣 Una consulta guardada en variable se juzga por SU tabla, no por el .from() de arriba',
    espera: 'fichadas',
    obtuvo:
      filtrosDelArchivo(EJEMPLO_VARIABLE_LEJOS).find((f) => f.valor === 'bienal')?.tabla ??
      'NO LO VIO',
  },
  {
    que: '💣 El mismo nombre `q` para dos consultas: vale la ligadura más cercana HACIA ARRIBA',
    espera: 'gastos/pagos_gastos',
    obtuvo: (() => {
      const f = filtrosDelArchivo(EJEMPLO_Q_REUSADA);
      const a = f.find((x) => x.valor === 'vedia')?.tabla ?? '?';
      const b = f.find((x) => x.valor === 'efectivo')?.tabla ?? '?';
      return `${a}/${b}`;
    })(),
  },
]);

// ─── Chequeo 1 · cada lista contra los datos, por local ──────────────────────
console.log('');
console.log(C.neg('1 · LAS LISTAS DEL CÓDIGO CONTRA LOS DATOS, POR LOCAL'));
let vaciasEnAlgunLocal = 0;
for (const [lista, valores] of Object.entries(LISTAS)) {
  const d = DONDE[lista];
  console.log('');
  console.log(`  ${C.neg(lista)} ${C.gris(`— ${d.tabla}.${d.col}`)}`);
  console.log(C.gris(`    ${pad('valor', 24)}${LOCALES.map((l) => padN(l, 12)).join('')}`));
  for (const v of valores) {
    const porLocal = LOCALES.map(
      (l) => filas.find((f) => f.lista === lista && f.valor === v && f.local === l)?.n ?? 0,
    );
    const total = porLocal.reduce((a, b) => a + b, 0);
    // Que Vedia no tenga panadería no es un error: es el negocio. Se informa
    // en gris. La alarma es el valor que NO EXISTE EN NINGÚN LOCAL: ese es una
    // opción que la pantalla ofrece y no le corresponde ninguna fila.
    const vacioEnAlguno = total > 0 && porLocal.some((n) => n === 0);
    if (total === 0) vaciasEnAlgunLocal++;
    const soloEn = LOCALES.filter((_, i) => porLocal[i] > 0).join(' y ');
    const marca =
      total === 0
        ? C.amar('  ⚠ la pantalla lo ofrece y no hay ni una fila')
        : vacioEnAlguno
          ? C.gris(`  solo ${soloEn}`)
          : '';
    console.log(
      `    ${pad(v, 24)}${porLocal.map((n) => padN(n === 0 ? '·' : n, 12)).join('')}${marca}`,
    );
  }
}

// ─── Chequeo 2 · valores en los datos que el código no contempla ─────────────
console.log('');
console.log(C.neg('2 · VALORES EN LOS DATOS QUE LA LISTA DEL CÓDIGO NO TIENE'));
console.log(C.gris('   Este es el que rompe en silencio: el código ni los contempla.'));
const huerfanos = [];
for (const [lista, valores] of Object.entries(LISTAS)) {
  const permitidos = new Set([...valores, '(vacío)']);
  for (const f of filas.filter((x) => x.lista === lista && !permitidos.has(x.valor))) {
    huerfanos.push({ ...f });
  }
}
if (huerfanos.length === 0) console.log(C.verde('   ✓ ninguno: los datos no usan un valor que el código desconozca'));
for (const h of huerfanos) {
  console.log(C.rojo(`   ${pad(h.lista, 24)} ${pad(h.valor, 22)} ${pad(h.local, 10)} ${h.n} filas`));
}

// ─── Chequeo 3 · los cuatro vocabularios que se cruzan ───────────────────────
console.log('');
console.log(C.neg('3 · LOS VOCABULARIOS QUE SE TIENEN QUE CRUZAR'));
console.log(C.gris('   cocina_productos.familia_stock → categoriaDeLote() → cocina_lotes_produccion.categoria'));
console.log(C.gris('   Este es el cruce que dejó "🥖 Panes" sin una fecha durante tres meses.'));
console.log('');
console.log(C.gris(`   ${pad('familia del producto', 22)}${pad('busca lotes de', 18)}${padN('lotes', 8)}`));
const catLotes = new Set(lotes.map((l) => l.categoria));
let sinLotes = 0;
for (const fam of LISTAS.FAMILIAS_STOCK) {
  const destino = PUENTE_LOTE[fam] ?? fam;
  const n = lotes.filter((l) => l.categoria === destino).reduce((a, b) => a + b.n, 0);
  if (n === 0) sinLotes++;
  console.log(
    `   ${pad(fam, 22)}${pad(destino, 18)}${padN(n || '—', 8)}` +
      (destino !== fam ? C.amar('   ← traducido por el puente') : '') +
      (n === 0 ? C.amar('   ⚠ ni un lote: la sección va a salir vacía') : ''),
  );
}
const sinFamilia = [...catLotes].filter(
  (t) => t !== '(vacío)' && !LISTAS.FAMILIAS_STOCK.some((f) => (PUENTE_LOTE[f] ?? f) === t),
);
if (sinFamilia.length) {
  console.log('');
  console.log(C.amar(`   ⚠ categorías de lote que NINGUNA familia produce: ${sinFamilia.join(' · ')}`));
  console.log(C.gris('     Son lotes que ninguna sección de Stock va a encontrar.'));
}

// ─── Chequeo 4 · los pisos de margen ─────────────────────────────────────────
console.log('');
console.log(C.neg('4 · PISOS DE MARGEN — productos_costeo_config'));
console.log(C.gris('   El semáforo busca por CAJÓN (cajonComercial). Lo que no coincide, cae al default.'));
console.log('');
const porCajon = new Map(cajones.map((c) => [c.cajon, c]));
const cfgPorCat = new Map(cfg.map((c) => [c.categoria, c]));
console.log(
  C.gris(`   ${pad('cajón', 18)}${padN('piso', 7)}${padN('franja', 8)}${padN('verde desde', 13)}${padN('con precio', 12)}`),
);
const sobran = [];
for (const c of cfg) {
  const uso = porCajon.get(c.categoria);
  const esDefault = c.categoria === 'default';
  const n = uso?.con_precio ?? 0;
  if (!esDefault && n === 0) sobran.push(c.categoria);
  console.log(
    `   ${pad(c.categoria, 18)}${padN((c.piso * 100).toFixed(0) + '%', 7)}${padN((c.franja * 100).toFixed(0) + '%', 8)}` +
      `${padN(((c.piso + c.franja) * 100).toFixed(0) + '%', 13)}${padN(esDefault ? '—' : n || '·', 12)}` +
      (esDefault ? C.gris('   el que agarra a los que no tienen fila') : n === 0 ? C.amar('   ⚠ no aplica a ningún plato') : ''),
  );
}
const faltan = cajones.filter((c) => c.con_precio > 0 && !cfgPorCat.has(c.cajon));
if (faltan.length) {
  console.log('');
  console.log(C.amar('   ⚠ CAJONES CON PLATOS A LA VENTA Y SIN PISO PROPIO — caen al default:'));
  for (const f of faltan) {
    console.log(C.amar(`     ${pad(f.cajon, 18)} ${padN(f.con_precio, 4)} platos con precio`));
  }
}

// ─── Chequeo 4 · los filtros escritos a mano adentro de una pantalla ────────
console.log('');
console.log(C.neg('4 · LOS FILTROS ESCRITOS A MANO ADENTRO DE UNA PANTALLA'));
console.log(
  C.gris(
    `   ${TODOS_LOS_FILTROS.length} filtros sobre ${
      new Set(TODOS_LOS_FILTROS.map((f) => f.tabla)).size
    } tablas nombradas · ${PARES.length} par(es) tabla.columna con valor de vocabulario`,
  ),
);

if (COLUMNAS_ROTAS.length) {
  console.log('');
  console.log(C.rojo('   🔴 LA COLUMNA NO EXISTE — esa consulta devuelve HTTP 400:'));
  for (const f of COLUMNAS_ROTAS) {
    console.log(
      C.rojo(
        `     ${pad(f.ruta.replace('src/modules/', ''), 52)} :${padN(f.linea, 5)}  ` +
          `${f.tabla}.${C.neg(f.columna)}${f.valor === null ? '' : ` = '${f.valor}'`}`,
      ),
    );
  }
  console.log(
    C.gris(
      `     Las columnas que SÍ tiene: ${[...new Set(COLUMNAS_ROTAS.map((f) => f.tabla))]
        .map((t) => `${t} → ${TABLAS_APLICADAS.get(t).join(', ')}`)
        .join(' | ')}`,
    ),
  );
} else {
  console.log(C.verde('   ✓ Ningún filtro pide una columna que no existe.'));
}

if (VALORES_HUERFANOS.length) {
  console.log('');
  console.log(C.amar('   🟡 EL VALOR NO TIENE NI UNA FILA — la pantalla filtra y queda vacía:'));
  for (const f of VALORES_HUERFANOS) {
    console.log(
      C.amar(
        `     ${pad(f.ruta.replace('src/modules/', ''), 52)} :${padN(f.linea, 5)}  ` +
          `${f.tabla}.${f.columna} = '${f.valor}'`,
      ),
    );
    console.log(C.gris(`       los valores que hay: ${f.hay.join(' · ')}`));
  }
}

if (VALORES_SIN_UN_LOCAL.length) {
  console.log('');
  console.log(C.gris('   Filtran por un valor que existe pero falta en algún local:'));
  for (const f of VALORES_SIN_UN_LOCAL) {
    console.log(
      C.gris(
        `     ${pad(f.ruta.replace('src/modules/', ''), 52)} :${padN(f.linea, 5)}  ` +
          `${f.tabla}.${f.columna} = '${f.valor}' — sin filas en ${f.vacios.join(' y ')}`,
      ),
    );
  }
}

console.log('');
// 💥 Esto corta PRIMERO: una columna que no existe no es un desajuste de
// vocabulario, es una pantalla caída. PostgREST devuelve HTTP 400 y, si el
// código no distingue el error del vacío, se ve como "no hay nada cargado".
if (COLUMNAS_ROTAS.length) {
  console.log(
    C.rojo(
      `⛔ ${COLUMNAS_ROTAS.length} filtro(s) piden una columna que NO EXISTE. Eso es HTTP 400 en producción.`,
    ),
  );
  process.exit(1);
}
if (huerfanos.length) {
  console.log(C.rojo(`⛔ ${huerfanos.length} valor(es) en los datos que el código no contempla.`));
  process.exit(1);
}
console.log(
  C.gris(
    `Sin valores desconocidos. ${vaciasEnAlgunLocal} valor(es) que la pantalla ofrece sin una sola fila, ${sinLotes} familia(s) sin lotes y ${sobran.length + faltan.length} desajuste(s) de piso: listas para decidir, no errores.`,
  ),
);
