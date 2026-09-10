# Contexto de datos — rodziny-erp

**Generado el 10-sep-2026** · Solo lectura: armar este documento no tocó ni un dato.

## De dónde sale cada cosa, y por qué importa

Hay **dos fuentes y no dicen lo mismo**, así que conviene saber cuál se usó para qué:

| Parte | Fuente | Qué garantiza |
|---|---|---|
| Tablas, columnas, tipos, claves foráneas, índices | `supabase/esquema-aplicado.sql` | Es una **foto de la base real**. Lo que está acá, está aplicado. |
| Qué hace cada función y cada trigger | los 207 `supabase/migrations/*.sql` | Es lo que se **escribió**. Que esté escrito no prueba que esté aplicado. |
| Restricciones CHECK | los 207 `.sql` **únicamente** | ⚠️ Ver el aviso de abajo. |

> ### 💣 Tres cosas que este documento NO puede afirmar
>
> **1. Que los CHECK estén aplicados.** La foto del esquema exporta 116 restricciones con
> nombre y **las 116 son claves foráneas: no hay un solo CHECK**. Las reglas del tipo "este
> monto no puede ser negativo" solo se leen en las migraciones. Si alguna nunca se aplicó, o
> se borró a mano contra la base, este documento no tiene cómo darse cuenta.
>
> **2. Que lo escrito esté corriendo.** Ya pasó: la migración 072 estuvo escrita meses sin
> aplicarse. Por eso cada función lleva una columna **Aplicada**, que sale de cruzar su
> nombre contra la foto. Un ❌ ahí significa *escrita y nunca aplicada*.
>
> **3. Nada sobre permisos ni RLS.** La foto no trae las policies. Quién puede leer o
> escribir cada tabla **no está en este documento** y no se puede deducir de él.

---

## La cadena, de un vistazo

Es el recorrido que pidió el dueño, y es la parte que está completa. Se lee de arriba
hacia abajo: cada escalón se apoya en el anterior, y un error arriba se arrastra hasta abajo
sin que nadie lo note.

```
  COSTO         productos.costo_unitario ─── productos_costo_historial
    │           (lo que sale un insumo)      (quién lo cambió y cuándo)
    ▼
  RECETA        cocina_recetas ── cocina_receta_ingredientes ── cocina_pasta_recetas
    │           (qué lleva cada plato, y las subrecetas que cuelgan de él)
    ▼
  PRODUCCIÓN    cocina_lotes_masa ─┐
    │           cocina_lotes_relleno ─┼─► cocina_lotes_pasta ──► cocina_pizarron_items
    │           cocina_lotes_produccion ─┘   (porcionar_pasta_lote lo manda a la cámara)
    ▼
  STOCK         movimientos_stock · cocina_ajustes_stock · cocina_merma · cocina_traspasos
    │           (FIFO: fifo_consumir_camara_pasta reparte por lote más viejo primero)
    ▼
  VENTA         ventas_tickets ── ventas_items ── ventas_pagos
    │           caja_mesa_sesiones ── caja_mesa_lineas   (cobrar_venta / salon_cobrar_mesa)
    ▼
  MARGEN        cocina_recetas_precios_canal · productos_costeo_config
                (precio − IVA − comisión − costo)
```

> **Dónde se corta hoy.** Entre COSTO y MARGEN hay tres formas distintas de calcular lo
> mismo y no dan igual. Está todo en la sección 4.

---

## 1. Las tablas

**93 tablas · 1.162 columnas · 116 claves foráneas · 139 índices únicos · 13 vistas.**

### Las 35 tablas de la cadena, en detalle

> `NN` = no admite vacio. `→` = clave foranea. `U` = indice unico.

#### 1. COSTO — cuanto sale un insumo

##### `productos` · 19 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** |  |
| `fudo_id` | text |  |
| `categoria` | text **NN** |  |
| `nombre` | text **NN** |  |
| `unidad` | text **NN** |  |
| `stock_actual` | numeric |  |
| `stock_minimo` | numeric |  |
| `proveedor` | text |  |
| `costo_unitario` | numeric |  |
| `activo` | boolean |  |
| `updated_at` | timestamptz |  |
| `categoria_gasto_id` | uuid | → `categorias_gasto.id` *on delete set null* |
| `marca` | text |  |
| `merma_pct` | numeric **NN** |  |
| `es_packaging` | boolean **NN** |  |
| `contenido_ml` | numeric |  |
| `bulto_cantidad` | numeric |  |
| `bulto_nombre` | text |  |

- **Unico** `productos_local_nombre_key`: (local, nombre)
- **Unico** `productos_nombre_local_unique`: (nombre, local)

- **Le apuntan:** `cocina_productos.insumo_reventa_id` · `cocina_receta_ingredientes.producto_id` · `movimientos_stock.producto_id` · `productos_costo_historial.producto_id`

##### `productos_costo_historial` · 10 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `producto_id` | uuid **NN** | → `productos.id` *on delete cascade* |
| `costo_anterior` | numeric |  |
| `costo_nuevo` | numeric **NN** |  |
| `variacion_pct` | numeric |  |
| `fuente` | text **NN** |  |
| `gasto_id` | uuid | → `gastos.id` *on delete set null* |
| `usuario` | text |  |
| `comentario` | text |  |
| `fecha` | timestamptz **NN** |  |

##### `productos_costeo_config` · 6 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `categoria` | text **NN** |  |
| `margen_min` | numeric **NN** |  |
| `redondeo` | numeric **NN** |  |
| `descripcion` | text |  |
| `created_at` | timestamptz **NN** |  |
| `updated_at` | timestamptz **NN** |  |

##### `proveedores` · 18 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `razon_social` | text **NN** |  |
| `cuit` `U` | text |  |
| `condicion_iva` | text |  |
| `categoria_default_id` | uuid |  |
| `medio_pago_default` | text |  |
| `dias_pago` | integer |  |
| `contacto` | text |  |
| `telefono` | text |  |
| `email` | text |  |
| `activo` | boolean **NN** |  |
| `notas` | text |  |
| `created_at` | timestamptz **NN** |  |
| `updated_at` | timestamptz **NN** |  |
| `nombre_comercial` | text |  |
| `aliases` | ARRAY |  |
| `cuits_alt` | ARRAY |  |
| `medio_pago_default_id` | uuid | → `medios_pago.id` |

- **Le apuntan:** `gastos.proveedor_id`

##### `recepciones_pendientes` · 13 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** |  |
| `proveedor` | text |  |
| `items` | jsonb **NN** |  |
| `registrado_por` | text |  |
| `notas` | text |  |
| `foto_path` | text |  |
| `estado` | text **NN** |  |
| `validada_en` | timestamptz |  |
| `validada_por` | text |  |
| `notas_validacion` | text |  |
| `created_at` | timestamptz **NN** |  |
| `gasto_id` | uuid | → `gastos.id` |

#### 2. RECETA — que lleva cada plato

##### `cocina_recetas` · 24 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `nombre` | text **NN** |  |
| `tipo` | text **NN** |  |
| `rendimiento_kg` | numeric |  |
| `rendimiento_porciones` | numeric |  |
| `instrucciones` | text |  |
| `activo` | boolean **NN** |  |
| `created_at` | timestamptz **NN** |  |
| `updated_at` | timestamptz **NN** |  |
| `local` | text |  |
| `margen_seguridad_pct` | numeric |  |
| `gramos_por_porcion` | integer |  |
| `fudo_productos` | ARRAY |  |
| `rendimiento_unidad` | text **NN** |  |
| `g_semolin_por_kg` | numeric |  |
| `g_huevo_por_kg` | numeric |  |
| `minutos_lote` | numeric |  |
| `vendible` | boolean **NN** |  |
| `categoria` | text |  |
| `rol` | text |  |
| `subcategoria` | text |  |
| `ingredientes_armado` | jsonb |  |
| `kg_por_bolsa` | numeric |  |
| `descuenta_producto_id` | uuid | → `cocina_productos.id` |

- **Unico** `cocina_recetas_nombre_local_unique`: (nombre, local)

- **Le apuntan:** `caja_mesa_lineas.receta_id` · `cocina_cierre_dia.receta_id` · `cocina_lotes_masa.receta_id` · `cocina_lotes_pasta.receta_masa_id` · `cocina_lotes_produccion.receta_id` · `cocina_lotes_relleno.receta_id` · `cocina_merma.receta_id` · `cocina_pasta_recetas.receta_id` · `cocina_pizarron_items.receta_id` · `cocina_productos.masa_id` · `cocina_productos.receta_id` · `cocina_receta_ingredientes.receta_id` · `cocina_recetas_precios_canal.receta_id` · `ventas_items.receta_id`

##### `cocina_receta_ingredientes` · 9 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `receta_id` | uuid **NN** | → `cocina_recetas.id` *on delete cascade* |
| `nombre` | text **NN** |  |
| `cantidad` | numeric **NN** |  |
| `unidad` | text **NN** |  |
| `observaciones` | text |  |
| `orden` | integer **NN** |  |
| `created_at` | timestamptz **NN** |  |
| `producto_id` | uuid | → `productos.id` *on delete set null* |

##### `cocina_pasta_recetas` · 4 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `pasta_id` | uuid **NN** | → `cocina_productos.id` *on delete cascade* |
| `receta_id` | uuid **NN** | → `cocina_recetas.id` *on delete cascade* |
| `created_at` | timestamptz **NN** |  |

- **Unico** `cocina_pasta_recetas_pasta_id_receta_id_key`: (pasta_id, receta_id)

##### `cocina_productos` · 23 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `nombre` | text **NN** |  |
| `codigo` `U` | text **NN** |  |
| `tipo` | text **NN** |  |
| `unidad` | text **NN** |  |
| `minimo_produccion` | numeric |  |
| `local` | text **NN** |  |
| `activo` | boolean **NN** |  |
| `created_at` | timestamptz **NN** |  |
| `congelable` | boolean |  |
| `tiempo_anticipacion_hs` | integer |  |
| `disponible_almacen` | boolean |  |
| `receta_id` | uuid | → `cocina_recetas.id` *on delete set null* |
| `precio_venta` | numeric |  |
| `costo_empaque` | numeric |  |
| `fudo_nombres` | ARRAY **NN** |  |
| `es_ancla` | boolean **NN** |  |
| `insumo_reventa_id` | uuid | → `productos.id` *on delete set null* |
| `controla_stock` | boolean **NN** |  |
| `ml_por_venta` | numeric |  |
| `es_mixto` | boolean **NN** |  |
| `masa_id` | uuid | → `cocina_recetas.id` |
| `lleva_relleno` | boolean |  |

- **Le apuntan:** `almacen_pedidos.producto_id` · `cocina_ajustes_stock.producto_id` · `cocina_cierre_camara.producto_id` · `cocina_cierre_dia.producto_id` · `cocina_lotes_pasta.producto_id` · `cocina_merma.producto_id` · `cocina_pasta_recetas.pasta_id` · `cocina_pizarron_items.destino_producto_id` · `cocina_productos_precio_historial.cocina_producto_id` · `cocina_productos_precios_canal.cocina_producto_id` · `cocina_recetas.descuenta_producto_id` · `cocina_traspasos.producto_id` · `ventas_items.cocina_producto_id`

#### 3. PRODUCCION — que se fabrico

##### `cocina_lotes_pasta` · 25 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `producto_id` | uuid **NN** | → `cocina_productos.id` |
| `lote_relleno_id` | uuid | → `cocina_lotes_relleno.id` |
| `fecha` | date **NN** |  |
| `codigo_lote` | text **NN** |  |
| `receta_masa_id` | uuid | → `cocina_recetas.id` |
| `masa_kg` | numeric |  |
| `relleno_kg` | numeric |  |
| `porciones` | integer |  |
| `responsable` | text |  |
| `local` | text **NN** |  |
| `notas` | text |  |
| `created_at` | timestamptz **NN** |  |
| `lote_masa_id` | uuid | → `cocina_lotes_masa.id` |
| `ubicacion` | text **NN** |  |
| `cantidad_cajones` | integer |  |
| `fecha_porcionado` | date |  |
| `responsable_porcionado` | text |  |
| `merma_porcionado` | integer **NN** |  |
| `muzzarella_gramos` | integer |  |
| `sobrante_gramos` | numeric |  |
| `sobrante_origen_lote_id` | uuid | → `cocina_lotes_pasta.id` *on delete set null* |
| `semolin_gramos` | integer |  |
| `huevo_gramos` | integer |  |
| `porcionado_at` | timestamptz |  |

- **Unico** `cocina_lotes_pasta_codigo_unico_por_local`: (local, codigo_lote) WHERE (codigo_lote IS NOT NULL)

- **Le apuntan:** `almacen_pedidos.lote_id` · `cocina_lote_consumos.lote_pasta_id` · `cocina_lotes_pasta.sobrante_origen_lote_id` · `cocina_lotes_pasta_masas.lote_pasta_id`

##### `cocina_lotes_masa` · 12 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `receta_id` | uuid | → `cocina_recetas.id` |
| `fecha` | date **NN** |  |
| `kg_producidos` | numeric **NN** |  |
| `kg_sobrante` | numeric |  |
| `destino_sobrante` | text |  |
| `responsable` | text |  |
| `local` | text **NN** |  |
| `notas` | text |  |
| `created_at` | timestamptz **NN** |  |
| `ingredientes_reales` | jsonb |  |
| `excluido_analisis` | boolean **NN** |  |

- **Le apuntan:** `cocina_lotes_pasta.lote_masa_id` · `cocina_lotes_pasta_masas.lote_masa_id`

##### `cocina_lotes_relleno` · 13 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `receta_id` | uuid | → `cocina_recetas.id` |
| `fecha` | date **NN** |  |
| `cantidad_recetas` | integer **NN** |  |
| `peso_total_kg` | numeric **NN** |  |
| `responsable` | text |  |
| `local` | text **NN** |  |
| `notas` | text |  |
| `created_at` | timestamptz **NN** |  |
| `ingredientes_reales` | jsonb |  |
| `excluido_analisis` | boolean **NN** |  |
| `bolsas` | numeric |  |
| `kg_papa` | numeric |  |

- **Le apuntan:** `cocina_lotes_pasta.lote_relleno_id`

##### `cocina_lotes_produccion` · 18 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `fecha` | date **NN** |  |
| `local` | text **NN** |  |
| `categoria` | text **NN** |  |
| `receta_id` | uuid | → `cocina_recetas.id` |
| `nombre_libre` | text |  |
| `cantidad_producida` | numeric **NN** |  |
| `unidad` | text **NN** |  |
| `merma_cantidad` | numeric |  |
| `merma_motivo` | text |  |
| `responsable` | text |  |
| `notas` | text |  |
| `created_at` | timestamptz **NN** |  |
| `ingredientes_reales` | jsonb |  |
| `en_stock` | boolean **NN** |  |
| `cantidad_restante_manual` | numeric |  |
| `origen` | text **NN** |  |
| `excluido_analisis` | boolean **NN** |  |

##### `cocina_lotes_pasta_masas` · 5 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `lote_pasta_id` | uuid **NN** | → `cocina_lotes_pasta.id` *on delete cascade* |
| `lote_masa_id` | uuid **NN** | → `cocina_lotes_masa.id` |
| `masa_kg` | numeric **NN** |  |
| `created_at` | timestamptz **NN** |  |

##### `cocina_lote_consumos` · 10 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `lote_pasta_id` | uuid **NN** | → `cocina_lotes_pasta.id` *on delete cascade* |
| `tipo` | text **NN** |  |
| `cantidad` | numeric **NN** |  |
| `origen_tabla` | text **NN** |  |
| `origen_id` | uuid |  |
| `fecha` | date **NN** |  |
| `local` | text **NN** |  |
| `notas` | text |  |
| `created_at` | timestamptz **NN** |  |

##### `cocina_pizarron_items` · 18 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `fecha_objetivo` | date **NN** |  |
| `local` | text **NN** |  |
| `turno` | text |  |
| `tipo` | text **NN** |  |
| `receta_id` | uuid | → `cocina_recetas.id` *on delete set null* |
| `texto_libre` | text |  |
| `cantidad_recetas` | numeric **NN** |  |
| `estado` | text **NN** |  |
| `lote_tabla` | text |  |
| `lote_id` | uuid |  |
| `cantidad_hecha` | numeric |  |
| `completado_en` | timestamptz |  |
| `notas` | text |  |
| `publicado_por` | uuid | → `auth.users.id` *on delete set null* |
| `publicado_en` | timestamptz **NN** |  |
| `created_at` | timestamptz **NN** |  |
| `destino_producto_id` | uuid | → `cocina_productos.id` *on delete set null* |

#### 4. STOCK — que hay y donde

##### `movimientos_stock` · 12 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** |  |
| `producto_id` | uuid | → `productos.id` |
| `producto_nombre` | text **NN** |  |
| `tipo` | text **NN** |  |
| `cantidad` | numeric **NN** |  |
| `unidad` | text **NN** |  |
| `motivo` | text |  |
| `observacion` | text |  |
| `registrado_por` | text |  |
| `created_at` | timestamptz |  |
| `cantidad_sin_stock` | numeric |  |

##### `cocina_ajustes_stock` · 9 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `fecha` | date **NN** |  |
| `local` | text **NN** |  |
| `producto_id` | uuid **NN** | → `cocina_productos.id` *on delete cascade* |
| `ubicacion` | text **NN** |  |
| `delta` | numeric **NN** |  |
| `motivo` | text |  |
| `responsable` | text |  |
| `created_at` | timestamptz **NN** |  |

##### `cocina_merma` · 10 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `producto_id` | uuid | → `cocina_productos.id` |
| `fecha` | date **NN** |  |
| `porciones` | numeric **NN** |  |
| `motivo` | text |  |
| `responsable` | text |  |
| `local` | text **NN** |  |
| `notas` | text |  |
| `created_at` | timestamptz **NN** |  |
| `receta_id` | uuid | → `cocina_recetas.id` *on delete set null* |

##### `cocina_traspasos` · 10 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `producto_id` | uuid **NN** | → `cocina_productos.id` |
| `fecha` | date **NN** |  |
| `hora` | time |  |
| `porciones` | integer **NN** |  |
| `responsable` | text |  |
| `local` | text **NN** |  |
| `notas` | text |  |
| `created_at` | timestamptz **NN** |  |
| `cantidad_cajones` | integer |  |

##### `cocina_cierre_camara` · 8 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `producto_id` | uuid **NN** | → `cocina_productos.id` *on delete cascade* |
| `local` | text **NN** |  |
| `fecha` | date **NN** |  |
| `cantidad_real` | numeric **NN** |  |
| `responsable` | text |  |
| `notas` | text |  |
| `created_at` | timestamptz **NN** |  |

##### `cocina_cierre_dia` · 15 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `fecha` | date **NN** |  |
| `local` | text **NN** |  |
| `producto_id` | uuid | → `cocina_productos.id` *on delete cascade* |
| `tipo` | text **NN** |  |
| `turno` | text |  |
| `cantidad_real` | numeric **NN** |  |
| `unidad` | text **NN** |  |
| `inicial` | numeric |  |
| `entrega` | numeric |  |
| `vendido` | numeric |  |
| `responsable` | text |  |
| `notas` | text |  |
| `created_at` | timestamptz **NN** |  |
| `receta_id` | uuid | → `cocina_recetas.id` *on delete set null* |

- **Unico** `ux_cocina_cierre_dia_con_turno`: (fecha, local, producto_id, turno) WHERE (turno IS NOT NULL)
- **Unico** `ux_cocina_cierre_dia_sin_turno`: (fecha, local, producto_id) WHERE (turno IS NULL)

##### `almacen_pedidos` · 19 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `producto_id` | uuid | → `cocina_productos.id` |
| `producto_nombre` | text **NN** |  |
| `cantidad` | integer **NN** |  |
| `cliente_nombre` | text **NN** |  |
| `cliente_telefono` | text |  |
| `fecha_pedido` | date **NN** |  |
| `fecha_entrega` | date **NN** |  |
| `turno` | text |  |
| `estado` | text **NN** |  |
| `lote_id` | uuid | → `cocina_lotes_pasta.id` |
| `medio_pago` | text |  |
| `abono` | boolean |  |
| `vendedor` | text |  |
| `nro_ticket` | text |  |
| `observaciones` | text |  |
| `local` | text **NN** |  |
| `created_at` | timestamptz **NN** |  |
| `medio_pago_id` | uuid | → `medios_pago.id` |

##### `edr_cierres_inventario` · 15 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** |  |
| `periodo` | text **NN** |  |
| `fecha_cierre` | timestamptz **NN** |  |
| `monto_alimentos` | numeric **NN** |  |
| `monto_bebidas` | numeric **NN** |  |
| `monto_indirectos` | numeric **NN** |  |
| `productos_sin_clasificar` | integer **NN** |  |
| `estado` | text **NN** |  |
| `cerrado_por` | text |  |
| `observaciones` | text |  |
| `aprobado_por` | text |  |
| `aprobado_at` | timestamptz |  |
| `observacion_aprobacion` | text |  |
| `created_at` | timestamptz **NN** |  |

- **Unico** `edr_cierres_inventario_local_periodo_key`: (local, periodo)

#### 5. VENTA — que salio por la puerta

##### `ventas_items` · 20 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** | → `ventas_origen_oficial.local` *on update cascade* |
| `periodo` | text **NN** |  |
| `codigo` | text |  |
| `categoria` | text |  |
| `subcategoria` | text |  |
| `nombre` | text **NN** |  |
| `cantidad` | numeric **NN** |  |
| `total` | numeric **NN** |  |
| `ticket_id` | uuid | → `ventas_tickets.id` *on delete cascade* |
| `fecha` | date |  |
| `linea` | integer |  |
| `linea_padre_id` | uuid | → `ventas_items.id` *on delete cascade* |
| `vinculo_origen` | text |  |
| `receta_id` | uuid | → `cocina_recetas.id` |
| `cocina_producto_id` | uuid | → `cocina_productos.id` |
| `precio_unitario` | numeric |  |
| `origen` | text **NN** |  |
| `descuento_pct` | numeric **NN** |  |
| `descuento_monto` | numeric **NN** |  |

- **Unico** `ventas_items_pos_ticket_linea_key`: (ticket_id, linea) WHERE (origen = 'pos'::text)

- **Le apuntan:** `ventas_items.linea_padre_id`

##### `ventas_tickets` · 24 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** | → `ventas_origen_oficial.local` *on update cascade* |
| `fudo_id` | text |  |
| `fecha` | date **NN** |  |
| `hora` | time |  |
| `caja` | text |  |
| `estado` | text |  |
| `tipo_venta` | text |  |
| `medio_pago` | text |  |
| `total_bruto` | numeric **NN** |  |
| `total_neto` | numeric |  |
| `iva` | numeric |  |
| `es_fiscal` | boolean |  |
| `periodo` | text **NN** |  |
| `es_dividendo` | boolean |  |
| `medio_pago_id` | uuid | → `medios_pago.id` |
| `cuenta` | text |  |
| `origen` | text **NN** |  |
| `cierre_caja_id` | uuid | → `cierres_caja.id` *on delete set null* |
| `cliente` | text |  |
| `descuento_total` | numeric **NN** |  |
| `convenio_id` | uuid | → `convenios.id` *on delete set null* |
| `idempotencia` `U` | uuid |  |
| `cobro_huella` | text |  |

- **Unico** `ventas_tickets_local_fudo_id_key`: (local, fudo_id)

- **Le apuntan:** `caja_mesa_lineas.ticket_id` · `ventas_comprobantes.ticket_id` · `ventas_items.ticket_id` · `ventas_pagos.ticket_id`

##### `ventas_pagos` · 14 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** |  |
| `periodo` | text **NN** |  |
| `fudo_ticket_id` | text **NN** |  |
| `fecha` | date |  |
| `medio_pago` | text **NN** |  |
| `monto` | numeric **NN** |  |
| `tipo_venta` | text |  |
| `caja` | text |  |
| `es_dividendo` | boolean |  |
| `medio_pago_id` | uuid | → `medios_pago.id` |
| `cuenta` | text |  |
| `ticket_id` | uuid | → `ventas_tickets.id` *on delete cascade* |
| `origen` | text **NN** |  |

##### `ventas_comprobantes` · 34 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `ticket_id` `U` | uuid **NN** | → `ventas_tickets.id` *on delete restrict* |
| `local` | text **NN** |  |
| `tipo_comprobante` | smallint **NN** |  |
| `punto_venta` | integer **NN** |  |
| `concepto` | smallint **NN** |  |
| `receptor_doc_tipo` | smallint **NN** |  |
| `receptor_doc_nro` | text **NN** |  |
| `receptor_nombre` | text |  |
| `receptor_condicion_iva` | smallint **NN** |  |
| `receptor_domicilio` | text |  |
| `imp_neto` | numeric **NN** |  |
| `imp_iva` | numeric **NN** |  |
| `imp_tot_conc` | numeric **NN** |  |
| `imp_op_ex` | numeric **NN** |  |
| `imp_trib` | numeric **NN** |  |
| `imp_total` | numeric **NN** |  |
| `iva_detalle` | jsonb **NN** |  |
| `fecha_comprobante` | date **NN** |  |
| `numero` | bigint |  |
| `cae` | text |  |
| `cae_vencimiento` | date |  |
| `observaciones` | jsonb |  |
| `estado` | text **NN** |  |
| `intentos` | integer **NN** |  |
| `ultimo_error` | text |  |
| `arca_request` | jsonb |  |
| `arca_response` | jsonb |  |
| `ambiente` | text **NN** |  |
| `anula_comprobante_id` | uuid | → `ventas_comprobantes.id` |
| `solicitud` | text **NN** |  |
| `creado_at` | timestamptz **NN** |  |
| `creado_por` | uuid |  |
| `emitido_at` | timestamptz |  |

- **Unico** `ux_ventas_comprobantes_numeracion`: (ambiente, punto_venta, tipo_comprobante, numero) WHERE (numero IS NOT NULL)

- **Le apuntan:** `ventas_comprobantes.anula_comprobante_id`

##### `ventas_origen_oficial` · 4 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `local` | text **NN** |  |
| `origen` | text **NN** |  |
| `actualizado_en` | timestamptz **NN** |  |
| `actualizado_por` | uuid | → `auth.users.id` *on delete set null* |

- **Le apuntan:** `ventas_items.local` · `ventas_tickets.local`

##### `caja_mesa_lineas` · 19 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** |  |
| `sesion_id` | uuid **NN** | → `caja_mesa_sesiones.id` *on delete restrict* |
| `envio_id` | uuid | → `caja_mesa_envios.id` *on delete restrict* |
| `padre_id` | uuid | → `caja_mesa_lineas.id` *on delete restrict* |
| `linea` | integer **NN** |  |
| `receta_id` | uuid **NN** | → `cocina_recetas.id` *on delete restrict* |
| `nombre` | text **NN** |  |
| `categoria` | text |  |
| `cantidad` | numeric **NN** |  |
| `precio_unitario` | numeric **NN** |  |
| `descuento_pct` | numeric **NN** |  |
| `estado` | text **NN** |  |
| `sacada_en` | timestamptz |  |
| `sacada_por` | uuid | → `auth.users.id` *on delete set null* |
| `sacada_motivo` | text |  |
| `ticket_id` | uuid | → `ventas_tickets.id` *on delete set null* |
| `agregada_en` | timestamptz **NN** |  |
| `agregada_por` | uuid | → `auth.users.id` *on delete set null* |

