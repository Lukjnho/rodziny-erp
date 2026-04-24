import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface PastaRow {
  id: string;
  nombre: string;
  codigo: string;
  porcionesPorCajon: number | null;
  stockCamara: number;
}

export function TrasladoPastasForm({ local }: { local: 'vedia' | 'saavedra' }) {
  const [busqueda, setBusqueda] = useState('');
  const [seleccionado, setSeleccionado] = useState<PastaRow | null>(null);
  const [cajones, setCajones] = useState('');
  const [porcionesManuales, setPorcionesManuales] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [exito, setExito] = useState(false);
  const qc = useQueryClient();

  const { data: productos } = useQuery({
    queryKey: ['qr-traslado-productos', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, local, porciones_por_cajon')
        .eq('tipo', 'pasta')
        .eq('activo', true)
        .eq('local', local)
        .order('nombre');
      if (error) throw error;
      return data as Array<{
        id: string;
        nombre: string;
        codigo: string;
        local: string;
        porciones_por_cajon: number | null;
      }>;
    },
  });

  const { data: lotes } = useQuery({
    queryKey: ['qr-traslado-lotes', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('producto_id, porciones, ubicacion')
        .eq('local', local)
        .eq('ubicacion', 'camara_congelado');
      if (error) throw error;
      return data as Array<{ producto_id: string; porciones: number | null; ubicacion: string }>;
    },
  });

  const { data: traspasos } = useQuery({
    queryKey: ['qr-traslado-traspasos', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('producto_id, porciones')
        .eq('local', local);
      if (error) throw error;
      return data as Array<{ producto_id: string; porciones: number }>;
    },
  });

  const { data: mermas } = useQuery({
    queryKey: ['qr-traslado-mermas', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('producto_id, porciones')
        .eq('local', local);
      if (error) throw error;
      return data as Array<{ producto_id: string; porciones: number }>;
    },
  });

  const rows = useMemo<PastaRow[]>(() => {
    if (!productos) return [];
    return productos.map((p) => {
      const enCamara = (lotes ?? [])
        .filter((l) => l.producto_id === p.id)
        .reduce((s, l) => s + (l.porciones ?? 0), 0);
      const traspasado = (traspasos ?? [])
        .filter((t) => t.producto_id === p.id)
        .reduce((s, t) => s + t.porciones, 0);
      const merma = (mermas ?? [])
        .filter((m) => m.producto_id === p.id)
        .reduce((s, m) => s + m.porciones, 0);
      return {
        id: p.id,
        nombre: p.nombre,
        codigo: p.codigo,
        porcionesPorCajon: p.porciones_por_cajon,
        stockCamara: enCamara - traspasado - merma,
      };
    });
  }, [productos, lotes, traspasos, mermas]);

  const filtradas = useMemo(() => {
    if (!busqueda.trim()) return rows;
    const q = busqueda
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    return rows.filter((r) =>
      (r.nombre + ' ' + r.codigo)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .includes(q),
    );
  }, [rows, busqueda]);

  // Porciones calculadas según modo (cajones × ppc  o  porciones manuales)
  const porcionesACargar = useMemo(() => {
    if (!seleccionado) return 0;
    if (seleccionado.porcionesPorCajon && cajones) {
      return Number(cajones) * seleccionado.porcionesPorCajon;
    }
    return porcionesManuales ? Number(porcionesManuales) : 0;
  }, [seleccionado, cajones, porcionesManuales]);

  const registrarMut = useMutation({
    mutationFn: async () => {
      if (!seleccionado) throw new Error('Elegí un producto');
      if (porcionesACargar <= 0) throw new Error('Cantidad inválida');
      if (porcionesACargar > seleccionado.stockCamara) {
        throw new Error(`Solo hay ${seleccionado.stockCamara} porciones en cámara`);
      }

      const hoy = new Date();
      const fecha = hoy.toISOString().slice(0, 10);
      const hora = hoy.toTimeString().slice(0, 8);

      const notasFinales =
        seleccionado.porcionesPorCajon && cajones
          ? `${cajones} caj × ${seleccionado.porcionesPorCajon} porc${notas ? ' — ' + notas : ''}`
          : notas || null;

      const { error } = await supabase.from('cocina_traspasos').insert({
        producto_id: seleccionado.id,
        local,
        fecha,
        hora,
        porciones: porcionesACargar,
        responsable: responsable || null,
        notas: notasFinales,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(true);
      qc.invalidateQueries({ queryKey: ['qr-traslado-traspasos'] });
      qc.invalidateQueries({ queryKey: ['compras-pastas-traspasos'] });
      setTimeout(() => {
        setExito(false);
        setSeleccionado(null);
        setCajones('');
        setPorcionesManuales('');
        setNotas('');
        setBusqueda('');
      }, 1500);
    },
  });

  if (seleccionado) {
    const porCajon = seleccionado.porcionesPorCajon;
    const cajonesMax = porCajon
      ? Math.floor(seleccionado.stockCamara / porCajon)
      : null;

    return (
      <div className="mx-auto max-w-md space-y-4 p-4">
        {exito ? (
          <div className="py-12 text-center">
            <div className="mb-3 text-5xl">📦</div>
            <p className="text-lg font-semibold text-green-700">Traslado registrado</p>
            <p className="text-sm text-gray-500">
              {porCajon && cajones
                ? `${cajones} cajón${Number(cajones) > 1 ? 'es' : ''} · ${porcionesACargar} porciones`
                : `${porcionesACargar} porciones`}{' '}
              de {seleccionado.nombre}
            </p>
          </div>
        ) : (
          <>
            <div className="border-rodziny-200 rounded-lg border bg-rodziny-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{seleccionado.nombre}</p>
                  <p className="text-xs text-gray-500">
                    {seleccionado.codigo} · En cámara:{' '}
                    <span
                      className={cn(
                        'font-semibold',
                        seleccionado.stockCamara > 0 ? 'text-gray-700' : 'text-red-600',
                      )}
                    >
                      {seleccionado.stockCamara} porc.
                      {porCajon && cajonesMax != null && cajonesMax > 0 && (
                        <> · {cajonesMax} cajón{cajonesMax > 1 ? 'es' : ''}</>
                      )}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => setSeleccionado(null)}
                  className="text-lg text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
            </div>

            {porCajon ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Cajones a trasladar al mostrador
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="1"
                  max={cajonesMax ?? undefined}
                  value={cajones}
                  onChange={(e) => setCajones(e.target.value)}
                  placeholder="1"
                  className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-lg font-medium focus:border-rodziny-500 focus:outline-none"
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-500">
                  1 cajón = {porCajon} porciones
                  {cajones && Number(cajones) > 0 && (
                    <span className="ml-2 font-semibold text-rodziny-700">
                      → {porcionesACargar} porciones
                    </span>
                  )}
                </p>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Porciones a trasladar al mostrador
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="1"
                  max={seleccionado.stockCamara}
                  value={porcionesManuales}
                  onChange={(e) => setPorcionesManuales(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-lg font-medium focus:border-rodziny-500 focus:outline-none"
                  autoFocus
                />
                <p className="mt-1 text-[11px] text-amber-600">
                  Tip: si configurás "porciones por cajón" desde Cocina → Productos, podés
                  cargar directamente en cajones.
                </p>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Registrado por
              </label>
              <input
                type="text"
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
                placeholder="Tu nombre"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-rodziny-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Notas (opcional)
              </label>
              <input
                type="text"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Ej: para turno noche"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-rodziny-500 focus:outline-none"
              />
            </div>

            <button
              onClick={() => registrarMut.mutate()}
              disabled={registrarMut.isPending || porcionesACargar <= 0}
              className="w-full rounded-lg bg-rodziny-800 py-3 text-base font-semibold text-white transition-colors hover:bg-rodziny-700 disabled:opacity-50"
            >
              {registrarMut.isPending
                ? 'Guardando...'
                : porCajon && cajones
                ? `Trasladar ${cajones} cajón${Number(cajones) > 1 ? 'es' : ''} (${porcionesACargar} porc.)`
                : `Trasladar ${porcionesACargar || 0} porciones`}
            </button>

            {registrarMut.isError && (
              <p className="text-center text-sm text-red-600">
                {(registrarMut.error as Error).message}
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-3 p-4">
      <div className="mb-2 text-center">
        <h2 className="text-lg font-bold text-gray-900">Traslado de pastas</h2>
        <p className="text-xs text-gray-500">Cámara de congelado → Freezer del mostrador</p>
      </div>

      <input
        type="text"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="🔍 Buscar pasta..."
        className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-base focus:border-rodziny-500 focus:outline-none"
        autoFocus
      />

      <div className="max-h-[60vh] space-y-1 overflow-y-auto">
        {filtradas.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            {busqueda ? 'No se encontró la pasta' : 'No hay pastas cargadas'}
          </p>
        ) : (
          filtradas.map((r) => {
            const sin = r.stockCamara <= 0;
            const cajonesDisp = r.porcionesPorCajon
              ? Math.floor(r.stockCamara / r.porcionesPorCajon)
              : null;
            return (
              <button
                key={r.id}
                onClick={() => !sin && setSeleccionado(r)}
                disabled={sin}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-colors',
                  sin
                    ? 'cursor-not-allowed opacity-50'
                    : 'hover:bg-gray-50 active:bg-gray-100',
                )}
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{r.nombre}</p>
                  <p className="font-mono text-[11px] text-gray-500">{r.codigo}</p>
                </div>
                <div className="text-right">
                  <p
                    className={cn(
                      'text-sm font-semibold',
                      sin ? 'text-red-600' : 'text-gray-700',
                    )}
                  >
                    {cajonesDisp != null ? (
                      <>
                        {cajonesDisp} cajón{cajonesDisp !== 1 ? 'es' : ''}
                      </>
                    ) : (
                      <>{r.stockCamara} porc.</>
                    )}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {cajonesDisp != null ? `${r.stockCamara} porc.` : 'en cámara'}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
