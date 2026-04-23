import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const { error: err } = await signIn(email.trim(), password);
    setCargando(false);
    if (err) {
      // Mensajes más claros que los de Supabase
      if (err.includes('Invalid login')) setError('Email o contraseña incorrectos.');
      else setError(err);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: '#0f1117' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div
            className="mb-3 flex h-14 w-14 items-center justify-center rounded-lg text-2xl font-bold"
            style={{ background: '#2D5016', color: '#82c44e' }}
          >
            R
          </div>
          <h1 className="text-xl font-semibold text-white">Rodziny</h1>
          <p className="text-xs" style={{ color: '#8b9bb4' }}>
            Sistema de gestión
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg bg-white p-6 shadow-2xl">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              autoComplete="email"
              placeholder="tu@rodziny.com.ar"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-rodziny-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Contraseña</label>
            <div className="relative">
              <input
                type={verPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-rodziny-500"
              />
              <button
                type="button"
                onClick={() => setVerPassword((v) => !v)}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-base text-gray-500 hover:text-gray-700"
                title={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {verPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={cargando}
            className="w-full rounded bg-rodziny-700 py-2 text-sm font-medium text-white transition-colors hover:bg-rodziny-800 disabled:opacity-60"
          >
            {cargando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px]" style={{ color: '#8b9bb4' }}>
          Si no recordás tu contraseña, pedile a Lucas que la reinicie.
        </p>
      </div>
    </div>
  );
}
