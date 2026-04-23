import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { FinanzasPage } from '@/modules/finanzas/FinanzasPage';
import { ComprasPage } from '@/modules/compras/ComprasPage';
import { DepositoPage } from '@/modules/compras/DepositoPage';
import { RecepcionPage } from '@/modules/compras/RecepcionPage';
import { RRHHPage } from '@/modules/rrhh/RRHHPage';
import { FicharPage } from '@/modules/rrhh/FicharPage';
import { LoginPage } from '@/modules/auth/LoginPage';
import { UsuariosPage } from '@/modules/usuarios/UsuariosPage';
import { CocinaPage } from '@/modules/cocina/CocinaPage';
import { ProduccionQRPage } from '@/modules/cocina/ProduccionQRPage';
import { AlmacenPage } from '@/modules/almacen/AlmacenPage';
import { DashboardPage } from '@/modules/dashboard/DashboardPage';
import { PageContainer } from '@/components/layout/PageContainer';
import { AuthProvider, useAuth, type Modulo } from '@/lib/auth';
import { type ReactNode } from 'react';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 1000 * 60 * 2 } } });

function PantallaCargando() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: '#0f1117' }}
    >
      <div className="text-sm" style={{ color: '#8b9bb4' }}>
        Cargando…
      </div>
    </div>
  );
}

function SinAcceso() {
  return (
    <PageContainer title="Sin acceso">
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div className="mb-3 text-4xl">🔒</div>
        <h3 className="mb-1 text-lg font-semibold text-gray-700">No tenés acceso a este módulo</h3>
        <p className="text-sm text-gray-500">
          Pedile a un administrador que te habilite el permiso.
        </p>
      </div>
    </PageContainer>
  );
}

function Ruta({ modulo, children }: { modulo: Modulo; children: ReactNode }) {
  const { tienePermiso } = useAuth();
  return tienePermiso(modulo) ? <>{children}</> : <SinAcceso />;
}

// Modulos que viven dentro del tab Finanzas — el acceso a /finanzas se
// concede si el usuario tiene permiso a cualquiera de estos.
const MODULOS_FINANZAS: Modulo[] = ['finanzas', 'ventas', 'edr', 'gastos', 'amortizaciones'];

function RutaFinanzas({ children }: { children: ReactNode }) {
  const { tienePermiso } = useAuth();
  return MODULOS_FINANZAS.some((m) => tienePermiso(m)) ? <>{children}</> : <SinAcceso />;
}

function AppInterna() {
  const { user, perfil, cargando, tienePermiso } = useAuth();

  if (cargando) return <PantallaCargando />;
  if (!user) return <LoginPage />;
  if (!perfil) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6 text-center"
        style={{ background: '#0f1117' }}
      >
        <div className="max-w-md">
          <div className="mb-3 text-4xl">⚠️</div>
          <p className="mb-2 font-semibold text-white">Tu usuario no tiene un perfil cargado</p>
          <p className="mb-4 text-sm" style={{ color: '#8b9bb4' }}>
            Pedile a un administrador que te asigne permisos desde el módulo Usuarios.
          </p>
          <button
            onClick={async () => {
              const { supabase } = await import('@/lib/supabase');
              await supabase.auth.signOut();
              window.location.reload();
            }}
            className="rounded bg-rodziny-700 px-4 py-2 text-sm text-white hover:bg-rodziny-800"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  // Primera ruta con acceso para redirigir el '/' cuando Dashboard no esté habilitado
  const tieneAlgunFinanzas = MODULOS_FINANZAS.some((m) => tienePermiso(m));
  const primeraRutaPermitida = tienePermiso('dashboard')
    ? '/'
    : tieneAlgunFinanzas
      ? '/finanzas'
      : tienePermiso('rrhh')
        ? '/rrhh'
        : tienePermiso('compras')
          ? '/compras'
          : tienePermiso('cocina')
            ? '/cocina'
            : tienePermiso('almacen')
              ? '/almacen'
              : tienePermiso('usuarios')
                ? '/usuarios'
                : null;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1">
        <Routes>
          <Route
            path="/"
            element={
              tienePermiso('dashboard') ? (
                <DashboardPage />
              ) : primeraRutaPermitida && primeraRutaPermitida !== '/' ? (
                <Navigate to={primeraRutaPermitida} replace />
              ) : (
                <SinAcceso />
              )
            }
          />
          <Route
            path="/finanzas"
            element={
              <RutaFinanzas>
                <FinanzasPage />
              </RutaFinanzas>
            }
          />
          {/* Rutas legacy: ahora viven como tabs adentro de /finanzas */}
          <Route path="/ventas" element={<Navigate to="/finanzas" replace />} />
          <Route path="/edr" element={<Navigate to="/finanzas" replace />} />
          <Route path="/gastos" element={<Navigate to="/finanzas" replace />} />
          <Route path="/amortizaciones" element={<Navigate to="/finanzas" replace />} />
          <Route
            path="/rrhh"
            element={
              <Ruta modulo="rrhh">
                <RRHHPage />
              </Ruta>
            }
          />
          <Route
            path="/compras"
            element={
              <Ruta modulo="compras">
                <ComprasPage />
              </Ruta>
            }
          />
          <Route
            path="/cocina"
            element={
              <Ruta modulo="cocina">
                <CocinaPage />
              </Ruta>
            }
          />
          <Route
            path="/almacen"
            element={
              <Ruta modulo="almacen">
                <AlmacenPage />
              </Ruta>
            }
          />
          <Route
            path="/usuarios"
            element={
              <Ruta modulo="usuarios">
                <UsuariosPage />
              </Ruta>
            }
          />
          <Route path="*" element={<Navigate to={primeraRutaPermitida || '/'} replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Rutas públicas sin auth (mobile PWAs) */}
            <Route path="/deposito" element={<DepositoPage />} />
            <Route path="/recepcion" element={<RecepcionPage />} />
            <Route path="/fichar" element={<FicharPage />} />
            <Route path="/produccion" element={<ProduccionQRPage />} />

            {/* Resto del ERP protegido */}
            <Route path="*" element={<AppInterna />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
