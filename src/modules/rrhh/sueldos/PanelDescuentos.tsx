import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatARS } from '@/lib/utils'
import { ymd } from '../utils'
import type { Descuento } from './tipos'
import type { Empleado } from '../RRHHPage'

interface Props {
  empleado: Empleado
  periodo: string
  descuentos: Descuento[]
  onClose: () => void
}

export function PanelDescuentos({ empleado, periodo, descuentos, onClose }: Props) {
  const qc = useQueryClient()
  const [fecha, setFecha] = useState(ymd(new Date()))
  const [monto, setMonto] = useState('')
  const [motivo, setMotivo] = useState('')

  const agregar = useMutation({
    mutationFn: async () => {
      const n = parseFloat(monto.replace(',', '.'))
      if (!n || n <= 0) throw new Error('Ingresá un monto válido')
      if (!motivo.trim()) throw new Error('El motivo es obligatorio (ej: día sin goce, licencia no remunerada)')
      const { error } = await supabase.from('descuentos').insert({
        empleado_id: empleado.id,
        periodo,
        fecha,
        monto: n,
        motivo: motivo.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['descuentos'] })
      setMonto('')
      setMotivo('')
    },
    onError: (e: Error) => window.alert(e.message),
  })

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('descuentos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['descuentos'] }),
  })

  const total = descuentos.reduce((s, a) => s + Number(a.monto), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30">
      <div
        className="mt-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Descuentos eventuales</h3>
            <p className="text-xs text-gray-500">{empleado.nombre} {empleado.apellido} · {periodo}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Días sin goce, licencias no remuneradas, etc.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-xs uppercase text-gray-500 tracking-wide">Total a descontar</span>
            <span className="text-lg font-bold text-orange-700">{formatARS(total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs"
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder="Monto"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs"
            />
          </div>
          <textarea
            placeholder="Motivo (obligatorio) — ej: día sin goce 20/04"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            className="mt-2 w-full border border-gray-300 rounded px-2 py-1.5 text-xs resize-none"
          />
          <button
            onClick={() => agregar.mutate()}
            disabled={agregar.isPending}
            className="mt-2 w-full bg-orange-700 hover:bg-orange-800 text-white rounded py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {agregar.isPending ? 'Guardando…' : '+ Agregar descuento'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {descuentos.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-gray-400">Sin descuentos cargados</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {[...descuentos]
                .sort((a, b) => b.fecha.localeCompare(a.fecha))
                .map((d) => (
                  <li key={d.id} className="px-5 py-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{formatARS(Number(d.monto))}</div>
                      <div className="text-xs text-gray-500">{d.fecha}</div>
                      <div className="text-xs text-gray-700 mt-0.5 whitespace-pre-wrap">{d.motivo}</div>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm('¿Borrar este descuento?')) borrar.mutate(d.id)
                      }}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      Borrar
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
