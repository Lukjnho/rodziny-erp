// Edge function: envía notificaciones Web Push a uno o varios usuarios.
// Body: { user_ids: string[], title: string, body?: string, url?: string, tag?: string }
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:adm.rodziny@gmail.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      throw new Error('Faltan las claves VAPID en los secrets del proyecto.');
    }

    const { user_ids, title, body, url, tag } = await req.json();
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return new Response(JSON.stringify({ error: 'user_ids requerido' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: subs, error } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', user_ids);
    if (error) throw error;

    const payload = JSON.stringify({
      title: title ?? 'Rodziny ERP',
      body: body ?? '',
      url: url ?? '/agenda',
      tag,
    });

    let enviados = 0;
    const vencidas: string[] = [];

    await Promise.all(
      (subs ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          enviados++;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          // 404/410 = suscripción muerta → marcar para borrar.
          if (code === 404 || code === 410) vencidas.push(s.id);
        }
      }),
    );

    if (vencidas.length > 0) {
      await admin.from('push_subscriptions').delete().in('id', vencidas);
    }

    return new Response(
      JSON.stringify({ enviados, vencidas: vencidas.length, total: subs?.length ?? 0 }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
