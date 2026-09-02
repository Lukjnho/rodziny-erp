/**
 * WSAA: el permiso para hablar con ARCA.
 *
 * Antes de facturar hay que pedir un "ticket de acceso" (un token y una firma)
 * que dura 12 horas. Para pedirlo se manda un XML firmado digitalmente con el
 * certificado de la empresa, en formato CMS/PKCS#7 — que tradicionalmente se
 * arma con OpenSSL, que acá no existe. Lo hace node-forge en JavaScript puro
 * (probado: openssl valida la firma que sale de esto).
 *
 * ⚠️ EL CACHÉ ES OBLIGATORIO, no es una optimización. Si se pide un ticket
 * nuevo mientras el anterior sigue vigente, ARCA contesta "El CEE ya posee un
 * TA valido para el acceso al WSN solicitado" y rechaza el pedido. Sin caché
 * fallaría la segunda factura del día.
 */

import forge from 'npm:node-forge@1.3.1';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type Ambiente = 'homologacion' | 'produccion';

// ⚠️ Los endpoints de ARCA siguen en .gov.ar (no .gob.ar). El manual del WSAA
// documenta hostnames de arca.gov.ar que NO resuelven en DNS: copiarlos de ahí
// rompe la integración.
const URL_WSAA: Record<Ambiente, string> = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};

/** Se renueva un rato antes de que venza, para no cortarse en el medio de una venta. */
const MARGEN_MS = 10 * 60 * 1000;

export interface TicketAcceso {
  token: string;
  sign: string;
  expira: Date;
}

/** ARCA quiere las fechas con el huso horario explícito. */
function isoConHuso(d: Date): string {
  const ms = d.getTime() - 3 * 60 * 60 * 1000; // Argentina, UTC-3
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '-03:00');
}

function armarTRA(servicio: string): string {
  const ahora = new Date();
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>
    <generationTime>${isoConHuso(new Date(ahora.getTime() - 10 * 60 * 1000))}</generationTime>
    <expirationTime>${isoConHuso(new Date(ahora.getTime() + 10 * 60 * 1000))}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;
}

/** El TRA firmado, en Base64, que es lo que ARCA espera recibir. */
export function firmarCMS(tra: string, certPem: string, keyPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const clave = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: clave,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  p7.sign();

  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

function entre(xml: string, etiqueta: string): string | null {
  // Las respuestas de ARCA a veces traen prefijo de namespace y a veces no.
  const m = xml.match(new RegExp(`<(?:\\w+:)?${etiqueta}>([\\s\\S]*?)</(?:\\w+:)?${etiqueta}>`));
  return m ? m[1] : null;
}

function desescapar(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Le pide a ARCA un ticket nuevo. Solo se llama si el caché no sirve. */
async function pedirTicket(
  ambiente: Ambiente,
  servicio: string,
  certPem: string,
  keyPem: string,
): Promise<TicketAcceso> {
  const cms = firmarCMS(armarTRA(servicio), certPem, keyPem);

  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desarrollo.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(URL_WSAA[ambiente], {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: sobre,
  });
  const cuerpo = await res.text();

  if (!res.ok) {
    // El motivo real viene adentro del faultstring, no en el código HTTP.
    const falla = entre(cuerpo, 'faultstring');
    throw new Error(`ARCA rechazó el pedido de permiso: ${falla ?? `HTTP ${res.status}`}`);
  }

  const devuelto = entre(cuerpo, 'loginCmsReturn');
  if (!devuelto) throw new Error('ARCA contestó algo que no se entiende (sin loginCmsReturn).');

  // Adentro viene otro XML, escapado.
  const ta = desescapar(devuelto);
  const token = entre(ta, 'token');
  const sign = entre(ta, 'sign');
  const vence = entre(ta, 'expirationTime');
  if (!token || !sign || !vence) throw new Error('El permiso de ARCA vino incompleto.');

  return { token, sign, expira: new Date(vence) };
}

/**
 * El ticket de acceso, del caché si sirve y de ARCA si no.
 *
 * Si dos ventas piden permiso al mismo tiempo, una lo obtiene y la otra recibe
 * el "ya posee un TA valido". En ese caso NO se reintenta pedirlo: se vuelve a
 * leer el caché, donde la primera ya lo dejó.
 */
export async function obtenerTicket(
  db: SupabaseClient,
  opciones: {
    cuit: string;
    servicio: string;
    ambiente: Ambiente;
    certPem: string;
    keyPem: string;
  },
): Promise<TicketAcceso> {
  const { cuit, servicio, ambiente, certPem, keyPem } = opciones;

  const leerCache = async (): Promise<TicketAcceso | null> => {
    const { data } = await db
      .from('arca_tokens')
      .select('token, sign, expira_at')
      .eq('cuit', cuit)
      .eq('servicio', servicio)
      .eq('ambiente', ambiente)
      .maybeSingle();
    if (!data) return null;
    const expira = new Date(data.expira_at);
    if (expira.getTime() - Date.now() < MARGEN_MS) return null;
    return { token: data.token, sign: data.sign, expira };
  };

  const guardado = await leerCache();
  if (guardado) return guardado;

  let ticket: TicketAcceso;
  try {
    ticket = await pedirTicket(ambiente, servicio, certPem, keyPem);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // "El CEE ya posee un TA valido": otro proceso lo pidió recién.
    if (/ya posee un TA valido/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 2000));
      const deOtro = await leerCache();
      if (deOtro) return deOtro;
    }
    throw e;
  }

  await db.from('arca_tokens').upsert(
    {
      cuit,
      servicio,
      ambiente,
      token: ticket.token,
      sign: ticket.sign,
      generado_at: new Date().toISOString(),
      expira_at: ticket.expira.toISOString(),
      guardado_at: new Date().toISOString(),
    },
    { onConflict: 'cuit,servicio,ambiente' },
  );

  return ticket;
}
