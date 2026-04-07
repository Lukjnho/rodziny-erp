import { type ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}

export function PageContainer({ title, subtitle, actions, children }: Props) {
  return (
    <div className="flex-1 flex flex-col min-h-screen bg-surface-bg">
      {/* Topbar */}
      <header className="bg-white border-b border-surface-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>

      {/* Content */}
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
