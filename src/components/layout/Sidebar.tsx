import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/',          label: 'Dashboard',  icon: '▦' },
  { to: '/ventas',    label: 'Ventas',     icon: '📈' },
  { to: '/finanzas',  label: 'Finanzas',   icon: '💰' },
  { to: '/edr',       label: 'EdR',        icon: '📋' },
  { to: '/gastos',          label: 'Gastos',          icon: '🧾' },
  { to: '/amortizaciones', label: 'Amortizaciones',  icon: '📉' },
  { to: '/rrhh',      label: 'RRHH',       icon: '👥' },
  { to: '/compras',   label: 'Compras',    icon: '🛒' },
]

export function Sidebar() {
  return (
    <aside className="w-60 min-h-screen flex flex-col" style={{ background: '#0f1117', borderRight: '1px solid #1e2330' }}>
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
        {NAV.map(({ to, label, icon }) => (
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
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-rodziny-800 flex items-center justify-center text-xs font-bold text-rodziny-400">L</div>
          <div>
            <div className="text-sm text-white">Lucas</div>
            <div className="text-xs" style={{ color: '#8b9bb4' }}>Superadmin</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
