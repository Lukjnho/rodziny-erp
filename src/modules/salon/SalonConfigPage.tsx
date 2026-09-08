import { useMemo, useRef, useState } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  useSalas,
  useMesas,
  useCrearSala,
  useEditarSala,
  useBorrarSala,
  useCrearMesa,
  useEditarMesa,
  useBorrarMesa,
  type LocalSalon,
  type Mesa,
  type FormaMesa,
} from './useSalon';

/**
 * El plano del salón: espacios y mesas.
 *
 * Es la ÚNICA fuente del plano. De estas dos tablas leen después el teléfono
 * del mozo y la pantalla del mostrador, así que una mesa que no esté acá, para
 * ellos no existe.
 *
 * ⚠️ Solo administración. Decisión de Lucas (8-sep-2026): el plano lo armamos
 * nosotros, el mozo y el cajero apenas lo miran. La base opina lo mismo — las
 * reglas de `caja_salas` y `caja_mesas` no tienen puerta de escritura para
 * ellos — así que esta pantalla no es el único candado, es el cartel.
 */

const CELDA = 48; // píxeles por casillero de la grilla
const COLS = 16;
const FILAS = 10;

export function SalonConfigPage() {
  const { perfil } = useAuth();
  const localFijo = (perfil?.local_restringido as LocalSalon | null) ?? null;
  const [local, setLocal] = useState<LocalSalon>(localFijo ?? 'saavedra');
  // Lo que el usuario tocó. Puede quedar viejo al cambiar de casa o al borrar un
  // espacio, así que el espacio que vale se deriva más abajo en vez de
  // sincronizarse con un efecto.
  const [salaPedida, setSalaPedida] = useState<string | null>(null);
  const [mesaSel, setMesaSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const salasQ = useSalas(local);
  const mesasQ = useMesas(local);

  const crearSala = useCrearSala(local);
  const editarSala = useEditarSala(local);
  const borrarSala = useBorrarSala(local);
  const crearMesa = useCrearMesa(local);
  const editarMesa = useEditarMesa(local);
  const borrarMesa = useBorrarMesa(local);

  const salas = useMemo(() => salasQ.data ?? [], [salasQ.data]);

  // Si lo elegido ya no existe (cambió la casa, se borró el espacio), cae solo
  // en el primero que haya.
  const salaSel = salas.some((s) => s.id === salaPedida) ? salaPedida : (salas[0]?.id ?? null);

  const mesas = useMemo(
    () => (mesasQ.data ?? []).filter((m) => m.sala_id === salaSel),
    [mesasQ.data, salaSel],
  );

  const mesa = mesas.find((m) => m.id === mesaSel) ?? null;

  async function correr(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    }
  }

  if (!perfil?.es_admin) {
    return (
      <PageContainer title="Salón">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div className="mb-3 text-4xl">🍽️</div>
          <h3 className="mb-1 text-lg font-semibold text-gray-700">
            El plano lo arma administración
          </h3>
          <p className="text-sm text-gray-500">
            Los espacios y las mesas se configuran desde una cuenta de administrador. La pantalla
            para tomar pedidos en la mesa todavía no está lista.
          </p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer title="Salón — espacios y mesas">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {!localFijo && (
          <LocalSelector value={local} onChange={(v) => setLocal(v as LocalSalon)} />
        )}
        <p className="text-sm text-gray-500">
          Lo que armes acá es lo que van a ver el mozo en el teléfono y el cajero en el mostrador.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <Espacios
        salas={salas}
        cargando={salasQ.isLoading}
        salaSel={salaSel}
        onElegir={(id) => {
          setSalaPedida(id);
          setMesaSel(null);
        }}
        cuantasMesas={(id) => (mesasQ.data ?? []).filter((m) => m.sala_id === id).length}
        onCrear={(nombre) => correr(() => crearSala.mutateAsync({ nombre, orden: salas.length + 1 }))}
        onRenombrar={(id, nombre) => correr(() => editarSala.mutateAsync({ id, nombre }))}
        onBorrar={(id, nombre, conMesas) => {
          if (conMesas > 0) {
            setError(
              `"${nombre}" todavía tiene ${conMesas} mesa${conMesas === 1 ? '' : 's'}. ` +
                'Borralas o mudalas antes de sacar el espacio.',
            );
            return;
          }
          if (!window.confirm(`¿Sacar el espacio "${nombre}"?`)) return;
          void correr(() => borrarSala.mutateAsync(id));
        }}
      />

      {salaSel && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Plano
            mesas={mesas}
            mesaSel={mesaSel}
            onElegir={setMesaSel}
            onMover={(id, pos_x, pos_y) => correr(() => editarMesa.mutateAsync({ id, pos_x, pos_y }))}
            onAgregar={() => {
              const numero = window.prompt('Número o nombre de la mesa (ej: 7, 24, Barra)');
              if (numero === null) return;
              const libre = primerLugarLibre(mesas);
              void correr(() =>
                crearMesa.mutateAsync({ salaId: salaSel, numero, pos_x: libre.x, pos_y: libre.y }),
              );
            }}
          />
          <PanelMesa
            // Con la key, elegir otra mesa REMONTA el panel y los campos nacen
            // con los datos de esa mesa. Sin esto haría falta un efecto que
            // sincronice, que es de donde salen los renglones que se pisan.
            key={mesa?.id ?? 'sin-mesa'}
            mesa={mesa}
            onCambiar={(cambios) =>
              mesa && correr(() => editarMesa.mutateAsync({ id: mesa.id, ...cambios }))
            }
            onBorrar={() => {
              if (!mesa) return;
              if (!window.confirm(`¿Sacar la mesa ${mesa.numero} del plano?`)) return;
              void correr(async () => {
                await borrarMesa.mutateAsync(mesa.id);
                setMesaSel(null);
              });
            }}
          />
        </div>
      )}
    </PageContainer>
  );
}

