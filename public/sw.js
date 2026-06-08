/* Service worker mínimo del ERP — SOLO Web Push. No cachea assets (para no
   arriesgar el deploy activo con contenido viejo). */

self.addEventListener('install', () => {
  // Activar la nueva versión del SW de inmediato.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Llega un push del servidor → mostrar la notificación.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Rodziny ERP', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Rodziny ERP';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/agenda' },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click en la notificación → enfocar una pestaña abierta o abrir la URL.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/agenda';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client) client.navigate(url);
            return;
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
