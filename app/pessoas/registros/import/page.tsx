'use client'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import { fetchWithRetry } from '@/lib/fetch-utils'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import CustomSelect from '@/components/CustomSelect'
import { parsePontoFile, aplicarMapping, type BatidaParseada, type PontoParseResult } from '@/lib/ponto-import'
import styles from './import.module.css'

interface UsuarioOpcao { id: string; nome: string; username: string }

async function callFn(fn: string, body: object): Promise<any> {
  const s = getSession()
  if (!s) return { error: 'Sessão expirada.' }
  const res = await fetchWithRetry(
    `${SURL}/functions/v1/${fn}`,
    { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session, ...body }), cache: 'no-store' },
    2,
  )
  const text = await res.text()
  try { return text ? JSON.parse(text) : { error: 'Resposta vazia.' } }
  catch { return { error: `Erro ${res.status}.` } }
}

function ImportInner() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [usuarios, setUsuarios] = useState<UsuarioOpcao[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<PontoParseResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Step state
  const [step, setStep] = useState<'upload' | 'mapping' | 'commit' | 'done'>('upload')
  const [mapping, setMapping] = useState<Record<string, string>>({}) // nome_planilha -> usuario_id
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; errors: number } | null>(null)

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 6000)
  }

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    setIsAdmin(s.role === 'admin')
    setAuthChecked(true)
  }, [router])

  useEffect(() => {
    if (!isAdmin) return
    void (async () => {
      const resp = await callFn('pessoas-ponto-import', { action: 'listar_usuarios' })
      if (resp?.error) { showMsg('err', resp.error); return }
      setUsuarios(resp?.usuarios || [])
    })()
  }, [isAdmin])

  async function handleFilePick(file: File) {
    setFileName(file.name)
    setParsing(true)
    setParseResult(null)
    setMapping({})
    setImportResult(null)
    try {
      const res = await parsePontoFile(file)
      setParseResult(res)
      if (!res.ok) { showMsg('err', res.error || 'Falha ao ler arquivo.'); return }
      // Sugere mapping automático por nome aproximado (case-insensitive, primeira palavra)
      const auto: Record<string, string> = {}
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
      for (const nome of res.nomesUnicos) {
        const key = norm(nome)
        const exact = usuarios.find(u => norm(u.nome) === key)
        if (exact) { auto[nome] = exact.id; continue }
        const firstWordMatches = usuarios.filter(u => norm(u.nome).split(' ')[0] === key.split(' ')[0])
        if (firstWordMatches.length === 1) auto[nome] = firstWordMatches[0].id
      }
      setMapping(auto)
      setStep('mapping')
    } catch (e: any) {
      showMsg('err', e?.message || 'Erro ao ler arquivo.')
    } finally {
      setParsing(false)
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.currentTarget.value = ''
    if (file) void handleFilePick(file)
  }

  // Resumo do step Commit
  const commitSummary = useMemo(() => {
    if (!parseResult) return null
    const total = parseResult.batidas.length
    const semMapping = parseResult.batidas.filter(b => !mapping[b.nome_planilha]).length
    const ausencias = parseResult.batidas.filter(b => b.tipo_registro === 'ausencia').length
    const comHorario = total - ausencias
    return { total, semMapping, ausencias, comHorario }
  }, [parseResult, mapping])

  const usuariosOptions = useMemo(() => [
    { id: '', label: '— Ignorar (não importar) —' },
    ...usuarios.map(u => ({ id: u.id, label: u.nome, subLabel: u.username })),
  ], [usuarios])

  async function executarImport() {
    if (!parseResult) return
    const prontas = aplicarMapping(parseResult.batidas, mapping).filter(b => b.usuario_id)
    if (prontas.length === 0) {
      showMsg('err', 'Nenhuma batida com usuário mapeado.')
      return
    }
    setImporting(true)
    setImportProgress({ done: 0, total: prontas.length })
    let inserted = 0, skipped = 0, errors = 0
    const BATCH = 1000
    for (let off = 0; off < prontas.length; off += BATCH) {
      const slice = prontas.slice(off, off + BATCH).map(b => ({
        usuario_id: b.usuario_id,
        created_at_iso: b.created_at_iso,
        tipo_registro: b.tipo_registro,
        observacao: b.observacao,
      }))
      const resp = await callFn('pessoas-ponto-import', { action: 'importar', batidas: slice })
      if (resp?.error) {
        showMsg('err', `Lote ${Math.floor(off / BATCH) + 1}: ${resp.error}`)
        setImporting(false)
        return
      }
      inserted += resp.inserted || 0
      skipped += resp.skipped || 0
      errors += (resp.errors?.length || 0)
      setImportProgress({ done: off + slice.length, total: prontas.length })
    }
    setImportResult({ inserted, skipped, errors })
    setImporting(false)
    setStep('done')
  }

  function resetTudo() {
    setFileName(null); setParseResult(null); setMapping({}); setImportResult(null); setImportProgress(null); setStep('upload')
  }

  if (!authChecked) return <NGPLoading loading loadingText="Verificando acesso..." />
  if (!isAdmin) {
    return (
      <div className={styles.layout}>
        <main className={styles.main}>
          <div className={styles.center}>
            <h1 className={styles.title}>Acesso restrito</h1>
            <p className={styles.muted}>Importação de histórico de ponto disponível apenas para administradores.</p>
            <Link href="/pessoas" className={styles.btnSecondary}>Voltar</Link>
          </div>
        </main>
      </div>
    )
  }

  const Ico = ({ children }: { children: React.ReactNode }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>{children}</svg>
  )
  const sectorNav = [
    { icon: <Ico><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>, label: 'Dashboard', href: '/pessoas' },
    { icon: <Ico><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></Ico>, label: 'Registros de Ponto', href: '/pessoas/registros' },
    { icon: <Ico><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></Ico>, label: 'Importar histórico', href: '/pessoas/registros/import' },
  ]

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal sectorNav={sectorNav} sectorNavTitle="PESSOAS" />
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <Link href="/pessoas/registros" className={styles.back}>← Registros de ponto</Link>
            <h1 className={styles.title}>Importar histórico de ponto</h1>
            <p className={styles.subtitle}>Suba uma planilha (CSV ou XLSX) com batidas históricas. Cada linha = 1 dia de 1 colaborador.</p>
          </div>
          <div className={styles.stepsBar}>
            <span className={`${styles.stepDot} ${step === 'upload' ? styles.stepActive : ''}`}>1. Arquivo</span>
            <span className={`${styles.stepDot} ${step === 'mapping' ? styles.stepActive : ''}`}>2. Mapeamento</span>
            <span className={`${styles.stepDot} ${(step === 'commit' || step === 'done') ? styles.stepActive : ''}`}>3. Importar</span>
          </div>
        </header>

        {msg && (
          <div className={`${styles.toast} ${msg.type === 'ok' ? styles.toastOk : styles.toastErr}`}>{msg.text}</div>
        )}

        {step === 'upload' && (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Selecione o arquivo</h2>
            <p className={styles.muted}>Formatos aceitos: <strong>.xlsx</strong> e <strong>.csv</strong>. Cabeçalho esperado: Data, Nome (Colaborador), Entrada, Saída intervalo, Retorno intervalo, Saída.</p>
            <div className={styles.dropZone} onClick={() => fileInputRef.current?.click()}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={onFileChange}
              />
              <div className={styles.dropIcon}>📄</div>
              <div className={styles.dropMain}>{parsing ? 'Lendo arquivo...' : fileName || 'Clique para selecionar'}</div>
              <div className={styles.dropHint}>ou arraste aqui</div>
            </div>
          </section>
        )}

        {step === 'mapping' && parseResult?.ok && (
          <>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Mapeie os nomes da planilha</h2>
              <p className={styles.muted}>
                Encontrei <strong>{parseResult.nomesUnicos.length}</strong> nome(s) único(s) na planilha. Associe cada um a um colaborador cadastrado, ou ignore.
              </p>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Linhas</span>
                  <span className={styles.summaryValue}>{parseResult.totalLinhas}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Batidas detectadas</span>
                  <span className={styles.summaryValue}>{parseResult.batidas.length}</span>
                </div>
                {parseResult.periodo && (
                  <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>Período</span>
                    <span className={styles.summaryValue}>
                      {new Date(parseResult.periodo.inicio + 'T00:00:00').toLocaleDateString('pt-BR')} → {new Date(parseResult.periodo.fim + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                )}
              </div>

              <div className={styles.mappingList}>
                {parseResult.nomesUnicos.map(nome => {
                  const qtd = parseResult.batidas.filter(b => b.nome_planilha === nome).length
                  return (
                    <div key={nome} className={styles.mappingRow}>
                      <div className={styles.mappingLeft}>
                        <div className={styles.mappingNome}>{nome}</div>
                        <div className={styles.mappingHint}>{qtd} batida{qtd === 1 ? '' : 's'} na planilha</div>
                      </div>
                      <div className={styles.mappingRight}>
                        <CustomSelect
                          value={mapping[nome] || ''}
                          options={usuariosOptions}
                          onChange={(id) => setMapping(prev => ({ ...prev, [nome]: id }))}
                          placeholder="Selecionar colaborador..."
                          menuFixed
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <div className={styles.actionsRow}>
              <button className={styles.btnSecondary} onClick={resetTudo}>↺ Trocar arquivo</button>
              <button
                className={styles.btnPrimary}
                onClick={() => setStep('commit')}
                disabled={Object.values(mapping).filter(Boolean).length === 0}
              >
                Continuar → Resumo
              </button>
            </div>
          </>
        )}

        {step === 'commit' && commitSummary && parseResult && (
          <>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Pronto para importar</h2>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Total de batidas</span>
                  <span className={styles.summaryValue}>{commitSummary.total}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Com horário</span>
                  <span className={styles.summaryValue}>{commitSummary.comHorario}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Ausências (FOLGA/FERIADO/DOMINGO)</span>
                  <span className={styles.summaryValue}>{commitSummary.ausencias}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Serão ignoradas (sem mapeamento)</span>
                  <span className={`${styles.summaryValue} ${commitSummary.semMapping > 0 ? styles.summaryWarn : ''}`}>{commitSummary.semMapping}</span>
                </div>
              </div>
              <p className={styles.muted}>
                Duplicatas serão automaticamente ignoradas (mesma combinação <code>usuário + data/hora + tipo</code> não é inserida 2×).
              </p>
              {importing && importProgress && (
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }} />
                  <span className={styles.progressLabel}>{importProgress.done} / {importProgress.total}</span>
                </div>
              )}
            </section>

            <div className={styles.actionsRow}>
              <button className={styles.btnSecondary} onClick={() => setStep('mapping')} disabled={importing}>← Voltar</button>
              <button className={styles.btnPrimary} onClick={() => void executarImport()} disabled={importing}>
                {importing ? 'Importando...' : 'Importar'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && importResult && (
          <>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Importação concluída</h2>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Inseridas</span>
                  <span className={`${styles.summaryValue} ${styles.summaryOk}`}>{importResult.inserted}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Ignoradas (duplicadas)</span>
                  <span className={styles.summaryValue}>{importResult.skipped}</span>
                </div>
                {importResult.errors > 0 && (
                  <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>Erros</span>
                    <span className={`${styles.summaryValue} ${styles.summaryWarn}`}>{importResult.errors}</span>
                  </div>
                )}
              </div>
            </section>
            <div className={styles.actionsRow}>
              <button className={styles.btnSecondary} onClick={resetTudo}>Importar outro arquivo</button>
              <Link href="/pessoas/registros" className={styles.btnPrimary}>Ver registros →</Link>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default function PontoImportPage() {
  return (
    <Suspense fallback={<NGPLoading loading loadingText="Carregando..." />}>
      <ImportInner />
    </Suspense>
  )
}
