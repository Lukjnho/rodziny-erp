import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { KPICard } from '@/components/ui/KPICard';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PRODUCTOS_COCINA, normNombre } from './DashboardTab';
import { StockProduccionSection } from './components/StockProduccionSection';

interface Producto {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  unidad: string;
  minimo_produccion: number | null;
  local: string;
  activo: boolean;
  fudo_nombres: string[] | null;
}
interface LotePasta {
  producto_id: string;
  porciones: number | null;
  local: string;
  ubicacion: 'freezer_produccion' | 'camara_congelado';
}
interface Traspaso {
  producto_id: string;
  porciones: number;
  local: string;
}
interface Merma {
  producto_id: string;
  porciones: number;
  local: string;
}
interface AjusteStock {
  producto_id: string;
  local: string;
  ubicacion: 'camara' | 'mostrador';
  delta: number;
}
interface FudoRankingItem {
  nombre: string;
  cantidad: number;
  facturacion: number;
  categoria: string;
}
interface FudoData {
  dias: number;
  ranking: FudoRankingItem[];
}

type FiltroLocal = 'todos' | 'vedia' | 'saavedra';

interface StockRow {
  producto: Producto;
  local: string;
  producido: number;
  fresco: number;
  traspasado: number;
  vendidoHoy: number;
  mostrador: number;
  merma: number;
  stock: number; // cámara — incluye ajustes acumulados
  ajusteCamara: number;
  ajusteMostrador: number;
}

// Fecha de hoy en zona horaria de Argentina (UTC-3, sin horario de verano).
// No usar toISOString() porque devuelve UTC: a las 22hs en Argentina ya es el día
// siguiente en UTC, y las queries con .eq('fecha', hoy) dejarían de encontrar datos.
const HOY = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Mapa nombre normalizado → config con fudoNombres (para resolver ventas de Fudo por producto)
const PRODUCTO_POR_NOMBRE = new Map(
  PRODUCTOS_COCINA.map((p) => [normNombre(p.nombre), p] as const),
);

