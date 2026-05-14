import { getTeamChatClient } from './client'
import type {
  MessageMention,
  MessageType,
  MessageWithAttachments,
  ReactionGroup,
  ReplyPreview,
  TeamChatAttachment,
  TeamChatMessage,
  TeamChatReaction,
} from './types'

const PAGE_SIZE = 50

interface ListMessagesOptions {
  channelId: string
  before?: string | null
  limit?: number
  currentUsuarioId: string | null
}

export async function listMessages({
  channelId,
  before = null,
  limit = PAGE_SIZE,
  currentUsuarioId,
}: ListMessagesOptions): Promise<MessageWithAttachments[]> {
  const supabase = getTeamChatClient()

  let q = supabase
    .from('team_chat_messages')
    .select('*')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) q = q.lt('created_at', before)

  const { data: messages, error } = await q
  if (error) throw error
  if (!messages || messages.length === 0) return []

  const messageIds = messages.map((m) => m.id)
  const authorIds = Array.from(
    new Set(messages.map((m) => m.autor_usuario_id).filter((id): id is string => Boolean(id)))
  )
  const replyIds = Array.from(
    new Set(
      messages
        .map((m) => m.reply_to_message_id)
        .filter((id): id is string => Boolean(id))
    )
  )

  const [attRes, autRes, reacRes, replyRes, mentionsRes] = await Promise.all([
    supabase.from('team_chat_attachments').select('*').in('message_id', messageIds),
    authorIds.length > 0
      ? supabase.rpc('team_chat_get_authors', { user_ids: authorIds })
      : Promise.resolve({ data: [] as Array<{ id: string; nome: string; foto_url: string | null }> }),
    supabase.from('team_chat_reactions').select('*').in('message_id', messageIds),
    replyIds.length > 0
      ? supabase.rpc('team_chat_get_reply_previews', { message_ids: replyIds })
      : Promise.resolve({ data: [] as ReplyPreview[] }),
    supabase
      .from('team_chat_message_mentions')
      .select('message_id, mention_type, usuario_id')
      .in('message_id', messageIds),
  ])

  const attsByMessage = new Map<string, TeamChatAttachment[]>()
  for (const a of (attRes.data ?? []) as TeamChatAttachment[]) {
    const arr = attsByMessage.get(a.message_id) ?? []
    arr.push(a)
    attsByMessage.set(a.message_id, arr)
  }

  const autorById = new Map<string, { nome: string; foto_url: string | null }>()
  for (const u of (autRes.data ?? []) as Array<{ id: string; nome: string; foto_url: string | null }>) {
    autorById.set(u.id, { nome: u.nome, foto_url: u.foto_url })
  }

  // Agrupar reactions por mensagem + emoji
  const reactionsByMessage = new Map<string, ReactionGroup[]>()
  const buckets = new Map<string, Map<string, { count: number; reactedByMe: boolean }>>()
  for (const r of (reacRes.data ?? []) as TeamChatReaction[]) {
    let perMsg = buckets.get(r.message_id)
    if (!perMsg) {
      perMsg = new Map()
      buckets.set(r.message_id, perMsg)
    }
    const cur = perMsg.get(r.emoji) ?? { count: 0, reactedByMe: false }
    cur.count += 1
    if (currentUsuarioId && r.usuario_id === currentUsuarioId) cur.reactedByMe = true
    perMsg.set(r.emoji, cur)
  }
  for (const [mid, perMsg] of buckets) {
    const groups: ReactionGroup[] = []
    for (const [emoji, data] of perMsg) {
      groups.push({ emoji, count: data.count, reacted_by_me: data.reactedByMe })
    }
    groups.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
    reactionsByMessage.set(mid, groups)
  }

  const replyById = new Map<string, ReplyPreview>()
  for (const r of (replyRes.data ?? []) as ReplyPreview[]) {
    replyById.set(r.id, r)
  }

  // Agrupa menções por mensagem; resolve nome usando o autorById quando disponível
  const mentionRows = (mentionsRes.data ?? []) as Array<{
    message_id: string
    mention_type: 'user' | 'all' | 'here'
    usuario_id: string | null
  }>
  const mentionUserIds = Array.from(
    new Set(mentionRows.map((r) => r.usuario_id).filter((id): id is string => Boolean(id)))
  )
  const mentionUsersToFetch = mentionUserIds.filter((id) => !autorById.has(id))
  if (mentionUsersToFetch.length > 0) {
    const { data: extra } = await supabase.rpc('team_chat_get_authors', {
      user_ids: mentionUsersToFetch,
    })
    for (const u of (extra ?? []) as Array<{ id: string; nome: string; foto_url: string | null }>) {
      autorById.set(u.id, { nome: u.nome, foto_url: u.foto_url })
    }
  }
  const mentionsByMessage = new Map<string, MessageMention[]>()
  for (const r of mentionRows) {
    const arr = mentionsByMessage.get(r.message_id) ?? []
    arr.push({
      mention_type: r.mention_type,
      usuario_id: r.usuario_id,
      usuario_nome: r.usuario_id ? autorById.get(r.usuario_id)?.nome ?? null : null,
    })
    mentionsByMessage.set(r.message_id, arr)
  }

  return (messages as TeamChatMessage[])
    .map((m) => ({
      ...m,
      attachments: attsByMessage.get(m.id) ?? [],
      autor_nome: m.autor_usuario_id ? autorById.get(m.autor_usuario_id)?.nome ?? null : null,
      autor_foto: m.autor_usuario_id ? autorById.get(m.autor_usuario_id)?.foto_url ?? null : null,
      reactions: reactionsByMessage.get(m.id) ?? [],
      reply_preview: m.reply_to_message_id ? replyById.get(m.reply_to_message_id) ?? null : null,
      mentions: mentionsByMessage.get(m.id) ?? [],
    }))
    .reverse()
}

