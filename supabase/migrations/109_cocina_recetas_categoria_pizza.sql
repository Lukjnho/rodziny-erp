-- Agrega 'pizza' como categoría válida de cocina_recetas.
-- Las pizzas estaban clasificadas dentro de 'pasta'; se separan en su propia
-- categoría para distinguirlas en Menú/Costeo.
alter table cocina_recetas drop constraint if exists cocina_recetas_categoria_check;
alter table cocina_recetas add constraint cocina_recetas_categoria_check
  check (
    categoria is null
    or categoria = any (
      array['pasta', 'pizza', 'salsa', 'postre', 'pasteleria', 'panificado', 'cafeteria', 'bebida', 'otros']
    )
  );
