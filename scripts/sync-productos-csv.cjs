/**
 * Sync productos desde CSVs de costeo → tabla `productos` en Supabase.
 * Uso: node scripts/sync-productos-csv.js          (dry-run)
 *      node scripts/sync-productos-csv.js --apply   (ejecutar cambios)
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const sb = createClient(
  'https://hiolgfvtcilblmqyxuxm.supabase.co',
  'sb_publishable_XIlXJy5rxxznW7H9ccwXXw_v9kqByns'
)

const APPLY = process.argv.includes('--apply')

// ── Parsear CSV limpio (nombre,marca,categoria,unidad,proveedor,precio_pack,formato)
function parsearCSV(contenido) {
  const lineas = contenido.split('\n').filter(l => l.trim())
  const productos = []

  for (let i = 1; i < lineas.length; i++) { // skip header
    // Parse respetando comillas
    const cols = []
    let campo = '', enComillas = false
    for (let j = 0; j < lineas[i].length; j++) {
      const c = lineas[i][j]
      if (c === '"') { enComillas = !enComillas; continue }
      if (c === ',' && !enComillas) { cols.push(campo.trim()); campo = ''; continue }
      campo += c
    }
    cols.push(campo.trim())

    const nombre = cols[0] || ''
    const marca = cols[1] || ''
    const categoria = cols[2] || ''
    const unidad = cols[3] || 'unidad'
    const proveedor = cols[4] || ''
    const precioPack = parseFloat(cols[5]) || 0
    const formato = parseFloat(cols[6]) || 0

    if (!nombre || !categoria) continue

    const costoUnitario = formato > 0 && precioPack > 0
      ? Math.round((precioPack / formato) * 100) / 100
      : precioPack

    productos.push({ nombre, marca: marca || null, categoria, unidad, proveedor, costoUnitario })
  }
  return productos
}

// ── Normalizar nombre para matching ──────────────────────────────────────────
function normalizar(s) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(deposito\)/gi, '')
    .replace(/\(cocina\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  console.log('='.repeat(70))
  console.log(' SYNC PRODUCTOS CSV → SUPABASE')
  console.log(' Modo:', APPLY ? '🚀 APLICAR CAMBIOS' : '👀 DRY RUN')
  console.log('='.repeat(70))

  // 1) Leer CSVs
  const csvSaavedra = fs.readFileSync(path.join(__dirname, '..', 'data', 'costeos-saavedra.csv'), 'utf8')
  const csvVedia = fs.readFileSync(path.join(__dirname, '..', 'data', 'costeos-vedia.csv'), 'utf8')

  const prodsSaavedra = parsearCSV(csvSaavedra).map(p => ({ ...p, local: 'saavedra' }))
  const prodsVedia = parsearCSV(csvVedia).map(p => ({ ...p, local: 'vedia' }))
  const todosCSV = [...prodsVedia, ...prodsSaavedra]

  console.log(`\nCSV: Vedia=${prodsVedia.length} | Saavedra=${prodsSaavedra.length} | Total=${todosCSV.length}`)

  // 2) Fetch productos existentes
  const { data: existentes, error } = await sb.from('productos')
    .select('id,nombre,marca,categoria,proveedor,costo_unitario,unidad,local,activo')
  if (error) { console.error('Error fetch:', error.message); return }
  console.log(`DB: ${existentes.length} productos`)

  // Indexar por nombre normalizado + local
  const dbIndex = new Map()
  for (const p of existentes) {
    const key = normalizar(p.nombre) + '|' + p.local
    if (!dbIndex.has(key)) dbIndex.set(key, p)
  }

  // 3) Cruzar
  const updates = []
  const inserts = []
  const matchOk = []

  for (const csv of todosCSV) {
    const key = normalizar(csv.nombre) + '|' + csv.local
    const db = dbIndex.get(key)

    if (db) {
      const cambios = {}
      // Marca: siempre actualizar si CSV tiene y DB no tiene (o es diferente)
      if (csv.marca && csv.marca !== db.marca) cambios.marca = csv.marca
      // Costo: actualizar si hay diferencia significativa (>$1)
      if (csv.costoUnitario > 0 && Math.abs((db.costo_unitario || 0) - csv.costoUnitario) > 1) {
        cambios.costo_unitario = csv.costoUnitario
      }
      // Proveedor: solo si DB no tiene
      if (csv.proveedor && !db.proveedor) cambios.proveedor = csv.proveedor

      if (Object.keys(cambios).length > 0) {
        updates.push({ id: db.id, nombre: db.nombre, local: db.local, cambios })
      } else {
        matchOk.push(`${db.nombre} (${db.local})`)
      }
    } else {
      inserts.push(csv)
    }
  }

  // 4) Reporte
  console.log('\n' + '-'.repeat(70))
  console.log(`RESUMEN:`)
  console.log(`  Updates (marca/costo/prov):  ${updates.length}`)
  console.log(`  Ya OK (sin cambios):         ${matchOk.length}`)
  console.log(`  Nuevos a crear (INSERT):     ${inserts.length}`)
  console.log('-'.repeat(70))

  if (updates.length > 0) {
    console.log('\nUPDATES:')
    for (const u of updates) {
      const c = Object.entries(u.cambios).map(([k, v]) => `${k}=${v}`).join(', ')
      console.log(`  [${u.local}] ${u.nombre} -> ${c}`)
    }
  }

  if (inserts.length > 0) {
    console.log('\nNUEVOS:')
    for (const p of inserts) {
      console.log(`  [${p.local}] ${p.nombre} | ${p.categoria} | marca: ${p.marca || '-'} | prov: ${p.proveedor || '-'} | $${p.costoUnitario}/u`)
    }
  }

  if (!APPLY) {
    console.log('\n>> Dry run. Usa --apply para ejecutar.')
    return
  }

  // 5) Aplicar
  console.log('\nAplicando...')

  let updOk = 0, updErr = 0
  for (const u of updates) {
    const { error } = await sb.from('productos')
      .update({ ...u.cambios, updated_at: new Date().toISOString() })
      .eq('id', u.id)
    if (error) { console.error(`  X Update ${u.nombre}: ${error.message}`); updErr++ }
    else updOk++
  }
  console.log(`  Updates: ${updOk} OK, ${updErr} errores`)

  let insOk = 0, insErr = 0
  for (const p of inserts) {
    const { error } = await sb.from('productos').insert({
      nombre: p.nombre,
      marca: p.marca,
      categoria: p.categoria,
      unidad: p.unidad,
      stock_actual: 0,
      stock_minimo: 0,
      proveedor: p.proveedor,
      costo_unitario: p.costoUnitario,
      activo: true,
      local: p.local,
    })
    if (error) { console.error(`  X Insert [${p.local}] ${p.nombre}: ${error.message}`); insErr++ }
    else insOk++
  }
  console.log(`  Inserts: ${insOk} OK, ${insErr} errores`)
  console.log('\nSync completado.')
}

main().catch(console.error)
