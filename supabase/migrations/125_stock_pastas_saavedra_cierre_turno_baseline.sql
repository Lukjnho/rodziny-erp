-- 125 — Saavedra: el cierre de turno de pastas es el baseline de cámara
--
-- Problema (reportado por Lucas): el "stock de cámara" de las pastas de Saavedra
-- se acumulaba sin techo. El baseline (conteo físico, cocina_cierre_camara) lo
-- cargaba Vero, pero se dejó de hacer el 23-jun; desde entonces cada producción
-- porcionada sumaba a cámara y NADA la bajaba (Fudo no descuenta cocina, sin
-- traspasos/merma), así que el Resumen semanal y la tab Stock mostraban ~285
-- porciones de ñoquis cuando el cierre de turno real daba ~0.
--
-- Modelo (definido con Lucas): en Saavedra se produce y almacena en la MISMA
-- cámara, así que el cierre de turno de pastas (cocina_cierre_dia, tipo='pasta')
-- ES el conteo físico de cámara. Debe funcionar como baseline: cada turno que el
-- equipo cuenta resetea el acumulado, y solo lo producido vía QR DESPUÉS de ese
-- cierre vuelve a sumar.
--
-- Local-aware: en Vedia el cierre de turno es del MOSTRADOR (≠ cámara freezer),
-- así que allí NO entra como baseline — Vedia sigue usando solo
-- cocina_cierre_camara, sin cambios de comportamiento.
--
-- Único cambio vs. mig 108: el lateral `b` (baseline) ahora toma el más reciente
-- entre cocina_cierre_camara y (solo Saavedra) el cierre de turno de pastas.

create or replace view v_cocina_stock_pastas as
select
  p.id as producto_id,
  p.nombre,
  p.codigo,
  p.local,
  p.minimo_produccion,
  -- CÁMARA: baseline + porcionado posterior + ajustes posteriores
  (coalesce(b.cantidad_real, 0)
   + coalesce((select sum(lp.porciones) from cocina_lotes_pasta lp
       where lp.producto_id = p.id and lp.local = p.local and lp.ubicacion = 'camara_congelado'
         and (b.created_at is null or coalesce(lp.porcionado_at, lp.created_at) > b.created_at)), 0)
   + coalesce((select sum(a.delta) from cocina_ajustes_stock a
       where a.producto_id = p.id and a.local = p.local and a.ubicacion = 'camara'
         and (b.created_at is null or a.created_at > b.created_at)), 0)
  )::numeric as porciones_camara,
  -- FRESCO: bandejas en freezer de producción, sin porcionar (histórico)
  coalesce((select sum(lp.porciones) from cocina_lotes_pasta lp
      where lp.producto_id = p.id and lp.local = p.local and lp.ubicacion = 'freezer_produccion'), 0)::numeric as porciones_fresco,
  -- TRASPASADAS: posteriores al baseline
  coalesce((select sum(t.porciones) from cocina_traspasos t
      where t.producto_id = p.id and t.local = p.local
        and (b.created_at is null or t.created_at > b.created_at)), 0)::numeric as porciones_traspasadas,
  -- MERMA: posterior al baseline
  coalesce((select sum(m.porciones) from cocina_merma m
      where m.producto_id = p.id and m.local = p.local
        and (b.created_at is null or m.created_at > b.created_at)), 0)::numeric as porciones_merma,
  -- AJUSTE MOSTRADOR: histórico (el mostrador tiene su propio cierre aparte)
  coalesce((select sum(a.delta) from cocina_ajustes_stock a
      where a.producto_id = p.id and a.local = p.local and a.ubicacion = 'mostrador'), 0) as porciones_ajuste_mostrador
from cocina_productos p
left join lateral (
  select bx.cantidad_real, bx.created_at
  from (
    -- Conteo físico de cámara (ambos locales)
    select cc.cantidad_real, cc.created_at
    from cocina_cierre_camara cc
    where cc.producto_id = p.id and cc.local = p.local
    union all
    -- Saavedra: cierre de turno de pastas = conteo físico de cámara (misma cámara)
    select cd.cantidad_real, cd.created_at
    from cocina_cierre_dia cd
    where cd.producto_id = p.id and cd.local = p.local
      and cd.tipo = 'pasta' and p.local = 'saavedra'
  ) bx
  order by bx.created_at desc
  limit 1
) b on true
where p.tipo = 'pasta' and p.activo = true;
