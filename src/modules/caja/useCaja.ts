import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type LocalCaja = 'vedia' | 'saavedra';

/**
 * Canal de precio que usa el mostrador. El catálogo tiene precios distintos por
 * canal (plato / vianda / congelado); la caja del salón cobra el de "plato".
 */
export const CANAL_MOSTRADOR = 'plato';

// ── Catálogo ─────────────────────────────────────────────────────────────────

export interface ItemCatalogo {
  /** clave para React y para el buscador; no se guarda en la base */
  key: string;
  tipo: 'receta' | 'producto';
  /** apunta a cocina_recetas.id o a cocina_productos.id */
  refId: string;
  nombre: string;
  codigo: string | null;
  categoria: string | null;
  /** con qué se agrupa en la pantalla: pasta, salsa, bebida, postre… */
  grupo: string;
  precio: number;
}

/** Las masas son insumos de cocina, no algo que se venda en el mostrador. */
const GRUPOS_NO_VENDIBLES = new Set(['masa']);

/** Orden en que se muestran los grupos: primero lo que más se tickea. */
export const ORDEN_GRUPOS = ['pasta', 'salsa', 'bebida', 'postre', 'otros'];

export function ordenGrupo(g: string): number {
  const i = ORDEN_GRUPOS.indexOf(g);
  return i === -1 ? ORDEN_GRUPOS.length : i;
}

/**
 * Lo que se puede vender en el mostrador de un local.
 *
 * REGLA (Lucas, 31-ago-2026): el catálogo son las **recetas individuales**, y
 * nada más. El modelo de cocina tiene dos capas:
 *   · la receta TOTAL (subreceta "X Base") = el lote, rinde N kg o N porciones,
 *     no tiene precio porque no se vende;
 *   · la receta INDIVIDUAL (tipo receta, rinde 1 porción, marcada vendible) =
 *     lo que se cobra, y **el precio SIEMPRE vive acá**.
 *
 * Por eso NO se leen los `cocina_productos`: sus precios son copias viejas
 * (Bolognesa figuraba $7.300 cuando se cobra $8.500), traían duplicados con
 * otra grafía ("Tagliatelles al huevo" vs la receta "Tagliatelles Huevo") y
 * seguían mostrando cosas que ya salieron del menú, como Parisienne.
 *
 * Si algo se vende y no aparece acá, la solución es darle su receta individual
 * en Productos — no cargarle un precio suelto al producto.
 */
export function useCatalogoCaja(local: LocalCaja) {
  return useQuery({
    queryKey: ['caja-catalogo', local, CANAL_MOSTRADOR],
    staleTime: 1000 * 60 * 10,
    queryFn: async (): Promise<ItemCatalogo[]> => {
      const [recetasRes, preciosRecetaRes] = await Promise.all([
        supabase
          .from('cocina_recetas')
          .select('id, nombre, categoria')
          .eq('local', local)
          .eq('vendible', true)
          .eq('activo', true),
        supabase
          .from('cocina_recetas_precios_canal')
          .select('receta_id, precio')
          .eq('canal', CANAL_MOSTRADOR),
      ]);

      const primerError = recetasRes.error || preciosRecetaRes.error;
      if (primerError) throw primerError;

      const precioReceta = new Map<string, number>();
      for (const p of preciosRecetaRes.data ?? []) {
        const v = Number(p.precio);
        if (v > 0) precioReceta.set(p.receta_id, v);
      }

      const items: ItemCatalogo[] = [];
      for (const r of recetasRes.data ?? []) {
        // sin precio de mostrador no se puede cobrar: queda afuera
        const precio = precioReceta.get(r.id);
        if (!precio) continue;
        const grupo = (r.categoria ?? 'otros').toLowerCase();
        if (GRUPOS_NO_VENDIBLES.has(grupo)) continue;
        items.push({
          key: `receta:${r.id}`,
          tipo: 'receta',
          refId: r.id,
          nombre: r.nombre,
          codigo: null,
          categoria: r.categoria ?? null,
          grupo,
          precio,
        });
      }

      return items.sort(
        (a, b) => ordenGrupo(a.grupo) - ordenGrupo(b.grupo) || a.nombre.localeCompare(b.nombre, 'es'),
      );
    },
  });
}

// ── Descuentos ───────────────────────────────────────────────────────────────

