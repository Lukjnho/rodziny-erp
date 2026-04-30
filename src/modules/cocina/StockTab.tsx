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
  created_at: string;
}
interface Merma {
  producto_id: string;
  porciones: number;
  local: string;
  created_at: string;
}
interface AjusteStock {
  producto_id: string;
  local: string;
  ubicacion: 'camara' | 'mostrador';
  delta: number;
  created_at: string;
}
interface CierreDia {
  producto_id: string;
  local: string;
  fecha: string; // YYYY-MM-DD
  turno: 'mediodia' | 'noche';
  cantidad_real: number;
  created_at: string;
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
  mostrador: number; // clamp >= 0 para mostrar
  mostradorRaw: number; // valor real (puede ser negativo si las ventas exceden traspasos+ajustes)
  merma: number;
  stock: number; // cámara — incluye ajustes acumulados (clamp para mostrar)
  stockRaw: number; // sin clamp
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
    actual: number; // valor "raw" sin clamp (usado para calcular el delta correcto)
    actualMostrado: number; // valor con clamp >= 0 (usado en el display del modal)
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
        .select('producto_id, porciones, local, created_at');
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
        .select('producto_id, porciones, local, created_at');
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
        .select('producto_id, local, ubicacion, delta, created_at');
      if (error) throw error;
      return (data ?? []) as AjusteStock[];
    },
  });

  // Último cierre de mostrador por producto (tipo='pasta'). Define el "stock inicial"
  // del próximo turno: cuando el equipo confirma físicamente lo que quedó al cerrar,
  // ese valor se usa como base y los eventos posteriores se aplican encima.
  const { data: cierresPorProducto } = useQuery({
    queryKey: ['cocina-cierres-pastas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_cierre_dia')
        .select('producto_id, local, fecha, turno, cantidad_real, created_at')
        .eq('tipo', 'pasta')
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Quedarse con el más reciente por (producto_id, local)
      const m = new Map<string, CierreDia>();
      for (const c of (data ?? []) as CierreDia[]) {
        const key = `${c.producto_id}|${c.local}`;
        if (!m.has(key)) m.set(key, c);
      }
      return m;
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
      qc.invalidateQueries({ queryKey: ['dashboard-ajustes-mostrador'] });
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

  // Fecha desde la cual necesitamos ventas Fudo para descontar del mostrador.
  // Es la fecha MÁS ANTIGUA entre los últimos cierres de Vedia + 1 día.
  // Si todos los cierres son de hoy o no hay cierres, alcanza con "hoy".
  const fudoDesdeFecha = useMemo(() => {
    if (!cierresPorProducto || cierresPorProducto.size === 0) return hoy;
    let masAntigua: string | null = null;
    for (const c of cierresPorProducto.values()) {
      if (c.local !== 'vedia') continue;
      if (c.fecha < hoy) {
        if (!masAntigua || c.fecha < masAntigua) masAntigua = c.fecha;
      }
    }
    if (!masAntigua) return hoy;
    // Día siguiente al cierre más antiguo
    const d = new Date(masAntigua + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [cierresPorProducto, hoy]);

  // Ventas Fudo desde el último cierre relevante (para aplicar al mostrador acumulado).
  // Si fudoDesdeFecha == hoy, este query devuelve lo mismo que fudoVedia.
  const { data: fudoDesdeCierre } = useQuery({
    queryKey: ['cocina-stock-fudo-desde-cierre', 'vedia', fudoDesdeFecha, hoy],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local: 'vedia', fechaDesde: fudoDesdeFecha, fechaHasta: hoy },
      });
      if (error) return null;
      if (!data?.ok) return null;
      return data.data as FudoData;
    },
    staleTime: 2 * 60 * 1000,
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

        // Vendido hoy (para la columna "Vendido hoy" — no necesariamente lo mismo que se descuenta del mostrador)
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

        // Stock mostrador: usa el último cierre como punto de partida si existe.
        // Si no hay cierre, fallback al cálculo viejo (traspasos_hoy − ventas_hoy − merma_hoy + ajustes_hoy).
        const cierre = cierresPorProducto?.get(`${prod.id}|${loc}`) ?? null;
        let mostrador: number;
        let mostradorRaw: number;
        if (cierre) {
          // Eventos posteriores al cierre (created_at > cierre.created_at)
          const traspasosPost = (traspasos ?? [])
            .filter(
              (t) =>
                t.producto_id === prod.id && t.local === loc && t.created_at > cierre.created_at,
            )
            .reduce((s, t) => s + t.porciones, 0);
          const mermaPost = (mermas ?? [])
            .filter(
              (m) =>
                m.producto_id === prod.id && m.local === loc && m.created_at > cierre.created_at,
            )
            .reduce((s, m) => s + m.porciones, 0);
          const ajustesPost = (ajustes ?? [])
            .filter(
              (a) =>
                a.producto_id === prod.id &&
                a.local === loc &&
                a.ubicacion === 'mostrador' &&
                a.created_at > cierre.created_at,
            )
            .reduce((s, a) => s + Number(a.delta), 0);

          // Ventas Fudo: si el cierre fue HOY, asumimos que es lo más reciente y no
          // descontamos ventas posteriores (Fudo no devuelve timestamp por venta para
          // filtrar por hora exacta del cierre).
          let ventasPost = 0;
          if (loc === 'vedia' && cierre.fecha < hoy) {
            ventasPost = ventasFudoDelProducto(prod, fudoDesdeCierre?.ranking);
          }

          mostradorRaw =
            Number(cierre.cantidad_real) + traspasosPost - ventasPost - mermaPost + ajustesPost;
          mostrador = Math.max(0, mostradorRaw);
        } else {
          // Sin cierre todavía: lógica anterior (solo "hoy")
          const traspasadoHoy = traspasosHoy
            .filter((t) => t.producto_id === prod.id && t.local === loc)
            .reduce((s, t) => s + t.porciones, 0);
          const mermaDelDia = mermasHoy
            .filter((m) => m.producto_id === prod.id && m.local === loc)
            .reduce((s, m) => s + m.porciones, 0);
          mostradorRaw = traspasadoHoy - vendidoHoy - mermaDelDia + ajusteMostrador;
          mostrador = Math.max(0, mostradorRaw);
        }

        const stockRaw = producido - traspasado - mermaTotal + ajusteCamara;
        const stock = stockRaw; // sin clamp: si es negativo se ve como "sin-stock" en el render

        rows.push({
          producto: prod,
          local: loc,
          producido,
          fresco,
          traspasado,
          vendidoHoy,
          mostrador,
          mostradorRaw,
          merma: mermaTotal,
          stock,
          stockRaw,
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
    fudoDesdeCierre,
    cierresPorProducto,
    hoy,
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
                          // Pasamos el valor "raw" (sin clamp) para que el delta sea correcto
                          // aunque la cuenta interna esté en negativos por ventas/traspasos.
                          actual: r.stockRaw,
                          actualMostrado: Math.max(0, r.stock),
                          real: String(Math.max(0, r.stock)),
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
                          // Pasamos el valor "raw" (sin clamp) para que el delta cuadre
                          // con lo que el usuario contó físicamente, aunque las ventas
                          // ya hayan llevado la cuenta interna a negativo.
                          actual: r.mostradorRaw,
                          actualMostrado: Math.max(0, r.mostrador),
                          real: String(Math.max(0, r.mostrador)),
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
    actual: number; // raw, sin clamp (para calcular delta)
    actualMostrado: number; // clamp (para display)
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
  const hayDeudaOculta = state.actual < state.actualMostrado;

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
              <span className="font-medium tabular-nums text-gray-900">
                {state.actualMostrado}
              </span>
            </div>
            {hayDeudaOculta && (
              <div className="mt-1 text-[10px] text-amber-700">
                ⓘ Hay {Math.abs(state.actual - state.actualMostrado)} unidades de ventas/traspasos
                que ya descontaron de esta cuenta. El ajuste se calcula contra el valor real
                interno para que el resultado quede como vos contás.
              </div>
            )}
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
