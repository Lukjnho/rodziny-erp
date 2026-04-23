import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { KPICard } from '@/components/ui/KPICard';

interface Producto {
  id: string;
  nombre: string;
  codigo: string;
}
interface LoteStock {
  producto_id: string;
  porciones: number | null;
  local: string;
}
interface MovStock {
  producto_id: string;
  porciones: number;
  local: string;
}
type StockMap = Map<string, number>; // key = `${producto_id}|${local}`

function stockKey(productoId: string, local: string) {
  return `${productoId}|${local}`;
}
interface Traspaso {
  id: string;
  producto_id: string;
  fecha: string;
  hora: string | null;
  porciones: number;
  responsable: string | null;
  local: string;
  notas: string | null;
  created_at: string;
  producto?: { nombre: string } | null;
}
interface MermaRow {
  id: string;
  producto_id: string;
  fecha: string;
  porciones: number;
  motivo: string | null;
  responsable: string | null;
  local: string;
  notas: string | null;
  created_at: string;
  producto?: { nombre: string } | null;
}

type FiltroLocal = 'todos' | 'vedia' | 'saavedra';

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

export function TraspasosTab() {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(hoy());
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos');
  const [modalTraspaso, setModalTraspaso] = useState(false);
  const [modalMerma, setModalMerma] = useState(false);
  const [seccionMerma, setSeccionMerma] = useState(false);

  const { data: productos } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as Producto[];
    },
  });

  const { data: lotesCamara } = useQuery({
    queryKey: ['cocina-stock-lotes', 'camara'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('producto_id, porciones, local')
        .eq('ubicacion', 'camara_congelado');
      if (error) throw error;
      return data as LoteStock[];
    },
  });

  const { data: traspasosTotales } = useQuery({
    queryKey: ['cocina-stock-traspasos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('producto_id, porciones, local');
      if (error) throw error;
      return data as MovStock[];
    },
  });

  const { data: mermasTotales } = useQuery({
    queryKey: ['cocina-stock-merma'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('producto_id, porciones, local');
      if (error) throw error;
      return data as MovStock[];
    },
  });

  // Stock disponible por producto × local: cámara − traspasos − merma
  const stockDisponible = useMemo<StockMap>(() => {
    const map: StockMap = new Map();
    if (!lotesCamara || !traspasosTotales || !mermasTotales) return map;
    for (const l of lotesCamara) {
      const k = stockKey(l.producto_id, l.local);
      map.set(k, (map.get(k) ?? 0) + (l.porciones ?? 0));
    }
    for (const t of traspasosTotales) {
      const k = stockKey(t.producto_id, t.local);
      map.set(k, (map.get(k) ?? 0) - t.porciones);
    }
    for (const m of mermasTotales) {
      const k = stockKey(m.producto_id, m.local);
      map.set(k, (map.get(k) ?? 0) - m.porciones);
    }
    return map;
  }, [lotesCamara, traspasosTotales, mermasTotales]);

  const { data: traspasos, isLoading: cargandoT } = useQuery({
    queryKey: ['cocina-traspasos', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('*, producto:cocina_productos(nombre)')
        .eq('fecha', fecha)
        .order('hora', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as Traspaso[];
    },
  });

  const { data: mermas, isLoading: cargandoM } = useQuery({
    queryKey: ['cocina-merma', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('*, producto:cocina_productos(nombre)')
        .eq('fecha', fecha)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as MermaRow[];
    },
  });

  const traspasosFiltrados = useMemo(() => {
    if (filtroLocal === 'todos') return traspasos ?? [];
    return (traspasos ?? []).filter((t) => t.local === filtroLocal);
  }, [traspasos, filtroLocal]);

  const mermasFiltradas = useMemo(() => {
    if (filtroLocal === 'todos') return mermas ?? [];
    return (mermas ?? []).filter((m) => m.local === filtroLocal);
  }, [mermas, filtroLocal]);

  const kpis = useMemo(
    () => ({
      traspasos: traspasosFiltrados.length,
      porcionesTraspasadas: traspasosFiltrados.reduce((s, t) => s + t.porciones, 0),
      mermas: mermasFiltradas.length,
      porcionesMerma: mermasFiltradas.reduce((s, m) => s + m.porciones, 0),
    }),
    [traspasosFiltrados, mermasFiltradas],
  );

  const cambiarFecha = (delta: number) => {
    const d = new Date(fecha + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setFecha(d.toISOString().slice(0, 10));
  };

  const eliminarTraspaso = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_traspasos').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-traspasos', fecha] });
      qc.invalidateQueries({ queryKey: ['cocina-stock'] });
      qc.invalidateQueries({ queryKey: ['cocina-stock-traspasos'] });
      qc.invalidateQueries({ queryKey: ['cocina-stock-traspasos-hoy'] });
    },
  });

  const eliminarMerma = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cocina_merma').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-merma', fecha] });
      qc.invalidateQueries({ queryKey: ['cocina-stock'] });
      qc.invalidateQueries({ queryKey: ['cocina-stock-merma'] });
      qc.invalidateQueries({ queryKey: ['cocina-stock-merma-hoy'] });
    },
  });

  const fechaLabel = new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-white p-3">
        <button
          onClick={() => cambiarFecha(-1)}
          className="rounded px-2 py-1 text-lg hover:bg-gray-100"
        >
          ‹
        </button>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => cambiarFecha(1)}
          className="rounded px-2 py-1 text-lg hover:bg-gray-100"
        >
          ›
        </button>
        <span className="text-sm capitalize text-gray-500">{fechaLabel}</span>
        {fecha !== hoy() && (
          <button
            onClick={() => setFecha(hoy())}
            className="text-xs text-rodziny-700 hover:underline"
          >
            Hoy
          </button>
        )}
        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
          className="ml-auto rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
      </div>

      {/* KPIs — los de merma abren la sección colapsada */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPICard
          label="Traspasos hoy"
          value={String(kpis.traspasos)}
          color="blue"
          loading={cargandoT}
        />
        <KPICard
          label="Porciones traspasadas"
          value={String(kpis.porcionesTraspasadas)}
          color="green"
          loading={cargandoT}
        />
        <KPICard
          label="Mermas hoy"
          value={String(kpis.mermas)}
          color="red"
          loading={cargandoM}
          active={seccionMerma}
          onClick={() => setSeccionMerma(!seccionMerma)}
        />
        <KPICard
          label="Porciones merma"
          value={String(kpis.porcionesMerma)}
          color="red"
          loading={cargandoM}
          active={seccionMerma}
          onClick={() => setSeccionMerma(!seccionMerma)}
        />
      </div>

      {/* ── Traspasos ──────────────────────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">Traspasos depósito → mostrador</h3>
          <button
            onClick={() => setModalTraspaso(true)}
            className="rounded bg-rodziny-700 px-3 py-1.5 text-sm text-white hover:bg-rodziny-800"
          >
            + Nuevo traspaso
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-gray-50 text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-2">Hora</th>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Porciones</th>
                <th className="px-4 py-2">Local</th>
                <th className="px-4 py-2">Responsable</th>
                <th className="px-4 py-2">Notas</th>
                <th className="px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {traspasosFiltrados.map((t) => (
                <tr key={t.id} className="border-b border-surface-border hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{t.hora?.slice(0, 5) || '—'}</td>
                  <td className="px-4 py-2 font-medium">{t.producto?.nombre ?? '—'}</td>
                  <td className="px-4 py-2 font-semibold">{t.porciones}</td>
                  <td className="px-4 py-2 capitalize">{t.local}</td>
                  <td className="px-4 py-2">{t.responsable || '—'}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-gray-500">{t.notas || '—'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => {
                        if (window.confirm('¿Eliminar este traspaso?'))
                          eliminarTraspaso.mutate(t.id);
                      }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {traspasosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                    {cargandoT ? 'Cargando...' : 'No hay traspasos hoy'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Merma (colapsable) ─────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => setSeccionMerma(!seccionMerma)}
          className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-800"
        >
          <span className="text-xs">{seccionMerma ? '▼' : '▶'}</span>
          Merma / Descarte
          {kpis.mermas > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
              {kpis.mermas}
            </span>
          )}
        </button>

        {seccionMerma && (
          <div>
            <div className="mb-2 flex justify-end">
              <button
                onClick={() => setModalMerma(true)}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                + Registrar merma
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-4 py-2">Producto</th>
                    <th className="px-4 py-2">Porciones</th>
                    <th className="px-4 py-2">Motivo</th>
                    <th className="px-4 py-2">Local</th>
                    <th className="px-4 py-2">Responsable</th>
                    <th className="px-4 py-2">Notas</th>
                    <th className="px-4 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {mermasFiltradas.map((m) => (
                    <tr key={m.id} className="border-b border-surface-border hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{m.producto?.nombre ?? '—'}</td>
                      <td className="px-4 py-2 font-semibold text-red-600">{m.porciones}</td>
                      <td className="px-4 py-2 capitalize">{m.motivo || '—'}</td>
                      <td className="px-4 py-2 capitalize">{m.local}</td>
                      <td className="px-4 py-2">{m.responsable || '—'}</td>
                      <td className="max-w-xs truncate px-4 py-2 text-gray-500">
                        {m.notas || '—'}
                      </td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => {
                            if (window.confirm('¿Eliminar esta merma?')) eliminarMerma.mutate(m.id);
                          }}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {mermasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                        {cargandoM ? 'Cargando...' : 'No hay merma registrada hoy'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modales */}
      {modalTraspaso && (
        <ModalTraspaso
          fecha={fecha}
          productos={productos ?? []}
          stockDisponible={stockDisponible}
          onClose={() => setModalTraspaso(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-traspasos', fecha] });
            qc.invalidateQueries({ queryKey: ['cocina-stock'] });
            qc.invalidateQueries({ queryKey: ['cocina-stock-lotes', 'camara'] });
            qc.invalidateQueries({ queryKey: ['cocina-stock-traspasos'] });
            qc.invalidateQueries({ queryKey: ['cocina-stock-traspasos-hoy'] });
            setModalTraspaso(false);
          }}
        />
      )}
      {modalMerma && (
        <ModalMerma
          fecha={fecha}
          productos={productos ?? []}
          onClose={() => setModalMerma(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['cocina-merma', fecha] });
            qc.invalidateQueries({ queryKey: ['cocina-stock'] });
            qc.invalidateQueries({ queryKey: ['cocina-stock-merma'] });
            qc.invalidateQueries({ queryKey: ['cocina-stock-merma-hoy'] });
            setModalMerma(false);
          }}
        />
      )}
    </div>
  );
}