/**
 * Lo que se bonifica en una línea.
 *
 * ⚠️ El redondeo va acá y en un solo lugar: si cada pantalla redondeara por su
 * cuenta, el total del ticket no cerraría con la suma de las líneas por unos
 * pesos, y esa diferencia terminaría apareciendo en el arqueo.
 */
export function descuentoDeLinea(bruto: number, pct: number): number {
  if (!pct || pct <= 0) return 0;
  return Math.round(bruto * Math.min(pct, 100)) / 100;
}

export interface ConvenioCaja {
  id: string;
  nombre: string;
  descuentoPct: number;
}

/**
 * Los convenios vigentes del local, para aplicar su descuento al cobrar.
 *
 * Reemplaza el truco de Fudo de cargar un producto inventado ("ADICIONAL POR
 * DESC.") con importe negativo: acá el descuento queda atado a la venta y al
 * convenio, y se puede medir cuánto se bonificó a cada uno.
 */
export function useConveniosCaja(local: LocalCaja) {
  return useQuery({
    queryKey: ['caja-convenios', local],
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<ConvenioCaja[]> => {
      const hoy = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('convenios')
        .select('id, nombre, descuento_pct, vigencia_desde, vigencia_hasta')
        .eq('local', local)
        .eq('activo', true)
        .gt('descuento_pct', 0)
        .order('nombre');
      if (error) throw error;
      return (data ?? [])
        // Vigencia sin cargar = sin límite, que es como están todos hoy.
        .filter((c) => !c.vigencia_desde || c.vigencia_desde <= hoy)
        .filter((c) => !c.vigencia_hasta || c.vigencia_hasta >= hoy)
        .map((c) => ({ id: c.id, nombre: c.nombre, descuentoPct: Number(c.descuento_pct) }));
    },
  });
}

// ── Medios de pago ───────────────────────────────────────────────────────────

export interface MedioPagoCaja {
  id: string;
  codigo: string;
  nombre: string;
  es_efectivo: boolean;
}

export function useMediosPagoCaja() {
  return useQuery({
    queryKey: ['caja-medios-pago'],
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<MedioPagoCaja[]> => {
      const { data, error } = await supabase
        .from('medios_pago')
        .select('id, codigo, nombre, es_efectivo')
        .eq('aplica_ventas', true)
        .eq('activo', true)
        .neq('codigo', 'sin_especificar')
        .order('orden');
      if (error) throw error;
      return (data ?? []) as MedioPagoCaja[];
    },
  });
}

// ── Turno ────────────────────────────────────────────────────────────────────

export interface TurnoCaja {
  id: string;
  local: string;
  fecha: string;
  turno: string;
  caja: string;
  fondo_apertura: number;
  hora_inicio: string | null;
  hora_cierre: string | null;
  cajero_nombre: string | null;
}

/**
 * El turno abierto de esa caja, si hay. Se busca en los últimos días y no solo
 * en hoy porque el turno noche de Vedia cierra pasada la medianoche.
 *
 * ⚠️ LANDMINE: **no alcanza con `hora_cierre IS NULL`**. Los cierres que carga
 * administración a mano (módulo Cierre de Caja) nunca completan esa columna —
 * las 822 filas de la tabla la tienen en NULL. Si buscáramos solo por ahí, el
 * POS agarraría el cierre de ayer cargado por administración como si fuera "tu
 * turno abierto" y le metería los tickets adentro.
 *
 * Por eso `cierres_caja.origen` (migración 146): turno abierto = lo abrió el
 * POS **y** todavía no cerró.
 */
export function useTurnoAbierto(local: LocalCaja, caja: string) {
  return useQuery({
    queryKey: ['caja-turno-abierto', local, caja],
    enabled: !!caja,
    queryFn: async (): Promise<TurnoCaja | null> => {
      const desde = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('cierres_caja')
        .select('id, local, fecha, turno, caja, fondo_apertura, hora_inicio, hora_cierre, cajero_nombre')
        .eq('local', local)
        .eq('caja', caja)
        .eq('origen', 'pos')
        .gte('fecha', desde)
        .is('hora_cierre', null)
        .order('fecha', { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] as TurnoCaja | undefined) ?? null;
    },
  });
}

export interface TurnoAbiertoResumen {
  id: string;
  local: string;
  fecha: string;
  turno: string;
  caja: string;
  fondoApertura: number;
  horaInicio: string | null;
  cajeroNombre: string | null;
  /** cuántas ventas lleva cobradas ese turno */
  tickets: number;
  /** cuánto lleva cobrado, sumando todos los medios */
  cobrado: number;
}

