import { useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PageContainer } from '@/components/layout/PageContainer';
import { KPICard } from '@/components/ui/KPICard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { cn, formatARS, formatFecha } from '@/lib/utils';
import { CronogramaTab } from './CronogramaTab';
import { AsistenciaTab } from './AsistenciaTab';
import { SueldosTab } from './SueldosTab';
import { EvaluacionesTab } from './EvaluacionesTab';
import { VacacionesTab } from './VacacionesTab';
import { AguinaldoTab } from './AguinaldoTab';

type Tab =
  | 'legajos'
  | 'cronograma'
  | 'asistencia'
  | 'sueldos'
  | 'evaluaciones'
  | 'vacaciones'
  | 'aguinaldo';
type FiltroLocal = 'todos' | 'vedia' | 'saavedra';
type FiltroEstado = 'activos' | 'todos' | 'prueba' | 'efectivo' | 'suspendido' | 'baja';

export interface Empleado {
  id: string;
  nombre: string;
  apellido: string;
  dni: string;
  telefono: string | null;
  email: string | null;
  puesto: string;
  local: 'vedia' | 'saavedra';
  fecha_ingreso: string;
  sueldo_neto: number;
  horario_tipo: 'fijo' | 'flexible';
  horas_semanales_requeridas: number | null;
  estado_laboral: 'prueba' | 'efectivo' | 'suspendido' | 'baja';
  fecha_efectivizacion: string | null;
  activo: boolean;
  pin_fichaje: string | null;
  observaciones: string | null;
  modalidad_cobro: 'quincenal' | 'mensual';
  manipulacion_alimentos_vence: string | null;
  certificado_domicilio: boolean;
  certificado_domicilio_fecha: string | null;
  created_at: string;
}

