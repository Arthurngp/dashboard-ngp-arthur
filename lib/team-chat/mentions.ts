import { getTeamChatClient } from './client'

export interface MentionableUser {
  id: string
  nome: string
  email: string | null
  username: string
}

export interface MentionPayload {
  mention_type: 'user' | 'all' | 'here'
  usuario_id?: string | null
}

/**
 * Lista usuários (e tokens especiais) que podem ser mencionados num canal.
 * O server-side define escopo (público = toda equipe, privado = só membros, DM = o outro).
 */
export async function listMentionable(channelId: string): Promise<MentionableUser[]> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase.rpc('team_chat_list_mentionable', {
    target_channel_id: channelId,
  })
  if (error) throw error
  return (data ?? []) as MentionableUser[]
}

/**
 * Extrai menções de um texto. Retorna entradas a serem inseridas em
 * team_chat_message_mentions após o save da mensagem.
 *
 * Regras:
 * - @nome.sobrenome → procura username exato no `available`
 * - @nome (primeiro nome) → procura primeiro user cujo nome começa com "Nome "
 * - @all e @here → tokens especiais
 *
 * Match é case-insensitive. Retorna lista deduplicada.
 */
export function parseMentions(
  texto: string,
  available: MentionableUser[]
): MentionPayload[] {
  const mentions: MentionPayload[] = []
  const seen = new Set<string>()

  // captura @token onde token é palavra (letras, números, ponto, hífen, underscore)
  const re = /@([\p{L}\p{N}._-]+)/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) {
    const raw = m[1].toLowerCase()

    if (raw === 'all' || raw === 'todos') {
      if (!seen.has('all')) {
        seen.add('all')
        mentions.push({ mention_type: 'all' })
      }
      continue
    }
    if (raw === 'here' || raw === 'aqui') {
      if (!seen.has('here')) {
        seen.add('here')
        mentions.push({ mention_type: 'here' })
      }
      continue
    }

    // Tenta match por username, depois por primeiro nome
    const byUsername = available.find((u) => u.username?.toLowerCase() === raw)
    const byFirstName =
      byUsername
      ?? available.find((u) => u.nome.split(/\s+/)[0]?.toLowerCase() === raw)
    if (byFirstName) {
      const key = `user:${byFirstName.id}`
      if (!seen.has(key)) {
        seen.add(key)
        mentions.push({ mention_type: 'user', usuario_id: byFirstName.id })
      }
    }
  }

  return mentions
}

/** Persiste menções pra uma mensagem já salva. */
export async function saveMentions(messageId: string, mentions: MentionPayload[]): Promise<void> {
  if (mentions.length === 0) return
  const supabase = getTeamChatClient()
  const rows = mentions.map((m) => ({
    message_id: messageId,
    mention_type: m.mention_type,
    usuario_id: m.usuario_id ?? null,
  }))
  const { error } = await supabase
    .from('team_chat_message_mentions')
    .insert(rows)
  if (error) throw error
}

/** Conta menções não lidas por canal, pro usuário atual. */
export async function getUnreadMentionsByChannel(): Promise<Map<string, number>> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase.rpc('team_chat_my_unread_mentions')
  if (error) throw error
  const map = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ channel_id: string; mention_count: number }>) {
    map.set(r.channel_id, Number(r.mention_count))
  }
  return map
}
