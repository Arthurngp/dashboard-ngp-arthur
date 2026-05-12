'use client'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import CustomSelect, { SelectOption } from '@/components/CustomSelect'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import AusenciaModal from './AusenciaModal'
import BatidaModal from './BatidaModal'
import styles from './registros.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type TipoRegistro =
  | 'entrada' | 'saida_almoco' | 'retorno_almoco' | 'saida'
  | 'extra_entrada' | 'extra_saida' | 'extra' | 'ausencia'

interface PontoRecord {
  id: string
  tipo_registro: TipoRegistro
  created_at: string
  usuario_id: string
  usuario_nome?: string
  observacao?: string | null
  anexo_path?: string | null
  anexo_mime?: string | null
  anexo_size?: number | null
}

// Mapa de IDs reais das batidas por tipo — usado pra editar/deletar inline.
type RecordsByTipo = Partial<Record<TipoRegistro, {
  id: string
  created_at: string
  observacao?: string | null
  anexo_path?: string | null
  anexo_mime?: string | null
  anexo_size?: number | null
}>>

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
  status: 'complete' | 'overtime' | 'below' | 'incomplete' | 'empty' | 'absent' | 'partial_absent' | 'negative' | 'pending'
  hasAusencia: boolean
  observacaoAusencia: string | null
  recordsByTipo: RecordsByTipo
}

interface UsuarioOpt { id: string; nome: string }

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

function calcBalance(
  records: PontoRecord[],
  jornada: Jornada = DEFAULT_JORNADA_NGP,
  dateStr?: string,
  isHistorico: boolean = true,    // dia já passou? (false = hoje ou futuro)
): { totalMins: number; status: DayRow['status']; extrasMins: number } {
  // Ignora 'ausencia' no cálculo de horas — é só rótulo do dia.
  const real = records.filter(r => r.tipo_registro !== 'ausencia')
  const hasAusencia = records.some(r => r.tipo_registro === 'ausencia')

  const sorted = [...real].sort((a,b) => a.created_at.localeCompare(b.created_at))
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

  // Carga prevista: usa dateStr explícito quando dado; fallback p/ primeiro record.
  let dayOfWeek: number
  if (dateStr) {
    const [y, mo, d] = dateStr.split('-').map(Number)
    dayOfWeek = new Date(Date.UTC(y, mo - 1, d, 12)).getUTCDay()
  } else {
    const firstRec = records[0]
    const date = firstRec ? new Date(new Date(firstRec.created_at).getTime() + BRT_OFFSET) : new Date()
    dayOfWeek = date.getUTCDay()
  }
  const TARGET = targetMinsForDow(jornada, dayOfWeek)

  const diffMins = totalMins - TARGET
  const extrasMins = diffMins > 0 ? diffMins : 0

  const hasEntrada = real.some(r => r.tipo_registro === 'entrada')
  const hasSaida   = real.some(r => r.tipo_registro === 'saida')

  // Dia totalmente ocupado por ausência → status 'absent'
  if (!hasEntrada && hasAusencia) {
    return { totalMins: 0, status: 'absent', extrasMins: 0 }
  }
  // Sem batidas e sem ausência:
  //   - FDS (TARGET = 0): 'empty' (nada esperado)
  //   - dia útil passado: 'negative' (devendo a jornada inteira)
  //   - dia útil hoje/futuro: 'pending' (ainda pode bater, sem peso negativo)
  if (!hasEntrada) {
    if (TARGET === 0) return { totalMins: 0, status: 'empty', extrasMins: 0 }
    return {
      totalMins: 0,
      status: isHistorico ? 'negative' : 'pending',
      extrasMins: 0,
    }
  }

  // Tem batidas E ausência → parcial
  if (hasAusencia) {
    return { totalMins, status: 'partial_absent', extrasMins }
  }

  const status: DayRow['status'] = !hasSaida ? 'incomplete'
    : diffMins > 0 ? 'overtime'
    : diffMins >= -5 ? 'complete'
    : 'below'
  return { totalMins, status, extrasMins }
}

const DAYS   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

/**
 * Gera 1 linha por (usuario × dia do mês). Mescla com os records do banco.
 * Dias úteis sem nenhum registro saem com status 'negative' (devendo jornada).
 * FDS sem registro saem como 'empty' (nada esperado).
 */
