/**
 * Emite los comprobantes que están esperando en la cola.
 *
 * La caja cobra e imprime siempre; la factura sale por atrás. Esta función es
 * "por atrás": toma lo que está en `pendiente`, le pide el CAE a ARCA y lo
 * guarda. Se la puede llamar al cobrar (para que salga en el momento) o cada
 * tanto para barrer lo que quedó colgado sin internet.
 *
 * LO QUE NO PUEDE PASAR, Y CÓMO SE EVITA
 *
 * Emitir dos comprobantes por la misma venta. Hay tres cercos:
 *   1. la base tiene un índice único: una venta, una factura;
 *   2. antes de hablar con ARCA el comprobante se marca `emitiendo`, con un
 *      UPDATE condicional: si otra ejecución lo tomó primero, esta lo saltea;
 *   3. el número que se va a usar se guarda ANTES de pedirlo. Si la respuesta
 *      se pierde (timeout), el próximo intento primero le PREGUNTA a ARCA si
 *      ese número ya existe. Sin eso, un corte de red en el peor momento
 *      generaría dos facturas reales, y eso no se deshace.
 *
 * El certificado y la clave viven en variables de entorno de Supabase
 * (ARCA_CERT y ARCA_KEY), nunca en la base ni en el navegador.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { obtenerTicket, type Ambiente } from './wsaa.ts';
import {
  consultarComprobante,
  fechaArca,
  fechaDesdeArca,
  solicitarCAE,
  ultimoAutorizado,
  type Autenticacion,
} from './wsfev1.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Comprobante {
  id: string;
  ticket_id: string;
  local: string;
  tipo_comprobante: number;
  punto_venta: number;
  concepto: number;
  receptor_doc_tipo: number;
  receptor_doc_nro: string;
  receptor_condicion_iva: number;
  imp_neto: number;
  imp_iva: number;
  imp_tot_conc: number;
  imp_op_ex: number;
  imp_trib: number;
  imp_total: number;
  iva_detalle: { Id: number; BaseImp: number; Importe: number }[];
  fecha_comprobante: string;
  numero: number | null;
  estado: string;
  intentos: number;
  ambiente: Ambiente;
}

function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // service_role: saltea RLS, que es justamente lo que hace falta — el CAE
    // no lo puede escribir nadie desde el navegador.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const certPem = Deno.env.get('ARCA_CERT');
  const keyPem = Deno.env.get('ARCA_KEY');
  if (!certPem || !keyPem) {
    return respuesta(
      {
        error: 'Falta el certificado de ARCA.',
        detalle:
          'Cargar ARCA_CERT y ARCA_KEY en las variables de entorno de Supabase, con el contenido de los archivos .crt y .key.',
      },
      503,
    );
  }

  let comprobanteId: string | null = null;
  let limite = 10;
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      comprobanteId = body?.comprobante_id ?? null;
      if (typeof body?.limite === 'number') limite = Math.min(50, Math.max(1, body.limite));
    } catch {
      // Sin cuerpo: barre la cola con los valores por defecto.
    }
  }

  // Se atienden también los que quedaron en 'error': puede haber sido un corte
  // de internet, y el reintento es justamente para eso.
  let busca = db
    .from('ventas_comprobantes')
    .select('*')
    .in('estado', ['pendiente', 'error'])
    .order('creado_at', { ascending: true })
    .limit(limite);
  if (comprobanteId) busca = db.from('ventas_comprobantes').select('*').eq('id', comprobanteId);

  const { data: cola, error: errCola } = await busca;
  if (errCola) return respuesta({ error: errCola.message }, 500);
  if (!cola || cola.length === 0) return respuesta({ ok: true, emitidos: 0, mensaje: 'No hay nada para facturar.' });

  const resultados: unknown[] = [];

  for (const fila of cola as Comprobante[]) {
    try {
      resultados.push(await emitir(db, fila, certPem, keyPem));
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      await db
        .from('ventas_comprobantes')
        .update({ estado: 'error', ultimo_error: motivo.slice(0, 2000) })
        .eq('id', fila.id);
      resultados.push({ id: fila.id, ok: false, error: motivo });
    }
  }

  return respuesta({
    ok: true,
    procesados: resultados.length,
    emitidos: resultados.filter((r) => (r as { ok?: boolean }).ok).length,
    resultados,
  });
});

async function emitir(
  // deno-lint-ignore no-explicit-any
  db: any,
  fila: Comprobante,
  certPem: string,
  keyPem: string,
) {
  // ── 1. El candado ───────────────────────────────────────────────────────────
  // Condicional a propósito: si otra ejecución ya lo tomó, este UPDATE afecta
  // cero filas y salimos sin tocar nada.
  const { data: tomado } = await db
    .from('ventas_comprobantes')
    .update({ estado: 'emitiendo', intentos: fila.intentos + 1, ultimo_error: null })
    .eq('id', fila.id)
    .in('estado', ['pendiente', 'error'])
    .select('id');

  if (!tomado || tomado.length === 0) {
    return { id: fila.id, ok: false, salteado: 'Ya lo está emitiendo otro proceso.' };
  }

  // ── 2. La configuración del local ───────────────────────────────────────────
  const { data: cfg } = await db
    .from('arca_config')
    .select('cuit_emisor, punto_venta, ambiente, activo')
    .eq('local', fila.local)
    .maybeSingle();

  if (!cfg) throw new Error(`No hay configuración de facturación para ${fila.local}.`);
  if (!cfg.activo) {
    throw new Error(
      `La facturación de ${fila.local} está desactivada. Se activa en Ventas → Facturación, después de cargar el punto de venta real.`,
    );
  }

  const auth: Autenticacion = {
    ticket: await obtenerTicket(db, {
      cuit: cfg.cuit_emisor,
      servicio: 'wsfe',
      ambiente: cfg.ambiente,
      certPem,
      keyPem,
    }),
    cuit: cfg.cuit_emisor,
    ambiente: cfg.ambiente,
  };

  // ── 3. ¿Y si el intento anterior salió y no nos enteramos? ──────────────────
  // Esto es lo que evita la doble facturación después de un timeout.
  if (fila.numero) {
    const previo = await consultarComprobante(auth, cfg.punto_venta, fila.tipo_comprobante, fila.numero);
    if (previo.existe && previo.cae) {
      const { data } = await db
        .from('ventas_comprobantes')
        .update({
          estado: 'emitido',
          cae: previo.cae,
          cae_vencimiento: previo.caeVencimiento ? fechaDesdeArca(previo.caeVencimiento) : null,
          emitido_at: new Date().toISOString(),
          ultimo_error: null,
        })
        .eq('id', fila.id)
        .select('id');
      return {
        id: fila.id,
        ok: true,
        recuperado: true,
        cae: previo.cae,
        nota: 'Ya estaba emitido en ARCA: la respuesta del intento anterior se había perdido.',
        guardado: !!data?.length,
      };
    }
  }

  // ── 4. Qué número le toca ───────────────────────────────────────────────────
  const ultimo = await ultimoAutorizado(auth, cfg.punto_venta, fila.tipo_comprobante);
  const numero = ultimo + 1;

  // Se guarda ANTES de pedirlo. Si la respuesta se pierde, el próximo intento
  // sabe qué número preguntarle a ARCA.
  //
  // Si dos ejecuciones corren a la vez y les tocó el mismo número, el índice
  // único de la base hace fallar a la segunda. Es deseable: mejor un reintento
  // que dos comprobantes con el mismo número.
  const { error: errNumero } = await db
    .from('ventas_comprobantes')
    .update({ numero, punto_venta: cfg.punto_venta, ambiente: cfg.ambiente })
    .eq('id', fila.id);

  if (errNumero) {
    throw new Error(
      `No se pudo reservar el número ${numero}: ${errNumero.message}. ` +
        'Puede que otra ejecución lo haya tomado al mismo tiempo; se reintenta solo.',
    );
  }

  // ── 5. El pedido ────────────────────────────────────────────────────────────
  const pedido = {
    puntoVenta: cfg.punto_venta,
    tipoComprobante: fila.tipo_comprobante,
    concepto: fila.concepto,
    docTipo: fila.receptor_doc_tipo,
    docNro: fila.receptor_doc_nro,
    numero,
    fecha: fechaArca(fila.fecha_comprobante),
    impTotal: Number(fila.imp_total),
    impTotConc: Number(fila.imp_tot_conc),
    impNeto: Number(fila.imp_neto),
    impOpEx: Number(fila.imp_op_ex),
    impTrib: Number(fila.imp_trib),
    impIVA: Number(fila.imp_iva),
    condicionIvaReceptor: fila.receptor_condicion_iva,
    iva: (fila.iva_detalle ?? []).map((a) => ({
      Id: Number(a.Id),
      BaseImp: Number(a.BaseImp),
      Importe: Number(a.Importe),
    })),
  };

  const res = await solicitarCAE(auth, pedido);

  // ── 6. Lo que contestó ──────────────────────────────────────────────────────
  const observaciones = [...res.observaciones, ...res.errores];

  if (res.resultado === 'A' && res.cae) {
    const { data: guardado, error: errGuardar } = await db
      .from('ventas_comprobantes')
      .update({
        estado: 'emitido',
        cae: res.cae,
        cae_vencimiento: res.caeVencimiento ? fechaDesdeArca(res.caeVencimiento) : null,
        numero: res.numero ?? numero,
        emitido_at: new Date().toISOString(),
        observaciones: observaciones.length ? observaciones : null,
        arca_request: pedido,
        arca_response: { resultado: res.resultado, cae: res.cae, vto: res.caeVencimiento },
        ultimo_error: null,
      })
      .eq('id', fila.id)
      .select('id');

    // El momento más delicado de todo el circuito: ARCA ya autorizó, el
    // comprobante EXISTE, y si esta escritura falla el CAE se pierde. No se
    // puede tragar el error en silencio.
    //
    // Se deja constancia con el CAE adentro del mensaje y se corta. El
    // comprobante queda en 'error' con su número guardado, así que el próximo
    // intento lo recupera solo por el paso 3 (le pregunta a ARCA y lo
    // encuentra emitido). No se emite nada dos veces.
    if (errGuardar || !guardado || guardado.length === 0) {
      throw new Error(
        `ARCA AUTORIZO el comprobante ${cfg.punto_venta}-${res.numero ?? numero} con CAE ${res.cae} ` +
          `(vence ${res.caeVencimiento}) pero NO se pudo guardar: ${errGuardar?.message ?? 'la base no aceptó la escritura'}. ` +
          'El comprobante existe en ARCA. Se recupera solo en el próximo intento.',
      );
    }

    return {
      id: fila.id,
      ok: true,
      cae: res.cae,
      numero: res.numero ?? numero,
      vence: res.caeVencimiento,
      // Las observaciones no impiden la autorización, pero conviene mirarlas.
      observaciones: res.observaciones,
    };
  }

  // Rechazado: el motivo está en Errors u Observaciones, no en el código HTTP.
  const motivo =
    observaciones.map((o) => `${o.codigo}: ${o.mensaje}`).join(' · ') ||
    `ARCA respondió "${res.resultado ?? 'sin resultado'}" sin explicar por qué.`;

  await db
    .from('ventas_comprobantes')
    .update({
      estado: 'error',
      ultimo_error: motivo.slice(0, 2000),
      observaciones: observaciones.length ? observaciones : null,
      arca_request: pedido,
      arca_response: { resultado: res.resultado, crudo: res.crudo.slice(0, 4000) },
    })
    .eq('id', fila.id);

  return { id: fila.id, ok: false, resultado: res.resultado, error: motivo };
}
