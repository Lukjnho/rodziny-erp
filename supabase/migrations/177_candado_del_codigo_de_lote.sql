-- 177 — El candado que faltaba en el código de lote, y las 4 migraciones sin anotar
--
-- PARTE A — CANDADO
-- La migración 171 puso el generador (`trg_lote_pasta_codigo_unico`): si el código
-- ya existe en ese local, le va agregando `-b`, `-c`, etc. Pero **no había ningún
-- candado en la base**: si el generador fallaba o alguien escribía por otro lado,
-- dos cajones distintos podían quedar con el mismo código, que es justo lo que se
-- usa para entrar y sacar mercadería de la cámara.
--
-- Se esperó a que el generador se probara solo, como estaba anotado. Al 4-sep-2026:
-- **390 códigos, cero repetidos**, ni por local ni en total. Recién ahora se pone.
--
-- El alcance del candado es (local, codigo_lote) porque es exactamente el alcance
-- del generador, que compara `l.local = NEW.local`. Si fuera global bloquearía
-- códigos que el generador considera válidos y rompería la carga.
--
-- Efecto de borde buscado: el generador se rinde después de 26 tandas del mismo
-- producto en un día (`exit when v_tanda > 26`) y devolvía un código repetido en
-- silencio. Con el candado, eso pasa a fallar con un error visible en vez de
-- ensuciar la cámara con dos cajones iguales.

create unique index if not exists cocina_lotes_pasta_codigo_unico_por_local
  on public.cocina_lotes_pasta (local, codigo_lote)
  where codigo_lote is not null;

comment on index public.cocina_lotes_pasta_codigo_unico_por_local is
  'Dos lotes del mismo local no pueden compartir código: es el código con el que se '
  'entra y se saca mercadería de la cámara. El alcance (local, codigo_lote) es el mismo '
  'que usa el generador trg_lote_pasta_codigo_unico (migración 171).';

-- PARTE B — LAS 4 MIGRACIONES QUE CORRÍAN SIN ESTAR ANOTADAS
-- Las migraciones 168 a 171 estaban aplicadas en la base pero no figuraban en el
-- registro, así que el listado había dejado de servir para saber qué hay
-- desplegado, y un entorno nuevo iba a intentar aplicarlas de vuelta.
-- Se verificó una por una que el objeto que crean EXISTE, no por el nombre:
--   168 → la función de merma de cámara que descuenta lotes            ✓
--   169 → la columna cocina_recetas.descuenta_producto_id              ✓
--   170 → la vista v_cocina_stock_mostrador                            ✓
--   171 → el trigger trg_lote_pasta_codigo_unico                       ✓

insert into supabase_migrations.schema_migrations (version, name) values
  ('20260903160000', '168_merma_camara_descuenta_lotes'),
  ('20260903161000', '169_receta_declara_de_que_pote_descuenta'),
  ('20260903162000', '170_cuenta_unica_del_mostrador'),
  ('20260903163000', '171_codigo_de_lote_unico_por_tanda')
on conflict (version) do nothing;
