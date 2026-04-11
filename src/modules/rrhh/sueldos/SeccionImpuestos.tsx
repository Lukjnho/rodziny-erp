import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { cn, formatARS } from '@/lib/utils'
import type { ImpuestoMensual } from './tipos'

const BUCKET = 'sueldos-docs'

interface Props {
  periodoMes: string // 'YYYY-MM'
}

export function SeccionImpuestos({ periodoMes }: Props) {
  const qc = useQueryClient()
  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState<'f931' | 'libro' | null>(null)

  const { data: impuesto } = useQuery({
    queryKey: ['impuestos_mensuales', periodoMes],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('impuestos_mensuales')
        .select('*')
        .eq('periodo', periodoMes)
        .maybeSingle()
      if (error) throw error
      return data as ImpuestoMensual | null
    },
  })

  async function upsertCampos(patch: Partial<ImpuestoMensual>) {
    const { error } = await supabase
      .from('impuestos_mensuales')
      .upsert({ periodo: periodoMes, ...patch }, { onConflict: 'periodo' })
    if (error) throw error
    qc.invalidateQueries({ queryKey: ['impuestos_mensuales', periodoMes] })
  }

  const subirPdf = async (tipo: 'f931' | 'libro', file: File) => {
    if (file.type !== 'application/pdf') {
      window.alert('Solo PDFs')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      window.alert('Máximo 10MB')
      return
    }
    setGuardando(tipo)
    try {
      const path = `${periodoMes}/${tipo}_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: 'application/pdf', upsert: false })
      if (upErr) throw upErr
      // Borrar el anterior si había
      const pathAnterior = tipo === 'f931' ? impuesto?.f931_path : impuesto?.libro_path
      if (pathAnterior) {
        await supabase.storage.from(BUCKET).remove([pathAnterior])
      }
      await upsertCampos({ [tipo === 'f931' ? 'f931_path' : 'libro_path']: path } as Partial<ImpuestoMensual>)
    } catch (e) {
      window.alert(`Error: ${(e as Error).message}`)
    } finally {
      setGuardando(null)
    }
  }

  const verPdf = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60)
    if (error) {
      window.alert(`Error al generar link: ${error.message}`)
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  const borrarPdf = async (tipo: 'f931' | 'libro') => {
    const path = tipo === 'f931' ? impuesto?.f931_path : impuesto?.libro_path
    if (!path) return
    if (!window.confirm(`¿Borrar ${tipo === 'f931' ? 'F931' : 'libro de sueldos'}?`)) return
    try {
      await supabase.storage.from(BUCKET).remove([path])
      await upsertCampos({ [tipo === 'f931' ? 'f931_path' : 'libro_path']: null } as Partial<ImpuestoMensual>)
    } catch (e) {
      window.alert(`Error: ${(e as Error).message}`)
    }
  }

  const toggleMonto = useMutation({
    mutationFn: async (monto: number) => upsertCampos({ monto_total: monto }),
  })

  const togglePagado = useMutation({
    mutationFn: async (pagado: boolean) => upsertCampos({ pagado, fecha_pago: pagado ? new Date().toISOString().slice(0, 10) : null }),
  })

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">Impuestos y documentos del mes</span>
          <span className="text-xs text-gray-500">{periodoMes}</span>
          {impuesto?.pagado && (
            <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              Pagado
            </span>
          )}
          {impuesto && !impuesto.pagado && Number(impuesto.monto_total) > 0 && (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              Pendiente
            </span>
          )}
        </div>
        <span className="text-gray-400 text-sm">{abierto ? '▾' : '▸'}</span>
      </button>

      {abierto && (
        <div className="px-4 pt-2 pb-4 border-t border-gray-100 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <DocCard
              titulo="F931 (ARCA)"
              path={impuesto?.f931_path || null}
              guardando={guardando === 'f931'}
              onSubir={(f) => subirPdf('f931', f)}
              onVer={() => impuesto?.f931_path && verPdf(impuesto.f931_path)}
              onBorrar={() => borrarPdf('f931')}
            />
            <DocCard
              titulo="Libro de sueldos"
              path={impuesto?.libro_path || null}
              guardando={guardando === 'libro'}
              onSubir={(f) => subirPdf('libro', f)}
              onVer={() => impuesto?.libro_path && verPdf(impuesto.libro_path)}
              onBorrar={() => borrarPdf('libro')}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-gray-100">
            <div>
              <label className="text-[10px] uppercase text-gray-500 font-medium tracking-wide">Monto a pagar (ARCA)</label>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={impuesto?.monto_total ? String(impuesto.monto_total) : ''}
                onBlur={(e) => {
                  const n = parseFloat(e.target.value.replace(',', '.')) || 0
                  if (n !== Number(impuesto?.monto_total || 0)) toggleMonto.mutate(n)
                }}
                placeholder="0"
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
              <p className="text-[10px] text-gray-500 mt-1">{formatARS(Number(impuesto?.monto_total || 0))}</p>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!impuesto?.pagado}
                  onChange={(e) => togglePagado.mutate(e.target.checked)}
                  className="w-4 h-4"
                />
                Pagado en ARCA {impuesto?.fecha_pago && <span className="text-gray-400">· {impuesto.fecha_pago}</span>}
              </label>
            </div>
            <div className="text-[10px] text-gray-400 flex items-end">
              Estos montos alimentan el módulo Finanzas (próximamente).
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DocCard({
  titulo,
  path,
  guardando,
  onSubir,
  onVer,
  onBorrar,
}: {
  titulo: string
  path: string | null
  guardando: boolean
  onSubir: (f: File) => void
  onVer: () => void
  onBorrar: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const nombre = path?.split('/').pop() || null
  return (
    <div
      className={cn(
        'border rounded-lg p-3',
        path ? 'border-gray-200 bg-gray-50' : 'border-dashed border-gray-300',
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-700">{titulo}</span>
        {path && <span className="text-[10px] text-green-700">✓ Cargado</span>}
      </div>
      {path ? (
        <div className="space-y-2">
          <div className="text-[11px] text-gray-500 truncate">{nombre}</div>
          <div className="flex gap-2">
            <button
              onClick={onVer}
              className="flex-1 bg-rodziny-700 hover:bg-rodziny-800 text-white rounded px-2 py-1 text-[11px]"
            >
              Ver
            </button>
            <button
              onClick={() => inputRef.current?.click()}
              disabled={guardando}
              className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded px-2 py-1 text-[11px] disabled:opacity-50"
            >
              {guardando ? '…' : 'Reemplazar'}
            </button>
            <button
              onClick={onBorrar}
              className="text-red-600 hover:text-red-700 text-[11px] px-2"
            >
              Borrar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={guardando}
          className="w-full border border-dashed border-gray-300 hover:border-rodziny-500 hover:bg-white rounded py-3 text-xs text-gray-500 disabled:opacity-50"
        >
          {guardando ? 'Subiendo…' : '+ Subir PDF'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onSubir(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
