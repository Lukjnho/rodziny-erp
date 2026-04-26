-- 030_cocina_pure_papa_semolin_huevo.sql
-- Soporte para los ñoquis: el "Pure papa para ñoqui" en sector producción
-- recibe semolín y huevo según un ratio por kg de puré usado. El operario
-- carga lo que efectivamente agregó a cada bandeja.

alter table cocina_recetas
  add column if not exists g_semolin_por_kg numeric
    check (g_semolin_por_kg is null or g_semolin_por_kg >= 0),
  add column if not exists g_huevo_por_kg numeric
    check (g_huevo_por_kg is null or g_huevo_por_kg >= 0);

comment on column cocina_recetas.g_semolin_por_kg is
  'Gramos de semolín a agregar por kg de esta preparación al usarla en pastas. Sugerencia editable en QR.';
comment on column cocina_recetas.g_huevo_por_kg is
  'Gramos de huevo a agregar por kg de esta preparación al usarla en pastas. Sugerencia editable en QR.';

alter table cocina_lotes_pasta
  add column if not exists semolin_gramos integer
    check (semolin_gramos is null or semolin_gramos >= 0),
  add column if not exists huevo_gramos integer
    check (huevo_gramos is null or huevo_gramos >= 0);

comment on column cocina_lotes_pasta.semolin_gramos is
  'Semolín efectivamente agregado al puré para esta bandeja (g). Sólo aplica a ñoquis u otras pastas con ratio en la receta del relleno.';
comment on column cocina_lotes_pasta.huevo_gramos is
  'Huevo efectivamente agregado al puré para esta bandeja (g). Sólo aplica a ñoquis u otras pastas con ratio en la receta del relleno.';

-- Ratios reales del puré de papa de Rodziny: 350g semolín + 180g huevo por kg de puré.
update cocina_recetas
set g_semolin_por_kg = 350,
    g_huevo_por_kg = 180
where nombre ilike 'pure papa para ñoqui';
