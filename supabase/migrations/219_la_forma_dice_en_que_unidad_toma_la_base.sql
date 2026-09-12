-- ═══════════════════════════════════════════════════════════════════════════
-- ETAPA 2 · PASO 1 bis — La forma dice EN QUÉ UNIDAD toma su receta base
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 💣 POR QUÉ APARECIÓ ESTA COLUMNA
--
-- El paso 1 dejó `multiplicador` a secas, dando por hecho que "cuánta receta
-- base entra" se entiende solo. No se entiende: el motor de costeo elige entre
-- `costoBasePorKg` y `costoBasePorPorcion` MIRANDO LA UNIDAD del renglón, y
-- una subreceta puede rendir en las dos.
--
-- Medido antes de escribirla, sobre lo que hay hoy:
--
--   · 107 subrecetas activas. 68 declaran rendimiento en kg, 48 en porciones
--     y 9 declaran LAS DOS. En esas 9 el número solo no alcanza.
--   · Los 122 renglones que las 43 recetas variante usan para tomar su base
--     están escritos en tres unidades: 64 en 'unid.', 50 en 'kg' y 8 en 'g'.
--
-- Sin la unidad, el paso 3 tiene que adivinar en 9 casos, y adivinar mal
-- cambia el costo sin que nada falle. Con ella, la forma dice exactamente lo
-- mismo que decía el renglón viejo y los dos costos tienen que dar idénticos.
--
-- Es aditiva y sobre una tabla VACÍA: no puede romper nada.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.cocina_formas_venta
  add column if not exists unidad text not null default 'unid.';

-- Lo mismo para el surtido, por el mismo motivo: el Pack de 4 toma hoy sus
-- tres pastas con renglones de "1 unid." y "2 unid.", y esa unidad es la que
-- decide si el motor usa el costo por porción o el costo por kg.
alter table public.cocina_formas_venta_surtido
  add column if not exists unidad text not null default 'unid.';

comment on column public.cocina_formas_venta.unidad is
  'La unidad del multiplicador. Es la misma que llevaba el renglón "Subreceta X" de la receta variante, y decide si el motor usa el costo por kg o por porción.';

comment on column public.cocina_formas_venta.multiplicador is
  'Cuánta receta base entra en UNA unidad de esta forma, medida en la unidad de al lado. La porción de torta es 0,1 unid.; el Flat White son 2 unid. de expreso; el Pack de 4 son 4.';

-- ── Guardarraíl ────────────────────────────────────────────────────────────
do $guardia$
declare
  v_n integer;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'cocina_formas_venta' and column_name in ('multiplicador', 'unidad'))
       or (table_name = 'cocina_formas_venta_surtido' and column_name in ('cantidad', 'unidad')));
  if v_n <> 4 then
    raise exception 'Esperaba cantidad y unidad en las dos tablas, encontré % columnas.', v_n;
  end if;

  select (select count(*) from public.cocina_formas_venta)
       + (select count(*) from public.cocina_formas_venta_surtido) into v_n;
  if v_n <> 0 then
    raise exception 'Las tablas tendrían que seguir vacías y tienen % filas.', v_n;
  end if;

  raise notice 'Paso 1 bis OK · la forma ya puede decir en qué unidad toma su base';
end;
$guardia$;
