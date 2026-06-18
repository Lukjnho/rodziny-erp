-- Rol nuevo 'masa_panaderia': separa las masas de panaderia (rinden productos
-- terminados: panes/medialunas/facturas) de las masas de pasta (insumo del
-- armado, se combinan con el relleno). Permite que el boton "Cargar Panaderia"
-- del QR muestre solo estas masas, distinto del boton "Cargar Masa".
ALTER TABLE cocina_recetas DROP CONSTRAINT cocina_recetas_rol_check;
ALTER TABLE cocina_recetas ADD CONSTRAINT cocina_recetas_rol_check
  CHECK (
    rol IS NULL OR rol = ANY (ARRAY[
      'relleno','masa','masa_panaderia','salsa_base','postre_base',
      'panificado','pasteleria_base','bebida_base','adicional',
      'packaging','otros','milanesa_base'
    ])
  );

-- Reclasificar las masas de panaderia SIN GLUTEN de Saavedra (Pan Brioche, Pan
-- de Campo, Pan de Molde, Pan Lactal, pan de servicio, Focaccia, factura/
-- medialuna, Chipa). Patron robusto: todas empiezan con "Masa para" y terminan
-- "SIN GLUTEN"; ninguna masa de pasta usa ese patron.
UPDATE cocina_recetas
SET rol = 'masa_panaderia'
WHERE local = 'saavedra'
  AND rol = 'masa'
  AND nombre ILIKE 'Masa para %SIN GLUTEN';
