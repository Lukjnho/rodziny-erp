-- ============================================================================
--  ⛔ NO EJECUTAR ESTE ARCHIVO. NO ES UNA MIGRACION.
-- ============================================================================
--
--  Es una FOTO del esquema que esta REALMENTE APLICADO en Supabase, generada
--  automaticamente por scripts/graphify/esquema_aplicado.py.
--
--  Para que sirve: el mapa lee los archivos de supabase/migrations/, o sea la
--  base "tal como fue escrita". Esto le da la otra mitad: la base tal como
--  esta. Lo escrito y lo aplicado no son lo mismo (la migracion 072 esta
--  escrita y nunca se aplico).
--
--  Lo que NO trae: las policies de RLS. Eso lo mide scripts/mapa-erp/.
--
--  Generado: 2026-09-11 13:58 -0300
--  93 tablas · 13 vistas · 87 funciones · 116 claves foraneas · 289 indices · 3 realtime (publicaciones)
-- ============================================================================

-- ── TABLAS ──────────────────────────────────────────────────────

create table public.adelantos (
  id uuid not null,
  empleado_id uuid not null,
  periodo text not null,
  fecha date not null,
  monto numeric not null,
  motivo text,
  created_at timestamp with time zone,
  conciliado_movimiento_id uuid,
  medio_pago text,
  numero_operacion text,
  comprobante_path text,
  medio_pago_id uuid,
  cuenta text
);

create table public.agenda_items (
  id uuid not null,
  usuario_id uuid not null,
  titulo text not null,
  tipo text not null,
  fecha_inicio timestamp with time zone not null,
  fecha_fin timestamp with time zone,
  all_day boolean not null,
  prioridad text,
  completado boolean not null,
  completado_at timestamp with time zone,
  recurrencia jsonb,
  nota text,
  created_at timestamp with time zone not null,
  asignados ARRAY not null,
  recordatorio_minutos integer,
  recordatorio_enviado_at timestamp with time zone
);

create table public.aguinaldos (
  id uuid not null,
  empleado_id uuid not null,
  anio integer not null,
  semestre integer not null,
  mejor_sueldo numeric not null,
  dias_trabajados integer not null,
  monto_calculado numeric not null,
  monto_pagado numeric,
  pagado boolean not null,
  fecha_pago date,
  notas text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  medio_pago text,
  gasto_id uuid,
  medio_pago_id uuid,
  cuenta text
);

create table public.almacen_pedidos (
  id uuid not null,
  producto_id uuid,
  producto_nombre text not null,
  cantidad integer not null,
  cliente_nombre text not null,
  cliente_telefono text,
  fecha_pedido date not null,
  fecha_entrega date not null,
  turno text,
  estado text not null,
  lote_id uuid,
  medio_pago text,
  abono boolean,
  vendedor text,
  nro_ticket text,
  observaciones text,
  local text not null,
  created_at timestamp with time zone not null,
  medio_pago_id uuid
);

create table public.amortizaciones (
  id uuid not null,
  gasto_id uuid not null,
  local text not null,
  descripcion text not null,
  fecha_inicio date not null,
  importe_total numeric not null,
  vida_util_meses integer not null,
  cuota_mensual numeric,
  activo boolean,
  created_at timestamp with time zone
);

create table public.arca_config (
  local text not null,
  cuit_emisor text not null,
  punto_venta integer not null,
  ambiente text not null,
  razon_social text not null,
  domicilio_comercial text,
  ingresos_brutos text,
  inicio_actividades date,
  activo boolean not null,
  modo_facturacion text not null,
  actualizado_at timestamp with time zone not null
);

create table public.arca_tokens (
  cuit text not null,
  servicio text not null,
  ambiente text not null,
  token text not null,
  sign text not null,
  generado_at timestamp with time zone not null,
  expira_at timestamp with time zone not null,
  guardado_at timestamp with time zone not null
);

create table public.bonos (
  id uuid not null,
  empleado_id uuid not null,
  periodo text not null,
  fecha date not null,
  monto numeric not null,
  motivo text not null,
  created_at timestamp with time zone not null
);

create table public.caja_canal_precio (
  tipo_venta text not null,
  canal text not null
);

create table public.caja_mesa_envios (
  id uuid not null,
  local text not null,
  sesion_id uuid not null,
  numero integer not null,
  enviado_en timestamp with time zone not null,
  enviado_por uuid,
  impreso_en timestamp with time zone
);

create table public.caja_mesa_lineas (
  id uuid not null,
  local text not null,
  sesion_id uuid not null,
  envio_id uuid,
  padre_id uuid,
  linea integer not null,
  receta_id uuid not null,
  nombre text not null,
  categoria text,
  cantidad numeric not null,
  precio_unitario numeric not null,
  descuento_pct numeric not null,
  estado text not null,
  sacada_en timestamp with time zone,
  sacada_por uuid,
  sacada_motivo text,
  ticket_id uuid,
  agregada_en timestamp with time zone not null,
  agregada_por uuid
);

create table public.caja_mesa_sesiones (
  id uuid not null,
  local text not null,
  mesa_id uuid not null,
  comensales integer not null,
  estado text not null,
  abierta_en timestamp with time zone not null,
  abierta_por uuid,
  cuenta_pedida_en timestamp with time zone,
  cuenta_pedida_por uuid,
  cerrada_en timestamp with time zone,
  anulada_motivo text,
  nota text
);

create table public.caja_mesas (
  id uuid not null,
  local text not null,
  sala_id uuid not null,
  numero text not null,
  capacidad integer,
  forma text not null,
  pos_x numeric not null,
  pos_y numeric not null,
  ancho numeric not null,
  alto numeric not null,
  activo boolean not null
);

create table public.caja_salas (
  id uuid not null,
  local text not null,
  nombre text not null,
  orden integer not null,
  activo boolean not null
);

create table public.categorias_gasto (
  id uuid not null,
  nombre text not null,
  parent_id uuid,
  tipo_edr text not null,
  activo boolean not null,
  orden integer,
  created_at timestamp with time zone not null
);

create table public.cierres_caja (
  id uuid not null,
  local text not null,
  fecha date not null,
  turno text,
  caja text,
  monto_esperado numeric,
  monto_contado numeric not null,
  diferencia numeric,
  nota text,
  creado_por text,
  created_at timestamp with time zone,
  verificado boolean,
  verificado_por text,
  verificado_at timestamp with time zone,
  fondo_apertura numeric,
  fondo_siguiente numeric,
  retiro numeric,
  otros_retiros numeric not null,
  otros_retiros_nota text,
  hora_inicio time without time zone,
  hora_cierre time without time zone,
  fudo_efectivo numeric not null,
  fudo_qr numeric not null,
  fudo_debito numeric not null,
  fudo_credito numeric not null,
  fudo_transferencia numeric not null,
  cajero_nombre text,
  fudo_mp_lucas numeric not null,
  dividendo_id uuid,
  monto_llevado_caja_fuerte numeric,
  nota_caja_fuerte text,
  nro_arqueo_fudo text,
  retiro_cambio numeric,
  retiro_pagos numeric,
  origen text not null
);

create table public.cierres_caja_medios (
  id uuid not null,
  cierre_caja_id uuid not null,
  medio_pago_id uuid not null,
  esperado numeric not null,
  declarado numeric not null,
  diferencia numeric,
  created_at timestamp with time zone not null
);

create table public.cierres_mes (
  id uuid not null,
  local text not null,
  periodo text not null,
  cerrado_at timestamp with time zone not null,
  cerrado_por text,
  notas text
);

create table public.cierres_mes_overrides (
  id uuid not null,
  local text not null,
  periodo text not null,
  checkpoint_key text not null,
  marcado_at timestamp with time zone not null,
  marcado_por text,
  motivo text
);

create table public.clientes_fiscales (
  id uuid not null,
  doc_tipo smallint not null,
  doc_nro text not null,
  nombre text not null,
  condicion_iva smallint not null,
  domicilio text,
  email text,
  notas text,
  creado_at timestamp with time zone not null
);

create table public.cocina_ajustes_stock (
  id uuid not null,
  fecha date not null,
  local text not null,
  producto_id uuid not null,
  ubicacion text not null,
  delta numeric not null,
  motivo text,
  responsable text,
  created_at timestamp with time zone not null
);

create table public.cocina_cierre_camara (
  id uuid not null,
  producto_id uuid not null,
  local text not null,
  fecha date not null,
  cantidad_real numeric not null,
  responsable text,
  notas text,
  created_at timestamp with time zone not null
);

create table public.cocina_cierre_dia (
  id uuid not null,
  fecha date not null,
  local text not null,
  producto_id uuid,
  tipo text not null,
  turno text,
  cantidad_real numeric not null,
  unidad text not null,
  inicial numeric,
  entrega numeric,
  vendido numeric,
  responsable text,
  notas text,
  created_at timestamp with time zone not null,
  receta_id uuid
);

create table public.cocina_lote_consumos (
  id uuid not null,
  lote_pasta_id uuid not null,
  tipo text not null,
  cantidad numeric not null,
  origen_tabla text not null,
  origen_id uuid,
  fecha date not null,
  local text not null,
  notas text,
  created_at timestamp with time zone not null
);

create table public.cocina_lotes_masa (
  id uuid not null,
  receta_id uuid,
  fecha date not null,
  kg_producidos numeric not null,
  kg_sobrante numeric,
  destino_sobrante text,
  responsable text,
  local text not null,
  notas text,
  created_at timestamp with time zone not null,
  ingredientes_reales jsonb,
  excluido_analisis boolean not null
);

create table public.cocina_lotes_pasta (
  id uuid not null,
  producto_id uuid not null,
  lote_relleno_id uuid,
  fecha date not null,
  codigo_lote text not null,
  receta_masa_id uuid,
  masa_kg numeric,
  relleno_kg numeric,
  porciones integer,
  responsable text,
  local text not null,
  notas text,
  created_at timestamp with time zone not null,
  lote_masa_id uuid,
  ubicacion text not null,
  cantidad_cajones integer,
  fecha_porcionado date,
  responsable_porcionado text,
  merma_porcionado integer not null,
  muzzarella_gramos integer,
  sobrante_gramos numeric,
  sobrante_origen_lote_id uuid,
  semolin_gramos integer,
  huevo_gramos integer,
  porcionado_at timestamp with time zone
);

create table public.cocina_lotes_pasta_masas (
  id uuid not null,
  lote_pasta_id uuid not null,
  lote_masa_id uuid not null,
  masa_kg numeric not null,
  created_at timestamp with time zone not null
);

create table public.cocina_lotes_produccion (
  id uuid not null,
  fecha date not null,
  local text not null,
  categoria text not null,
  receta_id uuid,
  nombre_libre text,
  cantidad_producida numeric not null,
  unidad text not null,
  merma_cantidad numeric,
  merma_motivo text,
  responsable text,
  notas text,
  created_at timestamp with time zone not null,
  ingredientes_reales jsonb,
  en_stock boolean not null,
  cantidad_restante_manual numeric,
  origen text not null,
  excluido_analisis boolean not null
);

create table public.cocina_lotes_relleno (
  id uuid not null,
  receta_id uuid,
  fecha date not null,
  cantidad_recetas integer not null,
  peso_total_kg numeric not null,
  responsable text,
  local text not null,
  notas text,
  created_at timestamp with time zone not null,
  ingredientes_reales jsonb,
  excluido_analisis boolean not null,
  bolsas numeric,
  kg_papa numeric
);

create table public.cocina_merma (
  id uuid not null,
  producto_id uuid,
  fecha date not null,
  porciones numeric not null,
  motivo text,
  responsable text,
  local text not null,
  notas text,
  created_at timestamp with time zone not null,
  receta_id uuid
);

create table public.cocina_pasta_recetas (
  id uuid not null,
  pasta_id uuid not null,
  receta_id uuid not null,
  created_at timestamp with time zone not null
);

create table public.cocina_pizarron_items (
  id uuid not null,
  fecha_objetivo date not null,
  local text not null,
  turno text,
  tipo text not null,
  receta_id uuid,
  texto_libre text,
  cantidad_recetas numeric not null,
  estado text not null,
  lote_tabla text,
  lote_id uuid,
  cantidad_hecha numeric,
  completado_en timestamp with time zone,
  notas text,
  publicado_por uuid,
  publicado_en timestamp with time zone not null,
  created_at timestamp with time zone not null,
  destino_producto_id uuid
);

create table public.cocina_productos (
  id uuid not null,
  nombre text not null,
  codigo text not null,
  tipo text not null,
  unidad text not null,
  minimo_produccion numeric,
  local text not null,
  activo boolean not null,
  created_at timestamp with time zone not null,
  congelable boolean,
  tiempo_anticipacion_hs integer,
  disponible_almacen boolean,
  receta_id uuid,
  precio_venta numeric,
  fudo_nombres ARRAY not null,
  es_ancla boolean not null,
  insumo_reventa_id uuid,
  controla_stock boolean not null,
  ml_por_venta numeric,
  es_mixto boolean not null,
  masa_id uuid,
  lleva_relleno boolean
);

create table public.cocina_productos_precio_historial (
  id uuid not null,
  cocina_producto_id uuid not null,
  precio_anterior numeric,
  precio_nuevo numeric,
  variacion_pct numeric,
  fecha timestamp with time zone not null,
  usuario text,
  motivo text
);

create table public.cocina_productos_precios_canal (
  id uuid not null,
  cocina_producto_id uuid not null,
  canal text not null,
  precio numeric not null,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);

create table public.cocina_receta_ingredientes (
  id uuid not null,
  receta_id uuid not null,
  nombre text not null,
  cantidad numeric not null,
  unidad text not null,
  observaciones text,
  orden integer not null,
  created_at timestamp with time zone not null,
  producto_id uuid
);

create table public.cocina_recetas (
  id uuid not null,
  nombre text not null,
  tipo text not null,
  rendimiento_kg numeric,
  rendimiento_porciones numeric,
  instrucciones text,
  activo boolean not null,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  local text,
  margen_seguridad_pct numeric,
  gramos_por_porcion integer,
  fudo_productos ARRAY,
  rendimiento_unidad text not null,
  g_semolin_por_kg numeric,
  g_huevo_por_kg numeric,
  minutos_lote numeric,
  vendible boolean not null,
  categoria text,
  rol text,
  subcategoria text,
  ingredientes_armado jsonb,
  kg_por_bolsa numeric,
  descuenta_producto_id uuid
);

create table public.cocina_recetas_precios_canal (
  id uuid not null,
  receta_id uuid not null,
  canal text not null,
  precio numeric not null,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);

