/**
 * Impresión de comanda, control y ticket en formato 80 mm (rollo térmico).
 *
 * HAY DOS CAMINOS, y se prueban en este orden:
 *
 * 1. EL AGENTE (`agente-impresion/`). Si está instalado en la PC de la caja, el
 *    ticket sale SOLO: sin diálogo, cortando el papel. Es el camino bueno para
 *    un mostrador con 65 tickets por turno.
 *
 * 2. EL DIÁLOGO DEL NAVEGADOR. Si el agente no está, se arma el documento en la
 *    pantalla y se manda con `window.print()`, eligiendo la térmica como
 *    cualquier impresora. Funciona sin instalar nada, pero hay que confirmar
 *    cada impresión a mano.
 *
 * O sea que el agente MEJORA la caja pero no es obligatorio: si se cae, se
 * sigue imprimiendo igual.
 */

import { createPortal } from 'react-dom';
import qrcode from 'qrcode-generator';
import { imprimirConAgente, type RenglonImpreso } from '@/lib/impresoraDirecta';
import {
  CONDICION_IVA,
  LEYENDA_TRANSPARENCIA,
  LEYENDA_TRANSPARENCIA_TERMICA,
  TIPO_COMPROBANTE,
  fechaLarga,
  numeroFormateado,
  receptorImpreso,
  urlQrArca,
  type DatosFiscales,
} from './comprobanteFiscal';

export type TipoDocumento = 'comanda' | 'control' | 'ticket';

export interface LineaImpresa {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  descuentoMonto: number;
  /** lo que se cobra, con el descuento ya restado */
  total: number;
  /** true si cuelga de la línea de arriba (la salsa de esa pasta) */
  esHija: boolean;
}

export interface DatosImpresion {
  tipo: TipoDocumento;
  local: string;
  caja: string;
  numero: string;
  fecha: string;
  /** hora en que se comandó el pedido (no la de impresión) */
  hora: string;
  /** segunda copia: se perdió el ticket, no llegó la comanda a cocina… */
  reimpresion?: boolean;
  cliente: string | null;
  /** nombre del convenio con el que se bonificó, si hubo */
  convenio: string | null;
  lineas: LineaImpresa[];
  pagos: { medio: string; monto: number }[];
  /** lo que se cobra, con los descuentos ya restados */
  total: number;
  /**
   * Si vino el CAE de ARCA, el ticket deja de ser "documento no fiscal" y pasa
   * a ser la factura. Mientras esto no esté, se imprime el ticket de siempre.
   */
  fiscal?: DatosFiscales | null;
}

const pesos = (n: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);

const TITULO: Record<TipoDocumento, string> = {
  comanda: 'COMANDA',
  control: 'CONTROL',
  ticket: 'TICKET',
};

