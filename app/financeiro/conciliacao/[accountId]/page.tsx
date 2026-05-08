'use client'
import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import { fetchWithRetry } from '@/lib/fetch-utils'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import FinanceiroAuthModal from '@/components/FinanceiroAuthModal'
import {
  parseImportCsvContent,
  summarizeImportRows,
  fmtBRL,
  fmtDate,
  type ImportedCsvRow,
  type AiDuplicateMatch,
  type DupAction,
  type DupActionState,
  type ImportPreviewData,
} from '@/lib/financeiro-import'
import { financeiroNav } from '../../financeiro-nav'
import styles from '../../financeiro.module.css'

interface FinAccount {
  id: string
  nome: string
  tipo: string
  saldo_inicial: number
  saldo_atual: number
}

interface FinCategoria { id: string; nome: string; tipo: string }
interface FinContato { id: string; nome: string }

interface RowOverride {
  tipo?: 'entrada' | 'saida' | 'transferencia'
  contato?: string
  categoria?: string
}

function ConciliacaoInner() {
  const router = useRouter()
  const params = useParams<{ accountId: string }>()
  const accountId = params?.accountId

  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [account, setAccount] = useState<FinAccount | null>(null)
  const [loadingAccount, setLoadingAccount] = useState(true)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [importPreview, setImportPreview] = useState<ImportPreviewData | null>(null)
  const [importPreviewLoading, setImportPreviewLoading] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [importDupActions, setImportDupActions] = useState<Map<number, DupActionState>>(new Map())

  const [categorias, setCategorias] = useState<FinCategoria[]>([])
  const [clientes, setClientes] = useState<FinContato[]>([])
  const [fornecedores, setFornecedores] = useState<FinContato[]>([])
  const [allAccounts, setAllAccounts] = useState<FinAccount[]>([])
  const [rowOverrides, setRowOverrides] = useState<Map<number, RowOverride>>(new Map())
  const [openTipoMenuIdx, setOpenTipoMenuIdx] = useState<number | null>(null)

  const [searchModalIdx, setSearchModalIdx] = useState<number | null>(null)
  const [searchAccountId, setSearchAccountId] = useState<string | null>(null)
  const [searchDateStart, setSearchDateStart] = useState('')
  const [searchDateEnd, setSearchDateEnd] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [manualCombines, setManualCombines] = useState<Map<number, { existing_id: string; existing_descricao: string; existing_account_name: string }>>(new Map())

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const abortRefs = useRef<Record<string, AbortController>>({})

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const callFn = useCallback(async (fn: string, body: object) => {
    const s = getSession()
    if (!s) return { error: 'Sessão expirada. Faça login novamente.' }
    const action = String((body as { action?: unknown }).action || '')
    const entity = String((body as { entity?: unknown }).entity || '')
    // Ações com efeito colateral não devem ser canceladas/retentadas: importar_csv, combinar_transacao, criar/atualizar/excluir, importar_csv etc.
    const isMutating = /^(criar|atualizar|excluir|importar|combinar|conciliar|toggle|arquivar|restaurar|salvar|update|delete|insert)/i.test(action)
    const requestKey = [fn, entity, action].join(':')
    if (!isMutating) abortRefs.current[requestKey]?.abort()
    const controller = new AbortController()
    abortRefs.current[requestKey] = controller
    const signal = controller.signal
    try {
      const res = await fetchWithRetry(
        `${SURL}/functions/v1/${fn}`,
        { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session, ...body }), signal, cache: 'no-store' },
        isMutating ? 1 : 3,
      )
      const text = await res.text()
      let data: any = null
      try { data = text ? JSON.parse(text) : null }
      catch { return { error: `Resposta inválida do servidor (status ${res.status}).` } }
      if (!data) {
        return { error: res.ok ? 'O servidor não respondeu (resposta vazia). Verifique se a operação foi salva antes de tentar novamente.' : `Erro do servidor (status ${res.status}).` }
      }
      if (!res.ok && !data?.error) return { error: `Erro do servidor (status ${res.status}).` }
      return data
    } catch (e: any) {
      if (e?.name === 'AbortError') return { error: 'Operação cancelada.' }
      const msg = String(e?.message || '').toLowerCase()
      if (msg.includes('timeout') || msg.includes('timed out')) {
        return { error: 'A operação demorou demais. Verifique no banco/lista se foi salva antes de tentar novamente.' }
      }
      return { error: 'Erro de conexão. Verifique sua internet e tente novamente.' }
    } finally {
      if (abortRefs.current[requestKey] === controller) delete abortRefs.current[requestKey]
    }
  }, [])

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/setores'); return }
    const flag = sessionStorage.getItem('fin_auth_ok')
    setAuthorized(flag === '1')
    setAuthChecked(true)
  }, [router])

  useEffect(() => {
    if (!authorized || !accountId) return
    let cancel = false
    ;(async () => {
      setLoadingAccount(true)
      const accountsRes = await callFn('financeiro-aux', { entity: 'accounts', action: 'listar' })
      if (cancel) return
      const archivedRes = await callFn('financeiro-aux', { entity: 'accounts', action: 'listar', show_archived: true })
      if (cancel) return
      const [catsRes, cliRes, fornRes] = await Promise.all([
        callFn('financeiro-categorias', { action: 'listar' }),
        callFn('financeiro-clientes', { action: 'listar' }),
        callFn('financeiro-fornecedores', { action: 'listar' }),
      ])
      if (cancel) return
      if (accountsRes?.error) showMsg('err', `Erro ao carregar contas: ${accountsRes.error}`)
      const activeAccs = (accountsRes?.accounts || []) as FinAccount[]
      const archivedAccs = (archivedRes?.accounts || []) as FinAccount[]
      const allAccs = [...activeAccs, ...archivedAccs]
      console.log('[conciliacao] contas carregadas', { ativas: activeAccs.length, arquivadas: archivedAccs.length, accountId, found: allAccs.find(a => a.id === accountId) })
      setAllAccounts(allAccs)
      const found = allAccs.find((a: FinAccount) => a.id === accountId) || null
      setAccount(found)
      setCategorias(catsRes?.categorias || [])
      setClientes(cliRes?.clientes || [])
      setFornecedores(fornRes?.fornecedores || [])
      setLoadingAccount(false)
      if (!found) showMsg('err', 'Carteira/banco não encontrado.')
    })()
    return () => { cancel = true }
  }, [authorized, accountId, callFn])

  function triggerCsvPicker() {
    fileInputRef.current?.click()
  }

  async function handleCsvFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.currentTarget.value = ''
    if (!file || !accountId) return

    const text = await file.text()
    const rows = parseImportCsvContent(text)
    if (rows.length === 0) {
      showMsg('err', 'Nenhuma linha válida encontrada no CSV.')
      return
    }

    setImportPreviewLoading(true)
    try {
      const analysis = await callFn('financeiro-transacoes', {
        action: 'analisar_importacao_csv',
        account_id: accountId,
        rows,
      })
      if (!analysis || analysis.error) {
        showMsg('err', analysis?.error || 'A análise do CSV não retornou. Tente novamente.')
        return
      }
      setImportPreview({
        accountId,
        accountName: account?.nome || 'Conta',
        fileName: file.name,
        rows,
        analysis,
      })
      const dups: AiDuplicateMatch[] = analysis?.potential_duplicates || []
      const actionsMap = new Map<number, DupActionState>()
      for (const d of dups) {
        const reason = (d.reason || '').toUpperCase()
        const isInternalTransfer = reason.includes('TRANSFERÊNCIA INTERNA') || reason.includes('TRANSFERENCIA INTERNA')
        actionsMap.set(d.csv_index, { action: isInternalTransfer ? 'transfer' : 'pending' })
      }
      setImportDupActions(actionsMap)
    } finally {
      setImportPreviewLoading(false)
    }
  }

  function setDupAction(csvIndex: number, action: DupAction, chosenStatus?: 'confirmado' | 'pendente') {
    setImportDupActions(prev => {
      const next = new Map(prev)
      next.set(csvIndex, { action, chosenStatus })
      return next
    })
  }

  function openSearchModal(idx: number) {
    if (!importPreview) return
    const row = importPreview.rows[idx]
    if (!row) return
    setSearchModalIdx(idx)
    setSearchAccountId(accountId || null)
    const base = new Date(row.competence_date)
    const start = new Date(base); start.setDate(start.getDate() - 30)
    const end = new Date(base); end.setDate(end.getDate() + 30)
    setSearchDateStart(start.toISOString().split('T')[0])
    setSearchDateEnd(end.toISOString().split('T')[0])
    setSearchQuery('')
    setSearchResults([])
    void runSearch(idx, accountId || null, start.toISOString().split('T')[0], end.toISOString().split('T')[0], '', row.valor)
  }

  async function runSearch(idx: number, accId: string | null, dStart: string, dEnd: string, query: string, valor?: number) {
    if (!importPreview) return
    setSearchLoading(true)
    try {
      const row = importPreview.rows[idx]
      const data = await callFn('financeiro-transacoes', {
        action: 'buscar_para_conciliar',
        valor: valor ?? row?.valor,
        valor_tolerance: 0.05,
        date_start: dStart || undefined,
        date_end: dEnd || undefined,
        account_id: accId || undefined,
        descricao_query: query || undefined,
        limit: 50,
      })
      if (!data || data.error) {
        showMsg('err', data?.error || 'A busca não retornou resposta.')
        return
      }
      setSearchResults(data?.transacoes || [])
    } finally {
      setSearchLoading(false)
    }
  }

  async function confirmManualConcile(existingId: string, existingDesc: string, existingAccountName: string) {
    if (searchModalIdx === null || !importPreview) return
    const idx = searchModalIdx
    const csvRow = importPreview.rows[idx]
    if (!csvRow) return
    setSearchLoading(true)
    try {
      const res = await callFn('financeiro-transacoes', {
        action: 'combinar_transacao',
        existing_id: existingId,
        chosen_status: csvRow.status || 'confirmado',
        csv_payment_date: csvRow.payment_date,
      })
      if (!res || res.error) {
        showMsg('err', res?.error || 'Não foi possível concluir a conciliação manual.')
        return
      }
      setManualCombines(prev => {
        const next = new Map(prev)
        next.set(idx, { existing_id: existingId, existing_descricao: existingDesc, existing_account_name: existingAccountName })
        return next
      })
      setSearchModalIdx(null)
      showMsg('ok', 'Lançamento conciliado manualmente.')
    } finally {
      setSearchLoading(false)
    }
  }

  async function confirmImport() {
    if (!importPreview) return
    const pendingDups = Array.from(importDupActions.values()).filter(a => a.action === 'pending')
    if (pendingDups.length > 0) {
      showMsg('err', `Resolva ${pendingDups.length} duplicata${pendingDups.length > 1 ? 's' : ''} antes de importar.`)
      return
    }

    setImportPreviewLoading(true)
    const duplicates = importPreview.analysis?.potential_duplicates || []

    try {
      let combined = 0
      for (const dup of duplicates) {
        const dupAction = importDupActions.get(dup.csv_index)
        if (dupAction?.action !== 'combine') continue
        const csvRow = importPreview.rows[dup.csv_index]
        const res = await callFn('financeiro-transacoes', {
          action: 'combinar_transacao',
          existing_id: dup.existing_id,
          chosen_status: dupAction.chosenStatus || dup.existing_status,
          csv_payment_date: csvRow?.payment_date,
        })
        if (!res || res.error) {
          const msg = res?.error || 'Combinação não retornou resposta do servidor.'
          showMsg('err', `Combinar duplicata ${dup.csv_index + 1}: ${msg}`)
          return
        }
        combined++
      }

      const combineIndices = new Set(
        duplicates.filter(d => importDupActions.get(d.csv_index)?.action === 'combine').map(d => d.csv_index)
      )
      const transferIndices = new Set(
        duplicates.filter(d => importDupActions.get(d.csv_index)?.action === 'transfer').map(d => d.csv_index)
      )
      const rowsToImport = importPreview.rows
        .map((row, i) => {
          if (transferIndices.has(i)) return { ...row, tipo: 'transferencia' as const }
          const ov = rowOverrides.get(i)
          if (!ov) return row
          return {
            ...row,
            ...(ov.tipo ? { tipo: ov.tipo } : {}),
            ...(ov.contato !== undefined ? { contato: ov.contato || null } : {}),
            ...(ov.categoria !== undefined ? { categoria: ov.categoria || null } : {}),
          }
        })
        .filter((_, i) => !combineIndices.has(i) && !manualCombines.has(i))

      const BATCH_SIZE = 500
      const totalBatches = Math.ceil(rowsToImport.length / BATCH_SIZE)
      setImportProgress({ done: 0, total: rowsToImport.length })
      let totalImported = 0
      let totalSkipped = 0

      for (let i = 0; i < totalBatches; i++) {
        const batch = rowsToImport.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
        const data = await callFn('financeiro-transacoes', {
          action: 'importar_csv',
          account_id: importPreview.accountId || undefined,
          rows: batch,
        })
        if (!data || data.error) {
          const msg = data?.error || 'A importação não retornou resposta. Verifique a lista antes de tentar de novo para evitar duplicatas.'
          showMsg('err', `Lote ${i + 1}/${totalBatches}: ${msg}`)
          return
        }
        if (typeof data.imported !== 'number') {
          showMsg('err', `Lote ${i + 1}/${totalBatches}: resposta sem contagem de importados. Verifique a lista antes de repetir.`)
          return
        }
        totalImported += data.imported
        totalSkipped += (typeof data.skipped === 'number' ? data.skipped : 0)
        setImportProgress({ done: Math.min((i + 1) * BATCH_SIZE, rowsToImport.length), total: rowsToImport.length })
      }

      const transferCount = transferIndices.size
      const totalCombined = combined + manualCombines.size
      const parts = [`${totalImported} importados`]
      if (totalCombined > 0) parts.push(`${totalCombined} combinados`)
      if (transferCount > 0) parts.push(`${transferCount} como transferência`)
      if (totalSkipped > 0) parts.push(`${totalSkipped} ignorados`)
      const houveAcao = totalImported + totalCombined + transferCount > 0
      if (houveAcao) {
        showMsg('ok', `Importação concluída: ${parts.join(', ')}.`)
      } else {
        showMsg('err', `Nenhum lançamento foi salvo no banco. Detalhes: ${parts.join(', ')}. Verifique se o CSV tem datas, descrições e valores válidos.`)
        return
      }

      setImportPreview(null)
      setImportDupActions(new Map())
      setRowOverrides(new Map())
      setManualCombines(new Map())
      setTimeout(() => router.push(`/financeiro?account=${accountId}`), 1200)
    } finally {
      setImportPreviewLoading(false)
      setImportProgress(null)
    }
  }

  const summary = importPreview ? summarizeImportRows(importPreview.rows) : null
  const dups = importPreview?.analysis?.potential_duplicates || []
  const dupByIdx = new Map<number, AiDuplicateMatch>()
  for (const d of dups) dupByIdx.set(d.csv_index, d)
  const totalDups = dups.length
  const pendingDupsCount = dups.filter(d => (importDupActions.get(d.csv_index)?.action || 'pending') === 'pending').length
  const totalRows = importPreview?.rows.length || 0
  const unidentifiedCount = totalRows - dups.length

  if (!authChecked) return <NGPLoading loading loadingText="Carregando…" />

  return (
    <div className={styles.layout}>
      <Sidebar minimal sectorNavTitle="FINANCEIRO" sectorNav={financeiroNav} />
      <main className={styles.main}>
        <div className={styles.header}>
          <div>
            <button
              type="button"
              onClick={() => router.push('/financeiro?tab=contas')}
              style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 8 }}
            >
              ← Voltar para Carteiras e Bancos
            </button>
            <h1 className={styles.title}>
              Conciliação · {account?.nome || (loadingAccount ? '…' : 'Carteira não encontrada')}
            </h1>
            <p className={styles.subtitle}>
              Importe um extrato CSV deste banco e revise as conciliações antes de salvar.
            </p>
          </div>
        </div>

        {msg && (
          <div className={msg.type === 'ok' ? styles.msgOk : styles.msgErr}>
            {msg.text}
          </div>
        )}

        {!authorized && (
          <FinanceiroAuthModal
            onSuccess={() => setAuthorized(true)}
            onClose={() => router.push('/financeiro?tab=contas')}
          />
        )}

        {authorized && account && !importPreview && (
          <div className={styles.importPreviewBlock} style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📥</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              Selecione o extrato CSV de {account.nome}
            </div>
            <div style={{ color: '#6b7280', marginBottom: 24, maxWidth: 480, margin: '0 auto 24px' }}>
              A IA vai analisar o arquivo, detectar duplicatas com lançamentos já registrados e sugerir conciliações.
              Tudo aqui fica restrito a esta carteira/banco.
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFileChange}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className={styles.btnSave}
              onClick={triggerCsvPicker}
              disabled={importPreviewLoading}
            >
              {importPreviewLoading ? 'Analisando…' : 'Selecionar arquivo CSV'}
            </button>
          </div>
        )}

        {importPreviewLoading && !importPreview && (
          <div className={styles.formOverlay}>
            <div className={styles.aiLoadingCard}>
              <div className={styles.aiLoadingTitle}>🤖 IA analisando seu CSV…</div>
              <div className={styles.aiLoadingSubtitle}>
                Comparando os lançamentos do arquivo com os existentes no banco.
              </div>
              <div className={styles.aiLoadingHint}>
                Isso pode levar até 30 segundos para CSVs grandes.
              </div>
            </div>
          </div>
        )}

        {importPreview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className={styles.importPreviewHeader}>
              <div>
                <div className={styles.importPreviewFile}>{importPreview.fileName}</div>
                <div className={styles.importPreviewMeta}>Conta de destino: {importPreview.accountName}</div>
              </div>
              <div className={styles.importPreviewRows}>{totalRows} linhas válidas</div>
            </div>

            <div className={styles.importTopBar}>
              <div className={styles.importTopKpis}>
                <div className={styles.importTopKpi}>
                  <span className={styles.importTopKpiLabel}>Entradas</span>
                  <strong className={styles.importTopKpiValue}>{summary?.entradas || 0}</strong>
                  <small>{fmtBRL(summary?.total_entradas || 0)}</small>
                </div>
                <div className={styles.importTopKpiDivider} />
                <div className={styles.importTopKpi}>
                  <span className={styles.importTopKpiLabel}>Saídas</span>
                  <strong className={styles.importTopKpiValue}>{fmtBRL(summary?.total_saidas || 0)}</strong>
                  <small>{summary?.saidas || 0} lançamentos</small>
                </div>
                <div className={styles.importTopKpiDivider} />
                <div className={styles.importTopKpi}>
                  <span className={styles.importTopKpiLabel}>Duplicatas detectadas</span>
                  <strong className={`${styles.importTopKpiValue} ${pendingDupsCount > 0 ? styles.importTopKpiValueWarn : styles.importTopKpiValueOk}`}>
                    {totalDups}
                  </strong>
                  <small>{pendingDupsCount} pendente{pendingDupsCount !== 1 ? 's' : ''}</small>
                </div>
                <div className={styles.importTopKpiDivider} />
                <div className={styles.importTopKpi}>
                  <span className={styles.importTopKpiLabel}>Não identificados</span>
                  <strong className={styles.importTopKpiValue}>{unidentifiedCount}</strong>
                  <small>serão criados como novos</small>
                </div>
              </div>
            </div>

            {totalDups > 0 && (
              <div className={styles.importPreviewBlock}>
                <div className={styles.dupSplitHeader}>
                  <div>
                    <div className={styles.dupSplitTitle}>🔀 Duplicatas detectadas</div>
                    <div className={styles.dupSplitSubtitle}>
                      {totalDups} possível{totalDups !== 1 ? 'is' : ''} duplicata{totalDups !== 1 ? 's' : ''} ·{' '}
                      <strong style={{ color: pendingDupsCount > 0 ? '#ea580c' : '#16a34a' }}>
                        {pendingDupsCount} pendente{pendingDupsCount !== 1 ? 's' : ''}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className={styles.dupSplitList}>
                  {dups.map(dup => {
                    const csvRow = importPreview.rows[dup.csv_index]
                    if (!csvRow) return null
                    const dupState = importDupActions.get(dup.csv_index) || { action: 'pending' as DupAction }
                    const csvStatus = csvRow.status || 'pendente'
                    const existStatus = dup.existing_status
                    const rowClass = dupState.action === 'combine'
                      ? styles.dupSplitRowCombine
                      : dupState.action === 'import'
                        ? styles.dupSplitRowImport
                        : dupState.action === 'transfer'
                          ? styles.dupSplitRowTransfer
                          : ''
                    return (
                      <div key={dup.csv_index} className={`${styles.dupSplitRow} ${rowClass}`}>
                        <div className={styles.dupSplitCellExisting}>
                          <div className={styles.dupSplitCellMain}>{dup.existing_descricao}</div>
                          <div className={styles.dupSplitCellMeta}>
                            <span>📅 {fmtDate(dup.existing_date)}</span>
                            <span className={styles.dupSplitCellValor}>{fmtBRL(dup.existing_valor)}</span>
                            {dup.existing_tipo && (
                              <span className={`${styles.tipoBadge} ${dup.existing_tipo === 'entrada' ? styles.tipoEntrada : dup.existing_tipo === 'transferencia' ? styles.statusConfirmado : styles.tipoSaida}`}>
                                {dup.existing_tipo === 'entrada' ? 'Entrada' : dup.existing_tipo === 'transferencia' ? 'Transferência' : 'Saída'}
                              </span>
                            )}
                            <span className={existStatus === 'confirmado' ? styles.dupSplitTagPaid : styles.dupSplitTagPending}>
                              {existStatus === 'confirmado' ? '✓ Pago' : '⏳ Pendente'}
                            </span>
                          </div>
                          {dup.existing_contato && (
                            <div className={styles.dupSplitCellContact}>👤 {dup.existing_contato}</div>
                          )}
                        </div>

                        <div className={styles.dupSplitCellMatch}>
                          <span className={`${styles.dupSplitConfidence} ${styles[`dupSplitConfidence_${dup.confidence}`]}`}>
                            {dup.confidence === 'high' ? '⬤ Alta' : dup.confidence === 'medium' ? '⬤ Média' : '⬤ Baixa'}
                          </span>
                          <div className={styles.dupSplitArrows}>⇆</div>
                          <div className={styles.dupSplitReason} title={dup.reason}>{dup.reason}</div>
                        </div>

                        <div className={styles.dupSplitCellCsv}>
                          <div className={styles.dupSplitCellMain}>{csvRow.descricao || '—'}</div>
                          <div className={styles.dupSplitCellMeta}>
                            <span>📅 {fmtDate(csvRow.competence_date)}</span>
                            <span className={styles.dupSplitCellValor}>{fmtBRL(csvRow.valor)}</span>
                            {csvRow.tipo && (
                              <span className={`${styles.tipoBadge} ${csvRow.tipo === 'entrada' ? styles.tipoEntrada : csvRow.tipo === 'transferencia' ? styles.statusConfirmado : styles.tipoSaida}`}>
                                {csvRow.tipo === 'entrada' ? 'Entrada' : csvRow.tipo === 'transferencia' ? 'Transferência' : 'Saída'}
                              </span>
                            )}
                            <span className={csvStatus === 'confirmado' ? styles.dupSplitTagPaid : styles.dupSplitTagPending}>
                              {csvStatus === 'confirmado' ? '✓ Pago' : '⏳ Pendente'}
                            </span>
                          </div>
                          {csvRow.contato && (
                            <div className={styles.dupSplitCellContact}>👤 {csvRow.contato}</div>
                          )}
                        </div>

                        <div className={styles.dupSplitCellActions}>
                          <button
                            type="button"
                            className={`${styles.dupSplitBtn} ${styles.dupSplitBtnCombine} ${dupState.action === 'combine' ? styles.dupSplitBtnActive : ''}`}
                            onClick={() => setDupAction(dup.csv_index, 'combine', csvStatus as 'confirmado' | 'pendente')}
                          >
                            🔗 Combinar
                          </button>
                          <button
                            type="button"
                            className={`${styles.dupSplitBtn} ${styles.dupSplitBtnImport} ${dupState.action === 'import' ? styles.dupSplitBtnActive : ''}`}
                            onClick={() => setDupAction(dup.csv_index, 'import')}
                          >
                            ➕ Separado
                          </button>
                          <button
                            type="button"
                            className={`${styles.dupSplitBtn} ${styles.dupSplitBtnTransfer} ${dupState.action === 'transfer' ? styles.dupSplitBtnActive : ''}`}
                            onClick={() => setDupAction(dup.csv_index, 'transfer')}
                          >
                            🔄 Transferência
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {unidentifiedCount > 0 && (
              <div className={styles.importPreviewBlock}>
                <div className={styles.dupSplitHeader}>
                  <div>
                    <div className={styles.dupSplitTitle}>📋 {unidentifiedCount} lançamento{unidentifiedCount !== 1 ? 's' : ''} não identificado{unidentifiedCount !== 1 ? 's' : ''}</div>
                    <div className={styles.dupSplitSubtitle}>
                      Sem correspondência no banco. Confirme o tipo e o contato antes de criar.
                    </div>
                  </div>
                </div>

                <div className={styles.dupSplitList}>
                  {importPreview.rows.map((row, idx) => {
                    if (dupByIdx.has(idx)) return null
                    const csvStatus = row.status || 'pendente'
                    const ov = rowOverrides.get(idx) || {}
                    const effectiveTipo = ov.tipo || row.tipo
                    const effectiveContato = ov.contato !== undefined ? ov.contato : (row.contato || '')
                    const effectiveCategoria = ov.categoria !== undefined ? ov.categoria : (row.categoria || '')
                    const altOptions: ('entrada' | 'saida' | 'transferencia')[] = effectiveTipo === 'entrada'
                      ? ['saida', 'transferencia']
                      : effectiveTipo === 'saida'
                        ? ['entrada', 'transferencia']
                        : ['entrada', 'saida']
                    const tipoLabel = (t: string) => t === 'entrada' ? 'Entrada' : t === 'saida' ? 'Saída' : 'Transferência'
                    const manualMatch = manualCombines.get(idx)

                    return (
                      <div key={idx} className={`${styles.dupSplitRow} ${manualMatch ? styles.dupSplitRowCombine : styles.dupSplitRowClean}`}>
                        <div className={styles.dupSplitCellCsv}>
                          <div className={styles.dupSplitCellMain}>{row.descricao || '—'}</div>
                          <div className={styles.dupSplitCellMeta}>
                            <span>📅 {fmtDate(row.competence_date)}</span>
                            <span className={styles.dupSplitCellValor}>{fmtBRL(row.valor)}</span>
                            <span className={`${styles.tipoBadge} ${effectiveTipo === 'entrada' ? styles.tipoEntrada : effectiveTipo === 'transferencia' ? styles.statusConfirmado : styles.tipoSaida}`}>
                              {tipoLabel(effectiveTipo)}
                              {ov.tipo && ov.tipo !== row.tipo && <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.7 }}>(editado)</span>}
                            </span>
                            <span className={csvStatus === 'confirmado' ? styles.dupSplitTagPaid : styles.dupSplitTagPending}>
                              {csvStatus === 'confirmado' ? '✓ Pago' : '⏳ Pendente'}
                            </span>
                          </div>
                        </div>

                        <div className={styles.dupSplitCellMatchClean}>
                          {manualMatch ? (
                            <>
                              <span className={styles.dupSplitTagNew} style={{ background: '#ecfdf5', color: '#059669' }}>🔗 Conciliado manualmente</span>
                              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                                com “{manualMatch.existing_descricao}”
                                {manualMatch.existing_account_name && ` em ${manualMatch.existing_account_name}`}
                              </div>
                              <button
                                type="button"
                                onClick={() => setManualCombines(prev => {
                                  const next = new Map(prev)
                                  next.delete(idx)
                                  return next
                                })}
                                style={{ marginTop: 6, fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                              >
                                ↩ desfazer conciliação
                              </button>
                            </>
                          ) : (
                            <>
                              <span className={styles.dupSplitTagNew}>✓ Novo</span>
                              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Será criado neste banco</div>
                            </>
                          )}
                        </div>

                        <div className={styles.dupSplitCellExisting} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <input
                            list={effectiveTipo === 'entrada' ? 'concil-clientes' : 'concil-fornecedores'}
                            type="text"
                            placeholder={effectiveTipo === 'entrada' ? '👤 Cliente (recebimento de…)' : '👤 Fornecedor (pago para…)'}
                            value={effectiveContato}
                            onChange={e => setRowOverrides(prev => {
                              const next = new Map(prev)
                              next.set(idx, { ...(next.get(idx) || {}), contato: e.target.value })
                              return next
                            })}
                            style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6 }}
                          />
                          <input
                            list="concil-categorias"
                            type="text"
                            placeholder="🏷 Categoria"
                            value={effectiveCategoria}
                            onChange={e => setRowOverrides(prev => {
                              const next = new Map(prev)
                              next.set(idx, { ...(next.get(idx) || {}), categoria: e.target.value })
                              return next
                            })}
                            style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6 }}
                          />
                        </div>

                        <div className={styles.dupSplitCellActions} style={{ position: 'relative' }}>
                          {!manualMatch && (
                            <button
                              type="button"
                              className={`${styles.dupSplitBtn} ${styles.dupSplitBtnCombine}`}
                              onClick={() => openSearchModal(idx)}
                              title="Buscar lançamento existente para conciliar manualmente"
                            >
                              🔍 Buscar
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${styles.dupSplitBtn} ${styles.dupSplitBtnImport}`}
                            onClick={() => setOpenTipoMenuIdx(openTipoMenuIdx === idx ? null : idx)}
                            title="Adicionar como tipo diferente"
                            disabled={!!manualMatch}
                            style={manualMatch ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                          >
                            + Adicionar como…
                          </button>
                          {openTipoMenuIdx === idx && (
                            <>
                              <div
                                style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                                onClick={() => setOpenTipoMenuIdx(null)}
                              />
                              <div style={{
                                position: 'absolute',
                                top: '100%',
                                right: 0,
                                marginTop: 4,
                                background: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: 8,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                zIndex: 100,
                                minWidth: 160,
                              }}>
                                {altOptions.map(opt => (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => {
                                      setRowOverrides(prev => {
                                        const next = new Map(prev)
                                        next.set(idx, { ...(next.get(idx) || {}), tipo: opt })
                                        return next
                                      })
                                      setOpenTipoMenuIdx(null)
                                    }}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      padding: '8px 12px',
                                      textAlign: 'left',
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      fontSize: 13,
                                    }}
                                    onMouseEnter={e => { (e.target as HTMLElement).style.background = '#f3f4f6' }}
                                    onMouseLeave={e => { (e.target as HTMLElement).style.background = 'none' }}
                                  >
                                    {opt === 'entrada' ? '⬆ Entrada' : opt === 'saida' ? '⬇ Saída' : '↔ Transferência'}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                          {ov.tipo && (
                            <button
                              type="button"
                              onClick={() => setRowOverrides(prev => {
                                const next = new Map(prev)
                                const cur = next.get(idx)
                                if (cur) {
                                  const { tipo, ...rest } = cur
                                  if (Object.keys(rest).length === 0) next.delete(idx)
                                  else next.set(idx, rest)
                                }
                                return next
                              })}
                              style={{ marginTop: 4, fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                            >
                              ↩ desfazer tipo
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <datalist id="concil-clientes">
                  {clientes.map(c => <option key={c.id} value={c.nome} />)}
                </datalist>
                <datalist id="concil-fornecedores">
                  {fornecedores.map(f => <option key={f.id} value={f.nome} />)}
                </datalist>
                <datalist id="concil-categorias">
                  {categorias.map(c => <option key={c.id} value={c.nome} />)}
                </datalist>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
              <button
                type="button"
                className={styles.btnCancelForm}
                disabled={importPreviewLoading}
                onClick={() => { setImportPreview(null); setImportDupActions(new Map()); setRowOverrides(new Map()); setManualCombines(new Map()) }}
              >
                Cancelar e escolher outro arquivo
              </button>
              <button
                type="button"
                className={styles.btnSave}
                disabled={importPreviewLoading || pendingDupsCount > 0}
                onClick={confirmImport}
              >
                {importPreviewLoading
                  ? (importProgress ? `Importando ${importProgress.done}/${importProgress.total}…` : 'Processando…')
                  : pendingDupsCount > 0
                    ? `Resolva ${pendingDupsCount} duplicata${pendingDupsCount > 1 ? 's' : ''} para importar`
                    : 'Importar agora'}
              </button>
            </div>
          </div>
        )}

        {searchModalIdx !== null && importPreview && (() => {
          const csvRow = importPreview.rows[searchModalIdx]
          if (!csvRow) return null
          return (
            <div className={styles.formOverlay} onClick={() => !searchLoading && setSearchModalIdx(null)}>
              <div
                className={styles.formModal}
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: 900, width: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
              >
                <div className={styles.formTitle}>
                  🔍 Buscar lançamento para conciliar
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                  Procurando uma correspondência para: <strong>{csvRow.descricao}</strong> · {fmtBRL(csvRow.valor)} · {fmtDate(csvRow.competence_date)}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Conta / Banco</label>
                    <select
                      value={searchAccountId || ''}
                      onChange={e => setSearchAccountId(e.target.value || null)}
                      style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }}
                    >
                      <option value="">Todas as contas</option>
                      {allAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.nome}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>De</label>
                    <input
                      type="date"
                      value={searchDateStart}
                      onChange={e => setSearchDateStart(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Até</label>
                    <input
                      type="date"
                      value={searchDateEnd}
                      onChange={e => setSearchDateEnd(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>Buscar na descrição</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void runSearch(searchModalIdx, searchAccountId, searchDateStart, searchDateEnd, searchQuery, csvRow.valor) }}
                        placeholder="Ex: Montagem"
                        style={{ flex: 1, padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }}
                      />
                      <button
                        type="button"
                        onClick={() => void runSearch(searchModalIdx, searchAccountId, searchDateStart, searchDateEnd, searchQuery, csvRow.valor)}
                        disabled={searchLoading}
                        className={styles.btnSave}
                        style={{ padding: '8px 14px' }}
                      >
                        {searchLoading ? '…' : 'Buscar'}
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                  Filtra automaticamente por valor próximo (±R$ 0,05). Ajuste período e descrição para refinar.
                </div>

                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                  {searchLoading ? (
                    <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Buscando…</div>
                  ) : searchResults.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                      Nenhum lançamento encontrado com esses filtros.
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                          <th style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Tipo</th>
                          <th style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Data</th>
                          <th style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Descrição</th>
                          <th style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Conta</th>
                          <th style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                          <th style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', textAlign: 'right' }}>Valor</th>
                          <th style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchResults.map(t => (
                          <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '10px 12px' }}>
                              <span className={`${styles.tipoBadge} ${t.tipo === 'entrada' ? styles.tipoEntrada : t.tipo === 'transferencia' ? styles.statusConfirmado : styles.tipoSaida}`}>
                                {t.tipo === 'entrada' ? 'Entrada' : t.tipo === 'transferencia' ? 'Transferência' : 'Saída'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', color: '#374151' }}>{fmtDate(t.competence_date)}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ fontWeight: 500 }}>{t.descricao}</div>
                              {(t.cliente?.nome || t.fornecedor?.nome) && (
                                <div style={{ fontSize: 11, color: '#6b7280' }}>👤 {t.cliente?.nome || t.fornecedor?.nome}</div>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>{t.account?.nome || '—'}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span className={t.status === 'confirmado' ? styles.statusConfirmado : styles.statusPendente} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                                {t.status === 'confirmado' ? '✓ Pago' : '⏳ Pendente'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtBRL(t.valor)}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                              <button
                                type="button"
                                onClick={() => void confirmManualConcile(t.id, t.descricao, t.account?.nome || '')}
                                disabled={searchLoading}
                                className={styles.btnSave}
                                style={{ padding: '6px 12px', fontSize: 12 }}
                              >
                                Conciliar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                  <button
                    type="button"
                    className={styles.btnCancelForm}
                    onClick={() => setSearchModalIdx(null)}
                    disabled={searchLoading}
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
      </main>
    </div>
  )
}

export default function ConciliacaoPage() {
  return (
    <Suspense fallback={<NGPLoading loading loadingText="Carregando…" />}>
      <ConciliacaoInner />
    </Suspense>
  )
}
