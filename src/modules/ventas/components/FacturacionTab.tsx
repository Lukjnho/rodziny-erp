import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  useArcaConfig,
  useMediosFacturables,
  useGuardarArcaConfig,
  useCambiarFacturaAutomatica,
  type ArcaConfig,
  type ModoFacturacion,
} from '../hooks/useFacturacion';

const NOMBRE_LOCAL: Record<string, string> = {
  vedia: 'Rodziny Vedia',
  saavedra: 'Rodziny Sin Gluten (Saavedra)',
};

const MODOS: [ModoFacturacion, string, string][] = [
  [
    'segun_medio',
    'Solo los cobros digitales',
    'Se factura lo que entra por MercadoPago (tarjetas, QR y transferencias). El efectivo no. Es como trabaja Rodziny hoy.',
  ],
  ['todo', 'Todas las ventas', 'Cada venta genera su comprobante, se pague como se pague.'],
  [
    'ninguno',
    'Nada automático',
    'No se factura sola ninguna venta. Solo salen las facturas que el cajero pida a mano.',
  ],
];

function Etiqueta({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs font-medium text-gray-500">{children}</span>;
}

function Campo({
  label,
  value,
  onChange,
  placeholder,
  tipo = 'text',
  editable,
  ayuda,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  tipo?: string;
  editable: boolean;
  ayuda?: string;
}) {
  return (
    <label className="block">
      <Etiqueta>{label}</Etiqueta>
      <input
        type={tipo}
        value={value}
        placeholder={placeholder}
        disabled={!editable}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full rounded border border-gray-300 px-2 py-1.5 text-sm',
          'focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500',
          !editable && 'cursor-not-allowed bg-gray-50 text-gray-500',
        )}
      />
      {ayuda && <span className="mt-1 block text-xs text-gray-400">{ayuda}</span>}
    </label>
  );
}

