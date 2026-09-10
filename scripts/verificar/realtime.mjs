/**
 * ¿Realtime entrega de verdad, o solo dice que sí?
 *
 * POR QUE EXISTE
 * --------------
 * StockTab.tsx se suscribe a cocina_traspasos, cocina_lotes_pasta y cocina_merma
 * desde mayo-2026. Estuvo TRES MESES sin recibir nada: la migracion 072 nunca se
 * habia aplicado y las tablas no estaban publicadas.
 *
 * Nadie lo noto porque `.subscribe()` devuelve SUBSCRIBED igual. La pantalla dice
 * "conectado" y no llega nada. Por eso ver el estado NO alcanza: hay que provocar
 * un cambio y ver si el aviso entra.
 *
 * COMO SE USA
 * -----------
 *   node scripts/verificar/realtime.mjs
 *
 * Queda escuchando 25 segundos. Mientras tanto, en otra terminal, provocar un
 * cambio en alguna de las tres tablas. Un UPDATE que no cambia nada alcanza y no
 * ensucia datos:
 *
 *   update public.cocina_traspasos set id = id
 *    where id = (select id from public.cocina_traspasos limit 1);
 *
 * Sale con codigo 0 si llego al menos un aviso, y 1 si no llego nada.
 *
 * Se conecta con la clave publica, igual que las tablets. Las tres tablas tienen
 * lectura abierta para `anon`, asi que si a este script le llega, a la pantalla
 * tambien.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SEGUNDOS = Number(process.argv[2]) || 25;
const TABLAS = ['cocina_traspasos', 'cocina_lotes_pasta', 'cocina_merma'];

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
let recibidos = 0;

const canal = supabase.channel('verificacion-realtime');
for (const tabla of TABLAS) {
  canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, (p) => {
    recibidos++;
    console.log(`  AVISO RECIBIDO  tabla=${tabla}  evento=${p.eventType}`);
  });
}

canal.subscribe((estado, err) => {
  console.log(`  estado: ${estado}${err ? '  error=' + err.message : ''}`);
  if (estado === 'SUBSCRIBED') {
    console.log(`  escuchando ${SEGUNDOS}s... (OJO: este "SUBSCRIBED" salia igual cuando NO llegaba nada)`);
  }
});

setTimeout(() => {
  console.log(
    recibidos > 0
      ? `\nVEREDICTO: LLEGAN. ${recibidos} aviso(s).`
      : `\nVEREDICTO: NO LLEGO NADA en ${SEGUNDOS}s. Revisar pg_publication_tables y las policies de SELECT.`,
  );
  process.exit(recibidos > 0 ? 0 : 1);
}, SEGUNDOS * 1000);
