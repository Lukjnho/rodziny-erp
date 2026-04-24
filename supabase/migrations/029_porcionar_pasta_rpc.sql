-- 029_porcionar_pasta_rpc.sql
-- Function SECURITY DEFINER para que el QR público (anon) pueda porcionar lotes
-- de pasta sin abrir un UPDATE genérico sobre la tabla. La policy RLS sigue
-- bloqueando UPDATE directo desde anon; solo este flujo controlado pasa.

create or replace function public.porcionar_pasta_lote(
  p_lote_id uuid,
  p_porciones int,
  p_responsable text default null,
  p_sobrante_gramos numeric default null,
  p_sobrante_origen_lote_id uuid default null,
  p_merma_porcionado int default 0,
  p_notas text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existe boolean;
begin
  if p_porciones is null or p_porciones <= 0 then
    raise exception 'porciones debe ser > 0';
  end if;

  -- Validar que el lote exista y esté en freezer (evita doble porcionado)
  select true into v_existe
  from cocina_lotes_pasta
  where id = p_lote_id and ubicacion = 'freezer_produccion'
  limit 1;

  if v_existe is null then
    raise exception 'Lote no encontrado o ya porcionado';
  end if;

  update cocina_lotes_pasta
  set ubicacion = 'camara_congelado',
      porciones = p_porciones,
      fecha_porcionado = current_date,
      responsable_porcionado = nullif(trim(coalesce(p_responsable, '')), ''),
      merma_porcionado = coalesce(p_merma_porcionado, 0),
      sobrante_gramos = case
        when p_sobrante_gramos is not null and p_sobrante_gramos > 0 then p_sobrante_gramos
        else null
      end,
      sobrante_origen_lote_id = p_sobrante_origen_lote_id,
      notas = case
        when p_notas is not null and length(trim(p_notas)) > 0
        then '[Porcionado] ' || trim(p_notas)
        else notas
      end
  where id = p_lote_id;
end;
$$;

revoke all on function public.porcionar_pasta_lote(uuid, int, text, numeric, uuid, int, text) from public;
grant execute on function public.porcionar_pasta_lote(uuid, int, text, numeric, uuid, int, text) to anon, authenticated;

comment on function public.porcionar_pasta_lote is
  'Porciona un lote de pasta fresca: lo pasa a camara_congelado con sus porciones reales, responsable, merma y sobrante. Único punto de entrada para que el QR (anon) pueda completar el ciclo del lote sin abrir UPDATE genérico.';
