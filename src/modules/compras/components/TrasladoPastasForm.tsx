import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface PastaRow {
  id: string;
  nombre: string;
  codigo: string;
  stockCamara: number;
}

export function TrasladoPastasForm({ local }: { local: 'vedia' | 'saavedra' }) {
  const [busqueda, setBusqueda] = useState('');
  const [seleccionado, setSeleccionado] = useState<PastaRow | null>(null);
  const [porciones, setPorciones] = useState('');
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [exito, setExito] = useState(false);
  const qc = useQueryClient();

  const { data: productos } = useQuery({
    queryKey: ['qr-traslado-productos', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('id, nombre, codigo, local')
        .eq('tipo', 'pasta')
        .eq('activo', true)
        .eq('local', local)
        .order('nombre');
      if (error) throw error;
      return data as Array<{ id: string; nombre: string; codigo: string; local: string }>;
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

  const registrarMut = useMutation({
    mutationFn: async () => {
      if (!seleccionado || !porciones) throw new Error('Faltan datos');
      const cant = parseInt(porciones, 10);
      if (!cant || cant <= 0) throw new Error('Cantidad inválida');
      if (cant > seleccionado.stockCamara) {
        throw new Error(`Solo hay ${seleccionado.stockCamara} porciones en cámara`);
      }

      const hoy = new Date();
      const fecha = hoy.toISOString().slice(0, 10);
      const hora = hoy.toTimeString().slice(0, 8);

      const { error } = await supabase.from('cocina_traspasos').insert({
        producto_id: seleccionado.id,
        local,
        fecha,
        hora,
        porciones: cant,
        responsable: responsable || null,
        notas: notas || null,
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
        setPorciones('');
        setNotas('');
        setBusqueda('');
      }, 1500);
    },
  });

  if (seleccionado) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-4">
        {exito ? (
          <div className="py-12 text-center">
            <div className="mb-3 text-5xl">📦</div>
            <p className="text-lg font-semibold text-green-700">Traslado registrado</p>
            <p className="text-sm text-gray-500">
              {porciones} porciones de {seleccionado.nombre}
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
                value={porciones}
                onChange={(e) => setPorciones(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-lg font-medium focus:border-rodziny-500 focus:outline-none"
                autoFocus
              />
              <p className="mt-1 text-[11px] text-gray-400">
                Tip: si movés un cajón completo, cargá la cantidad total de porciones del cajón.
              </p>
            </div>

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
                placeholder="Ej: cajón 2 del día"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-rodziny-500 focus:outline-none"
              />
            </div>

            <button
              onClick={() => registrarMut.mutate()}
              disabled={registrarMut.isPending || !porciones}
              className="w-full rounded-lg bg-rodziny-800 py-3 text-base font-semibold text-white transition-colors hover:bg-rodziny-700 disabled:opacity-50"
            >
              {registrarMut.isPending
                ? 'Guardando...'
                : `Trasladar ${porciones || '0'} porciones al mostrador`}
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
                    {r.stockCamara} porc.
                  </p>
                  <p className="text-[10px] text-gray-400">en cámara</p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
