-- ═══════════════════════════════════════════════════════════════════════════
-- Los recibos de junio entraron dos veces, y nada lo impedía
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 💥 QUÉ PASÓ, medido el 11-sep-2026
--
-- El mismo lote de recibos de sueldo de **2026-06** se cargó el **5-ago** y de
-- nuevo el **19-ago**. Nueve empleados, con el mismo neto, el mismo bruto y el
-- mismo período las dos veces. Lo único distinto es el archivo, porque el
-- nombre del PDF lleva la hora de la subida.
--
--     60 recibos en la tabla · 9 pares duplicados · $6.701.520,42 repetidos
--
-- Dónde se ve el número inflado: `RecibosTab.tsx` suma `monto_neto` de los
-- recibos filtrados. Filtrando por junio, el total mostraba $6,7 M de más.
--
-- ✅ NO llega al Estado de Resultados: cero vistas y cero funciones de la base
-- leen `recibos_sueldo`, y los sueldos del EdR salen de `pagos_sueldos`.
--
-- ── POR QUÉ PASÓ ───────────────────────────────────────────────────────────
--
-- `recibos_sueldo` tenía **sólo la clave primaria**. Ninguna restricción
-- impedía cargar dos veces el mismo recibo, y el alta no chequeaba nada.
--
-- Es la misma familia que el F931 que entró tres veces y dejó $8,7 M de gasto
-- fantasma. La puerta es otra; el agujero es el mismo.
--
-- ── QUÉ HACE ESTA MIGRACIÓN ────────────────────────────────────────────────
--
--   1. Borra los 9 recibos del 19-ago y deja la primera carga.
--   2. Pone el candado: único por (CUIL, período).
--   3. Agrega `hash_archivo` a `recibos_sueldo`, con su propio candado, para
--      que el MISMO PDF no se pueda subir dos veces. Ver la nota de abajo.
--      **A `veps` no se le agrega nada**, y el porqué está escrito abajo.
--
-- ── ⚠️ POR QUÉ `hash_archivo` Y NO `message_id` ────────────────────────────
--
-- Lucas pidió escribir `message_id` "al procesar el correo". Fui a hacerlo y
-- **ese correo no existe**: los PDF se arrastran a mano a la pantalla de
-- Integraciones (`procesarArchivo(file: File)`). La función `outlook` sólo
-- guarda el permiso de acceso, no trae mensajes, y ninguna pantalla la llama;
-- `correo_integracion` tiene 0 filas.
--
-- 🔑 Cuando alguien arrastra un archivo no hay ningún mensaje del que sacar un
-- id. Lo que SÍ identifica a ese archivo es su contenido. Por eso el candado
-- va sobre el hash, que además es el patrón que ya usa `comprobantes`
-- (`comprobantes_hash_archivo_key`) para exactamente esto.
--
-- `message_id` se deja como está, vacía, para el día que la entrada por correo
-- se construya de verdad. Queda comentada en la base para que se entienda.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Los nueve del 19-ago ───────────────────────────────────────────────
--
-- Se identifican por su posición en el par, no por la fecha escrita a mano:
-- de cada (CUIL, período) repetido se queda el más viejo y se va el resto.
with pares as (
  select id,
         row_number() over (
           partition by cuil_detectado, periodo order by created_at, id
         ) as orden
    from public.recibos_sueldo
)
delete from public.recibos_sueldo r
 using pares p
 where p.id = r.id and p.orden > 1;

-- ── 2 · El candado por empleado y período ──────────────────────────────────
create unique index if not exists recibos_sueldo_cuil_periodo_uidx
  on public.recibos_sueldo (cuil_detectado, periodo);

comment on index public.recibos_sueldo_cuil_periodo_uidx is
  'Un recibo por persona y por mes. Junio 2026 entró dos veces y nadie lo notó: $6,7 M de más en el total de la pantalla de Recibos.';

-- ── 3 · El candado por archivo ─────────────────────────────────────────────
--
-- Mismo patrón que `comprobantes.hash_archivo`: si se vuelve a arrastrar el
-- MISMO PDF, el alta choca con un 23505 y la pantalla puede decir "este recibo
-- ya estaba cargado" en vez de cargarlo de nuevo.
alter table public.recibos_sueldo
  add column if not exists hash_archivo text;

