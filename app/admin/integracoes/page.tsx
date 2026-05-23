'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { efCall } from '@/lib/api'
import { getSession } from '@/lib/auth'
import {
  SETOR_BOXES,
  ALL_SCOPES,
  SENSIBILIDADE_LABELS,
  groupScopesForDisplay,
  type Sensibilidade,
} from '@/lib/api-scopes'
import styles from './integracoes.module.css'

interface ApiToken {
  id: string
  name: string
  token_prefix: string
  scopes: string[]
  created_at: string
  last_used_at?: string | null
  last_used_ip?: string | null
  revoked_at?: string | null
  expires_at?: string | null
}

const EXPIRATION_OPTIONS = [
  { value: '5', label: '5 dias' },
  { value: '15', label: '15 dias' },
  { value: '30', label: '30 dias' },
  { value: '60', label: '60 dias' },
  { value: '90', label: '90 dias' },
  { value: '180', label: '180 dias' },
  { value: '365', label: '1 ano' },
  { value: 'never', label: 'Sem expiração' },
]

const SETOR_ENDPOINTS: Array<{ id: string; label: string; url: string }> = [
  { id: 'financeiro', label: 'Financeiro', url: 'https://uqukfjtwsuffeunikiwz.supabase.co/functions/v1/financeiro-openclaw' },
  { id: 'feedback',   label: 'Feedback',   url: 'https://uqukfjtwsuffeunikiwz.supabase.co/functions/v1/feedback-api' },
]

function fmtDate(value?: string | null) {
  if (!value) return 'Nunca'
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function getTokenStatus(token: ApiToken) {
  if (token.revoked_at) return { label: 'Revogado', expired: false, revoked: true }
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    return { label: 'Expirado', expired: true, revoked: false }
  }
  return { label: 'Ativo', expired: false, revoked: false }
}

function sensClass(sens: Sensibilidade) {
  return sens === 'alta' ? styles.sensAlta : sens === 'media' ? styles.sensMedia : styles.sensBaixa
}

function permClass(sens: Sensibilidade) {
  return sens === 'alta' ? styles.permPartAlta : sens === 'media' ? styles.permPartMedia : styles.permPartBaixa
}

