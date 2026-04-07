// Script rápido para consultar categorías distintas en la tabla gastos
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://hiolgfvtcilblmqyxuxm.supabase.co',
  'sb_publishable_XIlXJy5rxxznW7H9ccwXXw_v9kqByns'
)

const { data, error } = await supabase
  .from('gastos')
  .select('categoria')
  .order('categoria')

if (error) {
  console.error('Error:', error.message)
  process.exit(1)
}

// Extraer valores únicos (Supabase JS no soporta DISTINCT directo)
const categorias = [...new Set(data.map(r => r.categoria))].sort()

console.log(`\n=== Categorías en tabla "gastos" (${categorias.length} valores únicos) ===\n`)
categorias.forEach(c => console.log(`  - ${c}`))
console.log()