create table public.cocina_recetas_precios_historial (
  id uuid not null,
  receta_id uuid not null,
  receta_nombre text,
  local text,
  canal text not null,
  accion text not null,
  precio_anterior numeric,
  precio_nuevo numeric,
  variacion_pct numeric,
  fecha timestamp with time zone not null,
  usuario text,
  usuario_id uuid,
  origen text,
  motivo text
);

create table public.cocina_traspasos (
  id uuid not null,
  producto_id uuid not null,
  fecha date not null,
  hora time without time zone,
  porciones integer not null,
  responsable text,
  local text not null,
  notas text,
  created_at timestamp with time zone not null,
  cantidad_cajones integer
);

create table public.comision_mp_config (
  medio_pago text not null,
  pct numeric not null,
  descripcion text,
  actualizado timestamp with time zone not null
);

create table public.comprobantes (
  id uuid not null,
  hash_archivo text not null,
  file_path text not null,
  mime_type text,
  tamano_bytes integer,
  subido_por uuid,
  subido_at timestamp with time zone not null,
  ocr_status text not null,
  ocr_raw jsonb,
  ocr_extraido jsonb,
  n_operacion text,
  cuit_emisor text,
  monto_extraido numeric,
  fecha_extraida date,
  gasto_id uuid,
  duplicado_de uuid,
  estado text not null
);

create table public.configuracion (
  clave text not null,
  valor jsonb not null,
  updated_at timestamp with time zone not null
);

create table public.convenios (
  id uuid not null,
  local text not null,
  fudo_customer_id text,
  nombre text not null,
  descuento_pct numeric,
  tipo text,
  contacto text,
  beneficios_extra text,
  vigencia_desde date,
  vigencia_hasta date,
  estado text not null,
  notas text,
  activo boolean not null,
  created_at timestamp with time zone not null
);

create table public.correo_integracion (
  id smallint not null,
  proveedor text not null,
  email_casilla text,
  refresh_token text,
  access_token text,
  token_expira_en timestamp with time zone,
  conectado boolean not null,
  oauth_state text,
  ultima_lectura timestamp with time zone,
  ultimo_error text,
  updated_at timestamp with time zone not null
);

create table public.cronograma (
  id uuid not null,
  empleado_id uuid not null,
  fecha date not null,
  hora_entrada time without time zone,
  hora_salida time without time zone,
  es_franco boolean not null,
  publicado boolean not null,
  created_by uuid,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  turnos jsonb not null,
  observaciones text
);

create table public.descuentos (
  id uuid not null,
  empleado_id uuid not null,
  periodo text not null,
  fecha date not null,
  monto numeric not null,
  motivo text not null,
  created_at timestamp with time zone not null
);

create table public.dividendos (
  id uuid not null,
  socio text not null,
  fecha date not null,
  monto numeric not null,
  medio_pago text not null,
  concepto text,
  local text,
  periodo text not null,
  creado_por text,
  created_at timestamp with time zone,
  numero_operacion text,
  comprobante_path text,
  conciliado_movimiento_id uuid,
  medio_pago_id uuid,
  cuenta text
);

create table public.edr_cierres_inventario (
  id uuid not null,
  local text not null,
  periodo text not null,
  fecha_cierre timestamp with time zone not null,
  monto_alimentos numeric not null,
  monto_bebidas numeric not null,
  monto_indirectos numeric not null,
  productos_sin_clasificar integer not null,
  estado text not null,
  cerrado_por text,
  observaciones text,
  aprobado_por text,
  aprobado_at timestamp with time zone,
  observacion_aprobacion text,
  created_at timestamp with time zone not null
);

create table public.edr_partidas (
  id uuid not null,
  local text not null,
  periodo text not null,
  concepto text not null,
  monto numeric not null,
  updated_at timestamp with time zone
);

create table public.efemerides_gastronomicas (
  id uuid not null,
  mes integer,
  dia integer not null,
  nombre text not null,
  descripcion text,
  categoria text not null,
  idea_plato text,
  activo boolean not null,
  created_at timestamp with time zone not null
);

create table public.empleados (
  id uuid not null,
  nombre text not null,
  apellido text not null,
  dni text not null,
  telefono text,
  email text,
  puesto text not null,
  local text not null,
  fecha_ingreso date not null,
  sueldo_neto numeric not null,
  horario_tipo text not null,
  estado_laboral text not null,
  fecha_efectivizacion date,
  activo boolean not null,
  pin_fichaje text,
  observaciones text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  modalidad_cobro text not null,
  manipulacion_alimentos_vence date,
  certificado_domicilio boolean not null,
  certificado_domicilio_fecha date,
  horas_semanales_requeridas integer,
  es_produccion boolean not null,
  cbu text,
  alias_bancario text,
  cuenta_sueldo boolean not null,
  fecha_egreso date,
  motivo_baja text
);

create table public.extractos_estado (
  cuenta text not null,
  al_dia_hasta date not null,
  actualizado_por uuid,
  actualizado_en timestamp with time zone not null
);

create table public.fichadas (
  id uuid not null,
  empleado_id uuid not null,
  fecha date not null,
  tipo text not null,
  "timestamp" timestamp with time zone not null,
  local text not null,
  lat numeric,
  lng numeric,
  foto_path text,
  minutos_diferencia integer,
  origen text not null,
  observaciones text,
  created_at timestamp with time zone not null,
  evento text
);

create table public.fudo_sync_runs (
  id uuid not null,
  local text not null,
  anio text not null,
  started_at timestamp with time zone not null,
  finished_at timestamp with time zone,
  status text not null,
  tickets_importados integer not null,
  dividendos_importados integer not null,
  errores jsonb not null,
  error_msg text,
  iniciado_por text
);

create table public.fudo_tokens (
  local text not null,
  token text not null,
  exp bigint not null,
  actualizado_at timestamp with time zone not null
);

create table public.gastos (
  id uuid not null,
  local text,
  fudo_id text,
  fecha date not null,
  proveedor text,
  categoria text,
  subcategoria text,
  comentario text,
  estado_pago text,
  importe_total numeric not null,
  importe_neto numeric,
  iva numeric,
  iibb numeric,
  medio_pago text,
  tipo_comprobante text,
  nro_comprobante text,
  de_caja boolean,
  cancelado boolean,
  periodo text not null,
  fecha_vencimiento date,
  proveedor_id uuid,
  categoria_id uuid,
  comprobante_path text,
  recepcion_id uuid,
  punto_venta text,
  creado_por text,
  creado_manual boolean,
  items_json jsonb,
  factura_path text,
  regla_id uuid,
  comprobante_id uuid,
  aprobado_por uuid,
  aprobado_at timestamp with time zone,
  created_at timestamp with time zone not null,
  medio_pago_id uuid,
  cuenta text
);

create table public.gastos_backfill_proveedor_id_log (
  id uuid not null,
  gasto_id uuid not null,
  proveedor_id_anterior uuid,
  proveedor_id_nuevo uuid not null,
  texto_gasto text,
  score integer,
  match_label text,
  batch_label text not null,
  aplicado_at timestamp with time zone
);

create table public.impuestos_mensuales (
  id uuid not null,
  periodo text not null,
  f931_path text,
  libro_path text,
  monto_total numeric not null,
  pagado boolean,
  fecha_pago date,
  observaciones text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
);

create table public.liquidaciones_quincenales (
  id uuid not null,
  empleado_id uuid not null,
  periodo text not null,
  cobra_presentismo boolean not null,
  pagado boolean not null,
  fecha_pago date,
  observaciones text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  medio_pago text,
  medio_pago_id uuid
);

create table public.medios_pago (
  id uuid not null,
  codigo text not null,
  nombre text not null,
  es_efectivo boolean not null,
  cuenta_default_egreso text,
  aplica_ventas boolean not null,
  aplica_egresos boolean not null,
  activo boolean not null,
  orden integer not null,
  created_at timestamp with time zone,
  cuenta_default_venta text,
  factura_automatica boolean not null,
  es_dividendo boolean not null
);

create table public.medios_pago_alias (
  alias text not null,
  medio_codigo text not null,
  cuenta text,
  nota text
);

create table public.movimientos_bancarios (
  id uuid not null,
  cuenta text not null,
  fecha date not null,
  descripcion text,
  debito numeric,
  credito numeric,
  saldo numeric,
  categoria text,
  local text,
  es_dividendo boolean,
  referencia text,
  periodo text not null,
  fuente text not null,
  es_transferencia_interna boolean,
  tipo text,
  gasto_id uuid,
  transferencia_par_id uuid,
  sugerencia text,
  sugerencia_regla_id uuid
);

create table public.movimientos_stock (
  id uuid not null,
  local text not null,
  producto_id uuid,
  producto_nombre text not null,
  tipo text not null,
  cantidad numeric not null,
  unidad text not null,
  motivo text,
  observacion text,
  registrado_por text,
  created_at timestamp with time zone,
  cantidad_sin_stock numeric
);

create table public.mp_release_reports (
  id uuid not null,
  begin_date date not null,
  end_date date not null,
  status text not null,
  mp_post_id bigint,
  mp_list_id bigint,
  file_name text,
  payouts_insertados integer,
  cargos_insertados integer,
  filas_csv integer,
  filas_ignoradas integer,
  error_msg text,
  created_at timestamp with time zone not null,
  processed_at timestamp with time zone,
  poll_intentos integer
);

create table public.mp_sync_runs (
  id uuid not null,
  started_at timestamp with time zone not null,
  finished_at timestamp with time zone,
  desde date not null,
  hasta date not null,
  meses_procesados integer not null,
  payments_encontrados integer not null,
  movs_principales_nuevos integer not null,
  movs_principales_existentes integer not null,
  charges_nuevos integer not null,
  charges_existentes integer not null,
  conciliados integer not null,
  errores jsonb not null,
  detalle_meses jsonb not null,
  status text not null
);

create table public.pagos_fijos (
  id uuid not null,
  periodo text not null,
  concepto text not null,
  categoria text not null,
  categoria_gasto_id uuid,
  monto numeric,
  fecha_vencimiento date,
  pagado boolean not null,
  fecha_pago date,
  medio_pago text,
  gasto_id uuid,
  notas text,
  created_at timestamp with time zone not null,
  comprobante_path text,
  local text not null,
  vep_numero text,
  medio_pago_id uuid,
  cuenta text
);

create table public.pagos_gastos (
  id uuid not null,
  gasto_id uuid not null,
  fecha_pago date not null,
  monto numeric not null,
  medio_pago text not null,
  referencia text,
  comprobante_pago_path text,
  conciliado_movimiento_id uuid,
  notas text,
  creado_por text,
  created_at timestamp with time zone not null,
  descuento numeric not null,
  numero_operacion text,
  programado boolean not null,
  medio_pago_id uuid,
  cuenta text
);

create table public.pagos_mp (
  id bigint not null,
  fecha timestamp with time zone not null,
  fecha_aprobado timestamp with time zone,
  monto numeric not null,
  monto_neto numeric,
  comision_mp numeric,
  impuestos numeric,
  medio_pago text,
  metodo_pago text,
  estado text not null,
  descripcion text,
  store_id bigint,
  pos_id bigint,
  local text,
  periodo text not null,
  referencia_externa text,
  sincronizado_at timestamp with time zone
);

create table public.pagos_sueldos (
  id uuid not null,
  empleado_id uuid not null,
  periodo text not null,
  fecha_pago date not null,
  monto numeric not null,
  medio_pago text not null,
  local text not null,
  empleado_nombre text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  cuenta text,
  numero_operacion text,
  comprobante_pago_path text,
  conciliado_movimiento_id uuid,
  medio_pago_id uuid
);

create table public.perfiles (
  user_id uuid not null,
  nombre text not null,
  es_admin boolean not null,
  puede_ver_dashboard boolean not null,
  puede_ver_ventas boolean not null,
  puede_ver_finanzas boolean not null,
  puede_ver_edr boolean not null,
  puede_ver_gastos boolean not null,
  puede_ver_amortizaciones boolean not null,
  puede_ver_rrhh boolean not null,
  puede_ver_compras boolean not null,
  puede_ver_usuarios boolean not null,
  created_at timestamp with time zone,
  puede_ver_cocina boolean,
  puede_ver_almacen boolean,
  local_restringido text,
  puede_ver_flujo_caja boolean not null,
  puede_ver_productos boolean not null,
  puede_ver_agenda boolean not null,
  puede_ver_convenios boolean not null,
  puede_ver_integraciones boolean not null,
  puede_ver_alertas_finanzas boolean not null,
  puede_ver_caja boolean not null,
  puede_ver_salon boolean not null,
  puede_anular_ventas boolean not null,
  puede_ver_esperado_caja boolean not null
);

create table public.productos (
  id uuid not null,
  local text not null,
  fudo_id text,
  categoria text not null,
  nombre text not null,
  unidad text not null,
  stock_actual numeric,
  stock_minimo numeric,
  proveedor text,
  costo_unitario numeric,
  activo boolean,
  updated_at timestamp with time zone,
  categoria_gasto_id uuid,
  marca text,
  merma_pct numeric not null,
  es_packaging boolean not null,
  contenido_ml numeric,
  bulto_cantidad numeric,
  bulto_nombre text
);

create table public.productos_acciones_estado (
  id uuid not null,
  accion_key text not null,
  tipo text not null,
  local text not null,
  producto_codigo text,
  producto_nombre text,
  estado text not null,
  precio_objetivo numeric,
  nota text,
  usuario_id uuid,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);

create table public.productos_costeo_config (
  categoria text not null,
  margen_min numeric not null,
  redondeo numeric not null,
  descripcion text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  margen_colchon numeric not null
);

create table public.productos_costo_historial (
  id uuid not null,
  producto_id uuid not null,
  costo_anterior numeric,
  costo_nuevo numeric not null,
  variacion_pct numeric,
  fuente text not null,
  gasto_id uuid,
  usuario text,
  comentario text,
  fecha timestamp with time zone not null
);

create table public.proveedores (
  id uuid not null,
  razon_social text not null,
  cuit text,
  condicion_iva text,
  categoria_default_id uuid,
  medio_pago_default text,
  dias_pago integer,
  contacto text,
  telefono text,
  email text,
  activo boolean not null,
  notas text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  nombre_comercial text,
  aliases ARRAY,
  cuits_alt ARRAY,
  medio_pago_default_id uuid
);

create table public.proyeccion_config (
  id integer not null,
  saldo_operativa_inicial numeric not null,
  saldo_reserva_inicial numeric not null,
  fecha_saldo date not null,
  cmv_pct_override numeric,
  meses_promedio integer not null,
  updated_at timestamp with time zone not null
);

