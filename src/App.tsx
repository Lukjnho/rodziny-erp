import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Sidebar } from '@/components/layout/Sidebar'
import { FinanzasPage } from '@/modules/finanzas/FinanzasPage'
import { VentasPage } from '@/modules/ventas/VentasPage'
import { EstadoResultados } from '@/modules/finanzas/edr/EstadoResultados'
import { GastosPage } from '@/modules/gastos/GastosPage'
import { AmortizacionesPage } from '@/modules/finanzas/amortizaciones/AmortizacionesPage'
import { ComprasPage } from '@/modules/compras/ComprasPage'
import { DepositoPage } from '@/modules/compras/DepositoPage'
import { PageContainer } from '@/components/layout/PageContainer'

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 1000 * 60 * 2 } } })

function Placeholder({ title }: { title: string }) {
  return (
    <PageContainer title={title}>
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Módulo en construcción</div>
    </PageContainer>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          {/* Ruta mobile sin sidebar (para QR depósito) */}
          <Route path="/deposito" element={<DepositoPage />} />

          {/* Rutas con sidebar */}
          <Route path="*" element={
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="flex-1">
                <Routes>
                  <Route path="/"         element={<Placeholder title="Dashboard" />} />
                  <Route path="/ventas"   element={<VentasPage />} />
                  <Route path="/finanzas" element={<FinanzasPage />} />
                  <Route path="/edr"      element={<EstadoResultados />} />
                  <Route path="/gastos"          element={<GastosPage />} />
                  <Route path="/amortizaciones"  element={<AmortizacionesPage />} />
                  <Route path="/rrhh"     element={<Placeholder title="RRHH" />} />
                  <Route path="/compras"  element={<ComprasPage />} />
                </Routes>
              </div>
            </div>
          } />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
