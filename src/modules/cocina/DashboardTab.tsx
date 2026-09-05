import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';
import { invalidarStockCocina } from './lib/invalidarStock';
import {
  SELECT_STOCK_PASTAS,
  vendibleHoy,
  bandejasEnProceso,
  type StockPastaRow,
} from './lib/stockPastas';
import { cn } from '@/lib/utils';
import { LocalSelector } from '@/components/ui/LocalSelector';
import { useAuth } from '@/lib/auth';
import { ProximasEfemeridesCard } from './components/ProximasEfemeridesCard';
import { useCierresFaltantes } from './hooks/useCierresFaltantes';

// ── Productos que el chef controla ──────────────────────────────────────────
// tipo determina unidad de medida y cálculo de porciones.
// 'panificado' (panes Saavedra vendidos vía Almacén) se comporta igual que
// 'postre': se cuenta por unidades y usa stock registrado, no flujo de pasta.
export type TipoProducto = 'salsa' | 'postre' | 'pasta' | 'panificado';

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
  // Salsas Saavedra — `nombre` = nombre real de cocina_productos (Lucas alineó
  // el ERP 2026-05-19) para que el cruce con el producto/receta funcione.
  // `fudoNombres` = nombre REAL en Fudo Saavedra: a diferencia de Vedia, acá la
  // salsa SÍ se tickea como línea de venta propia (ej. "Spaghetti al huevo" +
  // "Crema Blanca" = dos líneas). Fuente: UI de Fudo (app-v2.fu.do, 2026-05-19).
  {
    nombre: 'Salsa Amatriciana SG',
    fudoNombres: ['Salsa Amatriciana'],
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Salsa Bolognesa SG',
    fudoNombres: ['Salsa Bolognesa'],
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Salsa De Crema Blanca SG',
    fudoNombres: ['Crema Blanca'],
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Salsa Parisienne SG',
    fudoNombres: ['Parisienne'],
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Salsa Pomodoro SG',
    fudoNombres: ['Pomodoro'],
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Salsa Rose SG',
    fudoNombres: ['Rosé'],
    categoria: 'Salsas',
    tipo: 'salsa',
    gramosporcion: 200,
    porcionesporunidad: 1,
    unidadstock: 'kg',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Salsa Scarparo SG',
    fudoNombres: ['Scarparo'],
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
    nombre: 'Sorrentinos de Jamón y queso',
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
    nombre: 'Ravioli de Espinaca y quesos',
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
    nombre: 'Scarpinocc de Vacío de Cerdo',
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
    nombre: 'Capeletti de Pollo, puerro y quesos',
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
    nombre: 'Tagliatelles mixtos',
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
  // `nombre` = nombre real de cocina_productos (Lucas alineó el ERP 2026-05-19)
  // para el cruce producto/receta. `fudoNombres` = nombre REAL en Fudo Saavedra
  // (Lucas NO renombró Fudo, solo el ERP), tomado de ventas_items.
  {
    nombre: 'Capellacci de Pollo, puerro y quesos',
    // OJO: en Fudo la congelada está cargada con otra grafía que el salón
    // ("Cappellacci" doble P/L vs "Capellacci"). Verificado en API live
    // 2026-05-19. Copiar EXACTO o no matchea (el normalizador no corrige letras).
    fudoNombres: [
      'Capellacci de Pollo, puerro y quesos',
      'Cappellacci de pollo, puerro y quesos (CONGELADA)',
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
    nombre: 'Mezzelune de vacío de cerdo',
    fudoNombres: [
      'Mezzelune de vacío de cerdo',
      'Mezzelune de vacío de cerdo (CONGELADA)',
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
    nombre: 'Mila napo + fideos',
    fudoNombres: ['Mila napo + fideos'],
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
    fudoNombres: ['Ñoquis de papa', 'M.E. Ñoquis'],
    categoria: 'Pastas',
    tipo: 'pasta',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'porciones',
    diasObjetivo: 3,
    local: 'saavedra',
  },
  {
    nombre: 'Ñoquis rellenos',
    fudoNombres: ['Ñoquis rellenos'],
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
    fudoNombres: [
      'Spaghetti al huevo',
      'Spaghettis al huevo (CONGELADOS)',
      'M.E. Spaghettis',
    ],
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
  // Postres/Tortas Saavedra — `nombre` = nombre real de cocina_productos (Lucas
  // alineó el ERP 2026-05-19) para el cruce con producto/receta. `fudoNombres`
  // = nombre REAL en Fudo Saavedra, según UI de Fudo (app-v2.fu.do, 2026-05-19):
  // se vende por porción (cat. Postres/Tortas, "(porcion)") Y entera para llevar
  // (cat. Almacen sin gluten > Pastelería, "( ALMACEN)" — OJO espacio tras "(").
  // Las dos cuentan como demanda de producción. El match normaliza espacios
  // múltiples pero conserva el espacio simple tras "(": copiar EXACTO de Fudo.
  {
    nombre: 'Brownies Con Nueces SG',
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
    // Budín de pan: Lucas confirmó (2026-05-19) que NO se vende en Fudo
    // Saavedra (quedó en histórico). Sin fudoNombres → demanda 0. Igual
    // aparece en el Resumen como ítem planificable.
    nombre: 'Budin De Pan SG',
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Carrot Cake SG',
    fudoNombres: ['Carrot cake (porcion)', 'Carrot cake ( ALMACEN)'],
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Flan SG',
    fudoNombres: ['Flan'],
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Torta Matilda',
    fudoNombres: ['Matilda (porcion)', 'Torta matilda ( ALMACEN)'],
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Torta Vasca SG',
    fudoNombres: ['Tarta Vasca'],
    categoria: 'Postres/Tortas',
    tipo: 'postre',
    gramosporcion: 0,
    porcionesporunidad: 8,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },

  // ════════════════════════════════════════════════════════════════
  // PANADERÍA — Saavedra (se venden solo vía Almacén en Fudo)
  // ════════════════════════════════════════════════════════════════
  // `nombre` = nombre real de cocina_productos Saavedra (tipo='panificado').
  // `fudoNombres` = nombre EXACTO en Fudo cat. "Panaderia", verificado contra
  // la API live 2026-05-19: "(ALMACEN)" SIN espacio tras "(" (≠ las tortas de
  // Pastelería que van con espacio "( ALMACEN)"). El normalizador colapsa
  // espacios múltiples pero conserva el simple → copiar EXACTO.
  // Nota: hoy no tienen receta_id vinculada → no generan demanda en el Resumen
  // hasta que Lucas linkee receta desde Cocina (igual que las 7 pastas).
  // `Pan de servicio SG` NO se vende en Fudo. No existe producto `Rosca de Pascuas`.
  {
    nombre: 'Pan Brioche SG',
    fudoNombres: ['Pan brioche (ALMACEN)'],
    categoria: 'Panadería',
    tipo: 'panificado',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Pan de Campo SG',
    fudoNombres: ['Pan de campo (ALMACEN)'],
    categoria: 'Panadería',
    tipo: 'panificado',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Pan de Molde SG',
    fudoNombres: ['Pan de molde (ALMACEN)'],
    categoria: 'Panadería',
    tipo: 'panificado',
    gramosporcion: 0,
    porcionesporunidad: 1,
    unidadstock: 'unidades',
    diasObjetivo: 2,
    local: 'saavedra',
  },
  {
    nombre: 'Pan Lactal SG',
    fudoNombres: ['Pan lactal (ALMACEN)'],
    categoria: 'Panadería',
    tipo: 'panificado',
    gramosporcion: 0,
    porcionesporunidad: 1,
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
  'Pastas',
  'Salsas',
  'Pizzas',
  'Postres',
  'Helados',
  'Postres/Tortas',
  'Desayunos y Meriendas',
  'Salados',
];

// Stock derivado de cocina_lotes_produccion (fuente única para salsas, postres, etc.).
// Se obtiene sumando los lotes activos por receta y aplicando override manual si existe.
interface StockPorReceta {
  cantidad: number; // suma de lotes activos en su unidad (kg / unid / lt)
  unidad: 'kg' | 'unid' | 'lt';
  fecha: string; // fecha del lote más reciente (yyyy-mm-dd)
  recetaId: string | null;
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
  id: string;
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
  /** Bandejas armadas esperando el porcionado. Es el dato que se muestra. */
  bandejasPorPorcionar: number;
  /** Estimación en porciones de esas bandejas. Nunca se suma a lo vendible. */
  enColaPorciones: number;
  /** Hay bandejas pero no alcanza el histórico para estimarlas: se muestra "?". */
  enColaSinEstimar: boolean;
  enMostradorPorciones: number; // traspasos hoy − ventas hoy − merma hoy
  stockEsFallback: boolean; // true si stockCantidad es null y usamos cámara/mostrador como aproximación
};

// Shape crudo devuelto por Supabase para la query de cocina_productos con receta
// embebida. Supabase no infiere bien estos joins, por eso lo declaramos.
type ProductoDBRow = {
  id: string;
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
  /** Neto de cámara: vendible HOY. La resta ya viene hecha de la base (mig 161). */
  porcionesVendibles: number;
  /** Bandejas armadas esperando el porcionado. El dato crudo que ve el cocinero. */
  bandejasEnProceso: number;
  /** Esas bandejas traducidas a porciones (estimación por kilos, no conteo). */
  porcionesEnProcesoEst: number;
  /** Hay bandejas y NO se puede estimar: mostrar "?" en vez de un 0 que miente. */
  sinRatio: boolean;
}

// Normaliza nombres para matchear entre PRODUCTOS_COCINA y la tabla cocina_productos.
export function normNombre(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Lo que está armado en bandejas y todavía nadie cortó.
 *
 * Se muestra SIEMPRE aparte del stock vendible y nunca sumado: son dos cosas
 * distintas y confundirlas es lo que hacía que el plan pidiera producir de
 * nuevo pasta que ya estaba hecha.
 *
 * El número grande es la BANDEJA, porque es lo que la persona ve y cuenta en el
 * freezer. La porción va entre paréntesis y con ~ porque es una estimación por
 * kilos; si no hay histórico suficiente para estimarla dice "?" en vez de
 * mentir un 0.
 */
function PorPorcionar({
  bandejas,
  porciones,
  sinEstimar,
}: {
  bandejas: number;
  porciones: number;
  sinEstimar: boolean;
}) {
  if (bandejas <= 0) return null;
  return (
    <div className="text-[10px] text-blue-600">
      + {bandejas} band. por porcionar{' '}
      <span className="text-blue-400">
        ({sinEstimar || porciones <= 0 ? '?' : `~${porciones}`} porc.)
      </span>
    </div>
  );
}

// Piso de producción para pastas: siempre al menos 100 porciones si hay que producir.
const PISO_PORCIONES_PASTA = 100;

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// ── Componente ──────────────────────────────────────────────────────────────
export function DashboardTab() {
  const qc = useQueryClient();
  const { perfil } = useAuth();
  const localRestringido = perfil?.local_restringido ?? null;
  const [local, setLocal] = useState<'vedia' | 'saavedra'>(localRestringido ?? 'vedia');
  useEffect(() => {
    if (localRestringido && local !== localRestringido) setLocal(localRestringido);
  }, [localRestringido, local]);
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

  const { faltantes: cierresFaltantes } = useCierresFaltantes(local);

  // ── Query: productos BD con receta vinculada (para saber rendimiento y mínimos) ──
  const { data: productosDB } = useQuery({
    queryKey: ['cocina_productos_dashboard', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_productos')
        .select(
          'id, nombre, local, tipo, receta_id, minimo_produccion, receta:cocina_recetas(nombre, rendimiento_porciones, rendimiento_kg)',
        )
        .eq('local', local)
        .eq('activo', true);
      if (error) throw error;
      const filas: ProductoDB[] = (data as unknown as ProductoDBRow[]).map((r) => ({
        id: r.id,
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

  // ── Query: stock de pastas, de la cuenta única de la base (migración 161) ──
  // Acá NO se resta nada: la vista ya devuelve el neto de cámara y, aparte, las
  // bandejas armadas que esperan el porcionado. Las dos capas se muestran
  // SEPARADAS y no se suman: una es vendible hoy, la otra todavía no existe
  // como porción.
  //
  // Antes esta pantalla leía `porciones_fresco`, que da 0 SIEMPRE (en el freezer
  // de producción las porciones son NULL hasta que alguien corta), así que la
  // pasta armada era invisible y el plan la volvía a pedir.
  const { data: stockPastasDB } = useQuery({
    queryKey: ['cocina_stock_pastas', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cocina_stock_pastas')
        .select(SELECT_STOCK_PASTAS)
        .eq('local', local);
      if (error) throw error;
      const m = new Map<string, StockPastaDB>();
      for (const r of (data ?? []) as unknown as StockPastaRow[]) {
        m.set(normNombre(r.nombre), {
          porcionesVendibles: vendibleHoy(r),
          bandejasEnProceso: bandejasEnProceso(r),
          porcionesEnProcesoEst: Number(r.porciones_en_proceso_est) || 0,
          sinRatio: r.en_proceso_sin_ratio === true,
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

  // ── Query: merma registrada hoy desde el QR ──
  const { data: mermaHoy } = useQuery({
    queryKey: ['cocina_merma_hoy', local, hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_merma')
        .select('porciones')
        .eq('local', local)
        .eq('fecha', hoy);
      if (error) throw error;
      const total = (data ?? []).reduce(
        (s: number, r: { porciones: number | null }) => s + (Number(r.porciones) || 0),
        0,
      );
      return { total, eventos: data?.length ?? 0 };
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // ── Query: la cuenta única del mostrador (migración 170) ──
  // Acá vivían OCHO consultas para estimar lo que hay en el mostrador: traspasos
  // de hoy, merma de hoy por producto, ventas Fudo de hoy, el último cierre por
  // producto, el rango Fudo desde el cierre, y traspasos / mermas / ajustes
  // históricos. Todas juntas espejaban lo que la vista hace en la base — y el
  // tab Stock tenía su propia versión, parecida pero no igual.
  //
  // 🔑 La vista descuenta las ventas posteriores al conteo DE ESE producto porque
  // ventas_tickets guarda la hora; la API de Fudo no la da, así que acá se
  // redondeaba ("si el cierre fue hoy, no descontamos ventas"). Y desde la
  // migración 180 las ventas entran cada 15 minutos, que era la condición para
  // que esta cuenta sirva en vivo.
  const { data: stockMostrador } = useQuery({
    queryKey: ['cocina-stock-mostrador', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cocina_stock_mostrador')
        .select('producto_id, porciones_mostrador')
        .eq('local', local);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as Array<{
        producto_id: string
        porciones_mostrador: number | null
      }>) {
        m.set(r.producto_id, Number(r.porciones_mostrador) || 0);
      }
      return m;
    },
    // Las ventas entran por cron cada 15 minutos y no hay realtime sobre
    // ventas_items: sin esto el número se queda clavado con la pantalla abierta.
    refetchInterval: 5 * 60 * 1000,
  });

  // ── Query: lotes activos de cocina_lotes_produccion (raw, sin agregar) ──
  // Devuelve lotes con datos de receta necesarios para el FIFO con descuento Fudo.
  // El cálculo final del stock vive en `stockSalsasPostres` (useMemo abajo).
  type LoteProdRaw = {
    id: string;
    fecha: string;
    categoria: string;
    receta_id: string | null;
    nombre_libre: string | null;
    cantidad_producida: number;
    unidad: 'kg' | 'unid' | 'lt';
    merma_cantidad: number | null;
    cantidad_restante_manual: number | null;
    created_at: string;
    origen: 'produccion' | 'cierre';
    receta?: {
      id: string;
      nombre: string;
      tipo: 'receta' | 'subreceta';
      gramos_por_porcion: number | null;
      fudo_productos: string[] | null;
    } | null;
  };
  const { data: lotesProduccionRaw } = useQuery({
    queryKey: ['cocina_stock_salsas_postres', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_lotes_produccion')
        .select(
          'id, fecha, categoria, receta_id, nombre_libre, cantidad_producida, unidad, merma_cantidad, cantidad_restante_manual, created_at, origen, receta:cocina_recetas(id, nombre, tipo, gramos_por_porcion, fudo_productos)',
        )
        .eq('local', local)
        .eq('en_stock', true)
        .order('created_at'); // FIFO: del más viejo al más nuevo
      if (error) throw error;
      return (data ?? []) as unknown as LoteProdRaw[];
    },
  });

  // Recetas del local para hacer match al cargar/editar stock desde el Dashboard.
  // Se usa también para construir el receta_id cuando se inserta un lote nuevo.
  const { data: recetasLocal } = useQuery({
    queryKey: ['cocina_recetas_dashboard', local],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cocina_recetas')
        .select('id, nombre, tipo, local')
        .or(`local.eq.${local},local.eq.ambos`);
      if (error) throw error;
      const m = new Map<string, { id: string; nombre: string; tipo: string }>();
      for (const r of (data ?? []) as Array<{ id: string; nombre: string; tipo: string }>) {
        m.set(normNombre(r.nombre), r);
      }
      return m;
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

  // ── Stock final con FIFO + descuento de ventas Fudo ──────────────────────
  // Mismo modelo que StockProduccionSection: agrupa lotes por receta, calcula
  // consumo proyectado (ventas Fudo × g/porción si kg, ventas × 1 si unidades) y
  // descuenta del lote más viejo al más nuevo. Si la batea fue pesada
  // (cantidad_restante_manual != null), ese valor manda sobre el cálculo FIFO.
  //
  // Antes el Dashboard sumaba `cantidad_producida` cruda y los postres se veían
  // acumulados (Flan 201u, Tiramisú 182u, etc.) porque el modelo aditivo nunca
  // descontaba ventas. Las salsas zafaban porque el QR Salsa hace overwrite.
  const stockSalsasPostres = useMemo<Map<string, StockPorReceta> | null>(() => {
    if (!lotesProduccionRaw) return null;

    // 1) Agrupar lotes por receta (key = receta_id o nombre_libre normalizado)
    const porReceta = new Map<
      string,
      { lotes: LoteProdRaw[]; nombre: string; recetaId: string | null }
    >();
    for (const l of lotesProduccionRaw) {
      // Subrecetas (ej. Pomodoro Base) son insumos internos, no producto final
      if (l.receta?.tipo === 'subreceta') continue;
      const nombre = l.receta?.nombre ?? l.nombre_libre ?? '';
      if (!nombre) continue;
      const key = l.receta_id ?? `libre:${nombre}`;
      const prev = porReceta.get(key);
      if (!prev)
        porReceta.set(key, { lotes: [l], nombre, recetaId: l.receta_id });
      else prev.lotes.push(l);
    }

    // 2) Ventas Fudo por nombre normalizado (para auto-match e override manual)
    const rankingByNombre = new Map<string, number>();
    for (const p of fudoData?.ranking ?? [])
      rankingByNombre.set(p.nombre.toLowerCase(), p.cantidad);
    const productosFudoList = fudoData?.ranking ?? [];

    // 3) FIFO por receta
    const out = new Map<string, StockPorReceta>();
    for (const [, grp] of porReceta) {
      const receta = grp.lotes[0].receta;
      const gramosPorcion = receta?.gramos_por_porcion ?? null;
      const unidadBatch = grp.lotes[0].unidad;
      const nombreReceta = grp.nombre.toLowerCase().trim();

      // Productos Fudo: override manual si existe, si no auto-match por nombre
      const fudoManual = receta?.fudo_productos ?? [];
      let fudoNombres: string[] = [];
      if (fudoManual.length > 0) {
        fudoNombres = fudoManual;
      } else if (nombreReceta.length >= 3) {
        fudoNombres = productosFudoList
          .filter((p) => p.nombre.toLowerCase().includes(nombreReceta))
          .map((p) => p.nombre);
      }

      // Consumo proyectado en la misma unidad que los lotes
      let ventasAsociadas = 0;
      for (const n of fudoNombres)
        ventasAsociadas += rankingByNombre.get(n.toLowerCase()) ?? 0;
      let consumoRestante: number;
      if (gramosPorcion && (unidadBatch === 'kg' || unidadBatch === 'lt')) {
        consumoRestante = (ventasAsociadas * gramosPorcion) / 1000;
      } else {
        consumoRestante = ventasAsociadas;
      }

      // Si el grupo tiene un lote de hoy con origen='cierre', el peso registrado
      // ya es el stock real post-ventas del día — no se le descuenta Fudo encima.
      // Mismo modelo que el bloque de pastas con cocina_cierre_dia.
      const tieneCierreHoy = grp.lotes.some(
        (l) => l.origen === 'cierre' && l.fecha === hoy,
      );
      if (tieneCierreHoy) consumoRestante = 0;

      // FIFO: descontar del más viejo al más nuevo. La query ya viene ordenada
      // por created_at, así que basta con iterar en orden.
      let totalRestante = 0;
      let fechaMax = grp.lotes[0].fecha;
      for (const l of grp.lotes) {
        const disponibleBruto = Math.max(
          0,
          Number(l.cantidad_producida) - Number(l.merma_cantidad ?? 0),
        );
        const consumidoFifo = Math.min(Math.max(0, consumoRestante), disponibleBruto);
        consumoRestante = Math.max(0, consumoRestante - consumidoFifo);
        const restanteCalc = Math.max(0, disponibleBruto - consumidoFifo);
        // Override manual: si pesaron la batea, ese valor manda sobre el FIFO
        const restanteReal =
          l.cantidad_restante_manual != null
            ? Number(l.cantidad_restante_manual)
            : restanteCalc;
        totalRestante += restanteReal;
        if (l.fecha > fechaMax) fechaMax = l.fecha;
      }

      out.set(normNombre(grp.nombre), {
        cantidad: totalRestante,
        unidad: unidadBatch,
        fecha: fechaMax,
        recetaId: grp.recetaId,
      });
    }
    return out;
  }, [lotesProduccionRaw, fudoData]);

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

  // ── Mutation: actualizar stock de una salsa/postre ──
  // Estrategia simple: apaga lotes activos previos + crea uno nuevo con el total real.
  // Así Dashboard y "Salsas, postres y otras producciones" del tab Stock consumen
  // siempre la misma fuente: cocina_lotes_produccion.
  const guardarConteo = useMutation({
    mutationFn: async (payload: {
      producto: string;
      cantidad: number;
      tipo: 'salsa' | 'postre' | 'pasta' | 'panificado';
      unidadStock: string;
    }) => {
      if (payload.tipo === 'pasta') {
        throw new Error(
          'Las pastas se ajustan desde el tab Stock (botón en cámara/mostrador), no desde acá.',
        );
      }

      // Mapear unidad
      const unidad: 'kg' | 'unid' | 'lt' =
        payload.unidadStock === 'kg' ? 'kg' : payload.unidadStock === 'lt' ? 'lt' : 'unid';
      // cocina_lotes_produccion.categoria tiene CHECK (salsa/postre/pasteleria/
      // panaderia/prueba). El tipo 'panificado' (cocina_productos) mapea a la
      // categoría 'panaderia' de los lotes; el resto pasa tal cual.
      const categoria = payload.tipo === 'panificado' ? 'panaderia' : payload.tipo;

      // Match por nombre normalizado con cocina_recetas (puede no existir)
      const receta = recetasLocal?.get(normNombre(payload.producto)) ?? null;

      // 1) Apagar lotes activos previos para esta receta (o nombre_libre) + local
      let qDel = supabase
        .from('cocina_lotes_produccion')
        .update({ en_stock: false })
        .eq('local', local)
        .eq('en_stock', true);
      if (receta) {
        qDel = qDel.eq('receta_id', receta.id);
      } else {
        qDel = qDel.eq('nombre_libre', payload.producto).is('receta_id', null);
      }
      const { error: errDel } = await qDel;
      if (errDel) throw errDel;

      // 2) Insertar lote nuevo con la cantidad real
      const { error: errIns } = await supabase.from('cocina_lotes_produccion').insert({
        fecha: hoy,
        local,
        categoria,
        receta_id: receta?.id ?? null,
        nombre_libre: receta ? null : payload.producto,
        cantidad_producida: payload.cantidad,
        unidad,
        en_stock: true,
      });
      if (errIns) throw errIns;
    },
    onSuccess: () => {
      invalidarStockCocina(qc);
    },
    onError: (e: Error) => window.alert(mensajeErrorAmigable(e, 'No se pudo guardar el stock')),
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
      // Stock actual: para salsas/postres viene de cocina_lotes_produccion (lotes activos).
      // Las pastas no usan este map (se calculan abajo desde la vista).
      const stockReg = stockSalsasPostres?.get(normNombre(prod.nombre)) ?? null;
      const stockCantidad =
        prod.tipo !== 'pasta' && stockReg ? Math.round(stockReg.cantidad * 100) / 100 : null;
      const stockFecha = stockReg?.fecha ?? null;

      // Stock derivado de lotes registrados en QR (solo pastas), en dos capas
      // que NO se suman: lo que hay cortado en cámara, y lo que está armado en
      // bandejas esperando el porcionado.
      const stockDB =
        prod.tipo === 'pasta' ? (stockPastasDB?.get(normNombre(prod.nombre)) ?? null) : null;
      const enCamaraPorciones = stockDB?.porcionesVendibles ?? 0;
      const bandejasPorPorcionar = stockDB?.bandejasEnProceso ?? 0;
      const enColaPorciones = stockDB?.porcionesEnProcesoEst ?? 0;
      const enColaSinEstimar = stockDB?.sinRatio ?? false;

      // Lo que hay en el mostrador viene HECHO de la base (migracion 170):
      // ultimo conteo fisico + traspasos - ventas - merma + ajustes posteriores.
      const prodDBPreview = productosDB?.get(normNombre(prod.nombre));
      const enMostradorPorciones =
        prod.tipo === 'pasta' && prodDBPreview
          ? (stockMostrador?.get(prodDBPreview.id) ?? 0)
          : 0;

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
      } else if (prod.tipo === 'pasta' && enCamaraPorciones + enMostradorPorciones > 0) {
        // Sin conteo manual: usamos cámara + mostrador estimado como aproximación
        // para no decir "sin datos" cuando la DB ya sabe que hay stock.
        porcionesStock = enCamaraPorciones + enMostradorPorciones;
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
        bandejasPorPorcionar,
        enColaPorciones,
        enColaSinEstimar,
        enMostradorPorciones,
        stockEsFallback,
      };
    });
  }, [
    stockSalsasPostres,
    fudoData,
    fudoReciente,
    factorManana,
    ventanaDias,
    productosDB,
    stockPastasDB,
    stockMostrador,
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
      const fila = filas.find((f) => f.nombre === producto);
      if (!fila) {
        setEditando(null);
        return;
      }
      if (fila.tipo === 'pasta') {
        window.alert('Las pastas se ajustan desde el tab Stock (cámara/mostrador).');
        setEditando(null);
        return;
      }
      guardarConteo.mutate({
        producto,
        cantidad: n,
        tipo: fila.tipo,
        unidadStock: fila.unidadstock,
      });
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

  return (
    <div className="space-y-4">
      {cierresFaltantes.length > 0 && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800">
                {cierresFaltantes.length === 1
                  ? 'Falta un cierre de turno'
                  : `Faltan ${cierresFaltantes.length} cierres de turno`}
              </p>
              <p className="mt-0.5 text-xs text-red-700">
                {cierresFaltantes.map((c) => c.label).join(' · ')}
              </p>
              <p className="mt-1 text-[11px] text-red-600">
                Sin cierre, el stock del mostrador queda desactualizado. Pedile al equipo del
                mostrador que cargue desde el QR <span className="font-mono">/mostrador?local={local}</span>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-4">
        {!localRestringido && (
          <LocalSelector value={local} onChange={(v) => setLocal(v as 'vedia' | 'saavedra')} />
        )}
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
        <div
          className={cn(
            'rounded-lg border px-4 py-3 text-center',
            mermaHoy && mermaHoy.total > 0
              ? 'border-orange-200 bg-orange-50'
              : 'border-gray-200 bg-gray-50',
          )}
          title={
            mermaHoy && mermaHoy.eventos > 0
              ? `${mermaHoy.eventos} carga${mermaHoy.eventos !== 1 ? 's' : ''} desde el QR`
              : 'Sin merma registrada hoy'
          }
        >
          <div
            className={cn(
              'text-2xl font-bold',
              mermaHoy && mermaHoy.total > 0 ? 'text-orange-700' : 'text-gray-400',
            )}
          >
            {mermaHoy ? Math.round(mermaHoy.total * 10) / 10 : 0}
          </div>
          <div
            className={cn(
              'text-[10px] font-medium uppercase',
              mermaHoy && mermaHoy.total > 0 ? 'text-orange-600' : 'text-gray-400',
            )}
          >
            Merma hoy {mermaHoy && mermaHoy.eventos > 0 ? `· ${mermaHoy.eventos}` : ''}
          </div>
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
                <th className="px-4 py-2.5 text-right">
                  {ventanaDias === 1 ? 'Ventas ayer' : `Ventas/día (${ventanaDias}d)`}
                </th>
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
                          {f.tipo === 'pasta' && (
                            <PorPorcionar
                              bandejas={f.bandejasPorPorcionar}
                              porciones={f.enColaPorciones}
                              sinEstimar={f.enColaSinEstimar}
                            />
                          )}
                        </div>
                      ) : f.stockEsFallback ? (
                        <div>
                          <span className="font-medium text-gray-700">
                            ~{f.porcionesStock} porc.
                          </span>
                          <div className="text-[10px] text-gray-400">
                            {f.enCamaraPorciones > 0 && f.enMostradorPorciones > 0
                              ? `${f.enCamaraPorciones} cámara · ${f.enMostradorPorciones} mostrador`
                              : f.enMostradorPorciones > 0
                                ? `${f.enMostradorPorciones} en mostrador`
                                : 'cámara (auto)'}
                          </div>
                          <PorPorcionar
                            bandejas={f.bandejasPorPorcionar}
                            porciones={f.enColaPorciones}
                            sinEstimar={f.enColaSinEstimar}
                          />

                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
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
