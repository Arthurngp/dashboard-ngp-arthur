'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import styles from './lixeira.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeletedRecord {
  id: string
  tipo_registro: string
  created_at: string
  deleted_at: string
  deleted_by: string | null
  usuario_id: string
  usuario_nome: string
  usuario_username: string
  deletado_por_nome: string | null
}

interface DeletedGroup {
  key: string          // usuario_id + dateStr
  dateStr: string
  dateLabel: string
  usuarioNome: string
  usuarioUsername: string
  tipos: string[]
  deletedAt: string
  deletadoPorNome: string | null
  recordIds: string[]
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const BRT_OFFSET = -3 * 60 * 60 * 1000

function toLocalTime(utcIso: string): string {
  const ms = new Date(utcIso).getTime() + BRT_OFFSET
  const d  = new Date(ms)
  const h  = d.getUTCHours().toString().padStart(2, '0')
  const m  = d.getUTCMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

function fmtDateTime(utcIso: string): string {
  const ms  = new Date(utcIso).getTime() + BRT_OFFSET
  const d   = new Date(ms)
  const dd  = d.getUTCDate().toString().padStart(2, '0')
  const mo  = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  const yy  = d.getUTCFullYear()
  const h   = d.getUTCHours().toString().padStart(2, '0')
  const min = d.getUTCMinutes().toString().padStart(2, '0')
  return `${dd}/${mo}/${yy} ${h}:${min}`
}

const DAYS   = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

const TIPO_LABEL: Record<string, string> = {
  entrada:        'Entrada',
  saida_almoco:   'S. Almoço',
  retorno_almoco: 'R. Almoço',
  saida:          'Saída',
  extra:          'Extra',
}

function groupRecords(records: DeletedRecord[]): DeletedGroup[] {
  const groups: Record<string, DeletedGroup> = {}

  for (const r of records) {
    const dateStr = new Date(new Date(r.created_at).getTime() + BRT_OFFSET)
      .toISOString().split('T')[0]
    const key = `${r.usuario_id}__${dateStr}`

    if (!groups[key]) {
      const [y, mo, d] = dateStr.split('-').map(Number)
      const dateObj    = new Date(Date.UTC(y, mo - 1, d, 12))
      const dateLabel  = `${DAYS[dateObj.getUTCDay()]}, ${d} ${MONTHS[mo - 1]}`

      groups[key] = {
        key,
        dateStr,
        dateLabel,
        usuarioNome:     r.usuario_nome,
        usuarioUsername: r.usuario_username,
        tipos:           [],
        deletedAt:       r.deleted_at,
        deletadoPorNome: r.deletado_por_nome,
        recordIds:       [],
      }
    }
    groups[key].tipos.push(TIPO_LABEL[r.tipo_registro] || r.tipo_registro)
    groups[key].recordIds.push(r.id)
  }

  return Object.values(groups).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}


// ── Ícones ────────────────────────────────────────────────────────────────────

const IcoRelogio = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
)

const IcoTabela = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>
  </svg>
)

