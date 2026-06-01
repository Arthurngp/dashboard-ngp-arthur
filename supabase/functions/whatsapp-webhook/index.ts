// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizePhone(jid: string): string {
  // '5511999999999@s.whatsapp.net' → '5511999999999'
  return jid.replace(/@.*$/, '').replace(/[^0-9]/g, '')
}

function isGroupJid(jid: string): boolean {
  return jid.includes('@g.us')
}

function isLidJid(jid: string): boolean {
  return jid.endsWith('@lid')
}

function resolvePhoneNormalized(remoteJid: string): string {
  if (isGroupJid(remoteJid) || isLidJid(remoteJid)) return ''
  return normalizePhone(remoteJid)
}

function canonicalizeRemoteJid(remoteJid: string, phoneNormalized?: string | null): string {
  if (isGroupJid(remoteJid) || isLidJid(remoteJid)) return remoteJid
  const normalized = (phoneNormalized || normalizePhone(remoteJid)).trim()
  if (normalized) return `${normalized}@s.whatsapp.net`
  return remoteJid
}

function extractBody(message: any): { body: string; type: string } {
  if (message?.conversation) return { body: message.conversation, type: 'conversation' }
  if (message?.extendedTextMessage?.text) return { body: message.extendedTextMessage.text, type: 'extendedText' }
  if (message?.imageMessage?.caption) return { body: message.imageMessage.caption, type: 'image' }
  if (message?.videoMessage?.caption) return { body: message.videoMessage.caption, type: 'video' }
  if (message?.audioMessage) return { body: '[Áudio]', type: 'audio' }
  if (message?.documentMessage) return { body: `[Documento: ${message.documentMessage.fileName || ''}]`, type: 'document' }
  if (message?.stickerMessage) return { body: '[Sticker]', type: 'sticker' }
  return { body: '', type: 'unknown' }
}