function buildMonthRows(
  records: PontoRecord[],
  mes: number,                      // 1..12
  ano: number,
  usuarios: { id: string; nome: string }[],
  jornadas: Record<string, Jornada> = {},
  // Mapa usuario_id -> ISO da primeira batida histórica (qualquer mês).
  // Dias < primeira batida do usuário NÃO entram (ele ainda não 'existia').
  // Se o usuário não tem nenhuma batida histórica, ele não rende linhas.
  firstByUser: Record<string, string> = {},
): DayRow[] {
  // 1) Agrupar records por (usuario_id, dateStr)
  const groups: Record<string, PontoRecord[]> = {}
  for (const r of records) {
    const dateStr = new Date(new Date(r.created_at).getTime() + BRT_OFFSET).toISOString().split('T')[0]
    const key = `${r.usuario_id}__${dateStr}`
    if (!groups[key]) groups[key] = []
    groups[key].push(r)
  }

  // 2) Iterar (usuario × dia do mês). Inclui usuários ausentes nos records também.
  const daysInMonth = new Date(ano, mes, 0).getDate()
  const rows: DayRow[] = []

  // Hoje em BRT, em formato YYYY-MM-DD pra comparação textual.
  const hojeBrtMs = Date.now() + BRT_OFFSET
  const hojeBrt = new Date(hojeBrtMs).toISOString().split('T')[0]

  for (const usuario of usuarios) {
    // Cutoff: primeira batida histórica desse usuário (em formato YYYY-MM-DD BRT).
    // Sem batida nenhuma → pula o usuário inteiro.
    const firstIso = firstByUser[usuario.id]
    if (!firstIso) continue
    const firstBrtMs = new Date(firstIso).getTime() + BRT_OFFSET
    const firstDateStr = new Date(firstBrtMs).toISOString().split('T')[0]

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${ano}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      // Pula dias anteriores à primeira batida do colaborador.
      if (dateStr < firstDateStr) continue
      const isHistorico = dateStr < hojeBrt    // ontem ou antes
      const key = `${usuario.id}__${dateStr}`
      const recs = (groups[key] || []).sort((a,b) => a.created_at.localeCompare(b.created_at))
      const get = (t: TipoRegistro) => recs.find(r => r.tipo_registro === t)
      const jornada = jornadas[usuario.id] || DEFAULT_JORNADA_NGP
      const { totalMins, status, extrasMins } = calcBalance(recs, jornada, dateStr, isHistorico)

      const dateObj = new Date(Date.UTC(ano, mes - 1, d, 12))
      const ausencia = get('ausencia')

      const recordsByTipo: RecordsByTipo = {}
      for (const r of recs) {
        recordsByTipo[r.tipo_registro] = {
          id: r.id,
          created_at: r.created_at,
          observacao: r.observacao ?? null,
          anexo_path: r.anexo_path ?? null,
          anexo_mime: r.anexo_mime ?? null,
          anexo_size: r.anexo_size ?? null,
        }
      }

      rows.push({
        key,
        dateStr,
        dateLabel: `${DAYS[dateObj.getUTCDay()]}, ${d} ${MONTHS[mes-1]}`,
        usuarioId:   usuario.id,
        usuarioNome: usuario.nome,
        entrada:       get('entrada')        ? toLocalTime(get('entrada')!.created_at)        : null,
        saidaAlmoco:   get('saida_almoco')   ? toLocalTime(get('saida_almoco')!.created_at)   : null,
        retornoAlmoco: get('retorno_almoco') ? toLocalTime(get('retorno_almoco')!.created_at) : null,
        saida:         get('saida')          ? toLocalTime(get('saida')!.created_at)          : null,
        extraEntrada:  get('extra_entrada')  ? toLocalTime(get('extra_entrada')!.created_at)  : null,
        extraSaida:    get('extra_saida')    ? toLocalTime(get('extra_saida')!.created_at)    : null,
        totalMins,
        extrasMins,
        status,
        hasAusencia: !!ausencia,
        observacaoAusencia: ausencia?.observacao ?? null,
        recordsByTipo,
      })
    }
  }

  // Ordena: mais recente primeiro, usuário em ordem alfabética (quando empate).
  rows.sort((a, b) => {
    if (a.dateStr !== b.dateStr) return b.dateStr.localeCompare(a.dateStr)
    return a.usuarioNome.localeCompare(b.usuarioNome)
  })
  return rows
}

