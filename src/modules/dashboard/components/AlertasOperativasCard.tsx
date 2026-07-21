import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Severidad = 'critico' | 'warning' | 'info';

interface Alerta {
  id: string;
  severidad: Severidad;
  icono: string;
  titulo: string;
  detalle: string;
  link: string;
  cta: string;
}

const ORDEN_SEV: Record<Severidad, number> = { critico: 0, warning: 1, info: 2 };

const ESTILO_SEV: Record<Severidad, string> = {
  critico: 'border-red-300 bg-red-50',
  warning: 'border-amber-300 bg-amber-50',
  info: 'border-blue-200 bg-blue-50',
};

const TEXTO_SEV: Record<Severidad, string> = {
  critico: 'text-red-900',
  warning: 'text-amber-900',
  info: 'text-blue-900',
};

const BTN_SEV: Record<Severidad, string> = {
  critico: 'bg-red-600 hover:bg-red-700',
  warning: 'bg-amber-600 hover:bg-amber-700',
  info: 'bg-blue-600 hover:bg-blue-700',
};

const CUENTA_LABEL: Record<string, string> = {
  mercadopago: 'MercadoPago',
  galicia: 'Galicia',
  icbc: 'ICBC',
};

const NOMBRE_MES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function ymd(d: Date) {
  return d.toISOString().split('T')[0];
}

function diasEntre(desde: string, hasta: Date): number {
  const d1 = new Date(desde + 'T12:00:00Z').getTime();
  const d2 = hasta.getTime();
  return Math.floor((d2 - d1) / 86400000);
}

