-- 005: fudo_id pasa a nullable
-- Legacy de cuando todos los gastos venían del import de Fudo. Ahora
-- la mayoría se cargan a mano desde el modal y no tienen fudo_id.

alter table gastos alter column fudo_id drop not null;

notify pgrst, 'reload schema';
