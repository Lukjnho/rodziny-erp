import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Callback de OAuth de Microsoft (cuenta Outlook personal). Pública a propósito:
// Microsoft redirige acá SIN un JWT de Supabase. Se protege validando el `state`
// que generó la función `outlook` (CSRF). Intercambia el code por tokens y los
// guarda en correo_integracion (tabla blindada, solo service_role).

const TENANT = 'consumers';
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const SCOPES = 'offline_access Mail.Read User.Read';

Deno.serve(async (req) => {
  const reqUrl = new URL(req.url);
  const code = reqUrl.searchParams.get('code');
  const state = reqUrl.searchParams.get('state');
  const errorParam = reqUrl.searchParams.get('error');
  const appUrl = Deno.env.get('APP_URL') ?? 'https://rodziny-erp.vercel.app';

  const redirect = (qs: string) =>
    new Response(null, { status: 302, headers: { Location: `${appUrl}/integraciones?${qs}` } });

  if (errorParam) return redirect(`error=${encodeURIComponent(errorParam)}`);
  if (!code || !state) return redirect('error=faltan_parametros');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Validar state (CSRF)
  const { data: integ } = await supabase
    .from('correo_integracion')
    .select('oauth_state')
    .eq('id', 1)
    .single();
  if (!integ || integ.oauth_state !== state) return redirect('error=state_invalido');

  const clientId = Deno.env.get('OUTLOOK_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('OUTLOOK_CLIENT_SECRET') ?? '';
  const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/outlook-callback`;

  // Intercambiar code → tokens
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPES,
    }).toString(),
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok || !tok.refresh_token) {
    await supabase
      .from('correo_integracion')
      .update({
        ultimo_error: `token: ${JSON.stringify(tok).slice(0, 400)}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    return redirect('error=token');
  }

  // Email de la casilla conectada (informativo)
  let email: string | null = null;
  try {
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      email = me.mail ?? me.userPrincipalName ?? null;
    }
  } catch {
    /* no crítico */
  }

  const expira = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString();
  await supabase
    .from('correo_integracion')
    .update({
      conectado: true,
      email_casilla: email,
      refresh_token: tok.refresh_token,
      access_token: tok.access_token,
      token_expira_en: expira,
      oauth_state: null,
      ultimo_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  return redirect('conectado=1');
});
