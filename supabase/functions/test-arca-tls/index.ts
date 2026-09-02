// Spike temporal: ¿puede Supabase (Deno) hacer TODO lo que exige ARCA?
//
// Son dos riesgos distintos y hay que probar los dos:
//
//   1. CONEXION. Desde Node moderno el WSFEv1 de PRODUCCION rechaza la
//      conexion con "dh key too small": ARCA ofrece primero un intercambio de
//      claves viejo (DHE de clave corta) que OpenSSL 3 considera inseguro.
//      Deno usa rustls, que directamente NO implementa DHE, asi que negocia
//      ECDHE sola. GET / -> lo comprueba contra los cuatro servidores reales.
//
//   2. FIRMA. Para pedir el token (WSAA) hay que firmar el pedido en formato
//      CMS/PKCS#7, que tradicionalmente se hace con OpenSSL — que aca no
//      existe. Se prueba con node-forge, que es JavaScript puro.
//      POST / con {cert, key} en PEM -> arma el TRA y lo firma.
//
// El certificado del POST es de PRUEBA y descartable: no se guarda ni se loguea.
//
// BORRAR una vez tomada la decision de arquitectura.

import forge from 'npm:node-forge@1.3.1';

const DESTINOS: Array<[string, string]> = [
  ['wsaa_homologacion', 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL'],
  ['wsaa_produccion', 'https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL'],
  ['wsfev1_homologacion', 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL'],
  ['wsfev1_produccion', 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL'],
];

async function probarConexion(url: string) {
  const inicio = Date.now();
  try {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), 20000);
    const res = await fetch(url, { signal: control.signal });
    const cuerpo = await res.text();
    clearTimeout(reloj);
    return {
      ok: res.ok,
      status: res.status,
      bytes: cuerpo.length,
      ms: Date.now() - inicio,
      parece_wsdl: cuerpo.includes('wsdl:definitions') || cuerpo.includes('<definitions'),
    };
  } catch (e) {
    return { ok: false, ms: Date.now() - inicio, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

// ARCA quiere las fechas con el huso horario explicito.
function isoConHuso(d: Date) {
  const ms = d.getTime() - 3 * 60 * 60 * 1000; // Argentina, UTC-3
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '-03:00');
}

function armarTRA(servicio: string) {
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

function firmarCMS(tra: string, certPem: string, keyPem: string) {
  const inicio = Date.now();
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

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const base64 = forge.util.encode64(der);

  // Volver a leerlo confirma que quedo bien armado, no solo que no exploto.
  // OJO: al parsear, node-forge llena "signerInfos", no "signers" (ese ultimo
  // existe solo del lado de la creacion). Mirar el campo equivocado da un
  // falso negativo.
  // OJO: al parsear, node-forge NO repuebla ni "signers" ni "signerInfos" —
  // quedan en cero aunque el CMS este perfecto. Contarlos da un falso negativo.
  // La verificacion de verdad se hace afuera:
  //   openssl cms -verify -inform DER -in cms.der -noverify
  // Con este mismo codigo, openssl responde "CMS Verification successful".
  const releido = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(der)));

  return {
    ok: true,
    ms: Date.now() - inicio,
    cms_bytes: der.length,
    releido_ok: !!releido,
    certificados_incluidos: releido?.certificates?.length ?? 0,
    algoritmo: 'sha256',
    cms_base64: base64,
  };
}

Deno.serve(async (req: Request) => {
  const cabeceras = { 'Content-Type': 'application/json' };

  if (req.method === 'POST') {
    try {
      const { cert, key, servicio } = await req.json();
      if (!cert || !key) {
        return new Response(JSON.stringify({ error: 'Faltan cert y key en PEM' }, null, 2), { status: 400, headers: cabeceras });
      }
      const tra = armarTRA(servicio ?? 'wsfe');
      const firma = firmarCMS(tra, cert, key);
      return new Response(JSON.stringify({
        runtime: `Deno ${Deno.version.deno}`,
        veredicto: firma.ok && firma.releido_ok && firma.certificados_incluidos === 1
          ? 'FIRMA OK: node-forge arma el CMS que pide ARCA, sin OpenSSL'
          : 'FIRMA CON PROBLEMAS: revisar',
        tra_largo: tra.length,
        firma,
      }, null, 2), { headers: cabeceras });
    } catch (e) {
      return new Response(JSON.stringify({
        veredicto: 'FIRMA FALLA',
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        stack: e instanceof Error ? e.stack?.split('\n').slice(0, 6) : undefined,
      }, null, 2), { status: 500, headers: cabeceras });
    }
  }

  const resultados: Record<string, unknown> = {};
  for (const [nombre, url] of DESTINOS) {
    resultados[nombre] = { url, ...(await probarConexion(url)) };
  }
  const todos = Object.values(resultados) as Array<{ ok: boolean }>;
  return new Response(JSON.stringify({
    runtime: `Deno ${Deno.version.deno}`,
    veredicto: todos.every((r) => r.ok)
      ? 'CONEXION OK: el codigo de facturacion puede vivir en Supabase'
      : 'HAY FALLAS: puede hacer falta Vercel con runtime Node',
    resultados,
    nota: 'Para probar la firma: POST con {cert, key} en PEM.',
  }, null, 2), { headers: cabeceras });
});
