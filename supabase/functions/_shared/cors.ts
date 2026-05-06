// ─── CORS Dinâmico ───────────────────────────────────────────────────────────
// Configure ALLOWED_ORIGINS no Supabase Dashboard > Edge Functions > Secrets.
// Exemplo: "https://meusite.vercel.app,https://www.meusite.com"
// Se não configurado, aceita qualquer origem (modo desenvolvimento).
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || ''

  if (ALLOWED_ORIGINS.length > 0) {
    const allowed = ALLOWED_ORIGINS.includes(origin)
    return {
      'Access-Control-Allow-Origin': allowed ? origin : '',
      'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-ngp-api-token',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    }
  }

  // Fallback: sem whitelist configurada → aceita qualquer (dev mode)
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-ngp-api-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }
  return null
}

export function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

export function jsonCached(req: Request, data: unknown, ttlSeconds: number): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': `private, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`,
    },
  })
}