function TarjetaLocal({ config, editable }: { config: ArcaConfig; editable: boolean }) {
  const guardar = useGuardarArcaConfig();
  const [borrador, setBorrador] = useState<ArcaConfig>(config);
  const [aviso, setAviso] = useState<string | null>(null);

  // Si el dato cambia por afuera (otra pestaña, otra persona), se refleja.
  useEffect(() => setBorrador(config), [config]);

  const cambio = useMemo(
    () => (JSON.stringify(borrador) !== JSON.stringify(config) ? true : false),
    [borrador, config],
  );

  const puntoVentaSinCargar = borrador.punto_venta === 1;
  const enProduccion = borrador.ambiente === 'produccion';

  function set<K extends keyof ArcaConfig>(campo: K, valor: ArcaConfig[K]) {
    setAviso(null);
    setBorrador((b) => ({ ...b, [campo]: valor }));
  }

  function cambiarAmbiente(nuevo: string) {
    if (nuevo === 'produccion') {
      const ok = window.confirm(
        'Vas a pasar a PRODUCCIÓN.\n\n' +
          'Desde ese momento las facturas que emita este local son reales, ' +
          'con validez fiscal, y no se pueden borrar: solo anular con nota de crédito.\n\n' +
          '¿Seguro?',
      );
      if (!ok) return;
    }
    set('ambiente', nuevo as ArcaConfig['ambiente']);
  }

  function cambiarActivo(valor: boolean) {
    if (valor && puntoVentaSinCargar) {
      setAviso(
        'Antes de activar hay que cargar el punto de venta real de este local. El 1 es un número de relleno.',
      );
      return;
    }
    set('activo', valor);
  }

  async function onGuardar() {
    setAviso(null);
    try {
      await guardar.mutateAsync({
        local: config.local,
        cambios: {
          punto_venta: Number(borrador.punto_venta) || 1,
          ambiente: borrador.ambiente,
          razon_social: borrador.razon_social,
          domicilio_comercial: borrador.domicilio_comercial || null,
          ingresos_brutos: borrador.ingresos_brutos || null,
          inicio_actividades: borrador.inicio_actividades || null,
          activo: borrador.activo,
          modo_facturacion: borrador.modo_facturacion,
        },
      });
      setAviso('Guardado.');
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div>
          <h3 className="font-semibold text-gray-800">
            {NOMBRE_LOCAL[config.local] ?? config.local}
          </h3>
          <p className="text-xs text-gray-500">CUIT {config.cuit_emisor}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              borrador.activo
                ? enProduccion
                  ? 'bg-green-100 text-green-800'
                  : 'bg-blue-100 text-blue-800'
                : 'bg-gray-100 text-gray-600',
            )}
          >
            {!borrador.activo
              ? 'Sin facturar'
              : enProduccion
                ? 'Facturando de verdad'
                : 'Facturando en modo ensayo'}
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={borrador.activo}
              disabled={!editable}
              onChange={(e) => cambiarActivo(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-rodziny-600 focus:ring-rodziny-500"
            />
            <span className="text-gray-600">Activo</span>
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Campo
            label="Punto de venta"
            tipo="number"
            editable={editable}
            value={String(borrador.punto_venta ?? '')}
            onChange={(v) => set('punto_venta', Number(v) as ArcaConfig['punto_venta'])}
            ayuda="Los cuatro primeros dígitos de la factura. Es el mismo que usa Fudo hoy."
          />
          {puntoVentaSinCargar && (
            <p className="mt-1 text-xs font-medium text-amber-700">
              ⚠ Todavía es el número de relleno. Miralo en cualquier factura de este local.
            </p>
          )}
        </div>

        <label className="block">
          <Etiqueta>Ambiente</Etiqueta>
          <select
            value={borrador.ambiente}
            disabled={!editable}
            onChange={(e) => cambiarAmbiente(e.target.value)}
            className={cn(
              'w-full rounded border border-gray-300 px-2 py-1.5 text-sm',
              'focus:border-rodziny-500 focus:outline-none focus:ring-1 focus:ring-rodziny-500',
              !editable && 'cursor-not-allowed bg-gray-50 text-gray-500',
            )}
          >
            <option value="homologacion">Ensayo (las facturas no valen)</option>
            <option value="produccion">Producción (facturas reales)</option>
          </select>
          <span className="mt-1 block text-xs text-gray-400">
            En ensayo se puede probar todo lo que quieras sin consecuencias.
          </span>
        </label>

        <Campo
          label="Razón social"
          editable={editable}
          value={borrador.razon_social ?? ''}
          onChange={(v) => set('razon_social', v)}
        />
        <Campo
          label="Domicilio comercial"
          editable={editable}
          value={borrador.domicilio_comercial ?? ''}
          onChange={(v) => set('domicilio_comercial', v)}
          placeholder="Saavedra 286, Resistencia"
          ayuda="Se imprime en el ticket."
        />
        <Campo
          label="Ingresos brutos"
          editable={editable}
          value={borrador.ingresos_brutos ?? ''}
          onChange={(v) => set('ingresos_brutos', v)}
          ayuda="Se imprime en el ticket."
        />
        <Campo
          label="Inicio de actividades"
          tipo="date"
          editable={editable}
          value={borrador.inicio_actividades ?? ''}
          onChange={(v) => set('inicio_actividades', v)}
          ayuda="Se imprime en el ticket."
        />
      </div>

      <div className="mt-4">
        <Etiqueta>¿Qué se factura sin que nadie lo pida?</Etiqueta>
        <div className="space-y-1.5">
          {MODOS.map(([valor, titulo, detalle]) => (
            <label
              key={valor}
              className={cn(
                'flex cursor-pointer gap-2 rounded border p-2 text-sm',
                borrador.modo_facturacion === valor
                  ? 'border-rodziny-300 bg-rodziny-50'
                  : 'border-gray-200 hover:bg-gray-50',
                !editable && 'cursor-not-allowed',
              )}
            >
              <input
                type="radio"
                name={`modo-${config.local}`}
                checked={borrador.modo_facturacion === valor}
                disabled={!editable}
                onChange={() => set('modo_facturacion', valor)}
                className="mt-0.5 h-4 w-4 border-gray-300 text-rodziny-600 focus:ring-rodziny-500"
              />
              <span>
                <span className="font-medium text-gray-800">{titulo}</span>
                <span className="block text-xs text-gray-500">{detalle}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          En los tres casos el cajero puede pedir factura a mano para una venta puntual, aunque sea
          en efectivo, si el cliente se la pide.
        </p>
      </div>

      {aviso && (
        <p
          className={cn(
            'mt-3 rounded px-3 py-2 text-sm',
            aviso === 'Guardado.'
              ? 'bg-green-50 text-green-800'
              : 'bg-amber-50 text-amber-900',
          )}
        >
          {aviso}
        </p>
      )}

      {editable && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={onGuardar}
            disabled={!cambio || guardar.isPending}
            className={cn(
              'rounded px-4 py-1.5 text-sm font-medium text-white transition-colors',
              cambio && !guardar.isPending
                ? 'bg-rodziny-600 hover:bg-rodziny-700'
                : 'cursor-not-allowed bg-gray-300',
            )}
          >
            {guardar.isPending ? 'Guardando…' : cambio ? 'Guardar cambios' : 'Sin cambios'}
          </button>
        </div>
      )}
    </div>
  );
}

function MediosQueFacturan({ editable }: { editable: boolean }) {
  const { data: medios, isLoading } = useMediosFacturables();
  const cambiar = useCambiarFacturaAutomatica();
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string, valor: boolean) {
    setError(null);
    try {
      await cambiar.mutateAsync({ id, valor });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar.');
    }
  }

  if (isLoading) return <p className="text-sm text-gray-500">Cargando medios de pago…</p>;

  const lista = (medios ?? []).filter((m) => m.codigo !== 'sin_especificar');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-gray-800">Qué cobros generan factura solos</h3>
      <p className="mb-3 mt-1 text-xs text-gray-500">
        Solo se aplica en los locales configurados como «Solo los cobros digitales».
      </p>

      <div className="divide-y divide-gray-100">
        {lista.map((m) => (
          <label
            key={m.id}
            className={cn(
              'flex items-center justify-between gap-3 py-2',
              editable ? 'cursor-pointer' : 'cursor-default',
            )}
          >
            <span>
              <span className="text-sm text-gray-800">{m.nombre}</span>
              <span className="block text-xs text-gray-400">
                {m.es_efectivo
                  ? 'Entra a la caja del local'
                  : m.cuenta_default_venta
                    ? `Va a ${m.cuenta_default_venta}`
                    : 'Sin cuenta asignada'}
              </span>
            </span>
            <input
              type="checkbox"
              checked={m.factura_automatica}
              disabled={!editable || cambiar.isPending}
              onChange={(e) => toggle(m.id, e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-rodziny-600 focus:ring-rodziny-500"
            />
          </label>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>
      )}
    </div>
  );
}

export function FacturacionTab() {
  const { perfil } = useAuth();
  const editable = !!perfil?.es_admin;
  const { data: configs, isLoading, error } = useArcaConfig();

  if (isLoading) return <p className="text-sm text-gray-500">Cargando…</p>;
  if (error)
    return (
      <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
        No se pudo leer la configuración de facturación.
      </p>
    );

  const activos = (configs ?? []).filter((c) => c.activo);
  const enProduccion = activos.filter((c) => c.ambiente === 'produccion');

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'rounded-lg border p-3 text-sm',
          enProduccion.length > 0
            ? 'border-green-200 bg-green-50 text-green-900'
            : activos.length > 0
              ? 'border-blue-200 bg-blue-50 text-blue-900'
              : 'border-gray-200 bg-gray-50 text-gray-700',
        )}
      >
        {enProduccion.length > 0 ? (
          <>
            <strong>Facturación activa.</strong> {enProduccion.map((c) => NOMBRE_LOCAL[c.local] ?? c.local).join(' y ')}{' '}
            {enProduccion.length === 1 ? 'está emitiendo' : 'están emitiendo'} comprobantes reales.
          </>
        ) : activos.length > 0 ? (
          <>
            <strong>En modo ensayo.</strong> Se emiten comprobantes de prueba contra ARCA, sin
            validez fiscal. Sirve para probar todo antes de arrancar en serio.
          </>
        ) : (
          <>
            <strong>Todavía no se factura desde el ERP.</strong> Falta cargar el punto de venta de
            cada local y el certificado de ARCA. Mientras tanto, Fudo sigue facturando como siempre.
          </>
        )}
      </div>

      {!editable && (
        <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          Estás viendo la configuración en modo lectura. Para cambiarla hace falta ser
          administrador.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {(configs ?? []).map((c) => (
          <TarjetaLocal key={c.local} config={c} editable={editable} />
        ))}
      </div>

      <MediosQueFacturan editable={editable} />
    </div>
  );
}
