'use client'

// Side-effects globais das notificações do chat. Sem UI direta, exceto o toast
// no canto inferior-direito. Consome o ChatNotificationsProvider.
//
// Regras de quando dispara cada coisa:
// - Título da aba + favicon: sempre, refletindo totalUnread global
// - Som + desktop notif: SÓ quando aba NÃO está focada, e mute = false
// - Toast in-app: SÓ quando aba está focada MAS fora de /chat
// - /chat zera tudo (provider já cuida do badge global)

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useChatNotifications } from '@/lib/team-chat/notifications-provider'

const ORIGINAL_TITLE = 'NGP Space'
const TOAST_AUTO_DISMISS_MS = 6000

export default function ChatNotificationsEffects() {
  const pathname = usePathname()
  const { totalUnread, latestEvent, mute, desktopPermission, clearLatestEvent } = useChatNotifications()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioBlockedRef = useRef(false)
  const lastEventIdRef = useRef<number>(0)
  const [toastVisible, setToastVisible] = useState(false)
  const [toastText, setToastText] = useState('')
  const [toastChannelId, setToastChannelId] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 1. Título da aba (global, qualquer rota)
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) ${ORIGINAL_TITLE}` : ORIGINAL_TITLE
    return () => { document.title = ORIGINAL_TITLE }
  }, [totalUnread])

  // 2. Favicon dinâmico com bolinha vermelha + número
  useEffect(() => {
    drawFavicon(totalUnread)
  }, [totalUnread])

  // 3-4-5. Reage a um novo evento (delta de unread)
  useEffect(() => {
    if (!latestEvent) return
    if (latestEvent.timestamp === lastEventIdRef.current) return
    lastEventIdRef.current = latestEvent.timestamp

    const tabFocused = document.hasFocus()
    const isInChat = pathname?.startsWith('/chat') ?? false

    if (isInChat) return

    // Som — aba não-focada e não silenciado
    if (!tabFocused && !mute) {
      playNotificationBeep(audioBlockedRef)
    }

    // Desktop — aba não-focada, permissão granted, não silenciado
    if (!tabFocused && !mute && desktopPermission === 'granted') {
      try {
        const title = latestEvent.isDM ? 'Nova mensagem' : `Nova mensagem em ${latestEvent.channelName}`
        const body = latestEvent.isDM
          ? `${latestEvent.channelName} enviou ${latestEvent.unreadIncrement} mensagem${latestEvent.unreadIncrement > 1 ? 's' : ''}`
          : `${latestEvent.unreadIncrement} nova${latestEvent.unreadIncrement > 1 ? 's' : ''}`
        const n = new Notification(title, {
          body,
          icon: '/favicon.ico',
          tag: `chat-${latestEvent.channelId}`,
          requireInteraction: false,
          silent: true,
        })
        n.onclick = () => {
          window.focus()
          window.location.href = '/chat?canal=' + encodeURIComponent(latestEvent.channelId)
          n.close()
        }
      } catch (e) {
        console.warn('[chat-notif] desktop notification failed:', e)
      }
    }

    // Toast in-app — aba focada, fora de /chat
    if (tabFocused) {
      const text = latestEvent.isDM
        ? `${latestEvent.channelName} te enviou ${latestEvent.unreadIncrement === 1 ? 'uma mensagem' : `${latestEvent.unreadIncrement} mensagens`}`
        : `${latestEvent.unreadIncrement === 1 ? 'Nova mensagem' : `${latestEvent.unreadIncrement} novas mensagens`} em ${latestEvent.channelName}`
      setToastText(text)
      setToastChannelId(latestEvent.channelId)
      setToastVisible(true)
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setToastVisible(false), TOAST_AUTO_DISMISS_MS)
    }
  }, [latestEvent, mute, desktopPermission, pathname])

  useEffect(() => {
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current) }
  }, [])

  function handleToastClick() {
    if (!toastChannelId) return
    setToastVisible(false)
    clearLatestEvent()
    window.location.href = '/chat?canal=' + encodeURIComponent(toastChannelId)
  }

  function handleToastDismiss(e: React.MouseEvent) {
    e.stopPropagation()
    setToastVisible(false)
    clearLatestEvent()
  }

  return (
    <>
      {/* audioRef mantido pra compat futura — som atual é sintetizado via Web Audio API.
          Trocar pra <audio src="..."> se preferir um sample customizado. */}
      <audio ref={audioRef} preload="none" style={{ display: 'none' }} />

      {toastVisible && (
        <div
          onClick={handleToastClick}
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 9999,
            maxWidth: 340,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: '12px 14px 12px 16px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.05)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            animation: 'chatToastSlideIn 0.25s ease-out',
          }}
        >
          <div
            style={{
              flex: '0 0 32px',
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #6D28D9, #ec4899)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
            aria-hidden
          >
            💬
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#111', marginBottom: 2 }}>
              Nova mensagem
            </div>
            <div style={{ fontSize: 12, color: '#4b5563', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {toastText}
            </div>
          </div>
          <button
            onClick={handleToastDismiss}
            aria-label="Fechar"
            style={{
              flex: '0 0 auto',
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              fontSize: 16,
              cursor: 'pointer',
              padding: 2,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

      <style jsx global>{`
        @keyframes chatToastSlideIn {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function drawFavicon(unread: number) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Fundo do app (gradiente roxo NGP — combina com a marca)
    const grad = ctx.createLinearGradient(0, 0, 64, 64)
    grad.addColorStop(0, '#6D28D9')
    grad.addColorStop(1, '#9333EA')
    ctx.fillStyle = grad
    // roundRect ainda não é universal — fallback pra rect normal
    if (typeof (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect === 'function') {
      (ctx as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(0, 0, 64, 64, 12)
      ctx.fill()
    } else {
      ctx.fillRect(0, 0, 64, 64)
    }

    // "N" branca no centro
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 38px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('N', 32, 36)

    // Bolinha vermelha com contador no canto superior direito
    if (unread > 0) {
      ctx.fillStyle = '#ef4444'
      ctx.beginPath()
      ctx.arc(48, 16, 16, 0, Math.PI * 2)
      ctx.fill()

      const label = unread > 9 ? '9+' : String(unread)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 18px -apple-system, sans-serif'
      ctx.fillText(label, 48, 18)
    }

    const dataUrl = canvas.toDataURL('image/png')
    let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = dataUrl
  } catch (e) {
    console.warn('[chat-notif] favicon draw failed:', e)
  }
}

// Sintetiza um beep curto via Web Audio API — sem dependência de arquivo .mp3,
// e ainda assim sujeito à política de autoplay (precisa de interação prévia).
// Duas notas (E5 + A5, ~200ms total) — sutil, profissional, não estridente.
let _audioCtx: AudioContext | null = null
function playNotificationBeep(blockedRef: React.MutableRefObject<boolean>) {
  if (blockedRef.current) return
  try {
    if (!_audioCtx) {
      const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      _audioCtx = new Ctor()
    }
    const ctx = _audioCtx
    if (ctx.state === 'suspended') {
      // O resume() vai falhar se nunca houve interação — marca como blocked
      ctx.resume().catch(() => { blockedRef.current = true })
    }
    const now = ctx.currentTime

    const playTone = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + startOffset)
      gain.gain.linearRampToValueAtTime(0.18, now + startOffset + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + startOffset)
      osc.stop(now + startOffset + duration + 0.05)
    }
    playTone(659.25, 0, 0.12)    // E5
    playTone(880.00, 0.08, 0.16) // A5 (overlapping pra ficar agradável)
  } catch (e) {
    console.warn('[chat-notif] beep failed:', e)
    blockedRef.current = true
  }
}
