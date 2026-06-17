import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useAgendaItems, useToggleCompletado } from '@/modules/agenda/useAgenda';
import { TIPO_ICONO, PRIORIDAD_COLOR, type AgendaItem } from '@/modules/agenda/types';
import { PageContainer } from '@/components/layout/PageContainer';
import { ProximasEfemeridesCard } from '@/modules/cocina/components/ProximasEfemeridesCard';
import { AlertasOperativasCard } from '@/modules/dashboard/components/AlertasOperativasCard';
import { CierresInventarioPendientesCard } from '@/modules/dashboard/components/CierresInventarioPendientesCard';
import { ExtractosAlerta } from '@/modules/finanzas/components/ExtractosAlerta';

// Pantalla de inicio universal: lo primero que ve cualquier usuario al entrar.
// Muestra "su día" (tareas/recordatorios de la agenda) arriba y, debajo, las
// alertas operativas que ya existían en el Dashboard, cada una mostrada solo si
// el usuario tiene el permiso correspondiente (un empleado de cocina no ve —ni
// dispara queries de— finanzas).

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

type Grupo = 'atrasadas' | 'hoy' | 'manana';

const GRUPO_TITULO: Record<Grupo, string> = {
  atrasadas: 'Atrasadas',
  hoy: 'Hoy',
  manana: 'Mañana',
};

const GRUPO_COLOR: Record<Grupo, string> = {
  atrasadas: 'text-red-700 bg-red-50 border-red-200',
  hoy: 'text-rodziny-700 bg-rodziny-50 border-rodziny-200',
  manana: 'text-amber-700 bg-amber-50 border-amber-200',
};

function clasificar(item: AgendaItem, hoy: Date, manana: Date): Grupo | null {
  if (item.completado) return null;
  const inicio = startOfDay(new Date(item.fecha_inicio));
  if (inicio < hoy) return 'atrasadas';
  if (inicio.getTime() === hoy.getTime()) return 'hoy';
  if (inicio.getTime() === manana.getTime()) return 'manana';
  return null; // más adelante no entra en el resumen de Inicio
}

function formatHora(iso: string, allDay: boolean) {
  if (allDay) return 'Todo el día';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function saludo(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Buenas noches';
  if (h < 13) return 'Buen día';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function fechaLarga(): string {
  const s = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function InicioPage() {
  const { perfil, tienePermiso } = useAuth();

  // Alertas: agrupo permisos para no renderizar cards que el usuario no puede ver.
  // Las alertas financieras de supervisión (extractos, gastos/pagos fijos vencidos,
  // conciliación) NO se gobiernan por "puede cargar gastos": tienen su propio flag
  // dedicado que se asigna a mano (no hay override de admin a propósito, para que
  // el CEO decida exactamente quién las ve). Cargar gastos sigue intacto para todos.
  const verAlertasFinanzas = !!perfil?.puede_ver_alertas_finanzas;
  // Cierres de inventario queda con su criterio original (Martín hace el cierre).
  const verCierres =
    tienePermiso('edr') ||
    tienePermiso('finanzas') ||
    tienePermiso('gastos') ||
    tienePermiso('flujo_caja');
  const verEfemerides = tienePermiso('cocina');
  const hayAlertas = verCierres || verAlertasFinanzas || verEfemerides;

  const primerNombre = (perfil?.nombre || '').split(' ')[0];

  return (
    <PageContainer title="Inicio" subtitle={fechaLarga()}>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            {saludo()}
            {primerNombre && <span className="capitalize">, {primerNombre}</span>} 👋
          </h2>
          <p className="text-sm text-gray-500">Esto es lo que tenés para hoy.</p>
        </div>

        {tienePermiso('agenda') && <MiDia />}

        {hayAlertas && (
          <div className="space-y-6">
            {tienePermiso('agenda') && (
              <h3 className="border-t border-gray-100 pt-5 text-sm font-semibold uppercase tracking-wide text-gray-400">
                Alertas
              </h3>
            )}
            {verCierres && <CierresInventarioPendientesCard />}
            {verAlertasFinanzas && <AlertasOperativasCard />}
            {verAlertasFinanzas && <ExtractosAlerta variant="card" />}
            {verEfemerides && <ProximasEfemeridesCard diasAdelante={15} />}
          </div>
        )}
      </div>
    </PageContainer>
  );
}

function MiDia() {
  const { data: items, isLoading } = useAgendaItems();
  const toggle = useToggleCompletado();

  const grupos = useMemo(() => {
    const hoy = startOfDay(new Date());
    const manana = startOfDay(new Date(hoy.getTime() + 24 * 60 * 60 * 1000));
    const buckets: Record<Grupo, AgendaItem[]> = { atrasadas: [], hoy: [], manana: [] };
    for (const item of items ?? []) {
      const g = clasificar(item, hoy, manana);
      if (g) buckets[g].push(item);
    }
    return buckets;
  }, [items]);

  const total = grupos.atrasadas.length + grupos.hoy.length + grupos.manana.length;
  const orden: Grupo[] = ['atrasadas', 'hoy', 'manana'];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Mi día</h3>
        <Link to="/agenda" className="text-xs text-rodziny-700 hover:underline">
          Ver agenda completa →
        </Link>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
          Cargando tu agenda…
        </div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div className="mb-2 text-3xl">✅</div>
          <p className="font-medium text-gray-700">No tenés nada pendiente para hoy</p>
          <p className="text-sm text-gray-500">
            Cargá tareas o recordatorios desde la{' '}
            <Link to="/agenda" className="text-rodziny-700 hover:underline">
              Agenda
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orden.map((g) =>
            grupos[g].length === 0 ? null : (
              <div key={g} className="overflow-hidden rounded-lg border bg-white">
                <div
                  className={cn(
                    'flex items-center justify-between border-b px-4 py-2 text-sm font-medium',
                    GRUPO_COLOR[g],
                  )}
                >
                  <span>{GRUPO_TITULO[g]}</span>
                  <span className="text-xs">{grupos[g].length}</span>
                </div>
                <div>
                  {grupos[g].map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      atrasada={g === 'atrasadas'}
                      onToggle={(c) => toggle.mutate({ id: item.id, completado: c })}
                    />
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function ItemRow({
  item,
  atrasada,
  onToggle,
}: {
  item: AgendaItem;
  atrasada?: boolean;
  onToggle: (completado: boolean) => void;
}) {
  const prio = item.prioridad ? PRIORIDAD_COLOR[item.prioridad] : null;
  return (
    <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-2.5 text-sm first:border-t-0 hover:bg-gray-50">
      <input
        type="checkbox"
        checked={item.completado}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4 cursor-pointer rounded border-gray-300 text-rodziny-600 focus:ring-rodziny-500"
      />
      <span className="text-base" title={item.tipo}>
        {TIPO_ICONO[item.tipo]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-gray-900">{item.titulo}</div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className={cn(atrasada && 'font-semibold text-red-600')}>
            {formatHora(item.fecha_inicio, item.all_day)}
          </span>
          {item.recurrencia && <span className="text-rodziny-600">🔁</span>}
          {item.nota && <span className="truncate text-gray-400">· {item.nota}</span>}
        </div>
      </div>
      {prio && (
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', prio.bg, prio.text)}>
          {item.prioridad}
        </span>
      )}
    </div>
  );
}
