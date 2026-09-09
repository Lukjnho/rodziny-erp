import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { PageContainer } from '@/components/layout/PageContainer';
import { useAuth, type Perfil, type Modulo } from '@/lib/auth';
import { cn } from '@/lib/utils';

const MODULOS: { key: Modulo; label: string; campo: keyof Perfil }[] = [
  { key: 'dashboard', label: 'Dashboard', campo: 'puede_ver_dashboard' },
  { key: 'ventas', label: 'Ventas', campo: 'puede_ver_ventas' },
  { key: 'finanzas', label: 'Finanzas', campo: 'puede_ver_finanzas' },
  { key: 'flujo_caja', label: 'Flujo de caja', campo: 'puede_ver_flujo_caja' },
  { key: 'edr', label: 'EdR', campo: 'puede_ver_edr' },
  { key: 'gastos', label: 'Gastos', campo: 'puede_ver_gastos' },
  { key: 'amortizaciones', label: 'Amortizaciones', campo: 'puede_ver_amortizaciones' },
  { key: 'rrhh', label: 'RRHH', campo: 'puede_ver_rrhh' },
  { key: 'compras', label: 'Compras', campo: 'puede_ver_compras' },
  { key: 'cocina', label: 'Cocina', campo: 'puede_ver_cocina' },
  { key: 'almacen', label: 'Almacén', campo: 'puede_ver_almacen' },
  { key: 'productos', label: 'Productos', campo: 'puede_ver_productos' },
  { key: 'agenda', label: 'Agenda', campo: 'puede_ver_agenda' },
  { key: 'convenios', label: 'Convenios', campo: 'puede_ver_convenios' },
  { key: 'caja', label: 'Caja (POS)', campo: 'puede_ver_caja' },
  { key: 'salon', label: 'Salón (mesas)', campo: 'puede_ver_salon' },
  // Estos dos no son módulos: son dos botones del POS. Antes había que dar
  // `ventas` o `finanzas` para prenderlos, y eso le devolvía al cajero la plata de
  // la otra casa (mig 196). El rótulo dice lo que pasa al tildarlos.
  { key: 'anular_ventas', label: 'Caja: anular una venta cobrada', campo: 'puede_anular_ventas' },
  {
    key: 'ver_esperado_caja',
    label: 'Caja: ver el esperado (saca el arqueo a ciegas)',
    campo: 'puede_ver_esperado_caja',
  },
  { key: 'integraciones', label: 'Integraciones (docs contador)', campo: 'puede_ver_integraciones' },
  { key: 'usuarios', label: 'Usuarios', campo: 'puede_ver_usuarios' },
];

// Presets de rol: al crear un usuario, pre-tildan los módulos típicos de cada
// puesto. NO incluyen es_admin (eso se tilda a mano en la tabla).
const PRESETS: {
  key: string;
  label: string;
  permisos: Partial<Record<keyof Perfil, boolean>>;
  local?: 'saavedra' | 'vedia';
}[] = [
  {
    key: 'cajero',
    label: 'Cajero (solo la caja)',
    // A propósito NO lleva nada más: el cajero cobra y cierra su arqueo, y no
    // tiene por qué ver finanzas, costos ni sueldos. La base lo acompaña —
    // con este permiso solo alcanza los arqueos y las ventas del POS
    // (migración 146).
    permisos: { puede_ver_caja: true },
    // ⚠️ A propósito SIN local: acá estaba clavado 'vedia' y el cajero de la
    // otra casa nacía cobrando en la casa equivocada, sin que saltara un error.
    // Ahora el alta obliga a elegirlo.
  },
  {
    key: 'control_cocina',
    label: 'Cocina / Control (ej. Vero)',
    permisos: {
      puede_ver_cocina: true,
      puede_ver_productos: true,
      puede_ver_almacen: true,
      puede_ver_dashboard: true,
    },
    local: 'saavedra',
  },
  {
    key: 'produccion',
    label: 'Producción (ej. Nico)',
    permisos: { puede_ver_cocina: true, puede_ver_productos: true },
    local: 'saavedra',
  },
  { key: 'ninguno', label: 'Sin permisos (configurar a mano)', permisos: {} },
];