/**
 * Los turnos que quedaron abiertos, o sea el **arqueo en curso**. Es lo que el
 * ERP muestra en el módulo Caja y en el menú, para que se vea de un vistazo que
 * hay una caja trabajando ahora mismo.
 *
 * Se miran los últimos 3 días y no solo hoy porque el turno noche de Vedia
 * cierra pasada la medianoche — mismo criterio que `useTurnoAbierto`, incluido
 * el filtro por `origen='pos'` (sin eso aparecerían como "en curso" los 821
 * cierres que cargó administración a mano, que nunca completan `hora_cierre`).
 *
 * ⚠️ `local` va en la queryKey: sin eso, la vista del usuario restringido a un
 * local y la del administrador se pisarían en la caché.
 */
export function useTurnosAbiertos(local: LocalCaja | null, habilitado = true) {
  return useQuery({
    queryKey: ['caja-turnos-abiertos', local],
    enabled: habilitado,
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60,
    queryFn: async (): Promise<TurnoAbiertoResumen[]> => {
      const desde = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      let consulta = supabase
        .from('cierres_caja')
        .select('id, local, fecha, turno, caja, fondo_apertura, hora_inicio, cajero_nombre')
        .eq('origen', 'pos')
        .gte('fecha', desde)
        .is('hora_cierre', null)
        .order('fecha', { ascending: false })
        .order('caja');
      if (local) consulta = consulta.eq('local', local);

      const { data, error } = await consulta;
      if (error) throw error;
      const turnos = data ?? [];
      if (turnos.length === 0) return [];

      const { data: tickets, error: eTickets } = await supabase
        .from('ventas_tickets')
        .select('cierre_caja_id, total_bruto')
        .in(
          'cierre_caja_id',
          turnos.map((t) => t.id),
        );
      if (eTickets) throw eTickets;

      const acumulado = new Map<string, { tickets: number; cobrado: number }>();
      for (const t of tickets ?? []) {
        if (!t.cierre_caja_id) continue;
        const a = acumulado.get(t.cierre_caja_id) ?? { tickets: 0, cobrado: 0 };
        a.tickets += 1;
        a.cobrado += Number(t.total_bruto);
        acumulado.set(t.cierre_caja_id, a);
      }

      return turnos.map((t) => {
        const a = acumulado.get(t.id) ?? { tickets: 0, cobrado: 0 };
        return {
          id: t.id,
          local: t.local,
          fecha: t.fecha,
          turno: t.turno,
          caja: t.caja,
          fondoApertura: Number(t.fondo_apertura ?? 0),
          horaInicio: t.hora_inicio,
          cajeroNombre: t.cajero_nombre,
          tickets: a.tickets,
          cobrado: a.cobrado,
        };
      });
    },
  });
}

export interface PagoDeVenta {
  /** medios_pago.id — la identidad de verdad; el nombre es solo para mostrar */
  medioId: string | null;
  /** medios_pago.codigo: efectivo, qr, debito, credito, transferencia, mp_lucas */
  codigo: string | null;
  medio: string;
  esEfectivo: boolean;
  monto: number;
}

export interface VentaTurno {
  ticketId: string;
  total: number;
  hora: string | null;
  cliente: string | null;
  pagos: PagoDeVenta[];
}

export interface LineaTicketGuardada {
  id: string;
  linea: number | null;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  descuentoMonto: number;
  /** lo que se cobró, con el descuento ya restado */
  total: number;
  esHija: boolean;
}

/**
 * El detalle de una venta ya cobrada, para poder mirarla o volver a imprimirla
 * (se perdió el ticket, la comanda no llegó a cocina, etc.).
 */
export function useDetalleTicket(ticketId: string | null) {
  return useQuery({
    queryKey: ['caja-detalle-ticket', ticketId],
    enabled: !!ticketId,
    queryFn: async (): Promise<LineaTicketGuardada[]> => {
      const { data, error } = await supabase
        .from('ventas_items')
        .select(
          'id, linea, nombre, cantidad, precio_unitario, descuento_pct, descuento_monto, total, linea_padre_id',
        )
        .eq('ticket_id', ticketId!)
        .order('linea');
      if (error) throw error;
      return (data ?? []).map((l) => ({
        id: l.id,
        linea: l.linea,
        nombre: l.nombre,
        cantidad: Number(l.cantidad),
        precioUnitario: Number(l.precio_unitario ?? 0),
        descuentoPct: Number(l.descuento_pct ?? 0),
        descuentoMonto: Number(l.descuento_monto ?? 0),
        total: Number(l.total),
        esHija: !!l.linea_padre_id,
      }));
    },
  });
}

