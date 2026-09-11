/**
 * El costo guardado de cada insumo contra la SERIE de sus facturas.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE, Y POR QUÉ LA SERIE Y NO UNA FACTURA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Tres veces en una semana apareció el mismo error: alguien carga en el costo
 * del insumo el SUBTOTAL del renglón de la factura en vez del precio unitario.
 * El Morrón Rojo estuvo al doble ($6.000 en vez de $3.000) y se llevó puesta
 * la Pizza Especial SG.
 *
 * 💣 Pero comparar contra UNA factura da falsos positivos que cuestan caro.
 * La Palta tenía $8.000 cargados y una factura vieja de 2 kg × $4.000 = $8.000.
 * Parecía la misma firma. No lo era: $8.000 es el precio por kilo de la factura
 * MÁS RECIENTE y el más repetido de las 14. Corregirla a $4.000 habría sacado a
 * las Tostadas Proteicas del rojo sin que nada mejorara de verdad.
 *
 * 🔑 **Un costo se compara contra la serie entera, no contra una factura.**
 * Por eso este comando muestra la serie y no un veredicto solo.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LOS CUATRO CAJONES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   🔴 error de carga   el costo coincide con el SUBTOTAL de un renglón de 2 o
 *                       más unidades, y NO se parece a ningún precio unitario
 *                       de la serie. Esa es la firma, y la Palta no la cumple.
 *   🟠 hay bulto        el costo es una fracción pareja del precio de factura
 *                       en toda la serie: se compra por paquete.
 *                       ⚠️ el TAMAÑO del paquete no se deduce de acá — ver la
 *                       migración 215: las servilletas dan de 874 a 1.431 y el
 *                       paquete es de 1.000 siempre. Lo que cambia es el precio.
 *   🟡 desfasado        el costo quedó lejos de la última factura, sin múltiplo
 *                       redondo de por medio. Es precio viejo, no error.
 *   🟢 al día           el costo es el precio unitario de la última factura.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Los insumos sin ninguna factura enganchada: sobre esos no dice nada.
 *   · Si el renglón de la factura está enganchado al insumo equivocado.
 *   · El tamaño del bulto (ver arriba).
 *   · Renglones de factura mal cargados: los ve como ruido de la serie.
 *
 * Nunca sale con código de error: es una lista para decidir, no un semáforo
 * de CI. Va a mano.
 */

import { C, titulo, universo, testigos, consultar, plata, pad, padN } from './_comun.mjs';

// ─── Renglones de factura ya revisados ───────────────────────────────────────
//
// Esta lista existe para que nadie los vuelva a "arreglar". Son renglones de
// `gastos.items_json`, no insumos: el costo del insumo está bien y el que está
// mal es el renglón. Ensucian la serie que mira este comando y nada más —
// ningún total de compras ni de gastos los suma (`items_json` se lee en 3
// archivos y solo para volver a editar el gasto).
const RENGLONES_REVISADOS = [
  {
    estado: 'mal',
    insumo: 'Bolsa zipper 15*20 x 100ud.',
    fecha: '2026-09-08',
    dice: '200 unid. × $29,3428',
    porque:
      'mismo subtotal que los renglones de 100 ($5.868,56) con el doble de cantidad. ' +
      'En esa MISMA factura los otros 5 renglones coinciden exacto con su costo guardado: ' +
      'el proveedor no cambió de criterio, se cargó mal la cantidad. El precio real es $58,69.',
  },
  {
    estado: 'mal',
    insumo: 'Ricota',
    fecha: '2026-07-24',
    dice: '0,29 kg × $13.294,59',
    porque:
      '0,29 kg de ricota por $3.855 no existe. $3.855,43 ÷ $2.198,44 = 1,754 kg: el precio ' +
      'guardado parece el bueno y la cantidad la equivocada. Es la ÚNICA factura del insumo, ' +
      'así que no hay serie contra la cual medir. Ninguna receta usa ricota: impacto cero.',
  },
  {
    estado: 'bien',
    insumo: 'Caja Carton 18*18 x100ud · Caja Carton Pizza 25*25 x100ud',
    fecha: '2026-06-12 y 2026-06-16',
    dice: '1 y 2 unid. × $16.112 y $23.883',
    porque:
      'los reporté como error y NO lo son. RESIPACK vende por caja de 100: $16.112 ÷ 100 = ' +
      '$161,12 por cartón contra $169,17 guardados, un 5 % de precio viejo. Lo que daba ×95 ' +
      'era el detector, no la carga.',
  },
];

