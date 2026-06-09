import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';

// ── Tipos ──────────────────────────────────────────────────────────────────
interface EstadoCorreo {
  conectado: boolean;
  email_casilla: string | null;
  ultima_lectura: string | null;
  ultimo_error: string | null;
  updated_at: string | null;
}

interface Remitente {
  id: string;
  email: string;
  nombre: string | null;
  activo: boolean;
  created_at: string;
}

// Traduce el ?error= que devuelve el callback de Microsoft a algo legible.
const ERRORES: Record<string, string> = {
  token: 'Microsoft no devolvió el acceso. Revisá el Client Secret y volvé a intentar.',
  state_invalido: 'La sesión de conexión expiró. Reintentá desde "Conectar Outlook".',
  faltan_parametros: 'Microsoft no devolvió el código de autorización.',
  access_denied: 'Cancelaste el permiso en la pantalla de Microsoft.',
};

function fechaHora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

export function IntegracionesPage() {
  const qc = useQueryClient();
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [conectando, setConectando] = useState(false);

  // Leer ?conectado=1 / ?error= que deja el callback al volver
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('conectado') === '1') {
      setAviso({ tipo: 'ok', texto: '✓ Outlook conectado correctamente.' });
      qc.invalidateQueries({ queryKey: ['correo_estado'] });
    } else if (params.get('error')) {
      const code = params.get('error') ?? '';
      setAviso({ tipo: 'error', texto: ERRORES[code] ?? `Error al conectar: ${code}` });
    }
    if (params.has('conectado') || params.has('error')) {
      window.history.replaceState({}, '', '/integraciones');
    }
  }, [qc]);

  // ── Estado de la conexión ──
  const { data: estado, isLoading } = useQuery({
    queryKey: ['correo_estado'],
    queryFn: async (): Promise<EstadoCorreo | null> => {
      const { data, error } = await supabase.rpc('correo_integracion_estado');
      if (error) throw error;
      return (data?.[0] ?? null) as EstadoCorreo | null;
    },
    refetchInterval: 1000 * 30,
  });

  // ── Remitentes ──
  const { data: remitentes } = useQuery({
    queryKey: ['correo_remitentes'],
    queryFn: async (): Promise<Remitente[]> => {
      const { data, error } = await supabase
        .from('correo_remitentes')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as Remitente[];
    },
  });

  const conectar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; url?: string; error?: string }>(
        'outlook',
        { body: { action: 'consent_url' } },
      );
      if (error) throw error;
      if (!data?.ok || !data.url) throw new Error(data?.error ?? 'No se pudo generar el enlace.');
      return data.url;
    },
    onMutate: () => setConectando(true),
    onSuccess: (url) => {
      window.location.href = url; // ir a la pantalla de login de Microsoft
    },
    onError: (e: Error) => {
      setConectando(false);
      setAviso({ tipo: 'error', texto: e.message });
    },
  });

  const desconectar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>('outlook', {
        body: { action: 'desconectar' },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'No se pudo desconectar.');
    },
    onSuccess: () => {
      setAviso({ tipo: 'ok', texto: 'Outlook desconectado.' });
      qc.invalidateQueries({ queryKey: ['correo_estado'] });
    },
    onError: (e: Error) => setAviso({ tipo: 'error', texto: e.message }),
  });

  const conectado = !!estado?.conectado;

  return (
    <PageContainer title="Integraciones">
      <div className="space-y-4">
        {aviso && (
          <div
            className={cn(
              'flex items-start justify-between gap-3 rounded-lg border p-3 text-sm',
              aviso.tipo === 'ok'
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800',
            )}
          >
            <span>{aviso.texto}</span>
            <button onClick={() => setAviso(null)} className="text-xs opacity-60 hover:opacity-100">
              ✕
            </button>
          </div>
        )}

        {/* ── Tarjeta Outlook ── */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-xl">
                📧
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Outlook — Correo de contadores</h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  Lee los mails de los contadores y extrae recibos de sueldo (→ RRHH) y VEPs (→
                  Finanzas). Permiso de <span className="font-medium">solo lectura</span>.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium',
                      conectado ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        conectado ? 'bg-green-500' : 'bg-gray-400',
                      )}
                    />
                    {isLoading ? 'Cargando…' : conectado ? 'Conectado' : 'Sin conectar'}
                  </span>
                  {estado?.email_casilla && (
                    <span className="text-gray-600">{estado.email_casilla}</span>
                  )}
                  {conectado && (
                    <span className="text-gray-400">
                      Última lectura: {fechaHora(estado?.ultima_lectura ?? null)}
                    </span>
                  )}
                </div>
                {estado?.ultimo_error && (
                  <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                    ⚠ Último error: {estado.ultimo_error}
                  </p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {conectado ? (
                <button
                  onClick={() => {
                    if (window.confirm('¿Desconectar la casilla de Outlook? Se dejará de leer correo.'))
                      desconectar.mutate();
                  }}
                  disabled={desconectar.isPending}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {desconectar.isPending ? 'Desconectando…' : 'Desconectar'}
                </button>
              ) : (
                <button
                  onClick={() => conectar.mutate()}
                  disabled={conectando}
                  className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {conectando ? 'Redirigiendo…' : 'Conectar Outlook'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Remitentes de contadores ── */}
        <SeccionRemitentes remitentes={remitentes ?? []} />

        {/* ── Nota Paso 2 ── */}
        <p className="text-xs text-gray-400">
          La lectura automática y las alertas se activan una vez conectada la casilla y cargados los
          remitentes.
        </p>
      </div>
    </PageContainer>
  );
}

// ─── Sección remitentes ──────────────────────────────────────────────────────
function SeccionRemitentes({ remitentes }: { remitentes: Remitente[] }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);

  const invalidar = () => qc.invalidateQueries({ queryKey: ['correo_remitentes'] });

  const agregar = useMutation({
    mutationFn: async () => {
      const limpio = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpio)) throw new Error('Email inválido.');
      const { error } = await supabase
        .from('correo_remitentes')
        .insert({ email: limpio, nombre: nombre.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      setEmail('');
      setNombre('');
      setError(null);
      invalidar();
    },
    onError: (e: Error) =>
      setError(
        e.message.includes('duplicate') || e.message.includes('uniq')
          ? 'Ese remitente ya está cargado.'
          : e.message,
      ),
  });

  const toggleActivo = useMutation({
    mutationFn: async (r: Remitente) => {
      const { error } = await supabase
        .from('correo_remitentes')
        .update({ activo: !r.activo })
        .eq('id', r.id);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('correo_remitentes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-gray-900">Remitentes de contadores</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Solo se procesan los mails que llegan de estas direcciones. Agregá las casillas de tus
        contadores.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-[11px] font-medium text-gray-600">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contador@estudio.com"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="min-w-[160px]">
          <label className="mb-1 block text-[11px] font-medium text-gray-600">Nombre (opcional)</label>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Estudio Pérez"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={() => agregar.mutate()}
          disabled={agregar.isPending || !email.trim()}
          className="rounded bg-rodziny-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-700 disabled:opacity-50"
        >
          + Agregar
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      <div className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
        {remitentes.length === 0 && (
          <p className="py-4 text-center text-xs text-gray-400">
            Todavía no hay remitentes cargados.
          </p>
        )}
        {remitentes.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm text-gray-800">{r.email}</div>
              {r.nombre && <div className="text-[11px] text-gray-500">{r.nombre}</div>}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleActivo.mutate(r)}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  r.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500',
                )}
                title="Activar / pausar"
              >
                {r.activo ? 'Activo' : 'Pausado'}
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`¿Borrar el remitente ${r.email}?`)) borrar.mutate(r.id);
                }}
                className="text-xs text-gray-400 hover:text-red-600"
                title="Borrar"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