create unique index if not exists recibos_sueldo_hash_archivo_uidx
  on public.recibos_sueldo (hash_archivo) where hash_archivo is not null;

comment on column public.recibos_sueldo.hash_archivo is
  'SHA-256 del PDF que trajo este recibo. Impide subir dos veces el mismo archivo. Se llena desde Integraciones al procesarlo.';
comment on column public.recibos_sueldo.message_id is
  'VACÍA a propósito: hoy los PDF se suben a mano y no hay ningún correo del que sacar un id. Queda reservada para cuando la entrada por Outlook se construya. El anti-duplicado de hoy es hash_archivo.';

-- ⚠️ Y NO se le agrega nada a `veps`, aunque el pedido decía "en recibos_sueldo
-- y en veps". Fui a hacerlo y me frenó la medición: **`veps` no la escribe
-- nadie**. `grep -rn "veps" src/` no devuelve una sola línea, la tabla tiene 0
-- filas, y el VEP de verdad vive en `pagos_fijos.vep_numero`, que YA tiene su
-- candado único (`pagos_fijos_vep_numero_uidx`). Agregarle una columna a una
-- tabla que nadie escribe es justo lo que venimos listando como problema.
-- El agujero real del VEP es otro y se arregla del lado del código: el
-- anti-duplicado busca sólo entre los pagos no tildados.

-- ⚠️ Los índices sobre el hash son PARCIALES (`where hash_archivo is not null`)
-- a propósito: las 51 filas que ya estaban no tienen hash y no se les puede
-- calcular sin bajar cada PDF. Sin el `where`, en Postgres los NULL no chocan
-- igual, pero dejarlo escrito evita que alguien "lo emparejе" más adelante.

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARDARRAÍL
-- ═══════════════════════════════════════════════════════════════════════════
do $guardia$
declare
  v_n integer;
begin
  -- 1 · Quedaron 51: los 60 que había menos los 9 repetidos.
  select count(*) into v_n from public.recibos_sueldo;
  if v_n <> 51 then
    raise exception 'Esperaba 51 recibos después de sacar los 9 repetidos y quedaron %.', v_n;
  end if;

  -- 2 · No quedó ni un par repetido.
  select count(*) into v_n
    from (select 1 from public.recibos_sueldo
           group by cuil_detectado, periodo having count(*) > 1) x;
  if v_n <> 0 then
    raise exception 'Quedaron % par(es) repetidos. El candado no se puede poner así.', v_n;
  end if;

  -- 3 · Los 9 empleados siguen teniendo SU recibo de junio: se borró el
  --     duplicado, no la persona.
  select count(*) into v_n
    from public.recibos_sueldo where periodo = '2026-06';
  if v_n <> 9 then
    raise exception 'Junio tendría que quedar con 9 recibos, uno por empleado, y tiene %.', v_n;
  end if;

  -- 4 · Y el que quedó es el de la PRIMERA carga.
  select count(*) into v_n
    from public.recibos_sueldo
   where periodo = '2026-06' and created_at::date <> date '2026-08-05';
  if v_n <> 0 then
    raise exception 'Quedaron % recibo(s) de junio que NO son de la primera carga del 5-ago.', v_n;
  end if;

  -- 5 · Los dos candados están puestos.
  select count(*) into v_n
    from pg_indexes
   where schemaname = 'public'
     and indexname in ('recibos_sueldo_cuil_periodo_uidx',
                       'recibos_sueldo_hash_archivo_uidx');
  if v_n <> 2 then
    raise exception 'Esperaba los 2 índices únicos y encontré %.', v_n;
  end if;

  -- 6 · Y a `veps` no se le tocó nada: sigue sin columna de hash.
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'veps' and column_name = 'hash_archivo';
  if v_n <> 0 then
    raise exception 'Le quedó una columna hash_archivo a veps, que no la escribe nadie.';
  end if;

  raise notice 'Recibos OK · 51 filas · 9 en junio, uno por persona · 2 candados puestos';
end;
$guardia$;
