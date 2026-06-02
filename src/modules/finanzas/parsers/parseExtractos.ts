export interface MovimientoRaw {
  cuenta: 'mercadopago' | 'galicia' | 'icbc';
  fecha: string; // YYYY-MM-DD
  descripcion: string;
  debito: number;
  credito: number;
  saldo: number | null;
  referencia: string;
  periodo: string; // '2026-02'
  es_transferencia_interna?: boolean;
}

// CUITs/CUILs propios de la empresa — usado para detectar transferencias
// internas entre cuentas propias (de MP a Galicia, etc.) que no son egresos reales.
const CUITS_PROPIOS = ['30717352366']; // Rodziny S.A.S.

// Detecta si una descripción de movimiento corresponde a una transferencia entre
// cuentas propias (no es ingreso/egreso real, solo mover plata interna).
// IMPORTANTE: NO matchear cobros tipo "Producto de Rodziny Pastas" — esos son
// ventas QR del local, NO transferencias.
function detectarTransferenciaInterna(descripcion: string): boolean {
  if (!descripcion) return false;
  const upper = descripcion.toUpperCase();
  // Patrón 1: "TRANSFERENCIA DE CUENTA PROPIA" (Galicia)
  if (upper.includes('CUENTA PROPIA')) return true;
  // Patrón 2: descripción contiene TRANSFERENCIA + razón social propia
  if (upper.includes('TRANSFERENCIA') && upper.includes('RODZINY')) return true;
  // Patrón 3: CUIT propio explícito en la descripción
  if (CUITS_PROPIOS.some((c) => descripcion.includes(c))) return true;
  return false;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseFechaAR(str: string): string {
  // DD/MM/YYYY o DD/MM/YY
  const m = str.trim().match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!m) return '';
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2]}-${m[1]}`;
}

function parseNum(str: string): number {
  if (!str) return 0;
  // Formato argentino: puntos de miles, coma decimal → normalizar
  const clean = str
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.\-]/g, '');
  return parseFloat(clean) || 0;
}

function periodoFromFecha(fecha: string): string {
  return fecha.substring(0, 7);
}

// Genera referencias determinísticas por CONTENIDO para movimientos que el banco
// no identifica con un nº propio (PAGO DE SERVICIOS de Galicia, cargos de ICBC, etc.).
//
// Antes la referencia usaba la POSICIÓN de la fila en el archivo (`gal_FECHA_27_...`).
// Eso rompía la deduplicación al reimportar rangos superpuestos: la misma línea real
// caía en otra posición en cada export (27 vs 28) → referencia distinta → se cargaba
// dos veces.
//
// Acá usamos un contador de ocurrencia POR CONTENIDO dentro del archivo: si una línea
// idéntica (misma fecha/desc/débito/crédito) aparece, recibe siempre la misma ref aunque
// cambie de posición → reimportar la ignora. Si un día tuvo de verdad dos cargos iguales,
// reciben ocurrencia 1 y 2 → se conservan ambos.
function crearRefSintetica(prefijo: string) {
  const ocurrencias = new Map<string, number>();
  return (fecha: string, descripcion: string, debito: number, credito: number): string => {
    const clave = `${fecha}|${descripcion}|${debito}|${credito}`;
    const n = (ocurrencias.get(clave) ?? 0) + 1;
    ocurrencias.set(clave, n);
    return `${prefijo}_${fecha}_${descripcion.substring(0, 20)}_${debito}_${credito}_${n}`;
  };
}

// ─── MercadoPago ──────────────────────────────────────────────────────────────
// Formato legacy (separador ;):
//   DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;...
// Formato nuevo (separador ,):
//   EXTERNAL_REFERENCE,PAYMENT_METHOD_TYPE,PAYMENT_METHOD,TRANSACTION_TYPE,
//   TRANSACTION_AMOUNT,TRANSACTION_DATE,FEE_AMOUNT,SETTLEMENT_NET_AMOUNT,...

// Parser CSV que respeta comas dentro de comillas y JSON embebido
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseMercadoPago(csv: string, filename: string): MovimientoRaw[] {
  // Quitar BOM UTF-8 si viene
  const clean = csv.replace(/^﻿/, '');
  const lines = clean.split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].trim();

  // Reporte "Retiros" (CSV con separador ; y header en español)
  if (
    header.toLowerCase().includes('fecha de creación del retiro') ||
    header.toLowerCase().includes('fecha de creacion del retiro') ||
    header.includes('withdraw_id')
  ) {
    return parseMercadoPagoRetiros(lines);
  }

  // Detectar formato por headers
  if (header.startsWith('EXTERNAL_REFERENCE') || header.includes('TRANSACTION_AMOUNT')) {
    return parseMercadoPagoNuevo(lines);
  }
  return parseMercadoPagoLegacy(lines);
}

// Reporte "Retiros" (Mercado Pago → Reportes descargables → Retiros)
// Cada fila es un EGRESO de la cuenta MP hacia un banco externo.
// Header (ES, separador ;):
//   Fecha de creación del retiro;Número de retiro;Estado;Detalles del estado;Monto;Tarifa de retiro;...
//   ...;Nombre del titular;Tipo de identificación;Número de identificación;ID del banco;Nombre del banco;...
// La columna "Número de retiro" es el N° de operación que matchea con pagos_gastos.numero_operacion.
function parseMercadoPagoRetiros(lines: string[]): MovimientoRaw[] {
  const headers = lines[0].split(';').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const colIdx = (...candidates: string[]) =>
    headers.findIndex((h) => candidates.some((c) => h.includes(c.toLowerCase())));

  const iDate = colIdx('date_created', 'fecha de creación', 'fecha de creacion');
  const iId = colIdx('withdraw_id', 'número de retiro', 'numero de retiro');
  const iStatus = colIdx('status', 'estado');
  const iAmount = colIdx('amount', 'monto');
  const iFee = colIdx('fee', 'tarifa');
  const iHolder = colIdx('bank_account_holder', 'nombre del titular');
  const iCuit = colIdx('identification_number', 'número de identificación', 'numero de identificacion');
  const iBank = colIdx('bank_name', 'nombre del banco');

  if (iDate < 0 || iId < 0 || iAmount < 0) return [];

  const result: MovimientoRaw[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 5) continue;

    const fecha = (cols[iDate] ?? '').substring(0, 10);
    if (!fecha || fecha.length < 10) continue;

    const status = (iStatus >= 0 ? cols[iStatus] : '').toLowerCase();
    if (status && status !== 'approved') continue; // sólo retiros aprobados

    const withdrawId = cols[iId] ?? '';
    const amount = parseFloat(cols[iAmount] ?? '0') || 0;
    const fee = iFee >= 0 ? parseFloat(cols[iFee] ?? '0') || 0 : 0;
    if (amount <= 0) continue;

    const holder = iHolder >= 0 ? cols[iHolder] : '';
    const cuit = iCuit >= 0 ? cols[iCuit] : '';
    const bank = iBank >= 0 ? cols[iBank] : '';

    const descPartes = [`Retiro MP`];
    if (holder) descPartes.push(`a ${holder}`);
    if (bank) descPartes.push(`(${bank})`);
    if (cuit) descPartes.push(`CUIT ${cuit}`);
    descPartes.push(`Op. ${withdrawId}`);

    // Si el CUIT del beneficiario es propio → es transferencia interna
    // (de la cuenta MP a otra cuenta de la misma empresa, no es egreso real)
    const esInterna = CUITS_PROPIOS.includes(cuit);

    result.push({
      cuenta: 'mercadopago',
      fecha,
      descripcion: descPartes.join(' '),
      debito: amount,
      credito: 0,
      saldo: null,
      referencia: withdrawId || `mp_ret_${i}`,
      periodo: periodoFromFecha(fecha),
      es_transferencia_interna: esInterna,
    });

    // Tarifa de retiro como débito separado (si hubiera)
    if (fee > 0) {
      result.push({
        cuenta: 'mercadopago',
        fecha,
        descripcion: `Tarifa retiro MP · Op. ${withdrawId}`,
        debito: fee,
        credito: 0,
        saldo: null,
        referencia: `${withdrawId}_fee`,
        periodo: periodoFromFecha(fecha),
      });
    }
  }

  return result;
}

function parseMercadoPagoNuevo(lines: string[]): MovimientoRaw[] {
  const headers = parseCSVLine(lines[0]);
  const colIdx = (name: string) => headers.indexOf(name);

  const iDate = colIdx('TRANSACTION_DATE');
  const iAmount = colIdx('TRANSACTION_AMOUNT');
  const iFee = colIdx('FEE_AMOUNT');
  const iNet = colIdx('SETTLEMENT_NET_AMOUNT');
  const iTxType = colIdx('TRANSACTION_TYPE');
  const iMethod = colIdx('PAYMENT_METHOD');
  const iMethodT = colIdx('PAYMENT_METHOD_TYPE');
  const iRef = colIdx('EXTERNAL_REFERENCE');
  const iTaxes = colIdx('TAXES_AMOUNT');
  const iPOS = colIdx('POS_NAME');
  const iDetail = colIdx('SALE_DETAIL');
  const iPayer = colIdx('PAYER_NAME');
  const iSubUnit = colIdx('SUB_UNIT');

  if (iDate < 0 || iAmount < 0) return [];

  const result: MovimientoRaw[] = [];
  const refSintetica = crearRefSintetica('mp');

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 5) continue;

    const rawDate = cols[iDate] ?? '';
    const fecha = rawDate.substring(0, 10);
    if (!fecha || fecha.length < 10) continue;

    const txType = cols[iTxType] ?? '';
    const amount = parseFloat(cols[iAmount] ?? '0') || 0;
    const fee = parseFloat(cols[iFee] ?? '0') || 0;
    const taxes = parseFloat(cols[iTaxes] ?? '0') || 0;
    const method = cols[iMethod] ?? '';
    const methodT = cols[iMethodT] ?? '';
    const ref = cols[iRef] ?? '';
    const pos = cols[iPOS] ?? '';
    const detail = (cols[iDetail] ?? '').replace(/^"+|"+$/g, '').trim();
    const payer = iPayer >= 0 ? cols[iPayer] ?? '' : '';
    const subUnit = iSubUnit >= 0 ? cols[iSubUnit] ?? '' : '';

    // Descripción legible
    const desc = detail || `${methodT} · ${method}` + (pos ? ` · ${pos}` : '');

    // EXTERNAL_REFERENCE es el ID de operación de MP (estable). Si falta, generamos
    // una ref determinística por contenido (no por posición) para no duplicar al
    // reimportar. Las comisiones/retenciones cuelgan de la misma ref base.
    const baseRef = ref || refSintetica(fecha, desc, Math.abs(amount), 0);

    // SETTLEMENT puede ser cobro (amount >= 0) o egreso/cargo directo (amount < 0)
    // - amount >= 0 → cobro (con comisiones y retenciones como débitos separados)
    // - amount < 0  → cargo directo MP (suscripciones, pagos QR, retenciones AFIP, Secheep…)
    //   NOTA: los retiros bancarios NO vienen aquí como SETTLEMENT, vienen aparte en el
    //   reporte "Retiros" con más contexto (beneficiario, CUIT, banco).
    if (txType === 'SETTLEMENT') {
      if (amount < 0) {
        // Egreso: cargo directo en cuenta MP (no es retiro bancario)
        const partes = [detail || `Cargo MP · ${methodT}`];
        if (payer && payer.toUpperCase() !== 'RODZINY PASTAS') partes.push(`a ${payer}`);
        if (subUnit) partes.push(`(${subUnit})`);
        result.push({
          cuenta: 'mercadopago',
          fecha,
          descripcion: partes.join(' '),
          debito: Math.abs(amount),
          credito: 0,
          saldo: null,
          referencia: baseRef,
          periodo: periodoFromFecha(fecha),
        });
        // Retenciones aplicadas sobre el egreso (Ley 25.413, etc.)
        if (taxes < 0) {
          result.push({
            cuenta: 'mercadopago',
            fecha,
            descripcion: `Retención sobre egreso · ${detail || methodT}`,
            debito: Math.abs(taxes),
            credito: 0,
            saldo: null,
            referencia: `${baseRef}_tax`,
            periodo: periodoFromFecha(fecha),
          });
        }
        continue;
      }
      // amount >= 0 → cobro
      result.push({
        cuenta: 'mercadopago',
        fecha,
        descripcion: desc,
        debito: 0,
        credito: amount,
        saldo: null,
        referencia: baseRef,
        periodo: periodoFromFecha(fecha),
      });
      // Registrar comisiones como débito separado si hay fee
      if (fee < 0) {
        result.push({
          cuenta: 'mercadopago',
          fecha,
          descripcion: `Comisión MP: ${method}`,
          debito: Math.abs(fee),
          credito: 0,
          saldo: null,
          referencia: `${baseRef}_fee`,
          periodo: periodoFromFecha(fecha),
        });
      }
      // Registrar impuestos retenidos como débito separado
      if (taxes < 0) {
        result.push({
          cuenta: 'mercadopago',
          fecha,
          descripcion: `Retenciones MP: ${method}`,
          debito: Math.abs(taxes),
          credito: 0,
          saldo: null,
          referencia: `${baseRef}_tax`,
          periodo: periodoFromFecha(fecha),
        });
      }
    } else if (txType === 'WITHDRAWAL' || txType === 'PAYOUT') {
      // Los retiros (WITHDRAWAL/PAYOUT) los traemos del CSV "Retiros" que tiene
      // más contexto (beneficiario, CUIT, banco) y el monto NETO. Si los procesamos
      // también acá, generamos duplicados con monto BRUTO y descripción genérica
      // ("Transferencia saliente"). Lucas tiene que subir el reporte de Retiros aparte.
      continue;
    } else if (txType === 'REFUND') {
      result.push({
        cuenta: 'mercadopago',
        fecha,
        descripcion: `${txType}: ${desc}`,
        debito: Math.abs(amount),
        credito: 0,
        saldo: null,
        referencia: baseRef,
        periodo: periodoFromFecha(fecha),
      });
    }
  }

  return result;
}

function parseMercadoPagoLegacy(lines: string[]): MovimientoRaw[] {
  const result: MovimientoRaw[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 5) continue;

    const rawDate = cols[0];
    const fecha = rawDate.substring(0, 10);
    if (!fecha || fecha.length < 10) continue;

    const descripcion = cols[2] ?? '';
    const creditoRaw = parseFloat(cols[3] ?? '0') || 0;
    const debitoRaw = parseFloat(cols[4] ?? '0') || 0;
    const saldo = parseFloat(cols[12] ?? '0') || null;
    const referencia = cols[1] ?? `mp_${i}`;

    if (descripcion === 'reserve_for_payment') continue;

    result.push({
      cuenta: 'mercadopago',
      fecha,
      descripcion,
      debito: debitoRaw,
      credito: creditoRaw,
      saldo,
      referencia,
      periodo: periodoFromFecha(fecha),
    });
  }

  return result;
}

// ─── ICBC ─────────────────────────────────────────────────────────────────────
// Primera fila = nombre de cuenta → saltear
// Segunda fila = headers
// Separador: ; | decimales: ,

export function parseICBC(csv: string, filename: string): MovimientoRaw[] {
  const lines = csv.split('\n').filter(Boolean);
  if (lines.length < 3) return [];

  const result: MovimientoRaw[] = [];
  const refSintetica = crearRefSintetica('icbc');

  // Línea 0 = "Movimientos de CC $ ..." → skip
  // Línea 1 = headers
  // Línea 2+ = datos
  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 6) continue;

    const fecha = parseFechaAR(cols[0]);
    if (!fecha) continue;

    const concepto = cols[2] ?? '';
    const debitoStr = cols[3] ?? '';
    const creditoStr = cols[4] ?? '';
    const saldoStr = cols[5] ?? '';
    const infoComp = cols[6] ?? '';

    const debito = debitoStr ? Math.abs(parseNum(debitoStr)) : 0;
    const credito = creditoStr ? Math.abs(parseNum(creditoStr)) : 0;
    const saldo = saldoStr ? parseNum(saldoStr) : null;

    result.push({
      cuenta: 'icbc',
      fecha,
      descripcion: concepto,
      debito,
      credito,
      saldo,
      // infoComp suele venir vacío en cargos del banco → ref determinística por contenido
      referencia: infoComp || refSintetica(fecha, concepto, debito, credito),
      periodo: periodoFromFecha(fecha),
      es_transferencia_interna: detectarTransferenciaInterna(concepto),
    });
  }

  return result;
}

// ─── Galicia ──────────────────────────────────────────────────────────────────
// Headers en línea 0:
// Fecha;Descripción;Origen;Débitos;Créditos;Grupo de Conceptos;Concepto;...;Saldo

export function parseGalicia(csv: string, filename: string): MovimientoRaw[] {
  const lines = csv.split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  const result: MovimientoRaw[] = [];
  const refSintetica = crearRefSintetica('gal');

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 5) continue;

    const fecha = parseFechaAR(cols[0]);
    if (!fecha) continue;

    const descripcion = cols[1] ?? '';
    const debitoStr = cols[3] ?? '';
    const creditoStr = cols[4] ?? '';
    const saldoStr = cols[15] ?? cols[cols.length - 1] ?? '';
    const nroComp = cols[9] ?? '';

    const debito = debitoStr ? parseNum(debitoStr) : 0;
    const credito = creditoStr ? parseNum(creditoStr) : 0;
    // Saldo Galicia viene con + al frente: "+677024,22"
    const saldo = saldoStr ? parseNum(saldoStr.replace('+', '')) : null;

    const concepto = cols[6] ?? '';
    const leyenda1 = cols[10] ?? ''; // Leyenda Adicional1: contiene "INVERTIRONLINE S.A.U.", nombre de origen, etc.

    // Descripción enriquecida: descripción + leyenda adicional (origen del movimiento)
    let descFinal = descripcion;
    if (leyenda1 && leyenda1 !== '0') descFinal += ` · ${leyenda1}`;

    // Si el banco no trae nº de comprobante propio (caso "PAGO DE SERVICIOS", viene 0),
    // generamos una ref determinística por contenido para no duplicar al reimportar.
    const refUnica =
      nroComp && nroComp !== '0' ? nroComp : refSintetica(fecha, descFinal, debito, credito);

    result.push({
      cuenta: 'galicia',
      fecha,
      descripcion: descFinal,
      debito: Math.abs(debito),
      credito: Math.abs(credito),
      saldo,
      referencia: refUnica,
      periodo: periodoFromFecha(fecha),
      es_transferencia_interna: detectarTransferenciaInterna(descFinal),
    });
  }

  return result;
}

// ─── Auto-detector ────────────────────────────────────────────────────────────
export function parseExtracto(content: string, filename: string): MovimientoRaw[] {
  const lower = filename.toLowerCase();
  // Quitar BOM UTF-8 antes de leer la primera línea (MP-Retiros lo trae)
  const firstLine = content.replace(/^﻿/, '').split('\n')[0] ?? '';
  const firstLower = firstLine.toLowerCase();

  if (
    lower.includes('mp') ||
    lower.includes('mercadopago') ||
    lower.includes('withdraw') ||
    firstLine.startsWith('DATE;') ||
    firstLine.startsWith('EXTERNAL_REFERENCE') ||
    firstLower.includes('withdraw_id') ||
    firstLower.includes('fecha de creación del retiro') ||
    firstLower.includes('fecha de creacion del retiro')
  )
    return parseMercadoPago(content, filename);

  if (lower.includes('icbc') || firstLine.startsWith('Movimientos de CC'))
    return parseICBC(content, filename);

  if (
    lower.includes('galicia') ||
    firstLine.includes('Descripción') ||
    firstLine.includes('Descripcion')
  )
    return parseGalicia(content, filename);

  return [];
}
