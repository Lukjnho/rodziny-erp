/**
 * ¿Qué campos de PLATA no pasan por la única puerta?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 💣 En Argentina se tipea `15.000` para quince mil pesos: el punto es
 * SEPARADOR DE MILES. Y Postgres devuelve `2350.50`, donde el punto es DECIMAL.
 * Son dos caminos opuestos y mezclarlos es un bug de plata, no de estilo.
 *
 * Lo que rompió: se hacía `String(valor)` sobre un número de la base y después
 * se lo leía con el parser de tipeo, que le borra el punto. Un precio de
 * `2350.50` se guardaba como `23505` — **diez veces más grande**. En el editor
 * de la carta alcanzaba con entrar al campo y salir, sin escribir nada.
 *
 * La regla de CLAUDE.md: todo campo donde se escribe plata usa `<MontoInput>`,
 * que guarda `number | null` y sabe cuál de los dos caminos usar. Nunca un
 * `<input>` suelto, nunca `type="number"`, nunca un parser propio.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * QUÉ **NO** DETECTA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   · Si el número que se guarda es el CORRECTO. Sólo mira por qué puerta entra.
 *   · Un campo de plata cuyo nombre no suene a plata. La detección es por
 *     nombre y por eso puede perderse alguno: **avisa de menos, nunca de más**.
 *   · Las cantidades de cocina (kg, porciones), que usan la regla CONTRARIA y
 *     viven en `lib/numero.ts`. Un `type="number"` ahí está bien y se ignora.
 *   · Lo que se escribe desde un importador o un script, que no pasa por un
 *     campo de la pantalla.
 *
 * Sale con 1 si aparece la mezcla de los dos caminos, que es el bug caro.
 * Los `type="number"` sobre plata se listan y no cortan: son deuda conocida.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { C, titulo, universo, testigos, pad, padN } from './_comun.mjs';

// Cómo se llama la plata en este proyecto. Sale de mirar las columnas reales,
// no de imaginar: monto, importe, precio, costo, saldo, total, sueldo, pago…
const SUENA_A_PLATA =
  /(monto|importe|precio|costo|saldo|total|sueldo|haber|pago|efectivo|deposito|dividendo|adelanto|bono|descuento|comision|iva|neto|bruto|arqueo|retiro|gasto)/i;

// 💣 El bug caro: un valor que viene de la base convertido a texto y vuelto a
// leer con el parser de TIPEO. Cualquiera de estas dos formas.
const MEZCLA_DE_CAMINOS = [
  { patron: /montoDesdeTipeo\(\s*String\(/g, que: 'montoDesdeTipeo(String(...)) — el clásico ×10' },
  { patron: /montoDesdeTipeo\(\s*`\$\{/g, que: 'montoDesdeTipeo(`${...}`) — lo mismo con plantilla' },
  { patron: /montoDesdeTipeo\(\s*montoADisplay\(/g, que: 'montoDesdeTipeo(montoADisplay(...)) — ida y vuelta' },
];

/** Devuelve los hallazgos de un archivo. Exportada para que el testigo la use. */
export function revisar(txt, ruta = 'testigo') {
  const out = { mezcla: [], numberPlata: [], parserPropio: [] };
  const lineas = txt.split('\n');

  for (const { patron, que } of MEZCLA_DE_CAMINOS) {
    for (const m of txt.matchAll(patron)) {
      out.mezcla.push({ ruta, linea: txt.slice(0, m.index).split('\n').length, que });
    }
  }

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    // Un <input type="number"> cuyo value/onChange menciona algo que suena a
    // plata. Se mira la línea y las 3 de alrededor, que es donde vive el value.
    if (/type=["']number["']/.test(l)) {
      const vecindario = lineas.slice(Math.max(0, i - 3), i + 4).join(' ');
      if (SUENA_A_PLATA.test(vecindario) && !/kg|gramo|porcion|cantidad|minuto|hora|dias|pct|porcentaje/i.test(vecindario)) {
        out.numberPlata.push({ ruta, linea: i + 1, contexto: l.trim().slice(0, 90) });
      }
    }
    // Un parser propio sobre algo que suena a plata: parseFloat de un replace
    // de puntos y comas es reimplementar montoDesdeTipeo, y nunca da igual.
    //
    // 💣 Se mira el VECINDARIO y no sólo el renglón. La primera versión miraba
    // la línea sola y se perdió `parseFloat(e.target.value.replace(...))` en
    // SeccionImpuestos: ese renglón no dice "monto" en ninguna parte, lo dice
    // la etiqueta del campo de arriba. Era un caso real que no se veía.
    if (/parseFloat\([^)]*replace\(/.test(l)) {
      const vecindario = lineas.slice(Math.max(0, i - 4), i + 3).join(' ');
      if (SUENA_A_PLATA.test(vecindario) && !/kg|gramo|porcion|minuto|dias|pct|porcentaje/i.test(l)) {
        out.parserPropio.push({ ruta, linea: i + 1, contexto: l.trim().slice(0, 90) });
      }
    }
  }
  return out;
}

function archivos(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) archivos(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const rutas = archivos('src');
const todo = { mezcla: [], numberPlata: [], parserPropio: [] };
let conMontoInput = 0;
for (const ruta of rutas) {
  const txt = readFileSync(ruta, 'utf8');
  if (txt.includes('MontoInput')) conMontoInput++;
  const r = revisar(txt, ruta);
  todo.mezcla.push(...r.mezcla);
  todo.numberPlata.push(...r.numberPlata);
  todo.parserPropio.push(...r.parserPropio);
}

titulo('montos', 'Campos de plata que no pasan por la única puerta.');
universo(
  `${rutas.length} archivos .ts/.tsx de src/ (sin los tests) · ${conMontoInput} ya usan MontoInput`,
  'Plata se reconoce por el NOMBRE del campo: monto, importe, precio, costo, saldo, sueldo…',
  'Las cantidades de cocina (kg, porciones, minutos) quedan afuera: usan la regla CONTRARIA',
  'No se miran importadores ni scripts: sólo lo que se tipea en una pantalla',
);

// ─── Los testigos: código escrito a mano, no datos ───────────────────────────
const EJEMPLOS = {
  mezcla: `const v = montoDesdeTipeo(String(fila.precio_unitario));`,
  mezclaPlantilla: 'const v = montoDesdeTipeo(`${fila.importe}`);',
  numberPlata: `
    <label>Importe</label>
    <input type="number" value={importe} onChange={(e) => setImporte(e.target.value)} />
  `,
  cantidadCocina: `
    <label>Kilos por bolsa</label>
    <input type="number" value={kg} onChange={(e) => setKg(e.target.value)} />
  `,
  parserPropio: `const monto = parseFloat(texto.replace(/\\./g, '').replace(',', '.'));`,
  // La palabra "monto" está en la ETIQUETA, no en el renglón que parsea.
  parserSinLaPalabra: `
    <label>Monto del impuesto</label>
    <input onChange={(e) => { const n = parseFloat(e.target.value.replace(',', '.')) || 0; }} />
  `,
  bienHecho: `<MontoInput value={importe} onChange={setImporte} />`,
};

testigos([
  {
    que: '💣 Caza el bug caro: montoDesdeTipeo(String(...))',
    espera: 1,
    obtuvo: revisar(EJEMPLOS.mezcla).mezcla.length,
  },
  {
    que: '💣 Y también escrito con plantilla, que es el mismo bug',
    espera: 1,
    obtuvo: revisar(EJEMPLOS.mezclaPlantilla).mezcla.length,
  },
  {
    que: 'Un type="number" al lado de un campo de plata aparece',
    espera: 1,
    obtuvo: revisar(EJEMPLOS.numberPlata).numberPlata.length,
  },
  {
    que: '🔑 Un type="number" sobre KILOS no aparece: la cocina usa la regla contraria',
    espera: 0,
    obtuvo: revisar(EJEMPLOS.cantidadCocina).numberPlata.length,
  },
  {
    que: 'Un parser de plata escrito a mano aparece',
    espera: 1,
    obtuvo: revisar(EJEMPLOS.parserPropio).parserPropio.length,
  },
  {
    que: '💣 Y también cuando la palabra "monto" está en la etiqueta y no en el renglón',
    espera: 1,
    obtuvo: revisar(EJEMPLOS.parserSinLaPalabra).parserPropio.length,
  },
  {
    que: 'Un MontoInput bien puesto no reporta nada',
    espera: 0,
    obtuvo:
      revisar(EJEMPLOS.bienHecho).mezcla.length +
      revisar(EJEMPLOS.bienHecho).numberPlata.length +
      revisar(EJEMPLOS.bienHecho).parserPropio.length,
  },
]);

// ─── El reporte ──────────────────────────────────────────────────────────────
console.log('');
console.log(C.neg('RESUMEN'));
console.log(`  ${(todo.mezcla.length ? C.rojo : C.verde)(padN(todo.mezcla.length, 4))}  💣 mezclan los dos caminos (el bug ×10)`);
console.log(`  ${C.amar(padN(todo.numberPlata.length, 4))}  campos de plata con type="number"`);
console.log(`  ${C.amar(padN(todo.parserPropio.length, 4))}  parsers de plata escritos a mano`);

const mostrar = (titulo2, lista, color) => {
  if (!lista.length) return;
  console.log('');
  console.log(C.neg(titulo2) + C.gris(`  (${lista.length})`));
  const porArchivo = new Map();
  for (const x of lista) {
    if (!porArchivo.has(x.ruta)) porArchivo.set(x.ruta, []);
    porArchivo.get(x.ruta).push(x);
  }
  for (const [ruta, xs] of [...porArchivo].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${pad(ruta.replace('src/modules/', ''), 56)}${color(padN(xs.length, 3))}`);
    for (const x of xs.slice(0, 3)) console.log(C.gris(`      :${x.linea}  ${x.que ?? x.contexto}`));
    if (xs.length > 3) console.log(C.gris(`      … y ${xs.length - 3} más`));
  }
};

mostrar('💣 MEZCLAN LOS DOS CAMINOS', todo.mezcla, C.rojo);
mostrar('CAMPOS DE PLATA CON type="number"', todo.numberPlata, C.amar);
mostrar('PARSERS DE PLATA ESCRITOS A MANO', todo.parserPropio, C.amar);

console.log('');
if (todo.mezcla.length) {
  console.log(C.rojo('⛔ Hay valores de la base que se vuelven a parsear como si fueran tipeo.'));
  console.log(C.gris('   Ése es el bug que multiplicaba los precios por 10. Se arregla ya.'));
  process.exit(1);
}
console.log(C.verde('✓ Ningún valor de la base se reparsea con el parser de tipeo.'));
console.log(
  C.gris(`  Quedan ${todo.numberPlata.length + todo.parserPropio.length} campos por mudar a MontoInput. Deuda conocida, no incendio.`),
);
