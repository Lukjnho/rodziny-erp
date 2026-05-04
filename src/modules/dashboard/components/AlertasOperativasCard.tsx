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

      // Movimientos pendientes de clasificar
      const { count: movsPendientes } = await supabase
        .from('movimientos_bancarios')
        .select('*', { count: 'exact', head: true })
        .is('tipo', null)
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
    // Primer día del mes pasado: si hoy es 04/05, ese cutoff es 01/04
    const primerDiaMesAnt = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    const mesAntNombre = NOMBRE_MES[primerDiaMesAnt.getMonth()];
    const mesAntAnio = primerDiaMesAnt.getFullYear();

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
          link: '/finanzas',
          cta: 'Ir a Finanzas',
        });
      }
    } else {
      alertas.push({
        id: 'mp_sin_datos',
        severidad: 'warning',
        icono: '🔄',
        titulo: 'Sin datos de MercadoPago',
        detalle: 'No hay movimientos cargados todavía.',
        link: '/finanzas',
        cta: 'Ir a Finanzas',
      });
    }

    // Galicia / ICBC: extracto mensual, alerta si no hay nada del mes anterior
    for (const cuenta of ['galicia', 'icbc'] as const) {
      const max = data.ultimas[cuenta];
      const sinMesAnt = !max || new Date(max + 'T12:00:00Z') < primerDiaMesAnt;
      if (sinMesAnt) {
        alertas.push({
          id: `extracto_${cuenta}`,
          severidad: 'warning',
          icono: '📥',
          titulo: `Falta extracto ${CUENTA_LABEL[cuenta]} · ${mesAntNombre} ${mesAntAnio}`,
          detalle: max
            ? `Último movimiento cargado: ${max}`
            : 'No hay movimientos cargados.',
          link: '/compras',
          cta: 'Importar extracto',
        });
      }
    }

    if (data.gastosVencidos > 0) {
      alertas.push({
        id: 'gastos_vencidos',
        severidad: 'critico',
        icono: '💸',
        titulo: `${data.gastosVencidos} gasto${data.gastosVencidos > 1 ? 's' : ''} vencido${data.gastosVencidos > 1 ? 's' : ''} sin pagar`,
        detalle: 'Fecha de vencimiento ya pasó.',
        link: '/compras',
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
        link: '/finanzas',
        cta: 'Ir a checklist',
      });
    }

    if (data.movsPendientes > 0) {
      alertas.push({
        id: 'movs_pendientes',
        severidad: data.movsPendientes > 100 ? 'warning' : 'info',
        icono: '🏦',
        titulo: `${data.movsPendientes.toLocaleString('es-AR')} movimientos sin clasificar`,
        detalle: 'Vinculá a gastos, marcá transferencia interna o ignorá.',
        link: '/compras',
        cta: 'Clasificar',
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
