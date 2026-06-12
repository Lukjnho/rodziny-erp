// Edge function: gestión de usuarios (crear / resetear contraseña) desde el ERP.
// SOLO un admin (es_admin en perfiles) puede invocarla. Usa la service_role key
// para el admin API de auth, que jamás puede vivir en el frontend.
// Body: { accion: 'crear' | 'reset_password', ... }
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Columnas de permiso que un preset puede setear. Blindaje: NUNCA se permite
// es_admin por esta vía (eso se tilda a mano en la tabla de Usuarios).
const PERMISOS_VALIDOS = new Set([
  'puede_ver_dashboard', 'puede_ver_ventas', 'puede_ver_finanzas', 'puede_ver_flujo_caja',
  'puede_ver_edr', 'puede_ver_gastos', 'puede_ver_amortizaciones', 'puede_ver_rrhh',
  'puede_ver_compras', 'puede_ver_usuarios', 'puede_ver_cocina', 'puede_ver_almacen',
  'puede_ver_productos', 'puede_ver_agenda', 'puede_ver_convenios', 'puede_ver_integraciones',
]);

// Siempre 200 con { ok, error? } para que el mensaje llegue limpio al cliente
// (supabase-js esconde el body en los status 4xx/5xx).
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // 1. El que llama tiene que ser un admin autenticado.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!token) return json({ ok: false, error: 'No autenticado' });

    const { data: caller, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !caller?.user) return json({ ok: false, error: 'Sesión inválida' });

    const { data: perfilCaller } = await admin
      .from('perfiles').select('es_admin').eq('user_id', caller.user.id).maybeSingle();
    if (!perfilCaller?.es_admin) {
      return json({ ok: false, error: 'Solo un admin puede gestionar usuarios' });
    }

    const body = await req.json();
    const accion = body.accion as string;

    // 2. Crear usuario.
    if (accion === 'crear') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      if (!email || !password) return json({ ok: false, error: 'Email y contraseña son obligatorios' });
      if (password.length < 6) return json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' });

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (createErr || !created?.user) {
        return json({ ok: false, error: createErr?.message ?? 'No se pudo crear el usuario' });
      }

      // El trigger on_auth_user_created ya insertó el perfil; lo completamos.
      const patch: Record<string, unknown> = {};
      if (body.nombre) patch.nombre = String(body.nombre).trim();
      if (body.local_restringido === 'vedia' || body.local_restringido === 'saavedra') {
        patch.local_restringido = body.local_restringido;
      }
      if (body.permisos && typeof body.permisos === 'object') {
        for (const [k, v] of Object.entries(body.permisos)) {
          if (PERMISOS_VALIDOS.has(k)) patch[k] = !!v;
        }
      }
      if (Object.keys(patch).length > 0) {
        await admin.from('perfiles').update(patch).eq('user_id', created.user.id);
      }
      return json({ ok: true, user_id: created.user.id });
    }

    // 3. Resetear contraseña.
    if (accion === 'reset_password') {
      const userId = String(body.user_id ?? '');
      const password = String(body.password ?? '');
      if (!userId || !password) return json({ ok: false, error: 'Faltan datos' });
      if (password.length < 6) return json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' });

      const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password });
      if (updErr) return json({ ok: false, error: updErr.message });
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Acción no reconocida' });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) });
  }
});
