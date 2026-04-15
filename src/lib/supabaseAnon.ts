import { createClient } from '@supabase/supabase-js'

// Cliente Supabase dedicado para la PWA pública /fichar y otras páginas anónimas.
//
// Diferencia con el cliente normal: NO persiste sesión en localStorage y no
// auto-refresca tokens. Así, aunque el usuario haya quedado autenticado en la
// ERP principal en el mismo navegador, las queries de /fichar van siempre como
// rol 'anon' puro. Esto evita que las policies de tablas abiertas a anon
// (fichadas, cronograma, empleados, recepciones_*) devuelvan 0 filas o tiren
// "row-level security policy" al insertar.

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabaseAnon = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})
