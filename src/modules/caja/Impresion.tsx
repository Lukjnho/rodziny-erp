/**
 * Impresión de comanda, control y ticket en formato 80 mm (rollo térmico).
 *
 * CÓMO IMPRIME: se arma el documento en la pantalla y se manda a imprimir con
 * el diálogo del navegador, eligiendo la impresora térmica como cualquier otra
 * impresora de Windows. Funciona hoy, sin instalar nada.
 *
 * LO QUE ESTO NO HACE: imprimir de una sin que aparezca el diálogo, ni abrir la
 * gaveta, ni cortar el papel automáticamente. Eso necesita hablarle a la
 * impresora en su propio idioma (ESC/POS) y desde el navegador no se puede: hay
 * que instalar un programita en la notebook de la caja. Es un paso aparte.
 */

import { createPortal } from 'react-dom';

export type TipoDocumento = 'comanda' | 'control' | 'ticket';

export interface LineaImpresa {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
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
  lineas: LineaImpresa[];
  pagos: { medio: string; monto: number }[];
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

/** Manda a imprimir lo que esté montado en #area-impresion. */
export function imprimir() {
  window.print();
}

export function DocumentoImpresion({ datos }: { datos: DatosImpresion }) {
  const { tipo } = datos;
  const conPrecios = tipo !== 'comanda';
  // Se calcula al renderizar, que es el instante justo antes de imprimir. Si el
  // mismo pedido se reimprime, sale la hora nueva — que es lo que la cocina
  // necesita para saber hace cuánto está esperando ese plato.
  const horaImpresion = horaImpresionAR();

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
          </div>
        ))}

        {conPrecios && (
          <>
            <Separador />
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
