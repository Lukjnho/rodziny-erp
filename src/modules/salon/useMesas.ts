import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mensajeErrorAmigable } from '@/lib/erroresSupabase';
import { descuentoDeLinea } from '@/modules/caja/useCaja';
import type { LocalSalon, Mesa, Sala } from './useSalon';

/**
 * La operación del salón: abrir mesas, cargarles platos, mandarlos a la cocina
 * y cobrarlas.
 *
 * 🔑 Acá NO hay ningún insert ni update suelto: **todo pasa por las funciones de
 * la base** (migraciones 190 y 193). Las reglas de fila sólo dejan escribir con
 * una marca que ponen esas funciones, así que si mañana alguien agrega un
 * `.insert()` derecho desde acá, la base lo va a rechazar. Es a propósito.
 *
 * 💣 El precio NO viaja desde el teléfono. Se manda el plato y la cantidad, y el
 * precio lo pone la base leyendo la carta del local. Es lo que evita que se
 * cobre un plato a $1 con la consola del navegador abierta.
 */

export type EstadoSesion = 'abierta' | 'cuenta_pedida' | 'cobrada' | 'anulada';

export interface SesionMesa {
  id: string;
  mesa_id: string;
  comensales: number;
  estado: EstadoSesion;
  abierta_en: string;
  cuenta_pedida_en: string | null;
}

export interface LineaMesa {
  id: string;
  sesion_id: string;
  envio_id: string | null;
  padre_id: string | null;
  linea: number;
  receta_id: string;
  nombre: string;
  categoria: string | null;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  estado: 'activa' | 'sacada';
  ticket_id: string | null;
}

/** Lo que se le cobra a una línea, con su descuento ya restado. */
export function importeDeLinea(l: LineaMesa): number {
  const bruto = Number(l.cantidad) * Number(l.precio_unitario);
  return bruto - descuentoDeLinea(bruto, Number(l.descuento_pct));
}

const CLAVE_SESIONES = 'salon-sesiones';
const CLAVE_LINEAS = 'salon-lineas';

/** Las mesas ocupadas del local, con lo que llevan consumido. */
export function useSesionesAbiertas(local: LocalSalon | null) {
  return useQuery({
    queryKey: [CLAVE_SESIONES, local],
    enabled: !!local,
    // El salón se mira entre varios (el mozo en el teléfono, el cajero en el
    // mostrador). Realtime no está prendido en este proyecto, así que se
    // pregunta cada 5 segundos: en el peor caso la pantalla está 5 segundos
    // vieja, y nunca muda.
    refetchInterval: 5000,
    queryFn: async (): Promise<{ sesiones: SesionMesa[]; lineas: LineaMesa[] }> => {
      const { data: sesiones, error: eSes } = await supabase
        .from('caja_mesa_sesiones')
        .select('id, mesa_id, comensales, estado, abierta_en, cuenta_pedida_en')
        .eq('local', local!)
        .in('estado', ['abierta', 'cuenta_pedida'])
        .order('abierta_en');
      if (eSes) throw new Error(mensajeErrorAmigable(eSes, 'No se pudieron traer las mesas'));

      const ids = (sesiones ?? []).map((s) => s.id);
      if (ids.length === 0) return { sesiones: [], lineas: [] };

      const { data: lineas, error: eLin } = await supabase
        .from('caja_mesa_lineas')
        .select(
          'id, sesion_id, envio_id, padre_id, linea, receta_id, nombre, categoria, cantidad, precio_unitario, descuento_pct, estado, ticket_id',
        )
        .in('sesion_id', ids)
        .order('linea');
      if (eLin) throw new Error(mensajeErrorAmigable(eLin, 'No se pudieron traer los pedidos'));

      return { sesiones: (sesiones ?? []) as SesionMesa[], lineas: (lineas ?? []) as LineaMesa[] };
    },
  });
}

/** Espacios + mesas del local, para dibujar el plano. Cambian poco. */
export function usePlano(local: LocalSalon | null) {
  return useQuery({
    queryKey: ['salon-plano', local],
    enabled: !!local,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<{ salas: Sala[]; mesas: Mesa[] }> => {
      const [salasRes, mesasRes] = await Promise.all([
        supabase
          .from('caja_salas')
          .select('id, local, nombre, orden, activo')
          .eq('local', local!)
          .eq('activo', true)
          .order('orden'),
        supabase
          .from('caja_mesas')
          .select('id, local, sala_id, numero, capacidad, forma, pos_x, pos_y, ancho, alto, activo')
          .eq('local', local!)
          .eq('activo', true),
      ]);
      const err = salasRes.error || mesasRes.error;
      if (err) throw new Error(mensajeErrorAmigable(err, 'No se pudo traer el plano'));
      return { salas: (salasRes.data ?? []) as Sala[], mesas: (mesasRes.data ?? []) as Mesa[] };
    },
  });
}