- **Unico** `caja_mesa_lineas_sesion_id_linea_key`: (sesion_id, linea)

- **Le apuntan:** `caja_mesa_lineas.padre_id`

##### `caja_mesa_sesiones` · 12 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** |  |
| `mesa_id` `U` | uuid **NN** | → `caja_mesas.id` *on delete restrict* |
| `comensales` | integer **NN** |  |
| `estado` | text **NN** |  |
| `abierta_en` | timestamptz **NN** |  |
| `abierta_por` | uuid | → `auth.users.id` *on delete set null* |
| `cuenta_pedida_en` | timestamptz |  |
| `cuenta_pedida_por` | uuid | → `auth.users.id` *on delete set null* |
| `cerrada_en` | timestamptz |  |
| `anulada_motivo` | text |  |
| `nota` | text |  |

- **Le apuntan:** `caja_mesa_envios.sesion_id` · `caja_mesa_lineas.sesion_id`

##### `cierres_caja` · 35 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** |  |
| `fecha` | date **NN** |  |
| `turno` | text |  |
| `caja` | text |  |
| `monto_esperado` | numeric |  |
| `monto_contado` | numeric **NN** |  |
| `diferencia` | numeric |  |
| `nota` | text |  |
| `creado_por` | text |  |
| `created_at` | timestamptz |  |
| `verificado` | boolean |  |
| `verificado_por` | text |  |
| `verificado_at` | timestamptz |  |
| `fondo_apertura` | numeric |  |
| `fondo_siguiente` | numeric |  |
| `retiro` | numeric |  |
| `otros_retiros` | numeric **NN** |  |
| `otros_retiros_nota` | text |  |
| `hora_inicio` | time |  |
| `hora_cierre` | time |  |
| `fudo_efectivo` | numeric **NN** |  |
| `fudo_qr` | numeric **NN** |  |
| `fudo_debito` | numeric **NN** |  |
| `fudo_credito` | numeric **NN** |  |
| `fudo_transferencia` | numeric **NN** |  |
| `cajero_nombre` | text |  |
| `fudo_mp_lucas` | numeric **NN** |  |
| `dividendo_id` | uuid | → `dividendos.id` *on delete set null* |
| `monto_llevado_caja_fuerte` | numeric |  |
| `nota_caja_fuerte` | text |  |
| `nro_arqueo_fudo` | text |  |
| `retiro_cambio` | numeric |  |
| `retiro_pagos` | numeric |  |
| `origen` | text **NN** |  |

- **Unico** `cierres_caja_local_fecha_turno_caja_key`: (local, fecha, turno, caja)

- **Le apuntan:** `cierres_caja_medios.cierre_caja_id` · `ventas_tickets.cierre_caja_id`

#### 6. MARGEN — a que precio, contra que costo

##### `cocina_recetas_precios_canal` · 6 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `receta_id` | uuid **NN** | → `cocina_recetas.id` *on delete cascade* |
| `canal` | text **NN** |  |
| `precio` | numeric **NN** |  |
| `created_at` | timestamptz **NN** |  |
| `updated_at` | timestamptz **NN** |  |

- **Unico** `cocina_recetas_precios_canal_receta_id_canal_key`: (receta_id, canal)

##### `cocina_productos_precios_canal` · 6 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `cocina_producto_id` | uuid **NN** | → `cocina_productos.id` *on delete cascade* |
| `canal` | text **NN** |  |
| `precio` | numeric **NN** |  |
| `created_at` | timestamptz **NN** |  |
| `updated_at` | timestamptz **NN** |  |

- **Unico** `cocina_productos_precios_canal_cocina_producto_id_canal_key`: (cocina_producto_id, canal)

##### `cocina_recetas_precios_historial` · 14 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `receta_id` | uuid **NN** |  |
| `receta_nombre` | text |  |
| `local` | text |  |
| `canal` | text **NN** |  |
| `accion` | text **NN** |  |
| `precio_anterior` | numeric |  |
| `precio_nuevo` | numeric |  |
| `variacion_pct` | numeric |  |
| `fecha` | timestamptz **NN** |  |
| `usuario` | text |  |
| `usuario_id` | uuid |  |
| `origen` | text |  |
| `motivo` | text |  |

##### `cocina_productos_precio_historial` · 8 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `cocina_producto_id` | uuid **NN** | → `cocina_productos.id` *on delete cascade* |
| `precio_anterior` | numeric |  |
| `precio_nuevo` | numeric |  |
| `variacion_pct` | numeric |  |
| `fecha` | timestamptz **NN** |  |
| `usuario` | text |  |
| `motivo` | text |  |

##### `caja_canal_precio` · 2 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `tipo_venta` | text **NN** |  |
| `canal` | text **NN** |  |

##### `convenios` · 14 columnas

| Columna | Tipo | Apunta a |
|---|---|---|
| `id` | uuid **NN** |  |
| `local` | text **NN** |  |
| `fudo_customer_id` | text |  |
| `nombre` | text **NN** |  |
| `descuento_pct` | numeric |  |
| `tipo` | text |  |
| `contacto` | text |  |
| `beneficios_extra` | text |  |
| `vigencia_desde` | date |  |
| `vigencia_hasta` | date |  |
| `estado` | text **NN** |  |
| `notas` | text |  |
| `activo` | boolean **NN** |  |
| `created_at` | timestamptz **NN** |  |

- **Unico** `convenios_local_fudo_customer_id_key`: (local, fudo_customer_id)

- **Le apuntan:** `ventas_tickets.convenio_id`

---

### Las otras 58 tablas, en compacto

| Tabla | Cols | Columnas | Apunta a |
|---|---:|---|---|
| `adelantos` | 13 | id, empleado_id, periodo, fecha, monto, motivo, created_at, conciliado_movimiento_id, medio_pago, numero_operacion, comprobante_path, medio_pago_id, cuenta | empleados · medios_pago · movimientos_bancarios |
| `agenda_items` | 16 | id, usuario_id, titulo, tipo, fecha_inicio, fecha_fin, all_day, prioridad, completado, completado_at, recurrencia, nota, created_at, asignados, recordatorio_minutos, recordatorio_enviado_at | auth.users |
| `aguinaldos` | 17 | id, empleado_id, anio, semestre, mejor_sueldo, dias_trabajados, monto_calculado, monto_pagado, pagado, fecha_pago, notas, created_at, updated_at, medio_pago, gasto_id, medio_pago_id, cuenta | empleados · gastos · medios_pago |
| `amortizaciones` | 10 | id, gasto_id, local, descripcion, fecha_inicio, importe_total, vida_util_meses, cuota_mensual, activo, created_at | gastos |
| `arca_config` | 11 | local, cuit_emisor, punto_venta, ambiente, razon_social, domicilio_comercial, ingresos_brutos, inicio_actividades, activo, modo_facturacion, actualizado_at |  |
| `arca_tokens` | 8 | cuit, servicio, ambiente, token, sign, generado_at, expira_at, guardado_at |  |
| `bonos` | 7 | id, empleado_id, periodo, fecha, monto, motivo, created_at | empleados |
| `caja_mesa_envios` | 7 | id, local, sesion_id, numero, enviado_en, enviado_por, impreso_en | auth.users · caja_mesa_sesiones |
| `caja_mesas` | 11 | id, local, sala_id, numero, capacidad, forma, pos_x, pos_y, ancho, alto, activo | caja_salas |
| `caja_salas` | 5 | id, local, nombre, orden, activo |  |
| `categorias_gasto` | 7 | id, nombre, parent_id, tipo_edr, activo, orden, created_at | categorias_gasto |
| `cierres_caja_medios` | 7 | id, cierre_caja_id, medio_pago_id, esperado, declarado, diferencia, created_at | cierres_caja · medios_pago |
| `cierres_mes` | 6 | id, local, periodo, cerrado_at, cerrado_por, notas |  |
| `cierres_mes_overrides` | 7 | id, local, periodo, checkpoint_key, marcado_at, marcado_por, motivo |  |
| `clientes_fiscales` | 9 | id, doc_tipo, doc_nro, nombre, condicion_iva, domicilio, email, notas, creado_at |  |
| `comision_mp_config` | 4 | medio_pago, pct, descripcion, actualizado |  |
| `comprobantes` | 17 | id, hash_archivo, file_path, mime_type, tamano_bytes, subido_por, subido_at, ocr_status, ocr_raw, ocr_extraido, n_operacion, cuit_emisor, monto_extraido, fecha_extraida, gasto_id, duplicado_de, estado | auth.users · comprobantes · gastos |
| `configuracion` | 3 | clave, valor, updated_at |  |
| `correo_integracion` | 11 | id, proveedor, email_casilla, refresh_token, access_token, token_expira_en, conectado, oauth_state, ultima_lectura, ultimo_error, updated_at |  |
| `cronograma` | 12 | id, empleado_id, fecha, hora_entrada, hora_salida, es_franco, publicado, created_by, created_at, updated_at, turnos, observaciones | empleados |
| `descuentos` | 7 | id, empleado_id, periodo, fecha, monto, motivo, created_at | empleados |
| `dividendos` | 15 | id, socio, fecha, monto, medio_pago, concepto, local, periodo, creado_por, created_at, numero_operacion, comprobante_path, conciliado_movimiento_id, medio_pago_id, cuenta | medios_pago |
| `edr_partidas` | 6 | id, local, periodo, concepto, monto, updated_at |  |
| `efemerides_gastronomicas` | 9 | id, mes, dia, nombre, descripcion, categoria, idea_plato, activo, created_at |  |
| `empleados` | 29 | id, nombre, apellido, dni, telefono, email, puesto, local, fecha_ingreso, sueldo_neto, horario_tipo, estado_laboral, fecha_efectivizacion, activo, pin_fichaje, observaciones, created_at, updated_at, modalidad_cobro, manipulacion_alimentos_vence, certificado_domicilio, certificado_domicilio_fecha, horas_semanales_requeridas, es_produccion, cbu, alias_bancario, cuenta_sueldo, fecha_egreso, motivo_baja |  |
| `extractos_estado` | 4 | cuenta, al_dia_hasta, actualizado_por, actualizado_en |  |
| `fichadas` | 14 | id, empleado_id, fecha, tipo, "timestamp", local, lat, lng, foto_path, minutos_diferencia, origen, observaciones, created_at, evento | empleados |
| `fudo_sync_runs` | 11 | id, local, anio, started_at, finished_at, status, tickets_importados, dividendos_importados, errores, error_msg, iniciado_por |  |
| `fudo_tokens` | 4 | local, token, exp, actualizado_at |  |
| `gastos` | 36 | id, local, fudo_id, fecha, proveedor, categoria, subcategoria, comentario, estado_pago, importe_total, importe_neto, iva, iibb, medio_pago, tipo_comprobante, nro_comprobante, de_caja, cancelado, periodo, fecha_vencimiento, proveedor_id, categoria_id, comprobante_path, recepcion_id, punto_venta, creado_por, creado_manual, items_json, factura_path, regla_id, comprobante_id, aprobado_por, aprobado_at, created_at, medio_pago_id, cuenta | auth.users · categorias_gasto · comprobantes · medios_pago · proveedores · reglas_movimiento |
| `gastos_backfill_proveedor_id_log` | 9 | id, gasto_id, proveedor_id_anterior, proveedor_id_nuevo, texto_gasto, score, match_label, batch_label, aplicado_at | gastos |
| `impuestos_mensuales` | 10 | id, periodo, f931_path, libro_path, monto_total, pagado, fecha_pago, observaciones, created_at, updated_at |  |
| `liquidaciones_quincenales` | 11 | id, empleado_id, periodo, cobra_presentismo, pagado, fecha_pago, observaciones, created_at, updated_at, medio_pago, medio_pago_id | empleados · medios_pago |
| `medios_pago` | 12 | id, codigo, nombre, es_efectivo, cuenta_default_egreso, aplica_ventas, aplica_egresos, activo, orden, created_at, cuenta_default_venta, factura_automatica |  |
| `medios_pago_alias` | 4 | alias, medio_codigo, cuenta, nota | medios_pago |
| `movimientos_bancarios` | 19 | id, cuenta, fecha, descripcion, debito, credito, saldo, categoria, local, es_dividendo, referencia, periodo, fuente, es_transferencia_interna, tipo, gasto_id, transferencia_par_id, sugerencia, sugerencia_regla_id | gastos · movimientos_bancarios · reglas_movimiento |
| `mp_release_reports` | 15 | id, begin_date, end_date, status, mp_post_id, mp_list_id, file_name, payouts_insertados, cargos_insertados, filas_csv, filas_ignoradas, error_msg, created_at, processed_at, poll_intentos |  |
| `mp_sync_runs` | 15 | id, started_at, finished_at, desde, hasta, meses_procesados, payments_encontrados, movs_principales_nuevos, movs_principales_existentes, charges_nuevos, charges_existentes, conciliados, errores, detalle_meses, status |  |
| `pagos_fijos` | 18 | id, periodo, concepto, categoria, categoria_gasto_id, monto, fecha_vencimiento, pagado, fecha_pago, medio_pago, gasto_id, notas, created_at, comprobante_path, local, vep_numero, medio_pago_id, cuenta | categorias_gasto · gastos · medios_pago |
| `pagos_gastos` | 16 | id, gasto_id, fecha_pago, monto, medio_pago, referencia, comprobante_pago_path, conciliado_movimiento_id, notas, creado_por, created_at, descuento, numero_operacion, programado, medio_pago_id, cuenta | gastos · medios_pago |
| `pagos_mp` | 17 | id, fecha, fecha_aprobado, monto, monto_neto, comision_mp, impuestos, medio_pago, metodo_pago, estado, descripcion, store_id, pos_id, local, periodo, referencia_externa, sincronizado_at |  |
| `pagos_sueldos` | 15 | id, empleado_id, periodo, fecha_pago, monto, medio_pago, local, empleado_nombre, created_at, updated_at, cuenta, numero_operacion, comprobante_pago_path, conciliado_movimiento_id, medio_pago_id | empleados · medios_pago |
| `perfiles` | 26 | user_id, nombre, es_admin, puede_ver_dashboard, puede_ver_ventas, puede_ver_finanzas, puede_ver_edr, puede_ver_gastos, puede_ver_amortizaciones, puede_ver_rrhh, puede_ver_compras, puede_ver_usuarios, created_at, puede_ver_cocina, puede_ver_almacen, local_restringido, puede_ver_flujo_caja, puede_ver_productos, puede_ver_agenda, puede_ver_convenios, puede_ver_integraciones, puede_ver_alertas_finanzas, puede_ver_caja, puede_ver_salon, puede_anular_ventas, puede_ver_esperado_caja | auth.users |
| `productos_acciones_estado` | 12 | id, accion_key, tipo, local, producto_codigo, producto_nombre, estado, precio_objetivo, nota, usuario_id, created_at, updated_at | auth.users |
| `proyeccion_config` | 7 | id, saldo_operativa_inicial, saldo_reserva_inicial, fecha_saldo, cmv_pct_override, meses_promedio, updated_at |  |
| `proyeccion_flujo_items` | 8 | id, periodo, concepto, tipo, cuenta, monto, nota, created_at |  |
| `push_subscriptions` | 7 | id, user_id, endpoint, p256dh, auth, user_agent, created_at | auth.users |
| `recibos_sueldo` | 14 | id, empleado_id, cuil_detectado, nombre_detectado, periodo, monto_neto, archivo_path, message_id, created_at, bruto, aporte_jubilacion, aporte_obra_social, aporte_pami, total_aportes | empleados |
| `reglas_movimiento` | 15 | id, nombre, patron, cuenta, signo, proveedor, subcategoria, categoria_gasto_id, agrupacion, prioridad, activo, notas, creado_at, updated_at, accion | categorias_gasto |
| `saldos_cuentas` | 6 | id, cuenta, fecha, saldo, fuente, created_at |  |
| `sanciones` | 7 | id, empleado_id, periodo, fecha, monto, motivo, created_at | empleados |
| `sueldos_mensuales` | 10 | id, empleado_id, periodo, sueldo_recibo, plus_mano, presentismo_pagado, fecha_pago, observaciones, created_at, updated_at | empleados |
| `vacaciones` | 12 | id, empleado_id, fecha_desde, fecha_hasta, dias_corridos, anio_correspondiente, estado, motivo, aprobado_por, notas, created_at, updated_at | empleados |
| `ventas_mensuales_historico` | 5 | local, periodo, total_bruto, fuente, updated_at |  |
| `veps` | 12 | id, descripcion, impuesto, periodo, vencimiento, monto, archivo_path, pagado, fecha_pago, message_id, created_at, updated_at |  |


### Las 13 vistas

- `v_cocina_lote_pasta_saldo`
- `v_cocina_stock_mostrador`
- `v_cocina_stock_pastas`
- `v_edr_gastos_invisibles`
- `v_edr_gastos_sin_renglon`
- `v_egresos_caja`
- `v_empleados_publicos`
- `v_medios_pago_sin_mapear`
- `v_retiros_descuadrados`
- `v_retiros_sin_clasificar`
- `v_ventas_items_oficial`
- `v_ventas_items_sin_catalogo`
- `v_ventas_tickets_oficial`

---

## 2. Las funciones de la base (RPC)

**56 funciones.** De ésas, **13 escriben en más de una tabla**: son
las transaccionales, las que si se cortan por la mitad dejan la base a medio camino.

> La columna **T** marca las transaccionales. **Aplicada** ✅ = su nombre está en la foto del
> esquema real; ❌ = está escrita pero no aparece aplicada.

### 2.1 Costo · Receta · Producción · Stock

⭐ El corazón de la cadena.

| Función | Qué hace | Escribe en | T | Aplicada |
|---|---|---|:-:|:-:|
| `_cocina_fraccion_subreceta` | Calcula qué pedacito de una subreceta usa un renglón que la nombra: lo que pide el padre dividido por lo que la subreceta rinde. | — *solo lee* | — | ✅ |
| `_cocina_norm_nombre` | Limpia un nombre de receta para poder compararlo: lo pasa a minúsculas, le saca el prefijo "Subreceta " y aplasta los espacios repetidos. | — *solo lee* | — | ✅ |
| `cocina_cerrar_masa` | Cierra un lote de masa desde la tablet: anota cuántos kilos sobraron y a dónde fueron. | `cocina_lotes_masa` | — | ✅ |
| `cocina_ingredientes_expandidos` | Arma la lista de lo que hay que pesar para una receta, bajando los renglones que apuntan a una subreceta hasta llegar a los insumos de verdad. | — *solo lee* | — | ✅ |
| `cocina_salidas_de_camara` | Dice qué salió de la cámara en una ventana de tiempo, devolviendo el ID del producto en vez del nombre. | — *solo lee* | — | ✅ |
| `fifo_consumir_camara_pasta` | Reparte una salida de cámara (traspaso, merma o ajuste) entre los lotes más viejos primero, y anota de qué lote salió cada porción. | `cocina_lote_consumos` | — | ✅ |
| `fusionar_producto` | Junta dos productos duplicados del catálogo en uno solo: pasa las recetas y los movimientos del repetido al bueno, le transfiere el stock y borra el repetido. | `cocina_receta_ingredientes`, `movimientos_stock`, `productos` | **Sí** | ✅ |
| `norm_nombre_cocina` | Limpia un nombre para poder compararlo: minúsculas, sin acentos y sin nada que no sea letra o número ("Ñoquis de Papa" queda "noquisdepapa"). | — *solo lee* | — | ✅ |
| `pool_mano_obra_produccion` | Devuelve cuánto se paga por mes en sueldos de la gente de producción y cuántos son, separado por local, para poder repartir ese costo entre las recetas. | — *solo lee* | — | ✅ |
| `porcionar_pasta_lote` | Pasa un lote de pasta del freezer de producción a la cámara, fijando cuántas porciones salieron y a qué hora exacta entró. | `cocina_lotes_pasta`, `cocina_pizarron_items` | **Sí** | ✅ |
| `produccion_mensual_por_receta` | Junta en una sola lista todo lo que se produjo en un mes, sacándolo de las cuatro tablas de lotes distintas que hay. | — *solo lee* | — | ✅ |
| `recalcular_pizarron_para_lote` | Mira los lotes de pasta que salieron de un relleno o de una masa y actualiza en qué etapa está ese renglón del pizarrón (en producción, en bandejas o ciclo completo). | `cocina_pizarron_items` | — | ✅ |
| `recalcular_pizarron_pasta_simple` | Suma las porciones de pasta simple producidas de un producto ese día y marca el renglón del plan como pendiente, en producción o cumplido según llegue o no a lo planificado. | `cocina_pizarron_items` | — | ✅ |
| `recepcionar_mercaderia` | Registra una entrada de mercadería desde el QR: deja la recepción pendiente de que Martín cargue los precios, suma el stock de cada producto y anota el movimiento. | `recepciones_pendientes`, `productos`, `movimientos_stock` | **Sí** | ✅ |
| `registrar_salida_deposito` | Registra que salió mercadería del depósito: baja el stock del producto y anota el movimiento con el motivo. | `productos`, `movimientos_stock` | **Sí** | ✅ |
| `snapshot_inventario_actual` | Saca una foto al instante de cuánta plata hay en stock, separada en alimentos, bebidas e indirectos, para el cierre mensual de inventario. | — *solo lee* | — | ✅ |

<details><summary><b>Las trampas de este grupo (16 funciones tienen una)</b></summary>

**`_cocina_fraccion_subreceta`** — Es pura cuenta, no toca ninguna tabla. Pasa kg/g/lt/ml/oz a kilos (1 litro = 1 kilo, 1 onza = 30 ml) y todo lo demás (unidad, botella, paquete) lo cuenta como porciones. Si falta el rinde que hace falta devuelve NULL, y ese NULL es la señal de "no expandas este renglón". Copia la misma regla que usa el motor de costeo del front (costeoEngine.ts).

*Parámetros:* `(p_cantidad numeric, p_unidad text, p_rend_kg numeric, p_rend_porciones numeric) → numeric` · *Definida en:* `supabase/migrations/174_ingredientes_expandidos_dividen_por_el_rinde.sql`

**`_cocina_norm_nombre`** — 💣 TRAMPA: hay DOS normalizadores de nombre en la base y no hacen lo mismo. Éste conserva los espacios y los acentos; el otro (norm_nombre_cocina) borra acentos y todo lo que no sea letra o número. No son intercambiables. Además es el único del grupo que NO tiene 'set search_path' fijado.

*Parámetros:* `(n text) → text` · *Definida en:* `supabase/migrations/124_cocina_ingredientes_expandidos.sql`

**`cocina_cerrar_masa`** — SECURITY DEFINER con search_path vacío, habilitada para anon (la tablet pública). Existe justamente por la trampa del proyecto: anon no tiene UPDATE sobre cocina_lotes_masa y un UPDATE que la RLS bloquea devuelve 0 filas SIN error — los botones "Cerrar Masa" y "Cargar Panadería" decían que guardaban y no guardaban nada (215 masas quedaron abiertas). Devuelve la fila entera a propósito, para que la pantalla pueda comprobar que el cambio ocurrió. NO es idempotente: si la masa ya estaba cerrada tira error con la fecha y el sobrante anterior. Toca solo dos columnas (kg_sobrante y destino_sobrante), nunca los kilos producidos ni el local. Valida que el sobrante no supere lo producido, con 1 gramo de tolerancia.

*Parámetros:* `(p_lote_id uuid, p_kg_sobrante numeric, p_destino text = null) → fila de cocina_lotes_masa` · *Definida en:* `supabase/migrations/172_cerrar_masa_desde_la_tablet.sql`

**`cocina_ingredientes_expandidos`** — SECURITY DEFINER, de solo lectura, abierta a anon (la usa la tablet). Baja hasta 8 niveles de subreceta y engancha por NOMBRE normalizado + mismo local, no por id: si alguien renombra una subreceta, el enganche se corta en silencio. Si a la subreceta le falta el rinde no la expande y deja el renglón entero a la vista, que es preferible a inventar un número. La versión vieja (mig 124) multiplicaba sin dividir por el rinde y por eso pedía el LOTE ENTERO: llegó a pedir 32 huevos donde iban 2/150 — 155 renglones en 113 recetas activas estaban inflados así.

*Parámetros:* `(p_receta_id uuid) → tabla(id, nombre, cantidad, unidad, producto_id)` · *Definida en:* `supabase/migrations/174_ingredientes_expandidos_dividen_por_el_rinde.sql`

**`cocina_salidas_de_camara`** — SECURITY DEFINER, solo lectura, abierta a anon (la pantalla /mostrador). Engancha en tres pasos y gana el primero: el producto que ya trae el renglón, después cocina_recetas.descuenta_producto_id, y recién al final por nombre. 💣 Los tickets tipo_venta='salon' quedan AFUERA a propósito: esos platos ya se contaron cuando la comanda fue a la cocina, contarlos de nuevo sería duplicarlos. Lo del mostrador y Fudo se cuenta a la hora del ticket; lo del salón, a la hora del envío. NO reemplaza a cocina_ventas_por_producto — esa contesta qué se vendió, ésta qué salió, y no es lo mismo cuando hay mesas. Los platos 'sacados' también cuentan (la pasta se hizo igual).

*Parámetros:* `(p_local text, p_desde timestamptz, p_hasta timestamptz) → tabla(producto_id uuid, cantidad numeric)` · *Definida en:* `supabase/migrations/195_lo_que_sale_de_la_camara.sql`

**`fifo_consumir_camara_pasta`** — SECURITY DEFINER; el hardening le sacó el permiso a anon. 💣 Si no hay stock suficiente en cámara NO falla: reparte lo que puede, deja el resto sin asignar y solo emite un NOTICE que nadie lee. El desfase queda escondido entre el total del producto y el detalle por lote. 💣 Tampoco es idempotente: llamarla dos veces con el mismo origen duplica las imputaciones — por eso los triggers que la usan (traspasos, ajustes y, desde la mig 168, mermas) primero BORRAN las filas anteriores de ese origen y después la vuelven a llamar. No usa FOR UPDATE, así que dos salidas simultáneas del mismo producto pueden consumir el mismo saldo. Solo mira lotes en 'camara_congelado' con fecha anterior o igual a la del consumo. Las 25 mermas históricas nunca se recalcularon.

*Parámetros:* `(p_producto_id uuid, p_local text, p_fecha date, p_cantidad numeric, p_tipo text, p_origen_tabla text, p_origen_id uuid, p_notas text = null) → numeric` · *Definida en:* `supabase/migrations/050_cocina_lote_trazabilidad.sql`

