'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { listChannels } from './channels'
import { deleteMessage, generateClientId, listMessages, sendMessage } from './messages'
import { getChannelLastRead, markChannelRead } from './reads'
import { sendMessageWithFiles } from './attachments'
import { toggleReaction } from './reactions'
import type {
  MessageSendState,
  MessageWithAttachments,
  TeamChatChannelWithUnread,
} from './types'

const POLL_INTERVAL_MS = 4000
const CHANNEL_LIST_POLL_MS = 15000

export function useChannels(currentUsuarioId?: string | null) {
  const [channels, setChannels] = useState<TeamChatChannelWithUnread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(true)

  const refetch = useCallback(async () => {
    try {
      const data = await listChannels(currentUsuarioId ?? null)
      if (mountedRef.current) {
        setChannels(data)
        setError(null)
      }
    } catch (e) {
      if (mountedRef.current) setError(e as Error)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [currentUsuarioId])

  useEffect(() => {
    mountedRef.current = true
    refetch()
    const interval = setInterval(refetch, CHANNEL_LIST_POLL_MS)
    const onFocus = () => refetch()
    window.addEventListener('focus', onFocus)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [refetch])

  return { channels, loading, error, refetch }
}

interface UseMessagesOptions {
  channelId: string | null
  autorUsuarioId: string | null
}

export function useMessages({ channelId, autorUsuarioId }: UseMessagesOptions) {
  const [messages, setMessages] = useState<MessageWithAttachments[]>([])
  const [pending, setPending] = useState<Map<string, MessageSendState>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  // Timestamp do último read no momento que o canal foi aberto.
  // Congelado durante a sessão → separador "Novas mensagens" não pula com polling.
  const [frozenLastReadAt, setFrozenLastReadAt] = useState<string | null>(null)
  // True quando o snapshot do last_read já foi capturado (mesmo que null).
  // Permite ao consumer atrasar o markRead até depois disso.
  const [lastReadSnapshotReady, setLastReadSnapshotReady] = useState(false)
  const mountedRef = useRef(true)
  const lastFetchedAtRef = useRef<string | null>(null)

  const refetch = useCallback(async () => {
    if (!channelId) return
    try {
      const data = await listMessages({ channelId, currentUsuarioId: autorUsuarioId })
      if (mountedRef.current) {
        setMessages(data)
        setError(null)
        if (data.length > 0) {
          lastFetchedAtRef.current = data[data.length - 1].created_at
        }
      }
    } catch (e) {
      if (mountedRef.current) setError(e as Error)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [channelId, autorUsuarioId])

  useEffect(() => {
    if (!channelId) return
    mountedRef.current = true
    setLoading(true)
    setMessages([])
    setPending(new Map())
    setFrozenLastReadAt(null)
    setLastReadSnapshotReady(false)

    let interval: ReturnType<typeof setInterval> | null = null
    const onFocus = () => refetch()

    // Captura last_read ANTES de iniciar fetch+polling.
    // Sequencial garante que o snapshot está pronto antes do markRead do consumer disparar.
    const init = async () => {
      if (autorUsuarioId) {
        const iso = await getChannelLastRead(channelId, autorUsuarioId).catch(() => null)
        if (!mountedRef.current) return
        setFrozenLastReadAt(iso)
      }
      if (!mountedRef.current) return
      setLastReadSnapshotReady(true)
      await refetch()
      if (!mountedRef.current) return
      interval = setInterval(refetch, POLL_INTERVAL_MS)
      window.addEventListener('focus', onFocus)
    }
    init()

    return () => {
      mountedRef.current = false
      if (interval) clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [channelId, autorUsuarioId, refetch])

  const send = useCallback(
    async (
      texto: string,
      replyToMessageId: string | null = null,
      mentions: Array<{ mention_type: 'user' | 'all' | 'here'; usuario_id?: string | null }> = []
    ) => {
      if (!channelId || !autorUsuarioId) return null
      const trimmed = texto.trim()
      if (!trimmed) return null

      const clientId = generateClientId()
      setPending((prev) => {
        const next = new Map(prev)
        next.set(clientId, { client_generated_id: clientId, status: 'sending' })
        return next
      })

      try {
        const saved = await sendMessage({
          channelId,
          autorUsuarioId,
          clientGeneratedId: clientId,
          texto: trimmed,
          tipo: 'text',
          replyToMessageId,
          mentions,
        })
        // Insere a mensagem retornada no estado antes de remover o pending,
        // para evitar flicker (gap onde nem pending nem refetch estão na UI).
        // Reusa autor_nome/foto da última mensagem nossa, se houver.
        setMessages((prev) => {
          if (prev.some((m) => m.id === saved.id)) return prev
          const lastMine = [...prev]
            .reverse()
            .find((m) => m.autor_usuario_id === autorUsuarioId)
          const optimistic: MessageWithAttachments = {
            ...saved,
            attachments: [],
            reactions: [],
            reply_preview: null,
            mentions: [],
            autor_nome: lastMine?.autor_nome ?? null,
            autor_foto: lastMine?.autor_foto ?? null,
          }
          return [...prev, optimistic]
        })
        setPending((prev) => {
          const next = new Map(prev)
          next.delete(clientId)
          return next
        })
        // Refetch silencioso para reconciliar nome/foto/reply_preview do servidor
        refetch()
        return saved
      } catch (e) {
        setPending((prev) => {
          const next = new Map(prev)
          next.set(clientId, {
            client_generated_id: clientId,
            status: 'failed',
            error: (e as Error).message,
          })
          return next
        })
        return null
      }
    },
    [channelId, autorUsuarioId, refetch]
  )

  const react = useCallback(
    async (messageId: string, emoji: string, currentlyReacted: boolean) => {
      if (!autorUsuarioId) return
      // Otimista: ajusta localmente já
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m
          const existing = m.reactions.find((r) => r.emoji === emoji)
          let next = m.reactions.filter((r) => r.emoji !== emoji)
          if (currentlyReacted) {
            // remover meu like
            if (existing && existing.count > 1) {
              next = [...next, { emoji, count: existing.count - 1, reacted_by_me: false }]
            }
          } else {
            // adicionar
            next = [
              ...next,
              { emoji, count: (existing?.count ?? 0) + 1, reacted_by_me: true },
            ]
          }
          next.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
          return { ...m, reactions: next }
        })
      )
      try {
        await toggleReaction(messageId, autorUsuarioId, emoji, currentlyReacted)
      } catch {
        // se falhar, refetch refaz o estado correto
      } finally {
        refetch()
      }
    },
    [autorUsuarioId, refetch]
  )

  const remove = useCallback(
    async (messageId: string) => {
      // optimistic remove
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
      try {
        await deleteMessage(messageId)
      } finally {
        refetch()
      }
    },
    [refetch]
  )

  const retry = useCallback(
    async (clientId: string, texto: string) => {
      if (!channelId || !autorUsuarioId) return null
      setPending((prev) => {
        const next = new Map(prev)
        next.set(clientId, { client_generated_id: clientId, status: 'sending' })
        return next
      })
      try {
        const saved = await sendMessage({
          channelId,
          autorUsuarioId,
          clientGeneratedId: clientId,
          texto: texto.trim(),
          tipo: 'text',
        })
        setPending((prev) => {
          const next = new Map(prev)
          next.delete(clientId)
          return next
        })
        refetch()
        return saved
      } catch (e) {
        setPending((prev) => {
          const next = new Map(prev)
          next.set(clientId, {
            client_generated_id: clientId,
            status: 'failed',
            error: (e as Error).message,
          })
          return next
        })
        return null
      }
    },
    [channelId, autorUsuarioId, refetch]
  )

  const sendWithFiles = useCallback(
    async (texto: string, files: File[]) => {
      if (!channelId || !autorUsuarioId) return
      try {
        await sendMessageWithFiles({ channelId, autorUsuarioId, texto, files })
        refetch()
      } catch (e) {
        throw e as Error
      }
    },
    [channelId, autorUsuarioId, refetch]
  )

  const markRead = useCallback(async () => {
    if (!channelId || !autorUsuarioId) return
    try {
      await markChannelRead(channelId, autorUsuarioId)
    } catch {
      // silencioso — não bloqueia UX
    }
  }, [channelId, autorUsuarioId])

  return {
    messages,
    pending,
    loading,
    error,
    send,
    sendWithFiles,
    retry,
    refetch,
    markRead,
    react,
    remove,
    frozenLastReadAt,
    lastReadSnapshotReady,
  }
}
