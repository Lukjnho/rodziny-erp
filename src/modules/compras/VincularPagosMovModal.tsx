// Modal para vincular un movimiento bancario del extracto a una o varias facturas
// pendientes. Caso típico: 1 transferencia consolidada de $322k que paga 4 facturas
// chicas del mismo proveedor.
//
// Flujo:
//  1) Lucas elige uno o varios gastos pendientes (con buscador por proveedor)
//  2) Al confirmar, por cada gasto seleccionado:
//      - Crea un pagos_gastos con monto=importe_total, numero_operacion=mov.referencia,
//        conciliado_movimiento_id=mov.id, medio_pago según la cuenta del mov
//      - Marca gastos.estado_pago = 'Pagado'
//  3) Vincula movimientos_bancarios.gasto_id al primer gasto seleccionado
//     (para que el panel de Conciliados lo muestre como vinculado)

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatARS, cn } from '@/lib/utils';

interface ProveedorMatch {
  id: string;
  razon_social: string | null;
  nombre_comercial: string | null;
  cuit: string | null;
  score: number;
}

interface CategoriaOpt {
  id: string;
  nombre: string;
  parent_id: string | null;
}

interface MovExtracto {
  id: string;
  fecha: string;
  descripcion: string | null;
  debito: number;
  cuenta: string;
  referencia: string | null;
}

interface GastoPendiente {
  id: string;
  fecha: string;
  proveedor: string | null;
  importe_total: number;
  estado_pago: string | null;
  comentario: string | null;
  nro_comprobante: string | null;
  local: string | null;
}

interface Props {
  mov: MovExtracto;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Mapea la cuenta del movimiento a un valor válido del check constraint
// pagos_gastos.medio_pago.
function medioPagoFromCuenta(cuenta: string): string {
  if (cuenta === 'mercadopago') return 'transferencia_mp';
  if (cuenta === 'galicia') return 'transferencia_galicia';
  if (cuenta === 'icbc') return 'transferencia_icbc';
  return 'otro';
}

// Heurística simple: del "Retiro MP a XXX" o "Transferencia a YYY", extraer un keyword
// para pre-filtrar la búsqueda de proveedor.
function extraerKeywordProveedor(descripcion: string | null): string {
  if (!descripcion) return '';
  // "Retiro MP a Piceda Priscila Magali (Nuevo Banco del Chaco) CUIT 27408713191 Op. 157234954206"
  const match = descripcion.match(/(?:Retiro MP a|Transferencia a|a)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ\s]+?)(?:\s+\(|\s+CUIT|\s+CUIL|\s+Op\.|$)/i);
  if (match) return match[1].trim();
  return '';
}

