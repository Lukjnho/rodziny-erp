-- 149 — Descuento de verdad, en vez del producto falso
--
-- Hoy los convenios se aplican en Fudo cargando un producto inventado que se
-- llama "ADICIONAL POR DESC." con importe negativo. Eso ensucia todo: aparece
-- como un producto más en la ingeniería de menú, no se puede saber a qué plato
-- se le hizo el descuento, y no hay forma de cruzarlo con el convenio.
--
-- Acá el descuento pasa a ser lo que es: un atributo de la línea vendida.
--
-- ⚠️ REGLA QUE NO SE ROMPE: `ventas_items.total` y `ventas_tickets.total_bruto`
-- siguen siendo **lo que se cobró de verdad**, ya con el descuento restado. Las
-- decenas de pantallas y funciones que hoy leen esas columnas siguen dando el
-- mismo número sin tocarles una línea. Lo que se agrega es el detalle de cuánto
-- se bonificó y por qué.
--
--   bruto de la línea = precio_unitario × cantidad
--   descuento_monto   = bruto × descuento_pct / 100  (redondeado a 2 decimales)
--   total             = bruto − descuento_monto      ← lo que paga el cliente

begin;

alter table public.ventas_items
  add column if not exists descuento_pct numeric(5, 2) not null default 0,
  add column if not exists descuento_monto numeric(14, 2) not null default 0;

alter table public.ventas_items
  drop constraint if exists ventas_items_descuento_pct_check;
alter table public.ventas_items
  add constraint ventas_items_descuento_pct_check
  check (descuento_pct >= 0 and descuento_pct <= 100);

alter table public.ventas_items
  drop constraint if exists ventas_items_descuento_monto_check;
alter table public.ventas_items
  add constraint ventas_items_descuento_monto_check check (descuento_monto >= 0);

comment on column public.ventas_items.descuento_pct is
  'Porcentaje bonificado en esta linea. 0 = sin descuento.';
comment on column public.ventas_items.descuento_monto is
  'Pesos bonificados en esta linea. `total` YA los tiene restados: total = precio_unitario * cantidad - descuento_monto.';

alter table public.ventas_tickets
  add column if not exists descuento_total numeric(14, 2) not null default 0,
  add column if not exists convenio_id uuid references public.convenios(id) on delete set null;

alter table public.ventas_tickets
  drop constraint if exists ventas_tickets_descuento_total_check;
alter table public.ventas_tickets
  add constraint ventas_tickets_descuento_total_check check (descuento_total >= 0);

comment on column public.ventas_tickets.descuento_total is
  'Suma de lo bonificado en las lineas. total_bruto YA lo tiene restado: es lo que se cobro.';
comment on column public.ventas_tickets.convenio_id is
  'Convenio con el que se hizo el descuento, si vino de uno. Reemplaza al truco del producto falso "ADICIONAL POR DESC." de Fudo.';

create index if not exists idx_ventas_tickets_convenio
  on public.ventas_tickets (convenio_id)
  where convenio_id is not null;

-- El cajero tiene que poder elegir el convenio al cobrar. Solo lectura, y solo
-- los que estan vigentes: nombre y porcentaje, nada sensible.
drop policy if exists convenios_caja_select on public.convenios;
create policy convenios_caja_select on public.convenios
  for select to authenticated
  using (tiene_permiso('caja') and activo);

commit;
