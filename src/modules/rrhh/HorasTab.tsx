import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Empleado } from './RRHHPage';
import {
  MESES,
  ymd,
  sumHorasTurnos,
  etiquetaDia,
  normalizarTexto,
  ultimoDiaDelMes,
  type Quincena,
  type TurnoCrono,
} from './utils';

type PeriodoTipo = 'mes' | 'quincena';
type FiltroLocal = 'todos' | 'vedia' | 'saavedra';

interface Cronograma {
  empleado_id: string;
  fecha: string;
  hora_entrada: string | null;
  hora_salida: string | null;
  turnos: TurnoCrono[] | null;
  es_franco: boolean;
  publicado: boolean;
}

interface Fichada {
  empleado_id: string;
  fecha: string;
  tipo: 'entrada' | 'salida';
  timestamp: string;
}

interface DiaDetalle {
  fecha: string;
  programado: boolean;
  esFranco: boolean;
  horarioTexto: string; // "08:00–16:00" o "11–15 · 20–00:30" o "—"
  fichajeTexto: string; // "08:05–15:55" o "Sin fichar" o "Solo entrada"
  horasTeoricas: number;
  horasReales: number;
  diferencia: number; // real - teórica
}

interface ResumenEmpleado {
  empleado: Empleado;
  diasProgramados: number;
  horasTeoricas: number;
  horasReales: number;
  diferencia: number;
  diasConDiscrepancia: number; // |dif| > 0.5h en días programados
  dias: DiaDetalle[];
}

const UMBRAL_DISCREPANCIA = 0.5; // horas — diferencia significativa por día
const MAX_HORAS_TRAMO = 16; // un par entrada→salida con diff > esto se considera salida no fichada

// Pares entrada/salida ordenados cronológicamente. Si quedan impares no suman.
// Si un par excede MAX_HORAS_TRAMO, asume que el empleado se olvidó de fichar la
// salida y al día siguiente cerró tarde — no suma esas horas falsas.
function calcularHorasReales(fichadasDia: Fichada[]): { horas: number; texto: string } {
  if (fichadasDia.length === 0) return { horas: 0, texto: 'Sin fichar' };
  const ordenadas = [...fichadasDia].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  let horas = 0;
  const tramos: string[] = [];
  let i = 0;
  while (i < ordenadas.length) {
    const f = ordenadas[i];
    if (f.tipo !== 'entrada') {
      i++;
      continue;
    }
    const next = ordenadas[i + 1];
    if (next && next.tipo === 'salida') {
      const t1 = new Date(f.timestamp);
      const t2 = new Date(next.timestamp);
      const horasTramo = Math.max(0, (t2.getTime() - t1.getTime()) / 3600000);
      if (horasTramo > MAX_HORAS_TRAMO) {
        // Salida fichada al día siguiente — turno sin cierre real
        tramos.push(`${hhmmFromTs(f.timestamp)}–⚠ sin salida`);
      } else {
        horas += horasTramo;
        tramos.push(`${hhmmFromTs(f.timestamp)}–${hhmmFromTs(next.timestamp)}`);
      }
      i += 2;
    } else {
      tramos.push(`${hhmmFromTs(f.timestamp)}–?`);
      i++;
    }
  }
  if (tramos.length === 0) {
    return { horas: 0, texto: 'Fichaje incompleto' };
  }
  return { horas, texto: tramos.join(' · ') };
}

