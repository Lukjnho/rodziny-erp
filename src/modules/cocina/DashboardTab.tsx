import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { ProximasEfemeridesCard } from './components/ProximasEfemeridesCard';

// ── Productos que el chef controla ──────────────────────────────────────────
// tipo determina unidad de medida y cálculo de porciones
export type TipoProducto = 'salsa' | 'postre' | 'pasta';

export interface ProductoCocina {
  nombre: string;
  fudoNombres?: string[];
  tipo: TipoProducto;
  categoria: string; // Categoría visual para agrupar en accordion
  gramosporcion: number;
  porcionesporunidad: number;
  unidadstock: string;
  diasObjetivo: number;
  local?: 'vedia' | 'saavedra';
}

export const PRODUCTOS_COCINA: ProductoCocina[] = [
  // ════════════════════════════════════════════════════════════════
  // SALSAS (ambos locales — stock en kg, porción referencia ~200g)
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Bolognesa',
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
  },
  {
    nombre: 'Ragú de Roast Beef',
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
  },
  {
    nombre: 'Parisienne',
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
  },
  {
    nombre: 'Scarparo',
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
  },
  {
    nombre: 'Rosé',
    fudoNombres: ['Rosé', 'Rose'],
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
  },
  {
    nombre: 'Crema Blanca',
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
  },
  {
    nombre: 'Amatriciana',
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
    local: 'vedia',
  },
  {
    nombre: 'Pomodoro',
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
    local: 'saavedra',
  },

  // ════════════════════════════════════════════════════════════════
  // PASTAS — Vedia (salón + vianda + congelada se suman)
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Sorrentino J&Q',
    fudoNombres: [
      'Sorrentino Jamón, Queso y Cebollas',
      'Sorrentino Jamón, Cebollas y Quesos VIANDA',
      'Sorrentino de Jamón, Quesos y Cebollas Confitadas CONGELADA',
    ],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'vedia',
  },
  {
    nombre: 'Ñoquis de Papa',
    fudoNombres: ['Ñoquis de Papa', 'Ñoquis de Papa VIANDA'],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'vedia',
  },
  {
    nombre: 'Ravioli espinaca y quesos',
    fudoNombres: [
      'Ravioli de espinaca y quesos',
      'Ravioli de espinaca y quesos VIANDA',
      'Ravioli espinaca y quesos CONGELADA',
    ],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'vedia',
  },
  {
    nombre: 'Ñoquis rellenos',
    fudoNombres: ['Ñoquis rellenos', 'Ñoquis rellenos VIANDA'],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
  },
  {
    nombre: 'Scapinocc Vacio',
    fudoNombres: [
      'Scapinocc Vacio de cerdo, cerveza y barbacoa',
      'Scapinocc Vacio de cerdo, cerveza y barbacoa VIANDA',
    ],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'vedia',
  },
  {
    nombre: 'Cappelletti pollo',
    fudoNombres: ['Cappelletti de pollo y puerro', 'Cappelletti de pollo y puerro VIANDA'],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'vedia',
  },
  {
    nombre: 'Tagliatelles al Huevo',
    fudoNombres: ['Tagliatelles al Huevo', 'Tagliatelles al Huevo VIANDA'],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'vedia',
  },
  {
    nombre: 'Tagliatelles mix',
    fudoNombres: ['Tagliatelles mix', 'Tagliatelles Mixtos VIANDA', 'Tagliatelles mix CONGELADA'],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'vedia',
  },

  // ════════════════════════════════════════════════════════════════
  // PASTAS — Saavedra (salón + congelada se suman)
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Mila napo + fideos',
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Ñoquis de papa',
    fudoNombres: ['Ñoquis de papa'],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Cappelletti Capresse',
    fudoNombres: ['Cappelletti Capresse', 'Cappelletti Capresse (CONGELADA)'],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Scarpinocc J&Q',
    fudoNombres: [
      'Scarpinocc de Jamón, Quesos y cebollas caramelizadas',
      'Scarpinocc de Jamón, Quesos y cebollas caramelizadas (CONGELADA)',
    ],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Mezzelune de Bondiola',
    fudoNombres: ['Mezzelune de Bondiola Braseada', 'Mezzelune de Bondiola Braseada (CONGELADA)'],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Spaghetti al huevo',
    fudoNombres: ['Spaghetti al huevo', 'Spaghettis al huevo (CONGELADOS)'],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'saavedra',
  },

  // ════════════════════════════════════════════════════════════════
  // PIZZAS — Saavedra
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Pizza Especial',
    categoria: 'Pizzas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Pizza Napolitana',
    categoria: 'Pizzas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Pizza Muzzarella',
    categoria: 'Pizzas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 2,
    local: 'saavedra',
  },

  // ════════════════════════════════════════════════════════════════
  // POSTRES — Vedia
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Flan',
    fudoNombres: ['Flan', 'Flan M.E'],
    categoria: 'Postres',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
  },
  {
    nombre: 'Tiramisú',
    fudoNombres: ['Tiramisú', 'Tiramisu', 'Tiramisu M.E'],
    categoria: 'Postres',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
  },
  {
    nombre: 'Budín de pan',
    fudoNombres: ['Budín de pan', 'Budin de Pan M.E'],
    categoria: 'Postres',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'vedia',
  },

  // ════════════════════════════════════════════════════════════════
  // HELADOS — Vedia
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Helado soft americana',
    categoria: 'Helados',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 2,
    local: 'vedia',
  },
  {
    nombre: 'Helado soft pistacho',
    categoria: 'Helados',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 2,
    local: 'vedia',
  },
  {
    nombre: 'Helado soft mixto',
    categoria: 'Helados',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 2,
    local: 'vedia',
  },

  // ════════════════════════════════════════════════════════════════
  // POSTRES/TORTAS — Saavedra
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Cheese cake',
    fudoNombres: ['Cheese cake (porcion)', 'Cheesecake (ALMACEN)'],
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Brownie',
    fudoNombres: ['Brownie (porcion)', 'Torta brownie ( ALMACEN)'],
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Matilda',
    fudoNombres: ['Matilda (porcion)'],
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Carrot cake',
    fudoNombres: ['Carrot cake (porcion)'],
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Lemon pie',
    fudoNombres: ['Lemon pie (porcion)'],
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Tarta Vasca',
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },

  // ════════════════════════════════════════════════════════════════
  // DESAYUNOS Y MERIENDAS — Saavedra
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Facturas',
    categoria: 'Desayunos y Meriendas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'unidades',
    diasObjetivo: 1,
    local: 'saavedra',
  },
  {
    nombre: 'Medialuna Dulce',
    categoria: 'Desayunos y Meriendas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'unidades',
    diasObjetivo: 1,
    local: 'saavedra',
  },
  {
    nombre: 'Cookies choco',
    fudoNombres: ['Cookies con chips de chocolate'],
    categoria: 'Desayunos y Meriendas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Cookies avellanas',
    fudoNombres: ['Cookies de chocolate con crema de avellanas'],
    categoria: 'Desayunos y Meriendas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },

  // ════════════════════════════════════════════════════════════════
  // SALADOS — Saavedra
  // ════════════════════════════════════════════════════════════════
  {
    nombre: 'Chipa (200g)',
    categoria: 'Salados',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'unidades',
    diasObjetivo: 1,
    local: 'saavedra',
  },
  {
    nombre: 'Mbejú clasico',
    fudoNombres: ['Mbejú clasico', 'Mbeju de jamon y queso'],
    categoria: 'Salados',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'unidades',
    diasObjetivo: 1,
    local: 'saavedra',
  },
];