// ── Modal: Nuevo traspaso ─────────────────────────────────────────────────────

function ModalTraspaso({
  fecha,
  productos,
  stockDisponible,
  onClose,
  onSaved,
}: {
  fecha: string;
  productos: Producto[];
  stockDisponible: StockMap;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia');
  const [productoId, setProductoId] = useState('');
  const [porciones, setPorciones] = useState('');
  const [hora, setHora] = useState(
    new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
  );
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Productos con stock disponible > 0 en el local seleccionado (sólo los que se enviaron a cámara
  // desde "Cargar pastas" y todavía no fueron traspasados ni descartados por merma)
  const productosDisponibles = useMemo(() => {
    return productos
      .map((p) => ({ ...p, stock: stockDisponible.get(stockKey(p.id, local)) ?? 0 }))
      .filter((p) => p.stock > 0);
  }, [productos, stockDisponible, local]);

  // Si cambia el local y el producto elegido ya no está disponible, reseteo la selección
  useEffect(() => {
    if (productosDisponibles.length === 0) {
      if (productoId !== '') setProductoId('');
      return;
    }
    if (!productosDisponibles.find((p) => p.id === productoId)) {
      setProductoId(productosDisponibles[0].id);
    }
  }, [local, productosDisponibles, productoId]);

  const stockProducto = productoId
    ? (stockDisponible.get(stockKey(productoId, local)) ?? 0)
    : 0;

  const guardar = async () => {
    if (!productoId || !porciones) {
      setError('Producto y porciones son obligatorios');
      return;
    }
    const porcionesNum = Number(porciones);
    if (!Number.isFinite(porcionesNum) || porcionesNum <= 0) {
      setError('Las porciones deben ser un número mayor a 0');
      return;
    }
    if (porcionesNum > stockProducto) {
      setError(`Máximo disponible en ${local}: ${stockProducto} porciones`);
      return;
    }
    setGuardando(true);
    setError('');
    const { error: err } = await supabase.from('cocina_traspasos').insert({
      producto_id: productoId,
      fecha,
      hora: hora || null,
      porciones: porcionesNum,
      responsable: responsable.trim() || null,
      local,
      notas: notas.trim() || null,
    });
    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onSaved();
  };

  const sinDisponibles = productosDisponibles.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-bold text-gray-800">Nuevo traspaso</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Local</label>
            <select
              value={local}
              onChange={(e) => setLocal(e.target.value as 'vedia' | 'saavedra')}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="vedia">Vedia</option>
              <option value="saavedra">Saavedra</option>
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label className="block text-xs text-gray-500">Producto</label>
              {productoId && !sinDisponibles && (
                <span className="text-xs text-gray-500">
                  Disponible: <span className="font-semibold text-rodziny-700">{stockProducto}</span>
                </span>
              )}
            </div>
            {sinDisponibles ? (
              <div className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                No hay productos en la cámara de <span className="font-semibold capitalize">{local}</span>.
                Producilos primero en el tab <span className="font-semibold">Producción</span> y enviá el
                lote a cámara.
              </div>
            ) : (
              <select
                value={productoId}
                onChange={(e) => setProductoId(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                {productosDisponibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} · {p.stock} disp.
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Porciones</label>
              <input
                type="number"
                min={1}
                max={stockProducto || undefined}
                value={porciones}
                onChange={(e) => setPorciones(e.target.value)}
                disabled={sinDisponibles}
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-50"
                placeholder={stockProducto ? `hasta ${stockProducto}` : '—'}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Hora</label>
              <input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Responsable</label>
            <input
              value={responsable}
              onChange={(e) => setResponsable(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Notas</label>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || sinDisponibles}
            className="rounded bg-rodziny-700 px-4 py-1.5 text-sm text-white hover:bg-rodziny-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Registrar merma ────────────────────────────────────────────────────

function ModalMerma({
  fecha,
  productos,
  onClose,
  onSaved,
}: {
  fecha: string;
  productos: Producto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [productoId, setProductoId] = useState(productos[0]?.id ?? '');
  const [porciones, setPorciones] = useState('');
  const [motivo, setMotivo] = useState<'rotura' | 'vencido' | 'otro'>('rotura');
  const [responsable, setResponsable] = useState('');
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const guardar = async () => {
    if (!productoId || !porciones) {
      setError('Producto y porciones son obligatorios');
      return;
    }
    const porcionesNum = Number(porciones);
    if (!Number.isFinite(porcionesNum) || porcionesNum <= 0) {
      setError('Las porciones deben ser un número mayor a 0');
      return;
    }
    setGuardando(true);
    setError('');
    const { error: err } = await supabase.from('cocina_merma').insert({
      producto_id: productoId,
      fecha,
      porciones: porcionesNum,
      motivo,
      responsable: responsable.trim() || null,
      local,
      notas: notas.trim() || null,
    });
    if (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-bold text-gray-800">Registrar merma</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Producto</label>
            <select
              value={productoId}
              onChange={(e) => setProductoId(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Porciones</label>
              <input
                type="number"
                value={porciones}
                onChange={(e) => setPorciones(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Motivo</label>
              <select
                value={motivo}
                onChange={(e) => setMotivo(e.target.value as 'rotura' | 'vencido' | 'otro')}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="rotura">Rotura</option>
                <option value="vencido">Vencido</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">Responsable</label>
              <input
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Local</label>
              <select
                value={local}
                onChange={(e) => setLocal(e.target.value as 'vedia' | 'saavedra')}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="vedia">Vedia</option>
                <option value="saavedra">Saavedra</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Notas</label>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded bg-red-600 px-4 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Registrar merma'}
          </button>
        </div>
      </div>
    </div>
  );
}
