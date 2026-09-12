import { useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { guardarContando } from '@/lib/escribir';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn, formatARS } from '@/lib/utils';
import { normalizarTexto } from '@/modules/rrhh/utils';
import { hoyAR } from '@/lib/fechaAR';
import { sha256File } from '@/lib/hashFile';

// ── Tipos ──────────────────────────────────────────────────────────────────
interface EmpleadoMin {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
}

interface ReciboOcr {
  empleado_nombre: string | null;
  cuil: string | null;
  periodo: string | null;
  neto: number | null;
  bruto: number | null;
  aporte_jubilacion: number | null;
  aporte_obra_social: number | null;
  aporte_pami: number | null;
  total_aportes: number | null;
  pagina: number | null;
}
interface DatosOcr {
  tipo: 'recibo' | 'vep' | 'desconocido';
  recibos?: ReciboOcr[];
  vep?: {
    impuesto: string | null;
    periodo: string | null;
    vencimiento: string | null;
    fecha_pago: string | null;
    monto: number | null;
    numero: string | null;
  } | null;
  descripcion?: string | null;
  confianza?: number;
}

interface ReciboRow {
  id: string;
  empleado_id: string | null;
  cuil_detectado: string | null;
  nombre_detectado: string | null;
  periodo: string | null;
  monto_neto: number | null;
  archivo_path: string;
  created_at: string;
}

type ItemProc = {
  id: string;
  nombre: string;
  estado: 'subiendo' | 'analizando' | 'ok' | 'error';
  resultado?: string;
  tipo?: DatosOcr['tipo'];
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function soloDigitos(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}
// DNI a partir del CUIL (11 dígitos): los 8 del medio, sin ceros a la izquierda.
function dniDeCuil(cuil: string | null): string {
  const d = soloDigitos(cuil);
  if (d.length < 11) return '';
  const medio = d.slice(2, 10);
  const n = Number(medio);
  return Number.isFinite(n) ? String(n) : '';
}
function normDni(dni: string | null): string {
  const n = Number(soloDigitos(dni));
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

async function abrirArchivo(path: string) {
  const { data, error } = await supabase.storage
    .from('correos-contadores')
    .createSignedUrl(path, 300);
  if (!error && data) window.open(data.signedUrl, '_blank');
}

// Categorías de gasto para rutear el VEP a Pagos Fijos (IDs estables).
// Las cargas sociales pagadas por VEP van a "Regularización de impuestos" (resultado
// extraordinario, fuera del giro del mes) — mismo criterio que los F931/PLAN de la SAS.
// Así no inflan la línea de Cargas Sociales operativas del EdR (que sale del F931/RRHH).
// nombre SIN tilde a propósito: es el texto con el que ya están las ~32 filas de
// pagos_fijos y el checklist agrupa las secciones por ese string exacto. Con tilde
// abría un segundo cuadro "Regularización de impuestos" separado. El EdR no depende
// de esto (matchea la subcategoría del gasto con TRANSLATE, ignora tildes).
const CAT_REGULARIZACION = {
  id: '2b6f10eb-b749-46a7-baf9-3dc915d4d64b',
  nombre: 'Regularizacion de impuestos',
};
const CAT_IMPUESTOS = { id: '407704c3-9b1a-45c4-92c8-f4f41642e4ac', nombre: 'Impuestos y Tasas' };
const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
// Normaliza un período a 'YYYY-MM'. Tolera el formato viejo 'YYYYMM' (que a veces
// devuelve el OCR copiando el PDF, ej "202512") y 'YYYY-MM-DD'. Devuelve null si no
// se puede interpretar (evita insertar períodos inválidos que no matchean ninguna
// vista del checklist, que filtra por 'YYYY-MM' exacto).
function normPeriodo(p: string | null | undefined): string | null {
  if (!p) return null;
  const s = String(p).trim();
  let m = s.match(/^(\d{4})-(\d{2})/); // 'YYYY-MM' o 'YYYY-MM-DD'
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{4})(\d{2})$/); // 'YYYYMM'
  if (m) return `${m[1]}-${m[2]}`;
  return null;
}
// 'YYYY-MM' -> el mes anterior. La fila manual del F931 suele estar cargada en el mes
// del impuesto, y el VEP cae en el mes en que se paga (uno después).
function mesAnterior(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number);
  return m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Con qué conceptos ya cargados a mano puede corresponderse este VEP.