// Orden fijo de categorías para mostrar
const ORDEN_CATEGORIAS = [
  'Salsas',
  'Pastas',
  'Pizzas',
  'Postres',
  'Helados',
  'Postres/Tortas',
  'Desayunos y Meriendas',
  'Salados',
];

interface ConteoStock {
  id: string;
  producto: string;
  fecha: string;
  cantidad: number; // kg para salsas, unidades para postres
  local: string;
  responsable: string | null;
  created_at: string;
}

interface FudoProductoRanking {
  nombre: string;
  cantidad: number;
  facturacion: number;
  categoria: string;
}

interface FudoData {
  dias: number;
  ranking: FudoProductoRanking[];
  porDiaSemana: Record<number, { tickets: number; total: number }>;
  porHora: Record<number, { tickets: number; total: number }>;
}

interface ProductoDB {
  nombre: string;
  local: string;
  tipo: string;
  receta_id: string | null;
  minimo_produccion: number | null;
  receta_nombre: string | null;
  rendimiento_porciones: number | null;
  rendimiento_kg: number | null;
}

// Fila derivada para renderizar la grilla del dashboard. La usan tanto el
// componente principal como CategoriaAccordion/generarPizarron.
export type FilaDashboard = ProductoCocina & {
  stockCantidad: number | null;
  stockFecha: string | null;
  porcionesStock: number;
  ventasDiariasPromedio: number;
  ventasDiariasAjustadas: number;
  ventasReciente: number;
  diasRestantes: number | null;
  producirLabel: string;
  producirCantidad: number;
  estado: 'ok' | 'bajo' | 'critico' | 'sin_datos';
  recetaNombre: string | null;
  rendPorciones: number | null;
  // Lotes registrados en QR (solo aplica a tipo === 'pasta').
  enCamaraPorciones: number;
  enColaPorciones: number;
  stockEsFallback: boolean; // true si stockCantidad es null y usamos cámara como aproximación
};

// Shape crudo devuelto por Supabase para la query de cocina_productos con receta
// embebida. Supabase no infiere bien estos joins, por eso lo declaramos.
type ProductoDBRow = {
  nombre: string;
  local: string;
  tipo: string;
  receta_id: string | null;
  minimo_produccion: number | null;
  receta: {
    nombre: string;
    rendimiento_porciones: number | null;
    rendimiento_kg: number | null;
  } | null;
};

// Stock derivado de la vista v_cocina_stock_pastas (lotes registrados en QR).
// Se usa para mostrar bandejas en cola y como fallback cuando no hay conteo manual.
interface StockPastaDB {
  porcionesCamara: number;
  porcionesFresco: number;
  porcionesTraspasadas: number;
  porcionesMerma: number;
  porcionesVendibles: number; // camara - traspasos - merma
}

