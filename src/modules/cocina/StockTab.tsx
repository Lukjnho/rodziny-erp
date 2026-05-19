import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { KPICard } from '@/components/ui/KPICard';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PRODUCTOS_COCINA, normNombre } from './DashboardTab';

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
  receta_id: string | null;
  controla_stock: boolean;
}
interface LotePasta {
  producto_id: string;
  porciones: number | null;
  cantidad_cajones: number | null;
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

// Cocina es una herramienta operativa por local: nunca vista combinada.
// El admin elige Vedia o Saavedra (default Vedia); al cocinero con
// local_restringido se le fuerza el suyo y se le oculta el selector.
type FiltroLocal = 'vedia' | 'saavedra';

interface StockRow {
  producto: Producto;
  local: string;
  producido: number;
  fresco: number; // porciones en freezer_produccion (sirve para histórico ya porcionado)
  frescoBandejas: number; // bandejas en cola para porcionar (cantidad_cajones)
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
  const esAdmin = perfil?.es_admin ?? false;
  const localRestringido = perfil?.local_restringido ?? null;

  // Toggle admin: sacar/poner un producto del control de stock (independiente de
  // 'activo'). Lo usan la tabla Pastas (Vedia) y el catálogo (Saavedra).
  const toggleControlaStock = useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: boolean }) => {
      const { error } = await supabase
        .from('cocina_productos')
        .update({ controla_stock: valor })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cocina-productos'] });
      qc.invalidateQueries({ queryKey: ['cocina-catalogo-saavedra-lotes'] });
    },
  });
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>(
    (localRestringido as FiltroLocal | null) ?? 'vedia',
  );
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

  const {
    data: productos,
    isError: productosError,
    refetch: refetchProductos,
  } = useQuery({
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
    refetchOnMount: 'always',
  });

  const { data: lotesPasta } = useQuery({
    queryKey: ['cocina-stock-lotes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_pasta')
        .select('producto_id, porciones, cantidad_cajones, local, ubicacion');
      if (error) throw error;
      return data as LotePasta[];
    },
    refetchOnMount: 'always',
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

  // Locales en alcance según el filtro. Ambos locales tienen API de Fudo
  // (credenciales en las Edge Functions fudo-*). Antes esto era solo Vedia.
  const localesScope = useMemo<string[]>(() => [filtroLocal], [filtroLocal]);

  // Ventas Fudo de HOY por local. Una llamada a fudo-productos por local.
  const { data: fudoHoy } = useQuery({
    queryKey: ['cocina-stock-fudo-hoy', localesScope, hoy],
    queryFn: async () => {
      const res: Record<string, FudoData | null> = {};
      for (const loc of localesScope) {
        const { data, error } = await supabase.functions.invoke('fudo-productos', {
          body: { local: loc, fechaDesde: hoy, fechaHasta: hoy },
        });
        res[loc] = !error && data?.ok ? (data.data as FudoData) : null;
      }
      return res;
    },
    staleTime: 2 * 60 * 1000, // refrescar cada 2 min
  });

  // Fecha "desde" POR LOCAL = día siguiente al cierre más antiguo (anterior a
  // hoy) de ese local. Si todos los cierres son de hoy o no hay, alcanza "hoy".
  const fudoDesdeFechaPorLocal = useMemo(() => {
    const out: Record<string, string> = {};
    for (const loc of localesScope) {
      let masAntigua: string | null = null;
      if (cierresPorProducto) {
        for (const c of cierresPorProducto.values()) {
          if (c.local !== loc) continue;
          if (c.fecha < hoy && (!masAntigua || c.fecha < masAntigua)) masAntigua = c.fecha;
        }
      }
      if (!masAntigua) {
        out[loc] = hoy;
        continue;
      }
      const d = new Date(masAntigua + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      out[loc] = d.toISOString().slice(0, 10);
    }
    return out;
  }, [cierresPorProducto, hoy, localesScope]);

  // Ventas Fudo desde el último cierre relevante de cada local, para descontar
  // del mostrador acumulado. Si la fecha desde == hoy, devuelve lo mismo que fudoHoy.
  const { data: fudoDesdeCierre } = useQuery({
    queryKey: ['cocina-stock-fudo-desde-cierre', fudoDesdeFechaPorLocal, hoy],
    queryFn: async () => {
      const res: Record<string, FudoData | null> = {};
      for (const loc of Object.keys(fudoDesdeFechaPorLocal)) {
        const { data, error } = await supabase.functions.invoke('fudo-productos', {
          body: { local: loc, fechaDesde: fudoDesdeFechaPorLocal[loc], fechaHasta: hoy },
        });
        res[loc] = !error && data?.ok ? (data.data as FudoData) : null;
      }
      return res;
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
    const locales: string[] = [filtroLocal];

    for (const prod of productos) {
      // Esta tabla es SOLO de pastas (flujo cámara/mostrador/porcionado).
      // Postres, panificados y salsas tienen su stock por conteo registrado
      // en StockProduccionSection (abajo) — no se duplican acá.
      // Filtro defensivo en JS: la query ['cocina-productos'] la comparte
      // TraspasosTab y necesita todos los tipos.
      if (prod.tipo !== 'pasta') continue;
      for (const loc of locales) {
        if (prod.local !== loc) continue;

        // Producido en cámara = stock disponible. "Pastas en produ" = frescas sin porcionar (no cuentan como stock vendible).
        const producido = lotesPasta
          .filter(
            (l) =>
              l.producto_id === prod.id && l.local === loc && l.ubicacion === 'camara_congelado',
          )
          .reduce((s, l) => s + (l.porciones ?? 0), 0);
        // Lotes en freezer de producción = bandejas armadas, todavía sin porcionar.
        // Las porciones quedan en null hasta el paso "Porcionar pasta" del QR, así que
        // lo que tiene valor en esta etapa son las bandejas (cantidad_cajones).
        const lotesFresco = lotesPasta.filter(
          (l) =>
            l.producto_id === prod.id && l.local === loc && l.ubicacion === 'freezer_produccion',
        );
        const fresco = lotesFresco.reduce((s, l) => s + (l.porciones ?? 0), 0);
        const frescoBandejas = lotesFresco.reduce((s, l) => s + (l.cantidad_cajones ?? 0), 0);
        const traspasado = traspasos
          .filter((t) => t.producto_id === prod.id && t.local === loc)
          .reduce((s, t) => s + t.porciones, 0);
        const mermaTotal = mermas
          .filter((m) => m.producto_id === prod.id && m.local === loc)
          .reduce((s, m) => s + m.porciones, 0);

        // Vendido hoy (para la columna "Vendido hoy" — no necesariamente lo mismo que se descuenta del mostrador)
        const vendidoHoy = ventasFudoDelProducto(prod, fudoHoy?.[loc]?.ranking);

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
          if (cierre.fecha < hoy) {
            ventasPost = ventasFudoDelProducto(prod, fudoDesdeCierre?.[loc]?.ranking);
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

        // El stock nunca puede ser negativo (regla de negocio: máximo puede ser 0).
        // Clamp consistente con v_cocina_stock_pastas (Dashboard) y TraspasosTab.
        const stockRaw = producido - traspasado - mermaTotal + ajusteCamara;
        const stock = Math.max(0, stockRaw);

        rows.push({
          producto: prod,
          local: loc,
          producido,
          fresco,
          frescoBandejas,
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
    fudoHoy,
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
    // El KPI "Pastas en produ" muestra bandejas (cola para porcionar). Las porciones
    // recién se asignan al porcionar, así que sumar porciones acá daría 0 en este flujo.
    const totalFrescos = stockRows.reduce((s, r) => s + r.frescoBandejas, 0);
    const conFresco = stockRows.filter((r) => r.frescoBandejas > 0 || r.fresco > 0).length;
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
    if (filtroEstado === 'con_fresco')
      return stockRows.filter((r) => r.frescoBandejas > 0 || r.fresco > 0);
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
          onClick={() => setFiltroEstado('todos')}
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
            <option value="vedia">Vedia</option>
            <option value="saavedra">Saavedra</option>
          </select>
        )}
        <span className="ml-auto text-xs text-gray-400">
          En cámara (depósito) = histórico − traspasos − merma · En mostrador = traspasos hoy −
          ventas Fudo − merma hoy · Pastas en produ = frescas sin porcionar
        </span>
      </div>

      {/* Saavedra controla TODO el stock con overwrite ("último pesaje manda"):
          catálogo único por tipo, sin flujo cámara/mostrador. Ver project_modelo_salsas. */}
      {filtroLocal === 'saavedra' && (
        <CatalogoStock
          productos={productos ?? []}
          local="saavedra"
          tipos={CATALOGO_TIPOS_SAAVEDRA}
          esAdmin={esAdmin}
          onQuitarControl={(id) => toggleControlaStock.mutate({ id, valor: false })}
          toggleDisabled={toggleControlaStock.isPending}
        />
      )}

      {/* Tabla de pastas (Vedia) — flujo cámara/mostrador/porcionado.
          Saavedra no usa este flujo (sin mostrador). */}
      {filtroLocal === 'vedia' &&
        localesScope.map((locKey) => {
        const filasLocal = stockRowsFiltrados.filter(
          (r) => r.local === locKey && r.producto.controla_stock !== false,
        );
        return (
          <div key={locKey} className="space-y-2">
            <h3 className="text-base font-semibold text-gray-800">
              🍝 Pastas{' '}
              <span className="text-sm font-normal capitalize text-gray-500">· {locKey}</span>
            </h3>
            <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-4 py-2">Producto</th>
                    <th className="px-4 py-2">Código</th>
                    <th className="px-4 py-2 text-right">Pastas en produ</th>
                    <th className="px-4 py-2 text-right">En cámara</th>
                    <th className="px-4 py-2 text-right">En mostrador</th>
                    <th className="px-4 py-2 text-right">Vendido hoy</th>
                    <th className="px-4 py-2 text-right">Merma</th>
                    <th className="px-4 py-2">Mín.</th>
                    <th className="px-4 py-2">Estado</th>
                    {esAdmin && <th className="px-4 py-2 text-center">Control</th>}
                  </tr>
                </thead>
                <tbody>
                  {filasLocal.map((r, i) => {
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
                  <td className="px-4 py-2 text-right">
                    {r.frescoBandejas > 0 || r.fresco > 0 ? (
                      <div className="flex flex-col items-end leading-tight">
                        {r.frescoBandejas > 0 && (
                          <span className="font-medium text-blue-600">
                            {r.frescoBandejas} band.
                          </span>
                        )}
                        {r.fresco > 0 && (
                          <span className="text-[10px] text-gray-400">{r.fresco} porc.</span>
                        )}
                      </div>
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
                  {esAdmin && (
                    <td className="px-4 py-2 text-center">
                      <ControlToggle
                        on
                        disabled={toggleControlaStock.isPending}
                        onToggle={() =>
                          toggleControlaStock.mutate({ id: r.producto.id, valor: false })
                        }
                      />
                    </td>
                  )}
                </tr>
              );
            })}
                  {filasLocal.length === 0 && (
                    <tr>
                      <td
                        colSpan={esAdmin ? 10 : 9}
                        className="px-4 py-8 text-center text-gray-400"
                      >
                        {isLoading || productos === undefined || lotesPasta === undefined ? (
                          'Cargando…'
                        ) : productosError ? (
                          <div className="space-y-2">
                            <p className="text-red-500">No se pudieron cargar los productos.</p>
                            <button
                              onClick={() => refetchProductos()}
                              className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                            >
                              Reintentar
                            </button>
                          </div>
                        ) : filtroEstado !== 'todos' ? (
                          'No hay pastas con ese estado en el filtro actual'
                        ) : (
                          'No hay datos de stock de pastas aún'
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          );
        })}

      {/* ── Vedia: salsas/postres en catálogo simple (mismo formato Saavedra) ──
          Modelo overwrite sin descuento por venta (ver project_modelo_salsas).
          La proyección Fudo + FIFO sigue disponible en el tab Producción. */}
      {filtroLocal === 'vedia' && (
        <div className="pt-6">
          <CatalogoStock
            productos={productos ?? []}
            local="vedia"
            tipos={CATALOGO_TIPOS_VEDIA}
            esAdmin={esAdmin}
            onQuitarControl={(id) => toggleControlaStock.mutate({ id, valor: false })}
            toggleDisabled={toggleControlaStock.isPending}
          />
        </div>
      )}

      {esAdmin && (
        <SinControlSection
          productos={productos ?? []}
          filtroLocal={filtroLocal}
          onReactivar={(id) => toggleControlaStock.mutate({ id, valor: true })}
          toggleDisabled={toggleControlaStock.isPending}
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

// ── Catálogo de stock (overwrite) ─────────────────────────────────────────────
// Stock por producto = última carga en Producción ("último pesaje manda") sobre
// cocina_lotes_produccion, sin descuento por venta (ver project_modelo_salsas).
// El stock se asocia al producto por nombre (nombre_libre) o por receta vinculada.
// Lista SIEMPRE todos los productos controlados, aunque estén en 0.
// Saavedra: pastas/milanesas/postres/panes/salsas (no usa cámara/mostrador).
// Vedia: salsas/postres (las pastas tienen su tabla cámara/mostrador aparte).

interface LoteProdCatalogo {
  receta_id: string | null;
  nombre_libre: string | null;
  categoria: string;
  cantidad_producida: number;
  merma_cantidad: number | null;
}

const CATALOGO_TIPOS_SAAVEDRA: { tipo: string; titulo: string }[] = [
  { tipo: 'pasta', titulo: '🍝 Pastas' },
  { tipo: 'milanesa', titulo: '🍖 Milanesas' },
  { tipo: 'postre', titulo: '🍰 Postres' },
  { tipo: 'panificado', titulo: '🥖 Panes' },
  { tipo: 'salsa', titulo: '🥫 Salsas' },
];
const CATALOGO_TIPOS_VEDIA: { tipo: string; titulo: string }[] = [
  { tipo: 'salsa', titulo: '🥫 Salsas' },
  { tipo: 'postre', titulo: '🍰 Postres' },
];

function CatalogoStock({
  productos,
  local,
  tipos,
  esAdmin,
  onQuitarControl,
  toggleDisabled,
}: {
  productos: Producto[];
  local: FiltroLocal;
  tipos: { tipo: string; titulo: string }[];
  esAdmin: boolean;
  onQuitarControl: (id: string) => void;
  toggleDisabled: boolean;
}) {
  const { data: lotes, isLoading } = useQuery({
    queryKey: ['cocina-catalogo-lotes', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select('receta_id, nombre_libre, categoria, cantidad_producida, merma_cantidad')
        .eq('local', local)
        .eq('en_stock', true);
      if (error) throw error;
      return (data ?? []) as LoteProdCatalogo[];
    },
  });

  // Stock por producto = Σ (producido − merma) de lotes activos que matchean por
  // nombre (nombre_libre) o por receta vinculada. Overwrite ⇒ normalmente 1 lote.
  const stockPorProducto = useMemo(() => {
    const m = new Map<string, number>();
    for (const prod of productos) {
      if (prod.local !== local || !prod.activo) continue;
      const objetivoNombre = normNombre(prod.nombre);
      let total = 0;
      for (const l of lotes ?? []) {
        const matchNombre =
          !!l.nombre_libre && normNombre(l.nombre_libre) === objetivoNombre;
        const matchReceta = !!prod.receta_id && l.receta_id === prod.receta_id;
        if (matchNombre || matchReceta) {
          total += Math.max(0, Number(l.cantidad_producida) - (Number(l.merma_cantidad) || 0));
        }
      }
      m.set(prod.id, total);
    }
    return m;
  }, [productos, lotes, local]);

  // Solo los controlados van al catálogo; los demás aparecen en la sección
  // colapsable "Sin control de stock" (abajo, admin) para re-activarlos.
  const productosCatalogo = useMemo(
    () =>
      productos.filter(
        (p) => p.local === local && p.activo && p.controla_stock !== false,
      ),
    [productos, local],
  );

  return (
    <div className="space-y-6">
      {tipos.map(({ tipo, titulo }) => {
        const filas = productosCatalogo
          .filter((p) => p.tipo === tipo)
          .sort((a, b) => a.nombre.localeCompare(b.nombre));
        if (filas.length === 0) return null;
        return (
          <div key={tipo} className="space-y-2">
            <h3 className="text-base font-semibold text-gray-800">
              {titulo}{' '}
              <span className="text-sm font-normal capitalize text-gray-500">
                · {local}
              </span>
            </h3>
            <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-4 py-2">Producto</th>
                    <th className="px-4 py-2">Código</th>
                    <th className="px-4 py-2 text-right">Stock</th>
                    <th className="px-4 py-2">Unidad</th>
                    <th className="px-4 py-2">Mín.</th>
                    <th className="px-4 py-2">Estado</th>
                    {esAdmin && <th className="px-4 py-2 text-center">Control</th>}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((p) => {
                    const stock = stockPorProducto.get(p.id) ?? 0;
                    const min = p.minimo_produccion ?? 0;
                    const estado =
                      stock <= 0 ? 'sin-stock' : min && stock < min ? 'bajo' : 'ok';
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          'border-b border-surface-border',
                          estado === 'sin-stock' && 'bg-red-50',
                          estado === 'bajo' && 'bg-yellow-50',
                        )}
                      >
                        <td className="px-4 py-2 font-medium">{p.nombre}</td>
                        <td className="px-4 py-2 font-mono text-xs">{p.codigo}</td>
                        <td className="px-4 py-2 text-right font-semibold">{stock}</td>
                        <td className="px-4 py-2 text-gray-500">{p.unidad}</td>
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
                        {esAdmin && (
                          <td className="px-4 py-2 text-center">
                            <ControlToggle
                              on
                              disabled={toggleDisabled}
                              onToggle={() => onQuitarControl(p.id)}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {isLoading && (
        <p className="text-xs text-gray-400">Cargando stock…</p>
      )}
      <p className="text-[11px] text-gray-400">
        Stock = última carga en Producción ("último pesaje manda"), sin descuento
        automático por venta.
        {local === 'saavedra' &&
          ' Saavedra produce y almacena en la misma cámara.'}
      </p>
    </div>
  );
}

// ── Toggle de control de stock (solo admin) ──────────────────────────────────

function ControlToggle({
  on,
  onToggle,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      title={on ? 'Quitar del control de stock' : 'Volver a controlar el stock'}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        on ? 'bg-green-500' : 'bg-gray-300',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

// ── Sección "Sin control de stock" (colapsable, solo admin) ──────────────────
// Lista los productos del local activo que el admin sacó del control de stock,
// con su toggle para volver a controlarlos. El cocinero no ve esta sección.

const TIPO_LABEL_SIN_CONTROL: Record<string, string> = {
  pasta: 'Pasta',
  milanesa: 'Milanesa',
  postre: 'Postre',
  panificado: 'Pan',
  salsa: 'Salsa',
  relleno: 'Relleno',
  masa: 'Masa',
  bebida: 'Bebida',
};

function SinControlSection({
  productos,
  filtroLocal,
  onReactivar,
  toggleDisabled,
}: {
  productos: Producto[];
  filtroLocal: FiltroLocal;
  onReactivar: (id: string) => void;
  toggleDisabled: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const items = useMemo(
    () =>
      productos
        .filter(
          (p) => p.local === filtroLocal && p.activo && p.controla_stock === false,
        )
        .sort(
          (a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre),
        ),
    [productos, filtroLocal],
  );

  return (
    <div className="pt-6">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-2 text-base font-semibold text-gray-800"
      >
        <span className="text-xs">{abierto ? '▼' : '▶'}</span>
        Sin control de stock
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {items.length}
        </span>
      </button>

      {abierto && (
        <div className="mt-3">
          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
              Todos los productos de{' '}
              <span className="capitalize">{filtroLocal}</span> están bajo control de
              stock.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-surface-border bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-4 py-2">Producto</th>
                    <th className="px-4 py-2">Tipo</th>
                    <th className="px-4 py-2">Código</th>
                    <th className="px-4 py-2 text-center">Control</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-b border-surface-border">
                      <td className="px-4 py-2 font-medium text-gray-600">{p.nombre}</td>
                      <td className="px-4 py-2 text-gray-500">
                        {TIPO_LABEL_SIN_CONTROL[p.tipo] ?? p.tipo}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">
                        {p.codigo}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <ControlToggle
                          on={false}
                          disabled={toggleDisabled}
                          onToggle={() => onReactivar(p.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

