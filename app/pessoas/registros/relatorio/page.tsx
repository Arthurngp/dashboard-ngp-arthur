'use client'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import CustomSelect from '@/components/CustomSelect'
import styles from './relatorio.module.css'

interface PontoRecord {
  id: string
  tipo_registro: string
  created_at: string
  usuario_id: string
  usuario_nome?: string
  observacao?: string | null
}

interface Jornada {
  min_dom: number; min_seg: number; min_ter: number; min_qua: number
  min_qui: number; min_sex: number; min_sab: number
}

const DEFAULT_JORNADA_NGP: Jornada = {
  min_dom: 0, min_seg: 540, min_ter: 540, min_qua: 540, min_qui: 540, min_sex: 480, min_sab: 0,
}

const BRT_OFFSET = -3 * 60 * 60 * 1000
const DAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function toLocalTime(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() + BRT_OFFSET)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function fmtMins(m: number): string {
  if (!Number.isFinite(m) || m === 0) return '0h'
  const h = Math.floor(Math.abs(m) / 60)
  const mi = Math.abs(m) % 60
  const sign = m < 0 ? '-' : ''
  return `${sign}${h}h${mi > 0 ? String(mi).padStart(2, '0') : ''}`
}

function targetMinsForDow(j: Jornada, dow: number): number {
  switch (dow) {
    case 0: return j.min_dom
    case 1: return j.min_seg
    case 2: return j.min_ter
    case 3: return j.min_qua
    case 4: return j.min_qui
    case 5: return j.min_sex
    case 6: return j.min_sab
    default: return 0
  }
}

interface DayInfo {
  dateStr: string
  dateLabel: string
  dow: number
  entrada: string | null
  saidaAlmoco: string | null
  retornoAlmoco: string | null
  saida: string | null
  hasAusencia: boolean
  observacao: string | null
  totalMins: number
  extrasMins: number
  negMins: number
  folgaDescontoMins: number
  targetMins: number
  status: 'complete' | 'overtime' | 'below' | 'incomplete' | 'empty'
}

type FolgaKind = 'compensatoria' | 'aniversario' | null
function classifyFolga(obs: string | null | undefined): FolgaKind {
  if (!obs) return null
  if (obs.startsWith('FOLGA ANIVERSARIO')) return 'aniversario'
  if (obs.startsWith('FOLGA')) return 'compensatoria'
  return null
}
function extractFaixaMins(obs: string | null | undefined): number | null {
  if (!obs) return null
  const m = obs.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/)
  if (!m) return null
  const ini = parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
  const fim = parseInt(m[3], 10) * 60 + parseInt(m[4], 10)
  const diff = fim - ini
  return diff > 0 ? diff : null
}