function hhmmFromTs(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function horarioTexto(c: Cronograma | undefined): string {
  if (!c) return '—';
  if (c.es_franco) return 'Franco';
  if (c.turnos && c.turnos.length > 0) {
    return c.turnos.map((t) => `${t.entrada}–${t.salida}`).join(' · ');
  }
  if (c.hora_entrada && c.hora_salida) return `${c.hora_entrada}–${c.hora_salida}`;
  return '—';
}

function formatHoras(h: number): string {
  const signo = h < 0 ? '−' : '';
  const abs = Math.abs(h);
  const horas = Math.floor(abs);
  const mins = Math.round((abs - horas) * 60);
  if (mins === 0) return `${signo}${horas}h`;
  return `${signo}${horas}h${String(mins).padStart(2, '0')}`;
}

export function HorasTab() {
  const hoy = new Date();
  // Estado inicial según hoy. Como el último día del mes (día de pago) pertenece
  // a la Q1 del mes siguiente, ese día arrancamos directamente en el mes próximo.
  const estadoInicial = (() => {
    const d = hoy.getDate();
    const esDiaDePago = d === ultimoDiaDelMes(hoy.getFullYear(), hoy.getMonth());
    if (esDiaDePago) {
      const next = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
      return { year: next.getFullYear(), month: next.getMonth(), quincena: 'q1' as Quincena };
    }
    return {
      year: hoy.getFullYear(),
      month: hoy.getMonth(),
      quincena: (d <= 14 ? 'q1' : 'q2') as Quincena,
    };
  })();
  const [year, setYear] = useState(estadoInicial.year);
  const [month, setMonth] = useState(estadoInicial.month);
  const [periodoTipo, setPeriodoTipo] = useState<PeriodoTipo>('quincena');
  const [quincena, setQuincena] = useState<Quincena>(estadoInicial.quincena);
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [soloConDiferencia, setSoloConDiferencia] = useState(false);

  const { fechaDesde, fechaHasta, labelPeriodo, todosDias } = useMemo(() => {
    const ultimoDia = ultimoDiaDelMes(year, month);
    // Modelo de pago: se paga el 15 y el último día del mes. Cada quincena CIERRA
    // un día antes del pago (el 14 y el 29/30). El último día del mes (día de pago)
    // rueda a la Q1 del mes siguiente para no perder horas trabajadas.
    //   Q1: último día del mes anterior → 14   (cierra 14, paga 15)
    //   Q2: 15 → anteúltimo del mes (29/30)     (cierra 29/30, paga 30/31)
    let dFrom: Date, dTo: Date, label: string;
    if (periodoTipo === 'mes') {
      // Mes = ambas quincenas: del último día del mes anterior al anteúltimo de este.
      dFrom = new Date(year, month, 0);
      dTo = new Date(year, month, ultimoDia - 1);
      label = `${MESES[month]} ${year}`;
    } else if (quincena === 'q1') {
      dFrom = new Date(year, month, 0); // último día del mes anterior (día de pago que rodó)
      dTo = new Date(year, month, 14); // cierra el 14, se paga el 15
      label = `${MESES[month]} ${year} · Q1 (al 14)`;
    } else {
      dFrom = new Date(year, month, 15);
      dTo = new Date(year, month, ultimoDia - 1); // cierra el 29/30, se paga el 30/31
      label = `${MESES[month]} ${year} · Q2 (15 al ${ultimoDia - 1})`;
    }
    const out: string[] = [];
    for (let d = new Date(dFrom); d <= dTo; d.setDate(d.getDate() + 1)) out.push(ymd(d));
    return { fechaDesde: ymd(dFrom), fechaHasta: ymd(dTo), labelPeriodo: label, todosDias: out };
  }, [year, month, periodoTipo, quincena]);

  const { data: empleados } = useQuery({
    // Trae TODOS los empleados. Key propia para no chocar con los tabs que filtran activos.
    queryKey: ['empleados', 'todos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('empleados').select('*').order('apellido');
      if (error) throw error;
      return data as Empleado[];
    },
  });

  const { data: cronograma } = useQuery({
    queryKey: ['cronograma-horas', fechaDesde, fechaHasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cronograma')
        .select('empleado_id, fecha, hora_entrada, hora_salida, turnos, es_franco, publicado')
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta);
      if (error) throw error;
      return data as Cronograma[];
    },
  });

  const { data: fichadas } = useQuery({
    queryKey: ['fichadas-horas', fechaDesde, fechaHasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fichadas')
        .select('empleado_id, fecha, tipo, timestamp')
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta);
      if (error) throw error;
      return data as Fichada[];
    },
  });

  const cargando = !empleados || !cronograma || !fichadas;

  const resumenes = useMemo<ResumenEmpleado[]>(() => {
    if (!empleados || !cronograma || !fichadas) return [];
    const activos = empleados.filter((e) => e.activo && e.estado_laboral !== 'baja');
    const filtrados = activos.filter((e) => {
      if (filtroLocal !== 'todos' && e.local !== filtroLocal) return false;
      if (busqueda.trim()) {
        const q = normalizarTexto(busqueda);
        const txt = normalizarTexto(`${e.nombre} ${e.apellido} ${e.puesto}`);
        if (!txt.includes(q)) return false;
      }
      return true;
    });

    return filtrados.map((emp) => {
      const cronoPorFecha = new Map<string, Cronograma>();
      for (const c of cronograma) {
        if (c.empleado_id === emp.id) cronoPorFecha.set(c.fecha, c);
      }
      const fichadasPorFecha = new Map<string, Fichada[]>();
      for (const f of fichadas) {
        if (f.empleado_id !== emp.id) continue;
        const arr = fichadasPorFecha.get(f.fecha) ?? [];
        arr.push(f);
        fichadasPorFecha.set(f.fecha, arr);
      }

      const dias: DiaDetalle[] = todosDias.map((fecha) => {
        const c = cronoPorFecha.get(fecha);
        const fichasDia = fichadasPorFecha.get(fecha) ?? [];
        const programado = !!(c && c.publicado && !c.es_franco);
        const esFranco = !!(c && c.es_franco);

        let horasTeoricas = 0;
        if (programado) {
          horasTeoricas = sumHorasTurnos(c!.turnos, c!.hora_entrada, c!.hora_salida);
        }

        const { horas: horasReales, texto: fichajeTexto } = calcularHorasReales(fichasDia);

        return {
          fecha,
          programado,
          esFranco,
          horarioTexto: horarioTexto(c),
          fichajeTexto: fichasDia.length === 0 ? (programado ? 'Sin fichar' : '—') : fichajeTexto,
          horasTeoricas: Math.round(horasTeoricas * 100) / 100,
          horasReales: Math.round(horasReales * 100) / 100,
          diferencia: Math.round((horasReales - horasTeoricas) * 100) / 100,
        };
      });

      const programados = dias.filter((d) => d.programado);
      const horasTeoricas = programados.reduce((s, d) => s + d.horasTeoricas, 0);
      const horasReales = dias.reduce((s, d) => s + d.horasReales, 0);
      const diasConDiscrepancia = programados.filter(
        (d) => Math.abs(d.diferencia) >= UMBRAL_DISCREPANCIA,
      ).length;

      return {
        empleado: emp,
        diasProgramados: programados.length,
        horasTeoricas: Math.round(horasTeoricas * 100) / 100,
        horasReales: Math.round(horasReales * 100) / 100,
        diferencia: Math.round((horasReales - horasTeoricas) * 100) / 100,
        diasConDiscrepancia,
        dias,
      };
    });
  }, [empleados, cronograma, fichadas, todosDias, filtroLocal, busqueda]);

  const visibles = useMemo(() => {
    let arr = resumenes;
    if (soloConDiferencia) arr = arr.filter((r) => r.diasConDiscrepancia > 0);
    // Ordenar por mayor magnitud de diferencia para que los casos a revisar suban
    return [...arr].sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
  }, [resumenes, soloConDiferencia]);

  function toggle(id: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function navegar(delta: number) {
    if (periodoTipo === 'mes') {
      let nm = month + delta;
      let ny = year;
      if (nm < 0) {
        nm = 11;
        ny--;
      }
      if (nm > 11) {
        nm = 0;
        ny++;
      }
      setMonth(nm);
      setYear(ny);
      return;
    }
    if (delta > 0) {
      if (quincena === 'q1') setQuincena('q2');
      else {
        setQuincena('q1');
        navegarMes(1);
      }
    } else {
      if (quincena === 'q2') setQuincena('q1');
      else {
        setQuincena('q2');
        navegarMes(-1);
      }
    }
  }
  function navegarMes(delta: number) {
    let nm = month + delta;
    let ny = year;
    if (nm < 0) {
      nm = 11;
      ny--;
    }
    if (nm > 11) {
      nm = 0;
      ny++;
    }
    setMonth(nm);
    setYear(ny);
  }

  // Totales del período: excluye empleados sin cronograma cargado para que las
  // reales sin teórico de referencia no inflen artificialmente la diferencia.
  const totales = useMemo(() => {
    const conCrono = visibles.filter((r) => r.diasProgramados > 0);
    const t = conCrono.reduce(
      (acc, r) => {
        acc.teoricas += r.horasTeoricas;
        acc.reales += r.horasReales;
        acc.discrepancias += r.diasConDiscrepancia;
        return acc;
      },
      { teoricas: 0, reales: 0, discrepancias: 0 },
    );
    const sinCrono = visibles.length - conCrono.length;
    return {
      empleadosComputados: conCrono.length,
      sinCrono,
      teoricas: Math.round(t.teoricas * 100) / 100,
      reales: Math.round(t.reales * 100) / 100,
      diferencia: Math.round((t.reales - t.teoricas) * 100) / 100,
      discrepancias: t.discrepancias,
    };
  }, [visibles]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-border bg-white p-3">
        <select
          value={periodoTipo}
          onChange={(e) => setPeriodoTipo(e.target.value as PeriodoTipo)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="quincena">Quincenal</option>
          <option value="mes">Mensual</option>
        </select>

        <div className="flex items-center gap-1">
          <button
            onClick={() => navegar(-1)}
            className="h-8 w-8 rounded border border-gray-300 hover:bg-gray-50"
          >
            ‹
          </button>
          <div className="min-w-[200px] px-3 py-1.5 text-center text-sm font-medium text-gray-700">
            {labelPeriodo}
          </div>
          <button
            onClick={() => navegar(1)}
            className="h-8 w-8 rounded border border-gray-300 hover:bg-gray-50"
          >
            ›
          </button>
        </div>

        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>

        <input
          type="text"
          placeholder="Buscar empleado…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="min-w-[180px] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rodziny-500"
        />

        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={soloConDiferencia}
            onChange={(e) => setSoloConDiferencia(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Solo con discrepancia
        </label>
      </div>

      {/* Totales consolidados (excluyen empleados sin cronograma) */}
      {!cargando && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-surface-border bg-white p-3 md:grid-cols-4">
          <Total
            label="Empleados computados"
            valor={String(totales.empleadosComputados)}
            sub={
              totales.sinCrono > 0
                ? `${totales.sinCrono} sin cronograma — excluido del total`
                : undefined
            }
          />
          <Total label="Horas teóricas" valor={formatHoras(totales.teoricas)} />
          <Total label="Horas reales" valor={formatHoras(totales.reales)} />
          <Total
            label="Diferencia"
            valor={formatHoras(totales.diferencia)}
            color={
              totales.diferencia > 0.5
                ? 'text-green-700'
                : totales.diferencia < -0.5
                  ? 'text-red-700'
                  : 'text-gray-700'
            }
            sub={`${totales.discrepancias} día${totales.discrepancias !== 1 ? 's' : ''} con dif. >30min`}
          />
        </div>
      )}

      {/* Lista */}
      {cargando ? (
        <div className="rounded-lg border border-surface-border bg-white p-12 text-center text-gray-400">
          Cargando…
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-lg border border-surface-border bg-white p-12 text-center text-gray-400">
          {soloConDiferencia
            ? 'No hay empleados con discrepancia en el período.'
            : 'No hay empleados que coincidan con los filtros.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Empleado</th>
                <th className="px-3 py-2 text-right">Días prog.</th>
                <th className="px-3 py-2 text-right">Teóricas</th>
                <th className="px-3 py-2 text-right">Reales</th>
                <th className="px-3 py-2 text-right">Diferencia</th>
                <th className="px-3 py-2 text-right">Días con dif.</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => {
                const abierto = expandidos.has(r.empleado.id);
                const colorDif =
                  r.diferencia > 0.5
                    ? 'text-green-700'
                    : r.diferencia < -0.5
                      ? 'text-red-700'
                      : 'text-gray-600';
                return (
                  <FilaEmpleado
                    key={r.empleado.id}
                    r={r}
                    abierto={abierto}
                    colorDif={colorDif}
                    onToggle={() => toggle(r.empleado.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Total({
  label,
  valor,
  color,
  sub,
}: {
  label: string;
  valor: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase text-gray-400">{label}</div>
      <div className={`text-lg font-semibold ${color ?? 'text-gray-800'}`}>{valor}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  );
}

function FilaEmpleado({
  r,
  abierto,
  colorDif,
  onToggle,
}: {
  r: ResumenEmpleado;
  abierto: boolean;
  colorDif: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
        onClick={onToggle}
      >
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 text-xs text-gray-400">{abierto ? '▾' : '▸'}</span>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-gray-900">
                  {r.empleado.apellido}, {r.empleado.nombre}
                </span>
                {r.diasProgramados === 0 && (
                  <span
                    className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500"
                    title="Sin cronograma cargado en el período — no suma al total"
                  >
                    sin cronograma
                  </span>
                )}
              </div>
              <div className="text-[11px] capitalize text-gray-400">
                {r.empleado.puesto} · {r.empleado.local}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2 text-right text-gray-600">{r.diasProgramados}</td>
        <td className="px-3 py-2 text-right text-gray-700">{formatHoras(r.horasTeoricas)}</td>
        <td className="px-3 py-2 text-right text-gray-700">{formatHoras(r.horasReales)}</td>
        <td className={`px-3 py-2 text-right font-semibold ${colorDif}`}>
          {r.diferencia > 0 ? '+' : ''}
          {formatHoras(r.diferencia)}
        </td>
        <td className="px-3 py-2 text-right text-gray-600">
          {r.diasConDiscrepancia > 0 ? (
            <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[11px] text-yellow-700">
              {r.diasConDiscrepancia}
            </span>
          ) : (
            <span className="text-gray-300">0</span>
          )}
        </td>
        <td className="px-3 py-2"></td>
      </tr>
      {abierto && (
        <tr className="border-t border-gray-100 bg-gray-50/40">
          <td colSpan={7} className="px-3 py-3">
            <div className="overflow-hidden rounded border border-gray-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Día</th>
                    <th className="px-3 py-1.5 text-left">Horario teórico</th>
                    <th className="px-3 py-1.5 text-left">Fichaje real</th>
                    <th className="px-3 py-1.5 text-right">Teóricas</th>
                    <th className="px-3 py-1.5 text-right">Reales</th>
                    <th className="px-3 py-1.5 text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {r.dias.map((d) => {
                    const dif = d.diferencia;
                    const significativa = Math.abs(dif) >= UMBRAL_DISCREPANCIA;
                    const colorD = !d.programado
                      ? 'text-gray-400'
                      : dif > UMBRAL_DISCREPANCIA
                        ? 'text-green-700'
                        : dif < -UMBRAL_DISCREPANCIA
                          ? 'text-red-700'
                          : 'text-gray-600';
                    return (
                      <tr
                        key={d.fecha}
                        className={`border-t border-gray-100 ${
                          significativa && d.programado ? 'bg-yellow-50/40' : ''
                        }`}
                      >
                        <td className="px-3 py-1.5 text-gray-700">{etiquetaDia(d.fecha)}</td>
                        <td className="px-3 py-1.5 text-gray-600">{d.horarioTexto}</td>
                        <td className="px-3 py-1.5 text-gray-600">{d.fichajeTexto}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600">
                          {d.programado ? formatHoras(d.horasTeoricas) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-gray-600">
                          {d.horasReales > 0 ? formatHoras(d.horasReales) : '—'}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-medium ${colorD}`}>
                          {d.programado || d.horasReales > 0
                            ? `${dif > 0 ? '+' : ''}${formatHoras(dif)}`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