export function AlertasOperativasCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['alertas_operativas'],
    queryFn: async () => {
      const hoy = ymd(new Date());

      // Última fecha de movimientos por cuenta
      const cuentas = ['mercadopago', 'galicia', 'icbc'];
      const ultimas: Record<string, string | null> = {};
      for (const c of cuentas) {
        const { data: row } = await supabase
          .from('movimientos_bancarios')
          .select('fecha')
          .eq('cuenta', c)
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle();
        ultimas[c] = row?.fecha ?? null;
      }

      // Egresos pendientes de conciliar en el MES ACTUAL: débitos del banco
      // sin gasto asociado, ignorando transferencias internas. El número
      // coincide con lo que Lucas ve al entrar al tab Conciliación (que
      // filtra al mes actual por defecto). Los movs históricos de meses
      // pasados se revisan cambiando el filtro de fecha en la pantalla.
      const inicioMes = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
      const { count: movsPendientes } = await supabase
        .from('movimientos_bancarios')
        .select('*', { count: 'exact', head: true })
        .is('gasto_id', null)
        .gt('debito', 0)
        .or('es_transferencia_interna.is.null,es_transferencia_interna.eq.false')
        .gte('fecha', inicioMes)
        .lte('fecha', hoy);

      // Gastos vencidos sin pagar
      const { count: gastosVencidos } = await supabase
        .from('gastos')
        .select('*', { count: 'exact', head: true })
        .lt('fecha_vencimiento', hoy)
        .neq('estado_pago', 'Pagado')
        .neq('cancelado', true);

      // Pagos fijos vencidos sin pagar
      const { count: pagosFijosVencidos } = await supabase
        .from('pagos_fijos')
        .select('*', { count: 'exact', head: true })
        .lt('fecha_vencimiento', hoy)
        .eq('pagado', false);

      return {
        ultimas,
        movsPendientes: movsPendientes ?? 0,
        gastosVencidos: gastosVencidos ?? 0,
        pagosFijosVencidos: pagosFijosVencidos ?? 0,
      };
    },
    staleTime: 60 * 1000,
  });

  const alertas: Alerta[] = [];

  if (data) {
    const ahora = new Date();

    // MercadoPago: API debería estar al día
    if (data.ultimas.mercadopago) {
      const dias = diasEntre(data.ultimas.mercadopago, ahora);
      if (dias > 7) {
        alertas.push({
          id: 'mp_atrasado',
          severidad: dias > 30 ? 'critico' : 'warning',
          icono: '🔄',
          titulo: 'Falta sincronizar MercadoPago',
          detalle: `Último movimiento: ${data.ultimas.mercadopago} (hace ${dias} días)`,
          link: '/finanzas?tab=flujo',
          cta: 'Ir a Flujo de caja',
        });
      }
    } else {
      alertas.push({
        id: 'mp_sin_datos',
        severidad: 'warning',
        icono: '🔄',
        titulo: 'Sin datos de MercadoPago',
        detalle: 'No hay movimientos cargados todavía.',
        link: '/finanzas?tab=flujo',
        cta: 'Ir a Flujo de caja',
      });
    }

    // Galicia / ICBC: extracto quincenal.
    // Q1 cubre días 1-15, Q2 cubre días 16-fin de mes.
    // - Si hoy >= día 16: ya cerró Q1 del mes actual → debería haber movs hasta día 15.
    // - Si hoy entre 1-15: ya cerró Q2 del mes anterior → debería haber movs hasta último día mes pasado.
    const dia = ahora.getDate();
    let cutoff: Date;
    let etiquetaQuincena: string;
    if (dia >= 16) {
      // Cerró Q1 mes actual
      cutoff = new Date(ahora.getFullYear(), ahora.getMonth(), 15);
      etiquetaQuincena = `Q1 ${NOMBRE_MES[ahora.getMonth()]} ${ahora.getFullYear()}`;
    } else {
      // Cerró Q2 mes anterior (último día del mes pasado)
      cutoff = new Date(ahora.getFullYear(), ahora.getMonth(), 0);
      etiquetaQuincena = `Q2 ${NOMBRE_MES[cutoff.getMonth()]} ${cutoff.getFullYear()}`;
    }

    for (const cuenta of ['galicia', 'icbc'] as const) {
      const max = data.ultimas[cuenta];
      const maxDate = max ? new Date(max + 'T12:00:00Z') : null;
      const faltaExtracto = !maxDate || maxDate < cutoff;
      if (!faltaExtracto) continue;

      const diasAtraso = maxDate
        ? Math.floor((cutoff.getTime() - maxDate.getTime()) / 86400000)
        : 999;
      const severidad: Severidad =
        diasAtraso > 30 ? 'critico' : diasAtraso > 10 ? 'warning' : 'info';

      alertas.push({
        id: `extracto_${cuenta}`,
        severidad,
        icono: '📥',
        titulo: `Falta extracto ${CUENTA_LABEL[cuenta]} · ${etiquetaQuincena}`,
        detalle: maxDate
          ? `Último movimiento cargado: ${max} (${diasAtraso} día${diasAtraso !== 1 ? 's' : ''} de atraso)`
          : 'No hay movimientos cargados.',
        link: '/finanzas?tab=conciliacion',
        cta: 'Importar extracto',
      });
    }

    if (data.gastosVencidos > 0) {
      alertas.push({
        id: 'gastos_vencidos',
        severidad: 'critico',
        icono: '💸',
        titulo: `${data.gastosVencidos} gasto${data.gastosVencidos > 1 ? 's' : ''} vencido${data.gastosVencidos > 1 ? 's' : ''} sin pagar`,
        detalle: 'Fecha de vencimiento ya pasó.',
        link: '/compras?tab=pagos',
        cta: 'Ver pagos',
      });
    }

    if (data.pagosFijosVencidos > 0) {
      alertas.push({
        id: 'pagos_fijos_vencidos',
        severidad: 'critico',
        icono: '🧾',
        titulo: `${data.pagosFijosVencidos} pago${data.pagosFijosVencidos > 1 ? 's' : ''} fijo${data.pagosFijosVencidos > 1 ? 's' : ''} vencido${data.pagosFijosVencidos > 1 ? 's' : ''}`,
        detalle: 'Pendientes de marcar como pagados.',
        link: '/finanzas?tab=checklist',
        cta: 'Ir a checklist',
      });
    }

    if (data.movsPendientes > 0) {
      alertas.push({
        id: 'movs_pendientes',
        severidad: data.movsPendientes > 50 ? 'warning' : 'info',
        icono: '🏦',
        titulo: `${data.movsPendientes.toLocaleString('es-AR')} egreso${data.movsPendientes > 1 ? 's' : ''} sin conciliar este mes`,
        detalle: 'Débitos del extracto que todavía no están vinculados a un gasto.',
        link: '/finanzas?tab=conciliacion',
        cta: 'Conciliar',
      });
    }
  }

  alertas.sort((a, b) => ORDEN_SEV[a.severidad] - ORDEN_SEV[b.severidad]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-surface-border bg-white p-4">
        <p className="text-sm text-gray-400">Cargando alertas...</p>
      </div>
    );
  }

  if (alertas.length === 0) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">✅</span>
          <span className="text-sm font-medium text-green-900">
            Todo en orden — sin pendientes operativos.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Alertas operativas</h3>
        <span className="text-xs text-gray-400">{alertas.length} pendiente{alertas.length > 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-2">
        {alertas.map((a) => (
          <div
            key={a.id}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-3',
              ESTILO_SEV[a.severidad],
            )}
          >
            <span className="text-lg leading-none">{a.icono}</span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-semibold', TEXTO_SEV[a.severidad])}>{a.titulo}</p>
              <p className={cn('mt-0.5 text-xs opacity-80', TEXTO_SEV[a.severidad])}>{a.detalle}</p>
            </div>
            <Link
              to={a.link}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors',
                BTN_SEV[a.severidad],
              )}
            >
              {a.cta} →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
