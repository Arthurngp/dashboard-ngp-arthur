'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { efCall } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import styles from './ia-analise.module.css'

interface Metrics {
  spend?: number | string
  leads?: number | string
  cpl?: number | string
  impressions?: number | string
  clicks?: number | string
  ctr?: number | string
  roas?: number | string
  purchases?: number | string
  cpc?: number | string
  reach?: number | string
  [key: string]: unknown
}

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
  created_at: string
}

function fmtMetric(v: unknown, prefix: string) {
  if (v === undefined || v === null || v === '') return '-'
  const n = parseFloat(String(v))
  if (Number.isNaN(n)) return '-'
  return prefix + (prefix ? ' ' : '') + n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function objValue(source: unknown, key: string) {
  if (!source || typeof source !== 'object') return undefined
  return (source as Record<string, unknown>)[key]
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function hasNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0
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

const EMPTY_PROMPT_FORM = {
  id: '',
  name: '',
  description: '',
  category: 'performance',
  model: 'gpt-4o-mini',
  temperature: 0.35,
  system_prompt: 'Voce e um estrategista senior de performance marketing da NGP. Responda em portugues brasileiro, com clareza e sem inventar dados ausentes.',
  user_prompt: 'Analise as metricas do periodo e entregue diagnostico, oportunidades, riscos e proximas acoes.',
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
  const [metrics, setMetrics] = useState<Metrics>({})
  const [clientName, setClientName] = useState('')
  const [clientUsername, setClientUsername] = useState('')
  const [clientId, setClientId] = useState('')
  const [metaAccountId, setMetaAccountId] = useState('')
  const [period, setPeriod] = useState('ultimos 30 dias')
  const [history, setHistory] = useState<AnalysisRun[]>([])
  const [output, setOutput] = useState<string | null>(null)
  const [rawOutput, setRawOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingBase, setLoadingBase] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState('')
  const analysisInFlight = useRef(false)
  const promptSaveInFlight = useRef(false)

  const loadMetrics = useCallback(() => {
    const stored = sessionStorage.getItem('ngp_ia_metrics')
    if (!stored) {
      setMetrics({})
      return
    }
    try {
      setMetrics(JSON.parse(stored))
    } catch {
      setMetrics({})
    }
  }, [])

  const loadPrompts = useCallback(async () => {
    const data = await efCall('ai-generate-analysis', {
      action: 'list_prompts',
      include_inactive: true,
    })

    if (data.error) {
      setError(String(data.error))
      setPrompts([])
      return
    }

    const list = Array.isArray(data.prompts) ? data.prompts as unknown as PromptTemplate[] : []
    setPrompts(list)
    setCanManagePrompts(Boolean(data.can_manage))
    setSelectedPromptId(prev => prev || list.find(p => p.is_active)?.id || list[0]?.id || '')
  }, [])

  const loadHistory = useCallback(async (cid: string, username: string) => {
    const data = await efCall('ai-generate-analysis', {
      action: 'history',
      cliente_id: cid || undefined,
      cliente_username: username || undefined,
    })

    if (!data.error && Array.isArray(data.history)) {
      setHistory(data.history as unknown as AnalysisRun[])
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
    loadMetrics()

    Promise.all([loadPrompts(), loadHistory(id, username)]).finally(() => setLoadingBase(false))
  }, [loadHistory, loadMetrics, loadPrompts, router])

  const metricsSummary = useMemo(() => {
    const resumo = objValue(metrics, 'resumo')
    return resumo && typeof resumo === 'object' ? resumo as Record<string, unknown> : metrics
  }, [metrics])

  const packageCampaigns = useMemo(() => asArray(objValue(metrics, 'campanhas')), [metrics])
  const packageCreatives = useMemo(() => asArray(objValue(metrics, 'criativos')), [metrics])
  const hasUsableMetrics = useMemo(() => {
    const numericKeys = [
      'investimento', 'spend', 'impressoes', 'impressions', 'cliques', 'clicks',
      'ctr', 'cpc_medio', 'cpc', 'resultados', 'conversas', 'leads', 'compras',
      'purchases', 'campanhas',
    ]
    return numericKeys.some(key => hasNumber(objValue(metricsSummary, key))) || packageCampaigns.length > 0 || packageCreatives.length > 0
  }, [metricsSummary, packageCampaigns.length, packageCreatives.length])

  const metricItems = useMemo(() => [
    { k: 'Cliente', v: clientName || String(objValue(objValue(metrics, 'cliente'), 'nome') || '-') },
    { k: 'Periodo', v: String(objValue(objValue(metrics, 'periodo'), 'label') || period || '-') },
    { k: 'Investimento', v: fmtMetric(objValue(metricsSummary, 'investimento') ?? objValue(metricsSummary, 'spend'), 'R$') },
    { k: 'Receita', v: fmtMetric(objValue(metricsSummary, 'receita') ?? objValue(metricsSummary, 'revenue'), 'R$') },
    { k: 'Resultados', v: fmtMetric(objValue(metricsSummary, 'resultados'), '') },
    { k: 'Conversas', v: fmtMetric(objValue(metricsSummary, 'conversas') ?? objValue(metricsSummary, 'conversations'), '') },
    { k: 'Leads', v: fmtMetric(objValue(metricsSummary, 'leads'), '') },
    { k: 'Compras', v: fmtMetric(objValue(metricsSummary, 'compras') ?? objValue(metricsSummary, 'purchases'), '') },
    { k: 'Impressoes', v: fmtMetric(objValue(metricsSummary, 'impressoes') ?? objValue(metricsSummary, 'impressions'), '') },
    { k: 'Cliques', v: fmtMetric(objValue(metricsSummary, 'cliques') ?? objValue(metricsSummary, 'clicks'), '') },
    { k: 'CTR', v: objValue(metricsSummary, 'ctr') !== undefined ? `${Number(objValue(metricsSummary, 'ctr')).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '-' },
    { k: 'CPC medio', v: fmtMetric(objValue(metricsSummary, 'cpc_medio') ?? objValue(metricsSummary, 'cpc'), 'R$') },
    { k: 'CPM', v: fmtMetric(objValue(metricsSummary, 'cpm'), 'R$') },
    { k: 'Custo/resultado', v: fmtMetric(objValue(metricsSummary, 'custo_por_resultado') ?? objValue(metricsSummary, 'cpl'), 'R$') },
    { k: 'ROAS', v: objValue(metricsSummary, 'roas') !== undefined ? `${Number(objValue(metricsSummary, 'roas')).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` : '-' },
    { k: 'Alcance', v: fmtMetric(objValue(metricsSummary, 'alcance') ?? objValue(metricsSummary, 'reach'), '') },
    { k: 'Frequencia', v: objValue(metricsSummary, 'frequencia') !== undefined ? `${Number(objValue(metricsSummary, 'frequencia')).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` : '-' },
    { k: 'Campanhas', v: fmtMetric(objValue(metricsSummary, 'campanhas'), '') },
    { k: 'Criativos', v: packageCreatives.length ? String(packageCreatives.length) : '-' },
  ].filter(i => i.v !== '-'), [clientName, metrics, metricsSummary, packageCreatives.length, period])

  const selectedPrompt = prompts.find(p => p.id === selectedPromptId)

  async function runAnalysis() {
    if (analysisInFlight.current) return

    if (!hasUsableMetrics) {
      alert('As metricas ainda nao foram carregadas para a IA. Volte ao dashboard, aguarde os dados aparecerem e abra a Analise IA novamente.')
      return
    }

    if (!selectedPromptId) {
      alert('Selecione um prompt para continuar.')
      return
    }

    analysisInFlight.current = true
    setLoading(true)
    setError('')
    setNotice('Gerando analise no servidor. Pode levar alguns segundos.')
    setOutput(null)
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
        metrics,
        extra_context: extraContext,
      })

      if (data.error) {
        setNotice('')
        setError(String(data.error))
        return
      }

      const analysis = String(data.analysis || '')
      setRawOutput(analysis)
      setOutput(renderMarkdown(analysis))
      setNotice('Analise gerada e salva no historico.')
      await loadHistory(clientId, clientUsername)
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
          <span className={styles.secureBadge}>Chave protegida no servidor</span>
        </div>

        <div className={styles.page}>
          <div className={`${styles.card} ${styles.generatorCard}`}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.ciPurple}`}>AI</div>
              <span className={styles.cardTitle}>Gerar analise</span>
              {canManagePrompts && (
                <button className={styles.btnGhost} style={{ marginLeft: 'auto' }} onClick={() => setEditingPrompts(v => !v)}>
                  {editingPrompts ? 'Fechar prompts' : 'Gerenciar prompts'}
                </button>
              )}
            </div>

            <div className={styles.infoBox}>
              A chave da OpenAI nao fica mais nesta tela. O navegador envia apenas metricas, cliente, periodo e prompt escolhido; a Edge Function validada chama a IA pelo servidor.
            </div>

            <div className={styles.fieldRow} style={{ marginTop: 14 }}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Prompt salvo</label>
                <select className={styles.select} value={selectedPromptId} onChange={e => setSelectedPromptId(e.target.value)} disabled={loadingBase}>
                  {!prompts.length && <option value="">Nenhum prompt ativo</option>}
                  {prompts.filter(p => p.is_active || canManagePrompts).map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.is_active ? '' : ' (inativo)'}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Modelo</label>
                <div className={styles.readOnlyBox}>{selectedPrompt?.model || '-'}</div>
              </div>
            </div>

            {selectedPrompt?.description && (
              <p className={styles.promptDesc}>{selectedPrompt.description}</p>
            )}

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
                onChange={e => setExtraContext(e.target.value)}
                maxLength={3000}
              />
            </div>

            <div className={styles.btnRow}>
              <button className={styles.btnPrimary} onClick={runAnalysis} disabled={loading || loadingBase || !selectedPromptId || !hasUsableMetrics}>
                {loading ? 'Analisando...' : 'Gerar analise com IA'}
              </button>
              <button className={styles.btnGhost} onClick={loadMetrics} disabled={loading}>Recarregar metricas</button>
              {loading && <span className={styles.busyInline}>A IA esta trabalhando no servidor. Aguarde sem recarregar a pagina.</span>}
            </div>
          </div>

          {editingPrompts && canManagePrompts && (
            <div className={`${styles.card} ${styles.promptCard}`}>
              <div className={styles.cardHead}>
                <div className={`${styles.cardIcon} ${styles.ciAmber}`}>P</div>
                <span className={styles.cardTitle}>Templates de prompt</span>
                <button className={styles.btnGhost} style={{ marginLeft: 'auto' }} onClick={() => setPromptForm(EMPTY_PROMPT_FORM)}>Novo</button>
              </div>

              <div className={styles.promptManagerGrid}>
                <aside className={styles.promptLibrary}>
                  <div className={styles.panelTitle}>Prompts salvos</div>
                  <div className={styles.promptList}>
                    {prompts.map(prompt => (
                      <button key={prompt.id} className={`${styles.promptItem} ${promptForm.id === prompt.id ? styles.promptItemActive : ''}`} onClick={() => editPrompt(prompt)}>
                        <strong>{prompt.name}</strong>
                        <span>{prompt.model} · {prompt.is_active ? 'ativo' : 'inativo'}</span>
                      </button>
                    ))}
                  </div>
                </aside>

                <section className={styles.promptEditor}>
                  <div className={styles.panelTitle}>{promptForm.id ? 'Editar template' : 'Novo template'}</div>

                  <div className={styles.promptEditorGrid}>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Nome</label>
                      <input className={styles.input} value={promptForm.name} onChange={e => setPromptForm(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Modelo</label>
                      <input className={styles.input} value={promptForm.model} onChange={e => setPromptForm(p => ({ ...p, model: e.target.value }))} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Descricao</label>
                      <input className={styles.input} value={promptForm.description} onChange={e => setPromptForm(p => ({ ...p, description: e.target.value }))} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Temperatura</label>
                      <input className={styles.input} type="number" min="0" max="1" step="0.05" value={promptForm.temperature} onChange={e => setPromptForm(p => ({ ...p, temperature: Number(e.target.value) }))} />
                    </div>
                    <div className={`${styles.field} ${styles.span2}`}>
                      <label className={styles.fieldLabel}>Prompt de sistema</label>
                      <textarea className={styles.textarea} rows={4} value={promptForm.system_prompt} onChange={e => setPromptForm(p => ({ ...p, system_prompt: e.target.value }))} />
                    </div>
                    <div className={`${styles.field} ${styles.span2}`}>
                      <label className={styles.fieldLabel}>Prompt do usuario</label>
                      <textarea className={styles.textarea} rows={4} value={promptForm.user_prompt} onChange={e => setPromptForm(p => ({ ...p, user_prompt: e.target.value }))} />
                    </div>
                  </div>

                  <div className={styles.promptActions}>
                    <label className={styles.checkRow}>
                      <input type="checkbox" checked={promptForm.is_active} onChange={e => setPromptForm(p => ({ ...p, is_active: e.target.checked }))} />
                      Prompt ativo
                    </label>
                    <button className={styles.btnPrimary} onClick={savePrompt} disabled={savingPrompt}>{savingPrompt ? 'Salvando...' : 'Salvar prompt'}</button>
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
              <div className={styles.metricsPreviewTitle}>Dados carregados do dashboard</div>
              {!hasUsableMetrics ? (
                <div className={styles.warningBox}>
                  As metricas ainda nao chegaram para esta conta. Volte ao dashboard, aguarde Resumo/Campanhas carregar, depois abra a Analise IA novamente.
                </div>
              ) : (
                <>
                  <div className={styles.metricsGrid}>
                    {metricItems.map(item => (
                      <div key={item.k} className={styles.metricPill}>
                        <div className={styles.metricKey}>{item.k}</div>
                        <div className={styles.metricVal}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.metricsFoot}>
                    Pacote IA: {packageCampaigns.length} campanhas e {packageCreatives.length} criativos enviados para analise.
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
              {!loading && !error && output && <div dangerouslySetInnerHTML={{ __html: output }} />}
              {!loading && !error && !output && <span className={styles.outputEmpty}>A resposta aparece aqui depois de clicar em "Gerar analise com IA".</span>}
            </div>

            <div className={styles.btnRow}>
              {rawOutput && !loading && (
                <>
                  <button className={styles.btnGhost} onClick={() => { setOutput(null); setRawOutput(''); setError(''); setNotice('') }}>Limpar</button>
                </>
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
                {history.map(item => (
                  <details key={item.id} className={styles.historyItem}>
                    <summary>
                      <strong>{item.prompt_name || 'Analise IA'}</strong>
                      <span>{fmtDate(item.created_at)} · {item.period_label || 'periodo nao informado'} · {item.model}</span>
                    </summary>
                    <div className={styles.historyOutput} dangerouslySetInnerHTML={{ __html: renderMarkdown(item.output) }} />
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
