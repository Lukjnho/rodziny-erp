import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { KPICard } from '@/components/ui/KPICard';
import type { Empleado } from './RRHHPage';
import { ymd, parseYmd, MESES, normalizarTexto } from './utils';

type FiltroLocal = 'todos' | 'vedia' | 'saavedra';
type EstadoVac = 'pendiente' | 'aprobada' | 'tomada' | 'rechazada';

interface Vacacion {
  id: string;
  empleado_id: string;
  fecha_desde: string;
  fecha_hasta: string;
  dias_corridos: number;
  anio_correspondiente: number;
  estado: EstadoVac;
  motivo: string | null;
  aprobado_por: string | null;
  notas: string | null;
  created_at: string;
}

interface Cronograma {
  empleado_id: string;
  fecha: string;
  hora_entrada: string | null;
  es_franco: boolean;
  publicado: boolean;
}

interface Fichada {
  empleado_id: string;
  fecha: string;
  tipo: 'entrada' | 'salida';
  minutos_diferencia: number | null;
}

// ── Reglas LCT ────────────────────────────────────────────────────────────────
function diasPorAntiguedad(años: number): number {
  if (años < 1) return 0; // Política Rodziny: no se otorgan antes del año
  if (años < 5) return 14;
  if (años < 10) return 21;
  if (años < 20) return 28;
  return 35;
}

function calcularAntiguedadAños(fechaIngreso: string, referencia: Date = new Date()): number {
  const ing = parseYmd(fechaIngreso);
  const diff = referencia.getTime() - ing.getTime();
  return diff / (1000 * 60 * 60 * 24 * 365.25);
}