// Fudo puede devolver el nombre con distinta capitalización o espacios extra; normalizar
// antes de comparar para no perder ventas por mismatch cosmético.
function normFudoNombre(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function ventasFudoDelProducto(producto: Producto, ranking: FudoRankingItem[] | undefined) {
  if (!ranking || ranking.length === 0) return 0;
  // Prioridad: fudo_nombres del producto en DB (configurable desde el editor)
  // > mapa hardcodeado PRODUCTOS_COCINA (legacy) > nombre del producto literal.
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

export function StockTab() {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const localRestringido = perfil?.local_restringido ?? null;
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>(localRestringido ?? 'todos');
  useEffect(() => {
    if (localRestringido && filtroLocal !== localRestringido) setFiltroLocal(localRestringido);
  }, [localRestringido, filtroLocal]);
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'bajo' | 'sin_stock' | 'con_fresco'>(
    'todos',
  );
  const hoy = HOY();

  // Modal de ajuste de stock
  const [ajusteModal, setAjusteModal] = useState<{
    producto: Producto;
    local: string;
    ubicacion: 'camara' | 'mostrador';
    actual: number;
    real: string;
    motivo: string;
    guardando: boolean;
  } | null>(null);

  // Modal de reset masivo (solo Lucas)
  const [resetModal, setResetModal] = useState<{
    paso: 'confirmar' | 'reseteando' | 'listo';
    pastasReseteadas: number;
    lotesReseteados: number;
  } | null>(null);
  const esLucas = perfil?.nombre === 'lukjnho';

  const { data: productos } = useQuery({
    queryKey: ['cocina-productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select('*')
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data as Producto[];
    },
  });

  const { data: lotesPasta } = useQuery({
    queryKey: ['cocina-stock-lotes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('producto_id, porciones, local, ubicacion');
      if (error) throw error;
      return data as LotePasta[];
    },
  });

  const { data: traspasos } = useQuery({
    queryKey: ['cocina-stock-traspasos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('producto_id, porciones, local');
      if (error) throw error;
      return data as Traspaso[];
    },
  });

  const { data: traspasosHoy } = useQuery({
    queryKey: ['cocina-stock-traspasos-hoy', hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_traspasos')
        .select('producto_id, porciones, local')
        .eq('fecha', hoy);
      if (error) throw error;
      return data as Traspaso[];
    },
  });

  const { data: mermas } = useQuery({
    queryKey: ['cocina-stock-merma'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('producto_id, porciones, local');
      if (error) throw error;
      return data as Merma[];
    },
  });

  const { data: mermasHoy } = useQuery({
    queryKey: ['cocina-stock-merma-hoy', hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('producto_id, porciones, local')
        .eq('fecha', hoy);
      if (error) throw error;
      return data as Merma[];
    },
  });

  // Ajustes manuales de stock (deltas acumulados por producto + ubicación)
  const { data: ajustes } = useQuery({
    queryKey: ['cocina-ajustes-stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_ajustes_stock')
        .select('producto_id, local, ubicacion, delta');
      if (error) throw error;
      return (data ?? []) as AjusteStock[];
    },
  });

  const guardarAjuste = useMutation({
    mutationFn: async (payload: {
      producto_id: string;
      local: string;
      ubicacion: 'camara' | 'mostrador';
      delta: number;
      motivo: string | null;
      responsable: string | null;
    }) => {
      const { error } = await supabase.from('cocina_ajustes_stock').insert({
        producto_id: payload.producto_id,
        local: payload.local,
        ubicacion: payload.ubicacion,
        delta: payload.delta,
        motivo: payload.motivo,
        responsable: payload.responsable,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-ajustes-stock'] });
      // El Dashboard usa la vista v_cocina_stock_pastas que ya incluye los ajustes
      qc.invalidateQueries({ queryKey: ['cocina_stock_pastas'] });
    },
    onError: (e: Error) => window.alert(`Error al guardar ajuste: ${e.message}`),
  });

  // Reset masivo de stock (solo para Lucas, hardcoded a Vedia).
  // Para pastas: ajustes negativos en cocina_ajustes_stock por la cantidad actual
  //   en cámara y mostrador (preserva historial de lotes y traspasos).
  // Para salsas/postres: marca todos los lotes activos como en_stock=false.
  const resetearStockVedia = useMutation({
    mutationFn: async () => {
      const filasVedia = stockRows.filter((r) => r.local === 'vedia');
      const ajustesAInsertar: Array<{
        producto_id: string;
        local: string;
        ubicacion: 'camara' | 'mostrador';
        delta: number;
        motivo: string;
        responsable: string | null;
      }> = [];

      for (const r of filasVedia) {
        if (r.stock > 0) {
          ajustesAInsertar.push({
            producto_id: r.producto.id,
            local: 'vedia',
            ubicacion: 'camara',
            delta: -r.stock,
            motivo: 'Reset stock fin de servicio',
            responsable: perfil?.nombre ?? null,
          });
        }
        if (r.mostrador > 0) {
          ajustesAInsertar.push({
            producto_id: r.producto.id,
            local: 'vedia',
            ubicacion: 'mostrador',
            delta: -r.mostrador,
            motivo: 'Reset stock fin de servicio',
            responsable: perfil?.nombre ?? null,
          });
        }
      }

      let pastasReseteadas = 0;
      if (ajustesAInsertar.length > 0) {
        const { error: errAj } = await supabase
          .from('cocina_ajustes_stock')
          .insert(ajustesAInsertar);
        if (errAj) throw errAj;
        pastasReseteadas = ajustesAInsertar.length;
      }

      // Salsas, postres y demás producciones: apagar lotes activos
      const { data: lotesActivos, error: errSelect } = await supabase
        .from('cocina_lotes_produccion')
        .select('id')
        .eq('local', 'vedia')
        .eq('en_stock', true);
      if (errSelect) throw errSelect;

      const cantLotes = lotesActivos?.length ?? 0;
      if (cantLotes > 0) {
        const { error: errUpd } = await supabase
          .from('cocina_lotes_produccion')
          .update({ en_stock: false })
          .eq('local', 'vedia')
          .eq('en_stock', true);
        if (errUpd) throw errUpd;
      }

      return { pastasReseteadas, lotesReseteados: cantLotes };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['cocina-ajustes-stock'] });
      qc.invalidateQueries({ queryKey: ['cocina_stock_pastas'] });
      qc.invalidateQueries({ queryKey: ['stock-produccion-lotes'] });
      qc.invalidateQueries({ queryKey: ['cocina_stock_salsas_postres'] });
      setResetModal({
        paso: 'listo',
        pastasReseteadas: res.pastasReseteadas,
        lotesReseteados: res.lotesReseteados,
      });
    },
    onError: (e: Error) => {
      window.alert(`Error al resetear stock: ${e.message}`);
      setResetModal(null);
    },
  });

  // Ventas Fudo del día — solo Vedia tiene API habilitada (fudoApi.ts: Saavedra pendiente)
  const { data: fudoVedia } = useQuery({
    queryKey: ['cocina-stock-fudo', 'vedia', hoy],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local: 'vedia', fechaDesde: hoy, fechaHasta: hoy },
      });
      if (error) return null;
      if (!data?.ok) return null;
      return data.data as FudoData;
    },
    staleTime: 2 * 60 * 1000, // refrescar cada 2 min
  });

  const isLoading =
    !productos || !lotesPasta || !traspasos || !mermas || !traspasosHoy || !mermasHoy;

  // Calcular stock por producto × local
  const stockRows = useMemo(() => {
    if (!productos || !lotesPasta || !traspasos || !mermas || !traspasosHoy || !mermasHoy)
      return [];

    const rows: StockRow[] = [];
    const locales: string[] = filtroLocal === 'todos' ? ['vedia', 'saavedra'] : [filtroLocal];

    for (const prod of productos) {
      for (const loc of locales) {
        if (prod.local !== loc) continue;

        // Producido en cámara = stock disponible. "Pastas en produ" = frescas sin porcionar (no cuentan como stock vendible).
        const producido = lotesPasta
          .filter(
            (l) =>
              l.producto_id === prod.id && l.local === loc && l.ubicacion === 'camara_congelado',
          )
          .reduce((s, l) => s + (l.porciones ?? 0), 0);
        const fresco = lotesPasta
          .filter(
            (l) =>
              l.producto_id === prod.id && l.local === loc && l.ubicacion === 'freezer_produccion',
          )
          .reduce((s, l) => s + (l.porciones ?? 0), 0);
        const traspasado = traspasos
          .filter((t) => t.producto_id === prod.id && t.local === loc)
          .reduce((s, t) => s + t.porciones, 0);
        const mermaTotal = mermas
          .filter((m) => m.producto_id === prod.id && m.local === loc)
          .reduce((s, m) => s + m.porciones, 0);

        // Stock del día en el freezer del mostrador (aproximado hasta Fase 2 con conteo físico):
        //   traspasos_hoy − ventas_fudo_hoy − merma_hoy
        // Asume que el mostrador arranca vacío cada día. Solo Vedia tiene ventas de Fudo hoy.
        const traspasadoHoy = traspasosHoy
          .filter((t) => t.producto_id === prod.id && t.local === loc)
          .reduce((s, t) => s + t.porciones, 0);
        const mermaDelDia = mermasHoy
          .filter((m) => m.producto_id === prod.id && m.local === loc)
          .reduce((s, m) => s + m.porciones, 0);
        const vendidoHoy =
          loc === 'vedia' ? ventasFudoDelProducto(prod, fudoVedia?.ranking) : 0;

        // Ajustes manuales acumulados por ubicación
        const ajusteCamara = (ajustes ?? [])
          .filter(
            (a) => a.producto_id === prod.id && a.local === loc && a.ubicacion === 'camara',
          )
          .reduce((s, a) => s + Number(a.delta), 0);
        const ajusteMostrador = (ajustes ?? [])
          .filter(
            (a) => a.producto_id === prod.id && a.local === loc && a.ubicacion === 'mostrador',
          )
          .reduce((s, a) => s + Number(a.delta), 0);

        const mostrador = Math.max(
          0,
          traspasadoHoy - vendidoHoy - mermaDelDia + ajusteMostrador,
        );

        const stock = producido - traspasado - mermaTotal + ajusteCamara;

        rows.push({
          producto: prod,
          local: loc,
          producido,
          fresco,
          traspasado,
          vendidoHoy,
          mostrador,
          merma: mermaTotal,
          stock,
          ajusteCamara,
          ajusteMostrador,
        });
      }
    }

    return rows.sort((a, b) => a.stock - b.stock); // los de menor stock primero
  }, [
    productos,
    lotesPasta,
    traspasos,
    mermas,
    traspasosHoy,
    mermasHoy,
    fudoVedia,
    ajustes,
    filtroLocal,
  ]);

  const kpis = useMemo(() => {
    const totalProductos = stockRows.filter((r) => r.stock > 0).length;
    const bajoMinimo = stockRows.filter(
      (r) => r.producto.minimo_produccion && r.stock < r.producto.minimo_produccion && r.stock > 0,
    ).length;
    const sinStock = stockRows.filter((r) => r.stock <= 0).length;
    const totalPorciones = stockRows.reduce((s, r) => s + Math.max(0, r.stock), 0);
    const totalFrescos = stockRows.reduce((s, r) => s + r.fresco, 0);
    const conFresco = stockRows.filter((r) => r.fresco > 0).length;
    const totalMostrador = stockRows.reduce((s, r) => s + r.mostrador, 0);
    const conMostrador = stockRows.filter((r) => r.mostrador > 0).length;
    return {
      totalProductos,
      bajoMinimo,
      sinStock,
      totalPorciones,
      totalFrescos,
      conFresco,
      totalMostrador,
      conMostrador,
    };
  }, [stockRows]);

  // Filtro de estado aplicado solo a la tabla (los KPIs muestran totales)
  const stockRowsFiltrados = useMemo(() => {
    if (filtroEstado === 'todos') return stockRows;
    if (filtroEstado === 'bajo') {
      return stockRows.filter(
        (r) =>
          r.producto.minimo_produccion && r.stock < r.producto.minimo_produccion && r.stock > 0,
      );
    }
    if (filtroEstado === 'sin_stock') return stockRows.filter((r) => r.stock <= 0);
    if (filtroEstado === 'con_fresco') return stockRows.filter((r) => r.fresco > 0);
    return stockRows;
  }, [stockRows, filtroEstado]);

  return (
    <div className="space-y-4">
      {/* KPIs — clickeables para filtrar la tabla */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <KPICard
          label="Productos en stock"
          value={String(kpis.totalProductos)}
          color="blue"
          loading={isLoading}
          onClick={() => {
            setFiltroEstado('todos');
            if (!localRestringido) setFiltroLocal('todos');
          }}
        />
        <KPICard
          label="Bajo mínimo"
          value={String(kpis.bajoMinimo)}
          color="yellow"
          loading={isLoading}
          active={filtroEstado === 'bajo'}
          onClick={() => setFiltroEstado(filtroEstado === 'bajo' ? 'todos' : 'bajo')}
        />
        <KPICard
          label="Sin stock"
          value={String(kpis.sinStock)}
          color="red"
          loading={isLoading}
          active={filtroEstado === 'sin_stock'}
          onClick={() => setFiltroEstado(filtroEstado === 'sin_stock' ? 'todos' : 'sin_stock')}
        />
        <KPICard
          label="En cámara"
          value={String(kpis.totalPorciones)}
          color="green"
          loading={isLoading}
        />
        <KPICard
          label="En mostrador"
          value={String(kpis.totalMostrador)}
          color={kpis.totalMostrador > 0 ? 'green' : 'neutral'}
          loading={isLoading}
        />
        <KPICard
          label="Pastas en produ"
          value={String(kpis.totalFrescos)}
          color={kpis.totalFrescos > 0 ? 'blue' : 'neutral'}
          loading={isLoading}
          active={filtroEstado === 'con_fresco'}
          onClick={
            kpis.conFresco > 0
              ? () => setFiltroEstado(filtroEstado === 'con_fresco' ? 'todos' : 'con_fresco')
              : undefined
          }
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-white p-3">
        {!localRestringido && (
          <select
            value={filtroLocal}
            onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="todos">Todos los locales</option>
            <option value="vedia">Vedia</option>
            <option value="saavedra">Saavedra</option>
          </select>
        )}
        {esLucas && (
          <button
            onClick={() =>
              setResetModal({ paso: 'confirmar', pastasReseteadas: 0, lotesReseteados: 0 })
            }
            className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
            title="Pone en 0 el stock de pastas, salsas y postres de Vedia (uso fin de servicio)"
          >
            ↺ Resetear stock Vedia
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">
          En cámara (depósito) = histórico − traspasos − merma · En mostrador = traspasos hoy −
          ventas Fudo − merma hoy · Pastas en produ = frescas sin porcionar
        </span>
      </div>

      {/* Tabla de pastas */}
      <h3 className="text-base font-semibold text-gray-800">Pastas</h3>
      <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Local</th>
              <th className="px-4 py-2 text-right">Pastas en produ</th>
              <th className="px-4 py-2 text-right">En cámara</th>
              <th className="px-4 py-2 text-right">En mostrador</th>
              <th className="px-4 py-2 text-right">Vendido hoy</th>
              <th className="px-4 py-2 text-right">Merma</th>
              <th className="px-4 py-2">Mín.</th>
              <th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {stockRowsFiltrados.map((r, i) => {
              const min = r.producto.minimo_produccion ?? 0;
              const estado = r.stock <= 0 ? 'sin-stock' : r.stock < min ? 'bajo' : 'ok';
              return (
                <tr
                  key={`${r.producto.id}-${r.local}-${i}`}
                  className={cn(
                    'border-b border-surface-border',
                    estado === 'sin-stock' && 'bg-red-50',
                    estado === 'bajo' && 'bg-yellow-50',
                  )}
                >
                  <td className="px-4 py-2 font-medium">{r.producto.nombre}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.producto.codigo}</td>
                  <td className="px-4 py-2 capitalize">{r.local}</td>
                  <td className="px-4 py-2 text-right">
                    {r.fresco > 0 ? (
                      <span className="font-medium text-blue-600">{r.fresco}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">
                    <button
                      onClick={() =>
                        setAjusteModal({
                          producto: r.producto,
                          local: r.local,
                          ubicacion: 'camara',
                          actual: r.stock,
                          real: String(r.stock),
                          motivo: '',
                          guardando: false,
                        })
                      }
                      className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-rodziny-50"
                      title="Ajustar stock de cámara (conteo físico)"
                    >
                      <span>{r.stock}</span>
                      <span className="text-[10px] text-gray-400 opacity-0 transition-opacity group-hover:opacity-100">
                        ✎
                      </span>
                    </button>
                    {r.ajusteCamara !== 0 && (
                      <div
                        className="text-[9px] text-purple-600"
                        title="Ajuste manual acumulado"
                      >
                        ({r.ajusteCamara > 0 ? '+' : ''}
                        {r.ajusteCamara} aj.)
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() =>
                        setAjusteModal({
                          producto: r.producto,
                          local: r.local,
                          ubicacion: 'mostrador',
                          actual: r.mostrador,
                          real: String(r.mostrador),
                          motivo: '',
                          guardando: false,
                        })
                      }
                      className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-rodziny-50"
                      title="Ajustar stock de mostrador (conteo físico)"
                    >
                      {r.mostrador > 0 ? (
                        <span className="font-medium text-green-700">{r.mostrador}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                      <span className="text-[10px] text-gray-400 opacity-0 transition-opacity group-hover:opacity-100">
                        ✎
                      </span>
                    </button>
                    {r.ajusteMostrador !== 0 && (
                      <div
                        className="text-[9px] text-purple-600"
                        title="Ajuste manual acumulado"
                      >
                        ({r.ajusteMostrador > 0 ? '+' : ''}
                        {r.ajusteMostrador} aj.)
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {r.vendidoHoy > 0 ? r.vendidoHoy : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">{r.merma}</td>
                  <td className="px-4 py-2">{min || '—'}</td>
                  <td className="px-4 py-2">
                    {estado === 'ok' && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        OK
                      </span>
                    )}
                    {estado === 'bajo' && (
                      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
                        Bajo mínimo
                      </span>
                    )}
                    {estado === 'sin-stock' && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                        Sin stock
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {stockRowsFiltrados.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                  {isLoading
                    ? 'Cargando...'
                    : filtroEstado !== 'todos'
                      ? 'No hay productos con ese estado en el filtro actual'
                      : 'No hay datos de stock aún'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Otras producciones: salsas, postres, pastelería, panadería ────── */}
      <div className="pt-6">
        <h3 className="mb-3 text-base font-semibold text-gray-800">
          Salsas, postres y otras producciones
        </h3>
        <StockProduccionSection filtroLocal={filtroLocal} />
      </div>

      {/* ── Modal de reset masivo (solo Lucas) ──────────────────────────── */}
      {resetModal && esLucas && (
        <ModalResetStock
          state={resetModal}
          resumen={(() => {
            const filasVedia = stockRows.filter((r) => r.local === 'vedia');
            const totalCamara = filasVedia.reduce((s, r) => s + Math.max(0, r.stock), 0);
            const totalMostrador = filasVedia.reduce((s, r) => s + r.mostrador, 0);
            const productosConStock = filasVedia.filter(
              (r) => r.stock > 0 || r.mostrador > 0,
            ).length;
            return { totalCamara, totalMostrador, productosConStock };
          })()}
          onCancel={() => setResetModal(null)}
          onConfirmar={async () => {
            setResetModal((s) => (s ? { ...s, paso: 'reseteando' } : s));
            await resetearStockVedia.mutateAsync();
          }}
        />
      )}

      {/* ── Modal de ajuste de stock ─────────────────────────────────────── */}
      {ajusteModal && (
        <ModalAjusteStock
          state={ajusteModal}
          onChange={(patch) => setAjusteModal((s) => (s ? { ...s, ...patch } : s))}
          onCancel={() => setAjusteModal(null)}
          onConfirmar={async () => {
            const real = parseFloat(ajusteModal.real.replace(',', '.'));
            if (isNaN(real) || real < 0) {
              window.alert('Ingresá un número válido (>= 0).');
              return;
            }
            const delta = Math.round((real - ajusteModal.actual) * 100) / 100;
            if (delta === 0) {
              window.alert('El valor real coincide con el calculado. Nada que ajustar.');
              return;
            }
            setAjusteModal((s) => (s ? { ...s, guardando: true } : s));
            try {
              await guardarAjuste.mutateAsync({
                producto_id: ajusteModal.producto.id,
                local: ajusteModal.local,
                ubicacion: ajusteModal.ubicacion,
                delta,
                motivo: ajusteModal.motivo.trim() || null,
                responsable: perfil?.nombre ?? null,
              });
              setAjusteModal(null);
            } catch {
              setAjusteModal((s) => (s ? { ...s, guardando: false } : s));
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Modal de ajuste manual de stock ────────────────────────────────────────
function ModalAjusteStock({
  state,
  onChange,
  onCancel,
  onConfirmar,
}: {
  state: {
    producto: Producto;
    local: string;
    ubicacion: 'camara' | 'mostrador';
    actual: number;
    real: string;
    motivo: string;
    guardando: boolean;
  };
  onChange: (patch: Partial<{ real: string; motivo: string }>) => void;
  onCancel: () => void;
  onConfirmar: () => void;
}) {
  const realNum = parseFloat(state.real.replace(',', '.'));
  const deltaPreview = !isNaN(realNum) ? Math.round((realNum - state.actual) * 100) / 100 : null;
  const ubicacionLabel = state.ubicacion === 'camara' ? 'Cámara (depósito)' : 'Mostrador';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900">Ajustar stock</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            <span className="font-medium text-gray-800">{state.producto.nombre}</span>{' '}
            <span className="capitalize">· {state.local}</span> ·{' '}
            <span className="font-medium">{ubicacionLabel}</span>
          </p>
        </div>

        <div className="space-y-3">
          <div className="rounded border border-gray-200 bg-gray-50 p-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-600">Stock calculado actual:</span>
              <span className="font-medium tabular-nums text-gray-900">{state.actual}</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Stock real contado
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={state.real}
              onChange={(e) => onChange({ real: e.target.value })}
              placeholder="0"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-right text-base tabular-nums focus:border-rodziny-500 focus:outline-none"
              autoFocus
            />
          </div>

          {deltaPreview !== null && deltaPreview !== 0 && (
            <div
              className={cn(
                'rounded border p-2 text-xs',
                deltaPreview > 0
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-red-200 bg-red-50 text-red-700',
              )}
            >
              Se va a registrar un ajuste de{' '}
              <span className="font-semibold">
                {deltaPreview > 0 ? '+' : ''}
                {deltaPreview}
              </span>{' '}
              {deltaPreview > 0 ? 'unidades sumadas' : 'unidades restadas'}.
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Motivo (opcional)
            </label>
            <input
              type="text"
              value={state.motivo}
              onChange={(e) => onChange({ motivo: e.target.value })}
              placeholder="ej: conteo físico semanal"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-rodziny-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={state.guardando}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={state.guardando || deltaPreview === 0 || deltaPreview === null}
            className="rounded bg-rodziny-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.guardando ? 'Guardando...' : 'Guardar ajuste'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de reset masivo de stock (solo Lucas) ────────────────────────────
function ModalResetStock({
  state,
  resumen,
  onCancel,
  onConfirmar,
}: {
  state: { paso: 'confirmar' | 'reseteando' | 'listo'; pastasReseteadas: number; lotesReseteados: number };
  resumen: { totalCamara: number; totalMostrador: number; productosConStock: number };
  onCancel: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={state.paso === 'confirmar' ? onCancel : undefined}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {state.paso === 'confirmar' && (
          <>
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-xl">
                ⚠
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  Resetear stock de Vedia a 0
                </h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  Pensado para usar al cierre del servicio antes de cargar el conteo del día.
                </p>
              </div>
            </div>

            <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium">Esto va a:</p>
              <ul className="list-disc space-y-0.5 pl-5">
                <li>
                  Poner en 0 el stock de pastas en cámara (
                  <span className="font-semibold">{resumen.totalCamara}</span> porc.) y mostrador (
                  <span className="font-semibold">{resumen.totalMostrador}</span> porc.) vía
                  ajustes negativos.
                </li>
                <li>
                  Apagar todos los lotes activos de salsas / postres / pastelería / panadería
                  (quedan en histórico).
                </li>
                <li>
                  <strong>No</strong> borra historial: lotes, traspasos, mermas, ventas Fudo
                  siguen tal cual.
                </li>
              </ul>
            </div>

            <p className="mt-4 text-xs text-gray-600">
              Productos afectados: <strong>{resumen.productosConStock}</strong> pastas con stock.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onCancel}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={onConfirmar}
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                Sí, resetear todo a 0
              </button>
            </div>
          </>
        )}

        {state.paso === 'reseteando' && (
          <div className="py-6 text-center">
            <div className="mb-3 text-3xl">⏳</div>
            <p className="text-sm font-medium text-gray-700">Reseteando stock...</p>
          </div>
        )}

        {state.paso === 'listo' && (
          <>
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-xl">
                ✓
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Stock reseteado</h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  Listo para cargar el conteo del día.
                </p>
              </div>
            </div>

            <div className="space-y-1 rounded border border-green-200 bg-green-50 p-3 text-xs text-green-900">
              <p>
                <strong>{state.pastasReseteadas}</strong> ajustes de pastas registrados.
              </p>
              <p>
                <strong>{state.lotesReseteados}</strong> lotes de salsas/postres apagados.
              </p>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={onCancel}
                className="rounded bg-rodziny-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-700"
              >
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
