import { supabase } from './supabase';

// Clave pública VAPID (es pública por diseño; la privada vive como secret del
// edge function enviar-push).
const VAPID_PUBLIC_KEY =
  'BIUI-mNe5S0tC7D1dXbj4q9WB1kOpP-ONH-Mw7-v4qZWN7GXOkwOtaAUViE1wrzYktTZhyAw4-l8GGR7TYu-_mw';

export function pushSoportado(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function permisoActual(): NotificationPermission | 'unsupported' {
  if (!pushSoportado()) return 'unsupported';
  return Notification.permission;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  // Asegura que el SW esté registrado y listo.
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return navigator.serviceWorker.ready;
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/** ¿Este dispositivo ya está suscripto? */
export async function estaSuscripto(): Promise<boolean> {
  if (!pushSoportado()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

/** Pide permiso, suscribe el dispositivo y guarda la suscripción en Supabase. */
export async function activarNotificaciones(userId: string): Promise<void> {
  if (!pushSoportado()) {
    throw new Error('Este dispositivo o navegador no soporta notificaciones push.');
  }

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    throw new Error(
      permiso === 'denied'
        ? 'Las notificaciones están bloqueadas. Activalas desde los ajustes del navegador.'
        : 'No se concedió el permiso de notificaciones.',
    );
  }

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint!,
      p256dh: json.keys!.p256dh,
      auth: json.keys!.auth,
      user_agent: navigator.userAgent.slice(0, 300),
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;
}

/** Desuscribe este dispositivo y borra la suscripción guardada. */
export async function desactivarNotificaciones(): Promise<void> {
  if (!pushSoportado()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

/** Notifica a las personas a quienes se les compartió/asignó una tarea. */
export async function notificarTareaCompartida(
  userIds: string[],
  titulo: string,
  deNombre: string,
): Promise<void> {
  if (userIds.length === 0) return;
  // No bloquear el guardado si el push falla: se intenta y se ignora el error.
  try {
    await supabase.functions.invoke('enviar-push', {
      body: {
        user_ids: userIds,
        title: `📋 ${deNombre} te compartió una tarea`,
        body: titulo,
        url: '/agenda',
      },
    });
  } catch {
    /* el push es best-effort */
  }
}

/** Envía un push de prueba al propio usuario (vía edge function). */
export async function enviarPushDePrueba(): Promise<void> {
  const { data: sesion } = await supabase.auth.getUser();
  const uid = sesion.user?.id;
  if (!uid) throw new Error('Sin sesión');
  const { error } = await supabase.functions.invoke('enviar-push', {
    body: {
      user_ids: [uid],
      title: '🔔 Prueba de notificación',
      body: 'Si ves esto en tu celular, las notificaciones funcionan.',
      url: '/agenda',
    },
  });
  if (error) throw error;
}
