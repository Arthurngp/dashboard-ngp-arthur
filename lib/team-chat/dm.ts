import { getTeamChatClient } from './client'

/**
 * Abre (ou cria) um canal DM 1:1 com o outro usuário.
 * Retorna o channel_id (existente ou novo).
 */
export async function openDirectMessage(otherUsuarioId: string): Promise<string> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase.rpc('team_chat_open_dm', {
    other_usuario_id: otherUsuarioId,
  })
  if (error) throw error
  return data as string
}
