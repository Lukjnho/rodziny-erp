-- 154 — Facturación electrónica ARCA
--
-- Modelo para que una venta del POS pueda convertirse en un comprobante fiscal.
--
-- DECISIONES DE DISEÑO
--
-- 1. Tabla aparte, no columnas en ventas_tickets. Una venta puede no tener
--    comprobante, tenerlo pendiente, o tener uno emitido más una nota de
--    crédito que lo anula. Además la emisión es asincrónica (se encola y sale
--    cuando hay internet) y eso necesita estado, reintentos y errores propios.
--
-- 2. El comprobante guarda los datos del receptor COMO SE EMITIERON, no una
--    referencia. Si mañana el cliente cambia de razón social, la factura vieja
--    tiene que seguir diciendo lo que decía. clientes_fiscales existe solo para
--    autocompletar al cargar, nunca para leer al reimprimir.
--
-- 3. El CAE lo escribe el servidor, nunca el navegador: no hay política de
--    UPDATE para nadie. La edge function usa service_role, que saltea RLS.
--
-- 4. Un comprobante emitido es inmutable. El trigger lo hace cumplir.
--
-- No toca ninguna tabla existente salvo para agregar una condición al borrado
-- de tickets: una venta facturada no se puede borrar.

-- ---------------------------------------------------------------------------
-- Helper: ¿el que está operando es administrador?
-- ---------------------------------------------------------------------------
-- tiene_permiso() ya trata al admin como que puede todo, pero acá hace falta
-- lo contrario: un permiso que SOLO tenga el admin, para que un cajero no
-- pueda cambiar el punto de venta con el que se factura.
--
-- Va como función SECURITY DEFINER y no como subconsulta suelta dentro de la
-- política: leer perfiles desde una política corre con los permisos del que
-- consulta, y ahí la RLS de perfiles puede devolver cero filas — o sea, un
-- admin real quedaría afuera sin ningún error visible.

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select es_admin from public.perfiles where user_id = auth.uid()), false);
$$;

revoke all on function public.es_admin() from public;
grant execute on function public.es_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Configuración fiscal por local
-- ---------------------------------------------------------------------------

create table if not exists public.arca_config (
  local                text primary key,
  cuit_emisor          text    not null,
  punto_venta          integer not null,
  ambiente             text    not null default 'homologacion',
  razon_social         text    not null,
  domicilio_comercial  text,
  ingresos_brutos      text,
  inicio_actividades   date,
  activo               boolean not null default true,

  -- Qué se factura sin que nadie lo pida:
  --   segun_medio = solo lo que cobra por un medio marcado como facturable
  --                 (hoy: los que van a MercadoPago). Es lo que hace Rodziny.
  --   todo        = toda venta genera comprobante.
  --   ninguno     = nada automático; solo lo que el cajero pida a mano.
  -- En los tres casos el cajero SIEMPRE puede pedir factura para una venta
  -- puntual si el cliente se la pide.
  modo_facturacion     text not null default 'segun_medio',

  actualizado_at       timestamptz not null default now(),

  constraint arca_config_ambiente_ck
    check (ambiente in ('homologacion','produccion')),
  constraint arca_config_modo_ck
    check (modo_facturacion in ('segun_medio','todo','ninguno')),
  constraint arca_config_cuit_ck
    check (cuit_emisor ~ '^[0-9]{11}$'),
  constraint arca_config_pv_ck
    check (punto_venta between 1 and 99998)
);

comment on table public.arca_config is
  'Datos fiscales por local: CUIT, punto de venta y ambiente. El punto de venta se da de alta en ARCA y no se puede reutilizar uno dado de baja.';

alter table public.arca_config enable row level security;

create policy arca_config_ver on public.arca_config
  for select to authenticated
  using (tiene_permiso('ventas') or tiene_permiso('caja'));

create policy arca_config_administrar on public.arca_config
  for all to authenticated
  using (es_admin()) with check (es_admin());

-- ---------------------------------------------------------------------------
-- Clientes (solo para autocompletar al emitir una A o una B con datos)
-- ---------------------------------------------------------------------------

