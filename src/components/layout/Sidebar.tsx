import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuth, type Modulo } from '@/lib/auth'

// Modulos que viven dentro del tab de Finanzas. Si el usuario tiene permiso
// a cualquiera de estos, mostramos el item Finanzas en el sidebar.
const MODULOS_FINANZAS: Modulo[] = ['finanzas', 'ventas', 'edr', 'gastos', 'amortizaciones']

const NAV: { to: string; label: string; icon: string; modulo: Modulo | 'finanzas-grupo' }[] = [
  { to: '/',          label: 'Dashboard', icon: '▦',  modulo: 'dashboard' },
  { to: '/finanzas',  label: 'Finanzas',  icon: '💰', modulo: 'finanzas-grupo' },
  { to: '/rrhh',      label: 'RRHH',      icon: '👥', modulo: 'rrhh' },
  { to: '/compras',   label: 'Gastos-Compras', icon: '🧾', modulo: 'compras' },
  { to: '/cocina',    label: 'Cocina',    icon: '🍝', modulo: 'cocina' },
  { to: '/almacen',   label: 'Almacén',   icon: '🏪', modulo: 'almacen' },
  { to: '/usuarios',  label: 'Usuarios',  icon: '🔑', modulo: 'usuarios' },
]

export function Sidebar() {
  const { perfil, signOut, tienePermiso } = useAuth()
  const items = NAV.filter((n) =>
    n.modulo === 'finanzas-grupo'
      ? MODULOS_FINANZAS.some((m) => tienePermiso(m))
      : tienePermiso(n.modulo)
  )

  const iniciales = (perfil?.nombre || '?').slice(0, 1).toUpperCase()
  const rolLabel = perfil?.es_admin ? 'Administrador' : 'Usuario'

  return (
    <aside className="w-60 h-screen sticky top-0 flex flex-col" style={{ background: '#0f1117', borderRight: '1px solid #1e2330' }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b" style={{ borderColor: '#1e2330' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold" style={{ background: '#2D5016', color: '#82c44e' }}>R</div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">Rodziny</div>
            <div className="text-xs" style={{ color: '#8b9bb4' }}>Sistema de gestión</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {items.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all',
              isActive
                ? 'text-white border-l-2 border-rodziny-500'
                : 'text-sidebar-text hover:text-white hover:bg-sidebar-hover'
            )}
            style={({ isActive }) => isActive ? { background: '#1e2a14' } : {}}
          >
            <span className="text-base">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t" style={{ borderColor: '#1e2330' }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-rodziny-800 flex items-center justify-center text-xs font-bold text-rodziny-400">
            {iniciales}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white truncate capitalize">{perfil?.nombre || 'Usuario'}</div>
            <div className="text-xs truncate" style={{ color: '#8b9bb4' }}>{rolLabel}</div>
          </div>
        </div>
        <button
          onClick={() => signOut()}
          className="w-full text-xs rounded px-2 py-1.5 transition-colors"
          style={{ background: '#1e2330', color: '#8b9bb4' }}
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
