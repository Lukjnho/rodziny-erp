import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { Proveedor, CategoriaGasto, CondicionIVA, MedioPago } from './types';
import { MEDIO_PAGO_LABEL } from './types';
import { displayProveedor, ProveedorLabel } from './proveedorDisplay';

const CONDICIONES: { value: CondicionIVA; label: string }[] = [
  { value: 'responsable_inscripto', label: 'Responsable Inscripto' },
  { value: 'monotributo', label: 'Monotributo' },
  { value: 'exento', label: 'Exento' },
  { value: 'consumidor_final', label: 'Consumidor Final' },
];

const FORM_VACIO: Partial<Proveedor> = {
  razon_social: '',
  nombre_comercial: null,
  cuit: null,
  cuits_alt: [],
  aliases: [],
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

// Input de chips: el usuario escribe + Enter (o coma) para agregar, X para quitar.
// Usado para aliases (variantes del nombre) y cuits_alt (CUITs del titular destino).
function ChipsInput({
  value,
  onChange,
  placeholder,
  sanitize,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  sanitize?: (s: string) => string;
}) {
  const [draft, setDraft] = useState('');
  function add() {
    const limpio = (sanitize ? sanitize(draft) : draft.trim());
    if (!limpio) return;
    if (value.includes(limpio)) {
      setDraft('');
      return;
    }
    onChange([...value, limpio]);
    setDraft('');
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-gray-300 bg-white px-2 py-1.5">
      {value.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-1 rounded bg-rodziny-50 px-2 py-0.5 text-xs text-rodziny-800"
        >
          {v}
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-rodziny-500 hover:text-rodziny-800"
            title="Quitar"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            remove(value.length - 1);
          }
        }}
        onBlur={add}
        placeholder={value.length === 0 ? placeholder : ''}
        className="min-w-[120px] flex-1 border-0 bg-transparent text-sm focus:outline-none"
      />
    </div>
  );
}

// CUIT: dejamos solo dígitos y guiones para que matchee tal cual aparece en el extracto.
function sanitizeCuit(s: string): string {
  return s.trim().replace(/[^0-9-]/g, '');
}

