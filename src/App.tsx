import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { LoginPage } from '@/modules/auth/LoginPage';
import { PageContainer } from '@/components/layout/PageContainer';
import { AuthProvider, useAuth, type Modulo } from '@/lib/auth';
import { lazy, Suspense, type ReactNode } from 'react';

// Lazy chunks por módulo: evitan que el bundle inicial cargue todo el ERP
// cuando el usuario solo entra al QR de Cocina o a Fichar desde el celular.
const FinanzasPage = lazy(() =>
  import('@/modules/finanzas/FinanzasPage').then((m) => ({ default: m.FinanzasPage })),
);
const ComprasPage = lazy(() =>
  import('@/modules/compras/ComprasPage').then((m) => ({ default: m.ComprasPage })),
);
const DepositoPage = lazy(() =>
  import('@/modules/compras/DepositoPage').then((m) => ({ default: m.DepositoPage })),
);
const RecepcionPage = lazy(() =>
  import('@/modules/compras/RecepcionPage').then((m) => ({ default: m.RecepcionPage })),
);
const RRHHPage = lazy(() =>
  import('@/modules/rrhh/RRHHPage').then((m) => ({ default: m.RRHHPage })),
);
const FicharPage = lazy(() =>
  import('@/modules/rrhh/FicharPage').then((m) => ({ default: m.FicharPage })),
);
const UsuariosPage = lazy(() =>
  import('@/modules/usuarios/UsuariosPage').then((m) => ({ default: m.UsuariosPage })),
);
const CocinaPage = lazy(() =>
  import('@/modules/cocina/CocinaPage').then((m) => ({ default: m.CocinaPage })),
);
const ProduccionQRPage = lazy(() =>
  import('@/modules/cocina/ProduccionQRPage').then((m) => ({ default: m.ProduccionQRPage })),
);
const MostradorPage = lazy(() =>
  import('@/modules/cocina/MostradorPage').then((m) => ({ default: m.MostradorPage })),
);
const AlmacenPage = lazy(() =>
  import('@/modules/almacen/AlmacenPage').then((m) => ({ default: m.AlmacenPage })),
);
const DashboardPage = lazy(() =>
  import('@/modules/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);

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
        <Suspense fallback={<PantallaCargando />}>
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
        </Suspense>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<PantallaCargando />}>
            <Routes>
              {/* Rutas públicas sin auth (mobile PWAs) */}
              <Route path="/deposito" element={<DepositoPage />} />
              <Route path="/recepcion" element={<RecepcionPage />} />
              <Route path="/fichar" element={<FicharPage />} />
              <Route path="/produccion" element={<ProduccionQRPage />} />
              <Route path="/mostrador" element={<MostradorPage />} />

              {/* Resto del ERP protegido */}
              <Route path="*" element={<AppInterna />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
