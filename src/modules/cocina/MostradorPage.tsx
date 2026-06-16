import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';
import { invalidarStockCocina } from './lib/invalidarStock';
import { normalizarDecimal, parseDecimal, equivalenteKgGramos } from '@/lib/numero';
import { PRODUCTOS_COCINA, normNombre } from './DashboardTab';

type Local = 'vedia' | 'saavedra';
type Turno = 'mediodia' | 'noche';
type TipoTab = 'pasta' | 'salsa' | 'postre' | 'panaderia' | 'milanesa';
type TipoSimple = 'salsa' | 'postre' | 'panaderia' | 'milanesa';

const TAB_META: Record<TipoTab, { emoji: string; label: string }> = {
  pasta: { emoji: '🍝', label: 'Pastas' },
  salsa: { emoji: '🥫', label: 'Salsas' },
  postre: { emoji: '🍰', label: 'Postres' },
  panaderia: { emoji: '🥐', label: 'Panadería' },
  milanesa: { emoji: '🍖', label: 'Milanesas' },
};

// Vedia cierra pasta/salsa/postre. Saavedra suma panadería + milanesa (no tiene
// Fudo, pero el cierre es conteo físico manual, así que no depende de ventas
// automáticas). La milanesa se cuenta en kg de milanesa que quedan congelados.
const TABS_POR_LOCAL: Record<Local, TipoTab[]> = {
  vedia: ['pasta', 'salsa', 'postre'],
  saavedra: ['pasta', 'salsa', 'postre', 'panaderia', 'milanesa'],
};

const UNIDAD_POR_TIPO: Record<TipoSimple, 'kg' | 'unidades'> = {
  salsa: 'kg',
  postre: 'unidades',
  panaderia: 'unidades',
  milanesa: 'kg',
};

interface Producto {
  id: string;
  nombre: string;
  codigo: string;
  fudo_nombres?: string[] | null;
}

interface FudoRankingItem {
  nombre: string;
  cantidad: number;
  facturacion: number;
  categoria: string;
}

interface FudoData {
  ranking: FudoRankingItem[];
}

// Mapa nombre normalizado → config con fudoNombres del DashboardTab (legacy hardcodeado).
const PRODUCTO_POR_NOMBRE = new Map(
  PRODUCTOS_COCINA.map((p) => [normNombre(p.nombre), p] as const),
);

function normFudoNombre(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Resuelve cuántas ventas Fudo le corresponden a un producto del catálogo:
// prioridad fudo_nombres en DB > mapa hardcodeado > nombre literal.
function ventasFudoDelProducto(producto: Producto, ranking: FudoRankingItem[] | undefined) {
  if (!ranking || ranking.length === 0) return 0;
  let nombres: string[];
  if (producto.fudo_nombres && producto.fudo_nombres.length > 0) {
    nombres = producto.fudo_nombres;
  } else {
    const cfg = PRODUCTO_POR_NOMBRE.get(normNombre(producto.nombre));
    nombres = cfg?.fudoNombres ?? [producto.nombre];
  }
  let total = 0;
  for (const n of nombres) {
    const objetivo = normFudoNombre(n);
    const hit = ranking.find((r) => normFudoNombre(r.nombre) === objetivo);
    if (hit) total += hit.cantidad;
  }
  return total;
}

// Corte de la jornada operativa (hora AR). El turno noche cierra hasta la ~01hs:
// para que esos cierres se imputen al día que corresponde (y no al siguiente),
// todo lo cargado entre las 00:00 y las 04:59 AR cuenta como el día anterior.
const CORTE_JORNADA_H = 5;

function hoyAR(): string {
  // Argentina: UTC-3 sin horario de verano. toISOString() devuelve UTC.
  // Restamos el offset AR + el corte de jornada para que la madrugada siga
  // perteneciendo al día operativo anterior.
  const ahora = new Date();
  const offsetMs = (3 + CORTE_JORNADA_H) * 60 * 60 * 1000;
  return new Date(ahora.getTime() - offsetMs).toISOString().slice(0, 10);
}

// /mostrador?local=vedia | saavedra
// Cierre obligatorio por turno/fin-de-día. Inserta en cocina_cierre_dia.
export function MostradorPage() {
  const [params] = useSearchParams();
  const local = (params.get('local') === 'saavedra' ? 'saavedra' : 'vedia') as Local;
  const [tab, setTab] = useState<TipoTab>('pasta');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-between bg-rodziny-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-rodziny-600 text-xs font-bold">
            R
          </div>
          <span className="text-sm font-semibold">Cierre de mostrador</span>
        </div>
        <span className="text-rodziny-200 text-xs">{local === 'vedia' ? 'Vedia' : 'Saavedra'}</span>
      </div>

      <div className="flex border-b border-gray-200 bg-white">
        {TABS_POR_LOCAL[local].map((t) => (
          <TabBtn key={t} activo={tab === t} onClick={() => setTab(t)}>
            {TAB_META[t].emoji} {TAB_META[t].label}
          </TabBtn>
        ))}
      </div>

      {tab === 'pasta' && <CierrePastas local={local} />}
      {tab !== 'pasta' && (
        <CierreSimple local={local} tipo={tab} unidad={UNIDAD_POR_TIPO[tab]} />
      )}
    </div>
  );
}