/** Las ventas cobradas en un turno, con el detalle de cómo se pagó cada una. */
export function useVentasDelTurno(turnoId: string | null) {
  return useQuery({
    queryKey: ['caja-ventas-turno', turnoId],
    enabled: !!turnoId,
    // Se refresca solo: el tablero del ERP muestra el turno EN VIVO, y sin esto
    // quedaría desfasado del encabezado (que sí se refresca cada minuto). En el
    // POS no hace falta porque cada cobro invalida la consulta, pero no molesta.
    refetchInterval: 1000 * 60,
    queryFn: async (): Promise<VentaTurno[]> => {
      const { data: tickets, error: e1 } = await supabase
        .from('ventas_tickets')
        .select('id, total_bruto, hora, cliente')
        .eq('cierre_caja_id', turnoId!)
        .order('hora');
      if (e1) throw e1;
      const ids = (tickets ?? []).map((t) => t.id);
      if (ids.length === 0) return [];

      const { data: pagos, error: e2 } = await supabase
        .from('ventas_pagos')
        .select('ticket_id, medio_pago, medio_pago_id, monto, medios_pago(codigo, es_efectivo)')
        .in('ticket_id', ids);
      if (e2) throw e2;

      const porTicket = new Map<string, VentaTurno['pagos']>();
      for (const p of (pagos ?? []) as unknown as {
        ticket_id: string;
        medio_pago: string;
        medio_pago_id: string | null;
        monto: number;
        medios_pago: { codigo: string; es_efectivo: boolean } | null;
      }[]) {
        const lista = porTicket.get(p.ticket_id) ?? [];
        lista.push({
          medioId: p.medio_pago_id,
          codigo: p.medios_pago?.codigo ?? null,
          medio: p.medio_pago,
          esEfectivo: !!p.medios_pago?.es_efectivo,
          monto: Number(p.monto),
        });
        porTicket.set(p.ticket_id, lista);
      }

      return (tickets ?? []).map((t) => ({
        ticketId: t.id,
        total: Number(t.total_bruto),
        hora: t.hora,
        cliente: t.cliente ?? null,
        pagos: porTicket.get(t.id) ?? [],
      }));
    },
  });
}

export function useAbrirTurno() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      local: LocalCaja;
      fecha: string;
      turno: string;
      caja: string;
      fondoApertura: number;
      cajeroNombre: string;
      horaInicio: string;
    }) => {
      const { data, error } = await supabase
        .from('cierres_caja')
        .insert({
          local: input.local,
          fecha: input.fecha,
          turno: input.turno,
          caja: input.caja,
          // marca el arqueo como abierto por el POS: es lo que lo distingue de
          // los cierres que carga administración a mano (migración 146)
          origen: 'pos',
          fondo_apertura: input.fondoApertura,
          hora_inicio: input.horaInicio,
          cajero_nombre: input.cajeroNombre,
          creado_por: input.cajeroNombre,
          monto_contado: 0,
        })
        .select('id')
        .single();
      if (error) {
        // (local, fecha, turno, caja) es único: ese turno ya fue cerrado o cargado
        if (error.code === '23505') {
          throw new Error(
            'Ese turno ya existe para esta caja y esta fecha. Si ya lo cerraste, elegí otro turno; si lo cargó administración, usá otra caja.',
          );
        }
        throw error;
      }
      return data.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['caja-turno-abierto'] });
      qc.invalidateQueries({ queryKey: ['caja-turnos-abiertos'] });
    },
  });
}

/**
 * Cuánto tiene que haber en el cajón al cerrar.
 *
 * ⚠️ Es **la misma cuenta que hace Finanzas → Cierre de Caja**; si se cambia
 * una hay que cambiar la otra, o el cajero y administración van a ver dos
 * diferencias distintas para el mismo turno:
 *
 *   esperado   = fondo inicial + efectivo cobrado − retiros
 *   diferencia = contado − esperado
 *
 * Los retiros restan porque esa plata salió del cajón durante el turno (se fue
 * a buscar cambio, se pagó algo). Sin esto, cada retiro aparecería como un
 * faltante.
 */
