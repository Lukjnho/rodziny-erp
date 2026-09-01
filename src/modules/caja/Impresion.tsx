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
import { imprimirConAgente, type RenglonImpreso } from '@/lib/impresoraDirecta';

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

  r.push({ x: 'RODZINY', c: true, b: true, s: 2 });
  r.push({ x: conMayuscula(datos.local), c: true });
  r.push({ x: TITULO[tipo], c: true, b: true });
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
    r.push({ k: 'lr', x: 'TOTAL', y: pesos(datos.total), b: true, s: 2 });
  }

  if (tipo === 'ticket' && datos.pagos.length > 0) {
    r.push({ k: 'sep' });
    for (const p of datos.pagos) r.push({ k: 'lr', x: p.medio, y: pesos(p.monto) });
  }

  r.push({ k: 'sep' });
  r.push({
    x:
      tipo === 'control'
        ? 'CONTROL - no válido como comprobante'
        : tipo === 'comanda'
          ? 'Cocina'
          : 'Documento no fiscal',
    c: true,
  });
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
        <div style={{ textAlign: 'center', fontWeight: 700, marginTop: 4 }}>{TITULO[tipo]}</div>
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
        <div style={{ textAlign: 'center', fontSize: 11 }}>
          {tipo === 'control'
            ? 'CONTROL — no válido como comprobante'
            : tipo === 'comanda'
              ? 'Cocina'
              : 'Documento no fiscal'}
        </div>
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
