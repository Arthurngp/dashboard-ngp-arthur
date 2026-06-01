import { getTeamChatClient } from './client'

export const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '🙏', '😮']

export const PICKER_EMOJIS = [
  '👍', '❤️', '😂', '🎉', '🔥', '👀', '🙏', '😮',
  '😢', '😡', '👏', '💯', '✅', '❌', '🤔', '🚀',
  '💪', '😎', '🤯', '🤝', '☕', '💡', '⚡', '🎯',
]

export async function addReaction(messageId: string, usuarioId: string, emoji: string): Promise<void> {
  const supabase = getTeamChatClient()
  const { error } = await supabase
    .from('team_chat_reactions')
    .insert({ message_id: messageId, usuario_id: usuarioId, emoji })
  if (error && !/duplicate/i.test(error.message)) throw error
}

export async function removeReaction(messageId: string, usuarioId: string, emoji: string): Promise<void> {
  const supabase = getTeamChatClient()
  const { error } = await supabase
    .from('team_chat_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('usuario_id', usuarioId)
    .eq('emoji', emoji)
  if (error) throw error
}

export async function toggleReaction(
  messageId: string,
  usuarioId: string,
  emoji: string,
  currentlyReacted: boolean
): Promise<void> {
  if (currentlyReacted) {
    await removeReaction(messageId, usuarioId, emoji)
  } else {
    await addReaction(messageId, usuarioId, emoji)
  }
}