create table public.proyeccion_flujo_items (
  id uuid not null,
  periodo text not null,
  concepto text not null,
  tipo text not null,
  cuenta text not null,
  monto numeric not null,
  nota text,
  created_at timestamp with time zone not null
);

create table public.push_subscriptions (
  id uuid not null,
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamp with time zone not null
);

create table public.recepciones_pendientes (
  id uuid not null,
  local text not null,
  proveedor text,
  items jsonb not null,
  registrado_por text,
  notas text,
  foto_path text,
  estado text not null,
  validada_en timestamp with time zone,
  validada_por text,
  notas_validacion text,
  created_at timestamp with time zone not null,
  gasto_id uuid
);

create table public.recibos_sueldo (
  id uuid not null,
  empleado_id uuid,
  cuil_detectado text,
  nombre_detectado text,
  periodo text,
  monto_neto numeric,
  archivo_path text not null,
  message_id text,
  created_at timestamp with time zone not null,
  bruto numeric,
  aporte_jubilacion numeric,
  aporte_obra_social numeric,
  aporte_pami numeric,
  total_aportes numeric
);

create table public.reglas_movimiento (
  id uuid not null,
  nombre text not null,
  patron text not null,
  cuenta text,
  signo text not null,
  proveedor text not null,
  subcategoria text,
  categoria_gasto_id uuid,
  agrupacion text not null,
  prioridad integer not null,
  activo boolean not null,
  notas text,
  creado_at timestamp with time zone not null,
  updated_at timestamp with time zone,
  accion text not null
);

create table public.saldos_cuentas (
  id uuid not null,
  cuenta text not null,
  fecha date not null,
  saldo numeric not null,
  fuente text not null,
  created_at timestamp with time zone not null
);

create table public.sanciones (
  id uuid not null,
  empleado_id uuid not null,
  periodo text not null,
  fecha date not null,
  monto numeric not null,
  motivo text not null,
  created_at timestamp with time zone
);

create table public.sueldos_mensuales (
  id uuid not null,
  empleado_id uuid not null,
  periodo text not null,
  sueldo_recibo numeric not null,
  plus_mano numeric not null,
  presentismo_pagado boolean not null,
  fecha_pago date,
  observaciones text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);

create table public.vacaciones (
  id uuid not null,
  empleado_id uuid not null,
  fecha_desde date not null,
  fecha_hasta date not null,
  dias_corridos integer not null,
  anio_correspondiente integer not null,
  estado text not null,
  motivo text,
  aprobado_por text,
  notas text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);

create table public.ventas_comprobantes (
  id uuid not null,
  ticket_id uuid not null,
  local text not null,
  tipo_comprobante smallint not null,
  punto_venta integer not null,
  concepto smallint not null,
  receptor_doc_tipo smallint not null,
  receptor_doc_nro text not null,
  receptor_nombre text,
  receptor_condicion_iva smallint not null,
  receptor_domicilio text,
  imp_neto numeric not null,
  imp_iva numeric not null,
  imp_tot_conc numeric not null,
  imp_op_ex numeric not null,
  imp_trib numeric not null,
  imp_total numeric not null,
  iva_detalle jsonb not null,
  fecha_comprobante date not null,
  numero bigint,
  cae text,
  cae_vencimiento date,
  observaciones jsonb,
  estado text not null,
  intentos integer not null,
  ultimo_error text,
  arca_request jsonb,
  arca_response jsonb,
  ambiente text not null,
  anula_comprobante_id uuid,
  solicitud text not null,
  creado_at timestamp with time zone not null,
  creado_por uuid,
  emitido_at timestamp with time zone
);

create table public.ventas_items (
  id uuid not null,
  local text not null,
  periodo text not null,
  codigo text,
  categoria text,
  subcategoria text,
  nombre text not null,
  cantidad numeric not null,
  total numeric not null,
  ticket_id uuid,
  fecha date,
  linea integer,
  linea_padre_id uuid,
  vinculo_origen text,
  receta_id uuid,
  cocina_producto_id uuid,
  precio_unitario numeric,
  origen text not null,
  descuento_pct numeric not null,
  descuento_monto numeric not null
);

create table public.ventas_mensuales_historico (
  local text not null,
  periodo text not null,
  total_bruto numeric not null,
  fuente text not null,
  updated_at timestamp with time zone not null
);

create table public.ventas_origen_oficial (
  local text not null,
  origen text not null,
  actualizado_en timestamp with time zone not null,
  actualizado_por uuid
);

create table public.ventas_pagos (
  id uuid not null,
  local text not null,
  periodo text not null,
  fudo_ticket_id text not null,
  fecha date,
  medio_pago text not null,
  monto numeric not null,
  tipo_venta text,
  caja text,
  es_dividendo boolean,
  medio_pago_id uuid,
  cuenta text,
  ticket_id uuid,
  origen text not null
);

create table public.ventas_tickets (
  id uuid not null,
  local text not null,
  fudo_id text,
  fecha date not null,
  hora time without time zone,
  caja text,
  estado text,
  tipo_venta text,
  medio_pago text,
  total_bruto numeric not null,
  total_neto numeric,
  iva numeric,
  es_fiscal boolean,
  periodo text not null,
  es_dividendo boolean,
  medio_pago_id uuid,
  cuenta text,
  origen text not null,
  cierre_caja_id uuid,
  cliente text,
  descuento_total numeric not null,
  convenio_id uuid,
  idempotencia uuid,
  cobro_huella text
);

create table public.veps (
  id uuid not null,
  descripcion text,
  impuesto text,
  periodo text,
  vencimiento date,
  monto numeric,
  archivo_path text,
  pagado boolean not null,
  fecha_pago date,
  message_id text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);

-- ── VISTAS ──────────────────────────────────────────────────────

create view public.v_cocina_lote_pasta_saldo as SELECT id AS lote_pasta_id,
    producto_id,
    local,
    fecha AS fecha_armado,
    fecha_porcionado,
    ubicacion,
    porciones AS porciones_iniciales,
    lote_relleno_id,
    lote_masa_id,
    responsable AS responsable_armado,
    responsable_porcionado,
    COALESCE(( SELECT sum(lc.cantidad) AS sum
           FROM cocina_lote_consumos lc
          WHERE ((lc.lote_pasta_id = lp.id) AND (lc.tipo = 'traspaso'::text))), (0)::numeric) AS porciones_a_mostrador,
    COALESCE(( SELECT sum(lc.cantidad) AS sum
           FROM cocina_lote_consumos lc
          WHERE ((lc.lote_pasta_id = lp.id) AND (lc.tipo = 'merma_camara'::text))), (0)::numeric) AS porciones_merma_camara,
    COALESCE(( SELECT sum(lc.cantidad) AS sum
           FROM cocina_lote_consumos lc
          WHERE ((lc.lote_pasta_id = lp.id) AND (lc.tipo = 'ajuste_camara'::text))), (0)::numeric) AS porciones_ajuste_camara,
    GREATEST(((porciones)::numeric - COALESCE(( SELECT sum(lc.cantidad) AS sum
           FROM cocina_lote_consumos lc
          WHERE (lc.lote_pasta_id = lp.id)), (0)::numeric)), (0)::numeric) AS saldo_camara
   FROM cocina_lotes_pasta lp
  WHERE ((ubicacion = 'camara_congelado'::text) OR (ubicacion = 'freezer_produccion'::text));

