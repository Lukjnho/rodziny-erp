import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth, type Modulo } from '@/lib/auth';
import { usePagosAlertas } from '@/modules/finanzas/hooks/usePagosAlertas';
import { useTurnosAbiertos, type LocalCaja } from '@/modules/caja/useCaja';
import { abrirVentanaCaja, RUTA_POS } from '@/lib/ventanaCaja';

// Modulos que viven dentro del tab de Finanzas. Si el usuario tiene permiso
// a cualquiera de estos, mostramos el item Finanzas en el sidebar.
const MODULOS_FINANZAS: Modulo[] = ['finanzas', 'edr', 'gastos', 'amortizaciones'];

const NAV: { to: string; label: string; icon: string; modulo: Modulo | 'finanzas-grupo' }[] = [
  { to: '/', label: 'Inicio', icon: '🏠', modulo: 'dashboard' },
  { to: '/caja', label: 'Caja', icon: '🧮', modulo: 'caja' },
  { to: '/ventas', label: 'Ventas', icon: '📈', modulo: 'ventas' },
  { to: '/finanzas', label: 'Finanzas', icon: '💰', modulo: 'finanzas-grupo' },
  { to: '/rrhh', label: 'RRHH', icon: '👥', modulo: 'rrhh' },
  { to: '/compras', label: 'Gastos-Compras', icon: '🧾', modulo: 'compras' },
  { to: '/cocina', label: 'Cocina', icon: '🍝', modulo: 'cocina' },
  { to: '/almacen', label: 'Almacén', icon: '🏪', modulo: 'almacen' },
  { to: '/productos', label: 'Productos', icon: '🏷️', modulo: 'productos' },
  { to: '/agenda', label: 'Agenda', icon: '📅', modulo: 'agenda' },
  { to: '/convenios', label: 'Convenios', icon: '🤝', modulo: 'convenios' },
  { to: '/usuarios', label: 'Usuarios', icon: '🔑', modulo: 'usuarios' },
  { to: '/integraciones', label: 'Integraciones', icon: '📧', modulo: 'integraciones' },
];

export function Sidebar() {
  const { perfil, signOut, tienePermiso } = useAuth();
  const { data: alertas } = usePagosAlertas();
  const navigate = useNavigate();
  // Arqueo en curso: el menú avisa que hay una caja abierta cobrando ahora.
  const { data: turnosCaja } = useTurnosAbiertos(
    (perfil?.local_restringido as LocalCaja | null) ?? null,
    tienePermiso('caja'),
  );
  const cajasAbiertas = turnosCaja?.length ?? 0;
  const items = NAV.filter((n) =>
    // Inicio es universal: lo ve cualquier usuario logueado.
    n.to === '/'
      ? true
      : n.modulo === 'finanzas-grupo'
        ? MODULOS_FINANZAS.some((m) => tienePermiso(m))
        : tienePermiso(n.modulo),
  );

  const iniciales = (perfil?.nombre || '?').slice(0, 1).toUpperCase();
  const rolLabel = perfil?.es_admin ? 'Administrador' : 'Usuario';

  return (
    <aside
      className="sticky top-0 flex h-screen w-60 flex-col"
      style={{ background: '#0f1117', borderRight: '1px solid #1e2330' }}
    >
      {/* Logo */}
      <div className="border-b px-5 py-5" style={{ borderColor: '#1e2330' }}>
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold"
            style={{ background: '#2D5016', color: '#82c44e' }}
          >
            R
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-white">Rodziny</div>
            <div className="text-xs" style={{ color: '#8b9bb4' }}>
              Sistema de gestión
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-3 py-3">
        {items.map(({ to, label, icon, modulo }) => {
          const mostrarBadge = modulo === 'finanzas-grupo' && (alertas?.urgentesTotal ?? 0) > 0;
          const badgeColor = (alertas?.vencidos ?? 0) > 0 ? 'bg-red-500' : 'bg-amber-500';
          const esCaja = to === '/caja';
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={(e) => {
                if (!esCaja) return;
                // La caja se abre en su PROPIA ventana y el ERP se queda atrás
                // mostrando el arqueo en curso. Tiene que salir de este click:
                // desde un efecto el navegador lo bloquearía. Si igual lo
                // bloquea, se entra al POS en esta misma pestaña.
                e.preventDefault();
                navigate(abrirVentanaCaja() ? '/caja' : RUTA_POS);
              }}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all',
                  isActive
                    ? 'border-l-2 border-rodziny-500 text-white'
                    : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white',
                )
              }
              style={({ isActive }) => (isActive ? { background: '#1e2a14' } : {})}
            >
              <span className="text-base">{icon}</span>
              <span className="flex-1 leading-tight">
                {label}
                {esCaja && cajasAbiertas > 0 && (
                  <span className="block text-[10px] font-medium text-green-400">
                    {cajasAbiertas === 1 ? 'Turno en curso' : `${cajasAbiertas} turnos en curso`}
                  </span>
                )}
              </span>
              {esCaja && cajasAbiertas > 0 && (
                <span
                  title={`Hay ${cajasAbiertas} caja${cajasAbiertas === 1 ? '' : 's'} con el arqueo abierto`}
                  className="relative flex h-2.5 w-2.5"
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                </span>
              )}
              {mostrarBadge && (
                <span
                  title={`${alertas!.urgentesTotal} pago${alertas!.urgentesTotal === 1 ? '' : 's'} vencido${alertas!.urgentesTotal === 1 ? '' : 's'} o por vencer en ≤7 días${
                    alertas!.urgentesSinImporte > 0
                      ? ` · ${alertas!.urgentesSinImporte} sin importe cargado`
                      : ''
                  }`}
                  className={cn(
                    'flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white',
                    badgeColor,
                  )}
                >
                  {alertas!.urgentesTotal}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t px-4 py-3" style={{ borderColor: '#1e2330' }}>
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rodziny-800 text-xs font-bold text-rodziny-400">
            {iniciales}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm capitalize text-white">
              {perfil?.nombre || 'Usuario'}
            </div>
            <div className="truncate text-xs" style={{ color: '#8b9bb4' }}>
              {rolLabel}
            </div>
          </div>
        </div>
        <button
          onClick={() => signOut()}
          className="w-full rounded px-2 py-1.5 text-xs transition-colors"
          style={{ background: '#1e2330', color: '#8b9bb4' }}
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
