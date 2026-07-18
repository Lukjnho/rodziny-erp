import { useEffect, useRef, useState } from 'react';
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';
import { cn } from '@/lib/utils';
import {
  TOLERANCIA_MIN,
  ANTIREBOTE_SEG,
  esTardanzaReal,
  ymd,
  hhmm,
  diffMinutosVsTurnos,
  formatTurnos,
  decidirProximaFichada,
  type TurnoCrono,
  type FichadaMin,
  type CronoDia,
} from './utils';

// ─── Configuración editable ─────────────────────────────────────────────────
// Si en el local detectás que las coordenadas no son exactas, ajustalas acá
const LOCALES = {
  vedia: { nombre: 'Rodziny Vedia', lat: -27.45042, lng: -58.98962 },
  saavedra: { nombre: 'Rodziny Saavedra', lat: -27.44856, lng: -58.97886 },
} as const;
const RADIO_METROS = 100;
const FOTO_MAX_LADO = 640; // px
const FOTO_QUALITY = 0.7;

type LocalKey = keyof typeof LOCALES;

// ─── Modo Bienal (evento externo) ───────────────────────────────────────────
// El QR de la Bienal apunta a /fichar?evento=bienal&stand=vedia|saavedra.
// En ese modo NO se valida GPS (el predio está lejos de los locales y los dos
// stands comparten ubicación) y las fichadas se etiquetan con evento='bienal'
// para no contaminar las horas del local. Mismo login DNI+PIN de siempre.
interface BienalCfg {
  stand: LocalKey; // stand donde se ficha; se guarda en la columna `local`
  label: string; // etiqueta visible, ej. "Bienal · Stand Vedia"
}

function bienalCfgDeStand(stand: LocalKey): BienalCfg {
  const nombreStand = stand === 'saavedra' ? 'Saavedra' : 'Vedia';
  return { stand, label: `Bienal · Stand ${nombreStand}` };
}

function leerBienalDeUrl(): BienalCfg | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('evento') !== 'bienal') return null;
  const stand: LocalKey = params.get('stand') === 'saavedra' ? 'saavedra' : 'vedia';
  return bienalCfgDeStand(stand);
}

// ─── Persistencia del modo Bienal ───────────────────────────────────────────
// El modo evento venía SOLO de la URL. Como la sesión del empleado sí se guarda
// 30 días, al reabrir la app sin el QR (ícono PWA, historial, autocompletar) se
// perdía el modo Bienal y la SALIDA caía en el ledger del local: la entrada de
// Bienal quedaba abierta ("no marca salida") y encima ensuciaba las horas del
// local. Persistimos el modo hasta el próximo corte de jornada (05:00) para que
// la salida del mismo turno caiga en el ledger correcto sin quedar pegado al día
// siguiente. El QR (`?evento=bienal`) siempre renueva; el logout y la salida de
// Bienal lo limpian.
const LS_BIENAL_KEY = 'rodziny_fichaje_evento';
const CORTE_JORNADA_H = 5;

function guardarModoBienal(cfg: BienalCfg) {
  try {
    localStorage.setItem(LS_BIENAL_KEY, JSON.stringify({ stand: cfg.stand, ts: Date.now() }));
  } catch {
    /* localStorage no disponible: seguimos en modo Bienal solo por esta sesión */
  }
}

function limpiarModoBienal() {
  try {
    localStorage.removeItem(LS_BIENAL_KEY);
  } catch {
    /* noop */
  }
}

function leerModoBienalPersistido(): BienalCfg | null {
  try {
    const raw = localStorage.getItem(LS_BIENAL_KEY);
    if (!raw) return null;
    const { stand, ts } = JSON.parse(raw);
    // Expira en el primer corte de jornada (05:00 local) posterior a cuando se
    // guardó: cubre cualquier turno del día (incluso nocturno) y se limpia solo
    // al arrancar el día siguiente.
    const guardado = new Date(ts);
    const corte = new Date(guardado);
    corte.setHours(CORTE_JORNADA_H, 0, 0, 0);
    if (corte.getTime() <= guardado.getTime()) corte.setDate(corte.getDate() + 1);
    if (Date.now() >= corte.getTime()) {
      limpiarModoBienal();
      return null;
    }
    return bienalCfgDeStand(stand === 'saavedra' ? 'saavedra' : 'vedia');
  } catch {
    return null;
  }
}

interface Empleado {
  id: string;
  nombre: string;
  apellido: string;
  dni: string;
  local: 'vedia' | 'saavedra';
  pin_fichaje: string | null;
  horario_tipo: 'fijo' | 'flexible';
  horas_semanales_requeridas: number | null;
}

interface Cronograma {
  id: string;
  empleado_id: string;
  fecha: string;
  hora_entrada: string | null;
  hora_salida: string | null;
  turnos: TurnoCrono[] | null;
  es_franco: boolean;
  publicado: boolean;
}

interface Fichada {
  id: string;
  empleado_id: string;
  fecha: string;
  tipo: 'entrada' | 'salida';
  timestamp: string;
  local: string;
  minutos_diferencia: number | null;
  foto_path: string | null;
}

// ─── Helpers locales (los compartidos vienen de ./utils) ────────────────────
// Fichadas legacy de madrugada (00:00-05:00) grabadas como "entrada" que en realidad
// son la salida del turno nocturno del día anterior. No deben contar para paridad.
function esSalidaNocturnaLegacy(f: { tipo: 'entrada' | 'salida'; timestamp: string }): boolean {
  if (f.tipo !== 'entrada') return false;
  const h = new Date(f.timestamp).getHours();
  return h >= 0 && h < 5;
}

function haversineMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function detectarLocal(lat: number, lng: number): { key: LocalKey; distancia: number } | null {
  const candidatos = (Object.keys(LOCALES) as LocalKey[]).map((key) => ({
    key,
    distancia: haversineMetros(lat, lng, LOCALES[key].lat, LOCALES[key].lng),
  }));
  candidatos.sort((a, b) => a.distancia - b.distancia);
  const mejor = candidatos[0];
  if (mejor.distancia <= RADIO_METROS) return mejor;
  return null;
}

