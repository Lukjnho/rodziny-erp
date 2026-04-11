# cleanup-fichadas-fotos

Edge Function que borra las fotos del bucket `fichadas-fotos` con más de 30 días.
Las filas de la tabla `fichadas` se conservan — solo se borra el archivo y se setea `foto_path = null`.

## Deploy

```bash
supabase functions deploy cleanup-fichadas-fotos
```

## Test manual

```bash
curl -X POST \
  "https://<PROJECT_REF>.supabase.co/functions/v1/cleanup-fichadas-fotos" \
  -H "Authorization: Bearer <ANON_KEY>"
```

Respuesta esperada:
```json
{ "ok": true, "borradas": 12, "errores": [], "total_candidatas": 12, "fecha_corte": "2026-03-11" }
```

## Schedule automático (pg_cron)

Ejecutar UNA sola vez en el SQL Editor de Supabase:

```sql
-- Habilitar extensiones (si no están)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Programar limpieza diaria a las 06:00 UTC (= 03:00 AR)
select cron.schedule(
  'cleanup-fichadas-fotos-diario',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cleanup-fichadas-fotos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    )
  );
  $$
);

-- Para ver el schedule:
select * from cron.job;

-- Para borrar el schedule (si querés desprogramarlo):
-- select cron.unschedule('cleanup-fichadas-fotos-diario');
```

> Reemplazar `<PROJECT_REF>` y `<SERVICE_ROLE_KEY>` con los valores reales del proyecto.
> El SERVICE_ROLE_KEY se ve en Supabase Dashboard → Settings → API.

## Configuración

Editar las constantes en `index.ts`:
- `DIAS_RETENCION = 30` — días que se conservan las fotos
- `BATCH_LIMIT = 500` — máximo de fotos a procesar por corrida
- `BUCKET = 'fichadas-fotos'` — bucket del que borrar
