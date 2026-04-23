-- 010_efemerides_gastronomicas.sql
-- Calendario de efemérides gastronómicas para el Chef Ejecutivo.
-- Se usa para:
--   1) Planificar menú temático / promos / contenido de redes
--   2) Alertas automáticas 15 días antes en el Dashboard
-- Las fechas se guardan como (mes, dia) para que se repitan todos los años sin recargar.
-- Si mes es NULL, es una efeméride recurrente mensual (ej. Día del Ñoqui: 29 de cada mes).

create table if not exists efemerides_gastronomicas (
  id uuid primary key default gen_random_uuid(),
  mes int check (mes is null or (mes between 1 and 12)),
  dia int not null check (dia between 1 and 31),
  nombre text not null,
  descripcion text,
  categoria text not null default 'otro'
    check (categoria in ('pasta','vino','argentina','internacional','fiesta','tradicion','postre','otro')),
  idea_plato text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_efemerides_fecha on efemerides_gastronomicas(mes, dia) where activo = true;

-- ─── Seed inicial ───────────────────────────────────────────────────────────
-- Lista curada: tradiciones Rodziny + ARG + internacionales relevantes para pasta/gastronomía.
-- Lucas puede editar/agregar/desactivar desde el tab Calendario en Cocina.

insert into efemerides_gastronomicas (mes, dia, nombre, descripcion, categoria, idea_plato) values
  -- Recurrente mensual (mes = NULL)
  (null, 29, 'Día del Ñoqui', 'Tradición argentina: comer ñoquis el 29 de cada mes para atraer la suerte. Se pone un billete debajo del plato.', 'tradicion', 'Promoción ñoquis + salsa a precio especial. Sumar variantes rellenos como gancho.'),

  -- Enero
  (1, 20, 'Día Mundial del Queso', 'Jornada internacional dedicada al queso.', 'internacional', 'Tabla de quesos + pasta con 4 quesos. Destacar parmesano y pecorino.'),

  -- Febrero
  (2, 9, 'Día Internacional de la Pizza', 'Celebración mundial de la pizza.', 'internacional', 'Promo en Saavedra: pizza + bebida. Especial con masa madre.'),
  (2, 14, 'San Valentín', 'Día de los enamorados — alta demanda en gastronomía.', 'fiesta', 'Menú parejas: entrada + pasta rellena + postre compartido + copa de vino.'),

  -- Marzo
  (3, 8, 'Día Internacional de la Mujer', 'Conmemoración mundial.', 'fiesta', 'Acción de descuento + contenido en redes. Plato firma de chef mujer.'),
  (3, 20, 'Día del Macarrón', 'Dulce francés de almendra — día internacional.', 'internacional', 'Macarrones de postre en Saavedra (merienda).'),

  -- Abril
  (4, 17, 'Día Mundial del Malbec', 'Cepa insignia argentina — declarado por Wines of Argentina.', 'argentina', 'Maridaje pastas con salsas rojas + copa de Malbec en promo.'),
  (4, 23, 'Día del Idioma / Día del Libro', 'Celebración literaria.', 'otro', 'Café literario de merienda en Saavedra con promo lectura.'),

  -- Mayo
  (5, 1, 'Día del Trabajador', 'Feriado nacional — demanda alta de delivery.', 'fiesta', 'Menú familiar para llevar a casa. Armado de combos.'),
  (5, 25, 'Día de la Revolución de Mayo', 'Feriado patrio — menú típico argentino.', 'argentina', 'Locro, pastelitos, chocolate caliente. Decoración patria.'),

  -- Junio
  (6, 5, 'Día del Cocinero', 'Conmemoración del oficio culinario en Argentina.', 'argentina', 'Reconocimiento al equipo de cocina. Plato firma del chef en carta.'),
  (6, 20, 'Día de la Bandera', 'Feriado patrio.', 'argentina', 'Menú patrio. Platos con banderines decorativos.'),

  -- Julio
  (7, 9, 'Día de la Independencia Argentina', 'Feriado patrio principal.', 'argentina', 'Locro, empanadas, chocolate con churros en merienda.'),
  (7, 20, 'Día del Amigo', 'Celebración argentina — máxima demanda del año en gastronomía.', 'argentina', 'Reservas anticipadas. Menú grupal con entrada + pasta + postre + bebida. Ambos locales full.'),
  (7, 22, 'Día Mundial del Helado', 'Celebración internacional del helado.', 'internacional', 'Promoción helados soft en Vedia. Especial postre helado en Saavedra.'),

  -- Agosto
  (8, 16, 'Día del Niño (3er domingo aprox)', 'Celebración argentina — fecha variable, ajustar por año.', 'argentina', 'Menú kids con pastas cortas + postre. Regalo sorpresa para chicos.'),

  -- Septiembre
  (9, 13, 'Día Internacional del Chocolate', 'Día mundial del chocolate.', 'internacional', 'Postre del día con chocolate. Promo brownie / volcán de chocolate.'),
  (9, 21, 'Día de la Primavera / del Estudiante', 'Celebración argentina.', 'argentina', 'Promo para estudiantes con presentación de libreta. Menú fresco de primavera.'),
  (9, 29, 'Día de la Familia (ARG)', 'Celebración argentina.', 'argentina', 'Menú familiar para compartir. Reservas anticipadas.'),

  -- Octubre
  (10, 8, 'Día de la Empanada', 'Celebración argentina de la empanada.', 'argentina', 'Empanadas caseras como entrada. Degustación de distintas variedades.'),
  (10, 16, 'Día Mundial de la Alimentación', 'Declarado por la FAO.', 'internacional', 'Contenido educativo en redes sobre producción propia. Destacar insumos locales.'),
  (10, 18, 'Día de la Madre (3er domingo aprox)', 'Celebración argentina — fecha variable, ajustar por año.', 'fiesta', 'Reservas anticipadas. Menú madre con copa de vino. Flores en la mesa.'),
  (10, 25, 'Día Mundial de la Pasta', 'Celebración internacional de la pasta — fecha clave para Rodziny.', 'pasta', 'EVENTO PRINCIPAL DEL AÑO. Menú degustación pastas. Promoción agresiva en redes. Descuentos + plato firma.'),

  -- Noviembre
  (11, 3, 'Día del Sándwich', 'Celebración informal mundial.', 'internacional', 'Sándwich gourmet del día en Saavedra (merienda).'),
  (11, 10, 'Día de la Tradición', 'Celebración argentina — nacimiento de José Hernández.', 'argentina', 'Menú criollo: locro, empanadas, asado. Música folklórica.'),

  -- Diciembre
  (12, 4, 'Día Nacional del Mate', 'Infusión nacional argentina.', 'argentina', 'Promoción de merienda con mate + medialunas en Saavedra.'),
  (12, 24, 'Nochebuena', 'Máxima demanda de pedidos anticipados para llevar.', 'fiesta', 'Menú para llevar: pastas frescas + salsas + postre navideño. Reservas con 7 días de anticipación.'),
  (12, 25, 'Navidad', 'Feriado — locales cerrados o con horario reducido.', 'fiesta', 'Comunicar horarios especiales. Pedidos anticipados 24hs antes.'),
  (12, 31, 'Nochevieja / Fin de Año', 'Alta demanda de pedidos anticipados.', 'fiesta', 'Menú fin de año para llevar. Armado de combos familiares.')
on conflict do nothing;

-- ─── Permisos RLS (público lectura, admin escritura) ────────────────────────
alter table efemerides_gastronomicas enable row level security;

drop policy if exists "efemerides_lectura" on efemerides_gastronomicas;
create policy "efemerides_lectura" on efemerides_gastronomicas
  for select using (true);

drop policy if exists "efemerides_admin" on efemerides_gastronomicas;
create policy "efemerides_admin" on efemerides_gastronomicas
  for all using (auth.uid() is not null);
