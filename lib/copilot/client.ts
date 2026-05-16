import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'

let cached: { client: SupabaseClient; token: string | null } | null = null

export function getCopilotClient(): SupabaseClient {
  const session = typeof window === 'undefined' ? null : getSession()
  const token = session?.session ?? null

  if (cached && cached.token === token) return cached.client

  const client = createClient(SURL, ANON, {
    global: {
      headers: token ? { 'x-session-token': token } : {},
    },
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'copilot-noop' },
  })

  cached = { client, token }
  return client
}
