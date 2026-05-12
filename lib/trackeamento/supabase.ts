import { createClient } from '@supabase/supabase-js'
import { ANON, SURL } from '@/lib/constants'

export const trackeamentoSupabase = createClient(SURL, ANON, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})
