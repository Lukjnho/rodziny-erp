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
        .gte('fecha', desde)
        .is('hora_cierre', null)
        .order('fecha', { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] as TurnoCaja | undefined) ?? null;
    },
  });
}

export interface VentaTurno {
  ticketId: string;
  total: number;
  hora: string | null;
  cliente: string | null;
  pagos: { medio: string; esEfectivo: boolean; monto: number }[];
}

export interface LineaTicketGuardada {
  id: string;
  linea: number | null;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
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
        .select('id, linea, nombre, cantidad, precio_unitario, total, linea_padre_id')
        .eq('ticket_id', ticketId!)
        .order('linea');
      if (error) throw error;
      return (data ?? []).map((l) => ({
        id: l.id,
        linea: l.linea,
        nombre: l.nombre,
        cantidad: Number(l.cantidad),
        precioUnitario: Number(l.precio_unitario ?? 0),
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
        .select('ticket_id, medio_pago, monto, medios_pago(es_efectivo)')
        .in('ticket_id', ids);
      if (e2) throw e2;

      const porTicket = new Map<string, VentaTurno['pagos']>();
      for (const p of (pagos ?? []) as unknown as {
        ticket_id: string;
        medio_pago: string;
        monto: number;
        medios_pago: { es_efectivo: boolean } | null;
      }[]) {
        const lista = porTicket.get(p.ticket_id) ?? [];
        lista.push({
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
    },
  });
}

export function useCerrarTurno() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      turnoId: string;
      montoContado: number;
      montoEsperado: number;
      efectivoDelTurno: number;
      qr: number;
      debito: number;
      credito: number;
      transferencia: number;
      mpLucas: number;
      horaCierre: string;
      nota: string | null;
    }) => {
      const { error } = await supabase
        .from('cierres_caja')
        .update({
          monto_contado: input.montoContado,
          monto_esperado: input.montoEsperado,
          diferencia: input.montoContado - input.montoEsperado,
          hora_cierre: input.horaCierre,
          // Las columnas fudo_* son "lo que dice el sistema de ventas". Cuando el
          // turno lo cobró el POS propio, el sistema de ventas es el POS. Se
          // escriben acá para que Cierre de Caja (Finanzas) lo lea sin cambios.
          fudo_efectivo: input.efectivoDelTurno,
          fudo_qr: input.qr,
          fudo_debito: input.debito,
          fudo_credito: input.credito,
          fudo_transferencia: input.transferencia,
          fudo_mp_lucas: input.mpLucas,
          nota: input.nota,
        })
        .eq('id', input.turnoId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['caja-turno-abierto'] });
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
      lineas: LineaVenta[];
      pagos: PagoVenta[];
    }) => {
      const total = input.lineas.reduce((s, l) => s + l.item.precio * l.cantidad, 0);
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

      const fila = (l: LineaVenta, nroLinea: number) => ({
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
        total: l.item.precio * l.cantidad,
        receta_id: l.item.tipo === 'receta' ? l.item.refId : null,
        cocina_producto_id: l.item.tipo === 'producto' ? l.item.refId : null,
        origen: 'pos',
      });

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
    },
  });
}
