'use client'

import { Fragment, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { getSession } from '@/lib/auth'
import WorkspaceTopbar from '@/components/WorkspaceTopbar'
import {
  isChatEnabled,
  useChannels,
  useMessages,
  getAttachmentSignedUrl,
  isDriveLink,
  resolveCurrentUsuarioId,
  isCurrentUserAdmin,
  togglePinMessage,
  toggleFavorite,
  setSortOrders,
  listMentionable,
  parseMentions,
  MAX_FILES_PER_MESSAGE,
  MAX_FILE_SIZE_BYTES,
  PICKER_EMOJIS,
  FileTooLargeError,
  FileTypeNotAllowedError,
} from '@/lib/team-chat'
import type { MentionableUser } from '@/lib/team-chat'
import CreateChannelModal from './CreateChannelModal'
import ChannelInfoPanel from './ChannelInfoPanel'
import NewDmModal from './NewDmModal'
import type { TeamChatAttachment, TeamChatChannelWithUnread, MessageWithAttachments, MessageMention } from '@/lib/team-chat'
import styles from './chat.module.css'

function initials(nome: string | null | undefined): string {
  if (!nome) return '?'
  const parts = nome.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function ChatPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [usuarioId, setUsuarioId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    setMounted(true)
    setEnabled(isChatEnabled())
    const session = getSession()
    if (!session?.auth || session.auth !== '1') {
      router.replace('/login')
      return
    }
    resolveCurrentUsuarioId(session.session)
      .then((id) => {
        if (id) setUsuarioId(id)
        else router.replace('/login')
      })
      .catch(() => router.replace('/login'))
    isCurrentUserAdmin(session.session)
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false))
  }, [router])

  if (!mounted || enabled === null) {
    return <div className={styles.loadingScreen}>Carregando…</div>
  }

  if (!enabled) {
    return (
      <div className={styles.disabledScreen}>
        <strong>Chat desabilitado</strong>
        <span>Defina NEXT_PUBLIC_INTERNAL_CHAT_ENABLED=true para ativar.</span>
      </div>
    )
  }

  if (!usuarioId) {
    return <div className={styles.loadingScreen}>Verificando sessão…</div>
  }

  return (
    <Suspense fallback={<div className={styles.loadingScreen}>Carregando…</div>}>
      <ChatShell usuarioId={usuarioId} isAdmin={isAdmin} />
    </Suspense>
  )
}

