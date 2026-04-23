import { useState, useMemo, Component, type ReactNode, type ErrorInfo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';
import { cn } from '@/lib/utils';

// Error boundary para capturar crashes y mostrar el error en vez de pantalla blanca
class RecepcionErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RecepcionPage crash:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
          <div className="max-w-sm rounded-lg border border-red-200 bg-white p-6 text-center">
            <div className="mb-2 text-3xl">⚠️</div>
            <h2 className="mb-2 text-base font-semibold text-gray-900">Error en Recepción</h2>
            <p className="mb-3 break-all rounded bg-red-50 p-2 text-xs text-red-600">
              {this.state.error.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="rounded bg-rodziny-700 px-4 py-2 text-sm text-white"
            >
              Recargar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Producto {
  id: string;
  nombre: string;
  categoria: string | null;
  unidad: string;
  stock_actual: number;
  proveedor: string | null;
}

interface ItemCarrito {
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  unidad: string;
}

// PWA de recepción de mercadería
// URL: /recepcion?local=vedia  o  /recepcion?local=saavedra
export function RecepcionPage() {
  return (
    <RecepcionErrorBoundary>
      <RecepcionPageInner />
    </RecepcionErrorBoundary>
  );
}

function RecepcionPageInner() {
  const [params] = useSearchParams();
  const local = (params.get('local') === 'saavedra' ? 'saavedra' : 'vedia') as 'vedia' | 'saavedra';

  const [proveedor, setProveedor] = useState('');
  const [registradoPor, setRegistradoPor] = useState('');
  const [notas, setNotas] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [cantidadTemp, setCantidadTemp] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);

  function elegirFoto(file: File | null) {
    if (!file) {
      setFoto(null);
      setFotoPreview(null);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('La foto supera los 8MB');
      return;
    }
    setFoto(file);
    setFotoPreview(URL.createObjectURL(file));
  }

  const { data: productos } = useQuery({
    queryKey: ['productos_activos_recepcion', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('id, nombre, categoria, unidad, stock_actual, proveedor, activo')
        .eq('local', local)
        .not('activo', 'is', false)
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as Producto[];
    },
  });

  // Lista única de proveedores para el datalist
  const proveedores = useMemo(() => {
    const set = new Set<string>();
    productos?.forEach((p) => {
      if (p.proveedor) set.add(p.proveedor);
    });
    return Array.from(set).sort();
  }, [productos]);

  // Filtrado por búsqueda + proveedor seleccionado (si hay)
  const filtrados = useMemo(() => {
    if (!productos) return [];
    let lista = productos;
    if (proveedor.trim()) {
      const p = proveedor.toLowerCase();
      lista = lista.filter((x) => (x.proveedor ?? '').toLowerCase().includes(p));
    }
    if (busqueda.trim()) {
      const b = busqueda
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      lista = lista.filter((x) => {
        const n = (x.nombre ?? '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        return n.includes(b) || (x.categoria ?? '').toLowerCase().includes(b);
      });
    }
    return lista;
  }, [productos, proveedor, busqueda]);

  function agregarAlCarrito(p: Producto) {
    const cant = parseFloat((cantidadTemp[p.id] ?? '').replace(',', '.'));
    if (!cant || cant <= 0) {
      setError(`Ingresá la cantidad para ${p.nombre}`);
      return;
    }
    setError(null);
    setCarrito((prev) => {
      const existe = prev.find((i) => i.producto_id === p.id);
      if (existe) {
        return prev.map((i) =>
          i.producto_id === p.id ? { ...i, cantidad: i.cantidad + cant } : i,
        );
      }
      return [
        ...prev,
        { producto_id: p.id, producto_nombre: p.nombre, cantidad: cant, unidad: p.unidad },
      ];
    });
    setCantidadTemp((prev) => ({ ...prev, [p.id]: '' }));
  }

  function quitarDelCarrito(id: string) {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== id));
  }

  async function confirmar() {
    setError(null);
    if (carrito.length === 0) {
      setError('Agregá al menos un producto');
      return;
    }
    if (!registradoPor.trim()) {
      setError('Ingresá tu nombre');
      return;
    }
    if (!foto) {
      setError('Sacá una foto del remito o factura');
      return;
    }

    setGuardando(true);
    try {
      // 0) Subir foto del remito al bucket
      const ext = foto.name.split('.').pop()?.toLowerCase() || 'jpg';
      const fotoPath = `${local}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: errFoto } = await supabase.storage
        .from('recepciones-fotos')
        .upload(fotoPath, foto, { contentType: foto.type || 'image/jpeg' });
      if (errFoto) throw errFoto;

      // 1) Crear recepción pendiente
      const { error: errRecep } = await supabase.from('recepciones_pendientes').insert({
        local,
        proveedor: proveedor.trim() || null,
        items: carrito,
        registrado_por: registradoPor.trim(),
        notas: notas.trim() || null,
        foto_path: fotoPath,
      });
      if (errRecep) throw errRecep;

      // 2) Actualizar stock de cada producto
      for (const item of carrito) {
        const prod = productos?.find((p) => p.id === item.producto_id);
        if (!prod) continue;
        const nuevoStock = prod.stock_actual + item.cantidad;
        const { error: errStock } = await supabase
          .from('productos')
          .update({ stock_actual: nuevoStock, updated_at: new Date().toISOString() })
          .eq('id', prod.id);
        if (errStock) throw errStock;

        // 3) Registrar movimiento de entrada
        const { error: errMov } = await supabase.from('movimientos_stock').insert({
          local,
          producto_id: prod.id,
          producto_nombre: prod.nombre,
          tipo: 'entrada',
          cantidad: item.cantidad,
          unidad: prod.unidad,
          motivo: 'Recepción mercadería',
          observacion: proveedor ? `Proveedor: ${proveedor}` : null,
          registrado_por: registradoPor.trim(),
        });
        if (errMov) throw errMov;
      }

      setExito(true);
      setTimeout(() => {
        setExito(false);
        setCarrito([]);
        setProveedor('');
        setNotas('');
        setBusqueda('');
        setFoto(null);
        setFotoPreview(null);
      }, 2500);
    } catch (e: any) {
      setError(e.message || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  if (exito) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-sm rounded-xl bg-white p-8 text-center shadow-lg">
          <div className="mb-3 text-5xl">✅</div>
          <h2 className="mb-1 text-lg font-bold text-gray-900">Recepción registrada</h2>
          <p className="text-sm text-gray-500">
            El stock se actualizó. Martín va a validar los precios más adelante.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-rodziny-800 px-4 py-3 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-rodziny-600 text-xs font-bold">
              R
            </div>
            <span className="text-sm font-semibold">Rodziny · Recepción</span>
          </div>
          <span className="rounded bg-rodziny-600 px-2 py-0.5 text-xs">
            {local === 'vedia' ? 'Vedia' : 'Saavedra'}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-xl space-y-4 px-4 py-4">
        {/* Datos generales */}
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Proveedor (opcional — filtra productos)
            </label>
            <select
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— Cualquiera —</option>
              {proveedores.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Tu nombre *</label>
            <input
              value={registradoPor}
              onChange={(e) => setRegistradoPor(e.target.value)}
              placeholder="Quien recibe"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Carrito */}
        {carrito.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-green-300 bg-white">
            <div className="bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">
              {carrito.length} producto{carrito.length !== 1 ? 's' : ''} a recibir
            </div>
            <div className="divide-y divide-gray-100">
              {carrito.map((i) => (
                <div key={i.producto_id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-900">{i.producto_nombre}</div>
                    <div className="text-xs text-gray-500">
                      {i.cantidad} {i.unidad}
                    </div>
                  </div>
                  <button
                    onClick={() => quitarDelCarrito(i.producto_id)}
                    className="px-2 py-1 text-xs text-red-500"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Buscador */}
        <div>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto..."
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="mt-1 text-[10px] text-gray-400">
            {filtrados.length} producto{filtrados.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Lista de productos */}
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {filtrados.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-gray-400">
              {productos ? 'Sin productos que coincidan' : 'Cargando...'}
            </div>
          )}
          {filtrados.map((p) => (
            <div key={p.id} className="px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">{p.nombre}</div>
                  <div className="truncate text-[11px] text-gray-500">
                    {p.categoria} · {p.proveedor || 'sin proveedor'} · stock {p.stock_actual}{' '}
                    {p.unidad}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={cantidadTemp[p.id] ?? ''}
                  onChange={(e) => setCantidadTemp((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder={`Cantidad (${p.unidad})`}
                  className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={() => agregarAlCarrito(p)}
                  className="rounded bg-rodziny-600 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-700"
                >
                  + Agregar
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Foto del remito / factura */}
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <label className="mb-2 block text-xs font-medium text-gray-600">
            Foto del remito o factura <span className="text-red-500">*</span>
          </label>
          {fotoPreview ? (
            <div className="space-y-2">
              <img
                src={fotoPreview}
                alt="Remito"
                className="max-h-64 w-full rounded border border-gray-200 object-contain"
              />
              <button
                type="button"
                onClick={() => elegirFoto(null)}
                className="text-xs text-red-600 underline"
              >
                Quitar foto
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-6 hover:border-rodziny-500">
              <div className="mb-1 text-3xl">📷</div>
              <div className="text-xs text-gray-600">Tocá para sacar foto</div>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => elegirFoto(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
        </div>

        {/* Notas */}
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <label className="mb-1 block text-xs font-medium text-gray-600">Notas (opcional)</label>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            placeholder="Ej: vino un faltante, lote vencido, etc."
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Barra fija inferior con botón confirmar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white px-4 py-3">
        <button
          onClick={confirmar}
          disabled={guardando || carrito.length === 0}
          className={cn(
            'w-full rounded-lg py-3 text-sm font-semibold transition-colors',
            carrito.length === 0 || guardando
              ? 'bg-gray-200 text-gray-400'
              : 'bg-rodziny-600 text-white hover:bg-rodziny-700',
          )}
        >
          {guardando ? 'Guardando…' : `Confirmar recepción (${carrito.length})`}
        </button>
      </div>
    </div>
  );
}
