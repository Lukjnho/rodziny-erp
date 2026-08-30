-- 139_cierres_caja_separar_retiros.sql
--
-- Separar los retiros de caja en dos conceptos que hoy están mezclados.
--
-- EL PROBLEMA (verificado en datos):
--   El campo `otros_retiros` mezcla dos cosas que son opuestas:
--     a) plata que se aparta para el CAMBIO del próximo turno → vuelve a la
--        caja, NO es un gasto;
--     b) plata que salió de verdad para PAGAR algo → sí es un egreso, y muchas
--        veces ya está cargado además como gasto o adelanto en el ERP.
--
--   Caso concreto: 25/08/2026, Vedia mediodía. `otros_retiros = 124000`, nota
--   "24000 cambio / 100000 adelanto rocio". Y en `adelantos` está el adelanto de
--   Rocío de $100.000 en efectivo del mismo día. El mismo billete, dos veces.
--
--   En 2026: $40.189.800 en 815 turnos. 157 turnos ($27.307.000) tienen notas
--   que mencionan pagos o adelantos.
--
-- LA SOLUCIÓN:
--   Dos campos nuevos. `otros_retiros` SE MANTIENE como el total, porque es el
--   que usa la cuenta del arqueo:
--       esperado = fondo_apertura + fudo_efectivo − otros_retiros
--   Un disparador lo mantiene igual a la suma de los dos nuevos cuando se cargan.
--   Así la fórmula no se toca y NINGÚN número de hoy cambia.
--
-- RECORRIDO DEL HISTÓRICO:
--   Solo se clasifica lo inequívoco (595 de 815 turnos). Los 220 restantes
--   quedan sin clasificar, visibles en v_retiros_sin_clasificar. No se adivina.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. LOS DOS CAMPOS
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.cierres_caja ADD COLUMN IF NOT EXISTS retiro_cambio NUMERIC(14,2);
ALTER TABLE public.cierres_caja ADD COLUMN IF NOT EXISTS retiro_pagos  NUMERIC(14,2);

COMMENT ON COLUMN public.cierres_caja.retiro_cambio IS
  'Plata apartada para el cambio del proximo turno. VUELVE a la caja: no es un egreso y no debe sumarse a los gastos.';
COMMENT ON COLUMN public.cierres_caja.retiro_pagos IS
  'Plata sacada de la caja para pagar algo (proveedor, adelanto). SI es un egreso real. OJO: si ademas se cargo el gasto/adelanto en el ERP, esa plata esta registrada dos veces — usar este campo para netear.';
COMMENT ON COLUMN public.cierres_caja.otros_retiros IS
  'TOTAL retirado del turno = retiro_cambio + retiro_pagos. Se mantiene porque es el que usa la cuenta del arqueo. Lo sincroniza el disparador trg_cierres_caja_retiros cuando se cargan los dos campos nuevos.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. EL DISPARADOR QUE MANTIENE EL TOTAL
-- ═══════════════════════════════════════════════════════════════════════
-- Solo actúa cuando se escribe el desglose. Si una pantalla vieja graba
-- únicamente `otros_retiros`, no se toca nada.

CREATE OR REPLACE FUNCTION public.trg_cierres_caja_retiros()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.retiro_cambio IS NOT NULL OR NEW.retiro_pagos IS NOT NULL THEN
      NEW.otros_retiros := COALESCE(NEW.retiro_cambio, 0) + COALESCE(NEW.retiro_pagos, 0);
    END IF;
  ELSE
    -- Solo si el desglose es lo que está cambiando. Así un UPDATE que toca
    -- únicamente otros_retiros (camino viejo) sigue funcionando igual.
    IF NEW.retiro_cambio IS DISTINCT FROM OLD.retiro_cambio
       OR NEW.retiro_pagos IS DISTINCT FROM OLD.retiro_pagos THEN
      NEW.otros_retiros := COALESCE(NEW.retiro_cambio, 0) + COALESCE(NEW.retiro_pagos, 0);
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.trg_cierres_caja_retiros() IS
  'Mantiene cierres_caja.otros_retiros = retiro_cambio + retiro_pagos cuando se carga el desglose. No toca nada si solo se graba el total (camino viejo).';