**`fusionar_producto`** — ⚠️ MISMO CASO QUE snapshot_inventario_actual: está APLICADA en producción pero su cuerpo NO ESTÁ en ninguna migración. La única mención en supabase/migrations/ es un ALTER FUNCTION en la 018 que le fija el search_path — o sea, la migración da por sentado que la función ya existe. El código original vive en un archivo suelto (fusionar_productos.sql, carpeta RODZINY IA) que nunca entró al repo. Las tablas que escribe salen de la memoria del proyecto y de lo que devuelve al front (ingredientes_reasignados, movimientos_reasignados, stock_transferido), no de SQL que yo haya podido leer. Es SECURITY DEFINER y BORRA una fila, así que el hardening le sacó el permiso a anon: solo authenticated. 💣 Dos agujeros conocidos si alguna vez se usa: (a) NO repunta gastos.items_json, así que rompe el detector de variaciones de costo y el histórico; (b) exige que los dos productos sean del mismo local, o sea que no sirve para unificar la papa de Vedia con la de Saavedra. Es destructiva y no tiene vuelta atrás.

*Parámetros:* `(p_duplicado_id uuid, p_master_id uuid) → jsonb` · *Definida en:* ``

**`norm_nombre_cocina`** — Es el espejo exacto de la función normNombre() del front (DashboardTab.tsx); si alguien cambia una y no la otra, el pizarrón deja de cruzar el plan con lo producido. 💣 No confundir con _cocina_norm_nombre, que limpia distinto. Tampoco tiene 'set search_path' fijado.

*Parámetros:* `(p_texto text) → text` · *Definida en:* `supabase/migrations/105_pizarron_pasta_simple_cumplido.sql`

**`pool_mano_obra_produccion`** — SECURITY DEFINER y lee sueldos: el hardening le sacó el permiso a anon justamente por eso, solo authenticated. Cuenta al empleado si está activo, no está de baja y tiene marcada la casilla es_produccion. Toma sueldo_neto tal cual está cargado — si alguien no lo tiene cargado, suma cero y el reparto queda corrido sin avisar.

*Parámetros:* `() → tabla(local text, total_sueldos numeric, n_empleados int)` · *Definida en:* `supabase/migrations/061_mano_obra_costeo.sql`

**`porcionar_pasta_lote`** — SECURITY DEFINER, habilitada para anon (el QR de producción). Escribe una sola tabla de forma directa, PERO al cambiar 'ubicacion' dispara el trigger trg_pizarron_lote_pasta_upd, que termina actualizando cocina_pizarron_items: por eso cuenta como transaccional. La hora exacta (porcionado_at) no es un detalle: el stock de cámara se calcula como último conteo + lo porcionado DESPUÉS de ese conteo, así que sin la hora la producción del mismo día del conteo se pierde. Se protege de porcionar dos veces exigiendo que el lote esté en 'freezer_produccion' (si no, tira "Lote no encontrado o ya porcionado"), pero esa verificación es un SELECT sin FOR UPDATE: dos tablets a la vez podrían pasar las dos.

*Parámetros:* `(p_lote_id uuid, p_porciones integer, p_responsable text = null, p_sobrante_gramos numeric = null, p_sobrante_origen_lote_id uuid = null, p_merma_porcionado integer = 0, p_notas text = null) → void` · *Definida en:* `supabase/migrations/108_camara_baseline_porcionado.sql`

**`produccion_mensual_por_receta`** — SECURITY DEFINER, sin permiso para anon. 💣 Las cantidades vienen en unidades DISTINTAS y no se pueden sumar entre sí: relleno y masa en kilos, la producción genérica en su unidad nativa, y la pasta en porciones. Sirve solo para repartir el pool de sueldos DENTRO de cada receta, nunca para comparar recetas entre sí. La pasta llega por un rodeo (cocina_lotes_pasta → cocina_productos.receta_id), así que un producto sin receta vinculada no aparece.

*Parámetros:* `(p_periodo text, formato 'YYYY-MM') → tabla(receta_id uuid, local text, cantidad numeric, unidad text)` · *Definida en:* `supabase/migrations/061_mano_obra_costeo.sql`

**`recalcular_pizarron_para_lote`** — SECURITY DEFINER; el hardening le sacó el permiso a anon (la llaman los triggers, no la pantalla). Solo entiende tipo 'relleno' o 'masa': cualquier otra cosa se va sin hacer nada. Primero busca el renglón del plan con la fecha exacta; si no lo encuentra, agarra el renglón abierto MÁS VIEJO de los últimos 7 días (eso es el "carry-over": lo que se planificó el martes y se produjo el jueves igual se marca). 💣 Si hay dos renglones iguales abiertos, marca uno solo. Cuando el ciclo se completa borra completado_en si vuelve para atrás, así que reeditar un lote puede desmarcar un renglón ya cerrado.

*Parámetros:* `(p_tipo text, p_lote_id uuid, p_receta_id uuid, p_local text, p_fecha date) → void` · *Definida en:* `supabase/migrations/049_pizarron_carry_over_lotes.sql`

**`recalcular_pizarron_pasta_simple`** — SECURITY DEFINER. La llaman los triggers de alta, edición y baja de cocina_lotes_pasta. 💣 Engancha el renglón del plan por NOMBRE normalizado contra texto_libre (la pasta simple se planifica escribiendo el nombre a mano, sin receta_id): si alguien escribe el nombre distinto, el plan no se descuenta nunca y queda en 'pendiente' para siempre. 💣 El cruce es por FECHA EXACTA: producir el jueves lo planificado para el martes no marca nada (a diferencia de recalcular_pizarron_para_lote, ésta NO tiene el carry-over de 7 días). Recalcula de cero cada vez, así que es idempotente.

*Parámetros:* `(p_producto_id uuid, p_local text, p_fecha date) → void` · *Definida en:* `supabase/migrations/105_pizarron_pasta_simple_cumplido.sql`

**`recepcionar_mercaderia`** — SECURITY DEFINER, habilitada para anon (el QR público). Escribe TRES tablas: si quedara a medias, entraría la recepción sin sumar el stock o al revés. Existe porque el hardening le sacó a anon el UPDATE sobre productos y el QR sumaba stock en silencio sin sumar nada (0 filas, cero error). Bloquea la fila del producto con FOR UPDATE para no perder sumas si dos personas reciben lo mismo al mismo tiempo. Valida que el producto sea del local que recibe y que la cantidad sea mayor a cero. 💣 A diferencia de la salida de depósito, acá NO hay tope por cantidad: se puede cargar cualquier número sin que nada frene.

*Parámetros:* `(p_local text, p_items jsonb, p_registrado_por text, p_foto_path text = null, p_notas text = null) → uuid` · *Definida en:* `supabase/migrations/102_recepcionar_mercaderia_rpc.sql`

**`registrar_salida_deposito`** — SECURITY DEFINER, habilitada para anon (el QR /deposito). Bloquea la fila con FOR UPDATE. Tiene un TOPE por carga que frena el número imposible: 1.000 en kg, 1.000 en litros, 5.000 en el resto — calibrado contra 5.145 salidas reales, frena 23 y las 23 son errores de verdad (74.000 kg de cuadril, 9.415 de jamón), cero falsos positivos en cinco meses. El stock nunca baja de cero (regla del negocio), pero lo que el piso se come ya no se evapora: queda anotado en movimientos_stock.cantidad_sin_stock. Antes de la mig 182 el papel decía que salieron 4.300 kg y el stock bajaba solo lo que había, y la diferencia desaparecía. 84 de 390 insumos activos están en 0,00 y siguen registrando salidas.

*Parámetros:* `(p_local text, p_producto_id uuid, p_cantidad numeric, p_motivo text = null, p_observacion text = null, p_registrado_por text = null) → numeric` · *Definida en:* `supabase/migrations/182_el_deposito_deja_de_tragarse_los_errores.sql`

**`snapshot_inventario_actual`** — ⚠️ AL REVÉS DEL CASO DE LA MIGRACIÓN 072: esta función ESTÁ APLICADA en producción (aparece en supabase/esquema-aplicado.sql) pero su código NO EXISTE en ninguna de las 207 migraciones. Alguien la creó a mano contra la base y nunca la versionó. Si mañana hay que levantar la base de cero desde las migraciones, esta función no está y el modal de Cierre de Inventario (src/modules/compras/components/CierreInventarioModal.tsx) se rompe. No pude leerle el cuerpo, así que las tablas que lee y las notas salen de la memoria del proyecto y del front que la llama, no del SQL. Agrupa por categorias_gasto.tipo_edr (cmv_alimentos / cmv_bebidas / cmv_indirectos) y cuenta aparte los productos con stock pero sin categoría asignada. La usa el EdR para calcular el CMV real = compras − variación de inventario.

*Parámetros:* `(p_local text) → tabla(monto_alimentos, monto_bebidas, monto_indirectos, productos_sin_clasificar, valor_sin_clasificar)` · *Definida en:* ``

</details>

### 2.2 Venta · Caja · Salón · Fichaje

⭐ El final de la cadena.

| Función | Qué hace | Escribe en | T | Aplicada |
|---|---|---|:-:|:-:|
| `cobrar_venta` | Guarda una venta entera de una sola vez: el ticket, cada renglon (las pastas y las salsas que cuelgan de ellas) y los cobros, y devuelve el numero de ticket. | `ventas_tickets`, `ventas_items`, `ventas_pagos` | **Sí** | ✅ |
| `cocina_tickets_por_dia_semana` | Cuenta cuantos tickets hubo en cada dia de la semana dentro de una ventana, para saber si manana se vende mas o menos que el promedio. | — *solo lee* | — | ✅ |
| `cocina_ventas_por_producto` | Devuelve el ranking de lo que se vendio por producto en una ventana de tiempo, en cantidades y sin plata. | — *solo lee* | — | ✅ |
| `fichaje_login` | Deja entrar a la pantalla de fichaje comparando DNI y PIN adentro de la base, y devuelve solo los datos publicos de la persona. | — *solo lee* | — | ✅ |
| `fichaje_sesion` | Retoma la sesion que la tablet de fichaje se guardo, para no pedir el PIN en cada pantalla. | — *solo lee* | — | ✅ |
| `salon_abrir_mesa` | Abre una mesa del salon con la cantidad de gente que se sento y devuelve el numero de esa sesion. | `caja_mesa_sesiones` | — | ✅ |
| `salon_agregar_linea` | Suma un plato al borrador de una mesa abierta, con el precio que dice la carta de esa casa en ese momento. | `caja_mesa_lineas` | — | ✅ |
| `salon_anular_sesion` | Anula una mesa que se abrio por error, siempre y cuando no se haya cobrado ni un solo plato. | `caja_mesa_lineas`, `caja_mesa_sesiones` | **Sí** | ✅ |
| `salon_cobrar_mesa` | Convierte una mesa del salon en una venta cobrada: arma los renglones desde la mesa, los cobra y despues marca cada plato con el ticket que se lo llevo. | `ventas_tickets`, `ventas_items`, `ventas_pagos`, `caja_mesa_lineas`, `caja_mesa_sesiones` | **Sí** | ✅ |
| `salon_enviar_a_cocina` | Manda a la cocina todo lo que hay cargado en la mesa y todavia no se envio, y devuelve el numero de comanda. | `caja_mesa_envios`, `caja_mesa_lineas` | **Sí** | ✅ |
| `salon_pedir_la_cuenta` | Marca que en esa mesa pidieron la cuenta, para que el mostrador la vea lista para cobrar. | `caja_mesa_sesiones` | — | ✅ |
| `salon_sacar_linea` | Saca un plato de la mesa dejando constancia de quien lo saco, cuando y por que: no lo borra. | `caja_mesa_lineas` | — | ✅ |
| `ticket_pos_sin_cobros` | Contesta si un ticket todavia no tiene ningun cobro anotado. | — *solo lee* | — | ✅ |
| `ticket_sin_comprobante` | Contesta si a un ticket todavia no se le emitio ninguna factura. | — *solo lee* | — | ✅ |
| `venta_descuento_de_linea` | Calcula cuanta plata se bonifica en un renglon de venta a partir del importe bruto y el porcentaje de descuento. | — *solo lee* | — | ✅ |

<details><summary><b>Las trampas de este grupo (15 funciones tienen una)</b></summary>

**`cobrar_venta`** — NO es SECURITY DEFINER, y esta puesto a proposito: si lo fuera apagaria la RLS de toda la base y el cajero de Vedia podria cobrar en Saavedra (la migracion trae un guardarrail que revienta si alguien la deja definer). Prende la marca de sesion rodziny.cobro: sin esa marca las tres reglas de escritura de ventas_tickets, ventas_items y ventas_pagos rechazan la fila, o sea que es la unica puerta para cobrar. Traba el turno con FOR SHARE para que no se cierre la caja en el medio. Es idempotente: guarda una huella md5 (turno + renglones + cobros) junto a la llave de intento, asi que un reintento del mismo cobro devuelve el ticket viejo con ya_estaba=true en vez de cobrar dos veces; si llega la misma llave con OTRA venta adentro, corta. Reintenta dos vueltas por si otra pantalla gano la carrera. Rehace TODAS las cuentas (no le cree al navegador) y exige que los cobros cierren exacto con el total, sin tolerancia. Cuenta las filas de cada insert y revienta si falta alguna. Cada renglon pasa ademas por el candado trg_ventas_items_z_precio_de_la_carta (mig 192/193), que frena la venta si el precio no coincide con la carta. La ejecuta solo un usuario con sesion (anon no puede).

*Parámetros:* `(p_idempotencia uuid, p_local text, p_caja text, p_turno_id uuid, p_fecha date, p_hora time, p_cliente text, p_convenio_id uuid, p_lineas jsonb, p_pagos jsonb, p_tipo_venta text = 'mostrador')` · *Definida en:* `supabase/migrations/189_cobrar_es_una_sola_transaccion.sql`

**`cocina_tickets_por_dia_semana`** — SECURITY DEFINER y ejecutable por la clave PUBLICA (anon), sin ningun importe. Alimenta el factor de dia de semana del plan de produccion. Mismo baile de fechas que cocina_ventas_por_producto: recorte grueso de un dia para cada lado y despues corte exacto por hora Argentina. El dia de semana lo saca de la fecha del ticket (0 = domingo). No escribe nada.

*Parámetros:* `(p_local text, p_desde timestamptz, p_hasta timestamptz) returns table(dia_semana int, tickets bigint)` · *Definida en:* `supabase/migrations/184_cocina_lee_las_ventas_de_nuestra_base.sql`

**`cocina_ventas_por_producto`** — SECURITY DEFINER y ejecutable por la clave PUBLICA (anon): por eso devuelve nombre y cantidad y NADA de importes. Reemplazo a la Edge Function fudo-productos. Agrupa por NOMBRE de texto, no por id de receta: dos escrituras distintas del mismo plato salen como dos renglones. Trabaja en hora Argentina y por eso abre la ventana un dia para cada lado (para entrar por el indice) y despues corta fino por hora: una venta de las 23:50 del dia anterior puede caer dentro de lo pedido. Toma lo importado de Fudo y lo del POS por igual. La migracion 195 dice explicitamente que NO se la reemplaza: contesta que se VENDIO, no que salio de la camara.

*Parámetros:* `(p_local text, p_desde timestamptz, p_hasta timestamptz) returns table(nombre text, cantidad numeric)` · *Definida en:* `supabase/migrations/184_cocina_lee_las_ventas_de_nuestra_base.sql`

**`fichaje_login`** — SECURITY DEFINER y ejecutable por la clave PUBLICA (anon): es la unica forma de que la tablet fiche sin login. El PIN se compara aca adentro y nunca sale de la base. Si falla devuelve cero filas sin decir si el que estaba mal era el DNI o el PIN, para que nadie pueda probar DNIs y averiguar cuales existen. Compara con btrim, y por eso la migracion 199 le puso a la columna del PIN un candado de exactamente 4 digitos sin espacios: sin eso ' 123' y '123 ' se confundirian. Solo trae gente activa y con PIN cargado. Las migraciones 186 y 199 traen guardarrailes que revientan si anon pierde el permiso de ejecutarla, porque ahi nadie podria fichar.

*Parámetros:* `(p_dni text, p_pin text) returns table(id, nombre, apellido, local, horario_tipo, horas_semanales_requeridas)` · *Definida en:* `supabase/migrations/185_los_sueldos_dejan_de_estar_a_la_vista.sql`

**`fichaje_sesion`** — SECURITY DEFINER y ejecutable por la clave PUBLICA (anon). Alcanza con tener el uuid de la persona: no pide PIN. El razonamiento es que el uuid no se puede adivinar y que lo que devuelve no es sensible (ni DNI, ni sueldo, ni CBU, ni PIN). Solo trae gente activa. No escribe nada.

*Parámetros:* `(p_id uuid) returns table(id, nombre, apellido, local, horario_tipo, horas_semanales_requeridas)` · *Definida en:* `supabase/migrations/185_los_sueldos_dejan_de_estar_a_la_vista.sql`

**`salon_abrir_mesa`** — Corre con los permisos del que llama (no es definer). Prende la marca rodziny.salon: sin ella la regla de escritura no deja entrar la fila, o sea que nadie puede abrir una mesa a mano desde la consola. El local que se manda ('x') es de mentira: lo pisa el disparador caja_salon_sella_local, que lo saca de la mesa. Si la mesa ya esta ocupada el choque de la clave unica se convierte en un mensaje entendible. Solo usuarios con sesion.

*Parámetros:* `(p_mesa_id uuid, p_comensales int) returns uuid` · *Definida en:* `supabase/migrations/190_las_mesas_del_salon.sql`

**`salon_agregar_linea`** — El precio NUNCA viene del telefono del mozo: lo busca en la carta del local de la mesa, y si el plato no esta o esta en cero, corta. Prende la marca rodziny.salon. El local lo sella el disparador. TRAMPA: el numero de renglon se calcula con max(linea)+1 sin trabar nada, y la tabla tiene clave unica por (sesion_id, linea) — si dos mozos cargan un plato en la misma mesa en el mismo segundo, uno de los dos se come un error crudo de Postgres, porque aca ese choque no se atrapa como si se atrapa en salon_abrir_mesa. Solo usuarios con sesion.

*Parámetros:* `(p_sesion_id uuid, p_receta_id uuid, p_cantidad numeric, p_padre_id uuid = null, p_descuento_pct numeric = 0)` · *Definida en:* `supabase/migrations/190_las_mesas_del_salon.sql`

**`salon_anular_sesion`** — Escribe en DOS tablas: primero marca todos los platos como sacados y despues cierra la mesa como anulada. A medias quedaria una mesa abierta con todos los platos sacados. Exige motivo escrito y se niega si algun renglon ya tiene ticket (eso lo anula un administrador desde Ventas). Prende la marca rodziny.salon. TRAMPA: ninguno de los dos UPDATE cuenta las filas que toco. Solo usuarios con sesion.

*Parámetros:* `(p_sesion_id uuid, p_motivo text) returns void` · *Definida en:* `supabase/migrations/190_las_mesas_del_salon.sql`

**`salon_cobrar_mesa`** — Escribe en CINCO tablas: las tres de venta se las delega a cobrar_venta (mig 189) y despues marca los renglones de la mesa y la cierra. La llama el MOSTRADOR, no el telefono del mozo. No es definer, igual que cobrar_venta. 💣 La marca rodziny.salon va ANTES de leer la mesa, no despues: el SELECT ... FOR UPDATE le exige a la fila pasar tambien la regla de ESCRITURA, y sin la marca la consulta no devuelve nada y la funcion contesta 'esa mesa no existe' con la mesa ahi adelante — costo encontrarlo. Traba la sesion con FOR UPDATE para que dos cajeros no cobren la misma mesa a la vez. Prende ademas rodziny.salon_cobro, que le dice al candado del precio que acepte el precio que la base le puso al plato cuando el mozo lo cargo, en vez de la carta de hoy. Si la salsa quedo huerfana porque le sacaron la pasta, la cobra suelta. Si cobra pero no logra enganchar la mesa, corta todo. Esta funcion SI cuenta las filas de sus dos UPDATE. Solo usuarios con sesion.

*Parámetros:* `(p_idempotencia uuid, p_sesion_id uuid, p_turno_id uuid, p_caja text, p_fecha date, p_hora time, p_pagos jsonb, p_cliente text = null, p_convenio_id uuid = null)` · *Definida en:* `supabase/migrations/193_cobrar_la_mesa.sql`

**`salon_enviar_a_cocina`** — Escribe en DOS tablas: crea la comanda y despues le pega cada renglon suelto. Si quedara a medias habria una comanda vacia o platos apuntando a una comanda que no existe. Numera las comandas con max(numero)+1 sin trabar, y la tabla tiene clave unica por (sesion_id, numero): dos envios simultaneos de la misma mesa chocan con error crudo. No cuenta las filas del UPDATE que engancha los renglones. Prende la marca rodziny.salon. Corre con los permisos del que llama. Solo usuarios con sesion.

*Parámetros:* `(p_sesion_id uuid) returns uuid` · *Definida en:* `supabase/migrations/190_las_mesas_del_salon.sql`

**`salon_pedir_la_cuenta`** — Es idempotente a proposito: apretarlo dos veces no es un error, sale sin hacer nada. No deja pedir la cuenta si quedan platos sin mandar a la cocina. Prende la marca rodziny.salon. TRAMPA: no cuenta las filas del UPDATE. Solo usuarios con sesion.

*Parámetros:* `(p_sesion_id uuid) returns void` · *Definida en:* `supabase/migrations/190_las_mesas_del_salon.sql`

**`salon_sacar_linea`** — No borra nada: marca el renglon como 'sacada' (decision de Lucas, 8-sep-2026). No deja sacar un plato que ya se cobro ni uno de una mesa cerrada. Prende la marca rodziny.salon. TRAMPA: hace el UPDATE y NO cuenta las filas que toco — si la regla de fila lo bloqueara, la funcion terminaria bien y no sacaria nada, que es exactamente lo que la regla del proyecto pide evitar. Solo usuarios con sesion.

*Parámetros:* `(p_linea_id uuid, p_motivo text = null) returns void` · *Definida en:* `supabase/migrations/190_las_mesas_del_salon.sql`

**`ticket_pos_sin_cobros`** — Es SECURITY DEFINER a proposito: si la pregunta se hiciera con los permisos del cajero, un cambio futuro en las reglas de ventas_pagos podria esconderle un cobro y hacerle creer que el ticket esta vacio, o sea volver a habilitarle el borrado sin que nadie se entere. No escribe nada. La usa la regla que le deja al cajero deshacer un cobro que fallo a mitad de camino. Solo usuarios con sesion.

*Parámetros:* `(p_ticket uuid) returns boolean` · *Definida en:* `supabase/migrations/151_caja_no_borra_ventas.sql`

**`ticket_sin_comprobante`** — SECURITY DEFINER, no escribe nada. Complementa a ticket_pos_sin_cobros en la regla de borrado: una venta facturada no se borra. La clave foranea ya lo impediria, pero con un error feo; esto lo frena antes y con un mensaje entendible. Sigue en uso en las migraciones 187 y 196. Solo usuarios con sesion.

*Parámetros:* `(p_ticket uuid) returns boolean` · *Definida en:* `supabase/migrations/154_facturacion_arca.sql`

**`venta_descuento_de_linea`** — No toca ninguna tabla: es pura cuenta (SQL immutable). Existe suelta a proposito, porque el total del ticket y el total de cada renglon se calculan en dos lugares distintos y con la formula escrita dos veces el dia que alguien tocara una sola el ticket dejaria de cerrar con sus lineas. El redondeo va sobre el producto y despues divide por 100, igual que la pantalla del POS. Solo la puede ejecutar un usuario con sesion.

*Parámetros:* `(p_bruto numeric, p_pct numeric) returns numeric` · *Definida en:* `supabase/migrations/189_cobrar_es_una_sola_transaccion.sql`

</details>

### 2.3 Finanzas · Conciliación · Estado de Resultados

| Función | Qué hace | Escribe en | T | Aplicada |
|---|---|---|:-:|:-:|
| `amort_resumen_anual` | NO ENCONTRADA en las migraciones | — *solo lee* | — | ✅ |
| `aplicar_reglas_sugerencia` | Le pone una etiqueta automatica (comision, IVA bancario, impuesto al debito, retencion MP, intereses) a los movimientos del extracto que todavia no tienen ninguna, para despues poder agruparlos. | `movimientos_bancarios` | — | ✅ |
| `auto_match_gastos_extracto` | NO ENCONTRADA en las migraciones | — *solo lee* | — | ✅ |
| `buscar_proveedor_por_texto` | Le pasas un texto suelto (de una factura o del extracto) y te devuelve los 5 proveedores que mas se le parecen, con un puntaje de 0 a 100. | — *solo lee* | — | ✅ |
| `concepto_canonico_cargo` | Devuelve siempre el texto 'Gastos bancarios', sin mirar lo que le pasan, para que todos los cargos del banco terminen en una sola linea. | — *solo lee* | — | ✅ |
| `conciliados_resumen_por_gasto` | Cuenta y suma, en el servidor, cuantos movimientos del banco quedaron pegados a cada gasto en un rango de fechas. | — *solo lee* | — | ✅ |
| `conciliar_adelantos` | Engancha los adelantos pagados por transferencia con el movimiento del banco que les corresponde. | `adelantos` | — | ✅ |
| `conciliar_dividendos` | Engancha los dividendos pagados por transferencia con el movimiento del banco que les corresponde. | `dividendos` | — | ✅ |
| `conciliar_pagos_consolidados` | Cuando UNA transferencia paga VARIOS gastos de golpe, agrupa esos pagos por N° de operacion y los pega todos al mismo movimiento del banco. | `pagos_gastos`, `movimientos_bancarios` | **Sí** | ✅ |
| `conciliar_sueldos_consolidados` | Igual que la de gastos pero para sueldos: una transferencia que le paga a varios empleados se pega a todos esos pagos juntos. | `pagos_sueldos` | — | ✅ |
| `crear_cargos_automaticos_bancarios` | Junta todos los cargos del banco de un mes (comisiones, IVA, impuestos, retenciones) en UN solo gasto por banco y les pega los movimientos. | `gastos`, `movimientos_bancarios` | **Sí** | ✅ |
| `edr_renglon_de_gasto` | Dice en que renglon del Estado de Resultados cae un gasto segun su categoria y subcategoria; lo que no encaja cae en 'sin_clasificar'. | — *solo lee* | — | ✅ |
| `edr_resumen_gastos` | Devuelve los gastos de un local y un año, mes por mes, ya repartidos en los renglones del Estado de Resultados. | — *solo lee* | — | ✅ |
| `edr_resumen_ventas` | Devuelve las ventas de un local y un año, mes por mes: facturacion bruta, IVA debito y cantidad de tickets. | — *solo lee* | — | ✅ |
| `fusionar_proveedores` | Junta dos proveedores duplicados en uno solo: le pasa todos los gastos al que queda, le hereda los nombres y CUITs del otro, y borra el repetido. | `gastos`, `proveedores` | **Sí** | ✅ |
| `resincronizar_medios_pago` | Repara el historico de once tablas despues de agregar un alias nuevo al diccionario de medios de pago, sin pisar nunca una cuenta ya cargada. | `gastos`, `pagos_gastos`, `pagos_fijos`, `adelantos`, `aguinaldos`, `dividendos`, `pagos_sueldos`, `ventas_tickets`, `ventas_pagos`, `liquidaciones_quincenales`, `almacen_pedidos` | **Sí** | ✅ |

