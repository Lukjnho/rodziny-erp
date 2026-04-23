import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { Proveedor, CategoriaGasto, CondicionIVA, MedioPago } from './types';
import { MEDIO_PAGO_LABEL } from './types';

const CONDICIONES: { value: CondicionIVA; label: string }[] = [
  { value: 'responsable_inscripto', label: 'Responsable Inscripto' },
  { value: 'monotributo', label: 'Monotributo' },
  { value: 'exento', label: 'Exento' },
  { value: 'consumidor_final', label: 'Consumidor Final' },
];

const FORM_VACIO: Partial<Proveedor> = {
  razon_social: '',
  cuit: null,
  condicion_iva: 'responsable_inscripto',
  categoria_default_id: null,
  medio_pago_default: 'transferencia_mp',
  dias_pago: 0,
  contacto: null,
  telefono: null,
  email: null,
  activo: true,
  notas: null,
};

export function ProveedoresPanel() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [editando, setEditando] = useState<Partial<Proveedor> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [mensajeImport, setMensajeImport] = useState<string | null>(null);

  async function importarDesdeHistorico() {
    setImportando(true);
    setMensajeImport(null);
    setError(null);
    try {
      // 1) Traer proveedores únicos de gastos (histórico de Fudo) y de productos
      const [{ data: gastosData }, { data: productosData }, { data: existentes }] =
        await Promise.all([
          supabase
            .from('gastos')
            .select('proveedor')
            .neq('cancelado', true)
            .not('proveedor', 'is', null),
          supabase.from('productos').select('proveedor').not('proveedor', 'is', null),
          supabase.from('proveedores').select('razon_social'),
        ]);

      const norm = (s: string) =>
        s
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();
      const yaExistentes = new Set((existentes ?? []).map((p) => norm(p.razon_social)));

      // 2) Armar set único sacando vacíos, deduplicando case-insensitive
      const candidatos = new Map<string, string>(); // normalized → original
      for (const g of gastosData ?? []) {
        const p = (g.proveedor ?? '').trim();
        if (p && !yaExistentes.has(norm(p)) && !candidatos.has(norm(p))) {
          candidatos.set(norm(p), p);
        }
      }
      for (const p of productosData ?? []) {
        const name = (p.proveedor ?? '').trim();
        if (name && !yaExistentes.has(norm(name)) && !candidatos.has(norm(name))) {
          candidatos.set(norm(name), name);
        }
      }

      if (candidatos.size === 0) {
        setMensajeImport('No se encontraron proveedores nuevos para importar.');
        return;
      }

      // 3) Insertar en batch
      const rows = Array.from(candidatos.values()).map((razon_social) => ({
        razon_social,
        activo: true,
        condicion_iva: 'responsable_inscripto' as const,
      }));
      const { error: errIns } = await supabase.from('proveedores').insert(rows);
      if (errIns) throw errIns;

      qc.invalidateQueries({ queryKey: ['proveedores'] });
      setMensajeImport(
        `✓ Se importaron ${rows.length} proveedor${rows.length !== 1 ? 'es' : ''} nuevos. Editalos para completar CUIT, condición IVA, etc.`,
      );
    } catch (e: any) {
      setError(e.message ?? 'Error al importar');
    } finally {
      setImportando(false);
    }
  }

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: async () => {
      const { data, error } = await supabase.from('proveedores').select('*').order('razon_social');
      if (error) throw error;
      return (data ?? []) as Proveedor[];
    },
  });

  const { data: categorias } = useQuery({
    queryKey: ['categorias_gasto'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categorias_gasto')
        .select('*')
        .eq('activo', true)
        .order('orden');
      if (error) throw error;
      return (data ?? []) as CategoriaGasto[];
    },
  });

  const filtrados = useMemo(() => {
    let lista = proveedores ?? [];
    if (!verInactivos) lista = lista.filter((p) => p.activo);
    if (filtro.trim()) {
      const f = filtro
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      lista = lista.filter((p) => {
        const blob = `${p.razon_social} ${p.cuit ?? ''} ${p.contacto ?? ''}`
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        return blob.includes(f);
      });
    }
    return lista;
  }, [proveedores, filtro, verInactivos]);

  async function guardar() {
    if (!editando) return;
    setError(null);
    const razon = (editando.razon_social ?? '').trim();
    if (!razon) {
      setError('Razón social requerida');
      return;
    }
    setGuardando(true);
    try {
      const payload = {
        razon_social: razon,
        cuit: editando.cuit?.trim() || null,
        condicion_iva: editando.condicion_iva ?? null,
        categoria_default_id: editando.categoria_default_id ?? null,
        medio_pago_default: editando.medio_pago_default ?? null,
        dias_pago: editando.dias_pago ?? 0,
        contacto: editando.contacto?.trim() || null,
        telefono: editando.telefono?.trim() || null,
        email: editando.email?.trim() || null,
        activo: editando.activo ?? true,
        notas: editando.notas?.trim() || null,
        updated_at: new Date().toISOString(),
      };
      let res;
      if (editando.id) {
        res = await supabase.from('proveedores').update(payload).eq('id', editando.id);
      } else {
        res = await supabase.from('proveedores').insert(payload);
      }
      if (res.error) throw res.error;
      qc.invalidateQueries({ queryKey: ['proveedores'] });
      setEditando(null);
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo(p: Proveedor) {
    await supabase
      .from('proveedores')
      .update({ activo: !p.activo, updated_at: new Date().toISOString() })
      .eq('id', p.id);
    qc.invalidateQueries({ queryKey: ['proveedores'] });
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por razón social, CUIT o contacto..."
          className="min-w-[240px] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-rodziny-500"
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={verInactivos}
            onChange={(e) => setVerInactivos(e.target.checked)}
          />
          Ver inactivos
        </label>
        <button
          onClick={importarDesdeHistorico}
          disabled={importando}
          className="ml-auto rounded-md border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          title="Crea proveedores a partir de los nombres que aparecen en gastos y productos"
        >
          {importando ? 'Importando…' : '📥 Importar desde histórico'}
        </button>
        <button
          onClick={() => setEditando({ ...FORM_VACIO })}
          className="rounded-md bg-rodziny-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rodziny-800"
        >
          + Nuevo proveedor
        </button>
      </div>
      {mensajeImport && (
        <div className="mb-3 flex items-center justify-between rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          <span>{mensajeImport}</span>
          <button
            onClick={() => setMensajeImport(null)}
            className="text-lg leading-none text-green-600 hover:text-green-800"
          >
            ×
          </button>
        </div>
      )}
      {error && !editando && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-surface-border bg-white">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr className="uppercase text-gray-500">
              <th className="px-3 py-2 text-left font-semibold">Razón social</th>
              <th className="px-3 py-2 text-left font-semibold">CUIT</th>
              <th className="px-3 py-2 text-left font-semibold">Condición IVA</th>
              <th className="px-3 py-2 text-left font-semibold">Medio pago</th>
              <th className="px-3 py-2 text-right font-semibold">Días pago</th>
              <th className="px-3 py-2 text-left font-semibold">Contacto</th>
              <th className="px-3 py-2 text-center font-semibold">Activo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                  {proveedores ? 'Sin proveedores cargados' : 'Cargando...'}
                </td>
              </tr>
            )}
            {filtrados.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-900">{p.razon_social}</td>
                <td className="px-3 py-2 text-gray-600">{p.cuit || '—'}</td>
                <td className="px-3 py-2 text-gray-600">
                  {CONDICIONES.find((c) => c.value === p.condicion_iva)?.label || '—'}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {p.medio_pago_default ? MEDIO_PAGO_LABEL[p.medio_pago_default as MedioPago] : '—'}
                </td>
                <td className="px-3 py-2 text-right text-gray-600">{p.dias_pago || 0}</td>
                <td className="px-3 py-2 text-gray-600">{p.contacto || '—'}</td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => toggleActivo(p)}
                    className={cn(
                      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                      p.activo ? 'bg-rodziny-600' : 'bg-gray-300',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                        p.activo ? 'translate-x-5' : 'translate-x-1',
                      )}
                    />
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setEditando({ ...p })}
                    className="text-xs text-rodziny-700 hover:underline"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal edición */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="font-semibold text-gray-900">
                {editando.id ? 'Editar proveedor' : 'Nuevo proveedor'}
              </h3>
              <button
                onClick={() => setEditando(null)}
                className="text-xl leading-none text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Razón social *
                  </label>
                  <input
                    value={editando.razon_social ?? ''}
                    onChange={(e) => setEditando({ ...editando, razon_social: e.target.value })}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">CUIT</label>
                  <input
                    value={editando.cuit ?? ''}
                    onChange={(e) => setEditando({ ...editando, cuit: e.target.value })}
                    placeholder="20-12345678-9"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Condición IVA
                  </label>
                  <select
                    value={editando.condicion_iva ?? ''}
                    onChange={(e) =>
                      setEditando({
                        ...editando,
                        condicion_iva: (e.target.value || null) as CondicionIVA | null,
                      })
                    }
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {CONDICIONES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Categoría default
                  </label>
                  <select
                    value={editando.categoria_default_id ?? ''}
                    onChange={(e) =>
                      setEditando({ ...editando, categoria_default_id: e.target.value || null })
                    }
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {(categorias ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Medio de pago default
                  </label>
                  <select
                    value={editando.medio_pago_default ?? ''}
                    onChange={(e) =>
                      setEditando({
                        ...editando,
                        medio_pago_default: (e.target.value || null) as MedioPago | null,
                      })
                    }
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {Object.entries(MEDIO_PAGO_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Días de pago habituales
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editando.dias_pago ?? 0}
                    onChange={(e) =>
                      setEditando({ ...editando, dias_pago: parseInt(e.target.value) || 0 })
                    }
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Contacto</label>
                  <input
                    value={editando.contacto ?? ''}
                    onChange={(e) => setEditando({ ...editando, contacto: e.target.value })}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Teléfono</label>
                  <input
                    value={editando.telefono ?? ''}
                    onChange={(e) => setEditando({ ...editando, telefono: e.target.value })}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Email</label>
                  <input
                    value={editando.email ?? ''}
                    onChange={(e) => setEditando({ ...editando, email: e.target.value })}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Notas</label>
                  <textarea
                    value={editando.notas ?? ''}
                    onChange={(e) => setEditando({ ...editando, notas: e.target.value })}
                    rows={2}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button
                onClick={() => setEditando(null)}
                disabled={guardando}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando}
                className="rounded bg-rodziny-700 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-800 disabled:bg-gray-300"
              >
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
