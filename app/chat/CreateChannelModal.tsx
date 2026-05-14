'use client'

import { useEffect, useState } from 'react'
import { createGeneralChannel, inviteChannelMember, listInternalUsers } from '@/lib/team-chat'
import styles from './chat.module.css'

interface Props {
  usuarioId: string
  onClose: () => void
  onCreated: (channelId: string) => void
}

interface InternalUser {
  id: string
  nome: string
  email: string
}

export default function CreateChannelModal({ usuarioId, onClose, onCreated }: Props) {
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set())
  const [users, setUsers] = useState<InternalUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listInternalUsers()
      .then((list) => setUsers(list.filter((u) => u.id !== usuarioId)))
      .catch(() => {})
  }, [usuarioId])

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreate = async () => {
    if (!nome.trim()) {
      setError('Dê um nome ao canal')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const id = await createGeneralChannel({
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        isPrivate,
      })
      if (isPrivate && selectedMembers.size > 0) {
        for (const memberId of selectedMembers) {
          try {
            await inviteChannelMember(id, memberId)
          } catch {
            // continua mesmo se um convite falhar
          }
        }
      }
      onCreated(id)
    } catch (e) {
      setError((e as Error).message || 'Erro ao criar canal')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <strong>Novo canal</strong>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <label className={styles.modalLabel}>Nome</label>
          <input
            type="text"
            className={styles.modalInput}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex: financeiro, musica, ti..."
            maxLength={50}
            autoFocus
          />

          <label className={styles.modalLabel}>Descrição (opcional)</label>
          <input
            type="text"
            className={styles.modalInput}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Para que serve esse canal?"
            maxLength={140}
          />

          <div className={styles.modalToggleRow}>
            <label className={styles.modalToggleLabel}>
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              <span>
                <strong>Canal privado</strong>
                <small>Apenas pessoas convidadas veem e participam</small>
              </span>
            </label>
          </div>

          {isPrivate && (
            <>
              <label className={styles.modalLabel}>
                Convidar pessoas {selectedMembers.size > 0 && `(${selectedMembers.size})`}
              </label>
              <div className={styles.modalMemberList}>
                {users.length === 0 ? (
                  <div className={styles.modalEmpty}>Carregando…</div>
                ) : (
                  users.map((u) => (
                    <label key={u.id} className={styles.modalMemberItem}>
                      <input
                        type="checkbox"
                        checked={selectedMembers.has(u.id)}
                        onChange={() => toggleMember(u.id)}
                      />
                      <span className={styles.modalMemberName}>{u.nome}</span>
                      <span className={styles.modalMemberEmail}>{u.email}</span>
                    </label>
                  ))
                )}
              </div>
            </>
          )}

          {error && <div className={styles.modalError}>{error}</div>}
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.modalBtnSecondary} onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            type="button"
            className={styles.modalBtnPrimary}
            onClick={handleCreate}
            disabled={loading || !nome.trim()}
          >
            {loading ? 'Criando…' : 'Criar canal'}
          </button>
        </div>
      </div>
    </div>
  )
}
