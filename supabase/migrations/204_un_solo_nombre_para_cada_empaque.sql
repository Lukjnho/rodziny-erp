-- 204 — Un solo nombre para cada empaque, y un solo lugar donde se cobra
--
-- ══════════════════════════════════════════════════════════════════════════════
-- LO QUE ESTABA PASANDO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- DOS COSAS con CUATRO nombres. Vedia escribe "Packaging Vianda" y "Packaging
-- Congelado"; Saavedra escribe "Packaging De Vianda" y "Packaging congelada". Es la
-- misma bandeja, la misma tapa y la misma bolsa.
--
-- El costeo no se rompe por esto —busca la subreceta DENTRO del local de la receta
-- padre (mig 175, 183), así que cada local encuentra la suya— pero cualquiera que
-- compare los dos locales tiene que saber de memoria que son sinónimos. Es el mismo
-- problema de fondo que la "unid.": una cosa, dos palabras.
--
--     Subreceta Packaging congelada    saavedra   14 recetas
--     Subreceta Packaging Congelado    vedia       9 recetas
--     Subreceta Packaging De Vianda    saavedra   13 recetas
--     Subreceta Packaging Vianda       vedia      11 recetas
--                                                 ──
--                                                 47
--
-- Quedan dos nombres: **Packaging Vianda** y **Packaging Congelado**.
--
-- 🔑 Hay que renombrar las DOS PUNTAS a la vez. La receta se llama "Packaging De
-- Vianda" y el renglón que la usa dice "Subreceta Packaging De Vianda": el motor
-- los ata por nombre normalizado (minúsculas, sin el prefijo "Subreceta "). Si se
-- renombra una sola punta, 13 recetas de Saavedra se quedan sin empaque y el costeo
-- NO avisa: simplemente sale más barato.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- Y SE BORRA EL SEGUNDO MECANISMO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `cocina_productos.costo_empaque` era una segunda forma de cobrar lo mismo: un
-- número suelto que dos pantallas de Productos le sumaban al costo de la receta.
--
--   · está en 0,00 en las 100 filas, sin una sola excepción
--   · ninguna pantalla lo escribe — no hay formulario, no hay import, nada
--   · ninguna vista ni función de la base lo lee (verificado sobre pg_proc y las
--     vistas del esquema public)
--   · y ni siquiera se aplicaba parejo: en Menu Engineering solo se sumaba cuando
--     el producto se encontraba por el camino viejo (`fudo_nombres`); si la receta
--     matcheaba directo, el campo ni se miraba
--
-- La subreceta queda como el único mecanismo. Si mañana hay que cobrar empaque en
-- algo, se le agrega la subreceta a la receta y listo.
--
begin;

do $fix$
declare v_filas int;
begin
  -- ── 1) Las recetas ─────────────────────────────────────────────────────────
  update public.cocina_recetas set nombre = 'Packaging Vianda', updated_at = now()
   where local = 'saavedra' and nombre = 'Packaging De Vianda';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'Esperaba renombrar 1 receta "Packaging De Vianda" y toqué %.', v_filas; end if;

  update public.cocina_recetas set nombre = 'Packaging Congelado', updated_at = now()
   where local = 'saavedra' and nombre = 'Packaging congelada';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'Esperaba renombrar 1 receta "Packaging congelada" y toqué %.', v_filas; end if;

  -- ── 2) Los renglones que las nombran ───────────────────────────────────────
  update public.cocina_receta_ingredientes set nombre = 'Subreceta Packaging Vianda'
   where nombre = 'Subreceta Packaging De Vianda';
  get diagnostics v_filas = row_count;
  if v_filas <> 13 then raise exception 'Esperaba 13 renglones "De Vianda" y toqué %.', v_filas; end if;

  update public.cocina_receta_ingredientes set nombre = 'Subreceta Packaging Congelado'
   where nombre = 'Subreceta Packaging congelada';
  get diagnostics v_filas = row_count;
  if v_filas <> 14 then raise exception 'Esperaba 14 renglones "congelada" y toqué %.', v_filas; end if;

  raise notice 'Nombres unificados: 2 recetas y 27 renglones.';
end
$fix$;

-- ── 3) El campo muerto ──────────────────────────────────────────────────────
do $muerto$
declare v_cargados int;
begin
  -- Red de seguridad: si alguien le cargó un valor entre que se midió y esto corre,
  -- la columna NO se borra.
  select count(*) into v_cargados from public.cocina_productos where coalesce(costo_empaque, 0) <> 0;
  if v_cargados > 0 then
    raise exception 'costo_empaque tiene % fila(s) con valor. No se borra: alguien lo empezó a usar.', v_cargados;
  end if;
end
$muerto$;

alter table public.cocina_productos drop column if exists costo_empaque;

-- ── Guardarraíl: que no quede ni un renglón huérfano ────────────────────────
do $guard$
declare
  v_nombres int;
  v_huerfanos int;
begin
  select count(distinct nombre) into v_nombres
    from public.cocina_receta_ingredientes where nombre ilike '%packaging%';
  if v_nombres <> 2 then
    raise exception 'GUARDARRAIL: quedaron % nombres de packaging distintos, esperaba 2.', v_nombres;
  end if;

  -- Cada renglón "Subreceta Packaging X" tiene que encontrar su receta EN SU LOCAL.
  select count(*) into v_huerfanos
    from public.cocina_receta_ingredientes i
    join public.cocina_recetas padre on padre.id = i.receta_id
   where i.nombre ilike 'subreceta packaging%'
     and not exists (
       select 1 from public.cocina_recetas sub
        where sub.local = padre.local
          and lower(sub.nombre) = lower(regexp_replace(i.nombre, '^subreceta\s+', '', 'i'))
     );
  if v_huerfanos > 0 then
    raise exception 'GUARDARRAIL: % renglón(es) de packaging se quedaron sin receta en su local.', v_huerfanos;
  end if;

  raise notice 'OK: 2 nombres, 47 renglones, 0 huérfanos, columna costo_empaque borrada.';
end
$guard$;

commit;