export default function IntegracoesPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [name, setName] = useState('OpenClaw NGP')
  // Setor habilitado e cada scope marcado dele.
  const [boxState, setBoxState] = useState<Record<string, { on: boolean; basico: boolean; acoes: Record<string, boolean> }>>(() => {
    const init: Record<string, { on: boolean; basico: boolean; acoes: Record<string, boolean> }> = {}
    SETOR_BOXES.forEach(b => {
      init[b.id] = { on: false, basico: true, acoes: Object.fromEntries(b.acoesDelicadas.map(a => [a.id, false])) }
    })
    return init
  })
  const [expiresInDays, setExpiresInDays] = useState('15')
  const [createdToken, setCreatedToken] = useState('')
  // Scopes que originaram o `createdToken` — congelados no momento do submit
  // pra que a seção "URLs da API" não mude se o usuário mexer nas boxes
  // depois de gerar o token (ver bug-008).
  const [createdScopes, setCreatedScopes] = useState<string[]>([])
  // Lista de tokens cadastrados mostra só ATIVOS por padrão; usuário pode
  // expandir pra ver os revogados/expirados quando precisar.
  const [showRevogados, setShowRevogados] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  // Pendência de confirmação para ações de alta sensibilidade.
  const [pending, setPending] = useState<{ scopes: string[]; highRiskLabels: string[] } | null>(null)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'admin') { router.replace('/setores'); return }
    setSess(s)
  }, [router])

  const loadTokens = useCallback(async () => {
    setLoading(true)
    const data = await efCall('admin-api-tokens', { action: 'listar' })
    if (data.error) {
      setMsg({ type: 'err', text: String(data.error) })
    } else {
      setTokens((data.tokens as ApiToken[]) || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { if (sess) void loadTokens() }, [sess, loadTokens])

  const activeTokens = useMemo(() => tokens.filter(t => {
    const s = getTokenStatus(t)
    return !s.revoked && !s.expired
  }), [tokens])

  const inactiveTokens = useMemo(() => tokens.filter(t => {
    const s = getTokenStatus(t)
    return s.revoked || s.expired
  }), [tokens])

  const visibleTokens = useMemo(
    () => (showRevogados ? tokens : activeTokens),
    [showRevogados, tokens, activeTokens]
  )

  /** Calcula o array final de scopes a partir do estado das boxes.
   *  Se qualquer ação delicada do setor estiver marcada, o básico (geralmente :read)
   *  é incluído à força — sem :read o agente não consegue listar para depois atualizar. */
  const computedScopes = useMemo(() => {
    const result: string[] = []
    for (const box of SETOR_BOXES) {
      if (box.status !== 'disponivel') continue
      const st = boxState[box.id]
      if (!st || !st.on) continue
      const acoesAtivas = box.acoesDelicadas.filter(a => st.acoes[a.id])
      if (st.basico || acoesAtivas.length > 0) result.push(...box.basico.scopes)
      for (const acao of acoesAtivas) result.push(acao.id)
    }
    return Array.from(new Set(result)).filter(s => ALL_SCOPES.includes(s))
  }, [boxState])

  const highRiskSelected = useMemo(() => {
    const labels: string[] = []
    for (const box of SETOR_BOXES) {
      const st = boxState[box.id]
      if (!st?.on) continue
      for (const acao of box.acoesDelicadas) {
        if (st.acoes[acao.id] && (acao.sensibilidade === 'alta' || acao.requerConfirmacao)) {
          labels.push(`${box.label}: ${acao.label}`)
        }
      }
    }
    return labels
  }, [boxState])

  function toggleBox(id: string) {
    setBoxState(prev => ({ ...prev, [id]: { ...prev[id], on: !prev[id].on } }))
  }
  function toggleBasico(id: string) {
    setBoxState(prev => ({ ...prev, [id]: { ...prev[id], basico: !prev[id].basico } }))
  }
  function toggleAcao(boxId: string, acaoId: string) {
    setBoxState(prev => ({
      ...prev,
      [boxId]: { ...prev[boxId], acoes: { ...prev[boxId].acoes, [acaoId]: !prev[boxId].acoes[acaoId] } },
    }))
  }

  async function doCreate(scopes: string[]) {
    setSaving(true)
    setCreatedToken('')
    setCreatedScopes([])
    setMsg(null)
    const data = await efCall('admin-api-tokens', { action: 'criar', name, scopes, expires_in_days: expiresInDays })
    if (data.error) {
      setMsg({ type: 'err', text: String(data.error) })
    } else {
      setCreatedToken(String(data.token || ''))
      setCreatedScopes(scopes)
      setMsg({ type: 'ok', text: 'Token gerado. Copie agora, ele não será exibido novamente.' })
      await loadTokens()
    }
    setSaving(false)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const scopes = computedScopes
    if (!name.trim()) { setMsg({ type: 'err', text: 'Informe um nome para o token.' }); return }
    if (scopes.length === 0) { setMsg({ type: 'err', text: 'Ative ao menos um setor com permissões.' }); return }
    if (highRiskSelected.length > 0) {
      setPending({ scopes, highRiskLabels: highRiskSelected })
      return
    }
    void doCreate(scopes)
  }

  async function revokeToken(id: string) {
    if (!confirm('Revogar este token? Integrações usando essa chave vão parar imediatamente.')) return
    const data = await efCall('admin-api-tokens', { action: 'revogar', id })
    if (data.error) setMsg({ type: 'err', text: String(data.error) })
    else {
      setMsg({ type: 'ok', text: 'Token revogado.' })
      await loadTokens()
    }
  }

  if (!sess) return null

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal />
      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <button className={styles.btnBack} onClick={() => router.push('/setores')}>← Setores</button>
            <div className={styles.eyebrow}>Admin · Segurança</div>
            <h1 className={styles.title}>Integrações</h1>
            <p className={styles.subtitle}>
              Gere tokens de API para conectar agentes externos ao NGP Space sem expor senha, sessão de usuário ou chave service role.
            </p>
          </header>

          {msg && <div className={`${styles.msg} ${msg.type === 'ok' ? styles.msgOk : styles.msgErr}`}>{msg.text}</div>}

          <form className={styles.panel} onSubmit={onSubmit}>
            <div>
              <div className={styles.panelTitle}>Novo token de API</div>
              <div className={styles.panelSub}>O token completo aparece apenas uma vez. Depois disso, o sistema guarda somente o hash.</div>
            </div>

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Nome</span>
                <input className={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="OpenClaw NGP" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Expiração</span>
                <select className={styles.input} value={expiresInDays} onChange={e => setExpiresInDays(e.target.value)}>
                  {EXPIRATION_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button className={styles.btnPrimary} disabled={saving || !name.trim() || computedScopes.length === 0}>
                {saving ? 'Gerando...' : 'Gerar token'}
              </button>
            </div>

            <div>
              <div className={styles.label} style={{ marginBottom: 10 }}>Setores e ações</div>
              <div className={styles.sectorList}>
                {SETOR_BOXES.map(box => {
                  const isSoon = box.status === 'em_breve'
                  const st = boxState[box.id]
                  const enabled = !isSoon && st?.on
                  return (
                    <div
                      key={box.id}
                      className={[
                        styles.sectorBox,
                        enabled ? styles.sectorBoxOn : '',
                        isSoon ? styles.sectorBoxSoon : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <div className={styles.sectorHead}>
                        <div className={styles.sectorHeadInfo}>
                          <div className={styles.sectorTitle}>
                            {box.label}
                            {isSoon && <span className={styles.soonChip}>Em breve</span>}
                          </div>
                          <div className={styles.sectorDesc}>{box.description}</div>
                        </div>
                        {!isSoon && (
                          <label className={styles.switch}>
                            <input
                              type="checkbox"
                              checked={st.on}
                              onChange={() => toggleBox(box.id)}
                              aria-label={`Ativar setor ${box.label}`}
                            />
                            <span className={styles.switchSlider} />
                          </label>
                        )}
                      </div>

                      {!isSoon && (
                        <>
                          {(() => {
                            const hasAcaoOn = box.acoesDelicadas.some(a => st.acoes[a.id])
                            const basicoLocked = hasAcaoOn // forçado: ações delicadas precisam do básico
                            return (
                              <div className={[styles.actionRow, !st.on ? styles.actionDisabled : ''].join(' ')}>
                                <input
                                  type="checkbox"
                                  checked={st.basico || basicoLocked}
                                  disabled={!st.on || basicoLocked}
                                  onChange={() => toggleBasico(box.id)}
                                />
                                <div className={styles.actionInfo}>
                                  <div className={styles.actionLabel}>
                                    {box.basico.label}
                                    <span className={[styles.sensChip, sensClass(box.basico.sensibilidade)].join(' ')}>
                                      {SENSIBILIDADE_LABELS[box.basico.sensibilidade]}
                                    </span>
                                    {basicoLocked && (
                                      <span className={styles.sensChip} style={{ background: 'rgba(255,255,255,.06)', color: '#8b92a5' }}>
                                        Obrigatório
                                      </span>
                                    )}
                                  </div>
                                  <div className={styles.actionDesc}>
                                    {basicoLocked
                                      ? 'Necessário para que as ações marcadas abaixo funcionem (sem leitura, o agente não consegue identificar registros).'
                                      : box.basico.description}
                                  </div>
                                </div>
                              </div>
                            )
                          })()}

                          {box.acoesDelicadas.map(acao => (
                            <div key={acao.id} className={[styles.actionRow, !st.on ? styles.actionDisabled : ''].join(' ')}>
                              <input
                                type="checkbox"
                                checked={!!st.acoes[acao.id]}
                                disabled={!st.on}
                                onChange={() => toggleAcao(box.id, acao.id)}
                              />
                              <div className={styles.actionInfo}>
                                <div className={styles.actionLabel}>
                                  {acao.label}
                                  <span className={[styles.sensChip, sensClass(acao.sensibilidade)].join(' ')}>
                                    {SENSIBILIDADE_LABELS[acao.sensibilidade]}
                                  </span>
                                </div>
                                <div className={styles.actionDesc}>{acao.description}</div>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {createdToken && (
              <div className={styles.tokenReveal}>
                <div className={styles.tokenRevealTitle}>Copie este token agora</div>
                <div className={styles.tokenValue}>{createdToken}</div>

                {(() => {
                  const urlsAtivas = SETOR_ENDPOINTS.filter(s =>
                    createdScopes.some(scope => scope.startsWith(s.id + ':'))
                  )
                  if (urlsAtivas.length === 0) return null
                  return (
                    <div className={styles.tokenRevealUrl}>
                      <span className={styles.tokenRevealUrlLabel}>
                        {urlsAtivas.length > 1 ? 'URLs da API' : 'URL da API'}
                      </span>
                      <div className={styles.tokenValue}>
                        {urlsAtivas.map(s => (
                          <div key={s.id}>
                            <strong>{s.label}:</strong> {s.url}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                <div className={styles.tokenRevealHint}>
                  Envie o token no header: <code>x-ngp-api-token: {createdToken.slice(0, 16)}...</code>
                  <br />
                  Ou como: <code>Authorization: Bearer {'<token>'}</code>
                </div>
              </div>
            )}
          </form>

          <section className={styles.panel}>
            <div>
              <div className={styles.panelTitle}>Tokens cadastrados</div>
              <div className={styles.panelSub}>
                {activeTokens.length} token(s) ativo(s)
                {inactiveTokens.length > 0 && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => setShowRevogados(v => !v)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#86efac',
                        cursor: 'pointer',
                        padding: 0,
                        font: 'inherit',
                        textDecoration: 'underline',
                      }}
                    >
                      {showRevogados
                        ? `esconder ${inactiveTokens.length} revogado(s)/expirado(s)`
                        : `mostrar ${inactiveTokens.length} revogado(s)/expirado(s)`}
                    </button>
                  </>
                )}
              </div>
            </div>

            {loading ? (
              <div className={styles.empty}>Carregando...</div>
            ) : visibleTokens.length === 0 ? (
              <div className={styles.empty}>
                {tokens.length === 0
                  ? 'Nenhum token criado ainda.'
                  : 'Nenhum token ativo. Crie um novo acima.'}
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>Permissões</th>
                      <th>Último uso</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTokens.map(token => {
                      const status = getTokenStatus(token)
                      const grouped = groupScopesForDisplay(token.scopes || [])
                      return (
                        <tr key={token.id}>
                          <td>
                            <div className={styles.name}>{token.name}</div>
                            <div className={styles.muted}>{token.token_prefix}...</div>
                            <div className={styles.muted}>Criado em {fmtDate(token.created_at)}</div>
                            <div className={styles.muted}>Expira em {token.expires_at ? fmtDate(token.expires_at) : 'Nunca'}</div>
                          </td>
                          <td>
                            {grouped.groups.length === 0 && grouped.unknown.length === 0 && (
                              <span className={styles.muted}>—</span>
                            )}
                            {grouped.groups.map(g => (
                              <div key={g.setorLabel} className={styles.permGroup}>
                                <span className={styles.permGroupSetor}>{g.setorLabel}:</span>
                                {g.parts.map(p => (
                                  <span
                                    key={p.scope}
                                    className={[styles.permPart, permClass(p.sensibilidade)].join(' ')}
                                    title={p.scope}
                                  >
                                    {p.label}
                                  </span>
                                ))}
                              </div>
                            ))}
                            {grouped.unknown.length > 0 && (
                              <div className={styles.permGroup}>
                                {grouped.unknown.map(s => (
                                  <span key={s} className={[styles.permPart, styles.permUnknown].join(' ')} title={`Scope desconhecido: ${s}`}>
                                    {s}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            <div>{fmtDate(token.last_used_at)}</div>
                            {token.last_used_ip && <div className={styles.muted}>{token.last_used_ip}</div>}
                          </td>
                          <td>
                            {status.revoked || status.expired
                              ? <span className={styles.revoked}>{status.label}</span>
                              : <span className={styles.badge}>{status.label}</span>}
                          </td>
                          <td>
                            {!status.revoked && !status.expired && (
                              <button type="button" className={styles.btnDanger} onClick={() => void revokeToken(token.id)}>Revogar</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>

      {pending && (
        <div className={styles.modalOverlay} onClick={() => setPending(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>⚠ Liberar permissões delicadas?</div>
            <div className={styles.modalBody}>
              Você está prestes a gerar um token com as seguintes permissões sensíveis:
              <ul style={{ margin: '10px 0 0 18px', padding: 0, color: '#f87171' }}>
                {pending.highRiskLabels.map(l => <li key={l}>{l}</li>)}
              </ul>
              <p style={{ marginTop: 10, color: '#8b92a5' }}>
                Tokens com permissão de exclusão ou alteração agem em nome do sistema. Confirme apenas se o agente externo é confiável.
              </p>
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={styles.modalSecondary} onClick={() => setPending(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={styles.modalDanger}
                onClick={() => {
                  const scopes = pending.scopes
                  setPending(null)
                  void doCreate(scopes)
                }}
              >
                Sim, gerar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
