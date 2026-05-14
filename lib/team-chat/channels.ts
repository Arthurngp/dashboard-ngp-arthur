import { getTeamChatClient } from './client'
import type { TeamChatChannel, TeamChatChannelWithUnread } from './types'

export async function listChannels(currentUsuarioId?: string | null): Promise<TeamChatChannelWithUnread[]> {
  const supabase = getTeamChatClient()

  const { data: channels, error } = await supabase
    .from('team_chat_channels')
    .select('*')
    .is('arquivado_em', null)
    .order('type', { ascending: true })
    .order('nome', { ascending: true })

  if (error) throw error
  if (!channels) return []

  const ids = channels.map((c) => c.id)
  if (ids.length === 0) return []

  const dmChannelIds = (channels as TeamChatChannel[])
    .filter((c) => c.type === 'dm')
    .map((c) => c.id)

  const [readsRes, lastMsgRes, prefsRes, dmsRes] = await Promise.all([
    supabase.from('team_chat_reads').select('channel_id,last_read_at').in('channel_id', ids),
    supabase
      .from('team_chat_messages')
      .select('channel_id,created_at')
      .in('channel_id', ids)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('team_chat_user_channel_prefs')
      .select('channel_id,is_favorite,sort_order')
      .in('channel_id', ids),
    dmChannelIds.length > 0
      ? supabase
          .from('team_chat_dms')
          .select('channel_id,user_a_id,user_b_id')
          .in('channel_id', dmChannelIds)
      : Promise.resolve({ data: [] as Array<{ channel_id: string; user_a_id: string; user_b_id: string }> }),
  ])

  const lastReadByChannel = new Map<string, string>()
  for (const r of readsRes.data ?? []) {
    lastReadByChannel.set(r.channel_id, r.last_read_at)
  }

  const lastMsgByChannel = new Map<string, string>()
  const unreadCountByChannel = new Map<string, number>()
  for (const m of lastMsgRes.data ?? []) {
    if (!lastMsgByChannel.has(m.channel_id)) {
      lastMsgByChannel.set(m.channel_id, m.created_at)
    }
    const lastRead = lastReadByChannel.get(m.channel_id)
    if (!lastRead || m.created_at > lastRead) {
      unreadCountByChannel.set(
        m.channel_id,
        (unreadCountByChannel.get(m.channel_id) ?? 0) + 1
      )
    }
  }

  const prefsByChannel = new Map<string, { is_favorite: boolean; sort_order: number }>()
  for (const p of (prefsRes.data ?? []) as Array<{ channel_id: string; is_favorite: boolean; sort_order: number }>) {
    prefsByChannel.set(p.channel_id, { is_favorite: p.is_favorite, sort_order: p.sort_order })
  }

  // Resolve "outro usuário" do DM
  const dmOtherByChannel = new Map<string, string>()
  for (const d of (dmsRes.data ?? []) as Array<{ channel_id: string; user_a_id: string; user_b_id: string }>) {
    if (currentUsuarioId) {
      dmOtherByChannel.set(
        d.channel_id,
        d.user_a_id === currentUsuarioId ? d.user_b_id : d.user_a_id
      )
    }
  }

  const otherIds = Array.from(new Set(dmOtherByChannel.values()))
  const authorsRes = otherIds.length > 0
    ? await supabase.rpc('team_chat_get_authors', { user_ids: otherIds })
    : { data: [] as Array<{ id: string; nome: string; foto_url: string | null }> }

  const otherInfoById = new Map<string, { nome: string; foto_url: string | null }>()
  for (const u of (authorsRes.data ?? []) as Array<{ id: string; nome: string; foto_url: string | null }>) {
    otherInfoById.set(u.id, { nome: u.nome, foto_url: u.foto_url })
  }

  return (channels as TeamChatChannel[]).map((c) => {
    const pref = prefsByChannel.get(c.id)
    const otherId = dmOtherByChannel.get(c.id) ?? null
    const otherInfo = otherId ? otherInfoById.get(otherId) : null
    return {
      ...c,
      // pra DMs, mostra o nome do outro como nome do canal
      nome: c.type === 'dm' && otherInfo ? otherInfo.nome : c.nome,
      unread_count: unreadCountByChannel.get(c.id) ?? 0,
      last_message_at: lastMsgByChannel.get(c.id) ?? null,
      is_favorite: pref?.is_favorite ?? false,
      sort_order: pref?.sort_order ?? 0,
      dm_other_usuario_id: otherId,
      dm_other_nome: otherInfo?.nome ?? null,
      dm_other_foto: otherInfo?.foto_url ?? null,
    }
  })
}

export async function getChannel(id: string): Promise<TeamChatChannel | null> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase
    .from('team_chat_channels')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data as TeamChatChannel | null
}

interface CreateChannelOptions {
  nome: string
  slug?: string
  descricao?: string
  isPrivate?: boolean
}

/** Cria um canal general. Só admins podem. Retorna o id do canal criado. */
export async function createGeneralChannel({
  nome,
  slug,
  descricao,
  isPrivate = false,
}: CreateChannelOptions): Promise<string> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase.rpc('team_chat_create_general_channel', {
    channel_nome: nome,
    channel_slug: slug ?? null,
    channel_descricao: descricao ?? null,
    channel_is_private: isPrivate,
  })
  if (error) throw error
  return data as string
}

/** Convida um usuário pra um canal privado. */
export async function inviteChannelMember(channelId: string, usuarioId: string): Promise<void> {
  const supabase = getTeamChatClient()
  const { error } = await supabase.rpc('team_chat_invite_member', {
    target_channel_id: channelId,
    target_usuario_id: usuarioId,
  })
  if (error) throw error
}

/** Lista usuários elegíveis pra convite (equipe interna ativa). */
export async function listInternalUsers(): Promise<Array<{ id: string; nome: string; email: string }>> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase.rpc('team_chat_list_internal_users')
  if (error) throw error
  return (data ?? []) as Array<{ id: string; nome: string; email: string }>
}