function diasEntreFechas(desde: string, hasta: string): number {
  const d1 = parseYmd(desde);
  const d2 = parseYmd(hasta);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function sumarDiasYmd(fecha: string, dias: number): string {
  const d = parseYmd(fecha);
  d.setDate(d.getDate() + dias - 1); // inclusivo
  return ymd(d);
}

function estaEnTemporadaBaja(fechaDesde: string, fechaHasta: string): boolean {
  // Temporada Rodziny: noviembre (10) → febrero (1)
  const mDesde = parseYmd(fechaDesde).getMonth();
  const mHasta = parseYmd(fechaHasta).getMonth();
  const enTemp = (m: number) => m === 10 || m === 11 || m === 0 || m === 1;
  return enTemp(mDesde) && enTemp(mHasta);
}

// ── Score (asistencia + puntualidad últimos 90 días) ─────────────────────────
function calcularScore(empleadoId: string, cronograma: Cronograma[], fichadas: Fichada[]): number {
  const hoy = new Date();
  const hace90 = new Date();
  hace90.setDate(hoy.getDate() - 90);
  const desde = ymd(hace90);
  const hasta = ymd(hoy);

  const crono = cronograma.filter(
    (c) =>
      c.empleado_id === empleadoId &&
      c.fecha >= desde &&
      c.fecha <= hasta &&
      c.publicado &&
      !c.es_franco &&
      c.hora_entrada,
  );
  if (crono.length < 5) return 0;

  const fichSet = new Set(
    fichadas
      .filter((f) => f.empleado_id === empleadoId && f.tipo === 'entrada')
      .map((f) => f.fecha),
  );

  let asistidos = 0;
  let tardanzas = 0;
  let puntuales = 0;
  for (const c of crono) {
    if (!fichSet.has(c.fecha)) continue;
    asistidos++;
    const entrada = fichadas.find(
      (f) => f.empleado_id === empleadoId && f.fecha === c.fecha && f.tipo === 'entrada',
    );
    if (entrada && entrada.minutos_diferencia !== null && entrada.minutos_diferencia > 10)
      tardanzas++;
    else puntuales++;
  }

  const pctAsistencia = (asistidos / crono.length) * 100;
  const pctPuntual = asistidos > 0 ? (puntuales / asistidos) * 100 : 0;
  // 60% asistencia, 40% puntualidad
  return Math.round(pctAsistencia * 0.6 + pctPuntual * 0.4);
}

// ── Componente principal ──────────────────────────────────────────────────────
export function VacacionesTab() {
  const qc = useQueryClient();
  const { perfil } = useAuth();
  const hoy = new Date();
  const [año, setAño] = useState(hoy.getFullYear());
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [modalEmpleado, setModalEmpleado] = useState<Empleado | null>(null);
  const [editVacacion, setEditVacacion] = useState<Vacacion | null>(null);

  const { data: empleados } = useQuery({
    queryKey: ['empleados'],
    queryFn: async () => {
      const { data, error } = await supabase.from('empleados').select('*').order('apellido');
      if (error) throw error;
      return data as Empleado[];
    },
  });

  const { data: vacaciones } = useQuery({
    queryKey: ['vacaciones', año],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vacaciones')
        .select('*')
        .eq('anio_correspondiente', año)
        .order('fecha_desde', { ascending: false });
      if (error) throw error;
      return data as Vacacion[];
    },
  });

  // Score data (últimos 90 días)
  const { data: cronograma90 } = useQuery({
    queryKey: ['cronograma-score-90'],
    queryFn: async () => {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      const { data, error } = await supabase
        .from('cronograma')
        .select('empleado_id, fecha, hora_entrada, es_franco, publicado')
        .gte('fecha', ymd(d));
      if (error) throw error;
      return data as Cronograma[];
    },
  });

  const { data: fichadas90 } = useQuery({
    queryKey: ['fichadas-score-90'],
    queryFn: async () => {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      const { data, error } = await supabase
        .from('fichadas')
        .select('empleado_id, fecha, tipo, minutos_diferencia')
        .gte('fecha', ymd(d));
      if (error) throw error;
      return data as Fichada[];
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: async ({ id, estado }: { id: string; estado: EstadoVac }) => {
      const patch: Partial<Vacacion> = {
        estado,
        aprobado_por:
          estado === 'aprobada' || estado === 'rechazada' ? perfil?.nombre || null : null,
      };
      const { error } = await supabase
        .from('vacaciones')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vacaciones'] }),
    onError: (e: Error) => window.alert(`Error: ${e.message}`),
  });

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('vacaciones').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vacaciones'] }),
    onError: (e: Error) => window.alert(`Error: ${e.message}`),
  });

  const cargando = !empleados || !vacaciones || !cronograma90 || !fichadas90;

  // Armar filas por empleado
  const filas = useMemo(() => {
    if (!empleados || !vacaciones || !cronograma90 || !fichadas90) return [];
    const activos = empleados.filter((e) => e.activo && e.estado_laboral !== 'baja');
    const filtrados = activos.filter((e) => {
      if (filtroLocal === 'vedia' && !(e.local === 'vedia' || e.local === 'ambos')) return false;
      if (filtroLocal === 'saavedra' && !(e.local === 'saavedra' || e.local === 'ambos'))
        return false;
      if (busqueda.trim()) {
        const q = normalizarTexto(busqueda);
        const txt = normalizarTexto(`${e.nombre} ${e.apellido} ${e.dni ?? ''}`);
        if (!txt.includes(q)) return false;
      }
      return true;
    });

    return filtrados
      .map((emp) => {
        const antAños = calcularAntiguedadAños(emp.fecha_ingreso);
        const elegible = antAños >= 1;
        const diasCorresponden = diasPorAntiguedad(antAños);
        const vacsEmp = vacaciones.filter((v) => v.empleado_id === emp.id);
        const diasTomados = vacsEmp
          .filter((v) => v.estado === 'aprobada' || v.estado === 'tomada')
          .reduce((s, v) => s + v.dias_corridos, 0);
        const diasPendientes = vacsEmp
          .filter((v) => v.estado === 'pendiente')
          .reduce((s, v) => s + v.dias_corridos, 0);
        const saldo = Math.max(0, diasCorresponden - diasTomados);
        const score = calcularScore(emp.id, cronograma90, fichadas90);
        return {
          empleado: emp,
          antAños,
          elegible,
          diasCorresponden,
          diasTomados,
          diasPendientes,
          saldo,
          score,
          vacaciones: vacsEmp,
        };
      })
      .sort((a, b) => b.score - a.score); // score descendente = mejores primero
  }, [empleados, vacaciones, cronograma90, fichadas90, filtroLocal, busqueda]);

  const kpis = useMemo(() => {
    const elegibles = filas.filter((f) => f.elegible);
    const diasAOtorgar = elegibles.reduce((s, f) => s + f.diasCorresponden, 0);
    const diasTomados = elegibles.reduce((s, f) => s + f.diasTomados, 0);
    const pendientes = (vacaciones ?? []).filter((v) => v.estado === 'pendiente').length;
    const sinTomar = elegibles.filter((f) => f.saldo > 0 && f.diasTomados === 0).length;
    return { elegibles: elegibles.length, diasAOtorgar, diasTomados, pendientes, sinTomar };
  }, [filas, vacaciones]);

  const pendientes = (vacaciones ?? []).filter((v) => v.estado === 'pendiente');

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KPICard label="Elegibles" value={String(kpis.elegibles)} color="blue" loading={cargando} />
        <KPICard
          label="Días a otorgar"
          value={String(kpis.diasAOtorgar)}
          color="neutral"
          loading={cargando}
        />
        <KPICard
          label="Días tomados"
          value={String(kpis.diasTomados)}
          color="green"
          loading={cargando}
        />
        <KPICard
          label="Pendientes aprobación"
          value={String(kpis.pendientes)}
          color={kpis.pendientes > 0 ? 'yellow' : 'neutral'}
          loading={cargando}
        />
        <KPICard
          label="Sin tomar aún"
          value={String(kpis.sinTomar)}
          color={kpis.sinTomar > 0 ? 'yellow' : 'green'}
          loading={cargando}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-white p-3">
        <input
          type="text"
          placeholder="Buscar empleado..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="min-w-[200px] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select
          value={año}
          onChange={(e) => setAño(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          {[hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>
              Año {y}
            </option>
          ))}
        </select>
        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
      </div>

      {/* Solicitudes pendientes de aprobación */}
      {pendientes.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
          <div className="mb-2 text-sm font-semibold text-yellow-900">
            ⏳ Solicitudes pendientes de aprobación ({pendientes.length})
          </div>
          <div className="space-y-2">
            {pendientes.map((v) => {
              const emp = empleados?.find((e) => e.id === v.empleado_id);
              if (!emp) return null;
              const fueraTemporada = !estaEnTemporadaBaja(v.fecha_desde, v.fecha_hasta);
              return (
                <div
                  key={v.id}
                  className="flex items-center gap-3 rounded bg-white px-3 py-2 text-sm"
                >
                  <div className="flex-1">
                    <span className="font-medium text-gray-900">
                      {emp.apellido}, {emp.nombre}
                    </span>
                    <span className="ml-2 text-gray-500">
                      {formatearRango(v.fecha_desde, v.fecha_hasta)} · {v.dias_corridos} días
                    </span>
                    {fueraTemporada && (
                      <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] text-orange-700">
                        fuera de temporada
                      </span>
                    )}
                    {v.motivo && <div className="mt-0.5 text-xs text-gray-400">{v.motivo}</div>}
                  </div>
                  <button
                    onClick={() => cambiarEstado.mutate({ id: v.id, estado: 'aprobada' })}
                    className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                  >
                    Aprobar
                  </button>
                  <button
                    onClick={() => cambiarEstado.mutate({ id: v.id, estado: 'rechazada' })}
                    className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                  >
                    Rechazar
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabla principal */}
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Empleado</th>
              <th className="px-2 py-2 text-center">Score</th>
              <th className="px-2 py-2 text-center">Antigüedad</th>
              <th className="px-2 py-2 text-center">Corresponden</th>
              <th className="px-2 py-2 text-center">Tomados</th>
              <th className="px-2 py-2 text-center">Pendientes</th>
              <th className="px-2 py-2 text-center">Saldo</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!cargando && filas.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-400">
                  Sin empleados
                </td>
              </tr>
            )}
            {filas.map((f, idx) => (
              <tr
                key={f.empleado.id}
                className={cn(
                  'border-t border-gray-100 hover:bg-gray-50',
                  !f.elegible && 'opacity-50',
                )}
              >
                <td className="px-4 py-2">
                  <div className="font-medium text-gray-900">
                    {idx < 3 && f.score >= 80 && (
                      <span className="mr-1">{['🥇', '🥈', '🥉'][idx]}</span>
                    )}
                    {f.empleado.apellido}, {f.empleado.nombre}
                  </div>
                  <div className="text-[11px] capitalize text-gray-400">
                    {f.empleado.puesto} · {f.empleado.local}
                  </div>
                </td>
                <td className="px-2 py-2 text-center">
                  {f.score > 0 ? (
                    <span
                      className={cn(
                        'rounded px-2 py-0.5 text-xs font-semibold',
                        f.score >= 90
                          ? 'bg-green-100 text-green-700'
                          : f.score >= 75
                            ? 'bg-blue-100 text-blue-700'
                            : f.score >= 60
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700',
                      )}
                    >
                      {f.score}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-400">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-center text-xs text-gray-600">
                  {f.antAños >= 1
                    ? `${Math.floor(f.antAños)} año${Math.floor(f.antAños) !== 1 ? 's' : ''}`
                    : `${Math.floor(f.antAños * 12)} meses`}
                </td>
                <td className="px-2 py-2 text-center font-medium text-gray-700">
                  {f.diasCorresponden}
                </td>
                <td className="px-2 py-2 text-center text-gray-600">{f.diasTomados}</td>
                <td className="px-2 py-2 text-center text-gray-600">{f.diasPendientes || '—'}</td>
                <td className="px-2 py-2 text-center">
                  <span
                    className={cn(
                      'font-semibold',
                      f.saldo === 0
                        ? 'text-gray-400'
                        : f.saldo <= 7
                          ? 'text-yellow-600'
                          : 'text-green-600',
                    )}
                  >
                    {f.saldo}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  {f.elegible ? (
                    <button
                      onClick={() => setModalEmpleado(f.empleado)}
                      className="rounded bg-rodziny-600 px-2 py-1 text-xs text-white hover:bg-rodziny-700"
                    >
                      + Vacaciones
                    </button>
                  ) : (
                    <span className="text-[10px] text-gray-400">no elegible</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Histórico del año */}
      {vacaciones && vacaciones.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
          <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">
            Histórico {año}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Empleado</th>
                <th className="px-2 py-2 text-left">Período</th>
                <th className="px-2 py-2 text-center">Días</th>
                <th className="px-2 py-2 text-center">Estado</th>
                <th className="px-2 py-2 text-left">Motivo</th>
                <th className="px-4 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {vacaciones.map((v) => {
                const emp = empleados?.find((e) => e.id === v.empleado_id);
                if (!emp) return null;
                return (
                  <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-900">
                      {emp.apellido}, {emp.nombre}
                    </td>
                    <td className="px-2 py-2 text-gray-600">
                      {formatearRango(v.fecha_desde, v.fecha_hasta)}
                    </td>
                    <td className="px-2 py-2 text-center">{v.dias_corridos}</td>
                    <td className="px-2 py-2 text-center">
                      <BadgeEstado estado={v.estado} />
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-500">{v.motivo || '—'}</td>
                    <td className="space-x-1 px-4 py-2 text-right">
                      {v.estado === 'aprobada' && (
                        <button
                          onClick={() => cambiarEstado.mutate({ id: v.id, estado: 'tomada' })}
                          className="rounded bg-blue-600 px-2 py-1 text-[10px] text-white hover:bg-blue-700"
                        >
                          Marcar tomada
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const emp2 = empleados?.find((e) => e.id === v.empleado_id);
                          if (emp2) {
                            setModalEmpleado(emp2);
                            setEditVacacion(v);
                          }
                        }}
                        className="text-[10px] text-rodziny-600 hover:text-rodziny-800"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('¿Eliminar esta solicitud?')) eliminar.mutate(v.id);
                        }}
                        className="text-[10px] text-red-500 hover:text-red-700"
                      >
                        Borrar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalEmpleado && (
        <ModalVacacion
          empleado={modalEmpleado}
          año={año}
          vacacionEdit={editVacacion}
          onClose={() => {
            setModalEmpleado(null);
            setEditVacacion(null);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['vacaciones'] });
            setModalEmpleado(null);
            setEditVacacion(null);
          }}
        />
      )}
    </div>
  );
}

// ── Modal solicitud ──────────────────────────────────────────────────────────
function ModalVacacion({
  empleado,
  año,
  vacacionEdit,
  onClose,
  onSaved,
}: {
  empleado: Empleado;
  año: number;
  vacacionEdit: Vacacion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fechaDesde, setFechaDesde] = useState(vacacionEdit?.fecha_desde ?? '');
  const [dias, setDias] = useState(vacacionEdit?.dias_corridos ?? 14);
  const [estado, setEstado] = useState<EstadoVac>(vacacionEdit?.estado ?? 'pendiente');
  const [motivo, setMotivo] = useState(vacacionEdit?.motivo ?? '');
  const [notas, setNotas] = useState(vacacionEdit?.notas ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fechaHasta = fechaDesde && dias > 0 ? sumarDiasYmd(fechaDesde, dias) : '';
  const fueraTemporada =
    fechaDesde && fechaHasta ? !estaEnTemporadaBaja(fechaDesde, fechaHasta) : false;

  async function guardar() {
    setError(null);
    if (!fechaDesde) {
      setError('Elegí la fecha de inicio.');
      return;
    }
    if (dias < 1) {
      setError('Mínimo 1 día.');
      return;
    }
    setGuardando(true);
    try {
      const payload = {
        empleado_id: empleado.id,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        dias_corridos: dias,
        anio_correspondiente: año,
        estado,
        motivo: motivo || null,
        notas: notas || null,
        updated_at: new Date().toISOString(),
      };
      if (vacacionEdit) {
        const { error } = await supabase
          .from('vacaciones')
          .update(payload)
          .eq('id', vacacionEdit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('vacaciones').insert(payload);
        if (error) throw error;
      }
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Error al guardar.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="font-semibold text-gray-900">
            {vacacionEdit ? 'Editar vacaciones' : 'Cargar vacaciones'}
          </h3>
          <div className="mt-0.5 text-xs text-gray-500">
            {empleado.apellido}, {empleado.nombre}
          </div>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Fecha de inicio *
            </label>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Días corridos *</label>
            <input
              type="number"
              min={1}
              max={35}
              value={dias}
              onChange={(e) => setDias(Number(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
          {fechaHasta && (
            <div className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Período: <span className="font-medium">{formatearRango(fechaDesde, fechaHasta)}</span>
              {fueraTemporada && (
                <div className="mt-1 text-orange-600">
                  ⚠ Fuera de temporada baja (Nov–Feb). Igual se puede cargar.
                </div>
              )}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Estado</label>
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoVac)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="pendiente">Pendiente aprobación</option>
              <option value="aprobada">Aprobada</option>
              <option value="tomada">Tomada</option>
              <option value="rechazada">Rechazada</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Motivo / Comentario
            </label>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              placeholder="Opcional"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Notas internas</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
          {error && <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded bg-rodziny-600 px-4 py-1.5 text-sm text-white hover:bg-rodziny-700 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers UI ────────────────────────────────────────────────────────────────
function formatearRango(desde: string, hasta: string): string {
  const d1 = parseYmd(desde);
  const d2 = parseYmd(hasta);
  return `${d1.getDate()} ${MESES[d1.getMonth()].slice(0, 3)} → ${d2.getDate()} ${MESES[d2.getMonth()].slice(0, 3)}`;
}

function BadgeEstado({ estado }: { estado: EstadoVac }) {
  const config = {
    pendiente: { bg: 'bg-yellow-100', fg: 'text-yellow-700', label: 'Pendiente' },
    aprobada: { bg: 'bg-blue-100', fg: 'text-blue-700', label: 'Aprobada' },
    tomada: { bg: 'bg-green-100', fg: 'text-green-700', label: 'Tomada' },
    rechazada: { bg: 'bg-red-100', fg: 'text-red-700', label: 'Rechazada' },
  }[estado];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${config.bg} ${config.fg}`}>
      {config.label}
    </span>
  );
}

// Silencia warning de import no usado si alguna función deja de usarse
void diasEntreFechas;
