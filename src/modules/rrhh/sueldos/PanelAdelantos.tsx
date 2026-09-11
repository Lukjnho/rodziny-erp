import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatARS, cn } from '@/lib/utils';
import { procesarComprobantePago } from '@/lib/ocrComprobantePago';
import { MEDIO_PAGO_LABEL, medioRequiereComprobante, type MedioPago } from '@/lib/mediosPago';
import { ymd } from '../utils';
import type { Adelanto } from './tipos';
import type { Empleado } from '../RRHHPage';

interface Props {
  empleado: Empleado;
  periodo: string;
  adelantos: Adelanto[];
  onClose: () => void;
}

// El medio de pago sale del vocabulario unico de egresos (`@/lib/mediosPago`).
//
// 💣 Lo que habia antes era una NOVENA lista: `'efectivo' | 'mercadopago' |
// 'galicia'`, y al grabar armaba el texto con `transferencia_${medio}`. Eso
// producia **`transferencia_mercadopago`, que NO es un alias del catalogo** —
// los que existen son `transferencia_mp` y `transferencia mercadopago`, con
// espacio. Un adelanto por MercadoPago entraba con un medio que el disparador
// de la base no sabe traducir. Nunca llego a pasar (los 42 adelantos cargados
// son efectivo o nulo), asi que no hay datos que reparar.
//
// Estas tres son un subconjunto de `MedioPago`: un adelanto se paga en mano o
// se transfiere, no se paga con cheque.
const OPCIONES: readonly MedioPago[] = ['efectivo', 'transferencia_mp', 'transferencia_galicia'];

