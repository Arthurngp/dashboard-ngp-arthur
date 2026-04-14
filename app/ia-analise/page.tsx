'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession, clearSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import styles from './ia-analise.module.css'

const MODELS: Record<string, { v: string; l: string }[]> = {
  openai: [{ v: 'gpt-4o', l: 'GPT-4o' }, { v: 'gpt-4o-mini', l: 'GPT-4o Mini' }, { v: 'gpt-4-turbo', l: 'GPT-4 Turbo' }, { v: 'gpt-3.5-turbo', l: 'GPT-3.5 Turbo' }],
  anthropic: [{ v: 'claude-opus-4-6', l: 'Claude Opus' }, { v: 'claude-sonnet-4-6', l: 'Claude Sonnet' }, { v: 'claude-haiku-4-5-20251001', l: 'Claude Haiku' }],
  gemini: [{ v: 'gemini-1.5-pro', l: 'Gemini 1.5 Pro' }, { v: 'gemini-1.5-flash', l: 'Gemini 1.5 Flash' }, { v: 'gemini-2.0-flash', l: 'Gemini 2.0 Flash' }],
  custom: [{ v: 'custom', l: 'Definido pelo endpoint' }],
}

const ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/chat/completions',
  custom: '',
}

const ANALYSIS_TYPES = [
  { value: 'geral', label: 'Análise geral de performance' },
  { value: 'otimizacao', label: 'Sugestões de otimização' },
  { value: 'diagnostico', label: 'Diagnóstico de campanhas' },
  { value: 'projecao', label: 'Projeção e previsão' },
  { value: 'comparativo', label: 'Análise comparativa' },
  { value: 'custom', label: 'Pergunta personalizada' },
]

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