export function ProveedoresPanel() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [editando, setEditando] = useState<Partial<Proveedor> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [mensajeImport, setMensajeImport] = useState<string | null>(null);

  // Fusión de duplicados
  const [fusionAbierta, setFusionAbierta] = useState(false);
  const [idMantener, setIdMantener] = useState('');
  const [idEliminar, setIdEliminar] = useState('');
  const [fusionando, setFusionando] = useState(false);
  const [errorFusion, setErrorFusion] = useState<string | null>(null);

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
      qc.invalidateQueries({ queryKey: ['proveedores_display_map'] });
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

  // Cuántos gastos quedarían re-apuntados al fusionar (preview de la fusión).
  const { data: gastosAEliminar } = useQuery({
    queryKey: ['proveedor_gastos_count', idEliminar],
    enabled: fusionAbierta && !!idEliminar,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('gastos')
        .select('id', { count: 'exact', head: true })
        .eq('proveedor_id', idEliminar);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const provMantener = (proveedores ?? []).find((p) => p.id === idMantener) ?? null;
  const provEliminar = (proveedores ?? []).find((p) => p.id === idEliminar) ?? null;

  function abrirFusion() {
    setIdMantener('');
    setIdEliminar('');
    setErrorFusion(null);
    setFusionAbierta(true);
  }

  async function fusionar() {
    setErrorFusion(null);
    if (!idMantener || !idEliminar) {
      setErrorFusion('Elegí los dos proveedores a fusionar.');
      return;
    }
    if (idMantener === idEliminar) {
      setErrorFusion('No se puede fusionar un proveedor consigo mismo.');
      return;
    }
    if (
      !window.confirm(
        `Vas a fusionar:\n\n` +
          `• Se MANTIENE: ${provMantener?.razon_social}\n` +
          `• Se ELIMINA: ${provEliminar?.razon_social}\n\n` +
          `${gastosAEliminar ?? 0} gasto(s) pasarán al proveedor que se mantiene y el duplicado se borrará. Esta acción no se puede deshacer.\n\n¿Confirmás?`,
      )
    )
      return;
    setFusionando(true);
    try {
      const { error } = await supabase.rpc('fusionar_proveedores', {
        p_mantener: idMantener,
        p_eliminar: idEliminar,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['proveedores'] });
      qc.invalidateQueries({ queryKey: ['proveedores_display_map'] });
      setFusionAbierta(false);
      setMensajeImport(
        `✓ Proveedores fusionados: "${provEliminar?.razon_social}" se unió a "${provMantener?.razon_social}".`,
      );
    } catch (e: any) {
      setErrorFusion(e.message ?? 'Error al fusionar');
    } finally {
      setFusionando(false);
    }
  }

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
        nombre_comercial: editando.nombre_comercial?.trim() || null,
        cuit: editando.cuit?.trim() || null,
        cuits_alt: (editando.cuits_alt ?? []).filter((c) => c.trim().length > 0),
        aliases: (editando.aliases ?? []).filter((a) => a.trim().length > 0),
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
      qc.invalidateQueries({ queryKey: ['proveedores_display_map'] });
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
          onClick={abrirFusion}
          className="ml-auto rounded-md border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
          title="Combinar dos registros que son el mismo proveedor en uno solo"
        >
          🔗 Fusionar duplicados
        </button>
        <button
          onClick={importarDesdeHistorico}
          disabled={importando}
          className="rounded-md border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
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
              <th className="px-3 py-2 text-left font-semibold">Proveedor</th>
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
                <td className="px-3 py-2 font-medium text-gray-900">
                  <ProveedorLabel value={displayProveedor(p) ?? { principal: '—', secundario: null }} />
                </td>
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

      {/* Modal fusión de duplicados */}
      {fusionAbierta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="font-semibold text-gray-900">🔗 Fusionar proveedores duplicados</h3>
              <button
                onClick={() => setFusionAbierta(false)}
                className="text-xl leading-none text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-xs text-gray-500">
                Combiná dos registros que son el mismo proveedor. Los gastos del que se elimina
                pasan al que se mantiene, y sus CUITs/aliases se conservan para la conciliación.
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Proveedor que se MANTIENE
                </label>
                <select
                  value={idMantener}
                  onChange={(e) => setIdMantener(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— Elegir —</option>
                  {(proveedores ?? []).map((p) => (
                    <option key={p.id} value={p.id} disabled={p.id === idEliminar}>
                      {displayProveedor(p)?.principal ?? p.razon_social}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Proveedor que se ELIMINA (se fusiona en el de arriba)
                </label>
                <select
                  value={idEliminar}
                  onChange={(e) => setIdEliminar(e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— Elegir —</option>
                  {(proveedores ?? []).map((p) => (
                    <option key={p.id} value={p.id} disabled={p.id === idMantener}>
                      {displayProveedor(p)?.principal ?? p.razon_social}
                    </option>
                  ))}
                </select>
              </div>
              {provMantener && provEliminar && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <strong>{gastosAEliminar ?? '…'}</strong> gasto(s) de “
                  {displayProveedor(provEliminar)?.principal}” pasarán a “
                  {displayProveedor(provMantener)?.principal}”. El registro “
                  {provEliminar.razon_social}” se eliminará. <strong>No se puede deshacer.</strong>
                </div>
              )}
              {errorFusion && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {errorFusion}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button
                onClick={() => setFusionAbierta(false)}
                disabled={fusionando}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={fusionar}
                disabled={fusionando || !idMantener || !idEliminar}
                className="rounded bg-rodziny-700 px-4 py-2 text-sm font-medium text-white hover:bg-rodziny-800 disabled:bg-gray-300"
              >
                {fusionando ? 'Fusionando…' : 'Fusionar'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                    Razón social * <span className="text-gray-400">(como factura)</span>
                  </label>
                  <input
                    value={editando.razon_social ?? ''}
                    onChange={(e) => setEditando({ ...editando, razon_social: e.target.value })}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Nombre comercial <span className="text-gray-400">(con el que lo conocemos)</span>
                  </label>
                  <input
                    value={editando.nombre_comercial ?? ''}
                    onChange={(e) =>
                      setEditando({ ...editando, nombre_comercial: e.target.value })
                    }
                    placeholder="ej: Miliana Fiambrería"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    CUIT <span className="text-gray-400">(fiscal)</span>
                  </label>
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
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Aliases <span className="text-gray-400">(cómo aparece en el extracto)</span>
                  </label>
                  <ChipsInput
                    value={editando.aliases ?? []}
                    onChange={(next) => setEditando({ ...editando, aliases: next })}
                    placeholder="ej: Mendoza Juan Carlos, MILIANA FIAM, …  (Enter para agregar)"
                  />
                  <p className="mt-1 text-[10px] text-gray-500">
                    Agregá variantes del nombre con que aparece este proveedor en los movimientos
                    bancarios. Sirve para auto-vincular.
                  </p>
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    CUITs alternativos{' '}
                    <span className="text-gray-400">(titular de la cuenta destino)</span>
                  </label>
                  <ChipsInput
                    value={editando.cuits_alt ?? []}
                    onChange={(next) => setEditando({ ...editando, cuits_alt: next })}
                    placeholder="ej: 20-12345678-9  (Enter para agregar)"
                    sanitize={sanitizeCuit}
                  />
                  <p className="mt-1 text-[10px] text-gray-500">
                    Si le transferís a una cuenta a nombre de otra persona (ej: el dueño en lugar de
                    la SRL), agregá ese CUIT acá. La conciliación lo va a matchear automáticamente
                    cuando aparezca en el extracto.
                  </p>
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