function distanciaAlLocalMasCercano(lat: number, lng: number): number {
  return Math.min(
    ...(Object.keys(LOCALES) as LocalKey[]).map((key) =>
      haversineMetros(lat, lng, LOCALES[key].lat, LOCALES[key].lng),
    ),
  );
}

async function comprimirImagen(blob: Blob): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const i = new Image();
    i.onload = () => {
      URL.revokeObjectURL(url);
      resolve(i);
    };
    i.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    i.src = url;
  });
  const escala = Math.min(1, FOTO_MAX_LADO / Math.max(img.width, img.height));
  const w = Math.round(img.width * escala);
  const h = Math.round(img.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob falló'))),
      'image/jpeg',
      FOTO_QUALITY,
    );
  });
}

// LocalStorage helpers
const LS_KEY = 'rodziny_fichaje_empleado';
function guardarSesion(empleadoId: string) {
  localStorage.setItem(LS_KEY, JSON.stringify({ id: empleadoId, ts: Date.now() }));
}
function leerSesion(): string | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Expira a los 30 días
    if (Date.now() - parsed.ts > 30 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return parsed.id;
  } catch {
    return null;
  }
}

// ─── Componente principal ───────────────────────────────────────────────────
export function FicharPage() {
  const [empleado, setEmpleado] = useState<Empleado | null>(null);
  const [cargando, setCargando] = useState(true);
  // Modo evento (Bienal). Se toma del QR (?evento=bienal) y se persiste hasta el
  // próximo corte de jornada; si se reabre la app sin el QR, se recupera del
  // almacenamiento para que la salida del turno caiga en el ledger de Bienal.
  const [bienal, setBienal] = useState<BienalCfg | null>(() => {
    const deUrl = leerBienalDeUrl();
    if (deUrl) {
      guardarModoBienal(deUrl);
      return deUrl;
    }
    return leerModoBienalPersistido();
  });

  // Auto-login si hay sesión guardada
  useEffect(() => {
    const id = leerSesion();
    if (!id) {
      setCargando(false);
      return;
    }
    supabase
      .from('empleados')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        if (data) setEmpleado(data as Empleado);
        setCargando(false);
      });
  }, []);

  if (cargando) {
    return (
      <Pantalla bienal={bienal}>
        <p className="text-sm text-gray-500">Cargando...</p>
      </Pantalla>
    );
  }

  if (!empleado) {
    return (
      <Login
        bienal={bienal}
        onLogin={(emp) => {
          guardarSesion(emp.id);
          setEmpleado(emp);
        }}
      />
    );
  }

  return (
    <Home
      empleado={empleado}
      bienal={bienal}
      onLogout={() => {
        localStorage.removeItem(LS_KEY);
        limpiarModoBienal();
        setEmpleado(null);
      }}
      onSalirEvento={() => {
        limpiarModoBienal();
        setBienal(null);
      }}
    />
  );
}

// ─── Layout base ────────────────────────────────────────────────────────────
function Pantalla({
  children,
  bienal,
}: {
  children: React.ReactNode;
  bienal?: BienalCfg | null;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="flex items-center gap-2 bg-rodziny-800 px-4 py-3 text-white">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-rodziny-600 text-xs font-bold">
          R
        </div>
        <span className="text-sm font-semibold">Rodziny · Fichaje</span>
        {bienal && (
          <span className="ml-auto rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950">
            🎪 {bienal.label}
          </span>
        )}
      </header>
      <main className="mx-auto w-full max-w-md flex-1 p-4">{children}</main>
    </div>
  );
}

// ─── Login ──────────────────────────────────────────────────────────────────
function Login({
  onLogin,
  bienal,
}: {
  onLogin: (e: Empleado) => void;
  bienal?: BienalCfg | null;
}) {
  const [dni, setDni] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    if (!dni || !pin) {
      setError('Completá DNI y PIN');
      return;
    }
    setLoading(true);
    const { data, error: dbError } = await supabase
      .from('empleados')
      .select('*')
      .eq('dni', dni.trim())
      .eq('activo', true)
      .maybeSingle();
    setLoading(false);
    if (dbError || !data) {
      setError('DNI no encontrado');
      return;
    }
    if (!data.pin_fichaje) {
      setError('Tu PIN no está configurado. Avisá a RRHH');
      return;
    }
    if (data.pin_fichaje !== pin.trim()) {
      setError('PIN incorrecto');
      return;
    }
    onLogin(data as Empleado);
  }

  return (
    <Pantalla bienal={bienal}>
      {bienal && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-center text-xs text-amber-900">
          Estás fichando en <strong>{bienal.label}</strong>. Ingresá con tu DNI y PIN de siempre.
        </div>
      )}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Ingresar</h2>
        <p className="mb-4 text-xs text-gray-500">Tu DNI y un PIN de 4 dígitos que te dio RRHH</p>

        <label className="mb-1 block text-xs font-medium text-gray-700">DNI</label>
        <input
          type="tel"
          inputMode="numeric"
          value={dni}
          onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))}
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          placeholder="Sin puntos"
        />

        <label className="mb-1 block text-xs font-medium text-gray-700">PIN</label>
        <input
          type="tel"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm tracking-widest"
          placeholder="••••"
        />

        {error && <div className="mb-3 text-xs text-red-600">{error}</div>}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full rounded bg-rodziny-700 py-2.5 text-sm font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
        >
          {loading ? 'Verificando...' : 'Ingresar'}
        </button>
      </div>
    </Pantalla>
  );
}

// ─── Home (logueado) ────────────────────────────────────────────────────────
type Vista = 'inicio' | 'fichando' | 'mis_horarios' | 'mi_quincena';