export function efectivoEsperadoEnCaja(input: {
  fondoApertura: number;
  efectivoCobrado: number;
  retiros: number;
}): number {
  return input.fondoApertura + input.efectivoCobrado - input.retiros;
}

export interface RenglonArqueo {
  medioId: string;
  nombre: string;
  esEfectivo: boolean;
  esperado: number;
  declarado: number;
  diferencia: number;
}

/**
 * El arqueo desglosado de un turno ya cerrado: qué decía el sistema y qué
 * declaró el cajero, medio por medio. Es lo que mira administración para
 * controlar. Vive en `cierres_caja_medios` (migración 147).
 */
export function useArqueoMedios(cierreId: string | null) {
  return useQuery({
    queryKey: ['caja-arqueo-medios', cierreId],
    enabled: !!cierreId,
    queryFn: async (): Promise<RenglonArqueo[]> => {
      const { data, error } = await supabase
        .from('cierres_caja_medios')
        .select('medio_pago_id, esperado, declarado, diferencia, medios_pago(nombre, es_efectivo, orden)')
        .eq('cierre_caja_id', cierreId!);
      if (error) throw error;
      return ((data ?? []) as unknown as {
        medio_pago_id: string;
        esperado: number;
        declarado: number;
        diferencia: number;
        medios_pago: { nombre: string; es_efectivo: boolean; orden: number } | null;
      }[])
        .map((r) => ({
          medioId: r.medio_pago_id,
          nombre: r.medios_pago?.nombre ?? 'Sin nombre',
          esEfectivo: !!r.medios_pago?.es_efectivo,
          esperado: Number(r.esperado),
          declarado: Number(r.declarado),
          diferencia: Number(r.diferencia),
          orden: r.medios_pago?.orden ?? 99,
        }))
        .sort((a, b) => a.orden - b.orden)
        .map(({ orden: _orden, ...r }) => r);
    },
  });
}

/** Un medio de pago y lo que el sistema dice que se cobró con él en el turno. */
export interface MedioCobrado {
  medioId: string;
  codigo: string;
  nombre: string;
  esEfectivo: boolean;
  cobrado: number;
}

/** Lo mismo, más lo que el cajero declaró tener. */
export interface MedioArqueo extends MedioCobrado {
  /** lo que el cajero contó (efectivo) o leyó del cierre de lote (el resto) */
  declarado: number;
}

export function useCerrarTurno() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      turnoId: string;
      fondoApertura: number;
      /** plata que se sacó para ir a buscar cambio (vuelve a la caja) */
      retiroCambio: number;
      /** plata que salió de verdad: se pagó algo con el efectivo del cajón */
      retiroPagos: number;
      retiroNota: string | null;
      medios: MedioArqueo[];
      horaCierre: string;
      nota: string | null;
    }) => {
      const otrosRetiros = input.retiroCambio + input.retiroPagos;
      const efectivo = input.medios.find((m) => m.esEfectivo);
      const efectivoCobrado = efectivo?.cobrado ?? 0;
      const montoContado = efectivo?.declarado ?? 0;
      const montoEsperado = efectivoEsperadoEnCaja({
        fondoApertura: input.fondoApertura,
        efectivoCobrado,
        retiros: otrosRetiros,
      });
      const porCodigo = (c: string) => input.medios.find((m) => m.codigo === c)?.cobrado ?? 0;

      // El desglose se graba ANTES de cerrar: mientras el turno sigue abierto el
      // cajero puede borrar y recargar sus renglones, así un cierre que falla a
      // mitad de camino se puede reintentar sin chocar con la clave única. Una
      // vez cerrado ya no los toca (no tiene permiso de UPDATE).
      await supabase.from('cierres_caja_medios').delete().eq('cierre_caja_id', input.turnoId);

      if (input.medios.length > 0) {
        const { error: eMedios } = await supabase.from('cierres_caja_medios').insert(
          input.medios.map((m) => ({
            cierre_caja_id: input.turnoId,
            medio_pago_id: m.medioId,
            // En efectivo lo esperado NO es lo cobrado: es lo que tiene que
            // estar en el cajón (fondo + cobrado − retiros).
            esperado: m.esEfectivo ? montoEsperado : m.cobrado,
            declarado: m.declarado,
          })),
        );
        if (eMedios) throw eMedios;
      }

      const { error } = await supabase
        .from('cierres_caja')
        .update({
          monto_contado: montoContado,
          monto_esperado: montoEsperado,
          // ⚠️ `diferencia` NO se manda: es una columna calculada por la base
          // (`monto_contado − monto_esperado`). Mandarla revienta con
          // "column diferencia can only be updated to DEFAULT".
          hora_cierre: input.horaCierre,
          // Las columnas fudo_* son "lo que dice el sistema de ventas". Cuando el
          // turno lo cobró el POS propio, el sistema de ventas es el POS. Se
          // escriben acá para que Cierre de Caja (Finanzas) lo lea sin cambios.
          // Se mapean por CÓDIGO, no por el nombre que se muestra: si mañana
          // alguien renombra "Código QR", el nombre cambia pero el código no.
          fudo_efectivo: efectivoCobrado,
          fudo_qr: porCodigo('qr'),
          fudo_debito: porCodigo('debito'),
          fudo_credito: porCodigo('credito'),
          fudo_transferencia: porCodigo('transferencia'),
          fudo_mp_lucas: porCodigo('mp_lucas'),
          // Retiros: `otros_retiros` es el TOTAL y es el que entra en la cuenta
          // del arqueo; los otros dos dicen en qué se fue (migración 139).
          // `retiro` es columna vieja y va en 0: si se duplicara el dato, el
          // arqueo contaría los retiros dos veces.
          otros_retiros: otrosRetiros,
          retiro_cambio: input.retiroCambio,
          retiro_pagos: input.retiroPagos,
          otros_retiros_nota: input.retiroNota,
          retiro: 0,
          fondo_siguiente: 0,
          nota: input.nota,
        })
        .eq('id', input.turnoId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['caja-turno-abierto'] });
      qc.invalidateQueries({ queryKey: ['caja-turnos-abiertos'] });
      qc.invalidateQueries({ queryKey: ['caja-ventas-turno'] });
    },
  });
}

