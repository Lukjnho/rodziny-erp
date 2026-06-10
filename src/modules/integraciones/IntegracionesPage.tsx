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

interface VepRow {
  id: string;
  descripcion: string | null;
  impuesto: string | null;
  periodo: string | null;
  vencimiento: string | null;
  monto: number | null;
  archivo_path: string;
  pagado: boolean;
  fecha_pago: string | null;
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

// Urgencia de un VEP según vencimiento (mismo criterio visual que Finanzas)
function urgenciaVep(venc: string | null, pagado: boolean): 'pagado' | 'vencido' | 'hoy' | 'semana' | 'ok' {
  if (pagado) return 'pagado';
  if (!venc) return 'ok';
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const v = new Date(venc + 'T00:00:00');
  const dias = Math.round((v.getTime() - hoy.getTime()) / 86_400_000);
  if (dias < 0) return 'vencido';
  if (dias === 0) return 'hoy';
  if (dias <= 7) return 'semana';
  return 'ok';
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

        const filas = lista.map((r) => ({
          empleado_id: matchEmpleado(r),
          cuil_detectado: r.cuil,
          nombre_detectado: r.empleado_nombre,
          periodo: r.periodo,
          monto_neto: r.neto,
          archivo_path: path,
        }));
        const { error } = await supabase.from('recibos_sueldo').insert(filas);
        if (error) throw error;

        const asignados = filas.filter((f) => f.empleado_id).length;
        const sinAsignar = filas.length - asignados;
        setItem({
          estado: 'ok',
          tipo: 'recibo',
          resultado:
            filas.length === 1
              ? asignados
                ? `Recibo → ${lista[0].empleado_nombre ?? 'empleado'} (RRHH)`
                : `Recibo de ${lista[0].empleado_nombre ?? 'empleado'} — sin asignar, asignalo abajo`
              : `${filas.length} recibos → ${asignados} asignados${sinAsignar ? `, ${sinAsignar} sin asignar (abajo)` : ''} (RRHH)`,
        });
        qc.invalidateQueries({ queryKey: ['recibos_sueldo'] });
      } else if (d.tipo === 'vep') {
        const v = d.vep ?? null;
        const { error } = await supabase.from('veps').insert({
          descripcion: d.descripcion,
          impuesto: v?.impuesto ?? null,
          periodo: v?.periodo ?? null,
          vencimiento: v?.vencimiento ?? null,
          monto: v?.monto ?? null,
          archivo_path: path,
        });
        if (error) throw error;
        setItem({
          estado: 'ok',
          tipo: 'vep',
          resultado: `VEP ${v?.impuesto ?? ''} → Finanzas${v?.vencimiento ? ` · vence ${v.vencimiento}` : ''}`,
        });
        qc.invalidateQueries({ queryKey: ['veps'] });
        qc.invalidateQueries({ queryKey: ['veps_alertas'] });
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
        <p className="text-sm text-gray-500">
          Arrastrá acá los recibos de sueldo y VEPs que te manda el contador. El sistema detecta solo
          qué es cada uno: los <span className="font-medium">recibos</span> van al legajo del empleado
          (RRHH) y los <span className="font-medium">VEPs</span> a Finanzas con alerta de vencimiento.
        </p>

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

        {/* ── VEPs ── */}
        <SeccionVeps />
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

// ─── VEPs ────────────────────────────────────────────────────────────────────
function SeccionVeps() {
  const qc = useQueryClient();
  const { data: veps } = useQuery({
    queryKey: ['veps'],
    queryFn: async (): Promise<VepRow[]> => {
      const { data, error } = await supabase
        .from('veps')
        .select('*')
        .order('vencimiento', { ascending: true, nullsFirst: false })
        .limit(60);
      if (error) throw error;
      return data as VepRow[];
    },
  });

  async function togglePagado(v: VepRow) {
    await supabase
      .from('veps')
      .update({
        pagado: !v.pagado,
        fecha_pago: !v.pagado ? new Date().toISOString().slice(0, 10) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', v.id);
    qc.invalidateQueries({ queryKey: ['veps'] });
    qc.invalidateQueries({ queryKey: ['veps_alertas'] });
  }
  async function borrar(id: string) {
    await supabase.from('veps').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['veps'] });
    qc.invalidateQueries({ queryKey: ['veps_alertas'] });
  }

  const colorUrg: Record<string, string> = {
    vencido: 'bg-red-100 text-red-700',
    hoy: 'bg-red-50 text-red-600',
    semana: 'bg-amber-100 text-amber-700',
    ok: 'bg-gray-100 text-gray-500',
    pagado: 'bg-green-100 text-green-700',
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">VEPs a pagar (→ Finanzas)</h3>
      <div className="mt-2 divide-y divide-gray-100">
        {(veps ?? []).length === 0 && (
          <p className="py-4 text-center text-xs text-gray-400">Todavía no hay VEPs cargados.</p>
        )}
        {(veps ?? []).map((v) => {
          const urg = urgenciaVep(v.vencimiento, v.pagado);
          return (
            <div key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-xs">
              <span className="min-w-[140px] flex-1 font-medium text-gray-800">
                {v.impuesto ?? v.descripcion ?? 'VEP'}
              </span>
              <span className="text-gray-500">{v.periodo ?? '—'}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', colorUrg[urg])}>
                {v.pagado ? 'Pagado' : v.vencimiento ? `Vence ${v.vencimiento}` : 'Sin vto.'}
              </span>
              <span className="tabular-nums text-gray-700">{v.monto ? formatARS(v.monto) : '—'}</span>
              <button onClick={() => abrirArchivo(v.archivo_path)} className="text-blue-600 hover:underline">
                ver PDF
              </button>
              <button
                onClick={() => togglePagado(v)}
                className={cn(
                  'rounded px-2 py-0.5 text-[10px] font-medium',
                  v.pagado
                    ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    : 'bg-green-600 text-white hover:bg-green-700',
                )}
              >
                {v.pagado ? 'Desmarcar' : 'Marcar pagado'}
              </button>
              <button
                onClick={() => window.confirm('¿Borrar este VEP?') && borrar(v.id)}
                className="text-gray-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