// Normaliza nombres para matchear entre PRODUCTOS_COCINA y la tabla cocina_productos.
export function normNombre(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

// Piso de producción para pastas: siempre al menos 100 porciones si hay que producir.
const PISO_PORCIONES_PASTA = 100;

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// ── Componente ──────────────────────────────────────────────────────────────
export function DashboardTab() {
  const qc = useQueryClient();
  const [local, setLocal] = useState<'vedia' | 'saavedra'>('vedia');
  const [ventanaDias, setVentanaDias] = useState<1 | 3 | 7>(3);
  // Fechas calculadas una sola vez al montar el componente (evita el warning de
  // react-hooks/purity de React 19 por llamar Date.now() en render) y estabiliza
  // las queryKey de react-query.
  const hoy = useMemo(() => new Date().toISOString().split('T')[0], []);
  const hace14 = useMemo(
    () => new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0],
    [],
  );
  const ventanaHasta = useMemo(
    () => new Date(Date.now() - 86400000).toISOString().split('T')[0],
    [],
  );
  const ventanaDesde = useMemo(
    () => new Date(Date.now() - ventanaDias * 86400000).toISOString().split('T')[0],
    [ventanaDias],
  );
  const dowManana = useMemo(() => new Date(Date.now() + 86400000).getDay(), []);

  // ── Query: productos BD con receta vinculada (para saber rendimiento y mínimos) ──
  const { data: productosDB } = useQuery({
    queryKey: ['cocina_productos_dashboard', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select(
          'nombre, local, tipo, receta_id, minimo_produccion, receta:cocina_recetas(nombre, rendimiento_porciones, rendimiento_kg)',
        )
        .eq('local', local)
        .eq('activo', true);
      if (error) throw error;
      const filas: ProductoDB[] = (data as unknown as ProductoDBRow[]).map((r) => ({
        nombre: r.nombre,
        local: r.local,
        tipo: r.tipo,
        receta_id: r.receta_id,
        minimo_produccion: r.minimo_produccion,
        receta_nombre: r.receta?.nombre ?? null,
        rendimiento_porciones: r.receta?.rendimiento_porciones ?? null,
        rendimiento_kg: r.receta?.rendimiento_kg ?? null,
      }));
      const m = new Map<string, ProductoDB>();
      for (const p of filas) m.set(normNombre(p.nombre), p);
      return m;
    },
  });

  // ── Query: stock de pastas derivado de lotes registrados en QR ──
  // La vista v_cocina_stock_pastas suma porciones por ubicación
  // (cámara_congelado vs freezer_produccion) descontando traspasos y merma.
  // Mostramos las bandejas "en cola" y usamos las de cámara como fallback
  // cuando no hay conteo manual reciente del chef.
  const { data: stockPastasDB } = useQuery({
    queryKey: ['cocina_stock_pastas', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cocina_stock_pastas')
        .select(
          'nombre, porciones_camara, porciones_fresco, porciones_traspasadas, porciones_merma',
        )
        .eq('local', local);
      if (error) throw error;
      const m = new Map<string, StockPastaDB>();
      for (const r of (data ?? []) as Array<{
        nombre: string;
        porciones_camara: number | null;
        porciones_fresco: number | null;
        porciones_traspasadas: number | null;
        porciones_merma: number | null;
      }>) {
        const camara = Number(r.porciones_camara) || 0;
        const fresco = Number(r.porciones_fresco) || 0;
        const traspasos = Number(r.porciones_traspasadas) || 0;
        const merma = Number(r.porciones_merma) || 0;
        m.set(normNombre(r.nombre), {
          porcionesCamara: camara,
          porcionesFresco: fresco,
          porcionesTraspasadas: traspasos,
          porcionesMerma: merma,
          porcionesVendibles: Math.max(0, camara - traspasos - merma),
        });
      }
      return m;
    },
    // Refetch periódico mientras la pestaña está activa para reflejar lotes
    // recién registrados desde el QR (cubre el caso multi-pestaña / multi-dispositivo).
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // ── Query: último conteo de stock por producto ──
  const { data: conteos } = useQuery({
    queryKey: ['cocina_conteo_stock', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_conteo_stock')
        .select('*')
        .eq('local', local)
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Agrupar: quedarse con el más reciente por producto
      const porProducto = new Map<string, ConteoStock>();
      for (const c of data as ConteoStock[]) {
        if (!porProducto.has(c.producto)) porProducto.set(c.producto, c);
      }
      return porProducto;
    },
  });

  // ── Query: ventas promedio de Fudo (últimos 14 días) ──
  const { data: fudoData, isLoading: fudoLoading } = useQuery({
    queryKey: ['fudo-consumo', local, hace14, hoy],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local, fechaDesde: hace14, fechaHasta: hoy },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? 'Error');
      return data.data as FudoData;
    },
    staleTime: 10 * 60 * 1000,
  });

  // ── Query: ventas de la VENTANA reciente (configurable: 1/3/7 días) ──
  // Termina ayer (no incluye hoy porque el día está incompleto).
  const { data: fudoReciente } = useQuery({
    queryKey: ['fudo-consumo-reciente', local, ventanaDesde, ventanaHasta],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fudo-productos', {
        body: { local, fechaDesde: ventanaDesde, fechaHasta: ventanaHasta },
      });
      if (error) return null;
      if (!data?.ok) return null;
      return data.data as FudoData;
    },
    staleTime: 30 * 60 * 1000,
  });

  // ── Mutation: guardar conteo de stock ──
  const guardarConteo = useMutation({
    mutationFn: async (payload: { producto: string; cantidad: number }) => {
      const { error } = await supabase.from('cocina_conteo_stock').insert({
        producto: payload.producto,
        cantidad: payload.cantidad,
        fecha: hoy,
        local,
        responsable: 'Chef',
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cocina_conteo_stock'] }),
  });

  // ── Factor por día de semana (mañana importa más que promedio) ──
  // Calcula cuánto se vende un día X vs el promedio general
  const factorManana = useMemo(() => {
    if (!fudoData?.porDiaSemana) return 1;
    const dataPorDia = fudoData.porDiaSemana;
    const dias = Object.keys(dataPorDia);
    if (dias.length === 0) return 1;
    const totalTickets = Object.values(dataPorDia).reduce((s, d) => s + d.tickets, 0);
    const promedioTicketsPorDia = totalTickets / dias.length;
    const ticketsManana = dataPorDia[dowManana]?.tickets ?? promedioTicketsPorDia;
    if (promedioTicketsPorDia === 0) return 1;
    return ticketsManana / promedioTicketsPorDia;
  }, [fudoData, dowManana]);

  const diaManana = DIAS_SEMANA[dowManana];

  // ── Calcular datos por producto ──
  const filas = useMemo(() => {
    // Filtrar productos por local
    const productosLocal = PRODUCTOS_COCINA.filter((p) => !p.local || p.local === local);

    return productosLocal.map((prod) => {
      // Stock actual (último conteo)
      const conteo = conteos?.get(prod.nombre);
      const stockCantidad = conteo?.cantidad ?? null;
      const stockFecha = conteo?.fecha ?? null;

      // Stock derivado de lotes registrados en QR (solo pastas).
      // Vendibles = porciones en cámara − traspasos − merma. En cola = freezer producción.
      const stockDB =
        prod.tipo === 'pasta' ? (stockPastasDB?.get(normNombre(prod.nombre)) ?? null) : null;
      const enCamaraPorciones = stockDB?.porcionesVendibles ?? 0;
      const enColaPorciones = stockDB?.porcionesFresco ?? 0;

      // Ventas diarias promedio desde Fudo
      const nombres = prod.fudoNombres ?? [prod.nombre];
      let ventasTotal = 0;
      for (const n of nombres) {
        const fudoProd = fudoData?.ranking.find((r) => r.nombre.toLowerCase() === n.toLowerCase());
        if (fudoProd) ventasTotal += fudoProd.cantidad;
      }
      const ventasDiariasPromedio = fudoData && fudoData.dias > 0 ? ventasTotal / fudoData.dias : 0;

      // Venta ajustada por día de semana (para sugerencia de producción)
      const ventasDiariasAjustadas = ventasDiariasPromedio * factorManana;

      // Ventas de la ventana reciente para este producto (promedio diario)
      let ventasReciente = 0;
      if (fudoReciente?.ranking) {
        for (const n of nombres) {
          const p = fudoReciente.ranking.find((r) => r.nombre.toLowerCase() === n.toLowerCase());
          if (p) ventasReciente += p.cantidad;
        }
      }
      const diasReciente = fudoReciente?.dias ?? ventanaDias;
      const ventasRecientePromedio =
        diasReciente > 0 ? Math.round((ventasReciente / diasReciente) * 10) / 10 : 0;

      // Calcular porciones aprox del stock (redondeo al alza: el chef prefiere un estimado conservador)
      let porcionesStock = 0;
      let stockEsFallback = false;
      if (stockCantidad !== null) {
        if (prod.tipo === 'salsa') {
          porcionesStock = Math.ceil((stockCantidad * 1000) / prod.gramosporcion);
        } else {
          porcionesStock = Math.ceil(stockCantidad * prod.porcionesporunidad);
        }
      } else if (prod.tipo === 'pasta' && enCamaraPorciones > 0) {
        // Sin conteo manual: usamos las porciones en cámara como aproximación
        // para no decir "sin datos" cuando la DB ya sabe que hay stock.
        porcionesStock = enCamaraPorciones;
        stockEsFallback = true;
      }

      // Días de stock restante (usar ajustada para ser conservador)
      const ventasParaCalculo = Math.max(ventasDiariasPromedio, ventasDiariasAjustadas);
      const tieneStock = stockCantidad !== null || stockEsFallback;
      const diasRestantes =
        ventasParaCalculo > 0 && tieneStock ? porcionesStock / ventasParaCalculo : null;

      // Match con tabla BD para obtener receta vinculada y mínimos
      const prodDB = productosDB?.get(normNombre(prod.nombre)) ?? null;
      const rendPorciones = prodDB?.rendimiento_porciones ?? null;
      const rendKg = prodDB?.rendimiento_kg ?? null;
      const minimoBD = prodDB?.minimo_produccion ?? null;

      // Producción sugerida: demanda proyectada × días de cobertura
      // Con piso: para pastas, mínimo 100 porciones (o lo configurado en BD). Para otros, usar minimo_produccion si está.
      let porcionesObjetivo = ventasDiariasAjustadas * prod.diasObjetivo;
      if (prod.tipo === 'pasta') {
        const piso = minimoBD ?? PISO_PORCIONES_PASTA;
        porcionesObjetivo = Math.max(porcionesObjetivo, piso);
      } else if (minimoBD != null && minimoBD > 0) {
        porcionesObjetivo = Math.max(porcionesObjetivo, minimoBD);
      }
      const porcionesFaltantes = Math.max(0, porcionesObjetivo - porcionesStock);

      // Convertir a unidad de stock + armar label en "N recetas" si hay rendimiento.
      let producirCantidad = 0;
      let producirLabel = '';
      if (prod.tipo === 'salsa') {
        const kgNecesarios = (porcionesFaltantes * prod.gramosporcion) / 1000;
        if (rendKg && rendKg > 0 && kgNecesarios > 0) {
          const recetas = Math.ceil(kgNecesarios / rendKg);
          producirCantidad = recetas;
          producirLabel = `${recetas} receta${recetas !== 1 ? 's' : ''} (~${Math.ceil(kgNecesarios * 10) / 10} kg)`;
        } else {
          producirCantidad = Math.ceil(kgNecesarios * 10) / 10;
          producirLabel = `${producirCantidad} kg`;
        }
      } else if (prod.tipo === 'pasta') {
        const porcReales = Math.ceil(porcionesFaltantes);
        if (rendPorciones && rendPorciones > 0 && porcReales > 0) {
          const recetas = Math.ceil(porcReales / rendPorciones);
          producirCantidad = recetas;
          producirLabel = `${recetas} receta${recetas !== 1 ? 's' : ''} (~${recetas * rendPorciones} porc.)`;
        } else {
          producirCantidad = porcReales;
          producirLabel = `${producirCantidad} porc.`;
        }
      } else {
        const unidades = Math.ceil(porcionesFaltantes / prod.porcionesporunidad);
        if (rendPorciones && rendPorciones > 0 && porcionesFaltantes > 0) {
          const recetas = Math.ceil(porcionesFaltantes / rendPorciones);
          producirCantidad = recetas;
          producirLabel = `${recetas} receta${recetas !== 1 ? 's' : ''} (~${recetas * rendPorciones} porc.)`;
        } else {
          producirCantidad = unidades;
          producirLabel = `${unidades} unidad${unidades !== 1 ? 'es' : ''}`;
        }
      }

      // Estado semáforo
      let estado: 'ok' | 'bajo' | 'critico' | 'sin_datos' = 'sin_datos';
      if (diasRestantes !== null) {
        if (diasRestantes >= prod.diasObjetivo) estado = 'ok';
        else if (diasRestantes >= 1) estado = 'bajo';
        else estado = 'critico';
      }

      return {
        ...prod,
        stockCantidad,
        stockFecha,
        porcionesStock,
        // Redondeo al alza para ventas y porciones: el chef prefiere un poco de más al decidir producción
        ventasDiariasPromedio: Math.ceil(ventasDiariasPromedio),
        ventasDiariasAjustadas: Math.ceil(ventasDiariasAjustadas),
        ventasReciente: Math.ceil(ventasRecientePromedio),
        diasRestantes: diasRestantes !== null ? Math.round(diasRestantes * 10) / 10 : null,
        producirLabel,
        producirCantidad,
        estado,
        recetaNombre: prodDB?.receta_nombre ?? null,
        rendPorciones,
        enCamaraPorciones,
        enColaPorciones,
        stockEsFallback,
      };
    });
  }, [
    conteos,
    fudoData,
    fudoReciente,
    factorManana,
    ventanaDias,
    productosDB,
    stockPastasDB,
    local,
  ]);

  // Agrupar filas por categoría, en orden definido
  const categorias = useMemo(() => {
    const grupos = new Map<string, typeof filas>();
    for (const f of filas) {
      const cat = f.categoria;
      if (!grupos.has(cat)) grupos.set(cat, []);
      grupos.get(cat)!.push(f);
    }
    // Ordenar por ORDEN_CATEGORIAS, y si aparece alguna nueva al final
    return ORDEN_CATEGORIAS.filter((c) => grupos.has(c)).map((c) => ({
      nombre: c,
      filas: grupos.get(c)!,
    }));
  }, [filas]);

  // ── Estado inline para edición rápida ──
  const [editando, setEditando] = useState<string | null>(null);
  const [valorEdit, setValorEdit] = useState('');

  function iniciarEdicion(producto: string, valorActual: number | null) {
    setEditando(producto);
    setValorEdit(valorActual !== null ? String(valorActual) : '');
  }

  function guardar(producto: string) {
    const n = parseFloat(valorEdit.replace(',', '.'));
    if (!isNaN(n) && n >= 0) {
      guardarConteo.mutate({ producto, cantidad: n });
    }
    setEditando(null);
    setValorEdit('');
  }

  // ── KPIs resumen ──
  const countOk = filas.filter((f) => f.estado === 'ok').length;
  const countBajo = filas.filter((f) => f.estado === 'bajo').length;
  const countCritico = filas.filter((f) => f.estado === 'critico').length;
  const countSinDatos = filas.filter((f) => f.estado === 'sin_datos').length;

  // ── Plan de producción: items que necesitan producción, ordenados por urgencia ──
  // Incluye items con stock por conteo manual y los que estimamos por lotes (fallback).
  const planProduccion = filas
    .filter((f) => f.producirCantidad > 0 && (f.stockCantidad !== null || f.stockEsFallback))
    .sort((a, b) => (a.diasRestantes ?? 0) - (b.diasRestantes ?? 0));

  // ── Pizarrón ──
  const [pizarronAbierto, setPizarronAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  function generarPizarron(): string {
    const hoyFmt = new Date().toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const localLabel = local === 'vedia' ? 'Vedia' : 'Saavedra';

    let txt = `COCINA ${localLabel.toUpperCase()} — ${hoyFmt.charAt(0).toUpperCase() + hoyFmt.slice(1)}\n`;
    txt += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    // Urgentes primero
    const criticos = filas.filter((f) => f.estado === 'critico');
    if (criticos.length > 0) {
      txt += 'URGENTE:\n';
      for (const f of criticos) {
        txt += `  !! ${f.nombre} — ${f.diasRestantes !== null ? f.diasRestantes + ' días' : 'sin stock'}\n`;
      }
      txt += '\n';
    }

    // Producir hoy — agrupado por categoría
    if (planProduccion.length > 0) {
      txt += `PRODUCIR PARA ${diaManana.toUpperCase()}:\n`;
      let lastCat = '';
      for (const f of planProduccion) {
        if (f.categoria !== lastCat) {
          txt += `  [${f.categoria}]\n`;
          lastCat = f.categoria;
        }
        const urgencia = f.estado === 'critico' ? ' !!' : '';
        const verbo = f.rendPorciones && f.rendPorciones > 0 ? 'Hacer' : 'Producir';
        txt += `    * ${verbo} ${f.producirLabel} de ${f.nombre}${urgencia}\n`;
      }
      txt += '\n';
    }

    // Stock por categoría
    for (const cat of categorias) {
      const okEnCat = cat.filas.filter((f) => f.estado === 'ok');
      const bajoEnCat = cat.filas.filter((f) => f.estado === 'bajo');
      if (okEnCat.length === 0 && bajoEnCat.length === 0) continue;

      txt += `${cat.nombre.toUpperCase()}:\n`;
      const fmtStock = (f: FilaDashboard) =>
        f.stockCantidad !== null
          ? `${f.stockCantidad} ${f.unidadstock}`
          : f.stockEsFallback
            ? `~${f.porcionesStock} porc.`
            : '—';
      for (const f of okEnCat) {
        txt += `  OK  ${f.nombre} — ${f.diasRestantes}d (${fmtStock(f)})\n`;
      }
      for (const f of bajoEnCat) {
        txt += `  *   ${f.nombre} — ${f.diasRestantes}d (${fmtStock(f)})\n`;
      }
      txt += '\n';
    }

    // Nota mañana
    const factorPct = Math.round((factorManana - 1) * 100);
    if (factorPct !== 0) {
      txt += `NOTA: Mañana ${diaManana} (${factorPct >= 0 ? '+' : ''}${factorPct}% ventas vs promedio)\n`;
    }

    return txt;
  }

  function copiarPizarron() {
    const txt = generarPizarron();
    navigator.clipboard.writeText(txt);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-4">
        <LocalSelector value={local} onChange={(v) => setLocal(v as 'vedia' | 'saavedra')} />
        <button
          onClick={() => setPizarronAbierto(true)}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700"
        >
          Pizarron
        </button>
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
          <span className="px-2 text-[10px] text-gray-500">Comparar:</span>
          {([1, 3, 7] as const).map((n) => (
            <button
              key={n}
              onClick={() => setVentanaDias(n)}
              className={cn(
                'rounded px-2.5 py-1 text-xs transition-colors',
                ventanaDias === n
                  ? 'bg-rodziny-700 font-medium text-white'
                  : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {n === 1 ? 'Ayer' : `${n}d`}
            </button>
          ))}
        </div>
        {fudoLoading && (
          <span className="animate-pulse text-xs text-gray-400">Cargando ventas de Fudo...</span>
        )}
        {fudoData && (
          <span className="ml-auto text-xs text-gray-400">
            Promedios últimos {fudoData.dias} días · Ajuste {diaManana}:{' '}
            {factorManana >= 1 ? '+' : ''}
            {Math.round((factorManana - 1) * 100)}%
          </span>
        )}
      </div>

      {/* ── KPIs RESUMEN ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-green-700">{countOk}</div>
          <div className="text-[10px] font-medium uppercase text-green-600">OK</div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-amber-700">{countBajo}</div>
          <div className="text-[10px] font-medium uppercase text-amber-600">Stock bajo</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-red-700">{countCritico}</div>
          <div className="text-[10px] font-medium uppercase text-red-600">Urgente</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-gray-500">{countSinDatos}</div>
          <div className="text-[10px] font-medium uppercase text-gray-400">Sin contar</div>
        </div>
      </div>

      {/* ── PRÓXIMAS EFEMÉRIDES ── */}
      <ProximasEfemeridesCard diasAdelante={15} />

      {/* ── PLAN DE PRODUCCIÓN DEL DÍA ── */}
      {planProduccion.length > 0 && (
        <div className="border-rodziny-200 rounded-lg border bg-rodziny-50 p-4">
          <h3 className="mb-1 text-sm font-bold text-rodziny-800">
            Plan de producción — preparar para {diaManana}
          </h3>
          <p className="mb-2 text-[11px] text-rodziny-600">
            Sugerencias en base a ventas y stock. El cheff decide qué y cuánto hacer.
          </p>
          <div className="flex flex-wrap gap-2">
            {planProduccion.map((item) => {
              const usaRecetas = item.rendPorciones && item.rendPorciones > 0;
              const verboSug = usaRecetas ? 'Hacer' : 'Producir';
              return (
                <span
                  key={item.nombre}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
                    item.estado === 'critico'
                      ? 'bg-red-100 text-red-800 ring-1 ring-red-300'
                      : 'bg-amber-100 text-amber-800 ring-1 ring-amber-300',
                  )}
                >
                  <span className="font-bold">
                    {verboSug} {item.producirLabel}
                  </span>
                  <span>de {item.nombre}</span>
                  {item.diasRestantes !== null && (
                    <span className="text-[10px] opacity-70">· te dura {item.diasRestantes}d</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── CATEGORÍAS ACCORDION ── */}
      {categorias.map((cat) => (
        <CategoriaAccordion
          key={cat.nombre}
          nombre={cat.nombre}
          filas={cat.filas}
          diaManana={diaManana}
          ventanaDias={ventanaDias}
          editando={editando}
          valorEdit={valorEdit}
          onIniciarEdicion={iniciarEdicion}
          onCambiarValor={setValorEdit}
          onGuardar={guardar}
          onCancelar={() => setEditando(null)}
        />
      ))}

      {/* ── MODAL PIZARRÓN ── */}
      {pizarronAbierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setPizarronAbierto(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-gray-900 p-6 font-mono text-green-400 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                Pizarron del dia
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={copiarPizarron}
                  className={cn(
                    'rounded px-3 py-1 text-xs font-medium transition-colors',
                    copiado
                      ? 'bg-green-700 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                  )}
                >
                  {copiado ? 'Copiado!' : 'Copiar texto'}
                </button>
                <button
                  onClick={() => setPizarronAbierto(false)}
                  className="text-lg text-gray-500 hover:text-gray-300"
                >
                  x
                </button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed">{generarPizarron()}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Categoría accordion ─────────────────────────────────────────────────────
function CategoriaAccordion({
  nombre,
  filas,
  diaManana,
  ventanaDias,
  editando,
  valorEdit,
  onIniciarEdicion,
  onCambiarValor,
  onGuardar,
  onCancelar,
}: {
  nombre: string;
  filas: FilaDashboard[];
  diaManana: string;
  ventanaDias: 1 | 3 | 7;
  editando: string | null;
  valorEdit: string;
  onIniciarEdicion: (producto: string, valorActual: number | null) => void;
  onCambiarValor: (v: string) => void;
  onGuardar: (producto: string) => void;
  onCancelar: () => void;
}) {
  const [abierto, setAbierto] = useState(true);

  const countOk = filas.filter((f) => f.estado === 'ok').length;
  const countBajo = filas.filter((f) => f.estado === 'bajo').length;
  const countCritico = filas.filter((f) => f.estado === 'critico').length;
  const countSinDatos = filas.filter((f) => f.estado === 'sin_datos').length;

  return (
    <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
      {/* Header clickeable */}
      <button
        onClick={() => setAbierto(!abierto)}
        className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
      >
        <span className={cn('text-xs transition-transform', abierto ? 'rotate-90' : 'rotate-0')}>
          &#9654;
        </span>
        <h3 className="text-sm font-semibold text-gray-800">{nombre}</h3>
        <span className="text-xs text-gray-400">
          {filas.length} producto{filas.length !== 1 ? 's' : ''}
        </span>

        {/* Mini badges resumen en la fila del header */}
        <div className="ml-auto flex items-center gap-1.5">
          {countCritico > 0 && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
              {countCritico} urgente
            </span>
          )}
          {countBajo > 0 && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              {countBajo} bajo
            </span>
          )}
          {countOk > 0 && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700">
              {countOk} ok
            </span>
          )}
          {countSinDatos > 0 && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
              {countSinDatos} sin datos
            </span>
          )}
        </div>
      </button>

      {/* Contenido expandible */}
      {abierto && (
        <div className="overflow-x-auto border-t border-gray-100">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr className="text-[10px] uppercase text-gray-500">
                <th className="px-4 py-2.5 text-left">Producto</th>
                <th className="px-4 py-2.5 text-center">Estado</th>
                <th className="px-4 py-2.5 text-right">Stock actual</th>
                <th className="px-4 py-2.5 text-right">Porc. aprox</th>
                <th className="px-4 py-2.5 text-right">
                  {ventanaDias === 1 ? 'Ventas ayer' : `Ventas/día (${ventanaDias}d)`}
                </th>
                <th className="px-4 py-2.5 text-right">Ventas/día (14d)</th>
                <th className="px-4 py-2.5 text-right">Días restantes</th>
                <th className="px-4 py-2.5 text-right">{'Producir (' + diaManana + ')'}</th>
                <th className="w-24 px-4 py-2.5 text-center">Actualizar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filas.map((f) => {
                const isEditing = editando === f.nombre;
                return (
                  <tr
                    key={f.nombre}
                    className={cn(
                      'hover:bg-gray-50',
                      f.estado === 'critico' && 'bg-red-50/50',
                      f.estado === 'bajo' && 'bg-amber-50/30',
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{f.nombre}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium',
                          f.estado === 'ok' && 'bg-green-100 text-green-800',
                          f.estado === 'bajo' && 'bg-amber-100 text-amber-800',
                          f.estado === 'critico' && 'bg-red-100 text-red-800',
                          f.estado === 'sin_datos' && 'bg-gray-100 text-gray-500',
                        )}
                      >
                        {f.estado === 'ok'
                          ? 'OK'
                          : f.estado === 'bajo'
                            ? 'Bajo'
                            : f.estado === 'critico'
                              ? 'Urgente'
                              : 'Sin datos'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {f.stockCantidad !== null ? (
                        <div>
                          <span className="font-medium">
                            {f.stockCantidad} {f.unidadstock}
                          </span>
                          {f.stockFecha && (
                            <div className="text-[10px] text-gray-400">
                              {new Date(f.stockFecha + 'T12:00:00').toLocaleDateString('es-AR', {
                                day: 'numeric',
                                month: 'short',
                              })}
                            </div>
                          )}
                          {f.tipo === 'pasta' && f.enColaPorciones > 0 && (
                            <div className="text-[10px] text-blue-600">
                              + {f.enColaPorciones} porc. en cola
                            </div>
                          )}
                        </div>
                      ) : f.stockEsFallback ? (
                        <div>
                          <span className="font-medium text-gray-700">
                            ~{f.porcionesStock} porc.
                          </span>
                          <div className="text-[10px] text-gray-400">cámara (auto)</div>
                          {f.enColaPorciones > 0 && (
                            <div className="text-[10px] text-blue-600">
                              + {f.enColaPorciones} porc. en cola
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">
                      {f.porcionesStock > 0 ? `~${f.porcionesStock} porc.` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {f.ventasReciente > 0 ? (
                        <div>
                          <span
                            className={cn(
                              'font-medium',
                              f.ventasReciente > f.ventasDiariasPromedio * 1.2
                                ? 'text-green-700'
                                : f.ventasReciente < f.ventasDiariasPromedio * 0.8
                                  ? 'text-red-600'
                                  : 'text-gray-700',
                            )}
                          >
                            {f.ventasReciente}
                          </span>
                          {f.ventasDiariasPromedio > 0 &&
                            f.ventasReciente !== f.ventasDiariasPromedio && (
                              <span className="ml-1 text-[10px] text-gray-400">
                                {f.ventasReciente > f.ventasDiariasPromedio ? '+' : ''}
                                {Math.round((f.ventasReciente / f.ventasDiariasPromedio - 1) * 100)}
                                %
                              </span>
                            )}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {f.ventasDiariasPromedio > 0 ? (
                        <span className="text-gray-700">{f.ventasDiariasPromedio} porc.</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {f.diasRestantes !== null ? (
                        <span
                          className={cn(
                            'font-medium',
                            f.diasRestantes >= f.diasObjetivo
                              ? 'text-green-700'
                              : f.diasRestantes >= 1
                                ? 'text-amber-700'
                                : 'text-red-700',
                          )}
                        >
                          {f.diasRestantes} días
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {f.producirCantidad > 0 && (f.stockCantidad !== null || f.stockEsFallback) ? (
                        <span className="font-medium text-rodziny-700">{f.producirLabel}</span>
                      ) : f.stockCantidad === null && !f.stockEsFallback ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <span className="text-xs text-green-600">Suficiente</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={valorEdit}
                            onChange={(e) => onCambiarValor(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') onGuardar(f.nombre);
                              if (e.key === 'Escape') onCancelar();
                            }}
                            autoFocus
                            className="border-rodziny-300 w-16 rounded border px-2 py-1 text-center text-xs focus:outline-none focus:ring-1 focus:ring-rodziny-500"
                            placeholder={f.unidadstock}
                          />
                          <button
                            onClick={() => onGuardar(f.nombre)}
                            className="text-xs font-medium text-green-600 hover:text-green-800"
                          >
                            OK
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => onIniciarEdicion(f.nombre, f.stockCantidad)}
                          className="text-xs text-rodziny-700 hover:text-rodziny-900 hover:underline"
                        >
                          {f.stockCantidad !== null ? 'Editar' : 'Cargar'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