create table if not exists public.clientes_fiscales (
  id             uuid primary key default gen_random_uuid(),
  doc_tipo       smallint not null,          -- 80=CUIT · 96=DNI · 99=sin identificar
  doc_nro        text     not null,
  nombre         text     not null,
  condicion_iva  smallint not null,          -- ver comentario de receptor_condicion_iva
  domicilio      text,
  email          text,
  notas          text,
  creado_at      timestamptz not null default now(),

  constraint clientes_fiscales_doc_uk unique (doc_tipo, doc_nro),
  constraint clientes_fiscales_doc_tipo_ck check (doc_tipo in (80, 86, 96, 99)),
  constraint clientes_fiscales_doc_nro_ck  check (doc_nro ~ '^[0-9]+$'),
  constraint clientes_fiscales_cond_ck     check (condicion_iva in (1,4,5,6,7,8,9,10,13,15,16))
);

comment on table public.clientes_fiscales is
  'Libreta de clientes para autocompletar al facturar. NO es la fuente de verdad de un comprobante ya emitido: eso vive en ventas_comprobantes.';

alter table public.clientes_fiscales enable row level security;

create policy clientes_fiscales_ver on public.clientes_fiscales
  for select to authenticated
  using (tiene_permiso('ventas') or tiene_permiso('caja'));

create policy clientes_fiscales_cargar on public.clientes_fiscales
  for insert to authenticated
  with check (tiene_permiso('ventas') or tiene_permiso('caja'));

create policy clientes_fiscales_corregir on public.clientes_fiscales
  for update to authenticated
  using (tiene_permiso('ventas')) with check (tiene_permiso('ventas'));

create policy clientes_fiscales_borrar on public.clientes_fiscales
  for delete to authenticated
  using (tiene_permiso('ventas'));

-- ---------------------------------------------------------------------------
-- Comprobantes fiscales
-- ---------------------------------------------------------------------------

create table if not exists public.ventas_comprobantes (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.ventas_tickets(id) on delete restrict,
  local        text not null,

  -- Qué se pide emitir. Los códigos son de ARCA; se validan contra
  -- FEParamGetTiposCbte antes de usarlos en producción.
  tipo_comprobante smallint not null,   -- 1=Factura A · 6=Factura B · 3=NC A · 8=NC B
  punto_venta      integer  not null,
  concepto         smallint not null default 1,  -- 1=Productos

  -- Receptor: foto histórica al momento de emitir.
  receptor_doc_tipo      smallint not null default 99,
  receptor_doc_nro       text     not null default '0',
  receptor_nombre        text,
  receptor_condicion_iva smallint not null,
  receptor_domicilio     text,

  -- Importes declarados a ARCA.
  imp_neto     numeric(14,2) not null,
  imp_iva      numeric(14,2) not null default 0,
  imp_tot_conc numeric(14,2) not null default 0,   -- no gravado
  imp_op_ex    numeric(14,2) not null default 0,   -- exento
  imp_trib     numeric(14,2) not null default 0,   -- otros tributos
  imp_total    numeric(14,2) not null,
  iva_detalle  jsonb         not null default '[]'::jsonb,

  fecha_comprobante date not null,

  -- Lo que devuelve ARCA.
  numero           bigint,
  cae              text,
  cae_vencimiento  date,
  observaciones    jsonb,

  -- Cola de emisión.
  estado        text    not null default 'pendiente',
  intentos      integer not null default 0,
  ultimo_error  text,
  arca_request  jsonb,
  arca_response jsonb,
  ambiente      text    not null default 'homologacion',

  -- Una nota de crédito apunta al comprobante que anula.
  anula_comprobante_id uuid references public.ventas_comprobantes(id),

  -- Por qué existe este comprobante. Sirve para auditar después cuánto se
  -- facturó porque correspondía solo y cuánto porque el cliente lo pidió.
  solicitud  text not null default 'automatica',

  creado_at  timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  emitido_at timestamptz,

  constraint ventas_comprobantes_estado_ck
    check (estado in ('pendiente','emitiendo','emitido','error','anulado')),
  constraint ventas_comprobantes_solicitud_ck
    check (solicitud in ('automatica','pedido_cliente')),
  constraint ventas_comprobantes_ambiente_ck
    check (ambiente in ('homologacion','produccion')),
  constraint ventas_comprobantes_doc_tipo_ck
    check (receptor_doc_tipo in (80, 86, 96, 99)),
  constraint ventas_comprobantes_doc_nro_ck
    check (receptor_doc_nro ~ '^[0-9]+$'),
  -- CondicionIVAReceptorId. Verificados: 1=Responsable Inscripto · 4=Exento
  -- 5=Consumidor Final · 6=Monotributo. El resto de la lista son los códigos
  -- que ARCA acepta hoy; antes de usar uno distinto de esos cuatro hay que
  -- confirmarlo con FEParamGetCondicionIvaReceptor.
  constraint ventas_comprobantes_cond_iva_ck
    check (receptor_condicion_iva in (1,4,5,6,7,8,9,10,13,15,16)),
  constraint ventas_comprobantes_pv_ck
    check (punto_venta between 1 and 99998),
  constraint ventas_comprobantes_importes_positivos_ck
    check (imp_neto >= 0 and imp_iva >= 0 and imp_tot_conc >= 0
           and imp_op_ex >= 0 and imp_trib >= 0 and imp_total > 0),
  -- ARCA rechaza el comprobante si esta suma no cierra exacto.
  constraint ventas_comprobantes_total_ck
    check (abs(imp_total - (imp_neto + imp_iva + imp_tot_conc + imp_op_ex + imp_trib)) < 0.01),
  -- Emitido significa emitido: sin CAE no hay comprobante.
  constraint ventas_comprobantes_emitido_completo_ck
    check (estado <> 'emitido'
           or (cae is not null and numero is not null and cae_vencimiento is not null)),
  -- A un consumidor final sin identificar no se le puede poner nombre de otro.
  constraint ventas_comprobantes_cf_anonimo_ck
    check (receptor_doc_tipo <> 99 or receptor_doc_nro = '0'),
  -- Si se identifica al cliente, hay que saber cómo se llama.
  constraint ventas_comprobantes_identificado_con_nombre_ck
    check (receptor_doc_tipo = 99 or nullif(btrim(coalesce(receptor_nombre,'')), '') is not null),
  -- Un CUIT tiene 11 dígitos. Mandarlo mal es un rechazo seguro de ARCA.
  constraint ventas_comprobantes_cuit_largo_ck
    check (receptor_doc_tipo <> 80 or length(receptor_doc_nro) = 11),
  -- Una factura A exige CUIT del receptor.
  constraint ventas_comprobantes_factura_a_con_cuit_ck
    check (tipo_comprobante not in (1,2,3) or receptor_doc_tipo = 80)
);

