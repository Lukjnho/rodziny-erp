-- 080: Datos bancarios por empleado
-- Permite registrar CBU/CVU + alias para liquidaciones por transferencia,
-- distinguiendo cuenta sueldo Rodziny de cuentas externas / billeteras.

alter table empleados
  add column if not exists cbu text,
  add column if not exists alias_bancario text,
  add column if not exists cuenta_sueldo boolean not null default false;

comment on column empleados.cbu is 'CBU/CVU de 22 dígitos. Texto libre para no bloquear cargas parciales.';
comment on column empleados.alias_bancario is 'Alias del banco o billetera (MP, Ualá, etc.). Sirve cuando el empleado no tiene CBU operativo.';
comment on column empleados.cuenta_sueldo is 'true = cuenta sueldo abierta por Rodziny. false = cuenta externa o billetera del empleado.';
