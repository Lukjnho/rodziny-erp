-- 171 · El codigo de lote identifica UNA tanda, no un dia
--
-- POR QUE AHORA. Lucas (3-sep-2026): "faltaria los botones o parte donde diga el
-- codigo cuando se produce, acordate que ese codigo es el que vamos a usar para
-- ingresar y retirar la mercaderia de la camara". Desde el momento en que ese
-- codigo se escribe en un cajon, tiene que identificar UNA tanda. Hoy no lo hace.
--
-- EL PROBLEMA, medido el 3-sep-2026. El codigo lo arma el navegador como
-- producto + dia (ProduccionQRPage: `${prodSel.codigo}-${formatDDMM(hoy())}`), asi
-- que DOS TANDAS DE LA MISMA PASTA EL MISMO DIA COMPARTEN CODIGO. No es historia:
-- los dos ultimos lotes cargados hoy son los dos `mezz-0309`. Paso 10 veces en los
-- ultimos 60 dias, y hay 26 codigos repetidos entre los lotes de camara.
--
-- LA SOLUCION: la tanda se numera con una letra. mezz-0309, mezz-0309-b,
-- mezz-0309-c... Se eligio letra y no hora ni id porque la etiqueta se imprime y
-- se puede llegar a tipear a mano si el lector falla: tiene que ser corto y
-- legible. Y la primera tanda del dia NO cambia de forma, asi que lo que el
-- equipo ya conoce sigue leyendose igual.
--
-- ⚠️ EL ORDEN IMPORTA Y ES ESTE. Primero el generador (este archivo), DESPUES el
-- candado (un UNIQUE, en otra migracion y cuando se vea que anda). Al reves, el
-- equipo queda trabado a las 6 de la mañana y encima con un mensaje que miente:
-- erroresSupabase traduce el error 23505 como "Ya existe un registro con esos
-- datos. Puede que ya lo hayas cargado hoy", que es exactamente lo que NO pasa.
--
-- ⚠️ VA EN LA BASE, NO EN EL NAVEGADOR. Si el sufijo se calculara en la pantalla,
-- dos tablets cargando a la vez elegirian la misma letra. Ademas el QR no es la
-- unica puerta a esta tabla.
--
-- SEGURO PARA EL HISTORIAL: ninguna vista, funcion ni pantalla usa codigo_lote
-- para calcular nada — es texto para el ojo humano. cocina_lote_consumos apunta
-- por lote_pasta_id, no por codigo. Verificado antes de escribir esto.

create or replace function public.trg_lote_pasta_codigo_unico()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_base   text;
  v_cand   text;
  v_tanda  int := 1;
begin
  v_base := nullif(btrim(coalesce(NEW.codigo_lote, '')), '');
  if v_base is null then
    return NEW;  -- sin codigo no hay nada que desambiguar
  end if;

  v_cand := v_base;
  while exists (
    select 1 from cocina_lotes_pasta l
    where l.local = NEW.local
      and l.codigo_lote = v_cand
      and (TG_OP = 'INSERT' or l.id <> NEW.id)
  ) loop
    v_tanda := v_tanda + 1;
    exit when v_tanda > 26;              -- 26 tandas del mismo producto en un dia no pasa
    v_cand := v_base || '-' || chr(96 + v_tanda);   -- 2 -> b, 3 -> c, ...
  end loop;

  NEW.codigo_lote := v_cand;
  return NEW;
end;
$function$;

drop trigger if exists trg_lote_pasta_codigo_unico_ins on public.cocina_lotes_pasta;
create trigger trg_lote_pasta_codigo_unico_ins
  before insert on public.cocina_lotes_pasta
  for each row execute function public.trg_lote_pasta_codigo_unico();

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL de lo viejo. Se hace AHORA porque estos codigos nunca se imprimieron
-- ni se escribieron en un cajon: no hay nada en el mundo fisico que contradecir.
-- La tanda mas vieja de cada grupo CONSERVA su codigo tal cual; solo las
-- siguientes reciben la letra. No se recalcula ningun codigo: se le agrega un
-- sufijo al que ya estaba (hay 9 lotes cuyo codigo no sale de la formula del
-- navegador y hay que dejarlos como estan).
-- ─────────────────────────────────────────────────────────────────────────────
with dup as (
  select id,
         codigo_lote,
         row_number() over (partition by local, codigo_lote order by created_at, id) as tanda
  from public.cocina_lotes_pasta
  where codigo_lote is not null and btrim(codigo_lote) <> ''
)
update public.cocina_lotes_pasta l
set codigo_lote = d.codigo_lote || '-' || chr(96 + d.tanda::int)
from dup d
where d.id = l.id
  and d.tanda > 1
  and d.tanda <= 26;