function patronesConcepto(esCarga: boolean, impuesto: string | null | undefined): string[] {
  if (esCarga) {
    return ['concepto.ilike.%931%', 'concepto.ilike.%carga%social%'];
  }
  const imp = (impuesto ?? '').trim();
  // Con menos de 4 letras (ej. "IVA" sí, "F" no) el ilike matchearía cualquier cosa.
  return imp.length >= 4 ? [`concepto.ilike.%${imp}%`] : ['concepto.ilike.%__nunca__%'];
}

// 'YYYY-MM' (o 'YYYYMM') -> 'Abril 2026'
function mesNombre(periodo: string | null): string {
  const norm = normPeriodo(periodo);
  if (!norm) return '';
  const [y, m] = norm.split('-').map(Number);
  return MESES_ES[(m || 1) - 1] ? `${MESES_ES[(m || 1) - 1]} ${y}` : norm;
}
function esCargaSocial(imp: string | null | undefined): boolean {
  const s = (imp ?? '').toLowerCase();
  return (
    s.includes('sicoss') || s.includes('931') || s.includes('social') ||
    s.includes('carga') || s.includes('seguridad') || s.includes('sijp')
  );
}

export function IntegracionesPage() {
  const qc = useQueryClient();
  const [items, setItems] = useState<ItemProc[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: empleados } = useQuery({
    queryKey: ['empleados-min-contador'],
    queryFn: async (): Promise<EmpleadoMin[]> => {
      const { data, error } = await supabase
        .from('empleados')
        .select('id, nombre, apellido, dni')
        .eq('activo', true);
      if (error) throw error;
      return data as EmpleadoMin[];
    },
  });

  // Matchea un recibo a un empleado por DNI (desde el CUIL) y, si no, por nombre.
  const matchEmpleado = (r: ReciboOcr): string | null => {
    if (!empleados) return null;
    const dni = dniDeCuil(r.cuil);
    if (dni) {
      const porDni = empleados.find((e) => normDni(e.dni) === dni);
      if (porDni) return porDni.id;
    }
    if (r.empleado_nombre) {
      const q = normalizarTexto(r.empleado_nombre);
      const porNombre = empleados.find((e) => {
        const full = normalizarTexto(`${e.nombre} ${e.apellido}`);
        const inv = normalizarTexto(`${e.apellido} ${e.nombre}`);
        return q.includes(normalizarTexto(e.apellido)) && (full.includes(q) || inv.includes(q) || q.includes(full) || q.includes(inv));
      });
      if (porNombre) return porNombre.id;
    }
    return null;
  };

  async function procesarArchivo(file: File) {
    const itemId = crypto.randomUUID();
    setItems((prev) => [{ id: itemId, nombre: file.name, estado: 'subiendo' }, ...prev]);
    const setItem = (patch: Partial<ItemProc>) =>
      setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));

    try {
      // ════════════════════════════════════════════════════════════════════
      // 0) ¿ESTE MISMO ARCHIVO YA SE CARGÓ?
      // ════════════════════════════════════════════════════════════════════
      //
      // 💥 Los recibos de junio de 2026 entraron DOS VECES —el 5-ago y el
      // 19-ago— y nada lo impidió: 9 empleados repetidos, $6,7 M de más en el
      // total de la pantalla de Recibos. Es la misma familia que el F931 que
      // entró tres veces.
      //
      // 🔑 Acá no hay ningún correo del que sacar un id: los PDF se arrastran
      // a mano. Lo que identifica al archivo es su contenido, así que el
      // candado va sobre el SHA-256, igual que en `comprobantes`.
      //
      // Y se pregunta ANTES de subir y ANTES del OCR a propósito: el OCR se
      // paga por uso y no tiene sentido gastarlo en algo que ya está cargado.
      // ⚠️ Sólo se pregunta por los recibos. El VEP NO tiene hash y no hace
      // falta: el VEP vive en `pagos_fijos` y ahí el candado por número ya
      // existe (`pagos_fijos_vep_numero_uidx`). La tabla `veps` no la escribe
      // nadie: tiene 0 filas y ni una línea de código la toca.
      const hashArchivo = await sha256File(file);
      const { data: yaCargado } = await supabase
        .from('recibos_sueldo')
        .select('periodo')
        .eq('hash_archivo', hashArchivo)
        .limit(1);
      if (yaCargado?.length) {
        setItem({
          estado: 'error',
          resultado: `⚠️ Este mismo archivo ya se cargó (recibos de ${mesNombre(yaCargado[0].periodo as string)}). No se cargó de nuevo.`,
        });
        return;
      }

      // 1) Subir al bucket
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
      const mes = new Date().toISOString().slice(0, 7);
      const rand = crypto.randomUUID().slice(0, 8);
      const path = `inbox/${mes}/${Date.now()}_${rand}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('correos-contadores')
        .upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (upErr) throw new Error(`No se pudo subir: ${upErr.message}`);

      // 2) OCR + clasificación
      setItem({ estado: 'analizando' });
      const { data: res, error: ocrErr } = await supabase.functions.invoke<{
        ok: boolean;
        datos?: DatosOcr;
        error?: string;
      }>('ocr-contador-doc', { body: { path } });
      if (ocrErr) throw new Error(ocrErr.message);
      if (!res?.ok || !res.datos) throw new Error(res?.error ?? 'El OCR no devolvió datos.');
      const d = res.datos;

      // 3) Rutear según tipo
      if (d.tipo === 'recibo') {
        const lista = (d.recibos ?? []).filter((r) => r.cuil || r.empleado_nombre);
        if (lista.length === 0) throw new Error('Se detectó un recibo pero no se pudo leer ningún empleado.');

        // Cortar el PDF por empleado: cada recibo se queda con SU hoja (confidencial).
        // Si falla el corte, se cae al PDF completo. Las imágenes no se cortan.
        const paths: (string | null)[] = lista.map(() => null);
        const esPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (esPdf) {
          try {
            const { PDFDocument } = await import('pdf-lib');
            const src = await PDFDocument.load(await file.arrayBuffer());
            const totalPags = src.getPageCount();
            for (let i = 0; i < lista.length; i++) {
              // 1 empleado por página y en orden → mapeo directo; si no, uso la página que dijo el OCR.
              let idx: number | null = null;
              if (lista.length === totalPags) idx = i;
              else if (
                typeof lista[i].pagina === 'number' &&
                lista[i].pagina! >= 1 &&
                lista[i].pagina! <= totalPags
              )
                idx = lista[i].pagina! - 1;
              if (idx === null) continue;

              const nueva = await PDFDocument.create();
              const [pg] = await nueva.copyPages(src, [idx]);
              nueva.addPage(pg);
              const bytes = await nueva.save();
              const rand = crypto.randomUUID().slice(0, 8);
              const pPath = `inbox/${mes}/${Date.now()}_${rand}_emp${i + 1}.pdf`;
              const { error: upE } = await supabase.storage
                .from('correos-contadores')
                .upload(pPath, bytes, { contentType: 'application/pdf' });
              if (!upE) paths[i] = pPath;
            }
          } catch {
            /* si el corte falla, cada recibo queda apuntando al PDF completo */
          }
        }

        const filas = lista.map((r, i) => ({
          empleado_id: matchEmpleado(r),
          cuil_detectado: r.cuil,
          nombre_detectado: r.empleado_nombre,
          periodo: r.periodo,
          monto_neto: r.neto,
          bruto: r.bruto ?? null,
          aporte_jubilacion: r.aporte_jubilacion ?? null,
          aporte_obra_social: r.aporte_obra_social ?? null,
          aporte_pami: r.aporte_pami ?? null,
          // Si el OCR no trajo el total pero sí bruto y neto, lo derivamos (bruto − neto).
          total_aportes:
            r.total_aportes ?? (r.bruto != null && r.neto != null ? r.bruto - r.neto : null),
          archivo_path: paths[i] ?? path,
          // Sólo el PRIMER recibo del lote se queda con el hash: el candado es
          // único y un PDF con ocho hojas genera ocho filas del mismo archivo.
          // Con que una lo lleve alcanza para que el archivo entero no se
          // pueda volver a subir, que es lo que se quiere impedir.
          hash_archivo: i === 0 ? hashArchivo : null,
        }));
        const { error } = await supabase.from('recibos_sueldo').insert(filas);
        if (error) {
          // 23505 = choca contra un candado único. Son dos: el del archivo
          // (mismo PDF otra vez) y el de (CUIL, período) — que es el que
          // atrapa el caso real: el MISMO mes exportado de nuevo, con otro
          // archivo. Sin esto, junio 2026 entró dos veces y nadie se enteró.
          if ((error as { code?: string }).code === '23505') {
            setItem({
              estado: 'error',
              resultado:
                '⚠️ Estos recibos ya estaban cargados: hay uno por empleado y por mes. ' +
                'No se cargó nada de nuevo. Si el contador mandó una corrección, hay que ' +
                'borrar el recibo viejo desde Sueldos antes de subir el nuevo.',
            });
            await supabase.storage.from('correos-contadores').remove([path]);
            return;
          }
          throw error;
        }

        // Si TODAS las hojas se cortaron bien, borramos el PDF completo para no
        // dejar el lote entero (todos los sueldos) accesible.
        if (paths.every((p) => p !== null)) {
          await supabase.storage.from('correos-contadores').remove([path]);
        }

        const asignados = filas.filter((f) => f.empleado_id).length;
        const sinAsignar = filas.length - asignados;
        setItem({
          estado: 'ok',
          tipo: 'recibo',
          resultado:
            filas.length === 1
              ? asignados
                ? `Recibo de ${lista[0].empleado_nombre ?? 'empleado'} → guardado en su legajo (RRHH → Recibos)`
                : `Recibo de ${lista[0].empleado_nombre ?? 'empleado'} → cargado, falta asignarlo (abajo, en Recibos de sueldo)`
              : `${filas.length} recibos → ${asignados} guardados en su legajo${sinAsignar ? `, ${sinAsignar} sin asignar (abajo)` : ''} · RRHH → Recibos`,
        });
        qc.invalidateQueries({ queryKey: ['recibos_sueldo'] });
      } else if (d.tipo === 'vep') {
        const v = d.vep ?? null;
        const venc = v?.vencimiento ?? null;
        const fechaPagoVep = v?.fecha_pago ?? null;
        const periodoImp = normPeriodo(v?.periodo ?? null); // período del impuesto (ej "2025-12")
        // Cae en el MES EN QUE SE PAGÓ: fecha real de pago del comprobante → si no
        // hay (VEP a pagar), vencimiento → último recurso, hoy (AR). El período del
        // impuesto se preserva en el concepto y la nota, no define el mes.
        const periodoPago =
          normPeriodo((fechaPagoVep ?? venc)?.slice(0, 7)) ?? hoyAR().slice(0, 7);
        // Anti-duplicado por número de VEP: si ya existe un pago fijo con ese mismo
        // número, es el mismo comprobante re-subido → rechazar con aviso claro (sin
        // depender del error del índice). Best-effort: si RLS no deja leer, igual lo
        // ataja el índice único parcial pagos_fijos_vep_numero_uidx (23505 abajo).
        if (v?.numero) {
          const { data: yaExiste } = await supabase
            .from('pagos_fijos')
            .select('id, concepto')
            .eq('vep_numero', v.numero)
            .maybeSingle();
          if (yaExiste) {
            await supabase.storage.from('correos-contadores').remove([path]);
            setItem({
              estado: 'error',
              tipo: 'vep',
              resultado: `⚠️ Este VEP (N° ${v.numero}) ya estaba cargado como "${yaExiste.concepto}". No se cargó de nuevo.`,
            });
            return;
          }
        }
        const carga = esCargaSocial(v?.impuesto);
        const cat = carga ? CAT_REGULARIZACION : CAT_IMPUESTOS;
        const base = carga
          ? `Pago cargas sociales ${mesNombre(periodoImp)}`.trim()
          : `Pago ${v?.impuesto ?? 'impuesto'} ${mesNombre(periodoImp)}`.trim();
        // El concepto incluye el N° de VEP para ser ÚNICO: puede haber VARIOS VEP del
        // mismo período (ej. aportes y contribuciones, montos distintos) y el
        // UNIQUE(periodo, concepto) rechazaría el segundo como falso duplicado. El
        // número los distingue; el anti-duplicado real es por vep_numero (arriba).
        const concepto = v?.numero ? `${base} · VEP ${v.numero}` : base;

        // El VEP es la fuente de verdad, pero la fila puede haberla cargado alguien a
        // mano antes de que llegara el comprobante. En ese caso la VINCULAMOS (le
        // pegamos número, monto real y comprobante) en vez de crear una segunda: así
        // entró tres veces el F931 y quedó $8,7M de gasto fantasma en el EdR.
        //
        // Solo se vincula si NO hay ambigüedad: un único candidato y el monto coincide.
        // El monto es el desempate que importa — la serie "F931 $7.000.000" de la
        // moratoria también matchea por nombre y pisarla borraría la deuda vieja.
        // 💥 ACÁ SE BUSCA ENTRE TODOS, PAGADOS O NO, y ese es el arreglo.
        //
        // Antes llevaba `.eq('pagado', false)`, y el camino NORMAL del F931 es
        // justo el otro: se carga a mano y se tilda cuando se paga. Cuando el
        // VEP llegaba después, esa fila ya tildada quedaba fuera de la
        // búsqueda, no había candidato, y el VEP entraba como una SEGUNDA fila.
        // Es exactamente por donde el F931 entró tres veces.
        const { data: candidatos } = await supabase
          .from('pagos_fijos')
          .select('id, concepto, periodo, monto, pagado')
          .is('vep_numero', null)
          .in('periodo', [periodoPago, mesAnterior(periodoPago)])
          .or(patronesConcepto(carga, v?.impuesto).join(','));

        const montoVep = v?.monto ?? null;
        const coincideMonto = (m: number | null) =>
          montoVep == null || m == null || Math.abs(m - montoVep) <= montoVep * 0.02;
        const vinculables = (candidatos ?? []).filter((c) => coincideMonto(c.monto));
        const aVincular = vinculables.length === 1 ? vinculables[0] : null;

        const fila = {
          periodo: periodoPago,
          concepto,
          categoria: cat.nombre,
          categoria_gasto_id: cat.id,
          monto: montoVep,
          fecha_vencimiento: venc ?? fechaPagoVep,
          comprobante_path: path,
          vep_numero: v?.numero ?? null,
          notas: `${base}${v?.numero ? ` · VEP N° ${v.numero}` : ''}${v?.impuesto ? ` · ${v.impuesto}` : ''}`.trim(),
        };

        // ⚠️ Si la fila YA está tildada como pagada, el VEP no le toca la plata.
        //
        // Ese pago ya se hizo y puede estar conciliado contra el banco: pisarle
        // el monto con lo que leyó el OCR —que además puede venir vacío— le
        // cambiaría el número a un gasto cerrado. Lo que el VEP aporta ahí es
        // el comprobante y el número, que es justo lo que faltaba.
        const loQueSeEscribe =
          aVincular?.pagado
            ? {
                comprobante_path: fila.comprobante_path,
                vep_numero: fila.vep_numero,
                notas: fila.notas,
              }
            : fila;

        // ⚠️ Acá NO se usa `guardarContando`, a propósito: hace falta el `code` crudo
        // del error para reconocer el 23505 (el mismo VEP resubido) y avisar en vez de
        // cargarlo dos veces. El helper devuelve el mensaje ya masticado y esa
        // distinción se perdería. El conteo de filas del update se hace igual, abajo.
        // Mismo criterio que ChecklistPagos.moverPago.
        // El insert no cuenta nada: un insert que la RLS bloquea SÍ tira error (42501).
        const { data: vinculadas, error } = aVincular
          ? await supabase
              .from('pagos_fijos')
              .update(loQueSeEscribe)
              .eq('id', aVincular.id)
              .select('id')
          : await supabase.from('pagos_fijos').insert(fila);
        if (error) {
          // 23505 = viola un UNIQUE: el número de VEP (pagos_fijos_vep_numero_uidx) o
          // período+concepto. En ambos casos es el mismo VEP recargado: no duplicamos,
          // avisamos y borramos el archivo recién subido (quedaría huérfano en storage).
          if (error.code === '23505') {
            await supabase.storage.from('correos-contadores').remove([path]);
            setItem({
              estado: 'error',
              tipo: 'vep',
              resultado: `⚠️ Este VEP ya estaba cargado (${base}). No se cargó de nuevo.`,
            });
            return;
          }
          throw error;
        }
        // 💣 Cero filas y ningún error: la RLS bloqueó el update. Sin este corte el
        // cartel decía "se vinculó al pago que ya estaba cargado a mano" con el VEP
        // sin guardar en ninguna parte: el impuesto queda sin comprobante y nadie se
        // entera hasta que lo buscan en Pagos Fijos.
        if (aVincular && (vinculadas?.length ?? 0) === 0) {
          // El PDF se borra igual que en los otros dos cortes de este flujo: el
          // mensaje invita a reintentar y cada reintento dejaría otra copia
          // colgada en un bucket que ya pegó contra la cuota.
          await supabase.storage.from('correos-contadores').remove([path]);
          // ⚠️ El aviso arranca por lo que hay que hacer, no por la explicación:
          // se muestra en un renglón con `truncate` y la cola se corta.
          throw new Error(
            `El VEP NO quedó cargado: revisá Pagos Fijos y volvé a subirlo. ` +
              `No se pudo vincular al pago "${aVincular.concepto}" que ya estaba cargado a mano ` +
              '(no se guardó ninguna fila: casi siempre es un permiso que falta, o que alguien ' +
              'más lo cambió recién).',
          );
        }
        // Cuando quedaron VARIOS candidatos (o el monto no coincidió con ninguno) no
        // vinculamos nada, pero hay que decirlo: si no, el duplicado vuelve callado.
        const sospechosos = (candidatos ?? []).filter((c) => c.id !== aVincular?.id);
        const aviso =
          aVincular != null
            ? ` · se vinculó al pago que ya estaba cargado a mano ("${aVincular.concepto}", ${mesNombre(aVincular.periodo)}): no se duplicó${aVincular.pagado ? '. Ese pago ya estaba tildado, así que se le agregó el comprobante y el N° de VEP y NO se le tocó el monto' : ''}`
            : sospechosos.length > 0
              ? ` · ⚠️ ojo: hay ${sospechosos.length} pago(s) parecido(s) cargado(s) a mano (${sospechosos.map((c) => `"${c.concepto}"`).join(', ')}). Si es el mismo, borrá el manual.`
              : '';

        setItem({
          estado: 'ok',
          tipo: 'vep',
          resultado: `VEP ${v?.impuesto ?? ''} → Finanzas → Pagos Fijos (${mesNombre(periodoPago)})${venc ? ` · vence ${venc}` : ''}${aviso}`,
        });
        qc.invalidateQueries({ queryKey: ['pagos_fijos'] });
        qc.invalidateQueries({ queryKey: ['pagos_alertas_global'] });
      } else {
        setItem({
          estado: 'error',
          tipo: 'desconocido',
          resultado: 'No se reconoció como recibo ni VEP. Revisalo y cargalo a mano.',
        });
      }
    } catch (e) {
      setItem({ estado: 'error', resultado: (e as Error).message });
    }
  }

  function manejarArchivos(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => procesarArchivo(f));
  }

  return (
    <PageContainer title="Documentos del contador">
      <div className="space-y-4">
        {/* ── Guía: cómo funciona (para administración) ── */}
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4">
          <p className="text-sm font-semibold text-blue-900">¿Cómo funciona?</p>
          <p className="mt-0.5 text-xs text-blue-800">
            Arrastrá los PDF que manda el contador (podés soltar varios juntos). El sistema los lee y
            los manda solo a donde corresponde:
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-blue-100 bg-white p-2.5">
              <div className="text-sm font-medium text-gray-800">🧾 Recibo de sueldo</div>
              <div className="mt-0.5 text-[11px] text-gray-600">
                Se guarda en el <span className="font-medium">legajo de cada empleado</span> (lo ves
                en <span className="font-medium">RRHH → Recibos</span> y dentro de cada legajo).
              </div>
            </div>
            <div className="rounded-md border border-blue-100 bg-white p-2.5">
              <div className="text-sm font-medium text-gray-800">🏛️ VEP / impuesto</div>
              <div className="mt-0.5 text-[11px] text-gray-600">
                Entra como pago en <span className="font-medium">Finanzas → Pagos Fijos</span> del mes
                de vencimiento, con <span className="font-medium">aviso de pago</span>.
              </div>
            </div>
            <div className="rounded-md border border-blue-100 bg-white p-2.5">
              <div className="text-sm font-medium text-gray-800">❓ No reconocido</div>
              <div className="mt-0.5 text-[11px] text-gray-600">
                Si es una captura o un documento sin datos, queda marcado en{' '}
                <span className="font-medium">ámbar</span> y se carga a mano.
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-blue-700">
            💡 Por cada archivo vas a ver abajo un cartel que dice <span className="font-medium">qué
            era</span> y <span className="font-medium">a dónde fue</span>. Si subís el mismo dos veces,
            se carga repetido (borralo con la ✕).
          </p>
        </div>

        {/* ── Zona de subida ── */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            manejarArchivos(e.dataTransfer.files);
          }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            arrastrando ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-300',
          )}
        >
          <div className="text-3xl">📥</div>
          <p className="mt-2 text-sm font-medium text-gray-700">
            Arrastrá los PDF acá, o hacé click para elegir
          </p>
          <p className="text-xs text-gray-400">Podés soltar varios a la vez · PDF o imágenes</p>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="hidden"
            onChange={(e) => manejarArchivos(e.target.files)}
          />
        </div>

        {/* ── Lista de procesamiento (sesión actual) ── */}
        {items.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Resultado de la subida
            </p>
            {items.map((it) => (
              <div
                key={it.id}
                className={cn(
                  'flex items-center gap-3 rounded border px-3 py-2 text-xs',
                  it.estado === 'ok'
                    ? 'border-green-200 bg-green-50'
                    : it.estado === 'error'
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-gray-200 bg-white',
                )}
              >
                <span className="text-base">
                  {it.estado === 'ok' ? '✓' : it.estado === 'error' ? '⚠' : '⏳'}
                </span>
                {/* `truncate` corta los avisos largos: el title deja leer el resto
                    pasando el mouse, sin romper el renglon. */}
                <span className="min-w-0 flex-1 truncate" title={it.resultado ?? undefined}>
                  <span className="font-medium text-gray-700">{it.nombre}</span>
                  {it.resultado && <span className="ml-2 text-gray-500">{it.resultado}</span>}
                  {!it.resultado && (
                    <span className="ml-2 text-gray-400">
                      {it.estado === 'subiendo' ? 'Subiendo…' : 'Analizando…'}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Recibos ── */}
        <SeccionRecibos empleados={empleados ?? []} />

        <p className="text-xs text-gray-400">
          Los VEPs detectados se cargan automáticamente en{' '}
          <span className="font-medium">Finanzas → Pagos Fijos</span> (en el mes de su vencimiento),
          con su PDF adjunto y el aviso de pago.
        </p>
      </div>
    </PageContainer>
  );
}

// ─── Recibos ─────────────────────────────────────────────────────────────────
function SeccionRecibos({ empleados }: { empleados: EmpleadoMin[] }) {
  const qc = useQueryClient();
  const { data: recibos } = useQuery({
    queryKey: ['recibos_sueldo'],
    queryFn: async (): Promise<ReciboRow[]> => {
      const { data, error } = await supabase
        .from('recibos_sueldo')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data as ReciboRow[];
    },
  });

  const nombreEmp = useMemo(() => {
    const m = new Map<string, string>();
    empleados.forEach((e) => m.set(e.id, `${e.apellido}, ${e.nombre}`));
    return m;
  }, [empleados]);

  // Las dos escrituras de abajo salen de un onChange y de un onClick: si el error
  // no se avisa acá, se pierde en la consola y la pantalla se refresca igual, como
  // si hubiera guardado. Por eso el alert, y por eso se invalida en los dos casos:
  // que la lista muestre cómo quedó de verdad.
  async function asignar(id: string, empleadoId: string) {
    try {
      await guardarContando(
        supabase.from('recibos_sueldo').update({ empleado_id: empleadoId || null }).eq('id', id),
        'No se pudo asignar el recibo a ese empleado',
        { filasEsperadas: 1 },
      );
    } catch (e) {
      window.alert((e as Error).message);
    }
    qc.invalidateQueries({ queryKey: ['recibos_sueldo'] });
  }
  async function borrar(id: string) {
    // No es un "borrá lo que haya": el recibo está en pantalla, así que tiene que
    // desaparecer una fila. Cero filas es la RLS bloqueando, y el recibo vuelve solo
    // al recargar.
    try {
      await guardarContando(
        supabase.from('recibos_sueldo').delete().eq('id', id),
        'No se pudo borrar el recibo',
        { filasEsperadas: 1 },
      );
    } catch (e) {
      window.alert((e as Error).message);
    }
    qc.invalidateQueries({ queryKey: ['recibos_sueldo'] });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Recibos de sueldo (→ RRHH)</h3>
      <div className="mt-2 divide-y divide-gray-100">
        {(recibos ?? []).length === 0 && (
          <p className="py-4 text-center text-xs text-gray-400">Todavía no hay recibos cargados.</p>
        )}
        {(recibos ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-xs">
            <div className="min-w-[180px] flex-1">
              {r.empleado_id ? (
                <span className="font-medium text-gray-800">{nombreEmp.get(r.empleado_id) ?? 'Empleado'}</span>
              ) : (
                <select
                  defaultValue=""
                  onChange={(e) => asignar(r.id, e.target.value)}
                  className="rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[11px] text-amber-800"
                >
                  <option value="">⚠ Asignar a… ({r.nombre_detectado ?? 'sin nombre'})</option>
                  {empleados.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.apellido}, {e.nombre}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <span className="text-gray-500">{r.periodo ?? '—'}</span>
            <span className="tabular-nums text-gray-700">{r.monto_neto ? formatARS(r.monto_neto) : '—'}</span>
            <button onClick={() => abrirArchivo(r.archivo_path)} className="text-blue-600 hover:underline">
              ver PDF
            </button>
            <button
              onClick={() => window.confirm('¿Borrar este recibo?') && borrar(r.id)}
              className="text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