function Home({
  empleado,
  onLogout,
  onSalirEvento,
  bienal,
}: {
  empleado: Empleado;
  onLogout: () => void;
  onSalirEvento: () => void;
  bienal?: BienalCfg | null;
}) {
  const [vista, setVista] = useState<Vista>('inicio');
  const [refrescador, setRefrescador] = useState(0);
  // Última marca recién hecha: se la pasamos al Inicio para que la muestre al
  // instante, sin esperar a que la relea de la base (evita el flash de
  // "FICHAR ENTRADA" justo después de fichar).
  const [ultimaMarca, setUltimaMarca] = useState<FichadaMin | null>(null);

  return (
    <Pantalla bienal={bienal}>
      <div className="mb-3 mt-2 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500">Hola</p>
            <p className="text-base font-semibold text-gray-900">
              {empleado.nombre} {empleado.apellido}
            </p>
          </div>
          <button onClick={onLogout} className="text-xs text-gray-500 underline hover:text-red-600">
            Salir
          </button>
        </div>
      </div>

      {vista === 'inicio' && (
        <Inicio
          empleado={empleado}
          bienal={bienal}
          key={refrescador}
          marcaRecien={ultimaMarca}
          onIrAFichar={() => setVista('fichando')}
          onIrAHorarios={() => setVista('mis_horarios')}
          onIrAQuincena={() => setVista('mi_quincena')}
          onSalirEvento={onSalirEvento}
        />
      )}
      {vista === 'fichando' && (
        <Fichando
          empleado={empleado}
          bienal={bienal}
          onCancelar={() => setVista('inicio')}
          onListo={(marca) => {
            // Al cerrar el turno de Bienal, soltamos el modo evento persistido: la
            // próxima reapertura arranca en modo local salvo que reescanee el QR.
            if (bienal && marca.tipo === 'salida') limpiarModoBienal();
            setUltimaMarca(marca);
            setRefrescador((x) => x + 1);
            setVista('inicio');
          }}
        />
      )}
      {vista === 'mis_horarios' && (
        <MisHorarios empleado={empleado} onVolver={() => setVista('inicio')} />
      )}
      {vista === 'mi_quincena' && (
        <MiQuincena empleado={empleado} onVolver={() => setVista('inicio')} />
      )}
    </Pantalla>
  );
}