// ── Cobrar ───────────────────────────────────────────────────────────────────

export interface LineaVenta {
  item: ItemCatalogo;
  cantidad: number;
  /**
   * Si esta línea "cuelga" de otra (la salsa que va con esa pasta), acá va la
   * key de la pasta. Es lo que Fudo NO puede representar: allá la salsa llega
   * como una línea suelta al lado y nadie sabe con qué pasta iba.
   */
  padreKey?: string | null;
  /** porcentaje bonificado en esta línea (convenio o descuento a mano) */
  descuentoPct?: number;
}

/** Lo que sale y lo que se cobra de una línea, con el descuento ya aplicado. */
export function importesDeLinea(l: LineaVenta) {
  const bruto = l.item.precio * l.cantidad;
  const descuento = descuentoDeLinea(bruto, l.descuentoPct ?? 0);
  return { bruto, descuento, total: bruto - descuento };
}

export interface PagoVenta {
  medio: MedioPagoCaja;
  monto: number;
}

/**
 * Guarda una venta: el ticket, sus líneas y sus pagos.
 *
 * Cada línea queda apuntando al producto REAL del catálogo (receta_id o
 * cocina_producto_id), no a un nombre suelto — que es justamente lo que el
 * modelo canónico (migración 141) vino a resolver.
 */