function ChatShell({ usuarioId, isAdmin }: { usuarioId: string; isAdmin: boolean }) {
  const { channels, loading: loadingChannels, refetch: refetchChannels } = useChannels(usuarioId)
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [dmModalOpen, setDmModalOpen] = useState(false)
  const [infoPanelOpen, setInfoPanelOpen] = useState(false)
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null)

  const handleToggleFavorite = async (channelId: string) => {
    try {
      await toggleFavorite(channelId)
      refetchChannels()
    } catch {}
  }

  const handleReorder = async (newOrderIds: string[]) => {
    try {
      const orders = newOrderIds.map((_, i) => i)
      await setSortOrders(newOrderIds, orders)
      refetchChannels()
    } catch {}
  }
  const searchParams = useSearchParams()
  const initialParamApplied = useRef(false)

  // Aplica o ?channel= apenas uma vez (na primeira chegada do canal nos dados);
  // depois disso o usuário pode trocar livremente pela sidebar.
  useEffect(() => {
    if (channels.length === 0) return
    if (!initialParamApplied.current) {
      const param = searchParams?.get('channel') ?? null
      if (param && channels.some((c) => c.id === param)) {
        setActiveChannelId(param)
        initialParamApplied.current = true
        return
      }
      initialParamApplied.current = true
    }
    if (!activeChannelId) {
      const geral = channels.find((c) => c.type === 'general' && c.slug === 'geral')
      setActiveChannelId(geral?.id ?? channels[0].id)
    }
  }, [channels, activeChannelId, searchParams])

  // Fecha drawer ao trocar de canal
  useEffect(() => {
    setInfoPanelOpen(false)
  }, [activeChannelId])

  const totalUnread = useMemo(
    () => channels.reduce((sum, c) => sum + c.unread_count, 0),
    [channels]
  )

  useEffect(() => {
    const original = document.title
    document.title = totalUnread > 0 ? `(${totalUnread}) Chat NGP` : 'Chat NGP'
    return () => {
      document.title = original
    }
  }, [totalUnread])

  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? null

  // Ordena cada bucket por sort_order asc, depois last_message_at desc, depois nome
  const sortChannels = (list: TeamChatChannelWithUnread[]) =>
    [...list].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      const at = a.last_message_at ?? ''
      const bt = b.last_message_at ?? ''
      if (at !== bt) return bt.localeCompare(at)
      return a.nome.localeCompare(b.nome, 'pt-BR')
    })

  // Buckets: favoritos sobem pro topo (independente do tipo)
  const favoriteChannels = sortChannels(channels.filter((c) => c.is_favorite))
  const generalChannels = sortChannels(
    channels.filter((c) => c.type === 'general' && !c.is_favorite)
  )
  const dmChannels = sortChannels(channels.filter((c) => c.type === 'dm' && !c.is_favorite))
  const clientChannels = sortChannels(
    channels.filter((c) => c.type === 'client' && !c.is_favorite)
  )

  // Estado de abertura de cada seção, persistido em localStorage
  const useSectionState = (key: string, defaultOpen: boolean) => {
    const [open, setOpen] = useState(defaultOpen)
    useEffect(() => {
      try {
        const saved = localStorage.getItem(key)
        if (saved !== null) setOpen(saved === '1')
      } catch {}
    }, [key])
    const toggle = () => {
      setOpen((prev) => {
        const next = !prev
        try {
          localStorage.setItem(key, next ? '1' : '0')
        } catch {}
        return next
      })
    }
    return [open, toggle] as const
  }

  const [favOpen, toggleFav] = useSectionState('team-chat-fav-open', true)
  const [teamOpen, toggleTeam] = useSectionState('team-chat-team-open', true)
  const [dmsOpen, toggleDms] = useSectionState('team-chat-dms-open', true)
  const [clientsOpen, toggleClients] = useSectionState('team-chat-clients-open', false)

  const favUnread = favoriteChannels.reduce((s, c) => s + (c.unread_count || 0), 0)
  const teamUnread = generalChannels.reduce((s, c) => s + (c.unread_count || 0), 0)
  const dmsUnread = dmChannels.reduce((s, c) => s + (c.unread_count || 0), 0)
  const clientsUnread = clientChannels.reduce((s, c) => s + (c.unread_count || 0), 0)

  return (
    <div className={styles.pageWrapper}>
      <WorkspaceTopbar subtitle="CHAT INTERNO NGP" />
      <div
        className={`${styles.shell} ${
          infoPanelOpen && activeChannel ? styles.shellWithDrawer : ''
        }`}
      >
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            Chat NGP
            <small>{loadingChannels ? 'carregando…' : `${channels.length} canais`}</small>
          </div>
          <div className={styles.sidebarScroll}>
            <SidebarSection
              title="Favoritos"
              channels={favoriteChannels}
              count={favoriteChannels.length}
              unread={favUnread}
              open={favOpen}
              onToggle={toggleFav}
              activeChannelId={activeChannelId}
              onSelectChannel={setActiveChannelId}
              onToggleFavorite={handleToggleFavorite}
              onReorder={handleReorder}
              hideWhenEmpty
            />
            <SidebarSection
              title="Equipe"
              channels={generalChannels}
              count={generalChannels.length}
              unread={teamUnread}
              open={teamOpen}
              onToggle={toggleTeam}
              activeChannelId={activeChannelId}
              onSelectChannel={setActiveChannelId}
              onToggleFavorite={handleToggleFavorite}
              onReorder={handleReorder}
              actionBtn={
                isAdmin && (
                  <button
                    type="button"
                    className={styles.sectionAddBtn}
                    onClick={(e) => {
                      e.stopPropagation()
                      setCreateModalOpen(true)
                    }}
                    title="Criar novo canal"
                    aria-label="Criar novo canal"
                  >
                    +
                  </button>
                )
              }
            />
            <SidebarSection
              title="Mensagens diretas"
              channels={dmChannels}
              count={dmChannels.length}
              unread={dmsUnread}
              open={dmsOpen}
              onToggle={toggleDms}
              activeChannelId={activeChannelId}
              onSelectChannel={setActiveChannelId}
              onToggleFavorite={handleToggleFavorite}
              onReorder={handleReorder}
              actionBtn={
                <button
                  type="button"
                  className={styles.sectionAddBtn}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDmModalOpen(true)
                  }}
                  title="Nova mensagem direta"
                  aria-label="Nova mensagem direta"
                >
                  +
                </button>
              }
            />
            <SidebarSection
              title="Clientes"
              channels={clientChannels}
              count={clientChannels.length}
              unread={clientsUnread}
              open={clientsOpen}
              onToggle={toggleClients}
              activeChannelId={activeChannelId}
              onSelectChannel={setActiveChannelId}
              onToggleFavorite={handleToggleFavorite}
              onReorder={handleReorder}
              isClientSection
            />
          </div>
        </aside>

        {activeChannel ? (
          <ChatMain
            key={activeChannel.id}
            channel={activeChannel}
            usuarioId={usuarioId}
            onActivity={refetchChannels}
            infoPanelOpen={infoPanelOpen}
            onToggleInfoPanel={() => setInfoPanelOpen((v) => !v)}
            externalJumpToMessageId={jumpToMessageId}
            onJumpHandled={() => setJumpToMessageId(null)}
          />
        ) : (
          <main className={styles.main}>
            <div className={styles.empty}>
              <strong>Selecione um canal</strong>
              <span>Escolha um canal na lateral para começar.</span>
            </div>
          </main>
        )}
        {infoPanelOpen && activeChannel && (
          <ChannelInfoPanel
            channel={activeChannel}
            onClose={() => setInfoPanelOpen(false)}
            onJumpToMessage={(id) => setJumpToMessageId(id)}
          />
        )}
      </div>
      {createModalOpen && (
        <CreateChannelModal
          usuarioId={usuarioId}
          onClose={() => setCreateModalOpen(false)}
          onCreated={(id) => {
            setCreateModalOpen(false)
            refetchChannels()
            setActiveChannelId(id)
          }}
        />
      )}
      {dmModalOpen && (
        <NewDmModal
          usuarioId={usuarioId}
          onClose={() => setDmModalOpen(false)}
          onOpened={(id) => {
            setDmModalOpen(false)
            refetchChannels()
            setActiveChannelId(id)
          }}
        />
      )}
    </div>
  )
}