comment on table public.ventas_comprobantes is
  'Comprobantes fiscales emitidos o por emitir. Un registro por comprobante. El CAE lo escribe únicamente el servidor.';
comment on column public.ventas_comprobantes.iva_detalle is
  'Desglose por alícuota tal como se manda a ARCA: [{"Id":5,"BaseImp":1000.00,"Importe":210.00}]. Id 5 = 21%, 4 = 10,5%, 3 = 0%.';
comment on column public.ventas_comprobantes.estado is
  'pendiente = en cola · emitiendo = candado mientras se habla con ARCA · emitido = con CAE · error = falló, se reintenta · anulado = anulado por nota de crédito';

-- Un ticket no puede tener dos facturas vivas a la vez. Es la protección
-- contra emitir dos veces por un reintento o un doble clic.
--
-- OJO: 'error' NO está excluido, a propósito. Si dejáramos crear otro
-- comprobante cuando el primero falló, un timeout tapa el peor caso posible:
-- ARCA autorizó la factura pero la respuesta no llegó. Ahí habría DOS
-- comprobantes emitidos en ARCA por la misma venta, y eso no se deshace.
-- Un fallo se reintenta sobre LA MISMA fila, después de preguntarle a ARCA
-- con FECompConsultar si el número ya se usó.
create unique index if not exists ux_ventas_comprobantes_un_vivo_por_ticket
  on public.ventas_comprobantes (ticket_id)
  where anula_comprobante_id is null and estado <> 'anulado';

-- La numeración de ARCA es única por ambiente, punto de venta y tipo.
create unique index if not exists ux_ventas_comprobantes_numeracion
  on public.ventas_comprobantes (ambiente, punto_venta, tipo_comprobante, numero)
  where numero is not null;