<details><summary><b>Las trampas de este grupo (16 funciones tienen una)</b></summary>

**`amort_resumen_anual`** — ⚠️ Existe en la base (esquema-aplicado.sql linea 1858) y la tabla amortizaciones tambien, pero su CUERPO no esta en ninguna migracion. Lo unico que aparece es la migracion 018_rls_blindar_cocina_y_misc.sql linea 143, que le fija el search_path con un ALTER FUNCTION — o sea que la 018 da por hecho que la funcion YA existia. Se creo a mano en produccion antes de que existiera la carpeta de migraciones y nunca se versiono. Por la firma se entiende que devuelve la amortizacion total por mes de un local y un año, para el EdR, pero eso es deduccion: el codigo real no esta en git. Si se pierde la base, no se puede reconstruir.

*Parámetros:* `(p_local text, p_anio text) → tabla(periodo, total_amort)` · *Definida en:* ``

**`aplicar_reglas_sugerencia`** — Vale la 091 (la 088 es la version vieja). Es repetible sin romper nada: solo toca filas con sugerencia vacia, con debito > 0 y que no sean transferencia interna, asi que correrla dos veces no pisa lo ya etiquetado. La 091 agrego que en Galicia/ICBC mire tambien la columna 'referencia', porque el ICBC pone el concepto real ahi y en la descripcion deja un codigo tipo '0001'. Cuida a proposito de NO tocar egresos reales (AFIP, echeqs, pago de servicios). No es SECURITY DEFINER.

*Parámetros:* `() → jsonb` · *Definida en:* `supabase/migrations/091_reglas_sugerencia_referencia_icbc.sql`

**`auto_match_gastos_extracto`** — ⚠️ Existe en la base (esquema-aplicado.sql linea 1867) pero su cuerpo NO esta en ningun .sql de supabase/migrations. Se creo a mano en produccion y nunca se versiono. La llama el frontend en src/modules/gastos/ImportarExtractoModal.tsx (linea 129) y en src/modules/compras/ConciliacionTab.tsx, justo antes de conciliar_pagos_consolidados, para enganchar movimientos del extracto con gastos cargados a mano por N° de operacion. Como no esta en git, nadie puede leerla, revisarla ni reconstruir la base desde cero: hay que bajarla de prod y versionarla.

*Parámetros:* `(p_fecha_desde date default null, p_fecha_hasta date default null) → jsonb` · *Definida en:* ``

**`buscar_proveedor_por_texto`** — Vale la 131 (la 127 es la anterior). Solo lee, no escribe. Solo mira proveedores activos y devuelve como maximo 5. La 131 arreglo que el CUIT se compare digito contra digito, asi el guion ya no bloquea el match (antes '30-71206276-9' no encontraba a '30712062769'). 💣 Trampa que sigue viva y esta documentada en la propia 127: los alias matchean por pedazo de texto en los dos sentidos, asi que un alias corto y generico (ej. 'ICBC') da falsos positivos con puntaje 70. Tampoco normaliza acentos ni puntuacion: 'S.A.' no es lo mismo que 'SA'. Anon tiene el permiso revocado; solo usuarios logueados.

*Parámetros:* `(p_texto text) → tabla(id, razon_social, nombre_comercial, cuit, score)` · *Definida en:* `supabase/migrations/131_proveedores_cuit_normalizado.sql`

**`concepto_canonico_cargo`** — 💣 TRAMPA GORDA: el parametro p_texto se ignora por completo. El cuerpo entero es 'SELECT ''Gastos bancarios''::text'. Fue una decision a proposito de la 090 para que impuestos, IVA, percepciones, comisiones, retenciones y sellos caigan todos en un unico gasto por banco y mes, en vez de una linea por tipo. Como devuelve siempre lo mismo, el filtro de crear_cargos_automaticos_bancarios que compara 'concepto del gasto = concepto del movimiento' hoy da verdadero SIEMPRE: no discrimina nada. La 090 aclara que en prod, una sola vez, se desvincularon a mano los cargos consolidados viejos, se borraron y se regeneraron. No lee ni escribe nada, es IMMUTABLE.

*Parámetros:* `(p_texto text) → text` · *Definida en:* `supabase/migrations/090_cargos_bancarios_una_linea.sql`

**`conciliados_resumen_por_gasto`** — Solo lee. Existe justamente para esquivar el corte de filas del cliente: los cargos consolidados de MercadoPago tienen miles de movimientos y el navegador solo se traia 2000, asi que el total salia incompleto y el panel mostraba una alerta de desfase que era mentira. Acepta 'todos' como cuenta para no filtrar.

*Parámetros:* `(p_desde date, p_hasta date, p_cuenta text default null) → tabla(gasto_id, n_movs, total_debito)` · *Definida en:* `supabase/migrations/087_conciliados_resumen_por_gasto.sql`

**`conciliar_adelantos`** — Copia calcada de conciliar_dividendos. Trabaja en dos pasadas: primero por N° de operacion (exige 6 digitos o mas), y despues, para los que quedaron sueltos, por monto + fecha (±3 dias) + banco, pero SOLO si hay un unico movimiento candidato libre. Es repetible: solo toca adelantos con la conciliacion vacia. 💣 No usa bloqueo (sin FOR UPDATE): si dos personas la corren al mismo tiempo, las dos pueden agarrar el mismo movimiento. 💣 La segunda pasada chequea que el movimiento no este tomado por otro adelanto ni por un dividendo, pero NO chequea sueldos ni pagos de gastos. No es SECURITY DEFINER.

*Parámetros:* `(p_desde date, p_hasta date) → jsonb` · *Definida en:* `supabase/migrations/103_adelantos_comprobante_y_conciliacion.sql`

**`conciliar_dividendos`** — La 103, la 137 y la 138 la nombran solo en comentarios; la definicion buena sigue siendo la de la 089. Misma mecanica que conciliar_adelantos: primero por N° de operacion y despues por monto + fecha (±3 dias) + banco cuando hay un unico candidato libre (ese es el caso MP-a-MP, que entra como 'VAR' sin numero). Solo toma dividendos con medio de pago que empiece con 'transferencia': deja afuera los automaticos de Fudo / MP Lucas. Es repetible. 💣 Sin bloqueo (no hay FOR UPDATE) y la segunda pasada solo se fija en otros dividendos, no en adelantos, sueldos ni gastos. La migracion agrega ademas la columna dividendos.conciliado_movimiento_id.

*Parámetros:* `(p_desde date, p_hasta date) → jsonb` · *Definida en:* `supabase/migrations/089_conciliar_dividendos.sql`

**`conciliar_pagos_consolidados`** — Escribe en DOS tablas: primero marca los pagos (pagos_gastos.conciliado_movimiento_id) y despues pega el movimiento al primer gasto del grupo (movimientos_bancarios.gasto_id) para que el Retiro no siga apareciendo en 'Movimientos por procesar'. Si queda a medias, el pago figura conciliado pero el movimiento sigue suelto. Lo que evita falsos positivos es que la SUMA del grupo tiene que dar igual al debito (tolerancia de $1): el 'Impuesto al debito' comparte los digitos de operacion pero no el monto. Si empatan dos movimientos, gana el que dice 'Retiro MP'. 💣 El segundo UPDATE NO respeta el rango de fechas que le pasaste: barre TODOS los pagos ya conciliados de la historia, no solo los del periodo. No es SECURITY DEFINER y no usa bloqueos.

*Parámetros:* `(p_fecha_desde date, p_fecha_hasta date) → jsonb` · *Definida en:* `supabase/migrations/084_conciliar_pagos_consolidados.sql`

**`conciliar_sueldos_consolidados`** — Agrupa por N° de operacion Y banco (a diferencia de la de gastos, que agrupa solo por operacion). Exige medio de pago 'transferencia' y 6 digitos o mas de operacion, y que la suma del grupo coincida con el debito con tolerancia de $1. A diferencia de conciliar_pagos_consolidados, esta NO toca movimientos_bancarios: el movimiento del banco queda igual sin pegarse a ningun gasto. Es repetible. No es SECURITY DEFINER.

*Parámetros:* `(p_fecha_desde date, p_fecha_hasta date) → jsonb` · *Definida en:* `supabase/migrations/086_conciliar_sueldos_consolidados.sql`

**`crear_cargos_automaticos_bancarios`** — Vale la 116 (la 092 es la anterior, la 090 es de donde sale concepto_canonico_cargo). Escribe en DOS tablas: crea o actualiza el gasto y despues marca los movimientos con ese gasto_id; si queda a medias, el gasto existe con un importe que no coincide con los movimientos pegados. Si el gasto del mes ya existe, le SUMA el importe en vez de pisarlo, asi que no se puede correr dos veces sobre los mismos movimientos... pero como solo agarra movimientos con gasto_id vacio, en la practica no duplica. La 116 agrego que el medio de pago se deduzca solo del banco de origen (mercadopago→transferencia_mp, galicia→transferencia_galicia, icbc→transferencia_icbc). 💣 Tiene clavados adentro el local ('sas'), la categoria ('Impuestos y Tasas') y la subcategoria. Al insertar en gastos se dispara el trigger trg_medio_pago (mig 138), que completa medio_pago_id y cuenta en la misma fila, no en otra tabla. No es SECURITY DEFINER y no usa bloqueos. La 116 trae ademas un backfill que arregla los cargos viejos que habian quedado sin medio de pago.

*Parámetros:* `(p_categoria_id uuid, p_creado_por text default null, p_fecha_desde date default null, p_fecha_hasta date default null) → jsonb` · *Definida en:* `supabase/migrations/116_autodeteccion_medio_cargos_bancarios.sql`

**`edr_renglon_de_gasto`** — La 167 la usa pero no la redefine: la definicion buena es la de la 166. No lee ni escribe nada (IMMUTABLE), es pura cuenta de texto: saca acentos, pasa a minusculas y decide. Es EL unico lugar donde vive esa regla: la usan edr_resumen_gastos y la vista v_edr_gastos_sin_renglon. Para sumar una categoria nueva al EdR se toca aca y nada mas. Dos decisiones de negocio metidas adentro: la regularizacion ARCA sale de Impuestos y va al resultado financiero, y la Bienal 2026 tiene renglon propio abajo del EBIT (decision de Lucas del 3-sep-2026).

*Parámetros:* `(p_categoria text, p_subcategoria text) → text` · *Definida en:* `supabase/migrations/166_renglon_del_edr_una_sola_definicion.sql`

**`edr_resumen_gastos`** — Vale la 167 (antes: 018, 048, 110, 165, 166). Solo lee. 💰 La 167 arreglo un agujero de plata: antes usaba coalesce(importe_neto, importe_total), y como el formulario guardaba CERO cuando el campo quedaba vacio, coalesce no rescata un cero y esos gastos entraban al EdR valiendo $0. Medido el 3-sep-2026: 76 gastos de 2026 por $14.761.906 figuraban cargados y no sumaban nada. Ahora usa nullif(importe_neto, 0) — un neto en cero se trata como 'no cargado' y vale el total. Por construccion la suma de los renglones da igual al total_gastos. Filtra cancelado = false y periodo del año pedido. La misma migracion crea dos vistas de control: v_edr_gastos_sin_renglon (lo que quedo sin clasificar) y v_edr_gastos_invisibles (gastos sin local o con un local que no existe, que no aparecen en ningun EdR).

*Parámetros:* `(p_local text, p_anio text) → tabla(periodo, cmv_alimentos, cmv_bebidas, cmv_indirectos, gastos_op, gastos_rrhh, impuestos_op, inversiones, intereses, sueldos, cargas_sociales, arca, rrhh_otros, aguinaldo, bienal, sin_clasificar, total_gastos)` · *Definida en:* `supabase/migrations/167_edr_neto_en_cero_no_es_gratis.sql`

**`edr_resumen_ventas`** — Vale la 198 (antes: 018, 142; la 157 solo la nombra en un comentario). Solo lee. 💣 Lo que arreglo: tenia clavado adentro origen = 'fudo', asi que el EdR no contaba un peso de lo que cobra nuestra propia caja. La migracion 188 saco ese filtro de ocho lugares del codigo y este quedo afuera porque vive en la base, no en una pantalla. El dia que Saavedra cortara a POS, sus ventas en el EdR se iban a CERO y el EdR no protesta: mostraba un mes con todos los costos y sin ingresos. Ahora lee v_ventas_tickets_oficial, que resuelve por local cual es el origen que vale. Sigue siendo security invoker (NO definer): el que la llama tiene que poder leer los tickets con sus propios permisos. Deja afuera los tickets Cancelada, Eliminada y los marcados como dividendo. La migracion trae un guardarrail que verifica que hoy los numeros no se muevan ni un peso y que no quede ninguna otra funcion con 'origen = fudo' escrito adentro.

*Parámetros:* `(p_local text, p_anio text) → tabla(periodo, ing_bruto, iva_debito, ticket_count)` · *Definida en:* `supabase/migrations/198_el_edr_cuenta_las_ventas_del_pos.sql`

**`fusionar_proveedores`** — Escribe en DOS tablas y hace cuatro pasos que dependen uno del otro: re-apunta los gastos, junta alias y CUITs alternativos, hereda CUIT y nombre comercial si faltaban, y recien ahi BORRA el duplicado. Si quedara a medias, o se pierden gastos apuntando a un proveedor que ya no existe, o el que queda pierde los alias con los que la conciliacion encontraba el historico. Es SECURITY DEFINER con search_path fijado, y valida es_admin_actual() adentro: si no sos admin, corta con error. Anon tiene el permiso revocado. Chequea que los dos existan y que no sean el mismo. El unico FK contra proveedores es gastos.proveedor_id, asi que con re-apuntar gastos no quedan huerfanos — pero si algun dia se agrega otra tabla que apunte a proveedores, esta funcion se queda corta y el DELETE va a fallar. Devuelve cuantos gastos movio.

*Parámetros:* `(p_mantener uuid, p_eliminar uuid) → jsonb` · *Definida en:* `supabase/migrations/118_fusionar_proveedores.sql`

**`resincronizar_medios_pago`** — Vale la 140 (la 138 es la version original, sin el control de admin). Es la mas pesada de la lista: escribe en ONCE tablas de plata en un mismo llamado, con SQL armado al vuelo (EXECUTE format). Si se corta a la mitad, unas tablas quedan resincronizadas y otras no. Es SECURITY DEFINER con search_path fijado. 💣 El control de admin tiene una puerta a proposito: si auth.uid() es NULL —o sea, si corre desde el editor SQL de Supabase o con la clave de servicio— NO pide nada y pasa igual; solo exige es_admin cuando hay un usuario logueado. Nunca pisa una cuenta ya cargada (usa COALESCE) y solo completa filas cuyo medio_pago_id este vacio o sea 'sin_especificar', asi que es repetible. Devuelve un jsonb con cuantas filas toco cada tabla, y omite las que no toco. Esos UPDATE disparan el trigger trg_medio_pago (mig 138), que solo completa columnas de la misma fila. Se controla con la vista v_medios_pago_sin_mapear, que tiene que dar cero filas.

*Parámetros:* `() → jsonb` · *Definida en:* `supabase/migrations/140_medios_pago_hardening.sql`

</details>

### 2.4 Permisos y utilidades

| Función | Qué hace | Escribe en | T | Aplicada |
|---|---|---|:-:|:-:|
| `agenda_companeros` | Da la lista de gente a la que se le puede asignar una tarea de la Agenda. | — *solo lee* | — | ✅ |
| `correo_integracion_estado` | Dice si la casilla de correo del contador está conectada, cuándo se leyó por última vez y cuál fue el último error. | — *solo lee* | — | ✅ |
| `es_admin` | Contesta si la persona que está operando en este momento es administrador. | — *solo lee* | — | ✅ |
| `es_admin_actual` | NO ENCONTRADA en las migraciones | — *solo lee* | — | ✅ |
| `mi_local` | Devuelve a qué local está atado el usuario que está operando: 'vedia', 'saavedra', o NULL si ve los dos. | — *solo lee* | — | ✅ |
| `migrar_ambos_a_locales` | NO ENCONTRADA en las migraciones | — *solo lee* | — | ✅ |
| `pesos_criollo` | Escribe un número como se escribe la plata en Argentina: $1.500.000,50. | — *solo lee* | — | ✅ |
| `procesar_recordatorios_agenda` | Cada 5 minutos revisa la Agenda y manda el aviso al celular de los que tienen una tarea a punto de empezar. | `agenda_items`, `net.http_request_queue` | **Sí** | ✅ |
| `tiene_permiso` | Contesta si la persona que está operando tiene habilitado el módulo que se le pregunta (caja, cocina, gastos, etc.). | — *solo lee* | — | ✅ |

<details><summary><b>Las trampas de este grupo (9 funciones tienen una)</b></summary>

**`agenda_companeros`** — SECURITY DEFINER porque `perfiles` no se lee de afuera, pero devuelve SOLO el id y el nombre: no expone sueldos, PIN ni permisos. La 098 la arregló para incluir a los admins (Lucas, Karina), que tienen puede_ver_agenda=false porque entran por es_admin y no por la casilla; sin ese arreglo no aparecían en 'Compartir con' y nadie les podía asignar nada. Solo la pueden llamar los usuarios logueados (anon no).

*Parámetros:* `() → TABLE(user_id uuid, nombre text)` · *Definida en:* `supabase/migrations/098_agenda_companeros_incluye_admins.sql`

**`correo_integracion_estado`** — SECURITY DEFINER, plpgsql. Se redefinió dos veces (100 → 104) y vale la 104: la 100 la dejaba solo para admins y la 104 la abrió al permiso 'integraciones', para poder dársela a alguien de confianza que no sea admin. Chequea el permiso ella misma y, si no lo tenés, corta con la excepción 'no autorizado' (o sea que el front tiene que atajar ese error, no le llega una lista vacía). 💣 Lee siempre la fila con id = 1, hardcodeada: hay una sola casilla configurable. Solo lee, no escribe nada.

*Parámetros:* `() → TABLE(conectado boolean, email_casilla text, ultima_lectura timestamptz, ultimo_error text, updated_at timestamptz)` · *Definida en:* `supabase/migrations/104_integraciones_permiso.sql`

**`es_admin`** — SECURITY DEFINER y STABLE, con search_path fijado en 'public'. Existe justamente porque preguntarle a la tabla `perfiles` desde adentro de una regla de seguridad corre con los permisos del que consulta, y ahí la RLS puede devolver CERO filas: un admin de verdad quedaría afuera sin ningún error visible. Solo la pueden llamar los usuarios logueados (se le revocó el permiso a todo el mundo). Si no encuentra la fila devuelve false, nunca NULL.

*Parámetros:* `() → boolean` · *Definida en:* `supabase/migrations/154_facturacion_arca.sql`

**`es_admin_actual`** — 💣 TRAMPA AL REVÉS: existe en la base real (aparece en supabase/esquema-aplicado.sql como sql · SECURITY DEFINER) pero NINGUNA migración la crea. Se usa en las migraciones 017, 100, 101, 118 y 150 (por ejemplo `if es_admin_actual() then`), o sea que se creó a mano en el panel de Supabase antes de que existiera el sistema de migraciones. Es la hermana vieja de es_admin(): las dos contestan lo mismo. Si alguna vez hay que recrear la base desde cero con las migraciones, esta función NO va a estar y se caen las reglas de correo, storage de documentos del contador y la fusión de proveedores.

*Parámetros:* `() → boolean` · *Definida en:* ``

**`mi_local`** — SECURITY DEFINER y STABLE porque `perfiles` no la puede leer cualquiera; devuelve una sola palabra, ningún dato sensible. 💣 NULL significa 've las dos casas', no 'no tiene permiso': cualquier regla nueva que la use tiene que contemplar el NULL o le corta el acceso a los que ven todo. La puede llamar hasta la clave pública (anon), a propósito: le contesta NULL en vez de tirar 'permission denied for function'. Es la base de las 15 reglas del POS que separan Vedia de Saavedra.

*Parámetros:* `() → text` · *Definida en:* `supabase/migrations/187_cada_cajero_ve_solo_su_casa.sql`

**`migrar_ambos_a_locales`** — 💣 MISMO CASO QUE es_admin_actual: existe en la base real (supabase/esquema-aplicado.sql la muestra como plpgsql, SIN security definer, devolviendo un entero) pero ninguna migración la crea. Lo único que hay en el repo es la línea 145 de supabase/migrations/018_rls_blindar_cocina_y_misc.sql, que le fija el search_path a una función que ya existía: `ALTER FUNCTION public.migrar_ambos_a_locales() SET search_path = public;`. Se creó a mano en el panel de Supabase. Por el nombre y por devolver un número, todo indica que fue una corrida de una sola vez para partir las filas que tenían local = 'ambos' en filas por local (vedia y saavedra), devolviendo cuántas tocó — pero eso es lectura del nombre, NO del código: el cuerpo no está en ningún lado del repo, así que no se puede afirmar qué tablas escribe ni si es seguro volver a correrla. ⚠️ ALERTA LUCAS: no la ejecutes para averiguarlo. Si hace falta saberlo, hay que pedirle el cuerpo a la base con las tools de Supabase.

*Parámetros:* `() → integer` · *Definida en:* ``

**`pesos_criollo`** — No toca ninguna tabla: solo da formato para los mensajes de error que lee el cajero. IMMUTABLE, sin SECURITY DEFINER (no lo necesita). La base habla en inglés (lc_numeric = en_US.UTF-8) y devolvería 1,500,000.50, así que hace un baile con una X de por medio para intercambiar el punto y la coma sin pisar uno con el otro. Redondea a 2 decimales y trata el NULL como cero. Antes de esto los carteles de la caja salían con dieciséis decimales. Solo la pueden llamar los usuarios logueados.

*Parámetros:* `(p_monto numeric) → text` · *Definida en:* `supabase/migrations/189_cobrar_es_una_sola_transaccion.sql`

**`procesar_recordatorios_agenda`** — SECURITY DEFINER, plpgsql, la dispara pg_cron con el horario '*/5 * * * *'. Nadie la puede llamar a mano (se revocó public, anon y authenticated). Es idempotente: marca `recordatorio_enviado_at` en cada item y nunca lo vuelve a mandar; si esa marca no se llegara a grabar, el mismo aviso saldría de nuevo a los 5 minutos. El aviso no se manda desde acá: encola un pedido HTTP con pg_net (por eso escribe también en la cola interna net.http_request_queue) hacia la función `enviar-push`, que es la que después toca las tablas de suscripciones. 💣 Tiene la URL del proyecto Y la clave pública (anon) PEGADAS A MANO adentro del cuerpo: si algún día se rota esa clave o cambia el proyecto, esta función deja de avisar en silencio, sin ningún error a la vista. 💣 Usa la zona horaria 'America/Argentina/Cordoba' para armar la hora del cartel. Junta al creador y a todos los asignados en una sola lista sin repetidos.

*Parámetros:* `() → void` · *Definida en:* `supabase/migrations/101_agenda_recordatorios_push.sql`

**`tiene_permiso`** — Es EL portero de todo el ERP: 96 reglas de seguridad cuelgan de ella. SECURITY DEFINER, STABLE, search_path fijo. Se redefinió cinco veces (016 → 104 → 143 → 187 → 196) y vale la 196, que maneja 21 módulos incluyendo los dos últimos: 'anular_ventas' y 'ver_esperado_caja'. 💣 JAMÁS hacerle un `drop ... cascade`: se lleva puestas las 96 reglas y el ERP queda mudo; siempre `create or replace`. 💣 Si le pasás un nombre de módulo que no está en la lista devuelve false sin quejarse: un typo apaga el acceso en silencio. 💣 Al admin le dice que sí a todo antes de mirar nada, así que probando con un usuario admin NUNCA vas a ver si el permiso funciona. Dentro de las reglas hay que envolverla en `(select tiene_permiso(...))` o la evalúa fila por fila y la consulta se va a 500ms.

*Parámetros:* `(modulo text) → boolean` · *Definida en:* `supabase/migrations/196_el_candado_de_local_no_se_borra_mas.sql`

</details>

---

## 3. Las edge functions

**Son 19, no 22.** Conté las carpetas de `supabase/functions/`.

⚠️ **A 7 de las 19 no las invoca nada en `src/`.** Pero
*"no la llama nadie"* no quiere decir lo mismo en los tres casos, y meterlas en la misma
bolsa sería un error caro:

| Situación | Cuáles | Qué hacer |
|---|---|---|
| **Andamios que ya cumplieron.** El archivo mismo dice «BORRAR». | `diag-anthropic` (del incidente de saldo de Anthropic, 1-sep) · `test-arca-tls` (spike de TLS, ya resuelto) | Se pueden borrar |
| **Terminada y esperando que la prendan.** | `arca-facturar` | ⛔ **No tocar.** La facturación está frenada por el certificado y la RG 3685, no por el código |
| **Circuitos completos apagados**, las dos mitades sin llamador. | `outlook` + `outlook-callback` · `sync-mp-release-trigger` + `sync-mp-release-process` | Decidir: prenderlos o sacarlos. A medias no sirven |

> 💣 **Ojo con `outlook-callback`:** que no aparezca en `src/` es esperable — a esa la
> llama **Microsoft**, redirigiendo el navegador. No es código muerto por sí misma: está
> apagada porque `outlook`, que arma el link de permiso, no la llama nadie. La cadena se
> corta arriba, no abajo.

