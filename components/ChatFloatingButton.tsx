'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { MessageCircle, X, ChevronRight, ExternalLink, Bug } from 'lucide-react'
import { getSession } from '@/lib/auth'
import { isChatEnabled, useChannels } from '@/lib/team-chat'
import type { TeamChatChannelWithUnread } from '@/lib/team-chat'
import { FEEDBACK_OPEN_EVENT } from './FeedbackFloatingButton'

const HIDDEN_PATHS = ['/login', '/', '/chat']

function formatRelative(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  if (diff < 60_000) return 'agora'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

export default function ChatFloatingButton() {
  const pathname = usePathname()
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const enabled = isChatEnabled()

  useEffect(() => {
    const check = () => setVisible(!!getSession())
    check()
    window.addEventListener('storage', check)
    window.addEventListener('focus', check)
    return () => {
      window.removeEventListener('storage', check)
      window.removeEventListener('focus', check)
    }
  }, [pathname])

  // hooks sempre chamados, mesmo se não vai renderizar (evita warning de hooks condicionais)
  const { channels } = useChannels()

  const grouped = useMemo(() => {
    const generals = channels
      .filter((c) => c.type === 'general')
      .sort((a, b) => {
        const aT = a.last_message_at ?? a.created_at
        const bT = b.last_message_at ?? b.created_at
        return bT.localeCompare(aT)
      })
    const clients = channels
      .filter((c) => c.type === 'client')
      .sort((a, b) => {
        const aHas = a.last_message_at ? 1 : 0
        const bHas = b.last_message_at ? 1 : 0
        if (aHas !== bHas) return bHas - aHas
        const aT = a.last_message_at ?? ''
        const bT = b.last_message_at ?? ''
        if (aT && bT) return bT.localeCompare(aT)
        return a.nome.localeCompare(b.nome, 'pt-BR')
      })
    return { generals, clients }
  }, [channels])

  const unread = useMemo(
    () => channels.reduce((sum, c) => sum + (c.unread_count || 0), 0),
    [channels]
  )

  if (!enabled) return null
  if (!visible) return null
  if (HIDDEN_PATHS.includes(pathname)) return null

  const openChannel = (id: string) => {
    setOpen(false)
    router.push(`/chat?channel=${id}`)
  }

  const goToFullChat = () => {
    setOpen(false)
    router.push('/chat')
  }

  const openFeedbackModal = () => {
    setOpen(false)
    window.dispatchEvent(new Event(FEEDBACK_OPEN_EVENT))
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title={unread > 0 ? `${unread} mensagens não lidas` : 'Chat NGP'}
          aria-label="Chat NGP"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #4338ca)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 6px 24px rgba(99, 102, 241, 0.45)',
            transition: 'transform 0.18s ease, box-shadow 0.18s ease',
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)'
            ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 30px rgba(99, 102, 241, 0.65)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
            ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 24px rgba(99, 102, 241, 0.45)'
          }}
        >
          <MessageCircle size={22} color="#fff" />
          {unread > 0 && (
            <span
              style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                minWidth: '22px',
                height: '22px',
                padding: '0 6px',
                background: '#ef4444',
                color: '#fff',
                borderRadius: '11px',
                fontSize: '11px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                border: '2px solid #0f1115',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            width: '360px',
            maxHeight: 'calc(100vh - 48px)',
            background: '#111318',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '14px',
            boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            animation: 'chatPanelIn 0.18s ease-out',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #6366f1, #4338ca)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageCircle size={18} color="#fff" />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: '14px', letterSpacing: '0.01em' }}>
                Chat NGP
              </span>
              {unread > 0 && (
                <span
                  style={{
                    background: 'rgba(255,255,255,0.22)',
                    color: '#fff',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '9px',
                  }}
                >
                  {unread} não lidas
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              style={{
                background: 'rgba(255,255,255,0.12)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '4px',
                borderRadius: '6px',
              }}
            >
              <X size={16} color="#fff" />
            </button>
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {channels.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#8b92a5', fontSize: '12.5px' }}>
                Nenhum canal disponível.
              </div>
            ) : (
              <>
                {grouped.generals.length > 0 && (
                  <ChannelSection title="Equipe" channels={grouped.generals} onSelect={openChannel} isGeneral />
                )}
                {grouped.clients.length > 0 && (
                  <ChannelSection title="Clientes" channels={grouped.clients} onSelect={openChannel} />
                )}
              </>
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid rgba(255,255,255,0.08)',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              background: '#0d1015',
            }}
          >
            <button
              type="button"
              onClick={goToFullChat}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '10px',
                borderRadius: '8px',
                background: '#1a1f29',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <ExternalLink size={14} /> Abrir chats
            </button>
            <button
              type="button"
              onClick={openFeedbackModal}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '6px',
                background: 'transparent',
                border: 'none',
                color: '#8b92a5',
                fontSize: '11.5px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <Bug size={12} /> Reportar bug ou enviar feedback
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes chatPanelIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
      `}</style>
    </>
  )
}

function ChannelSection({
  title,
  channels,
  onSelect,
  isGeneral = false,
}: {
  title: string
  channels: TeamChatChannelWithUnread[]
  onSelect: (id: string) => void
  isGeneral?: boolean
}) {
  return (
    <div>
      <div
        style={{
          padding: '12px 16px 6px',
          fontSize: '10px',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          color: '#6b7280',
          fontWeight: 700,
        }}
      >
        {title}
      </div>
      <div>
        {channels.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '8px 16px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#cbd5e1',
              fontSize: '13px',
              fontFamily: 'inherit',
              textAlign: 'left',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#1a1f29')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
              <span style={{ color: '#6b7280', fontWeight: 600 }}>{isGeneral ? '#' : '·'}</span>
              <span
                style={{
                  fontWeight: c.unread_count > 0 ? 700 : 500,
                  color: c.unread_count > 0 ? '#fff' : '#cbd5e1',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {c.nome}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {c.last_message_at && (
                <span style={{ fontSize: '10.5px', color: '#6b7280' }}>{formatRelative(c.last_message_at)}</span>
              )}
              {c.unread_count > 0 ? (
                <span
                  style={{
                    background: '#ef4444',
                    color: '#fff',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '9px',
                    minWidth: '18px',
                    textAlign: 'center',
                  }}
                >
                  {c.unread_count > 99 ? '99+' : c.unread_count}
                </span>
              ) : (
                <ChevronRight size={13} color="#4a5168" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
