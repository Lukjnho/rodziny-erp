/**
 * WSFEv1: pedirle a ARCA que autorice un comprobante y devuelva el CAE.
 *
 * ⚠️ EL ORDEN DE LOS CAMPOS IMPORTA. Es un XSD con `sequence`: si un campo va
 * fuera de lugar, ARCA rechaza todo el mensaje. El orden de acá está sacado del
 * WSDL en vivo, no de un manual, y tiene dos cosas contraintuitivas:
 *   · ImpTrib va ANTES que ImpIVA;
 *   · CondicionIVAReceptorId va ANTES del detalle de IVA.
 */

import type { Ambiente, TicketAcceso } from './wsaa.ts';

const URL_WSFE: Record<Ambiente, string> = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};

const NS = 'http://ar.gov.afip.dif.FEV1/';

export interface Autenticacion {
  ticket: TicketAcceso;
  cuit: string;
  ambiente: Ambiente;
}

export interface AlicuotaIva {
  Id: number;
  BaseImp: number;
  Importe: number;
}

export interface PedidoCAE {
  puntoVenta: number;
  tipoComprobante: number;
  concepto: number;
  docTipo: number;
  docNro: string;
  numero: number;
  /** aaaammdd */
  fecha: string;
  impTotal: number;
  impTotConc: number;
  impNeto: number;
  impOpEx: number;
  impTrib: number;
  impIVA: number;
  condicionIvaReceptor: number;
  iva: AlicuotaIva[];
}

export interface RespuestaCAE {
  resultado: 'A' | 'R' | 'P' | null;
  cae: string | null;
  caeVencimiento: string | null;
  numero: number | null;
  observaciones: { codigo: string; mensaje: string }[];
  errores: { codigo: string; mensaje: string }[];
  crudo: string;
}