| Función | Qué hace | Quién la llama | Escribe en | Afuera |
|---|---|---|---|---|
| `arca-facturar` | Toma las facturas que quedaron en cola, le pide el CAE a ARCA y las guarda con su número fiscal. | `nadie la llama` | `ventas_comprobantes`, `arca_tokens` | ARCA (WSAA + WSFEv1) |
| `cleanup-fichadas-fotos` | Borra las fotos de fichaje con más de 30 días; el registro de la fichada queda, solo se va la imagen. | `src/modules/rrhh/AsistenciaTab.tsx:98 (botón manual, oculto, en la pestaña Asistencia)` | `fichadas (pone foto_path = null)`, `bucket de Storage 'fichadas-fotos' (borra los archivos)` | — |
| `diag-anthropic` | Prueba de diagnóstico que le pregunta a Anthropic a qué cuenta pertenece la clave del OCR y si tiene saldo. | `nadie la llama` | — | Anthropic |
| `enviar-push` | Manda notificaciones push al celular de uno o varios usuarios del ERP. | `src/lib/push.ts:107`<br>`src/lib/push.ts:125 (y desde ahí src/modules/agenda/NotificacionesBoton.tsx y src/modules/agenda/NuevoItemModal.tsx)`<br>`src/modules/almacen/PedidosTab.tsx:597`<br>`CRON: supabase/migrations/101_agenda_recordatorios_push.sql:34 — la función procesar_recordatorios_agenda() le pega por net.http_post, y corre cada 5 minutos (línea 56). Esa función SÍ está en supabase/esquema-aplicado.sql:1981, así que existe en la base.` | `push_subscriptions (borra las suscripciones vencidas)` | Servicio Web Push del navegador (VAPID) |
| `fudo-convenios` | Mide cuánto consumieron los clientes con convenio en un rango de fechas, leyendo las ventas de Fudo. | `src/modules/convenios/useConvenios.ts:57` | — | Fudo |
| `fudo-importar-ventas` | Baja todas las ventas de Fudo de un local y las mete en las tablas del ERP: borra el período y lo repone entero. | `src/modules/finanzas/edr/EstadoResultados.tsx:573 (botón manual de sincronizar en el Estado de Resultados)`<br>`CRON DIARIO: supabase/migrations/118_cron_fudo_importar_diario.sql:21 — 11:00 UTC = 8 de la mañana AR, trae el mes actual y el anterior. Es el corrector: Fudo no avisa cuando alguien modifica una venta vieja.`<br>`CRON CADA 15 MIN: supabase/migrations/180_ventas_del_dia_cada_quince_minutos.sql:57 — de 11:00 a 01:00 hora AR, solo el día de hoy, para que el stock del mostrador esté al día.` | `ventas_tickets`, `ventas_pagos`, `ventas_items`, `edr_partidas`, `fudo_sync_runs`, `fudo_tokens` | Fudo |
| `fudo-mensuales` | Devuelve el total vendido y la cantidad de tickets mes por mes, para el gráfico de los últimos 12 meses. | `src/modules/ventas/components/FudoLiveTab.tsx:188` | — | Fudo |
| `fudo-productos` | Trae qué se vendió por producto en un rango de fechas, agrupado, para ver el ranking del menú. | `src/modules/ventas/components/FudoLiveTab.tsx:159 (período actual)`<br>`src/modules/ventas/components/FudoLiveTab.tsx:174 (período anterior, para comparar)` | `fudo_tokens (guarda el token de Fudo, por REST directo)` | Fudo |
| `fudo-ventas` | Trae las ventas de un día agrupadas por medio de pago; es lo que compara el cierre de caja contra lo que hay en el cajón. | `src/lib/fudoApi.ts:87 (y desde ahí src/modules/finanzas/components/CierreCaja.tsx:156)` | — | Fudo |
| `gestionar-usuario` | Crea usuarios del ERP y les resetea la contraseña; es lo único que puede tocar el login de la gente. | `src/modules/usuarios/UsuariosPage.tsx:154 (crear)`<br>`src/modules/usuarios/UsuariosPage.tsx:368 (resetear contraseña)` | `perfiles`, `auth.users (el sistema de login de Supabase, vía admin API)` | — |
| `ocr-comprobante` | Lee un comprobante de pago (transferencia, ticket, voucher) con IA y saca proveedor, monto, fecha y número de operación. | `src/lib/ocrComprobantePago.ts:200 (y desde ahí: src/modules/compras/ComprasPage.tsx:1129, src/modules/finanzas/components/ChecklistPagos.tsx:1980, src/modules/finanzas/components/FlujoCaja.tsx:554, src/modules/gastos/NuevoGastoForm.tsx:1128)`<br>`src/modules/gastos/NuevoGastoForm.tsx:946 (llamada directa, sin pasar por la librería)` | `comprobantes` | Anthropic (Claude Haiku 4.5, con visión) |
| `ocr-contador-doc` | Clasifica los PDFs que manda el contador: dice si es recibo de sueldo (y de qué empleados) o si es un VEP de ARCA. | `src/modules/integraciones/IntegracionesPage.tsx:208`<br>`src/modules/rrhh/RRHHPage.tsx:804` | — | Anthropic (Claude Haiku 4.5, con visión) |
| `ocr-factura` | Lee una factura fiscal argentina con IA y precarga sola el formulario de Nuevo Gasto. | `src/lib/ocrFactura.ts:148 (y desde ahí src/modules/gastos/NuevoGastoForm.tsx:1205)` | `comprobantes` | Anthropic (Claude Haiku 4.5, con visión) |
| `outlook` | Prende, apaga y consulta la conexión con la casilla de Outlook por donde el contador manda los papeles. | `nadie la llama` | `correo_integracion` | Microsoft (login OAuth) |
| `outlook-callback` | Recibe a Microsoft cuando el usuario dio permiso y guarda las llaves para poder leer la casilla. | `nadie la llama` | `correo_integracion` | Microsoft (Graph API + OAuth) |
| `sync-mercadopago` | Baja los cobros de Mercado Pago de un mes y los deja en la tabla de pagos. | `src/modules/finanzas/components/FlujoCaja.tsx:526 (botón manual en Flujo de Caja)` | `pagos_mp`, `saldos_cuentas` | Mercado Pago |
| `sync-mp-release-process` | Baja el reporte de dinero liberado de Mercado Pago cuando MP terminó de armarlo y lo carga como movimientos del banco. | `nadie la llama` | `mp_release_reports`, `movimientos_bancarios` | Mercado Pago |
| `sync-mp-release-trigger` | Le pide a Mercado Pago que empiece a preparar el reporte de dinero liberado y anota el pedido para buscarlo después. | `nadie la llama` | `mp_release_reports` | Mercado Pago |
| `test-arca-tls` | Prueba de laboratorio: verifica si los servidores de Supabase pueden conectarse a ARCA y firmar como ARCA exige. | `nadie la llama` | — | ARCA (los cuatro servidores: WSAA y WSFEv1, homologación y producción) |

<details><summary><b>Notas y trampas de las edge functions</b></summary>

**`arca-facturar`** — CÓDIGO MUERTO HOY. No hay un solo invoke en src/, ningún cron la dispara, y la tabla ventas_comprobantes no aparece nunca en el frontend: nadie crea las filas 'pendiente' que esta función iría a buscar. Está escrita completa y bien blindada (índice único + marca 'emitiendo' + le pregunta a ARCA si el número ya existe antes de reintentar), pero está esperando que se prenda la facturación. Lee arca_config (no la escribe). El certificado y la clave viven en variables de entorno (ARCA_CERT / ARCA_KEY), no en la base.

**`cleanup-fichadas-fotos`** — El comentario de arriba del archivo dice que además corre por pg_cron todos los días a las 03:00 AR, pero NO hay ninguna migración en supabase/migrations/ que cree ese cron. O se creó a mano en la base, o no existe. Vale la pena verificarlo contra Supabase antes de confiar en que se limpia solo. Procesa de a 500 fotos por corrida.

**`diag-anthropic`** — CÓDIGO MUERTO A PROPÓSITO. El propio archivo dice: 'Edge Function TEMPORAL' y 'BORRAR una vez resuelto: supabase functions delete diag-anthropic'. Se hizo el 1-sep-2026 por el incidente de 'credit balance is too low'. No expone la clave, solo un prefijo enmascarado. Se puede borrar.

**`enviar-push`** — Lee perfiles para resolver el alias de grupo (hoy solo 'almacen_saavedra') del lado del servidor, para no exponer la lista de usuarios al navegador.

**`fudo-convenios`** — Solo lee, no escribe nada. Las credenciales de Fudo (las dos, Vedia y Saavedra) están escritas a mano dentro del archivo, líneas 14-23 — son las mismas que fudo-ventas.

**`fudo-importar-ventas`** — LA MÁS PELIGROSA DE LAS 19. Borra y repone: por cada corrida hace DELETE de ventas_tickets, ventas_pagos y ventas_items del período. El filtro por origen='fudo' (línea 671) NO ES OPCIONAL: sin él se llevaba puestas también las ventas cobradas por el POS propio, todas las mañanas y en silencio. Si el borrado falla ahora tira excepción, antes lo ignoraba y duplicaba todo. Vedia con un año entero pasa los 150 segundos y se muere por timeout, por eso el cron pide solo dos meses. NO borra dividendos (esa tabla ya no es suya, la fuente es el cierre de caja). Las credenciales de Fudo están escritas a mano en el archivo, líneas 20-29, y las claves de Supabase están pegadas en texto plano dentro de la migración 118.

**`fudo-mensuales`** — Liviana a propósito: solo trae la cabecera de cada venta, no los items. Solo lee, no escribe. Credenciales de Fudo escritas a mano en el archivo (líneas 6-15).

**`fudo-productos`** — OJO con un falso positivo: src/modules/cocina/lib/ventasCocina.ts la nombra en las líneas 5 y 79, pero son COMENTARIOS, no llamadas. Cocina no la usa. El token de Fudo se guarda en la tabla fudo_tokens y lo comparten todas las invocaciones porque Fudo limita los logins: cuando varias pantallas pedían datos juntas devolvía 429 y quedaba 'sin ventas Fudo'.

**`fudo-ventas`** — Existe para saltar el CORS: el navegador no puede pegarle directo a api.fu.do. Tiene los IDs de medio de pago cargados uno por uno POR LOCAL, porque cada Fudo tiene los suyos. Los dos stands de la Bienal 2026 entran acá como 'bienal' compartiendo el Fudo de Saavedra y separándose por número de caja. Solo lee.

**`gestionar-usuario`** — Existe porque la clave de servicio (service_role) jamás puede vivir en el navegador. Antes de hacer nada chequea que el que llama sea admin de verdad (es_admin en perfiles). Blindaje importante: la lista PERMISOS_VALIDOS (líneas 20-27) NUNCA incluye es_admin — nadie se asciende solo por esta vía, eso se tilda a mano en la tabla. Siempre contesta 200 con {ok:false, error} porque supabase-js esconde el cuerpo de las respuestas 4xx/5xx y el mensaje no llegaba.

**`ocr-comprobante`** — Además de leer, busca duplicados: primero por número de operación exacto, después parecidos por monto + fecha + CUIT. Es el punto de OCR más usado del ERP: 7 pantallas terminan acá. Todas fallan 'para adelante': si la IA se queda sin saldo el archivo ya subido no se pierde, se avisa en amarillo y se completa a mano (incidente del 1-sep-2026). Guarda siempre la respuesta cruda en ocr_raw.

**`ocr-contador-doc`** — NO escribe en la base: devuelve el dato y el frontend decide si va a recibos_sueldo (RRHH) o a veps (Finanzas). Un solo PDF puede traer muchos empleados, uno por página, a veces con la copia empleado y la copia empleador duplicadas — por eso devuelve una lista sin repetidos por CUIL, con el número de página de cada uno para poder cortar el PDF.

**`ocr-factura`** — Sabe que el CUIT de Rodziny es 30717352366, así que descarta ese lado y se queda con el del proveedor. Busca al proveedor en la tabla proveedores para engancharlo (solo lo lee, nunca lo crea: el proveedor se da de alta a mano, a propósito). Falla para adelante igual que ocr-comprobante.

**`outlook`** — CÓDIGO MUERTO. La palabra 'outlook' no aparece ni una vez en todo src/ — la pantalla de Integraciones existe pero nunca la invoca. Sin esta función nadie puede generar el link de consentimiento, así que la integración con Outlook no se puede prender desde la app. Exige JWT válido + perfil admin. La tabla correo_integracion está vacía (0 filas según scripts/mapa-erp).

**`outlook-callback`** — CÓDIGO MUERTO EN LA PRÁCTICA. En teoría no la llama código nuestro sino que Microsoft redirige el navegador acá (por eso es pública a propósito, sin JWT), pero eso solo pasa después de que la función 'outlook' arma el link de consentimiento — y a 'outlook' no la llama nadie. La cadena entera está apagada. Se protege validando el 'state' que dejó la otra función (anti-CSRF), y si todo sale bien manda al usuario a /integraciones?conectado=1.

**`sync-mercadopago`** — Usa upsert por id, así que reimportar el mismo mes no duplica. Los dos locales cobran con la MISMA cuenta de MP: se separan por el número de caja (pos_id) y de sucursal (store_id), mapeados a mano en las líneas 20-30. Cuando se sume una caja nueva hay que agregar su id ahí o las ventas caen sin local. Mercado Pago corta la paginación en 10.000 registros.

**`sync-mp-release-process`** — CÓDIGO MUERTO. El comentario de arriba dice que 'corre por pg_cron', pero no hay ninguna migración que cree ese cron y no la invoca nada en src/. La tabla mp_release_reports tiene 0 filas (scripts/mapa-erp), así que nunca procesó nada. Pensada para reintentar: chequea hasta 30 veces (30 corridas x 5 min = 2 horas y media) antes de darla por perdida, y hace hasta 5 reportes por corrida.

**`sync-mp-release-trigger`** — CÓDIGO MUERTO, la pareja de la anterior. Nada en src/, ninguna migración, ningún cron. Es la mitad que arranca el circuito: pide el reporte y se va sin esperar; después sync-mp-release-process lo levanta. Como ninguna de las dos se llama, el circuito completo está apagado y mp_release_reports está en cero.

**`test-arca-tls`** — CÓDIGO MUERTO A PROPÓSITO. El archivo dice 'Spike temporal' y 'BORRAR una vez tomada la decision de arquitectura'. Probaba dos miedos: que ARCA rechace la conexión por usar un cifrado viejo, y que no se pueda firmar el pedido sin OpenSSL (lo resuelve con node-forge, JavaScript puro). El certificado que se le manda es de prueba y no se guarda ni se loguea. Ya cumplió: arca-facturar existe y usa ese mismo enfoque, así que esta se puede borrar.

</details>

---

## 4. La misma regla escrita dos veces: SQL y frontend

Esta es la parte que importa. Cada fila es **una regla de negocio que vive en la base**
**y también en el código de pantalla**. Cuando las dos copias no dan el mismo número, el
sistema se contradice consigo mismo sin avisar.

**32 duplicaciones encontradas · 30 dan resultados distintos · 12 de riesgo alto.**

> **Riesgo alto** quiere decir: *puede mover plata o stock sin que nadie lo note.*
>
> **Sobre la confianza de esta tabla:** la armaron tres relevamientos en paralelo leyendo
> el código. **Yo verifiqué a mano tres de las de riesgo alto** —el IVA todo-o-nada del EdR,
> el costo de empaque, y el respaldo del 21% que nunca se dispara— y las tres eran exactas.
> Las demás llevan el veredicto del relevamiento, no una comprobación mía. Antes de tocar
> código por cualquiera de ellas, abrí el archivo.

### Resumen, ordenado por riesgo