export function UsuariosPage() {
  const { user: usuarioActual, perfil: perfilActual, refetchPerfil } = useAuth();
  const qc = useQueryClient();
  const [modalAbierto, setModalAbierto] = useState(false);

  const { data: perfiles, isLoading } = useQuery({
    queryKey: ['perfiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('perfiles').select('*').order('nombre');
      if (error) throw error;
      return data as Perfil[];
    },
  });

  const actualizar = useMutation({
    mutationFn: async (payload: { user_id: string; patch: Partial<Perfil> }) => {
      const { data, error } = await supabase
        .from('perfiles')
        .update(payload.patch)
        .eq('user_id', payload.user_id)
        .select('user_id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('No se actualizó ninguna fila (RLS?)');
    },
    onMutate: async ({ user_id, patch }) => {
      await qc.cancelQueries({ queryKey: ['perfiles'] });
      const previo = qc.getQueryData<Perfil[]>(['perfiles']);
      if (previo) {
        qc.setQueryData<Perfil[]>(
          ['perfiles'],
          previo.map((p) => (p.user_id === user_id ? { ...p, ...patch } : p)),
        );
      }
      return { previo };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.previo) qc.setQueryData(['perfiles'], ctx.previo);
      window.alert(`Error: ${e.message}`);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['perfiles'] });
      // Si el admin se modificó a sí mismo, refrescar su propio perfil para que el sidebar reaccione
      if (vars.user_id === usuarioActual?.id) refetchPerfil();
    },
  });

  // El local dejó de ser un dato de adorno: para un cajero decide qué plata ve
  // y en qué casa se anota lo que cobra. Antes solo se podía poner al crear el
  // usuario y corregirlo después era ir a la base a mano.
  //
  // ⚠️ Cambiarlo con la caja abierta le esconde su propio turno: el POS le
  // ofrece abrir uno nuevo y el viejo queda abierto para siempre con la plata
  // adentro, y solo lo destraba un administrador. Por eso se avisa antes.
  const cambiarLocal = (p: Perfil, valor: string) => {
    const nuevo = valor === '' ? null : (valor as 'saavedra' | 'vedia');
    if (nuevo === (p.local_restringido ?? null)) return;
    if (p.puede_ver_caja || p.es_admin) {
      const seguir = window.confirm(
        `Vas a cambiarle el local a ${p.nombre}.\n\n` +
          'Si tiene la caja abierta, cerrala ANTES de hacer esto: si no, el turno le desaparece ' +
          'de la pantalla, abre uno nuevo, y el viejo queda abierto con la plata adentro.\n\n' +
          '¿Seguimos?',
      );
      if (!seguir) return;
    }
    actualizar.mutate({ user_id: p.user_id, patch: { local_restringido: nuevo } });
  };

  // Resetear la contraseña de un usuario (vía edge function, requiere admin).
  const resetearPassword = async (p: Perfil) => {
    const nueva = window.prompt(`Nueva contraseña para "${p.nombre}" (mínimo 6 caracteres):`);
    if (!nueva) return;
    if (nueva.length < 6) {
      window.alert('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    const { data, error } = await supabase.functions.invoke('gestionar-usuario', {
      body: { accion: 'reset_password', user_id: p.user_id, password: nueva },
    });
    if (error || !(data as { ok?: boolean })?.ok) {
      window.alert(`Error: ${(data as { error?: string })?.error ?? error?.message ?? 'desconocido'}`);
      return;
    }
    window.alert(`Contraseña actualizada para ${p.nombre}.`);
  };

  return (
    <PageContainer title="Usuarios" subtitle="Gestión de accesos y permisos">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs text-gray-600">
          Creá el usuario acá con su rol; después podés ajustar los módulos en la tabla. El usuario
          entra con el email y la contraseña que le pongas.
        </p>
        {perfilActual?.es_admin && (
          <button
            onClick={() => setModalAbierto(true)}
            className="whitespace-nowrap rounded bg-rodziny-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rodziny-800"
          >
            + Crear usuario
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          Cargando...
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 text-left font-semibold">Usuario</th>
                  <th className="px-2 py-2 text-center font-semibold">Admin</th>
                  <th
                    className="whitespace-nowrap px-2 py-2 text-center font-semibold"
                    title="Ve las alertas financieras de supervisión en el Inicio (extractos, gastos/pagos fijos vencidos, conciliación). Independiente de cargar gastos."
                  >
                    Alertas finanzas
                  </th>
                  {MODULOS.map((m) => (
                    <th
                      key={m.key}
                      className="whitespace-nowrap px-2 py-2 text-center font-semibold"
                    >
                      {m.label}
                    </th>
                  ))}
                  {perfilActual?.es_admin && (
                    <th className="px-2 py-2 text-center font-semibold">Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {perfiles?.map((p) => {
                  const esYo = p.user_id === usuarioActual?.id;
                  return (
                    <tr
                      key={p.user_id}
                      className={cn('hover:bg-gray-50', esYo && 'bg-rodziny-50/30')}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium capitalize text-gray-900">{p.nombre}</div>
                        {esYo && <div className="text-[9px] text-rodziny-700">(vos)</div>}
                        {perfilActual?.es_admin ? (
                          <select
                            value={p.local_restringido ?? ''}
                            onChange={(e) => cambiarLocal(p, e.target.value)}
                            title="Con qué local trabaja. Para un cajero, esto decide qué plata ve y en qué casa se anota lo que cobra."
                            className="mt-1 rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px] text-gray-600"
                          >
                            <option value="">Los dos locales</option>
                            <option value="saavedra">Solo Saavedra</option>
                            <option value="vedia">Solo Vedia</option>
                          </select>
                        ) : (
                          p.local_restringido && (
                            <div className="text-[9px] capitalize text-gray-400">
                              solo {p.local_restringido}
                            </div>
                          )
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={p.es_admin}
                          disabled={esYo}
                          title={esYo ? 'No podés quitarte tus propios permisos de admin' : ''}
                          onChange={(e) =>
                            actualizar.mutate({
                              user_id: p.user_id,
                              patch: { es_admin: e.target.checked },
                            })
                          }
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={p.puede_ver_alertas_finanzas}
                          onChange={(e) =>
                            actualizar.mutate({
                              user_id: p.user_id,
                              patch: { puede_ver_alertas_finanzas: e.target.checked },
                            })
                          }
                          className="h-4 w-4"
                        />
                      </td>
                      {MODULOS.map((m) => (
                        <td key={m.key} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={p.es_admin || (p[m.campo] as boolean)}
                            disabled={p.es_admin}
                            title={p.es_admin ? 'Admin tiene todos los módulos' : ''}
                            onChange={(e) => {
                              // Un cajero sin local ve y cobra en las dos casas:
                              // la casilla no se prende hasta que tenga uno.
                              if (m.key === 'caja' && e.target.checked && !p.local_restringido) {
                                window.alert(
                                  `Antes de darle la Caja a ${p.nombre}, elegile un local acá al lado.\n\n` +
                                    'Un cajero sin local ve y cobra en las dos casas.',
                                );
                                return;
                              }
                              actualizar.mutate({
                                user_id: p.user_id,
                                patch: { [m.campo]: e.target.checked } as Partial<Perfil>,
                              });
                            }}
                            className="h-4 w-4"
                          />
                        </td>
                      ))}
                      {perfilActual?.es_admin && (
                        <td className="px-2 py-2 text-center">
                          <button
                            onClick={() => resetearPassword(p)}
                            className="whitespace-nowrap text-[11px] text-rodziny-700 hover:text-rodziny-900"
                          >
                            🔑 Contraseña
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalAbierto && (
        <CrearUsuarioModal
          onCerrar={() => setModalAbierto(false)}
          onCreado={() => {
            qc.invalidateQueries({ queryKey: ['perfiles'] });
            setModalAbierto(false);
          }}
        />
      )}
    </PageContainer>
  );
}

function CrearUsuarioModal({
  onCerrar,
  onCreado,
}: {
  onCerrar: () => void;
  onCreado: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [local, setLocal] = useState<'' | 'saavedra' | 'vedia'>('');
  const [presetKey, setPresetKey] = useState('control_cocina');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Al elegir un preset, sugiere su local (si lo tiene) sin pisar una elección previa.
  const elegirPreset = (key: string) => {
    setPresetKey(key);
    const preset = PRESETS.find((p) => p.key === key);
    if (preset?.local && !local) setLocal(preset.local);
  };

  const crear = async () => {
    if (!email.trim() || !password) {
      setError('Email y contraseña son obligatorios');
      return;
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    const preset = PRESETS.find((p) => p.key === presetKey);
    // El local de un cajero no es un dato de adorno: decide qué plata ve y en
    // qué casa se anota lo que cobra. Sin local ve y cobra en las dos.
    if (preset?.permisos.puede_ver_caja && !local) {
      setError('Un cajero necesita local: elegí Saavedra o Vedia. Sin local, ve y cobra en las dos casas.');
      return;
    }
    setGuardando(true);
    setError('');
    const { data, error: errInvoke } = await supabase.functions.invoke('gestionar-usuario', {
      body: {
        accion: 'crear',
        nombre: nombre.trim() || email.split('@')[0],
        email: email.trim(),
        password,
        local_restringido: local || undefined,
        permisos: preset?.permisos ?? {},
      },
    });
    if (errInvoke || !(data as { ok?: boolean })?.ok) {
      setError((data as { error?: string })?.error ?? errInvoke?.message ?? 'No se pudo crear');
      setGuardando(false);
      return;
    }
    onCreado();
  };

  const labelCls = 'mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500';
  const inputCls = 'w-full rounded border border-gray-300 px-3 py-2 text-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">Nuevo usuario</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Se crea el login y se le asigna el rol. Después podés afinar los módulos en la tabla.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className={labelCls}>Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={inputCls}
              placeholder="Vero"
              autoFocus
            />
          </div>
          <div>
            <label className={labelCls}>Email (con esto inicia sesión)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="vero@rodziny.com.ar"
            />
          </div>
          <div>
            <label className={labelCls}>Contraseña inicial</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              placeholder="mínimo 6 caracteres"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Rol (preset)</label>
              <select
                value={presetKey}
                onChange={(e) => elegirPreset(e.target.value)}
                className={inputCls}
              >
                {PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Local</label>
              <select
                value={local}
                onChange={(e) => setLocal(e.target.value as '' | 'saavedra' | 'vedia')}
                className={inputCls}
              >
                <option value="">Los dos locales</option>
                <option value="saavedra">Saavedra</option>
                <option value="vedia">Vedia</option>
              </select>
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCerrar}
            disabled={guardando}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={crear}
            disabled={guardando}
            className="rounded bg-rodziny-700 px-5 py-2 text-sm font-semibold text-white hover:bg-rodziny-800 disabled:opacity-50"
          >
            {guardando ? 'Creando...' : 'Crear usuario'}
          </button>
        </div>
      </div>
    </div>
  );
}
