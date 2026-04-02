// Suporta múltiplas origens separadas por vírgula no secret ALLOWED_ORIGIN
// Ex: https://dashboardngp.vercel.app,http://localhost:3000
export function getCorsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('origin') || ''
  // @ts-ignore
  const allowed = (Deno.env.get('ALLOWED_ORIGIN') ?? '').split(',')
  const isAllowed = allowed.includes(origin)

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : (allowed[0] ?? ''),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, apikey, Authorization',
    'Vary': 'Origin',
  }
}

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) })
  }
  return null
}
