import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Empleado } from './RRHHPage';
import { etiquetaDia, normalizarTexto } from './utils';
import {
  AYUDA_ALERTA,
  LABEL_ALERTA,
  REVISAR_LARGO_H,
  turnosPorEmpleado,
  type Alerta,
  type FichadaEvento,
  type Turno,
} from './bienalHoras';

// ════════════════════════════════════════════════════════════════════════════
// HORAS DE EVENTOS EXTERNOS (Bienal)
// ────────────────────────────────────────────────────────────────────────────
// Las fichadas de la Bienal se guardan con `evento='bienal'` (QR por stand, sin
// GPS). TODOS los demás tabs de RRHH filtran `evento IS NULL`, así que estas
// marcas no aparecen en Horas, Asistencia, Sueldos ni Evaluaciones: quedaban
// guardadas pero sin ninguna pantalla que las mostrara. Este tab es esa
// pantalla — es de ANÁLISIS, no liquida ni escribe nada.
//
// Criterio de cálculo (mismo que el tab Horas, para que los números sean
// comparables): pares entrada→salida cronológicos dentro de la jornada, con
// anti doble-tap de 90s. Un par de más de 16hs se considera salida no fichada y
// NO suma. Los umbrales de REVISIÓN (largo/corto) solo marcan, no descartan.
// ════════════════════════════════════════════════════════════════════════════

// La Bienal 2026 arrancó el 17/07 pero la primera marca por QR es del 18: el
// rango arranca el 17 a propósito para que el día faltante quede a la vista.
const INICIO_CONOCIDO: Record<string, string> = { bienal: '2026-07-17' };

type FiltroStand = 'todos' | 'vedia' | 'saavedra';

interface ResumenEmpleado {
  empleado: Empleado;
  turnos: Turno[];
  dias: number;
  horas: number;
  horasVedia: number;
  horasSaavedra: number;
  standPrincipal: 'vedia' | 'saavedra';
  turnosComputados: number;
  alertas: number;
}

