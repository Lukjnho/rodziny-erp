-- 013_lotes_pasta_porciones_nullable.sql
-- En el flujo real de producción el equipo no mide porciones estimadas al armar los
-- cajones — las porciones reales se cuentan recién cuando se porciona en bolsitas
-- de 200g al día siguiente. Por eso los lotes que están en freezer_produccion pueden
-- quedar con porciones=null hasta que se porcionen y pasen a camara_congelado.

alter table cocina_lotes_pasta
  alter column porciones drop not null;

notify pgrst, 'reload schema';
