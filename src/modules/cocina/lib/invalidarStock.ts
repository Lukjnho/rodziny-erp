import type { QueryClient } from '@tanstack/react-query';

// Set canónico de queryKeys que muestran stock de Cocina en alguna pantalla
// (StockTab, TraspasosTab, DashboardTab, ResumenSemanalCard, catálogo). Se
// invalidan TODAS juntas ante cualquier movimiento de stock (traspaso, merma,
// ajuste, armado/porcionado de pasta, carga de salsa/postre, cierre, borrados)
// para que el número quede sincronizado en todos lados, sin depender de que
// cada mutación se acuerde de cada key.
//
// Eficiencia: invalidateQueries solo re-consulta las queries MONTADAS (las que
// están en pantalla en ese momento); el resto solo queda marcado para refrescar
// al abrirlas. Por eso la lista puede ser amplia sin costo real.
const KEYS_STOCK_COCINA = [
  // Vista canónica + crudos de pastas (StockTab / TraspasosTab / Dashboard)
  'cocina_stock_pastas',
  'cocina-stock-lotes',
  'cocina-stock-traspasos',
  'cocina-stock-traspasos-hoy',
  'cocina-stock-merma',
  'cocina-stock-merma-hoy',
  'cocina-ajustes-stock',
  'cocina-cierres-pastas',
  // Salsas / postres (catálogo StockTab + Dashboard)
  'cocina-catalogo-lotes',
  'cocina_stock_salsas_postres',
  // Resumen semanal
  'resumen-semanal-stock-pastas',
  'resumen-semanal-stock-postres',
  // KPIs del Dashboard (sin realtime, dependen de invalidación)
  'cocina_traspasos_hoy',
  'dashboard-traspasos-todos',
  'dashboard-mermas-todas',
  'cocina_merma_hoy',
  'cocina_merma_hoy_por_producto',
  'dashboard-ajustes-mostrador',
  'dashboard-cierres-pastas',
] as const;

export function invalidarStockCocina(qc: QueryClient): void {
  for (const k of KEYS_STOCK_COCINA) {
    // Match por prefijo: ['cocina_stock_pastas'] alcanza también a
    // ['cocina_stock_pastas', local] de Dashboard, etc.
    qc.invalidateQueries({ queryKey: [k] });
  }
}