export function PanelAdelantos({ empleado, periodo, adelantos, onClose }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [fecha, setFecha] = useState(ymd(new Date()));
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [medio, setMedio] = useState<MedioPago>('efectivo');

  // Datos bancarios (solo si medio = transferencia). El comprobante + N° op son
  // obligatorios para que el adelanto se concilie después contra el extracto.
  const [nOperacion, setNOperacion] = useState('');
  const [comprobantePath, setComprobantePath] = useState<string | null>(null);
  const [ocrEjecutando, setOcrEjecutando] = useState(false);
  const [ocrInfo, setOcrInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // La regla de "esto se concilia contra el extracto, asi que exige comprobante
  // y N° de operacion" es UNA sola en todo el ERP: `medioRequiereComprobante`.
  // Acá estaba escrita por décima vez, como `medio === 'mercadopago' || ...`.
  const esTransferencia = medioRequiereComprobante(medio);

  function resetForm() {
    setMonto('');
    setMotivo('');
    setMedio('efectivo');
    setNOperacion('');
    setComprobantePath(null);
    setOcrInfo(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function manejarArchivo(file: File) {
    setOcrEjecutando(true);
    setOcrInfo(null);
    try {
      const res = await procesarComprobantePago({
        archivo: file,
        subfolder: `adelantos/${empleado.local}`,
        userId: user?.id ?? null,
      });
      if (!res.ok && res.error) {
        window.alert(res.error);
        return;
      }
      setComprobantePath(res.file_path);
      if (res.n_operacion) {
        if (!nOperacion.trim()) setNOperacion(res.n_operacion);
        setOcrInfo(`✓ N° detectado: ${res.n_operacion}`);
      } else {
        setOcrInfo('Comprobante subido. Completá el N° de operación.');
      }
    } finally {
      setOcrEjecutando(false);
    }
  }

  const agregar = useMutation({
    mutationFn: async () => {
      const n = parseFloat(monto.replace(',', '.'));
      if (!n || n <= 0) throw new Error('Ingresá un monto válido');
      if (esTransferencia) {
        if (ocrEjecutando) throw new Error('Esperá a que termine el análisis del comprobante.');
        if (!comprobantePath) throw new Error('Comprobante de pago obligatorio. Subí la captura o PDF.');
        if (!nOperacion.trim()) throw new Error('N° de operación obligatorio. Copialo del comprobante.');
      }
      const { error } = await supabase.from('adelantos').insert({
        empleado_id: empleado.id,
        periodo,
        fecha,
        monto: n,
        motivo: motivo.trim() || null,
        // El valor se graba tal cual, sin armarlo con pedazos: `medio` YA es
        // una de las siete opciones canonicas y las siete son filas de
        // `medios_pago_alias`, asi que el disparador de la base lo resuelve.
        medio_pago: medio,
        numero_operacion: esTransferencia ? nOperacion.trim() : null,
        comprobante_path: esTransferencia ? comprobantePath : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['adelantos'] });
      resetForm();
    },
    onError: (e: Error) => window.alert(e.message),
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('adelantos').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['adelantos'] }),
  });

  const total = adelantos.reduce((s, a) => s + Number(a.monto), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30">
      <div
        className="mt-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="font-semibold text-gray-900">Adelantos</h3>
            <p className="text-xs text-gray-500">
              {empleado.nombre} {empleado.apellido} · {periodo}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl leading-none text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>

        <div className="border-b border-gray-100 bg-gray-50 px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide text-gray-500">
              Total de la quincena
            </span>
            <span className="text-lg font-bold text-gray-900">{formatARS(total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-xs"
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder="Monto"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-xs"
            />
          </div>
          {/* MITIGACION-MONTOS — provisorio. Este campo todavía lee el punto como
              coma decimal, así que "150.000" se guarda como 150. Se saca cuando el
              campo pase a MontoInput (ver docs/TRASPASO-MONTOS.md, grupo C). */}
          <p className="mt-1 text-[11px] text-amber-700">
            Escribí el monto sin puntos. Ejemplo: 150000
          </p>
          <input
            type="text"
            placeholder="Motivo (opcional)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="mt-2 w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
          />

          {/* Medio de pago — efectivo no se concilia; transferencia exige comprobante */}
          <div className="mt-2">
            <label className="mb-1 block text-[11px] font-medium text-gray-600">Medio de pago</label>
            <div className="flex items-stretch gap-1.5">
              {OPCIONES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMedio(m)}
                  className={cn(
                    'flex-1 rounded border px-2 py-1 text-[11px] font-medium leading-tight',
                    medio === m
                      ? 'border-blue-400 bg-blue-50 text-blue-800'
                      : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {MEDIO_PAGO_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Comprobante + N° op (solo transferencia) */}
          {esTransferencia && (
            <div className="mt-2 space-y-2 rounded border border-blue-100 bg-blue-50/40 p-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) manejarArchivo(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={ocrEjecutando}
                className="w-full rounded border border-dashed border-gray-300 px-2 py-1.5 text-[11px] text-gray-600 hover:border-blue-400 disabled:opacity-50"
              >
                {ocrEjecutando
                  ? '⏳ Analizando comprobante…'
                  : comprobantePath
                    ? '✓ Comprobante cargado — cambiar'
                    : '📎 Subir comprobante *'}
              </button>
              {ocrInfo && <p className="text-[11px] text-green-700">{ocrInfo}</p>}
              <input
                type="text"
                value={nOperacion}
                onChange={(e) => setNOperacion(e.target.value)}
                placeholder="N° de operación *"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
              />
            </div>
          )}

          <button
            onClick={() => agregar.mutate()}
            disabled={agregar.isPending || ocrEjecutando}
            className="mt-2 w-full rounded bg-rodziny-700 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800 disabled:opacity-50"
          >
            {agregar.isPending ? 'Guardando…' : '+ Agregar adelanto'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {adelantos.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-gray-400">
              Sin adelantos cargados
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {[...adelantos]
                .sort((a, b) => b.fecha.localeCompare(a.fecha))
                .map((a) => {
                  // Misma regla que arriba: se concilia lo bancarizado. Antes
                  // esto adivinaba con `.startsWith('transferencia')`, que deja
                  // afuera el cheque y la tarjeta.
                  const esTransf = medioRequiereComprobante(a.medio_pago);
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900">
                          {formatARS(Number(a.monto))}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                          <span>{a.fecha}</span>
                          {esTransf ? (
                            <span
                              className={cn(
                                'rounded px-1 py-0.5 text-[10px] font-medium',
                                a.conciliado_movimiento_id
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-amber-100 text-amber-700',
                              )}
                              title={
                                a.conciliado_movimiento_id
                                  ? 'Conciliado contra el extracto bancario'
                                  : 'Transferencia pendiente de conciliar'
                              }
                            >
                              {/* El nombre sale del vocabulario unico. El `??`
                                  cubre los formatos viejos con espacio, que
                                  siguen en la base y no se reescriben. */}
                              🏦{' '}
                              {MEDIO_PAGO_LABEL[a.medio_pago as MedioPago] ?? a.medio_pago}
                              {a.conciliado_movimiento_id ? ' · conciliado' : ' · pendiente'}
                            </span>
                          ) : (
                            <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600">
                              efectivo
                            </span>
                          )}
                        </div>
                        {a.numero_operacion && (
                          <div className="mt-0.5 font-mono text-[10px] text-gray-400">
                            N° op {a.numero_operacion}
                          </div>
                        )}
                        {a.motivo && (
                          <div className="mt-0.5 truncate text-xs text-gray-600">{a.motivo}</div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          if (window.confirm('¿Borrar este adelanto?')) borrar.mutate(a.id);
                        }}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Borrar
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
