// Display canónico de proveedor — fuente única de verdad para TODO el ERP.
//
// Problema que resuelve: cada pantalla mostraba un campo distinto del mismo
// proveedor (razón social en una, nombre comercial en otra, texto crudo del
// gasto en otra) → se veía desordenado y "duplicado" cuando en realidad era el
// mismo registro (ej: "Frigorifico Pete SRL" == "Carniceria La Esperanza").
//
// Regla decidida con Lucas (jun 2026):
//   principal  = nombre comercial si existe, si no la razón social.
//   secundario = razón social, SOLO cuando difiere del principal (línea gris).
// Nunca mostrar el texto crudo `gastos.proveedor` cuando hay proveedor_id.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export interface ProveedorNombre {
  razon_social?: string | null;
  nombre_comercial?: string | null;
}

export interface ProveedorDisplay {
  principal: string; // lo que se muestra grande
  secundario: string | null; // razón social en gris debajo (cuando difiere)
}

// Calcula el display canónico a partir de un registro maestro de proveedor.
// Devuelve null si no hay ningún nombre cargado.
export function displayProveedor(p?: ProveedorNombre | null): ProveedorDisplay | null {
  const comercial = p?.nombre_comercial?.trim() || '';
  const razon = p?.razon_social?.trim() || '';
  if (!comercial && !razon) return null;
  const principal = comercial || razon;
  const secundario =
    comercial && razon && comercial.toLowerCase() !== razon.toLowerCase() ? razon : null;
  return { principal, secundario };
}

export interface ProveedorMapInfo extends ProveedorDisplay {
  // Razón + comercial + aliases en minúsculas, unidos por ' | '. Espacio de
  // búsqueda: así buscar "MACLAR" matchea gastos cargados como "FRESH Dist.".
  nombres: string;
}

export type ProveedoresMap = Map<string, ProveedorMapInfo>;

// Hook compartido: mapa proveedor_id → display canónico + espacio de búsqueda.
// Reemplaza los queries locales duplicados que había en cada módulo.
export function useProveedoresMap(opts?: { enabled?: boolean }) {
  return useQuery<ProveedoresMap>({
    queryKey: ['proveedores_display_map'],
    enabled: opts?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proveedores')
        .select('id, razon_social, nombre_comercial, aliases');
      if (error) throw error;
      const map: ProveedoresMap = new Map();
      for (const p of data ?? []) {
        const disp = displayProveedor(p);
        if (!disp) continue;
        const nombres = [
          p.razon_social,
          p.nombre_comercial,
          ...(((p.aliases as string[] | null) ?? []) as string[]),
        ]
          .filter(Boolean)
          .map((s) => (s as string).toLowerCase())
          .join(' | ');
        map.set(p.id as string, { ...disp, nombres });
      }
      return map;
    },
  });
}

export interface ConProveedor {
  proveedor?: string | null; // texto crudo legacy
  proveedor_id?: string | null; // FK al registro maestro
}

// Resuelve el display de cualquier objeto con proveedor/proveedor_id.
// - Con proveedor_id vinculado → usa el registro maestro (canónico).
// - Sin vincular → cae al texto crudo `proveedor`.
export function resolverProveedor(
  g: ConProveedor,
  map?: ProveedoresMap | null,
  fallbackVacio = '(Sin proveedor)',
): ProveedorDisplay {
  if (g.proveedor_id && map) {
    const info = map.get(g.proveedor_id);
    if (info) return { principal: info.principal, secundario: info.secundario };
  }
  const crudo = g.proveedor?.trim() || '';
  return { principal: crudo || fallbackVacio, secundario: null };
}

// Solo el nombre principal (string) — para lugares donde no se puede renderizar
// dos líneas (agrupar, filtros, opciones de <select>, comparaciones).
export function nombreProveedor(
  g: ConProveedor,
  map?: ProveedoresMap | null,
  fallbackVacio = '(Sin proveedor)',
): string {
  return resolverProveedor(g, map, fallbackVacio).principal;
}

// Espacio de búsqueda (minúsculas) de un objeto con proveedor: texto crudo +
// todos los nombres del registro maestro (razón + comercial + aliases).
export function proveedorSearchSpace(g: ConProveedor, map?: ProveedoresMap | null): string {
  const partes: string[] = [];
  if (g.proveedor) partes.push(g.proveedor.toLowerCase());
  if (g.proveedor_id && map) {
    const info = map.get(g.proveedor_id);
    if (info) partes.push(info.nombres);
  }
  return partes.join(' | ');
}

// Componente de display: principal + razón social en gris debajo.
// `compact` → una sola línea con la razón social como tooltip (para tablas densas).
export function ProveedorLabel({
  value,
  compact = false,
  className,
}: {
  value: ProveedorDisplay;
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <span className={className} title={value.secundario ?? undefined}>
        {value.principal}
      </span>
    );
  }
  return (
    <span className={cn('flex flex-col leading-tight', className)}>
      <span>{value.principal}</span>
      {value.secundario && (
        <span className="text-[11px] font-normal text-gray-400">{value.secundario}</span>
      )}
    </span>
  );
}
