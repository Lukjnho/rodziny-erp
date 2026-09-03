-- 160 — La pasta DECLARA si lleva relleno. El formulario deja de deducirlo.
--
-- EL BUG QUE ESTO MATA (mezzelune, 1-sep-2026). El QR de producción tenía esta
-- línea (ProduccionQRPage.tsx):
--
--     const esPastaSinRelleno = !loteRellenoId;
--
-- O sea: "si el operario no eligió relleno, entonces esto es un fideo". Y a los
-- fideos el QR los manda DIRECTO a la cámara, ya porcionados, porque se arman y
-- se embolsan en una sola pasada. Resultado: una pasta RELLENA cargada sin
-- elegir el lote de relleno nacía marcada como ya porcionada y desaparecía del
-- paso "Porcionar". Los chicos la habían cargado, pero al día siguiente no
-- estaba. Eso fue el mezzelune de bondiola.
--
-- El dato pasa a vivir en el producto y se pregunta UNA sola vez, al darlo de
-- alta. Lista confirmada por Lucas el 2-sep-2026: 13 rellenas / 7 fideos.
--
-- ⚠️ Los ñoquis van en TRUE a propósito. No llevan relleno en el sentido común,
-- pero en el sistema el puré de papa se carga por la puerta del relleno
-- ("tomamos al puré como un relleno" — Lucas, 2-sep-2026). Si se los marcara
-- como fideos se rompería la forma en que se cargan hoy.

alter table cocina_productos add column if not exists lleva_relleno boolean;

comment on column cocina_productos.lleva_relleno is
  'Solo aplica a tipo=pasta. true = se arma con un lote de relleno y después se '
  'porciona (entra al freezer de producción). false = fideo, se embolsa en una '
  'pasada y va directo a cámara. Los ñoquis son true: el puré entra por acá.';

-- ── Las 13 que llevan relleno ────────────────────────────────────────────────
update cocina_productos set lleva_relleno = true where id in (
  'bab4933b-cc57-430f-8c29-0de16ed1682b', -- vedia · Sorrentinos de Jamón y queso
  '51c523cd-2f59-45d8-bd7d-feab3d674eb3', -- vedia · Scarpinocc de Vacío de Cerdo
  'd66631cd-8b20-46b2-800f-1646b3fc23a1', -- vedia · Ñoquis de papa (puré)
  'f5c5dba4-c62e-415f-a4d0-9a0df2428e66', -- vedia · Ravioli de Espinaca y quesos
  '6cd398b2-7b21-47e7-b780-397fae2f7f7b', -- vedia · Ñoquis rellenos (puré)
  'b50ed093-b778-4934-92e0-9093346bb062', -- vedia · Capeletti de Pollo, puerro y quesos
  '1ba373c0-eadd-4ba2-82d6-1a2419707f1d', -- vedia · Mezzelune de Bondiola Braseada
  'f3bdc5a3-31e6-45e3-af8b-64e717c765a3', -- saavedra · Ñoquis de papa (puré)
  '00f1c533-e39f-4bb9-a795-f7111c4eeb01', -- saavedra · Cappelletti Capresse
  '133cf342-a8fe-4c10-a934-2769d10efebb', -- saavedra · Ñoquis rellenos (puré)
  '244e211c-3e2b-457c-a697-431c488a5950', -- saavedra · Mezzelune de vacío de cerdo
  '686dd84c-e84f-4f18-877f-489d2bad8ccf', -- saavedra · Capellacci de Pollo, puerro y quesos
  '60b6527c-0b0e-41b2-9e0d-686149175f47', -- saavedra · Mezzelune De Bondiola Braseada
  -- Archivado (mig 158), sin lotes. Es una pasta rellena igual: si algún día se
  -- reactiva, que no nazca con el bug.
  '1a2b3963-dcbb-4684-a477-9c6857e10e1e'  -- vedia · Scappinoc (duplicado archivado)
);

-- ── Los 7 fideos ─────────────────────────────────────────────────────────────
update cocina_productos set lleva_relleno = false where id in (
  'b0c383f8-28d3-4bfd-b1a7-49b43d33b331', -- vedia · Tagliatelles al huevo
  '514cf33b-99c9-4f3c-90de-ac287784ad55', -- vedia · Tagliatelles mixtos
  '3a53bdc8-80b0-43d4-8699-7c6c5ca42c6b', -- vedia · Rigatoni
  'a182c1d3-e9d2-4930-9ea6-0f44a8fc87a3', -- vedia · Radiatori
  'e7b11350-c478-475a-873a-ca37c28b0ce6', -- saavedra · Tagliatelles al huevo
  'c3f17e9a-8ce4-4f3d-ae85-16e3a4364190', -- saavedra · Cresta di Gallo
  -- Nunca se produjo (0 lotes). Va como fideo por decisión de Lucas, no por datos.
  '96632ada-9bbf-4084-8ef7-6a6220f001cb'  -- saavedra · Fusilli
);

-- ── Toda pasta nueva tiene que declararlo ────────────────────────────────────
-- Sin esto, la próxima pasta que alguien dé de alta nacería con el dato en NULL
-- y el QR volvería a tener que adivinar. El ABM de Productos ahora pregunta.
alter table cocina_productos
  drop constraint if exists cocina_productos_pasta_declara_relleno;
alter table cocina_productos
  add constraint cocina_productos_pasta_declara_relleno
  check (tipo is distinct from 'pasta' or lleva_relleno is not null);

-- ── La red de seguridad ──────────────────────────────────────────────────────
-- La pantalla ya bloquea el guardado, pero la pantalla se puede cambiar. Esto
-- vive en la base: si el producto lleva relleno, el lote NO se guarda sin él.
-- Aunque alguien reescriba el formulario dentro de dos años.
create or replace function cocina_lote_pasta_exige_relleno()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lleva  boolean;
  v_nombre text;
begin
  select lleva_relleno, nombre into v_lleva, v_nombre
  from cocina_productos where id = new.producto_id;

  if coalesce(v_lleva, false) and new.lote_relleno_id is null then
    raise exception
      'La pasta "%" lleva relleno: elegí el lote de relleno antes de guardar.',
      coalesce(v_nombre, 'sin nombre')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Solo INSERT y los UPDATE que tocan justamente esas dos columnas. El paso
-- "Porcionar" actualiza ubicación/porciones y NO dispara esto, así que sigue
-- funcionando igual. Los 10 lotes históricos sin relleno tampoco se tocan.
drop trigger if exists trg_lote_pasta_exige_relleno on cocina_lotes_pasta;
create trigger trg_lote_pasta_exige_relleno
  before insert or update of producto_id, lote_relleno_id on cocina_lotes_pasta
  for each row execute function cocina_lote_pasta_exige_relleno();