create view public.v_cocina_stock_mostrador as WITH cierre AS (
         SELECT DISTINCT ON (cocina_cierre_dia.producto_id, cocina_cierre_dia.local) cocina_cierre_dia.producto_id,
            cocina_cierre_dia.local,
            cocina_cierre_dia.cantidad_real,
            cocina_cierre_dia.created_at,
            cocina_cierre_dia.fecha,
            cocina_cierre_dia.turno
           FROM cocina_cierre_dia
          WHERE ((cocina_cierre_dia.tipo = 'pasta'::text) AND (cocina_cierre_dia.producto_id IS NOT NULL))
          ORDER BY cocina_cierre_dia.producto_id, cocina_cierre_dia.local, cocina_cierre_dia.created_at DESC
        ), base AS (
         SELECT p.id AS producto_id,
            p.nombre,
            p.local,
            p.codigo,
            c.cantidad_real AS conteo_base,
            c.created_at AS ultimo_conteo_at,
            c.fecha AS ultimo_conteo_fecha,
            c.turno AS ultimo_conteo_turno,
            COALESCE((c.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires'::text), (((now() AT TIME ZONE 'America/Argentina/Buenos_Aires'::text))::date)::timestamp without time zone) AS corte
           FROM (cocina_productos p
             LEFT JOIN cierre c ON (((c.producto_id = p.id) AND (c.local = p.local))))
          WHERE ((p.tipo = 'pasta'::text) AND (p.activo = true))
        )
 SELECT b.producto_id,
    b.nombre,
    b.codigo,
    b.local,
    COALESCE(b.conteo_base, (0)::numeric) AS conteo_base,
    b.ultimo_conteo_at,
    b.ultimo_conteo_fecha,
    b.ultimo_conteo_turno,
    (b.ultimo_conteo_at IS NULL) AS sin_conteo,
    (COALESCE(tr.n, (0)::bigint))::numeric AS traspasos_post,
    COALESCE(ve.n, (0)::numeric) AS ventas_post,
    COALESCE(me.n, (0)::numeric) AS merma_post,
    COALESCE(aj.n, (0)::numeric) AS ajustes_post,
    GREATEST((0)::numeric, ((((COALESCE(b.conteo_base, (0)::numeric) + (COALESCE(tr.n, (0)::bigint))::numeric) - COALESCE(ve.n, (0)::numeric)) - COALESCE(me.n, (0)::numeric)) + COALESCE(aj.n, (0)::numeric))) AS porciones_mostrador,
    ((((COALESCE(b.conteo_base, (0)::numeric) + (COALESCE(tr.n, (0)::bigint))::numeric) - COALESCE(ve.n, (0)::numeric)) - COALESCE(me.n, (0)::numeric)) + COALESCE(aj.n, (0)::numeric)) AS porciones_mostrador_crudo
   FROM ((((base b
     LEFT JOIN LATERAL ( SELECT sum(t.porciones) AS n
           FROM cocina_traspasos t
          WHERE ((t.producto_id = b.producto_id) AND (t.local = b.local) AND ((t.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires'::text) > b.corte))) tr ON (true))
     LEFT JOIN LATERAL ( SELECT sum(vi.cantidad) AS n
           FROM ((ventas_items vi
             JOIN ventas_tickets vt ON ((vt.id = vi.ticket_id)))
             LEFT JOIN cocina_recetas r ON ((r.id = vi.receta_id)))
          WHERE ((COALESCE(vi.cocina_producto_id, r.descuenta_producto_id) = b.producto_id) AND (vi.local = b.local) AND ((vt.fecha + vt.hora) > b.corte))) ve ON (true))
     LEFT JOIN LATERAL ( SELECT sum(m.porciones) AS n
           FROM cocina_merma m
          WHERE ((m.producto_id = b.producto_id) AND (m.local = b.local) AND ((m.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires'::text) > b.corte))) me ON (true))
     LEFT JOIN LATERAL ( SELECT sum(a.delta) AS n
           FROM cocina_ajustes_stock a
          WHERE ((a.producto_id = b.producto_id) AND (a.local = b.local) AND (a.ubicacion = 'mostrador'::text) AND ((a.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires'::text) > b.corte))) aj ON (true));

create view public.v_cocina_stock_pastas as WITH base AS (
         SELECT p.id AS producto_id,
            p.nombre,
            p.codigo,
            p.local,
            p.minimo_produccion,
            ((COALESCE(b.cantidad_real, (0)::numeric) + (COALESCE(( SELECT sum(lp.porciones) AS sum
                   FROM cocina_lotes_pasta lp
                  WHERE ((lp.producto_id = p.id) AND (lp.local = p.local) AND (lp.ubicacion = 'camara_congelado'::text) AND ((b.created_at IS NULL) OR (COALESCE(lp.porcionado_at, lp.created_at) > b.created_at)))), (0)::bigint))::numeric) + COALESCE(( SELECT sum(a.delta) AS sum
                   FROM cocina_ajustes_stock a
                  WHERE ((a.producto_id = p.id) AND (a.local = p.local) AND (a.ubicacion = 'camara'::text) AND ((b.created_at IS NULL) OR (a.created_at > b.created_at)))), (0)::numeric)) AS porciones_camara,
            (COALESCE(( SELECT sum(t.porciones) AS sum
                   FROM cocina_traspasos t
                  WHERE ((t.producto_id = p.id) AND (t.local = p.local) AND ((b.created_at IS NULL) OR (t.created_at > b.created_at)))), (0)::bigint))::numeric AS porciones_traspasadas,
            COALESCE(( SELECT sum(m.porciones) AS sum
                   FROM cocina_merma m
                  WHERE ((m.producto_id = p.id) AND (m.local = p.local) AND ((b.created_at IS NULL) OR (m.created_at > b.created_at)))), (0)::numeric) AS porciones_merma,
            COALESCE(( SELECT sum(a.delta) AS sum
                   FROM cocina_ajustes_stock a
                  WHERE ((a.producto_id = p.id) AND (a.local = p.local) AND (a.ubicacion = 'mostrador'::text))), (0)::numeric) AS porciones_ajuste_mostrador
           FROM (cocina_productos p
             LEFT JOIN LATERAL ( SELECT bx.cantidad_real,
                    bx.created_at
                   FROM ( SELECT cc.cantidad_real,
                            cc.created_at
                           FROM cocina_cierre_camara cc
                          WHERE ((cc.producto_id = p.id) AND (cc.local = p.local))
                        UNION ALL
                         SELECT cd.cantidad_real,
                            cd.created_at
                           FROM cocina_cierre_dia cd
                          WHERE ((cd.producto_id = p.id) AND (cd.local = p.local) AND (cd.tipo = 'pasta'::text) AND (p.local = 'saavedra'::text))) bx
                  ORDER BY bx.created_at DESC
                 LIMIT 1) b ON (true))
          WHERE ((p.tipo = 'pasta'::text) AND (p.activo = true))
        ), ratio AS (
         SELECT lp.producto_id,
            lp.local,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((((lp.porciones)::numeric / (COALESCE(lp.masa_kg, (0)::numeric) +
                CASE
                    WHEN (COALESCE(lp.relleno_kg, (0)::numeric) > (50)::numeric) THEN (lp.relleno_kg / 1000.0)
                    ELSE COALESCE(lp.relleno_kg, (0)::numeric)
                END)))::double precision)) AS porc_por_kg,
            count(*) AS lotes_muestra
           FROM cocina_lotes_pasta lp
          WHERE ((lp.porciones > 0) AND (lp.fecha >= (CURRENT_DATE - 120)) AND ((COALESCE(lp.masa_kg, (0)::numeric) +
                CASE
                    WHEN (COALESCE(lp.relleno_kg, (0)::numeric) > (50)::numeric) THEN (lp.relleno_kg / 1000.0)
                    ELSE COALESCE(lp.relleno_kg, (0)::numeric)
                END) > (0)::numeric))
          GROUP BY lp.producto_id, lp.local
        ), proceso AS (
         SELECT lp.producto_id,
            lp.local,
            sum((COALESCE(lp.masa_kg, (0)::numeric) +
                CASE
                    WHEN (COALESCE(lp.relleno_kg, (0)::numeric) > (50)::numeric) THEN (lp.relleno_kg / 1000.0)
                    ELSE COALESCE(lp.relleno_kg, (0)::numeric)
                END)) AS kg,
            sum(COALESCE(lp.cantidad_cajones, 0)) AS bandejas,
            count(*) AS lotes
           FROM cocina_lotes_pasta lp
          WHERE (lp.ubicacion = 'freezer_produccion'::text)
          GROUP BY lp.producto_id, lp.local
        ), conteo AS (
         SELECT p.id AS producto_id,
            p.local,
            c.created_at AS ultimo_conteo_at
           FROM (cocina_productos p
             LEFT JOIN LATERAL ( SELECT bx.created_at
                   FROM ( SELECT cc.created_at
                           FROM cocina_cierre_camara cc
                          WHERE ((cc.producto_id = p.id) AND (cc.local = p.local))
                        UNION ALL
                         SELECT cd.created_at
                           FROM cocina_cierre_dia cd
                          WHERE ((cd.producto_id = p.id) AND (cd.local = p.local) AND (cd.tipo = 'pasta'::text) AND (p.local = 'saavedra'::text))) bx
                  ORDER BY bx.created_at DESC
                 LIMIT 1) c ON (true))
          WHERE ((p.tipo = 'pasta'::text) AND (p.activo = true))
        )
 SELECT base.producto_id,
    base.nombre,
    base.codigo,
    base.local,
    base.minimo_produccion,
    base.porciones_camara,
    base.porciones_traspasadas,
    base.porciones_merma,
    base.porciones_ajuste_mostrador,
    GREATEST((0)::numeric, ((base.porciones_camara - base.porciones_traspasadas) - base.porciones_merma)) AS porciones_neto_camara,
    (COALESCE(pr.bandejas, (0)::bigint))::integer AS bandejas_en_proceso,
    (COALESCE(round(((COALESCE(pr.kg, (0)::numeric))::double precision * COALESCE(r.porc_por_kg, (0)::double precision))), (0)::double precision))::integer AS porciones_en_proceso_est,
    ((COALESCE(pr.lotes, (0)::bigint) > 0) AND (COALESCE(round(((COALESCE(pr.kg, (0)::numeric))::double precision * COALESCE(r.porc_por_kg, (0)::double precision))), (0)::double precision) = (0)::double precision)) AS en_proceso_sin_ratio,
    ((GREATEST((0)::numeric, ((base.porciones_camara - base.porciones_traspasadas) - base.porciones_merma)))::double precision + COALESCE(round(((COALESCE(pr.kg, (0)::numeric))::double precision * COALESCE(r.porc_por_kg, (0)::double precision))), (0)::double precision)) AS porciones_proyectadas,
    co.ultimo_conteo_at
   FROM (((base
     LEFT JOIN proceso pr ON (((pr.producto_id = base.producto_id) AND (pr.local = base.local))))
     LEFT JOIN ratio r ON (((r.producto_id = base.producto_id) AND (r.local = base.local))))
     LEFT JOIN conteo co ON (((co.producto_id = base.producto_id) AND (co.local = base.local))));

create view public.v_edr_gastos_invisibles as SELECT id,
    periodo,
    fecha,
    local,
    proveedor,
    categoria,
    subcategoria,
    COALESCE(NULLIF(importe_neto, (0)::numeric), importe_total) AS monto,
        CASE
            WHEN ((local IS NULL) OR (local = ''::text)) THEN 'sin local'::text
            ELSE ('local desconocido: '::text || local)
        END AS motivo
   FROM gastos g
  WHERE ((cancelado = false) AND ((local IS NULL) OR (local <> ALL (ARRAY['vedia'::text, 'saavedra'::text, 'sas'::text]))));

create view public.v_edr_gastos_sin_renglon as SELECT id,
    periodo,
    local,
    fecha,
    proveedor,
    COALESCE(NULLIF(TRIM(BOTH FROM categoria), ''::text), '(sin categoría)'::text) AS categoria,
    subcategoria,
    COALESCE(NULLIF(importe_neto, (0)::numeric), importe_total) AS monto
   FROM gastos g
  WHERE ((cancelado = false) AND (edr_renglon_de_gasto(categoria, subcategoria) = 'sin_clasificar'::text));

create view public.v_egresos_caja as SELECT 'pagos_gastos'::text AS origen,
    pg.id,
    pg.fecha_pago AS fecha,
    pg.monto,
    pg.cuenta,
    pg.medio_pago_id
   FROM pagos_gastos pg
  WHERE (NOT COALESCE(pg.programado, false))
UNION ALL
 SELECT 'pagos_sueldos'::text AS origen,
    ps.id,
    ps.fecha_pago AS fecha,
    ps.monto,
    ps.cuenta,
    ps.medio_pago_id
   FROM pagos_sueldos ps
UNION ALL
 SELECT 'dividendos'::text AS origen,
    d.id,
    d.fecha,
    d.monto,
    d.cuenta,
    d.medio_pago_id
   FROM dividendos d;

create view public.v_empleados_publicos as SELECT id,
    nombre,
    apellido,
    puesto,
    es_produccion,
    local,
    activo
   FROM empleados e
  WHERE (activo IS TRUE);

create view public.v_medios_pago_sin_mapear as WITH t AS (
         SELECT 'gastos'::text AS tabla,
            lower(btrim(COALESCE(gastos.medio_pago, ''::text))) AS txt
           FROM gastos
        UNION ALL
         SELECT 'pagos_gastos'::text,
            lower(btrim(COALESCE(pagos_gastos.medio_pago, ''::text))) AS lower
           FROM pagos_gastos
        UNION ALL
         SELECT 'pagos_fijos'::text,
            lower(btrim(COALESCE(pagos_fijos.medio_pago, ''::text))) AS lower
           FROM pagos_fijos
        UNION ALL
         SELECT 'adelantos'::text,
            lower(btrim(COALESCE(adelantos.medio_pago, ''::text))) AS lower
           FROM adelantos
        UNION ALL
         SELECT 'aguinaldos'::text,
            lower(btrim(COALESCE(aguinaldos.medio_pago, ''::text))) AS lower
           FROM aguinaldos
        UNION ALL
         SELECT 'dividendos'::text,
            lower(btrim(COALESCE(dividendos.medio_pago, ''::text))) AS lower
           FROM dividendos
        UNION ALL
         SELECT 'pagos_sueldos'::text,
            lower(btrim(COALESCE(pagos_sueldos.medio_pago, ''::text))) AS lower
           FROM pagos_sueldos
        UNION ALL
         SELECT 'ventas_tickets'::text,
            lower(btrim(COALESCE(ventas_tickets.medio_pago, ''::text))) AS lower
           FROM ventas_tickets
        UNION ALL
         SELECT 'ventas_pagos'::text,
            lower(btrim(COALESCE(ventas_pagos.medio_pago, ''::text))) AS lower
           FROM ventas_pagos
        UNION ALL
         SELECT 'liquidaciones_quincenales'::text,
            lower(btrim(COALESCE(liquidaciones_quincenales.medio_pago, ''::text))) AS lower
           FROM liquidaciones_quincenales
        UNION ALL
         SELECT 'almacen_pedidos'::text,
            lower(btrim(COALESCE(almacen_pedidos.medio_pago, ''::text))) AS lower
           FROM almacen_pedidos
        )
 SELECT t.tabla,
    t.txt AS texto,
    count(*) AS filas
   FROM (t
     LEFT JOIN medios_pago_alias a ON ((a.alias = t.txt)))
  WHERE (a.alias IS NULL)
  GROUP BY t.tabla, t.txt
  ORDER BY (count(*)) DESC;

create view public.v_retiros_descuadrados as SELECT id,
    fecha,
    local,
    turno,
    otros_retiros,
    retiro_cambio,
    retiro_pagos,
    (otros_retiros - (COALESCE(retiro_cambio, (0)::numeric) + COALESCE(retiro_pagos, (0)::numeric))) AS diferencia
   FROM cierres_caja c
  WHERE (((retiro_cambio IS NOT NULL) OR (retiro_pagos IS NOT NULL)) AND (COALESCE(otros_retiros, (0)::numeric) <> (COALESCE(retiro_cambio, (0)::numeric) + COALESCE(retiro_pagos, (0)::numeric))));

create view public.v_retiros_sin_clasificar as SELECT id,
    fecha,
    local,
    turno,
    caja,
    otros_retiros AS total_retirado,
    otros_retiros_nota AS nota,
        CASE
            WHEN ((otros_retiros_nota IS NULL) OR (btrim(otros_retiros_nota) = ''::text)) THEN 'sin nota'::text
            WHEN (otros_retiros_nota ~* '(pago|prove|adelanto|compr|merc)'::text) THEN 'menciona pago o adelanto'::text
            ELSE 'nota ambigua'::text
        END AS motivo
   FROM cierres_caja c
  WHERE ((COALESCE(otros_retiros, (0)::numeric) > (0)::numeric) AND ((retiro_cambio IS NULL) OR (retiro_pagos IS NULL)))
  ORDER BY fecha DESC, local, turno;

create view public.v_ventas_items_oficial as SELECT i.id,
    i.local,
    i.periodo,
    i.codigo,
    i.categoria,
    i.subcategoria,
    i.nombre,
    i.cantidad,
    i.total,
    i.ticket_id,
    i.fecha,
    i.linea,
    i.linea_padre_id,
    i.vinculo_origen,
    i.receta_id,
    i.cocina_producto_id,
    i.precio_unitario,
    i.origen,
    i.descuento_pct,
    i.descuento_monto
   FROM (ventas_items i
     JOIN ventas_origen_oficial o ON (((o.local = i.local) AND (o.origen = i.origen))));

create view public.v_ventas_items_sin_catalogo as SELECT local,
    periodo,
    nombre,
    sum(cantidad) AS uds,
    sum(total) AS total,
    count(*) AS lineas
   FROM ventas_items v
  WHERE ((receta_id IS NULL) AND (cocina_producto_id IS NULL))
  GROUP BY local, periodo, nombre;

create view public.v_ventas_tickets_oficial as SELECT t.id,
    t.local,
    t.fudo_id,
    t.fecha,
    t.hora,
    t.caja,
    t.estado,
    t.tipo_venta,
    t.medio_pago,
    t.total_bruto,
    t.total_neto,
    t.iva,
    t.es_fiscal,
    t.periodo,
    t.es_dividendo,
    t.medio_pago_id,
    t.cuenta,
    t.origen,
    t.cierre_caja_id,
    t.cliente,
    t.descuento_total,
    t.convenio_id
   FROM (ventas_tickets t
     JOIN ventas_origen_oficial o ON (((o.local = t.local) AND (o.origen = t.origen))));

-- ── FUNCIONES ───────────────────────────────────────────────────

-- sql
create function public._cocina_fraccion_subreceta(p_cantidad numeric, p_unidad text, p_rend_kg numeric, p_rend_porciones numeric) returns numeric;

-- sql
create function public._cocina_norm_nombre(n text) returns text;

-- sql · SECURITY DEFINER
create function public.agenda_companeros() returns TABLE(user_id uuid, nombre text);

-- sql
create function public.amort_resumen_anual(p_local text, p_anio text) returns TABLE(periodo text, total_amort numeric);

-- plpgsql
create function public.aplicar_baja_empleado() returns trigger;

-- plpgsql
create function public.aplicar_reglas_sugerencia() returns jsonb;

-- plpgsql · SECURITY DEFINER
create function public.auto_match_gastos_extracto(p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date) returns jsonb;

-- sql
create function public.buscar_proveedor_por_texto(p_texto text) returns TABLE(id uuid, razon_social text, nombre_comercial text, cuit text, score integer);

-- plpgsql
create function public.caja_salon_sella_local() returns trigger;

-- plpgsql
create function public.cobrar_venta(p_idempotencia uuid, p_local text, p_caja text, p_turno_id uuid, p_fecha date, p_hora time without time zone, p_cliente text, p_convenio_id uuid, p_lineas jsonb, p_pagos jsonb, p_tipo_venta text DEFAULT 'mostrador'::text) returns jsonb;

-- plpgsql · SECURITY DEFINER
create function public.cocina_cerrar_masa(p_lote_id uuid, p_kg_sobrante numeric, p_destino text DEFAULT NULL::text) returns cocina_lotes_masa;

-- sql · SECURITY DEFINER
create function public.cocina_ingredientes_expandidos(p_receta_id uuid) returns TABLE(id text, nombre text, cantidad double precision, unidad text, producto_id uuid);

-- plpgsql · SECURITY DEFINER
create function public.cocina_lote_pasta_exige_relleno() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.cocina_productos_log_precio() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.cocina_recetas_baja_log() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.cocina_recetas_precios_log() returns trigger;

-- sql · SECURITY DEFINER
create function public.cocina_salidas_de_camara(p_local text, p_desde timestamp with time zone, p_hasta timestamp with time zone) returns TABLE(producto_id uuid, cantidad numeric);

-- sql · SECURITY DEFINER
create function public.cocina_tickets_por_dia_semana(p_local text, p_desde timestamp with time zone, p_hasta timestamp with time zone) returns TABLE(dia_semana integer, tickets bigint);

-- sql · SECURITY DEFINER
create function public.cocina_ventas_por_producto(p_local text, p_desde timestamp with time zone, p_hasta timestamp with time zone) returns TABLE(nombre text, cantidad numeric);

-- sql
create function public.concepto_canonico_cargo(p_texto text) returns text;

-- sql
create function public.conciliados_resumen_por_gasto(p_desde date, p_hasta date, p_cuenta text DEFAULT NULL::text) returns TABLE(gasto_id uuid, n_movs bigint, total_debito numeric);

-- plpgsql
create function public.conciliar_adelantos(p_desde date, p_hasta date) returns jsonb;

-- plpgsql
create function public.conciliar_dividendos(p_desde date, p_hasta date) returns jsonb;

-- plpgsql
create function public.conciliar_pagos_consolidados(p_fecha_desde date, p_fecha_hasta date) returns jsonb;

-- plpgsql
create function public.conciliar_sueldos_consolidados(p_fecha_desde date, p_fecha_hasta date) returns jsonb;

-- plpgsql · SECURITY DEFINER
create function public.correo_integracion_estado() returns TABLE(conectado boolean, email_casilla text, ultima_lectura timestamp with time zone, ultimo_error text, updated_at timestamp with time zone);

-- plpgsql
create function public.crear_cargos_automaticos_bancarios(p_categoria_id uuid, p_creado_por text DEFAULT NULL::text, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date) returns jsonb;

-- plpgsql · SECURITY DEFINER
create function public.crear_perfil_nuevo_usuario() returns trigger;

-- sql
create function public.edr_renglon_de_gasto(p_categoria text, p_subcategoria text) returns text;

-- sql
create function public.edr_resumen_gastos(p_local text, p_anio text) returns TABLE(periodo text, cmv_alimentos numeric, cmv_bebidas numeric, cmv_indirectos numeric, gastos_op numeric, gastos_rrhh numeric, impuestos_op numeric, inversiones numeric, intereses numeric, sueldos numeric, cargas_sociales numeric, arca numeric, rrhh_otros numeric, aguinaldo numeric, bienal numeric, sin_clasificar numeric, total_gastos numeric);

-- sql
create function public.edr_resumen_ventas(p_local text, p_anio text) returns TABLE(periodo text, ing_bruto numeric, iva_debito numeric, ticket_count bigint);

-- sql · SECURITY DEFINER
create function public.es_admin() returns boolean;

-- sql · SECURITY DEFINER
create function public.es_admin_actual() returns boolean;

-- sql · SECURITY DEFINER
create function public.fichaje_login(p_dni text, p_pin text) returns TABLE(id uuid, nombre text, apellido text, local text, horario_tipo text, horas_semanales_requeridas integer);

-- sql · SECURITY DEFINER
create function public.fichaje_sesion(p_id uuid) returns TABLE(id uuid, nombre text, apellido text, local text, horario_tipo text, horas_semanales_requeridas integer);

-- plpgsql · SECURITY DEFINER
create function public.fifo_consumir_camara_pasta(p_producto_id uuid, p_local text, p_fecha date, p_cantidad numeric, p_tipo text, p_origen_tabla text, p_origen_id uuid, p_notas text DEFAULT NULL::text) returns numeric;

-- plpgsql · SECURITY DEFINER
create function public.fusionar_producto(p_duplicado_id uuid, p_master_id uuid) returns jsonb;

-- plpgsql · SECURITY DEFINER
create function public.fusionar_proveedores(p_mantener uuid, p_eliminar uuid) returns jsonb;

-- sql · SECURITY DEFINER
create function public.mi_local() returns text;

-- plpgsql
create function public.migrar_ambos_a_locales() returns integer;

-- sql
create function public.norm_nombre_cocina(p_texto text) returns text;

-- sql
create function public.pesos_criollo(p_monto numeric) returns text;

-- sql · SECURITY DEFINER
create function public.pool_mano_obra_produccion() returns TABLE(local text, total_sueldos numeric, n_empleados integer);

-- plpgsql · SECURITY DEFINER
create function public.porcionar_pasta_lote(p_lote_id uuid, p_porciones integer, p_responsable text DEFAULT NULL::text, p_sobrante_gramos numeric DEFAULT NULL::numeric, p_sobrante_origen_lote_id uuid DEFAULT NULL::uuid, p_merma_porcionado integer DEFAULT 0, p_notas text DEFAULT NULL::text) returns void;

-- plpgsql · SECURITY DEFINER
create function public.procesar_recordatorios_agenda() returns void;

-- sql · SECURITY DEFINER
create function public.produccion_mensual_por_receta(p_periodo text) returns TABLE(receta_id uuid, local text, cantidad numeric, unidad text);

-- plpgsql
create function public.productos_costeo_config_touch_updated() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.recalcular_pizarron_para_lote(p_tipo text, p_lote_id uuid, p_receta_id uuid, p_local text, p_fecha date) returns void;

-- plpgsql · SECURITY DEFINER
create function public.recalcular_pizarron_pasta_simple(p_producto_id uuid, p_local text, p_fecha date) returns void;

-- plpgsql · SECURITY DEFINER
create function public.recepcionar_mercaderia(p_local text, p_items jsonb, p_registrado_por text, p_foto_path text DEFAULT NULL::text, p_notas text DEFAULT NULL::text) returns uuid;

-- plpgsql · SECURITY DEFINER
create function public.registrar_salida_deposito(p_local text, p_producto_id uuid, p_cantidad numeric, p_motivo text DEFAULT NULL::text, p_observacion text DEFAULT NULL::text, p_registrado_por text DEFAULT NULL::text) returns numeric;

-- plpgsql · SECURITY DEFINER
create function public.resincronizar_medios_pago() returns jsonb;

-- plpgsql
create function public.salon_abrir_mesa(p_mesa_id uuid, p_comensales integer) returns uuid;

-- plpgsql
create function public.salon_agregar_linea(p_sesion_id uuid, p_receta_id uuid, p_cantidad numeric, p_padre_id uuid DEFAULT NULL::uuid, p_descuento_pct numeric DEFAULT 0) returns uuid;

-- plpgsql
create function public.salon_anular_sesion(p_sesion_id uuid, p_motivo text) returns void;

-- plpgsql
create function public.salon_cobrar_mesa(p_idempotencia uuid, p_sesion_id uuid, p_turno_id uuid, p_caja text, p_fecha date, p_hora time without time zone, p_pagos jsonb, p_cliente text DEFAULT NULL::text, p_convenio_id uuid DEFAULT NULL::uuid) returns jsonb;

-- plpgsql
create function public.salon_enviar_a_cocina(p_sesion_id uuid) returns uuid;

-- plpgsql
create function public.salon_pedir_la_cuenta(p_sesion_id uuid) returns void;

-- plpgsql
create function public.salon_sacar_linea(p_linea_id uuid, p_motivo text DEFAULT NULL::text) returns void;

-- sql
create function public.snapshot_inventario_actual(p_local text) returns TABLE(monto_alimentos numeric, monto_bebidas numeric, monto_indirectos numeric, productos_sin_clasificar integer, valor_sin_clasificar numeric);

-- plpgsql
create function public.sync_precio_venta_salon() returns trigger;

-- sql · SECURITY DEFINER
create function public.ticket_pos_sin_cobros(p_ticket uuid) returns boolean;

-- sql · SECURITY DEFINER
create function public.ticket_sin_comprobante(p_ticket uuid) returns boolean;

-- sql · SECURITY DEFINER
create function public.tiene_permiso(modulo text) returns boolean;

-- plpgsql
create function public.touch_precios_canal_updated_at() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_ajuste_camara_fifo() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_cierres_caja_proteger_pos() returns trigger;

-- plpgsql
create function public.trg_cierres_caja_retiros() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_comprobante_coincide_con_venta() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_comprobante_inmutable() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_lote_pasta_codigo_unico() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_medio_pago_completar() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_medio_pago_completar_id() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_medio_pago_dividendo() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_merma_camara_fifo() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_perfiles_no_autoescalar() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_pizarron_lote_masa() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_pizarron_lote_pasta() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_pizarron_lote_produccion() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_pizarron_lote_relleno() returns trigger;

-- plpgsql
create function public.trg_pizarron_reset_on_lote_delete() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_pizarron_reset_pasta_simple_del() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_traspaso_fifo() returns trigger;

-- plpgsql
create function public.trg_ventas_items_precio_de_la_carta() returns trigger;

-- plpgsql · SECURITY DEFINER
create function public.trg_ventas_items_vincular_catalogo() returns trigger;

-- sql
create function public.venta_descuento_de_linea(p_bruto numeric, p_pct numeric) returns numeric;

-- plpgsql
create function public.ventas_origen_oficial_sello() returns trigger;

-- ── CLAVES FORANEAS ─────────────────────────────────────────────

alter table public.adelantos add constraint adelantos_conciliado_movimiento_id_fkey FOREIGN KEY (conciliado_movimiento_id) REFERENCES movimientos_bancarios(id) ON DELETE SET NULL;
alter table public.adelantos add constraint adelantos_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.adelantos add constraint adelantos_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.agenda_items add constraint agenda_items_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.aguinaldos add constraint aguinaldos_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.aguinaldos add constraint aguinaldos_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
alter table public.aguinaldos add constraint aguinaldos_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.almacen_pedidos add constraint almacen_pedidos_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES cocina_lotes_pasta(id);
alter table public.almacen_pedidos add constraint almacen_pedidos_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.almacen_pedidos add constraint almacen_pedidos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES cocina_productos(id);
alter table public.amortizaciones add constraint amortizaciones_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE CASCADE;
alter table public.bonos add constraint bonos_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.caja_mesa_envios add constraint caja_mesa_envios_enviado_por_fkey FOREIGN KEY (enviado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.caja_mesa_envios add constraint caja_mesa_envios_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES caja_mesa_sesiones(id) ON DELETE RESTRICT;
alter table public.caja_mesa_lineas add constraint caja_mesa_lineas_agregada_por_fkey FOREIGN KEY (agregada_por) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.caja_mesa_lineas add constraint caja_mesa_lineas_envio_id_fkey FOREIGN KEY (envio_id) REFERENCES caja_mesa_envios(id) ON DELETE RESTRICT;
alter table public.caja_mesa_lineas add constraint caja_mesa_lineas_padre_id_fkey FOREIGN KEY (padre_id) REFERENCES caja_mesa_lineas(id) ON DELETE RESTRICT;
alter table public.caja_mesa_lineas add constraint caja_mesa_lineas_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id) ON DELETE RESTRICT;
alter table public.caja_mesa_lineas add constraint caja_mesa_lineas_sacada_por_fkey FOREIGN KEY (sacada_por) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.caja_mesa_lineas add constraint caja_mesa_lineas_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES caja_mesa_sesiones(id) ON DELETE RESTRICT;
alter table public.caja_mesa_lineas add constraint caja_mesa_lineas_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES ventas_tickets(id) ON DELETE SET NULL;
alter table public.caja_mesa_sesiones add constraint caja_mesa_sesiones_abierta_por_fkey FOREIGN KEY (abierta_por) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.caja_mesa_sesiones add constraint caja_mesa_sesiones_cuenta_pedida_por_fkey FOREIGN KEY (cuenta_pedida_por) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.caja_mesa_sesiones add constraint caja_mesa_sesiones_mesa_id_fkey FOREIGN KEY (mesa_id) REFERENCES caja_mesas(id) ON DELETE RESTRICT;
alter table public.caja_mesas add constraint caja_mesas_sala_id_fkey FOREIGN KEY (sala_id) REFERENCES caja_salas(id) ON DELETE RESTRICT;
alter table public.categorias_gasto add constraint categorias_gasto_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES categorias_gasto(id) ON DELETE CASCADE;
alter table public.cierres_caja add constraint cierres_caja_dividendo_id_fkey FOREIGN KEY (dividendo_id) REFERENCES dividendos(id) ON DELETE SET NULL;
alter table public.cierres_caja_medios add constraint cierres_caja_medios_cierre_caja_id_fkey FOREIGN KEY (cierre_caja_id) REFERENCES cierres_caja(id) ON DELETE CASCADE;
alter table public.cierres_caja_medios add constraint cierres_caja_medios_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.cocina_ajustes_stock add constraint cocina_ajustes_stock_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES cocina_productos(id) ON DELETE CASCADE;
alter table public.cocina_cierre_camara add constraint cocina_cierre_camara_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES cocina_productos(id) ON DELETE CASCADE;
alter table public.cocina_cierre_dia add constraint cocina_cierre_dia_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES cocina_productos(id) ON DELETE CASCADE;
alter table public.cocina_cierre_dia add constraint cocina_cierre_dia_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id) ON DELETE SET NULL;
alter table public.cocina_lote_consumos add constraint cocina_lote_consumos_lote_pasta_id_fkey FOREIGN KEY (lote_pasta_id) REFERENCES cocina_lotes_pasta(id) ON DELETE CASCADE;
alter table public.cocina_lotes_masa add constraint cocina_lotes_masa_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id);
alter table public.cocina_lotes_pasta add constraint cocina_lotes_pasta_lote_masa_id_fkey FOREIGN KEY (lote_masa_id) REFERENCES cocina_lotes_masa(id);
alter table public.cocina_lotes_pasta add constraint cocina_lotes_pasta_lote_relleno_id_fkey FOREIGN KEY (lote_relleno_id) REFERENCES cocina_lotes_relleno(id);
alter table public.cocina_lotes_pasta add constraint cocina_lotes_pasta_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES cocina_productos(id);
alter table public.cocina_lotes_pasta add constraint cocina_lotes_pasta_receta_masa_id_fkey FOREIGN KEY (receta_masa_id) REFERENCES cocina_recetas(id);
alter table public.cocina_lotes_pasta add constraint cocina_lotes_pasta_sobrante_origen_lote_id_fkey FOREIGN KEY (sobrante_origen_lote_id) REFERENCES cocina_lotes_pasta(id) ON DELETE SET NULL;
alter table public.cocina_lotes_pasta_masas add constraint cocina_lotes_pasta_masas_lote_masa_id_fkey FOREIGN KEY (lote_masa_id) REFERENCES cocina_lotes_masa(id);
alter table public.cocina_lotes_pasta_masas add constraint cocina_lotes_pasta_masas_lote_pasta_id_fkey FOREIGN KEY (lote_pasta_id) REFERENCES cocina_lotes_pasta(id) ON DELETE CASCADE;
alter table public.cocina_lotes_produccion add constraint cocina_lotes_produccion_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id);
alter table public.cocina_lotes_relleno add constraint cocina_lotes_relleno_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id);
alter table public.cocina_merma add constraint cocina_merma_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES cocina_productos(id);
alter table public.cocina_merma add constraint cocina_merma_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id) ON DELETE SET NULL;
alter table public.cocina_pasta_recetas add constraint cocina_pasta_recetas_pasta_id_fkey FOREIGN KEY (pasta_id) REFERENCES cocina_productos(id) ON DELETE CASCADE;
alter table public.cocina_pasta_recetas add constraint cocina_pasta_recetas_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id) ON DELETE CASCADE;
alter table public.cocina_pizarron_items add constraint cocina_pizarron_items_destino_producto_id_fkey FOREIGN KEY (destino_producto_id) REFERENCES cocina_productos(id) ON DELETE SET NULL;
alter table public.cocina_pizarron_items add constraint cocina_pizarron_items_publicado_por_fkey FOREIGN KEY (publicado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.cocina_pizarron_items add constraint cocina_pizarron_items_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id) ON DELETE SET NULL;
alter table public.cocina_productos add constraint cocina_productos_insumo_reventa_id_fkey FOREIGN KEY (insumo_reventa_id) REFERENCES productos(id) ON DELETE SET NULL;
alter table public.cocina_productos add constraint cocina_productos_masa_id_fkey FOREIGN KEY (masa_id) REFERENCES cocina_recetas(id);
alter table public.cocina_productos add constraint cocina_productos_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id) ON DELETE SET NULL;
alter table public.cocina_productos_precio_historial add constraint cocina_productos_precio_historial_cocina_producto_id_fkey FOREIGN KEY (cocina_producto_id) REFERENCES cocina_productos(id) ON DELETE CASCADE;
alter table public.cocina_productos_precios_canal add constraint cocina_productos_precios_canal_cocina_producto_id_fkey FOREIGN KEY (cocina_producto_id) REFERENCES cocina_productos(id) ON DELETE CASCADE;
alter table public.cocina_receta_ingredientes add constraint cocina_receta_ingredientes_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL;
alter table public.cocina_receta_ingredientes add constraint cocina_receta_ingredientes_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id) ON DELETE CASCADE;
alter table public.cocina_recetas add constraint cocina_recetas_descuenta_producto_id_fkey FOREIGN KEY (descuenta_producto_id) REFERENCES cocina_productos(id);
alter table public.cocina_recetas_precios_canal add constraint cocina_recetas_precios_canal_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id) ON DELETE CASCADE;
alter table public.cocina_traspasos add constraint cocina_traspasos_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES cocina_productos(id);
alter table public.comprobantes add constraint comprobantes_duplicado_de_fkey FOREIGN KEY (duplicado_de) REFERENCES comprobantes(id);
alter table public.comprobantes add constraint comprobantes_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
alter table public.comprobantes add constraint comprobantes_subido_por_fkey FOREIGN KEY (subido_por) REFERENCES auth.users(id);
alter table public.cronograma add constraint cronograma_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.descuentos add constraint descuentos_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.dividendos add constraint dividendos_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.fichadas add constraint fichadas_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.gastos add constraint gastos_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES auth.users(id);
alter table public.gastos add constraint gastos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES categorias_gasto(id);
alter table public.gastos add constraint gastos_comprobante_id_fkey FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id);
alter table public.gastos add constraint gastos_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.gastos add constraint gastos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.gastos add constraint gastos_regla_id_fkey FOREIGN KEY (regla_id) REFERENCES reglas_movimiento(id) ON DELETE SET NULL;
alter table public.gastos_backfill_proveedor_id_log add constraint gastos_backfill_proveedor_id_log_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE CASCADE;
alter table public.liquidaciones_quincenales add constraint liquidaciones_quincenales_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.liquidaciones_quincenales add constraint liquidaciones_quincenales_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.medios_pago_alias add constraint medios_pago_alias_medio_codigo_fkey FOREIGN KEY (medio_codigo) REFERENCES medios_pago(codigo) ON UPDATE CASCADE;
alter table public.movimientos_bancarios add constraint movimientos_bancarios_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
alter table public.movimientos_bancarios add constraint movimientos_bancarios_sugerencia_regla_id_fkey FOREIGN KEY (sugerencia_regla_id) REFERENCES reglas_movimiento(id) ON DELETE SET NULL;
alter table public.movimientos_bancarios add constraint movimientos_bancarios_transferencia_par_id_fkey FOREIGN KEY (transferencia_par_id) REFERENCES movimientos_bancarios(id) ON DELETE SET NULL;
alter table public.movimientos_stock add constraint movimientos_stock_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id);
alter table public.pagos_fijos add constraint pagos_fijos_categoria_gasto_id_fkey FOREIGN KEY (categoria_gasto_id) REFERENCES categorias_gasto(id);
alter table public.pagos_fijos add constraint pagos_fijos_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id);
alter table public.pagos_fijos add constraint pagos_fijos_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.pagos_gastos add constraint pagos_gastos_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE CASCADE;
alter table public.pagos_gastos add constraint pagos_gastos_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.pagos_sueldos add constraint pagos_sueldos_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.pagos_sueldos add constraint pagos_sueldos_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.perfiles add constraint perfiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.productos add constraint productos_categoria_gasto_id_fkey FOREIGN KEY (categoria_gasto_id) REFERENCES categorias_gasto(id) ON DELETE SET NULL;
alter table public.productos_acciones_estado add constraint productos_acciones_estado_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.productos_costo_historial add constraint productos_costo_historial_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id) ON DELETE SET NULL;
alter table public.productos_costo_historial add constraint productos_costo_historial_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE;
alter table public.proveedores add constraint proveedores_medio_pago_default_id_fkey FOREIGN KEY (medio_pago_default_id) REFERENCES medios_pago(id);
alter table public.push_subscriptions add constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.recepciones_pendientes add constraint recepciones_pendientes_gasto_id_fkey FOREIGN KEY (gasto_id) REFERENCES gastos(id);
alter table public.recibos_sueldo add constraint recibos_sueldo_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.reglas_movimiento add constraint reglas_movimiento_categoria_gasto_id_fkey FOREIGN KEY (categoria_gasto_id) REFERENCES categorias_gasto(id) ON DELETE SET NULL;
alter table public.sanciones add constraint sanciones_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.sueldos_mensuales add constraint sueldos_mensuales_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.vacaciones add constraint vacaciones_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT;
alter table public.ventas_comprobantes add constraint ventas_comprobantes_anula_comprobante_id_fkey FOREIGN KEY (anula_comprobante_id) REFERENCES ventas_comprobantes(id);
alter table public.ventas_comprobantes add constraint ventas_comprobantes_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES ventas_tickets(id) ON DELETE RESTRICT;
alter table public.ventas_items add constraint ventas_items_cocina_producto_id_fkey FOREIGN KEY (cocina_producto_id) REFERENCES cocina_productos(id);
alter table public.ventas_items add constraint ventas_items_linea_padre_id_fkey FOREIGN KEY (linea_padre_id) REFERENCES ventas_items(id) ON DELETE CASCADE;
alter table public.ventas_items add constraint ventas_items_local_oficial_fk FOREIGN KEY (local) REFERENCES ventas_origen_oficial(local) ON UPDATE CASCADE;
alter table public.ventas_items add constraint ventas_items_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES cocina_recetas(id);
alter table public.ventas_items add constraint ventas_items_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES ventas_tickets(id) ON DELETE CASCADE;
alter table public.ventas_origen_oficial add constraint ventas_origen_oficial_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.ventas_pagos add constraint ventas_pagos_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);
alter table public.ventas_pagos add constraint ventas_pagos_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES ventas_tickets(id) ON DELETE CASCADE;
alter table public.ventas_tickets add constraint ventas_tickets_cierre_caja_id_fkey FOREIGN KEY (cierre_caja_id) REFERENCES cierres_caja(id) ON DELETE SET NULL;
alter table public.ventas_tickets add constraint ventas_tickets_convenio_id_fkey FOREIGN KEY (convenio_id) REFERENCES convenios(id) ON DELETE SET NULL;
alter table public.ventas_tickets add constraint ventas_tickets_local_oficial_fk FOREIGN KEY (local) REFERENCES ventas_origen_oficial(local) ON UPDATE CASCADE;
alter table public.ventas_tickets add constraint ventas_tickets_medio_pago_id_fkey FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id);

-- ── INDICES ─────────────────────────────────────────────────────

CREATE UNIQUE INDEX adelantos_pkey ON public.adelantos USING btree (id);
CREATE INDEX idx_adelantos_emp_periodo ON public.adelantos USING btree (empleado_id, periodo);
CREATE INDEX agenda_items_asignados_gin ON public.agenda_items USING gin (asignados);
CREATE UNIQUE INDEX agenda_items_pkey ON public.agenda_items USING btree (id);
CREATE INDEX idx_agenda_items_usuario_fecha ON public.agenda_items USING btree (usuario_id, fecha_inicio);
CREATE UNIQUE INDEX aguinaldos_empleado_id_anio_semestre_key ON public.aguinaldos USING btree (empleado_id, anio, semestre);
CREATE UNIQUE INDEX aguinaldos_pkey ON public.aguinaldos USING btree (id);
CREATE INDEX idx_aguinaldos_anio_sem ON public.aguinaldos USING btree (anio, semestre);
CREATE INDEX idx_aguinaldos_empleado ON public.aguinaldos USING btree (empleado_id);
CREATE INDEX idx_aguinaldos_gasto ON public.aguinaldos USING btree (gasto_id);
CREATE UNIQUE INDEX almacen_pedidos_pkey ON public.almacen_pedidos USING btree (id);
CREATE INDEX idx_almacen_pedidos_lote ON public.almacen_pedidos USING btree (lote_id);
CREATE INDEX idx_almacen_pedidos_producto ON public.almacen_pedidos USING btree (producto_id);
CREATE UNIQUE INDEX amortizaciones_gasto_id_key ON public.amortizaciones USING btree (gasto_id);
CREATE UNIQUE INDEX amortizaciones_pkey ON public.amortizaciones USING btree (id);
CREATE INDEX idx_amort_local ON public.amortizaciones USING btree (local);
CREATE UNIQUE INDEX arca_config_pkey ON public.arca_config USING btree (local);
CREATE UNIQUE INDEX arca_tokens_pkey ON public.arca_tokens USING btree (cuit, servicio, ambiente);
CREATE INDEX bonos_empleado_periodo_idx ON public.bonos USING btree (empleado_id, periodo);
CREATE UNIQUE INDEX bonos_pkey ON public.bonos USING btree (id);
CREATE UNIQUE INDEX caja_canal_precio_pkey ON public.caja_canal_precio USING btree (tipo_venta);
CREATE UNIQUE INDEX caja_mesa_envios_pkey ON public.caja_mesa_envios USING btree (id);
CREATE UNIQUE INDEX caja_mesa_envios_sesion_id_numero_key ON public.caja_mesa_envios USING btree (sesion_id, numero);
CREATE UNIQUE INDEX caja_mesa_lineas_pkey ON public.caja_mesa_lineas USING btree (id);
CREATE UNIQUE INDEX caja_mesa_lineas_sesion_id_linea_key ON public.caja_mesa_lineas USING btree (sesion_id, linea);
CREATE INDEX idx_caja_lineas_sesion ON public.caja_mesa_lineas USING btree (sesion_id);
CREATE INDEX idx_caja_lineas_sin_cobrar ON public.caja_mesa_lineas USING btree (local, receta_id) WHERE ((ticket_id IS NULL) AND (estado = 'activa'::text));
CREATE UNIQUE INDEX caja_mesa_sesiones_pkey ON public.caja_mesa_sesiones USING btree (id);
CREATE UNIQUE INDEX idx_caja_sesion_una_por_mesa ON public.caja_mesa_sesiones USING btree (mesa_id) WHERE (estado = ANY (ARRAY['abierta'::text, 'cuenta_pedida'::text]));
CREATE INDEX idx_caja_sesiones_local ON public.caja_mesa_sesiones USING btree (local, estado);
CREATE UNIQUE INDEX caja_mesas_pkey ON public.caja_mesas USING btree (id);
CREATE UNIQUE INDEX caja_mesas_sala_id_numero_key ON public.caja_mesas USING btree (sala_id, numero);
CREATE INDEX idx_caja_mesas_local ON public.caja_mesas USING btree (local, activo);
CREATE UNIQUE INDEX caja_salas_local_nombre_key ON public.caja_salas USING btree (local, nombre);
CREATE UNIQUE INDEX caja_salas_pkey ON public.caja_salas USING btree (id);
CREATE UNIQUE INDEX categorias_gasto_pkey ON public.categorias_gasto USING btree (id);
CREATE INDEX idx_categorias_parent ON public.categorias_gasto USING btree (parent_id);
CREATE UNIQUE INDEX cierres_caja_local_fecha_turno_caja_key ON public.cierres_caja USING btree (local, fecha, turno, caja);
CREATE UNIQUE INDEX cierres_caja_pkey ON public.cierres_caja USING btree (id);
CREATE INDEX idx_cierres_caja_dividendo_id ON public.cierres_caja USING btree (dividendo_id) WHERE (dividendo_id IS NOT NULL);
CREATE INDEX idx_cierres_caja_pos_abiertos ON public.cierres_caja USING btree (local, caja, fecha DESC) WHERE ((origen = 'pos'::text) AND (hora_cierre IS NULL));
CREATE INDEX idx_cierres_local_fecha ON public.cierres_caja USING btree (local, fecha DESC);
CREATE UNIQUE INDEX cierres_caja_medios_cierre_caja_id_medio_pago_id_key ON public.cierres_caja_medios USING btree (cierre_caja_id, medio_pago_id);
CREATE UNIQUE INDEX cierres_caja_medios_pkey ON public.cierres_caja_medios USING btree (id);
CREATE INDEX idx_cierres_caja_medios_cierre ON public.cierres_caja_medios USING btree (cierre_caja_id);
CREATE UNIQUE INDEX cierres_mes_local_periodo_key ON public.cierres_mes USING btree (local, periodo);
CREATE INDEX cierres_mes_periodo_idx ON public.cierres_mes USING btree (periodo);
CREATE UNIQUE INDEX cierres_mes_pkey ON public.cierres_mes USING btree (id);
CREATE UNIQUE INDEX cierres_mes_overrides_local_periodo_checkpoint_key_key ON public.cierres_mes_overrides USING btree (local, periodo, checkpoint_key);
CREATE INDEX cierres_mes_overrides_periodo_idx ON public.cierres_mes_overrides USING btree (local, periodo);
CREATE UNIQUE INDEX cierres_mes_overrides_pkey ON public.cierres_mes_overrides USING btree (id);
CREATE UNIQUE INDEX clientes_fiscales_doc_uk ON public.clientes_fiscales USING btree (doc_tipo, doc_nro);
CREATE UNIQUE INDEX clientes_fiscales_pkey ON public.clientes_fiscales USING btree (id);
CREATE UNIQUE INDEX cocina_ajustes_stock_pkey ON public.cocina_ajustes_stock USING btree (id);
CREATE INDEX cocina_ajustes_stock_producto_ubicacion_idx ON public.cocina_ajustes_stock USING btree (producto_id, ubicacion, local);
CREATE UNIQUE INDEX cocina_cierre_camara_pkey ON public.cocina_cierre_camara USING btree (id);
CREATE INDEX idx_cocina_cierre_camara_prod ON public.cocina_cierre_camara USING btree (producto_id, local, created_at DESC);
CREATE UNIQUE INDEX cocina_cierre_dia_pkey ON public.cocina_cierre_dia USING btree (id);
CREATE INDEX cocina_cierre_dia_receta_idx ON public.cocina_cierre_dia USING btree (receta_id) WHERE (receta_id IS NOT NULL);
CREATE INDEX idx_cocina_cierre_dia_fecha_local ON public.cocina_cierre_dia USING btree (local, fecha DESC);
CREATE INDEX idx_cocina_cierre_dia_producto ON public.cocina_cierre_dia USING btree (producto_id, fecha DESC);
CREATE UNIQUE INDEX ux_cocina_cierre_dia_con_turno ON public.cocina_cierre_dia USING btree (fecha, local, producto_id, turno) WHERE (turno IS NOT NULL);
CREATE UNIQUE INDEX ux_cocina_cierre_dia_sin_turno ON public.cocina_cierre_dia USING btree (fecha, local, producto_id) WHERE (turno IS NULL);
CREATE UNIQUE INDEX cocina_lote_consumos_pkey ON public.cocina_lote_consumos USING btree (id);
CREATE INDEX idx_cocina_lote_consumos_lote ON public.cocina_lote_consumos USING btree (lote_pasta_id);
CREATE INDEX idx_cocina_lote_consumos_origen ON public.cocina_lote_consumos USING btree (origen_tabla, origen_id);
CREATE UNIQUE INDEX cocina_lotes_masa_pkey ON public.cocina_lotes_masa USING btree (id);
CREATE INDEX idx_cocina_lotes_masa_receta ON public.cocina_lotes_masa USING btree (receta_id);
CREATE UNIQUE INDEX cocina_lotes_pasta_codigo_unico_por_local ON public.cocina_lotes_pasta USING btree (local, codigo_lote) WHERE (codigo_lote IS NOT NULL);
CREATE UNIQUE INDEX cocina_lotes_pasta_pkey ON public.cocina_lotes_pasta USING btree (id);
CREATE INDEX idx_cocina_lotes_pasta_lote_masa ON public.cocina_lotes_pasta USING btree (lote_masa_id);
CREATE INDEX idx_cocina_lotes_pasta_lote_relleno ON public.cocina_lotes_pasta USING btree (lote_relleno_id);
CREATE INDEX idx_cocina_lotes_pasta_producto ON public.cocina_lotes_pasta USING btree (producto_id);
CREATE INDEX idx_cocina_lotes_pasta_receta_masa ON public.cocina_lotes_pasta USING btree (receta_masa_id);
CREATE INDEX idx_cocina_lotes_pasta_sobrante_origen ON public.cocina_lotes_pasta USING btree (sobrante_origen_lote_id);
CREATE INDEX idx_lotes_pasta_sobrante_pendiente ON public.cocina_lotes_pasta USING btree (local, producto_id) WHERE ((sobrante_gramos IS NOT NULL) AND (sobrante_gramos > (0)::numeric));
CREATE INDEX idx_lotes_pasta_ubicacion_local ON public.cocina_lotes_pasta USING btree (ubicacion, local);
CREATE UNIQUE INDEX cocina_lotes_pasta_masas_pkey ON public.cocina_lotes_pasta_masas USING btree (id);
CREATE INDEX idx_clpm_lote_masa ON public.cocina_lotes_pasta_masas USING btree (lote_masa_id);
CREATE INDEX idx_clpm_lote_pasta ON public.cocina_lotes_pasta_masas USING btree (lote_pasta_id);
CREATE UNIQUE INDEX cocina_lotes_produccion_pkey ON public.cocina_lotes_produccion USING btree (id);
CREATE INDEX idx_clp_categoria ON public.cocina_lotes_produccion USING btree (categoria);
CREATE INDEX idx_clp_en_stock_fecha ON public.cocina_lotes_produccion USING btree (en_stock, fecha DESC) WHERE (en_stock = true);
CREATE INDEX idx_clp_fecha ON public.cocina_lotes_produccion USING btree (fecha);
CREATE INDEX idx_clp_local ON public.cocina_lotes_produccion USING btree (local);
CREATE INDEX idx_cocina_lotes_produccion_receta ON public.cocina_lotes_produccion USING btree (receta_id);
CREATE UNIQUE INDEX cocina_lotes_relleno_pkey ON public.cocina_lotes_relleno USING btree (id);
CREATE INDEX idx_cocina_lotes_relleno_receta ON public.cocina_lotes_relleno USING btree (receta_id);
CREATE UNIQUE INDEX cocina_merma_pkey ON public.cocina_merma USING btree (id);
CREATE INDEX cocina_merma_receta_idx ON public.cocina_merma USING btree (receta_id) WHERE (receta_id IS NOT NULL);
CREATE INDEX idx_cocina_merma_producto ON public.cocina_merma USING btree (producto_id);
CREATE UNIQUE INDEX cocina_pasta_recetas_pasta_id_receta_id_key ON public.cocina_pasta_recetas USING btree (pasta_id, receta_id);
CREATE INDEX cocina_pasta_recetas_pasta_idx ON public.cocina_pasta_recetas USING btree (pasta_id);
CREATE UNIQUE INDEX cocina_pasta_recetas_pkey ON public.cocina_pasta_recetas USING btree (id);
CREATE INDEX cocina_pasta_recetas_receta_idx ON public.cocina_pasta_recetas USING btree (receta_id);
CREATE INDEX cocina_pizarron_fecha_local_idx ON public.cocina_pizarron_items USING btree (fecha_objetivo, local);
CREATE UNIQUE INDEX cocina_pizarron_items_pkey ON public.cocina_pizarron_items USING btree (id);
CREATE INDEX cocina_pizarron_pendientes_idx ON public.cocina_pizarron_items USING btree (fecha_objetivo, local, tipo, receta_id) WHERE (estado = 'pendiente'::text);
CREATE INDEX idx_cocina_pizarron_items_publicado_por ON public.cocina_pizarron_items USING btree (publicado_por);
CREATE INDEX idx_cocina_pizarron_items_receta ON public.cocina_pizarron_items USING btree (receta_id);
CREATE UNIQUE INDEX cocina_productos_codigo_key ON public.cocina_productos USING btree (codigo);
CREATE UNIQUE INDEX cocina_productos_pkey ON public.cocina_productos USING btree (id);
CREATE INDEX idx_cocina_productos_fudo_nombres ON public.cocina_productos USING gin (fudo_nombres);
CREATE INDEX idx_cocina_productos_receta ON public.cocina_productos USING btree (receta_id);
CREATE UNIQUE INDEX cocina_productos_precio_historial_pkey ON public.cocina_productos_precio_historial USING btree (id);
CREATE INDEX idx_precio_historial_producto ON public.cocina_productos_precio_historial USING btree (cocina_producto_id, fecha DESC);
CREATE UNIQUE INDEX cocina_productos_precios_canal_cocina_producto_id_canal_key ON public.cocina_productos_precios_canal USING btree (cocina_producto_id, canal);
CREATE UNIQUE INDEX cocina_productos_precios_canal_pkey ON public.cocina_productos_precios_canal USING btree (id);
CREATE INDEX idx_precios_canal_producto ON public.cocina_productos_precios_canal USING btree (cocina_producto_id);
CREATE UNIQUE INDEX cocina_receta_ingredientes_pkey ON public.cocina_receta_ingredientes USING btree (id);
CREATE INDEX idx_cocina_receta_ingredientes_producto ON public.cocina_receta_ingredientes USING btree (producto_id);
CREATE INDEX idx_cocina_receta_ingredientes_receta ON public.cocina_receta_ingredientes USING btree (receta_id);
CREATE UNIQUE INDEX cocina_recetas_nombre_local_unique ON public.cocina_recetas USING btree (nombre, local);
CREATE UNIQUE INDEX cocina_recetas_pkey ON public.cocina_recetas USING btree (id);
CREATE INDEX idx_cocina_recetas_descuenta_producto ON public.cocina_recetas USING btree (descuenta_producto_id) WHERE (descuenta_producto_id IS NOT NULL);
CREATE INDEX idx_cocina_recetas_fudo_productos ON public.cocina_recetas USING gin (fudo_productos);
CREATE UNIQUE INDEX cocina_recetas_precios_canal_pkey ON public.cocina_recetas_precios_canal USING btree (id);
CREATE UNIQUE INDEX cocina_recetas_precios_canal_receta_id_canal_key ON public.cocina_recetas_precios_canal USING btree (receta_id, canal);
CREATE UNIQUE INDEX cocina_recetas_precios_historial_pkey ON public.cocina_recetas_precios_historial USING btree (id);
CREATE INDEX idx_recetas_precio_hist_fecha ON public.cocina_recetas_precios_historial USING btree (fecha DESC);
CREATE INDEX idx_recetas_precio_hist_receta ON public.cocina_recetas_precios_historial USING btree (receta_id, canal, fecha DESC);
CREATE UNIQUE INDEX cocina_traspasos_pkey ON public.cocina_traspasos USING btree (id);
CREATE INDEX idx_cocina_traspasos_producto ON public.cocina_traspasos USING btree (producto_id);
CREATE UNIQUE INDEX comision_mp_config_pkey ON public.comision_mp_config USING btree (medio_pago);
CREATE UNIQUE INDEX comprobantes_hash_archivo_key ON public.comprobantes USING btree (hash_archivo);
CREATE UNIQUE INDEX comprobantes_pkey ON public.comprobantes USING btree (id);
CREATE INDEX idx_comprobantes_estado ON public.comprobantes USING btree (estado);
CREATE INDEX idx_comprobantes_gasto_id ON public.comprobantes USING btree (gasto_id);
CREATE INDEX idx_comprobantes_monto_fecha ON public.comprobantes USING btree (monto_extraido, fecha_extraida);
CREATE INDEX idx_comprobantes_n_operacion ON public.comprobantes USING btree (n_operacion) WHERE (n_operacion IS NOT NULL);
CREATE UNIQUE INDEX configuracion_pkey ON public.configuracion USING btree (clave);
CREATE UNIQUE INDEX convenios_local_fudo_customer_id_key ON public.convenios USING btree (local, fudo_customer_id);
CREATE UNIQUE INDEX convenios_pkey ON public.convenios USING btree (id);
CREATE INDEX idx_convenios_local ON public.convenios USING btree (local);
CREATE UNIQUE INDEX correo_integracion_pkey ON public.correo_integracion USING btree (id);
CREATE UNIQUE INDEX cronograma_empleado_id_fecha_key ON public.cronograma USING btree (empleado_id, fecha);
CREATE UNIQUE INDEX cronograma_pkey ON public.cronograma USING btree (id);
CREATE INDEX idx_cronograma_empleado ON public.cronograma USING btree (empleado_id);
CREATE INDEX idx_cronograma_fecha ON public.cronograma USING btree (fecha);
CREATE UNIQUE INDEX descuentos_pkey ON public.descuentos USING btree (id);
CREATE INDEX idx_descuentos_empleado_periodo ON public.descuentos USING btree (empleado_id, periodo);
CREATE UNIQUE INDEX dividendos_pkey ON public.dividendos USING btree (id);
CREATE INDEX idx_dividendos_periodo ON public.dividendos USING btree (periodo);
CREATE UNIQUE INDEX edr_cierres_inventario_local_periodo_key ON public.edr_cierres_inventario USING btree (local, periodo);
CREATE UNIQUE INDEX edr_cierres_inventario_pkey ON public.edr_cierres_inventario USING btree (id);
CREATE INDEX idx_edr_cierres_inv_aprobados ON public.edr_cierres_inventario USING btree (local, periodo) WHERE (estado = 'aprobado'::text);
CREATE INDEX idx_edr_cierres_inv_estado ON public.edr_cierres_inventario USING btree (estado, periodo) WHERE (estado = 'pendiente'::text);
CREATE UNIQUE INDEX edr_partidas_local_periodo_concepto_key ON public.edr_partidas USING btree (local, periodo, concepto);
CREATE UNIQUE INDEX edr_partidas_pkey ON public.edr_partidas USING btree (id);
CREATE INDEX idx_edr_local_periodo ON public.edr_partidas USING btree (local, periodo);
CREATE UNIQUE INDEX efemerides_gastronomicas_pkey ON public.efemerides_gastronomicas USING btree (id);
CREATE INDEX idx_efemerides_fecha ON public.efemerides_gastronomicas USING btree (mes, dia) WHERE (activo = true);
CREATE UNIQUE INDEX empleados_dni_key ON public.empleados USING btree (dni);
CREATE UNIQUE INDEX empleados_pin_fichaje_unico ON public.empleados USING btree (pin_fichaje);
CREATE UNIQUE INDEX empleados_pkey ON public.empleados USING btree (id);
CREATE INDEX idx_empleados_activo ON public.empleados USING btree (activo);
CREATE INDEX idx_empleados_estado ON public.empleados USING btree (estado_laboral);
CREATE INDEX idx_empleados_local ON public.empleados USING btree (local);
CREATE UNIQUE INDEX extractos_estado_pkey ON public.extractos_estado USING btree (cuenta);
CREATE UNIQUE INDEX fichadas_pkey ON public.fichadas USING btree (id);
CREATE INDEX idx_fichadas_empleado_fecha ON public.fichadas USING btree (empleado_id, fecha);
CREATE INDEX idx_fichadas_evento ON public.fichadas USING btree (evento, fecha) WHERE (evento IS NOT NULL);
CREATE UNIQUE INDEX fudo_sync_runs_pkey ON public.fudo_sync_runs USING btree (id);
CREATE INDEX idx_fudo_sync_runs_local_finished ON public.fudo_sync_runs USING btree (local, finished_at DESC NULLS LAST) WHERE (status = 'ok'::text);
CREATE UNIQUE INDEX fudo_tokens_pkey ON public.fudo_tokens USING btree (local);
CREATE INDEX gastos_created_at_desc_idx ON public.gastos USING btree (created_at DESC);
CREATE UNIQUE INDEX gastos_local_fudo_id_key ON public.gastos USING btree (local, fudo_id);
CREATE UNIQUE INDEX gastos_pkey ON public.gastos USING btree (id);
CREATE INDEX idx_gastos_categoria_id ON public.gastos USING btree (categoria_id);
CREATE INDEX idx_gastos_cuenta ON public.gastos USING btree (cuenta);
CREATE INDEX idx_gastos_local_periodo ON public.gastos USING btree (local, periodo);
CREATE INDEX idx_gastos_medio ON public.gastos USING btree (medio_pago_id);
CREATE INDEX idx_gastos_proveedor_id ON public.gastos USING btree (proveedor_id);
CREATE INDEX idx_gastos_regla_id ON public.gastos USING btree (regla_id, periodo) WHERE (regla_id IS NOT NULL);
CREATE INDEX gastos_backfill_log_batch_idx ON public.gastos_backfill_proveedor_id_log USING btree (batch_label);
CREATE INDEX gastos_backfill_log_gasto_idx ON public.gastos_backfill_proveedor_id_log USING btree (gasto_id);
CREATE UNIQUE INDEX gastos_backfill_proveedor_id_log_pkey ON public.gastos_backfill_proveedor_id_log USING btree (id);
CREATE UNIQUE INDEX impuestos_mensuales_periodo_key ON public.impuestos_mensuales USING btree (periodo);
CREATE UNIQUE INDEX impuestos_mensuales_pkey ON public.impuestos_mensuales USING btree (id);
CREATE INDEX idx_liq_periodo ON public.liquidaciones_quincenales USING btree (periodo);
CREATE UNIQUE INDEX liquidaciones_quincenales_empleado_id_periodo_key ON public.liquidaciones_quincenales USING btree (empleado_id, periodo);
CREATE UNIQUE INDEX liquidaciones_quincenales_pkey ON public.liquidaciones_quincenales USING btree (id);
CREATE UNIQUE INDEX medios_pago_codigo_key ON public.medios_pago USING btree (codigo);
CREATE UNIQUE INDEX medios_pago_pkey ON public.medios_pago USING btree (id);
CREATE UNIQUE INDEX medios_pago_alias_pkey ON public.medios_pago_alias USING btree (alias);
CREATE INDEX idx_mov_gasto ON public.movimientos_bancarios USING btree (gasto_id) WHERE (gasto_id IS NOT NULL);
CREATE INDEX idx_mov_par ON public.movimientos_bancarios USING btree (transferencia_par_id) WHERE (transferencia_par_id IS NOT NULL);
CREATE INDEX idx_mov_tipo ON public.movimientos_bancarios USING btree (tipo);
CREATE INDEX idx_movimientos_cuenta ON public.movimientos_bancarios USING btree (cuenta, periodo);
CREATE UNIQUE INDEX movimientos_bancarios_cuenta_fecha_referencia_debito_credit_key ON public.movimientos_bancarios USING btree (cuenta, fecha, referencia, debito, credito);
CREATE UNIQUE INDEX movimientos_bancarios_pkey ON public.movimientos_bancarios USING btree (id);
CREATE INDEX idx_mov_stock_local ON public.movimientos_stock USING btree (local, created_at DESC);
CREATE INDEX idx_mov_stock_producto ON public.movimientos_stock USING btree (producto_id);
CREATE UNIQUE INDEX movimientos_stock_pkey ON public.movimientos_stock USING btree (id);
CREATE INDEX idx_mp_release_reports_status ON public.mp_release_reports USING btree (status, created_at);
CREATE UNIQUE INDEX mp_release_reports_pkey ON public.mp_release_reports USING btree (id);
CREATE INDEX idx_mp_sync_runs_started_at ON public.mp_sync_runs USING btree (started_at DESC);
CREATE UNIQUE INDEX mp_sync_runs_pkey ON public.mp_sync_runs USING btree (id);
CREATE INDEX idx_pagos_fijos_categoria_gasto ON public.pagos_fijos USING btree (categoria_gasto_id);
CREATE INDEX idx_pagos_fijos_gasto ON public.pagos_fijos USING btree (gasto_id);
CREATE UNIQUE INDEX pagos_fijos_periodo_concepto_key ON public.pagos_fijos USING btree (periodo, concepto);
CREATE UNIQUE INDEX pagos_fijos_pkey ON public.pagos_fijos USING btree (id);
CREATE UNIQUE INDEX pagos_fijos_vep_numero_uidx ON public.pagos_fijos USING btree (vep_numero) WHERE (vep_numero IS NOT NULL);
CREATE INDEX idx_pagos_fecha ON public.pagos_gastos USING btree (fecha_pago);
CREATE INDEX idx_pagos_gasto ON public.pagos_gastos USING btree (gasto_id);
CREATE INDEX idx_pagos_gastos_cuenta ON public.pagos_gastos USING btree (cuenta);
CREATE INDEX idx_pagos_gastos_medio ON public.pagos_gastos USING btree (medio_pago_id);
CREATE INDEX idx_pagos_gastos_numero_operacion ON public.pagos_gastos USING btree (numero_operacion) WHERE (numero_operacion IS NOT NULL);
CREATE UNIQUE INDEX pagos_gastos_pkey ON public.pagos_gastos USING btree (id);
CREATE INDEX idx_pagos_mp_fecha ON public.pagos_mp USING btree (fecha);
CREATE INDEX idx_pagos_mp_periodo ON public.pagos_mp USING btree (periodo);
CREATE UNIQUE INDEX pagos_mp_pkey ON public.pagos_mp USING btree (id);
CREATE INDEX idx_pagos_sueldos_conciliado ON public.pagos_sueldos USING btree (conciliado_movimiento_id) WHERE (conciliado_movimiento_id IS NOT NULL);
CREATE INDEX pagos_sueldos_empleado_periodo_idx ON public.pagos_sueldos USING btree (empleado_id, periodo);
CREATE UNIQUE INDEX pagos_sueldos_pkey ON public.pagos_sueldos USING btree (id);
CREATE UNIQUE INDEX perfiles_pkey ON public.perfiles USING btree (user_id);
CREATE INDEX idx_productos_categoria_gasto ON public.productos USING btree (categoria_gasto_id);
CREATE INDEX idx_productos_local ON public.productos USING btree (local);
CREATE UNIQUE INDEX productos_local_nombre_key ON public.productos USING btree (local, nombre);
CREATE UNIQUE INDEX productos_nombre_local_unique ON public.productos USING btree (nombre, local);
CREATE UNIQUE INDEX productos_pkey ON public.productos USING btree (id);
CREATE UNIQUE INDEX productos_acciones_estado_accion_key_key ON public.productos_acciones_estado USING btree (accion_key);
CREATE INDEX productos_acciones_estado_local_idx ON public.productos_acciones_estado USING btree (local);
CREATE UNIQUE INDEX productos_acciones_estado_pkey ON public.productos_acciones_estado USING btree (id);
CREATE UNIQUE INDEX productos_costeo_config_pkey ON public.productos_costeo_config USING btree (categoria);
CREATE INDEX idx_costo_historial_producto ON public.productos_costo_historial USING btree (producto_id, fecha DESC);
CREATE UNIQUE INDEX productos_costo_historial_pkey ON public.productos_costo_historial USING btree (id);
CREATE INDEX idx_proveedores_razon ON public.proveedores USING btree (razon_social);
CREATE INDEX proveedores_aliases_gin ON public.proveedores USING gin (aliases);
CREATE UNIQUE INDEX proveedores_pkey ON public.proveedores USING btree (id);
CREATE UNIQUE INDEX ux_proveedores_cuit ON public.proveedores USING btree (cuit) WHERE (cuit IS NOT NULL);
CREATE UNIQUE INDEX proyeccion_config_pkey ON public.proyeccion_config USING btree (id);
CREATE INDEX idx_proy_items_periodo ON public.proyeccion_flujo_items USING btree (periodo);
CREATE UNIQUE INDEX proyeccion_flujo_items_pkey ON public.proyeccion_flujo_items USING btree (id);
CREATE UNIQUE INDEX push_subscriptions_endpoint_key ON public.push_subscriptions USING btree (endpoint);
CREATE UNIQUE INDEX push_subscriptions_pkey ON public.push_subscriptions USING btree (id);
CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id);
CREATE INDEX idx_recepciones_estado ON public.recepciones_pendientes USING btree (estado, local);
CREATE INDEX idx_recepciones_pendientes_gasto ON public.recepciones_pendientes USING btree (gasto_id);
CREATE UNIQUE INDEX recepciones_pendientes_pkey ON public.recepciones_pendientes USING btree (id);
CREATE INDEX recibos_sueldo_empleado_idx ON public.recibos_sueldo USING btree (empleado_id);
CREATE UNIQUE INDEX recibos_sueldo_pkey ON public.recibos_sueldo USING btree (id);
CREATE INDEX idx_reglas_movimiento_activo ON public.reglas_movimiento USING btree (activo, prioridad);
CREATE UNIQUE INDEX reglas_movimiento_pkey ON public.reglas_movimiento USING btree (id);
CREATE INDEX idx_saldos_cuentas_cuenta_fecha ON public.saldos_cuentas USING btree (cuenta, fecha DESC);
CREATE UNIQUE INDEX saldos_cuentas_cuenta_fecha_key ON public.saldos_cuentas USING btree (cuenta, fecha);
CREATE UNIQUE INDEX saldos_cuentas_pkey ON public.saldos_cuentas USING btree (id);
CREATE INDEX idx_sanciones_emp_periodo ON public.sanciones USING btree (empleado_id, periodo);
CREATE UNIQUE INDEX sanciones_pkey ON public.sanciones USING btree (id);
CREATE UNIQUE INDEX sueldos_mensuales_empleado_id_periodo_key ON public.sueldos_mensuales USING btree (empleado_id, periodo);
CREATE UNIQUE INDEX sueldos_mensuales_pkey ON public.sueldos_mensuales USING btree (id);
CREATE INDEX idx_vacaciones_anio ON public.vacaciones USING btree (anio_correspondiente);
CREATE INDEX idx_vacaciones_empleado ON public.vacaciones USING btree (empleado_id);
CREATE UNIQUE INDEX vacaciones_pkey ON public.vacaciones USING btree (id);
CREATE INDEX ix_ventas_comprobantes_cola ON public.ventas_comprobantes USING btree (creado_at) WHERE (estado = ANY (ARRAY['pendiente'::text, 'error'::text]));
CREATE INDEX ix_ventas_comprobantes_local_fecha ON public.ventas_comprobantes USING btree (local, fecha_comprobante DESC);
CREATE INDEX ix_ventas_comprobantes_ticket ON public.ventas_comprobantes USING btree (ticket_id);
CREATE UNIQUE INDEX ux_ventas_comprobantes_numeracion ON public.ventas_comprobantes USING btree (ambiente, punto_venta, tipo_comprobante, numero) WHERE (numero IS NOT NULL);
CREATE UNIQUE INDEX ux_ventas_comprobantes_un_vivo_por_ticket ON public.ventas_comprobantes USING btree (ticket_id) WHERE ((anula_comprobante_id IS NULL) AND (estado <> 'anulado'::text));
CREATE UNIQUE INDEX ventas_comprobantes_pkey ON public.ventas_comprobantes USING btree (id);
CREATE INDEX idx_items_local_periodo ON public.ventas_items USING btree (local, periodo);
CREATE INDEX idx_ventas_items_local_fecha ON public.ventas_items USING btree (local, fecha);
CREATE INDEX idx_ventas_items_padre ON public.ventas_items USING btree (linea_padre_id);
CREATE INDEX idx_ventas_items_producto ON public.ventas_items USING btree (cocina_producto_id);
CREATE INDEX idx_ventas_items_receta ON public.ventas_items USING btree (receta_id);
CREATE INDEX idx_ventas_items_ticket ON public.ventas_items USING btree (ticket_id);
CREATE UNIQUE INDEX ventas_items_pkey ON public.ventas_items USING btree (id);
CREATE UNIQUE INDEX ventas_items_pos_ticket_linea_key ON public.ventas_items USING btree (ticket_id, linea) WHERE (origen = 'pos'::text);
CREATE UNIQUE INDEX ventas_mensuales_historico_pkey ON public.ventas_mensuales_historico USING btree (local, periodo);
CREATE UNIQUE INDEX ventas_origen_oficial_pkey ON public.ventas_origen_oficial USING btree (local);
CREATE INDEX idx_pagos_local_periodo ON public.ventas_pagos USING btree (local, periodo);
CREATE INDEX idx_ventas_pagos_cuenta ON public.ventas_pagos USING btree (cuenta);
CREATE INDEX idx_ventas_pagos_medio ON public.ventas_pagos USING btree (medio_pago_id);
CREATE INDEX idx_ventas_pagos_origen ON public.ventas_pagos USING btree (local, periodo, origen);
CREATE INDEX idx_ventas_pagos_ticket ON public.ventas_pagos USING btree (ticket_id);
CREATE INDEX idx_ventas_pagos_ticket_id ON public.ventas_pagos USING btree (ticket_id);
CREATE UNIQUE INDEX ventas_pagos_pkey ON public.ventas_pagos USING btree (id);
CREATE INDEX idx_tickets_fecha ON public.ventas_tickets USING btree (fecha DESC);
CREATE INDEX idx_tickets_local_fecha_medio ON public.ventas_tickets USING btree (local, fecha, medio_pago);
CREATE INDEX idx_tickets_local_periodo ON public.ventas_tickets USING btree (local, periodo);
CREATE INDEX idx_ventas_tickets_cierre_caja ON public.ventas_tickets USING btree (cierre_caja_id);
CREATE INDEX idx_ventas_tickets_convenio ON public.ventas_tickets USING btree (convenio_id) WHERE (convenio_id IS NOT NULL);
CREATE INDEX idx_ventas_tickets_cuenta ON public.ventas_tickets USING btree (cuenta);
CREATE INDEX idx_ventas_tickets_medio ON public.ventas_tickets USING btree (medio_pago_id);
CREATE UNIQUE INDEX ventas_tickets_idempotencia_key ON public.ventas_tickets USING btree (idempotencia) WHERE (idempotencia IS NOT NULL);
CREATE UNIQUE INDEX ventas_tickets_local_fudo_id_key ON public.ventas_tickets USING btree (local, fudo_id);
CREATE UNIQUE INDEX ventas_tickets_pkey ON public.ventas_tickets USING btree (id);
CREATE INDEX veps_pendientes_idx ON public.veps USING btree (pagado, vencimiento);
CREATE UNIQUE INDEX veps_pkey ON public.veps USING btree (id);

-- ── REALTIME (publicaciones) ────────────────────────────────────

alter publication supabase_realtime add table public.cocina_lotes_pasta;
alter publication supabase_realtime add table public.cocina_merma;
alter publication supabase_realtime add table public.cocina_traspasos;
