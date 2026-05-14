'use client'

import { useEffect, useState } from 'react'
import {
  getAttachmentSignedUrl,
  listChannelFiles,
  listChannelLinks,
  listChannelMedia,
  listChannelMembers,
  listPinnedMessages,
} from '@/lib/team-chat'
import type {
  ChannelMember,
  LinkItem,
  MediaItem,
  PinnedMessage,
  TeamChatChannelWithUnread,
} from '@/lib/team-chat'
import styles from './chat.module.css'

type Tab = 'media' | 'files' | 'links' | 'pinned' | 'about'

interface Props {
  channel: TeamChatChannelWithUnread
  onClose: () => void
  onJumpToMessage: (messageId: string) => void
}

function initials(nome: string | null | undefined): string {
  if (!nome) return '?'
  const parts = nome.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  } catch {
    return ''
  }
}

function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function ChannelInfoPanel({ channel, onClose, onJumpToMessage }: Props) {
  const [tab, setTab] = useState<Tab>('media')
  const [media, setMedia] = useState<MediaItem[]>([])
  const [files, setFiles] = useState<MediaItem[]>([])
  const [links, setLinks] = useState<LinkItem[]>([])
  const [pinned, setPinned] = useState<PinnedMessage[]>([])
  const [members, setMembers] = useState<ChannelMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      listChannelMedia(channel.id).catch(() => []),
      listChannelFiles(channel.id).catch(() => []),
      listChannelLinks(channel.id).catch(() => []),
      listPinnedMessages(channel.id).catch(() => []),
      channel.type === 'general' ? listChannelMembers(channel.id).catch(() => []) : Promise.resolve([] as ChannelMember[]),
    ]).then(([m, f, l, p, mb]) => {
      if (!active) return
      setMedia(m)
      setFiles(f)
      setLinks(l)
      setPinned(p)
      setMembers(mb)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [channel.id, channel.type])

  return (
    <aside className={styles.drawer}>
      <header className={styles.drawerHeader}>
        <span className={styles.drawerTitle}>Sobre o canal</span>
        <button type="button" className={styles.drawerClose} onClick={onClose} aria-label="Fechar painel">
          ×
        </button>
      </header>

      <nav className={styles.drawerTabs}>
        <TabBtn label="Mídia" active={tab === 'media'} onClick={() => setTab('media')} />
        <TabBtn label="Arquivos" active={tab === 'files'} onClick={() => setTab('files')} />
        <TabBtn label="Links" active={tab === 'links'} onClick={() => setTab('links')} />
        <TabBtn
          label={`Fixadas${pinned.length > 0 ? ` · ${pinned.length}` : ''}`}
          active={tab === 'pinned'}
          onClick={() => setTab('pinned')}
        />
        <TabBtn label="Sobre" active={tab === 'about'} onClick={() => setTab('about')} />
      </nav>

      <div className={styles.drawerBody}>
        {loading ? (
          <div className={styles.drawerEmpty}>Carregando…</div>
        ) : tab === 'media' ? (
          <MediaTab items={media} />
        ) : tab === 'files' ? (
          <FilesTab items={files} />
        ) : tab === 'links' ? (
          <LinksTab items={links} onJumpToMessage={onJumpToMessage} />
        ) : tab === 'pinned' ? (
          <PinnedTab items={pinned} onJumpToMessage={onJumpToMessage} />
        ) : (
          <AboutTab channel={channel} members={members} />
        )}
      </div>
    </aside>
  )
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.drawerTab} ${active ? styles.drawerTabActive : ''}`}
    >
      {label}
    </button>
  )
}

function MediaTab({ items }: { items: MediaItem[] }) {
  if (items.length === 0) {
    return <div className={styles.drawerEmpty}>Nenhuma imagem ainda.</div>
  }
  return (
    <div className={styles.mediaGrid}>
      {items.map((m) => (
        <MediaThumb key={m.id} item={m} />
      ))}
    </div>
  )
}

function MediaThumb({ item }: { item: MediaItem }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    getAttachmentSignedUrl(item).then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [item.id])
  return (
    <button
      type="button"
      className={styles.mediaCell}
      onClick={() => url && window.open(url, '_blank')}
      title={item.file_name}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={item.file_name} />
      ) : (
        <span>…</span>
      )}
    </button>
  )
}

function FilesTab({ items }: { items: MediaItem[] }) {
  if (items.length === 0) {
    return <div className={styles.drawerEmpty}>Nenhum arquivo ainda.</div>
  }
  return (
    <>
      {items.map((f) => (
        <FileLink key={f.id} item={f} />
      ))}
    </>
  )
}

function FileLink({ item }: { item: MediaItem }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    getAttachmentSignedUrl(item).then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [item.id])
  return (
    <a
      href={url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className={styles.fileItem}
      onClick={(e) => {
        if (!url) e.preventDefault()
      }}
    >
      <span className={styles.fileItemIcon}>📄</span>
      <span className={styles.fileItemInfo}>
        <span className={styles.fileItemName}>{item.file_name}</span>
        <span className={styles.fileItemMeta}>
          {fmtSize(item.file_size_bytes)}
          {item.file_size_bytes ? ' · ' : ''}
          {fmtDate(item.created_at)}
        </span>
      </span>
    </a>
  )
}

function LinksTab({
  items,
  onJumpToMessage,
}: {
  items: LinkItem[]
  onJumpToMessage: (id: string) => void
}) {
  if (items.length === 0) {
    return <div className={styles.drawerEmpty}>Nenhum link ainda.</div>
  }
  return (
    <>
      {items.map((l, i) => (
        <a
          key={`${l.message_id}-${i}`}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className={styles.linkItem}
          onClick={(e) => {
            // ctrl/cmd click abre, click puro pula pra msg
            if (!e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              onJumpToMessage(l.message_id)
            }
          }}
        >
          <span className={styles.linkItemIcon}>🔗</span>
          <span className={styles.linkItemInfo}>
            <span className={styles.linkItemTexto}>{l.url}</span>
            <span className={styles.linkItemUrl}>
              {l.autor_nome ?? 'usuário'} · {fmtDate(l.created_at)}
            </span>
          </span>
        </a>
      ))}
    </>
  )
}

function PinnedTab({
  items,
  onJumpToMessage,
}: {
  items: PinnedMessage[]
  onJumpToMessage: (id: string) => void
}) {
  if (items.length === 0) {
    return <div className={styles.drawerEmpty}>Nenhuma mensagem fixada.</div>
  }
  return (
    <>
      {items.map((m) => (
        <button
          key={m.id}
          type="button"
          className={styles.pinnedItem}
          onClick={() => onJumpToMessage(m.id)}
        >
          <span className={styles.memberAvatar}>{initials(m.autor_nome)}</span>
          <span className={styles.pinnedItemInfo}>
            <span className={styles.pinnedItemAuthor}>{m.autor_nome ?? 'usuário'}</span>
            <span className={styles.pinnedItemMeta}>
              📌 Fixado · {fmtDate(m.pinned_at)}
            </span>
            <span className={styles.pinnedItemText}>{m.texto ?? '📎 Anexo'}</span>
          </span>
        </button>
      ))}
    </>
  )
}

function AboutTab({
  channel,
  members,
}: {
  channel: TeamChatChannelWithUnread
  members: ChannelMember[]
}) {
  return (
    <>
      <div className={styles.aboutBlock}>
        <div className={styles.aboutLabel}>Nome</div>
        <div className={styles.aboutValue}>{channel.nome}</div>
      </div>
      <div className={styles.aboutBlock}>
        <div className={styles.aboutLabel}>Tipo</div>
        <div className={styles.aboutValue}>
          {channel.type === 'general'
            ? channel.is_private
              ? '🔒 Equipe (privado)'
              : '# Equipe (público)'
            : 'Canal de cliente'}
        </div>
      </div>
      {channel.descricao && (
        <div className={styles.aboutBlock}>
          <div className={styles.aboutLabel}>Descrição</div>
          <div className={styles.aboutValue}>{channel.descricao}</div>
        </div>
      )}
      <div className={styles.aboutBlock}>
        <div className={styles.aboutLabel}>Criado em</div>
        <div className={styles.aboutValue}>{fmtDate(channel.created_at)}</div>
      </div>

      {channel.type === 'general' && (
        <div className={styles.aboutBlock}>
          <div className={styles.aboutLabel}>Membros ({members.length})</div>
          {members.length === 0 ? (
            <div className={styles.aboutValue}>
              <small>
                {channel.is_private
                  ? 'Nenhum membro convidado.'
                  : 'Canal público — toda equipe interna tem acesso.'}
              </small>
            </div>
          ) : (
            members.map((m) => (
              <div key={m.usuario_id} className={styles.memberItem}>
                <span className={styles.memberAvatar}>{initials(m.nome)}</span>
                <span className={styles.fileItemInfo}>
                  <span className={styles.fileItemName}>{m.nome}</span>
                  <span
                    className={`${styles.memberRole} ${
                      m.role === 'admin' ? styles.memberRoleAdmin : ''
                    }`}
                  >
                    {m.role === 'admin' ? 'admin' : 'membro'}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </>
  )
}