const SQL = `
with lineas as (
  select g.fecha, g.proveedor,
         (e.value->>'producto_id')::uuid as pid,
         (e.value->>'cantidad')::numeric as cant,
         (e.value->>'precio_unitario')::numeric as pu,
         (e.value->>'subtotal')::numeric as sub
  from gastos g, lateral jsonb_array_elements(g.items_json) e
  where jsonb_typeof(g.items_json) = 'array'
    and e.value->>'producto_id' is not null
    and coalesce((e.value->>'cantidad')::numeric, 0) > 0
    and coalesce((e.value->>'precio_unitario')::numeric, 0) > 0
)
select p.id, p.nombre, p.local, p.unidad,
       p.costo_unitario::float8 as costo,
       p.bulto_cantidad::float8 as bulto,
       (select count(*) from lineas l where l.pid = p.id)::int as n,
       (select json_agg(json_build_object(
                 'fecha', x.fecha, 'prov', x.proveedor,
                 'cant', x.cant::float8, 'pu', x.pu::float8, 'sub', x.sub::float8))
          from (select * from lineas l where l.pid = p.id order by l.fecha desc limit 8) x
       ) as serie
from productos p
where p.activo and coalesce(p.costo_unitario, 0) > 0
order by p.nombre, p.local
`;

const filas = await consultar(SQL);

const cerca = (a, b, tol) => Math.abs(a / b - 1) <= tol;

const mediana = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/**
 * 💣 Acá estuvo el error que casi se me escapa, y lo dejo escrito porque es
 * la trampa de este comando entero.
 *
 * La primera versión eximía al insumo si su costo se parecía a ALGÚN precio
 * unitario de la serie. Con esa regla la Palta quedaba bien… **y el Morrón
 * Rojo también**, porque entre sus 15 facturas hay UNA del 7-jul a $6.000 el
 * kilo. O sea: el comando escrito para cazar al Morrón no cazaba al Morrón.
 *
 * Lo que de verdad los separa no es "alguna factura", es CUÁL:
 *   · Palta  $8.000 = el unitario de la factura MÁS RECIENTE  → al día.
 *   · Morrón $6.000 ≠ el unitario de la más reciente ($3.000),
 *              ≠ la mediana de la serie ($3.000),
 *              = el SUBTOTAL de esa misma factura (2 kg × $3.000) → error.
 *
 * Una factura suelta a $6.000 en julio es un precio que pasó, no la firma.
 */
export function clasificar(f) {
  const serie = f.serie ?? [];
  if (serie.length === 0) return { cajon: 'sin_factura' };

  const ult = serie[0];
  const razonUlt = ult.pu / f.costo;
  const med = mediana(serie.map((l) => l.pu));

  // 🟢 el costo ES el precio unitario de la última factura. Nada más que discutir.
  if (cerca(f.costo, ult.pu, 0.1)) return { cajon: 'al_dia', ult, razonUlt, med };

  // 🔴 el costo es el subtotal de un renglón de 2 o más, y está lejos del precio
  // que de verdad se paga (la mediana de la serie).
  const comoSubtotal = serie.find((l) => l.cant >= 2 && cerca(f.costo, l.sub, 0.02));
  if (comoSubtotal && !cerca(f.costo, med, 0.15)) {
    return { cajon: 'error_carga', ult, razonUlt, med, evidencia: comoSubtotal };
  }

  // 🟠 toda la serie cobra un múltiplo parejo del costo → se compra por paquete.
  //
  // 💣 Hacen falta 3 facturas o más. Con una sola, "viene en paquete" y "subió
  // el precio un 60 %" son el mismo número y no hay forma de distinguirlos: el
  // Escobillón con una factura a 1,54× no es un paquete de dos escobillones.
  // Con menos de 3 el insumo cae en "desfasado", que es lo que se puede afirmar.
  const razones = serie.map((l) => l.pu / f.costo);
  if (serie.length >= 3 && Math.min(...razones) >= 1.5) {
    return { cajon: 'bulto', ult, razonUlt, med, rmin: Math.min(...razones), rmax: Math.max(...razones) };
  }

  return { cajon: 'desfasado', ult, razonUlt, med };
}

for (const f of filas) f.v = clasificar(f);

const de = (c) => filas.filter((f) => f.v.cajon === c);
const buscar = (nombre, local) => filas.find((f) => f.nombre === nombre && f.local === local);

// ── El universo ──────────────────────────────────────────────────────────────
titulo('costos', 'El costo de cada insumo contra la serie entera de sus facturas.');
universo(
  `${filas.length} insumos ACTIVOS con costo cargado (productos.activo = true, costo_unitario > 0)`,
  'Facturas: renglones de gastos.items_json con producto_id, cantidad > 0 y precio unitario > 0',
  'Se compara contra TODA la serie, no contra la última factura. La última solo ordena la lista.',
  'No mira recetas: no dice cuánta plata mueve cada desvío.',
);

