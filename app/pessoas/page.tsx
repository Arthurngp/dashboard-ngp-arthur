'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'
import Sidebar from '@/components/Sidebar'
import styles from './pessoas.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PontoRecord {
  id: string
  tipo_registro: 'entrada' | 'saida_almoco' | 'retorno_almoco' | 'saida' | 'extra'
  created_at: string
}

interface DayRow {
  dateStr: string
  dateLabel: string
  entrada: string | null
  saidaAlmoco: string | null
  retornoAlmoco: string | null
  saida: string | null
  totalMins: number
  status: 'complete' | 'overtime' | 'below' | 'incomplete' | 'empty'
  recordIds: string[]
}

interface NextAction {
  tipo: string
  label: string
  color: string
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

function fmtMins(mins: number): string {
  if (mins <= 0) return '--'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h${m.toString().padStart(2, '00')}m`
}

function calcBalance(records: PontoRecord[]): { totalMins: number; status: DayRow['status'] } {
  const get = (t: string) => records.find(r => r.tipo_registro === t)
  const ms  = (r: PontoRecord) => new Date(r.created_at).getTime()

  const entrada  = get('entrada')
  const saidaAlm = get('saida_almoco')
  const retAlm   = get('retorno_almoco')
  const saida    = get('saida')

  if (!entrada) return { totalMins: 0, status: 'empty' }

  let totalMs = 0
  if (saida) {
    if (saidaAlm && retAlm) {
      totalMs = (ms(saidaAlm) - ms(entrada)) + (ms(saida) - ms(retAlm))
    } else {
      totalMs = ms(saida) - ms(entrada)
    }
  } else if (saidaAlm) {
    totalMs = ms(saidaAlm) - ms(entrada)
  }

  const totalMins = Math.floor(totalMs / 60000)
  const TARGET    = 8 * 60

  let status: DayRow['status']
  if (!saida)                        status = 'incomplete'
  else if (totalMins >= TARGET + 20) status = 'overtime'
  else if (totalMins >= TARGET - 15) status = 'complete'
  else                               status = 'below'

  return { totalMins, status }
}

const DAYS   = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function groupByDay(records: PontoRecord[]): DayRow[] {
  const groups: Record<string, PontoRecord[]> = {}
  for (const r of records) {
    const dateStr = new Date(new Date(r.created_at).getTime() + BRT_OFFSET)
      .toISOString().split('T')[0]
    if (!groups[dateStr]) groups[dateStr] = []
    groups[dateStr].push(r)
  }

  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateStr, dayRecords]) => {
      dayRecords.sort((a, b) => a.created_at.localeCompare(b.created_at))
      const get = (t: string) => dayRecords.find(r => r.tipo_registro === t)
      const { totalMins, status } = calcBalance(dayRecords)

      const [y, mo, d] = dateStr.split('-').map(Number)
      const dateObj = new Date(Date.UTC(y, mo - 1, d, 12))
      const dayLabel = `${DAYS[dateObj.getUTCDay()]}, ${d} ${MONTHS[mo - 1]}`

      return {
        dateStr,
        dateLabel:    dayLabel,
        entrada:      get('entrada')        ? toLocalTime(get('entrada')!.created_at)        : null,
        saidaAlmoco:  get('saida_almoco')   ? toLocalTime(get('saida_almoco')!.created_at)   : null,
        retornoAlmoco:get('retorno_almoco') ? toLocalTime(get('retorno_almoco')!.created_at) : null,
        saida:        get('saida')          ? toLocalTime(get('saida')!.created_at)          : null,
        totalMins,
        status,
        recordIds: dayRecords.map(r => r.id),
      }
    })
}

function getNextAction(records: PontoRecord[]): NextAction | null {
  if (records.length === 0) return { tipo: 'entrada', label: 'Registrar Entrada', color: '#059669' }
  const last = records[records.length - 1].tipo_registro
  const map: Record<string, NextAction> = {
    entrada:        { tipo: 'saida_almoco',   label: 'Saída para Almoço', color: '#f59e0b' },
    saida_almoco:   { tipo: 'retorno_almoco', label: 'Retorno do Almoço', color: '#3b82f6' },
    retorno_almoco: { tipo: 'saida',          label: 'Registrar Saída',   color: '#9B1540' },
    saida:          { tipo: 'extra',          label: 'Ponto Extra',       color: '#7c3aed' },
    extra:          { tipo: 'extra',          label: 'Ponto Extra',       color: '#7c3aed' },
  }
  return map[last] ?? null
}

const STATUS_LABEL: Record<string, string> = {
  complete:   'Completo',
  overtime:   'Hora extra',
  below:      'Abaixo da carga',
  incomplete: 'Em andamento',
  empty:      '—',
}
const STATUS_COLOR: Record<string, string> = {
  complete:   '#059669',
  overtime:   '#3b82f6',
  below:      '#dc2626',
  incomplete: '#f59e0b',
  empty:      '#8E8E93',
}

const TIPO_LABEL: Record<string, string> = {
  entrada:        'Entrada',
  saida_almoco:   'Saída Almoço',
  retorno_almoco: 'Retorno Almoço',
  saida:          'Saída',
  extra:          'Extra',
}

const efHeaders = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` }

// ── Ícones inline ─────────────────────────────────────────────────────────────

const IcoRelogio = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
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

const IcoTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
  </svg>
)

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PessoasPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  // Relógio
  const clockRef = useRef<Date | null>(null)
  const [clockDisplay, setClockDisplay] = useState('--:--:--')

  // Ponto do dia
  const [todayRecords, setTodayRecords] = useState<PontoRecord[]>([])
  const [loadingPonto, setLoadingPonto] = useState(false)
  const [pontoMsg, setPontoMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Registros mensais
  const [mesRecords, setMesRecords] = useState<PontoRecord[]>([])
  const [loadingMes, setLoadingMes] = useState(false)

  // Filtro mês/ano
  const nowDate = new Date()
  const [selMes, setSelMes] = useState(nowDate.getMonth() + 1)
  const [selAno, setSelAno] = useState(nowDate.getFullYear())

  // Delete
  const [deletingRow, setDeletingRow] = useState<string | null>(null)

  // Auth
  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    setSess(s)
  }, [router])

  // Verifica se é admin
  const checkAdmin = useCallback(async () => {
    const s = getSession()
    if (!s) return
    try {
      const res  = await fetch(`${SURL}/functions/v1/admin-ponto-check`, {
        method: 'POST', headers: efHeaders,
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      setIsAdmin(data.is_admin === true)
    } catch { /* silencioso */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchToday = useCallback(async () => {
    const s = getSession()
    if (!s) return
    try {
      const res  = await fetch(`${SURL}/functions/v1/get-ponto-now`, {
        method: 'POST', headers: efHeaders,
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (data.error) return
      const serverDate = new Date(data.server_now)
      if (!isNaN(serverDate.getTime())) clockRef.current = serverDate
      setTodayRecords(data.today_records || [])
    } catch { /* silencioso */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchMes = useCallback(async (mes: number, ano: number) => {
    const s = getSession()
    if (!s) return
    setLoadingMes(true)
    try {
      const res  = await fetch(`${SURL}/functions/v1/get-ponto-mes`, {
        method: 'POST', headers: efHeaders,
        body: JSON.stringify({ session_token: s.session, mes, ano }),
      })
      const data = await res.json()
      if (!data.error) setMesRecords(data.records || [])
    } catch { /* silencioso */ } finally {
      setLoadingMes(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sess) return
    fetchToday()
    fetchMes(selMes, selAno)
    checkAdmin()
  }, [sess]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sess) return
    fetchMes(selMes, selAno)
  }, [selMes, selAno]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tick do relógio
  useEffect(() => {
    const interval = setInterval(() => {
      const prev = clockRef.current
      const isValid = prev && !isNaN(prev.getTime())
      clockRef.current = isValid
        ? new Date(prev!.getTime() + 1000)
        : new Date()

      const brtMs = clockRef.current.getTime() + BRT_OFFSET
      const brt   = new Date(brtMs)
      const h     = brt.getUTCHours().toString().padStart(2, '0')
      const m     = brt.getUTCMinutes().toString().padStart(2, '0')
      const sc    = brt.getUTCSeconds().toString().padStart(2, '0')
      setClockDisplay(`${h}:${m}:${sc}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Registra ponto
  const registrarPonto = async () => {
    const s = getSession()
    if (!s || loadingPonto) return
    setLoadingPonto(true)
    setPontoMsg(null)
    try {
      const res  = await fetch(`${SURL}/functions/v1/registrar-ponto`, {
        method: 'POST', headers: efHeaders,
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (data.error) {
        setPontoMsg({ type: 'err', text: data.error })
      } else {
        setTodayRecords(data.today_records || [])
        const rec   = data.record
        const label = TIPO_LABEL[rec.tipo_registro] || rec.tipo_registro
        setPontoMsg({ type: 'ok', text: `${label} registrado às ${toLocalTime(rec.created_at)}` })
        setTimeout(() => setPontoMsg(null), 4000)
        const d = new Date()
        if (selMes === d.getMonth() + 1 && selAno === d.getFullYear()) {
          fetchMes(selMes, selAno)
        }
      }
    } catch {
      setPontoMsg({ type: 'err', text: 'Erro de conexão. Tente novamente.' })
    } finally {
      setLoadingPonto(false)
    }
  }

  // Exclui todos os registros de um dia (admin)
  const deletarDia = async (row: DayRow) => {
    if (!confirm(`Mover os registros de ${row.dateLabel} para a lixeira?`)) return
    const s = getSession()
    if (!s) return
    setDeletingRow(row.dateStr)
    try {
      const res  = await fetch(`${SURL}/functions/v1/admin-ponto-delete`, {
        method: 'POST', headers: efHeaders,
        body: JSON.stringify({ session_token: s.session, record_ids: row.recordIds }),
      })
      const data = await res.json()
      if (data.error) {
        alert(`Erro: ${data.error}`)
      } else {
        fetchMes(selMes, selAno)
        fetchToday()
      }
    } catch {
      alert('Erro de conexão.')
    } finally {
      setDeletingRow(null)
    }
  }

  if (!sess) return null

  const nextAction               = getNextAction(todayRecords)
  const { totalMins: todayMins } = calcBalance(todayRecords)
  const dayRows                  = groupByDay(mesRecords)
  const findToday                = (tipo: string) => todayRecords.find(r => r.tipo_registro === tipo)

  // Nav do setor Pessoas na sidebar
  const sectorNav = [
    { icon: <IcoRelogio />, label: 'Ponto Eletrônico', href: '/pessoas' },
    ...(isAdmin ? [{ icon: <IcoLixeira />, label: 'Lixeira', href: '/pessoas/lixeira' }] : []),
  ]

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal sectorNav={sectorNav} sectorNavTitle="PESSOAS" />

      <main className={styles.main}>
        <div className={styles.content}>

          {/* ── Header ─────────────────────────────────────────────────── */}
          <header className={styles.header}>
            <button className={styles.btnBack} onClick={() => router.push('/setores')}>
              ← Setores
            </button>
            <div className={styles.eyebrow}>Setor · Pessoas</div>
            <h1 className={styles.title}>Ponto Eletrônico</h1>
            <p className={styles.subtitle}>Registro de jornada de trabalho NGP.</p>
          </header>

          {/* ── Widget ─────────────────────────────────────────────────── */}
          <div className={styles.pontoWidget}>

            <div className={styles.clockSection}>
              <div className={styles.clockTime}>{clockDisplay}</div>
              <div className={styles.clockLabel}>Horário de Brasília</div>
            </div>

            <div className={styles.todayGrid}>
              {(['entrada','saida_almoco','retorno_almoco','saida'] as const).map(tipo => {
                const rec = findToday(tipo)
                return (
                  <div key={tipo} className={styles.todayItem}>
                    <span className={styles.todayLabel}>{TIPO_LABEL[tipo]}</span>
                    <span className={`${styles.todayValue} ${rec ? styles.todayValueSet : ''}`}>
                      {rec ? toLocalTime(rec.created_at) : '--:--'}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className={styles.pontoActionArea}>
              {todayMins > 0 && (
                <div className={styles.todayTotal}>
                  Total acumulado: <strong>{fmtMins(todayMins)}</strong>
                </div>
              )}

              {pontoMsg && (
                <div className={`${styles.pontoMsg} ${pontoMsg.type === 'ok' ? styles.pontoOk : styles.pontoErr}`}>
                  {pontoMsg.type === 'ok' ? '✓ ' : '✕ '}{pontoMsg.text}
                </div>
              )}

              {nextAction ? (
                <button
                  className={styles.btnPonto}
                  style={{ background: nextAction.color }}
                  onClick={registrarPonto}
                  disabled={loadingPonto}
                >
                  {loadingPonto ? (
                    <span className={styles.spinner} />
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={18} height={18}>
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      {nextAction.label}
                    </>
                  )}
                </button>
              ) : (
                <div className={styles.pontoComplete}>
                  ✓ Jornada encerrada · {fmtMins(todayMins)}
                </div>
              )}
            </div>
          </div>

          {/* ── Registros mensais ──────────────────────────────────────── */}
          <section className={styles.mesSection}>
            <div className={styles.mesHeader}>
              <h2 className={styles.mesTitle}>Histórico de Registros</h2>
              <div className={styles.mesFilter}>
                <select
                  className={styles.mesSelect}
                  value={selMes}
                  onChange={e => setSelMes(Number(e.target.value))}
                >
                  {MONTHS.map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
                <select
                  className={styles.mesSelect}
                  value={selAno}
                  onChange={e => setSelAno(Number(e.target.value))}
                >
                  {[2025, 2026, 2027].map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
            </div>

            {loadingMes ? (
              <div className={styles.mesLoading}>Carregando registros...</div>
            ) : dayRows.length === 0 ? (
              <div className={styles.mesEmpty}>
                Nenhum registro em {MONTHS[selMes - 1]}/{selAno}.
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>Data</th>
                      <th>Entrada</th>
                      <th>S. Almoço</th>
                      <th>R. Almoço</th>
                      <th>Saída</th>
                      <th>Total</th>
                      <th>Status</th>
                      {isAdmin && <th className={styles.thAcoes}>Ações</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {dayRows.map(row => (
                      <tr key={row.dateStr}>
                        <td className={styles.tdUsuario}>{sess.username || sess.user}</td>
                        <td className={styles.tdDate}>{row.dateLabel}</td>
                        <td>{row.entrada      || <span className={styles.tdEmpty}>--:--</span>}</td>
                        <td>{row.saidaAlmoco  || <span className={styles.tdEmpty}>--:--</span>}</td>
                        <td>{row.retornoAlmoco|| <span className={styles.tdEmpty}>--:--</span>}</td>
                        <td>{row.saida        || <span className={styles.tdEmpty}>--:--</span>}</td>
                        <td className={styles.tdTotal}>
                          {row.totalMins > 0 ? fmtMins(row.totalMins) : <span className={styles.tdEmpty}>--</span>}
                        </td>
                        <td>
                          <span
                            className={styles.statusBadge}
                            style={{
                              color:      STATUS_COLOR[row.status],
                              background: STATUS_COLOR[row.status] + '18',
                            }}
                          >
                            {STATUS_LABEL[row.status]}
                          </span>
                        </td>
                        {isAdmin && (
                          <td>
                            <button
                              className={styles.btnDelete}
                              onClick={() => deletarDia(row)}
                              disabled={deletingRow === row.dateStr}
                              title="Mover para lixeira"
                            >
                              {deletingRow === row.dateStr
                                ? <span className={styles.spinnerDark} />
                                : <IcoTrash />
                              }
                            </button>
                          </td>
                        )}
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