// ── Ayuda contextual ────────────────────────────────────────────────────────
const ayudaPorTab: Record<Tab, { titulo: string; pasos: string[] }> = {
  legajos: {
    titulo: 'Legajos del personal',
    pasos: [
      'Cargá acá los datos básicos de cada empleado: nombre, DNI, puesto, local, sueldo neto.',
      'El "Estado laboral" indica si está en período de prueba o ya quedó efectivo.',
      'Para efectivizar a alguien, editá su legajo y cambiá el estado a "Efectivo" — se guarda la fecha automáticamente.',
      'Los empleados en prueba con más de 3 meses aparecen con alerta amarilla 🟡.',
      'Usá el botón "Importar CSV" para cargar varios empleados de una vez.',
      'Para dar de baja, editá y cambiá estado a "Baja" — no se borra, queda en el historial.',
    ],
  },
  cronograma: {
    titulo: 'Cronograma de horarios',
    pasos: [
      'Próximamente: armá el cronograma mensual o quincenal asignando horarios a cada empleado.',
      'Vas a poder copiar la quincena anterior, copiar de hace 14 días (para rotaciones) y filtrar por día de la semana.',
    ],
  },
  asistencia: {
    titulo: 'Asistencia diaria',
    pasos: [
      'Acá ves todas las fichadas de la quincena, agrupadas por día.',
      'Click en un día para expandirlo y ver los detalles: hora, foto, diferencia con el horario.',
      'Cada fichada muestra su origen: pwa (app móvil), manual (cargada por RRHH) o biometrico.',
      'Si alguien se olvidó el celu, usá "+ Fichaje manual" desde la toolbar o desde dentro del día.',
      'Podés editar la hora de una fichada o eliminarla si se cargó por error.',
      'Los KPIs de arriba resumen toda la quincena: fichajes totales, asistencias completas, ausencias y tardanzas.',
    ],
  },
  sueldos: {
    titulo: 'Sueldos y liquidación',
    pasos: [
      'Navegá entre quincenas con las flechas ‹ ›. Q1 = días 1-14, Q2 = 15-fin de mes.',
      'Cada empleado se liquida según su modalidad: "Quincenal" cobra la mitad del sueldo cada quincena, "Mensual" cobra todo en Q2.',
      'Cambiá la modalidad desde el select debajo del nombre — se guarda en el legajo.',
      'El toggle de Presentismo se pre-marca automáticamente leyendo la asistencia (regla CCT: 0 ausencias y 0 tardanzas, o 1 ≤10min). Podés modificarlo manualmente y aparece un 🖊 indicador.',
      'Si no cobra presentismo se descuenta `sueldo × 10/110` de la base.',
      'Click en Adelantos o Sanciones para abrir el panel lateral y cargar/borrar items. Se descuentan del total automáticamente.',
      'Para mensuales: en Q1 se pueden cargar adelantos pero el total aparece atenuado (cobran en Q2). En Q2 ves el mes completo.',
      'Abajo: F931, libro de sueldos y monto total a pagar a ARCA del mes (alimentará Finanzas).',
    ],
  },
  aguinaldo: {
    titulo: 'Aguinaldo (SAC)',
    pasos: [
      'Sueldo Anual Complementario calculado automáticamente según LCT art. 121.',
      'Fórmula: (mejor sueldo del semestre / 2) × (días trabajados / 180). Proporcional si entraron a mitad de semestre.',
      '1° SAC: semestre enero–junio, vencimiento 30 de junio.',
      '2° SAC: semestre julio–diciembre, vencimiento 18 de diciembre.',
      'El cálculo usa solo el sueldo_recibo (lo en blanco) — el plus en mano no entra en SAC.',
      'Los datos vienen de la tabla Sueldos del tab anterior. Cargá los sueldos del semestre para que el cálculo funcione.',
      'Click "Marcar pagado" para registrar la fecha de pago y el monto real (puede diferir del teórico por redondeo).',
      'KPI "Días al vencimiento" muestra cuánto falta para 30/06 o 18/12 según el semestre seleccionado.',
    ],
  },
  vacaciones: {
    titulo: 'Vacaciones',
    pasos: [
      'Elegibles: empleados con 1 año o más de antigüedad. Antes de cumplir el año no se otorgan.',
      'Días que corresponden por ley (LCT art. 150): 14 días (<5 años), 21 (5-10), 28 (10-20), 35 (>20).',
      'La tabla está ordenada por score (asistencia + puntualidad) — los mejores primero para darles prioridad de elección.',
      'Temporada preferida Rodziny: Noviembre a Febrero (baja temporada). Fuera de ese rango el sistema avisa pero no bloquea.',
      'Click en "+ Vacaciones" en un empleado para cargar una solicitud: fecha desde + cantidad de días → calcula el hasta automáticamente.',
      'Las solicitudes arrancan en "pendiente". Aprobalas o rechazalas desde la sección de arriba.',
      'Cuando el empleado efectivamente las toma, cambialas a "tomada" para que queden en el histórico.',
      'El saldo restante del año se actualiza automático: días corresponden − días aprobados/tomados.',
    ],
  },
  evaluaciones: {
    titulo: 'Evaluaciones del equipo',
    pasos: [
      'Rankings del equipo calculados automáticamente a partir de asistencia, puntualidad y horas trabajadas.',
      'Elegí período Mensual o Quincenal con el selector, y navegá con las flechas ‹ ›.',
      'Filtrá por local si querés ver solo Vedia o Saavedra, o dejalo en "Todos" para el consolidado.',
      '🏆 Asistencia perfecta: top empleados con 0 ausencias en el período.',
      '⏰ Puntualidad: porcentaje de fichadas dentro de los 10 min del horario.',
      '🔥 Racha actual: días consecutivos sin faltar (desde hoy hacia atrás, no depende del período).',
      '⚡ Horas extras: diferencia positiva entre fichadas reales y horas programadas.',
      'Los rankings excluyen empleados con menos de 5 días programados en el período (datos insuficientes).',
    ],
  },
};

