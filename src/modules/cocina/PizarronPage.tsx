import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabaseAnon } from '@/lib/supabaseAnon';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { SELECT_STOCK_PASTAS, vendibleHoy, type StockPastaRow } from './lib/stockPastas';
import { PizarronPanelPasta } from './components/PizarronPanelPasta';

/**
 * EL PIZARRÓN DE LA FÁBRICA — pantalla para una tablet colgada de la pared.
 *
 * URL: /pizarron?vista=camara&local=vedia
 *
 * POR QUÉ EXISTE. Lucas, 3-sep-2026: *"contamos pero no anotamos, ni
 * corregimos, porque no tenemos un 'lugar' para mirar fácilmente el stock en el
 * sistema"*. El conteo físico de la cámara de Vedia tiene hasta 83 días de
 * atraso, y no es por falta de disciplina: el dato se cuenta y se pierde porque
 * el único lugar donde cargarlo está enterrado en un tab del ERP, en una
 * computadora, lejos de la cámara.
 *
 * Entonces esta pantalla NO es un tablero que muestra. Es EL LUGAR donde se
 * cuenta: un toque, un número, y listo, de parado.
 *
 * ⚠️ NO ES EL ERP y no tiene que parecerlo. Se lee a 3 metros, se toca con el
 * dedo sin apuntar, y muestra pocos números grandes en vez de veinte chicos.
 * Cualquier cosa que necesite precisión de mouse está mal acá.
 *
 * ⚠️ ES UNA PANTALLA COMPARTIDA. Lee sin sesión (como el QR de producción), y
 * por eso no recuerda a nadie: al contar pregunta siempre quién sos y se olvida
 * al guardar. Ver `ResponsableBotones`.
 *
 * LOS NÚMEROS NO SE CALCULAN ACÁ. Salen de `v_cocina_stock_pastas` (la cuenta
 * única, migración 161) a través de `lib/stockPastas`. Una pantalla de pared
 * expuesta a todo el equipo no puede tener su propia versión del stock.
 */

type Vista = 'camara';
type Local = 'vedia' | 'saavedra';

/** Fila de la vista + la fecha del último conteo físico (migración 164). */
type FilaStock = StockPastaRow & { ultimo_conteo_at: string | null };

/**
 * A partir de cuántos días el conteo dejó de ser confiable.
 *
 * El stock arranca del último conteo y le suma lo posterior, así que el error
 * se acumula. Estos cortes son un criterio inicial y se calibran con el uso:
 * hoy la antigüedad promedio en Vedia es de 17 días.
 */
const DIAS_CONTEO_TIBIO = 7;
const DIAS_CONTEO_VENCIDO = 14;

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86_400_000);
}

/** "hoy" · "ayer" · "hace 11 días" · "nunca se contó" */
function textoAntiguedad(dias: number | null): string {
  if (dias === null) return 'nunca se contó';
  if (dias <= 0) return 'contado hoy';
  if (dias === 1) return 'contado ayer';
  return `contado hace ${dias} días`;
}

function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/** Los miles con punto, como en todo el ERP. */
function conMiles(n: number): string {
  return n.toLocaleString('es-AR');
}

