import { type ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PageContainer({ title, subtitle, actions, children }: Props) {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-surface-bg">
      {/* Topbar */}
      <header className="flex items-center justify-between border-b border-surface-border bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>

      {/* Content */}
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
