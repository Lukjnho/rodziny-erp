import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
// Pantalla pública de tablet: va SIEMPRE como rol anon, igual que /produccion,
// /pizarron, /fichar, /recepcion y /deposito. Con el cliente normal, si alguien
// dejó su usuario logueado en esa tablet, el cierre de turno corría como él: si
// ese usuario no tiene permiso de cocina, la RLS le bloquea los UPDATE y los
// descuentos de stock se pierden EN SILENCIO (0 filas, sin error) mientras la
// pantalla dice que guardó bien.
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';
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

// Vedia y Saavedra cierran pasta (mostrador) / salsa / postre. El cierre de pasta
// por turno (cocina_cierre_dia) es independiente del stock de cámara
// (v_cocina_stock_pastas ← cocina_cierre_camara): no se duplica conteo. Saavedra
// suma además panadería + milanesa (conteo físico manual; la milanesa se cuenta en
// kg que quedan congelados).
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

// Productos-pan que se cuentan en el cierre de panadería de Saavedra (curado por
// id de PRODUCTO). El stock vive en cocina_productos, así que el cierre cuenta el
// producto directo (como las pastas). El resto de 'panificado' (facturas,
// medialunas, etc.) no entra. Focaccia se suma cuando Tomy cargue su producto.
const PRODUCTOS_PAN_CIERRE_SAAVEDRA: string[] = [
  '771d5ccc-6614-4eb4-80c3-3a4a83ddf151', // Pan Brioche
  '4daa2926-8127-45b1-ae70-5be2d9c1cc11', // Pan de Molde
  '29d53880-9b1f-4847-9a59-14c84a4e3c07', // Pan de Campo
  'd8c58792-de2a-492c-8b27-b36fccf37550', // Pan Lactal
  'a6fb9940-d0f3-4ee2-a01b-ea004a4e80f6', // Pan de Servicio
  'd81fc5ee-fac9-4e1a-b0a5-1dca6d84344b', // Prepizza
];

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

// Qué turno se está cerrando, según el reloj.
//
// ⚠️ ANTES ARRANCABA SIEMPRE EN 'mediodia'. El que cerraba a las once de la noche
// tenía que acordarse de tocar "Noche"; si no lo tocaba, el guardado PISABA el
// conteo del mediodía (el cierre se borra y se repone por local/fecha/tipo/turno).
// Un dedazo esperando pasar, en la pantalla que define el stock del mostrador.
function turnoPorReloj(): Turno {
  // Argentina = UTC-3 sin horario de verano, mismo criterio que hoyAR().
  const h = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCHours();
  // 05:00–16:59 mediodía · 17:00–04:59 noche (la madrugada sigue siendo el turno
  // noche del día operativo anterior, igual que en hoyAR()).
  return h >= 5 && h < 17 ? 'mediodia' : 'noche';
}

/** Hora del día en formato HH:MM, hora Argentina. */
function horaAR(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return (
    String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0')
  );
}