DROP TRIGGER IF EXISTS trg_cierres_caja_retiros ON public.cierres_caja;
CREATE TRIGGER trg_cierres_caja_retiros
  BEFORE INSERT OR UPDATE OF retiro_cambio, retiro_pagos
  ON public.cierres_caja
  FOR EACH ROW EXECUTE FUNCTION public.trg_cierres_caja_retiros();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. RECORRIDO DEL HISTÓRICO — solo lo inequívoco
-- ═══════════════════════════════════════════════════════════════════════

-- 3.a — Turnos sin retiro: los dos en cero. (232 turnos)
UPDATE public.cierres_caja
   SET retiro_cambio = 0, retiro_pagos = 0
 WHERE otros_retiros IS NOT NULL
   AND otros_retiros = 0
   AND retiro_cambio IS NULL AND retiro_pagos IS NULL;

-- 3.b — La nota dice "cambio" y NO menciona pagos ni adelantos: todo es cambio.
--       (363 turnos, $10.377.900)
UPDATE public.cierres_caja
   SET retiro_cambio = otros_retiros, retiro_pagos = 0
 WHERE otros_retiros IS NOT NULL
   AND otros_retiros > 0
   AND otros_retiros_nota ~* 'cambio'
   AND otros_retiros_nota !~* '(pago|prove|adelanto|compr|merc)'
   AND retiro_cambio IS NULL AND retiro_pagos IS NULL;

-- El resto (220 turnos, $29.811.900) queda SIN clasificar a propósito:
-- notas que mezclan cambio con pagos, notas ambiguas y turnos con retiro sin nota.

-- ═══════════════════════════════════════════════════════════════════════
-- 4. VISTAS DE CONTROL
-- ═══════════════════════════════════════════════════════════════════════

-- 4.a — Lo que falta clasificar a mano.
CREATE OR REPLACE VIEW public.v_retiros_sin_clasificar AS
SELECT c.id, c.fecha, c.local, c.turno, c.caja,
       c.otros_retiros AS total_retirado,
       c.otros_retiros_nota AS nota,
       CASE
         WHEN c.otros_retiros_nota IS NULL OR btrim(c.otros_retiros_nota) = '' THEN 'sin nota'
         WHEN c.otros_retiros_nota ~* '(pago|prove|adelanto|compr|merc)'      THEN 'menciona pago o adelanto'
         ELSE 'nota ambigua'
       END AS motivo
  FROM public.cierres_caja c
 WHERE COALESCE(c.otros_retiros, 0) > 0
   AND (c.retiro_cambio IS NULL OR c.retiro_pagos IS NULL)
 ORDER BY c.fecha DESC, c.local, c.turno;

COMMENT ON VIEW public.v_retiros_sin_clasificar IS
  'Turnos con retiro de caja donde todavia no se separo cuanto fue cambio y cuanto fue pago. Los que dicen "menciona pago o adelanto" son los candidatos a estar contados dos veces (una en otros_retiros y otra como gasto/adelanto).';

-- 4.b — Control de que el total y el desglose no se desincronicen.
CREATE OR REPLACE VIEW public.v_retiros_descuadrados AS
SELECT c.id, c.fecha, c.local, c.turno,
       c.otros_retiros, c.retiro_cambio, c.retiro_pagos,
       c.otros_retiros - (COALESCE(c.retiro_cambio,0) + COALESCE(c.retiro_pagos,0)) AS diferencia
  FROM public.cierres_caja c
 WHERE (c.retiro_cambio IS NOT NULL OR c.retiro_pagos IS NOT NULL)
   AND COALESCE(c.otros_retiros,0) <> COALESCE(c.retiro_cambio,0) + COALESCE(c.retiro_pagos,0);

COMMENT ON VIEW public.v_retiros_descuadrados IS
  'Debe dar 0 filas. Si aparece algo, alguien grabo otros_retiros por un lado sin actualizar el desglose.';
