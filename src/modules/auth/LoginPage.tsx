import { useState, type FormEvent } from 'react'
import { useAuth } from '@/lib/auth'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    const { error: err } = await signIn(email.trim(), password)
    setCargando(false)
    if (err) {
      // Mensajes más claros que los de Supabase
      if (err.includes('Invalid login')) setError('Email o contraseña incorrectos.')
      else setError(err)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: '#0f1117' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-lg flex items-center justify-center text-2xl font-bold mb-3"
            style={{ background: '#2D5016', color: '#82c44e' }}
          >
            R
          </div>
          <h1 className="text-white text-xl font-semibold">Rodziny</h1>
          <p className="text-xs" style={{ color: '#8b9bb4' }}>Sistema de gestión</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow-2xl p-6 space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              autoComplete="email"
              placeholder="tu@rodziny.com.ar"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rodziny-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Contraseña</label>
            <div className="relative">
              <input
                type={verPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full border border-gray-300 rounded px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-rodziny-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setVerPassword((v) => !v)}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 text-base px-1"
                title={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {verPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={cargando}
            className="w-full bg-rodziny-700 hover:bg-rodziny-800 disabled:opacity-60 text-white rounded py-2 text-sm font-medium transition-colors"
          >
            {cargando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <p className="text-center text-[11px] mt-6" style={{ color: '#8b9bb4' }}>
          Si no recordás tu contraseña, pedile a Lucas que la reinicie.
        </p>
      </div>
    </div>
  )
}