export function PizarronPage() {
  const [params, setParams] = useSearchParams();
  const local: Local = params.get('local') === 'saavedra' ? 'saavedra' : 'vedia';
  const vista: Vista = 'camara';

  // ── El stock, de la cuenta única ───────────────────────────────────────────
  const { data: filas, isLoading } = useQuery({
    queryKey: ['pizarron-stock', local],
    queryFn: async () => {
      const { data, error } = await supabaseAnon
        .from('v_cocina_stock_pastas')
        .select(SELECT_STOCK_PASTAS + ', ultimo_conteo_at')
        .eq('local', local)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as unknown as FilaStock[];
    },
    // En vivo sin botón de refrescar: la gracia es ver aparecer el lote que el
    // compañero acaba de cargar desde la sala de producción.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // ── Lo último que entró y salió, para saber que la pantalla está viva ──────
  const { data: movimientos } = useQuery({
    queryKey: ['pizarron-movimientos', local],
    queryFn: async () => {
      const [entradas, salidas, conteos] = await Promise.all([
        supabaseAnon
          .from('cocina_lotes_pasta')
          .select('id, porciones, porcionado_at, responsable_porcionado, producto:cocina_productos(nombre)')
          .eq('local', local)
          .eq('ubicacion', 'camara_congelado')
          .not('porcionado_at', 'is', null)
          .order('porcionado_at', { ascending: false })
          .limit(6),
        supabaseAnon
          .from('cocina_traspasos')
          .select('id, porciones, created_at, responsable, producto:cocina_productos(nombre)')
          .eq('local', local)
          .order('created_at', { ascending: false })
          .limit(6),
        // Los conteos también son movimiento, y el más importante: son los que
        // corrigen el número. Sin esto, contar no deja rastro visible en la
        // pantalla y no se puede verificar que quedó guardado.
        supabaseAnon
          .from('cocina_cierre_camara')
          .select('id, cantidad_real, created_at, responsable, producto:cocina_productos(nombre)')
          .eq('local', local)
          .order('created_at', { ascending: false })
          .limit(6),
      ]);
      if (entradas.error) throw entradas.error;
      if (salidas.error) throw salidas.error;
      if (conteos.error) throw conteos.error;

      const nombreDe = (p: unknown): string => {
        const rel = Array.isArray(p) ? p[0] : p;
        return (rel as { nombre?: string } | null)?.nombre ?? 'Sin nombre';
      };

      const items = [
        ...(entradas.data ?? []).map((r) => ({
          id: `e-${r.id}`,
          cuando: r.porcionado_at as string,
          signo: '+' as const,
          porciones: Number(r.porciones) || 0,
          producto: nombreDe(r.producto),
          quien: (r.responsable_porcionado as string | null) ?? null,
          que: 'porcionó',
        })),
        ...(salidas.data ?? []).map((r) => ({
          id: `s-${r.id}`,
          cuando: r.created_at as string,
          signo: '−' as const,
          porciones: Number(r.porciones) || 0,
          producto: nombreDe(r.producto),
          quien: (r.responsable as string | null) ?? null,
          que: 'bajó al mostrador',
        })),
        ...(conteos.data ?? []).map((r) => ({
          id: `c-${r.id}`,
          cuando: r.created_at as string,
          // El conteo no suma ni resta: FIJA el número. Por eso lleva "=".
          signo: '=' as const,
          porciones: Number(r.cantidad_real) || 0,
          producto: nombreDe(r.producto),
          quien: (r.responsable as string | null) ?? null,
          que: 'contó',
        })),
      ];
      items.sort((a, b) => (a.cuando < b.cuando ? 1 : -1));
      return items.slice(0, 8);
    },
    refetchInterval: 30_000,
  });

  // ── ¿Se puede guardar el conteo desde acá? ─────────────────────────────────
  // La pantalla LEE sin sesión, pero `cocina_cierre_camara` hoy solo acepta
  // conteos de un usuario logueado. Si la tablet no tiene sesión, se avisa en
  // vez de dejar tocar un botón que va a fallar.
  //
  // ⚠️ Se usa el contexto de auth y NO `supabase.auth.getSession()`: ese método
  // queda colgado con refresh tokens (bug conocido de Supabase, documentado en
  // `lib/auth.tsx`), y el aviso nunca aparecería. El contexto escucha
  // `onAuthStateChange`, que sí dispara siempre.
  const { user, perfil, cargando: cargandoSesion } = useAuth();
  const haySesion = cargandoSesion ? null : !!user;

  // ── Qué pasta se está mirando ────────────────────────────────────────────
  // El panel de la pasta (los lotes, contar y sacar) vive en su propio
  // archivo: acá solo se elige cuál se abre.
  const [contando, setContando] = useState<FilaStock | null>(null);
  const [guardado, setGuardado] = useState('');

  const totales = useMemo(() => {
    const lista = filas ?? [];
    return {
      porciones: lista.reduce((s, f) => s + vendibleHoy(f), 0),
      productos: lista.length,
      vencidos: lista.filter((f) => {
        const d = diasDesde(f.ultimo_conteo_at);
        return d === null || d >= DIAS_CONTEO_VENCIDO;
      }).length,
      bandejasEnSala: lista.reduce((s, f) => s + (Number(f.bandejas_en_proceso) || 0), 0),
    };
  }, [filas]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50">
      {/* ── Encabezado ────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-bold tracking-tight">🧊 Cámara de congelado</h1>
          <span className="text-lg text-slate-400">
            {local === 'vedia' ? 'Vedia' : 'Saavedra'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              const p = new URLSearchParams(params);
              p.set('local', local === 'vedia' ? 'saavedra' : 'vedia');
              p.set('vista', vista);
              setParams(p);
            }}
            className="rounded-lg bg-slate-700 px-4 py-2 text-base text-slate-200 hover:bg-slate-600"
          >
            Ver {local === 'vedia' ? 'Saavedra' : 'Vedia'}
          </button>
          <span className="flex items-center gap-2 text-base text-slate-400">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-teal-400" />
            en vivo
          </span>
        </div>
      </header>

      {/* ── El número grande ──────────────────────────────────────────────── */}
      <section className="px-6 py-8 text-center">
        <div className="text-7xl font-bold tabular-nums text-teal-300 sm:text-8xl">
          {isLoading ? '—' : conMiles(totales.porciones)}
        </div>
        <p className="mt-2 text-xl text-slate-300">
          porciones en cámara · {totales.productos} pastas
        </p>
        {totales.vencidos > 0 && (
          <p className="mt-3 text-lg font-semibold text-amber-300">
            ⚠ {totales.vencidos}{' '}
            {totales.vencidos === 1 ? 'pasta hace mucho que no se cuenta' : 'pastas hace mucho que no se cuentan'}
          </p>
        )}
        {totales.bandejasEnSala > 0 && (
          <p className="mt-2 text-base text-slate-400">
            Además hay {totales.bandejasEnSala} bandejas por porcionar en la sala de producción — no
            están acá todavía.
          </p>
        )}
      </section>

      {guardado && (
        <div className="mx-6 mb-4 rounded-xl bg-teal-500/20 px-6 py-4 text-xl font-semibold text-teal-200">
          ✓ {guardado}
        </div>
      )}

      {/* ── Una tarjeta por pasta, tocable ────────────────────────────────── */}
      <main className="grid gap-4 px-6 pb-8 sm:grid-cols-2 xl:grid-cols-3">
        {(filas ?? []).map((f) => {
          const dias = diasDesde(f.ultimo_conteo_at);
          const vencido = dias === null || dias >= DIAS_CONTEO_VENCIDO;
          const tibio = !vencido && dias !== null && dias >= DIAS_CONTEO_TIBIO;
          const porciones = vendibleHoy(f);
          return (
            <button
              key={f.producto_id}
              type="button"
              onClick={() => setContando(f)}
              className={cn(
                'rounded-2xl border-2 p-5 text-left transition',
                vencido
                  ? 'border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20'
                  : 'border-slate-700 bg-slate-800 hover:bg-slate-700',
              )}
            >
              <div className="mb-3 min-h-[3.5rem] text-xl font-semibold leading-tight">
                {f.nombre}
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <span className="text-5xl font-bold tabular-nums">{conMiles(porciones)}</span>
                  <span className="ml-2 text-lg text-slate-400">porc.</span>
                </div>
                <span
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-base font-medium',
                    vencido
                      ? 'bg-amber-400 text-slate-900'
                      : tibio
                        ? 'bg-slate-600 text-amber-200'
                        : 'bg-slate-700 text-slate-300',
                  )}
                >
                  {textoAntiguedad(dias)}
                </span>
              </div>
            </button>
          );
        })}
        {!isLoading && (filas ?? []).length === 0 && (
          <p className="text-xl text-slate-400">
            No hay pastas activas cargadas en {local === 'vedia' ? 'Vedia' : 'Saavedra'}.
          </p>
        )}
      </main>

      {/* ── Lo último que pasó ────────────────────────────────────────────── */}
      {(movimientos ?? []).length > 0 && (
        <footer className="border-t border-slate-700 px-6 py-5">
          <h2 className="mb-3 text-base uppercase tracking-wider text-slate-500">
            Lo último que pasó
          </h2>
          <ul className="space-y-2">
            {(movimientos ?? []).map((m) => (
              <li key={m.id} className="flex items-baseline gap-3 text-lg">
                <span className="w-14 shrink-0 tabular-nums text-slate-500">
                  {horaCorta(m.cuando)}
                </span>
                <span
                  className={cn(
                    'w-20 shrink-0 text-right font-semibold tabular-nums',
                    m.signo === '+'
                      ? 'text-teal-300'
                      : m.signo === '='
                        ? 'text-amber-300'
                        : 'text-slate-300',
                  )}
                >
                  {m.signo}
                  {m.porciones}
                </span>
                <span className="truncate">{m.producto}</span>
                <span className="truncate text-slate-500">
                  {m.que}
                  {m.quien ? ` · ${m.quien}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </footer>
      )}


      {/* ── El panel de la pasta: los lotes, contar y sacar ───────────────── */}
      {contando && (
        <PizarronPanelPasta
          fila={contando}
          local={local}
          nombreSesion={perfil?.nombre ?? null}
          haySesion={haySesion}
          onCerrar={() => setContando(null)}
          onGuardado={(msg) => {
            setGuardado(msg);
            window.setTimeout(() => setGuardado(''), 6000);
          }}
        />
      )}
    </div>
  );
}
