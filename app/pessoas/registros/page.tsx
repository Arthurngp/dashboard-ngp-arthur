'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import CustomSelect, { SelectOption } from '@/components/CustomSelect'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import styles from './registros.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PontoRecord {
  id: string
  tipo_registro: 'entrada' | 'saida_almoco' | 'retorno_almoco' | 'saida' | 'extra_entrada' | 'extra_saida' | 'extra'
  created_at: string
  usuario_id: string
  usuario_nome?: string
}

interface DayRow {
  key: string
  dateStr: string
  dateLabel: string
  usuarioId: string
  usuarioNome: string
  entrada: string | null
  saidaAlmoco: string | null
  retornoAlmoco: string | null
  saida: string | null
  extraEntrada: string | null
  extraSaida: string | null
  totalMins: number
  extrasMins: number
  status: 'complete' | 'overtime' | 'below' | 'incomplete' | 'empty'
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
  return `${d.getUTCHours().toString().padStart(2,'0')}:${d.getUTCMinutes().toString().padStart(2,'0')}`
}

function fmtMins(mins: number): string {
  if (mins <= 0) return '--'
  return `${Math.floor(mins / 60)}h${(mins % 60).toString().padStart(2,'0')}m`
}

interface Jornada {
  min_dom: number; min_seg: number; min_ter: number; min_qua: number;
  min_qui: number; min_sex: number; min_sab: number
}
// Padrão NGP — usado como fallback se o colaborador não tem jornada custom.
const DEFAULT_JORNADA_NGP: Jornada = {
  min_dom: 0, min_seg: 540, min_ter: 540, min_qua: 540, min_qui: 540, min_sex: 480, min_sab: 0,
}
function targetMinsForDow(jornada: Jornada, dow: number): number {
  switch (dow) {
    case 0: return jornada.min_dom
    case 1: return jornada.min_seg
    case 2: return jornada.min_ter
    case 3: return jornada.min_qua
    case 4: return jornada.min_qui
    case 5: return jornada.min_sex
    case 6: return jornada.min_sab
    default: return 0
  }
}

function calcBalance(records: PontoRecord[], jornada: Jornada = DEFAULT_JORNADA_NGP): { totalMins: number; status: DayRow['status']; extrasMins: number } {
  const sorted = [...records].sort((a,b) => a.created_at.localeCompare(b.created_at))
  const ms = (iso: string) => new Date(iso).getTime()
  let totalMs = 0

  const isEntry = (t: string) => ['entrada', 'retorno_almoco', 'extra_entrada'].includes(t)
  const isExit  = (t: string) => ['saida_almoco', 'saida', 'extra_saida'].includes(t)

  let entryTime: number | null = null
  for (const r of sorted) {
    if (isEntry(r.tipo_registro)) entryTime = ms(r.created_at)
    else if (isExit(r.tipo_registro) && entryTime) {
      totalMs += (ms(r.created_at) - entryTime)
      entryTime = null
    }
  }

  const totalMins = Math.floor(totalMs / 60000)

  // Carga prevista vem da jornada do colaborador (ou padrão NGP).
  const firstRec = records[0]
  const date = firstRec ? new Date(new Date(firstRec.created_at).getTime() + BRT_OFFSET) : new Date()
  const dayOfWeek = date.getUTCDay()
  const TARGET = targetMinsForDow(jornada, dayOfWeek)

  const diffMins = totalMins - TARGET
  const extrasMins = diffMins > 0 ? diffMins : 0

  const hasEntrada = records.some(r => r.tipo_registro === 'entrada')
  const hasSaida   = records.some(r => r.tipo_registro === 'saida')

  if (!hasEntrada) return { totalMins: 0, status: 'empty', extrasMins: 0 }

  const status: DayRow['status'] = !hasSaida ? 'incomplete'
    : diffMins > 0 ? 'overtime'
    : diffMins >= -5 ? 'complete'
    : 'below'
  return { totalMins, status, extrasMins }
}

