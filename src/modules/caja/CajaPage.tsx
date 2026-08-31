import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { CAJAS, CAJA_PRUEBAS, TURNOS, turnoSugerido } from '@/lib/turnosCaja';
import { esVentanaDeCaja } from '@/lib/ventanaCaja';
import { DocumentoImpresion, imprimir, type DatosImpresion } from './Impresion';
import {
  useCatalogoCaja,
  useMediosPagoCaja,
  useTurnoAbierto,
  useVentasDelTurno,
  useAbrirTurno,
  useCerrarTurno,
  useCobrarVenta,
  useDetalleTicket,
  efectivoEsperadoEnCaja,
  ordenGrupo,
  type ItemCatalogo,
  type LocalCaja,
  type MedioPagoCaja,
  type LineaVenta,
  type PagoVenta,
  type VentaTurno,
} from './useCaja';

const pesos = (n: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);

const ETIQUETA_GRUPO: Record<string, string> = {
  pasta: 'Pastas',
  salsa: 'Salsas',
  bebida: 'Bebidas',
  postre: 'Postres',
  otros: 'Otros',
};
const etiqueta = (g: string) => ETIQUETA_GRUPO[g] ?? g.charAt(0).toUpperCase() + g.slice(1);

/**
 * Fecha y hora de Argentina para estampar el ticket.
 *
 * OJO: acá NO se usa hoyAR(), que corre el corte a las 5 de la mañana para la
 * jornada de cocina. El ticket tiene que llevar la fecha del calendario, la
 * misma que le pone Fudo, porque los dos se comparan mientras corran en
 * paralelo. El turno (que sí cruza la medianoche) se resuelve aparte, con
 * cierre_caja_id.
 */
function ahoraAR(): { fecha: string; hora: string } {
  const arg = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return {
    fecha: arg.toISOString().slice(0, 10),
    hora: arg.toISOString().slice(11, 16),
  };
}

