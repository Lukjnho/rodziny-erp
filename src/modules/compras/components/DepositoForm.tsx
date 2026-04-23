import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface Producto {
  id: string;
  nombre: string;
  unidad: string;
  categoria: string;
  stock_actual: number;
}

export function DepositoForm({ local }: { local: 'vedia' | 'saavedra' }) {
  const [busqueda, setBusqueda] = useState('');
  const [seleccionado, setSeleccionado] = useState<Producto | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('Consumo producción');
  const [obs, setObs] = useState('');
  const [registradoPor, setRegistradoPor] = useState('');
  const [exito, setExito] = useState(false);
  const qc = useQueryClient();

  // ── productos del local ────────────────────────────────────────────────────
  const { data: productos } = useQuery({
    queryKey: ['productos_activos', local],
    queryFn: async () => {
      const { data } = await supabase
        .from('productos')
        .select('id, nombre, unidad, categoria, stock_actual')
        .eq('local', local)
        .eq('activo', true)
        .order('nombre');
      return (data ?? []) as Producto[];
    },
  });

  // ── filtrar por búsqueda ───────────────────────────────────────────────────
  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return productos ?? [];
    const b = busqueda
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return (productos ?? []).filter((p) => {
      const n = p.nombre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return n.includes(b) || p.categoria.toLowerCase().includes(b);
    });
  }, [productos, busqueda]);

  // ── registrar movimiento ───────────────────────────────────────────────────
  const registrarMut = useMutation({
    mutationFn: async () => {
      if (!seleccionado || !cantidad) throw new Error('Faltan datos');
      const cant = parseFloat(cantidad.replace(',', '.'));
      if (!cant || cant <= 0) throw new Error('Cantidad inválida');

      // Insertar movimiento
      const { error } = await supabase.from('movimientos_stock').insert({
        local,
        producto_id: seleccionado.id,
        producto_nombre: seleccionado.nombre,
        tipo: 'salida',
        cantidad: cant,
        unidad: seleccionado.unidad,
        motivo,
        observacion: obs || null,
        registrado_por: registradoPor || null,
      });
      if (error) throw error;

      // Actualizar stock
      await supabase
        .from('productos')
        .update({
          stock_actual: Math.max(0, seleccionado.stock_actual - cant),
          updated_at: new Date().toISOString(),
        })
        .eq('id', seleccionado.id);
    },
    onSuccess: () => {
      setExito(true);
      qc.invalidateQueries({ queryKey: ['productos_activos'] });
      qc.invalidateQueries({ queryKey: ['movimientos_stock'] });
      setTimeout(() => {
        setExito(false);
        setSeleccionado(null);
        setCantidad('');
        setObs('');
        setBusqueda('');
      }, 1500);
    },
  });

  // ── UI ─────────────────────────────────────────────────────────────────────
  // Si ya hay producto seleccionado → mostrar form de cantidad
  if (seleccionado) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-4">
        {exito ? (
          <div className="py-12 text-center">
            <div className="mb-3 text-5xl">✅</div>
            <p className="text-lg font-semibold text-green-700">Registrado</p>
            <p className="text-sm text-gray-500">
              {cantidad} {seleccionado.unidad} de {seleccionado.nombre}
            </p>
          </div>
        ) : (
          <>
            {/* Producto seleccionado */}
            <div className="border-rodziny-200 rounded-lg border bg-rodziny-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{seleccionado.nombre}</p>
                  <p className="text-xs text-gray-500">
                    {seleccionado.categoria} · Stock: {seleccionado.stock_actual}{' '}
                    {seleccionado.unidad}
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

            {/* Cantidad */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Cantidad ({seleccionado.unidad})
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-lg font-medium focus:border-rodziny-500 focus:outline-none"
                autoFocus
              />
            </div>

            {/* Motivo */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Motivo</label>
              <select
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-rodziny-500 focus:outline-none"
              >
                <option>Consumo producción</option>
                <option>Producto terminado perdido</option>
                <option>Merma</option>
                <option>Otro</option>
              </select>
            </div>

            {/* Quién */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Registrado por</label>
              <input
                type="text"
                value={registradoPor}
                onChange={(e) => setRegistradoPor(e.target.value)}
                placeholder="Tu nombre"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-rodziny-500 focus:outline-none"
              />
            </div>

            {/* Observación */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Observación (opcional)
              </label>
              <input
                type="text"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Ej: Producción de relleno"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-rodziny-500 focus:outline-none"
              />
            </div>

            {/* Botón */}
            <button
              onClick={() => registrarMut.mutate()}
              disabled={registrarMut.isPending || !cantidad}
              className="w-full rounded-lg bg-rodziny-800 py-3 text-base font-semibold text-white transition-colors hover:bg-rodziny-700 disabled:opacity-50"
            >
              {registrarMut.isPending
                ? 'Guardando...'
                : `Registrar salida de ${cantidad || '0'} ${seleccionado.unidad}`}
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

  // ── Lista de productos para seleccionar ────────────────────────────────────
  return (
    <div className="mx-auto max-w-md space-y-3 p-4">
      <div className="mb-2 text-center">
        <h2 className="text-lg font-bold text-gray-900">Salida de depósito</h2>
        <p className="text-xs text-gray-500">
          {local === 'vedia' ? 'Rodziny Vedia' : 'Rodziny Saavedra'}
        </p>
      </div>

      {/* Búsqueda */}
      <input
        type="text"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="🔍 Buscar producto..."
        className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-base focus:border-rodziny-500 focus:outline-none"
        autoFocus
      />

      {/* Lista */}
      <div className="max-h-[60vh] space-y-1 overflow-y-auto">
        {filtrados.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            {busqueda ? 'No se encontró el producto' : 'No hay productos cargados'}
          </p>
        ) : (
          filtrados.map((p) => (
            <button
              key={p.id}
              onClick={() => setSeleccionado(p)}
              className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{p.nombre}</p>
                <p className="text-xs text-gray-500">{p.categoria}</p>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    'text-sm font-medium',
                    p.stock_actual <= 0 ? 'text-red-600' : 'text-gray-700',
                  )}
                >
                  {p.stock_actual} {p.unidad}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