const STATUS_LABEL: Record<string, string> = {
  complete: 'Completo', overtime: 'Hora extra',
  below: 'Abaixo da carga', incomplete: 'Em andamento', empty: '—',
  absent: 'Ausência', partial_absent: 'Ausência parcial',
  negative: 'Sem registro', pending: 'Em aberto',
}
const STATUS_COLOR: Record<string, string> = {
  complete: '#059669', overtime: '#3b82f6',
  below: '#dc2626', incomplete: '#f59e0b', empty: '#8E8E93',
  absent: '#5a5a60', partial_absent: '#b45309',
  negative: '#991b1b', pending: '#94a3b8',
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

  const [allRecords, setAllRecords] = useState<PontoRecord[]>([])
  // Mapa usuario_id -> ISO da primeira batida histórica (qualquer mês).
  // Dias antes disso não aparecem na tabela.
  const [firstByUser, setFirstByUser] = useState<Record<string, string>>({})
  const [jornadasMap, setJornadasMap] = useState<Record<string, Jornada>>({})
  const [minhaJornada, setMinhaJornada] = useState<Jornada>(DEFAULT_JORNADA_NGP)
  const [loading, setLoading]     = useState(false)

  // ─── Admin: lista de usuários pra modais + estado de modais abertos ──────
  const [usuariosOpts, setUsuariosOpts] = useState<UsuarioOpt[]>([])

  type ModalState =
    | { kind: 'absence'; usuarioId?: string; data?: string; tipoSugerido?: string }
    | { kind: 'batida_create'; usuarioId?: string; data?: string }
    | {
        kind: 'batida_edit'
        record: {
          id: string
          usuario_id: string
          tipo_registro: string
          created_at: string
          observacao?: string | null
        }
      }
    | {
        kind: 'manage_anexo'
        record: {
          id: string
          observacao?: string | null
          anexo_path?: string | null
          anexo_mime?: string | null
          anexo_size?: number | null
        }
      }
    | null
  const [modal, setModal] = useState<ModalState>(null)

  // Estado do menu "Mais" — qual linha está aberta e em que posição (px).
  const [maisMenu, setMaisMenu] = useState<{
    rowKey: string
    x: number
    y: number
  } | null>(null)

  // Auth
  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    const admin = s.role === 'admin'
    setIsAdmin(admin)
    setSess(s)
  }, [router])

  const fetchRegistros = useCallback(async (mes: number, ano: number, adminUsersIds?: string[]) => {
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
        setFirstByUser(data.first_by_user || {})

        // Busca jornadas: union(usuários dos records, usuários ativos quando admin).
        const idsFromRecords = records.map(r => r.usuario_id)
        const ids = Array.from(new Set([...idsFromRecords, ...(adminUsersIds || [])])).filter(Boolean)
        let jornadasResp: Record<string, Jornada> = {}
        if (ids.length > 0) {
          try {
            const jr = await fetch(`${SURL}/functions/v1/pessoas-jornada`, {
              method: 'POST', headers: efHeaders(),
              body: JSON.stringify({ session_token: s.session, action: 'obter_bulk', usuario_ids: ids }),
            })
            const jd = await jr.json()
            if (jd?.jornadas) jornadasResp = jd.jornadas as Record<string, Jornada>
          } catch { /* silencioso — usa default */ }
        }
        setJornadasMap(jornadasResp)

        // Jornada do próprio usuário pro card "Meu ponto hoje".
        if (s.role !== 'admin') {
          const jornadaKeys = Object.keys(jornadasResp)
          if (jornadaKeys.length === 1) setMinhaJornada(jornadasResp[jornadaKeys[0]])
          else setMinhaJornada(DEFAULT_JORNADA_NGP)
        }

        setAllRecords(records)
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

  // Carrega lista de usuários (uma vez) pro modal — só admin precisa.
  const fetchUsuarios = useCallback(async () => {
    const s = getSession()
    if (!s) return
    try {
      const res = await fetch(`${SURL}/functions/v1/pessoas-ponto-import`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, action: 'listar_usuarios' }),
      })
      const data = await res.json()
      if (data?.usuarios) {
        setUsuariosOpts(data.usuarios.map((u: { id: string; nome: string }) => ({
          id: u.id, nome: u.nome,
        })))
      }
    } catch { /* silencioso */ }
  }, [])

  useEffect(() => {
    if (!sess) return
    fetchToday()
    const adminIds = isAdmin ? usuariosOpts.map(u => u.id) : undefined
    fetchRegistros(selMes, selAno, adminIds)
    if (isAdmin && usuariosOpts.length === 0) fetchUsuarios()
  }, [sess, selMes, selAno, fetchToday, isAdmin, usuariosOpts, fetchUsuarios, fetchRegistros])

  const reload = useCallback(() => {
    const adminIds = isAdmin ? usuariosOpts.map(u => u.id) : undefined
    fetchRegistros(selMes, selAno, adminIds)
    fetchToday()
  }, [fetchRegistros, fetchToday, selMes, selAno, isAdmin, usuariosOpts])

  // Lista de usuários pra sintetizar dias do mês:
  //  - admin: todos ativos
  //  - não-admin: só o próprio (extraído dos records, ou fallback do sess)
  const usuariosParaSintetizar = useMemo<{ id: string; nome: string }[]>(() => {
    if (isAdmin) return usuariosOpts
    if (!sess) return []
    // Tenta achar o nome nos records; senão usa o username.
    const fromRec = allRecords.find(r => r.usuario_id === sess.user)
    const nome = fromRec?.usuario_nome || sess.username || sess.user
    return [{ id: sess.user, nome }]
  }, [isAdmin, usuariosOpts, sess, allRecords])

  const allRows = useMemo<DayRow[]>(() => {
    if (usuariosParaSintetizar.length === 0) return []
    return buildMonthRows(
      allRecords, selMes, selAno,
      usuariosParaSintetizar, jornadasMap, firstByUser,
    )
  }, [allRecords, selMes, selAno, usuariosParaSintetizar, jornadasMap, firstByUser])

  // Fechar menu "Mais" ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!maisMenu) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t && t.closest('[data-mais-menu]')) return
      setMaisMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaisMenu(null)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [maisMenu])

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
    // FDS sem nada = ruído visual, não aparece. Dia útil 'negative' aparece sim.
    if (r.status === 'empty') return false
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
  // Dias considerados pra agregação:
  //  - 'empty' (FDS sem nada), 'absent' (ausência total) e 'pending' (hoje/futuro
  //    sem registro) NÃO entram.
  //  - 'negative' (dia útil passado sem registro) ENTRA — vai pra totalNegativas.
  //  - 'partial_absent' entra normalmente.
  const diasAtivos = rows.filter(r =>
    r.status !== 'empty' && r.status !== 'absent' && r.status !== 'pending'
  )
  const totalHoras = diasAtivos.reduce((acc, r) => acc + r.totalMins, 0)
  const totalExtras = diasAtivos.reduce((acc, r) => acc + r.extrasMins, 0)
  const totalNegativas = diasAtivos.reduce((acc, r) => {
    const target = targetForRow(r)
    if (target === 0) return acc
    const diff = r.totalMins - target  // negative tem totalMins=0, então diff = -target
    return acc + (diff < 0 ? -diff : 0)
  }, 0)
  const saldoMins = totalExtras - totalNegativas
  const diasCompletos = rows.filter(r => r.status === 'complete' || r.status === 'overtime').length
  const diasAbaixo    = rows.filter(r => r.status === 'below').length
  const diasIncompletos = rows.filter(r => r.status === 'incomplete').length
  const diasSemRegistro = rows.filter(r => r.status === 'negative').length
  // "Ausências" = dias com qualquer marcação de ausência (total ou parcial).
  const diasAusencias = rows.filter(r => r.hasAusencia).length

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
                  { id: 'negative', label: 'Sem registro' },
                  { id: 'pending', label: 'Em aberto' },
                  { id: 'absent', label: 'Ausência' },
                  { id: 'partial_absent', label: 'Ausência parcial' },
                ]}
                onChange={setFilterStatus}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isAdmin && (
                <>
                  <button
                    className={styles.btnNew}
                    onClick={() => setModal({ kind: 'absence' })}
                    title="Marcar atestado, feriado, folga ou falta justificada"
                  >
                    + Marcar ausência
                  </button>
                  <button
                    className={styles.btnNew}
                    style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}
                    onClick={() => setModal({ kind: 'batida_create' })}
                    title="Adicionar batida manual"
                  >
                    + Adicionar batida
                  </button>
                </>
              )}
              <button className={styles.btnExport} onClick={exportCSV} disabled={rows.length === 0}>
                <IcoDownload /> Exportar CSV
              </button>
            </div>
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
            <div className={styles.card}>
              <div className={styles.cardValue} style={{color:'#991b1b'}}>{diasSemRegistro}</div>
              <div className={styles.cardLabel}>Sem registro</div>
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
                      {isAdmin && <th>Ações</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      // Constrói o handler de clique numa célula de batida.
                      const onCellClick = (tipo: TipoRegistro) => {
                        if (!isAdmin) return
                        const rec = row.recordsByTipo[tipo]
                        if (rec) {
                          setModal({
                            kind: 'batida_edit',
                            record: {
                              id: rec.id,
                              usuario_id: row.usuarioId,
                              tipo_registro: tipo,
                              created_at: rec.created_at,
                              observacao: rec.observacao,
                            },
                          })
                        } else {
                          // célula vazia → abre modo create pré-preenchido
                          setModal({
                            kind: 'batida_create',
                            usuarioId: row.usuarioId,
                            data: row.dateStr,
                          })
                        }
                      }
                      const cellCls = isAdmin ? styles.cellEditable : undefined

                      const [yy, mm, dd] = row.dateStr.split('-').map(Number)
                      const dow = new Date(Date.UTC(yy, mm - 1, dd, 12)).getUTCDay()
                      const isFds = dow === 0 || dow === 6

                      return (
                        <tr key={row.key}>
                          {isAdmin && <td className={styles.tdUser}>{row.usuarioNome}</td>}
                          <td className={styles.tdDate}>{row.dateLabel}</td>
                          <td className={cellCls} onClick={() => onCellClick('entrada')}>
                            {row.entrada || <span className={styles.empty2}>--:--</span>}
                          </td>
                          <td className={cellCls} onClick={() => onCellClick('saida_almoco')}>
                            {row.saidaAlmoco || <span className={styles.empty2}>--:--</span>}
                          </td>
                          <td className={cellCls} onClick={() => onCellClick('retorno_almoco')}>
                            {row.retornoAlmoco || <span className={styles.empty2}>--:--</span>}
                          </td>
                          <td className={cellCls} onClick={() => onCellClick('saida')}>
                            {row.saida || <span className={styles.empty2}>--:--</span>}
                          </td>
                          <td className={styles.tdExtraCol}>
                            {row.extraEntrada || <span className={styles.empty2}>--:--</span>}
                          </td>
                          <td className={styles.tdExtraCol}>
                            {row.extraSaida || <span className={styles.empty2}>--:--</span>}
                          </td>
                          <td className={styles.tdTotal}>
                            {row.status === 'negative' ? (
                              <span style={{ color: '#991b1b', fontWeight: 600 }}>
                                −{fmtMins(targetForRow(row))}
                              </span>
                            ) : row.status === 'pending' ? (
                              <span className={styles.empty2}>—</span>
                            ) : row.totalMins > 0 ? (
                              fmtMins(row.totalMins)
                            ) : (
                              <span className={styles.empty2}>--</span>
                            )}
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
                            {row.hasAusencia && row.observacaoAusencia && (
                              <div className={styles.absentNote}>{row.observacaoAusencia}</div>
                            )}
                            {isAdmin && row.hasAusencia && row.recordsByTipo.ausencia && (
                              <button
                                type="button"
                                className={styles.linkAnexo}
                                onClick={() => setModal({
                                  kind: 'manage_anexo',
                                  record: {
                                    id: row.recordsByTipo.ausencia!.id,
                                    observacao: row.recordsByTipo.ausencia!.observacao,
                                    anexo_path: row.recordsByTipo.ausencia!.anexo_path,
                                    anexo_mime: row.recordsByTipo.ausencia!.anexo_mime,
                                    anexo_size: row.recordsByTipo.ausencia!.anexo_size,
                                  },
                                })}
                                title={row.recordsByTipo.ausencia!.anexo_path
                                  ? 'Ver/gerenciar anexo'
                                  : 'Anexar atestado/justificativa'}
                              >
                                {row.recordsByTipo.ausencia!.anexo_path ? '📎 Anexo' : '+ Anexo'}
                              </button>
                            )}
                          </td>
                          {isAdmin && (
                            <td>
                              <button
                                data-mais-menu
                                className={styles.btnAction}
                                title="Mais ações"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (maisMenu?.rowKey === row.key) {
                                    setMaisMenu(null)
                                    return
                                  }
                                  const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                                  setMaisMenu({
                                    rowKey: row.key,
                                    x: rect.right - 220, // 220px = largura do menu
                                    y: rect.bottom + 4,
                                  })
                                }}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
                                  <circle cx="12" cy="5" r="1"/>
                                  <circle cx="12" cy="12" r="1"/>
                                  <circle cx="12" cy="19" r="1"/>
                                </svg>
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

        </div>
      </main>

      {isAdmin && modal?.kind === 'absence' && (
        <AusenciaModal
          usuarios={usuariosOpts}
          defaultUsuarioId={modal.usuarioId}
          defaultData={modal.data}
          defaultTipo={modal.tipoSugerido}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}
      {isAdmin && modal?.kind === 'batida_create' && (
        <BatidaModal
          mode="create"
          usuarios={usuariosOpts}
          defaultUsuarioId={modal.usuarioId}
          defaultData={modal.data}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}
      {isAdmin && modal?.kind === 'batida_edit' && (
        <BatidaModal
          mode="edit"
          usuarios={usuariosOpts}
          record={modal.record}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}
      {isAdmin && modal?.kind === 'manage_anexo' && (
        <AusenciaModal
          usuarios={usuariosOpts}
          manageRecord={modal.record}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}

      {isAdmin && maisMenu && (() => {
        const row = allRows.find(r => r.key === maisMenu.rowKey)
        if (!row) return null
        const [yy, mm, dd] = row.dateStr.split('-').map(Number)
        const dow = new Date(Date.UTC(yy, mm - 1, dd, 12)).getUTCDay()
        const isFds = dow === 0 || dow === 6
        const ausenciaRec = row.recordsByTipo.ausencia

        const closeAndDo = (fn: () => void) => () => { setMaisMenu(null); fn() }

        const openAusencia = (tipoSugerido?: string) => closeAndDo(() => {
          setModal({
            kind: 'absence',
            usuarioId: row.usuarioId,
            data: row.dateStr,
            tipoSugerido,
          })
        })

        return (
          <div
            data-mais-menu
            className={styles.maisMenu}
            style={{ left: maisMenu.x, top: maisMenu.y }}
          >
            <div className={styles.maisMenuHeader}>{row.dateLabel} · {row.usuarioNome}</div>

            <button
              type="button"
              className={styles.maisMenuItem}
              onClick={closeAndDo(() => setModal({
                kind: 'batida_create',
                usuarioId: row.usuarioId,
                data: row.dateStr,
              }))}
            >
              <span>＋</span> Adicionar batida
            </button>

            {!isFds && (
              <>
                <div className={styles.maisMenuDivider}/>
                <button type="button" className={styles.maisMenuItem} onClick={openAusencia('atestado')}>
                  <span>🩺</span> Marcar atestado
                </button>
                <button type="button" className={styles.maisMenuItem} onClick={openAusencia('feriado')}>
                  <span>📅</span> Marcar feriado
                </button>
                <button type="button" className={styles.maisMenuItem} onClick={openAusencia('folga')}>
                  <span>🏖</span> Marcar folga
                </button>
                <button type="button" className={styles.maisMenuItem} onClick={openAusencia('falta_justificada')}>
                  <span>⚠</span> Marcar falta justificada
                </button>
              </>
            )}

            {ausenciaRec && (
              <>
                <div className={styles.maisMenuDivider}/>
                <button
                  type="button"
                  className={styles.maisMenuItem}
                  onClick={closeAndDo(() => setModal({
                    kind: 'manage_anexo',
                    record: {
                      id: ausenciaRec.id,
                      observacao: ausenciaRec.observacao,
                      anexo_path: ausenciaRec.anexo_path,
                      anexo_mime: ausenciaRec.anexo_mime,
                      anexo_size: ausenciaRec.anexo_size,
                    },
                  }))}
                >
                  <span>📎</span> {ausenciaRec.anexo_path ? 'Ver/gerenciar anexo' : 'Anexar arquivo'}
                </button>
              </>
            )}
          </div>
        )
      })()}
    </div>
  )
}
