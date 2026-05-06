'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { efCall } from '@/lib/api'
import { getSession } from '@/lib/auth'
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

const SCOPE_META: Record<string, { label: string; desc: string }> = {
  'financeiro:read': {
    label: 'Financeiro leitura',
    desc: 'Listar contas, categorias e dados básicos para o agente.',
  },
  'financeiro:create': {
    label: 'Criar lançamentos',
    desc: 'Permitir que o OpenClaw registre entradas e saídas simples.',
  },
  'financeiro:reports': {
    label: 'Relatórios financeiros',
    desc: 'Consultar briefing diário e resumo semanal.',
  },
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

export default function IntegracoesPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [availableScopes, setAvailableScopes] = useState<string[]>(Object.keys(SCOPE_META))
  const [name, setName] = useState('OpenClaw Financeiro')
  const [scopes, setScopes] = useState<string[]>(['financeiro:read', 'financeiro:create', 'financeiro:reports'])
  const [expiresInDays, setExpiresInDays] = useState('15')
  const [createdToken, setCreatedToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

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
      setAvailableScopes((data.available_scopes as string[]) || Object.keys(SCOPE_META))
    }
    setLoading(false)
  }, [])

  useEffect(() => { if (sess) void loadTokens() }, [sess, loadTokens])

  const activeTokens = useMemo(() => tokens.filter(token => {
    const status = getTokenStatus(token)
    return !status.revoked && !status.expired
  }), [tokens])

  function toggleScope(scope: string) {
    setScopes(prev => prev.includes(scope) ? prev.filter(item => item !== scope) : [...prev, scope])
  }

  async function createToken(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setCreatedToken('')
    setMsg(null)
    const data = await efCall('admin-api-tokens', { action: 'criar', name, scopes, expires_in_days: expiresInDays })
    if (data.error) {
      setMsg({ type: 'err', text: String(data.error) })
    } else {
      setCreatedToken(String(data.token || ''))
      setMsg({ type: 'ok', text: 'Token gerado. Copie agora, ele não será exibido novamente.' })
      await loadTokens()
    }
    setSaving(false)
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

          <form className={styles.panel} onSubmit={createToken}>
            <div>
              <div className={styles.panelTitle}>Novo token de API</div>
              <div className={styles.panelSub}>O token completo aparece apenas uma vez. Depois disso, o sistema guarda somente o hash.</div>
            </div>

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Nome</span>
                <input className={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="OpenClaw Financeiro" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Expiração</span>
                <select className={styles.input} value={expiresInDays} onChange={e => setExpiresInDays(e.target.value)}>
                  {EXPIRATION_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button className={styles.btnPrimary} disabled={saving || !name.trim() || scopes.length === 0}>
                {saving ? 'Gerando...' : 'Gerar token'}
              </button>
            </div>

            <div className={styles.scopes}>
              {availableScopes.map(scope => {
                const meta = SCOPE_META[scope] || { label: scope, desc: 'Permissão da integração.' }
                return (
                  <label key={scope} className={styles.scopeRow}>
                    <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                    <span>
                      <span className={styles.scopeName}>{meta.label}</span>
                      <span className={styles.scopeDesc}>{meta.desc}</span>
                    </span>
                  </label>
                )
              })}
            </div>

            {createdToken && (
              <div className={styles.tokenReveal}>
                <div className={styles.tokenRevealTitle}>Copie este token agora</div>
                <div className={styles.tokenValue}>{createdToken}</div>
                <div className={styles.tokenRevealUrl}>
                  <span className={styles.tokenRevealUrlLabel}>URL da API</span>
                  <div className={styles.tokenValue}>
                    https://uqukfjtwsuffeunikiwz.supabase.co/functions/v1/admin-api-tokens
                  </div>
                </div>
                <div className={styles.tokenRevealHint}>
                  Use o token no header: <code>Authorization: Bearer {'<token>'}</code>
                </div>
              </div>
            )}
          </form>

          <section className={styles.panel}>
            <div>
              <div className={styles.panelTitle}>Tokens cadastrados</div>
              <div className={styles.panelSub}>{activeTokens.length} token(s) ativo(s).</div>
            </div>

            {loading ? (
              <div className={styles.empty}>Carregando...</div>
            ) : tokens.length === 0 ? (
              <div className={styles.empty}>Nenhum token criado ainda.</div>
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
                    {tokens.map(token => {
                      const status = getTokenStatus(token)
                      return (
                      <tr key={token.id}>
                        <td>
                          <div className={styles.name}>{token.name}</div>
                          <div className={styles.muted}>{token.token_prefix}...</div>
                          <div className={styles.muted}>Criado em {fmtDate(token.created_at)}</div>
                          <div className={styles.muted}>Expira em {token.expires_at ? fmtDate(token.expires_at) : 'Nunca'}</div>
                        </td>
                        <td>
                          <div className={styles.badgeList}>
                            {(token.scopes || []).map(scope => <span key={scope} className={styles.badge}>{scope}</span>)}
                          </div>
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
    </div>
  )
}
