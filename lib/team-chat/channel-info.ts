import { getTeamChatClient } from './client'
import type {
  MessageWithAttachments,
  TeamChatAttachment,
  TeamChatMessage,
} from './types'

export interface MediaItem {
  id: string
  storage_path: string
  storage_provider: 'supabase' | 'gdrive_link'
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
  message_id: string
  created_at: string
}

export interface LinkItem {
  message_id: string
  url: string
  texto: string | null
  autor_nome: string | null
  created_at: string
}

export interface PinnedMessage extends MessageWithAttachments {
  pinned_at: string
  pinned_by: string | null
}

export interface ChannelMember {
  usuario_id: string
  nome: string
  email: string | null
  foto_url: string | null
  role: 'admin' | 'member'
  joined_at: string
}

async function listAttachmentsByMime(
  channelId: string,
  matcher: (mime: string | null) => boolean
): Promise<MediaItem[]> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase
    .from('team_chat_attachments')
    .select('*, team_chat_messages!inner(channel_id, deleted_at)')
    .eq('team_chat_messages.channel_id', channelId)
    .is('team_chat_messages.deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return ((data ?? []) as Array<TeamChatAttachment & { team_chat_messages: unknown }>)
    .filter((a) => matcher(a.mime_type))
    .map((a) => ({
      id: a.id,
      storage_path: a.storage_path,
      storage_provider: a.storage_provider,
      file_name: a.file_name,
      mime_type: a.mime_type,
      file_size_bytes: a.file_size_bytes,
      message_id: a.message_id,
      created_at: a.created_at,
    }))
}

export async function listChannelMedia(channelId: string): Promise<MediaItem[]> {
  return listAttachmentsByMime(channelId, (mime) => !!mime && mime.startsWith('image/'))
}

export async function listChannelFiles(channelId: string): Promise<MediaItem[]> {
  return listAttachmentsByMime(
    channelId,
    (mime) => !!mime && !mime.startsWith('image/')
  )
}

export async function listChannelLinks(channelId: string): Promise<LinkItem[]> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase.rpc('team_chat_get_channel_links', {
    target_channel_id: channelId,
    limit_count: 100,
  })
  if (error) throw error
  return (data ?? []) as LinkItem[]
}

export async function listPinnedMessages(channelId: string): Promise<PinnedMessage[]> {
  const supabase = getTeamChatClient()
  const { data: messages, error } = await supabase
    .from('team_chat_messages')
    .select('*')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .not('pinned_at', 'is', null)
    .order('pinned_at', { ascending: false })
    .limit(20)
  if (error) throw error
  if (!messages || messages.length === 0) return []

  const authorIds = Array.from(
    new Set(
      messages.map((m) => m.autor_usuario_id).filter((id): id is string => Boolean(id))
    )
  )

  const autRes = authorIds.length > 0
    ? await supabase.rpc('team_chat_get_authors', { user_ids: authorIds })
    : { data: [] as Array<{ id: string; nome: string; foto_url: string | null }> }

  const autorById = new Map<string, { nome: string; foto_url: string | null }>()
  for (const u of (autRes.data ?? []) as Array<{ id: string; nome: string; foto_url: string | null }>) {
    autorById.set(u.id, { nome: u.nome, foto_url: u.foto_url })
  }

  return (messages as Array<TeamChatMessage & { pinned_at: string; pinned_by: string | null }>).map(
    (m) => ({
      ...m,
      attachments: [],
      reactions: [],
      reply_preview: null,
      mentions: [],
      autor_nome: m.autor_usuario_id ? autorById.get(m.autor_usuario_id)?.nome ?? null : null,
      autor_foto: m.autor_usuario_id ? autorById.get(m.autor_usuario_id)?.foto_url ?? null : null,
    })
  )
}

export async function togglePinMessage(messageId: string): Promise<boolean> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase.rpc('team_chat_toggle_pin', {
    target_message_id: messageId,
  })
  if (error) throw error
  return !!(data as { pinned?: boolean } | null)?.pinned
}

export async function listChannelMembers(channelId: string): Promise<ChannelMember[]> {
  const supabase = getTeamChatClient()
  const { data: rows, error } = await supabase
    .from('team_chat_channel_members')
    .select('channel_id, usuario_id, role, joined_at')
    .eq('channel_id', channelId)
  if (error) throw error
  if (!rows || rows.length === 0) return []

  const ids = rows.map((r) => r.usuario_id)
  const { data: usersData } = await supabase.rpc('team_chat_list_internal_users')
  const userInfo = new Map(
    ((usersData ?? []) as Array<{ id: string; nome: string; email: string }>).map((u) => [u.id, u])
  )

  return rows
    .filter((r) => ids.includes(r.usuario_id))
    .map((r) => {
      const u = userInfo.get(r.usuario_id)
      return {
        usuario_id: r.usuario_id,
        nome: u?.nome ?? '—',
        email: u?.email ?? null,
        foto_url: null,
        role: (r.role as 'admin' | 'member') ?? 'member',
        joined_at: r.joined_at,
      }
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}