// ── Los testigos ─────────────────────────────────────────────────────────────
const kraft5 = buscar('Bolsa Papel Kraft Nº5 30*11*20', 'saavedra');
const palta = buscar('Palta', 'saavedra');
const servi = buscar('Servilleta (24x24cm, c/u)', 'vedia');
// El Morrón ya está corregido en la base, así que su serie de antes va a mano:
// es la prueba de que el comando SÍ habría cazado el caso que lo motivó.
const MORRON_COMO_ESTABA = {
  costo: 6000,
  serie: [
    { fecha: '2026-08-18', prov: 'El Eden', cant: 2, pu: 3000, sub: 6000 },
    { fecha: '2026-08-11', prov: 'El Eden', cant: 2, pu: 2800, sub: 5600 },
    { fecha: '2026-07-31', prov: 'El Eden', cant: 3, pu: 3000, sub: 9000 },
    { fecha: '2026-07-07', prov: 'Piceda', cant: 4, pu: 6000, sub: 24000 },
    { fecha: '2026-07-01', prov: 'Piceda', cant: 3, pu: 4000, sub: 12000 },
    { fecha: '2026-06-23', prov: 'Piceda', cant: 5, pu: 4000, sub: 20000 },
    { fecha: '2026-06-16', prov: 'Piceda', cant: 4, pu: 4000, sub: 16000 },
    { fecha: '2026-06-09', prov: 'Piceda', cant: 5, pu: 4000, sub: 20000 },
  ],
};

testigos([
  {
    que: 'Kraft Nº5 a $101,07 calza con sus facturas',
    espera: 'al_dia',
    obtuvo: kraft5?.v.cajon ?? 'NO ESTÁ',
  },
  {
    que: 'La Palta NO es error de carga: su costo es el unitario de la última factura',
    espera: 'al_dia',
    obtuvo: palta?.v.cajon ?? 'NO ESTÁ',
  },
  {
    que: 'La servilleta de Vedia se compra por paquete',
    espera: 'bulto',
    obtuvo: servi?.v.cajon ?? 'NO ESTÁ',
  },
  {
    que: 'El Morrón como estaba el 11-sep ($6.000, con una factura suelta a $6.000) cae en rojo',
    espera: 'error_carga',
    obtuvo: clasificar(MORRON_COMO_ESTABA).cajon,
  },
  {
    que: 'El Morrón ya corregido a $3.000 sale del rojo',
    espera: 'al_dia',
    obtuvo: clasificar({ ...MORRON_COMO_ESTABA, costo: 3000 }).cajon,
  },
]);

// ── El reporte ───────────────────────────────────────────────────────────────
console.log('');
console.log(C.neg('RESUMEN'));
for (const [c, etq, col] of [
  ['error_carga', '🔴 error de carga', C.rojo],
  ['bulto', '🟠 hay bulto', C.amar],
  ['desfasado', '🟡 desfasado (precio viejo)', C.amar],
  ['al_dia', '🟢 al día', C.verde],
  ['sin_factura', '⚪ sin ninguna factura', C.gris],
]) {
  console.log(`  ${col(padN(de(c).length, 4))}  ${etq}`);
}

function renglonSerie(l) {
  return `${l.fecha}  ${pad(l.prov, 26)} ${padN(l.cant, 7)} × ${padN(plata(l.pu), 13)} = ${padN(plata(l.sub), 13)}`;
}

function mostrar(c, titu, cuantos = 99) {
  const g = de(c).sort((a, b) => Math.abs(b.v.razonUlt - 1) - Math.abs(a.v.razonUlt - 1));
  if (!g.length) return;
  console.log('');
  console.log(C.neg(titu) + C.gris(`  (${g.length})`));
  for (const f of g.slice(0, cuantos)) {
    console.log('');
    console.log(
      `  ${C.neg(pad(f.nombre, 38))} ${pad(f.local, 9)} guardado ${padN(plata(f.costo), 13)} /${f.unidad}` +
        (f.bulto ? C.gris(`   bulto ${f.bulto}`) : ''),
    );
    for (const l of (f.serie ?? []).slice(0, 3)) console.log(C.gris('      ' + renglonSerie(l)));
    if (f.n > 3) console.log(C.gris(`      … ${f.n - 3} facturas más`));
  }
}

mostrar('error_carga', '🔴 ERROR DE CARGA — el costo es el subtotal de un renglón');
mostrar('bulto', '🟠 HAY BULTO — la factura cobra el paquete');
mostrar('desfasado', '🟡 DESFASADO — el costo quedó lejos de la última factura', 25);

const desf = de('desfasado');
if (desf.length > 25) {
  console.log('');
  console.log(C.gris(`  … y ${desf.length - 25} desfasados más, ordenados de mayor a menor desvío.`));
}

console.log('');
console.log(C.neg('RENGLONES DE FACTURA YA REVISADOS') + C.gris('  (no los toques de nuevo)'));
for (const r of RENGLONES_REVISADOS) {
  const marca = r.estado === 'mal' ? C.rojo('✗ mal cargado') : C.verde('✓ está bien');
  console.log('');
  console.log(`  ${marca}  ${C.neg(r.insumo)}`);
  console.log(C.gris(`     ${r.fecha} · ${r.dice}`));
  console.log(C.gris(`     ${r.porque}`));
}

console.log('');
console.log(C.gris('Sin código de error: esto es una lista para decidir, no un semáforo.'));
