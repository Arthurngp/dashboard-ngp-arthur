'use client'

import { useEffect, useMemo, useState } from 'react'
import { listInternalUsers, openDirectMessage } from '@/lib/team-chat'
import styles from './chat.module.css'

interface Props {
  usuarioId: string
  onClose: () => void
  onOpened: (channelId: string) => void
}

interface InternalUser {
  id: string
  nome: string
  email: string
}

function initials(nome: string): string {
  const parts = nome.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function NewDmModal({ usuarioId, onClose, onOpened }: Props) {
  const [users, setUsers] = useState<InternalUser[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listInternalUsers()
      .then((list) => setUsers(list.filter((u) => u.id !== usuarioId)))
      .catch(() => {})
  }, [usuarioId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    )
  }, [users, search])

  const handleOpen = async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const channelId = await openDirectMessage(id)
      onOpened(channelId)
    } catch (e) {
      setError((e as Error).message || 'Erro ao abrir DM')
      setLoading(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <strong>Nova mensagem direta</strong>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <input
            type="text"
            className={styles.modalInput}
            placeholder="Buscar colaborador…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className={styles.modalMemberList} style={{ marginTop: 12 }}>
            {filtered.length === 0 ? (
              <div className={styles.modalEmpty}>Nenhum colaborador encontrado.</div>
            ) : (
              filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={styles.modalMemberItem}
                  onClick={() => handleOpen(u.id)}
                  disabled={loading}
                  style={{ width: '100%', background: 'transparent', border: 'none' }}
                >
                  <span className={styles.memberAvatar}>{initials(u.nome)}</span>
                  <span className={styles.modalMemberName}>{u.nome}</span>
                  <span className={styles.modalMemberEmail}>{u.email}</span>
                </button>
              ))
            )}
          </div>
          {error && <div className={styles.modalError}>{error}</div>}
        </div>
      </div>
    </div>
  )
}