function etiqueta(xml: string, nombre: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nombre}>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`));
  return m ? m[1].trim() : null;
}

/** Todos los bloques con ese nombre (para Obs y Err, que vienen repetidos). */
function bloques(xml: string, nombre: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${nombre}>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

function mensajes(xml: string, contenedor: string, item: string) {
  const zona = etiqueta(xml, contenedor);
  if (!zona) return [];
  return bloques(zona, item).map((b) => ({
    codigo: etiqueta(b, 'Code') ?? '',
    mensaje: etiqueta(b, 'Msg') ?? '',
  }));
}

async function llamar(auth: Autenticacion, metodo: string, cuerpo: string): Promise<string> {
  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">
  <soap:Body>
    <ar:${metodo}>
      <ar:Auth>
        <ar:Token>${auth.ticket.token}</ar:Token>
        <ar:Sign>${auth.ticket.sign}</ar:Sign>
        <ar:Cuit>${auth.cuit}</ar:Cuit>
      </ar:Auth>
      ${cuerpo}
    </ar:${metodo}>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(URL_WSFE[auth.ambiente], {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `${NS}${metodo}`,
    },
    body: sobre,
  });
  const texto = await res.text();
  if (!res.ok) {
    const falla = etiqueta(texto, 'faultstring');
    throw new Error(`ARCA rechazó ${metodo}: ${falla ?? `HTTP ${res.status}`}`);
  }
  return texto;
}

/**
 * El último número usado en ese punto de venta y tipo. El siguiente comprobante
 * va con ese número más uno: la numeración la lleva el emisor, no ARCA.
 */
export async function ultimoAutorizado(
  auth: Autenticacion,
  puntoVenta: number,
  tipoComprobante: number,
): Promise<number> {
  const xml = await llamar(
    auth,
    'FECompUltimoAutorizado',
    `<ar:PtoVta>${puntoVenta}</ar:PtoVta><ar:CbteTipo>${tipoComprobante}</ar:CbteTipo>`,
  );
  const errores = mensajes(xml, 'Errors', 'Err');
  if (errores.length > 0) {
    throw new Error(`No se pudo leer el último número: ${errores.map((e) => `${e.codigo} ${e.mensaje}`).join(' · ')}`);
  }
  const n = etiqueta(xml, 'CbteNro');
  if (n === null) throw new Error('ARCA no devolvió el último número autorizado.');
  return Number(n);
}

/**
 * Consulta un comprobante puntual.
 *
 * Sirve para el peor caso: se pidió el CAE, ARCA lo autorizó, y la respuesta se
 * perdió en el camino. Antes de reintentar hay que preguntar si ese número ya
 * existe — si no, se emitirían dos comprobantes por la misma venta.
 */
export async function consultarComprobante(
  auth: Autenticacion,
  puntoVenta: number,
  tipoComprobante: number,
  numero: number,
): Promise<{ existe: boolean; cae: string | null; caeVencimiento: string | null }> {
  const xml = await llamar(
    auth,
    'FECompConsultar',
    `<ar:FeCompConsReq>
        <ar:CbteTipo>${tipoComprobante}</ar:CbteTipo>
        <ar:CbteNro>${numero}</ar:CbteNro>
        <ar:PtoVta>${puntoVenta}</ar:PtoVta>
      </ar:FeCompConsReq>`,
  );
  const cae = etiqueta(xml, 'CodAutorizacion');
  return {
    existe: !!cae,
    cae,
    caeVencimiento: etiqueta(xml, 'FchVto'),
  };
}

/** Redondeo a dos decimales: ARCA rechaza el comprobante si la suma no cierra exacto. */
const dos = (n: number) => Number(n.toFixed(2));

export async function solicitarCAE(auth: Autenticacion, p: PedidoCAE): Promise<RespuestaCAE> {
  const alicuotas = p.iva
    .map(
      (a) =>
        `<ar:AlicIva><ar:Id>${a.Id}</ar:Id><ar:BaseImp>${dos(a.BaseImp)}</ar:BaseImp><ar:Importe>${dos(a.Importe)}</ar:Importe></ar:AlicIva>`,
    )
    .join('');

  // El orden de este bloque sale del WSDL. No reordenar por prolijidad.
  const detalle = `<ar:FECAEDetRequest>
          <ar:Concepto>${p.concepto}</ar:Concepto>
          <ar:DocTipo>${p.docTipo}</ar:DocTipo>
          <ar:DocNro>${p.docNro}</ar:DocNro>
          <ar:CbteDesde>${p.numero}</ar:CbteDesde>
          <ar:CbteHasta>${p.numero}</ar:CbteHasta>
          <ar:CbteFch>${p.fecha}</ar:CbteFch>
          <ar:ImpTotal>${dos(p.impTotal)}</ar:ImpTotal>
          <ar:ImpTotConc>${dos(p.impTotConc)}</ar:ImpTotConc>
          <ar:ImpNeto>${dos(p.impNeto)}</ar:ImpNeto>
          <ar:ImpOpEx>${dos(p.impOpEx)}</ar:ImpOpEx>
          <ar:ImpTrib>${dos(p.impTrib)}</ar:ImpTrib>
          <ar:ImpIVA>${dos(p.impIVA)}</ar:ImpIVA>
          <ar:MonId>PES</ar:MonId>
          <ar:MonCotiz>1</ar:MonCotiz>
          <ar:CondicionIVAReceptorId>${p.condicionIvaReceptor}</ar:CondicionIVAReceptorId>
          ${p.iva.length > 0 ? `<ar:Iva>${alicuotas}</ar:Iva>` : ''}
        </ar:FECAEDetRequest>`;

  const cuerpo = `<ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${p.puntoVenta}</ar:PtoVta>
          <ar:CbteTipo>${p.tipoComprobante}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>${detalle}</ar:FeDetReq>
      </ar:FeCAEReq>`;

  const xml = await llamar(auth, 'FECAESolicitar', cuerpo);

  const resultado = (etiqueta(xml, 'Resultado') as RespuestaCAE['resultado']) ?? null;
  const cae = etiqueta(xml, 'CAE');
  return {
    resultado,
    cae: cae && cae !== '' ? cae : null,
    caeVencimiento: etiqueta(xml, 'CAEFchVto'),
    numero: Number(etiqueta(xml, 'CbteDesde') ?? p.numero),
    observaciones: mensajes(xml, 'Observaciones', 'Obs'),
    errores: mensajes(xml, 'Errors', 'Err'),
    crudo: xml,
  };
}

/** "2026-09-02" → "20260902", que es como lo quiere ARCA. */
export function fechaArca(iso: string): string {
  return iso.replaceAll('-', '');
}

/** "20260912" → "2026-09-12" */
export function fechaDesdeArca(s: string): string {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
