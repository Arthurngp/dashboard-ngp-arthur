import { createClient } from '@supabase/supabase-js'
import { SURL, ANON } from './constants'

export const supabase = createClient(SURL, ANON)
