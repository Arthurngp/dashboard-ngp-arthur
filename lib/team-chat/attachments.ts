import { getTeamChatClient } from './client'
import { generateClientId, sendMessage } from './messages'
import type { MessageType, TeamChatAttachment } from './types'

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
export const MAX_FILES_PER_MESSAGE = 5
export const BUCKET = 'team-chat-attachments'

export const ALLOWED_MIME_PREFIXES = [
  'image/',
  'video/',
  'application/pdf',
  'text/',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument',
  'application/msword',
  'application/vnd.ms-excel',
]

export class FileTooLargeError extends Error {
  constructor(public readonly sizeMb: number) {
    super(
      `Arquivo excede 50 MB (${sizeMb.toFixed(1)} MB). Faça upload no Google Drive da NGP e cole o link no chat.`
    )
    this.name = 'FileTooLargeError'
  }
}

export class FileTypeNotAllowedError extends Error {
  constructor(public readonly mime: string) {
    super(`Tipo de arquivo não permitido: ${mime}`)
    this.name = 'FileTypeNotAllowedError'
  }
}

export function validateFile(file: File): void {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(file.size / 1024 / 1024)
  }
  const mime = file.type || 'application/octet-stream'
  const ok = ALLOWED_MIME_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? mime.startsWith(prefix) : mime === prefix
  )
  if (!ok) throw new FileTypeNotAllowedError(mime)
}

function buildStoragePath(channelId: string, fileName: string): string {
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  return `${channelId}/${yyyy}/${mm}/${dd}/${uuid}-${safeName}`
}

export async function uploadAttachment(
  channelId: string,
  file: File
): Promise<{ storage_path: string; file_name: string; mime_type: string; file_size_bytes: number }> {
  validateFile(file)
  const supabase = getTeamChatClient()
  const path = buildStoragePath(channelId, file.name)
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  })
  if (error) throw error
  return {
    storage_path: path,
    file_name: file.name,
    mime_type: file.type || 'application/octet-stream',
    file_size_bytes: file.size,
  }
}

interface SendMessageWithFilesOptions {
  channelId: string
  autorUsuarioId: string
  texto?: string
  files: File[]
}

export async function sendMessageWithFiles({
  channelId,
  autorUsuarioId,
  texto,
  files,
}: SendMessageWithFilesOptions): Promise<void> {
  if (files.length > MAX_FILES_PER_MESSAGE) {
    throw new Error(`Máximo ${MAX_FILES_PER_MESSAGE} arquivos por mensagem.`)
  }
  for (const f of files) validateFile(f)

  const supabase = getTeamChatClient()
  const clientId = generateClientId()
  const trimmedText = texto?.trim() || null
  const tipo: MessageType = trimmedText ? 'text_file' : 'file'

  const message = await sendMessage({
    channelId,
    autorUsuarioId,
    clientGeneratedId: clientId,
    texto: trimmedText,
    tipo,
  })

  for (const file of files) {
    const meta = await uploadAttachment(channelId, file)
    const { error } = await supabase.from('team_chat_attachments').insert({
      message_id: message.id,
      storage_provider: 'supabase',
      ...meta,
    })
    if (error) throw error
  }
}

export async function getAttachmentSignedUrl(
  attachment: Pick<TeamChatAttachment, 'storage_path' | 'storage_provider'>,
  expiresIn = 600
): Promise<string | null> {
  if (attachment.storage_provider === 'gdrive_link') {
    return attachment.storage_path
  }
  const supabase = getTeamChatClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(attachment.storage_path, expiresIn)
  if (error || !data) return null
  return data.signedUrl
}

const DRIVE_REGEX = /https:\/\/(?:drive|docs)\.google\.com\/[^\s]+/g

export function extractDriveLinks(text: string): string[] {
  return text.match(DRIVE_REGEX) ?? []
}

export function isDriveLink(url: string): boolean {
  return /^https:\/\/(?:drive|docs)\.google\.com\//.test(url)
}
