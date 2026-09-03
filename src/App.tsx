import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { LoginPage } from '@/modules/auth/LoginPage';
import { PageContainer } from '@/components/layout/PageContainer';
import { AuthProvider, useAuth, type Modulo } from '@/lib/auth';
import { ActualizacionBanner } from '@/components/ActualizacionBanner';
import { lazy, Suspense, type ReactNode } from 'react';

// Lazy chunks por módulo: evitan que el bundle inicial cargue todo el ERP
// cuando el usuario solo entra al QR de Cocina o a Fichar desde el celular.
const FinanzasPage = lazy(() =>
  import('@/modules/finanzas/FinanzasPage').then((m) => ({ default: m.FinanzasPage })),
);
const VentasPage = lazy(() =>
  import('@/modules/ventas/VentasPage').then((m) => ({ default: m.VentasPage })),
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
const PizarronPage = lazy(() =>
  import('@/modules/cocina/PizarronPage').then((m) => ({ default: m.PizarronPage })),
);
const AlmacenPage = lazy(() =>
  import('@/modules/almacen/AlmacenPage').then((m) => ({ default: m.AlmacenPage })),
);
const ProductosPage = lazy(() =>
  import('@/modules/productos/ProductosPage').then((m) => ({ default: m.ProductosPage })),
);
const InicioPage = lazy(() =>
  import('@/modules/inicio/InicioPage').then((m) => ({ default: m.InicioPage })),
);
const AgendaPage = lazy(() =>
  import('@/modules/agenda/AgendaPage').then((m) => ({ default: m.AgendaPage })),
);
const ConveniosPage = lazy(() =>
  import('@/modules/convenios/ConveniosPage').then((m) => ({ default: m.ConveniosPage })),
);
const CajaPage = lazy(() =>
  import('@/modules/caja/CajaPage').then((m) => ({ default: m.CajaPage })),
);
const CajaResumen = lazy(() =>
  import('@/modules/caja/CajaResumen').then((m) => ({ default: m.CajaResumen })),
);
const IntegracionesPage = lazy(() =>
  import('@/modules/integraciones/IntegracionesPage').then((m) => ({ default: m.IntegracionesPage })),
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

const MODULOS_FINANZAS: Modulo[] = ['finanzas', 'edr', 'gastos', 'amortizaciones'];

function RutaFinanzas({ children }: { children: ReactNode }) {
  const { tienePermiso } = useAuth();
  return MODULOS_FINANZAS.some((m) => tienePermiso(m)) ? <>{children}</> : <SinAcceso />;
}

// Rutas que se muestran SIN el menú lateral, a pantalla completa. El punto de
// venta se usa así todo el turno: el cajero queda adentro del POS, sin Finanzas
// ni RRHH al costado tentando errores. Normalmente además corre en su propia
// ventana (ver src/lib/ventanaCaja.ts); /caja queda para el ERP, mostrando el
// arqueo en curso.
const RUTAS_PANTALLA_COMPLETA = ['/caja/pos'];

function AppInterna() {
  const { user, perfil, cargando } = useAuth();
  const { pathname } = useLocation();
  const pantallaCompleta = RUTAS_PANTALLA_COMPLETA.includes(pathname);

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

  return (
    <div className="flex min-h-screen">
      {!pantallaCompleta && <Sidebar />}
      <div className="flex-1">
        <Suspense fallback={<PantallaCargando />}>
          <Routes>
            {/* Inicio universal: cualquier usuario logueado abre acá (su agenda
                del día + alertas que tenga permiso de ver). */}
            <Route path="/" element={<InicioPage />} />
            <Route
              path="/finanzas"
              element={
                <RutaFinanzas>
                  <FinanzasPage />
                </RutaFinanzas>
              }
            />
            {/* /caja = el tablero dentro del ERP (arqueo en curso).
                /caja/pos = el punto de venta, a pantalla completa. */}
            <Route
              path="/caja"
              element={
                <Ruta modulo="caja">
                  <CajaResumen />
                </Ruta>
              }
            />
            <Route
              path="/caja/pos"
              element={
                <Ruta modulo="caja">
                  <CajaPage />
                </Ruta>
              }
            />
            <Route
              path="/ventas"
              element={
                <Ruta modulo="ventas">
                  <VentasPage />
                </Ruta>
              }
            />
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
              path="/productos"
              element={
                <Ruta modulo="productos">
                  <ProductosPage />
                </Ruta>
              }
            />
            <Route
              path="/agenda"
              element={
                <Ruta modulo="agenda">
                  <AgendaPage />
                </Ruta>
              }
            />
            <Route
              path="/convenios"
              element={
                <Ruta modulo="convenios">
                  <ConveniosPage />
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
            <Route
              path="/integraciones"
              element={
                <Ruta modulo="integraciones">
                  <IntegracionesPage />
                </Ruta>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
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
          <ActualizacionBanner />
          <Suspense fallback={<PantallaCargando />}>
            <Routes>
              {/* Rutas públicas sin auth (mobile PWAs) */}
              <Route path="/deposito" element={<DepositoPage />} />
              <Route path="/recepcion" element={<RecepcionPage />} />
              <Route path="/fichar" element={<FicharPage />} />
              <Route path="/produccion" element={<ProduccionQRPage />} />
              <Route path="/mostrador" element={<MostradorPage />} />
              {/* El pizarrón de la fábrica: tablet colgada en la pared, se lee
                  sin sesión igual que el QR. Va acá arriba (fuera de
                  AppInterna) a propósito: si estuviera bajo /cocina pediría
                  login y una tablet de pared con login termina mostrando
                  "sesión expirada" y nadie la arregla. */}
              <Route path="/pizarron" element={<PizarronPage />} />

              {/* Resto del ERP protegido */}
              <Route path="*" element={<AppInterna />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