const DAYS   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function groupByDay(records: PontoRecord[], jornadas: Record<string, Jornada> = {}): DayRow[] {
  const groups: Record<string, PontoRecord[]> = {}
  for (const r of records) {
    const dateStr = new Date(new Date(r.created_at).getTime() + BRT_OFFSET).toISOString().split('T')[0]
    const key = `${r.usuario_id}__${dateStr}`
    if (!groups[key]) groups[key] = []
    groups[key].push(r)
  }
  return Object.entries(groups)
    .sort(([a],[b]) => {
      const [,dA] = a.split('__'); const [,dB] = b.split('__')
      return dB.localeCompare(dA) || a.localeCompare(b)
    })
    .map(([key, recs]) => {
      recs.sort((a,b) => a.created_at.localeCompare(b.created_at))
      const get = (t: string) => recs.find(r => r.tipo_registro === t)
      const usuarioId = recs[0].usuario_id
      const jornada = jornadas[usuarioId] || DEFAULT_JORNADA_NGP
      const { totalMins, status, extrasMins } = calcBalance(recs, jornada)
      const [,dateStr] = key.split('__')
      const [y,mo,d] = dateStr.split('-').map(Number)
      const dateObj = new Date(Date.UTC(y, mo-1, d, 12))
      return {
        key,
        dateStr,
        dateLabel: `${DAYS[dateObj.getUTCDay()]}, ${d} ${MONTHS[mo-1]}`,
        usuarioId:   recs[0].usuario_id,
        usuarioNome: recs[0].usuario_nome || recs[0].usuario_id,
        entrada:       get('entrada')        ? toLocalTime(get('entrada')!.created_at)        : null,
        saidaAlmoco:   get('saida_almoco')   ? toLocalTime(get('saida_almoco')!.created_at)   : null,
        retornoAlmoco: get('retorno_almoco') ? toLocalTime(get('retorno_almoco')!.created_at) : null,
        saida:         get('saida')          ? toLocalTime(get('saida')!.created_at)          : null,
        extraEntrada:  get('extra_entrada')  ? toLocalTime(get('extra_entrada')!.created_at)  : null,
        extraSaida:    get('extra_saida')    ? toLocalTime(get('extra_saida')!.created_at)    : null,
        totalMins,
        extrasMins,
        status,
      }
    })
}

const STATUS_LABEL: Record<string, string> = {
  complete: 'Completo', overtime: 'Hora extra',
  below: 'Abaixo da carga', incomplete: 'Em andamento', empty: '—',
}
const STATUS_COLOR: Record<string, string> = {
  complete: '#059669', overtime: '#3b82f6',
  below: '#dc2626', incomplete: '#f59e0b', empty: '#8E8E93',
}

const TIPO_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  saida_almoco: 'Saída Almoço',
  retorno_almoco: 'Retorno Almoço',
  saida: 'Saída',
  extra_entrada: 'Entrada Extra',
  extra_saida: 'Saída Extra',
  extra: 'Extra',
}

function getNextAction(records: PontoRecord[]): NextAction | null {
  if (records.length === 0) return { tipo: 'entrada', label: 'Registrar Entrada', color: '#059669' }
  const last = records[records.length - 1].tipo_registro
  const map: Record<string, NextAction> = {
    entrada: { tipo: 'saida_almoco', label: 'Saída para Almoço', color: '#f59e0b' },
    saida_almoco: { tipo: 'retorno_almoco', label: 'Retorno do Almoço', color: '#3b82f6' },
    retorno_almoco: { tipo: 'saida', label: 'Registrar Saída', color: '#9B1540' },
    saida: { tipo: 'extra_entrada', label: 'Entrada Extra', color: '#7c3aed' },
    extra_entrada: { tipo: 'extra_saida', label: 'Saída Extra', color: '#6d28d9' },
    extra_saida: { tipo: 'extra_entrada', label: 'Entrada Extra', color: '#7c3aed' },
    extra: { tipo: 'extra_entrada', label: 'Entrada Extra', color: '#7c3aed' },
  }
  return map[last] ?? null
}


// ── Ícones ────────────────────────────────────────────────────────────────────