/** Lee un casillero como número. Vacío o basura = 0, nunca NaN en pantalla. */
function numeroDe(s: string): number {
  const v = Number((s ?? '').trim().replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
}

/** Un renglón del detalle: etiqueta chica a la izquierda, número mono a la derecha. */
function RenglonDetalle({
  k,
  v,
  fuerte,
}: {
  k: string;
  v: number | string;
  fuerte?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span
        className={cn(
          'text-[10px] uppercase tracking-wider',
          fuerte ? 'font-semibold text-zinc-700' : 'text-zinc-400',
        )}
      >
        {k}
      </span>
      <span
        className={cn(
          'font-mono text-sm tabular-nums',
          fuerte ? 'font-semibold text-zinc-900' : 'text-zinc-600',
        )}
      >
        {v}
      </span>
    </div>
  );
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
  // Default = primera tab del local (pasta en ambos).
  const [tab, setTab] = useState<TipoTab>(TABS_POR_LOCAL[local][0]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-between bg-rodziny-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-rodziny-600 text-xs font-bold">
            R
          </div>
          {/* En Saavedra no hay mostrador: se cuenta la camara. El rotulo lo dice. */}
          <span className="text-sm font-semibold">
            {local === 'saavedra' ? 'Conteo de camara' : 'Cierre de mostrador'}
          </span>
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
  const [turno, setTurno] = useState<Turno>(turnoPorReloj);
  // Qué renglón tiene el detalle abierto. Uno solo por vez: la pantalla se mira
  // parado y con la tablet en una mano, no es un tablero para estudiar.
  const [abierto, setAbierto] = useState<string | null>(null);
  // Productos donde la persona YA tipeó un número. Ver el efecto de hidratación.
  const tocados = useRef<Set<string>>(new Set());
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

  // ⚠️ LOS DOS LOCALES NO FUNCIONAN IGUAL, Y NO ES UN OLVIDO.
  //
  // Vedia tiene la fábrica sectorizada: la pasta viaja de la cámara al mostrador y
  // ese viaje se anota (503 traspasos desde abril). Saavedra tiene todo en un mismo
  // ambiente: lo que se produce va derecho a la cámara y de ahí se vende, sin etapa
  // intermedia. Por eso `cocina_traspasos` NO TIENE UNA SOLA FILA de Saavedra en
  // cinco meses, y por eso las migraciones 125 y 161 ya usan el cierre de turno como
  // baseline de cámara para ese local.
  //
  // Consecuencia para esta pantalla: lo que hace subir el stock es el TRASPASO en
  // Vedia y la PRODUCCIÓN en Saavedra. Usar traspasos en Saavedra hacía que 1 de cada
  // 4 conteos del mediodía diera "de más" sin motivo real.
  const esSaavedra = local === 'saavedra';

  const { data: lotesProducidos } = useQuery({
    queryKey: ['mostrador-lotes-producidos', local],
    enabled: esSaavedra,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('producto_id, porciones, created_at')
        .eq('local', local)
        .not('porciones', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as Array<{ producto_id: string; porciones: number; created_at: string }>;
    },
    refetchInterval: 2 * 60 * 1000,
  });

  // Lo que hay en la cámara para bajar. Sin este dato el que cuenta ve "quedan 12"
  // y no sabe si en el freezer hay cero o doscientas, que es justo la decisión que
  // tiene que tomar parado ahí. anon puede leer esta vista (verificado 5-sep-2026).
  const { data: enCamara } = useQuery({
    queryKey: ['mostrador-camara', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cocina_stock_pastas')
        .select('producto_id, porciones_neto_camara')
        .eq('local', local);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as Array<{
        producto_id: string;
        porciones_neto_camara: number | null;
      }>) {
        m.set(r.producto_id, Math.max(0, Number(r.porciones_neto_camara) || 0));
      }
      return m;
    },
    refetchInterval: 2 * 60 * 1000,
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
        created_at: string;
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
      // Se guarda el último conteo (el primero que aparece, porque viene ordenado
      // de más nuevo a más viejo) Y el máximo histórico de ese producto, que es lo
      // que usa el guardarraíl de abajo para detectar un dedazo.
      const m = new Map<
        string,
        { cantidad_real: number; created_at: string; maxHistorico: number }
      >();
      for (const c of (data ?? []) as Array<{
        producto_id: string;
        cantidad_real: number;
        created_at: string;
        fecha: string;
        turno: string;
      }>) {
        if (c.fecha === fecha && c.turno === turno) continue; // saltar el cierre actual
        const previo = m.get(c.producto_id);
        if (!previo) {
          m.set(c.producto_id, {
            cantidad_real: c.cantidad_real,
            created_at: c.created_at,
            maxHistorico: c.cantidad_real,
          });
        } else if (c.cantidad_real > previo.maxHistorico) {
          previo.maxHistorico = c.cantidad_real;
        }
      }
      return m;
    },
  });

  // Las ventanas de venta, agrupadas por el último conteo de cada producto.
  //
  // ⚠️ ANTES SE USABA UNA SOLA VENTANA: la del conteo MÁS VIEJO de todos los
  // productos. Como el Scarpinocc de Vedia se contó el 31-ago y el resto anoche,
  // a CADA pasta se le restaban cinco días de ventas y el "vendido" salía inflado.
  // Con la diferencia en vivo eso haría aparecer "sobran 40" donde en realidad
  // cuadra, y ofrecería anotar traspasos que nunca existieron.
  //
  // Medido el 5-sep-2026: son 2 ventanas distintas por local (los productos se
  // cuentan casi todos en la misma tanda), así que esto son 2 llamadas a Fudo en
  // vez de 1 — no una por producto.
  const ventanas = useMemo(() => {
    if (!ultimosCierres || ultimosCierres.size === 0) return [`${fecha}T03:00:00Z`];
    const set = new Set<string>();
    for (const c of ultimosCierres.values()) set.add(new Date(c.created_at).toISOString());
    return [...set].sort();
  }, [ultimosCierres, fecha]);

  const { data: fudoPorVentana } = useQuery({
    queryKey: ['mostrador-fudo-por-ventana', local, ventanas],
    queryFn: async () => {
      const ahoraISO = new Date().toISOString();
      const m = new Map<string, FudoData | null>();
      for (const desdeISO of ventanas) {
        const { data, error } = await supabase.functions.invoke('fudo-productos', {
          body: {
            local,
            fechaDesde: desdeISO.slice(0, 10),
            fechaHasta: ahoraISO.slice(0, 10),
            desdeISO,
            hastaISO: ahoraISO,
          },
        });
        m.set(desdeISO, !error && data?.ok ? (data.data as FudoData) : null);
      }
      return m;
    },
    staleTime: 60_000, // refrescar máximo cada minuto (Fudo es prácticamente real-time)
    refetchInterval: 2 * 60_000,
  });

  // Cambiar de turno (o de día, o de local) empieza un conteo NUEVO: lo que se
  // tipeó antes no aplica. Sin esto, la preservación de abajo arrastraría los
  // números del mediodía al conteo de la noche.
  useEffect(() => {
    tocados.current.clear();
  }, [turno, fecha, local]);

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
      // Lo que ENTRÓ al stock desde el último conteo: traspaso en Vedia, producción
      // en Saavedra (ver el comentario largo arriba).
      const entrega = esSaavedra
        ? (lotesProducidos ?? [])
            .filter(
              (l) =>
                l.producto_id === p.id &&
                (ultimo == null || l.created_at > ultimo.created_at),
            )
            .reduce((s, l) => s + (l.porciones ?? 0), 0)
        : (traspasos ?? [])
            .filter(
              (t) =>
                t.producto_id === p.id &&
                (ultimo == null || t.created_at > ultimo.created_at),
            )
            .reduce((s, t) => s + (t.porciones ?? 0), 0);
      // Cada pasta mira su propia ventana: la que arranca en SU último conteo.
      const ventana = ultimo ? new Date(ultimo.created_at).toISOString() : ventanas[0];
      const vendido = ventasFudoDelProducto(p, fudoPorVentana?.get(ventana)?.ranking);
      nuevas[p.id] = {
        inicial: String(inicial),
        entrega: String(entrega),
        vendido: String(vendido),
        real: '',
      };
    }
    // ⚠️ PRESERVAR LO QUE YA SE TIPEÓ. Este efecto depende de `traspasos`, que se
    // recarga solo cada 60 segundos: si alguien anotaba una bajada desde el depósito
    // mientras acá estaban contando, este setFilas le borraba TODOS los números a la
    // persona, en silencio y sin manera de recuperarlos.
    setFilas((prev) => {
      const salida: Record<string, FilaPasta> = {};
      for (const [pid, fila] of Object.entries(nuevas)) {
        salida[pid] = tocados.current.has(pid)
          ? { ...fila, real: prev[pid]?.real ?? fila.real }
          : fila;
      }
      return salida;
    });
    if (cierreActual && cierreActual.length > 0 && cierreActual[0].responsable) {
      setResponsable(cierreActual[0].responsable);
    }
  }, [
    pastas,
    cierreActual,
    ultimosCierres,
    traspasos,
    lotesProducidos,
    esSaavedra,
    fudoPorVentana,
    ventanas,
  ]);

  function setCampo(pid: string, campo: keyof FilaPasta, valor: string) {
    if (campo === 'real') tocados.current.add(pid);
    setFilas((prev) => ({
      ...prev,
      [pid]: { ...prev[pid], [campo]: valor },
    }));
  }

  // El traspaso que faltó anotar.
  //
  // 🔑 POR QUÉ ESTE BOTÓN. De los 16 casos en 90 días donde el conteo dio mucho más
  // de lo esperado, NINGUNO era un dedazo: era pasta bajada del freezer que nadie
  // anotó (contaron 61 donde figuraban 11). Ese papel que falta es el que rompe el
  // stock, y el único momento en que alguien se acuerda es justo ahora, contando.
  const anotarTraspaso = useMutation({
    mutationFn: async ({ productoId, porciones }: { productoId: string; porciones: number }) => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .insert({
          producto_id: productoId,
          local,
          fecha: hoyAR(),
          hora: new Date().toTimeString().slice(0, 8),
          porciones,
          responsable: responsable.trim() || null,
          notas: 'Anotado desde el cierre de mostrador: la cuenta daba de más',
        })
        .select('id');
      if (error) throw error;
      // Un INSERT que la RLS bloquea devuelve 0 filas SIN error. Sin este chequeo,
      // el botón diría "listo" y no habría quedado nada anotado.
      if (!data || data.length === 0) {
        throw new Error('La base no confirmó la bajada. Avisale a Lucas antes de seguir.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mostrador-traspasos-cierre'] });
      qc.invalidateQueries({ queryKey: ['mostrador-camara'] });
    },
    onError: (e: Error) => window.alert(mensajeErrorAmigable(e, 'No se pudo anotar la bajada')),
  });

  const guardar = useMutation({
    mutationFn: async () => {
      if (!responsable.trim()) throw new Error('Cargá tu nombre antes de guardar');
      const conDatos = Object.entries(filas).filter(([, f]) => f.real.trim() !== '');
      if (conDatos.length === 0) throw new Error('Cargá al menos un producto con stock real');

      const num = (s: string) => Number(s.trim().replace(/\s/g, '').replace(',', '.'));
      // Inicial/Entrega/Vendido se autocompletan en el QR (cierre previo + traspasos +
      // ventas Fudo). Guardamos siempre un número (0 si vacío) para que la tabla de
      // "Detalle del día" nunca muestre "—" y el cuadre Inicial+Entrega−Vendido=Real
      // se pueda verificar contra el conteo físico.
      const numOrZero = (s: string) => {
        const v = num(s);
        return Number.isFinite(v) ? v : 0;
      };

      // ⚠️ VALIDAR ANTES DE BORRAR. Esta comprobación estaba DESPUÉS del delete: si
      // alguien tipeaba cualquier cosa en un casillero, el cierre del turno YA se
      // había borrado y el error dejaba al turno sin ningún conteo guardado.
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

      // Guardarraíl del dedazo. El 4-sep-2026 se cargaron 610 porciones de
      // tagliatelles donde iban 61: la pantalla lo aceptó sin chistar, y ese número
      // manda el stock del mostrador hasta el conteo siguiente.
      //
      // 🔑 SE COMPARA CONTRA EL MÁXIMO HISTÓRICO DE ESE PRODUCTO, no contra lo que
      // figura que bajó. Probado contra los últimos 90 días (2.111 conteos):
      //   · contra lo que bajó  → saltaría 16 veces, y NINGUNA es un dedazo: son
      //     reposiciones que nadie anotó como traspaso (contaron 61 y figuraban 11).
      //     Un aviso que salta por eso se clickea que sí sin leerlo y deja de servir.
      //   · contra el máximo histórico → saltaría 1 vez en 90 días, y sí agarra el 610
      //     (el máximo de ese producto era 71).
      //
      // NO bloquea: el que cuenta es el que sabe, y la regla del proyecto es que el
      // turno siempre se pueda cerrar. Solo obliga a mirar el número una vez.
      const sospechosos = conDatos
        .map(([pid, f]) => {
          const real = num(f.real);
          const maxHist = ultimosCierres?.get(pid)?.maxHistorico ?? 0;
          // Sin historia todavía, un número redondo grande igual merece una mirada.
          const exagerado =
            maxHist > 0 ? real > maxHist * 2 && real - maxHist >= 50 : real >= 200;
          if (!exagerado) return null;
          const nombre = pastas?.find((p) => p.id === pid)?.nombre ?? 'una pasta';
          return { nombre, real, maxHist };
        })
        .filter((x): x is { nombre: string; real: number; maxHist: number } => x !== null);

      if (sospechosos.length > 0) {
        const detalle = sospechosos
          .map((x) =>
            x.maxHist > 0
              ? `• ${x.nombre}: pusiste ${x.real}. Lo más que hubo alguna vez fue ${x.maxHist}.`
              : `• ${x.nombre}: pusiste ${x.real}, y no hay conteos anteriores para comparar.`,
          )
          .join('\n');
        const seguir = window.confirm(
          `Revisá estos números antes de guardar:\n\n${detalle}\n\n¿Los guardo igual?`,
        );
        if (!seguir) {
          throw new Error('No se guardó nada. Corregí los números y volvé a intentar.');
        }
      }

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

  // ¿Llegó el dato de ventas? Hoy sale de la API de Fudo. El día que Fudo se corte
  // —o simplemente si falla la llamada— esto queda en false y la pantalla deja de
  // hablar de "faltan": sin saber cuánto se vendió, un faltante no se puede afirmar.
  // Lo que SÍ se puede afirmar sin ventas es el sobrante, porque las ventas solo
  // restan: si contaste más de lo máximo posible, entró algo sin registrar. Punto.
  const hayDatoDeVentas = useMemo(() => {
    if (!fudoPorVentana) return false;
    for (const v of fudoPorVentana.values()) if (v) return true;
    return false;
  }, [fudoPorVentana]);

  if (loadingPastas) {
    return <div className="py-12 text-center text-sm text-gray-400">Cargando…</div>;
  }

  const contadas = visibles.filter((p) => (filas[p.id]?.real ?? '').trim() !== '').length;
  const yaCerrado = cierreActual && cierreActual.length > 0 ? cierreActual[0] : null;

  return (
    // pb-28 deja lugar al botón fijo de abajo, que en la tablet queda siempre a mano.
    <div className="mx-auto max-w-3xl p-3 pb-28">
      {/* ── Cabecera: turno, quién cuenta, cuánto falta ─────────────────────── */}
      <div className="border border-zinc-300 bg-white">
        <div className="flex">
          {(['mediodia', 'noche'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTurno(t)}
              className={cn(
                'flex-1 border-b px-3 py-3 text-xs font-semibold uppercase tracking-wider transition',
                turno === t
                  ? 'border-zinc-900 bg-zinc-900 text-white'
                  : 'border-zinc-200 bg-white text-zinc-400',
              )}
            >
              {t === 'mediodia' ? 'Mediodía' : 'Noche'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 p-3">
          <input
            type="text"
            value={responsable}
            onChange={(e) => setResponsable(e.target.value)}
            placeholder="Tu nombre"
            className="min-w-0 flex-1 border border-zinc-300 px-3 py-2.5 text-base text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none"
          />
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wider text-zinc-400">Contadas</p>
            <p className="font-mono text-lg font-semibold tabular-nums text-zinc-800">
              {contadas}
              <span className="text-zinc-400">/{visibles.length}</span>
            </p>
          </div>
        </div>

        {yaCerrado && (
          <p className="border-t border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
            Este turno ya está cerrado
            {yaCerrado.responsable ? ' por ' + yaCerrado.responsable : ''} a las{' '}
            {horaAR(yaCerrado.created_at)}. Si guardás de nuevo, se reemplaza.
          </p>
        )}
      </div>

      {visibles.length === 0 ? (
        <div className="mt-3 border border-dashed border-zinc-300 bg-white p-6 text-center">
          <p className="text-sm font-medium text-zinc-700">No hay pastas cargadas</p>
          <p className="mt-1 text-xs text-zinc-500">
            Cargalas en Cocina → Productos con tipo "pasta" para que aparezcan acá.
          </p>
        </div>
      ) : (
        <>
          {/* ── Un renglón por pasta. Cerrado muestra UNA línea; el detalle se abre
                tocándola. Parado y con la tablet en una mano hay que ver el nombre,
                el casillero y si cuadra: nada más. ─────────────────────────────── */}
          <div className="mt-3 border border-zinc-300 bg-white">
            {visibles.map((p, idx) => {
              const f = filas[p.id] ?? { inicial: '', entrega: '', vendido: '', real: '' };
              const inicial = numeroDe(f.inicial);
              const entrega = numeroDe(f.entrega);
              const vendido = numeroDe(f.vendido);
              // TOPE = lo máximo que pudo haber (lo que quedaba + lo que entró).
              // ESPERADO = el tope menos lo vendido.
              const tope = inicial + entrega;
              const esperado = Math.max(0, tope - vendido);
              const tieneReal = f.real.trim() !== '';
              const real = numeroDe(f.real);
              const dif = real - esperado;
              // 🔑 EL EXCEDENTE ES UNA CERTEZA, el "dif" es una estimación. Las ventas
              // solo RESTAN: si se contó más que el tope, entró algo que no se registró,
              // y eso es verdad aunque el dato de ventas esté mal o no exista. Por eso
              // la ACCIÓN se dispara con el excedente y no con el dif.
              const excedente = real - tope;
              const camara = enCamara?.get(p.id) ?? null;
              const estaAbierto = abierto === p.id;

              const ultimoConteo = ultimosCierres?.get(p.id) ?? null;
              const lotesDesdeConteo = esSaavedra
                ? (lotesProducidos ?? []).filter(
                    (l) =>
                      l.producto_id === p.id &&
                      (ultimoConteo == null || l.created_at > ultimoConteo.created_at),
                  )
                : [];

              const estado = !tieneReal
                ? hayDatoDeVentas
                  ? 'deberían quedar ' + esperado
                  : 'puede haber hasta ' + tope
                : excedente > 0
                  ? 'sobran ' + excedente
                  : hayDatoDeVentas
                    ? dif === 0
                      ? 'cuadra'
                      : dif < 0
                        ? 'faltan ' + -dif
                        : 'sobran ' + dif
                    : 'ok';
              const marcado = tieneReal && (excedente > 0 || (hayDatoDeVentas && dif !== 0));

              return (
                <div key={p.id} className={cn(idx > 0 && 'border-t border-zinc-200')}>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold uppercase tracking-tight text-zinc-800">
                        {p.nombre}
                      </p>
                      <button
                        type="button"
                        onClick={() => setAbierto(estaAbierto ? null : p.id)}
                        className="mt-0.5 flex items-center gap-1.5 py-0.5 font-mono text-[11px] tabular-nums"
                      >
                        <span
                          className={cn(
                            'inline-block text-zinc-400 transition-transform',
                            estaAbierto && 'rotate-90',
                          )}
                        >
                          ›
                        </span>
                        <span
                          className={cn(
                            marcado ? 'font-semibold text-amber-700' : 'text-zinc-500',
                          )}
                        >
                          {estado}
                        </span>
                      </button>
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      min="0"
                      value={f.real}
                      onChange={(e) => setCampo(p.id, 'real', e.target.value)}
                      placeholder="—"
                      className={cn(
                        'w-24 shrink-0 border-2 py-2.5 text-center font-mono text-2xl tabular-nums text-zinc-900 focus:border-zinc-900 focus:outline-none',
                        tieneReal ? 'border-zinc-800 bg-white' : 'border-zinc-200 bg-zinc-50',
                      )}
                    />
                  </div>

                  {estaAbierto && (
                    <div className="border-t border-zinc-200 bg-zinc-50 px-3 py-3">
                      <RenglonDetalle
                        k={esSaavedra ? 'Quedaban del conteo anterior' : 'Quedaban del turno anterior'}
                        v={inicial}
                      />
                      <RenglonDetalle
                        k={esSaavedra ? 'Se produjo desde entonces' : 'Bajaron del freezer'}
                        v={entrega}
                      />
                      {esSaavedra && lotesDesdeConteo.length > 0 && (
                        <div className="mb-1 pl-3">
                          {lotesDesdeConteo.map((l) => (
                            <p
                              key={l.created_at + l.porciones}
                              className="font-mono text-[10px] text-zinc-400"
                            >
                              · {l.porciones} porc. a las {horaAR(l.created_at)}
                            </p>
                          ))}
                        </div>
                      )}
                      <RenglonDetalle k="Se vendieron" v={hayDatoDeVentas ? vendido : 'sin dato'} />
                      <div className="my-1.5 border-t border-zinc-300" />
                      <RenglonDetalle
                        k={hayDatoDeVentas ? 'Deberían quedar' : 'Puede haber hasta'}
                        v={hayDatoDeVentas ? esperado : tope}
                        fuerte
                      />
                      {/* En Saavedra la cámara ES este stock: mostrarla aparte sería
                          contar dos veces el mismo pote. */}
                      {camara != null && !esSaavedra && (
                        <RenglonDetalle k="Hay en cámara" v={camara} />
                      )}

                      {/* Vedia: el papel que falta es el traspaso, y se anota acá. */}
                      {tieneReal && excedente > 0 && !esSaavedra && (
                        <button
                          type="button"
                          disabled={anotarTraspaso.isPending}
                          onClick={() => {
                            const ok = window.confirm(
                              '¿Bajaste ' +
                                excedente +
                                ' porciones de ' +
                                p.nombre +
                                ' del freezer sin anotarlo? Lo anoto ahora y la cuenta cierra.',
                            );
                            if (ok)
                              anotarTraspaso.mutate({ productoId: p.id, porciones: excedente });
                          }}
                          className="mt-3 w-full bg-zinc-900 px-3 py-3 text-xs font-semibold uppercase tracking-wider text-white disabled:opacity-50"
                        >
                          {anotarTraspaso.isPending
                            ? 'Anotando…'
                            : 'Anotar ' + excedente + ' bajadas del freezer'}
                        </button>
                      )}

                      {/* Saavedra: acá no hay traspaso que anotar. Lo que falta es la
                          producción, y se carga en la pantalla de Producción, no en esta.
                          Lo que sí hace esta pantalla es MOSTRAR qué figura cargado, que
                          es el dato que nadie tenía a mano. */}
                      {tieneReal && excedente > 0 && esSaavedra && (
                        <div className="mt-3 border border-amber-300 bg-amber-50 px-3 py-2">
                          <p className="text-[11px] font-semibold leading-snug text-amber-900">
                            Contaste {excedente} más de lo que podía haber.
                          </p>
                          <p className="mt-1 text-[11px] leading-snug text-amber-800">
                            {lotesDesdeConteo.length === 0
                              ? 'No figura ninguna producción cargada desde el conteo anterior. Fijate si falta cargarla en la pantalla de Producción.'
                              : 'Puede que falte cargar una producción: arriba está la que sí figura.'}
                          </p>
                        </div>
                      )}

                      {tieneReal && excedente <= 0 && hayDatoDeVentas && dif < 0 && (
                        <p className="mt-3 text-[11px] leading-snug text-zinc-500">
                          Faltan {-dif}. Puede ser merma, o una venta que todavía no entró al
                          sistema.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-2 px-1 text-[10px] leading-snug text-zinc-400">
            Cargá el stock físico que queda al cierre del turno. Ese número define el stock
            inicial del turno siguiente.
          </p>

          {mensaje && (
            <p className="mt-3 border border-zinc-300 bg-white px-3 py-2 text-center text-sm text-zinc-700">
              {mensaje}
            </p>
          )}

          {/* Botón fijo abajo: en la tablet la lista se va para arriba y guardar
              quedaba fuera de pantalla. */}
          <div className="fixed inset-x-0 bottom-0 border-t border-zinc-300 bg-white p-3">
            <div className="mx-auto max-w-3xl">
              <button
                onClick={() => guardar.mutate()}
                disabled={guardar.isPending}
                className="w-full bg-rodziny-800 py-4 text-sm font-semibold uppercase tracking-wider text-white disabled:opacity-50"
              >
                {guardar.isPending ? 'Guardando…' : 'Guardar cierre de turno'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Cierre simple — Salsas (kg) y Postres (unidades). Sin turno (fin de día).
// ════════════════════════════════════════════════════════════════════════════

// Ítem contable del cierre simple. `recetaId` = receta contra la que se
// re-baselinea el stock (lote.receta_id); `productoId` ≠ null cuando se cuenta
// un producto directo (postre/panadería) → además se sella nombre_libre con el
// nombre del producto para que el StockTab lo matchee aunque receta_id sea null.
interface ItemCierre {
  id: string;
  nombre: string;
  recetaId: string | null;
  productoId: string | null;
}

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

  // El stock del tab Producción vive en `cocina_productos`. Para que el cierre
  // realmente impacte ese stock:
  //  · Postres / Panadería → se cuentan los PRODUCTOS directos (igual que pastas):
  //    el re-baseline escribe el lote con receta_id + nombre del producto, así
  //    el StockTab lo reconcilia siempre (matchea por receta_id o por nombre).
  //  · Salsas / Milanesa → se cuentan RECETAS-base; sus productos apuntan a esa
  //    misma receta, así que reconcilian igual (no se tocan).
  const { data: productos, isLoading } = useQuery({
    queryKey: ['mostrador-simple-items', local, tipo],
    queryFn: async (): Promise<ItemCierre[]> => {
      if (tipo === 'postre' || tipo === 'panaderia') {
        let pq = supabase
          .from('cocina_productos')
          .select('id, nombre, receta_id')
          .eq('activo', true)
          .eq('local', local);
        if (tipo === 'postre') {
          // Todos los postres-producto (Flan, Tiramisú, y la repostería por
          // porción: Brownie, Carrot, Cheesecake, Tarta Vasca, Matilda).
          pq = pq.eq('tipo', 'postre');
        } else {
          // Panadería: solo los panes curados (ver PRODUCTOS_PAN_CIERRE_SAAVEDRA).
          pq = pq.in('id', PRODUCTOS_PAN_CIERRE_SAAVEDRA);
        }
        const { data, error } = await pq.order('nombre');
        if (error) throw error;
        return (data ?? []).map((p) => ({
          id: p.id,
          nombre: p.nombre,
          recetaId: p.receta_id,
          productoId: p.id,
        }));
      }
      // Salsa / milanesa: recetas-base (el id ES el receta_id).
      let q = supabase
        .from('cocina_recetas')
        .select('id, nombre')
        .eq('activo', true)
        .eq('local', local);
      if (tipo === 'salsa') {
        // Solo las subrecetas Base (la que tiene la receta cargada), igual que el
        // QR de producción. Los vendibles (categoria='salsa') son referencia de
        // costeo y NO se cuentan: duplicarían cada salsa y partirían el stock.
        q = q.eq('rol', 'salsa_base');
      } else {
        // milanesa → subreceta base (rol='milanesa_base').
        q = q.eq('rol', 'milanesa_base');
      }
      const { data, error } = await q.order('nombre');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        nombre: r.nombre,
        recetaId: r.id,
        productoId: null,
      }));
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
      const cierres = conDatos.map(([itemId, valor]) => {
        const item = productos?.find((p) => p.id === itemId);
        return {
          itemId,
          recetaId: item?.recetaId ?? null,
          productoId: item?.productoId ?? null,
          nombre: item?.nombre ?? null,
          cantidad: Number(valor.trim().replace(/\s/g, '').replace(',', '.')),
        };
      });
      const mala = cierres.find(
        (c) => !Number.isFinite(c.cantidad) || c.cantidad < 0,
      );
      if (mala) {
        const nom =
          productos?.find((p) => p.id === mala.itemId)?.nombre ?? 'un producto';
        throw new Error(
          `Revisá la cantidad de "${nom}": "${valores[mala.itemId]}" no es un número válido. Usá coma para los decimales (ej: 8,910).`,
        );
      }

      // Tope de sanidad: un valor desmesurado casi siempre es gramos cargados
      // como kilos (ej: 3270 en vez de 3,27). Lo rebotamos con mensaje claro en
      // vez de guardar un stock disparatado. kg → 100 / unidades → 1000.
      const topeSanidad = unidad === 'kg' ? 100 : 1000;
      const absurda = cierres.find((c) => c.cantidad > topeSanidad);
      if (absurda) {
        const nom =
          productos?.find((p) => p.id === absurda.itemId)?.nombre ?? 'un producto';
        const enKg = unidad === 'kg' ? ` (¿cargaste gramos en vez de kilos? serían ${(absurda.cantidad / 1000).toLocaleString('es-AR')} kg)` : '';
        throw new Error(
          `La cantidad de "${nom}" (${absurda.cantidad.toLocaleString('es-AR')} ${unidad}) parece un error.${enKg} Revisala y volvé a guardar.`,
        );
      }

      const payload = cierres.map(({ itemId, recetaId, productoId, cantidad }) => ({
        fecha,
        local,
        producto_id: productoId,
        receta_id: recetaId,
        tipo,
        turno: null as null,
        cantidad_real: cantidad,
        unidad,
        responsable: responsable.trim(),
        notas: notas[itemId]?.trim() || null,
      }));

      const { error } = await supabase.from('cocina_cierre_dia').insert(payload);
      if (error) throw error;

      // Sincronizar con cocina_lotes_produccion para que el stock visible cuadre
      // con lo que se cerró: apaga los lotes activos previos de la receta + local,
      // y crea uno nuevo con la cantidad real del cierre. Así Dashboard/Stock
      // arrancan el día siguiente con exactamente lo que se contó al cerrar.
      const unidadLote: 'kg' | 'unid' | 'lt' = unidad === 'kg' ? 'kg' : 'unid';
      for (const { recetaId, productoId, nombre, cantidad } of cierres) {
        // (a) Apagar lotes con la misma receta vinculada (si el ítem tiene receta).
        if (recetaId) {
          const { error: errOff } = await supabase
            .from('cocina_lotes_produccion')
            .update({ en_stock: false })
            .eq('local', local)
            .eq('receta_id', recetaId)
            .eq('en_stock', true);
          if (errOff) throw errOff;
        }

        // (b) Apagar lotes previos identificados por nombre_libre = nombre del
        // ítem. Cubre los cierres anteriores en modo producto (que sellan
        // nombre_libre) y los huérfanos del modelo viejo. Sin esto se acumularían.
        if (nombre) {
          const { error: errOff2 } = await supabase
            .from('cocina_lotes_produccion')
            .update({ en_stock: false })
            .eq('local', local)
            .ilike('nombre_libre', nombre)
            .eq('en_stock', true);
          if (errOff2) throw errOff2;
        }

        if (cantidad > 0) {
          // origen='cierre' evita que el trigger trg_pizarron_lote_produccion
          // marque items del pizarrón como ciclo_completo: el cierre es
          // re-baselining de stock, no producción real.
          // Modo producto (postre/panadería): sellamos nombre_libre con el nombre
          // del producto para que el StockTab lo reconcilie aunque el producto
          // tenga receta_id null. Modo receta (salsa/milanesa): nombre_libre null.
          const { error: errIns } = await supabase.from('cocina_lotes_produccion').insert({
            fecha,
            local,
            categoria: tipo,
            receta_id: recetaId,
            nombre_libre: productoId ? nombre : null,
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