const IcoLixeira = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
  </svg>
)

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LixeiraPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [groups, setGroups]   = useState<DeletedGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [actionKey, setActionKey] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    setIsAdmin(s.role === 'admin')
    setSess(s)
  }, [router])

  const fetchLixeira = useCallback(async () => {
    const s = getSession()
    if (!s) return
    setLoading(true)
    try {
      const res  = await fetch(`${SURL}/functions/v1/admin-ponto-lixeira`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (data.error) {
        if (res.status === 403) router.replace('/pessoas')
        return
      }
      setGroups(groupRecords(data.records || []))
    } catch { /* silencioso */ } finally {
      setLoading(false)
    }
  }, [router]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sess) return
    fetchLixeira()
  }, [sess]) // eslint-disable-line react-hooks/exhaustive-deps

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const restaurar = async (group: DeletedGroup) => {
    if (!confirm(`Restaurar os registros de ${group.usuarioNome} em ${group.dateLabel}?`)) return
    const s = getSession()
    if (!s) return
    setActionKey(group.key)
    try {
      const res  = await fetch(`${SURL}/functions/v1/admin-ponto-restore`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, record_ids: group.recordIds }),
      })
      const data = await res.json()
      if (data.error) showMsg('err', data.error)
      else { showMsg('ok', 'Registros restaurados com sucesso.'); fetchLixeira() }
    } catch {
      showMsg('err', 'Erro de conexão.')
    } finally {
      setActionKey(null)
    }
  }

  const excluirPermanente = async (group: DeletedGroup) => {
    if (!confirm(`Excluir PERMANENTEMENTE os registros de ${group.usuarioNome} em ${group.dateLabel}?\n\nEssa ação não pode ser desfeita.`)) return
    const s = getSession()
    if (!s) return
    setActionKey(group.key)
    try {
      const res  = await fetch(`${SURL}/functions/v1/admin-ponto-purge`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, record_ids: group.recordIds }),
      })
      const data = await res.json()
      if (data.error) showMsg('err', data.error)
      else { showMsg('ok', 'Registros excluídos permanentemente.'); fetchLixeira() }
    } catch {
      showMsg('err', 'Erro de conexão.')
    } finally {
      setActionKey(null)
    }
  }

  if (!sess) return null

  const sectorNav = [
    { icon: <IcoRelogio />, label: 'Ponto Eletrônico', href: '/pessoas' },
    { icon: <IcoTabela />,  label: 'Registros de Ponto', href: '/pessoas/registros' },
    ...(isAdmin ? [{ icon: <IcoLixeira />, label: 'Lixeira', href: '/pessoas/lixeira' }] : []),
  ]

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal sectorNav={sectorNav} sectorNavTitle="PESSOAS" />

      <main className={styles.main}>
        <div className={styles.content}>

          <header className={styles.header}>
            <button className={styles.btnBack} onClick={() => router.push('/pessoas')}>
              ← Ponto Eletrônico
            </button>
            <div className={styles.eyebrow}>Setor · Pessoas · Admin</div>
            <h1 className={styles.title}>Lixeira</h1>
            <p className={styles.subtitle}>Registros de ponto excluídos. Restaure ou exclua permanentemente.</p>
          </header>

          {msg && (
            <div className={`${styles.msgBar} ${msg.type === 'ok' ? styles.msgOk : styles.msgErr}`}>
              {msg.type === 'ok' ? '✓ ' : '✕ '}{msg.text}
            </div>
          )}

          <section className={styles.section}>
            {loading ? (
              <div className={styles.empty}>Carregando...</div>
            ) : groups.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyIcon}>🗑️</span>
                <span>Nenhum registro na lixeira.</span>
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>Data do Ponto</th>
                      <th>Registros</th>
                      <th>Excluído em</th>
                      <th>Excluído por</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(group => (
                      <tr key={group.key}>
                        <td>
                          <div className={styles.userCell}>
                            <span className={styles.userName}>{group.usuarioNome}</span>
                            <span className={styles.userUsername}>@{group.usuarioUsername}</span>
                          </div>
                        </td>
                        <td className={styles.tdDate}>{group.dateLabel}</td>
                        <td>
                          <div className={styles.tiposList}>
                            {group.tipos.map((t, i) => (
                              <span key={i} className={styles.tipoChip}>{t}</span>
                            ))}
                          </div>
                        </td>
                        <td className={styles.tdMuted}>{fmtDateTime(group.deletedAt)}</td>
                        <td className={styles.tdMuted}>{group.deletadoPorNome || '—'}</td>
                        <td>
                          <div className={styles.actions}>
                            <button
                              className={styles.btnRestore}
                              onClick={() => restaurar(group)}
                              disabled={actionKey === group.key}
                            >
                              {actionKey === group.key ? <span className={styles.spinner} /> : 'Restaurar'}
                            </button>
                            <button
                              className={styles.btnPurge}
                              onClick={() => excluirPermanente(group)}
                              disabled={actionKey === group.key}
                            >
                              Excluir
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

        </div>
      </main>
    </div>
  )
}