export function VincularPagosMovModal({ mov, open, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState<string>(() => extraerKeywordProveedor(mov.descripcion));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Proveedor resuelto via tabla `proveedores` (razón social del extracto → nombre comercial del ERP).
  const [proveedorResuelto, setProveedorResuelto] = useState<ProveedorMatch | null>(null);

  // Modo "crear gasto nuevo" — para ECHEQs / regularización ARCA / casos sin factura cargada
  const [modoCrear, setModoCrear] = useState(false);
  const [nuevoCategoria, setNuevoCategoria] = useState<string>('');
  const [nuevoLocal, setNuevoLocal] = useState<'vedia' | 'saavedra' | 'sas'>('sas');
  const [nuevoProveedor, setNuevoProveedor] = useState<string>('');
  const [nuevoComentario, setNuevoComentario] = useState<string>('');

  // Categorías disponibles (para el selector del modo crear)
  const { data: categorias } = useQuery<CategoriaOpt[]>({
    queryKey: ['categorias_para_crear_gasto'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categorias_gasto')
        .select('id, nombre, parent_id')
        .or('activo.is.null,activo.eq.true')
        .order('parent_id', { nullsFirst: true })
        .order('orden', { nullsFirst: true })
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as CategoriaOpt[];
    },
    enabled: open && modoCrear,
  });

  // Cuando se entra al modo crear, precargar comentario y proveedor con datos del mov
  useEffect(() => {
    if (modoCrear) {
      if (!nuevoComentario) setNuevoComentario(mov.descripcion ?? '');
      if (!nuevoProveedor) {
        // Si hubo lookup, usar la razón social del proveedor matcheado;
        // si no, extraer keyword de la descripción
        const fallback = proveedorResuelto?.razon_social ?? extraerKeywordProveedor(mov.descripcion);
        setNuevoProveedor(fallback || '');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoCrear, mov, proveedorResuelto]);

  // Lookup automático: cuando se abre el modal, intenta resolver el proveedor desde la
  // descripción del mov (que tiene la razón social bancaria) usando aliases/CUIT.
  // Si encuentra match, sobreescribe el filtro inicial con el nombre con que está
  // cargado en el ERP (ej: "Mashill Sas" → "FrigoPorc").
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const keyword = extraerKeywordProveedor(mov.descripcion).trim();
    if (!keyword) return;
    (async () => {
      // Buscar por la descripción completa primero (cubre CUIT en la descripción)
      const { data, error } = await supabase.rpc('buscar_proveedor_por_texto', {
        p_texto: mov.descripcion ?? keyword,
      });
      if (cancelled) return;
      if (error) {
        console.warn('[VincularPagosMov] lookup proveedor falló:', error.message);
        return;
      }
      const top = (data as ProveedorMatch[] | null)?.[0];
      if (!top) return;
      setProveedorResuelto(top);
      // Sobreescribir el filtro con el nombre con que está cargado en el ERP
      const nombreERP = top.razon_social ?? top.nombre_comercial ?? '';
      if (nombreERP && nombreERP.toLowerCase() !== busqueda.toLowerCase()) {
        setBusqueda(nombreERP);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mov.id]);

  const { data: gastosPendientes, isLoading } = useQuery<GastoPendiente[]>({
    queryKey: ['gastos_pendientes_para_vincular', busqueda],
    queryFn: async () => {
      // Sin búsqueda → muestra TODAS las pendientes (las 120 más recientes).
      // Con búsqueda → filtra por tokens.
      let q = supabase
        .from('gastos')
        .select('id, fecha, proveedor, importe_total, estado_pago, comentario, nro_comprobante, local')
        .neq('cancelado', true)
        .neq('estado_pago', 'Pagado')
        .order('fecha', { ascending: false })
        .limit(120);
      if (busqueda.trim().length >= 2) {
        // Buscar por TOKENS — si "Mashill Sas" no matchea, probar con "Mashill" sola.
        // Esto cubre casos donde el proveedor del mov tiene sufijos (Sas, SRL, S.A., etc.)
        // que no aparecen en cómo se cargó el gasto en el ERP.
        const tokens = busqueda.trim().split(/\s+/).filter((t) => t.length >= 3);
        if (tokens.length > 0) {
          // OR entre todos los tokens significativos
          const orParts = tokens.map((t) => `proveedor.ilike.%${t}%`).join(',');
          q = q.or(orParts);
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as GastoPendiente[];
    },
    enabled: open,
  });

  function toggle(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sumaSeleccion = useMemo(() => {
    if (!gastosPendientes) return 0;
    return gastosPendientes
      .filter((g) => seleccion.has(g.id))
      .reduce((s, g) => s + Number(g.importe_total), 0);
  }, [gastosPendientes, seleccion]);

  const diferencia = mov.debito - sumaSeleccion;
  const cuadra = Math.abs(diferencia) < 1;

  // Crear un gasto nuevo a partir del mov (caso ECHEQ / regularización ARCA / etc.)
  async function handleCrearGastoNuevo() {
    if (!nuevoCategoria) {
      setError('Elegí una categoría para el gasto.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const cat = categorias?.find((c) => c.id === nuevoCategoria);
      const padre = cat?.parent_id ? categorias?.find((c) => c.id === cat.parent_id) : null;

      const { data: gastoNuevo, error: errInsert } = await supabase
        .from('gastos')
        .insert({
          local: nuevoLocal,
          fecha: mov.fecha,
          categoria_id: nuevoCategoria,
          categoria: padre?.nombre ?? cat?.nombre ?? null,
          subcategoria: padre ? cat?.nombre ?? null : null,
          proveedor: nuevoProveedor.trim() || null,
          importe_total: mov.debito,
          estado_pago: 'Pagado',
          tipo_comprobante: 'recibo',
          comentario: nuevoComentario.trim() || null,
          nro_comprobante: mov.referencia ? `${mov.cuenta.toUpperCase()}-${mov.referencia}` : null,
          creado_por: user?.id ?? 'sistema',
          creado_manual: true,
          cancelado: false,
          periodo: mov.fecha.substring(0, 7),
        })
        .select('id')
        .single();
      if (errInsert) throw errInsert;
      const gastoId = gastoNuevo!.id as string;

      // Pago del gasto vinculado al mov del extracto
      const { error: errPago } = await supabase.from('pagos_gastos').insert({
        gasto_id: gastoId,
        fecha_pago: mov.fecha,
        monto: mov.debito,
        medio_pago: medioPagoFromCuenta(mov.cuenta),
        numero_operacion: mov.referencia ?? null,
        conciliado_movimiento_id: mov.id,
        creado_por: user?.id ?? 'sistema',
        notas: `Creado desde extracto · ${mov.cuenta} · ${mov.descripcion?.slice(0, 80) ?? ''}`,
      });
      if (errPago) throw errPago;

      // Vincular el mov al gasto nuevo
      const { error: errMov } = await supabase
        .from('movimientos_bancarios')
        .update({ gasto_id: gastoId })
        .eq('id', mov.id);
      if (errMov) throw errMov;

      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
      qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });
      qc.invalidateQueries({ queryKey: ['gastos_pendientes_para_vincular'] });

      onSuccess();
      onClose();
    } catch (e: unknown) {
      console.error('[VincularPagosMov] crear gasto error:', e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Error desconocido';
      setError(`Error al crear gasto: ${msg}`);
    } finally {
      setGuardando(false);
    }
  }

  async function handleConfirmar() {
    if (seleccion.size === 0) {
      setError('Seleccioná al menos una factura.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const idsArr = Array.from(seleccion);
      const seleccionados = (gastosPendientes ?? []).filter((g) => seleccion.has(g.id));
      const medio = medioPagoFromCuenta(mov.cuenta);

      // 1) Insertar un pago por cada gasto seleccionado
      const pagos = seleccionados.map((g) => ({
        gasto_id: g.id,
        fecha_pago: mov.fecha,
        monto: g.importe_total,
        medio_pago: medio,
        numero_operacion: mov.referencia ?? null,
        conciliado_movimiento_id: mov.id,
        creado_por: user?.id ?? 'sistema',
        notas: `Pago consolidado · Mov. ${mov.referencia ?? mov.id.slice(0, 8)}`,
      }));
      const { error: errPagos } = await supabase.from('pagos_gastos').insert(pagos);
      if (errPagos) throw errPagos;

      // 2) Marcar gastos como pagados
      const { error: errGastos } = await supabase
        .from('gastos')
        .update({ estado_pago: 'Pagado' })
        .in('id', idsArr);
      if (errGastos) throw errGastos;

      // 3) Vincular el movimiento al primer gasto (para el panel Conciliados)
      const { error: errMov } = await supabase
        .from('movimientos_bancarios')
        .update({ gasto_id: idsArr[0] })
        .eq('id', mov.id);
      if (errMov) throw errMov;

      // 4) Refresh
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      qc.invalidateQueries({ queryKey: ['gastos_listado'] });
      qc.invalidateQueries({ queryKey: ['gastos_conciliados_ids'] });
      qc.invalidateQueries({ queryKey: ['gastos_pendientes_para_vincular'] });
      qc.invalidateQueries({ queryKey: ['gastos_resumen_kpis'] });

      onSuccess();
      onClose();
    } catch (e: unknown) {
      console.error('[VincularPagosMov] error:', e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Error desconocido';
      setError(`Error al guardar: ${msg}`);
    } finally {
      setGuardando(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="border-b border-gray-200 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-gray-900">
                💸 Vincular movimiento a facturas
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Marcá las facturas pendientes que cubre este movimiento del extracto.
                Se van a marcar como pagadas con la misma fecha y N° de operación.
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          {/* Datos del mov */}
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
            <div className="font-medium text-blue-900">{mov.descripcion}</div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-blue-700">
              <span><strong>Fecha:</strong> {mov.fecha}</span>
              <span><strong>Cuenta:</strong> {mov.cuenta}</span>
              <span><strong>Op:</strong> {mov.referencia ?? '—'}</span>
              <span className="ml-auto rounded bg-red-100 px-2 py-0.5 text-sm font-bold text-red-800 tabular-nums">
                {formatARS(mov.debito)}
              </span>
            </div>
          </div>
        </div>

        {/* Toggle de modo: pagar facturas existentes vs crear gasto nuevo */}
        <div className="border-b border-gray-100 px-5 py-2">
          <div className="flex gap-1 rounded-md bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => setModoCrear(false)}
              className={cn(
                'flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors',
                !modoCrear ? 'bg-white text-rodziny-800 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              💸 Pagar facturas existentes
            </button>
            <button
              type="button"
              onClick={() => setModoCrear(true)}
              className={cn(
                'flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors',
                modoCrear ? 'bg-white text-rodziny-800 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              ➕ Crear gasto nuevo
            </button>
          </div>
          {modoCrear && (
            <p className="mt-1 text-[10px] text-gray-500">
              Para casos sin factura cargada (ej: ECHEQ, regularización ARCA, anticipos).
              Crea el gasto y lo marca como pagado con este mov.
            </p>
          )}
        </div>

        {/* Buscador (solo en modo pagar facturas) */}
        <div className={cn('border-b border-gray-100 px-5 py-3', modoCrear && 'hidden')}>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Buscar proveedor:</label>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="ej: piceda, don vitto, sameep..."
              className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-rodziny-500 focus:outline-none"
            />
          </div>
          {proveedorResuelto && (
            <div className="mt-1.5 text-[10px] text-emerald-700">
              🔗 Detectado proveedor <strong>{proveedorResuelto.razon_social}</strong>
              {proveedorResuelto.cuit ? ` (CUIT ${proveedorResuelto.cuit})` : ''}
              {' '}vía {proveedorResuelto.score >= 90 ? 'CUIT' : proveedorResuelto.score >= 70 ? 'alias' : 'razón social'}.
              Filtramos las facturas pendientes por este nombre.
            </div>
          )}
        </div>

        {/* Lista de gastos pendientes (modo pagar) */}
        <div className={cn('flex-1 overflow-y-auto px-5 py-3', modoCrear && 'hidden')}>
          {isLoading ? (
            <div className="py-6 text-center text-xs text-gray-400">Cargando facturas pendientes…</div>
          ) : (gastosPendientes?.length ?? 0) === 0 ? (
            <div className="space-y-2 py-6 text-center text-xs">
              {busqueda.trim().length >= 2 ? (
                <>
                  <div className="text-gray-500">
                    No hay facturas pendientes que coincidan con <strong>"{busqueda}"</strong>.
                  </div>
                  <div className="text-gray-400">
                    Probá con otra palabra (ej: solo el primer nombre del proveedor),
                    o <button
                      type="button"
                      onClick={() => setBusqueda('')}
                      className="text-rodziny-700 underline hover:text-rodziny-900"
                    >ver todas las pendientes</button>.
                  </div>
                  <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
                    💡 Si el gasto no está cargado todavía, cerrá este modal y andá a{' '}
                    <strong>Compras &gt; Gastos &gt; + Nuevo gasto</strong>. Cargalo con monto{' '}
                    <strong className="tabular-nums">{formatARS(mov.debito)}</strong>, fecha{' '}
                    <strong>{mov.fecha}</strong>, y N° de operación <strong className="font-mono">{mov.referencia ?? '—'}</strong>.
                  </div>
                </>
              ) : (
                <div className="text-gray-400">No hay facturas pendientes en este momento.</div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {(gastosPendientes ?? []).map((g) => {
                const sel = seleccion.has(g.id);
                return (
                  <button
                    type="button"
                    key={g.id}
                    onClick={() => toggle(g.id)}
                    className={cn(
                      'w-full rounded-md border p-2.5 text-left text-xs transition-all',
                      sel
                        ? 'border-rodziny-700 bg-rodziny-50 ring-1 ring-rodziny-300'
                        : 'border-gray-200 bg-white hover:bg-gray-50',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={sel} readOnly className="h-4 w-4" />
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-gray-900">{g.proveedor ?? '(sin proveedor)'}</strong>
                          <span className="text-[10px] text-gray-500">{g.fecha}</span>
                          {g.local && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] uppercase text-gray-600">
                              {g.local}
                            </span>
                          )}
                          {g.nro_comprobante && (
                            <span className="font-mono text-[10px] text-gray-400">
                              #{g.nro_comprobante}
                            </span>
                          )}
                        </div>
                        {g.comentario && (
                          <div className="mt-0.5 text-[10px] text-gray-500">
                            {g.comentario.length > 80 ? g.comentario.slice(0, 80) + '…' : g.comentario}
                          </div>
                        )}
                      </div>
                      <strong className="tabular-nums text-red-700">{formatARS(g.importe_total)}</strong>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Form crear gasto nuevo */}
        {modoCrear && (
          <div className="flex-1 overflow-y-auto px-5 py-3">
            <div className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-medium text-gray-700">Categoría *</label>
                <select
                  value={nuevoCategoria}
                  onChange={(e) => setNuevoCategoria(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">— Elegí una categoría —</option>
                  {(() => {
                    const padres = (categorias ?? []).filter((c) => !c.parent_id);
                    return padres.map((p) => (
                      <optgroup key={p.id} label={p.nombre}>
                        <option value={p.id}>{p.nombre} (general)</option>
                        {(categorias ?? [])
                          .filter((c) => c.parent_id === p.id)
                          .map((sub) => (
                            <option key={sub.id} value={sub.id}>
                              {sub.nombre}
                            </option>
                          ))}
                      </optgroup>
                    ));
                  })()}
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-gray-700">Local *</label>
                <div className="flex gap-2">
                  {(['vedia', 'saavedra', 'sas'] as const).map((l) => (
                    <button
                      type="button"
                      key={l}
                      onClick={() => setNuevoLocal(l)}
                      className={cn(
                        'flex-1 rounded border px-2 py-1 text-xs transition-colors',
                        nuevoLocal === l
                          ? 'border-rodziny-700 bg-rodziny-50 text-rodziny-800 font-medium'
                          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      {l === 'sas' ? 'Rodziny S.A.S.' : l === 'vedia' ? 'Vedia' : 'Saavedra'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block font-medium text-gray-700">
                  Proveedor / Concepto
                </label>
                <input
                  type="text"
                  value={nuevoProveedor}
                  onChange={(e) => setNuevoProveedor(e.target.value)}
                  placeholder="ej: ARCA, Banco Galicia, ..."
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-gray-700">Detalle</label>
                <textarea
                  value={nuevoComentario}
                  onChange={(e) => setNuevoComentario(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>

              <div className="rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
                <strong>Datos del mov (no editables):</strong>
                <div className="mt-1 grid grid-cols-2 gap-1 text-gray-600">
                  <div>
                    Importe: <strong className="tabular-nums text-red-700">{formatARS(mov.debito)}</strong>
                  </div>
                  <div>
                    Fecha: <strong>{mov.fecha}</strong>
                  </div>
                  <div>
                    Cuenta: <strong className="uppercase">{mov.cuenta}</strong>
                  </div>
                  <div>
                    N° de op: <strong className="font-mono">{mov.referencia ?? '—'}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer: total seleccionado + acciones */}
        <div className="border-t border-gray-200 bg-gray-50 px-5 py-3">
          {!modoCrear && (
            <div className="mb-2 flex items-center justify-between text-xs">
              <div>
                <span className="text-gray-500">Seleccionadas:</span>{' '}
                <strong>{seleccion.size}</strong>{' '}
                <span className="text-gray-400">·</span>{' '}
                <strong className="tabular-nums">{formatARS(sumaSeleccion)}</strong>
              </div>
              <div
                className={cn(
                  'rounded px-2 py-0.5 font-semibold tabular-nums',
                  cuadra
                    ? 'bg-green-100 text-green-800'
                    : Math.abs(diferencia) < mov.debito * 0.05
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-800',
                )}
                title={
                  cuadra
                    ? 'La suma cuadra exacto con el movimiento'
                    : `Diferencia con el movimiento: ${formatARS(diferencia)}`
                }
              >
                {cuadra ? '✓ cuadra' : `Δ ${formatARS(diferencia)}`}
              </div>
            </div>
          )}

          {error && (
            <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
              ⚠ {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={guardando}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            {modoCrear ? (
              <button
                onClick={handleCrearGastoNuevo}
                disabled={guardando || !nuevoCategoria}
                className="rounded bg-rodziny-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800 disabled:bg-gray-300"
              >
                {guardando ? 'Creando…' : '➕ Crear gasto y conciliar'}
              </button>
            ) : (
              <button
                onClick={handleConfirmar}
                disabled={guardando || seleccion.size === 0}
                className="rounded bg-rodziny-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rodziny-800 disabled:bg-gray-300"
              >
                {guardando ? 'Guardando…' : `✓ Marcar como pagadas (${seleccion.size})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
