-- 028_cocina_pasta_sobrante.sql
-- Sobrante de pasta al porcionar: gramos que no alcanzan para una porción de 200g
-- y se reservan para sumarse al próximo porcionado de la misma pasta.
-- No es merma (no se descarta), es reutilización física.

alter table cocina_lotes_pasta
  add column if not exists sobrante_gramos numeric
    check (sobrante_gramos is null or sobrante_gramos >= 0),
  add column if not exists sobrante_origen_lote_id uuid
    references cocina_lotes_pasta(id) on delete set null;

comment on column cocina_lotes_pasta.sobrante_gramos is
  'Gramos que sobraron al porcionar (no alcanzaron para una bolsita de 200g). Quedan disponibles para sumarse al próximo porcionado de la misma pasta.';

comment on column cocina_lotes_pasta.sobrante_origen_lote_id is
  'Si este lote consumió un sobrante de un porcionado anterior, apunta al lote origen. Permite trazar la reutilización y marcar el sobrante como ya usado.';

create index if not exists idx_lotes_pasta_sobrante_pendiente
  on cocina_lotes_pasta(local, producto_id)
  where sobrante_gramos is not null and sobrante_gramos > 0;