/** Hora de Argentina en el momento exacto en que se manda a imprimir. */
function horaImpresionAR(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

/** "2026-08-31" → "31/08". El año no entra: ocupa lugar y no dice nada. */
function fechaCorta(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return dia && mes ? `${dia}/${mes}` : iso;
}

/** Manda a imprimir lo que esté montado en #area-impresion (plan B). */
export function imprimir() {
  window.print();
}

/** "vedia" → "Vedia" */
function conMayuscula(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * El mismo documento, pero en renglones para la impresora térmica.
 *
 * El diseño vive acá, del lado del ERP, y no adentro del agente: así se puede
 * cambiar el ticket con un deploy, sin volver a instalar nada en las PCs de los
 * locales.
 *
 * ⚠️ Nada de caracteres finos: la térmica escribe con una tabla vieja
 * (PC850). Las eñes y los acentos entran bien, pero el "×" y el "−" largos no:
 * van una "x" y un guion común.
 */
export function aRenglones(datos: DatosImpresion): RenglonImpreso[] {
  const { tipo } = datos;
  const conPrecios = tipo !== 'comanda';
  const horaImpresion = horaImpresionAR();
  const descuentoTotal = datos.lineas.reduce((s, l) => s + l.descuentoMonto, 0);
  const r: RenglonImpreso[] = [];

  const f = tipo === 'ticket' ? (datos.fiscal ?? null) : null;
  const cbte = f ? TIPO_COMPROBANTE[f.tipoComprobante] : null;

  r.push({ x: 'RODZINY', c: true, b: true, s: 2 });
  r.push({ x: conMayuscula(datos.local), c: true });

  if (f) {
    // Encabezado del emisor: lo exige la RG 4291 en todo comprobante.
    r.push({ x: f.emisor.razonSocial, c: true });
    r.push({ x: `CUIT ${f.emisor.cuit}`, c: true });
    if (f.emisor.domicilio) r.push({ x: f.emisor.domicilio, c: true });
    if (f.emisor.ingresosBrutos) r.push({ x: `IIBB ${f.emisor.ingresosBrutos}`, c: true });
    if (f.emisor.inicioActividades) {
      r.push({ x: `Inicio de actividades ${fechaLarga(f.emisor.inicioActividades)}`, c: true });
    }
    r.push({ x: 'IVA RESPONSABLE INSCRIPTO', c: true });
    r.push({ k: 'sep' });

    // La letra es lo que primero mira quien recibe el comprobante.
    r.push({ x: cbte?.letra ?? '?', c: true, b: true, s: 3 });
    r.push({
      x: `${cbte?.nombre ?? 'COMPROBANTE'} ${cbte?.letra ?? ''} - COD. ${String(f.tipoComprobante).padStart(2, '0')}`,
      c: true,
      b: true,
    });
    r.push({ x: numeroFormateado(f.puntoVenta, f.numero), c: true, b: true, s: 2 });
    r.push({ x: `Fecha de emision ${fechaLarga(f.fecha)}`, c: true });
    if (f.ambiente === 'homologacion') {
      r.push({ k: 'nl' });
      r.push({ x: 'PRUEBA - SIN VALOR FISCAL', c: true, b: true, s: 2 });
    }
    r.push({ k: 'sep' });

    const rec = receptorImpreso(f.receptor);
    r.push({ x: rec.linea1, b: true });
    if (rec.linea2) r.push({ x: rec.linea2 });
    if (f.receptor.domicilio) r.push({ x: f.receptor.domicilio });
    // "A CONSUMIDOR FINAL" ya lo dice todo: repetir abajo "Consumidor Final"
    // es ruido. La condición se aclara solo cuando el cliente está identificado.
    if (f.receptor.docTipo !== 99) {
      r.push({ x: CONDICION_IVA[f.receptor.condicionIva] ?? 'Consumidor Final' });
    }
  } else {
    r.push({ x: TITULO[tipo], c: true, b: true });
  }

  r.push({ k: 'sep' });

  r.push({
    k: 'lr',
    x: `${fechaCorta(datos.fecha)} ${horaImpresion}`,
    y: `#${datos.numero}`,
    b: true,
  });
  r.push({ x: datos.caja });
  if (datos.reimpresion) r.push({ x: `REIMPRESIÓN - pedido ${datos.hora}`, b: true });

  // El llamador es lo que la cocina canta: va grande, solo y sin nada al lado.
  if (datos.cliente) {
    r.push({ k: 'sep' });
    r.push({ x: 'LLAMADOR', c: true });
    r.push({ x: datos.cliente, c: true, b: true, s: tipo === 'comanda' ? 3 : 2 });
  }

  r.push({ k: 'sep' });

  for (const l of datos.lineas) {
    const sangria = l.esHija ? 2 : 0;
    const nombre = `${l.esHija ? '> ' : ''}${l.cantidad} x ${l.nombre}`;
    if (conPrecios) {
      r.push({ k: 'lr', x: nombre, y: pesos(l.total), i: sangria });
      if (l.cantidad > 1) {
        r.push({ x: `${l.cantidad} x ${pesos(l.precioUnitario)}`, i: sangria + 2 });
      }
      if (l.descuentoMonto > 0) {
        r.push({
          k: 'lr',
          x: `desc. ${l.descuentoPct}%`,
          y: `- ${pesos(l.descuentoMonto)}`,
          i: sangria + 2,
        });
      }
    } else {
      // En la comanda no hay precios: la cantidad en negrita es lo que importa
      r.push({ x: nombre, b: true, i: sangria });
    }
  }

  if (conPrecios) {
    r.push({ k: 'sep' });
    if (descuentoTotal > 0) {
      r.push({ k: 'lr', x: 'Subtotal', y: pesos(datos.total + descuentoTotal) });
      r.push({
        k: 'lr',
        x: `Descuento${datos.convenio ? ` ${datos.convenio}` : ''}`,
        y: `- ${pesos(descuentoTotal)}`,
      });
    }
    // El IVA discriminado es obligatorio desde el 1-abr-2025 (Ley 27.743): el
    // consumidor final tiene derecho a ver cuánto de lo que paga es impuesto.
    if (f) {
      r.push({ k: 'lr', x: 'Neto gravado', y: pesos(f.neto) });
      r.push({ k: 'lr', x: 'IVA 21%', y: pesos(f.iva) });
    }
    r.push({ k: 'lr', x: 'TOTAL', y: pesos(datos.total), b: true, s: 2 });
  }

  if (tipo === 'ticket' && datos.pagos.length > 0) {
    r.push({ k: 'sep' });
    for (const p of datos.pagos) r.push({ k: 'lr', x: p.medio, y: pesos(p.monto) });
  }

  r.push({ k: 'sep' });

  if (f) {
    for (const linea of LEYENDA_TRANSPARENCIA_TERMICA) r.push({ x: linea, c: true });
    r.push({ k: 'sep' });
    r.push({ k: 'lr', x: 'CAE', y: f.cae, b: true });
    r.push({ k: 'lr', x: 'Vencimiento del CAE', y: fechaLarga(f.caeVencimiento) });
    r.push({ k: 'nl' });
    // El QR lo dibuja la impresora con su propio comando: sale nítido y no
    // depende de mandar una imagen por el cable.
    r.push({ k: 'qr', x: urlQrArca(f) });
    r.push({ k: 'nl' });
  } else {
    r.push({
      x:
        tipo === 'control'
          ? 'CONTROL - no válido como comprobante'
          : tipo === 'comanda'
            ? 'Cocina'
            : 'Documento no fiscal',
      c: true,
    });
  }

  r.push({ x: '¡Gracias!', c: true });

  return r;
}

/**
 * Intenta imprimir por el agente de la PC de la caja.
 * `true` si salió por la térmica; `false` si hay que usar el diálogo.
 */
export async function imprimirDirecto(datos: DatosImpresion): Promise<boolean> {
  return imprimirConAgente({
    titulo: `${TITULO[datos.tipo]} ${datos.numero}`,
    lineas: aRenglones(datos),
    cortar: true,
  });
}

export function DocumentoImpresion({ datos }: { datos: DatosImpresion }) {
  const { tipo } = datos;
  const conPrecios = tipo !== 'comanda';
  // Se calcula al renderizar, que es el instante justo antes de imprimir. Si el
  // mismo pedido se reimprime, sale la hora nueva — que es lo que la cocina
  // necesita para saber hace cuánto está esperando ese plato.
  const horaImpresion = horaImpresionAR();
  const descuentoTotal = datos.lineas.reduce((s, l) => s + l.descuentoMonto, 0);
  const f = tipo === 'ticket' ? (datos.fiscal ?? null) : null;
  const cbte = f ? TIPO_COMPROBANTE[f.tipoComprobante] : null;
  const rec = f ? receptorImpreso(f.receptor) : null;

  // OJO: el documento se monta como hijo DIRECTO de <body>, fuera del árbol de
  // la app. Si quedara adentro, la regla que esconde la pantalla para imprimir
  // lo escondería a él también y saldría la hoja en blanco.
  return createPortal(
    <>
      <style>{`
        #area-impresion { display: none; }
        @media print {
          /* Solo se imprime el documento: el resto del ERP no sale en el papel */
          body > *:not(#area-impresion) { display: none !important; }
          #area-impresion {
            display: block !important;
            position: absolute; left: 0; top: 0;
            width: 72mm;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.35;
            color: #000;
          }
          @page { size: 80mm auto; margin: 3mm; }
        }
      `}</style>

      <div id="area-impresion">
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15 }}>RODZINY</div>
        <div style={{ textAlign: 'center', textTransform: 'capitalize' }}>{datos.local}</div>

        {f ? (
          <>
            <div style={{ textAlign: 'center', fontSize: 11 }}>
              <div>{f.emisor.razonSocial}</div>
              <div>CUIT {f.emisor.cuit}</div>
              {f.emisor.domicilio && <div>{f.emisor.domicilio}</div>}
              {f.emisor.ingresosBrutos && <div>IIBB {f.emisor.ingresosBrutos}</div>}
              {f.emisor.inicioActividades && (
                <div>Inicio de actividades {fechaLarga(f.emisor.inicioActividades)}</div>
              )}
              <div>IVA RESPONSABLE INSCRIPTO</div>
            </div>
            <Separador />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>
                {cbte?.letra ?? '?'}
              </div>
              <div style={{ fontWeight: 700 }}>
                {cbte?.nombre ?? 'COMPROBANTE'} {cbte?.letra} — COD.{' '}
                {String(f.tipoComprobante).padStart(2, '0')}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {numeroFormateado(f.puntoVenta, f.numero)}
              </div>
              <div style={{ fontSize: 11 }}>Fecha de emisión {fechaLarga(f.fecha)}</div>
              {f.ambiente === 'homologacion' && (
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>
                  PRUEBA — SIN VALOR FISCAL
                </div>
              )}
            </div>
            <Separador />
            <div style={{ fontSize: 11 }}>
              <div style={{ fontWeight: 700 }}>{rec?.linea1}</div>
              {rec?.linea2 && <div>{rec.linea2}</div>}
              {f.receptor.domicilio && <div>{f.receptor.domicilio}</div>}
              <div>{CONDICION_IVA[f.receptor.condicionIva] ?? 'Consumidor Final'}</div>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', fontWeight: 700, marginTop: 4 }}>{TITULO[tipo]}</div>
        )}

        <Separador />

        {/* UNA sola hora: la de impresión, que es el reloj con el que se guía la
            cocina (desde acá se cuenta cuánto hace que el plato está esperando).
            La hora del pedido solo aparece si es distinta — o sea, solo en las
            reimpresiones, donde además sirve para saber que es segunda copia. */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700 }}>
            {fechaCorta(datos.fecha)} {horaImpresion}
          </span>
          <span>#{datos.numero}</span>
        </div>
        <div>{datos.caja}</div>
        {datos.reimpresion && (
          <div style={{ fontWeight: 700 }}>REIMPRESIÓN · pedido {datos.hora}</div>
        )}

        {/* El número de llamador es lo que la cocina canta cuando el plato está
            listo: va grande, solo y sin nada al lado. */}
        {datos.cliente && (
          <>
            <Separador />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11 }}>LLAMADOR</div>
              <div style={{ fontSize: tipo === 'comanda' ? 40 : 22, fontWeight: 700, lineHeight: 1.1 }}>
                {datos.cliente}
              </div>
            </div>
          </>
        )}

        <Separador />

        {/* La cantidad va SIEMPRE, aunque sea 1: el cocinero no tiene que
            deducirla. Con dos Tagliatelle y dos Bolognesa, los dos renglones
            dicen 2. */}
        {datos.lineas.map((l, i) => (
          <div key={i} style={{ marginBottom: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ paddingLeft: l.esHija ? 12 : 0 }}>
                {l.esHija ? '› ' : ''}
                <span style={{ fontWeight: 700, fontSize: tipo === 'comanda' ? 14 : 12 }}>
                  {l.cantidad}
                </span>
                {' × '}
                {l.nombre}
              </span>
              {conPrecios && <span>{pesos(l.total)}</span>}
            </div>
            {conPrecios && l.cantidad > 1 && (
              <div style={{ paddingLeft: l.esHija ? 12 : 0, fontSize: 11 }}>
                {l.cantidad} × {pesos(l.precioUnitario)}
              </div>
            )}
            {/* El descuento se muestra debajo de su línea: el cliente tiene que
                poder ver de dónde salió la rebaja, no solo el total final. */}
            {conPrecios && l.descuentoMonto > 0 && (
              <div
                style={{
                  paddingLeft: l.esHija ? 12 : 0,
                  fontSize: 11,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>desc. {l.descuentoPct}%</span>
                <span>− {pesos(l.descuentoMonto)}</span>
              </div>
            )}
          </div>
        ))}

        {conPrecios && (
          <>
            <Separador />
            {descuentoTotal > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Subtotal</span>
                  <span>{pesos(datos.total + descuentoTotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Descuento{datos.convenio ? ` ${datos.convenio}` : ''}</span>
                  <span>− {pesos(descuentoTotal)}</span>
                </div>
              </>
            )}
            {f && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Neto gravado</span>
                  <span>{pesos(f.neto)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>IVA 21%</span>
                  <span>{pesos(f.iva)}</span>
                </div>
              </>
            )}
            <div
              style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}
            >
              <span>TOTAL</span>
              <span>{pesos(datos.total)}</span>
            </div>
          </>
        )}

        {tipo === 'ticket' && datos.pagos.length > 0 && (
          <>
            <Separador />
            {datos.pagos.map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{p.medio}</span>
                <span>{pesos(p.monto)}</span>
              </div>
            ))}
          </>
        )}

        <Separador />

        {f ? (
          <>
            <div style={{ textAlign: 'center', fontSize: 10 }}>{LEYENDA_TRANSPARENCIA}</div>
            <Separador />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>CAE</span>
              <span>{f.cae}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span>Vencimiento del CAE</span>
              <span>{fechaLarga(f.caeVencimiento)}</span>
            </div>
            <div style={{ textAlign: 'center', marginTop: 6 }}>
              <QrArca url={urlQrArca(f)} />
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', fontSize: 11 }}>
            {tipo === 'control'
              ? 'CONTROL — no válido como comprobante'
              : tipo === 'comanda'
                ? 'Cocina'
                : 'Documento no fiscal'}
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 11, marginTop: 2 }}>¡Gracias!</div>
        {/* aire al final para que el corte no se coma la última línea */}
        <div style={{ height: '10mm' }} />
      </div>
    </>,
    document.body,
  );
}

function Separador() {
  return <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />;
}

/**
 * El QR de ARCA para el camino del navegador (cuando no está el agente).
 *
 * Se dibuja acá y no se pide a ningún servicio: un comprobante fiscal no puede
 * depender de que una web ajena esté levantada al momento de imprimir.
 * Corrección 'L' a propósito: la URL es larga y con menos corrección entran
 * menos cuadraditos, que en una térmica de 203 dpi se leen mucho mejor.
 */
function QrArca({ url }: { url: string }) {
  const qr = qrcode(0, 'L');
  qr.addData(url);
  qr.make();
  return (
    <img
      src={qr.createDataURL(4, 0)}
      alt="Código QR del comprobante"
      style={{ width: '28mm', height: '28mm' }}
    />
  );
}