| | Regla | Tipo | Veredicto |
|:-:|---|---|---|
| 🔴 | [Cuando un renglón de una receta nombra a una subreceta, hay que reemplazarlo por los ingredient](#dup-1) | costeo | ❌ **dan distinto** |
| 🔴 | [Misma regla que la anterior (bajar una subreceta a materia prima), TERCERA copia: la Calculador](#dup-2) | costeo | ❌ **dan distinto** |
| 🔴 | [El costo de un producto que se vende = el costo de su receta + lo que cuesta el empaque.](#dup-3) | costeo | ❌ **dan distinto** |
| 🔴 | [Cuanto deberia quedar en el mostrador despues del ultimo conteo fisico](#dup-4) | stock | ❌ **dan distinto** |
| 🔴 | [Que cuenta como 'salido de la camara' en una ventana de tiempo (lo vendido desde el ultimo cont](#dup-5) | stock | ❌ **dan distinto** |
| 🔴 | [Cuantas porciones de pasta congelada hay en Saavedra](#dup-6) | stock | ❌ **dan distinto** |
| 🔴 | [Recibir mercaderia suma al stock del almacen y deja el movimiento de entrada](#dup-7) | stock | ❌ **dan distinto** |
| 🔴 | [El stock no queda negativo, y lo que el piso en cero se come tiene que quedar anotado](#dup-8) | stock | ❌ **dan distinto** |
| 🔴 | [La diferencia entre lo esperado y lo contado en el mostrador se registra como merma](#dup-9) | stock | ❌ **dan distinto** |
| 🔴 | [Cuánto IVA débito se le descuenta al mes en el Estado de Resultados](#dup-10) | iva | ❌ **dan distinto** |
| 🔴 | [La plata que entra por Mercado Pago Lucas no es venta del negocio, es dividendo](#dup-11) | otro | ❌ **dan distinto** |
| 🔴 | [Cuánto costaron los sueldos del mes en el Estado de Resultados](#dup-12) | otro | ❌ **dan distinto** |
| 🟠 | [Qué parte de una subreceta se lleva un renglón: pasar la cantidad a kg (g÷1000, ml÷1000, 1 lt =](#dup-13) | costeo | ❌ **dan distinto** |
| 🟠 | [La merma de un insumo encarece su costo: si al pelar la cebolla se pierde 15%, el kilo útil cue](#dup-14) | costeo | ❌ **dan distinto** |
| 🟠 | [Cuándo un margen es 'bajo' y hay que hacer algo al respecto.](#dup-15) | margen | ❌ **dan distinto** |
| 🟠 | [Cuánto margen de seguridad se le suma al costo de una receta antes de fijarle precio.](#dup-16) | margen | ❌ **dan distinto** |
| 🟠 | [Con qué nombre de categoría se busca la configuración de precios de un producto (su piso de mar](#dup-17) | precio | ❌ **dan distinto** |
| 🟠 | [Tope de 'cantidad imposible' al RECIBIR mercaderia](#dup-18) | stock | ❌ **dan distinto** |
| 🟠 | [El orden FIFO de la camara de congelado: se saca el lote mas viejo primero](#dup-19) | stock | ❌ **dan distinto** |
| 🟠 | [relleno_kg esta sucio: si el numero es mayor a 50, son gramos y hay que dividir por 1000](#dup-20) | stock | ❌ **dan distinto** |
| 🟠 | [Cuánto se bonifica en un renglón de venta (descuento por línea)](#dup-21) | precio | ❌ **dan distinto** |
| 🟠 | [Cuánto suma el ticket: la suma de los renglones tiene que ser el total cobrado](#dup-22) | precio | ❌ **dan distinto** |
| 🟠 | [Con qué lista de precios cobra cada clase de venta (mostrador = canal, salón = canal)](#dup-23) | precio | ❌ **dan distinto** |
| 🟠 | [Con qué importe entra un gasto: neto de IVA si la factura lo discrimina, si no el total](#dup-24) | iva | ❌ **dan distinto** |
| 🟠 | [La diferencia de arqueo de un turno (lo contado contra lo esperado)](#dup-25) | otro | ❌ **dan distinto** |
| 🟠 | [Cuánto de un precio de venta es IVA (para sacar el neto)](#dup-26) | iva | ❌ **dan distinto** |
| 🟠 | [Cuanto vale la mercaderia que hay en el deposito](#dup-27) | costeo | ❓ no se pudo comprobar |
| 🟡 | [En qué escala se expresa un margen: fracción (0,62) o porcentaje (62).](#dup-28) | margen | ❌ **dan distinto** |
| 🟡 | [Tope de 'cantidad imposible' al sacar mercaderia del deposito](#dup-29) | stock | ❌ **dan distinto** |
| 🟡 | [Cruzar un renglon de plan de pasta simple con el producto, por nombre normalizado](#dup-30) | otro | ❌ **dan distinto** |
| 🟡 | [El precio de venta de un producto se espeja del canal 'plato'](#dup-31) | precio | ❌ **dan distinto** |
| 🟡 | [Qué ticket cuenta como venta del negocio (no cancelado, no eliminado, no dividendo)](#dup-32) | otro | ✅ coinciden |

### Una por una

<a id="dup-1"></a>

#### 1. 🔴 Cuando un renglón de una receta nombra a una subreceta, hay que reemplazarlo por los ingredientes reales de esa subreceta, escalados por la parte que se usa (cantidad del padre ÷ lo que rinde).

**Tipo:** costeo · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public.cocina_ingredientes_expandidos(uuid) + public._cocina_norm_nombre(text) — escrita en supabase/migrations/124_cocina_ingredientes_expandidos.sql y REESCRITA (la que manda) en supabase/migrations/174_ingredientes_expandidos_dividen_por_el_rinde.sql. Las tres funciones SÍ están aplicadas (supabase/esquema-aplicado.sql:1849, 1852, 1882). La consume la tablet: src/modules/cocina/components/IngredientesGrilla.tsx:102. | Recorrido recursivo (tope 8 niveles). Baja a la subreceta SOLO si el renglón no tiene producto_id Y existe una receta con tipo='subreceta', activo=true, MISMO local que la receta padre, y nombre igual después de normalizar (minúsculas, sin el prefijo 'Subreceta ', espacios colapsados — no saca acentos). Escala con _cocina_fraccion_subreceta = cantidad/rinde. Si falta el rinde, NO expande y deja el renglón puntero a la vista. |
| **Frontend** | src/modules/cocina/lib/costeoEngine.ts:277-389 (la decisión de expandir, en la línea 296; el fallback que abre el juego, en 304-309). Los datos entran por src/modules/cocina/hooks/useCostosRecetas.ts:20-88 (filtra activo=true, igual que el SQL). | Mismo recorrido recursivo y mismo normalizado de nombre, PERO: (a) también intenta expandir cuando el renglón TIENE producto_id, si el nombre arranca con 'Subreceta '; (b) si no encuentra subreceta, cae a CUALQUIER receta del mismo local (incluidas las vendibles tipo='receta'), no solo tipo='subreceta'; (c) tiene un segundo intento con el nombre 'simplificado', al que le saca sufijos de tamaño ('1 kg', '500g', '(COCINA)'). El escalado lo hace vía costoPorKg / costoPorPorcion, que es la misma división por el rinde. |

> **En qué difieren.** Los dos filtran por local IGUAL (la sospecha de que uno no filtraba es falsa para este par: el que no filtra es la Calculadora, ver el punto siguiente). Lo que difiere es a qué le pega cada uno. 1) Renglón 'Salsa Fileto 2 kg' sin producto_id y sin el prefijo 'Subreceta', existiendo en el mismo local una receta VENDIBLE llamada 'Salsa Fileto' de $8.000/kg: el costeo la expande y le carga $16.000 al plato; el SQL no la toca y la tablet muestra 'Salsa Fileto 2 kg' como un renglón que nadie puede pesar. El plato cuesta $16.000 más de lo que la cocina ve. 2) Renglón 'Subreceta Pomodoro 1 kg' cuando la subreceta se llama solo 'Pomodoro': el costeo simplifica el nombre, matchea y cobra; el SQL normaliza a 'pomodoro 1 kg', no matchea y no expande. En los dos casos la lista que se pesa y la lista que se cobra son distintas.

<a id="dup-2"></a>

#### 2. 🔴 Misma regla que la anterior (bajar una subreceta a materia prima), TERCERA copia: la Calculadora de Cocina.

**Tipo:** costeo · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public.cocina_ingredientes_expandidos(uuid) + public._cocina_fraccion_subreceta(numeric,text,numeric,numeric) — supabase/migrations/174_ingredientes_expandidos_dividen_por_el_rinde.sql (aplicadas: supabase/esquema-aplicado.sql:1849 y 1882). | Exige tipo='subreceta' + activo + MISMO LOCAL que la receta padre. Pasa la cantidad del renglón a kg antes de dividir (g÷1000, ml÷1000, lt=kg, oz×30÷1000) y divide por rendimiento_kg; si el renglón va por unidad, divide por rendimiento_porciones. Sin rinde, no expande. |
| **Frontend** | src/modules/cocina/CalculadoraTab.tsx:102-111 (el índice de subrecetas) y 114-162 (la explosión; la fracción se calcula en las líneas 133-138). | Arma un mapa de subrecetas por NOMBRE SOLO —sin local, prefiriendo la activa pero aceptando la inactiva si no hay otra— y calcula subFactor = cantidad_del_renglón / rendimiento_kg, sin convertir la unidad y sin mirar nunca rendimiento_porciones. Tope 6 niveles. |

> **En qué difieren.** Tres diferencias, las tres se leen en el código. 1) GRAMOS ×1000: renglón 'Subreceta Pomodoro 500 g' con un Pomodoro que rinde 20 kg → el SQL calcula 0,5÷20 = 2,5% del lote; la Calculadora calcula 500÷20 = 25 LOTES. La lista de compra pide mil veces de más. 2) CRUZA LOCALES: si Saavedra no tiene cargada 'Masa de medialuna' y Vedia sí, la Calculadora agarra la de Vedia (harina de trigo) para una receta de Saavedra, que es 100% sin gluten; el SQL y el motor de costeo se niegan. 3) SUBRECETAS POR PORCIONES: 'Pan para servicio' rinde 150 porciones y no tiene rendimiento_kg → el SQL expande (2 unid ÷ 150), la Calculadora dice 'no se pudo expandir' y no suma nada a la lista de compra.

<a id="dup-3"></a>

#### 3. 🔴 El costo de un producto que se vende = el costo de su receta + lo que cuesta el empaque.

**Tipo:** costeo · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | NO HAY LADO SQL EJECUTABLE. cocina_productos.costo_empaque existe en la base real (supabase/esquema-aplicado.sql:507) pero NO aparece en ninguno de los 207 archivos de supabase/migrations/ — la columna se creó a mano contra la base. Ninguna función, vista ni trigger la suma. | Ninguna: la base solo guarda el número. Quién lo suma y cuándo queda a criterio de cada pantalla. |
| **Frontend** | src/modules/productos/hooks/useMenuEngineering.ts:322-330 (SUMA) · src/modules/productos/hooks/useCostoPorFudo.ts:74-96 (SUMA, pero solo en el segundo camino) · src/modules/productos/components/MenuTab.tsx:349-364 (NO SUMA). | Tres copias de la misma cuenta. Ingeniería de Menú y el costo en vivo de Fudo hacen costo = costoPorPorcion(receta) + costo_empaque. El tab Menú hace costo = costoPorPorcion(receta) a secas. Y peor: en los dos que sí suman, el empaque entra SOLO cuando el producto enganchó por cocina_productos.fudo_nombres; si enganchó por la receta vendible (fudo_productos), la variable del producto queda en null y el empaque suma cero. |

> **En qué difieren.** Un sorrentino con costo de receta $3.000 y costo_empaque $450: el tab Menú dice que cuesta $3.000; Ingeniería de Menú y el ranking de Fudo dicen $3.450. Con precio de lista $12.000 (IVA 21%, comisión 3%), lo recibido son $9.623: el tab Menú muestra 68,8% de margen y las otras dos pantallas 64,1%. Casi 5 puntos de diferencia sobre el mismo plato, en dos pestañas del mismo módulo. Y el mismo plato puede dar los dos números dentro de Ingeniería de Menú según por dónde haya enganchado con Fudo.

<a id="dup-4"></a>

#### 4. 🔴 Cuanto deberia quedar en el mostrador despues del ultimo conteo fisico

**Tipo:** stock · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | Vista v_cocina_stock_mostrador (migracion 170_cuenta_unica_del_mostrador.sql). CONFIRMADA en la foto: supabase/esquema-aplicado.sql:1490-1543 | porciones_mostrador = GREATEST(0, conteo_base + traspasos_post - ventas_post - merma_post + ajustes_post). Todo lo 'post' es lo que paso DESPUES del ultimo cierre de ese producto. Los traspasos, la merma y los ajustes se cuentan por created_at; las ventas por (ventas_tickets.fecha + hora). |
| **Frontend** | src/modules/cocina/MostradorPage.tsx:788-789 (el numero) y :462-483 (de donde saca cada pieza) | tope = inicial + entrega; esperado = Math.max(0, tope - vendido). 'inicial' = cantidad_real del ultimo cierre. 'entrega' = suma de traspasos posteriores en Vedia, pero suma de PRODUCCION (cocina_lotes_pasta.porciones) en Saavedra (linea 466-473). 'vendido' = RPC cocina_salidas_de_camara. NO resta merma y NO suma ajustes. |

> **En qué difieren.** Dos diferencias, las dos con numero. (1) MERMA: pasta con ultimo conteo 40, se tiran 10 podridas y se venden 5. El SQL dice esperado 25 (40-5-10); la tablet dice 35 (40-5). La tablet va a marcar 'faltan 10' y mandar a buscar pasta que ya se tiro, y el tab Stock de Cocina va a mostrar 25 mientras la tablet muestra 35. (2) SAAVEDRA: ahi no se usan traspasos (lo dice el propio codigo, MostradorPage.tsx:282-284 y StockCongeladosTab.tsx:183-186). Ultimo conteo 20, se produjeron 100 porciones y se vendieron 30: la tablet dice esperado 90 (20+100-30) y la vista SQL dice 0 (20+0-30, cortado en cero), porque para la vista la produccion de Saavedra no entra nunca al mostrador. 90 contra 0 sobre el mismo producto el mismo dia.

<a id="dup-5"></a>

#### 5. 🔴 Que cuenta como 'salido de la camara' en una ventana de tiempo (lo vendido desde el ultimo conteo)

**Tipo:** stock · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | Sub-consulta 've' adentro de v_cocina_stock_mostrador — supabase/esquema-aplicado.sql:1535-1539 (migracion 170) | suma ventas_items.cantidad uniendo ventas_tickets, enganchando por COALESCE(vi.cocina_producto_id, receta.descuenta_producto_id), con (vt.fecha + vt.hora) > corte. Cuenta TODOS los tickets, incluidos los de salon, a la hora en que se COBRA. No mira caja_mesa_lineas y no tiene enganche por nombre. |
| **Frontend** | src/modules/cocina/MostradorPage.tsx:414 → src/modules/cocina/lib/ventasCocina.ts:135-152 → RPC cocina_salidas_de_camara (migracion 195_lo_que_sale_de_la_camara.sql:88-176, CONFIRMADA aplicada en esquema-aplicado.sql:1897) | la pantalla del mostrador pide el vendido a otra funcion: excluye los tickets con tipo_venta='salon' y en su lugar cuenta caja_mesa_lineas a la hora del ENVIO de la comanda a la cocina (incluidas las lineas 'sacadas' que nunca se cobraron), y ademas tiene un ultimo recurso por NOMBRE contra cocina_productos.fudo_nombres. |

> **En qué difieren.** Son dos definiciones distintas de la misma palabra 'vendido', y cada pantalla usa una. (1) HORA: mesa de salon con 6 sorrentinos, comanda a la cocina 21:10, se cobra 22:40, conteo a las 22:00. La tablet cuenta 0 (el envio fue antes del corte) y la vista cuenta 6 (el cobro fue despues): 6 porciones de diferencia en el mismo producto. (2) ENGANCHE POR NOMBRE: los productos sin receta vinculada — la propia migracion 195 nombra el Tortelli de Espinaca — los cuenta la RPC por nombre y la vista NO los cuenta nunca. Para esos productos el 'mostrador' del tab Stock no descuenta una sola venta y solo sube, mientras la tablet los descuenta bien.

<a id="dup-6"></a>

#### 6. 🔴 Cuantas porciones de pasta congelada hay en Saavedra

**Tipo:** stock · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | Vista v_cocina_stock_pastas (migracion 161_stock_pastas_una_sola_cuenta.sql, ultima version 164). CONFIRMADA aplicada: supabase/esquema-aplicado.sql:1545-1642 | arranca del ULTIMO CONTEO FISICO (cocina_cierre_camara, o cocina_cierre_dia en Saavedra) y le suma solo lo posterior: porciones_camara = cantidad_real + lotes en camara_congelado porcionados despues del conteo + ajustes de camara posteriores. Despues porciones_neto_camara = GREATEST(0, porciones_camara - traspasos - merma). |
| **Frontend** | src/modules/almacen/StockCongeladosTab.tsx:160 (la cuenta) y :44-98 (las cuatro consultas crudas) | stock = producido - traspasado - merma - entregadoPedidos, armado en el navegador: suma TODAS las porciones de cocina_lotes_pasta de la historia de Saavedra (sin filtrar ubicacion y sin baseline de conteo), le resta todos los traspasos, toda la merma y los almacen_pedidos entregados. No corta en cero y no mira cocina_ajustes_stock. |

> **En qué difieren.** Ya esta medido y escrito en el propio archivo (StockCongeladosTab.tsx:180-190): el 10-sep-2026 esta pantalla marcaba 2.715 porciones y el conteo fisico de la camara daba 272. Diez veces mas. La causa es que suma la produccion desde siempre y nunca resta lo vendido, y en Saavedra no hay traspasos que la bajen. El ultimo commit le puso un cartel rojo arriba avisando que esta mal, pero el numero se sigue calculando igual y sigue alimentando los KPI 'OK / bajo minimo / sin stock' de esa pantalla, que no tienen cartel.

<a id="dup-7"></a>

#### 7. 🔴 Recibir mercaderia suma al stock del almacen y deja el movimiento de entrada

**Tipo:** stock · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | recepcionar_mercaderia (migracion 102_recepcionar_mercaderia_rpc.sql). CONFIRMADA aplicada: supabase/esquema-aplicado.sql:1996 | en UNA transaccion: inserta la recepcion pendiente, y por cada item hace SELECT ... FOR UPDATE del producto validando que pertenezca al local, stock_actual = stock_leido_en_vivo + cantidad, e inserta el movimiento de entrada. El FOR UPDATE esta puesto a proposito 'para evitar perder sumas en recepciones concurrentes del mismo producto'. |
| **Frontend** | src/modules/compras/ComprasPage.tsx:1601-1660, funcion confirmarRecepcion (la recepcion contra el export de Fudo) | no llama a la RPC. Hace un insert suelto en movimientos_stock y despues un update suelto: stock_actual = prod.stock_actual + totalCantidad, donde prod.stock_actual es el valor que tenia la CACHE de react-query cuando se cargo la pantalla. Sin bloqueo de fila, sin validar el local, sin transaccion y sin contar filas afectadas. |

> **En qué difieren.** Es una lectura-modificacion-escritura sobre un dato viejo, que la RPC no puede hacer. Caso concreto: harina con stock 50 kg. Martin abre Compras, alguien recibe 20 kg por el QR /recepcion (la RPC lo deja en 70). Martin confirma en su pantalla una recepcion de 10 kg: escribe 50+10 = 60. El stock real deberia ser 80 y queda 60 — se perdieron 20 kg y ningun error salta. Ademas, si la RLS bloquea el update, devuelve 0 filas sin error: el movimiento de entrada queda grabado y el stock no se mueve, que es exactamente el bug que la migracion 102 fue escrita para cerrar.

<a id="dup-8"></a>

#### 8. 🔴 El stock no queda negativo, y lo que el piso en cero se come tiene que quedar anotado

**Tipo:** stock · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | registrar_salida_deposito (migracion 182_el_deposito_deja_de_tragarse_los_errores.sql:112-135). CONFIRMADA aplicada: supabase/esquema-aplicado.sql:1999 | v_sin_stock = greatest(0, p_cantidad - stock_actual); v_nuevo_stock = greatest(0, stock_actual - p_cantidad). El piso en cero se mantiene, pero la diferencia se guarda en movimientos_stock.cantidad_sin_stock. La migracion dice textual: 'lo que estaba mal era el silencio'. |
| **Frontend** | src/modules/compras/ComprasPage.tsx:2822-2831 (boton ✕ de la tabla de movimientos, revertir stock al borrar) | nuevoStock = m.tipo === 'salida' ? prod.stock_actual + m.cantidad : Math.max(0, prod.stock_actual - m.cantidad), y update directo a productos. Aplica el mismo piso en cero pero NO guarda en ningun lado lo que el piso se comio, y tampoco cuenta las filas afectadas. |

> **En qué difieren.** Mismo piso, distinto registro. Ejemplo: se cargo por error una entrada de 30 kg de queso, despues se consumieron 25 y el stock quedo en 5. Se borra la entrada equivocada: la pantalla escribe max(0, 5-30) = 0 y los 25 kg de descuadre desaparecen sin dejar rastro. Por el camino de la base los 25 hubieran quedado en cantidad_sin_stock, que es la columna que se creo el 182 justamente para poder ver despues que insumo se pidio mas veces de las que habia.

<a id="dup-9"></a>

#### 9. 🔴 La diferencia entre lo esperado y lo contado en el mostrador se registra como merma

**Tipo:** stock · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | registrar_merma_conteo_mostrador + trigger trg_merma_conteo_mostrador (migraciones 026_cocina_conteos_mostrador.sql:51-80 y 027). ⚠️ NO EXISTE EN LA BASE: no aparece en supabase/esquema-aplicado.sql. La tabla cocina_conteos_mostrador la borro la migracion 042 y la funcion la borro la 179 (drop function ... cascade). No es que 'nunca se aplico': se mato a proposito y nada la reemplazo. | cuando existia: v_merma = cantidad_inicial - cantidad_vendida - cantidad_real, y si daba > 0 insertaba la fila en cocina_merma con motivo 'Cierre mostrador — turno X'. Hoy no hay ningun trigger sobre cocina_cierre_dia ni sobre cocina_cierre_camara (verificado: no hay una sola linea 'trigger' asociada a esas dos tablas en las 207 migraciones). |
| **Frontend** | src/modules/cocina/MostradorPage.tsx:792 (dif = real - esperado) y :945-948 (el cartel 'Faltan N. Puede ser merma, o una venta que todavia no entro'), contra el guardado en :645-660 | calcula la misma resta que hacia el trigger, la muestra en pantalla como 'faltan N', y al guardar inserta SOLO la fila de cocina_cierre_dia con inicial/entrega/vendido/cantidad_real. No escribe nada en cocina_merma. |

> **En qué difieren.** La cuenta sobrevivio y el registro no. Ejemplo: turno con esperado 45 y contado 33. La tablet muestra 'faltan 12', se guarda el cierre con cantidad_real 33, y v_cocina_stock_mostrador se re-basa sobre ese 33 — o sea que las 12 porciones desaparecen del stock sin dejar una sola fila en cocina_merma. El total de merma del tab Stock (columna que sale de v_cocina_stock_pastas.porciones_merma) sigue en cero para esas 12. Antes de la migracion 042 esa fila se creaba sola. Hoy la unica manera de que la merma quede anotada es que alguien la cargue a mano por el boton 'Se perdio' del pizarron del deposito.

<a id="dup-10"></a>

#### 10. 🔴 Cuánto IVA débito se le descuenta al mes en el Estado de Resultados

**Tipo:** iva · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public.edr_resumen_ventas(text,text) — supabase/migrations/198_el_edr_cuenta_las_ventas_del_pos.sql:52. Aplicada. | iva_debito = sum(coalesce(t.iva, 0)) sobre los tickets oficiales del mes. Ese campo t.iva sale del XLS fiscal de Fudo, ticket por ticket: el que no aparece en el archivo fiscal entra con iva = 0 (src/modules/finanzas/components/UploadFudo.tsx:137, `iva: f ? f.iva : 0`). Y cobrar_venta NUNCA escribe iva: los tickets del POS propio nacen con iva NULL. |
| **Frontend** | src/modules/finanzas/edr/EstadoResultados.tsx:739-744 (dentro del queryFn de ticketsRaw) y el uso en :294 y :328 | const ivaReal = Number(row.iva_debito); const ivaEstimado = (lo cargado a mano en edr_partidas concepto='iva_debito' para ese local y mes); const ivaEfectivo = ivaReal > 0 ? ivaReal : ivaEstimado. Después: ingNeto = ingBruto − ivaDebito + difArqueo. |

> **En qué difieren.** Es todo-o-nada y gana el parcial. Si en el mes UN solo ticket tiene IVA cargado del archivo fiscal, ivaReal > 0 y el estimado mensual cargado a mano se DESCARTA entero. Ejemplo con números: mes de $50.000.000 facturados donde el XLS fiscal cubrió $1.000.000 → la base devuelve iva_debito $173.554; como es > 0, el EdR descuenta $173.554 en vez de los ~$8.677.686 del estimado 21/121, y el resultado del mes queda inflado ~$8,5M. No hay ningún cartel: el aviso «Sin IVA débito» (EstadoResultados.tsx:1415-1425) solo salta cuando el IVA es CERO, no cuando es parcial. Y esto se pone peor con el POS: cobrar_venta no escribe iva, así que el día que un local corte a 'pos' todos sus tickets aportan 0 de IVA.

<a id="dup-11"></a>

#### 11. 🔴 La plata que entra por Mercado Pago Lucas no es venta del negocio, es dividendo

**Tipo:** otro · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public.cobrar_venta(...) — supabase/migrations/189_cobrar_es_una_sola_transaccion.sql: el INSERT del ticket (líneas 690-700, `es_fiscal, es_dividendo` → `false, false`) y el INSERT de los cobros (líneas 785-800, `es_dividendo = (m.codigo = 'mp_lucas')`). El filtro que decide qué cuenta como venta está en edr_resumen_ventas (mig 198:59), y mira el TICKET, no el cobro. | En el POS, ventas_tickets.es_dividendo queda SIEMPRE en false y total_bruto es el importe completo, MP Lucas incluido. Solo la fila de ventas_pagos queda marcada es_dividendo = true. Como edr_resumen_ventas filtra por coalesce(t.es_dividendo,false)=false a nivel ticket, esa plata entra 100% como venta. |
| **Frontend** | src/modules/finanzas/components/UploadFudo.tsx:112-127 (importador de Fudo) y src/modules/finanzas/components/CierreCaja.tsx:275-300 (crea la fila en dividendos) | Suma los pagos por ticket; si MP Lucas cubre todo el ticket (mpLucas >= total − 0,01) marca es_dividendo = true en el TICKET; si es mixto, le RESTA la porción MP Lucas al total_bruto (totalAjustado = totalOriginal − mpLucas). Aparte, el cierre de caja manual crea la fila en `dividendos` cuando fudo_mp_lucas > 0. |

> **En qué difieren.** Misma regla, dos implementaciones que no coinciden. Ejemplo: venta de $30.000, $30.000 pagados con «Mercado Pago Lucas». Importada de Fudo → el ticket queda es_dividendo=true y el EdR cuenta $0 de venta. Cobrada por el POS propio → el ticket queda es_dividendo=false con total_bruto $30.000 y el EdR cuenta $30.000 de venta. Y una venta mixta ($20.000 tarjeta + $10.000 MP Lucas): Fudo la guarda como $20.000, el POS como $30.000. El medio mp_lucas está activo y con aplica_ventas=TRUE (mig 136:110), así que el cajero lo tiene en la lista y lo puede usar hoy. Además useCerrarTurno (src/modules/caja/useCaja.ts:686) escribe fudo_mp_lucas pero NO crea la fila en `dividendos` que sí crea el cierre manual. Es silencioso: no hay cartel ni diferencia de arqueo.

<a id="dup-12"></a>

#### 12. 🔴 Cuánto costaron los sueldos del mes en el Estado de Resultados

**Tipo:** otro · **Riesgo:** alto · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public.edr_resumen_gastos(text,text), renglón 'sueldos', vía public.edr_renglon_de_gasto — supabase/migrations/167_edr_neto_en_cero_no_es_gratis.sql:64 y 166_renglon_del_edr_una_sola_definicion.sql:31. Las dos aplicadas (esquema-aplicado.sql:1933 y :1936). | Suma coalesce(nullif(importe_neto,0), importe_total) de los gastos con categoria = 'gastos de rrhh' y subcategoria = 'sueldos', del local y del año, no cancelados. |
| **Frontend** | src/modules/finanzas/edr/EstadoResultados.tsx:1016-1043 (query edr_sueldos_pagados) y :1219-1230 (el pisado) | Trae pagos_sueldos agrupado por periodo y hace `existing.sueldos = Number(s.sueldos_total)` — PISA el número que devolvió el SQL, no lo suma ni lo compara. Solo cae al valor del SQL cuando el mes no tiene NINGUNA fila en pagos_sueldos. |

> **En qué difieren.** Es el mismo patrón todo-o-nada del IVA: alcanza UN pago tildado en RRHH para que se descarte todo el renglón que calculó la base. Ejemplo: un mes con $9.000.000 cargados como gasto «Gastos de RRHH → Sueldos» y un solo empleado tildado en RRHH por $600.000 → el EdR muestra $600.000 de sueldos y se come $8,4M de costo de personal, inflando EBITDA y resultado por esa misma plata. Encima las dos fuentes no son comparables: pagos_sueldos guarda el NETO pagado y los gastos suelen tener el bruto. Y el renglón total_gastos que la base devuelve como control («la suma de los renglones = total_gastos») nunca se chequea contra lo que arma la pantalla, así que el desvío no dispara ningún cartel.

<a id="dup-13"></a>

#### 13. 🟠 Qué parte de una subreceta se lleva un renglón: pasar la cantidad a kg (g÷1000, ml÷1000, 1 lt = 1 kg, 1 oz = 30 ml) y dividir por rendimiento_kg; si el renglón va por unidad, dividir por rendimiento_porciones.

**Tipo:** costeo · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public._cocina_fraccion_subreceta(numeric, text, numeric, numeric) — supabase/migrations/174_ingredientes_expandidos_dividen_por_el_rinde.sql. Aplicada (supabase/esquema-aplicado.sql:1849). El comentario de la propia función dice textual: 'Misma regla que costeoEngine.ts'. | Tabla de unidades escrita a mano: kg/kgs→kg; g/gr/grs/gramo/gramos→g; lt/l/lts/litro/litros→lt; ml/mililitros→ml; oz/onza/onzas→oz; y TODO LO DEMÁS cae en 'unid'. Peso y volumen se pasan a kg y se dividen por rendimiento_kg; 'unid' se divide por rendimiento_porciones. Devuelve NULL si falta el rinde que hace falta. |
| **Frontend** | src/lib/unidades.ts:68-96 (normalizarUnidad) + src/modules/cocina/lib/costeoEngine.ts:315-372. | Misma tabla de equivalencias y los mismos números (÷1000, lt=kg, oz×30÷1000), pero la lista de sinónimos es CERRADA: lo que no reconoce como kg/g/lt/ml/oz/unid (los envases botella, lata, paquete, caja y bolsa sí cuentan como unidad) no cae en 'unid' — devuelve el texto tal cual y el motor corta con el error 'Unidad no soportada para subreceta'. |

> **En qué difieren.** Para todas las unidades que el formulario ofrece hoy (kg, g, L, ml, unid., oz) dan EXACTAMENTE el mismo número: lo comparé caso por caso. La diferencia aparece con una unidad que ninguno reconoce, o con la unidad vacía: un renglón 'Subreceta Crema base — 3' sin unidad, con la subreceta rindiendo 30 porciones, el SQL lo toma como unidad y expande 3/30 = 10% del lote; el motor de costeo lo descarta con una advertencia y ese ingrediente suma $0 al plato (el plato sale más barato de lo que es). NO PUDE COMPROBAR si hoy existen renglones con unidad rara o vacía: eso se contesta con una consulta a cocina_receta_ingredientes y la tarea era solo leer código.

<a id="dup-14"></a>

#### 14. 🟠 La merma de un insumo encarece su costo: si al pelar la cebolla se pierde 15%, el kilo útil cuesta más.

**Tipo:** costeo · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | productos.merma_pct — supabase/migrations/056_productos_costeo_y_merma.sql (encabezado, líneas 5-8, y el COMMENT ON COLUMN de la línea 17). La columna está aplicada (supabase/esquema-aplicado.sql:1134). OJO: del lado SQL esto es SOLO texto — no hay función, trigger ni check que lo calcule. | El comentario dice: 'La merma se aplica al multiplicar el costo_unitario por (1 + merma_pct)'. O sea, 15% de merma = costo × 1,15. |
| **Frontend** | src/modules/cocina/lib/costeoEngine.ts:116-117 y 140 (y el mismo factor en la línea 129, para el puente unidad↔ml). El dato se carga en src/modules/productos/components/InsumosTab.tsx:93-95 (se tipea 15 y se guarda 0,15). | factorMerma = 1/(1 − merma_pct), y solo si la merma está entre 0 y 1. O sea, 15% de merma = costo ÷ 0,85 = costo × 1,17647. |

> **En qué difieren.** Cebolla a $1.000/kg con 15% de merma: lo que dice la base es $1.150/kg, lo que cobra el sistema es $1.176,47/kg. 2,3% de diferencia en cada insumo con merma, siempre para arriba. La fórmula del CÓDIGO es la correcta (para tener 1 kg útil hay que comprar 1/0,85 kg); la mal escrita es la de la base. Como del lado SQL es solo un comentario, hoy no hay dos números conviviendo: hay un número y una documentación que engaña al que la lea. Se corrige el comentario, no el código.

<a id="dup-15"></a>

#### 15. 🟠 Cuándo un margen es 'bajo' y hay que hacer algo al respecto.

**Tipo:** margen · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | Tabla public.productos_costeo_config, columna margen_min — creada y sembrada en supabase/migrations/056_productos_costeo_y_merma.sql y podada en supabase/migrations/176_config_de_precios_solo_lo_que_manda.sql, que deja escrito que margen_min 'dispara la alerta de margen bajo y define el precio objetivo'. La tabla está aplicada (supabase/esquema-aplicado.sql:1156). | Un piso por categoría, guardado como fracción: default 0,50 · pasta 0,55 · salsa 0,50 · postre 0,55 · panificado 0,45 · pasteleria 0,50 · masa 0,45 · bebida 0,55 (la migración 063 quiso bajar bebida a 0,30 pero usó ON CONFLICT DO NOTHING, así que no pisó nada). |
| **Frontend** | Lo respeta: src/modules/productos/components/PlanAccionTab.tsx:113-119. Lo ignora y usa números fijos: src/modules/ventas/components/FudoLiveTab.tsx:576-580. | Plan de Acción compara el margen real contra cfg.margen_min de la categoría y arma la acción 'subir precio'. El ranking de 'En vivo Fudo' pinta verde con ≥60%, ámbar con ≥40% y rojo abajo de 40, sin leer la tabla ni mirar la categoría. |

> **En qué difieren.** Una pasta con 52% de margen: Plan de Acción la marca como problema (el piso de la pasta es 55%) y te dice a qué precio ponerla; el ranking de Fudo la pinta ÁMBAR, que se lee como 'anda bien'. Al revés: una pasta con 58% está por encima de su piso y el ranking la pinta ámbar igual. Dos pantallas del mismo ERP contestan distinto la misma pregunta sobre el mismo plato, y la que decide el color es la que nadie puede configurar.

<a id="dup-16"></a>

#### 16. 🟠 Cuánto margen de seguridad se le suma al costo de una receta antes de fijarle precio.

**Tipo:** margen · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | DOS lugares en la base: la fila configuracion.clave='margen_seguridad_pct' y la columna cocina_recetas.margen_seguridad_pct (existe en la base real: bloque 'create table public.cocina_recetas' de supabase/esquema-aplicado.sql). | La fila de configuracion es un porcentaje global para todo el ERP. La columna por receta permitiría un margen distinto para una receta puntual. Ninguna función SQL usa ninguna de las dos: el cálculo es todo del frontend. |
| **Frontend** | src/modules/cocina/hooks/useCostosRecetas.ts:33-46 (lee SOLO la fila global) y src/modules/cocina/lib/costeoEngine.ts:480-489 (la aplica). La columna por receta está declarada en src/modules/cocina/recetas/modelo.ts:61 y no la lee nadie: lo verifiqué buscando 'margen_seguridad_pct' en todo src/. | costoConMargen = costoBase × (1 + margen_global), y de ahí salen costoPorKg y costoPorPorcion. El margen por receta se ignora siempre. |

> **En qué difieren.** Si alguien carga 8% de margen de seguridad en la receta de los sorrentinos, el número queda guardado en la base y el costo no se mueve ni un peso: el sistema sigue usando el global. Es una perilla que gira en el vacío. Aparte, y esto conviene mirarlo por separado: como el margen se aplica en CADA nivel (el costoPorKg de una subreceta ya viene con el margen adentro, y el plato le vuelve a aplicar el mismo margen encima), una receta con dos niveles de subreceta lleva el margen al cuadrado: con 5%, la parte que viene de la subreceta paga 10,25% en vez de 5%.

<a id="dup-17"></a>

#### 17. 🟠 Con qué nombre de categoría se busca la configuración de precios de un producto (su piso de margen y su paso de redondeo).

**Tipo:** precio · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | productos_costeo_config.categoria (clave primaria) — supabase/migrations/056_productos_costeo_y_merma.sql, comentario de las líneas 15-17 y COMMENT ON TABLE de la línea 26. Aplicada (supabase/esquema-aplicado.sql:1156 y el índice único de la línea 2451). | La base dice textual: 'Categoría matchea cocina_productos.tipo o usa default como fallback'. Y cocina_productos.tipo está limitado por un CHECK (migración 063) a pasta, salsa, postre, relleno, masa, panificado y bebida. Las filas sembradas son default, pasta, salsa, postre, panificado, pasteleria, masa, bebida, vino, aperitivo y helado. |
| **Frontend** | src/modules/productos/hooks/useMenuEngineering.ts:313-314 (arma la categoría) y :388 (getConfig(it.tipo)); el buscador con fallback está en src/modules/productos/hooks/useProductosCosteoConfig.ts:67-71. | La clave que usa NO es cocina_productos.tipo sino, en este orden: cocina_recetas.categoria → cocina_productos.tipo → la categoría que viene de Fudo pasada a minúsculas. Si no encuentra la fila, cae a 'default' sin avisar. |

> **En qué difieren.** El vocabulario de cocina_recetas.categoria (src/modules/cocina/recetas/modelo.ts:26-34) incluye 'pizza', 'cafeteria' y 'otros', que NO existen como filas en productos_costeo_config; y la tabla tiene 'relleno' del lado viejo, que ya no llega nunca. Resultado concreto: una pizza o un café se miden contra el piso 'default' de 50% en lugar del suyo, y nadie lo ve porque el fallback es mudo. Si el enganche vino de Fudo, la clave puede terminar siendo algo como 'pastas salón', que tampoco existe: default otra vez. No pude contar cuántos productos caen hoy en default — eso sale de la base, no del código.

<a id="dup-18"></a>

#### 18. 🟠 Tope de 'cantidad imposible' al RECIBIR mercaderia

**Tipo:** stock · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | recepcionar_mercaderia (migracion 102). CONFIRMADA aplicada (esquema-aplicado.sql:1996) — pero la regla NO ESTA ESCRITA ADENTRO: la funcion valida local, cantidad > 0 y que el producto exista, y nada mas. | no hay tope. Cualquier cantidad positiva entra. |
| **Frontend** | src/modules/compras/RecepcionPage.tsx:21-35 (UMBRALES_RECEPCION + evaluarCantidadRecepcion) | kg {confirma 500, bloquea 5000}, lt {confirma 200, bloquea 2000}, unid {confirma 2000, bloquea 20000}. |

> **En qué difieren.** El freno de la ENTRADA existe en una sola pantalla y no en la base — al reves de la salida, que la migracion 182 mando a la base 'para que no dependa de que pantalla lo llame'. Consecuencia concreta: los 4.300 kg de Queso Danbo que nombra la propia migracion 182 son una ENTRADA, y hoy se pueden volver a cargar por el camino de Compras (ComprasPage.tsx:1601, confirmarRecepcion), que no pasa por RecepcionPage y no aplica ningun umbral. La segunda puerta esta abierta.

<a id="dup-19"></a>

#### 19. 🟠 El orden FIFO de la camara de congelado: se saca el lote mas viejo primero

**Tipo:** stock · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | fifo_consumir_camara_pasta (migracion 050_cocina_lote_trazabilidad.sql:78-88). CONFIRMADA aplicada: supabase/esquema-aplicado.sql:1954 | recorre los lotes con WHERE ubicacion='camara_congelado' AND lp.fecha <= fecha_del_consumo, ORDER BY lp.fecha, lp.created_at, y va imputando LEAST(restante, saldo) a cada lote. El created_at es el desempate cuando dos lotes tienen la misma fecha. |
| **Frontend** | src/modules/cocina/components/PizarronPanelPasta.tsx:94-104 (la lista 'del mas viejo al mas nuevo', con el cartel 'el primero' en el numero 1) | lee v_cocina_lote_pasta_saldo con .eq('ubicacion','camara_congelado').gt('saldo_camara', 0).order('fecha_armado', ascending). Ordena SOLO por fecha, sin created_at como desempate, y sin filtrar por fecha del consumo. |

> **En qué difieren.** Cuando hay dos lotes del mismo producto armados el MISMO dia, la tablet y el trigger pueden no coincidir en cual es 'el primero'. Ejemplo: lote A (armado 01-09 a las 08:00, 60 porciones) y lote B (armado 01-09 a las 15:00, 40 porciones). La tablet le dice al operario 'saca del lote B' porque Postgres devolvio B primero al no haber desempate; el operario baja 40 porciones, se inserta el traspaso y el trigger se las descuenta al lote A. Resultado: el sistema muestra el lote A en cero y el B entero, cuando fisicamente es al reves. No mueve el total de la camara — mueve la trazabilidad y la instruccion de que sacar, que es justo para lo que se hizo el panel.

<a id="dup-20"></a>

#### 20. 🟠 relleno_kg esta sucio: si el numero es mayor a 50, son gramos y hay que dividir por 1000

**Tipo:** stock · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | Vista v_cocina_stock_pastas, bloques 'ratio' y 'proceso' — supabase/esquema-aplicado.sql:1583-1586 y 1597-1601 (aplicada) | CASE WHEN COALESCE(lp.relleno_kg,0) > 50 THEN lp.relleno_kg / 1000.0 ELSE COALESCE(lp.relleno_kg,0) END, sumado a masa_kg. Con eso arma los kg en proceso y el ratio de porciones por kilo que dan porciones_en_proceso_est. |
| **Frontend** | src/modules/cocina/ProduccionQRPage.tsx:826-833 (consumoPorRelleno) y :858-862 (disponible_kg) | suma relleno_kg CRUDO, sin ninguna guarda: disponible_kg = peso_total_kg - Σ relleno_kg, y despues filtra los lotes que quedan en <= 0.01. |

> **En qué difieren.** La misma columna se lee con dos criterios opuestos. Si alguien arma una pasta y escribe el relleno en gramos (3200 en vez de 3,2), la base lo interpreta como 3,2 kg para el estimado de porciones en proceso, y el QR lo interpreta como 3.200 kg: al lote de relleno de 12 kg le calcula disponible = 12 - 3200 = -3188, lo saca de la lista por el filtro > 0.01, y el cocinero ve que el relleno 'ya no esta' cuando en la heladera quedan casi 9 kg. Es la unica guarda del sistema contra ese dedazo y esta escrita en un solo lado de los dos.

<a id="dup-21"></a>

#### 21. 🟠 Cuánto se bonifica en un renglón de venta (descuento por línea)

**Tipo:** precio · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public.venta_descuento_de_linea(numeric,numeric) — supabase/migrations/189_cobrar_es_una_sola_transaccion.sql:289 (aplicada: figura en supabase/esquema-aplicado.sql:2101). La usa cobrar_venta tanto para el total del ticket como para cada renglón. | case when coalesce(pct,0) <= 0 then 0 else round(bruto * least(pct,100)) / 100 end. El bruto que le llega ya viene redondeado a 2 decimales: round(precio_unitario * cantidad, 2). round() de Postgres sobre numeric es decimal exacto y redondea el medio para arriba. |
| **Frontend** | src/modules/caja/useCaja.ts:132-135 (descuentoDeLinea), usada por src/modules/caja/CajaPage.tsx:622 y por el salón en src/modules/salon/useMesas.ts:48-51 | if (!pct \|\| pct <= 0) return 0; return Math.round(bruto * Math.min(pct,100)) / 100. El bruto NO se redondea antes: es precio * cantidad en coma flotante. |

> **En qué difieren.** El SQL comenta que es «espejo exacto» y con los precios enteros de hoy da igual. Pero Math.round trabaja sobre coma flotante y round() de Postgres sobre decimal exacto, así que se separan un centavo apenas un precio tenga centavos. Ejemplo comprobado corriendo el cálculo: plato a $1.024,10 con 15% de convenio → el navegador bonifica $153,61 y cobra $870,49; la base bonifica $153,62 y calcula $870,48. Como cobrar_venta exige que los cobros cierren exacto (v_pagado <> v_total), la caja corta con «Los cobros suman $870,49 y la venta es de $870,48» y la venta NO se puede cobrar hasta que alguien saque los centavos del precio. Otros casos iguales: $1.024,34 con 25%, $1.024,85 con 30%. No pude verificar contra la base si hoy hay algún precio con centavos cargado (no ejecuté SQL): si todos son enteros, hoy no pasa.

<a id="dup-22"></a>

#### 22. 🟠 Cuánto suma el ticket: la suma de los renglones tiene que ser el total cobrado

**Tipo:** precio · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public.cobrar_venta(...) §4.4 «Las cuentas se rehacen ACÁ» — supabase/migrations/189_cobrar_es_una_sola_transaccion.sql:498-512, más los dos INSERT a ventas_items (líneas 705-731 y 745-775). Aplicada (esquema-aplicado.sql:1876). | Por renglón: bruto = round(precio_unitario * cantidad, 2); descuento = venta_descuento_de_linea(bruto, pct); total_renglón = round(bruto - descuento, 2). Total del ticket = sum() de esos renglones YA redondeados, y descuento_total = sum(round(descuento,2)). Después exige v_pagado = v_total sin tolerancia, si no revienta. |
| **Frontend** | src/modules/caja/CajaPage.tsx:621-625 (mostrador) y src/modules/salon/MesasMostradorPage.tsx:77-79 (mesas), apoyados en src/modules/caja/useCaja.ts:747-751 (importesDeLinea) | bruto = precio * cantidad (sin redondear); total del ticket = suma de brutos − suma de descuentos, todo en coma flotante y sin redondear renglón por renglón. Recién al cobrar se redondea el resto: restante = Math.round((total − pagado) * 100) / 100 (CajaPage.tsx:1508, MesasMostradorPage.tsx:79). |

> **En qué difieren.** La base redondea CADA renglón a 2 decimales antes de sumar; la pantalla suma primero y redondea después. Con precios enteros y cantidades enteras los dos dan el mismo número. Con cualquier precio con centavos más descuento, el arrastre del renglón (ver la fila anterior) se traslada al total y cobrar_venta rechaza la venta entera. Lo bueno: no hay plata silenciosa: la base nunca acepta un total que no cierre con los cobros, y lo que se muestra en el cartel «Cobrado $X» es el total que devolvió la base (CajaPage.tsx:1219), no el del navegador. Lo malo: el ticket IMPRESO (CajaPage.tsx:788-802 → Impresion.tsx) usa los importes del navegador, así que en ese caso el papel y la fila guardada pueden diferir un centavo.

<a id="dup-23"></a>

#### 23. 🟠 Con qué lista de precios cobra cada clase de venta (mostrador = canal, salón = canal)

**Tipo:** precio · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | tabla public.caja_canal_precio (supabase/migrations/192_el_precio_lo_pone_la_carta.sql:101-110) + public.trg_ventas_items_precio_de_la_carta() en su versión más nueva, migración 193_cobrar_la_mesa.sql:135-206 (aplicada: esquema-aplicado.sql:2095), disparador trg_ventas_items_z_precio_de_la_carta sobre ventas_items. También public.salon_agregar_linea (190_las_mesas_del_salon.sql:423-427). | Lee el canal de caja_canal_precio según ventas_tickets.tipo_venta ('mostrador'→'plato', 'salon'→'plato' hoy), busca el precio en cocina_recetas_precios_canal cruzado con la receta del MISMO local, vendible, activa y precio > 0, y si round(precio_unitario,2) <> round(precio_carta,2) FRENA la venta con un cartel. No corrige por atrás, a propósito. |
| **Frontend** | src/modules/caja/useCaja.ts:13 (const CANAL_MOSTRADOR = 'plato') y useCaja.ts:80-96 (useCatalogoCaja) | El canal está escrito a mano en una constante del código: .eq('canal', CANAL_MOSTRADOR). Filtra recetas del local, vendible=true, activo=true, y descarta las que no tienen precio > 0. Nunca lee caja_canal_precio. |

> **En qué difieren.** La migración 192 dice textual que cambiar de lista es «un renglón, sin deploy»: update caja_canal_precio set canal='mesa' where tipo_venta='mostrador'. Si alguien hace ese update, la base pasa a exigir el precio del canal 'mesa' y el POS sigue mandando el del canal 'plato' → TODA venta del mostrador se rechaza con «X está a $A en la carta y la pantalla dice $B» hasta que se haga un deploy cambiando la constante. O sea: la puerta que la 192 dejó abierta a propósito hoy rompe la caja. El salón no tiene el problema porque el precio lo pone la base (salon_agregar_linea) y el teléfono no manda ninguno.

<a id="dup-24"></a>

#### 24. 🟠 Con qué importe entra un gasto: neto de IVA si la factura lo discrimina, si no el total

**Tipo:** iva · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public.edr_resumen_gastos(text,text) y la vista v_edr_gastos_sin_renglon — supabase/migrations/167_edr_neto_en_cero_no_es_gratis.sql:47 y :86 (es la más nueva; la 166 usaba coalesce a secas). Aplicadas: esquema-aplicado.sql:1936 y :1661. | monto = coalesce(nullif(g.importe_neto, 0), g.importe_total), filtrando cancelado = false. El nullif() es la corrección de la 167: un neto en CERO se trata como «no cargado» y vale el total. Sin eso, 76 gastos por $14.761.906 entraban valiendo $0. |
| **Frontend** | src/modules/gastos/AnalisisGastos.tsx:207 (coincide) y src/modules/gastos/ListadoGastos.tsx:226-237 + el total del pie en :604 (NO coincide) | AnalisisGastos: `const monto = Number(g.importe_neto) \|\| Number(g.importe_total) \|\| 0` — el \|\| de JavaScript descarta el 0 igual que el nullif, así que da lo mismo que el SQL. ListadoGastos: `acc.neto += Number(g.importe_neto ?? 0)` — suma el neto crudo, y el gasto sin neto o con neto en 0 aporta CERO a la columna «Neto». |

> **En qué difieren.** Análisis de Gastos y el EdR usan la regla arreglada; el Listado de Gastos usa la vieja. Sobre los mismos gastos filtrados, el pie del Listado muestra un «Neto» más chico que lo que el EdR cuenta como gasto, por exactamente la suma de los importe_total de los gastos sin neto discriminado (típicamente todo lo que no es factura A) más los que quedaron con neto en 0. Con el número que midió la propia migración 167, son $14.761.906 de 2026 que el Listado sigue mostrando como $0 en la columna Neto y el EdR ya cuenta enteros. Ese total además se reporta hacia arriba con onResumen() y alimenta los KPI de la pantalla de Gastos (ListadoGastos.tsx:242-253).

<a id="dup-25"></a>

#### 25. 🟠 La diferencia de arqueo de un turno (lo contado contra lo esperado)

**Tipo:** otro · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | Columna generada public.cierres_caja.diferencia — supabase/migrations/001_finanzas.sql:102. Existe en la foto del esquema (esquema-aplicado.sql:238). | diferencia = monto_contado − coalesce(monto_esperado, monto_contado), GENERATED ALWAYS ... STORED. Ojo el coalesce: si monto_esperado quedó NULL, la diferencia guardada es CERO. |
| **Frontend** | src/modules/finanzas/components/CierreCaja.tsx:565-566 (calcDif, usada en :598 y :1368) contra src/modules/finanzas/edr/EstadoResultados.tsx:1005 (que sí lee la columna) | calcDif = monto_contado + (otros_retiros ?? 0) − (fudo_efectivo + fondo_apertura). Cuando monto_esperado está cargado da exactamente lo mismo que la columna, porque el propio formulario lo guarda como fondo + fudo_efectivo − retiros (CierreCaja.tsx:268). Pero la pantalla nunca lee c.diferencia: siempre recalcula. |

> **En qué difieren.** El formulario guarda monto_esperado en NULL cuando fudo_efectivo y fondo_apertura son los dos cero (CierreCaja.tsx:333: `fudoEfvo > 0 || fondoAp > 0 ? efectivoEsperado : null`). En ese caso la columna de la base vale 0 y la pantalla muestra monto_contado + retiros. Ejemplo: turno cargado con $8.000 contados en el cajón y sin cargar el efectivo del sistema → la pantalla de Cierre de Caja muestra un sobrante de $8.000 y el Estado de Resultados, que lee la columna (EstadoResultados.tsx:1005-1007), suma $0 a los ingresos netos. Nadie ve la contradicción porque cada pantalla muestra su número y ninguna muestra el del otro. No pude medir cuántos cierres tienen monto_esperado en NULL porque no ejecuté SQL contra la base.

<a id="dup-26"></a>

#### 26. 🟠 Cuánto de un precio de venta es IVA (para sacar el neto)

**Tipo:** iva · **Riesgo:** medio · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | No hay ninguna función SQL que lo calcule. Lo más parecido es public.edr_resumen_ventas (mig 198:52), que NO calcula el IVA: suma la columna ventas_tickets.iva que trae el XLS fiscal, ticket por ticket. | iva_debito = sum(coalesce(t.iva,0)). Es un dato importado, no una fórmula: la base nunca aplica una alícuota. |
| **Frontend** | src/modules/productos/components/MenuTab.tsx:233 y :253, :281-282, :521; src/modules/productos/hooks/useMenuEngineering.ts:263, :375, :397; src/modules/productos/hooks/useCostoPorFudo.ts:61, :111 | neto = precio / (1 + ivaPct), con ivaPct = configuracion.iva_pct y 0.21 de respaldo. De ahí sale el margen: recibido = neto − neto*comisión, margen = (recibido − costo) / recibido. Y el precio objetivo se despeja al revés: bruto = (costo/(1−margen_min)) * (1+ivaPct) / (1−comisión). |

> **En qué difieren.** La alícuota del margen sale de una fila de la tabla `configuracion` y la del EdR sale del archivo fiscal (o de un estimado cargado a mano en edr_partidas). Son dos números distintos que nadie concilia: el EdR puede estar descontando el 0,3% de IVA sobre las ventas del mes (ver la fila del IVA débito) mientras el Menú calcula todos los márgenes sacándole el 21% al precio. Peor: useConfigCosteo devuelve 0 cuando la fila no existe (src/modules/cocina/hooks/useConfigCosteo.ts:26-31, toNumber devuelve 0), y como el objeto config SÍ existe, el `?? 0.21` no salta — así que si la fila iva_pct no está cargada, neto = precio / 1 = precio y TODOS los márgenes del Menú salen ~21 puntos más altos de lo que son, en silencio. No hay ninguna migración que siembre esa fila (grepeé iva_pct en los 207 .sql: cero resultados), y no ejecuté SQL para ver si está cargada a mano.

<a id="dup-27"></a>

#### 27. 🟠 Cuanto vale la mercaderia que hay en el deposito

**Tipo:** costeo · **Riesgo:** medio · **Veredicto:** ❓ no se pudo comprobar

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | snapshot_inventario_actual(p_local). ⚠️ CASO AL REVES: esta VIVA en la base (supabase/esquema-aplicado.sql:2026) pero NO ESTA EN NINGUNA MIGRACION — se creo a mano contra Supabase. El repo no tiene su cuerpo, y la foto del esquema solo guarda la firma, no el codigo. | no se puede leer. Por la firma se sabe que devuelve monto_alimentos, monto_bebidas, monto_indirectos, productos_sin_clasificar y valor_sin_clasificar — o sea que reparte la plata en tres canastas segun alguna clasificacion, y aparte informa cuanto quedo afuera. |
| **Frontend** | src/modules/compras/ComprasPage.tsx:1472 (KPI 'valor total') y :1450 (valor del filtro activo); el consumidor de la RPC es src/modules/compras/components/CierreInventarioModal.tsx:92-99 | valorTotal = activos.reduce((s, p) => s + p.stock_actual * p.costo_unitario, 0), sobre los productos activos del local. Plano, sin canastas y sin excluir nada. |

> **En qué difieren.** Me falto el cuerpo de la funcion. Los dos numeros valuan el mismo deposito y el del modal (que es el que se congela en edr_cierres_inventario y despues pega en el CMV del Estado de Resultados) es la suma de las tres canastas, mientras el KPI de la pantalla es la suma plana. Que la funcion devuelva 'valor_sin_clasificar' aparte sugiere fuerte que los productos sin clasificar NO entran en las tres canastas, y entonces el cierre valdria menos que el KPI por exactamente ese monto — pero eso es deduccion mia por la firma, no lectura del codigo. Para confirmarlo hay que pedirle el cuerpo a la base (pg_get_functiondef), no al repo. Y aparte hay un problema de fondo: una funcion que mueve el CMV vive solo en produccion y no esta versionada; si alguien la pisa no queda diff de nada.

<a id="dup-28"></a>

#### 28. 🟡 En qué escala se expresa un margen: fracción (0,62) o porcentaje (62).

**Tipo:** margen · **Riesgo:** bajo · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | productos_costeo_config.margen_min — supabase/migrations/056_productos_costeo_y_merma.sql, más el comentario de supabase/migrations/176_config_de_precios_solo_lo_que_manda.sql. Aplicada (supabase/esquema-aplicado.sql:1156). | La base guarda FRACCIÓN: 0,55 quiere decir 55%. |
| **Frontend** | Fracción: src/modules/productos/hooks/useMenuEngineering.ts:379-382 (margenPctSobrePrecio) y src/modules/productos/components/MenuTab.tsx:245-256 (margenEscenario). 0-100: src/modules/productos/hooks/useCostoPorFudo.ts:108-115 (getMargenPct termina en '* 100'). La pantalla de carga, src/modules/productos/components/ConfiguracionTab.tsx:220-234, muestra 55 y guarda 0,55. | Dos convenciones conviviendo con nombres casi iguales: margenPctSobrePrecio devuelve 0,62 y getMargenPct devuelve 62,0. Hoy cada consumidor la usa bien: MenuEngineeringTab y PlanAccionTab multiplican por 100 antes de mostrar, y FudoLiveTab compara contra 60 y 40. |

> **En qué difieren.** La escala difiere y está confirmado (useCostoPorFudo.ts:114 hace '* 100', useMenuEngineering.ts:382 no). HOY no rompe nada porque nadie cruza los dos mundos: busqué en todo src/ y ningún archivo compara getMargenPct() contra margen_min. Es una trampa cargada, no un número mal: el día que alguien escriba 'if (getMargenPct(...) < cfg.margen_min)' va a comparar 62 contra 0,55 y ninguna pasta va a dar nunca margen bajo. Lo barato es renombrar una de las dos o hacer que devuelva fracción como todas.

<a id="dup-29"></a>

#### 29. 🟡 Tope de 'cantidad imposible' al sacar mercaderia del deposito

**Tipo:** stock · **Riesgo:** bajo · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | registrar_salida_deposito (migracion 182:99-109). CONFIRMADA aplicada: supabase/esquema-aplicado.sql:1999 | v_tope = kg → 1000, l → 1000, cualquier otra → 5000, mirando lower(productos.unidad). Frena con excepcion si p_cantidad > v_tope (mayor estricto). |
| **Frontend** | src/modules/compras/components/DepositoForm.tsx:27-38 (UMBRALES_SALIDA + evaluarCantidad) | kg {confirma 100, bloquea 1000}, lt {confirma 100, bloquea 1000}, unid {confirma 500, bloquea 5000}, con normalizarUnidad(). Bloquea si cant >= u.bloquea (mayor O IGUAL) y ademas pide confirmacion a partir del escalon 'confirma', que en la base no existe. |

> **En qué difieren.** Solo en el borde exacto, y la pantalla es la mas estricta: una carga de exactamente 1.000 kg la frena la pantalla (>=) y la base la deja pasar (>). O sea que la misma carga entra si se hace por otro camino que no sea este formulario. Los valores de los topes coinciden porque productos.unidad guarda solo 'kg', 'L' y 'unid.' (src/lib/unidades.ts:25), y lower('L') = 'l' cae en la rama de 1000. El escalon intermedio de 100 kg que pide confirmar vive unicamente en la pantalla.

<a id="dup-30"></a>

#### 30. 🟡 Cruzar un renglon de plan de pasta simple con el producto, por nombre normalizado

**Tipo:** otro · **Riesgo:** bajo · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | norm_nombre_cocina (migracion 105_pizarron_pasta_simple_cumplido.sql:38-53), usada por recalcular_pizarron_pasta_simple (105:63-121). Las dos CONFIRMADAS aplicadas: esquema-aplicado.sql:1993 y la funcion helper esta en la lista de las 86. | lower + translate sobre una lista fija de 24 acentos ('aeiouaeiouaeiouaeiouaonc') + regexp_replace('[^a-z0-9]','','g'). El comentario de la migracion dice textual: 'Espeja src/modules/cocina/DashboardTab.tsx:normNombre'. |
| **Frontend** | src/modules/cocina/DashboardTab.tsx:787-793 (normNombre), usada para el mismo cruce en src/modules/cocina/lib/cobertura.ts:95-101 | toLowerCase + normalize('NFD') + replace(/[̀-ͯ]/g,'') + replace(/[^a-z0-9]+/g,''). El NFD saca CUALQUIER acento, no una lista. |

> **En qué difieren.** Para los nombres reales de la carta dan igual: verifique los 24 caracteres de la lista del SQL uno por uno contra lo que hace el NFD y coinciden todos (incluidos ñ→n y ç→c). La diferencia aparece solo con un acento que no este en la lista: 'Ñoquis Åland' → el frontend da 'noquisaland' y el SQL da 'noquisland' (se come la å entera en vez de convertirla en 'a'), y el renglon del plan no se tacharia nunca. Hoy no hay ningun producto asi, asi que es una bomba dormida, no un numero que este mal. Lo anoto porque son dos copias a mano de la misma regla y la unica atadura entre las dos es un comentario.

<a id="dup-31"></a>

#### 31. 🟡 El precio de venta de un producto se espeja del canal 'plato'

**Tipo:** precio · **Riesgo:** bajo · **Veredicto:** ❌ **dan distinto**

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public.sync_precio_venta_salon() + disparador trg_sync_precio_venta_salon sobre cocina_productos_precios_canal — supabase/migrations/062_precios_por_canal.sql:51-67. Aplicada (esquema-aplicado.sql:2029). | AFTER INSERT OR UPDATE OF precio: if NEW.canal = 'plato' then update cocina_productos set precio_venta = NEW.precio where id = NEW.cocina_producto_id and precio_venta is distinct from NEW.precio. |
| **Frontend** | src/modules/productos/hooks/usePreciosCanal.ts:44-58 (escribe la tabla VIEJA cocina_productos_precios_canal) contra src/modules/productos/components/MenuTab.tsx:323-331 (escribe la tabla NUEVA cocina_recetas_precios_canal, que es la que lee la caja en src/modules/caja/useCaja.ts:80-84) | Hay dos listas de precios paralelas: la de productos (cocina_productos_precios_canal, con su espejo a cocina_productos.precio_venta por trigger) y la de recetas (cocina_recetas_precios_canal), que es la única que cobra el mostrador y contra la que compara el candado de la mig 192/193. |

> **En qué difieren.** El trigger sigue vivo pero ya no espeja nada que se use. El hook usePreciosCanal —lo único que escribe la tabla vieja— no lo usa ninguna pantalla (grepeé: de usePreciosCanal solo se importa el tipo CanalPrecio en MenuTab.tsx:10), y cocina_productos.precio_venta no lo lee ni una vista, ni una función, ni una pantalla (grep sobre esquema-aplicado.sql y sobre src: solo aparece la definición de la columna y comentarios). O sea: cocina_productos.precio_venta quedó congelado con precios de mayo-2026 y el trigger que lo mantenía ya no se dispara. Hoy no mueve plata; es una segunda lista de precios muerta esperando que alguien la lea de nuevo por error.

<a id="dup-32"></a>

#### 32. 🟡 Qué ticket cuenta como venta del negocio (no cancelado, no eliminado, no dividendo)

**Tipo:** otro · **Riesgo:** bajo · **Veredicto:** ✅ coinciden

| | Dónde | Cómo lo calcula |
|---|---|---|
| **SQL** | public.edr_resumen_ventas(text,text) — supabase/migrations/198_el_edr_cuenta_las_ventas_del_pos.sql:45-64 (es la más nueva; la 142 quedó vieja). Aplicada: esquema-aplicado.sql:1939. | from v_ventas_tickets_oficial where estado != 'Cancelada' and estado != 'Eliminada' and coalesce(es_dividendo,false) = false; ing_bruto = sum(total_bruto). |
| **Frontend** | src/modules/ventas/hooks/useVentasResumen.ts:74-81 (traerTickets) | Lee la misma vista v_ventas_tickets_oficial con .neq('estado','Cancelada').neq('estado','Eliminada').or('es_dividendo.is.null,es_dividendo.eq.false'), y suma total_bruto. |

> **En qué difieren.** Los dos usan la misma vista oficial (mig 188) y los mismos tres filtros. El .neq de PostgREST se traduce a <>, que con estado NULL descarta la fila igual que el != del SQL; y el .or(...is.null, ...eq.false) es exactamente coalesce(es_dividendo,false)=false. Está escrito dos veces, pero da el mismo número. Si mañana se agrega un cuarto estado, hay que acordarse de tocar los dos lugares.

---

## 5. Reglas que la base impone sola

**31 triggers · 46 restricciones CHECK que expresan una regla de negocio.**

Esto es lo que pasa *aunque el frontend no lo pida*. Es la parte del sistema que sigue
funcionando cuando alguien escribe directo contra la base.

### 5.1 Triggers

| Trigger | Sobre la tabla | Cuándo | La regla que impone | Termina escribiendo en |
|---|---|---|---|---|
| `trg_pizarron_reset_on_lote_delete` | `(no consta en las migraciones)` | (no consta) | ⚠️ ESTÁ EN LA BASE PERO NO EN EL REPO. La foto del esquema aplicado la tiene como función de disparador y la migración 105 la menciona por escrito ('solo limpia los items cuyo lote_id apunta al lote borrado'), pero su código no está en ninguno de los 207 .sql. O sea: borrar un lote destilda el renglón del pizarrón que ese lote había cumplido, pero la regla exacta no se puede verificar leyendo el repo. Vale la pena rescatarla de la base y escribirla. | `cocina_pizarron_items` |
| `crear_perfil_nuevo_usuario` | `(no consta en las migraciones; por el nombre, auth.users)` | (no consta) | ⚠️ ESTÁ EN LA BASE PERO NO EN EL REPO. Por el nombre, cuando se crea un usuario nuevo se le arma solo su perfil en el ERP. No hay ninguna migración que la defina, así que no se puede decir con qué permisos nace ese perfil sin mirar la base. Es la otra pieza suelta que conviene escribir en una migración. | `perfiles (presumible)` |
| `trg_caja_mesas_local, trg_caja_sesiones_local, trg_caja_envios_local, trg_caja_lineas_local` | `caja_mesas, caja_mesa_sesiones, caja_mesa_envios, caja_mesa_lineas` | BEFORE INSERT OR UPDATE | El local de una mesa, de una sesión o de un renglón del salón sale SIEMPRE de arriba —la sala manda sobre la mesa, la mesa sobre la sesión, la sesión sobre el renglón— y nunca de lo que mande la pantalla. Así una tablet no puede meter una comanda en la casa equivocada, y la regla de 'cada cajero ve solo su casa' puede comparar el campo pelado. | — |
| `cierres_caja_proteger_pos` | `cierres_caja` | BEFORE UPDATE OR DELETE | Un arqueo que cerró el cajero desde la caja no se reescribe. Administración solo puede marcarlo verificado, anotar cuánto se llevó a la caja fuerte y dejar notas; cualquier otro campo queda congelado (y si mañana se agrega una columna, nace protegida). Y si el turno tiene ventas colgadas, no se borra nunca, porque las dejaría sin turno. Si hay una diferencia, ese es el dato: se deja una nota, no se corrige el número. | — |
| `trg_cierres_caja_retiros` | `cierres_caja` | BEFORE INSERT OR UPDATE OF retiro_cambio, retiro_pagos | El total retirado de un turno es siempre la suma de lo apartado para el cambio del turno siguiente más lo sacado para pagar algo. Se recalcula solo cuando se carga ese desglose. Si una pantalla vieja graba únicamente el total, no se toca nada: la cuenta del arqueo sigue igual. | — |
| `trg_ajuste_camara_fifo_ins, trg_ajuste_camara_fifo_upd, trg_ajuste_camara_fifo_del` | `cocina_ajustes_stock` | AFTER INSERT / AFTER UPDATE OF delta, producto_id, fecha, local, ubicacion / AFTER DELETE | Un ajuste que resta stock de la cámara se descuenta del lote más viejo primero. Un ajuste que suma no se le imputa a ningún lote, porque no hay lote de dónde haya salido esa pasta: queda como ajuste libre. | `cocina_lote_consumos` |
| `trg_merma_conteo_mostrador` | `cocina_conteos_mostrador` | AFTER INSERT | 💀 MUERTO, NO RIGE MÁS. La regla era: al cerrar el turno del mostrador se cuenta físicamente cada pasta y, si falta contra lo esperado (inicial − vendido − contado), el sistema anotaba la merma solo. La tabla se borró y la migración 179 tiró la función. No está en la foto del esquema aplicado. Lo menciono para que nadie lo busque de nuevo: hoy el mostrador se cierra por 'último pesaje manda' en cocina_lotes_produccion con origen='cierre'. | `cocina_merma` |
| `trg_pizarron_lote_masa_ins` | `cocina_lotes_masa` | AFTER INSERT | Lo mismo para la masa: cargar una masa pone el renglón del pizarrón en 'en producción' y lo va moviendo de etapa según las pastas que después se armen con ella. También arrastra hasta 7 días para atrás si no hay plan de hoy. | `cocina_pizarron_items` |
| `trg_lote_pasta_codigo_unico_ins` | `cocina_lotes_pasta` | BEFORE INSERT | Dos tandas del mismo producto el mismo día y en el mismo local no pueden compartir el código de lote: la segunda pasa a ser '-b', la tercera '-c', y así hasta 26. La letra la decide la base y no la tablet, porque dos tablets cargando a la vez elegirían la misma. | — |
| `trg_lote_pasta_exige_relleno` | `cocina_lotes_pasta` | BEFORE INSERT OR UPDATE OF producto_id, lote_relleno_id | Si el producto está declarado como pasta rellena, el lote no se guarda sin decir de qué lote de relleno salió. La pantalla ya lo pide, pero la pantalla se puede cambiar: esto vive en la base y aguanta aunque alguien reescriba el formulario dentro de dos años. Porcionar no lo dispara, así que ese paso sigue funcionando igual. | — |
| `trg_pizarron_lote_pasta_ins, trg_pizarron_lote_pasta_upd` | `cocina_lotes_pasta` | AFTER INSERT y AFTER UPDATE OF ubicacion | Cada vez que se arma una pasta, o que se la mueve del freezer a la cámara, el pizarrón se pone al día solo. La pasta con relleno pasa a 'en bandejas' mientras está en el freezer y a 'ciclo completo' recién cuando toda entró a la cámara. La pasta simple no se mide por etapa sino por cantidad: queda pendiente hasta que haya algo hecho, 'en producción' mientras falte, y cumplida recién cuando las porciones llegan a lo planificado. | `cocina_pizarron_items` |
| `trg_pizarron_reset_pasta_simple_del` | `cocina_lotes_pasta` | AFTER DELETE | Si se borra un lote de pasta simple cargado por error, el pizarrón vuelve para atrás: recuenta lo que quedó y, si ya no hay nada, el renglón vuelve a quedar pendiente. Borrar no deja el plan tildado en falso. | `cocina_pizarron_items` |
| `trg_pizarron_lote_produccion_ins` | `cocina_lotes_produccion` | AFTER INSERT | Cargar un lote de salsa, postre, pastelería o panadería da por cumplido el renglón del pizarrón de ese día (o el abierto más viejo de la última semana). PERO los lotes que vienen del cierre físico del mostrador (origen='cierre') no cuentan: eso es un recuento de stock, no producción, y antes marcaba como hechas cosas que nunca se cocinaron porque había remanente. | `cocina_pizarron_items` |
| `trg_pizarron_lote_relleno_ins` | `cocina_lotes_relleno` | AFTER INSERT | Cuando se carga un lote de relleno, el renglón del pizarrón de ese relleno se marca solo como 'en producción', y después va cambiando de etapa a medida que se arman las pastas que salen de él. Si nadie lo planificó para hoy, engancha el renglón abierto más viejo de los últimos 7 días (arrastre), así lo que se hace un día tarde igual tilda su plan. | `cocina_pizarron_items` |
| `trg_pizarron_cumplido_relleno, trg_pizarron_cumplido_masa, trg_pizarron_cumplido_produccion` | `cocina_lotes_relleno, cocina_lotes_masa, cocina_lotes_produccion` | AFTER INSERT | 💀 REEMPLAZADOS, NO RIGEN MÁS. Eran la primera versión, de una sola etapa: cargabas cualquier lote y el renglón del pizarrón pasaba directo de 'pendiente' a 'hecho'. La migración 031 los borró y los partió en las etapas de verdad (en producción → en bandejas → ciclo completo), porque una pasta armada todavía en el freezer no está lista para vender. La función vieja ya no existe en la base. | `cocina_pizarron_items` |
| `trg_merma_camara_fifo_ins, trg_merma_camara_fifo_upd, trg_merma_camara_fifo_del` | `cocina_merma` | AFTER INSERT / AFTER UPDATE OF porciones, producto_id, fecha, local / AFTER DELETE | Cuando se tira pasta ('se perdió'), la merma se descuenta del lote más viejo, no solamente del total. Antes tirabas una bandeja podrida y el panel te la seguía ofreciendo como la primera que hay que sacar. Las mermas de recetas (salsa, pan, postre) se saltean porque no tienen lote de pasta que descontar. | `cocina_lote_consumos` |
| `cocina_productos_precio_log` | `cocina_productos` | AFTER UPDATE OF precio_venta | Todo cambio de precio de venta de un producto queda anotado solo: precio viejo, precio nuevo, cuánto varió en porcentaje y quién lo hizo. Nadie cambia un precio sin dejar rastro. | `cocina_productos_precio_historial` |
| `trg_sync_precio_venta_salon` | `cocina_productos_precios_canal` | AFTER INSERT OR UPDATE OF precio | El precio del canal 'plato' ES el precio de salón: cuando se cambia ahí, se copia solo al precio de venta del producto. Los otros canales (vianda, congelado) no lo tocan. Una sola fuente para el precio del mostrador. | `cocina_productos` |
| `trg_touch_precios_canal, trg_touch_precios_recetas_canal` | `cocina_productos_precios_canal, cocina_recetas_precios_canal` | BEFORE UPDATE | Cada precio por canal guarda cuándo se modificó por última vez, para poder saber qué tan viejo es el precio de la carta. | — |
| `trg_log_baja_receta` | `cocina_recetas` | BEFORE DELETE | Si se borra una receta entera, antes de que desaparezca se anota la baja de todos sus precios con el nombre y el local. Va en la receta y no en los precios porque el borrado en cascada mata primero a los hijos, y ahí ya no quedaría de dónde sacar el nombre: quedaría un renglón anónimo. | `cocina_recetas_precios_historial` |
| `trg_log_precios_recetas_canal` | `cocina_recetas_precios_canal` | AFTER INSERT OR UPDATE OR DELETE | Toda alta, cambio o baja de un precio de la carta queda anotada: qué receta, de qué local, en qué lista, cuánto valía, cuánto vale, cuánto varió, quién lo tocó y desde dónde (la app, un script con la llave de servicio, o la consola SQL a mano). Si la anotación falla, el precio se guarda igual: el historial nunca frena una edición. | `cocina_recetas_precios_historial` |
| `trg_traspaso_fifo_ins, trg_traspaso_fifo_upd, trg_traspaso_fifo_del` | `cocina_traspasos` | AFTER INSERT / AFTER UPDATE OF porciones, producto_id, fecha, local / AFTER DELETE | Lo que se traslada de la cámara al mostrador sale de los lotes más viejos primero (lo primero que entró es lo primero que sale). Si se corrige o se borra el traslado, el reparto se rehace de cero. Y si no alcanza el stock, no inventa: deja la diferencia sin imputar y la anota, en vez de descontar de un lote que no existe. | `cocina_lote_consumos` |
| `trg_aplicar_baja_empleado` | `empleados` | BEFORE INSERT OR UPDATE | Poner a alguien en baja lo desactiva de verdad y le pone fecha de egreso con la fecha argentina (no UTC), así deja de poder fichar el mismo día. Antes se podía marcar 'baja' y dejar el legajo activo, y la persona seguía fichando. Si la baja se corrige o la persona reingresa, el legajo se reabre solo y se limpian egreso y motivo. | — |
| `trg_medio_pago (11 disparadores con el mismo nombre)` | `gastos, pagos_gastos, pagos_fijos, adelantos, aguinaldos, dividendos, pagos_sueldos, ventas_tickets, ventas_pagos, liquidaciones_quincenales, almacen_pedidos` | BEFORE INSERT OR UPDATE OF medio_pago, medio_pago_id, cuenta | El medio de pago escrito a mano se traduce solo al medio del catálogo y a la cuenta que corresponde (caja, banco, MercadoPago). Lo que alguien cargó a propósito nunca se pisa. Un texto que el diccionario no conoce entra como 'sin especificar' para que los totales cierren igual, y queda a la vista en la lista de lo que falta mapear. En ventas se usa la cuenta de ingreso y en egresos la de egreso: es la misma palabra pero no significa lo mismo. | — |
| `perfiles_no_autoescalar` | `perfiles` | BEFORE UPDATE | Nadie se da permisos a sí mismo. Solo un administrador puede prender o apagar el permiso de admin, cualquier casilla 'puede ver...' y el candado de local. El alta de usuarios que hace el servidor sigue funcionando, porque si no no se podría dar de alta a nadie. | — |
| `productos_costeo_config_touch` | `productos_costeo_config` | BEFORE UPDATE | Cada vez que se toca la configuración de costeo de una categoría (markup, merma, rango de mercado) queda registrada la fecha del cambio, para saber desde cuándo rige ese margen. | — |
| `comprobante_coincide_con_venta` | `ventas_comprobantes` | BEFORE INSERT | No se puede facturar un importe distinto al que se cobró, ni de un local distinto al de la venta. Y las ventas importadas de Fudo no se facturan desde el ERP, porque ya las facturó Fudo: sería emitir dos comprobantes por la misma operación. Las notas de crédito quedan exceptuadas, porque pueden ser por otro importe. | — |
| `comprobante_inmutable` | `ventas_comprobantes` | BEFORE UPDATE OR DELETE | Una factura emitida no se toca ni se borra. Lo único que puede pasarle es que se anule, y sin cambiarle un solo importe, ni el CAE, ni el número, ni la venta a la que pertenece. Si está mal, se emite una nota de crédito: un comprobante fiscal se anula, no se borra. Y mientras todavía no está emitido, tampoco se puede pasar de una venta a otra. | — |
| `trg_ventas_items_vincular` | `ventas_items` | BEFORE INSERT OR UPDATE OF nombre, local, receta_id, cocina_producto_id | Cada renglón vendido se engancha solo al plato de la carta o al producto de cocina que le corresponde, por nombre y por local, mirando solo lo vendible y activo. Si el que graba ya dijo a qué apunta (el POS lo sabe), se respeta. Y si el nombre da para más de un producto, se deja SIN enganchar antes que adivinar mal. Lo resuelve la base al grabar, así la próxima reimportación de Fudo no deja el mes entero desvinculado otra vez. | — |
| `trg_ventas_items_z_precio_de_la_carta` | `ventas_items` | BEFORE INSERT | Un renglón cobrado por la caja propia solo entra al precio que dice la carta de ESA casa, en la lista que corresponda a esa clase de venta (salón, vianda, congelado). Si el precio no coincide, o el plato no está en la carta, o falta configurar la lista, la venta se FRENA con un cartel en criollo. No corrige por atrás a propósito: si corrigiera, el cajero cobraría un importe y el ticket guardaría otro, y al cierre faltaría plata sin explicación. La 'z' del nombre está para que corra después del que engancha el plato. | — |
| `ventas_origen_oficial_sello` | `ventas_origen_oficial` | BEFORE UPDATE | Cada vez que se cambia de qué sistema salen las ventas oficiales de un local (Fudo o la caja propia), queda anotado cuándo y quién lo cambió. Así, meses después, se sabe qué día se cortó Fudo en cada casa. Cortar Fudo es cambiar este renglón, no hacer un deploy. | — |

### 5.2 Restricciones CHECK con sentido de negocio

> ⚠️ Salen de las migraciones. **No hay forma de confirmar desde el archivo que estén**
> **aplicadas** — ver el aviso del principio.

| Tabla | Restricción | Qué prohíbe |
|---|---|---|
| `arca_config` | `(sin nombre)` | Cada local decide si factura todo, nada, o solo según el medio de pago. Y declara si está en homologación o en producción, con CUIT de 11 dígitos y punto de venta entre 1 y 99998. |
| `caja_mesa_lineas` | `(sin nombre)` | En una mesa del salón: se pide más de cero, el precio unitario nunca es negativo, el descuento va de 0 a 100, y el renglón está activo o sacado. Nada más. |
| `caja_mesa_sesiones` | `(sin nombre)` | Una mesa se abre con al menos un comensal, y la sesión está abierta, con la cuenta pedida, cobrada o anulada. No hay otro estado. |
| `cierres_caja` | `cierres_caja_local_check` | Un arqueo es de Vedia, de Saavedra o de la Bienal. El evento tiene su propia caja y no se mezcla con las dos casas. |
| `cierres_caja` | `cierres_caja_origen_check` | Un arqueo lo cerró el cajero desde la caja ('pos') o lo cargó administración a mano ('manual'). De ahí depende si se puede reescribir o no. |
| `cocina_ajustes_stock` | `(sin nombre)` | Un ajuste de stock se hace en la cámara o en el mostrador. No hay un tercer lugar donde ajustar. |
| `cocina_cierre_dia` | `(sin nombre)` | La cantidad contada en el cierre nunca es negativa, y se mide en porciones, kg o unidades — no en cualquier palabra. |
| `cocina_cierre_dia` | `cocina_cierre_dia_target_check` | Un renglón del cierre del día tiene que apuntar a un producto o a una receta. No se cierra sobre la nada. |
| `cocina_lote_consumos` | `(sin nombre)` | Lo que sale de un lote de la cámara solo puede salir por tres puertas: traspaso al mostrador, ajuste de cámara o merma. Y la cantidad que sale siempre es mayor a cero. |
| `cocina_lotes_pasta_masas` | `(sin nombre)` | Una masa aportada a un lote de pasta tiene que pesar más de cero kilos. |
| `cocina_lotes_produccion` | `cocina_lotes_produccion_categoria_check` | Un lote de producción solo puede ser de salsa, postre, pastelería, panadería, pasta, milanesa o prueba. Saavedra usa pasta y milanesa acá porque controla todo con el modelo 'último pesaje manda'. |
| `cocina_lotes_produccion` | `cocina_lotes_produccion_origen_check` | Un lote de producción es 'produccion' (se cocinó de verdad) o 'cierre' (es el recuento físico del mostrador que repisa el stock). Son dos cosas distintas y la base obliga a decir cuál es, porque solo la primera cumple el pizarrón. |
| `cocina_merma` | `cocina_merma_target_check` | Una merma tiene que decir qué se tiró: o un producto de cocina o una receta. Una merma sin sujeto no entra. |
| `cocina_pizarron_items` | `(sin nombre)` | No se puede planificar cero (ni menos que cero) recetas: la cantidad planificada tiene que ser mayor a cero. |
| `cocina_pizarron_items` | `cocina_pizarron_items_estado_check` | Un renglón del pizarrón solo puede estar en uno de cinco estados: pendiente, en producción, en bandejas, ciclo completo o cancelado. No hay estados inventados a mano. |
| `cocina_pizarron_items` | `pizarron_referencia_valida` | Un renglón del plan de producción o apunta a una receta del catálogo, o tiene un texto libre que no esté vacío. Un renglón en blanco no se publica. |
| `cocina_productos` | `(sin nombre)` | Si un producto declara cuántas porciones entran en un cajón, ese número tiene que ser mayor a cero. Un cajón de cero porciones rompería toda la cuenta de traslados. |
| `cocina_productos` | `cocina_productos_pasta_declara_relleno` | Si el producto es una pasta, tiene que declarar SI o NO si lleva relleno. No se admite el 'no sé'. Sin esto el QR volvía a adivinar. |
| `cocina_productos` | `cocina_productos_tipo_check` | Un producto de cocina solo puede ser: pasta, salsa, postre, relleno, masa, panificado, milanesa o bebida. La milanesa es tipo propio, no es pasta. |
| `cocina_productos_precios_canal` | `(sin nombre)` | Un producto se vende por tres canales y nada más: plato, vianda o congelado. Y el precio nunca puede ser negativo. |
| `cocina_recetas` | `(sin nombre)` | El rinde de una receta se mide en kg, litros o unidades. No hay una cuarta unidad. |
| `cocina_recetas` | `cocina_recetas_categoria_check` | La categoría de menú, si está cargada, solo puede ser pasta, pizza, salsa, postre, pastelería, panificado, cafetería, bebida u otros. La pizza es categoría aparte de la pasta. |
| `cocina_recetas` | `cocina_recetas_rol_check` | El rol de una receta (para qué botón del QR sirve) sale de una lista cerrada de 12: relleno, masa, masa_panaderia, salsa_base, postre_base, panificado, pasteleria_base, bebida_base, adicional, packaging, milanesa_base u otros. La masa de panadería es un rol distinto de la masa de pasta. |
| `cocina_recetas` | `cocina_recetas_tipo_check` | Una receta solo puede ser: relleno, masa, salsa, pasta, postre, pastelería, panadería, subreceta, bebida u otro. |
| `cocina_recetas_precios_canal` | `(sin nombre)` | La carta tiene tres listas de precios (plato, vianda, congelado) y ningún precio puede ser negativo. Esta es la tabla que el POS consulta para frenar una venta al precio equivocado. |
| `cocina_recetas_precios_historial` | `(sin nombre)` | En la libreta de precios de la carta, cada movimiento es alta, cambio o baja. No hay una cuarta cosa. |
| `empleados` | `empleados_motivo_baja_check` | Si alguien se va, el motivo tiene que ser uno de estos seis: renuncia, despido, fin de contrato, abandono, acuerdo u otro. |
| `empleados` | `empleados_pin_fichaje_formato` | El PIN de fichaje es exactamente 4 números, sin espacios (o no está cargado todavía). Sin esto, ' 123' y '123 ' convivían como dos personas distintas y el login de fichaje los confundía. |
| `liquidaciones_quincenales` | `liquidaciones_quincenales_medio_pago_check` | Una quincena se paga en efectivo, por transferencia, o mitad y mitad. No hay un cuarto camino. |
| `productos` | `productos_bulto_cantidad_check` | Si un insumo declara en qué formato viene (bolsa de 25 kg, caja de 12), esa cantidad por bulto tiene que ser mayor a cero — si no, el costo unitario daría infinito. |
| `productos_costo_historial` | `(sin nombre)` | Todo cambio de costo de un insumo tiene que decir de dónde salió: cargado a mano, de un renglón de una factura, del sistema, o de una variación que alguien aprobó. Un costo sin origen no se anota. |
| `ventas_comprobantes` | `ventas_comprobantes_cf_anonimo_ck / ventas_comprobantes_identificado_con_nombre_ck / ventas_comprobantes_cuit_largo_ck` | O el cliente es consumidor final sin identificar (y entonces el documento es 0 y no se le pone el nombre de otro), o está identificado (y entonces hay que saber cómo se llama). Y un CUIT tiene 11 dígitos, siempre. |
| `ventas_comprobantes` | `ventas_comprobantes_emitido_completo_ck` | Emitido significa emitido: un comprobante no puede figurar como emitido sin CAE, sin número y sin fecha de vencimiento del CAE. |
| `ventas_comprobantes` | `ventas_comprobantes_factura_a_con_cuit_ck` | Una factura A exige CUIT del cliente. Sin CUIT no hay factura A. |
| `ventas_comprobantes` | `ventas_comprobantes_importes_positivos_ck` | Ningún importe de la factura puede ser negativo, y el total tiene que ser mayor a cero. No se factura por cero ni en contra. |
| `ventas_comprobantes` | `ventas_comprobantes_total_ck` | El total de la factura tiene que ser exactamente neto + IVA + no gravado + exento + otros tributos (con menos de un centavo de diferencia). Si no cierra, ARCA la rechaza. |
| `ventas_comprobantes, clientes_fiscales` | `ventas_comprobantes_cond_iva_ck / ventas_comprobantes_doc_tipo_ck / clientes_fiscales_cond_ck` | La condición de IVA del cliente y el tipo de documento salen de las listas de códigos que ARCA acepta (Responsable Inscripto, Exento, Consumidor Final, Monotributo y el resto de la tabla oficial). Un código inventado se rechaza acá, no en el organismo. |
| `ventas_items` | `ventas_items_padre_no_es_hijo` | Un renglón no puede colgar de sí mismo (la salsa no puede ser su propio plato). |
| `ventas_items` | `ventas_items_pos_con_ticket` | Un renglón cobrado por la caja propia tiene que estar colgado de un ticket. Un renglón suelto no existiría para ningún arqueo. (El histórico de Fudo queda exceptuado: son 82.072 renglones sin ticket.) |
| `ventas_items` | `ventas_items_un_solo_vinculo` | Un renglón vendido apunta a UNA sola cosa del catálogo: o a un plato de la carta, o a un producto de cocina. Nunca a las dos, porque sería contar el mismo plato dos veces en los reportes. |
| `ventas_items, ventas_tickets` | `ventas_items_descuento_pct_check / ventas_items_descuento_monto_check / ventas_tickets_descuento_total_check` | Un descuento va de 0 a 100 por ciento y su importe nunca es negativo. No se puede 'descontar' en contra para inflar una venta. |
| `ventas_pagos` | `ventas_pagos_pos_con_ticket` | Un cobro de la caja propia tiene que estar colgado de un ticket. Plata cobrada sin venta asociada no entra. |
| `ventas_pagos` | `ventas_pagos_pos_local_check` | Un cobro de la caja propia es de Vedia o de Saavedra. Un local con un error de tipeo entraba sin protestar y ese cobro quedaba invisible para el arqueo y para los reportes. |
| `ventas_pagos` | `ventas_pagos_pos_monto_positivo` | Un cobro de la caja propia nunca puede ser negativo. Cierra el truco de hacer desaparecer un faltante de efectivo metiendo un cobro en menos dentro del mismo turno. |
| `ventas_tickets` | `ventas_tickets_fudo_id_requerido` | Si una venta dice que vino de Fudo, tiene que traer el número de Fudo. Las que cobra la caja propia no lo tienen, y está bien. |
| `ventas_tickets, ventas_items, ventas_pagos` | `ventas_tickets_origen_check / ventas_items_origen_check / ventas_pagos_origen_check` | Toda venta, todo renglón y todo cobro dice de dónde salió: importado de Fudo, cobrado por la caja propia, o cargado a mano. De esa palabra dependen el arqueo, la facturación y qué ventas son las oficiales de cada local. |

---

## Lo que este documento no cubre

- **Permisos y RLS.** Nada. Quién puede leer o escribir cada tabla no está acá.
  Para eso está el subagente `rls-auditor` y las tools de Supabase.
- **Si los CHECK están realmente aplicados.** Ver el aviso del principio.
- **Los datos.** Esto describe la forma de la base, no lo que hay adentro.
  Para revisar datos históricos está `docs/diagnostico-montos.sql`.
- **Las 25 duplicaciones que no verifiqué a mano.** Llevan el veredicto del relevamiento.
- **El resto de las duplicaciones que puede haber fuera de la cadena.** El relevamiento
  se concentró en costo → receta → producción → stock → venta → margen, como se pidió.

## Documentos hermanos

- `docs/AUDITORIA.md` — la auditoría de arquitectura del código
- `docs/TRASPASO-MONTOS.md` — la entrada de plata, y por qué el vocabulario es el problema de fondo
- `docs/diagnostico-montos.sql` — consultas de solo lectura sobre los datos históricos
- `CLAUDE.md` — las reglas del proyecto
