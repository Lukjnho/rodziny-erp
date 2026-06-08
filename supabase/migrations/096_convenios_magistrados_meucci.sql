-- Convenios adicionales detectados en Fudo Vedia (jun 2026).
-- Usan el formato "%NN" en el nombre del cliente (en vez de "NN%").
INSERT INTO public.convenios (local, fudo_customer_id, nombre, descuento_pct, tipo, estado)
VALUES
  ('vedia', '760', 'Magistrados', 10, 'institucional', 'activo'),
  ('vedia', '761', 'Meucci',      15, 'empresa',       'activo')
ON CONFLICT (local, fudo_customer_id) DO NOTHING;
