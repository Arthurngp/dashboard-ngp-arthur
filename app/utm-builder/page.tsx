'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession, clearSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import styles from './utm-builder.module.css'

interface HistoryItem { url: string; source: string; medium: string; campaign: string }

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function sanitize(v: string) {
  return v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_+.]/g, '')
}

export default function UTMBuilderPage() {
  const router = useRouter()

  const [url, setUrl]             = useState('')
  const [source, setSource]       = useState('')
  const [sourceCustom, setSourceCustom] = useState('')
  const [medium, setMedium]       = useState('')
  const [mediumCustom, setMediumCustom] = useState('')
  const [campaign, setCampaign]   = useState('')
  const [content, setContent]     = useState('')
  const [term, setTerm]           = useState('')

  const [currentURL, setCurrentURL] = useState('')
  const [urlOutput, setUrlOutput]   = useState<{html: string; empty: boolean}>({ html: 'Preencha os campos acima para gerar sua URL...', empty: true })
  const [charCount, setCharCount]   = useState(0)
  const [paramCount, setParamCount] = useState(0)
  const [score, setScore]           = useState<{label: string; good: boolean}|null>(null)
  const [urlError, setUrlError]     = useState('')
  const [toast, setToast]           = useState('')
  const [toastVisible, setToastVisible] = useState(false)
  const [history, setHistory]       = useState<HistoryItem[]>([])
  const [historyKeys] = useState(() => new Set<string>())
  const [generatedCount, setGeneratedCount] = useState(0)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
  }, [router])

  const getSourceVal = useCallback(() => source === 'custom' ? sourceCustom : source, [source, sourceCustom])
  const getMediumVal = useCallback(() => medium === 'custom' ? mediumCustom : medium, [medium, mediumCustom])

  const buildUTM = useCallback(() => {
    const srcVal = source === 'custom' ? sourceCustom : source
    const medVal = medium === 'custom' ? mediumCustom : medium

    if (!url) {
      setUrlOutput({ html: 'Preencha os campos acima para gerar sua URL...', empty: true })
      setCurrentURL(''); setCharCount(0); setParamCount(0); setScore(null); return
    }

    let baseURL: URL
    try { baseURL = new URL(url) } catch {
      setUrlOutput({ html: '⚠️ URL inválida — inclua https://', empty: true })
      setCurrentURL(''); setCharCount(0); setParamCount(0); setScore(null); return
    }

    const params = new URLSearchParams(baseURL.searchParams)
    let pc = 0
    if (srcVal)   { params.set('utm_source',   srcVal);   pc++ }
    if (medVal)   { params.set('utm_medium',   medVal);   pc++ }
    if (campaign) { params.set('utm_campaign', campaign); pc++ }
    if (content)  { params.set('utm_content',  content);  pc++ }
    if (term)     { params.set('utm_term',     term);     pc++ }

    baseURL.search = params.toString()
    const finalURL = baseURL.toString()
    setCurrentURL(finalURL)

    const [base, qs] = finalURL.split('?')
    let html = `<span class="bu">${esc(base)}</span>`
    if (qs) {
      html += '<span class="sep">?</span>'
      html += qs.split('&').map(p => {
        const [k, v] = p.split('=')
        return `<span class="pk">${esc(k)}</span><span class="sep">=</span><span class="pv">${esc(v || '')}</span>`
      }).join('<span class="sep">&amp;</span>')
    }

    setUrlOutput({ html, empty: false })
    setCharCount(finalURL.length)
    setParamCount(pc)

    if (srcVal && medVal && campaign) {
      const bad = finalURL.length > 500 || campaign.includes(' ')
      setScore({ label: bad ? 'Atenção' : 'Ótima', good: !bad })
      addToHistory(finalURL, srcVal, medVal, campaign)
    } else {
      setScore(null)
    }
  }, [url, source, sourceCustom, medium, mediumCustom, campaign, content, term])

  useEffect(() => { buildUTM() }, [buildUTM])

  function addToHistory(finalUrl: string, src: string, med: string, camp: string) {
    if (historyKeys.has(finalUrl)) return
    historyKeys.add(finalUrl)
    setGeneratedCount(c => c + 1)
    setHistory(h => [{ url: finalUrl, source: src, medium: med, campaign: camp }, ...h].slice(0, 20))
  }

  function showToast(msg: string) {
    setToast(msg); setToastVisible(true)
    setTimeout(() => setToastVisible(false), 2200)
  }

  async function copyURL() {
    if (!currentURL) return
    try {
      await navigator.clipboard.writeText(currentURL)
      showToast('✅ Copiado!')
    } catch {
      showToast('✅ Copiado!')
    }
  }

  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text) } catch {}
    showToast('✅ Copiado!')
  }

  function openURL() { if (currentURL) window.open(currentURL, '_blank') }

  function resetAll() {
    setUrl(''); setSource(''); setSourceCustom(''); setMedium(''); setMediumCustom('')
    setCampaign(''); setContent(''); setTerm('')
    setCurrentURL(''); showToast('🗑 Limpo!')
  }

  function deleteHistory(i: number) {
    setHistory(h => {
      const next = [...h]
      historyKeys.delete(next[i].url)
      next.splice(i, 1)
      return next
    })
  }

  async function doLogout() {
    if (!confirm('Deseja sair?')) return
    const s = getSession()
    if (s?.session) {
      fetch(`${SURL}/functions/v1/logout`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ token: s.session }),
      }).catch(() => {})
    }
    clearSession()
    router.replace('/login')
  }

  const sess = getSession()
  const uName = sess?.user || 'NGP'
  const uFoto = sess?.foto || ''
  const initials = uName.slice(0, 2).toUpperCase()

  return (
    <div className={styles.layout}>
      <Sidebar />

      <div className={styles.main}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>🔗 UTM Builder</span>
        </div>

        <div className={styles.page}>

          {/* URL base */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.green}`}>🌐</div>
              <span className={styles.cardTitleT}>URL de destino</span>
            </div>
            <div className={styles.field}>
              <label>URL <span className={styles.req}>*</span></label>
              <input type="url" value={url} placeholder="https://seusite.com.br/pagina"
                onChange={e => {
                  setUrl(e.target.value)
                  try { new URL(e.target.value); setUrlError('') } catch { setUrlError(e.target.value ? '⚠ URL inválida. Exemplo: https://seusite.com.br' : '') }
                }} />
              {urlError && <div className={styles.hintError}>{urlError}</div>}
            </div>
          </div>

          {/* Parâmetros UTM */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.red}`}>📊</div>
              <span className={styles.cardTitleT}>Parâmetros UTM</span>
            </div>
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <label>utm_source <span className={styles.req}>*</span><span className={styles.tip}>de onde vem o tráfego</span></label>
                <select value={source} onChange={e => { setSource(e.target.value); if (e.target.value !== 'custom') setSourceCustom('') }}>
                  <option value="">Selecionar...</option>
                  {['google','facebook','instagram','tiktok','youtube','linkedin','twitter','email','whatsapp','newsletter','sms'].map(v => <option key={v} value={v}>{v}</option>)}
                  <option value="custom">✏️ Personalizado...</option>
                </select>
                {source === 'custom' && <input type="text" value={sourceCustom} placeholder="fonte personalizada" onChange={e => setSourceCustom(e.target.value)} style={{ marginTop: 6 }} />}
              </div>

              <div className={styles.field}>
                <label>utm_medium <span className={styles.req}>*</span><span className={styles.tip}>tipo de mídia</span></label>
                <select value={medium} onChange={e => { setMedium(e.target.value); if (e.target.value !== 'custom') setMediumCustom('') }}>
                  <option value="">Selecionar...</option>
                  {['cpc','cpm','organic','social','social-paid','email','display','video','affiliate','referral','push','sms'].map(v => <option key={v} value={v}>{v}</option>)}
                  <option value="custom">✏️ Personalizado...</option>
                </select>
                {medium === 'custom' && <input type="text" value={mediumCustom} placeholder="mídia personalizada" onChange={e => setMediumCustom(e.target.value)} style={{ marginTop: 6 }} />}
              </div>

              <div className={styles.field}>
                <label>utm_campaign <span className={styles.req}>*</span><span className={styles.tip}>nome da campanha</span></label>
                <input type="text" value={campaign} placeholder="black-friday-2025" onChange={e => setCampaign(sanitize(e.target.value))} />
                <div className={styles.presets}>
                  {['black-friday-2025','lancamento-produto','remarketing','brand-awareness'].map(v => (
                    <button key={v} className={styles.presetBtn} onClick={() => setCampaign(v)}>{v.replace(/-/g, ' ')}</button>
                  ))}
                </div>
              </div>

              <div className={styles.field}>
                <label>utm_content<span className={styles.tip}>versão/criativo</span></label>
                <input type="text" value={content} placeholder="banner-topo-v1" onChange={e => setContent(sanitize(e.target.value))} />
                <div className={styles.presets}>
                  {['banner-topo','texto-link','video-30s'].map(v => (
                    <button key={v} className={styles.presetBtn} onClick={() => setContent(v)}>{v}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.divider} />
            <div className={styles.field}>
              <label>utm_term<span className={styles.tip}>palavra-chave (para buscas pagas)</span></label>
              <input type="text" value={term} placeholder="tenis+corrida+masculino" onChange={e => setTerm(sanitize(e.target.value))} />
            </div>
          </div>

          {/* Output */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.blue}`}>⚡</div>
              <span className={styles.cardTitleT}>URL Final Gerada</span>
            </div>
            <div className={`${styles.urlDisplay} ${!urlOutput.empty ? styles.hasUrl : ''}`}>
              {urlOutput.empty
                ? <div className={styles.urlEmpty}>{urlOutput.html}</div>
                : <div className={styles.urlText} dangerouslySetInnerHTML={{ __html: urlOutput.html }} />}
            </div>
            <div className={styles.charRow}>
              <div className={styles.charCount}>Comprimento: <span>{charCount}</span> caracteres</div>
              {score && (
                <span className={`${styles.scoreBadge} ${score.good ? styles.scoreGood : styles.scoreMedium}`}>
                  ● {score.label}
                </span>
              )}
            </div>
            <div className={styles.actions}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={copyURL}>📋 Copiar URL</button>
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={openURL}>↗ Abrir URL</button>
              <button className={`${styles.btn} ${styles.btnGhost}`} onClick={resetAll} title="Limpar tudo">🗑</button>
            </div>
            <div className={styles.statsRow}>
              <div className={styles.stat}><div className={styles.statVal}>{paramCount}</div><div className={styles.statLabel}>Parâmetros</div></div>
              <div className={styles.stat}><div className={styles.statVal}>{charCount}</div><div className={styles.statLabel}>Caracteres</div></div>
              <div className={styles.stat}><div className={styles.statVal}>{generatedCount}</div><div className={styles.statLabel}>Geradas</div></div>
            </div>
          </div>

          {/* Histórico */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`${styles.cardIcon} ${styles.green}`}>🕐</div>
              <span className={styles.cardTitleT}>Histórico da sessão</span>
            </div>
            <div className={styles.historyList}>
              {history.length === 0
                ? <div className={styles.emptyH}>Nenhuma URL gerada ainda</div>
                : history.map((item, i) => (
                  <div key={i} className={styles.historyItem}>
                    <div className={styles.hm}>
                      <div className={styles.hs}>{item.source} / {item.medium} — {item.campaign}</div>
                      <div className={styles.hu}>{item.url}</div>
                    </div>
                    <button className={`${styles.hbtn}`} onClick={() => copyText(item.url)} title="Copiar">📋</button>
                    <button className={`${styles.hbtn}`} onClick={() => deleteHistory(i)} title="Remover">✕</button>
                  </div>
                ))
              }
            </div>
          </div>

        </div>
      </div>

      <div className={`${styles.toast} ${toastVisible ? styles.toastShow : ''}`}>{toast}</div>
    </div>
  )
}
