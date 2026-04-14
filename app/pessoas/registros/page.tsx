'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'
import Sidebar from '@/components/Sidebar'
import styles from './registros.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PontoRecord {
  id: string
  tipo_registro: 'entrada' | 'saida_almoco' | 'retorno_almoco' | 'saida' | 'extra'
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
  totalMins: number
  status: 'complete' | 'overtime' | 'below' | 'incomplete' | 'empty'
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

function calcBalance(records: PontoRecord[]): { totalMins: number; status: DayRow['status'] } {
  const get = (t: string) => records.find(r => r.tipo_registro === t)
  const ms  = (r: PontoRecord) => new Date(r.created_at).getTime()
  const entrada = get('entrada'), saidaAlm = get('saida_almoco')
  const retAlm  = get('retorno_almoco'), saida = get('saida')
  if (!entrada) return { totalMins: 0, status: 'empty' }
  let totalMs = 0
  if (saida) {
    totalMs = saidaAlm && retAlm
      ? (ms(saidaAlm) - ms(entrada)) + (ms(saida) - ms(retAlm))
      : ms(saida) - ms(entrada)
  } else if (saidaAlm) {
    totalMs = ms(saidaAlm) - ms(entrada)
  }
  const totalMins = Math.floor(totalMs / 60000)
  const TARGET = 8 * 60
  const status: DayRow['status'] = !saida ? 'incomplete'
    : totalMins >= TARGET + 20 ? 'overtime'
    : totalMins >= TARGET - 15 ? 'complete'
    : 'below'
  return { totalMins, status }
}

const DAYS   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function groupByDay(records: PontoRecord[]): DayRow[] {
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
      const { totalMins, status } = calcBalance(recs)
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
        totalMins,
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

const efHeaders = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` }

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

  const nowDate = new Date()
  const [selMes, setSelMes]   = useState(nowDate.getMonth() + 1)
  const [selAno, setSelAno]   = useState(nowDate.getFullYear())
  const [filterUser, setFilterUser] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const [allRows, setAllRows]     = useState<DayRow[]>([])
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
        method: 'POST', headers: efHeaders,
        body: JSON.stringify({ session_token: s.session, mes, ano, admin_all: s.role === 'admin' }),
      })
      const data = await res.json()
      if (!data.error) setAllRows(groupByDay(data.records || []))
    } catch { /* silencioso */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!sess) return
    fetchRegistros(selMes, selAno)
  }, [sess, selMes, selAno]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtros aplicados
  const usuariosUnicos = Array.from(new Set(allRows.map(r => r.usuarioNome))).sort()
  const rows = allRows.filter(r => {
    if (filterUser   && r.usuarioNome !== filterUser)  return false
    if (filterStatus && r.status      !== filterStatus) return false
    return true
  })

  // Totais
  const totalHoras = rows.reduce((acc, r) => acc + r.totalMins, 0)
  const diasCompletos = rows.filter(r => r.status === 'complete' || r.status === 'overtime').length
  const diasAbaixo    = rows.filter(r => r.status === 'below').length

  // Export CSV
  const exportCSV = () => {
    const header = ['Usuário','Data','Entrada','S. Almoço','R. Almoço','Saída','Total','Status']
    const csvRows = rows.map(r => [
      r.usuarioNome,
      r.dateLabel,
      r.entrada      || '--',
      r.saidaAlmoco  || '--',
      r.retornoAlmoco|| '--',
      r.saida        || '--',
      fmtMins(r.totalMins),
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

  if (!sess) return null

  const sectorNav = [
    { icon: <IcoRelogio />, label: 'Ponto Eletrônico', href: '/pessoas' },
    { icon: <IcoTabela />,  label: 'Registros de Ponto', href: '/pessoas/registros' },
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

          {/* Filtros + Export */}
          <div className={styles.toolbar}>
            <div className={styles.filters}>
              <div className={styles.filterLabel}><IcoFiltro /> Filtros</div>

              <select className={styles.sel} value={selMes} onChange={e => setSelMes(Number(e.target.value))}>
                {MONTHS.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
              <select className={styles.sel} value={selAno} onChange={e => setSelAno(Number(e.target.value))}>
                {[2025,2026,2027].map(a => <option key={a} value={a}>{a}</option>)}
              </select>

              {isAdmin && (
                <select className={styles.sel} value={filterUser} onChange={e => setFilterUser(e.target.value)}>
                  <option value="">Todos os usuários</option>
                  {usuariosUnicos.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              )}

              <select className={styles.sel} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">Todos os status</option>
                <option value="complete">Completo</option>
                <option value="overtime">Hora extra</option>
                <option value="below">Abaixo da carga</option>
                <option value="incomplete">Em andamento</option>
              </select>
            </div>

            <button className={styles.btnExport} onClick={exportCSV} disabled={rows.length === 0}>
              <IcoDownload /> Exportar CSV
            </button>
          </div>

          {/* Cards de resumo */}
          <div className={styles.cards}>
            <div className={styles.card}>
              <div className={styles.cardValue}>{rows.length}</div>
              <div className={styles.cardLabel}>Dias registrados</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue}>{fmtMins(totalHoras)}</div>
              <div className={styles.cardLabel}>Total de horas</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue} style={{color:'#059669'}}>{diasCompletos}</div>
              <div className={styles.cardLabel}>Dias completos</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardValue} style={{color:'#dc2626'}}>{diasAbaixo}</div>
              <div className={styles.cardLabel}>Abaixo da carga</div>
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
                      <th>Total</th>
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
                        <td className={styles.tdTotal}>
                          {row.totalMins > 0 ? fmtMins(row.totalMins) : <span className={styles.empty2}>--</span>}
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