function buildDayInfo(records: PontoRecord[], dateStr: string, jornada: Jornada): DayInfo {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, d, 12))
  const dow = dt.getUTCDay()
  const target = targetMinsForDow(jornada, dow)
  const sorted = [...records].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const find = (t: string) => sorted.find(r => r.tipo_registro === t)

  const hasAusencia = sorted.some(r => r.tipo_registro === 'ausencia')
  const ausenciaObs = hasAusencia ? (sorted.find(r => r.tipo_registro === 'ausencia')?.observacao || 'AUSÊNCIA') : null

  // Soma pares entrada→saida no dia
  const isEntry = (t: string) => ['entrada', 'retorno_almoco', 'extra_entrada'].includes(t)
  const isExit  = (t: string) => ['saida_almoco', 'saida', 'extra_saida'].includes(t)
  let totalMs = 0
  let entryTime: number | null = null
  for (const r of sorted) {
    if (isEntry(r.tipo_registro)) entryTime = new Date(r.created_at).getTime()
    else if (isExit(r.tipo_registro) && entryTime) {
      totalMs += new Date(r.created_at).getTime() - entryTime
      entryTime = null
    }
  }
  const totalMins = Math.floor(totalMs / 60000)

  const hasEntrada = !!find('entrada')
  const hasSaida = !!find('saida')

  let status: DayInfo['status'] = 'empty'
  if (!hasEntrada && !hasAusencia) status = 'empty'
  else if (hasAusencia && !hasEntrada) status = 'empty'
  else if (!hasSaida) status = 'incomplete'
  else if (totalMins - target > 0) status = 'overtime'
  else if (totalMins - target >= -5) status = 'complete'
  else status = 'below'

  const diff = totalMins - target
  const extrasMins = diff > 0 ? diff : 0
  const rawNeg = target > 0 && diff < 0 && (status === 'below' || status === 'incomplete') ? -diff : 0

  // Desconto de folga compensatória: só conta se for tipo 'compensatoria'.
  // Aniversário é brinde (não desconta). Faixa desconta duração; dia inteiro
  // desconta a jornada do dia.
  const folgaKind = classifyFolga(ausenciaObs)
  let folgaDescontoMins = 0
  if (folgaKind === 'compensatoria' && target > 0) {
    const faixa = extractFaixaMins(ausenciaObs)
    folgaDescontoMins = faixa ?? target
    if (folgaDescontoMins > target) folgaDescontoMins = target
  }
  // Folga em faixa já está dentro do déficit (target - totalMins) quando há
  // batidas. Subtrai antes de somar pra evitar double-counting.
  const negMins = Math.max(0, rawNeg - folgaDescontoMins)

  return {
    dateStr,
    dateLabel: `${DAYS[dow]}, ${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}`,
    dow,
    entrada: find('entrada') ? toLocalTime(find('entrada')!.created_at) : null,
    saidaAlmoco: find('saida_almoco') ? toLocalTime(find('saida_almoco')!.created_at) : null,
    retornoAlmoco: find('retorno_almoco') ? toLocalTime(find('retorno_almoco')!.created_at) : null,
    saida: find('saida') ? toLocalTime(find('saida')!.created_at) : null,
    hasAusencia,
    observacao: ausenciaObs,
    totalMins,
    extrasMins,
    negMins,
    folgaDescontoMins,
    targetMins: target,
    status,
  }
}

function generateMonthDays(mes: number, ano: number, recordsByDay: Map<string, PontoRecord[]>, jornada: Jornada): DayInfo[] {
  const daysInMonth = new Date(ano, mes, 0).getDate()
  const out: DayInfo[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const recs = recordsByDay.get(dateStr) || []
    out.push(buildDayInfo(recs, dateStr, jornada))
  }
  return out
}

