-- 197 — Dos tablas dejan de leerse con la clave pública
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- DE DÓNDE SALE ESTO
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Las pantallas de tablet de la fábrica entran SIN USUARIO, con la clave pública
-- (`anon`): producción por QR, pizarrón, conteo del mostrador, fichaje, recepción
-- y depósito. Es una decisión de diseño, no un descuido — nadie en la cocina
-- tiene que loguearse para anotar un lote.
--
-- El precio de eso es que las tablas que esas pantallas leen quedan abiertas a
-- cualquiera que tenga la clave, y la clave viaja adentro del JavaScript del
-- sitio. Medido el 9-sep-2026 ENTRANDO DE VERDAD COMO `anon` (no leyendo las
-- reglas, que es como me equivoqué la primera vez): **24 tablas y vistas con
-- datos**.
--
-- De esas 24, se cruzó una por una contra lo que las diez pantallas anónimas
-- consultan de verdad. **Veinte se usan. Cuatro no las toca nadie**, y esta
-- migración cierra DOS:
--
--     categorias_gasto ········ 65 filas · la usan Gastos/Compras/Finanzas, todas con login
--     efemerides_gastronomicas  31 filas · la usa el calendario de Cocina, con login
--
-- 🙋 **Las otras dos quedan abiertas por decisión de Lucas (9-sep-2026)**: mantener
-- el cambio en lo que se había conversado y no estirarlo de costado. Se probó que
-- cerrarlas también andaba —la clave pública pasaba de 24 a 20 sin romper ninguna
-- tablet— así que si algún día se quieren cerrar, es un renglón cada una:
--
--     drop policy cocina_lote_consumos_select_anon on public.cocina_lote_consumos;
--     drop policy cocina_ajustes_stock_anon_select on public.cocina_ajustes_stock;
--
-- 🔑 Y por qué se puede: las pantallas no las consultan directo, las ven por
-- `v_cocina_lote_pasta_saldo` y `v_cocina_stock_pastas`, que **no son
-- `security_invoker`** — corren con los permisos de quien las creó, así que siguen
-- leyendo la tabla aunque el que mira ya no pueda. Y lo que ESCRIBE
-- `cocina_lote_consumos` son disparadores `security definer` (trg_traspaso_fifo,
-- trg_merma_camara_fifo, trg_ajuste_camara_fifo): tampoco pasan por la regla.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- LO QUE ESTA MIGRACIÓN NO ARREGLA (que es lo grande)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- 💣 **Las recetas siguen siendo públicas.** `cocina_recetas` (374) y
-- `cocina_receta_ingredientes` (1.422) las lee cualquiera con la clave, porque el
-- QR de producción expande las subrecetas y las necesita. En una fábrica de pastas
-- eso es el know-how. Tampoco se cierran `fichadas` (8.359, quién fichó y cuándo)
-- ni los nombres de los empleados activos.
--
-- Eso NO se arregla con una migración: hay que sacar las tablets de la clave
-- pública y darles un usuario propio de dispositivo. Es un trabajo aparte, sobre
-- diez pantallas, y cambia qué pasa cuando una tablet pierde la sesión en plena
-- producción. Queda anotado, no resuelto.
--
--
-- ══════════════════════════════════════════════════════════════════════════════
-- CÓMO SE CIERRA CADA UNA
-- ══════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ Acá SÍ se dropean policies, y no contradice la regla de "alter policy, nunca
-- drop". Esa regla es para la policy que PROTEGE: dropearla deja la tabla un
-- instante abierta. Estas tres son lo contrario — son la que ABRE. Dropearlas
-- cierra, no abre, y no hay instante de exposición.
--
-- La de efemérides sí va con `alter`, porque es una sola policy para todos
-- (PUBLIC) y hay que conservarla para los que entran con usuario.
--
begin;

-- ── categorias_gasto ────────────────────────────────────────────────────────
-- Los que entran con usuario siguen igual: `categorias_lectura_general`
-- (compras/gastos/finanzas) y `categorias_compras_all` no se tocan. Esta policy
-- era solo para el rol `anon`, así que sacarla no le cambia nada a nadie logueado.
drop policy if exists catgasto_anon_select on public.categorias_gasto;

