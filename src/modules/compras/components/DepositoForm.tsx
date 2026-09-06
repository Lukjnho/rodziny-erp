import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabaseAnon as supabase } from '@/lib/supabaseAnon';
import { cn } from '@/lib/utils';
import { normalizarDecimal, parseDecimal, equivalenteKgGramos } from '@/lib/numero';
import { normalizarUnidad } from '@/lib/unidades';

interface Producto {
  id: string;
  nombre: string;
  unidad: string;
  categoria: string;
  stock_actual: number;
}

// Umbrales de sanity, los mismos que ya tenía /recepcion y que a esta pantalla
// NUNCA se le pusieron. Calibrados contra las 5.145 salidas de producción: el
// escalón de "confirmá" molesta al 0,3-1,5% de las cargas, y lo que agarra ahí
// son 445 kg de orégano, 500 kg de levadura fresca, 680 kg de manteca. El de
// "bloquea" frenó 23 cargas en cinco meses y las 23 son imposibles (74.000 kg de
// cuadril, 9.415 de jamón). Cero falsos positivos.
//
// Las unidades van con tope más alto a propósito: 1.000 sorbetes o 1.000 bolsas
// de arranque SON cargas reales de todos los meses.
//
// El tope duro está TAMBIÉN en la base (mig 182, registrar_salida_deposito). Este
// de acá es para avisar antes y con un mensaje mejor, no para ser la única puerta.
const UMBRALES_SALIDA: Record<string, { confirma: number; bloquea: number }> = {
  kg: { confirma: 100, bloquea: 1000 },
  lt: { confirma: 100, bloquea: 1000 },
  unid: { confirma: 500, bloquea: 5000 },
};

function evaluarCantidad(cant: number, unidad: string): 'ok' | 'confirma' | 'bloquea' {
  const u = UMBRALES_SALIDA[normalizarUnidad(unidad)] ?? UMBRALES_SALIDA.unid;
  if (cant >= u.bloquea) return 'bloquea';
  if (cant >= u.confirma) return 'confirma';
  return 'ok';
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
    const normalizar = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    // Tokeniza la b\u00fasqueda y descarta los pedazos de cantidad/unidad
    // (ej: "1kg", "500g", "x12", "2", "kg") para que "Cebolla 1kg" matchee "Cebolla".
    const esCantidadOUnidad = (t: string) =>
      /^\d+([.,]\d+)?(kg|kgs|g|gr|grs|l|lt|ml|cc|u|un|unid|unidad|unidades)?$/.test(t) ||
      /^x\d+$/.test(t) ||
      /^(kg|kgs|g|gr|grs|l|lt|ml|cc|u|un|unid|unidad|unidades)$/.test(t);

    const tokens = normalizar(busqueda)
      .split(/\s+/)
      .filter((t) => t && !esCantidadOUnidad(t));

    // Si solo escribi\u00f3 cantidades/unidades, no filtra nada (muestra todo)
    if (tokens.length === 0) return productos ?? [];

    return (productos ?? []).filter((p) => {
      const texto = normalizar(`${p.nombre} ${p.categoria}`);
      // Cada palabra real de la b\u00fasqueda debe estar presente
      return tokens.every((t) => texto.includes(t));
    });
  }, [productos, busqueda]);

  // ── registrar movimiento ───────────────────────────────────────────────────
  const registrarMut = useMutation({
    mutationFn: async () => {
      if (!seleccionado || !cantidad) throw new Error('Faltan datos');
      // parseDecimal, no parseFloat a mano: lee el formato argentino que escribe
      // normalizarDecimal en el input (coma decimal), igual que /recepcion.
      const cant = parseDecimal(cantidad);
      if (!cant || cant <= 0) throw new Error('Cantidad inválida');

      const nivel = evaluarCantidad(cant, seleccionado.unidad);
      if (nivel === 'bloquea') {
        throw new Error(
          `${cant} ${seleccionado.unidad} de ${seleccionado.nombre} es una cantidad imposible. ` +
            `Fijate si sobra un cero o si pusiste un punto donde iba una coma.`,
        );
      }
      if (nivel === 'confirma') {
        const lectura =
          normalizarUnidad(seleccionado.unidad) === 'kg' ? equivalenteKgGramos(cant) : null;
        const ok = window.confirm(
          `¿Seguro que salieron ${cant} ${seleccionado.unidad} de ${seleccionado.nombre}?` +
            (lectura ? `\n\nEso es ${lectura}.` : '') +
            `\n\nEs mucho más de lo habitual. Si te equivocaste, cancelá y corregilo.`,
        );
        if (!ok) return;
      }

      // Resta de stock + movimiento de salida en una sola transacción atómica.
      // Vía RPC SECURITY DEFINER (mig 106) porque el QR /deposito corre como anon
      // y anon no puede hacer UPDATE directo sobre productos: el update se
      // descartaba en silencio y el stock no se movía (mismo bug que mig 102
      // arregló para entradas). La RPC lee el stock vivo (for update), así que
      // tampoco pisa cambios concurrentes con un snapshot viejo del cliente.
      const { error } = await supabase.rpc('registrar_salida_deposito', {
        p_local: local,
        p_producto_id: seleccionado.id,
        p_cantidad: cant,
        p_motivo: motivo,
        p_observacion: obs || null,
        p_registrado_por: registradoPor || null,
      });
      if (error) throw error;
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
              {/* type="text" + normalizarDecimal, no type="number": cualquier "."
                  pasa a "," al instante, así el operario ve siempre formato
                  argentino y desaparece la ambigüedad punto-decimal / punto-de-miles.
                  Es lo mismo que hace /recepcion desde hace meses; acá faltaba, y
                  por eso entraron 4.300 kg de queso sin que nada chillara. */}
              <input
                type="text"
                inputMode="decimal"
                value={cantidad}
                onChange={(e) => setCantidad(normalizarDecimal(e.target.value))}
                placeholder="0"
                className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-lg font-medium focus:border-rodziny-500 focus:outline-none"
                autoFocus
              />
              {/* La lectura humana: "= 4 toneladas 300 kg" hace obvio el disparate
                  de un vistazo, sin tener que contar ceros. */}
              {(() => {
                const cant = parseDecimal(cantidad);
                if (!cant || cant <= 0) return null;
                // Sólo para kg: la lectura habla en kilos y gramos, así que en
                // litros o unidades diría cualquier cosa.
                const lectura =
                  normalizarUnidad(seleccionado.unidad) === 'kg'
                    ? equivalenteKgGramos(cant)
                    : null;
                const nivel = evaluarCantidad(cant, seleccionado.unidad);
                if (!lectura && nivel === 'ok') return null;
                return (
                  <p
                    className={cn(
                      'mt-1 text-[11px] tabular-nums',
                      nivel === 'ok' ? 'text-gray-500' : 'font-semibold text-red-700',
                    )}
                  >
                    {lectura ? `= ${lectura}` : `${cant} ${seleccionado.unidad}`}
                    {nivel !== 'ok' && ' — es muchísimo, revisalo'}
                  </p>
                );
              })()}
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
