import { useEffect, useState } from 'react';

// Chequea si salió un deploy nuevo comparando la versión horneada en el bundle
// (__APP_VERSION__) contra /version.json, que se regenera en cada build.
// Si difieren, muestra un cartel para recargar y bajar la versión nueva.
// Pensado sobre todo para los QR públicos (depósito, fichar, producción, etc.)
// donde los teléfonos suelen quedarse con la app vieja cacheada.

const INTERVALO_MS = 60_000; // chequea cada 60s

async function obtenerVersionRemota(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

export function ActualizacionBanner() {
  const [hayNueva, setHayNueva] = useState(false);

  useEffect(() => {
    // En local (__APP_VERSION__ === 'dev') no tiene sentido chequear.
    if (__APP_VERSION__ === 'dev') return;

    let activo = true;

    const chequear = async () => {
      const remota = await obtenerVersionRemota();
      if (activo && remota && remota !== __APP_VERSION__) {
        setHayNueva(true);
      }
    };

    chequear();
    const id = setInterval(chequear, INTERVALO_MS);
    // Re-chequear al volver a la pestaña (típico en mobile)
    const onVisible = () => {
      if (document.visibilityState === 'visible') chequear();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      activo = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!hayNueva) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-between gap-3 bg-rodziny-800 px-4 py-3 text-white shadow-lg">
      <span className="text-sm font-medium">🔄 Hay una versión nueva disponible</span>
      <button
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-rodziny-800 transition-colors hover:bg-rodziny-50"
      >
        Actualizar
      </button>
    </div>
  );
}