-- ── efemerides_gastronomicas ────────────────────────────────────────────────
-- Una sola policy de lectura para todos, con `using (true)`. Se le pide usuario
-- en vez de sacarla: el calendario de Cocina la sigue leyendo.
alter policy efemerides_lectura on public.efemerides_gastronomicas
  using (auth.uid() is not null);

-- ══════════════════════════════════════════════════════════════════════════════
-- GUARDARRAÍL — se prueba ENTRANDO COMO anon, no leyendo las reglas
-- ══════════════════════════════════════════════════════════════════════════════
do $guard$
declare
  v_tabla   text;
  v_n       bigint;
  v_rotas   text := '';
  v_abiertas text := '';
  -- Lo que las diez pantallas de tablet consultan de verdad. Todas tienen filas
  -- hoy: si alguna vuelve en cero, esta migración rompió una tablet.
  v_tablets text[] := array[
    'fichadas', 'cocina_cierre_dia', 'cronograma', 'cocina_lotes_produccion',
    'cocina_receta_ingredientes', 'cocina_pizarron_items', 'productos',
    'cocina_traspasos', 'v_cocina_lote_pasta_saldo', 'cocina_lotes_pasta',
    'cocina_recetas', 'cocina_lotes_relleno', 'cocina_lotes_masa',
    'cocina_cierre_camara', 'cocina_productos', 'cocina_lotes_pasta_masas',
    'cocina_merma', 'v_empleados_publicos', 'cocina_pasta_recetas',
    'v_cocina_stock_pastas'
  ];
  v_cerradas text[] := array['categorias_gasto', 'efemerides_gastronomicas'];
  -- Estas dos quedan abiertas a propósito (ver el encabezado). Se chequea que
  -- SIGAN abiertas: si un día aparecen cerradas sin que nadie lo haya decidido,
  -- este guardarraíl deja escrito que acá estaban así queriendo.
  v_a_proposito text[] := array['cocina_lote_consumos', 'cocina_ajustes_stock'];
begin
  -- 1) Las cuatro tienen que quedar en CERO para la clave pública.
  foreach v_tabla in array v_cerradas loop
    begin
      set local role anon;
      execute format('select count(*) from public.%I', v_tabla) into v_n;
      reset role;
    exception when others then
      reset role;
      v_n := 0;  -- si ni siquiera puede consultarla, mejor todavía
    end;
    if v_n > 0 then
      v_abiertas := v_abiertas || v_tabla || ' (' || v_n || ') ';
    end if;
  end loop;
  if v_abiertas <> '' then
    raise exception 'GUARDARRAIL: la clave publica todavia lee: %', v_abiertas;
  end if;

  -- 2) Y las veinte de las tablets tienen que seguir contestando con datos.
  foreach v_tabla in array v_tablets loop
    begin
      set local role anon;
      execute format('select count(*) from public.%I', v_tabla) into v_n;
      reset role;
    exception when others then
      reset role;
      v_n := 0;
    end;
    if v_n = 0 then
      v_rotas := v_rotas || v_tabla || ' ';
    end if;
  end loop;
  if v_rotas <> '' then
    raise exception 'GUARDARRAIL: se rompio una tablet, dejaron de verse: %', v_rotas;
  end if;

  -- 3) Y las dos que se dejaron abiertas a propósito siguen abiertas.
  foreach v_tabla in array v_a_proposito loop
    begin
      set local role anon;
      execute format('select count(*) from public.%I', v_tabla) into v_n;
      reset role;
    exception when others then
      reset role;
      v_n := 0;
    end;
    if v_n = 0 then
      raise exception 'GUARDARRAIL: "%" se cerro sin querer. Se decidio dejarla abierta.', v_tabla;
    end if;
  end loop;

  raise notice 'GUARDARRAIL OK — 2 cerradas, 20 tablets intactas, 2 abiertas a proposito';
end
$guard$;

commit;
