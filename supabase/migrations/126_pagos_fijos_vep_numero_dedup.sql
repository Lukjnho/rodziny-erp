-- Deduplicación de VEP por número de operación.
-- El número de VEP (AFIP/ARCA) es único por pago; es la clave real para detectar
-- que se re-subió el mismo comprobante. Antes solo existía UNIQUE (periodo, concepto),
-- que puede dar falsos positivos entre VEP distintos del mismo mes.
--
-- Aditivo y seguro: columna nullable + índice único PARCIAL (solo aplica cuando
-- vep_numero no es null, así las filas manuales / viejas sin número no chocan).

alter table public.pagos_fijos
  add column if not exists vep_numero text;

create unique index if not exists pagos_fijos_vep_numero_uidx
  on public.pagos_fijos (vep_numero)
  where vep_numero is not null;

comment on column public.pagos_fijos.vep_numero is
  'Número de VEP (AFIP/ARCA) del comprobante que originó este pago fijo. Único (índice parcial) para rechazar re-subidas del mismo VEP desde Integraciones.';
