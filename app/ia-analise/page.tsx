'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CustomSelect, { SelectOption } from '@/components/CustomSelect'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { efCall, efCallCached, invalidateEfCache } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import {
  parseStructuredAnalysis,
  renderStructuredAnalysisMarkdown,
} from '@/lib/analytics-contract'
import type {
  AnalyticsSnapshot,
  StructuredAnalysisResult,
} from '@/lib/analytics-contract'
import styles from './ia-analise.module.css'

interface PromptTemplate {
  id: string
  name: string
  description?: string | null
  category: string
  model: string
  temperature: number
  system_prompt: string
  user_prompt: string
  is_active: boolean
}

interface AnalysisRun {
  id: string
  cliente_nome?: string | null
  period_label?: string | null
  prompt_name?: string | null
  model?: string | null
  output: string
  output_json?: unknown
  snapshot_id?: string | null
  created_at: string
}

interface SnapshotRow {
  id: string
  period_label?: string | null
  updated_at?: string | null
  snapshot: AnalyticsSnapshot | null
}

function fmtMetric(v: unknown, prefix: string) {
  if (v === undefined || v === null || v === '') return '-'
  const n = parseFloat(String(v))
  if (Number.isNaN(n)) return '-'
  return prefix + (prefix ? ' ' : '') + n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function fmtDate(value: string) {
  try {
    return new Date(value).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(.+)$/, '<p>$1</p>')
}

function priorityLabel(priority: 'high' | 'medium' | 'low') {
  if (priority === 'high') return 'Alta prioridade'
  if (priority === 'low') return 'Baixa prioridade'
  return 'Prioridade média'
}

function confidenceLabel(confidence: 'high' | 'medium' | 'low') {
  if (confidence === 'high') return 'Alta'
  if (confidence === 'low') return 'Baixa'
  return 'Média'
}

function StructuredAnalysisView({ result }: { result: StructuredAnalysisResult }) {
  const sections = [
    { title: 'O que está funcionando', items: result.wins },
    { title: 'Riscos e desperdícios', items: result.risks },
    { title: 'Oportunidades', items: result.opportunities },
    { title: 'Lacunas de dados', items: result.dataGaps },
  ].filter((section) => section.items.length > 0)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          background: '#fff',
          border: '1px solid #E5E7EB',
          borderRadius: 10,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Headline
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', lineHeight: 1.2, marginTop: 8 }}>
          {result.headline}
        </div>
        <p style={{ margin: '12px 0 0', color: '#4B5563', fontSize: 14, lineHeight: 1.65 }}>
          {result.diagnosis}
        </p>
      </div>

      {result.nextActions.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #DBEAFE',
            borderRadius: 10,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>
            Próximas ações
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {result.nextActions.map((action) => (
              <div
                key={`${action.priority}-${action.title}`}
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ color: '#111827', fontSize: 14 }}>{action.title}</strong>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: action.priority === 'high' ? '#B91C1C' : action.priority === 'low' ? '#1D4ED8' : '#92400E',
                      background: action.priority === 'high' ? '#FEE2E2' : action.priority === 'low' ? '#DBEAFE' : '#FEF3C7',
                      padding: '3px 6px',
                      borderRadius: 999,
                    }}
                  >
                    {priorityLabel(action.priority)}
                  </span>
                </div>
                <p style={{ margin: '8px 0 0', color: '#4B5563', fontSize: 13, lineHeight: 1.6 }}>
                  {action.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {sections.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {sections.map((section) => (
            <div
              key={section.title}
              style={{
                background: '#fff',
                border: '1px solid #E5E7EB',
                borderRadius: 10,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
                {section.title}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, color: '#374151', fontSize: 13, lineHeight: 1.6 }}>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          background: '#EFF6FF',
          border: '1px solid #BFDBFE',
          borderRadius: 10,
          padding: 14,
          color: '#1D4ED8',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        Confiança da análise: {confidenceLabel(result.confidence)}.
      </div>
    </div>
  )
}

const EMPTY_PROMPT_FORM = {
  id: '',
  name: '',
  description: '',
  category: 'performance',
  model: 'gpt-4o-mini',
  temperature: 0.35,
  system_prompt:
    'Voce e um estrategista senior de performance marketing da NGP. Responda em portugues brasileiro, com clareza e sem inventar dados ausentes.',
  user_prompt:
    'Analise as metricas do periodo e entregue diagnostico, oportunidades, riscos e proximas acoes.',
  is_active: true,
}

export default function IaAnalisePage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)

  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [selectedPromptId, setSelectedPromptId] = useState('')
  const [promptForm, setPromptForm] = useState(EMPTY_PROMPT_FORM)
  const [editingPrompts, setEditingPrompts] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [canManagePrompts, setCanManagePrompts] = useState(false)

  const [extraContext, setExtraContext] = useState('')
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null)
  const [snapshotId, setSnapshotId] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientUsername, setClientUsername] = useState('')
  const [clientId, setClientId] = useState('')
  const [metaAccountId, setMetaAccountId] = useState('')
  const [period, setPeriod] = useState('ultimos 30 dias')
  const [history, setHistory] = useState<AnalysisRun[]>([])
  const [analysisResult, setAnalysisResult] = useState<StructuredAnalysisResult | null>(null)
  const [outputHtml, setOutputHtml] = useState<string | null>(null)
  const [rawOutput, setRawOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingBase, setLoadingBase] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState('')
  const analysisInFlight = useRef(false)
  const promptSaveInFlight = useRef(false)

  const loadLatestSnapshot = useCallback(async (cid: string, username: string, account: string, opts?: { bypass?: boolean }) => {
    // Cache 30min: snapshots de IA são caros de gerar e raramente mudam dentro
    // de uma sessão de trabalho. Bypass via botão "↻ Atualizar".
    const data = await efCallCached('analytics-snapshots', {
      action: 'latest',
      cliente_id: cid || undefined,
      cliente_username: username || undefined,
      meta_account_id: account || undefined,
    }, { bypass: opts?.bypass })

    if (data.error) {
      setSnapshot(null)
      setSnapshotId('')
      setError(String(data.error))
      return
    }

    const row = (data.snapshot as SnapshotRow | null) || null
    if (!row?.snapshot) {
      setSnapshot(null)
      setSnapshotId('')
      return
    }

    setSnapshot(row.snapshot)
    setSnapshotId(row.id)
    setPeriod(row.snapshot.period.label || row.period_label || 'Período atual')
    setError('')
  }, [])

  const loadPrompts = useCallback(async () => {
    // Cache de prompts: muda raramente (apenas quando admin edita).
    // Invalidamos via invalidateEfCache('ai-generate-analysis') após salvar prompt.
    const data = await efCallCached('ai-generate-analysis', {
      action: 'list_prompts',
      include_inactive: true,
    })

    if (data.error) {
      setError(String(data.error))
      setPrompts([])
      return
    }

    const list = Array.isArray(data.prompts) ? (data.prompts as PromptTemplate[]) : []
    setPrompts(list)
    setCanManagePrompts(Boolean(data.can_manage))
    setSelectedPromptId((prev) => prev || list.find((p) => p.is_active)?.id || list[0]?.id || '')
  }, [])

  const loadHistory = useCallback(async (cid: string, username: string, opts?: { bypass?: boolean }) => {
    const data = await efCallCached('ai-generate-analysis', {
      action: 'history',
      cliente_id: cid || undefined,
      cliente_username: username || undefined,
    }, { bypass: opts?.bypass })

    if (!data.error && Array.isArray(data.history)) {
      setHistory(data.history as AnalysisRun[])
    }
  }, [])

  useEffect(() => {
    const currentSession = getSession()
    if (!currentSession || currentSession.auth !== '1') {
      router.replace('/login')
      return
    }
    setSess(currentSession)

    sessionStorage.removeItem('ngp_ia_key_openai')
    sessionStorage.removeItem('ngp_ia_key_anthropic')
    sessionStorage.removeItem('ngp_ia_key_gemini')
    sessionStorage.removeItem('ngp_ia_key_custom')
    sessionStorage.removeItem('ngp_ia_endpoint_custom')
    localStorage.removeItem('ngp_ia_key_openai')
    localStorage.removeItem('ngp_ia_key_anthropic')
    localStorage.removeItem('ngp_ia_key_gemini')
    localStorage.removeItem('ngp_ia_key_custom')

    const name = sessionStorage.getItem('ngp_viewing_name') || currentSession.user || ''
    const account = sessionStorage.getItem('ngp_viewing_account') || currentSession.metaAccount || ''
    const username = sessionStorage.getItem('ngp_viewing_username') || currentSession.username || ''
    const id = sessionStorage.getItem('ngp_viewing_id') || ''
    const currentIsInternal = currentSession.role === 'ngp' || currentSession.role === 'admin'

    if (!account && currentIsInternal) {
      alert('Selecione um cliente no dashboard antes de acessar a Analise de IA.')
      router.replace('/dashboard')
      return
    }

    setClientName(name)
    setClientUsername(username)
    setClientId(id)
    setMetaAccountId(account)
    setPeriod(sessionStorage.getItem('ngp_ia_period') || 'ultimos 30 dias')

    Promise.all([
      loadPrompts(),
      loadHistory(id, username),
      loadLatestSnapshot(id, username, account),
    ]).finally(() => setLoadingBase(false))
  }, [loadHistory, loadLatestSnapshot, loadPrompts, router])

  const packageCampaigns = useMemo(() => snapshot?.campaigns || [], [snapshot])
  const packageCreatives = useMemo(() => snapshot?.creatives || [], [snapshot])
  const hasUsableMetrics = useMemo(() => Boolean(snapshot && snapshotId), [snapshot, snapshotId])

  const metricItems = useMemo(() => {
    if (!snapshot) return []
    return [
      { k: 'Cliente', v: snapshot.client.name || clientName || '-' },
      { k: 'Periodo', v: snapshot.period.label || period || '-' },
      { k: 'Investimento', v: fmtMetric(snapshot.summary.spend, 'R$') },
      { k: 'Receita', v: fmtMetric(snapshot.summary.revenue, 'R$') },
      { k: snapshot.summary.primaryResultLabel || 'Resultados', v: fmtMetric(snapshot.summary.primaryResults, '') },
      { k: 'Conversas', v: fmtMetric(snapshot.summary.conversations, '') },
      { k: 'Leads', v: fmtMetric(snapshot.summary.leads, '') },
      { k: 'Compras', v: fmtMetric(snapshot.summary.purchases, '') },
      { k: 'Impressoes', v: fmtMetric(snapshot.summary.impressions, '') },
      { k: 'Cliques', v: fmtMetric(snapshot.summary.clicks, '') },
      { k: 'CTR', v: `${snapshot.summary.ctr.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` },
      { k: 'CPC medio', v: fmtMetric(snapshot.summary.cpc, 'R$') },
      { k: 'CPM', v: fmtMetric(snapshot.summary.cpm, 'R$') },
      { k: 'Custo/resultado', v: fmtMetric(snapshot.summary.costPerResult, 'R$') },
      { k: 'ROAS', v: `${snapshot.summary.roas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` },
      { k: 'Alcance', v: fmtMetric(snapshot.summary.reach, '') },
      { k: 'Frequencia', v: `${snapshot.summary.frequency.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` },
      { k: 'Campanhas', v: fmtMetric(snapshot.summary.filteredCampaignCount, '') },
      { k: 'Criativos', v: String(packageCreatives.length) },
    ].filter((item) => item.v !== '-')
  }, [clientName, packageCreatives.length, period, snapshot])

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId)

  async function runAnalysis() {
    if (analysisInFlight.current) return

    if (!hasUsableMetrics || !snapshotId) {
      alert('O snapshot analítico ainda não foi salvo para esta conta/período. Volte ao dashboard, aguarde os dados e tente novamente.')
      return
    }

    if (!selectedPromptId) {
      alert('Selecione um prompt para continuar.')
      return
    }

    analysisInFlight.current = true
    setLoading(true)
    setError('')
    setNotice('Gerando análise no servidor com base no snapshot analítico consolidado.')
    setAnalysisResult(null)
    setOutputHtml(null)
    setRawOutput('')

    try {
      const data = await efCall('ai-generate-analysis', {
        action: 'generate',
        prompt_id: selectedPromptId,
        cliente_id: clientId || undefined,
        cliente_username: clientUsername || undefined,
        cliente_nome: clientName || undefined,
        meta_account_id: metaAccountId || undefined,
        period_label: period,
        snapshot_id: snapshotId,
        extra_context: extraContext,
      })

      if (data.error) {
        setNotice('')
        setError(String(data.error))
        return
      }

      const structured = parseStructuredAnalysis(data.analysis_json)
      const markdown = String(
        data.analysis || (structured ? renderStructuredAnalysisMarkdown(structured) : '')
      )

      setAnalysisResult(structured)
      setRawOutput(markdown)
      setOutputHtml(structured ? null : renderMarkdown(markdown))
      setNotice('Análise gerada e salva no histórico.')
      // Nova análise gerada → invalida cache de history pra mostrar a nova.
      invalidateEfCache('ai-generate-analysis')
      await loadHistory(clientId, clientUsername, { bypass: true })
    } catch {
      setNotice('')
      setError('Nao foi possivel gerar a analise agora. Tente novamente em alguns segundos.')
    } finally {
      analysisInFlight.current = false
      setLoading(false)
    }
  }

  async function savePrompt() {
    if (promptSaveInFlight.current) return

    if (!promptForm.name.trim() || !promptForm.system_prompt.trim() || !promptForm.user_prompt.trim()) {
      setNotice('')
      setError('Nome, prompt de sistema e prompt do usuario sao obrigatorios.')
      return
    }

    promptSaveInFlight.current = true
    setSavingPrompt(true)
    setError('')
    setNotice('Salvando prompt...')

    try {
      const data = await efCall('ai-generate-analysis', {
        action: 'save_prompt',
        id: promptForm.id || undefined,
        name: promptForm.name,
        description: promptForm.description,
        category: promptForm.category,
        model: promptForm.model,
        temperature: promptForm.temperature,
        system_prompt: promptForm.system_prompt,
        user_prompt: promptForm.user_prompt,
        is_active: promptForm.is_active,
      })

      if (data.error) {
        setNotice('')
        setError(String(data.error))
        return
      }

      setNotice('Prompt salvo com sucesso.')
      setPromptForm(EMPTY_PROMPT_FORM)
      setEditingPrompts(false)
      await loadPrompts()
    } catch {
      setNotice('')
      setError('Nao foi possivel salvar o prompt agora. Tente novamente em alguns segundos.')
    } finally {
      promptSaveInFlight.current = false
      setSavingPrompt(false)
    }
  }

  async function copyOutput() {
    await navigator.clipboard.writeText(rawOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function editPrompt(prompt: PromptTemplate) {
    setPromptForm({
      id: prompt.id,
      name: prompt.name,
      description: prompt.description || '',
      category: prompt.category,
      model: prompt.model,
      temperature: Number(prompt.temperature ?? 0.35),
      system_prompt: prompt.system_prompt,
      user_prompt: prompt.user_prompt,
      is_active: prompt.is_active,
    })
    setEditingPrompts(true)
  }

  if (!sess) return null

  return (
    <div className={styles.layout}>
      <Sidebar />

      <div className={styles.main}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>Analise de IA</span>
          {clientName && <span className={styles.clientBadge}>Cliente: {clientName}</span>}
          <span className={styles.secureBadge}>Snapshot + chave protegidos no servidor</span>
        </div>

        <div className={styles.page}>
          <div className={`${styles.card} ${styles.generatorCard}`}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.ciPurple}`}>AI</div>
              <span className={styles.cardTitle}>Gerar analise</span>
              {canManagePrompts && (
                <button className={styles.btnGhost} style={{ marginLeft: 'auto' }} onClick={() => setEditingPrompts((value) => !value)}>
                  {editingPrompts ? 'Fechar prompts' : 'Gerenciar prompts'}
                </button>
              )}
            </div>

            <div className={styles.infoBox}>
              A IA agora consome um snapshot analítico salvo no servidor. Isso deixa a leitura coerente entre dashboard, histórico e análise automática.
            </div>

            <div className={styles.fieldRow} style={{ marginTop: 14 }}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Prompt salvo</label>
                <CustomSelect
                  caption="Prompt"
                  value={selectedPromptId}
                  options={prompts.length > 0 
                    ? prompts.filter((p) => p.is_active || canManagePrompts).map((p) => ({
                        id: p.id,
                        label: p.name + (p.is_active ? '' : ' (inativo)')
                      }))
                    : [{ id: '', label: 'Nenhum prompt ativo' }]
                  }
                  onChange={setSelectedPromptId}
                  disabled={loadingBase}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Modelo</label>
                <div className={styles.readOnlyBox}>{selectedPrompt?.model || '-'}</div>
              </div>
            </div>

            {selectedPrompt?.description && <p className={styles.promptDesc}>{selectedPrompt.description}</p>}

            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                Contexto adicional
                <span className={styles.fieldHint}>opcional</span>
              </label>
              <textarea
                className={styles.textarea}
                rows={3}
                placeholder="Ex: cliente quer escalar vendas, verba mensal de R$ 10.000, foco em leads qualificados..."
                value={extraContext}
                onChange={(e) => setExtraContext(e.target.value)}
                maxLength={3000}
              />
            </div>

            <div className={styles.btnRow}>
              <button className={styles.btnPrimary} onClick={runAnalysis} disabled={loading || loadingBase || !selectedPromptId || !hasUsableMetrics}>
                {loading ? 'Analisando...' : 'Gerar analise com IA'}
              </button>
              <button
                className={styles.btnGhost}
                onClick={() => loadLatestSnapshot(clientId, clientUsername, metaAccountId)}
                disabled={loading}
              >
                Recarregar snapshot
              </button>
              {loading && <span className={styles.busyInline}>A IA esta trabalhando no servidor. Aguarde sem recarregar a pagina.</span>}
            </div>
          </div>

          {editingPrompts && canManagePrompts && (
            <div className={`${styles.card} ${styles.promptCard}`}>
              <div className={styles.cardHead}>
                <div className={`${styles.cardIcon} ${styles.ciAmber}`}>P</div>
                <span className={styles.cardTitle}>Templates de prompt</span>
                <button className={styles.btnGhost} style={{ marginLeft: 'auto' }} onClick={() => setPromptForm(EMPTY_PROMPT_FORM)}>
                  Novo
                </button>
              </div>

              <div className={styles.promptManagerGrid}>
                <aside className={styles.promptLibrary}>
                  <div className={styles.panelTitle}>Prompts salvos</div>
                  <div className={styles.promptList}>
                    {prompts.map((prompt) => (
                      <button
                        key={prompt.id}
                        className={`${styles.promptItem} ${promptForm.id === prompt.id ? styles.promptItemActive : ''}`}
                        onClick={() => editPrompt(prompt)}
                      >
                        <strong>{prompt.name}</strong>
                        <span>
                          {prompt.model} · {prompt.is_active ? 'ativo' : 'inativo'}
                        </span>
                      </button>
                    ))}
                  </div>
                </aside>

                <section className={styles.promptEditor}>
                  <div className={styles.panelTitle}>{promptForm.id ? 'Editar template' : 'Novo template'}</div>

                  <div className={styles.promptEditorGrid}>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Nome</label>
                      <input className={styles.input} value={promptForm.name} onChange={(e) => setPromptForm((value) => ({ ...value, name: e.target.value }))} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Modelo</label>
                      <input className={styles.input} value={promptForm.model} onChange={(e) => setPromptForm((value) => ({ ...value, model: e.target.value }))} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Descricao</label>
                      <input className={styles.input} value={promptForm.description} onChange={(e) => setPromptForm((value) => ({ ...value, description: e.target.value }))} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Temperatura</label>
                      <input className={styles.input} type="number" min="0" max="1" step="0.05" value={promptForm.temperature} onChange={(e) => setPromptForm((value) => ({ ...value, temperature: Number(e.target.value) }))} />
                    </div>
                    <div className={`${styles.field} ${styles.span2}`}>
                      <label className={styles.fieldLabel}>Prompt de sistema</label>
                      <textarea className={styles.textarea} rows={4} value={promptForm.system_prompt} onChange={(e) => setPromptForm((value) => ({ ...value, system_prompt: e.target.value }))} />
                    </div>
                    <div className={`${styles.field} ${styles.span2}`}>
                      <label className={styles.fieldLabel}>Prompt do usuario</label>
                      <textarea className={styles.textarea} rows={4} value={promptForm.user_prompt} onChange={(e) => setPromptForm((value) => ({ ...value, user_prompt: e.target.value }))} />
                    </div>
                  </div>

                  <div className={styles.promptActions}>
                    <label className={styles.checkRow}>
                      <input type="checkbox" checked={promptForm.is_active} onChange={(e) => setPromptForm((value) => ({ ...value, is_active: e.target.checked }))} />
                      Prompt ativo
                    </label>
                    <button className={styles.btnPrimary} onClick={savePrompt} disabled={savingPrompt}>
                      {savingPrompt ? 'Salvando...' : 'Salvar prompt'}
                    </button>
                    {savingPrompt && <span className={styles.busyInline}>Gravando template no Supabase...</span>}
                  </div>
                </section>
              </div>
            </div>
          )}

          <div className={`${styles.card} ${styles.metricsCard}`}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.ciGreen}`}>M</div>
              <span className={styles.cardTitle}>Metricas usadas na analise</span>
            </div>

            <div className={styles.metricsPreview}>
              <div className={styles.metricsPreviewTitle}>Dados carregados do snapshot analítico</div>
              {!hasUsableMetrics ? (
                <div className={styles.warningBox}>
                  Nenhum snapshot analítico foi encontrado para esta conta. Volte ao dashboard, aguarde a consolidação dos dados e tente novamente.
                </div>
              ) : (
                <>
                  <div className={styles.metricsGrid}>
                    {metricItems.map((item) => (
                      <div key={item.k} className={styles.metricPill}>
                        <div className={styles.metricKey}>{item.k}</div>
                        <div className={styles.metricVal}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.metricsFoot}>
                    Snapshot salvo em {fmtDate(snapshot?.generatedAt || '')}. Pacote IA: {packageCampaigns.length} campanhas e {packageCreatives.length} criativos.
                  </div>
                </>
              )}
            </div>
          </div>

          <div className={`${styles.card} ${styles.responseCard}`}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.ciAmber}`}>R</div>
              <span className={styles.cardTitle}>Resposta da IA</span>
              {rawOutput && !loading && (
                <button className={styles.btnGhost} style={{ marginLeft: 'auto' }} onClick={copyOutput}>
                  {copied ? 'Copiado!' : 'Copiar todo conteudo'}
                </button>
              )}
            </div>

            {notice && <div className={styles.successBox}>{notice}</div>}

            <div className={styles.outputBox}>
              {loading && <div className={styles.outputLoading}>A IA esta analisando as metricas<span className={styles.cursor} /></div>}
              {!loading && error && <span className={styles.outputError}>Erro: {error}</span>}
              {!loading && !error && analysisResult && <StructuredAnalysisView result={analysisResult} />}
              {!loading && !error && !analysisResult && outputHtml && <div dangerouslySetInnerHTML={{ __html: outputHtml }} />}
              {!loading && !error && !analysisResult && !outputHtml && (
                <span className={styles.outputEmpty}>A resposta aparece aqui depois de clicar em "Gerar analise com IA".</span>
              )}
            </div>

            <div className={styles.btnRow}>
              {rawOutput && !loading && (
                <button
                  className={styles.btnGhost}
                  onClick={() => {
                    setAnalysisResult(null)
                    setOutputHtml(null)
                    setRawOutput('')
                    setError('')
                    setNotice('')
                  }}
                >
                  Limpar
                </button>
              )}
            </div>
          </div>

          <div className={`${styles.card} ${styles.historyCard}`}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.ciPurple}`}>H</div>
              <span className={styles.cardTitle}>Historico salvo</span>
            </div>

            {history.length === 0 ? (
              <span className={styles.outputEmpty}>Nenhuma analise salva ainda para este cliente.</span>
            ) : (
              <div className={styles.historyList}>
                {history.map((item) => {
                  const structured = parseStructuredAnalysis(item.output_json)
                  return (
                    <details key={item.id} className={styles.historyItem}>
                      <summary>
                        <strong>{item.prompt_name || 'Analise IA'}</strong>
                        <span>
                          {fmtDate(item.created_at)} · {item.period_label || 'periodo nao informado'} · {item.model}
                        </span>
                      </summary>
                      <div className={styles.historyOutput}>
                        {structured ? (
                          <StructuredAnalysisView result={structured} />
                        ) : (
                          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(item.output) }} />
                        )}
                      </div>
                    </details>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