/**
 * Todas las funciones del salón contestan igual: se refresca el tablero.
 *
 * El tipo de lo que devuelve la función viaja hasta el que la llama (`R`): sin
 * eso, cobrar la mesa devolvía `unknown` y la pantalla no podía mostrar ni el
 * número de la venta.
 */
function useAccion<T, R>(fn: (input: T) => Promise<R>, local: LocalSalon | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CLAVE_SESIONES, local] });
      qc.invalidateQueries({ queryKey: [CLAVE_LINEAS] });
    },
  });
}

async function rpc(nombre: string, args: Record<string, unknown>, queHacia: string) {
  const { data, error } = await supabase.rpc(nombre, args);
  if (error) throw new Error(mensajeErrorAmigable(error, queHacia));
  return data;
}

export function useAbrirMesa(local: LocalSalon | null) {
  return useAccion(
    (input: { mesaId: string; comensales: number }) =>
      rpc(
        'salon_abrir_mesa',
        { p_mesa_id: input.mesaId, p_comensales: input.comensales },
        'No se pudo abrir la mesa',
      ),
    local,
  );
}

export function useAgregarPlato(local: LocalSalon | null) {
  return useAccion(
    (input: { sesionId: string; recetaId: string; cantidad: number; padreId?: string | null }) =>
      rpc(
        'salon_agregar_linea',
        {
          p_sesion_id: input.sesionId,
          p_receta_id: input.recetaId,
          p_cantidad: input.cantidad,
          p_padre_id: input.padreId ?? null,
          // El descuento por renglón lo maneja la caja, no el mozo.
          p_descuento_pct: 0,
        },
        'No se pudo agregar el plato',
      ),
    local,
  );
}

export function useSacarPlato(local: LocalSalon | null) {
  return useAccion(
    (input: { lineaId: string; motivo: string }) =>
      rpc(
        'salon_sacar_linea',
        { p_linea_id: input.lineaId, p_motivo: input.motivo },
        'No se pudo sacar el plato',
      ),
    local,
  );
}

export function useMandarACocina(local: LocalSalon | null) {
  return useAccion(
    (sesionId: string) =>
      rpc('salon_enviar_a_cocina', { p_sesion_id: sesionId }, 'No se pudo mandar a la cocina'),
    local,
  );
}

export function usePedirLaCuenta(local: LocalSalon | null) {
  return useAccion(
    (sesionId: string) =>
      rpc('salon_pedir_la_cuenta', { p_sesion_id: sesionId }, 'No se pudo avisar que piden la cuenta'),
    local,
  );
}

export function useAnularMesa(local: LocalSalon | null) {
  return useAccion(
    (input: { sesionId: string; motivo: string }) =>
      rpc(
        'salon_anular_sesion',
        { p_sesion_id: input.sesionId, p_motivo: input.motivo },
        'No se pudo anular la mesa',
      ),
    local,
  );
}

export interface ResultadoCobroMesa {
  ticket_id: string;
  numero: string;
  total: number;
  mesa_cerrada: boolean;
  ya_estaba: boolean;
}

/**
 * Cobrar la mesa. La llama el MOSTRADOR, nunca el teléfono del mozo.
 *
 * ⚠️ La llave del intento (`idempotencia`) la manda la pantalla y NO se cambia
 * si el cobro falla: mientras siga viva, la base reconoce el reintento y
 * devuelve la misma venta en vez de cobrar dos veces.
 */
export function useCobrarMesa(local: LocalSalon | null) {
  return useAccion(
    async (input: {
      idempotencia: string;
      sesionId: string;
      turnoId: string;
      caja: string;
      fecha: string;
      hora: string;
      pagos: { medio_pago_id: string; monto: number }[];
      cliente?: string | null;
    }): Promise<ResultadoCobroMesa> => {
      const data = await rpc(
        'salon_cobrar_mesa',
        {
          p_idempotencia: input.idempotencia,
          p_sesion_id: input.sesionId,
          p_turno_id: input.turnoId,
          p_caja: input.caja,
          p_fecha: input.fecha,
          p_hora: input.hora,
          p_pagos: input.pagos,
          p_cliente: input.cliente ?? null,
        },
        'No se pudo cobrar la mesa',
      );
      if (!data) {
        throw new Error(
          'La base no confirmó el cobro de la mesa. Fijate en "Ventas del turno" antes de volver ' +
            'a cobrar, no sea cosa que se cobre dos veces.',
        );
      }
      const r = data as { ticket_id: string; numero: string; total: number | string; mesa_cerrada: boolean; ya_estaba: boolean };
      return {
        ticket_id: r.ticket_id,
        numero: r.numero,
        total: Number(r.total),
        mesa_cerrada: !!r.mesa_cerrada,
        ya_estaba: !!r.ya_estaba,
      };
    },
    local,
  );
}