function AyudaPanel({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const info = ayudaPorTab[tab];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4" onClick={onClose}>
      <div
        className="mr-2 mt-16 w-80 rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h4 className="text-sm font-semibold text-gray-900">{info.titulo}</h4>
          <button
            onClick={onClose}
            className="text-lg leading-none text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>
        <ol className="space-y-2 px-4 py-3">
          {info.pasos.map((paso, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-gray-600">
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-rodziny-100 text-[10px] font-bold text-rodziny-700">
                {i + 1}
              </span>
              <span>{paso}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function diasDesde(fecha: string): number {
  const d = new Date(fecha);
  const hoy = new Date();
  return Math.floor((hoy.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

type EstadoCert = 'sin_cargar' | 'vencido' | 'por_vencer' | 'vigente';
function estadoManipulacion(vence: string | null): EstadoCert {
  if (!vence) return 'sin_cargar';
  const dias = Math.floor(
    (new Date(vence).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24),
  );
  if (dias < 0) return 'vencido';
  if (dias <= 30) return 'por_vencer';
  return 'vigente';
}

function badgeCertificaciones(e: Empleado) {
  const estadoMan = estadoManipulacion(e.manipulacion_alimentos_vence);
  const colorMan =
    estadoMan === 'vigente'
      ? 'bg-green-100 text-green-700'
      : estadoMan === 'por_vencer'
        ? 'bg-yellow-100 text-yellow-700'
        : estadoMan === 'vencido'
          ? 'bg-red-100 text-red-700'
          : 'bg-gray-100 text-gray-500';
  const labelMan =
    estadoMan === 'vigente'
      ? 'Manipulación'
      : estadoMan === 'por_vencer'
        ? 'Manipul. ⚠'
        : estadoMan === 'vencido'
          ? 'Manipul. ✕'
          : 'Manipul. —';
  return (
    <div className="flex flex-wrap gap-1">
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] ${colorMan}`}
        title={
          e.manipulacion_alimentos_vence
            ? `Vence ${formatFecha(e.manipulacion_alimentos_vence)}`
            : 'No cargado'
        }
      >
        {labelMan}
      </span>
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] ${e.certificado_domicilio ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
        title={
          e.certificado_domicilio_fecha
            ? `Emitido ${formatFecha(e.certificado_domicilio_fecha)}`
            : e.certificado_domicilio
              ? 'Entregado'
              : 'No entregado'
        }
      >
        {e.certificado_domicilio ? 'Domicilio ✓' : 'Domicilio —'}
      </span>
    </div>
  );
}

function badgeEstado(estado: Empleado['estado_laboral']) {
  switch (estado) {
    case 'efectivo':
      return <StatusBadge status="green" label="Efectivo" />;
    case 'prueba':
      return <StatusBadge status="yellow" label="Período de prueba" />;
    case 'suspendido':
      return <StatusBadge status="red" label="Suspendido" />;
    case 'baja':
      return <StatusBadge status="gray" label="Baja" />;
  }
}

// ── Página principal ────────────────────────────────────────────────────────
export function RRHHPage() {
  const [tab, setTab] = useState<Tab>('legajos');
  const [ayudaAbierta, setAyudaAbierta] = useState(false);

  return (
    <PageContainer title="RRHH" subtitle="Gestión del personal — Rodziny S.A.S.">
      <div className="mb-6 flex items-center gap-1 border-b border-surface-border">
        <TabButton activo={tab === 'legajos'} onClick={() => setTab('legajos')}>
          Legajos
        </TabButton>
        <TabButton activo={tab === 'cronograma'} onClick={() => setTab('cronograma')}>
          Cronograma
        </TabButton>
        <TabButton activo={tab === 'asistencia'} onClick={() => setTab('asistencia')}>
          Asistencia
        </TabButton>
        <TabButton activo={tab === 'sueldos'} onClick={() => setTab('sueldos')}>
          Sueldos
        </TabButton>
        <TabButton activo={tab === 'evaluaciones'} onClick={() => setTab('evaluaciones')}>
          Evaluaciones
        </TabButton>
        <TabButton activo={tab === 'vacaciones'} onClick={() => setTab('vacaciones')}>
          Vacaciones
        </TabButton>
        <TabButton activo={tab === 'aguinaldo'} onClick={() => setTab('aguinaldo')}>
          Aguinaldo
        </TabButton>
        <button
          onClick={() => setAyudaAbierta(true)}
          className="hover:bg-rodziny-200 mb-2 ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-rodziny-100 text-sm font-bold text-rodziny-700 transition-colors"
          title="Ayuda"
        >
          ?
        </button>
      </div>

      {tab === 'legajos' && <LegajosTab />}
      {tab === 'cronograma' && <CronogramaTab />}
      {tab === 'asistencia' && <AsistenciaTab />}
      {tab === 'sueldos' && <SueldosTab />}
      {tab === 'evaluaciones' && <EvaluacionesTab />}
      {tab === 'vacaciones' && <VacacionesTab />}
      {tab === 'aguinaldo' && <AguinaldoTab />}

      {ayudaAbierta && <AyudaPanel tab={tab} onClose={() => setAyudaAbierta(false)} />}
    </PageContainer>
  );
}

function TabButton({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
        activo
          ? 'border-rodziny-500 text-rodziny-700'
          : 'border-transparent text-gray-500 hover:text-gray-700',
      )}
    >
      {children}
    </button>
  );
}

function Placeholder({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-white p-12 text-center">
      <div className="mb-3 text-4xl">🚧</div>
      <h3 className="mb-1 text-lg font-semibold text-gray-700">{titulo}</h3>
      <p className="text-sm text-gray-500">{descripcion}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB LEGAJOS
// ════════════════════════════════════════════════════════════════════════════
function LegajosTab() {
  const qc = useQueryClient();
  const [filtroLocal, setFiltroLocal] = useState<FiltroLocal>('todos');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('activos');
  const [busqueda, setBusqueda] = useState('');
  const [modalAbierto, setModalAbierto] = useState(false);
  const [empleadoEdit, setEmpleadoEdit] = useState<Empleado | null>(null);
  const [importadorAbierto, setImportadorAbierto] = useState(false);

  const { data: empleados, isLoading } = useQuery({
    queryKey: ['empleados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empleados')
        .select('*')
        .order('apellido', { ascending: true });
      if (error) throw error;
      return data as Empleado[];
    },
  });

  const filtrados = useMemo(() => {
    let lista = empleados ?? [];
    if (filtroLocal === 'vedia') lista = lista.filter((e) => e.local === 'vedia');
    else if (filtroLocal === 'saavedra') lista = lista.filter((e) => e.local === 'saavedra');
    if (filtroEstado === 'activos') lista = lista.filter((e) => e.estado_laboral !== 'baja');
    else if (filtroEstado !== 'todos') lista = lista.filter((e) => e.estado_laboral === filtroEstado);
    if (busqueda.trim()) {
      const q = busqueda
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      lista = lista.filter((e) => {
        const txt = `${e.nombre} ${e.apellido} ${e.dni} ${e.puesto}`
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        return txt.includes(q);
      });
    }
    return lista;
  }, [empleados, filtroLocal, filtroEstado, busqueda]);

  const kpis = useMemo(() => {
    const todos = empleados ?? [];
    const activos = todos.filter((e) => e.activo && e.estado_laboral !== 'baja');
    const enPrueba = activos.filter((e) => e.estado_laboral === 'prueba');
    const pruebaPorVencer = enPrueba.filter((e) => diasDesde(e.fecha_ingreso) >= 75); // alerta a 75 días
    const manipVencida = activos.filter(
      (e) => estadoManipulacion(e.manipulacion_alimentos_vence) === 'vencido',
    ).length;
    const manipPorVencer = activos.filter(
      (e) => estadoManipulacion(e.manipulacion_alimentos_vence) === 'por_vencer',
    ).length;
    const manipSinCargar = activos.filter(
      (e) => estadoManipulacion(e.manipulacion_alimentos_vence) === 'sin_cargar',
    ).length;
    const sinDomicilio = activos.filter((e) => !e.certificado_domicilio).length;
    return {
      total: activos.length,
      vedia: activos.filter((e) => e.local === 'vedia').length,
      saavedra: activos.filter((e) => e.local === 'saavedra').length,
      enPrueba: enPrueba.length,
      pruebaPorVencer: pruebaPorVencer.length,
      sueldoTotal: activos.reduce((s, e) => s + (e.sueldo_neto || 0), 0),
      manipVencida,
      manipPorVencer,
      manipSinCargar,
      sinDomicilio,
    };
  }, [empleados]);

  async function eliminarEmpleado(emp: Empleado) {
    const ok = window.confirm(
      `¿Eliminar definitivamente a ${emp.apellido}, ${emp.nombre}?\n\n` +
        `Esto borra el legajo. Si tiene fichadas, cronograma u otro historial asociado, ` +
        `el borrado puede fallar y conviene marcarlo como BAJA desde Editar.`,
    );
    if (!ok) return;
    const { error } = await supabase.from('empleados').delete().eq('id', emp.id);
    if (error) {
      window.alert(
        `No se pudo eliminar: ${error.message}\n\n` +
          `Probablemente tiene registros asociados (fichadas / cronograma / sueldos). ` +
          `Editá el legajo y cambiá el estado a "Baja" en vez de borrar.`,
      );
      return;
    }
    qc.invalidateQueries({ queryKey: ['empleados'] });
  }

  function abrirNuevo() {
    setEmpleadoEdit(null);
    setModalAbierto(true);
  }
  function abrirEditar(emp: Empleado) {
    setEmpleadoEdit(emp);
    setModalAbierto(true);
  }
  function cerrarModal() {
    setModalAbierto(false);
    setEmpleadoEdit(null);
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <KPICard label="Activos" value={String(kpis.total)} color="blue" loading={isLoading} />
        <KPICard label="Vedia" value={String(kpis.vedia)} color="neutral" loading={isLoading} />
        <KPICard
          label="Saavedra"
          value={String(kpis.saavedra)}
          color="neutral"
          loading={isLoading}
        />
        <KPICard
          label="En prueba"
          value={`${kpis.enPrueba}${kpis.pruebaPorVencer ? ` (${kpis.pruebaPorVencer}⚠)` : ''}`}
          color={kpis.pruebaPorVencer ? 'yellow' : 'neutral'}
          loading={isLoading}
        />
        <KPICard
          label="Sueldos netos/mes"
          value={formatARS(kpis.sueldoTotal)}
          color="green"
          loading={isLoading}
        />
        <KPICard
          label="Manipulación"
          value={
            kpis.manipVencida > 0
              ? `${kpis.manipVencida} vencida${kpis.manipVencida > 1 ? 's' : ''}`
              : kpis.manipPorVencer > 0
                ? `${kpis.manipPorVencer} por vencer`
                : kpis.manipSinCargar > 0
                  ? `${kpis.manipSinCargar} sin cargar`
                  : 'Al día'
          }
          color={
            kpis.manipVencida > 0
              ? 'red'
              : kpis.manipPorVencer > 0
                ? 'yellow'
                : kpis.manipSinCargar > 0
                  ? 'neutral'
                  : 'green'
          }
          loading={isLoading}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-white p-3">
        <input
          type="text"
          placeholder="Buscar por nombre, DNI o puesto..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="min-w-[200px] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-rodziny-500"
        />
        <select
          value={filtroLocal}
          onChange={(e) => setFiltroLocal(e.target.value as FiltroLocal)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="todos">Todos los locales</option>
          <option value="vedia">Vedia</option>
          <option value="saavedra">Saavedra</option>
        </select>
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value as FiltroEstado)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="activos">Activos (sin bajas)</option>
          <option value="todos">Todos los estados</option>
          <option value="prueba">En prueba</option>
          <option value="efectivo">Efectivos</option>
          <option value="suspendido">Suspendidos</option>
          <option value="baja">Bajas</option>
        </select>
        <button
          onClick={() => setImportadorAbierto(true)}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          📥 Importar CSV
        </button>
        <button
          onClick={abrirNuevo}
          className="rounded-md bg-rodziny-600 px-3 py-1.5 text-sm text-white hover:bg-rodziny-700"
        >
          + Nuevo empleado
        </button>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Empleado</th>
              <th className="px-4 py-2 text-left">DNI</th>
              <th className="px-4 py-2 text-left">Puesto</th>
              <th className="px-4 py-2 text-left">Local</th>
              <th className="px-4 py-2 text-left">Ingreso</th>
              <th className="px-4 py-2 text-right">Sueldo neto</th>
              <th className="px-4 py-2 text-left">Certificaciones</th>
              <th className="px-4 py-2 text-left">Estado</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">
                  Cargando...
                </td>
              </tr>
            )}
            {!isLoading && filtrados.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">
                  {empleados?.length === 0
                    ? 'No hay empleados cargados todavía. Hacé clic en "+ Nuevo empleado" para empezar.'
                    : 'No hay empleados que coincidan con los filtros.'}
                </td>
              </tr>
            )}
            {filtrados.map((e) => {
              const dias = diasDesde(e.fecha_ingreso);
              const alertaPrueba = e.estado_laboral === 'prueba' && dias >= 75;
              return (
                <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">
                      {e.apellido}, {e.nombre}
                    </div>
                    {e.telefono && <div className="text-xs text-gray-400">{e.telefono}</div>}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{e.dni}</td>
                  <td className="px-4 py-2 text-gray-600">{e.puesto}</td>
                  <td className="px-4 py-2">
                    <span className="capitalize text-gray-600">{e.local}</span>
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {formatFecha(e.fecha_ingreso)}
                    {alertaPrueba && (
                      <div className="text-[10px] font-semibold text-yellow-700">
                        ⚠ {dias} días en prueba
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-700">{formatARS(e.sueldo_neto)}</td>
                  <td className="px-4 py-2">{badgeCertificaciones(e)}</td>
                  <td className="px-4 py-2">{badgeEstado(e.estado_laboral)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => abrirEditar(e)}
                        className="text-xs font-medium text-rodziny-600 hover:text-rodziny-800"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => eliminarEmpleado(e)}
                        className="text-xs font-medium text-red-600 hover:text-red-800"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <ModalEmpleado
          empleado={empleadoEdit}
          onClose={cerrarModal}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['empleados'] });
            cerrarModal();
          }}
        />
      )}

      {importadorAbierto && (
        <ModalImportador
          onClose={() => setImportadorAbierto(false)}
          onImported={() => {
            qc.invalidateQueries({ queryKey: ['empleados'] });
            setImportadorAbierto(false);
          }}
        />
      )}
    </div>
  );
}

// ── Modal alta/edición ──────────────────────────────────────────────────────
function ModalEmpleado({
  empleado,
  onClose,
  onSaved,
}: {
  empleado: Empleado | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    nombre: empleado?.nombre ?? '',
    apellido: empleado?.apellido ?? '',
    dni: empleado?.dni ?? '',
    telefono: empleado?.telefono ?? '',
    email: empleado?.email ?? '',
    puesto: empleado?.puesto ?? '',
    local: empleado?.local ?? 'vedia',
    fecha_ingreso: empleado?.fecha_ingreso ?? new Date().toISOString().split('T')[0],
    sueldo_neto: empleado?.sueldo_neto ?? 0,
    horario_tipo: empleado?.horario_tipo ?? 'fijo',
    horas_semanales_requeridas: empleado?.horas_semanales_requeridas ?? 40,
    estado_laboral: empleado?.estado_laboral ?? 'prueba',
    fecha_efectivizacion: empleado?.fecha_efectivizacion ?? '',
    pin_fichaje: empleado?.pin_fichaje ?? '',
    observaciones: empleado?.observaciones ?? '',
    activo: empleado?.activo ?? true,
    manipulacion_alimentos_vence: empleado?.manipulacion_alimentos_vence ?? '',
    certificado_domicilio: empleado?.certificado_domicilio ?? false,
    certificado_domicilio_fecha: empleado?.certificado_domicilio_fecha ?? '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    if (!form.nombre.trim() || !form.apellido.trim() || !form.dni.trim() || !form.puesto.trim()) {
      setError('Nombre, apellido, DNI y puesto son obligatorios.');
      return;
    }
    setGuardando(true);
    try {
      // Si se cambió a efectivo y no tiene fecha de efectivización, ponerla hoy
      const payload = {
        ...form,
        sueldo_neto: Number(form.sueldo_neto) || 0,
        horas_semanales_requeridas:
          form.horario_tipo === 'flexible' ? Number(form.horas_semanales_requeridas) || null : null,
        telefono: form.telefono || null,
        email: form.email || null,
        pin_fichaje: form.pin_fichaje || null,
        observaciones: form.observaciones || null,
        fecha_efectivizacion:
          form.estado_laboral === 'efectivo'
            ? form.fecha_efectivizacion || new Date().toISOString().split('T')[0]
            : form.fecha_efectivizacion || null,
        manipulacion_alimentos_vence: form.manipulacion_alimentos_vence || null,
        certificado_domicilio: form.certificado_domicilio,
        certificado_domicilio_fecha: form.certificado_domicilio_fecha || null,
        updated_at: new Date().toISOString(),
      };
      if (empleado) {
        const { error } = await supabase.from('empleados').update(payload).eq('id', empleado.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('empleados').insert(payload);
        if (error) throw error;
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Error al guardar.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
          <h3 className="font-semibold text-gray-900">
            {empleado ? 'Editar empleado' : 'Nuevo empleado'}
          </h3>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-600">
            &times;
          </button>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre *">
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Apellido *">
              <input
                value={form.apellido}
                onChange={(e) => setForm({ ...form, apellido: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="DNI *">
              <input
                value={form.dni}
                onChange={(e) => setForm({ ...form, dni: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Teléfono">
              <input
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Puesto *">
              <input
                value={form.puesto}
                onChange={(e) => setForm({ ...form, puesto: e.target.value })}
                placeholder="Cocinero / Cajero / Mozo..."
                className="input"
              />
            </Field>
            <Field label="Local *">
              <select
                value={form.local}
                onChange={(e) => setForm({ ...form, local: e.target.value as Empleado['local'] })}
                className="input"
              >
                <option value="vedia">Vedia</option>
                <option value="saavedra">Saavedra</option>
              </select>
            </Field>
            <Field label="Fecha de ingreso *">
              <input
                type="date"
                value={form.fecha_ingreso}
                onChange={(e) => setForm({ ...form, fecha_ingreso: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Sueldo neto (en mano)">
              <input
                type="number"
                value={form.sueldo_neto}
                onChange={(e) => setForm({ ...form, sueldo_neto: Number(e.target.value) })}
                className="input"
              />
            </Field>
            <Field label="Tipo de horario">
              <select
                value={form.horario_tipo}
                onChange={(e) =>
                  setForm({ ...form, horario_tipo: e.target.value as 'fijo' | 'flexible' })
                }
                className="input"
              >
                <option value="fijo">Fijo</option>
                <option value="flexible">Flexible</option>
              </select>
            </Field>
            {form.horario_tipo === 'flexible' && (
              <Field label="Horas semanales requeridas">
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={form.horas_semanales_requeridas}
                  onChange={(e) =>
                    setForm({ ...form, horas_semanales_requeridas: Number(e.target.value) })
                  }
                  className="input"
                />
              </Field>
            )}
            <Field label="Estado laboral">
              <select
                value={form.estado_laboral}
                onChange={(e) =>
                  setForm({ ...form, estado_laboral: e.target.value as Empleado['estado_laboral'] })
                }
                className="input"
              >
                <option value="prueba">Período de prueba</option>
                <option value="efectivo">Efectivo</option>
                <option value="suspendido">Suspendido</option>
                <option value="baja">Baja</option>
              </select>
            </Field>
            <Field label="Fecha efectivización">
              <input
                type="date"
                value={form.fecha_efectivizacion ?? ''}
                onChange={(e) => setForm({ ...form, fecha_efectivizacion: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="PIN fichaje (4 dígitos)">
              <input
                value={form.pin_fichaje}
                onChange={(e) => setForm({ ...form, pin_fichaje: e.target.value })}
                maxLength={4}
                className="input"
              />
            </Field>
          </div>

          {/* Certificaciones */}
          <div className="border-t border-gray-100 pt-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-700">
              Certificaciones
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Manipulación de alimentos — vence">
                <input
                  type="date"
                  value={form.manipulacion_alimentos_vence}
                  onChange={(e) =>
                    setForm({ ...form, manipulacion_alimentos_vence: e.target.value })
                  }
                  className="input"
                />
                <div className="mt-0.5 text-[10px] text-gray-400">Dejar vacío si no tiene</div>
              </Field>
              <div className="space-y-1">
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Certificado de domicilio
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.certificado_domicilio}
                    onChange={(e) => setForm({ ...form, certificado_domicilio: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Entregado
                </label>
                {form.certificado_domicilio && (
                  <input
                    type="date"
                    value={form.certificado_domicilio_fecha}
                    onChange={(e) =>
                      setForm({ ...form, certificado_domicilio_fecha: e.target.value })
                    }
                    className="input mt-1"
                    placeholder="Fecha emisión"
                  />
                )}
              </div>
            </div>
          </div>

          <Field label="Observaciones">
            <textarea
              value={form.observaciones}
              onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
              rows={2}
              className="input"
            />
          </Field>
          {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded-md bg-rodziny-600 px-4 py-1.5 text-sm text-white hover:bg-rodziny-700 disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
      <style>{`.input { width: 100%; padding: 6px 10px; font-size: 13px; border: 1px solid #d1d5db; border-radius: 6px; outline: none; } .input:focus { border-color: #82c44e; box-shadow: 0 0 0 2px rgba(130,196,78,0.2); }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

// ── Importador CSV ──────────────────────────────────────────────────────────
function ModalImportador({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setResultado(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error('El archivo debe tener al menos un header y una fila.');
      const sep = lines[0].includes(';') ? ';' : ',';
      const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
      const required = ['nombre', 'apellido', 'dni', 'puesto', 'local', 'fecha_ingreso'];
      const missing = required.filter((r) => !headers.includes(r));
      if (missing.length) throw new Error(`Faltan columnas obligatorias: ${missing.join(', ')}`);

      const rows = lines.slice(1).map((line) => {
        const cols = line.split(sep).map((c) => c.trim());
        const obj: any = {};
        headers.forEach((h, i) => {
          obj[h] = cols[i] ?? '';
        });
        return {
          nombre: obj.nombre,
          apellido: obj.apellido,
          dni: obj.dni,
          telefono: obj.telefono || null,
          email: obj.email || null,
          puesto: obj.puesto,
          local: (obj.local || 'vedia').toLowerCase(),
          fecha_ingreso: obj.fecha_ingreso,
          sueldo_neto: Number(obj.sueldo_neto || 0),
          horario_tipo: (obj.horario_tipo || 'fijo').toLowerCase(),
          estado_laboral: (obj.estado_laboral || 'prueba').toLowerCase(),
          activo: true,
        };
      });
      setPreview(rows);
    } catch (err: any) {
      setError(err.message);
      setPreview([]);
    }
  }

  async function importar() {
    if (!preview.length) return;
    setImportando(true);
    setError(null);
    try {
      const { error } = await supabase.from('empleados').insert(preview);
      if (error) throw error;
      setResultado(`✅ ${preview.length} empleados importados correctamente.`);
      setTimeout(onImported, 1200);
    } catch (err: any) {
      setError(err.message || 'Error al importar.');
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h3 className="font-semibold text-gray-900">Importar empleados desde CSV</h3>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-600">
            &times;
          </button>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div className="rounded border border-blue-100 bg-blue-50 p-3 text-xs text-gray-600">
            <div className="mb-1 font-semibold">Formato del CSV:</div>
            <div>
              Columnas obligatorias:{' '}
              <code>nombre, apellido, dni, puesto, local, fecha_ingreso</code>
            </div>
            <div>
              Opcionales: <code>telefono, email, sueldo_neto, horario_tipo, estado_laboral</code>
            </div>
            <div className="mt-1">
              Separador: coma (<code>,</code>) o punto y coma (<code>;</code>). Fecha en formato{' '}
              <code>YYYY-MM-DD</code>. Local: <code>vedia</code> o <code>saavedra</code>.
            </div>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-rodziny-600 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-rodziny-700"
          />

          {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          {resultado && (
            <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{resultado}</div>
          )}

          {preview.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-gray-500">
                Vista previa ({preview.length} filas):
              </div>
              <div className="max-h-64 overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">Apellido</th>
                      <th className="px-2 py-1 text-left">Nombre</th>
                      <th className="px-2 py-1 text-left">DNI</th>
                      <th className="px-2 py-1 text-left">Puesto</th>
                      <th className="px-2 py-1 text-left">Local</th>
                      <th className="px-2 py-1 text-left">Ingreso</th>
                      <th className="px-2 py-1 text-right">Sueldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((p, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1">{p.apellido}</td>
                        <td className="px-2 py-1">{p.nombre}</td>
                        <td className="px-2 py-1">{p.dni}</td>
                        <td className="px-2 py-1">{p.puesto}</td>
                        <td className="px-2 py-1">{p.local}</td>
                        <td className="px-2 py-1">{p.fecha_ingreso}</td>
                        <td className="px-2 py-1 text-right">{formatARS(p.sueldo_neto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={importar}
            disabled={!preview.length || importando}
            className="rounded-md bg-rodziny-600 px-4 py-1.5 text-sm text-white hover:bg-rodziny-700 disabled:opacity-50"
          >
            {importando ? 'Importando...' : `Importar ${preview.length || ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