const IcoRelogio = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
)
const IcoTabela = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>
  </svg>
)
const IcoLixeira = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
  </svg>
)
const IcoCarreira = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <path d="M12 20h9"/>
    <path d="M12 4h9"/>
    <path d="M4 9h16"/>
    <path d="M4 15h16"/>
    <path d="M8 4v16"/>
  </svg>
)
const IcoDownload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)
const IcoFiltro = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
)

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RegistrosPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const offsetRef = useRef<number>(0)
  const [clockDisplay, setClockDisplay] = useState('--:--:--')
  const [todayRecords, setTodayRecords] = useState<PontoRecord[]>([])
  const [loadingPonto, setLoadingPonto] = useState(false)
  const [pontoMsg, setPontoMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const nowDate = new Date()
  const [selMes, setSelMes]   = useState(nowDate.getMonth() + 1)
  const [selAno, setSelAno]   = useState(nowDate.getFullYear())
  const [filterUser, setFilterUser] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const [allRows, setAllRows]     = useState<DayRow[]>([])
  const [jornadasMap, setJornadasMap] = useState<Record<string, Jornada>>({})
  const [minhaJornada, setMinhaJornada] = useState<Jornada>(DEFAULT_JORNADA_NGP)
  const [loading, setLoading]     = useState(false)

  // Auth
  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    const admin = s.role === 'admin'
    setIsAdmin(admin)
    setSess(s)
  }, [router])

  const fetchRegistros = useCallback(async (mes: number, ano: number) => {
    const s = getSession()
    if (!s) return
    setLoading(true)
    try {
      const res  = await fetch(`${SURL}/functions/v1/get-ponto-mes`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, mes, ano, admin_all: s.role === 'admin' }),
      })
      const data = await res.json()
      if (!data.error) {
        const records: PontoRecord[] = data.records || []
        // Busca jornadas dos usuários distintos presentes (admin recebe todos;
        // não admin recebe só o próprio — backend filtra).
        const usuarioIds = Array.from(new Set(records.map(r => r.usuario_id))).filter(Boolean)
        let jornadasResp: Record<string, Jornada> = {}
        if (usuarioIds.length > 0) {
          try {
            const jr = await fetch(`${SURL}/functions/v1/pessoas-jornada`, {
              method: 'POST', headers: efHeaders(),
              body: JSON.stringify({ session_token: s.session, action: 'obter_bulk', usuario_ids: usuarioIds }),
            })
            const jd = await jr.json()
            if (jd?.jornadas) jornadasResp = jd.jornadas as Record<string, Jornada>
          } catch { /* silencioso — usa default */ }
        }
        setJornadasMap(jornadasResp)
        // Para "meu ponto hoje": para usuário não admin, jornadasResp tem apenas
        // o próprio; pega o único registro. Para admin, fica no default (admin
        // não usa o card pessoal de carga).
        const jornadaKeys = Object.keys(jornadasResp)
        if (jornadaKeys.length === 1) setMinhaJornada(jornadasResp[jornadaKeys[0]])
        else setMinhaJornada(DEFAULT_JORNADA_NGP)
        setAllRows(groupByDay(records, jornadasResp))
      }
    } catch { /* silencioso */ } finally {
      setLoading(false)
    }
  }, [])

  const fetchToday = useCallback(async () => {
    const s = getSession()
    if (!s) return
    try {
      const res = await fetch(`${SURL}/functions/v1/get-ponto-now`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (data.error) return
      const serverDate = new Date(data.server_now)
      if (!isNaN(serverDate.getTime())) {
        offsetRef.current = serverDate.getTime() - Date.now()
      }
      setTodayRecords(data.today_records || [])
    } catch {
      // silencioso
    }
  }, [])

  useEffect(() => {
    if (!sess) return
    fetchToday()
    fetchRegistros(selMes, selAno)
  }, [sess, selMes, selAno, fetchToday]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const interval = setInterval(() => {
      const nowMs = Date.now() + offsetRef.current
      const brtMs = nowMs + BRT_OFFSET
      const brt = new Date(brtMs)
      const h = brt.getUTCHours().toString().padStart(2, '0')
      const m = brt.getUTCMinutes().toString().padStart(2, '0')
      const sc = brt.getUTCSeconds().toString().padStart(2, '0')
      setClockDisplay(`${h}:${m}:${sc}`)
    }, 1000)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchToday()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchToday])

  const registrarPonto = async () => {
    const s = getSession()
    if (!s || loadingPonto) return
    setLoadingPonto(true)
    setPontoMsg(null)
    try {
      const res = await fetch(`${SURL}/functions/v1/registrar-ponto`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (data.error) {
        setPontoMsg({ type: 'err', text: data.error })
      } else {
        setTodayRecords(data.today_records || [])
        const rec = data.record
        const label = TIPO_LABEL[rec.tipo_registro] || rec.tipo_registro
        setPontoMsg({ type: 'ok', text: `${label} registrado às ${toLocalTime(rec.created_at)}` })
        window.setTimeout(() => setPontoMsg(null), 4000)
        const d = new Date()
        if (selMes === d.getMonth() + 1 && selAno === d.getFullYear()) {
          fetchRegistros(selMes, selAno)
        }
      }
    } catch {
      setPontoMsg({ type: 'err', text: 'Erro de conexão. Tente novamente.' })
    } finally {
      setLoadingPonto(false)
    }
  }

  // Filtros aplicados
  const usuariosUnicos = Array.from(new Set(allRows.map(r => r.usuarioNome))).sort()
  const rows = allRows.filter(r => {
    if (filterUser   && r.usuarioNome !== filterUser)  return false
    if (filterStatus && r.status      !== filterStatus) return false
    return true
  })

  // Totais — agregados do período visível (após filtros de usuário/status).
  // Carga prevista vem da jornada custom do colaborador; fallback para NGP.
  // Ausências não entram no cálculo de horas extras/negativas.
  function targetForRow(r: DayRow): number {
    const [y, mo, d] = r.dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, mo - 1, d, 12))
    const dow = dt.getUTCDay()
    const j = jornadasMap[r.usuarioId] || DEFAULT_JORNADA_NGP
    return targetMinsForDow(j, dow)
  }
  const diasAtivos = rows.filter(r => r.status !== 'empty')
  const totalHoras = diasAtivos.reduce((acc, r) => acc + r.totalMins, 0)
  const totalExtras = diasAtivos.reduce((acc, r) => acc + r.extrasMins, 0)
  const totalNegativas = diasAtivos.reduce((acc, r) => {
    const target = targetForRow(r)
    if (target === 0) return acc
    const diff = r.totalMins - target
    return acc + (diff < 0 ? -diff : 0)
  }, 0)
  const saldoMins = totalExtras - totalNegativas
  const diasCompletos = rows.filter(r => r.status === 'complete' || r.status === 'overtime').length
  const diasAbaixo    = rows.filter(r => r.status === 'below').length
  const diasIncompletos = rows.filter(r => r.status === 'incomplete').length
  const diasAusencias = rows.filter(r => r.status === 'empty').length

  // Export CSV
  const exportCSV = () => {
    const header = ['Usuário','Data','Entrada','S. Almoço','R. Almoço','Saída','Total','H. Extras','Status']
    const csvRows = rows.map(r => [
      r.usuarioNome,
      r.dateLabel,
      r.entrada      || '--',
      r.saidaAlmoco  || '--',
      r.retornoAlmoco|| '--',
      r.saida        || '--',
      fmtMins(r.totalMins),
      fmtMins(r.extrasMins),
      STATUS_LABEL[r.status],
    ])
    const csv = [header, ...csvRows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `registros-ponto-${MONTHS[selMes-1]}-${selAno}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!sess) return <NGPLoading loading loadingText="Carregando registros..." />

  const nextAction = getNextAction(todayRecords)
  const { totalMins: todayMins } = calcBalance(todayRecords, minhaJornada)
  const findToday = (tipo: string) => todayRecords.find((r) => r.tipo_registro === tipo)

  const sectorNav = [
    { icon: <IcoRelogio />, label: 'Dashboard', href: '/pessoas' },
    { icon: <IcoTabela />,  label: 'Registros de Ponto', href: '/pessoas/registros' },
    { icon: <IcoCarreira />, label: 'Colaboradores', href: '/pessoas/carreira' },
    ...(isAdmin ? [{ icon: <IcoTabela />, label: 'Cadastros', href: '/pessoas/cadastros' }] : []),
    ...(isAdmin ? [{ icon: <IcoTabela />, label: 'Relatório mensal', href: '/pessoas/registros/relatorio' }] : []),
    ...(isAdmin ? [{ icon: <IcoTabela />, label: 'Importar histórico', href: '/pessoas/registros/import' }] : []),
    ...(isAdmin ? [{ icon: <IcoLixeira />, label: 'Lixeira', href: '/pessoas/lixeira' }] : []),
  ]

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal sectorNav={sectorNav} sectorNavTitle="PESSOAS" />

      <main className={styles.main}>
        <div className={styles.content}>

          {/* Header */}
          <header className={styles.header}>
            <button className={styles.btnBack} onClick={() => router.push('/setores')}>
              ← Setores
            </button>
            <div className={styles.eyebrow}>Setor · Pessoas</div>
            <h1 className={styles.title}>Registros de Ponto</h1>
            <p className={styles.subtitle}>Auditoria e histórico completo de jornadas.</p>
          </header>

          <section className={styles.pontoWidget}>
            <div className={styles.clockSection}>
              <div className={styles.clockTime}>{clockDisplay}</div>
              <div className={styles.clockLabel}>Horário de Brasília</div>
            </div>

            <div className={styles.todayGrid}>
              {(['entrada', 'saida_almoco', 'retorno_almoco', 'saida'] as const).map((tipo) => {
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
              <div className={styles.widgetHeader}>
                <h2 className={styles.widgetTitle}>Meu ponto hoje</h2>
                <span className={styles.sectionHint}>Registro rápido</span>
              </div>

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
          </section>

          {/* Filtros + Export */}
          <div className={styles.toolbar}>
            <div className={styles.filters}>
              <div className={styles.filterLabel}><IcoFiltro /> Filtros</div>

              <CustomSelect
                caption="Mês"
                value={String(selMes)}
                options={MONTHS.map((m, i) => ({ id: String(i + 1), label: m }))}
                onChange={val => setSelMes(Number(val))}
              />
              <CustomSelect
                caption="Ano"
                value={String(selAno)}
                options={[2025, 2026, 2027].map(a => ({ id: String(a), label: String(a) }))}
                onChange={val => setSelAno(Number(val))}
              />

              {isAdmin && (
                <CustomSelect
                  caption="Usuário"
                  value={filterUser}
                  options={[
                    { id: '', label: 'Todos os usuários' },
                    ...usuariosUnicos.map(u => ({ id: u, label: u }))
                  ]}
                  onChange={setFilterUser}
                />
              )}

              <CustomSelect
                caption="Status"
                value={filterStatus}
                options={[
                  { id: '', label: 'Todos os status' },
                  { id: 'complete', label: 'Completo' },
                  { id: 'overtime', label: 'Hora extra' },
                  { id: 'below', label: 'Abaixo da carga' },
                  { id: 'incomplete', label: 'Em andamento' },
                ]}
                onChange={setFilterStatus}
              />
            </div>

            <button className={styles.btnExport} onClick={exportCSV} disabled={rows.length === 0}>
              <IcoDownload /> Exportar CSV
            </button>
          </div>

          {/* Cards de resumo */}
          <div className={styles.cards}>
            <div className={styles.card}>
              <div className={styles.cardValue}>{fmtMins(totalHoras)}</div>
              <div className={styles.cardLabel}>Total de horas</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue} style={{color:'#3b82f6'}}>{fmtMins(totalExtras)}</div>
              <div className={styles.cardLabel}>Horas extras</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue} style={{color:'#dc2626'}}>{fmtMins(totalNegativas)}</div>
              <div className={styles.cardLabel}>Horas negativas</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue} style={{color: saldoMins >= 0 ? '#059669' : '#dc2626'}}>
                {saldoMins >= 0 ? '+' : '−'}{fmtMins(Math.abs(saldoMins))}
              </div>
              <div className={styles.cardLabel}>Saldo (extras − negativas)</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue} style={{color:'#059669'}}>{diasCompletos}</div>
              <div className={styles.cardLabel}>Dias completos</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue} style={{color:'#dc2626'}}>{diasAbaixo}</div>
              <div className={styles.cardLabel}>Abaixo da carga</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue} style={{color:'#f59e0b'}}>{diasIncompletos}</div>
              <div className={styles.cardLabel}>Em andamento</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue} style={{color:'#8E8E93'}}>{diasAusencias}</div>
              <div className={styles.cardLabel}>Ausências</div>
            </div>
          </div>

          {/* Tabela */}
          <section className={styles.tableSection}>
            {loading ? (
              <div className={styles.empty}>Carregando registros...</div>
            ) : rows.length === 0 ? (
              <div className={styles.empty}>Nenhum registro encontrado.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {isAdmin && <th>Usuário</th>}
                      <th>Data</th>
                      <th>Entrada</th>
                      <th>S. Almoço</th>
                      <th>R. Almoço</th>
                      <th>Saída</th>
                      <th>Extra Ent.</th>
                      <th>Extra Saí.</th>
                      <th>Total</th>
                      <th>H. Extras</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.key}>
                        {isAdmin && <td className={styles.tdUser}>{row.usuarioNome}</td>}
                        <td className={styles.tdDate}>{row.dateLabel}</td>
                        <td>{row.entrada       || <span className={styles.empty2}>--:--</span>}</td>
                        <td>{row.saidaAlmoco   || <span className={styles.empty2}>--:--</span>}</td>
                        <td>{row.retornoAlmoco || <span className={styles.empty2}>--:--</span>}</td>
                        <td>{row.saida         || <span className={styles.empty2}>--:--</span>}</td>
                        <td className={styles.tdExtraCol}>
                          {row.extraEntrada || <span className={styles.empty2}>--:--</span>}
                        </td>
                        <td className={styles.tdExtraCol}>
                          {row.extraSaida || <span className={styles.empty2}>--:--</span>}
                        </td>
                        <td className={styles.tdTotal}>
                          {row.totalMins > 0 ? fmtMins(row.totalMins) : <span className={styles.empty2}>--</span>}
                        </td>
                        <td className={styles.tdTotal}>
                          {row.extrasMins > 0 ? fmtMins(row.extrasMins) : <span className={styles.empty2}>--</span>}
                        </td>
                        <td>
                          <span className={styles.badge} style={{
                            color: STATUS_COLOR[row.status],
                            background: STATUS_COLOR[row.status] + '18',
                          }}>
                            {STATUS_LABEL[row.status]}
                          </span>
                        </td>
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