function SortableChannelItem({
  channel,
  active,
  onClick,
  onToggleFavorite,
  isClient,
}: {
  channel: TeamChatChannelWithUnread
  active: boolean
  onClick: () => void
  onToggleFavorite: () => void
  isClient: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: channel.id,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ChannelItem
        channel={channel}
        active={active}
        onClick={onClick}
        onToggleFavorite={onToggleFavorite}
        isClient={isClient}
      />
    </div>
  )
}

function SidebarSection({
  title,
  channels,
  count,
  unread,
  open,
  onToggle,
  activeChannelId,
  onSelectChannel,
  onToggleFavorite,
  onReorder,
  actionBtn,
  isClientSection = false,
  hideWhenEmpty = false,
}: {
  title: string
  channels: TeamChatChannelWithUnread[]
  count: number
  unread: number
  open: boolean
  onToggle: () => void
  activeChannelId: string | null
  onSelectChannel: (id: string) => void
  onToggleFavorite: (id: string) => void
  onReorder: (newOrderIds: string[]) => void
  actionBtn?: React.ReactNode
  isClientSection?: boolean
  hideWhenEmpty?: boolean
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  if (hideWhenEmpty && channels.length === 0) return null

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: act, over } = event
    if (!over || act.id === over.id) return
    const oldIndex = channels.findIndex((c) => c.id === act.id)
    const newIndex = channels.findIndex((c) => c.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(channels, oldIndex, newIndex)
    onReorder(reordered.map((c) => c.id))
  }

  return (
    <>
      <div className={styles.sectionLabelRow}>
        <button
          type="button"
          className={styles.sectionToggle}
          onClick={onToggle}
          aria-expanded={open}
          style={{ flex: 1, padding: 0, minWidth: 0 }}
        >
          <span className={styles.sectionToggleLabel}>
            <span className={`${styles.sectionChevron} ${open ? '' : styles.sectionChevronCollapsed}`}>
              <ChevronDown size={12} />
            </span>
            {title}
            {count > 0 && <span className={styles.sectionToggleCount}>{count}</span>}
            {unread > 0 && (
              <span className={styles.sectionUnread}>{unread > 99 ? '99+' : unread}</span>
            )}
          </span>
        </button>
        {actionBtn}
      </div>
      {open && channels.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={channels.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className={styles.channelList}>
              {channels.map((c) => (
                <SortableChannelItem
                  key={c.id}
                  channel={c}
                  active={c.id === activeChannelId}
                  onClick={() => onSelectChannel(c.id)}
                  onToggleFavorite={() => onToggleFavorite(c.id)}
                  isClient={isClientSection}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </>
  )
}

function channelInitials(nome: string): string {
  const parts = nome.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function ChannelItem({
  channel,
  active,
  onClick,
  onToggleFavorite,
  isClient = false,
}: {
  channel: TeamChatChannelWithUnread
  active: boolean
  onClick: () => void
  onToggleFavorite?: () => void
  isClient?: boolean
}) {
  const isDm = channel.type === 'dm'
  const cls = [
    styles.channelItem,
    active ? styles.channelItemActive : '',
    isClient ? styles.channelItemClient : '',
    isDm ? styles.channelItemDm : '',
    channel.is_private && !isDm ? styles.channelItemPrivate : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} onClick={onClick}>
      <span className={styles.channelItemRow}>
        {isDm && (
          <span className={styles.channelItemAvatar}>
            {channel.dm_other_foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={channel.dm_other_foto} alt={channel.dm_other_nome ?? ''} />
            ) : (
              channelInitials(channel.dm_other_nome ?? channel.nome)
            )}
          </span>
        )}
        <span className={styles.channelName}>{channel.nome}</span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {onToggleFavorite && (
          <button
            type="button"
            className={`${styles.favoriteStar} ${channel.is_favorite ? styles.favoriteStarActive : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite()
            }}
            title={channel.is_favorite ? 'Remover dos favoritos' : 'Favoritar'}
            aria-label="Favoritar"
          >
            {channel.is_favorite ? '★' : '☆'}
          </button>
        )}
        {channel.unread_count > 0 && (
          <span className={styles.unreadBadge}>{channel.unread_count > 99 ? '99+' : channel.unread_count}</span>
        )}
      </span>
    </div>
  )
}

function ChatMain({
  channel,
  usuarioId,
  onActivity,
  infoPanelOpen,
  onToggleInfoPanel,
  externalJumpToMessageId,
  onJumpHandled,
}: {
  channel: TeamChatChannelWithUnread
  usuarioId: string
  onActivity: () => void
  infoPanelOpen: boolean
  onToggleInfoPanel: () => void
  externalJumpToMessageId: string | null
  onJumpHandled: () => void
}) {
  const {
    messages,
    pending,
    loading,
    send,
    sendWithFiles,
    retry,
    markRead,
    react,
    remove,
    frozenLastReadAt,
    lastReadSnapshotReady,
  } = useMessages({
    channelId: channel.id,
    autorUsuarioId: usuarioId,
  })
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<MessageWithAttachments | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // mencionáveis do canal atual + estado do popup @
  const [mentionable, setMentionable] = useState<MentionableUser[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const unreadDividerRef = useRef<HTMLDivElement | null>(null)
  const scrolledToDividerRef = useRef(false)

  // Carrega mencionáveis ao trocar de canal
  useEffect(() => {
    listMentionable(channel.id)
      .then(setMentionable)
      .catch(() => setMentionable([]))
  }, [channel.id])

  // Filtra mencionáveis baseado na query atual
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    const specials: MentionableUser[] = [
      { id: '__all__', nome: '@all', email: 'Notifica todos do canal', username: 'all' },
      { id: '__here__', nome: '@here', email: 'Notifica todos do canal', username: 'here' },
    ]
    const filteredSpecials = specials.filter((s) => s.username.startsWith(q))
    const filteredUsers = mentionable
      .filter(
        (u) =>
          u.nome.toLowerCase().includes(q) ||
          u.username.toLowerCase().startsWith(q)
      )
      .slice(0, 8)
    return [...filteredSpecials, ...filteredUsers]
  }, [mentionQuery, mentionable])

  // Reseta índice ao mudar a lista
  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery])

  // Índice da primeira mensagem mais nova que o último read congelado.
  // -1 se não houver não-lidas (ou se todas as novas forem do próprio usuário).
  const unreadDividerIndex = useMemo(() => {
    if (!frozenLastReadAt) return -1
    let idx = -1
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].created_at > frozenLastReadAt) {
        idx = i
        break
      }
    }
    if (idx < 0) return -1
    const allMine = messages
      .slice(idx)
      .every((m) => m.autor_usuario_id === usuarioId)
    return allMine ? -1 : idx
  }, [messages, frozenLastReadAt, usuarioId])

  const scrollToMessage = (id: string) => {
    const el = messageRefs.current.get(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(id)
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1400)
  }

  const startReply = (m: MessageWithAttachments) => {
    setReplyingTo(m)
    textareaRef.current?.focus()
  }

  const handleTogglePin = async (messageId: string) => {
    try {
      await togglePinMessage(messageId)
    } catch (e) {
      alert((e as Error).message || 'Erro ao fixar mensagem')
    }
  }

  // Pular pra mensagem solicitada externamente (vindo do drawer)
  useEffect(() => {
    if (!externalJumpToMessageId) return
    const tryJump = () => {
      const el = messageRefs.current.get(externalJumpToMessageId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightId(externalJumpToMessageId)
        setTimeout(() => setHighlightId((cur) => (cur === externalJumpToMessageId ? null : cur)), 1400)
        onJumpHandled()
      }
    }
    // pode demorar 1 frame pra elemento estar montado
    requestAnimationFrame(() => requestAnimationFrame(tryJump))
  }, [externalJumpToMessageId, onJumpHandled])

  // Marca como lido só depois que o snapshot do last_read foi capturado.
  // Evita race: se markRead rodar antes, sobrescreve e o separador nunca aparece.
  useEffect(() => {
    if (!lastReadSnapshotReady) return
    if (loading || messages.length === 0) return
    const t = setTimeout(() => {
      markRead().then(onActivity).catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [channel.id, loading, messages.length, markRead, onActivity, lastReadSnapshotReady])

  useEffect(() => {
    // Não rola pro fim se ainda não rolamos pro divisor "Novas mensagens" —
    // senão pulamos por cima do separador.
    if (unreadDividerIndex >= 0 && !scrolledToDividerRef.current) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, pending.size, unreadDividerIndex])

  // reset composer ao trocar de canal
  useEffect(() => {
    setDraft('')
    setFiles([])
    setComposerError(null)
    setReplyingTo(null)
    scrolledToDividerRef.current = false
    unreadDividerRef.current = null
  }, [channel.id])

  // Quando o divisor "Novas mensagens" aparecer pela primeira vez no canal,
  // rola até ele em vez de pular pro final.
  useEffect(() => {
    if (scrolledToDividerRef.current) return
    if (unreadDividerIndex < 0) return
    if (!unreadDividerRef.current) return
    unreadDividerRef.current.scrollIntoView({ behavior: 'auto', block: 'center' })
    scrolledToDividerRef.current = true
  }, [unreadDividerIndex, messages.length])

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return
    setComposerError(null)
    const next = [...files]
    for (const f of incoming) {
      if (next.length >= MAX_FILES_PER_MESSAGE) {
        setComposerError(`Máximo ${MAX_FILES_PER_MESSAGE} arquivos por mensagem.`)
        break
      }
      if (f.size > MAX_FILE_SIZE_BYTES) {
        setComposerError(
          `"${f.name}" excede 50 MB. Use o Google Drive da NGP e cole o link no chat.`
        )
        continue
      }
      next.push(f)
    }
    setFiles(next)
  }

  const removeFile = (idx: number) => {
    setFiles(files.filter((_, i) => i !== idx))
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (sending) return
    if (!text && files.length === 0) return

    setSending(true)
    setComposerError(null)
    const textToSend = text
    const filesToSend = files
    const replyTarget = replyingTo
    setDraft('')
    setFiles([])
    setReplyingTo(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
      if (filesToSend.length > 0) {
        // anexos não suportam reply ainda; mantemos texto e arquivo
        await sendWithFiles(textToSend, filesToSend)
      } else {
        const mentions = parseMentions(textToSend, mentionable)
        await send(textToSend, replyTarget?.id ?? null, mentions)
      }
      onActivity()
    } catch (e) {
      if (e instanceof FileTooLargeError || e instanceof FileTypeNotAllowedError) {
        setComposerError(e.message)
      } else {
        setComposerError((e as Error).message || 'Erro ao enviar')
      }
      setDraft(textToSend)
      setFiles(filesToSend)
      setReplyingTo(replyTarget)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Se popup de menção está aberto, captura setas/Tab/Enter
    if (mentionQuery !== null && mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        completeMention(mentionSuggestions[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }
    if (e.key === 'Escape' && replyingTo) {
      e.preventDefault()
      setReplyingTo(null)
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setDraft(value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'

    // Detecta @ + token até o cursor
    const caret = el.selectionStart ?? value.length
    const before = value.slice(0, caret)
    // Aceita @ no início ou após whitespace/quebra
    const m = before.match(/(?:^|\s)@([\p{L}\p{N}._-]*)$/u)
    setMentionQuery(m ? m[1] : null)
  }

  const completeMention = (suggestion: MentionableUser) => {
    const el = textareaRef.current
    if (!el) return
    const caret = el.selectionStart ?? draft.length
    const before = draft.slice(0, caret)
    const after = draft.slice(caret)
    // Token preferido: 'all'/'here' pra especiais, ou primeiro nome em lowercase.
    // username pode conter '@' (email) — não usamos diretamente.
    const token = suggestion.id.startsWith('__')
      ? suggestion.username // 'all' ou 'here'
      : suggestion.nome.split(/\s+/)[0]?.toLowerCase() ?? suggestion.username.split('@')[0]
    const replaced = before.replace(/(@[\p{L}\p{N}._-]*)$/u, `@${token} `)
    const newValue = replaced + after
    setDraft(newValue)
    setMentionQuery(null)
    const newCaret = replaced.length
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCaret, newCaret)
      }
    })
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted: File[] = []
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) pasted.push(f)
      }
    }
    if (pasted.length > 0) {
      e.preventDefault()
      addFiles(pasted)
    }
  }

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? [])
    addFiles(list)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const pendingArray = useMemo(() => Array.from(pending.values()), [pending])

  return (
    <main className={styles.main}>
      <header className={styles.mainHeader}>
        <div
          className={`${styles.mainTitle} ${styles.mainTitleClickable}`}
          onClick={onToggleInfoPanel}
          role="button"
          tabIndex={0}
          title={infoPanelOpen ? 'Fechar painel do canal' : 'Abrir painel do canal'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onToggleInfoPanel()
            }
          }}
        >
          {channel.type === 'general'
            ? channel.is_private
              ? `🔒 ${channel.nome}`
              : `#${channel.nome.toLowerCase()}`
            : channel.nome}
          {channel.descricao && <small>{channel.descricao}</small>}
        </div>
      </header>

      <div className={styles.messagesList}>
        {loading && messages.length === 0 ? (
          <div className={styles.empty}>
            <span>Carregando mensagens…</span>
          </div>
        ) : messages.length === 0 && pendingArray.length === 0 ? (
          <div className={styles.empty}>
            <strong>Nenhuma mensagem ainda</strong>
            <span>Seja o primeiro a escrever neste canal.</span>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <Fragment key={m.id}>
                {i === unreadDividerIndex && (
                  <div
                    className={styles.unreadDivider}
                    ref={(el) => {
                      if (el) unreadDividerRef.current = el
                    }}
                  >
                    Novas mensagens
                  </div>
                )}
                <MessageRow
                  message={m}
                  currentUsuarioId={usuarioId}
                  onReply={() => startReply(m)}
                  onReact={(emoji, currentlyReacted) => react(m.id, emoji, currentlyReacted)}
                  onDelete={() => {
                    if (confirm('Apagar essa mensagem?')) remove(m.id)
                  }}
                  onPin={() => handleTogglePin(m.id)}
                  onQuoteClick={(targetId) => scrollToMessage(targetId)}
                  highlighted={highlightId === m.id}
                  registerRef={(el) => {
                    if (el) messageRefs.current.set(m.id, el)
                    else messageRefs.current.delete(m.id)
                  }}
                />
              </Fragment>
            ))}
            {pendingArray.map((p) => (
              <div
                key={p.client_generated_id}
                className={`${styles.message} ${p.status === 'sending' ? styles.messagePending : styles.messageFailed}`}
              >
                <div className={styles.avatar}>{initials('Eu')}</div>
                <div className={styles.messageBody}>
                  <div className={styles.messageHeader}>
                    <span className={styles.messageAuthor}>Você</span>
                    <span className={styles.messageTime}>
                      {p.status === 'sending' ? 'enviando…' : 'falhou'}
                    </span>
                  </div>
                  <div className={styles.messageText}>
                    {p.status === 'failed' && p.error ? p.error : '…'}
                  </div>
                  {p.status === 'failed' && (
                    <button
                      type="button"
                      className={styles.retryBtn}
                      onClick={() => retry(p.client_generated_id, draft || '')}
                    >
                      Tentar de novo
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.composer}>
        {replyingTo && (
          <div className={styles.replyPreviewBar}>
            <div className={styles.replyPreviewBarText}>
              <div className={styles.replyPreviewBarLabel}>
                Respondendo a {replyingTo.autor_nome ?? 'usuário'}
              </div>
              <div className={styles.replyPreviewBarBody}>
                {replyingTo.texto || (replyingTo.attachments.length > 0 ? '📎 anexo' : '...')}
              </div>
            </div>
            <button
              type="button"
              className={styles.replyPreviewBarClose}
              onClick={() => setReplyingTo(null)}
              aria-label="Cancelar resposta"
            >
              ×
            </button>
          </div>
        )}
        {composerError && <div className={styles.composerError}>{composerError}</div>}
        {files.length > 0 && (
          <div className={styles.composerPreview}>
            {files.map((f, idx) => (
              <div key={idx} className={styles.previewChip}>
                {f.type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={URL.createObjectURL(f)} alt={f.name} />
                ) : (
                  <span>📄</span>
                )}
                <span>{f.name}</span>
                <button type="button" onClick={() => removeFile(idx)} aria-label="Remover">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.composerWrapper}>
        {mentionQuery !== null && mentionSuggestions.length > 0 && (
          <div className={styles.mentionPopup}>
            {mentionSuggestions.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`${styles.mentionItem} ${
                  i === mentionIndex ? styles.mentionItemActive : ''
                }`}
                onMouseEnter={() => setMentionIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  completeMention(s)
                }}
              >
                <span className={styles.mentionItemAvatar}>
                  {s.id.startsWith('__') ? '@' : initials(s.nome)}
                </span>
                <span>{s.id.startsWith('__') ? s.nome : s.nome}</span>
                <span className={styles.mentionItemMeta}>
                  {s.id.startsWith('__') ? s.email : `@${s.username}`}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className={styles.composerInner}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={onFilePicked}
          />
          <button
            type="button"
            className={styles.attachBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || files.length >= MAX_FILES_PER_MESSAGE}
            title="Anexar arquivo"
          >
            +
          </button>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder={`Mensagem para ${channel.type === 'general' ? '#' + channel.nome.toLowerCase() : channel.nome}`}
            value={draft}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
          />
          <button
            type="button"
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={(!draft.trim() && files.length === 0) || sending}
          >
            Enviar
          </button>
        </div>
        </div>
      </div>
    </main>
  )
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉']

function MessageRow({
  message,
  currentUsuarioId,
  onReply,
  onReact,
  onDelete,
  onPin,
  onQuoteClick,
  highlighted,
  registerRef,
}: {
  message: MessageWithAttachments
  currentUsuarioId: string
  onReply: () => void
  onReact: (emoji: string, currentlyReacted: boolean) => void
  onDelete: () => void
  onPin: () => void
  onQuoteClick: (targetId: string) => void
  highlighted: boolean
  registerRef: (el: HTMLDivElement | null) => void
}) {
  const isPinned = !!message.pinned_at
  const [pickerOpen, setPickerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const isAuthor = message.autor_usuario_id === currentUsuarioId
  const cls = [styles.message, highlighted ? styles.messageHighlight : ''].filter(Boolean).join(' ')

  useEffect(() => {
    if (!pickerOpen && !menuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (
        t.closest(`.${styles.emojiPicker}`) ||
        t.closest(`.${styles.messageMenu}`) ||
        t.closest(`.${styles.messageActions}`)
      ) {
        return
      }
      setPickerOpen(false)
      setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [pickerOpen, menuOpen])

  const reactionByEmoji = new Map(message.reactions.map((r) => [r.emoji, r]))

  return (
    <div
      className={cls}
      ref={registerRef}
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement
        if (t.closest('a, button')) return
        onReply()
      }}
    >
      <div className={styles.avatar}>
        {message.autor_foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={message.autor_foto} alt={message.autor_nome ?? ''} />
        ) : (
          initials(message.autor_nome)
        )}
      </div>
      <div className={styles.messageBody}>
        {message.reply_preview && (
          <div
            className={styles.quoteBox}
            onClick={() => message.reply_preview && onQuoteClick(message.reply_preview.id)}
            title="Ir para mensagem original"
          >
            <div className={styles.quoteAuthor}>
              ↩ {message.reply_preview.autor_nome ?? 'usuário'}
            </div>
            <div
              className={`${styles.quoteText} ${
                message.reply_preview.deleted_at ? styles.quoteTextDeleted : ''
              }`}
            >
              {message.reply_preview.deleted_at
                ? 'Mensagem apagada'
                : message.reply_preview.texto || '📎 anexo'}
            </div>
          </div>
        )}
        <div className={styles.messageHeader}>
          {isPinned && <span className={styles.pinnedIndicator} title="Mensagem fixada">📌</span>}
          <span className={styles.messageAuthor}>{message.autor_nome ?? 'usuário'}</span>
          <span className={styles.messageTime}>{formatTime(message.created_at)}</span>
        </div>
        {message.texto && (
          <MessageText
            texto={message.texto}
            mentions={message.mentions}
            currentUsuarioId={currentUsuarioId}
          />
        )}
        {message.attachments.length > 0 && (
          <div className={styles.attachmentList}>
            {message.attachments.map((a) => (
              <AttachmentItem key={a.id} attachment={a} />
            ))}
          </div>
        )}
        {message.reactions.length > 0 && (
          <div className={styles.reactionsRow}>
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={`${styles.reactionChip} ${
                  r.reacted_by_me ? styles.reactionChipActive : ''
                }`}
                onClick={() => onReact(r.emoji, r.reacted_by_me)}
                title={r.reacted_by_me ? 'Remover reação' : 'Reagir'}
              >
                <span className={styles.reactionChipEmoji}>{r.emoji}</span>
                <span className={styles.reactionChipCount}>{r.count}</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.messageActionsWrapper}>
          <div
            className={`${styles.messageActions} ${
              pickerOpen || menuOpen ? styles.messageActionsAlwaysOn : ''
            }`}
          >
            {QUICK_REACTIONS.map((emoji) => {
              const r = reactionByEmoji.get(emoji)
              const active = !!r?.reacted_by_me
              return (
                <button
                  key={emoji}
                  type="button"
                  className={`${styles.messageActionBtn} ${styles.messageQuickEmoji} ${
                    active ? styles.messageQuickEmojiActive : ''
                  }`}
                  onClick={() => onReact(emoji, active)}
                  title={active ? `Remover ${emoji}` : `Reagir ${emoji}`}
                >
                  {emoji}
                </button>
              )
            })}
            <span className={styles.messageActionsDivider} />
            <button
              type="button"
              className={styles.messageActionBtn}
              onClick={onReply}
              title="Responder"
            >
              ↩
            </button>
            <button
              type="button"
              className={styles.messageActionBtn}
              onClick={() => {
                setMenuOpen((v) => !v)
                setPickerOpen(false)
              }}
              title="Mais"
            >
              ⋯
            </button>
          </div>

          {menuOpen && (
            <div className={styles.messageMenu}>
              <button
                type="button"
                className={styles.messageMenuItem}
                onClick={() => {
                  setMenuOpen(false)
                  setPickerOpen(true)
                }}
              >
                😊 Mais emojis…
              </button>
              <button
                type="button"
                className={styles.messageMenuItem}
                onClick={() => {
                  setMenuOpen(false)
                  onReply()
                }}
              >
                ↩ Responder
              </button>
              <button
                type="button"
                className={styles.messageMenuItem}
                onClick={() => {
                  setMenuOpen(false)
                  onPin()
                }}
              >
                📌 {isPinned ? 'Desafixar' : 'Fixar mensagem'}
              </button>
              {isAuthor && (
                <button
                  type="button"
                  className={`${styles.messageMenuItem} ${styles.messageMenuItemDanger}`}
                  onClick={() => {
                    setMenuOpen(false)
                    onDelete()
                  }}
                >
                  🗑 Apagar
                </button>
              )}
            </div>
          )}

          {pickerOpen && (
            <div className={styles.emojiPicker}>
              {PICKER_EMOJIS.map((e) => {
                const existing = reactionByEmoji.get(e)
                return (
                  <button
                    key={e}
                    type="button"
                    className={styles.emojiPickerBtn}
                    onClick={() => {
                      onReact(e, !!existing?.reacted_by_me)
                      setPickerOpen(false)
                    }}
                  >
                    {e}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageText({
  texto,
  mentions,
  currentUsuarioId,
}: {
  texto: string
  mentions: MessageMention[]
  currentUsuarioId: string
}) {
  // detecta menções @nome + drive links; resto vira texto puro
  const parts = useMemo(() => {
    type Part =
      | { type: 'text'; value: string }
      | { type: 'drive'; value: string }
      | { type: 'mention'; raw: string; kind: 'special' | 'me' | 'user' | 'unknown' }
    const out: Part[] = []

    // Regex unificada: captura @menção OU drive link
    const re = /(@[\p{L}\p{N}._-]+)|(https:\/\/(?:drive|docs)\.google\.com\/[^\s]+)/gu
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(texto))) {
      if (m.index > last) out.push({ type: 'text', value: texto.slice(last, m.index) })
      if (m[1]) {
        // menção
        const token = m[1].slice(1).toLowerCase()
        let kind: 'special' | 'me' | 'user' | 'unknown' = 'unknown'
        if (token === 'all' || token === 'todos' || token === 'here' || token === 'aqui') {
          kind = 'special'
        } else {
          // procura nas menções da mensagem
          const matched = mentions.find(
            (men) =>
              men.mention_type === 'user' &&
              men.usuario_nome &&
              men.usuario_nome.split(/\s+/)[0]?.toLowerCase() === token
          )
          if (matched) {
            kind = matched.usuario_id === currentUsuarioId ? 'me' : 'user'
          }
        }
        out.push({ type: 'mention', raw: m[1], kind })
      } else if (m[2]) {
        out.push({ type: 'drive', value: m[2] })
      }
      last = m.index + m[0].length
    }
    if (last < texto.length) out.push({ type: 'text', value: texto.slice(last) })
    return out
  }, [texto, mentions, currentUsuarioId])

  return (
    <div className={styles.messageText}>
      {parts.map((p, i) => {
        if (p.type === 'drive') {
          return (
            <a key={i} className={styles.driveLink} href={p.value} target="_blank" rel="noreferrer">
              Google Drive
            </a>
          )
        }
        if (p.type === 'mention') {
          const cls =
            p.kind === 'me'
              ? `${styles.mentionPill} ${styles.mentionPillMe}`
              : p.kind === 'special'
              ? `${styles.mentionPill} ${styles.mentionPillSpecial}`
              : styles.mentionPill
          return (
            <span key={i} className={cls}>
              {p.raw}
            </span>
          )
        }
        return <span key={i}>{p.value}</span>
      })}
    </div>
  )
}

function AttachmentItem({ attachment }: { attachment: TeamChatAttachment }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getAttachmentSignedUrl(attachment).then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [attachment.id])

  if (!url) {
    return (
      <span className={styles.attachmentItem}>
        <span>📄</span> {attachment.file_name}
      </span>
    )
  }

  const isImage = attachment.mime_type?.startsWith('image/')
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={attachment.file_name} className={styles.attachmentImage} />
      </a>
    )
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className={styles.attachmentItem}>
      <span>📄</span>
      <span>
        {attachment.file_name}
        {attachment.file_size_bytes
          ? ` (${(attachment.file_size_bytes / 1024 / 1024).toFixed(1)} MB)`
          : ''}
      </span>
    </a>
  )
}