-- Para que la cola encuentre rápido lo que falta emitir.
create index if not exists ix_ventas_comprobantes_cola
  on public.ventas_comprobantes (creado_at)
  where estado in ('pendiente','error');

create index if not exists ix_ventas_comprobantes_ticket
  on public.ventas_comprobantes (ticket_id);

create index if not exists ix_ventas_comprobantes_local_fecha
  on public.ventas_comprobantes (local, fecha_comprobante desc);

alter table public.ventas_comprobantes enable row level security;

-- Ver: la caja necesita ver el CAE para imprimirlo; administración, todo.
create policy ventas_comprobantes_ver on public.ventas_comprobantes
  for select to authenticated
  using (tiene_permiso('ventas') or tiene_permiso('caja'));

-- Encolar: la caja pide la factura al cobrar. Nace siempre en 'pendiente'
-- y sin CAE: nadie puede inventarse un comprobante ya emitido desde el navegador.
create policy ventas_comprobantes_encolar on public.ventas_comprobantes
  for insert to authenticated
  with check (
    (tiene_permiso('caja') or tiene_permiso('ventas'))
    and estado = 'pendiente'
    and cae is null and numero is null and cae_vencimiento is null
    and emitido_at is null and intentos = 0
  );

-- Sin política de UPDATE ni de DELETE, a propósito:
--   · el CAE lo escribe la edge function con service_role, que saltea RLS;
--   · un comprobante fiscal no se borra nunca, se anula con nota de crédito.

-- ---------------------------------------------------------------------------
-- Un comprobante emitido es inmutable
-- ---------------------------------------------------------------------------

create or replace function public.trg_comprobante_inmutable()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.estado in ('emitido','anulado') then
      raise exception 'No se puede borrar un comprobante % (punto de venta %, número %). Un comprobante fiscal se anula con una nota de crédito, no se borra.',
        OLD.estado, OLD.punto_venta, coalesce(OLD.numero::text, 's/n');
    end if;
    return OLD;
  end if;

  if OLD.estado = 'emitido' then
    -- Lo único que puede pasarle a un comprobante emitido es que se anule.
    if NEW.estado = 'anulado'
       and NEW.cae             is not distinct from OLD.cae
       and NEW.numero          is not distinct from OLD.numero
       and NEW.cae_vencimiento is not distinct from OLD.cae_vencimiento
       and NEW.imp_total       is not distinct from OLD.imp_total
       and NEW.imp_neto        is not distinct from OLD.imp_neto
       and NEW.imp_iva         is not distinct from OLD.imp_iva
       and NEW.ticket_id       is not distinct from OLD.ticket_id
       and NEW.tipo_comprobante is not distinct from OLD.tipo_comprobante
       and NEW.punto_venta     is not distinct from OLD.punto_venta then
      return NEW;
    end if;
    raise exception 'El comprobante %-% ya fue emitido con CAE %: no se puede modificar. Si está mal, hay que emitir una nota de crédito.',
      lpad(OLD.punto_venta::text, 4, '0'), lpad(coalesce(OLD.numero,0)::text, 8, '0'), OLD.cae;
  end if;

  -- Mientras no esté emitido, el ticket y el punto de venta tampoco se mueven.
  if NEW.ticket_id is distinct from OLD.ticket_id then
    raise exception 'Un comprobante no se puede pasar de una venta a otra.';
  end if;

  return NEW;
end
$$;

create trigger comprobante_inmutable
  before update or delete on public.ventas_comprobantes
  for each row execute function public.trg_comprobante_inmutable();

-- ---------------------------------------------------------------------------
-- Los importes del comprobante tienen que ser los de la venta
-- ---------------------------------------------------------------------------

create or replace function public.trg_comprobante_coincide_con_venta()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_total_venta  numeric;
  v_local_venta  text;
  v_origen_venta text;