// ─── Inicio ─────────────────────────────────────────────────────────────────
function Inicio({
  empleado,
  bienal,
  marcaRecien,
  onIrAFichar,
  onIrAHorarios,
  onIrAQuincena,
  onSalirEvento,
}: {
  empleado: Empleado;
  bienal?: BienalCfg | null;
  marcaRecien?: FichadaMin | null;
  onIrAFichar: () => void;
  onIrAHorarios: () => void;
  onIrAQuincena: () => void;
  onSalirEvento: () => void;
}) {
  const [crono, setCrono] = useState<Cronograma | null>(null);
  const [cronoAyer, setCronoAyer] = useState<Cronograma | null>(null);
  const [fichadasHoy, setFichadasHoy] = useState<Fichada[]>([]);
  const [fichadasAyer, setFichadasAyer] = useState<Fichada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const ahoraDev = new Date();
  const hoy = ymd(ahoraDev);
  const ayerDt = new Date(ahoraDev);
  ayerDt.setDate(ayerDt.getDate() - 1);
  const ayer = ymd(ayerDt);
  const debugOn =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === '1';

  useEffect(() => {
    (async () => {
      // Fichadas del día: en modo Bienal solo las del evento; en modo local solo
      // las del local (evento IS NULL), así ninguna vista mezcla las dos cosas.
      const fichadasDia = (fecha: string) => {
        const q = supabase
          .from('fichadas')
          .select('*')
          .eq('empleado_id', empleado.id)
          .eq('fecha', fecha);
        return (bienal ? q.eq('evento', 'bienal') : q.is('evento', null)).order('timestamp');
      };
      // En la Bienal no hay cronograma cargado: la entrada/salida se decide por
      // alternancia de la última marca (cronograma nulo).
      const cronoDia = (fecha: string) =>
        bienal
          ? Promise.resolve({ data: null as Cronograma | null })
          : supabase
              .from('cronograma')
              .select('*')
              .eq('empleado_id', empleado.id)
              .eq('fecha', fecha)
              .maybeSingle();

      const [{ data: c }, { data: cAyer }, { data: f }, { data: fAyer }] = await Promise.all([
        cronoDia(hoy),
        // Cronograma de ayer: por turnos nocturnos que cierran hoy de madrugada
        cronoDia(ayer),
        fichadasDia(hoy),
        // Fichadas de ayer para detectar entrada sin salida (turno nocturno)
        fichadasDia(ayer),
      ]);
      setCrono((c as Cronograma) || null);
      setCronoAyer((cAyer as Cronograma) || null);
      setFichadasHoy((f as Fichada[]) || []);
      setFichadasAyer((fAyer as Fichada[]) || []);
      setCargando(false);

      if (debugOn) {
        // Verificar si hay sesión auth activa en el cliente principal (hipótesis del bug RLS)
        const { supabase: supaMain } = await import('@/lib/supabase');
        const { data: sess } = await supaMain.auth.getSession();
        const authSession = sess?.session
          ? { user_id: sess.session.user?.id ?? null, email: sess.session.user?.email ?? null }
          : null;
        // Traer los próximos 14 días publicados para diagnóstico
        const hastaDt = new Date(ahoraDev);
        hastaDt.setDate(hastaDt.getDate() + 14);
        const { data: prox, error: proxErr } = await supabase
          .from('cronograma')
          .select('fecha, hora_entrada, hora_salida, publicado')
          .eq('empleado_id', empleado.id)
          .eq('publicado', true)
          .gte('fecha', hoy)
          .lte('fecha', ymd(hastaDt))
          .order('fecha');
        // Traer TODOS los días (sin filtro publicado) para comparar
        const { data: todos } = await supabase
          .from('cronograma')
          .select('fecha, publicado')
          .eq('empleado_id', empleado.id)
          .gte('fecha', hoy)
          .lte('fecha', ymd(hastaDt));
        // Test: contar todas las filas de cronograma SIN filtro de empleado (sanity check)
        const { count: cronoTotal } = await supabase
          .from('cronograma')
          .select('*', { count: 'exact', head: true });
        // Test: count empleados
        const { count: empTotal } = await supabase
          .from('empleados')
          .select('*', { count: 'exact', head: true });
        // Fetch directo a Supabase REST bypasseando el cliente, con cache-buster
        let directCount = -1;
        let directErr: string | null = null;
        try {
          const supaUrl = import.meta.env.VITE_SUPABASE_URL as string;
          const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
          const url = `${supaUrl}/rest/v1/cronograma?select=fecha&empleado_id=eq.${empleado.id}&fecha=gte.${hoy}&fecha=lte.${ymd(hastaDt)}&_cb=${Date.now()}`;
          const r = await fetch(url, {
            headers: {
              apikey: supaKey,
              Authorization: `Bearer ${supaKey}`,
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
            },
            cache: 'no-store',
          });
          const arr = await r.json();
          directCount = Array.isArray(arr) ? arr.length : -2;
        } catch (e: any) {
          directErr = e?.message ?? String(e);
        }
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const offset = -ahoraDev.getTimezoneOffset() / 60;
        const supaUrl = (import.meta.env.VITE_SUPABASE_URL as string) || '(sin env)';
        const supaHost = supaUrl.replace('https://', '').split('.')[0];
        // @ts-ignore
        const conn = (navigator as any).connection;
        setDebugInfo(
          JSON.stringify(
            {
              empleado_id: empleado.id,
              empleado_nombre: `${empleado.nombre} ${empleado.apellido}`,
              dni: empleado.dni,
              hoy_device: hoy,
              ahora_iso: ahoraDev.toISOString(),
              tz,
              offset_hs: offset,
              crono_hoy: c
                ? {
                    fecha: (c as any).fecha,
                    he: (c as any).hora_entrada,
                    hs: (c as any).hora_salida,
                    pub: (c as any).publicado,
                  }
                : null,
              prox14_pub: prox?.length ?? 0,
              prox14_todos: todos?.length ?? 0,
              primera_pub: prox?.[0] ?? null,
              err: proxErr?.message ?? null,
              // Sanity checks
              supabase_project: supaHost,
              crono_total_en_db: cronoTotal ?? null,
              empleados_total_en_db: empTotal ?? null,
              // Fetch directo con cache-bust
              direct_fetch_count: directCount,
              direct_fetch_err: directErr,
              // Red
              net_type: conn?.effectiveType ?? 'n/a',
              net_downlink: conn?.downlink ?? 'n/a',
              // Build / URL
              url: typeof window !== 'undefined' ? window.location.href : '',
              ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : '',
              // HIPÓTESIS CLAVE: sesión auth contaminada de la ERP principal
              auth_session_present: !!authSession,
              auth_session: authSession,
            },
            null,
            2,
          ),
        );
      }
    })();
  }, [empleado.id, hoy, debugOn, bienal]);

  // El próximo tipo se decide mirando la ÚLTIMA marca + el cronograma (robusto
  // ante marcas faltantes/sobrantes). Excluimos entradas fantasma de madrugada
  // (00:xx) que en datos viejos son salidas mal tipeadas del turno nocturno.
  const marcasRecientes: FichadaMin[] = [...fichadasAyer, ...fichadasHoy]
    .filter((f) => !esSalidaNocturnaLegacy(f))
    .map((f) => ({ tipo: f.tipo, timestamp: f.timestamp, fecha: f.fecha }));
  // Incluir la marca recién hecha si el re-fetch todavía no la trajo (evita
  // depender de la latencia lectura-tras-escritura).
  if (marcaRecien && !marcasRecientes.some((m) => m.timestamp === marcaRecien.timestamp)) {
    marcasRecientes.push(marcaRecien);
  }
  const ultimaFichada: FichadaMin | null =
    marcasRecientes.length > 0
      ? marcasRecientes.reduce((a, b) => (a.timestamp >= b.timestamp ? a : b))
      : null;
  const toCronoDia = (c: Cronograma | null): CronoDia | null =>
    c ? { turnos: c.turnos, hora_entrada: c.hora_entrada, hora_salida: c.hora_salida } : null;
  const decision = decidirProximaFichada({
    ahora: ahoraDev,
    fechaHoy: hoy,
    fechaAyer: ayer,
    cronoHoy: toCronoDia(crono),
    cronoAyer: toCronoDia(cronoAyer),
    ultimaFichada,
  });
  const proximoTipo = decision.tipo;
  const ultimaMarca = ultimaFichada;

  return (
    <>
      {bienal ? (
        <div className="mb-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
          <p className="mb-1 text-xs font-medium text-amber-700">Estás fichando en el EVENTO</p>
          <p className="text-lg font-bold text-amber-900">🎪 {bienal.label}</p>
          <p className="mt-1 text-[11px] text-amber-700">
            Fichá <strong>entrada y salida</strong> del turno acá mismo. Si vas al local, tocá
            «No estoy en la Bienal».
          </p>
          <button
            onClick={onSalirEvento}
            className="mt-2 rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
          >
            No estoy en la Bienal
          </button>
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-1 text-xs text-gray-500">Tu turno hoy</p>
          {crono?.es_franco ? (
            <p className="text-base font-semibold text-blue-700">FRANCO</p>
          ) : crono?.hora_entrada ? (
            <p className="text-base font-semibold text-gray-900">
              {formatTurnos(crono.turnos, crono.hora_entrada, crono.hora_salida)}
            </p>
          ) : (
            <p className="text-sm text-gray-500">No tenés turno asignado hoy</p>
          )}
          {crono && !crono.publicado && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
              ⚠️ Tu horario todavía está en <strong>borrador</strong> (sin publicar por el
              encargado). Podés fichar igual, pero sin horario de referencia.
            </div>
          )}
        </div>
      )}

      {fichadasHoy.length > 0 && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700">
          <p className="mb-1 font-medium">Fichajes de hoy:</p>
          {fichadasHoy.map((f) => (
            <div key={f.id} className="flex justify-between">
              <span className="capitalize">{f.tipo}</span>
              <span>{hhmm(new Date(f.timestamp))}</span>
            </div>
          ))}
        </div>
      )}

      {ultimaMarca && (
        <p className="mb-2 text-center text-xs text-gray-500">
          Tu última marca fue{' '}
          <span className="font-medium text-gray-700">
            {ultimaMarca.tipo} {hhmm(new Date(ultimaMarca.timestamp))}
          </span>{' '}
          ✓
        </p>
      )}

      <button
        onClick={onIrAFichar}
        disabled={cargando}
        className="mb-1 w-full rounded-lg bg-rodziny-700 py-4 text-base font-semibold text-white shadow hover:bg-rodziny-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {cargando ? 'Cargando…' : `FICHAR ${proximoTipo.toUpperCase()}`}
      </button>
      {!cargando && decision.horarioTramo && (
        <p className="mb-3 text-center text-[11px] text-gray-500">
          Tu horario de este tramo: {decision.horarioTramo}
        </p>
      )}
      {!cargando && decision.advertencia && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-center text-[11px] text-amber-800">
          ⚠️ {decision.advertencia}
        </p>
      )}
      {(cargando || !decision.horarioTramo) && <div className="mb-3" />}

      {!bienal && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onIrAHorarios}
            className="rounded-lg border border-gray-200 bg-white py-3 text-xs text-gray-700 hover:bg-gray-50"
          >
            Mis horarios
          </button>
          <button
            onClick={onIrAQuincena}
            className="rounded-lg border border-gray-200 bg-white py-3 text-xs text-gray-700 hover:bg-gray-50"
          >
            Mi quincena
          </button>
        </div>
      )}

      {debugOn && debugInfo && (
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-900 p-2 text-[10px] text-green-300">
          {debugInfo}
        </pre>
      )}
    </>
  );
}