function hhmm(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatHoras(h: number): string {
  const horas = Math.floor(h);
  const mins = Math.round((h - horas) * 60);
  if (mins === 0) return `${horas}h`;
  return `${horas}h${String(mins).padStart(2, '0')}`;
}

// Decimal con coma, como todo el resto del sistema.
function decimalAR(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function diasDelRango(desde: string, hasta: string): string[] {
  const out: string[] = [];
  const [y1, m1, d1] = desde.split('-').map(Number);
  const [y2, m2, d2] = hasta.split('-').map(Number);
  const fin = new Date(y2, m2 - 1, d2);
  for (let d = new Date(y1, m1 - 1, d1); d <= fin; d.setDate(d.getDate() + 1)) {
    out.push(ymdLocal(d));
  }
  return out;
}

export function BienalTab() {
  const [evento, setEvento] = useState('bienal');
  const [filtroStand, setFiltroStand] = useState<FiltroStand>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [rango, setRango] = useState<{ desde: string; hasta: string } | null>(null);

  // Eventos existentes + su rango de fechas. Así el tab sirve para el próximo
  // evento sin tocar código.
  const { data: eventos } = useQuery({
    queryKey: ['eventos-fichadas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fichadas')
        .select('evento, fecha')
        .not('evento', 'is', null)
        .order('fecha');
      if (error) throw error;
      const filas = (data ?? []) as { evento: string; fecha: string }[];
      const mapa = new Map<string, { desde: string; hasta: string }>();
      for (const f of filas) {
        const r = mapa.get(f.evento);
        if (!r) mapa.set(f.evento, { desde: f.fecha, hasta: f.fecha });
        else {
          if (f.fecha < r.desde) r.desde = f.fecha;
          if (f.fecha > r.hasta) r.hasta = f.fecha;
        }
      }
      return mapa;
    },
  });

  const rangoEvento = eventos?.get(evento);
  const desde = rango?.desde ?? INICIO_CONOCIDO[evento] ?? rangoEvento?.desde ?? '';
  const hasta = rango?.hasta ?? rangoEvento?.hasta ?? '';

  const { data: empleados } = useQuery({
    // Misma key que HorasTab: trae TODOS (incluye bajas — gente del evento que
    // después dejó la empresa tiene que seguir apareciendo).
    queryKey: ['empleados', 'todos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('empleados').select('*').order('apellido');
      if (error) throw error;
      return data as Empleado[];
    },
  });

  const { data: fichadas } = useQuery({
    queryKey: ['fichadas-evento', evento, desde, hasta],
    enabled: !!desde && !!hasta,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fichadas')
        .select('id, empleado_id, fecha, tipo, timestamp, local')
        .eq('evento', evento)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('timestamp');
      if (error) throw error;
      return data as FichadaEvento[];
    },
  });

  const cargando = !empleados || !fichadas || !eventos;

  const resumenes = useMemo<ResumenEmpleado[]>(() => {
    if (!empleados || !fichadas) return [];
    const porEmpleado = new Map<string, Empleado>(empleados.map((e) => [e.id, e]));

    const out: ResumenEmpleado[] = [];
    for (const [empId, turnos] of turnosPorEmpleado(fichadas)) {
      const emp = porEmpleado.get(empId);
      if (!emp) continue;

      let horasVedia = 0;
      let horasSaavedra = 0;
      let alertas = 0;
      for (const t of turnos) {
        // Las horas se imputan al stand por el que ENTRÓ.
        if (t.standEntrada === 'vedia') horasVedia += t.horas;
        else horasSaavedra += t.horas;
        if (t.alertas.length > 0) alertas++;
      }
      const horas = horasVedia + horasSaavedra;

      out.push({
        empleado: emp,
        turnos,
        dias: new Set(turnos.map((t) => t.fecha)).size,
        horas,
        horasVedia,
        horasSaavedra,
        standPrincipal: horasSaavedra > horasVedia ? 'saavedra' : 'vedia',
        turnosComputados: turnos.filter((t) => t.computa).length,
        alertas,
      });
    }
    return out;
  }, [empleados, fichadas]);

  const visibles = useMemo(() => {
    let arr = resumenes;
    if (filtroStand !== 'todos') {
      arr = arr.filter((r) => r.turnos.some((t) => t.standEntrada === filtroStand));
    }
    if (busqueda.trim()) {
      const q = normalizarTexto(busqueda);
      arr = arr.filter((r) =>
        normalizarTexto(`${r.empleado.nombre} ${r.empleado.apellido} ${r.empleado.puesto}`).includes(
          q,
        ),
      );
    }
    if (soloAlertas) arr = arr.filter((r) => r.alertas > 0);
    return [...arr].sort((a, b) => b.horas - a.horas);
  }, [resumenes, filtroStand, busqueda, soloAlertas]);

  const totales = useMemo(() => {
    const t = visibles.reduce(
      (acc, r) => {
        acc.horas += r.horas;
        acc.vedia += r.horasVedia;
        acc.saavedra += r.horasSaavedra;
        acc.alertas += r.alertas;
        acc.sinCerrar += r.turnos.filter((x) => x.alertas.includes('sin_salida')).length;
        return acc;
      },
      { horas: 0, vedia: 0, saavedra: 0, alertas: 0, sinCerrar: 0 },
    );
    return { ...t, personas: visibles.length };
  }, [visibles]);

  // Casos a revisar: turnos con al menos una bandera, ordenados por gravedad.
  const casos = useMemo(() => {
    const orden: Alerta[] = ['sin_salida', 'largo', 'salida_huerfana', 'cruce', 'corto'];
    const lista: { r: ResumenEmpleado; t: Turno }[] = [];
    for (const r of visibles) {
      for (const t of r.turnos) if (t.alertas.length > 0) lista.push({ r, t });
    }
    return lista.sort((a, b) => {
      const pa = Math.min(...a.t.alertas.map((x) => orden.indexOf(x)));
      const pb = Math.min(...b.t.alertas.map((x) => orden.indexOf(x)));
      if (pa !== pb) return pa - pb;
      return a.t.entrada.localeCompare(b.t.entrada);
    });
  }, [visibles]);

  // Por jornada: incluye los días del rango SIN marcas (ahí se ve el hueco).
  const porJornada = useMemo(() => {
    if (!desde || !hasta) return [];
    const mapa = new Map<string, { horas: number; personas: Set<string>; turnos: number }>();
    for (const r of visibles) {
      for (const t of r.turnos) {
        const e = mapa.get(t.fecha) ?? { horas: 0, personas: new Set<string>(), turnos: 0 };
        e.horas += t.horas;
        e.personas.add(r.empleado.id);
        e.turnos++;
        mapa.set(t.fecha, e);
      }
    }
    return diasDelRango(desde, hasta).map((fecha) => {
      const e = mapa.get(fecha);
      return {
        fecha,
        horas: e?.horas ?? 0,
        personas: e?.personas.size ?? 0,
        turnos: e?.turnos ?? 0,
      };
    });
  }, [visibles, desde, hasta]);

  const diasVacios = porJornada.filter((d) => d.turnos === 0);

  function toggle(id: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // CSV con el detalle turno por turno: es lo que se lleva a la reunión.
  function exportarCSV() {
    const sep = ';';
    const filas: string[][] = [
      [
        'Empleado',
        'Puesto',
        'Local legajo',
        'Jornada',
        'Stand entrada',
        'Entrada',
        'Stand salida',
        'Salida',
        'Horas',
        'Computa',
        'Alertas',
      ],
    ];
    for (const r of visibles) {
      for (const t of r.turnos) {
        filas.push([
          `${r.empleado.apellido}, ${r.empleado.nombre}`,
          r.empleado.puesto,
          r.empleado.local,
          t.fecha,
          t.standEntrada,
          hhmm(t.entrada),
          t.standSalida ?? '',
          t.salida ? hhmm(t.salida) : '',
          decimalAR(t.horas),
          t.computa ? 'si' : 'no',
          t.alertas.map((a) => LABEL_ALERTA[a]).join(' / '),
        ]);
      }
    }
    const csv = filas
      .map((f) => f.map((c) => (c.includes(sep) || c.includes('"') ? `"${c.replace(/"/g, '""')}"` : c)).join(sep))
      .join('\r\n');
    // BOM para que Excel en español respete los acentos.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `horas-${evento}-${desde}_a_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const listaEventos = eventos ? [...eventos.keys()] : [];

  return (
    <div className="space-y-4">
      {/* Aviso de alcance: que nadie confunda esto con liquidación */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-900">
        <strong>Horas de evento externo — vista de análisis.</strong> Estas fichadas se hacen con el
        QR del stand, van etiquetadas con <code>evento</code> y quedan fuera de Horas, Asistencia,
        Sueldos y Evaluaciones (que solo miran las del local). Este tab <strong>no liquida ni
        modifica nada</strong>: es para revisar los números con el equipo antes de decidir cómo se
        pagan.
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-border bg-white p-3">
        <select
          value={evento}
          onChange={(e) => {
            setEvento(e.target.value);
            setRango(null); // que recalcule el rango del evento nuevo
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm capitalize"
        >
          {listaEventos.length === 0 && <option value={evento}>{evento}</option>}
          {listaEventos.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 text-sm text-gray-600">
          <input
            type="date"
            value={desde}
            onChange={(e) => setRango({ desde: e.target.value, hasta })}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <span className="text-gray-400">→</span>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setRango({ desde, hasta: e.target.value })}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>

        <select
          value={filtroStand}
          onChange={(e) => setFiltroStand(e.target.value as FiltroStand)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="todos">Ambos stands</option>
          <option value="vedia">Stand Vedia</option>
          <option value="saavedra">Stand Saavedra</option>
        </select>

        <input
          type="text"
          placeholder="Buscar persona…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="min-w-[160px] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rodziny-500"
        />

        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={soloAlertas}
            onChange={(e) => setSoloAlertas(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Solo con alertas
        </label>

        <button
          onClick={exportarCSV}
          disabled={cargando || visibles.length === 0}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          ⬇ Exportar CSV
        </button>
      </div>

      {cargando ? (
        <div className="rounded-lg border border-surface-border bg-white p-12 text-center text-gray-400">
          Cargando…
        </div>
      ) : (
        <>
          {/* Totales */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-surface-border bg-white p-3 md:grid-cols-5">
            <Total label="Horas totales" valor={formatHoras(totales.horas)} destacado />
            <Total label="Stand Vedia" valor={formatHoras(totales.vedia)} />
            <Total label="Stand Saavedra" valor={formatHoras(totales.saavedra)} />
            <Total label="Personas" valor={String(totales.personas)} />
            <Total
              label="Turnos a revisar"
              valor={String(totales.alertas)}
              color={totales.alertas > 0 ? 'text-amber-700' : undefined}
              sub={
                totales.sinCerrar > 0
                  ? `${totales.sinCerrar} sin cerrar — horas que faltan`
                  : undefined
              }
            />
          </div>

          {diasVacios.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              ⚠ Sin ninguna marca en {diasVacios.length === 1 ? 'el día' : 'los días'}:{' '}
              <strong>{diasVacios.map((d) => etiquetaDia(d.fecha)).join(', ')}</strong>. Si esos días
              se trabajó, esas horas no están registradas por QR y hay que cargarlas aparte.
            </div>
          )}

          {/* Resumen por persona */}
          {visibles.length === 0 ? (
            <div className="rounded-lg border border-surface-border bg-white p-12 text-center text-gray-400">
              No hay fichadas de este evento con los filtros aplicados.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Persona</th>
                    <th className="px-3 py-2 text-left">Stand</th>
                    <th className="px-3 py-2 text-right">Días</th>
                    <th className="px-3 py-2 text-right">Turnos</th>
                    <th className="px-3 py-2 text-right">Horas</th>
                    <th className="px-3 py-2 text-right">A revisar</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((r) => (
                    <FilaPersona
                      key={r.empleado.id}
                      r={r}
                      abierto={expandidos.has(r.empleado.id)}
                      onToggle={() => toggle(r.empleado.id)}
                    />
                  ))}
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-gray-700">Total</td>
                    <td className="px-3 py-2 text-[11px] font-normal text-gray-500">
                      V {formatHoras(totales.vedia)} · S {formatHoras(totales.saavedra)}
                    </td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right text-gray-900">
                      {formatHoras(totales.horas)}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-700">{totales.alertas}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Casos a revisar */}
          {casos.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-amber-200 bg-white">
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5">
                <h4 className="text-sm font-semibold text-amber-900">
                  Casos a revisar ({casos.length})
                </h4>
                <p className="mt-0.5 text-[11px] text-amber-800">
                  Resolver con el equipo antes de pagar. Los turnos “sin salida” NO están sumados —
                  son horas que faltan. Los “&gt;{REVISAR_LARGO_H}h” SÍ están sumados y probablemente
                  sobren.
                </p>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Persona</th>
                    <th className="px-3 py-1.5 text-left">Jornada</th>
                    <th className="px-3 py-1.5 text-left">Stand</th>
                    <th className="px-3 py-1.5 text-left">Marcas</th>
                    <th className="px-3 py-1.5 text-right">Horas</th>
                    <th className="px-3 py-1.5 text-left">Qué pasó</th>
                  </tr>
                </thead>
                <tbody>
                  {casos.map(({ r, t }, i) => (
                    <tr key={`${t.empleadoId}-${t.entrada}-${i}`} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 text-gray-800">
                        {r.empleado.apellido}, {r.empleado.nombre}
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">{etiquetaDia(t.fecha)}</td>
                      <td className="px-3 py-1.5 capitalize text-gray-600">
                        {t.standEntrada}
                        {t.standSalida && t.standSalida !== t.standEntrada && (
                          <span className="text-amber-700"> → {t.standSalida}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-gray-600">
                        {hhmm(t.entrada)} – {t.salida ? hhmm(t.salida) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                        {t.computa ? formatHoras(t.horas) : <span className="text-gray-400">no suma</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {t.alertas.map((a) => (
                            <BadgeAlerta key={a} alerta={a} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Por jornada */}
          {porJornada.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
              <div className="border-b border-gray-100 px-4 py-2.5">
                <h4 className="text-sm font-semibold text-gray-800">Por jornada</h4>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Día</th>
                    <th className="px-3 py-1.5 text-right">Personas</th>
                    <th className="px-3 py-1.5 text-right">Turnos</th>
                    <th className="px-3 py-1.5 text-right">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {porJornada.map((d) => (
                    <tr
                      key={d.fecha}
                      className={`border-t border-gray-100 ${d.turnos === 0 ? 'bg-amber-50' : ''}`}
                    >
                      <td className="px-3 py-1.5 text-gray-700">{etiquetaDia(d.fecha)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                        {d.personas || <span className="text-amber-700">sin marcas</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                        {d.turnos || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                        {d.turnos ? formatHoras(d.horas) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BadgeAlerta({ alerta }: { alerta: Alerta }) {
  const color =
    alerta === 'sin_salida' || alerta === 'salida_huerfana'
      ? 'bg-red-100 text-red-700'
      : alerta === 'largo'
        ? 'bg-amber-100 text-amber-800'
        : alerta === 'cruce'
          ? 'bg-blue-100 text-blue-700'
          : 'bg-gray-100 text-gray-600';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${color}`} title={AYUDA_ALERTA[alerta]}>
      {LABEL_ALERTA[alerta]}
    </span>
  );
}

function Total({
  label,
  valor,
  color,
  sub,
  destacado,
}: {
  label: string;
  valor: string;
  color?: string;
  sub?: string;
  destacado?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase text-gray-400">{label}</div>
      <div
        className={`font-semibold ${destacado ? 'text-xl' : 'text-lg'} ${color ?? 'text-gray-800'}`}
      >
        {valor}
      </div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  );
}

function FilaPersona({
  r,
  abierto,
  onToggle,
}: {
  r: ResumenEmpleado;
  abierto: boolean;
  onToggle: () => void;
}) {
  const enAmbos = r.horasVedia > 0 && r.horasSaavedra > 0;
  return (
    <>
      <tr className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={onToggle}>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 text-xs text-gray-400">{abierto ? '▾' : '▸'}</span>
            <div>
              <div className="font-medium text-gray-900">
                {r.empleado.apellido}, {r.empleado.nombre}
              </div>
              <div className="text-[11px] capitalize text-gray-400">
                {r.empleado.puesto} · legajo {r.empleado.local}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2 capitalize text-gray-600">
          {r.standPrincipal}
          {enAmbos && (
            <span
              className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700"
              title={`Vedia ${formatHoras(r.horasVedia)} · Saavedra ${formatHoras(r.horasSaavedra)}`}
            >
              ambos
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.dias}</td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.turnosComputados}</td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
          {formatHoras(r.horas)}
        </td>
        <td className="px-3 py-2 text-right">
          {r.alertas > 0 ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
              {r.alertas}
            </span>
          ) : (
            <span className="text-gray-300">0</span>
          )}
        </td>
      </tr>
      {abierto && (
        <tr className="border-t border-gray-100 bg-gray-50/40">
          <td colSpan={6} className="px-3 py-3">
            <div className="overflow-hidden rounded border border-gray-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Jornada</th>
                    <th className="px-3 py-1.5 text-left">Stand</th>
                    <th className="px-3 py-1.5 text-left">Entrada</th>
                    <th className="px-3 py-1.5 text-left">Salida</th>
                    <th className="px-3 py-1.5 text-right">Horas</th>
                    <th className="px-3 py-1.5 text-left">Observación</th>
                  </tr>
                </thead>
                <tbody>
                  {r.turnos.map((t, i) => (
                    <tr
                      key={`${t.entrada}-${i}`}
                      className={`border-t border-gray-100 ${t.alertas.length > 0 ? 'bg-amber-50/50' : ''}`}
                    >
                      <td className="px-3 py-1.5 text-gray-700">{etiquetaDia(t.fecha)}</td>
                      <td className="px-3 py-1.5 capitalize text-gray-600">
                        {t.standEntrada}
                        {t.standSalida && t.standSalida !== t.standEntrada && (
                          <span className="text-amber-700"> → {t.standSalida}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-gray-600">{hhmm(t.entrada)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-gray-600">
                        {t.salida ? hhmm(t.salida) : <span className="text-red-600">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                        {t.computa ? formatHoras(t.horas) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {t.alertas.map((a) => (
                            <BadgeAlerta key={a} alerta={a} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
