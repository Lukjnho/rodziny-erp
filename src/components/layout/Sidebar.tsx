import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth, type Modulo } from '@/lib/auth';
import { usePagosAlertas } from '@/modules/finanzas/hooks/usePagosAlertas';

// Modulos que viven dentro del tab de Finanzas. Si el usuario tiene permiso
// a cualquiera de estos, mostramos el item Finanzas en el sidebar.
const MODULOS_FINANZAS: Modulo[] = ['finanzas', 'ventas', 'edr', 'gastos', 'amortizaciones'];

const NAV: { to: string; label: string; icon: string; modulo: Modulo | 'finanzas-grupo' }[] = [
  { to: '/', label: 'Dashboard', icon: '▦', modulo: 'dashboard' },
  { to: '/finanzas', label: 'Finanzas', icon: '💰', modulo: 'finanzas-grupo' },
  { to: '/rrhh', label: 'RRHH', icon: '👥', modulo: 'rrhh' },
  { to: '/compras', label: 'Gastos-Compras', icon: '🧾', modulo: 'compras' },
  { to: '/cocina', label: 'Cocina', icon: '🍝', modulo: 'cocina' },
  { to: '/almacen', label: 'Almacén', icon: '🏪', modulo: 'almacen' },
  { to: '/usuarios', label: 'Usuarios', icon: '🔑', modulo: 'usuarios' },
];

export function Sidebar() {
  const { perfil, signOut, tienePermiso } = useAuth();
  const { data: alertas } = usePagosAlertas();
  const items = NAV.filter((n) =>
    n.modulo === 'finanzas-grupo'
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
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
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
              <span className="flex-1">{label}</span>
              {mostrarBadge && (
                <span
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