async function generateAiSuggestion(
  openAiKey: string,
  body: string,
  leadContext: { company_name: string; contact_name: string | null } | null,
  recentMessages: { from_me: boolean; body: string }[]
): Promise<string | null> {
  const contextLines = recentMessages
    .slice(-5)
    .map(m => `${m.from_me ? 'Você' : 'Cliente'}: ${m.body}`)
    .join('\n')

  const leadInfo = leadContext
    ? `Empresa: ${leadContext.company_name}${leadContext.contact_name ? ` | Contato: ${leadContext.contact_name}` : ''}`
    : 'Lead: desconhecido'

  const prompt = `${leadInfo}

Histórico recente:
${contextLines || '(início da conversa)'}

Última mensagem recebida: "${body}"

Sugira uma resposta comercial usando técnicas de SPIN Selling e AIDA. Seja direto, natural e em português brasileiro. Máximo 2 frases.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content: 'Você é um assistente comercial especializado em vendas B2B. Usa técnicas de SPIN Selling (Situação, Problema, Implicação, Necessidade) e AIDA (Atenção, Interesse, Desejo, Ação). Responde sempre em português brasileiro informal, como um colega de vendas experiente.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.choices?.[0]?.message?.content?.trim() || null
  } catch {
    return null
  }
}

async function logSystemEvent(
  sb: ReturnType<typeof createClient>,
  entry: {
    event: string
    errorMessage: string
    payload?: Record<string, unknown>
    instanceName?: string | null
    evolutionMessageId?: string | null
    severity?: string
  }
) {
  try {
    await sb.from('system_logs').insert({
      scope: 'whatsapp-chat',
      source: 'whatsapp-webhook',
      event: entry.event,
      severity: entry.severity || 'error',
      instance_name: entry.instanceName || null,
      evolution_message_id: entry.evolutionMessageId || null,
      error_message: entry.errorMessage,
      payload: entry.payload || {},
    })
  } catch (logError) {
    console.error('[whatsapp-webhook] Falha ao salvar system_logs:', logError)
  }
}

async function upsertConversationProjection(
  sb: ReturnType<typeof createClient>,
  entry: {
    instanceName: string
    remoteJid: string
    canonicalRemoteJid: string
    phoneNormalized?: string | null
    chatType: 'direct' | 'group'
    leadId?: string | null
    displayName?: string | null
    lastMessagePreview?: string | null
    lastMessageAt?: string | null
    lastMessageFromMe: boolean
  }
) {
  try {
    await sb.rpc('upsert_chat_conversation_projection', {
      p_instance_name: entry.instanceName,
      p_remote_jid: entry.remoteJid,
      p_canonical_remote_jid: entry.canonicalRemoteJid,
      p_phone_normalized: entry.phoneNormalized || null,
      p_chat_type: entry.chatType,
      p_lead_id: entry.leadId || null,
      p_display_name: entry.displayName || null,
      p_profile_picture_url: null,
      p_last_message_preview: entry.lastMessagePreview || null,
      p_last_message_at: entry.lastMessageAt || null,
      p_last_message_from_me: entry.lastMessageFromMe,
    })
  } catch (error) {
    console.error('[whatsapp-webhook] Falha ao projetar conversa:', error)
  }
}

async function findLeadByPhone(
  sb: ReturnType<typeof createClient>,
  phoneNormalized: string
) {
  if (!phoneNormalized) return null

  try {
    const { data, error } = await sb.rpc('find_crm_lead_by_phone', {
      p_phone: phoneNormalized,
    })

    if (error) {
      console.error('[whatsapp-webhook] Falha ao buscar lead por telefone:', error)
      return null
    }

    const lead = Array.isArray(data) ? data[0] : null
    if (!lead?.id) return null

    return {
      id: lead.id as string,
      company_name: (lead.company_name as string | null) || '',
      contact_name: (lead.contact_name as string | null) || null,
    }
  } catch (error) {
    console.error('[whatsapp-webhook] Erro inesperado ao buscar lead por telefone:', error)
    return null
  }
}

async function processMessage(
  sb: ReturnType<typeof createClient>,
  openAiKey: string | undefined,
  instanceName: string,
  msg: any
) {
  const key = msg?.key || {}
  const evolutionMessageId: string = key?.id
  if (!evolutionMessageId) return

  // Prefere remoteJidAlt (telefone real @s.whatsapp.net) sobre @lid, 
  // MAS mantém remoteJid se for um grupo (@g.us)
  const remoteJid: string = isGroupJid(key?.remoteJid || '') 
    ? (key.remoteJid || '') 
    : (key?.remoteJidAlt || key?.remoteJid || '')
  if (!remoteJid) return

  const fromMe: boolean = key?.fromMe === true
  const isGroup = isGroupJid(remoteJid)
  const isLid = isLidJid(remoteJid)
  const phoneNormalized = resolvePhoneNormalized(remoteJid)
  const canonicalRemoteJid = canonicalizeRemoteJid(remoteJid, phoneNormalized)
  const { body, type: messageType } = extractBody(msg?.message || {})
  const messageTimestamp = msg?.messageTimestamp
    ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString()

  let leadId: string | null = null
  let leadContext: { company_name: string; contact_name: string | null } | null = null

  if (!isGroup && phoneNormalized) {
    const match = await findLeadByPhone(sb, phoneNormalized)
    if (match) {
      leadId = match.id
      leadContext = { company_name: match.company_name, contact_name: match.contact_name }
    }
  }

  let aiSuggestion: string | null = null
  let suggestionsEnabled = true
  if (!fromMe) {
    const { data: settings } = await sb
      .from('chat_conversation_settings')
      .select('suggestions_enabled')
      .eq('instance_name', instanceName)
      .eq('canonical_remote_jid', canonicalRemoteJid)
      .maybeSingle()
    suggestionsEnabled = settings?.suggestions_enabled ?? true
  }

  if (!fromMe && !isGroup && body && openAiKey && suggestionsEnabled) {
    const { data: recent } = await sb
      .from('chat_messages')
      .select('from_me, body, message_timestamp, created_at')
      .eq('instance_name', instanceName)
      .eq('canonical_remote_jid', canonicalRemoteJid)
      .order('created_at', { ascending: false })
      .limit(10)

    const history = (recent || [])
      .sort((a, b) => {
        const timeA = new Date(a.message_timestamp || a.created_at).getTime()
        const timeB = new Date(b.message_timestamp || b.created_at).getTime()
        return timeA - timeB
      })
      .slice(-5)
      .map(({ from_me, body }) => ({ from_me, body }))

    aiSuggestion = await generateAiSuggestion(openAiKey, body, leadContext, history)
  }

  await sb.from('chat_messages').upsert(
    {
      instance_name: instanceName,
      evolution_message_id: evolutionMessageId,
      remote_jid: remoteJid,
      canonical_remote_jid: canonicalRemoteJid,
      phone_normalized: phoneNormalized || null,
      from_me: fromMe,
      lead_id: leadId,
      cliente_id: null,
      body: body || null,
      message_type: messageType,
      ai_suggestion: aiSuggestion,
      chat_type: isGroup ? 'group' : 'direct',
      message_timestamp: messageTimestamp,
      metadata: {
        pushName: msg?.pushName || null,
        broadcast: msg?.broadcast || false,
        status: msg?.status || null,
      },
    },
    { onConflict: 'instance_name,evolution_message_id', ignoreDuplicates: true }
  )

  await upsertConversationProjection(sb, {
    instanceName,
    remoteJid: remoteJid,
    canonicalRemoteJid,
    phoneNormalized: phoneNormalized || null,
    chatType: isGroup ? 'group' : 'direct',
    leadId,
    displayName: isGroup
      ? null
      : leadContext?.company_name || (!isLid ? msg?.pushName || phoneNormalized || null : null),
    lastMessagePreview: body || null,
    lastMessageAt: messageTimestamp,
    lastMessageFromMe: fromMe,
  })
}

async function processWebhookPayload(
  sb: ReturnType<typeof createClient>,
  openAiKey: string | undefined,
  instanceName: string,
  rawMessages: any[],
  payload: any
) {
  const { data: instance } = await sb
    .from('whatsapp_instances')
    .select('id, instance_name')
    .eq('instance_name', instanceName)
    .single()

  if (!instance) {
    await logSystemEvent(sb, {
      event: 'unknown_instance_webhook',
      errorMessage: 'Webhook recebido para instance_name não cadastrada.',
      instanceName,
      payload,
      severity: 'warn',
    })
    return
  }

  for (const msg of rawMessages) {
    try {
      await processMessage(sb, openAiKey, instanceName, msg)
    } catch (err) {
      console.error('[whatsapp-webhook] Erro ao processar mensagem:', err)
      const evolutionMessageId = msg?.key?.id || null
      await logSystemEvent(sb, {
        event: 'async_processing_failed',
        errorMessage: err instanceof Error ? err.message : 'Erro desconhecido no processamento assíncrono.',
        instanceName,
        evolutionMessageId,
        payload: {
          message: msg,
        },
      })
    }
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
// Comparação constant-time evita timing attack que permitiria recuperar o
// secret um caractere por vez observando latência de resposta.
function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // ainda assim percorre B inteiro pra não vazar diferença de length precisa
    let dummy = 0
    for (let i = 0; i < b.length; i++) dummy |= b.charCodeAt(i)
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req: Request) => {
  const rawBody = req.method === 'POST' ? await req.text() : ''

  // Validação rígida do cabeçalho do webhook da Evolution.
  const secretToken = Deno.env.get('EVOLUTION_WEBHOOK_SECRET') || Deno.env.get('WEBHOOK_SECRET_TOKEN')
  if (!secretToken) {
    return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), { status: 500 })
  }

  const incoming = req.headers.get('apikey') || req.headers.get('authorization') || req.headers.get('x-webhook-secret') || ''
  const normalized = incoming.replace(/^Bearer\s+/i, '')
  if (!constantTimeEq(normalized, secretToken)) {
    // Loga só os 4 primeiros chars (não vaza secret). Antes logava 8.
    console.log('[whatsapp-webhook] 401 - prefix recebido:', normalized?.slice(0, 4) + '…')
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  let payload: any
  try {
    payload = rawBody ? JSON.parse(rawBody) : null
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  // Aceita MESSAGES_UPSERT vindo direto ou via "Webhook by Events" (URL com sufixo /messages-upsert)
  const url = new URL(req.url)
  const pathSuffix = url.pathname.split('/').pop() || ''
  const event = payload?.event || payload?.type || ''
  const isMsgUpsert =
    event === 'MESSAGES_UPSERT' ||
    event === 'messages.upsert' ||
    pathSuffix === 'messages-upsert' ||
    pathSuffix === 'MESSAGES_UPSERT'

  if (!isMsgUpsert) {
    return new Response(JSON.stringify({ ok: true, skipped: event || pathSuffix }), { status: 200 })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  const instanceName: string = payload?.instance || payload?.instanceName || 'default'

  // Evolution pode enviar um array ou objeto único
  const rawMessages = Array.isArray(payload?.data)
    ? payload.data
    : payload?.data?.messages
      ? payload.data.messages
      : payload?.data
        ? [payload.data]
        : []

  const processing = processWebhookPayload(sb, openAiKey, instanceName, rawMessages, payload)

  if ('EdgeRuntime' in globalThis && typeof globalThis.EdgeRuntime?.waitUntil === 'function') {
    globalThis.EdgeRuntime.waitUntil(processing)
    return new Response(JSON.stringify({ ok: true, queued: rawMessages.length }), { status: 200 })
  }

  processing.catch((err) => {
    console.error('[whatsapp-webhook] fallback async processing error:', err)
  })
  return new Response(JSON.stringify({ ok: true, queued: rawMessages.length }), { status: 200 })
})