/** Saca tildes y pasa a minúscula, para que "noqui" encuentre "Ñoquis". */
function normalizar(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Reloj en vivo, hora de Argentina. En la caja se mira todo el turno. */
function Reloj() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const opciones: Intl.DateTimeFormatOptions = { timeZone: 'America/Argentina/Buenos_Aires' };
  return (
    <div className="text-right leading-tight">
      <div className="text-2xl font-semibold tabular-nums text-gray-900">
        {ahora.toLocaleTimeString('es-AR', { ...opciones, hour12: false })}
      </div>
      <div className="text-xs capitalize text-gray-500">
        {ahora.toLocaleDateString('es-AR', {
          ...opciones,
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      </div>
    </div>
  );
}

/**
 * El punto de venta, siempre a pantalla completa y sin menú lateral (ver
 * RUTAS_PANTALLA_COMPLETA en App.tsx). Vive en `/caja/pos` y normalmente se
 * abre en su **propia ventana** desde el ítem Caja del menú — el ERP se queda
 * atrás mostrando el arqueo en curso (ver CajaResumen).
 */
export function CajaPage() {
  const { perfil } = useAuth();
  // Si esta es la ventana aparte, se sale cerrándola; si alguien entró por la
  // dirección en una pestaña normal, se sale volviendo al ERP.
  const enVentanaAparte = esVentanaDeCaja();
  const localForzado = perfil?.local_restringido ?? null;
  const [local, setLocal] = useState<LocalCaja>((localForzado as LocalCaja) ?? 'vedia');
  const [caja, setCaja] = useState<string>(CAJA_PRUEBAS);

  const turnoQ = useTurnoAbierto(local, caja);

  const selectores = (
    <>
      {!localForzado && (
        <select
          value={local}
          onChange={(e) => setLocal(e.target.value as LocalCaja)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
      )}
      <select
        value={caja}
        onChange={(e) => setCaja(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1.5 text-sm"
      >
        {(CAJAS[local] ?? []).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </>
  );

  const cuerpo = (
    <>
      {caja === CAJA_PRUEBAS && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Caja de pruebas.</strong> Todo lo que cobres acá se guarda de verdad, pero queda
          marcado como venta del POS: <strong>no entra en Ventas, EdR ni Flujo de Caja</strong>, y
          no se pisa con ningún cierre que cargue administración.
        </div>
      )}

      {turnoQ.isLoading ? (
        <p className="text-sm text-gray-500">Buscando turno abierto…</p>
      ) : turnoQ.data ? (
        <Mostrador
          local={local}
          caja={caja}
          turno={turnoQ.data}
          onCerrado={() => turnoQ.refetch()}
        />
      ) : (
        <AbrirTurno local={local} caja={caja} onAbierto={() => turnoQ.refetch()} />
      )}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface-bg">
      <header className="flex items-center justify-between gap-4 border-b border-surface-border bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-gray-900">Caja</span>
          {selectores}
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right leading-tight">
            <div className="text-sm font-medium capitalize text-gray-900">{perfil?.nombre}</div>
            <div className="text-xs text-gray-400">Cajero</div>
          </div>
          <Reloj />
          {/* La salida tiene que verse: acá no hay menú lateral, y sin un botón
              claro el cajero queda encerrado en el POS. */}
          {enVentanaAparte ? (
            <button
              onClick={() => window.close()}
              className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              title="Cierra esta ventana. El turno queda abierto: para cerrarlo usá 'Cerrar turno'."
            >
              ✕ Cerrar ventana
            </button>
          ) : (
            <Link
              to="/caja"
              className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              title="Vuelve al ERP. El turno queda abierto."
            >
              ← Salir al ERP
            </Link>
          )}
        </div>
      </header>
      <main className="flex-1 p-4">{cuerpo}</main>
    </div>
  );
}

// ── Apertura ─────────────────────────────────────────────────────────────────

function AbrirTurno({
  local,
  caja,
  onAbierto,
}: {
  local: LocalCaja;
  caja: string;
  onAbierto: () => void;
}) {
  const { perfil } = useAuth();
  const abrir = useAbrirTurno();
  const { fecha, hora } = ahoraAR();
  const [turno, setTurno] = useState(() => turnoSugerido(local, hora));
  const [fondo, setFondo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const turnos = TURNOS[local] ?? [];

  return (
    <div className="mx-auto max-w-md rounded-lg border border-surface-border bg-white p-6">
      <h2 className="mb-1 text-base font-semibold text-gray-900">Abrir turno</h2>
      <p className="mb-5 text-sm text-gray-500">
        {caja} · {fecha}
      </p>

      <label className="mb-1 block text-sm font-medium text-gray-700">Turno</label>
      <select
        value={turno}
        onChange={(e) => setTurno(e.target.value)}
        className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm"
      >
        {turnos.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>

      <label className="mb-1 block text-sm font-medium text-gray-700">
        Fondo inicial (la plata con la que arrancás)
      </label>
      <input
        type="number"
        inputMode="numeric"
        value={fondo}
        onChange={(e) => setFondo(e.target.value)}
        placeholder="0"
        className="mb-1 w-full rounded border border-gray-300 px-3 py-2 text-lg"
      />
      <p className="mb-5 text-xs text-gray-500">
        Se suma al arqueo del cierre: al final tenés que tener este fondo más lo que cobraste en
        efectivo.
      </p>

      {error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        disabled={abrir.isPending || fondo === ''}
        onClick={async () => {
          setError(null);
          try {
            await abrir.mutateAsync({
              local,
              fecha,
              turno,
              caja,
              fondoApertura: Number(fondo) || 0,
              cajeroNombre: perfil?.nombre ?? 'Sin nombre',
              horaInicio: hora,
            });
            onAbierto();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
        className="w-full rounded bg-rodziny-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
      >
        {abrir.isPending ? 'Abriendo…' : 'Abrir turno'}
      </button>
    </div>
  );
}

// ── Mostrador ────────────────────────────────────────────────────────────────

function Mostrador({
  local,
  caja,
  turno,
  onCerrado,
}: {
  local: LocalCaja;
  caja: string;
  turno: { id: string; fecha: string; turno: string; fondo_apertura: number };
  onCerrado: () => void;
}) {
  const catalogoQ = useCatalogoCaja(local);
  const ventasQ = useVentasDelTurno(turno.id);
  const cobrar = useCobrarVenta();

  const [busqueda, setBusqueda] = useState('');
  const [grupoSel, setGrupoSel] = useState<string>('todo');
  const [cliente, setCliente] = useState('');
  const [lineas, setLineas] = useState<LineaVenta[]>([]);
  const [cobrando, setCobrando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [doc, setDoc] = useState<DatosImpresion | null>(null);
  const [verVenta, setVerVenta] = useState<VentaTurno | null>(null);
  const [buscarVenta, setBuscarVenta] = useState('');
  const buscadorRef = useRef<HTMLInputElement>(null);

  const catalogo = catalogoQ.data ?? [];
  const total = lineas.reduce((s, l) => s + l.item.precio * l.cantidad, 0);

  // Cuando hay un documento armado, se manda a imprimir. El timeout le da a
  // React el tiempo de pintarlo antes de que el navegador saque la foto, y el
  // documento se desmonta recién cuando el diálogo se cerró: si se sacara antes,
  // la vista previa podía quedar vacía.
  useEffect(() => {
    if (!doc) return;
    const limpiar = () => setDoc(null);
    window.addEventListener('afterprint', limpiar);
    const t = setTimeout(() => imprimir(), 120);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', limpiar);
    };
  }, [doc]);

  const grupos = useMemo(() => {
    const set = new Set(catalogo.map((i) => i.grupo));
    return Array.from(set).sort((a, b) => ordenGrupo(a) - ordenGrupo(b));
  }, [catalogo]);

  const resultados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    let base = catalogo;
    if (grupoSel !== 'todo') base = base.filter((i) => i.grupo === grupoSel);
    if (q) base = base.filter((i) => normalizar(i.nombre).includes(q));
    return base;
  }, [busqueda, grupoSel, catalogo]);

  // Agrupado para mostrar: cuando el cajero no está buscando, ve las secciones.
  const porGrupo = useMemo(() => {
    const m = new Map<string, ItemCatalogo[]>();
    for (const i of resultados) {
      const lista = m.get(i.grupo) ?? [];
      lista.push(i);
      m.set(i.grupo, lista);
    }
    return Array.from(m.entries()).sort((a, b) => ordenGrupo(a[0]) - ordenGrupo(b[0]));
  }, [resultados]);

  /**
   * Agrega un producto al ticket.
   *
   * La regla de la casa: la salsa va DEBAJO de la pasta que la lleva. Si lo que
   * se agrega es una salsa, se cuelga de la última pasta cargada y se inserta
   * justo abajo de ella. Así la comanda sale como cocina la necesita leer:
   * Tagliatelle / Bolognesa, Ravioli / Rosé.
   */
  function agregar(item: ItemCatalogo) {
    setLineas((prev) => {
      // ¿ya está esa misma línea suelta? entonces solo suma cantidad
      const iguales = prev.findIndex((l) => l.item.key === item.key && !l.padreKey);
      if (item.grupo !== 'salsa' && iguales !== -1) {
        const copia = [...prev];
        copia[iguales] = { ...copia[iguales], cantidad: copia[iguales].cantidad + 1 };
        return copia;
      }

      if (item.grupo === 'salsa') {
        // última pasta cargada, buscando desde el final
        const idxPasta = [...prev].reverse().findIndex((l) => l.item.grupo === 'pasta' && !l.padreKey);
        if (idxPasta !== -1) {
          const real = prev.length - 1 - idxPasta;
          const madre = prev[real];
          // si esa pasta ya tiene esta misma salsa, se suma cantidad
          let fin = real + 1;
          while (fin < prev.length && prev[fin].padreKey === madre.item.key) {
            if (prev[fin].item.key === item.key) {
              const copia = [...prev];
              copia[fin] = { ...copia[fin], cantidad: copia[fin].cantidad + 1 };
              return copia;
            }
            fin++;
          }
          const copia = [...prev];
          copia.splice(fin, 0, { item, cantidad: 1, padreKey: madre.item.key });
          return copia;
        }
      }

      return [...prev, { item, cantidad: 1, padreKey: null }];
    });
    setBusqueda('');
    buscadorRef.current?.focus();
  }

  function cambiarCantidad(indice: number, delta: number) {
    setLineas((prev) => {
      const linea = prev[indice];
      if (!linea) return prev;
      const nueva = linea.cantidad + delta;
      if (nueva > 0) {
        const copia = [...prev];
        copia[indice] = { ...copia[indice], cantidad: nueva };
        return copia;
      }
      // al sacar una pasta se van también sus salsas: no tiene sentido una
      // salsa colgando de nada
      return prev.filter(
        (l, i) => i !== indice && !(linea.padreKey == null && l.padreKey === linea.item.key),
      );
    });
  }

  function armarDoc(tipo: DatosImpresion['tipo'], numero: string, pagos: PagoVenta[]): DatosImpresion {
    const { fecha, hora } = ahoraAR();
    return {
      tipo,
      local,
      caja,
      numero,
      fecha,
      hora,
      cliente: cliente.trim() || null,
      lineas: lineas.map((l) => ({
        nombre: l.item.nombre,
        cantidad: l.cantidad,
        precioUnitario: l.item.precio,
        total: l.item.precio * l.cantidad,
        esHija: !!l.padreKey,
      })),
      pagos: pagos.map((p) => ({ medio: p.medio.nombre, monto: p.monto })),
      total,
    };
  }

  // Totales del turno, para el arqueo
  const ventas = ventasQ.data ?? [];
  const totales = useMemo(() => {
    let efectivo = 0;
    let otros = 0;
    const porMedio = new Map<string, number>();
    for (const v of ventas) {
      for (const p of v.pagos) {
        if (p.esEfectivo) efectivo += p.monto;
        else otros += p.monto;
        porMedio.set(p.medio, (porMedio.get(p.medio) ?? 0) + p.monto);
      }
    }
    return { efectivo, otros, porMedio, cantidad: ventas.length };
  }, [ventas]);

  // Las últimas 6 (lo que se necesita cuando vuelve un cliente), o el resultado
  // de la búsqueda por llamador / hora si el cajero está buscando una vieja.
  const ventasVisibles = useMemo(() => {
    const q = normalizar(buscarVenta.trim());
    const recientes = [...ventas].reverse();
    if (!q) return recientes.slice(0, 6);
    return recientes.filter(
      (v) => normalizar(v.cliente ?? '').includes(q) || (v.hora ?? '').includes(q),
    );
  }, [ventas, buscarVenta]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      {/* Buscador + catálogo */}
      <div className="rounded-lg border border-surface-border bg-white p-4">
        <input
          ref={buscadorRef}
          autoFocus
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && resultados.length > 0) agregar(resultados[0]);
            if (e.key === 'Escape') setBusqueda('');
          }}
          placeholder="Escribí el producto y apretá Enter…"
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2.5 text-base"
        />

        <div className="mb-3 flex flex-wrap gap-1">
          <ChipGrupo activo={grupoSel === 'todo'} onClick={() => setGrupoSel('todo')}>
            Todo
          </ChipGrupo>
          {grupos.map((g) => (
            <ChipGrupo key={g} activo={grupoSel === g} onClick={() => setGrupoSel(g)}>
              {etiqueta(g)}
            </ChipGrupo>
          ))}
        </div>

        {catalogoQ.isLoading ? (
          <p className="text-sm text-gray-500">Cargando catálogo…</p>
        ) : catalogo.length === 0 ? (
          <p className="text-sm text-gray-500">
            Este local no tiene productos con precio de mostrador cargado.
          </p>
        ) : resultados.length === 0 ? (
          <p className="py-4 text-sm text-gray-500">
            Nada con ese nombre. Si es algo que vendés, hay que darlo de alta en Productos.
          </p>
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto">
            {porGrupo.map(([grupo, items]) => (
              <div key={grupo}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {etiqueta(grupo)}
                </h3>
                {/* Botones grandes: la caja se usa con apuro y con los dedos */}
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {items.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => agregar(item)}
                      className="rounded border border-gray-200 px-3 py-3 text-left hover:border-rodziny-500 hover:bg-rodziny-50"
                    >
                      <div className="text-base font-medium leading-tight text-gray-900">
                        {item.nombre}
                      </div>
                      <div className="mt-0.5 text-base font-medium text-gray-500">
                        {pesos(item.precio)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ticket actual + turno */}
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-surface-border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Ticket</h2>

          <label className="mb-1 block text-xs font-medium text-gray-600">
            Cliente / N° de llamador
          </label>
          <input
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="Ej: 12"
            className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-lg font-semibold"
          />

          {lineas.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Todavía no agregaste nada</p>
          ) : (
            <div className="mb-3 max-h-[34vh] space-y-1 overflow-y-auto">
              {lineas.map((l, i) => (
                <div
                  key={`${l.item.key}-${i}`}
                  className={cn(
                    'flex items-center gap-2 border-b border-gray-100 py-1.5',
                    l.padreKey && 'pl-4',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-900">
                      {l.padreKey && <span className="text-gray-400">› </span>}
                      {l.item.nombre}
                    </div>
                    <div className="text-xs text-gray-500">{pesos(l.item.precio)} c/u</div>
                  </div>
                  <button
                    onClick={() => cambiarCantidad(i, -1)}
                    className="h-7 w-7 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-medium">{l.cantidad}</span>
                  <button
                    onClick={() => cambiarCantidad(i, 1)}
                    className="h-7 w-7 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                  >
                    +
                  </button>
                  <span className="w-20 text-right text-sm font-medium text-gray-900">
                    {pesos(l.item.precio * l.cantidad)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mb-3 flex items-baseline justify-between border-t border-gray-200 pt-3">
            <span className="text-sm text-gray-600">Total</span>
            <span className="text-2xl font-semibold text-gray-900">{pesos(total)}</span>
          </div>

          {aviso && (
            <div className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
              {aviso}
            </div>
          )}

          <div className="mb-2 flex gap-2">
            <button
              disabled={lineas.length === 0}
              onClick={() => setLineas([])}
              className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Vaciar
            </button>
            <button
              disabled={lineas.length === 0}
              onClick={() => setDoc(armarDoc('control', '—', []))}
              className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Control
            </button>
            <button
              disabled={lineas.length === 0}
              onClick={() => setCobrando(true)}
              className="flex-1 rounded bg-rodziny-700 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-800 disabled:opacity-40"
            >
              Cobrar
            </button>
          </div>
          <p className="text-xs text-gray-400">
            "Control" imprime el detalle sin cobrar, para que el cliente lo revise.
          </p>
        </div>

        <div className="rounded-lg border border-surface-border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Turno abierto</h2>
          <dl className="space-y-1 text-sm">
            <Fila k="Caja" v={caja} />
            <Fila k="Fondo inicial" v={pesos(turno.fondo_apertura)} />
            <Fila k="Tickets cobrados" v={String(totales.cantidad)} />
            <Fila k="Efectivo" v={pesos(totales.efectivo)} />
            <Fila k="Otros medios" v={pesos(totales.otros)} />
            <Fila
              k="Tiene que haber en caja"
              v={pesos(turno.fondo_apertura + totales.efectivo)}
              fuerte
            />
          </dl>
          <button
            onClick={() => setCerrando(true)}
            className="mt-4 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cerrar turno
          </button>
        </div>

        {/* Historial del turno. En un turno real de Vedia son ~65 ventas, así
            que no se listan todas: se muestran las últimas (que es lo que el
            cajero necesita cuando vuelve un cliente) y para el resto hay
            buscador por número de llamador o por hora. */}
        <div className="rounded-lg border border-surface-border bg-white p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Ventas del turno</h2>
            <span className="text-xs text-gray-400">{ventas.length} en total</span>
          </div>

          {ventas.length === 0 ? (
            <p className="py-3 text-center text-sm text-gray-400">Todavía no cobraste nada</p>
          ) : (
            <>
              <input
                value={buscarVenta}
                onChange={(e) => setBuscarVenta(e.target.value)}
                placeholder="Buscar por llamador o por hora…"
                className="mb-2 w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm"
              />
              <div className="max-h-[30vh] divide-y divide-gray-100 overflow-y-auto">
                {ventasVisibles.map((v) => (
                  <button
                    key={v.ticketId}
                    onClick={() => setVerVenta(v)}
                    className="flex w-full items-center gap-2 py-2 text-left hover:bg-gray-50"
                  >
                    <span className="w-11 shrink-0 text-sm tabular-nums text-gray-500">
                      {v.hora?.slice(0, 5) ?? '—'}
                    </span>
                    {v.cliente ? (
                      <span className="shrink-0 rounded bg-rodziny-50 px-1.5 py-0.5 text-xs font-semibold text-rodziny-700">
                        #{v.cliente}
                      </span>
                    ) : (
                      <span className="w-6 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-500">
                      {v.pagos.map((p) => p.medio).join(' + ')}
                    </span>
                    <span className="shrink-0 text-sm font-medium text-gray-900">
                      {pesos(v.total)}
                    </span>
                  </button>
                ))}
                {ventasVisibles.length === 0 && (
                  <p className="py-3 text-center text-sm text-gray-400">
                    Ninguna venta con ese llamador
                  </p>
                )}
              </div>
              {!buscarVenta.trim() && ventas.length > ventasVisibles.length && (
                <p className="mt-2 text-xs text-gray-400">
                  Mostrando las últimas {ventasVisibles.length}. Buscá por llamador para encontrar
                  una anterior.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {cobrando && (
        <ModalCobro
          total={total}
          onCancelar={() => setCobrando(false)}
          onConfirmar={async (pagos, queImprimir) => {
            const { fecha, hora } = ahoraAR();
            const res = await cobrar.mutateAsync({
              local,
              caja,
              turnoId: turno.id,
              fecha,
              hora,
              cliente: cliente.trim() || null,
              lineas,
              pagos,
            });
            const numero = res.ticketId.slice(0, 8);
            if (queImprimir) setDoc(armarDoc(queImprimir, numero, pagos));
            setLineas([]);
            setCliente('');
            setCobrando(false);
            setAviso(`Cobrado ${pesos(res.total)} · ticket ${numero}`);
            setTimeout(() => setAviso(null), 5000);
            buscadorRef.current?.focus();
          }}
        />
      )}

      {cerrando && (
        <ModalCierre
          turnoId={turno.id}
          fondoApertura={turno.fondo_apertura}
          totales={totales}
          onCancelar={() => setCerrando(false)}
          onCerrado={() => {
            setCerrando(false);
            onCerrado();
          }}
        />
      )}

      {verVenta && (
        <ModalVenta
          venta={verVenta}
          local={local}
          caja={caja}
          fechaTurno={turno.fecha}
          onCerrar={() => setVerVenta(null)}
          onImprimir={(d) => setDoc(d)}
        />
      )}

      {doc && <DocumentoImpresion datos={doc} />}
    </div>
  );
}

// ── Detalle de una venta ya cobrada ──────────────────────────────────────────

function ModalVenta({
  venta,
  local,
  caja,
  fechaTurno,
  onCerrar,
  onImprimir,
}: {
  venta: VentaTurno;
  local: LocalCaja;
  caja: string;
  fechaTurno: string;
  onCerrar: () => void;
  onImprimir: (d: DatosImpresion) => void;
}) {
  const detalleQ = useDetalleTicket(venta.ticketId);
  const lineas = detalleQ.data ?? [];

  function reimprimir(tipo: 'comanda' | 'ticket') {
    onImprimir({
      tipo,
      local,
      caja,
      numero: venta.ticketId.slice(0, 8),
      fecha: fechaTurno,
      // la hora de la venta; la hora de impresión la pone el documento solo
      hora: venta.hora?.slice(0, 5) ?? '',
      cliente: venta.cliente,
      lineas: lineas.map((l) => ({
        nombre: l.nombre,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        total: l.total,
        esHija: l.esHija,
      })),
      pagos: venta.pagos.map((p) => ({ medio: p.medio, monto: p.monto })),
      total: venta.total,
    });
    onCerrar();
  }

  return (
    <Modal
      titulo={`Venta ${venta.hora?.slice(0, 5) ?? ''}${venta.cliente ? ` · llamador ${venta.cliente}` : ''}`}
      onCerrar={onCerrar}
    >
      {detalleQ.isLoading ? (
        <p className="text-sm text-gray-500">Buscando el detalle…</p>
      ) : (
        <>
          <div className="mb-3 space-y-1">
            {lineas.map((l) => (
              <div
                key={l.id}
                className={cn('flex justify-between text-sm', l.esHija && 'pl-4 text-gray-600')}
              >
                <span>
                  {l.esHija && <span className="text-gray-400">› </span>}
                  {l.cantidad > 1 ? `${l.cantidad}x ` : ''}
                  {l.nombre}
                </span>
                <span>{pesos(l.total)}</span>
              </div>
            ))}
          </div>

          <div className="mb-3 flex justify-between border-t border-gray-200 pt-2 font-semibold">
            <span>Total</span>
            <span>{pesos(venta.total)}</span>
          </div>

          <div className="mb-4 space-y-0.5 text-sm text-gray-600">
            {venta.pagos.map((p, i) => (
              <div key={i} className="flex justify-between">
                <span>{p.medio}</span>
                <span>{pesos(p.monto)}</span>
              </div>
            ))}
          </div>

          <div className="mb-2 grid grid-cols-2 gap-2">
            <button
              onClick={() => reimprimir('comanda')}
              className="rounded bg-rodziny-700 px-3 py-2 text-sm font-medium text-white hover:bg-rodziny-800"
            >
              Reimprimir comanda
            </button>
            <button
              onClick={() => reimprimir('ticket')}
              className="rounded border border-rodziny-600 px-3 py-2 text-sm font-medium text-rodziny-700 hover:bg-rodziny-50"
            >
              Reimprimir ticket
            </button>
          </div>
          <button
            onClick={onCerrar}
            className="w-full rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cerrar
          </button>
          <p className="mt-2 text-xs text-gray-400">
            La reimpresión sale con la hora de ahora, así cocina sabe que es una segunda copia.
          </p>
        </>
      )}
    </Modal>
  );
}

function ChipGrupo({
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
        'rounded-full border px-3 py-1 text-xs font-medium',
        activo
          ? 'border-rodziny-500 bg-rodziny-50 text-rodziny-700'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  );
}

function Fila({ k, v, fuerte }: { k: string; v: string; fuerte?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{k}</dt>
      <dd className={cn('text-gray-900', fuerte && 'font-semibold')}>{v}</dd>
    </div>
  );
}

// ── Cobro ────────────────────────────────────────────────────────────────────

function ModalCobro({
  total,
  onCancelar,
  onConfirmar,
}: {
  total: number;
  onCancelar: () => void;
  onConfirmar: (
    pagos: PagoVenta[],
    queImprimir: 'comanda' | 'ticket' | null,
  ) => Promise<void>;
}) {
  const mediosQ = useMediosPagoCaja();
  const [pagos, setPagos] = useState<PagoVenta[]>([]);
  const [monto, setMonto] = useState('');
  const [vuelto, setVuelto] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pagado = pagos.reduce((s, p) => s + p.monto, 0);
  const restante = Math.round((total - pagado) * 100) / 100;
  // Vacío = "cobrame todo lo que falta", que es el caso de siempre.
  const montoTipeado = monto.trim() === '' ? restante : Number(monto) || 0;

  /**
   * Un solo campo resuelve los dos casos de la caja:
   *  · pone MENOS que lo que falta  → paga esa parte con ese medio y queda el
   *    resto para cobrar con otro (te pagan $10.000 en efectivo y el resto QR);
   *  · pone MÁS y es efectivo       → se cobra lo que falta y la diferencia es
   *    vuelto, no plata de la empresa.
   */
  function agregarPago(medio: MedioPagoCaja) {
    if (restante <= 0) return;
    const aCobrar = Math.min(montoTipeado, restante);
    if (aCobrar <= 0) return;
    setPagos((prev) => [...prev, { medio, monto: aCobrar }]);
    setVuelto(medio.es_efectivo ? Math.max(0, montoTipeado - restante) : 0);
    setMonto('');
  }

  async function confirmar(queImprimir: 'comanda' | 'ticket' | null) {
    setGuardando(true);
    setError(null);
    try {
      await onConfirmar(pagos, queImprimir);
    } catch (e) {
      setError((e as Error).message);
      setGuardando(false);
    }
  }

  const listo = restante <= 0 && pagos.length > 0 && !guardando;

  return (
    <Modal titulo={`Cobrar ${pesos(total)}`} onCerrar={onCancelar}>
      {mediosQ.isLoading ? (
        <p className="text-sm text-gray-500">Cargando medios de pago…</p>
      ) : (
        <>
          {/* Primero el monto, después el medio: así se puede dividir la cuenta */}
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Monto — dejalo vacío para cobrar todo lo que falta
            </label>
            <input
              type="number"
              inputMode="numeric"
              autoFocus
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder={String(restante)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-lg font-semibold"
            />
            <p className="mt-1 text-xs text-gray-500">
              Si ponés menos, cobra esa parte y queda el resto para otro medio. Si ponés más y es
              efectivo, calcula el vuelto.
            </p>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            {(mediosQ.data ?? []).map((m) => (
              <button
                key={m.id}
                disabled={restante <= 0}
                onClick={() => agregarPago(m)}
                className="rounded border border-gray-300 px-3 py-2.5 text-sm hover:border-rodziny-500 hover:bg-rodziny-50 disabled:opacity-40"
              >
                {m.nombre}
                {montoTipeado < restante && restante > 0 && (
                  <span className="ml-1 text-xs text-gray-500">{pesos(montoTipeado)}</span>
                )}
              </button>
            ))}
          </div>

          {vuelto > 0 && (
            <div className="mb-3 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              Vuelto: <strong>{pesos(vuelto)}</strong>
            </div>
          )}

          {pagos.length > 0 && (
            <div className="mb-3 space-y-1 rounded bg-gray-50 p-2">
              {pagos.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{p.medio.nombre}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{pesos(p.monto)}</span>
                    <button
                      onClick={() => setPagos((prev) => prev.filter((_, j) => j !== i))}
                      className="text-xs text-gray-400 hover:text-red-600"
                    >
                      quitar
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mb-4 flex justify-between border-t border-gray-200 pt-3 text-sm">
            <span className="text-gray-600">Falta cobrar</span>
            <span className={cn('font-semibold', restante > 0 ? 'text-amber-700' : 'text-green-700')}>
              {pesos(restante)}
            </span>
          </div>

          {error && (
            <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="mb-2 grid grid-cols-2 gap-2">
            <button
              disabled={!listo}
              onClick={() => confirmar('comanda')}
              className="rounded bg-rodziny-700 px-3 py-2 text-sm font-medium text-white hover:bg-rodziny-800 disabled:opacity-40"
            >
              Cobrar e imprimir comanda
            </button>
            <button
              disabled={!listo}
              onClick={() => confirmar('ticket')}
              className="rounded border border-rodziny-600 px-3 py-2 text-sm font-medium text-rodziny-700 hover:bg-rodziny-50 disabled:opacity-40"
            >
              Cobrar e imprimir ticket
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancelar}
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Volver
            </button>
            <button
              disabled={!listo}
              onClick={() => confirmar(null)}
              className="flex-1 rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              {guardando ? 'Guardando…' : 'Cobrar sin imprimir'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Cierre ───────────────────────────────────────────────────────────────────

function ModalCierre({
  turnoId,
  fondoApertura,
  totales,
  onCancelar,
  onCerrado,
}: {
  turnoId: string;
  fondoApertura: number;
  totales: { efectivo: number; porMedio: Map<string, number> };
  onCancelar: () => void;
  onCerrado: () => void;
}) {
  const cerrar = useCerrarTurno();
  const [contado, setContado] = useState('');
  const [retiroCambio, setRetiroCambio] = useState('');
  const [retiroPagos, setRetiroPagos] = useState('');
  const [retiroNota, setRetiroNota] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cambio = Number(retiroCambio) || 0;
  const pagos = Number(retiroPagos) || 0;
  const retiros = cambio + pagos;
  const esperado = efectivoEsperadoEnCaja({
    fondoApertura,
    efectivoCobrado: totales.efectivo,
    retiros,
  });
  const diferencia = (Number(contado) || 0) - esperado;
  const porMedio = (n: string) => totales.porMedio.get(n) ?? 0;

  return (
    <Modal titulo="Cerrar el arqueo" onCerrar={onCancelar}>
      <dl className="mb-4 space-y-1 text-sm">
        <Fila k="Fondo inicial" v={pesos(fondoApertura)} />
        <Fila k="Cobrado en efectivo" v={pesos(totales.efectivo)} />
        {retiros > 0 && <Fila k="Retiros del turno" v={`− ${pesos(retiros)}`} />}
        <Fila k="Tiene que haber en caja" v={pesos(esperado)} fuerte />
      </dl>

      {/* Los retiros restan del arqueo: esa plata salió del cajón durante el
          turno. Sin cargarlos, cada retiro aparecería como un faltante. */}
      <p className="mb-2 text-sm font-medium text-gray-700">
        ¿Sacaste plata del cajón durante el turno?
      </p>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-gray-600">Para cambio</label>
          <input
            type="number"
            inputMode="numeric"
            value={retiroCambio}
            onChange={(e) => setRetiroCambio(e.target.value)}
            placeholder="0"
            className="w-full rounded border border-gray-300 px-3 py-2 text-base"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-600">Para pagar algo</label>
          <input
            type="number"
            inputMode="numeric"
            value={retiroPagos}
            onChange={(e) => setRetiroPagos(e.target.value)}
            placeholder="0"
            className="w-full rounded border border-gray-300 px-3 py-2 text-base"
          />
        </div>
      </div>
      {retiros > 0 && (
        <input
          value={retiroNota}
          onChange={(e) => setRetiroNota(e.target.value)}
          placeholder="¿En qué se fue? Ej: se le pagó al de la verdulería"
          className="mb-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      )}
      <p className="mb-4 text-xs text-gray-500">
        Si no sacaste nada, dejalos en cero.
      </p>

      <label className="mb-1 block text-sm font-medium text-gray-700">
        ¿Cuánto contaste en la caja?
      </label>
      <input
        type="number"
        inputMode="numeric"
        autoFocus
        value={contado}
        onChange={(e) => setContado(e.target.value)}
        placeholder="0"
        className="mb-2 w-full rounded border border-gray-300 px-3 py-2 text-lg"
      />

      {contado !== '' && (
        <div
          className={cn(
            'mb-3 rounded px-3 py-2 text-sm',
            Math.abs(diferencia) < 1
              ? 'bg-green-50 text-green-800'
              : diferencia > 0
                ? 'bg-blue-50 text-blue-800'
                : 'bg-red-50 text-red-800',
          )}
        >
          {Math.abs(diferencia) < 1
            ? 'Cuadra exacto.'
            : diferencia > 0
              ? `Sobran ${pesos(diferencia)}.`
              : `Faltan ${pesos(Math.abs(diferencia))}.`}
        </div>
      )}

      <label className="mb-1 block text-sm font-medium text-gray-700">Nota (opcional)</label>
      <input
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Ej: se sacaron $5.000 para cambio"
        className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />

      {error && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onCancelar}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Volver
        </button>
        <button
          disabled={contado === '' || cerrar.isPending}
          onClick={async () => {
            setError(null);
            try {
              await cerrar.mutateAsync({
                turnoId,
                montoContado: Number(contado) || 0,
                montoEsperado: esperado,
                efectivoDelTurno: totales.efectivo,
                retiroCambio: cambio,
                retiroPagos: pagos,
                retiroNota: retiroNota.trim() || null,
                qr: porMedio('Código QR'),
                debito: porMedio('Tarjeta de débito'),
                credito: porMedio('Tarjeta de crédito'),
                transferencia: porMedio('Transferencia'),
                mpLucas: porMedio('Mercado Pago Lucas'),
                horaCierre: ahoraAR().hora,
                nota: nota.trim() || null,
              });
              onCerrado();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          className="flex-1 rounded bg-rodziny-700 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-800 disabled:opacity-40"
        >
          {cerrar.isPending ? 'Cerrando…' : 'Cerrar el arqueo'}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Al cerrar, el arqueo queda cargado en Finanzas → Cierre de Caja para que administración lo
        controle y marque la plata como recibida.
      </p>
    </Modal>
  );
}

// ── Modal genérico ───────────────────────────────────────────────────────────

function Modal({
  titulo,
  onCerrar,
  children,
}: {
  titulo: string;
  onCerrar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCerrar}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold text-gray-900">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}
