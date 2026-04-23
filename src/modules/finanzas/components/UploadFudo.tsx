import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { parseFudoVentas } from '../parsers/parseFudoVentas';
import { parseFudoGastos } from '../parsers/parseFudoGastos';
import { parseExtracto } from '../parsers/parseExtractos';
import { cn } from '@/lib/utils';

type TipoArchivo = 'ventas' | 'gastos' | 'extracto';
type LocalFudo = 'vedia' | 'saavedra';

interface UploadResult {
  insertados: number;
  errores: string[];
}
interface Detectado {
  tipo: TipoArchivo;
  local: LocalFudo;
  confianza: 'alta' | 'baja';
}

// ── auto-detección desde nombre de archivo ────────────────────────────────────
function normalizar(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function detectarDesdeNombre(filename: string): Detectado {
  const f = normalizar(filename);

  let tipo: TipoArchivo = 'ventas';
  if (f.includes('gasto') || f.includes('egreso')) tipo = 'gastos';
  else if (
    f.includes('extracto') ||
    f.includes('galicia') ||
    f.includes('icbc') ||
    f.includes('mercado')
  )
    tipo = 'extracto';

  let local: LocalFudo = 'vedia';
  const esSaavedra =
    f.includes('saavedra') ||
    f.includes('saveedra') ||
    f.includes('savedra') ||
    f.includes('sin gluten');
  if (esSaavedra) local = 'saavedra';
  else if (f.includes('vedia') || f.includes('pasta')) local = 'vedia';

  const confianza: 'alta' | 'baja' =
    (f.includes('vedia') || esSaavedra) &&
    (f.includes('venta') || f.includes('gasto') || f.includes('extracto'))
      ? 'alta'
      : 'baja';

  return { tipo, local, confianza };
}

// ── componente ────────────────────────────────────────────────────────────────
export function UploadFudo({ onSuccess }: { onSuccess?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detectado, setDetectado] = useState<(Detectado & { nombre: string }) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── cuando el usuario elige o arrastra un archivo ─────────────────────────
  function onFileSelected(file: File) {
    setResult(null);
    setError(null);
    const det = detectarDesdeNombre(file.name);
    setDetectado({ ...det, nombre: file.name });
  }

  // ── importar después de confirmar ─────────────────────────────────────────
  async function importar(file: File, tipo: TipoArchivo, local: LocalFudo) {
    setLoading(true);
    setError(null);
    try {
      if (tipo === 'ventas' || tipo === 'gastos') {
        const buffer = await file.arrayBuffer();
        if (tipo === 'ventas') await importarVentas(buffer, local);
        else await importarGastos(buffer, local);
      } else {
        const text = await file.text();
        await importarExtracto(text, file.name);
      }
      onSuccess?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  async function importarVentas(buffer: ArrayBuffer, loc: LocalFudo) {
    const data = parseFudoVentas(buffer, loc);
    const errores: string[] = [];
    const fiscalMap = new Map(data.fiscales.map((f) => [f.fudo_id, f]));

    // Precalcular por ticket: total de pagos y porción "Mercadopago lucas"
    // Se usa para (a) flaggear tickets 100% MP Lucas como dividendo, (b) restar la porción
    // MP Lucas del total_bruto en tickets mixtos (pagos combinados)
    const pagosPorTicket = new Map<string, { total: number; mpLucas: number }>();
    for (const p of data.pagos) {
      const entry = pagosPorTicket.get(p.fudo_ticket_id) ?? { total: 0, mpLucas: 0 };
      entry.total += Number(p.monto) || 0;
      if ((p.medio_pago ?? '').toLowerCase().includes('mercadopago lucas')) {
        entry.mpLucas += Number(p.monto) || 0;
      }
      pagosPorTicket.set(p.fudo_ticket_id, entry);
    }

    const ticketsRows = data.tickets
      .map((t) => {
        const f = fiscalMap.get(t.fudo_id);
        const info = pagosPorTicket.get(t.fudo_id);
        const mpLucas = info?.mpLucas ?? 0;
        const totalOriginal = Number(t.total_bruto) || 0;
        const esDividendoCompleto = mpLucas > 0 && mpLucas >= totalOriginal - 0.01;
        const esMixto = mpLucas > 0 && !esDividendoCompleto;
        const totalAjustado = esMixto ? totalOriginal - mpLucas : totalOriginal;
        return {
          local: loc,
          fudo_id: t.fudo_id,
          fecha: t.fecha,
          hora: t.hora,
          caja: t.caja,
          estado: t.estado,
          tipo_venta: t.tipo_venta,
          medio_pago: t.medio_pago,
          total_bruto: totalAjustado,
          total_neto: f ? f.total_neto : null,
          iva: f ? f.iva : 0,
          es_fiscal: t.es_fiscal,
          es_dividendo: esDividendoCompleto,
          periodo: t.fecha ? t.fecha.substring(0, 7) : data.periodo,
        };
      })
      .filter((t) => t.fecha)
      // excluir canceladas/eliminadas igual que el script de Sheets
      .filter((t) => t.estado !== 'Cancelada' && t.estado !== 'Eliminada');

    // Eliminar tickets del mismo local+periodo antes de reinsertar (evita acumulación de imports)
    await supabase.from('ventas_tickets').delete().eq('local', loc).eq('periodo', data.periodo);
    const { error: e1 } = await supabase.from('ventas_tickets').insert(ticketsRows);
    if (e1) errores.push(`Tickets: ${e1.message}`);

    console.log(
      '[upload] periodo:',
      data.periodo,
      '| productos:',
      data.productos.length,
      '| pagos:',
      data.pagos.length,
      '| descuentos:',
      data.descuentos,
    );

    // Guardar resumen de descuentos como partidas del EdR (informativo)
    const descPartidas = [
      {
        local: loc,
        periodo: data.periodo,
        concepto: 'cortesias_cant',
        monto: data.descuentos.cortesias_cant,
      },
      {
        local: loc,
        periodo: data.periodo,
        concepto: 'cortesias_monto',
        monto: data.descuentos.cortesias_monto,
      },
      {
        local: loc,
        periodo: data.periodo,
        concepto: 'otros_descuentos',
        monto: data.descuentos.otros_descuentos_monto,
      },
    ];
    await supabase
      .from('edr_partidas')
      .upsert(descPartidas, { onConflict: 'local,periodo,concepto' });

    await supabase.from('ventas_items').delete().eq('local', loc).eq('periodo', data.periodo);
    const itemsRows = data.productos.map((p) => ({ local: loc, periodo: data.periodo, ...p }));
    console.log(
      '[upload] items a insertar:',
      itemsRows.length,
      itemsRows.length > 0 ? itemsRows[0] : 'VACÍO',
    );
    if (itemsRows.length) {
      const { error: e2 } = await supabase.from('ventas_items').insert(itemsRows);
      if (e2) {
        console.error('[upload] error items:', e2);
        errores.push(`Productos: ${e2.message}`);
      }
    }

    await supabase.from('ventas_pagos').delete().eq('local', loc).eq('periodo', data.periodo);
    // Excluir pagos de tickets cancelados/eliminados
    const ticketIdsValidos = new Set(ticketsRows.map((t) => t.fudo_id));
    const pagosRows = data.pagos
      .filter((p) => ticketIdsValidos.has(p.fudo_ticket_id))
      .map((p) => ({
        local: loc,
        periodo: data.periodo,
        ...p,
        es_dividendo: (p.medio_pago ?? '').toLowerCase().includes('mercadopago lucas'),
      }));
    console.log('[upload] pagos a insertar:', pagosRows.length);
    if (pagosRows.length) {
      const { error: e3 } = await supabase.from('ventas_pagos').insert(pagosRows);
      if (e3) {
        console.error('[upload] error pagos:', e3);
        errores.push(`Pagos: ${e3.message}`);
      }
    }

    // Auto-insertar cobros MP Lucas como dividendos (reemplaza los del mismo local+periodo para evitar duplicados en reimport)
    const dividendosRows = data.pagos
      .filter((p) => ticketIdsValidos.has(p.fudo_ticket_id))
      .filter((p) => (p.medio_pago ?? '').toLowerCase().includes('mercadopago lucas'))
      .map((p) => ({
        socio: 'lucas',
        fecha: p.fecha,
        monto: p.monto,
        medio_pago: 'Mercadopago Lucas',
        concepto: 'Cobro de venta con posnet personal — autoasignado',
        local: loc,
        periodo: data.periodo,
        creado_por: 'import_fudo',
      }));
    await supabase
      .from('dividendos')
      .delete()
      .eq('local', loc)
      .eq('periodo', data.periodo)
      .eq('creado_por', 'import_fudo');
    if (dividendosRows.length) {
      const { error: eDiv } = await supabase.from('dividendos').insert(dividendosRows);
      if (eDiv) {
        console.error('[upload] error dividendos:', eDiv);
        errores.push(`Dividendos: ${eDiv.message}`);
      }
    }

    setResult({ insertados: ticketsRows.length, errores });
  }

  async function importarGastos(buffer: ArrayBuffer, loc: LocalFudo) {
    const { gastos, periodo } = parseFudoGastos(buffer, loc);
    const rows = gastos
      .filter((g) => g.fecha && !g.cancelado)
      .map((g) => ({ local: loc, periodo, ...g }));
    if (!rows.length)
      throw new Error(
        `El parser no encontró filas válidas. Verificá que el archivo sea el export de Gastos de Fudo ` +
          `y que tenga datos en las columnas Id, Fecha e Importe.`,
      );
    const { error } = await supabase.from('gastos').upsert(rows, { onConflict: 'local,fudo_id' });
    setResult({ insertados: rows.length, errores: error ? [error.message] : [] });
  }

  async function importarExtracto(text: string, filename: string) {
    const movimientos = parseExtracto(text, filename);
    if (!movimientos.length) throw new Error('No se detectó formato válido (MP / Galicia / ICBC)');
    const { error } = await supabase.from('movimientos_bancarios').upsert(
      movimientos.map((m) => ({ ...m, fuente: filename })),
      {
        onConflict: 'cuenta,fecha,referencia,debito,credito',
        ignoreDuplicates: true,
      },
    );
    setResult({ insertados: movimientos.length, errores: error ? [error.message] : [] });
  }

  const tipoLabel: Record<TipoArchivo, string> = {
    ventas: '📈 Ventas',
    gastos: '📋 Gastos',
    extracto: '🏦 Extracto bancario',
  };

  return (
    <div className="max-w-xl rounded-lg border border-surface-border bg-white p-6">
      <h3 className="mb-1 font-semibold text-gray-900">Importar datos</h3>
      <p className="mb-5 text-xs text-gray-400">
        El archivo se detecta automáticamente. Nombrá los archivos como:{' '}
        <span className="font-medium text-gray-600">Ventas Vedia Marzo</span> o{' '}
        <span className="font-medium text-gray-600">Gastos Saavedra Enero</span>.
      </p>

      {/* Drop zone */}
      <div
        className={cn(
          'cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors',
          detectado
            ? 'border-rodziny-400 bg-rodziny-50'
            : 'border-gray-300 hover:border-rodziny-500',
        )}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) onFileSelected(f);
        }}
      >
        <div className="mb-2 text-2xl">{detectado ? '✅' : '📂'}</div>
        {detectado ? (
          <p className="truncate text-sm font-medium text-gray-700">{detectado.nombre}</p>
        ) : (
          <p className="text-sm text-gray-600">
            Arrastrá el archivo acá o{' '}
            <span className="font-medium text-rodziny-700">hacé clic para seleccionar</span>
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".xls,.xlsx,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileSelected(f);
          }}
        />
      </div>

      {/* Detección: muestra qué detectó y permite corregir */}
      {detectado && !result && !loading && (
        <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Detección automática{' '}
            {detectado.confianza === 'baja' && (
              <span className="text-yellow-600">(baja confianza — verificá)</span>
            )}
          </p>

          {/* Tipo */}
          <div>
            <p className="mb-1 text-xs text-gray-500">Tipo</p>
            <div className="flex gap-2">
              {(['ventas', 'gastos', 'extracto'] as TipoArchivo[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setDetectado((d) => (d ? { ...d, tipo: t } : d))}
                  className={cn(
                    'rounded px-3 py-1 text-xs font-medium transition-colors',
                    detectado.tipo === t
                      ? 'bg-rodziny-800 text-white'
                      : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {tipoLabel[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Local (solo para ventas/gastos) */}
          {detectado.tipo !== 'extracto' && (
            <div>
              <p className="mb-1 text-xs text-gray-500">Local</p>
              <div className="flex gap-2">
                {(['vedia', 'saavedra'] as LocalFudo[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setDetectado((d) => (d ? { ...d, local: l } : d))}
                    className={cn(
                      'rounded px-3 py-1 text-xs font-medium capitalize transition-colors',
                      detectado.local === l
                        ? 'bg-rodziny-800 text-white'
                        : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {l === 'vedia' ? 'Rodziny Vedia' : 'Rodziny Saavedra'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Botón importar */}
          <button
            onClick={async () => {
              // re-leer el archivo desde el input
              const file = inputRef.current?.files?.[0];
              if (!file) return;
              await importar(file, detectado.tipo, detectado.local);
            }}
            className="w-full rounded-md bg-rodziny-800 py-2 text-sm font-medium text-white transition-colors hover:bg-rodziny-700"
          >
            Importar como {tipoLabel[detectado.tipo]}
            {detectado.tipo !== 'extracto' ? ` · ${detectado.local}` : ''}
          </button>
        </div>
      )}

      {/* Estado */}
      {loading && (
        <p className="mt-3 animate-pulse text-sm text-blue-600">⏳ Procesando archivo...</p>
      )}
      {result && (
        <div
          className={cn(
            'mt-3 rounded-md p-3 text-sm',
            result.errores.length ? 'bg-yellow-50 text-yellow-800' : 'bg-green-50 text-green-800',
          )}
        >
          ✅ {result.insertados} registros importados
          {result.errores.length > 0 && (
            <div className="mt-1 text-red-600">{result.errores.join(' | ')}</div>
          )}
          <button
            onClick={() => {
              setResult(null);
              setDetectado(null);
            }}
            className="mt-2 block text-xs text-gray-500 underline"
          >
            Importar otro archivo
          </button>
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
          ❌ {error}
          <button
            onClick={() => {
              setError(null);
              setDetectado(null);
            }}
            className="mt-2 block text-xs text-red-500 underline"
          >
            Intentar con otro archivo
          </button>
        </div>
      )}
    </div>
  );
}
