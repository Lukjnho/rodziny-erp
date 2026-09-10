import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Vocabulario de plata. Solo nombres que en este proyecto SIEMPRE son dinero.
// Deliberadamente NO incluye `total`, `cantidad`, `costo` ni `valor`: en Cocina
// esos son kilos, y la regla del punto es la contraria.
const PLATA =
  'monto|importe|precio|saldo|sueldo|subtotal|fondo|retiro|efectivo|descuento|' +
  'adelanto|bono|comision|dividendo|contado|arqueo|haber|neto|bruto|abonado|pagado';

const AVISO =
  'Un monto que ya es número no se convierte a texto para meterlo en un input: ' +
  'el parser de tipeo le borra el punto y lo multiplica por 10. ' +
  'Usá <MontoInput value={monto} /> o, si necesitás el texto, montoADisplay() de @/lib/monto. ' +
  'Ver la regla en CLAUDE.md.';

// Un porcentaje NO es plata aunque se llame "descuento": `descuentoPct` tiene
// min 0 / max 100 y no sufre el bug del punto.
const NO_ES_PLATA = '(?!.*(Pct|Porc|Porcentaje|Porcentual))';
const CAMPO = `/^${NO_ES_PLATA}.*(${PLATA})/i`;

// Forma 1: el monto entra a un input ya convertido a texto.
const ENTRADA = 'JSXAttribute[name.name=/^(value|defaultValue)$/]';
// Forma 2: el monto se convierte a texto para guardarlo en el estado del
// formulario. Así se rompió el cierre de caja: `setFContado(String(...))`.
// Sin esta segunda forma la regla no habría detectado ese bug.
const AL_ESTADO = 'CallExpression[callee.name=/^set[A-Z]/]';

const montosComoTexto = [ENTRADA, AL_ESTADO]
  .flatMap((donde) => [
    // String(monto) / String(x.monto)
    `${donde} CallExpression[callee.name="String"] > Identifier[name=${CAMPO}]`,
    `${donde} CallExpression[callee.name="String"] > MemberExpression[property.name=${CAMPO}]`,
    // monto.toString() / x.monto.toString()
    `${donde} CallExpression[callee.property.name="toString"][callee.object.name=${CAMPO}]`,
    `${donde} CallExpression[callee.property.name="toString"] > MemberExpression[property.name=${CAMPO}]`,
  ])
  .map((selector) => ({ selector, message: AVISO }));

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['warn', ...montosComoTexto],
    },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