// ── Espacios ────────────────────────────────────────────────────────────────

function Espacios({
  salas,
  cargando,
  salaSel,
  onElegir,
  cuantasMesas,
  onCrear,
  onRenombrar,
  onBorrar,
}: {
  salas: { id: string; nombre: string }[];
  cargando: boolean;
  salaSel: string | null;
  onElegir: (id: string) => void;
  cuantasMesas: (id: string) => number;
  onCrear: (nombre: string) => void;
  onRenombrar: (id: string, nombre: string) => void;
  onBorrar: (id: string, nombre: string, conMesas: number) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Espacios</h3>
        <button
          onClick={() => {
            const nombre = window.prompt('Nombre del espacio (ej: Salón, Vereda, Patio)');
            if (nombre !== null) onCrear(nombre);
          }}
          className="rounded bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
        >
          + Agregar espacio
        </button>
      </div>

      {cargando && <p className="text-sm text-gray-400">Cargando…</p>}

      {!cargando && salas.length === 0 && (
        <p className="text-sm text-gray-500">
          Todavía no hay espacios en esta casa. Agregá el primero — por ejemplo “Salón”.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {salas.map((s) => {
          const n = cuantasMesas(s.id);
          const elegido = s.id === salaSel;
          return (
            <div
              key={s.id}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                elegido
                  ? 'border-rodziny-700 bg-rodziny-50 text-rodziny-900'
                  : 'border-gray-300 bg-white text-gray-600',
              )}
            >
              <button onClick={() => onElegir(s.id)} className="font-medium">
                {s.nombre}
              </button>
              <span className="text-xs text-gray-400">
                {n} mesa{n === 1 ? '' : 's'}
              </span>
              <button
                onClick={() => {
                  const nombre = window.prompt('Nuevo nombre del espacio', s.nombre);
                  if (nombre !== null) onRenombrar(s.id, nombre);
                }}
                title="Cambiarle el nombre"
                className="text-gray-400 hover:text-gray-700"
              >
                ✎
              </button>
              <button
                onClick={() => onBorrar(s.id, s.nombre, n)}
                title="Sacar el espacio"
                className="text-gray-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── El plano ────────────────────────────────────────────────────────────────

function Plano({
  mesas,
  mesaSel,
  onElegir,
  onMover,
  onAgregar,
}: {
  mesas: Mesa[];
  mesaSel: string | null;
  onElegir: (id: string) => void;
  onMover: (id: string, x: number, y: number) => void;
  onAgregar: () => void;
}) {
  // Mientras se arrastra, la mesa se mueve con el dedo sin esperar a la base.
  const [arrastre, setArrastre] = useState<{ id: string; x: number; y: number } | null>(null);
  const inicio = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  const cols = Math.max(COLS, ...mesas.map((m) => Math.ceil(m.pos_x + m.ancho)), 1);
  const filas = Math.max(FILAS, ...mesas.map((m) => Math.ceil(m.pos_y + m.alto)), 1);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Plano <span className="font-normal text-gray-400">— arrastrá las mesas para ubicarlas</span>
        </h3>
        <button
          onClick={onAgregar}
          className="rounded bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
        >
          + Agregar mesa
        </button>
      </div>

      <div className="overflow-x-auto">
        <div
          className="relative rounded-md border border-gray-200 bg-gray-50"
          style={{
            width: cols * CELDA,
            height: filas * CELDA,
            backgroundImage:
              'linear-gradient(to right, rgba(0,0,0,.06) 1px, transparent 1px),' +
              'linear-gradient(to bottom, rgba(0,0,0,.06) 1px, transparent 1px)',
            backgroundSize: `${CELDA}px ${CELDA}px`,
          }}
        >
          {mesas.length === 0 && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
              Este espacio todavía no tiene mesas.
            </p>
          )}

          {mesas.map((m) => {
            const moviendo = arrastre?.id === m.id;
            const x = moviendo ? arrastre.x : m.pos_x;
            const y = moviendo ? arrastre.y : m.pos_y;
            return (
              <button
                key={m.id}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  onElegir(m.id);
                  inicio.current = { mx: e.clientX, my: e.clientY, px: m.pos_x, py: m.pos_y };
                  setArrastre({ id: m.id, x: m.pos_x, y: m.pos_y });
                }}
                onPointerMove={(e) => {
                  if (!inicio.current || arrastre?.id !== m.id) return;
                  const dx = Math.round((e.clientX - inicio.current.mx) / CELDA);
                  const dy = Math.round((e.clientY - inicio.current.my) / CELDA);
                  setArrastre({
                    id: m.id,
                    x: Math.max(0, inicio.current.px + dx),
                    y: Math.max(0, inicio.current.py + dy),
                  });
                }}
                onPointerUp={() => {
                  if (arrastre?.id === m.id && (arrastre.x !== m.pos_x || arrastre.y !== m.pos_y)) {
                    onMover(m.id, arrastre.x, arrastre.y);
                  }
                  inicio.current = null;
                  setArrastre(null);
                }}
                className={cn(
                  'absolute flex touch-none select-none items-center justify-center border-2 text-sm font-semibold shadow-sm',
                  m.forma === 'redonda' ? 'rounded-full' : 'rounded-md',
                  !m.activo && 'opacity-40',
                  mesaSel === m.id
                    ? 'border-rodziny-700 bg-rodziny-100 text-rodziny-900'
                    : 'border-gray-400 bg-white text-gray-700',
                  moviendo ? 'cursor-grabbing' : 'cursor-grab',
                )}
                style={{
                  left: x * CELDA + 4,
                  top: y * CELDA + 4,
                  width: m.ancho * CELDA - 8,
                  height: m.alto * CELDA - 8,
                }}
                title={`Mesa ${m.numero}`}
              >
                {m.numero}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── El panel de la mesa elegida ─────────────────────────────────────────────

function PanelMesa({
  mesa,
  onCambiar,
  onBorrar,
}: {
  mesa: Mesa | null;
  onCambiar: (cambios: Partial<Mesa>) => void;
  onBorrar: () => void;
}) {
  const [numero, setNumero] = useState(mesa?.numero ?? '');

  if (!mesa) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-500">
          Tocá una mesa del plano para cambiarle el número, el tamaño o la forma.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700">Mesa {mesa.numero}</h3>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Número o nombre</span>
        <input
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          onBlur={() => numero.trim() !== mesa.numero && onCambiar({ numero: numero.trim() })}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <span className="mt-1 block text-xs text-gray-400">
          Va como texto: el Salón puede saltar del 13 al 24, o llamarse “Barra”.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Cuánta gente entra</span>
        <input
          type="number"
          min={1}
          value={mesa.capacidad ?? ''}
          onChange={(e) =>
            onCambiar({ capacidad: e.target.value === '' ? null : Number(e.target.value) })
          }
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </label>

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-500">Forma</span>
        <div className="flex overflow-hidden rounded-md border border-gray-300">
          {(['rectangular', 'redonda'] as FormaMesa[]).map((f) => (
            <button
              key={f}
              onClick={() => onCambiar({ forma: f })}
              className={cn(
                'flex-1 px-3 py-1.5 text-sm',
                mesa.forma === f ? 'bg-rodziny-800 text-white' : 'bg-white text-gray-600',
              )}
            >
              {f === 'rectangular' ? 'Rectangular' : 'Redonda'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Ancho</span>
          <input
            type="number"
            min={1}
            max={8}
            value={mesa.ancho}
            onChange={(e) => onCambiar({ ancho: Math.max(1, Number(e.target.value)) })}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Alto</span>
          <input
            type="number"
            min={1}
            max={8}
            value={mesa.alto}
            onChange={(e) => onCambiar({ alto: Math.max(1, Number(e.target.value)) })}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={mesa.activo}
          onChange={(e) => onCambiar({ activo: e.target.checked })}
        />
        En uso
      </label>
      <p className="text-xs text-gray-400">
        Una mesa apagada deja de aparecerle al mozo, pero no se pierde lo que se cobró en ella.
      </p>

      <button
        onClick={onBorrar}
        className="w-full rounded border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
      >
        Sacar la mesa del plano
      </button>
      <p className="text-xs text-gray-400">
        Si la mesa ya tuvo gente sentada, la base no la deja borrar: apagala con “En uso”.
      </p>
    </div>
  );
}

/** El primer casillero libre, para no apilar la mesa nueva sobre otra. */
function primerLugarLibre(mesas: Mesa[]): { x: number; y: number } {
  const ocupado = new Set<string>();
  for (const m of mesas) {
    for (let x = m.pos_x; x < m.pos_x + m.ancho; x++) {
      for (let y = m.pos_y; y < m.pos_y + m.alto; y++) ocupado.add(`${x},${y}`);
    }
  }
  for (let y = 0; y < FILAS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!ocupado.has(`${x},${y}`)) return { x, y };
    }
  }
  return { x: 0, y: FILAS };
}
