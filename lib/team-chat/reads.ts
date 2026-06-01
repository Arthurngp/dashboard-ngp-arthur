import { getTeamChatClient } from './client'

export async function markChannelRead(channelId: string, usuarioId: string): Promise<void> {
  const supabase = getTeamChatClient()
  const { error } = await supabase
    .from('team_chat_reads')
    .upsert(
      { channel_id: channelId, usuario_id: usuarioId, last_read_at: new Date().toISOString() },
      { onConflict: 'channel_id,usuario_id' }
    )
  if (error) throw error
}

/** Retorna o último ISO timestamp de leitura do canal pelo usuário (ou null se nunca leu). */
export async function getChannelLastRead(
  channelId: string,
  usuarioId: string
): Promise<string | null> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase
    .from('team_chat_reads')
    .select('last_read_at')
    .eq('channel_id', channelId)
    .eq('usuario_id', usuarioId)
    .maybeSingle()
  if (error) return null
  return data?.last_read_at ?? null
}
