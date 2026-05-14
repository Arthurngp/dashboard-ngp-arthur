export type ChannelType = 'general' | 'client' | 'dm'

export type MessageType = 'text' | 'file' | 'text_file' | 'system'

export type StorageProvider = 'supabase' | 'gdrive_link'

export interface TeamChatChannel {
  id: string
  type: ChannelType
  nome: string
  slug: string | null
  cliente_id: string | null
  criado_por: string | null
  descricao: string | null
  arquivado_em: string | null
  is_private: boolean
  created_at: string
  updated_at: string
}

export interface TeamChatMessage {
  id: string
  channel_id: string
  autor_usuario_id: string | null
  client_generated_id: string
  tipo: MessageType
  texto: string | null
  reply_to_message_id: string | null
  pinned_at: string | null
  pinned_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface TeamChatReaction {
  message_id: string
  usuario_id: string
  emoji: string
  created_at: string
}

export interface ReplyPreview {
  id: string
  texto: string | null
  autor_usuario_id: string | null
  autor_nome: string | null
  deleted_at: string | null
}

export interface ReactionGroup {
  emoji: string
  count: number
  reacted_by_me: boolean
}

export interface TeamChatAttachment {
  id: string
  message_id: string
  storage_provider: StorageProvider
  storage_path: string
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
  created_at: string
}

export interface TeamChatChannelWithUnread extends TeamChatChannel {
  unread_count: number
  last_message_at: string | null
  is_favorite: boolean
  sort_order: number
  // Pra canais DM: outro usuário (não-eu) do par
  dm_other_usuario_id?: string | null
  dm_other_nome?: string | null
  dm_other_foto?: string | null
}

export interface MessageSendState {
  client_generated_id: string
  status: 'sending' | 'sent' | 'failed'
  error?: string
}

export interface MessageMention {
  mention_type: 'user' | 'all' | 'here'
  usuario_id: string | null
  usuario_nome: string | null
}

export interface MessageWithAttachments extends TeamChatMessage {
  attachments: TeamChatAttachment[]
  autor_nome?: string | null
  autor_foto?: string | null
  reactions: ReactionGroup[]
  reply_preview?: ReplyPreview | null
  mentions: MessageMention[]
}
