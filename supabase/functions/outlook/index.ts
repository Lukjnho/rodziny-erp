import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Acciones administrativas de la integración Outlook: generar URL de consentimiento,
// desconectar y consultar estado. La autenticación OAuth real (callback de Microsoft)
// vive en la función `outlook-callback`. Esta función exige JWT válido + perfil admin.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TENANT = 'consumers'; // cuenta Outlook personal
const AUTH_BASE = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const SCOPES = 'offline_access Mail.Read User.Read';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // ── Auth: JWT válido + admin ──
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ ok: false, error: 'no autenticado' }, 401);
  const { data: perfil } = await supabase
    .from('perfiles')
    .select('es_admin')
    .eq('user_id', userData.user.id)
    .single();
  if (!perfil?.es_admin) return json({ ok: false, error: 'requiere admin' }, 403);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* sin body */
  }
  const action = body.action as string | undefined;

  const clientId = Deno.env.get('OUTLOOK_CLIENT_ID') ?? '';
  const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/outlook-callback`;

  if (action === 'consent_url') {
    if (!clientId)
      return json({ ok: false, error: 'Falta configurar OUTLOOK_CLIENT_ID en el servidor.' }, 400);
    const state = crypto.randomUUID();
    await supabase
      .from('correo_integracion')
      .update({ oauth_state: state, updated_at: new Date().toISOString() })
      .eq('id', 1);
    const url =
      `${AUTH_BASE}/authorize?` +
      new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: SCOPES,
        state,
      }).toString();
    return json({ ok: true, url });
  }

  if (action === 'desconectar') {
    await supabase
      .from('correo_integracion')
      .update({
        conectado: false,
        refresh_token: null,
        access_token: null,
        token_expira_en: null,
        oauth_state: null,
        ultimo_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    return json({ ok: true });
  }

  if (action === 'estado') {
    const { data } = await supabase
      .from('correo_integracion')
      .select('conectado, email_casilla, ultima_lectura, ultimo_error, updated_at')
      .eq('id', 1)
      .single();
    return json({ ok: true, estado: data });
  }

  return json({ ok: false, error: 'acción desconocida' }, 400);
});
