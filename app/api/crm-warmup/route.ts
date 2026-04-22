/**
 * API Route de warmup do CRM Pipeline.
 * Chamado pelo cliente a cada 50s para manter a Edge Function "quente"
 * e evitar cold starts (~1.5s de latência extra) no carregamento do pipeline.
 *
 * Next.js faz o fetch server-side, que é muito mais rápido que browser → Supabase.
 */
import { NextResponse } from 'next/server'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON!

export async function GET() {
  try {
    // Envia OPTIONS para acordar a função sem processamento real
    await fetch(`${SUPABASE_URL}/functions/v1/crm-manage-pipeline`, {
      method: 'OPTIONS',
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