interface SendMentionInput {
  mention_type: 'user' | 'all' | 'here'
  usuario_id?: string | null
}

interface SendMessageOptions {
  channelId: string
  autorUsuarioId: string
  clientGeneratedId: string
  texto?: string | null
  tipo?: MessageType
  replyToMessageId?: string | null
  mentions?: SendMentionInput[]
}

export async function sendMessage({
  channelId,
  autorUsuarioId,
  clientGeneratedId,
  texto,
  tipo = 'text',
  replyToMessageId = null,
  mentions = [],
}: SendMessageOptions): Promise<TeamChatMessage> {
  const supabase = getTeamChatClient()

  const { data, error } = await supabase
    .from('team_chat_messages')
    .upsert(
      {
        channel_id: channelId,
        autor_usuario_id: autorUsuarioId,
        client_generated_id: clientGeneratedId,
        tipo,
        texto: texto?.trim() || null,
        reply_to_message_id: replyToMessageId,
      },
      { onConflict: 'channel_id,autor_usuario_id,client_generated_id', ignoreDuplicates: false }
    )
    .select('*')
    .single()

  if (error) throw error
  const saved = data as TeamChatMessage

  if (mentions.length > 0) {
    const rows = mentions.map((m) => ({
      message_id: saved.id,
      mention_type: m.mention_type,
      usuario_id: m.usuario_id ?? null,
    }))
    const { error: mentionErr } = await supabase
      .from('team_chat_message_mentions')
      .insert(rows)
    // se falhar, não derruba a mensagem — log silencioso
    if (mentionErr) {
      console.warn('[team-chat] menções não persistidas:', mentionErr.message)
    }
  }

  return saved
}

export async function deleteMessage(messageId: string): Promise<void> {
  const supabase = getTeamChatClient()
  // Usa RPC com SECURITY DEFINER pra contornar issue de RLS + UPDATE + RETURNING
  // (a policy SELECT filtra deleted_at IS NULL, o que quebrava o RETURNING).
  const { error } = await supabase.rpc('team_chat_delete_message', {
    target_message_id: messageId,
  })
  if (error) throw error
}

export function generateClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
}