export function useCobrarVenta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      local: LocalCaja;
      caja: string;
      turnoId: string;
      fecha: string;
      hora: string;
      cliente: string | null;
      /** convenio con el que se hizo el descuento, si vino de uno */
      convenioId: string | null;
      lineas: LineaVenta[];
      pagos: PagoVenta[];
    }) => {
      // `total` es lo que se COBRA: ya tiene el descuento restado. Es la columna
      // que leen todas las pantallas viejas, así que no puede ser el bruto.
      const importes = input.lineas.map(importesDeLinea);
      const total = importes.reduce((s, i) => s + i.total, 0);
      const descuentoTotal = importes.reduce((s, i) => s + i.descuento, 0);
      const periodo = input.fecha.slice(0, 7);
      const mediosUnicos = [...new Set(input.pagos.map((p) => p.medio.id))];
      const unicoMedio = mediosUnicos.length === 1 ? input.pagos[0].medio : null;

      const { data: ticket, error: eTicket } = await supabase
        .from('ventas_tickets')
        .insert({
          local: input.local,
          fudo_id: null,
          origen: 'pos',
          cierre_caja_id: input.turnoId,
          fecha: input.fecha,
          hora: input.hora,
          periodo,
          caja: input.caja,
          cliente: input.cliente,
          convenio_id: input.convenioId,
          descuento_total: descuentoTotal,
          estado: 'Cerrada',
          tipo_venta: 'mostrador',
          // Con varios medios se guarda "Mixto", igual que hace el import de Fudo
          medio_pago: unicoMedio ? unicoMedio.nombre : 'Mixto',
          medio_pago_id: unicoMedio ? unicoMedio.id : null,
          total_bruto: total,
          es_fiscal: false,
          es_dividendo: false,
        })
        .select('id')
        .single();
      if (eTicket) throw eTicket;
      const ticketId = ticket.id as string;

      const fila = (l: LineaVenta, nroLinea: number) => {
        const { descuento, total: totalLinea } = importesDeLinea(l);
        return {
          ticket_id: ticketId,
          local: input.local,
          periodo,
          fecha: input.fecha,
          linea: nroLinea,
          codigo: l.item.codigo,
          nombre: l.item.nombre,
          categoria: l.item.categoria,
          subcategoria: null,
          cantidad: l.cantidad,
          precio_unitario: l.item.precio,
          descuento_pct: l.descuentoPct ?? 0,
          descuento_monto: descuento,
          total: totalLinea,
          receta_id: l.item.tipo === 'receta' ? l.item.refId : null,
          cocina_producto_id: l.item.tipo === 'producto' ? l.item.refId : null,
          origen: 'pos',
        };
      };

      // Dos pasadas: primero las líneas sueltas y las "madres" (las pastas), y
      // recién después las que cuelgan, ya sabiendo el id de su madre.
      const conNumero = input.lineas.map((l, i) => ({ linea: l, nro: i + 1 }));
      const madres = conNumero.filter((x) => !x.linea.padreKey);
      const hijas = conNumero.filter((x) => x.linea.padreKey);

      const { data: madresGuardadas, error: eItems } = await supabase
        .from('ventas_items')
        .insert(madres.map((x) => fila(x.linea, x.nro)))
        .select('id, linea');
      if (eItems) {
        // el ticket no puede quedar sin líneas: se deshace y se avisa
        await supabase.from('ventas_tickets').delete().eq('id', ticketId);
        throw eItems;
      }

      if (hijas.length > 0) {
        // nro de línea → id, para resolver a qué pasta cuelga cada salsa
        const idPorNro = new Map<number, string>();
        for (const m of (madresGuardadas ?? []) as { id: string; linea: number }[]) {
          idPorNro.set(m.linea, m.id);
        }
        const nroPorKey = new Map<string, number>();
        for (const m of madres) nroPorKey.set(m.linea.item.key, m.nro);

        const { error: eHijas } = await supabase.from('ventas_items').insert(
          hijas.map((x) => {
            const nroMadre = nroPorKey.get(x.linea.padreKey!);
            return {
              ...fila(x.linea, x.nro),
              linea_padre_id: nroMadre ? (idPorNro.get(nroMadre) ?? null) : null,
              vinculo_origen: 'pos' as const,
            };
          }),
        );
        if (eHijas) {
          await supabase.from('ventas_tickets').delete().eq('id', ticketId);
          throw eHijas;
        }
      }

      const filasPagos = input.pagos.map((p) => ({
        ticket_id: ticketId,
        local: input.local,
        periodo,
        fudo_ticket_id: `pos-${ticketId}`,
        fecha: input.fecha,
        medio_pago: p.medio.nombre,
        medio_pago_id: p.medio.id,
        monto: p.monto,
        tipo_venta: 'mostrador',
        caja: input.caja,
        es_dividendo: p.medio.codigo === 'mp_lucas',
        // sin esto el importador de Fudo los borraría todas las mañanas junto
        // con los suyos (migración 150)
        origen: 'pos',
      }));

      const { error: ePagos } = await supabase.from('ventas_pagos').insert(filasPagos);
      if (ePagos) {
        // borrar el ticket arrastra líneas y pagos por ON DELETE CASCADE
        await supabase.from('ventas_tickets').delete().eq('id', ticketId);
        throw ePagos;
      }

      return { ticketId, total };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['caja-ventas-turno'] });
      // el panel del ERP muestra cuánto lleva cobrado el turno
      qc.invalidateQueries({ queryKey: ['caja-turnos-abiertos'] });
    },
  });
}
