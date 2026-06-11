import { useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn, formatARS } from '@/lib/utils';
import { normalizarTexto } from '@/modules/rrhh/utils';

// ── Tipos ──────────────────────────────────────────────────────────────────
interface EmpleadoMin {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
}

interface ReciboOcr {
  empleado_nombre: string | null;
  cuil: string | null;
  periodo: string | null;
  neto: number | null;
  pagina: number | null;
}
interface DatosOcr {
  tipo: 'recibo' | 'vep' | 'desconocido';
  recibos?: ReciboOcr[];
  vep?: {
    impuesto: string | null;
    periodo: string | null;
    vencimiento: string | null;
    monto: number | null;
    numero: string | null;
  } | null;
  descripcion?: string | null;
  confianza?: number;
}

interface ReciboRow {
  id: string;
  empleado_id: string | null;
  cuil_detectado: string | null;
  nombre_detectado: string | null;
  periodo: string | null;
  monto_neto: number | null;
  archivo_path: string;
  created_at: string;
}

type ItemProc = {
  id: string;
  nombre: string;
  estado: 'subiendo' | 'analizando' | 'ok' | 'error';
  resultado?: string;
  tipo?: DatosOcr['tipo'];
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function soloDigitos(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}
// DNI a partir del CUIL (11 dígitos): los 8 del medio, sin ceros a la izquierda.
function dniDeCuil(cuil: string | null): string {
  const d = soloDigitos(cuil);
  if (d.length < 11) return '';
  const medio = d.slice(2, 10);
  const n = Number(medio);
  return Number.isFinite(n) ? String(n) : '';
}
function normDni(dni: string | null): string {
  const n = Number(soloDigitos(dni));
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

async function abrirArchivo(path: string) {
  const { data, error } = await supabase.storage
    .from('correos-contadores')
    .createSignedUrl(path, 300);
  if (!error && data) window.open(data.signedUrl, '_blank');
}

// Categorías de gasto para rutear el VEP a Pagos Fijos (IDs estables).
const CAT_CARGAS = { id: '0ad4dc6c-016a-4146-8b00-38cb5bae797f', nombre: 'Cargas sociales' };
const CAT_IMPUESTOS = { id: '407704c3-9b1a-45c4-92c8-f4f41642e4ac', nombre: 'Impuestos y Tasas' };
const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
// 'YYYY-MM' -> 'Abril 2026'
function mesNombre(periodo: string | null): string {
  if (!periodo) return '';
  const [y, m] = periodo.split('-').map(Number);
  return MESES_ES[(m || 1) - 1] ? `${MESES_ES[(m || 1) - 1]} ${y}` : periodo;
}
function esCargaSocial(imp: string | null | undefined): boolean {
  const s = (imp ?? '').toLowerCase();
  return (
    s.includes('sicoss') || s.includes('931') || s.includes('social') ||
    s.includes('carga') || s.includes('seguridad') || s.includes('sijp')
  );
}

export function IntegracionesPage() {
  const qc = useQueryClient();
  const [items, setItems] = useState<ItemProc[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: empleados } = useQuery({
    queryKey: ['empleados-min-contador'],
    queryFn: async (): Promise<EmpleadoMin[]> => {
      const { data, error } = await supabase
        .from('empleados')
        .select('id, nombre, apellido, dni')
        .eq('activo', true);
      if (error) throw error;
      return data as EmpleadoMin[];
    },
  });

  // Matchea un recibo a un empleado por DNI (desde el CUIL) y, si no, por nombre.
  const matchEmpleado = (r: ReciboOcr): string | null => {
    if (!empleados) return null;
    const dni = dniDeCuil(r.cuil);
    if (dni) {
      const porDni = empleados.find((e) => normDni(e.dni) === dni);
      if (porDni) return porDni.id;
    }
    if (r.empleado_nombre) {
      const q = normalizarTexto(r.empleado_nombre);
      const porNombre = empleados.find((e) => {
        const full = normalizarTexto(`${e.nombre} ${e.apellido}`);
        const inv = normalizarTexto(`${e.apellido} ${e.nombre}`);
        return q.includes(normalizarTexto(e.apellido)) && (full.includes(q) || inv.includes(q) || q.includes(full) || q.includes(inv));
      });
      if (porNombre) return porNombre.id;
    }
    return null;
  };

  async function procesarArchivo(file: File) {
    const itemId = crypto.randomUUID();
    setItems((prev) => [{ id: itemId, nombre: file.name, estado: 'subiendo' }, ...prev]);
    const setItem = (patch: Partial<ItemProc>) =>
      setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));

    try {
      // 1) Subir al bucket
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const mes = new Date().toISOString().slice(0, 7);
      const rand = crypto.randomUUID().slice(0, 8);
      const path = `inbox/${mes}/${Date.now()}_${rand}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('correos-contadores')
        .upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (upErr) throw new Error(`No se pudo subir: ${upErr.message}`);

      // 2) OCR + clasificación
      setItem({ estado: 'analizando' });
      const { data: res, error: ocrErr } = await supabase.functions.invoke<{
        ok: boolean;
        datos?: DatosOcr;
        error?: string;
      }>('ocr-contador-doc', { body: { path } });
      if (ocrErr) throw new Error(ocrErr.message);
      if (!res?.ok || !res.datos) throw new Error(res?.error ?? 'El OCR no devolvió datos.');
      const d = res.datos;

      // 3) Rutear según tipo
      if (d.tipo === 'recibo') {
        const lista = (d.recibos ?? []).filter((r) => r.cuil || r.empleado_nombre);
        if (lista.length === 0) throw new Error('Se detectó un recibo pero no se pudo leer ningún empleado.');

        // Cortar el PDF por empleado: cada recibo se queda con SU hoja (confidencial).
        // Si falla el corte, se cae al PDF completo. Las imágenes no se cortan.
        const paths: (string | null)[] = lista.map(() => null);
        const esPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (esPdf) {
          try {
            const { PDFDocument } = await import('pdf-lib');
            const src = await PDFDocument.load(await file.arrayBuffer());
            const totalPags = src.getPageCount();
            for (let i = 0; i < lista.length; i++) {
              // 1 empleado por página y en orden → mapeo directo; si no, uso la página que dijo el OCR.
              let idx: number | null = null;
              if (lista.length === totalPags) idx = i;
              else if (
                typeof lista[i].pagina === 'number' &&
                lista[i].pagina! >= 1 &&
                lista[i].pagina! <= totalPags
              )
                idx = lista[i].pagina! - 1;
              if (idx === null) continue;

              const nueva = await PDFDocument.create();
              const [pg] = await nueva.copyPages(src, [idx]);
              nueva.addPage(pg);
              const bytes = await nueva.save();
              const rand = crypto.randomUUID().slice(0, 8);
              const pPath = `inbox/${mes}/${Date.now()}_${rand}_emp${i + 1}.pdf`;
              const { error: upE } = await supabase.storage
                .from('correos-contadores')
                .upload(pPath, bytes, { contentType: 'application/pdf' });
              if (!upE) paths[i] = pPath;
            }
          } catch {
            /* si el corte falla, cada recibo queda apuntando al PDF completo */
          }
        }

        const filas = lista.map((r, i) => ({
          empleado_id: matchEmpleado(r),
          cuil_detectado: r.cuil,
          nombre_detectado: r.empleado_nombre,
          periodo: r.periodo,
          monto_neto: r.neto,
          archivo_path: paths[i] ?? path,
        }));
        const { error } = await supabase.from('recibos_sueldo').insert(filas);
        if (error) throw error;

        // Si TODAS las hojas se cortaron bien, borramos el PDF completo para no
        // dejar el lote entero (todos los sueldos) accesible.
        if (paths.every((p) => p !== null)) {
          await supabase.storage.from('correos-contadores').remove([path]);
        }

        const asignados = filas.filter((f) => f.empleado_id).length;
        const sinAsignar = filas.length - asignados;
        setItem({
          estado: 'ok',
          tipo: 'recibo',
          resultado:
            filas.length === 1
              ? asignados
                ? `Recibo de ${lista[0].empleado_nombre ?? 'empleado'} → guardado en su legajo (RRHH → Recibos)`
                : `Recibo de ${lista[0].empleado_nombre ?? 'empleado'} → cargado, falta asignarlo (abajo, en Recibos de sueldo)`
              : `${filas.length} recibos → ${asignados} guardados en su legajo${sinAsignar ? `, ${sinAsignar} sin asignar (abajo)` : ''} · RRHH → Recibos`,
        });
        qc.invalidateQueries({ queryKey: ['recibos_sueldo'] });
      } else if (d.tipo === 'vep') {
        const v = d.vep ?? null;
        const venc = v?.vencimiento ?? null;
        const periodoImp = v?.periodo ?? null;
        // Aparece en el mes de PAGO (vencimiento); el concepto lleva el período del impuesto.
        const periodoPago = venc ? venc.slice(0, 7) : periodoImp ?? new Date().toISOString().slice(0, 7);
        const carga = esCargaSocial(v?.impuesto);
        const cat = carga ? CAT_CARGAS : CAT_IMPUESTOS;
        const concepto = carga
          ? `Pago cargas sociales ${mesNombre(periodoImp)}`.trim()
          : `Pago ${v?.impuesto ?? 'impuesto'} ${mesNombre(periodoImp)}`.trim();
        const { error } = await supabase.from('pagos_fijos').insert({
          periodo: periodoPago,
          concepto,
          categoria: cat.nombre,
          categoria_gasto_id: cat.id,
          monto: v?.monto ?? null,
          fecha_vencimiento: venc,
          comprobante_path: path,
          notas: `VEP ${v?.impuesto ?? ''}${v?.numero ? ` N° ${v.numero}` : ''} · período ${periodoImp ?? '—'}`.trim(),
        });
        if (error) throw error;
        setItem({
          estado: 'ok',
          tipo: 'vep',
          resultado: `VEP ${v?.impuesto ?? ''} → Finanzas → Pagos Fijos (${mesNombre(periodoPago)})${venc ? ` · vence ${venc}` : ''}`,
        });
        qc.invalidateQueries({ queryKey: ['pagos_fijos'] });
        qc.invalidateQueries({ queryKey: ['pagos_alertas_global'] });
      } else {
        setItem({
          estado: 'error',
          tipo: 'desconocido',
          resultado: 'No se reconoció como recibo ni VEP. Revisalo y cargalo a mano.',
        });
      }
    } catch (e) {
      setItem({ estado: 'error', resultado: (e as Error).message });
    }
  }

  function manejarArchivos(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => procesarArchivo(f));
  }

  return (
    <PageContainer title="Documentos del contador">
      <div className="space-y-4">
        {/* ── Guía: cómo funciona (para administración) ── */}
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4">
          <p className="text-sm font-semibold text-blue-900">¿Cómo funciona?</p>
          <p className="mt-0.5 text-xs text-blue-800">
            Arrastrá los PDF que manda el contador (podés soltar varios juntos). El sistema los lee y
            los manda solo a donde corresponde:
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-blue-100 bg-white p-2.5">
              <div className="text-sm font-medium text-gray-800">🧾 Recibo de sueldo</div>
              <div className="mt-0.5 text-[11px] text-gray-600">
                Se guarda en el <span className="font-medium">legajo de cada empleado</span> (lo ves
                en <span className="font-medium">RRHH → Recibos</span> y dentro de cada legajo).
              </div>
            </div>
            <div className="rounded-md border border-blue-100 bg-white p-2.5">
              <div className="text-sm font-medium text-gray-800">🏛️ VEP / impuesto</div>
              <div className="mt-0.5 text-[11px] text-gray-600">
                Entra como pago en <span className="font-medium">Finanzas → Pagos Fijos</span> del mes
                de vencimiento, con <span className="font-medium">aviso de pago</span>.
              </div>
            </div>
            <div className="rounded-md border border-blue-100 bg-white p-2.5">
              <div className="text-sm font-medium text-gray-800">❓ No reconocido</div>
              <div className="mt-0.5 text-[11px] text-gray-600">
                Si es una captura o un documento sin datos, queda marcado en{' '}
                <span className="font-medium">ámbar</span> y se carga a mano.
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-blue-700">
            💡 Por cada archivo vas a ver abajo un cartel que dice <span className="font-medium">qué
            era</span> y <span className="font-medium">a dónde fue</span>. Si subís el mismo dos veces,
            se carga repetido (borralo con la ✕).
          </p>
        </div>

        {/* ── Zona de subida ── */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            manejarArchivos(e.dataTransfer.files);
          }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            arrastrando ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-300',
          )}
        >
          <div className="text-3xl">📥</div>
          <p className="mt-2 text-sm font-medium text-gray-700">
            Arrastrá los PDF acá, o hacé click para elegir
          </p>
          <p className="text-xs text-gray-400">Podés soltar varios a la vez · PDF o imágenes</p>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="hidden"
            onChange={(e) => manejarArchivos(e.target.files)}
          />
        </div>

        {/* ── Lista de procesamiento (sesión actual) ── */}
        {items.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Resultado de la subida
            </p>
            {items.map((it) => (
              <div
                key={it.id}
                className={cn(
                  'flex items-center gap-3 rounded border px-3 py-2 text-xs',
                  it.estado === 'ok'
                    ? 'border-green-200 bg-green-50'
                    : it.estado === 'error'
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-gray-200 bg-white',
                )}
              >
                <span className="text-base">
                  {it.estado === 'ok' ? '✓' : it.estado === 'error' ? '⚠' : '⏳'}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-gray-700">{it.nombre}</span>
                  {it.resultado && <span className="ml-2 text-gray-500">{it.resultado}</span>}
                  {!it.resultado && (
                    <span className="ml-2 text-gray-400">
                      {it.estado === 'subiendo' ? 'Subiendo…' : 'Analizando…'}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Recibos ── */}
        <SeccionRecibos empleados={empleados ?? []} />

        <p className="text-xs text-gray-400">
          Los VEPs detectados se cargan automáticamente en{' '}
          <span className="font-medium">Finanzas → Pagos Fijos</span> (en el mes de su vencimiento),
          con su PDF adjunto y el aviso de pago.
        </p>
      </div>
    </PageContainer>
  );
}

// ─── Recibos ─────────────────────────────────────────────────────────────────
function SeccionRecibos({ empleados }: { empleados: EmpleadoMin[] }) {
  const qc = useQueryClient();
  const { data: recibos } = useQuery({
    queryKey: ['recibos_sueldo'],
    queryFn: async (): Promise<ReciboRow[]> => {
      const { data, error } = await supabase
        .from('recibos_sueldo')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data as ReciboRow[];
    },
  });

  const nombreEmp = useMemo(() => {
    const m = new Map<string, string>();
    empleados.forEach((e) => m.set(e.id, `${e.apellido}, ${e.nombre}`));
    return m;
  }, [empleados]);

  async function asignar(id: string, empleadoId: string) {
    await supabase.from('recibos_sueldo').update({ empleado_id: empleadoId || null }).eq('id', id);
    qc.invalidateQueries({ queryKey: ['recibos_sueldo'] });
  }
  async function borrar(id: string) {
    await supabase.from('recibos_sueldo').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['recibos_sueldo'] });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Recibos de sueldo (→ RRHH)</h3>
      <div className="mt-2 divide-y divide-gray-100">
        {(recibos ?? []).length === 0 && (
          <p className="py-4 text-center text-xs text-gray-400">Todavía no hay recibos cargados.</p>
        )}
        {(recibos ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-xs">
            <div className="min-w-[180px] flex-1">
              {r.empleado_id ? (
                <span className="font-medium text-gray-800">{nombreEmp.get(r.empleado_id) ?? 'Empleado'}</span>
              ) : (
                <select
                  defaultValue=""
                  onChange={(e) => asignar(r.id, e.target.value)}
                  className="rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[11px] text-amber-800"
                >
                  <option value="">⚠ Asignar a… ({r.nombre_detectado ?? 'sin nombre'})</option>
                  {empleados.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.apellido}, {e.nombre}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <span className="text-gray-500">{r.periodo ?? '—'}</span>
            <span className="tabular-nums text-gray-700">{r.monto_neto ? formatARS(r.monto_neto) : '—'}</span>
            <button onClick={() => abrirArchivo(r.archivo_path)} className="text-blue-600 hover:underline">
              ver PDF
            </button>
            <button
              onClick={() => window.confirm('¿Borrar este recibo?') && borrar(r.id)}
              className="text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

