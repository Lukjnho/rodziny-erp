import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';
import {
  pushSoportado,
  permisoActual,
  estaSuscripto,
  activarNotificaciones,
  desactivarNotificaciones,
  enviarPushDePrueba,
} from '@/lib/push';

export function NotificacionesBoton() {
  const { user } = useAuth();
  const [soportado] = useState(() => pushSoportado());
  const [suscripto, setSuscripto] = useState(false);
  const [permiso, setPermiso] = useState(() => permisoActual());
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!soportado) return;
    estaSuscripto().then(setSuscripto).catch(() => {});
  }, [soportado]);

  if (!soportado) {
    return (
      <p className="mb-4 text-xs text-gray-400">
        Este navegador no soporta notificaciones push.
      </p>
    );
  }

  async function activar() {
    if (!user?.id) return;
    setCargando(true);
    setError(null);
    setMsg(null);
    try {
      await activarNotificaciones(user.id);
      setSuscripto(true);
      setPermiso(permisoActual());
      setMsg('✓ Notificaciones activadas en este dispositivo.');
    } catch (e) {
      setError(mensajeErrorAmigable(e));
    } finally {
      setCargando(false);
    }
  }

  async function desactivar() {
    setCargando(true);
    setError(null);
    setMsg(null);
    try {
      await desactivarNotificaciones();
      setSuscripto(false);
      setMsg('Notificaciones desactivadas en este dispositivo.');
    } catch (e) {
      setError(mensajeErrorAmigable(e));
    } finally {
      setCargando(false);
    }
  }

  async function prueba() {
    setCargando(true);
    setError(null);
    setMsg(null);
    try {
      await enviarPushDePrueba();
      setMsg('Push de prueba enviado. Debería llegarte en unos segundos.');
    } catch (e) {
      setError(mensajeErrorAmigable(e));
    } finally {
      setCargando(false);
    }
  }

  const bloqueado = permiso === 'denied';

  return (
    <div className="mb-4 rounded-lg border border-rodziny-100 bg-rodziny-50/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700">
          🔔 Notificaciones al celular
        </span>
        {suscripto ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Activadas en este dispositivo
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            Inactivas
          </span>
        )}

        <div className="ml-auto flex gap-2">
          {!suscripto && !bloqueado && (
            <button
              onClick={activar}
              disabled={cargando}
              className="rounded-md bg-rodziny-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-700 disabled:opacity-50"
            >
              {cargando ? 'Activando…' : 'Activar en este dispositivo'}
            </button>
          )}
          {suscripto && (
            <>
              <button
                onClick={prueba}
                disabled={cargando}
                className="rounded-md border border-rodziny-300 px-3 py-1.5 text-xs font-medium text-rodziny-700 hover:bg-rodziny-100 disabled:opacity-50"
              >
                Enviar prueba
              </button>
              <button
                onClick={desactivar}
                disabled={cargando}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Desactivar
              </button>
            </>
          )}
        </div>
      </div>

      {bloqueado && !suscripto && (
        <p className="mt-2 text-xs text-amber-700">
          Las notificaciones están bloqueadas para este sitio. Activalas desde el candado
          🔒 de la barra de direcciones → Notificaciones → Permitir.
        </p>
      )}
      {msg && <p className="mt-2 text-xs text-green-700">{msg}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
