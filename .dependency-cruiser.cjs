/* eslint-env node */
// Los seis niveles del ERP, con dientes.
//
// graphify DIBUJA el grafo; esto lo IMPIDE. Son dos cosas distintas y hacen
// falta las dos: el mapa te dice por dónde pasa algo hoy, este archivo te frena
// cuando estás por escribir la flecha que no va.
//
// La regla, en una línea: **un módulo solo importa de niveles más abajo.**
// Nunca del mismo nivel, nunca de arriba. Cuando dos módulos hermanos necesitan
// hablarse, el concepto compartido BAJA un nivel — es lo que se hizo con
// `src/lib/mediosPago.ts` (la regla de MP Lucas la necesitaban Finanzas y las
// integraciones, dos hermanos de nivel distinto, y terminó en nivel 1).
//
// Arranca en `warn` a propósito: primero se mide la deuda que ya existe, después
// se decide qué se arregla y recién ahí pasa a `error`. Ponerlo en error hoy
// dejaría el build rojo sin que nadie haya decidido nada.
//
//     npm run arq            # el informe
//     npm run arq -- --help  # opciones de dependency-cruiser
//
// ⚠️ AL AGREGAR UN MÓDULO NUEVO hay que darle nivel acá. Si no, no lo mira
// ninguna regla y entra por la ventana. La regla `todo-modulo-tiene-nivel` de
// abajo lo detecta.

const NIVELES = {
  1: {
    nombre: 'base',
    // core y shared. Todo el mundo puede importar de acá; acá no se importa
    // nada de arriba.
    rutas: ['^src/lib/', '^src/components/', '^src/modules/auth/'],
  },
  2: {
    nombre: 'núcleo',
    // productos, stock, costeo, convenios. Hoy `stock` y `costeo` no son
    // carpetas propias: viven adentro de cocina (nivel 3). Cuando se separen,
    // van acá.
    rutas: ['^src/modules/productos/', '^src/modules/convenios/'],
  },
  3: {
    nombre: 'operación',
    rutas: [
      '^src/modules/salon/',
      '^src/modules/cocina/',
      '^src/modules/almacen/',
      '^src/modules/rrhh/',
      '^src/modules/agenda/',
      '^src/modules/usuarios/',
    ],
  },
  4: {
    nombre: 'registro',
    rutas: [
      '^src/modules/caja/',
      '^src/modules/gastos/',
      '^src/modules/compras/',
      '^src/modules/integraciones/',
    ],
  },
  5: {
    nombre: 'agregación',
    // ventas, finanzas, fiscal. `fiscal` todavía no existe como carpeta.
    rutas: ['^src/modules/ventas/', '^src/modules/finanzas/'],
  },
  6: {
    nombre: 'lectura',
    rutas: ['^src/modules/inicio/', '^src/modules/dashboard/'],
  },
};

// Tres módulos no estaban en la lista de niveles y los ubiqué yo. Si alguno va
// en otro lado, se cambia acá y listo:
//   · auth      → nivel 1, porque lo necesita todo el mundo
//   · usuarios  → nivel 3, es la pantalla que administra legajos y permisos
//   · dashboard → nivel 6, es pantalla de lectura como inicio

const alterna = (rutas) => `(${rutas.join('|')})`;
const deNivel = (n) => alterna(NIVELES[n].rutas);

/** Los módulos de un nivel, como grupo capturado: para "no importes a tu hermano". */
function hermanos(n) {
  const nombres = NIVELES[n].rutas
    .map((r) => r.replace('^src/modules/', '').replace('/$', '').replace('/', ''))
    .filter((x) => !x.startsWith('^src'));
  return nombres.length > 1 ? `^src/modules/(${nombres.join('|')})/` : null;
}

const reglas = [];

// ── 1. Nadie importa de un nivel más arriba ────────────────────────────────
for (let n = 1; n <= 5; n++) {
  const arriba = [];
  for (let m = n + 1; m <= 6; m++) arriba.push(...NIVELES[m].rutas);
  reglas.push({
    name: `nivel-${n}-no-importa-arriba`,
    severity: 'warn',
    comment:
      `Nivel ${n} (${NIVELES[n].nombre}) importando de un nivel más arriba. ` +
      `La flecha va al revés: si los dos lo necesitan, el concepto compartido baja de nivel.`,
    from: { path: deNivel(n) },
    to: { path: alterna(arriba) },
  });
}

// ── 2. Nadie importa a un hermano del mismo nivel ──────────────────────────
for (let n = 2; n <= 6; n++) {
  const patron = hermanos(n);
  if (!patron) continue;
  reglas.push({
    name: `nivel-${n}-no-importa-hermanos`,
    severity: 'warn',
    comment:
      `Dos módulos del nivel ${n} (${NIVELES[n].nombre}) hablándose directo. ` +
      `Lo que comparten tiene que bajar un nivel, no cruzarse de costado.`,
    from: { path: patron },
    to: { path: patron, pathNot: '^src/modules/$1/' },
  });
}

// ── 3. La base no sabe que existen los módulos ─────────────────────────────
reglas.push({
  name: 'base-no-importa-modulos',
  severity: 'warn',
  comment:
    'src/lib y src/components son la base: los usa todo el ERP y no pueden ' +
    'depender de ningún módulo. Si algo de acá necesita un módulo, es que no era base.',
  from: { path: ['^src/lib/', '^src/components/'] },
  to: { path: '^src/modules/' },
});

// ── 4. Sin ciclos ──────────────────────────────────────────────────────────
reglas.push({
  name: 'sin-ciclos',
  severity: 'warn',
  comment:
    'Dos archivos que se importan en círculo. Además de marear, en Vite rompen ' +
    'de formas raras: uno de los dos ve el otro a medio cargar.',
  from: {},
  to: { circular: true },
});

// ── 5. Un módulo sin nivel entra por la ventana ────────────────────────────
reglas.push({
  name: 'todo-modulo-tiene-nivel',
  severity: 'warn',
  comment:
    'Este módulo no figura en NIVELES (.dependency-cruiser.cjs). Mientras no ' +
    'tenga nivel, ninguna regla lo mira. Agregalo antes de seguir.',
  from: {},
  to: {
    path: '^src/modules/',
    pathNot: alterna(
      Object.keys(NIVELES).flatMap((n) => NIVELES[n].rutas),
    ),
  },
});

module.exports = {
  forbidden: reglas,
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        'node_modules',
        '\\.test\\.tsx?$',
        // Los tests importan de donde les convenga: prueban, no dependen.
      ],
    },
    tsConfig: { fileName: 'tsconfig.app.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
