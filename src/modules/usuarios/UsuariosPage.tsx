import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PageContainer } from '@/components/layout/PageContainer'
import { useAuth, type Perfil, type Modulo } from '@/lib/auth'
import { cn } from '@/lib/utils'

const MODULOS: { key: Modulo; label: string; campo: keyof Perfil }[] = [
  { key: 'dashboard', label: 'Dashboard', campo: 'puede_ver_dashboard' },
  { key: 'ventas', label: 'Ventas', campo: 'puede_ver_ventas' },
  { key: 'finanzas', label: 'Finanzas', campo: 'puede_ver_finanzas' },
  { key: 'edr', label: 'EdR', campo: 'puede_ver_edr' },
  { key: 'gastos', label: 'Gastos', campo: 'puede_ver_gastos' },
  { key: 'amortizaciones', label: 'Amortizaciones', campo: 'puede_ver_amortizaciones' },
  { key: 'rrhh', label: 'RRHH', campo: 'puede_ver_rrhh' },
  { key: 'compras', label: 'Compras', campo: 'puede_ver_compras' },
  { key: 'cocina', label: 'Cocina', campo: 'puede_ver_cocina' },
  { key: 'almacen', label: 'Almacén', campo: 'puede_ver_almacen' },
  { key: 'usuarios', label: 'Usuarios', campo: 'puede_ver_usuarios' },
]

export function UsuariosPage() {
  const { user: usuarioActual, refetchPerfil } = useAuth()
  const qc = useQueryClient()

  const { data: perfiles, isLoading } = useQuery({
    queryKey: ['perfiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('*')
        .order('nombre')
      if (error) throw error
      return data as Perfil[]
    },
  })

  const actualizar = useMutation({
    mutationFn: async (payload: { user_id: string; patch: Partial<Perfil> }) => {
      const { data, error } = await supabase
        .from('perfiles')
        .update(payload.patch)
        .eq('user_id', payload.user_id)
        .select('user_id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('No se actualizó ninguna fila (RLS?)')
    },
    onMutate: async ({ user_id, patch }) => {
      await qc.cancelQueries({ queryKey: ['perfiles'] })
      const previo = qc.getQueryData<Perfil[]>(['perfiles'])
      if (previo) {
        qc.setQueryData<Perfil[]>(
          ['perfiles'],
          previo.map((p) => (p.user_id === user_id ? { ...p, ...patch } : p)),
        )
      }
      return { previo }
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.previo) qc.setQueryData(['perfiles'], ctx.previo)
      window.alert(`Error: ${e.message}`)
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['perfiles'] })
      // Si el admin se modificó a sí mismo, refrescar su propio perfil para que el sidebar reaccione
      if (vars.user_id === usuarioActual?.id) refetchPerfil()
    },
  })

  return (
    <PageContainer title="Usuarios" subtitle="Gestión de accesos y permisos">
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 text-xs text-gray-600">
        <p className="font-semibold text-gray-800 mb-1">Cómo sumar un usuario nuevo</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Entrá a Supabase Dashboard → Authentication → Users → Add user.</li>
          <li>Cargá email (ej. <code>nombre@rodziny.com.ar</code>) y contraseña.</li>
          <li>Destildá "Auto confirm user" → activalo para que pueda ingresar de una.</li>
          <li>Volvé acá y marcá los módulos a los que tiene que tener acceso.</li>
        </ol>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400">
          Cargando...
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-[10px] uppercase text-gray-500 tracking-wide">
                  <th className="text-left px-3 py-2 font-semibold">Usuario</th>
                  <th className="text-center px-2 py-2 font-semibold">Admin</th>
                  {MODULOS.map((m) => (
                    <th key={m.key} className="text-center px-2 py-2 font-semibold whitespace-nowrap">{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {perfiles?.map((p) => {
                  const esYo = p.user_id === usuarioActual?.id
                  return (
                    <tr key={p.user_id} className={cn('hover:bg-gray-50', esYo && 'bg-rodziny-50/30')}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 capitalize">{p.nombre}</div>
                        {esYo && <div className="text-[9px] text-rodziny-700">(vos)</div>}
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
                          className="w-4 h-4"
                        />
                      </td>
                      {MODULOS.map((m) => (
                        <td key={m.key} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={p.es_admin || (p[m.campo] as boolean)}
                            disabled={p.es_admin}
                            title={p.es_admin ? 'Admin tiene todos los módulos' : ''}
                            onChange={(e) =>
                              actualizar.mutate({
                                user_id: p.user_id,
                                patch: { [m.campo]: e.target.checked } as Partial<Perfil>,
                              })
                            }
                            className="w-4 h-4"
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageContainer>
  )
}
