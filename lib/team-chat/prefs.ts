import { getTeamChatClient } from './client'

export interface UserChannelPref {
  channel_id: string
  is_favorite: boolean
  sort_order: number
}

export async function listMyPrefs(): Promise<UserChannelPref[]> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase
    .from('team_chat_user_channel_prefs')
    .select('channel_id, is_favorite, sort_order')
  if (error) throw error
  return (data ?? []) as UserChannelPref[]
}

export async function toggleFavorite(channelId: string): Promise<boolean> {
  const supabase = getTeamChatClient()
  const { data, error } = await supabase.rpc('team_chat_toggle_favorite', {
    target_channel_id: channelId,
  })
  if (error) throw error
  return !!data
}

export async function setSortOrders(channelIds: string[], orders: number[]): Promise<void> {
  if (channelIds.length !== orders.length) {
    throw new Error('channelIds e orders precisam ter o mesmo tamanho')
  }
  if (channelIds.length === 0) return
  const supabase = getTeamChatClient()
  const { error } = await supabase.rpc('team_chat_set_sort_orders', {
    channel_ids: channelIds,
    orders,
  })
  if (error) throw error
}