begin
  -- Una nota de crédito puede ser por otro importe: no se valida contra la venta.
  if NEW.anula_comprobante_id is not null then
    return NEW;
  end if;

  select total_bruto, local, origen
    into v_total_venta, v_local_venta, v_origen_venta
    from public.ventas_tickets where id = NEW.ticket_id;

  if v_total_venta is null then
    raise exception 'No existe la venta % que se quiere facturar.', NEW.ticket_id;
  end if;

  -- Las ventas importadas de Fudo ya las facturó Fudo. Facturarlas de nuevo
  -- desde acá sería emitir dos comprobantes por la misma operación.
  if v_origen_venta is distinct from 'pos' then
    raise exception 'Esa venta viene de % y no se factura desde el ERP: ya la facturó ese sistema.', v_origen_venta;
  end if;

  if abs(NEW.imp_total - v_total_venta) >= 0.01 then
    raise exception 'El comprobante dice $% pero la venta fue de $%. No se puede facturar un importe distinto al cobrado.',
      NEW.imp_total, v_total_venta;
  end if;

  if NEW.local is distinct from v_local_venta then
    raise exception 'El comprobante es de % y la venta de %.', NEW.local, v_local_venta;
  end if;

  return NEW;
end
$$;

create trigger comprobante_coincide_con_venta
  before insert on public.ventas_comprobantes
  for each row execute function public.trg_comprobante_coincide_con_venta();

-- ---------------------------------------------------------------------------
-- Una venta facturada no se puede borrar
-- ---------------------------------------------------------------------------
--
-- La política de la migración 151 deja al cajero deshacer una venta sin cobros
-- mientras el turno esté abierto. Se le agrega que tampoco tenga comprobante:
-- la referencia con on delete restrict ya lo impediría, pero da un error feo.

create or replace function public.ticket_sin_comprobante(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.ventas_comprobantes where ticket_id = p_ticket
  );
$$;

revoke all on function public.ticket_sin_comprobante(uuid) from public;
grant execute on function public.ticket_sin_comprobante(uuid) to authenticated;

drop policy if exists ventas_tickets_caja_deshacer on public.ventas_tickets;
create policy ventas_tickets_caja_deshacer on public.ventas_tickets
  for delete to authenticated
  using (
    tiene_permiso('caja')
    and origen = 'pos'
    and public.ticket_pos_sin_cobros(id)
    and public.ticket_sin_comprobante(id)
    and exists (
      select 1 from public.cierres_caja c
       where c.id = ventas_tickets.cierre_caja_id
         and c.origen = 'pos'
         and c.hora_cierre is null
    )
  );

-- ---------------------------------------------------------------------------
-- Qué medios de pago disparan factura solos
-- ---------------------------------------------------------------------------
-- Rodziny hoy factura los ingresos digitales: todo lo que entra por
-- MercadoPago (tarjetas, QR y transferencias). El efectivo va a caja y no
-- dispara comprobante salvo que el cliente lo pida.
--
-- Se marca acá, en el catálogo, y no en el código del POS: así se cambia
-- desde la base el día que se decida facturar todo, sin tocar ni desplegar.

alter table public.medios_pago
  add column if not exists factura_automatica boolean not null default false;

comment on column public.medios_pago.factura_automatica is
  'Si al cobrar con este medio se encola un comprobante fiscal sin que nadie lo pida. Solo se aplica cuando arca_config.modo_facturacion = ''segun_medio''.';

update public.medios_pago
   set factura_automatica = true
 where codigo in ('credito','debito','qr','transferencia')
   and factura_automatica is distinct from true;

-- ---------------------------------------------------------------------------
-- Configuración inicial de cada local
-- ---------------------------------------------------------------------------
-- Nacen DESACTIVADAS y con punto de venta 1 de relleno: hasta que no se
-- confirme cuál es el punto de venta real de cada local, nadie puede facturar
-- con un número inventado. El definitivo es el que hoy usa Fudo (decisión de
-- Lucas: se reutiliza, con corte limpio).
insert into public.arca_config (local, cuit_emisor, punto_venta, ambiente, razon_social, activo)
values
  ('vedia',    '30717352366', 1, 'homologacion', 'RODZINY S.A.S.', false),
  ('saavedra', '30717352366', 1, 'homologacion', 'RODZINY S.A.S.', false)
on conflict (local) do nothing;

-- El rol anónimo (el de las pantallas públicas, como el QR de cocina o el
-- fichaje) no tiene nada que hacer acá. Las tablas nuevas del schema public
-- nacen con permisos para anon por la configuración de Supabase.
revoke all on public.ventas_comprobantes from anon;
revoke all on public.clientes_fiscales   from anon;
revoke all on public.arca_config         from anon;