function RelatorioInner() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const now = new Date()
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [ano, setAno] = useState(now.getFullYear())
  const [colaboradorId, setColaboradorId] = useState('')

  const [usuarios, setUsuarios] = useState<{ id: string; nome: string; username: string }[]>([])
  const [records, setRecords] = useState<PontoRecord[]>([])
  const [jornada, setJornada] = useState<Jornada>(DEFAULT_JORNADA_NGP)
  const [jornadaIsDefault, setJornadaIsDefault] = useState(true)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 5000)
  }

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    setIsAdmin(s.role === 'admin')
    setAuthChecked(true)
  }, [router])

  // Carrega lista de usuários ativos
  useEffect(() => {
    if (!isAdmin) return
    const s = getSession()
    if (!s) return
    fetch(`${SURL}/functions/v1/pessoas-ponto-import`, {
      method: 'POST', headers: efHeaders(),
      body: JSON.stringify({ session_token: s.session, action: 'listar_usuarios' }),
    })
      .then(r => r.json())
      .then(d => { if (d?.usuarios) setUsuarios(d.usuarios) })
      .catch(() => {})
  }, [isAdmin])

  // Carrega registros + jornada do colaborador
  const carregar = useCallback(async () => {
    if (!colaboradorId) return
    const s = getSession()
    if (!s) return
    setLoading(true)
    try {
      const [regRes, jorRes] = await Promise.all([
        fetch(`${SURL}/functions/v1/get-ponto-mes`, {
          method: 'POST', headers: efHeaders(),
          body: JSON.stringify({ session_token: s.session, mes, ano, admin_all: true }),
        }).then(r => r.json()),
        fetch(`${SURL}/functions/v1/pessoas-jornada`, {
          method: 'POST', headers: efHeaders(),
          body: JSON.stringify({ session_token: s.session, action: 'obter', usuario_id: colaboradorId }),
        }).then(r => r.json()),
      ])
      if (regRes?.error) { showMsg('err', regRes.error); return }
      if (jorRes?.error) { showMsg('err', jorRes.error); return }
      const all: PontoRecord[] = regRes?.records || []
      setRecords(all.filter(r => r.usuario_id === colaboradorId))
      const j = jorRes?.jornada || DEFAULT_JORNADA_NGP
      setJornada({
        min_dom: j.min_dom ?? 0, min_seg: j.min_seg ?? 540, min_ter: j.min_ter ?? 540,
        min_qua: j.min_qua ?? 540, min_qui: j.min_qui ?? 540, min_sex: j.min_sex ?? 480, min_sab: j.min_sab ?? 0,
      })
      setJornadaIsDefault(!!jorRes?.is_default)
    } finally {
      setLoading(false)
    }
  }, [colaboradorId, mes, ano])

  useEffect(() => { void carregar() }, [carregar])

  const colaboradorNome = usuarios.find(u => u.id === colaboradorId)?.nome || ''

  // Agrupa records por dia local (BRT)
  const recordsByDay = useMemo(() => {
    const map = new Map<string, PontoRecord[]>()
    for (const r of records) {
      const dateStr = new Date(new Date(r.created_at).getTime() + BRT_OFFSET).toISOString().slice(0, 10)
      if (!map.has(dateStr)) map.set(dateStr, [])
      map.get(dateStr)!.push(r)
    }
    return map
  }, [records])

  const days = useMemo(() => generateMonthDays(mes, ano, recordsByDay, jornada), [mes, ano, recordsByDay, jornada])

  // Resumo
  const resumo = useMemo(() => {
    const totalTrabalhado = days.reduce((s, d) => s + d.totalMins, 0)
    const totalExtras = days.reduce((s, d) => s + d.extrasMins, 0)
    const totalNeg = days.reduce((s, d) => s + d.negMins + d.folgaDescontoMins, 0)
    const saldo = totalExtras - totalNeg
    const diasTrabalhados = days.filter(d => d.entrada).length
    const diasAusencia = days.filter(d => d.hasAusencia).length
    const diasIncompletos = days.filter(d => d.status === 'incomplete').length
    const diasAbaixo = days.filter(d => d.status === 'below').length
    const diasComExtras = days.filter(d => d.status === 'overtime').length
    const totalPrevisto = days.reduce((s, d) => s + d.targetMins, 0)
    return { totalTrabalhado, totalExtras, totalNeg, saldo, diasTrabalhados, diasAusencia, diasIncompletos, diasAbaixo, diasComExtras, totalPrevisto }
  }, [days])

  // Export CSV
  function exportCSV() {
    const header = ['Data', 'Entrada', 'S. Almoço', 'R. Almoço', 'Saída', 'Total', 'H. Extras', 'H. Negativas', 'Status']
    const lines = days.map(d => [
      d.dateLabel,
      d.entrada || '--',
      d.saidaAlmoco || '--',
      d.retornoAlmoco || '--',
      d.saida || '--',
      fmtMins(d.totalMins),
      fmtMins(d.extrasMins),
      fmtMins(d.negMins),
      d.hasAusencia ? (d.observacao || 'Ausência') : d.status,
    ])
    const csv = [header, ...lines].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `relatorio-ponto-${colaboradorNome.replace(/\s+/g, '_')}-${MONTHS[mes-1]}-${ano}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!authChecked) return <NGPLoading loading loadingText="Verificando acesso..." />
  if (!isAdmin) {
    return (
      <div className={styles.layout}>
        <main className={styles.main}>
          <div className={styles.center}>
            <h1 className={styles.title}>Acesso restrito</h1>
            <p className={styles.muted}>Relatório de ponto disponível apenas para administradores.</p>
            <Link href="/pessoas" className={styles.btnSecondary}>Voltar</Link>
          </div>
        </main>
      </div>
    )
  }

  const sectorNav = [
    { icon: <Ico><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>, label: 'Dashboard', href: '/pessoas' },
    { icon: <IcoTabela />, label: 'Registros de Ponto', href: '/pessoas/registros' },
    { icon: <IcoTabela />, label: 'Relatório mensal', href: '/pessoas/registros/relatorio' },
    { icon: <IcoTabela />, label: 'Importar histórico', href: '/pessoas/registros/import' },
  ]

  const mesAnoLabel = `${MONTHS[mes-1]} de ${ano}`

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal sectorNav={sectorNav} sectorNavTitle="PESSOAS" />
      <main className={styles.main}>
        <header className={`${styles.header} ${styles.noprint}`}>
          <div>
            <Link href="/pessoas/registros" className={styles.back}>← Registros</Link>
            <h1 className={styles.title}>Relatório mensal para folha</h1>
            <p className={styles.subtitle}>Espelho de ponto com totais para fechamento da folha de pagamento.</p>
          </div>
          <div className={styles.actionsRow}>
            <button className={styles.btnSecondary} onClick={exportCSV} disabled={!colaboradorId || loading}>↓ CSV</button>
            <button
              className={styles.btnPrimary}
              onClick={() => {
                document.body.classList.add('printing')
                const cleanup = () => {
                  document.body.classList.remove('printing')
                  window.removeEventListener('afterprint', cleanup)
                }
                window.addEventListener('afterprint', cleanup)
                window.print()
              }}
              disabled={!colaboradorId || loading}
            >🖨 Imprimir / PDF</button>
          </div>
        </header>

        {msg && <div className={`${styles.toast} ${msg.type === 'ok' ? styles.toastOk : styles.toastErr}`}>{msg.text}</div>}

        <section className={`${styles.filters} ${styles.noprint}`}>
          <div className={styles.filterField}>
            <label>Colaborador</label>
            <CustomSelect
              value={colaboradorId}
              options={usuarios.map(u => ({ id: u.id, label: u.nome, subLabel: u.username }))}
              onChange={setColaboradorId}
              placeholder="Selecione um colaborador..."
              menuFixed
            />
          </div>
          <div className={styles.filterField}>
            <label>Mês</label>
            <CustomSelect
              value={String(mes)}
              options={MONTHS.map((nome, i) => ({ id: String(i + 1), label: nome }))}
              onChange={v => setMes(Number(v))}
              menuFixed
            />
          </div>
          <div className={styles.filterField}>
            <label>Ano</label>
            <CustomSelect
              value={String(ano)}
              options={Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i).map(y => ({ id: String(y), label: String(y) }))}
              onChange={v => setAno(Number(v))}
              menuFixed
            />
          </div>
        </section>

        {!colaboradorId && (
          <div className={styles.empty}>Selecione um colaborador para gerar o relatório.</div>
        )}

        {colaboradorId && (
          <section className={styles.report}>
            <header className={styles.reportHeader}>
              <div>
                <div className={styles.reportEyebrow}>Relatório de ponto · {mesAnoLabel}</div>
                <h2 className={styles.reportTitle}>{colaboradorNome}</h2>
                <div className={styles.reportMeta}>
                  Jornada: <strong>{jornadaIsDefault ? 'padrão NGP' : 'personalizada'}</strong> · Carga prevista no mês: <strong>{fmtMins(resumo.totalPrevisto)}</strong>
                </div>
              </div>
            </header>

            <div className={styles.summaryGrid}>
              <div className={styles.sumCard}>
                <span className={styles.sumLabel}>Trabalhadas</span>
                <span className={styles.sumValue}>{fmtMins(resumo.totalTrabalhado)}</span>
              </div>
              <div className={styles.sumCard}>
                <span className={styles.sumLabel}>Horas extras</span>
                <span className={`${styles.sumValue} ${styles.sumExtra}`}>{fmtMins(resumo.totalExtras)}</span>
              </div>
              <div className={styles.sumCard}>
                <span className={styles.sumLabel}>Horas negativas</span>
                <span className={`${styles.sumValue} ${styles.sumNeg}`}>{fmtMins(resumo.totalNeg)}</span>
              </div>
              <div className={styles.sumCard}>
                <span className={styles.sumLabel}>Saldo</span>
                <span className={`${styles.sumValue} ${resumo.saldo >= 0 ? styles.sumExtra : styles.sumNeg}`}>
                  {resumo.saldo >= 0 ? '+' : ''}{fmtMins(resumo.saldo)}
                </span>
              </div>
              <div className={styles.sumCard}>
                <span className={styles.sumLabel}>Dias trabalhados</span>
                <span className={styles.sumValue}>{resumo.diasTrabalhados}</span>
              </div>
              <div className={styles.sumCard}>
                <span className={styles.sumLabel}>Ausências</span>
                <span className={styles.sumValue}>{resumo.diasAusencia}</span>
              </div>
            </div>

            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Entrada</th>
                  <th>S. Almoço</th>
                  <th>R. Almoço</th>
                  <th>Saída</th>
                  <th className={styles.right}>Total</th>
                  <th className={styles.right}>Extras</th>
                  <th className={styles.right}>Negativas</th>
                  <th>Observação</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className={styles.loadingRow}>Carregando...</td></tr>
                ) : days.map(d => {
                  const isWeekend = d.dow === 0 || d.dow === 6
                  return (
                    <tr key={d.dateStr} className={`${isWeekend ? styles.weekend : ''} ${d.hasAusencia ? styles.ausencia : ''}`}>
                      <td>{d.dateLabel}</td>
                      <td>{d.entrada || '—'}</td>
                      <td>{d.saidaAlmoco || '—'}</td>
                      <td>{d.retornoAlmoco || '—'}</td>
                      <td>{d.saida || '—'}</td>
                      <td className={styles.right}>{d.entrada ? fmtMins(d.totalMins) : '—'}</td>
                      <td className={`${styles.right} ${d.extrasMins > 0 ? styles.cellExtra : ''}`}>{d.extrasMins > 0 ? fmtMins(d.extrasMins) : '—'}</td>
                      <td className={`${styles.right} ${d.negMins > 0 ? styles.cellNeg : ''}`}>{d.negMins > 0 ? fmtMins(d.negMins) : '—'}</td>
                      <td className={styles.obsCell}>
                        {d.hasAusencia ? (d.observacao || 'Ausência') : d.status === 'incomplete' ? 'Em andamento' : d.status === 'below' ? 'Abaixo da carga' : d.status === 'overtime' ? 'Hora extra' : d.status === 'complete' ? '✓' : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total do mês</td>
                  <td className={styles.right}><strong>{fmtMins(resumo.totalTrabalhado)}</strong></td>
                  <td className={styles.right}><strong>{fmtMins(resumo.totalExtras)}</strong></td>
                  <td className={styles.right}><strong>{fmtMins(resumo.totalNeg)}</strong></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>

            <footer className={styles.footer}>
              <div className={styles.signBox}>
                <div className={styles.signLine}></div>
                <div className={styles.signLabel}>Assinatura do colaborador</div>
              </div>
              <div className={styles.signBox}>
                <div className={styles.signLine}></div>
                <div className={styles.signLabel}>Assinatura RH / Gestor</div>
              </div>
            </footer>
          </section>
        )}
      </main>
    </div>
  )
}

const Ico = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>{children}</svg>
)
const IcoTabela = () => (
  <Ico>
    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>
  </Ico>
)

export default function RelatorioPage() {
  return (
    <Suspense fallback={<NGPLoading loading loadingText="Carregando..." />}>
      <RelatorioInner />
    </Suspense>
  )
}