// ─── Flujo de fichaje ───────────────────────────────────────────────────────
type PasoFichaje = 'gps' | 'gps_bloqueado' | 'foto' | 'subiendo' | 'ok' | 'error';

function Fichando({
  empleado,
  bienal,
  onCancelar,
  onListo,
}: {
  empleado: Empleado;
  bienal?: BienalCfg | null;
  onCancelar: () => void;
  onListo: (marca: FichadaMin) => void;
}) {
  // En la Bienal no se valida GPS: se salta directo a la foto.
  const [paso, setPaso] = useState<PasoFichaje>(bienal ? 'foto' : 'gps');
  const [mensaje, setMensaje] = useState<string>('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [localDetectado, setLocalDetectado] = useState<LocalKey | null>(null);
  const [sinUbicacion, setSinUbicacion] = useState(false);
  const [distanciaFuera, setDistanciaFuera] = useState<number | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [fotoBlob, setFotoBlob] = useState<Blob | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{
    tipo: 'entrada' | 'salida';
    minutos: number | null;
    hora: string;
    horarioTramo: string | null;
    iso: string;
    fecha: string;
  } | null>(null);

  // Verificación de ubicación — corre al entrar en el paso 'gps'.
  // Bloquea si el GPS funciona pero el empleado está fuera del local.
  // Si el GPS no da permiso / falla / no hay soporte → deja pasar pero marca "sin ubicación".
  useEffect(() => {
    if (paso !== 'gps') return;
    if (import.meta.env.DEV) {
      const v = LOCALES.vedia;
      setCoords({ lat: v.lat, lng: v.lng });
      setLocalDetectado('vedia');
      setSinUbicacion(false);
      setPaso('foto');
      return;
    }
    if (!navigator.geolocation) {
      setSinUbicacion(true);
      setPaso('foto');
      return;
    }
    let resuelto = false;

    function onExito(pos: GeolocationPosition) {
      if (resuelto) return;
      resuelto = true;
      const { latitude, longitude } = pos.coords;
      setCoords({ lat: latitude, lng: longitude });
      const det = detectarLocal(latitude, longitude);
      if (det) {
        setLocalDetectado(det.key);
        setSinUbicacion(false);
        setPaso('foto');
      } else {
        // Ubicación OK pero fuera del radio del local → bloquear
        setDistanciaFuera(Math.round(distanciaAlLocalMasCercano(latitude, longitude)));
        setPaso('gps_bloqueado');
      }
    }

    function onFallaFinal() {
      if (resuelto) return;
      resuelto = true;
      // Ni alta precisión ni red resolvieron → deja pasar con marca
      setSinUbicacion(true);
      setPaso('foto');
    }

    // Etapa 1: alta precisión con ventana corta. Adentro del local el GPS satelital
    // suele no conseguir fix; en vez de marcar "sin ubicación" al primer timeout,
    // reintentamos por red.
    navigator.geolocation.getCurrentPosition(
      onExito,
      () => {
        if (resuelto) return;
        // Etapa 2: ubicación por red (WiFi/antena). Resuelve rápido en interiores y es
        // de sobra precisa para el radio de 100 m del local.
        navigator.geolocation.getCurrentPosition(onExito, onFallaFinal, {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 120000,
        });
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    );
  }, [paso]);

  // Cámara — arranca directo
  useEffect(() => {
    if (paso !== 'foto') return;
    let cancelado = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e: any) {
        const msg =
          e?.name === 'NotAllowedError' || (e?.message || '').includes('denied')
            ? 'La cámara está bloqueada para este sitio.'
            : 'No pude acceder a la cámara.';
        setMensaje(msg);
        setWarning(
          'En iPhone: Ajustes → Safari → Cámara → Permitir. ' +
            'En Android: tocá el candado en la barra de dirección → Permisos → Cámara → Permitir. ' +
            'Después tocá Reintentar.',
        );
        setPaso('error');
      }
    })();
    return () => {
      cancelado = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [paso]);

  function tomarFoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setFotoBlob(blob);
        setFotoPreview(URL.createObjectURL(blob));
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      },
      'image/jpeg',
      0.85,
    );
  }

  async function confirmarFichaje() {
    if (!fotoBlob) return;
    setPaso('subiendo');
    setMensaje('Guardando...');
    try {
      const ahora = new Date();
      const fechaHoy = ymd(ahora);
      const ayerDt2 = new Date(ahora);
      ayerDt2.setDate(ayerDt2.getDate() - 1);
      const fechaAyer = ymd(ayerDt2);

      // Traer marcas (y cronogramas, salvo en Bienal) de ayer+hoy en un solo viaje.
      // Las marcas se acotan al mismo ámbito que la fichada que se va a insertar:
      // en Bienal solo cuentan las del evento; en el local solo las del local.
      const marcasQuery = supabase
        .from('fichadas')
        .select('id, tipo, timestamp, fecha')
        .eq('empleado_id', empleado.id)
        .in('fecha', [fechaAyer, fechaHoy]);
      const cronoDiaRaw = (fecha: string) =>
        bienal
          ? Promise.resolve({ data: null as Cronograma | null })
          : supabase
              .from('cronograma')
              .select('hora_entrada, hora_salida, turnos, es_franco, publicado')
              .eq('empleado_id', empleado.id)
              .eq('fecha', fecha)
              .maybeSingle();
      const [{ data: fichHoyAyer }, { data: cronoHoyRaw }, { data: cronoAyerRaw }] =
        await Promise.all([
          (bienal ? marcasQuery.eq('evento', 'bienal') : marcasQuery.is('evento', null)).order(
            'timestamp',
          ),
          cronoDiaRaw(fechaHoy),
          cronoDiaRaw(fechaAyer),
        ]);

      // Última marca real (ignoramos entradas fantasma de madrugada de datos viejos).
      const marcas = (fichHoyAyer ?? []).filter((f: any) => !esSalidaNocturnaLegacy(f));
      const ultimaFichada: FichadaMin | null =
        marcas.length > 0
          ? (marcas.reduce((a: any, b: any) => (a.timestamp >= b.timestamp ? a : b)) as FichadaMin)
          : null;

      // Anti doble-tap: si acabás de fichar hace segundos, es un toque repetido.
      if (
        ultimaFichada &&
        ahora.getTime() - new Date(ultimaFichada.timestamp).getTime() < ANTIREBOTE_SEG * 1000
      ) {
        setWarning(
          `Ya registramos tu marca de ${ultimaFichada.tipo} a las ${hhmm(
            new Date(ultimaFichada.timestamp),
          )}. Esperá un momento antes de fichar de nuevo.`,
        );
        setPaso('error');
        return;
      }

      // Decidir entrada/salida + día imputado con la última marca y el cronograma.
      const cronoHoy: CronoDia | null = cronoHoyRaw
        ? {
            turnos: (cronoHoyRaw.turnos as TurnoCrono[] | null) ?? null,
            hora_entrada: cronoHoyRaw.hora_entrada ?? null,
            hora_salida: cronoHoyRaw.hora_salida ?? null,
          }
        : null;
      const cronoAyer: CronoDia | null = cronoAyerRaw
        ? {
            turnos: (cronoAyerRaw.turnos as TurnoCrono[] | null) ?? null,
            hora_entrada: cronoAyerRaw.hora_entrada ?? null,
            hora_salida: cronoAyerRaw.hora_salida ?? null,
          }
        : null;
      const decision = decidirProximaFichada({
        ahora,
        fechaHoy,
        fechaAyer,
        cronoHoy,
        cronoAyer,
        ultimaFichada,
      });
      const tipo = decision.tipo;
      const fechaFichada = decision.fecha;

      // Cronograma del día al que se imputa la marca (para la diferencia vs horario).
      const cronoImputado = fechaFichada === fechaHoy ? cronoHoyRaw : cronoAyerRaw;
      const turnosDia = (cronoImputado?.turnos as TurnoCrono[] | null) ?? null;
      // En la Bienal no hay horario de referencia → no se calcula diferencia.
      const minutosDif = bienal
        ? null
        : diffMinutosVsTurnos(
            ahora,
            turnosDia,
            tipo,
            cronoImputado?.hora_entrada ?? null,
            cronoImputado?.hora_salida ?? null,
          );
      const tieneHorario = (turnosDia && turnosDia.length > 0) || !!cronoImputado?.hora_entrada;

      // Warnings (no bloquean)
      let w: string | null = decision.advertencia;
      if (cronoImputado?.es_franco) w = 'Hoy figurás de franco. Quedará registrado igual.';
      else if (cronoImputado && !cronoImputado.publicado)
        w = 'Tu horario está en borrador (sin publicar). Queda registrado igual.';
      else if (!bienal && !tieneHorario && !w) w = 'No tenés horario asignado para hoy.';
      else if (!w && minutosDif !== null && Math.abs(minutosDif) > TOLERANCIA_MIN)
        w = `Estás ${minutosDif > 0 ? 'tarde' : 'antes'} ${Math.abs(minutosDif)} min vs tu horario.`;
      setWarning(w);

      // Subir foto comprimida
      const comprimida = await comprimirImagen(fotoBlob);
      const nonce = Math.random().toString(36).slice(2, 8);
      const path = `${empleado.id}/${fechaFichada}/${ahora.getTime()}_${nonce}_${tipo}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('fichadas-fotos')
        .upload(path, comprimida, { contentType: 'image/jpeg', upsert: false });
      if (upErr) throw upErr;

      // Local a guardar: en Bienal es el stand del QR; en el local, el detectado
      // por GPS (o el del empleado como fallback informativo).
      const localParaGuardar = bienal ? bienal.stand : (localDetectado ?? (empleado.local as LocalKey));

      // Insertar fichada
      const { error: insErr } = await supabase.from('fichadas').insert({
        empleado_id: empleado.id,
        fecha: fechaFichada,
        tipo,
        timestamp: ahora.toISOString(),
        local: localParaGuardar,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        foto_path: path,
        minutos_diferencia: minutosDif,
        origen: bienal ? 'pwa-bienal' : 'pwa',
        evento: bienal ? 'bienal' : null,
      });
      if (insErr) {
        await supabase.storage
          .from('fichadas-fotos')
          .remove([path])
          .catch(() => {});
        throw insErr;
      }

      setResultado({
        tipo,
        minutos: minutosDif,
        hora: hhmm(ahora),
        horarioTramo: decision.horarioTramo,
        iso: ahora.toISOString(),
        fecha: fechaFichada,
      });
      setPaso('ok');
    } catch (e: any) {
      setMensaje('Error: ' + (e?.message || e));
      setPaso('error');
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      {paso === 'gps' && (
        <div className="py-8 text-center">
          <div className="mb-2 text-3xl">📍</div>
          <p className="text-sm text-gray-700">Verificando que estés en el local...</p>
          <button
            onClick={onCancelar}
            className="mt-4 block w-full text-xs text-gray-500 underline"
          >
            Cancelar
          </button>
        </div>
      )}

      {paso === 'gps_bloqueado' && (
        <div className="py-6 text-center">
          <div className="mb-2 text-3xl">🚫</div>
          <p className="text-base font-semibold text-red-700">Estás fuera del local</p>
          <p className="mt-1 text-xs text-gray-600">
            Acercate al local para poder fichar.
            {distanciaFuera !== null && ` Estás a ~${distanciaFuera} m del local más cercano.`}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={onCancelar}
              className="rounded bg-gray-100 py-2.5 text-sm text-gray-700 hover:bg-gray-200"
            >
              Volver
            </button>
            <button
              onClick={() => {
                setDistanciaFuera(null);
                setPaso('gps');
              }}
              className="rounded bg-rodziny-700 py-2.5 text-sm text-white hover:bg-rodziny-800"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {paso === 'foto' && (
        <>
          {!fotoPreview ? (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-[3/4] w-full rounded bg-black object-cover"
              />
              <button
                onClick={tomarFoto}
                className="mt-3 w-full rounded bg-rodziny-700 py-3 text-sm font-medium text-white"
              >
                Tomar foto
              </button>
            </>
          ) : (
            <>
              <img
                src={fotoPreview}
                alt="selfie"
                className="aspect-[3/4] w-full rounded object-cover"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setFotoBlob(null);
                    setFotoPreview(null);
                    setPaso('foto');
                  }}
                  className="rounded bg-gray-100 py-2.5 text-sm text-gray-700 hover:bg-gray-200"
                >
                  Reintentar
                </button>
                <button
                  onClick={confirmarFichaje}
                  className="rounded bg-rodziny-700 py-2.5 text-sm font-medium text-white hover:bg-rodziny-800"
                >
                  Confirmar
                </button>
              </div>
            </>
          )}
          <button
            onClick={onCancelar}
            className="mt-3 block w-full text-xs text-gray-500 underline"
          >
            Cancelar
          </button>
        </>
      )}

      {paso === 'subiendo' && (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-700">{mensaje}</p>
        </div>
      )}

      {paso === 'ok' && resultado && (
        <div className="py-4 text-center">
          <div className="mb-2 text-4xl">✓</div>
          <p className="text-lg font-bold text-gray-900">
            Marcaste <span className="uppercase">{resultado.tipo}</span>
          </p>
          <p className="mt-1 text-2xl font-bold text-rodziny-700">{resultado.hora}</p>
          {resultado.horarioTramo && (
            <p className="mt-1 text-xs text-gray-500">
              Tu horario de este tramo: {resultado.horarioTramo}
            </p>
          )}
          {resultado.minutos !== null && (
            <p
              className={cn(
                'mt-2 text-xs',
                Math.abs(resultado.minutos) <= TOLERANCIA_MIN ? 'text-green-700' : 'text-amber-700',
              )}
            >
              {resultado.minutos === 0
                ? 'Puntual'
                : resultado.minutos > 0
                  ? `+${resultado.minutos} min vs horario`
                  : `${resultado.minutos} min vs horario`}
            </p>
          )}
          {bienal ? (
            <p className="mt-2 text-[10px] text-amber-600">🎪 {bienal.label} · foto registrada</p>
          ) : sinUbicacion ? (
            <p className="mt-2 text-[10px] text-amber-600">
              ⚠ Fichaste sin ubicación (GPS no disponible)
            </p>
          ) : (
            <p className="mt-2 text-[10px] text-gray-400">
              ✓ Ubicación verificada{localDetectado ? ` · ${LOCALES[localDetectado].nombre}` : ''} ·
              foto registrada
            </p>
          )}
          {warning && <p className="mt-2 text-xs text-amber-700">{warning}</p>}
          <button
            onClick={() =>
              onListo({ tipo: resultado.tipo, timestamp: resultado.iso, fecha: resultado.fecha })
            }
            className="mt-4 w-full rounded bg-rodziny-700 py-2.5 text-sm font-medium text-white hover:bg-rodziny-800"
          >
            Listo
          </button>
        </div>
      )}

      {paso === 'error' && (
        <div className="py-4 text-center">
          <div className="mb-2 text-3xl">⚠</div>
          <p className="text-sm text-red-700">{mensaje}</p>
          {warning && (
            <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2.5 text-left text-xs text-amber-800">
              {warning}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={onCancelar}
              className="rounded bg-gray-100 py-2.5 text-sm text-gray-700 hover:bg-gray-200"
            >
              Volver
            </button>
            <button
              onClick={() => {
                setWarning(null);
                setPaso('foto');
              }}
              className="rounded bg-rodziny-700 py-2.5 text-sm text-white"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Mis horarios ───────────────────────────────────────────────────────────
function MisHorarios({ empleado, onVolver }: { empleado: Empleado; onVolver: () => void }) {
  const [filas, setFilas] = useState<Cronograma[]>([]);

  useEffect(() => {
    const hoy = new Date();
    const desde = ymd(hoy);
    const hastaDt = new Date(hoy);
    hastaDt.setDate(hastaDt.getDate() + 14);
    const hasta = ymd(hastaDt);
    supabase
      .from('cronograma')
      .select('*')
      .eq('empleado_id', empleado.id)
      .eq('publicado', true)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha')
      .then(({ data }) => setFilas((data as Cronograma[]) || []));
  }, [empleado.id]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Próximos 14 días</h3>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>
      {filas.length === 0 ? (
        <p className="text-xs text-gray-500">Sin horarios publicados.</p>
      ) : (
        <div className="space-y-1.5">
          {filas.map((f) => {
            const d = new Date(f.fecha + 'T00:00:00');
            const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dia = `${DIAS[d.getDay()]} ${dd}-${mm}`;
            return (
              <div
                key={f.id}
                className="flex justify-between border-b border-gray-100 py-1.5 text-xs"
              >
                <span className="capitalize text-gray-700">{dia}</span>
                <span
                  className={cn('font-medium', f.es_franco ? 'text-blue-700' : 'text-gray-900')}
                >
                  {f.es_franco ? 'Franco' : formatTurnos(f.turnos, f.hora_entrada, f.hora_salida)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Mi quincena ────────────────────────────────────────────────────────────
function MiQuincena({ empleado, onVolver }: { empleado: Empleado; onVolver: () => void }) {
  const [stats, setStats] = useState<{
    fichadas: number;
    tardanzasMayores: number;
    ausencias: number;
    horasTrabajadas: number;
    horasRequeridas: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const hoy = new Date();
      const dia = hoy.getDate();
      const ini = new Date(hoy.getFullYear(), hoy.getMonth(), dia <= 14 ? 1 : 15);
      const finDia = dia <= 14 ? 14 : new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
      const fin = new Date(hoy.getFullYear(), hoy.getMonth(), finDia);
      const desde = ymd(ini);
      const hasta = ymd(fin);

      const [{ data: fich }, { data: crono }] = await Promise.all([
        supabase
          .from('fichadas')
          .select('*')
          .eq('empleado_id', empleado.id)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          // "Mi quincena" es del local: no mezclar marcas de la Bienal.
          .is('evento', null),
        supabase
          .from('cronograma')
          .select('*')
          .eq('empleado_id', empleado.id)
          .gte('fecha', desde)
          .lte('fecha', hasta),
      ]);

      const fichArr = (fich as Fichada[]) || [];
      const cronoArr = (crono as Cronograma[]) || [];
      // Filtrar fichadas fantasma de madrugada (salidas nocturnas grabadas como entrada),
      // igual que Sueldos/Asistencia, para que el empleado vea lo mismo que se liquida.
      const fichReales = fichArr.filter((f) => !esSalidaNocturnaLegacy(f));

      // Tardanzas reales (+10min y dentro de lo plausible) contadas POR DÍA, igual que
      // el cálculo de presentismo de RRHH. Se pierde el presentismo con 2 (no con 1).
      const entradasPorDia: Record<string, Fichada[]> = {};
      fichReales.forEach((f) => {
        if (f.tipo === 'entrada') (entradasPorDia[f.fecha] ||= []).push(f);
      });
      const tardanzasMayores = Object.values(entradasPorDia).filter((ents) =>
        ents.some((f) => esTardanzaReal(f.minutos_diferencia)),
      ).length;

      // Ausencias: días con cronograma no franco y publicado, sin ninguna fichada real
      const ausencias = cronoArr.filter((c) => {
        if (c.es_franco || !c.publicado) return false;
        if (new Date(c.fecha + 'T00:00:00') > hoy) return false;
        return !fichReales.some((f) => f.fecha === c.fecha);
      }).length;

      // Horas trabajadas (pares entrada/salida por día)
      let horasTrabajadas = 0;
      const porDia: Record<string, Fichada[]> = {};
      fichReales.forEach((f) => {
        (porDia[f.fecha] ||= []).push(f);
      });
      Object.values(porDia).forEach((arr) => {
        arr.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        for (let i = 0; i + 1 < arr.length; i += 2) {
          const t1 = new Date(arr[i].timestamp).getTime();
          const t2 = new Date(arr[i + 1].timestamp).getTime();
          horasTrabajadas += Math.max(0, (t2 - t1) / 3600000);
        }
      });

      // Horas requeridas (flexibles): horas_semanales × 2
      const horasRequeridas =
        empleado.horario_tipo === 'flexible' && empleado.horas_semanales_requeridas
          ? empleado.horas_semanales_requeridas * 2
          : 0;

      setStats({
        fichadas: fichArr.length,
        tardanzasMayores,
        ausencias,
        horasTrabajadas: Math.round(horasTrabajadas * 10) / 10,
        horasRequeridas,
      });
    })();
  }, [empleado]);

  const ganaPresentismo = stats
    ? empleado.horario_tipo === 'flexible'
      ? stats.horasRequeridas > 0 &&
        stats.horasTrabajadas >= stats.horasRequeridas &&
        stats.ausencias === 0
      : stats.ausencias === 0 && stats.tardanzasMayores < 2
    : false;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Mi quincena</h3>
        <button onClick={onVolver} className="text-xs text-gray-500 underline">
          Volver
        </button>
      </div>

      {!stats ? (
        <p className="text-xs text-gray-500">Cargando...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Tarjeta label="Fichajes" value={String(stats.fichadas)} />
            <Tarjeta label="Ausencias" value={String(stats.ausencias)} />
            <Tarjeta label="Tardanzas" value={String(stats.tardanzasMayores)} />
            <Tarjeta
              label={empleado.horario_tipo === 'flexible' ? 'Horas' : 'Trabajadas'}
              value={
                empleado.horario_tipo === 'flexible' && stats.horasRequeridas
                  ? `${stats.horasTrabajadas} / ${stats.horasRequeridas}`
                  : `${stats.horasTrabajadas} h`
              }
            />
          </div>

          <div
            className={cn(
              'mt-3 rounded p-3 text-center text-xs font-medium',
              ganaPresentismo ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800',
            )}
          >
            {ganaPresentismo ? '✓ Estás ganando el presentismo' : 'Presentismo en riesgo'}
          </div>
        </>
      )}
    </div>
  );
}

function Tarjeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-gray-50 p-2.5">
      <p className="text-[10px] uppercase text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-900">{value}</p>
    </div>
  );
}