function TabBtn({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 py-3 text-sm font-medium transition',
        activo
          ? 'border-b-2 border-rodziny-600 text-rodziny-700'
          : 'text-gray-500 hover:text-gray-700',
      )}
    >
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Cierre de pastas — con turno (mediodia/noche) y 4 columnas
// ════════════════════════════════════════════════════════════════════════════

interface FilaPasta {
  inicial: string;
  entrega: string;
  vendido: string;
  real: string;
}

function CierrePastas({ local }: { local: Local }) {
  const qc = useQueryClient();
  const fecha = hoyAR();
  const [turno, setTurno] = useState<Turno>('mediodia');
  const [responsable, setResponsable] = useState('');
  const [filas, setFilas] = useState<Record<string, FilaPasta>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);

  const { data: pastas, isLoading: loadingPastas } = useQuery({
    queryKey: ['mostrador-pastas', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, fudo_nombres')
        .eq('tipo', 'pasta')
        .eq('activo', true)
        .eq('local', local)
        .order('nombre');
      if (error) throw error;
      return data as Producto[];
    },
  });

  // Traspasos del local con timestamp. Filtramos en memoria por created_at > último
  // cierre de cada pasta para calcular Entrega = "lo que entró desde el último cierre".
  const { data: traspasos } = useQuery({
    queryKey: ['mostrador-traspasos-cierre', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('producto_id, porciones, created_at')
        .eq('local', local);
      if (error) throw error;
      return data as Array<{ producto_id: string; porciones: number; created_at: string }>;
    },
    refetchInterval: 60_000,
  });

  // Cierre actual del turno (si ya cargaron y vuelven a editar)
  const { data: cierreActual } = useQuery({
    queryKey: ['mostrador-cierre-actual', local, fecha, turno],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_cierre_dia')
        .select('*')
        .eq('local', local)
        .eq('fecha', fecha)
        .eq('tipo', 'pasta')
        .eq('turno', turno);
      if (error) throw error;
      return data as Array<{
        id: string;
        producto_id: string;
        cantidad_real: number;
        inicial: number | null;
        entrega: number | null;
        vendido: number | null;
        responsable: string | null;
      }>;
    },
  });

  // Último cierre por producto (cualquier día/turno). Marca el "punto cero" desde el
  // que se cuentan traspasos y ventas de este turno: Inicial = cantidad_real de ese
  // cierre, Entrega = Σ traspasos posteriores, Vendido = Σ ventas Fudo posteriores.
  // Si nunca hubo cierre para una pasta, queda sin entrada en el mapa → Inicial = 0.
  // Excluye el cierre del turno ACTUAL (si existe) para no auto-inicializarse con sí
  // mismo cuando se está re-editando.
  const { data: ultimosCierres } = useQuery({
    queryKey: ['mostrador-ultimos-cierres', local, fecha, turno],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_cierre_dia')
        .select('producto_id, cantidad_real, created_at, fecha, turno')
        .eq('local', local)
        .eq('tipo', 'pasta')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const m = new Map<string, { cantidad_real: number; created_at: string }>();
      for (const c of (data ?? []) as Array<{
        producto_id: string;
        cantidad_real: number;
        created_at: string;
        fecha: string;
        turno: string;
      }>) {
        if (c.fecha === fecha && c.turno === turno) continue; // saltar el cierre actual
        if (!m.has(c.producto_id)) {
          m.set(c.producto_id, { cantidad_real: c.cantidad_real, created_at: c.created_at });
        }
      }
      return m;
    },
  });

  // Inicio de la ventana de Fudo: el cierre más antiguo entre los "últimos cierres"
  // por producto. Llamamos a Fudo UNA vez con ese rango y filtramos por producto en
  // memoria. Si no hay cierres, arrancamos hoy 00:00 AR.
  const fudoDesdeISO = useMemo(() => {
    if (!ultimosCierres || ultimosCierres.size === 0) {
      // Hoy 00:00 ART = 03:00 UTC
      return `${fecha}T03:00:00Z`;
    }
    let min: string | null = null;
    for (const c of ultimosCierres.values()) {
      if (!min || c.created_at < min) min = c.created_at;
    }
    return new Date(min!).toISOString();
  }, [ultimosCierres, fecha]);

  // Ventas Fudo desde fudoDesdeISO hasta ahora. Pedimos fechaDesde/fechaHasta amplios
  // (la edge function va a usar el override desdeISO igualmente).
  const { data: fudoDesdeCierre } = useQuery({
    queryKey: ['mostrador-fudo-desde-cierre', local, fudoDesdeISO],
    queryFn: async () => {
      const ahoraISO = new Date().toISOString();
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: {
          local,
          fechaDesde: fudoDesdeISO.slice(0, 10),
          fechaHasta: ahoraISO.slice(0, 10),
          desdeISO: fudoDesdeISO,
          hastaISO: ahoraISO,
        },
      });
      if (error || !data?.ok) return null;
      return data.data as FudoData;
    },
    staleTime: 60_000, // refrescar máximo cada minuto (Fudo es prácticamente real-time)
    refetchInterval: 2 * 60_000,
  });

  // Hidratar filas: inicial = último cierre, entrega = Σ traspasos posteriores,
  // vendido = ventas Fudo del producto desde ese cierre. Si ya hay cierre cargado
  // para este turno, pisar con esos valores (modo edición).
  useEffect(() => {
    if (!pastas) return;
    const nuevas: Record<string, FilaPasta> = {};
    for (const p of pastas) {
      const previo = cierreActual?.find((c) => c.producto_id === p.id);
      if (previo) {
        nuevas[p.id] = {
          inicial: previo.inicial != null ? String(previo.inicial) : '0',
          entrega: previo.entrega != null ? String(previo.entrega) : '0',
          vendido: previo.vendido != null ? String(previo.vendido) : '0',
          real: String(previo.cantidad_real),
        };
        continue;
      }
      const ultimo = ultimosCierres?.get(p.id) ?? null;
      const inicial = ultimo?.cantidad_real ?? 0;
      const entrega = (traspasos ?? [])
        .filter(
          (t) =>
            t.producto_id === p.id &&
            (ultimo == null || t.created_at > ultimo.created_at),
        )
        .reduce((s, t) => s + (t.porciones ?? 0), 0);
      const vendido = ventasFudoDelProducto(p, fudoDesdeCierre?.ranking);
      nuevas[p.id] = {
        inicial: String(inicial),
        entrega: String(entrega),
        vendido: String(vendido),
        real: '',
      };
    }
    setFilas(nuevas);
    if (cierreActual && cierreActual.length > 0 && cierreActual[0].responsable) {
      setResponsable(cierreActual[0].responsable);
    }
  }, [pastas, cierreActual, ultimosCierres, traspasos, fudoDesdeCierre]);

  function setCampo(pid: string, campo: keyof FilaPasta, valor: string) {
    setFilas((prev) => ({
      ...prev,
      [pid]: { ...prev[pid], [campo]: valor },
    }));
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!responsable.trim()) throw new Error('Cargá tu nombre antes de guardar');
      const conDatos = Object.entries(filas).filter(([, f]) => f.real.trim() !== '');
      if (conDatos.length === 0) throw new Error('Cargá al menos un producto con stock real');

      // Borrar el cierre previo de este turno por sus columnas naturales
      // (local/fecha/tipo/turno), NO por los ids del snapshot `cierreActual`:
      // si ese snapshot estaba viejo (otro guardado, otra pestaña) quedaban filas
      // sin borrar y el insert chocaba contra el índice único ux_..._con_turno.
      const { error: errDel } = await supabase
        .from('cocina_cierre_dia')
        .delete()
        .eq('local', local)
        .eq('fecha', fecha)
        .eq('tipo', 'pasta')
        .eq('turno', turno);
      if (errDel) throw errDel;

      const num = (s: string) => Number(s.trim().replace(/\s/g, '').replace(',', '.'));
      const malo = conDatos.find(([, f]) => {
        const v = num(f.real);
        return !Number.isFinite(v) || v < 0;
      });
      if (malo) {
        const nom = pastas?.find((p) => p.id === malo[0])?.nombre ?? 'una pasta';
        throw new Error(
          `Revisá el stock real de "${nom}": "${malo[1].real}" no es un número válido.`,
        );
      }

      // Inicial/Entrega/Vendido se autocompletan en el QR (cierre previo + traspasos +
      // ventas Fudo). Guardamos siempre un número (0 si vacío) para que la tabla de
      // "Detalle del día" nunca muestre "—" y el cuadre Inicial+Entrega−Vendido=Real
      // se pueda verificar contra el conteo físico.
      const numOrZero = (s: string) => {
        const v = num(s);
        return Number.isFinite(v) ? v : 0;
      };
      const payload = conDatos.map(([productoId, f]) => ({
        fecha,
        local,
        producto_id: productoId,
        tipo: 'pasta' as const,
        turno,
        cantidad_real: num(f.real),
        unidad: 'porciones' as const,
        inicial: numOrZero(f.inicial),
        entrega: numOrZero(f.entrega),
        vendido: numOrZero(f.vendido),
        responsable: responsable.trim(),
      }));

      const { error } = await supabase.from('cocina_cierre_dia').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      setMensaje('✅ Cierre guardado.');
      qc.invalidateQueries({ queryKey: ['mostrador-cierre-actual'] });
      qc.invalidateQueries({ queryKey: ['cocina-cierre-dia'] });
      qc.invalidateQueries({ queryKey: ['cocina-cierre-faltantes'] });
      // El cierre define el stock inicial del próximo turno → refrescar todo el stock.
      invalidarStockCocina(qc);
      setTimeout(() => setMensaje(null), 2500);
    },
    onError: (e) => {
      setMensaje(`❌ ${mensajeErrorAmigable(e, 'No se pudo guardar el cierre')}`);
      setTimeout(() => setMensaje(null), 4000);
    },
  });

  // Mostrar TODAS las pastas activas del local. El cierre se controla sobre todas
  // (puede haber stock previo aunque no haya traslado del día). Las que tienen
  // movimiento desde el último cierre (entrega, ventas o inicial > 0) van primero.
  const visibles = useMemo(() => {
    if (!pastas) return [];
    const conMovimiento = new Set<string>();
    for (const [pid, f] of Object.entries(filas)) {
      if (
        (Number(f.inicial) || 0) > 0 ||
        (Number(f.entrega) || 0) > 0 ||
        (Number(f.vendido) || 0) > 0
      ) {
        conMovimiento.add(pid);
      }
    }
    (cierreActual ?? []).forEach((c) => conMovimiento.add(c.producto_id));
    return [...pastas].sort((a, b) => {
      const am = conMovimiento.has(a.id) ? 0 : 1;
      const bm = conMovimiento.has(b.id) ? 0 : 1;
      if (am !== bm) return am - bm;
      return a.nombre.localeCompare(b.nombre);
    });
  }, [pastas, filas, cierreActual]);

  if (loadingPastas) {
    return <div className="py-12 text-center text-sm text-gray-400">Cargando…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3">
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <label className="mb-1 block text-xs font-medium text-gray-700">Turno</label>
        <div className="mb-3 flex gap-2">
          {(['mediodia', 'noche'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTurno(t)}
              className={cn(
                'flex-1 rounded border px-3 py-2 text-sm font-medium transition',
                turno === t
                  ? 'border-rodziny-600 bg-rodziny-50 text-rodziny-700'
                  : 'border-gray-300 bg-white text-gray-500',
              )}
            >
              {t === 'mediodia' ? '🌅 Mediodía' : '🌇 Noche'}
            </button>
          ))}
        </div>
        <label className="mb-1 block text-xs font-medium text-gray-700">Responsable *</label>
        <input
          type="text"
          value={responsable}
          onChange={(e) => setResponsable(e.target.value)}
          placeholder="Tu nombre"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        {cierreActual && cierreActual.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            ⚠️ Ya hay un cierre cargado en este turno. Al guardar se reemplaza.
          </p>
        )}
      </div>

      {visibles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center">
          <p className="text-2xl">📦</p>
          <p className="mt-2 text-sm font-medium text-gray-700">
            No hay pastas cargadas
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Cargalas en Cocina → Productos con tipo "pasta" para que aparezcan acá.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-gray-200 bg-white">
            {visibles.map((p, idx) => {
              const f = filas[p.id] ?? { inicial: '', entrega: '', vendido: '', real: '' };
              const ini = Number(f.inicial) || 0;
              const ent = Number(f.entrega) || 0;
              const ven = Number(f.vendido) || 0;
              const esperado = ini + ent - ven; // referencia para el cocinero
              return (
                <div
                  key={p.id}
                  className={cn('p-3', idx < visibles.length - 1 && 'border-b border-gray-100')}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-800">{p.nombre}</p>
                    {(ini > 0 || ent > 0 || ven > 0) && (
                      <p className="text-[10px] text-gray-500">
                        ini <span className="font-medium text-gray-700">{ini}</span>
                        {' · '}
                        ent <span className="font-medium text-gray-700">{ent}</span>
                        {' · '}
                        vend <span className="font-medium text-gray-700">{ven}</span>
                        {' = '}
                        <span className="font-semibold text-gray-800">
                          {Math.max(0, esperado)}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      min="0"
                      value={f.real}
                      onChange={(e) => setCampo(p.id, 'real', e.target.value)}
                      placeholder="0"
                      className="w-full rounded border-2 border-gray-300 px-3 py-2 text-right text-base font-medium tabular-nums focus:border-rodziny-500 focus:outline-none"
                    />
                    <span className="text-xs text-gray-500">porc.</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3 px-2 text-[10px] text-gray-500">
            <span>
              Cargá el stock real (físico) que queda al cierre del turno. Esto define el stock
              inicial del mostrador para el próximo turno.
            </span>
          </div>

          {mensaje && (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center text-sm">
              {mensaje}
            </div>
          )}

          <button
            onClick={() => guardar.mutate()}
            disabled={guardar.isPending}
            className="w-full rounded-lg bg-rodziny-800 py-3 text-base font-semibold text-white hover:bg-rodziny-700 disabled:opacity-50"
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar cierre de turno'}
          </button>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Cierre simple — Salsas (kg) y Postres (unidades). Sin turno (fin de día).
// ════════════════════════════════════════════════════════════════════════════

function CierreSimple({
  local,
  tipo,
  unidad,
}: {
  local: Local;
  tipo: TipoSimple;
  unidad: 'kg' | 'unidades';
}) {
  const meta = TAB_META[tipo];
  const labelLower = meta.label.toLowerCase();
  const qc = useQueryClient();
  const fecha = hoyAR();
  const [responsable, setResponsable] = useState('');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Salsas, postres y panadería viven en cocina_recetas (no en cocina_productos
  // como las pastas). Tras el refactor de recetas, `tipo` es solo receta/subreceta:
  // lo que antes era tipo='postre'/'salsa'/'panaderia' ahora está en `categoria`
  // (recetas vendibles) o `rol` (subrecetas-base).
  //  · Postres   → solo los VENDIBLES (las porciones que se cuentan al cierre).
  //  · Salsas    → vendibles + subrecetas-base (al cierre se pesa TODA la salsa).
  //  · Panadería → vendibles + subrecetas-base (conteo físico de todo).
  const { data: productos, isLoading } = useQuery({
    queryKey: ['mostrador-simple-recetas', local, tipo],
    queryFn: async () => {
      let q = supabase
        .from('cocina_recetas')
        .select('id, nombre')
        .eq('activo', true)
        .eq('local', local);
      if (tipo === 'postre') {
        // Postres + pastelería POR PORCIÓN (lo que se cuenta en la heladera del
        // mostrador). Las tortas enteras "(ALMACEN)" no entran: van por pedido
        // (módulo Almacén). Saavedra cierra toda la repostería dulce en este tab.
        q = q
          .in('categoria', ['postre', 'pasteleria'])
          .eq('vendible', true)
          .not('nombre', 'ilike', '%almacen%');
      } else if (tipo === 'salsa') {
        q = q.or('categoria.eq.salsa,rol.eq.salsa_base');
      } else if (tipo === 'milanesa') {
        // Se cuenta la subreceta base (rol='milanesa_base'): los kg de milanesa
        // que quedan congelados al cierre re-baselinean el stock contra esa receta.
        q = q.eq('rol', 'milanesa_base');
      } else {
        q = q.or('categoria.eq.panificado,rol.eq.panificado');
      }
      const { data, error } = await q.order('nombre');
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id, nombre: r.nombre, codigo: '' })) as Producto[];
    },
  });

  const { data: cierreActual } = useQuery({
    queryKey: ['mostrador-simple-cierre', local, fecha, tipo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_cierre_dia')
        .select('id, receta_id, producto_id, cantidad_real, notas, responsable')
        .eq('local', local)
        .eq('fecha', fecha)
        .eq('tipo', tipo)
        .is('turno', null);
      if (error) throw error;
      return data as Array<{
        id: string;
        receta_id: string | null;
        producto_id: string | null;
        cantidad_real: number;
        notas: string | null;
        responsable: string | null;
      }>;
    },
  });

  useEffect(() => {
    if (!productos) return;
    const v: Record<string, string> = {};
    const n: Record<string, string> = {};
    for (const p of productos) {
      // Match por receta_id (nuevo) con fallback a producto_id (legacy)
      const previo = cierreActual?.find(
        (c) => c.receta_id === p.id || c.producto_id === p.id,
      );
      v[p.id] = previo ? String(previo.cantidad_real) : '';
      n[p.id] = previo?.notas ?? '';
    }
    setValores(v);
    setNotas(n);
    if (cierreActual && cierreActual.length > 0 && cierreActual[0].responsable) {
      setResponsable(cierreActual[0].responsable);
    }
  }, [productos, cierreActual]);

  const guardar = useMutation({
    mutationFn: async () => {
      if (!responsable.trim()) throw new Error('Cargá tu nombre antes de guardar');
      const conDatos = Object.entries(valores).filter(([, v]) => v.trim() !== '');
      if (conDatos.length === 0) throw new Error('Cargá al menos un producto');

      // Borrar el cierre previo por columnas naturales (local/fecha/tipo, turno
      // NULL en salsa/postre/panadería), NO por los ids del snapshot
      // `cierreActual` — si está viejo deja filas sin borrar y se duplican.
      const { error: errDel } = await supabase
        .from('cocina_cierre_dia')
        .delete()
        .eq('local', local)
        .eq('fecha', fecha)
        .eq('tipo', tipo)
        .is('turno', null);
      if (errDel) throw errDel;

      // Salsas/postres se identifican por receta_id (no por producto_id).
      // Parse robusto: convención AR (decimal con coma). Sacamos espacios y
      // pasamos coma→punto. Cualquier valor que no quede como número válido
      // (doble separador, miles con punto, texto) se RECHAZA con mensaje claro
      // en vez de insertar NULL (cantidad_real es NOT NULL → rompía el cierre).
      // Guardamos el nombre del producto para poder apagar también los lotes
      // huérfanos del modelo viejo (con nombre_libre, sin receta_id) que si no
      // se desactivan siguen sumando al stock visible.
      const cierres = conDatos.map(([recetaId, valor]) => ({
        recetaId,
        nombre: productos?.find((p) => p.id === recetaId)?.nombre ?? null,
        cantidad: Number(valor.trim().replace(/\s/g, '').replace(',', '.')),
      }));
      const mala = cierres.find(
        (c) => !Number.isFinite(c.cantidad) || c.cantidad < 0,
      );
      if (mala) {
        const nom =
          productos?.find((p) => p.id === mala.recetaId)?.nombre ?? 'una salsa';
        throw new Error(
          `Revisá la cantidad de "${nom}": "${valores[mala.recetaId]}" no es un número válido. Usá coma para los decimales (ej: 8,910).`,
        );
      }

      // Tope de sanidad: un valor desmesurado casi siempre es gramos cargados
      // como kilos (ej: 3270 en vez de 3,27). Lo rebotamos con mensaje claro en
      // vez de guardar un stock disparatado. kg → 100 / unidades → 1000.
      const topeSanidad = unidad === 'kg' ? 100 : 1000;
      const absurda = cierres.find((c) => c.cantidad > topeSanidad);
      if (absurda) {
        const nom =
          productos?.find((p) => p.id === absurda.recetaId)?.nombre ?? 'un producto';
        const enKg = unidad === 'kg' ? ` (¿cargaste gramos en vez de kilos? serían ${(absurda.cantidad / 1000).toLocaleString('es-AR')} kg)` : '';
        throw new Error(
          `La cantidad de "${nom}" (${absurda.cantidad.toLocaleString('es-AR')} ${unidad}) parece un error.${enKg} Revisala y volvé a guardar.`,
        );
      }

      const payload = cierres.map(({ recetaId, cantidad }) => ({
        fecha,
        local,
        producto_id: null as null,
        receta_id: recetaId,
        tipo,
        turno: null as null,
        cantidad_real: cantidad,
        unidad,
        responsable: responsable.trim(),
        notas: notas[recetaId]?.trim() || null,
      }));

      const { error } = await supabase.from('cocina_cierre_dia').insert(payload);
      if (error) throw error;

      // Sincronizar con cocina_lotes_produccion para que el stock visible cuadre
      // con lo que se cerró: apaga los lotes activos previos de la receta + local,
      // y crea uno nuevo con la cantidad real del cierre. Así Dashboard/Stock
      // arrancan el día siguiente con exactamente lo que se contó al cerrar.
      const unidadLote: 'kg' | 'unid' | 'lt' = unidad === 'kg' ? 'kg' : 'unid';
      for (const { recetaId, nombre, cantidad } of cierres) {
        // (a) Apagar lotes con la misma receta vinculada (modelo actual)
        const { error: errOff } = await supabase
          .from('cocina_lotes_produccion')
          .update({ en_stock: false })
          .eq('local', local)
          .eq('receta_id', recetaId)
          .eq('en_stock', true);
        if (errOff) throw errOff;

        // (b) Apagar también lotes huérfanos con nombre_libre matching (modelo
        // viejo). Si no se desactivan, siguen sumando al stock visible junto con
        // el lote nuevo del cierre y los valores no se actualizan.
        if (nombre) {
          const { error: errOff2 } = await supabase
            .from('cocina_lotes_produccion')
            .update({ en_stock: false })
            .eq('local', local)
            .is('receta_id', null)
            .ilike('nombre_libre', nombre)
            .eq('en_stock', true);
          if (errOff2) throw errOff2;
        }

        if (cantidad > 0) {
          // origen='cierre' evita que el trigger trg_pizarron_lote_produccion
          // marque items del pizarrón como ciclo_completo: el cierre es
          // re-baselining de stock, no producción real.
          const { error: errIns } = await supabase.from('cocina_lotes_produccion').insert({
            fecha,
            local,
            categoria: tipo,
            receta_id: recetaId,
            nombre_libre: null,
            cantidad_producida: cantidad,
            unidad: unidadLote,
            en_stock: true,
            origen: 'cierre',
          });
          if (errIns) throw errIns;
        }
      }
    },
    onSuccess: () => {
      setMensaje('✅ Cierre guardado. Stock actualizado.');
      qc.invalidateQueries({ queryKey: ['mostrador-simple-cierre'] });
      qc.invalidateQueries({ queryKey: ['cocina-cierre-dia'] });
      qc.invalidateQueries({ queryKey: ['cocina-cierre-faltantes'] });
      // El cierre también define el stock actual del tab Stock y catálogo.
      invalidarStockCocina(qc);
      setTimeout(() => setMensaje(null), 2500);
    },
    onError: (e) => {
      setMensaje(`❌ ${mensajeErrorAmigable(e, 'No se pudo guardar el cierre')}`);
      setTimeout(() => setMensaje(null), 4000);
    },
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">Cargando…</div>;
  }

  if (!productos || productos.length === 0) {
    return (
      <div className="mx-auto max-w-md p-3">
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center">
          <p className="text-2xl">{meta.emoji}</p>
          <p className="mt-2 text-sm font-medium text-gray-700">
            No hay {labelLower} cargadas
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Cargalas primero desde el ERP en Cocina → Recetas → "Nueva receta" con tipo "
            {tipo}".
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3">
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <label className="mb-1 block text-xs font-medium text-gray-700">Responsable *</label>
        <input
          type="text"
          value={responsable}
          onChange={(e) => setResponsable(e.target.value)}
          placeholder="Tu nombre"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        {cierreActual && cierreActual.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            ⚠️ Ya hay un cierre cargado para hoy. Al guardar se reemplaza.
          </p>
        )}
        <p className="mt-2 text-[11px] text-gray-500">
          Cierre fin de día: lo que pesaste / contaste físico al cerrar el local.
        </p>
      </div>

      {tipo === 'salsa' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-800">
          <p className="font-semibold">⚖ Cómo pesar al cierre</p>
          <p className="mt-1">
            Pesá <strong>TODA la salsa que sobró</strong>: los potes que quedaron en mostrador{' '}
            <em>+</em> el recipiente grande en cámara. Sumá los dos pesos y cargá el total acá.
          </p>
          <p className="mt-1 text-blue-700">
            Este número reemplaza el stock anterior. Si te olvidás de pesar la cámara, mañana vas
            a tener stock fantasma.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white">
        {productos.map((p, idx) => (
          <div
            key={p.id}
            className={cn('p-3', idx < productos.length - 1 && 'border-b border-gray-100')}
          >
            <p className="text-sm font-medium text-gray-800">{p.nombre}</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type={unidad === 'kg' ? 'text' : 'number'}
                inputMode={unidad === 'kg' ? 'decimal' : 'numeric'}
                pattern={unidad === 'kg' ? '[0-9]*[.,]?[0-9]*' : undefined}
                value={valores[p.id] ?? ''}
                onChange={(e) =>
                  setValores((prev) => ({
                    ...prev,
                    [p.id]:
                      unidad === 'kg' ? normalizarDecimal(e.target.value) : e.target.value,
                  }))
                }
                placeholder={unidad === 'kg' ? '1,5' : '8'}
                className="flex-1 rounded border-2 border-gray-300 px-3 py-2 text-base font-semibold tabular-nums focus:border-rodziny-500 focus:outline-none"
              />
              <span className="text-sm font-medium text-gray-500">
                {unidad === 'kg' ? 'kg' : 'u'}
              </span>
            </div>
            {unidad === 'kg' &&
              parseDecimal(valores[p.id]) > 0 &&
              equivalenteKgGramos(parseDecimal(valores[p.id])) && (
                <p className="mt-1 text-[11px] text-gray-500">
                  = {equivalenteKgGramos(parseDecimal(valores[p.id]))}
                </p>
              )}
            <input
              type="text"
              value={notas[p.id] ?? ''}
              onChange={(e) => setNotas((prev) => ({ ...prev, [p.id]: e.target.value }))}
              placeholder="Notas (opcional)"
              className="mt-2 w-full rounded border border-gray-200 px-3 py-1.5 text-xs"
            />
          </div>
        ))}
      </div>

      {mensaje && (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center text-sm">
          {mensaje}
        </div>
      )}

      <button
        onClick={() => guardar.mutate()}
        disabled={guardar.isPending}
        className="w-full rounded-lg bg-rodziny-800 py-3 text-base font-semibold text-white hover:bg-rodziny-700 disabled:opacity-50"
      >
        {guardar.isPending ? 'Guardando…' : `Guardar cierre de ${labelLower}`}
      </button>
    </div>
  );
}