function fmtMetric(v: unknown, prefix: string) {
  if (v === undefined || v === null || v === '') return '—'
  const n = parseFloat(String(v))
  if (isNaN(n)) return '—'
  return prefix + (prefix ? ' ' : '') + n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
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

export default function IaAnalisePage() {
  const router = useRouter()
  const sess = getSession()

  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('gpt-4o')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [customEndpoint, setCustomEndpoint] = useState('')
  const [analysisType, setAnalysisType] = useState('geral')
  const [extraContext, setExtraContext] = useState('')
  const [customQuestion, setCustomQuestion] = useState('')
  const [metrics, setMetrics] = useState<Metrics>({})
  const [clientName, setClientName] = useState('')
  const [period, setPeriod] = useState('últimos 30 dias')
  const [output, setOutput] = useState<string | null>(null)
  const [rawOutput, setRawOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!sess || sess.auth !== '1') { router.replace('/login'); return }
    const name = sessionStorage.getItem('ngp_viewing_name') || ''
    const account = sessionStorage.getItem('ngp_viewing_account') || ''
    if (!account) {
      alert('Selecione um cliente no dashboard antes de acessar a Análise de IA.')
      router.replace('/dashboard')
      return
    }
    setClientName(name)
    setPeriod(sessionStorage.getItem('ngp_ia_period') || 'últimos 30 dias')
    loadMetrics()
    loadSavedKey('openai')
  }, [])

  function loadMetrics() {
    const stored = sessionStorage.getItem('ngp_ia_metrics')
    if (stored) {
      try { setMetrics(JSON.parse(stored)) } catch { }
    }
  }

  function loadSavedKey(p: string) {
    let key = sessionStorage.getItem('ngp_ia_key_' + p) || ''
    if (!key) {
      const legacy = localStorage.getItem('ngp_ia_key_' + p) || ''
      if (legacy) { sessionStorage.setItem('ngp_ia_key_' + p, legacy); localStorage.removeItem('ngp_ia_key_' + p); key = legacy }
    }
    setApiKey(key)
    const ep = sessionStorage.getItem('ngp_ia_endpoint_custom') || ''
    if (ep) setCustomEndpoint(ep)
  }

  function handleProviderChange(p: string) {
    setProvider(p)
    setModel(MODELS[p][0].v)
    loadSavedKey(p)
  }

  function handleKeyChange(v: string) {
    setApiKey(v)
    if (v) sessionStorage.setItem('ngp_ia_key_' + provider, v)
    localStorage.removeItem('ngp_ia_key_' + provider)
  }

  function handleEndpointChange(v: string) {
    setCustomEndpoint(v)
    if (v) sessionStorage.setItem('ngp_ia_endpoint_custom', v)
  }

  function buildPrompt() {
    const tipoLabel: Record<string, string> = {
      geral: 'Faça uma análise geral de performance das métricas abaixo.',
      otimizacao: 'Com base nas métricas abaixo, dê sugestões práticas e objetivas de otimização de campanhas.',
      diagnostico: 'Faça um diagnóstico detalhado das campanhas com base nas métricas. Identifique pontos de atenção.',
      projecao: 'Com base nos dados, faça uma projeção para o próximo período e recomendações.',
      comparativo: 'Analise os dados e identifique o que está performando bem e o que precisa melhorar.',
      custom: customQuestion || 'Analise as métricas abaixo e responda com insights relevantes.',
    }

    const metricsText = Object.keys(metrics).length
      ? Object.entries(metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')
      : '(Métricas não disponíveis — baseie-se no contexto fornecido)'

    return `Você é um especialista em marketing digital e tráfego pago. Analise os dados abaixo e responda em português brasileiro de forma clara, objetiva e acionável.

**Cliente:** ${clientName || 'Cliente'}
**Período:** ${period}

**Métricas:**
${metricsText}

${extraContext ? `**Contexto adicional:**\n${extraContext}\n` : ''}**Solicitação:** ${tipoLabel[analysisType]}

Estruture sua resposta com títulos em negrito usando **titulo**, use bullet points onde fizer sentido e seja direto nas recomendações.`
  }

  async function runAnalysis() {
    if (!apiKey.trim()) { alert('Insira sua chave de API para continuar.'); return }
    setLoading(true); setError(''); setOutput(null); setRawOutput('')

    const prompt = buildPrompt()

    try {
      let text = ''

      if (provider === 'openai' || provider === 'gemini' || provider === 'custom') {
        const endpoint = provider === 'custom'
          ? (customEndpoint.trim() || '')
          : ENDPOINTS[provider]

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey.trim() },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'Você é um especialista em marketing digital e análise de dados de campanhas pagas. Responda sempre em português brasileiro.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.7,
            max_tokens: 1500,
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
          throw new Error(err?.error?.message || 'Erro ' + res.status + ' na API')
        }

        const data = await res.json() as { choices?: { message?: { content?: string } }[] }
        text = data?.choices?.[0]?.message?.content || ''

      } else if (provider === 'anthropic') {
        const res = await fetch(ENDPOINTS.anthropic, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey.trim(),
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
          throw new Error(err?.error?.message || 'Erro ' + res.status + ' na API Anthropic')
        }

        const data = await res.json() as { content?: { text?: string }[] }
        text = data?.content?.[0]?.text || ''
      }

      setRawOutput(text)
      setOutput(renderMarkdown(text))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    }

    setLoading(false)
  }

  async function copyOutput() {
    await navigator.clipboard.writeText(rawOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function logout() {
    if (!confirm('Deseja sair?')) return
    fetch(`${SURL}/functions/v1/logout`, {
      method: 'POST',
      headers: efHeaders(),
      body: JSON.stringify({ token: sess?.session }),
    }).catch(() => { })
    clearSession()
    router.replace('/login')
  }

  const metricItems = [
    { k: 'Cliente', v: clientName || '—' },
    { k: 'Investimento', v: fmtMetric(metrics.spend, 'R$') },
    { k: 'Leads', v: fmtMetric(metrics.leads, '') },
    { k: 'CPL', v: fmtMetric(metrics.cpl, 'R$') },
    { k: 'Impressões', v: fmtMetric(metrics.impressions, '') },
    { k: 'Cliques', v: fmtMetric(metrics.clicks, '') },
    { k: 'CTR', v: metrics.ctr ? metrics.ctr + '%' : '—' },
    { k: 'ROAS', v: metrics.roas ? metrics.roas + 'x' : '—' },
    { k: 'Compras', v: fmtMetric(metrics.purchases, '') },
    { k: 'CPC', v: fmtMetric(metrics.cpc, 'R$') },
    { k: 'Alcance', v: fmtMetric(metrics.reach, '') },
  ].filter(i => i.v !== '—')

  if (!sess) return null

  return (
    <div className={styles.layout}>

      {/* SIDEBAR */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <div className={styles.logoMark}>
            <svg viewBox="0 0 24 24" fill="white" width={16} height={16}>
              <path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm14 3a4 4 0 110-8 4 4 0 010 8z" />
            </svg>
          </div>
          <div>
            <div className={styles.logoText}>NGP <span>Dashboard</span></div>
            <div className={styles.roleLabel}>{sess.role === 'ngp' ? '🚀 NGP Admin' : `👤 ${sess.user}`}</div>
          </div>
        </div>

        <nav className={styles.sidebarNav}>
          <span className={styles.navLabel}>Visão geral</span>
          <button className={styles.navItem} onClick={() => router.push('/dashboard')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={15} height={15}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
            Resumo
          </button>
          <button className={styles.navItem} onClick={() => router.push('/dashboard')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={15} height={15}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
            Campanhas
          </button>
          <button className={styles.navItem} onClick={() => window.open('/relatorio?novo=1', '_blank')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={15} height={15}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            Relatório ↗
          </button>
          <span className={styles.navLabel} style={{ marginTop: 6 }}>Plataformas</span>
          <button className={styles.navItem} onClick={() => router.push('/dashboard')}>
            <svg viewBox="0 0 24 24" fill="#1877f2" width={15} height={15}><circle cx="12" cy="12" r="10" /><path d="M16 8h-2a2 2 0 00-2 2v2h4l-.5 4H12v8h-4v-8H6v-4h2v-2a6 6 0 016-6h2v4z" fill="#fff" /></svg>
            Meta Ads
          </button>
          <button className={styles.navItem} style={{ opacity: 0.6, cursor: 'default' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={15} height={15}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            Google Ads <span className={styles.navBadge}>breve</span>
          </button>
          <span className={styles.navLabel} style={{ marginTop: 6 }}>Sistema</span>
          <button className={styles.navItem} onClick={() => router.push('/dashboard')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={15} height={15}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
            Trocar conta
          </button>
          <button className={styles.navItem} onClick={() => router.push('/utm-builder')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={15} height={15}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
            UTM Builder
          </button>
          <button className={`${styles.navItem} ${styles.navItemActive}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={15} height={15}><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 4a1.5 1.5 0 1 1-1.5 1.5A1.5 1.5 0 0 1 12 6zm3 11H9v-2h2v-4H9v-2h4v6h2z" /></svg>
            Análise IA
          </button>
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.userBlock}>
            <div className={styles.userInfo} onClick={() => router.push('/perfil')} style={{ cursor: 'pointer' }}>
              <div className={styles.userAvatar}>{(sess.user || 'NG').slice(0, 2).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div className={styles.userName}>{sess.user || 'NGP'}</div>
                <div className={styles.userRoleText}>Acesso total</div>
              </div>
            </div>
            <button className={styles.btnLogout} onClick={logout} title="Sair">⏻</button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className={styles.main}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>🤖 Análise de IA</span>
          {clientName && (
            <span className={styles.clientBadge}>👤 {clientName}</span>
          )}
        </div>

        <div className={styles.page}>

          {/* CONFIG LLM */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.ciPurple}`}>⚙️</div>
              <span className={styles.cardTitle}>Configurar LLM</span>
            </div>

            <label className={styles.fieldLabel} style={{ marginBottom: 10 }}>Provedor</label>
            <div className={styles.providerGrid}>
              {[
                { id: 'openai', icon: '🟢', name: 'OpenAI' },
                { id: 'anthropic', icon: '🟠', name: 'Claude' },
                { id: 'gemini', icon: '🔵', name: 'Gemini' },
                { id: 'custom', icon: '🔧', name: 'Custom' },
              ].map(p => (
                <div
                  key={p.id}
                  className={`${styles.providerCard} ${provider === p.id ? styles.providerSelected : ''}`}
                  onClick={() => handleProviderChange(p.id)}
                >
                  <div className={styles.pIcon}>{p.icon}</div>
                  <div className={styles.pName}>{p.name}</div>
                </div>
              ))}
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Modelo</label>
                <select className={styles.select} value={model} onChange={e => setModel(e.target.value)}>
                  {MODELS[provider].map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  Chave de API
                  <span className={styles.fieldHint}>salva localmente</span>
                </label>
                <div className={styles.keyWrap}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    className={styles.input}
                    placeholder={provider === 'openai' ? 'sk-...' : provider === 'anthropic' ? 'sk-ant-...' : provider === 'gemini' ? 'AIza...' : 'Bearer token...'}
                    value={apiKey}
                    onChange={e => handleKeyChange(e.target.value)}
                    autoComplete="off"
                  />
                  <button className={styles.keyToggle} onClick={() => setShowKey(!showKey)} type="button">👁</button>
                </div>
              </div>
            </div>

            {provider === 'custom' && (
              <div className={styles.customSection}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Endpoint URL</label>
                  <input
                    type="url"
                    className={styles.input}
                    placeholder="https://seu-llm.com/v1/chat/completions"
                    value={customEndpoint}
                    onChange={e => handleEndpointChange(e.target.value)}
                  />
                </div>
                <div className={styles.infoBox}>
                  🔧 O endpoint deve ser compatível com o formato OpenAI Chat Completions. Headers: <code>Authorization: Bearer &#123;chave&#125;</code>
                </div>
              </div>
            )}

            <div className={styles.modelBadge}>{provider} / {model}</div>
          </div>

          {/* MÉTRICAS */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.ciGreen}`}>📊</div>
              <span className={styles.cardTitle}>Métricas do cliente</span>
              <button className={styles.btnGhost} style={{ marginLeft: 'auto' }} onClick={loadMetrics}>↻ Recarregar</button>
            </div>

            <div className={styles.metricsPreview}>
              <div className={styles.metricsPreviewTitle}>Dados carregados automaticamente</div>
              {metricItems.length === 0 ? (
                <span className={styles.noMetrics}>Nenhuma métrica carregada. Selecione um cliente no dashboard primeiro.</span>
              ) : (
                <div className={styles.metricsGrid}>
                  {metricItems.map(item => (
                    <div key={item.k} className={styles.metricPill}>
                      <div className={styles.metricKey}>{item.k}</div>
                      <div className={styles.metricVal}>{item.v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.field} style={{ marginBottom: 14 }}>
              <label className={styles.fieldLabel}>
                Contexto adicional
                <span className={styles.fieldHint}>opcional</span>
              </label>
              <textarea
                className={styles.textarea}
                rows={3}
                placeholder="Ex: cliente do segmento de e-commerce, objetivo é aumentar ROAS, orçamento mensal de R$ 10.000..."
                value={extraContext}
                onChange={e => setExtraContext(e.target.value)}
              />
            </div>

            <div className={styles.field} style={{ marginBottom: 0 }}>
              <label className={styles.fieldLabel}>Tipo de análise</label>
              <select className={styles.select} value={analysisType} onChange={e => setAnalysisType(e.target.value)}>
                {ANALYSIS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {analysisType === 'custom' && (
              <div className={styles.field} style={{ marginTop: 10, marginBottom: 0 }}>
                <label className={styles.fieldLabel}>Sua pergunta</label>
                <textarea
                  className={styles.textarea}
                  rows={2}
                  placeholder="Ex: Por que o CPL subiu tanto essa semana?"
                  value={customQuestion}
                  onChange={e => setCustomQuestion(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* OUTPUT */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.ciAmber}`}>✨</div>
              <span className={styles.cardTitle}>Resposta da IA</span>
            </div>

            <div className={styles.outputBox}>
              {loading && (
                <div className={styles.outputLoading}>🤖 A IA está analisando as métricas<span className={styles.cursor} /></div>
              )}
              {!loading && error && (
                <span className={styles.outputError}>❌ Erro: {error}</span>
              )}
              {!loading && !error && output && (
                <div dangerouslySetInnerHTML={{ __html: output }} />
              )}
              {!loading && !error && !output && (
                <span className={styles.outputEmpty}>A análise aparecerá aqui após você clicar em &quot;Analisar&quot;.</span>
              )}
            </div>

            <div className={styles.btnRow}>
              <button
                className={styles.btnPrimary}
                onClick={runAnalysis}
                disabled={loading}
              >
                ✨ Analisar métricas
              </button>
              {rawOutput && !loading && (
                <>
                  <button className={styles.btnSecondary} onClick={copyOutput}>
                    {copied ? '✅ Copiado!' : '📋 Copiar resposta'}
                  </button>
                  <button className={styles.btnGhost} onClick={() => { setOutput(null); setRawOutput(''); setError('') }}>
                    🗑 Limpar
                  </button>
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
