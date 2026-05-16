'use client'

// Provider GLOBAL de notificações do chat interno NGP. Roda em /app/layout.tsx
// e fica vivo em qualquer rota — sidebar, favicon, toast e som consomem daqui.
//
// Por que um Provider:
// - Um único polling de 15s pra TODA a app (não duplica com useChannels da /chat)
// - Quando o usuário ABRE /chat, o hook local de lá faz seu próprio refetch mas
//   o provider continua funcionando — não atrapalha
// - Detecta DELTA de unread (mais mensagens que antes) pra disparar som/desktop
//
// Não dispara nada quando:
// - O usuário está NA aba do chat (já vê tudo)
// - mute = true
// - Aba não-focada não bloqueia — pelo contrário, é o caso principal

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { listChannels } from './channels'
import { resolveCurrentUsuarioId } from './identity'
import { isChatEnabled } from './client'
import type { TeamChatChannelWithUnread } from './types'

const POLL_MS = 15000

interface ChatNotifEvent {
  channelId: string
  channelName: string
  isDM: boolean
  unreadIncrement: number
  timestamp: number
}

interface ChatNotifContext {
  totalUnread: number
  channels: TeamChatChannelWithUnread[]
  mute: boolean
  setMute: (next: boolean) => void
  desktopPermission: NotificationPermission | 'unsupported'
  requestDesktopPermission: () => Promise<NotificationPermission>
  /** Último delta detectado — toast/som consomem isso */
  latestEvent: ChatNotifEvent | null
  /** Marca como visto (usado quando o toast fecha) */
  clearLatestEvent: () => void
}

const NoopCtx: ChatNotifContext = {
  totalUnread: 0,
  channels: [],
  mute: false,
  setMute: () => {},
  desktopPermission: 'unsupported',
  requestDesktopPermission: async () => 'denied' as NotificationPermission,
  latestEvent: null,
  clearLatestEvent: () => {},
}

const Ctx = createContext<ChatNotifContext>(NoopCtx)

const MUTE_KEY = 'ngp_chat_muted'

export function ChatNotificationsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [channels, setChannels] = useState<TeamChatChannelWithUnread[]>([])
  const [mute, setMuteState] = useState(false)
  const [desktopPermission, setDesktopPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [latestEvent, setLatestEvent] = useState<ChatNotifEvent | null>(null)
  const [usuarioId, setUsuarioId] = useState<string | null>(null)
  const prevUnreadByChannel = useRef<Map<string, number>>(new Map())
  // Se o usuário ainda não fez nenhum poll completo, NÃO dispara eventos
  // no primeiro carregamento — caso contrário toda mensagem antiga vira "nova".
  const firstPollDone = useRef(false)
  const mountedRef = useRef(true)

  // Hidrata mute do localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(MUTE_KEY)
      if (stored === '1') setMuteState(true)
    } catch {}
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setDesktopPermission(Notification.permission)
    }
  }, [])

  const setMute = useCallback((next: boolean) => {
    setMuteState(next)
    try { localStorage.setItem(MUTE_KEY, next ? '1' : '0') } catch {}
  }, [])

  const requestDesktopPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied' as NotificationPermission
    }
    const result = await Notification.requestPermission()
    setDesktopPermission(result)
    return result
  }, [])

  const clearLatestEvent = useCallback(() => setLatestEvent(null), [])

  // Resolve usuário logado uma vez
  useEffect(() => {
    if (!isChatEnabled()) return
    const sessionToken = typeof window !== 'undefined' ? sessionStorage.getItem('adsboard_session') : null
    if (!sessionToken) return
    let cancelled = false
    resolveCurrentUsuarioId(sessionToken).then(id => {
      if (!cancelled) setUsuarioId(id)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [pathname]) // re-resolve se o usuário trocar de aba (raro)

  // Poll global
  useEffect(() => {
    if (!isChatEnabled() || !usuarioId) return
    mountedRef.current = true

    const poll = async () => {
      try {
        const data = await listChannels(usuarioId)
        if (!mountedRef.current) return

        // Detecta delta SE não é o primeiro poll
        if (firstPollDone.current) {
          let strongestDelta: ChatNotifEvent | null = null
          for (const ch of data) {
            const prev = prevUnreadByChannel.current.get(ch.id) ?? 0
            const cur = ch.unread_count || 0
            if (cur > prev) {
              const increment = cur - prev
              // Pega o canal com MAIOR incremento como evento principal
              if (!strongestDelta || increment > strongestDelta.unreadIncrement) {
                strongestDelta = {
                  channelId: ch.id,
                  channelName: ch.nome || (ch.type === 'dm' ? 'Mensagem direta' : 'Canal'),
                  isDM: ch.type === 'dm',
                  unreadIncrement: increment,
                  timestamp: Date.now(),
                }
              }
            }
          }
          if (strongestDelta) setLatestEvent(strongestDelta)
        }

        // Atualiza estado prévio para o próximo poll
        const next = new Map<string, number>()
        for (const ch of data) next.set(ch.id, ch.unread_count || 0)
        prevUnreadByChannel.current = next

        setChannels(data)
        firstPollDone.current = true
      } catch (e) {
        console.warn('[chat-notif] poll failed:', e)
      }
    }

    poll()
    const interval = setInterval(poll, POLL_MS)
    // Refetch ao recuperar foco — pega notificações enquanto a aba estava idle
    const onFocus = () => poll()
    window.addEventListener('focus', onFocus)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [usuarioId])

  // Quando o usuário ESTÁ em /chat, zera o latestEvent ativamente
  // (ele já vê tudo, não precisa de toast)
  useEffect(() => {
    if (pathname?.startsWith('/chat')) setLatestEvent(null)
  }, [pathname, channels])

  const totalUnread = useMemo(
    () => channels.reduce((s, c) => s + (c.unread_count || 0), 0),
    [channels]
  )

  // Quando está na rota /chat, zera o badge global (UX: você já está lendo)
  const visibleTotal = pathname?.startsWith('/chat') ? 0 : totalUnread

  const value = useMemo<ChatNotifContext>(() => ({
    totalUnread: visibleTotal,
    channels,
    mute,
    setMute,
    desktopPermission,
    requestDesktopPermission,
    latestEvent,
    clearLatestEvent,
  }), [visibleTotal, channels, mute, setMute, desktopPermission, requestDesktopPermission, latestEvent, clearLatestEvent])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChatNotifications(): ChatNotifContext {
  return useContext(Ctx)
}
