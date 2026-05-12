'use client'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import CustomSelect from '@/components/CustomSelect'
import CustomDatePicker from '@/components/CustomDatePicker'
import NGPLoading from '@/components/NGPLoading'
import styles from './carreira.module.css'

interface DashboardCardData {
  total_colaboradores: number
  total_horas_semana_mins: number
  total_horas_mes_mins: number
  total_funcoes: number
}

interface DashboardDistribution {
  label: string
  count: number
}

interface DashboardColaborador {
  id: string
  nome: string
  username: string
  email?: string | null
  ativo?: boolean
  foto_url?: string | null
  setor?: string | null
  data_entrada?: string | null
  cargo?: string | null
  funcao?: string | null
  senioridade?: string | null
  gestor_usuario?: string | null
  objetivo_profissional_resumo?: string | null
  horas_semana_mins: number
  horas_mes_mins: number
}

interface DashboardResponse {
  cards: DashboardCardData
  distribuicoes: {
    por_funcao: DashboardDistribution[]
    por_cargo: DashboardDistribution[]
    por_senioridade: DashboardDistribution[]
  }
  colaboradores: DashboardColaborador[]
}

interface CadastroItem {
  id: string
  tipo: 'cargo' | 'funcao' | 'senioridade'
  nome: string
  ativo: boolean
  created_at: string
  updated_at: string
}

interface CadastrosResponse {
  cargos: CadastroItem[]
  funcoes: CadastroItem[]
  senioridades: CadastroItem[]
}

interface ReuniaoCarreira {
  id: string
  usuario_id: string
  data_reuniao: string
  titulo: string | null
  pontos_fortes: string | null
  pontos_melhoria: string | null
  swot_forcas: string | null
  swot_fraquezas: string | null
  swot_oportunidades: string | null
  swot_ameacas: string | null
  objetivos_pessoais: string | null
  apoio_ngp: string | null
  combinados_proximo_ciclo: string | null
  notas_livres: string | null
  status: 'anotado' | 'agendado' | 'publicado'
  apresentado_em: string | null
  created_at: string
  updated_at: string
}

interface PerfilColaborador extends Omit<DashboardColaborador, 'horas_semana_mins' | 'horas_mes_mins'> {}

interface ColaboradorResponse {
  colaborador: PerfilColaborador
  horas_semana_mins: number
  horas_mes_mins: number
  reunioes: ReuniaoCarreira[]
}

interface ColaboradorForm {
  setor: string
  data_entrada: string
  foto_url: string
  cargo: string
  funcao: string
  senioridade: string
  gestor_usuario: string
  objetivo_profissional_resumo: string
}

interface ReuniaoForm {
  id?: string
  data_reuniao: string
  titulo: string
  pontos_fortes: string
  pontos_melhoria: string
  swot_forcas: string
  swot_fraquezas: string
  swot_oportunidades: string
  swot_ameacas: string
  objetivos_pessoais: string
  apoio_ngp: string
  combinados_proximo_ciclo: string
  notas_livres: string
  status: 'anotado' | 'agendado' | 'publicado'
  apresentado_em?: string | null
}

interface NovoColaboradorForm {
  data_entrada: string
  nome: string
  email: string
  password: string
  foto_url: string
  setor: string
  cargo: string
  funcao: string
  senioridade: string
}

interface UsuarioAcessoForm {
  nome: string
  email: string
  password: string
  ativo: boolean
}

const EMPTY_FORM: ColaboradorForm = {
  setor: '',
  data_entrada: '',
  foto_url: '',
  cargo: '',
  funcao: '',
  senioridade: '',
  gestor_usuario: '',
  objetivo_profissional_resumo: '',
}

const EMPTY_NOVO_COLABORADOR: NovoColaboradorForm = {
  data_entrada: new Date().toISOString().split('T')[0],
  nome: '',
  email: '',
  password: '',
  foto_url: '',
  setor: '',
  cargo: '',
  funcao: '',
  senioridade: '',
}

const EMPTY_USUARIO_ACESSO: UsuarioAcessoForm = {
  nome: '',
  email: '',
  password: '',
  ativo: true,
}

const EMPTY_REUNIAO_FORM = (): ReuniaoForm => ({
  id: undefined,
  data_reuniao: new Date().toISOString().split('T')[0],
  titulo: '',
  pontos_fortes: '',
  pontos_melhoria: '',
  swot_forcas: '',
  swot_fraquezas: '',
  swot_oportunidades: '',
  swot_ameacas: '',
  objetivos_pessoais: '',
  apoio_ngp: '',
  combinados_proximo_ciclo: '',
  notas_livres: '',
  status: 'anotado',
  apresentado_em: null,
})

function fmtMins(mins: number): string {
  if (!mins || mins <= 0) return '--'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h${m.toString().padStart(2, '0')}m`
}

function fmtDate(dateStr?: string | null): string {
  if (!dateStr) return '--'
  const date = new Date(`${dateStr}T12:00:00`)
  return date.toLocaleDateString('pt-BR')
}

function previewText(value?: string | null, fallback = '--'): string {
  const text = (value || '').trim()
  if (!text) return fallback
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

function swotPreview(reuniao: ReuniaoCarreira): string {
  const parts = [
    reuniao.swot_forcas && `Forças: ${reuniao.swot_forcas}`,
    reuniao.swot_fraquezas && `Fraquezas: ${reuniao.swot_fraquezas}`,
    reuniao.swot_oportunidades && `Oportunidades: ${reuniao.swot_oportunidades}`,
    reuniao.swot_ameacas && `Ameaças: ${reuniao.swot_ameacas}`,
  ].filter(Boolean)

  return previewText(parts.join(' · '))
}

function toColaboradorForm(colaborador?: PerfilColaborador | null): ColaboradorForm {
  if (!colaborador) return EMPTY_FORM
  return {
    setor: colaborador.setor || '',
    data_entrada: colaborador.data_entrada || '',
    foto_url: colaborador.foto_url || '',
    cargo: colaborador.cargo || '',
    funcao: colaborador.funcao || '',
    senioridade: colaborador.senioridade || '',
    gestor_usuario: colaborador.gestor_usuario || '',
    objetivo_profissional_resumo: colaborador.objetivo_profissional_resumo || '',
  }
}

function toUsuarioAcessoForm(colaborador?: PerfilColaborador | null): UsuarioAcessoForm {
  if (!colaborador) return EMPTY_USUARIO_ACESSO
  return {
    nome: colaborador.nome || '',
    email: colaborador.email || colaborador.username || '',
    password: '',
    ativo: colaborador.ativo !== false,
  }
}

function toReuniaoForm(reuniao: ReuniaoCarreira): ReuniaoForm {
  return {
    id: reuniao.id,
    data_reuniao: reuniao.data_reuniao,
    titulo: reuniao.titulo || '',
    pontos_fortes: reuniao.pontos_fortes || '',
    pontos_melhoria: reuniao.pontos_melhoria || '',
    swot_forcas: reuniao.swot_forcas || '',
    swot_fraquezas: reuniao.swot_fraquezas || '',
    swot_oportunidades: reuniao.swot_oportunidades || '',
    swot_ameacas: reuniao.swot_ameacas || '',
    objetivos_pessoais: reuniao.objetivos_pessoais || '',
    apoio_ngp: reuniao.apoio_ngp || '',
    combinados_proximo_ciclo: reuniao.combinados_proximo_ciclo || '',
    notas_livres: reuniao.notas_livres || '',
    status: reuniao.status || 'anotado',
    apresentado_em: reuniao.apresentado_em || null,
  }
}

const IcoRelogio = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
)

const IcoTabela = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>
  </svg>
)

const IcoCarreira = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <path d="M12 20h9"/>
    <path d="M12 4h9"/>
    <path d="M4 9h16"/>
    <path d="M4 15h16"/>
    <path d="M8 4v16"/>
  </svg>
)

const IcoLixeira = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
  </svg>
)

export default function CarreiraPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [perfil, setPerfil] = useState<ColaboradorResponse | null>(null)
  const [perfilCache, setPerfilCache] = useState<Record<string, ColaboradorResponse>>({})
  const [loadingPerfil, setLoadingPerfil] = useState(false)
  const [perfilError, setPerfilError] = useState<string | null>(null)
  const [cadastros, setCadastros] = useState<CadastrosResponse>({ cargos: [], funcoes: [], senioridades: [] })
  const [colaboradorForm, setColaboradorForm] = useState<ColaboradorForm>(EMPTY_FORM)
  const [savingPerfil, setSavingPerfil] = useState(false)
  const [usuarioAcessoForm, setUsuarioAcessoForm] = useState<UsuarioAcessoForm>(EMPTY_USUARIO_ACESSO)
  const [savingUsuarioAcesso, setSavingUsuarioAcesso] = useState(false)

  // ── Jornada de trabalho do colaborador ─────────────────────────────────
  // Default NGP: seg-qui 9h, sex 8h, sáb/dom livres.
  const DEFAULT_JORNADA = { min_dom: 0, min_seg: 540, min_ter: 540, min_qua: 540, min_qui: 540, min_sex: 480, min_sab: 0 }
  const [jornadaForm, setJornadaForm] = useState<typeof DEFAULT_JORNADA>(DEFAULT_JORNADA)
  const [jornadaIsDefault, setJornadaIsDefault] = useState(true)
  const [loadingJornada, setLoadingJornada] = useState(false)
  const [savingJornada, setSavingJornada] = useState(false)
  const [creatingCollaborator, setCreatingCollaborator] = useState(false)
  const [novoColaboradorForm, setNovoColaboradorForm] = useState<NovoColaboradorForm>(EMPTY_NOVO_COLABORADOR)
  const [savingNewCollaborator, setSavingNewCollaborator] = useState(false)
  const [meetingForm, setMeetingForm] = useState<ReuniaoForm>(EMPTY_REUNIAO_FORM())
  const [savingMeeting, setSavingMeeting] = useState(false)
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null)
  const [showMeetingForm, setShowMeetingForm] = useState(false)
  const [feedbackTab, setFeedbackTab] = useState<'pending' | 'history'>('pending')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const showMeetingFormRef = useRef(false)
  const editingMeetingIdRef = useRef<string | null>(null)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'admin' && s.role !== 'ngp') { router.replace('/setores'); return }
    setSess(s)
  }, [router])

  const showMsg = useCallback((type: 'ok' | 'err', text: string) => {
    setMsg({ type, text })
    window.setTimeout(() => setMsg(null), 4500)
  }, [])

  useEffect(() => {
    showMeetingFormRef.current = showMeetingForm
  }, [showMeetingForm])

  useEffect(() => {
    editingMeetingIdRef.current = editingMeetingId
  }, [editingMeetingId])

  const fetchDashboard = useCallback(async (options?: { background?: boolean }) => {
    const s = getSession()
    if (!s) return
    if (!options?.background) {
      setLoadingDashboard(true)
      setDashboardError(null)
    }
    try {
      const res = await fetch(`${SURL}/functions/v1/admin-carreira-dashboard`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (data.error) {
        setDashboardError(data.error)
        return
      }
      setDashboard(data)
      setSelectedId((current: string) =>
        current && data.colaboradores?.some((colaborador: DashboardColaborador) => colaborador.id === current)
          ? current
          : ''
      )
    } catch {
      setDashboardError('Erro ao carregar dashboard de carreira.')
    } finally {
      setLoadingDashboard(false)
    }
  }, [])

  const fetchPerfil = useCallback(async (usuarioId: string, options?: { background?: boolean; preserveEditor?: boolean }) => {
    const s = getSession()
    if (!s || !usuarioId) return
    const cachedPerfil = perfilCache[usuarioId]

    if (!options?.background) {
      setPerfilError(null)
      if (cachedPerfil) {
        setPerfil(cachedPerfil)
        setColaboradorForm(toColaboradorForm(cachedPerfil.colaborador))
        setLoadingPerfil(false)
      } else {
        setLoadingPerfil(true)
      }
    }

    try {
      const res = await fetch(`${SURL}/functions/v1/admin-carreira-colaborador`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, usuario_id: usuarioId }),
      })
      const data = await res.json()
      if (data.error) {
        setPerfilError(data.error)
        return
      }
      startTransition(() => {
        setPerfilCache((current) => ({ ...current, [usuarioId]: data }))
      })
      setPerfil(data)
      setColaboradorForm(toColaboradorForm(data.colaborador))
      setUsuarioAcessoForm(toUsuarioAcessoForm(data.colaborador))
      const shouldPreserveCurrentEditor = showMeetingFormRef.current || !!editingMeetingIdRef.current
      if (!options?.preserveEditor && !shouldPreserveCurrentEditor) {
        setMeetingForm(EMPTY_REUNIAO_FORM())
        setEditingMeetingId(null)
        setShowMeetingForm(false)
      }
    } catch {
      setPerfilError('Erro ao carregar o perfil do colaborador.')
    } finally {
      if (!options?.background || !cachedPerfil) {
        setLoadingPerfil(false)
      }
    }
  }, [perfilCache])

  useEffect(() => {
    if (sess) fetchDashboard()
  }, [sess, fetchDashboard])

  const fetchCadastros = useCallback(async () => {
    const s = getSession()
    if (!s) return
    try {
      const res = await fetch(`${SURL}/functions/v1/admin-carreira-cadastros`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (data.error) return
      setCadastros({
        cargos: data.cargos || [],
        funcoes: data.funcoes || [],
        senioridades: data.senioridades || [],
      })
    } catch {
      // silencioso
    }
  }, [])

  useEffect(() => {
    if (sess) fetchCadastros()
  }, [sess, fetchCadastros])

  useEffect(() => {
    if (!sess || !selectedId) {
      setPerfil(null)
      setPerfilError(null)
      setColaboradorForm(EMPTY_FORM)
      setMeetingForm(EMPTY_REUNIAO_FORM())
      setEditingMeetingId(null)
      setShowMeetingForm(false)
      return
    }
    fetchPerfil(selectedId)
  }, [sess, selectedId, fetchPerfil])

  const filteredColaboradores = useMemo(() => {
    const term = search.trim().toLowerCase()
    const colaboradores = dashboard?.colaboradores || []
    if (!term) return colaboradores
    return colaboradores.filter((item) =>
      item.nome.toLowerCase().includes(term) ||
      item.username.toLowerCase().includes(term) ||
      (item.funcao || '').toLowerCase().includes(term) ||
      (item.cargo || '').toLowerCase().includes(term)
    )
  }, [dashboard, search])

  // Carrega jornada quando muda o colaborador selecionado.
  useEffect(() => {
    if (!selectedId) {
      // Resetar quando volta pro dashboard / nenhum selecionado.
      setJornadaForm(DEFAULT_JORNADA)
      setJornadaIsDefault(true)
      return
    }
    const s = getSession()
    if (!s) return
    setLoadingJornada(true)
    fetch(`${SURL}/functions/v1/pessoas-jornada`, {
      method: 'POST',
      headers: efHeaders(),
      body: JSON.stringify({ session_token: s.session, action: 'obter', usuario_id: selectedId }),
    })
      .then(r => r.json())
      .then(data => {
        if (data?.error) { setJornadaForm(DEFAULT_JORNADA); setJornadaIsDefault(true); return }
        const j = data?.jornada || DEFAULT_JORNADA
        setJornadaForm({
          min_dom: j.min_dom ?? 0, min_seg: j.min_seg ?? 540, min_ter: j.min_ter ?? 540,
          min_qua: j.min_qua ?? 540, min_qui: j.min_qui ?? 540, min_sex: j.min_sex ?? 480, min_sab: j.min_sab ?? 0,
        })
        setJornadaIsDefault(!!data?.is_default)
      })
      .catch(() => { setJornadaForm(DEFAULT_JORNADA); setJornadaIsDefault(true) })
      .finally(() => setLoadingJornada(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  async function salvarJornada(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId) return
    const s = getSession()
    if (!s) return
    setSavingJornada(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/pessoas-jornada`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, action: 'salvar', usuario_id: selectedId, jornada: jornadaForm }),
      })
      const data = await res.json()
      if (data?.error) { showMsg('err', data.error); return }
      setJornadaIsDefault(false)
      showMsg('ok', 'Jornada salva.')
    } finally {
      setSavingJornada(false)
    }
  }

  async function resetarJornada() {
    if (!selectedId) return
    if (!confirm('Resetar para a jornada padrão NGP (seg-qui 9h, sex 8h)?')) return
    const s = getSession()
    if (!s) return
    setSavingJornada(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/pessoas-jornada`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, action: 'resetar', usuario_id: selectedId }),
      })
      const data = await res.json()
      if (data?.error) { showMsg('err', data.error); return }
      setJornadaForm(DEFAULT_JORNADA)
      setJornadaIsDefault(true)
      showMsg('ok', 'Jornada resetada para o padrão.')
    } finally {
      setSavingJornada(false)
    }
  }

  // Helpers HH:MM ↔ minutos.
  function minsToHHMM(m: number): string {
    const hh = Math.floor(m / 60).toString().padStart(2, '0')
    const mm = (m % 60).toString().padStart(2, '0')
    return `${hh}:${mm}`
  }
  function hhmmToMins(s: string): number {
    const m = s.match(/^(\d{1,2}):(\d{1,2})$/)
    if (!m) return 0
    const h = Math.min(24, Math.max(0, Number(m[1])))
    const mi = Math.min(59, Math.max(0, Number(m[2])))
    return Math.min(1440, h * 60 + mi)
  }
  const totalSemanaMins = jornadaForm.min_dom + jornadaForm.min_seg + jornadaForm.min_ter + jornadaForm.min_qua + jornadaForm.min_qui + jornadaForm.min_sex + jornadaForm.min_sab

  const selectedDashboardColaborador = dashboard?.colaboradores.find((item) => item.id === selectedId) || null
  const isAdminUser = sess?.role === 'admin'
  const isResponsibleManager = !!(
    sess?.username &&
    perfil?.colaborador.gestor_usuario &&
    sess.username.trim().toLowerCase() === perfil.colaborador.gestor_usuario.trim().toLowerCase()
  )
  const canManageFeedback = !!(isAdminUser || isResponsibleManager)
  const canManageCollaboratorData = !!isAdminUser
  const canManageUserAccess = !!isAdminUser
  const canCreateCollaborator = !!isAdminUser

  const internalUsers = useMemo(() => {
    return (dashboard?.colaboradores || []).map((item) => item.username)
  }, [dashboard])

  const sectorNav = [
    { icon: <IcoRelogio />, label: 'Dashboard', href: '/pessoas' },
    { icon: <IcoTabela />, label: 'Registros de Ponto', href: '/pessoas/registros' },
    { icon: <IcoCarreira />, label: 'Colaboradores', href: '/pessoas/carreira' },
    ...(isAdminUser ? [
      { icon: <IcoTabela />, label: 'Cadastros', href: '/pessoas/cadastros' },
      { icon: <IcoLixeira />, label: 'Lixeira', href: '/pessoas/lixeira' },
    ] : []),
  ]

  const saveColaborador = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedId || savingPerfil || !canManageCollaboratorData) return
    const s = getSession()
    if (!s) return
    setSavingPerfil(true)
    const previousPerfil = perfil
    const previousCache = perfilCache[selectedId]
    setPerfil((current) => current ? {
      ...current,
      colaborador: {
        ...current.colaborador,
        ...colaboradorForm,
      },
    } : current)
    startTransition(() => {
      setPerfilCache((current) => current[selectedId] ? {
        ...current,
        [selectedId]: {
          ...current[selectedId],
          colaborador: {
            ...current[selectedId].colaborador,
            ...colaboradorForm,
          },
        },
      } : current)
    })
    try {
      const res = await fetch(`${SURL}/functions/v1/admin-carreira-upsert-colaborador`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({
          session_token: s.session,
          usuario_id: selectedId,
          ...colaboradorForm,
        }),
      })
      const data = await res.json()
      if (data.error) {
        if (previousPerfil) setPerfil(previousPerfil)
        startTransition(() => {
          setPerfilCache((current) => previousCache ? { ...current, [selectedId]: previousCache } : current)
        })
        showMsg('err', data.error)
        return
      }
      showMsg('ok', 'Dados de carreira atualizados.')
      void fetchDashboard({ background: true })
      void fetchPerfil(selectedId, { background: true, preserveEditor: true })
    } catch {
      if (previousPerfil) setPerfil(previousPerfil)
      startTransition(() => {
        setPerfilCache((current) => previousCache ? { ...current, [selectedId]: previousCache } : current)
      })
      showMsg('err', 'Erro ao salvar dados do colaborador.')
    } finally {
      setSavingPerfil(false)
    }
  }

  const saveReuniao = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedId || savingMeeting) return
    const s = getSession()
    if (!s) return
    setSavingMeeting(true)
    const previousPerfil = perfil
    const previousCache = perfilCache[selectedId]
    const now = new Date().toISOString()
    const optimisticMeeting: ReuniaoCarreira = {
      id: meetingForm.id || `temp-${Date.now()}`,
      usuario_id: selectedId,
      data_reuniao: meetingForm.data_reuniao,
      titulo: meetingForm.titulo || null,
      pontos_fortes: meetingForm.pontos_fortes || null,
      pontos_melhoria: meetingForm.pontos_melhoria || null,
      swot_forcas: meetingForm.swot_forcas || null,
      swot_fraquezas: meetingForm.swot_fraquezas || null,
      swot_oportunidades: meetingForm.swot_oportunidades || null,
      swot_ameacas: meetingForm.swot_ameacas || null,
      objetivos_pessoais: meetingForm.objetivos_pessoais || null,
      apoio_ngp: meetingForm.apoio_ngp || null,
      combinados_proximo_ciclo: meetingForm.combinados_proximo_ciclo || null,
      notas_livres: meetingForm.notas_livres || null,
      status: meetingForm.status,
      apresentado_em: meetingForm.status === 'publicado' ? now : null,
      created_at: previousPerfil?.reunioes.find((item) => item.id === meetingForm.id)?.created_at || now,
      updated_at: now,
    }
    const applyOptimisticMeeting = (base: ColaboradorResponse | null) => {
      if (!base) return base
      const reunioes = meetingForm.id
        ? base.reunioes.map((item) => item.id === meetingForm.id ? optimisticMeeting : item)
        : [optimisticMeeting, ...base.reunioes]
      return { ...base, reunioes }
    }
    setPerfil((current) => applyOptimisticMeeting(current))
    startTransition(() => {
      setPerfilCache((current) => current[selectedId] ? { ...current, [selectedId]: applyOptimisticMeeting(current[selectedId])! } : current)
    })
    setFeedbackTab(meetingForm.status === 'publicado' ? 'history' : 'pending')
    setMeetingForm(EMPTY_REUNIAO_FORM())
    setEditingMeetingId(null)
    setShowMeetingForm(false)
    try {
      const res = await fetch(`${SURL}/functions/v1/admin-carreira-upsert-reuniao`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({
          session_token: s.session,
          usuario_id: selectedId,
          ...meetingForm,
        }),
      })
      const data = await res.json()
      if (data.error) {
        if (previousPerfil) setPerfil(previousPerfil)
        startTransition(() => {
          setPerfilCache((current) => previousCache ? { ...current, [selectedId]: previousCache } : current)
        })
        setMeetingForm(meetingForm)
        setEditingMeetingId(meetingForm.id || null)
        setShowMeetingForm(true)
        showMsg('err', data.error)
        return
      }
      showMsg('ok', editingMeetingId ? 'Feedback atualizado.' : 'Feedback anotado.')
      void fetchPerfil(selectedId, { background: true })
    } catch {
      if (previousPerfil) setPerfil(previousPerfil)
      startTransition(() => {
        setPerfilCache((current) => previousCache ? { ...current, [selectedId]: previousCache } : current)
      })
      setMeetingForm(meetingForm)
      setEditingMeetingId(meetingForm.id || null)
      setShowMeetingForm(true)
      showMsg('err', 'Erro ao salvar reunião.')
    } finally {
      setSavingMeeting(false)
    }
  }

  const startEditMeeting = (reuniao: ReuniaoCarreira) => {
    setEditingMeetingId(reuniao.id)
    setMeetingForm(toReuniaoForm(reuniao))
    setShowMeetingForm(true)
  }

  const cancelEditMeeting = () => {
    setEditingMeetingId(null)
    setMeetingForm(EMPTY_REUNIAO_FORM())
    setShowMeetingForm(false)
  }

  const deleteMeeting = async (reuniao: ReuniaoCarreira) => {
    if (!selectedId || !sess || sess.role !== 'admin' || savingMeeting) return

    setSavingMeeting(true)
    const previousPerfil = perfil
    const previousCache = perfilCache[selectedId]
    const applyDelete = (base: ColaboradorResponse | null) => {
      if (!base) return base
      return {
        ...base,
        reunioes: base.reunioes.filter((item) => item.id !== reuniao.id),
      }
    }

    setPerfil((current) => applyDelete(current))
    startTransition(() => {
      setPerfilCache((current) => current[selectedId] ? { ...current, [selectedId]: applyDelete(current[selectedId])! } : current)
    })

    try {
      const res = await fetch(`${SURL}/functions/v1/admin-carreira-delete-reuniao`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({
          session_token: sess.session,
          id: reuniao.id,
        }),
      })
      const data = await res.json()
      if (data.error) {
        if (previousPerfil) setPerfil(previousPerfil)
        startTransition(() => {
          setPerfilCache((current) => previousCache ? { ...current, [selectedId]: previousCache } : current)
        })
        showMsg('err', data.error)
        return
      }
      showMsg('ok', 'Feedback excluído com sucesso.')
      void fetchPerfil(selectedId, { background: true, preserveEditor: true })
    } catch {
      if (previousPerfil) setPerfil(previousPerfil)
      startTransition(() => {
        setPerfilCache((current) => previousCache ? { ...current, [selectedId]: previousCache } : current)
      })
      showMsg('err', 'Erro ao excluir feedback.')
    } finally {
      setSavingMeeting(false)
    }
  }

  const startNewFeedback = () => {
    setEditingMeetingId(null)
    setMeetingForm(EMPTY_REUNIAO_FORM())
    setShowMeetingForm(true)
  }

  const createCollaborator = async (e: React.FormEvent) => {
    e.preventDefault()
    if (savingNewCollaborator || !canCreateCollaborator) return
    const s = getSession()
    if (!s) return

    setSavingNewCollaborator(true)
    try {
      const email = novoColaboradorForm.email.trim().toLowerCase()
      const res = await fetch(`${SURL}/functions/v1/admin-criar-usuario`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({
          session_token: s.session,
          nome: novoColaboradorForm.nome.trim(),
          username: email,
          email,
          password: novoColaboradorForm.password,
          role: 'ngp',
          foto_url: novoColaboradorForm.foto_url,
          setor: novoColaboradorForm.setor,
          data_entrada: novoColaboradorForm.data_entrada,
          cargo: novoColaboradorForm.cargo,
          funcao: novoColaboradorForm.funcao,
          senioridade: novoColaboradorForm.senioridade,
        }),
      })
      const data = await res.json()
      if (data.error) {
        showMsg('err', data.error)
        return
      }
      showMsg('ok', 'Colaborador criado com sucesso.')
      setNovoColaboradorForm(EMPTY_NOVO_COLABORADOR)
      setCreatingCollaborator(false)
      void fetchDashboard({ background: true })
    } catch {
      showMsg('err', 'Erro ao criar colaborador.')
    } finally {
      setSavingNewCollaborator(false)
    }
  }

  const updateMeetingStatus = async (
    reuniao: ReuniaoCarreira,
    nextStatus: ReuniaoCarreira['status'],
    successMessage: string,
    errorMessage: string
  ) => {
    if (!selectedId) return
    const s = getSession()
    if (!s) return
    setSavingMeeting(true)
    const previousPerfil = perfil
    const previousCache = perfilCache[selectedId]
    const apresentadoEm = new Date().toISOString()
    const applyStatusChange = (base: ColaboradorResponse | null) => {
      if (!base) return base
      return {
        ...base,
        reunioes: base.reunioes.map((item) =>
          item.id === reuniao.id
            ? ({
                ...item,
                status: nextStatus,
                apresentado_em: nextStatus === 'publicado' ? apresentadoEm : item.apresentado_em,
                updated_at: apresentadoEm,
              } satisfies ReuniaoCarreira)
            : item
        ),
      }
    }
    setPerfil((current) => applyStatusChange(current))
    startTransition(() => {
      setPerfilCache((current) => current[selectedId] ? { ...current, [selectedId]: applyStatusChange(current[selectedId])! } : current)
    })
    setFeedbackTab(nextStatus === 'publicado' ? 'history' : 'pending')
    try {
      const res = await fetch(`${SURL}/functions/v1/admin-carreira-upsert-reuniao`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({
          session_token: s.session,
          id: reuniao.id,
          usuario_id: selectedId,
          data_reuniao: reuniao.data_reuniao,
          titulo: reuniao.titulo,
          pontos_fortes: reuniao.pontos_fortes,
          pontos_melhoria: reuniao.pontos_melhoria,
          swot_forcas: reuniao.swot_forcas,
          swot_fraquezas: reuniao.swot_fraquezas,
          swot_oportunidades: reuniao.swot_oportunidades,
          swot_ameacas: reuniao.swot_ameacas,
          objetivos_pessoais: reuniao.objetivos_pessoais,
          apoio_ngp: reuniao.apoio_ngp,
          combinados_proximo_ciclo: reuniao.combinados_proximo_ciclo,
          notas_livres: reuniao.notas_livres,
          status: nextStatus,
          apresentado_em: nextStatus === 'publicado' ? apresentadoEm : reuniao.apresentado_em,
        }),
      })
      const data = await res.json()
      if (data.error) {
        if (previousPerfil) setPerfil(previousPerfil)
        startTransition(() => {
          setPerfilCache((current) => previousCache ? { ...current, [selectedId]: previousCache } : current)
        })
        setFeedbackTab(reuniao.status === 'publicado' ? 'history' : 'pending')
        showMsg('err', data.error)
        return
      }
      showMsg('ok', successMessage)
      void fetchPerfil(selectedId, { background: true, preserveEditor: true })
    } catch {
      if (previousPerfil) setPerfil(previousPerfil)
      startTransition(() => {
        setPerfilCache((current) => previousCache ? { ...current, [selectedId]: previousCache } : current)
      })
      setFeedbackTab(reuniao.status === 'publicado' ? 'history' : 'pending')
      showMsg('err', errorMessage)
    } finally {
      setSavingMeeting(false)
    }
  }

  const scheduleFeedback = (reuniao: ReuniaoCarreira) =>
    updateMeetingStatus(reuniao, 'agendado', 'Feedback agendado para apresentação.', 'Erro ao agendar feedback.')

  const publishFeedback = (reuniao: ReuniaoCarreira) =>
    updateMeetingStatus(reuniao, 'publicado', 'Feedback publicado com sucesso.', 'Erro ao publicar feedback.')

  const saveUsuarioAcesso = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedId || savingUsuarioAcesso) return
    const s = getSession()
    if (!s) return

    setSavingUsuarioAcesso(true)
    const previousPerfil = perfil
    const previousCache = perfilCache[selectedId]
    const email = usuarioAcessoForm.email.trim().toLowerCase()
    const nome = usuarioAcessoForm.nome.trim()

    const applyUserAccess = (base: ColaboradorResponse | null) => {
      if (!base) return base
      return {
        ...base,
        colaborador: {
          ...base.colaborador,
          nome,
          email,
          username: email,
        },
      }
    }

    setPerfil((current) => applyUserAccess(current))
    startTransition(() => {
      setPerfilCache((current) => current[selectedId] ? { ...current, [selectedId]: applyUserAccess(current[selectedId])! } : current)
    })

    try {
      const res = await fetch(`${SURL}/functions/v1/admin-update-usuario`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({
          session_token: s.session,
          usuario_id: selectedId,
          nome,
          email,
          password: usuarioAcessoForm.password.trim() || undefined,
          ativo: usuarioAcessoForm.ativo,
        }),
      })
      const data = await res.json()
      if (data.error) {
        if (previousPerfil) setPerfil(previousPerfil)
        startTransition(() => {
          setPerfilCache((current) => previousCache ? { ...current, [selectedId]: previousCache } : current)
        })
        showMsg('err', data.error)
        return
      }
      setUsuarioAcessoForm((prev) => ({ ...prev, password: '' }))
      showMsg('ok', 'Usuário de acesso atualizado.')
      void fetchDashboard({ background: true })
      void fetchPerfil(selectedId, { background: true, preserveEditor: true })
    } catch {
      if (previousPerfil) setPerfil(previousPerfil)
      startTransition(() => {
        setPerfilCache((current) => previousCache ? { ...current, [selectedId]: previousCache } : current)
      })
      showMsg('err', 'Erro ao atualizar usuário.')
    } finally {
      setSavingUsuarioAcesso(false)
    }
  }

  const returnToDashboard = () => {
    setSelectedId('')
    if (!canCreateCollaborator) {
      setCreatingCollaborator(false)
    }
    setPerfil(null)
    setPerfilError(null)
    setColaboradorForm(EMPTY_FORM)
    setMeetingForm(EMPTY_REUNIAO_FORM())
    setEditingMeetingId(null)
  }

  if (!sess) return <NGPLoading loading loadingText="Carregando carreira..." />

  const pendingMeetings = (perfil?.reunioes || []).filter((reuniao) => reuniao.status !== 'publicado')
  const historyMeetings = (perfil?.reunioes || []).filter((reuniao) => reuniao.status === 'publicado')
  const activeMeetings = feedbackTab === 'pending' ? pendingMeetings : historyMeetings

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal sectorNav={sectorNav} sectorNavTitle="PESSOAS" />

      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <button className={styles.btnBack} onClick={() => router.push('/pessoas')}>
              ← Pessoas
            </button>
            <div className={styles.eyebrow}>Setor · Pessoas · {isAdminUser ? 'Admin' : 'Gestor'}</div>
            <h1 className={styles.title}>Colaboradores</h1>
            <p className={styles.subtitle}>
              Gestão de colaboradores, criação de acessos e perfil privado de acompanhamento por colaborador.
            </p>
          </header>

          {msg && (
            <div className={`${styles.msgBar} ${msg.type === 'ok' ? styles.msgOk : styles.msgErr}`}>
              {msg.type === 'ok' ? '✓ ' : '✕ '}{msg.text}
            </div>
          )}

          {loadingDashboard ? (
            <section className={styles.loadingPanel}>Carregando dashboard de carreira...</section>
          ) : dashboardError ? (
            <section className={styles.errorPanel}>{dashboardError}</section>
          ) : (
            <>
              {!selectedId && !creatingCollaborator ? (
                <>
                  <section className={styles.panel}>
                    <div className={styles.panelHeader}>
                      <h3 className={styles.panelTitle}>Colaboradores</h3>
                      <span className={styles.panelHint}>Abrir perfil privado</span>
                    </div>
                    <div className={styles.feedbackToolbar}>
                      <div className={styles.panelHint}>{isAdminUser ? 'Equipe ativa da NGP' : 'Colaboradores sob sua gestão'}</div>
                      {canCreateCollaborator && (
                        <button className={styles.btnPrimary} type="button" onClick={() => setCreatingCollaborator(true)}>
                          Cadastrar novo colaborador
                        </button>
                      )}
                    </div>

                    <div className={styles.searchBox}>
                      <input
                        className={styles.searchInput}
                        placeholder="Buscar por nome, e-mail, função ou cargo"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <div className={styles.collaboratorsGrid}>
                      {filteredColaboradores.length === 0 ? (
                        <div className={styles.emptyState}>Nenhum colaborador encontrado.</div>
                      ) : (
                        filteredColaboradores.map((colaborador) => (
                          <button
                            key={colaborador.id}
                            type="button"
                            className={styles.collaboratorTile}
                            onClick={() => setSelectedId(colaborador.id)}
                          >
                            <span className={styles.collaboratorTileName}>{colaborador.nome}</span>
                            <span className={styles.collaboratorTileMeta}>
                              {(colaborador.funcao || 'Sem função')} · {(colaborador.cargo || 'Sem cargo')} · {fmtMins(colaborador.horas_mes_mins)}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </section>

                </>
              ) : creatingCollaborator && canCreateCollaborator ? (
                <section className={styles.profileStack}>
                  <div className={styles.profileBackRow}>
                    <button className={styles.btnSecondary} type="button" onClick={returnToDashboard}>
                      ← Voltar para colaboradores
                    </button>
                  </div>

                  <section className={styles.panel}>
                    <div className={styles.panelHeader}>
                      <h3 className={styles.panelTitle}>Cadastrar novo colaborador</h3>
                      <span className={styles.panelHint}>Criação de acesso no sistema</span>
                    </div>
                    <form className={styles.formSection} onSubmit={createCollaborator}>
                      <div className={styles.formGrid}>
                        <div className={styles.field}>
                          <CustomDatePicker
                            caption="Data de entrada"
                            value={novoColaboradorForm.data_entrada}
                            onChange={(val) => setNovoColaboradorForm((prev) => ({ ...prev, data_entrada: val }))}
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Nome completo</label>
                          <input
                            value={novoColaboradorForm.nome}
                            onChange={(e) => setNovoColaboradorForm((prev) => ({ ...prev, nome: e.target.value }))}
                            placeholder="Ex: Nathalli Santos"
                            required
                          />
                        </div>
                        <div className={styles.field}>
                          <label>E-mail oficial</label>
                          <input
                            type="email"
                            value={novoColaboradorForm.email}
                            onChange={(e) => setNovoColaboradorForm((prev) => ({ ...prev, email: e.target.value }))}
                            placeholder="nome@sejangp.com.br"
                            required
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Primeira senha</label>
                          <input
                            type="password"
                            minLength={6}
                            value={novoColaboradorForm.password}
                            onChange={(e) => setNovoColaboradorForm((prev) => ({ ...prev, password: e.target.value }))}
                            placeholder="Senha temporária para o primeiro acesso"
                            required
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Foto de perfil</label>
                          <input
                            value={novoColaboradorForm.foto_url}
                            onChange={(e) => setNovoColaboradorForm((prev) => ({ ...prev, foto_url: e.target.value }))}
                            placeholder="URL da foto (opcional)"
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Setor</label>
                          <input
                            value={novoColaboradorForm.setor}
                            onChange={(e) => setNovoColaboradorForm((prev) => ({ ...prev, setor: e.target.value }))}
                            placeholder="Ex: Pessoas"
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Cargo</label>
                          <CustomSelect
                            caption="Cargo"
                            value={novoColaboradorForm.cargo}
                            options={cadastros.cargos.map((item) => ({ id: item.nome, label: item.nome }))}
                            onChange={(val) => setNovoColaboradorForm((prev) => ({ ...prev, cargo: val }))}
                            placeholder="Selecione um cargo"
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Função</label>
                          <CustomSelect
                            caption="Função"
                            value={novoColaboradorForm.funcao}
                            options={cadastros.funcoes.map((item) => ({ id: item.nome, label: item.nome }))}
                            onChange={(val) => setNovoColaboradorForm((prev) => ({ ...prev, funcao: val }))}
                            placeholder="Selecione uma função"
                          />
                        </div>
                        <div className={styles.field}>
                          <label>Senioridade</label>
                          <CustomSelect
                            caption="Senioridade"
                            value={novoColaboradorForm.senioridade}
                            options={cadastros.senioridades.map((item) => ({ id: item.nome, label: item.nome }))}
                            onChange={(val) => setNovoColaboradorForm((prev) => ({ ...prev, senioridade: val }))}
                            placeholder="Selecione uma senioridade"
                          />
                        </div>
                      </div>
                      <div className={styles.formActions}>
                        <button className={styles.btnPrimary} type="submit" disabled={savingNewCollaborator}>
                          {savingNewCollaborator ? 'Criando...' : 'Criar colaborador'}
                        </button>
                      </div>
                    </form>
                  </section>
                </section>
              ) : (
                <section className={styles.profileStack}>
                  <div className={styles.profileBackRow}>
                    <button className={styles.btnSecondary} type="button" onClick={returnToDashboard}>
                      ← Voltar para colaboradores
                    </button>
                  </div>

                  {loadingPerfil ? (
                    <section className={styles.loadingPanel}>Carregando perfil do colaborador...</section>
                  ) : perfilError ? (
                    <section className={styles.errorPanel}>{perfilError}</section>
                  ) : !perfil || !selectedDashboardColaborador ? (
                    <section className={styles.emptyPanel}>Selecione um colaborador para abrir o perfil privado.</section>
                  ) : (
                    <>
                      <section className={styles.panel}>
                        <div className={styles.panelHeader}>
                          <h3 className={styles.panelTitle}>Perfil visível para mim</h3>
                          <span className={styles.panelHint}>Acompanhamento privado</span>
                        </div>

                        <div className={styles.profileHeader}>
                          <div className={styles.profileIdentity}>
                            <div className={styles.profileAvatar}>
                              {perfil.colaborador.foto_url ? <img src={perfil.colaborador.foto_url} alt="" /> : perfil.colaborador.nome.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <h4 className={styles.profileName}>{perfil.colaborador.nome}</h4>
                              <div className={styles.profileEmail}>{perfil.colaborador.username}</div>
                              <div className={styles.profileMeta}>
                                <span>{colaboradorForm.cargo || 'Sem cargo'}</span>
                                <span>{colaboradorForm.funcao || 'Sem função'}</span>
                                <span>{colaboradorForm.senioridade || 'Sem senioridade'}</span>
                              </div>
                            </div>
                          </div>
                          <div className={styles.profileHours}>
                            <div className={styles.hourCard}>
                              <span>Hrs dessa Semana</span>
                              <strong>{fmtMins(perfil.horas_semana_mins)}</strong>
                            </div>
                            <div className={styles.hourCard}>
                              <span>Hrs desse Mês</span>
                              <strong>{fmtMins(perfil.horas_mes_mins)}</strong>
                            </div>
                          </div>
                        </div>

                        <form className={styles.formSection} onSubmit={saveColaborador}>
                          <div className={styles.formSectionTitle}>Dados de carreira do colaborador</div>
                          <div className={styles.formGrid}>
                            <div className={styles.field}>
                              <CustomDatePicker
                                caption="Data de entrada"
                                value={colaboradorForm.data_entrada}
                                onChange={(val) => setColaboradorForm((prev) => ({ ...prev, data_entrada: val }))}
                                disabled={!canManageCollaboratorData}
                              />
                            </div>
                            <div className={styles.field}>
                              <label>Setor</label>
                              <input
                                value={colaboradorForm.setor}
                                onChange={(e) => setColaboradorForm((prev) => ({ ...prev, setor: e.target.value }))}
                                placeholder="Ex: Pessoas"
                                disabled={!canManageCollaboratorData}
                              />
                            </div>
                            <div className={`${styles.field} ${styles.fieldFull}`}>
                              <label>Foto de perfil</label>
                              <input
                                value={colaboradorForm.foto_url}
                                onChange={(e) => setColaboradorForm((prev) => ({ ...prev, foto_url: e.target.value }))}
                                placeholder="URL da foto (opcional)"
                                disabled={!canManageCollaboratorData}
                              />
                            </div>
                            <div className={styles.field}>
                              <label>Cargo</label>
                              <CustomSelect
                                caption="Cargo"
                                value={colaboradorForm.cargo}
                                options={cadastros.cargos.map((item) => ({ id: item.nome, label: item.nome }))}
                                onChange={(val) => setColaboradorForm((prev) => ({ ...prev, cargo: val }))}
                                placeholder="Selecione um cargo"
                                disabled={!canManageCollaboratorData}
                              />
                            </div>
                            <div className={styles.field}>
                              <label>Função</label>
                              <CustomSelect
                                caption="Função"
                                value={colaboradorForm.funcao}
                                options={cadastros.funcoes.map((item) => ({ id: item.nome, label: item.nome }))}
                                onChange={(val) => setColaboradorForm((prev) => ({ ...prev, funcao: val }))}
                                placeholder="Selecione uma função"
                                disabled={!canManageCollaboratorData}
                              />
                            </div>
                            <div className={styles.field}>
                              <label>Senioridade</label>
                              <CustomSelect
                                caption="Senioridade"
                                value={colaboradorForm.senioridade}
                                options={cadastros.senioridades.map((item) => ({ id: item.nome, label: item.nome }))}
                                onChange={(val) => setColaboradorForm((prev) => ({ ...prev, senioridade: val }))}
                                placeholder="Selecione uma senioridade"
                                disabled={!canManageCollaboratorData}
                              />
                            </div>
                            <div className={styles.field}>
                              <label>Gestor responsável</label>
                              <CustomSelect
                                caption="Gestor responsável"
                                value={colaboradorForm.gestor_usuario}
                                options={internalUsers.map((username) => ({ id: username, label: username }))}
                                onChange={(val) => setColaboradorForm((prev) => ({ ...prev, gestor_usuario: val }))}
                                placeholder="Sem gestor definido"
                                disabled={!canManageCollaboratorData}
                              />
                            </div>
                            <div className={`${styles.field} ${styles.fieldFull}`}>
                              <label>Objetivo profissional resumido</label>
                              <textarea
                                value={colaboradorForm.objetivo_profissional_resumo}
                                onChange={(e) => setColaboradorForm((prev) => ({ ...prev, objetivo_profissional_resumo: e.target.value }))}
                                placeholder="Resumo do objetivo profissional atual do colaborador."
                                rows={3}
                                disabled={!canManageCollaboratorData}
                              />
                            </div>
                          </div>
                          {canManageCollaboratorData && (
                            <button className={styles.btnPrimary} type="submit" disabled={savingPerfil}>
                              {savingPerfil ? 'Salvando...' : 'Salvar dados do colaborador'}
                            </button>
                          )}
                        </form>
                      </section>

                      {canManageCollaboratorData && (
                      <section className={styles.panel}>
                        <div className={styles.panelHeader}>
                          <h3 className={styles.panelTitle}>Jornada de trabalho</h3>
                          <span className={styles.panelHint}>
                            {jornadaIsDefault
                              ? 'Usando o padrão NGP — personalize se necessário'
                              : 'Jornada personalizada para este colaborador'}
                          </span>
                        </div>
                        <form className={styles.formSection} onSubmit={salvarJornada}>
                          {loadingJornada ? (
                            <div>Carregando jornada...</div>
                          ) : (
                            <>
                              <div className={styles.formGrid}>
                                {([
                                  ['min_seg', 'Segunda'],
                                  ['min_ter', 'Terça'],
                                  ['min_qua', 'Quarta'],
                                  ['min_qui', 'Quinta'],
                                  ['min_sex', 'Sexta'],
                                  ['min_sab', 'Sábado'],
                                  ['min_dom', 'Domingo'],
                                ] as const).map(([key, label]) => (
                                  <div key={key} className={styles.field}>
                                    <label>{label}</label>
                                    <input
                                      type="time"
                                      step={60}
                                      value={minsToHHMM(jornadaForm[key])}
                                      onChange={(e) => setJornadaForm(prev => ({ ...prev, [key]: hhmmToMins(e.target.value) }))}
                                    />
                                  </div>
                                ))}
                                <div className={styles.field}>
                                  <label>Total semanal</label>
                                  <input
                                    type="text"
                                    value={`${Math.floor(totalSemanaMins / 60)}h${totalSemanaMins % 60 ? `${(totalSemanaMins % 60).toString().padStart(2, '0')}` : ''}`}
                                    readOnly
                                    style={{ background: '#f5f5f7', fontWeight: 700 }}
                                  />
                                </div>
                              </div>
                              <div className={styles.formActions}>
                                {!jornadaIsDefault && (
                                  <button type="button" className={styles.btnSecondary} onClick={resetarJornada} disabled={savingJornada}>
                                    Resetar para padrão NGP
                                  </button>
                                )}
                                <button type="submit" className={styles.btnPrimary} disabled={savingJornada}>
                                  {savingJornada ? 'Salvando...' : 'Salvar jornada'}
                                </button>
                              </div>
                            </>
                          )}
                        </form>
                      </section>
                      )}

                      {canManageUserAccess && (
                      <section className={styles.panel}>
                        <div className={styles.panelHeader}>
                          <h3 className={styles.panelTitle}>Usuário de acesso</h3>
                          <span className={styles.panelHint}>Somente admin pode editar</span>
                        </div>

                        <form className={styles.formSection} onSubmit={saveUsuarioAcesso}>
                          <div className={styles.formGrid}>
                            <div className={styles.field}>
                              <label>Nome do usuário</label>
                              <input
                                value={usuarioAcessoForm.nome}
                                onChange={(e) => setUsuarioAcessoForm((prev) => ({ ...prev, nome: e.target.value }))}
                                placeholder="Nome completo"
                                required
                              />
                            </div>
                            <div className={styles.field}>
                              <label>E-mail de login</label>
                              <input
                                type="email"
                                value={usuarioAcessoForm.email}
                                onChange={(e) => setUsuarioAcessoForm((prev) => ({ ...prev, email: e.target.value }))}
                                placeholder="nome@sejangp.com.br"
                                required
                              />
                            </div>
                            <div className={styles.field}>
                              <label>Nova senha</label>
                              <input
                                type="password"
                                minLength={6}
                                value={usuarioAcessoForm.password}
                                onChange={(e) => setUsuarioAcessoForm((prev) => ({ ...prev, password: e.target.value }))}
                                placeholder="Deixe em branco para manter a atual"
                              />
                            </div>
                            <div className={`${styles.field} ${styles.fieldToggle}`}>
                              <label>Status do usuário</label>
                              <label className={styles.toggleRow}>
                                <input
                                  type="checkbox"
                                  checked={usuarioAcessoForm.ativo}
                                  onChange={(e) => setUsuarioAcessoForm((prev) => ({ ...prev, ativo: e.target.checked }))}
                                />
                                <span>{usuarioAcessoForm.ativo ? 'Usuário ativo' : 'Usuário desativado'}</span>
                              </label>
                            </div>
                          </div>
                          <div className={styles.formActions}>
                            <button className={styles.btnPrimary} type="submit" disabled={savingUsuarioAcesso}>
                              {savingUsuarioAcesso ? 'Salvando...' : 'Salvar usuário de acesso'}
                            </button>
                          </div>
                        </form>
                      </section>
                      )}

                      <section className={styles.panel}>
                        <div className={styles.panelHeader}>
                          <h3 className={styles.panelTitle}>Feedbacks do colaborador</h3>
                          <span className={styles.panelHint}>Anotações privadas</span>
                        </div>

                        <div className={styles.feedbackToolbar}>
                          <div className={styles.feedbackTabs}>
                            <button
                              type="button"
                              className={`${styles.feedbackTab} ${feedbackTab === 'pending' ? styles.feedbackTabActive : ''}`}
                              onClick={() => setFeedbackTab('pending')}
                            >
                              Para apresentar
                            </button>
                            <button
                              type="button"
                              className={`${styles.feedbackTab} ${feedbackTab === 'history' ? styles.feedbackTabActive : ''}`}
                              onClick={() => setFeedbackTab('history')}
                            >
                              Publicados
                            </button>
                          </div>

                          {canManageFeedback && (
                          <button className={styles.btnPrimary} type="button" onClick={startNewFeedback}>
                            Nova anotação de feedback
                          </button>
                          )}
                        </div>

                        {showMeetingForm && canManageFeedback && (
                          <form className={styles.formSection} onSubmit={saveReuniao}>
                            <div className={styles.formSectionTitle}>
                              {editingMeetingId ? 'Editar anotação de feedback' : 'Nova anotação de feedback'}
                            </div>
                            <div className={styles.formGrid}>
                              <div className={styles.field}>
                                <CustomDatePicker
                                  caption="Data prevista para apresentação"
                                  value={meetingForm.data_reuniao}
                                  onChange={(val) => setMeetingForm((prev) => ({ ...prev, data_reuniao: val }))}
                                />
                              </div>
                              <div className={styles.field}>
                                <label>Título</label>
                                <input
                                  value={meetingForm.titulo}
                                  onChange={(e) => setMeetingForm((prev) => ({ ...prev, titulo: e.target.value }))}
                                  placeholder="Ex: Feedback Abril 2026"
                                />
                              </div>
                              <div className={styles.field}>
                                <label>SWOT · Forças</label>
                                <textarea value={meetingForm.swot_forcas} onChange={(e) => setMeetingForm((prev) => ({ ...prev, swot_forcas: e.target.value }))} rows={3} />
                              </div>
                              <div className={styles.field}>
                                <label>SWOT · Fraquezas</label>
                                <textarea value={meetingForm.swot_fraquezas} onChange={(e) => setMeetingForm((prev) => ({ ...prev, swot_fraquezas: e.target.value }))} rows={3} />
                              </div>
                              <div className={styles.field}>
                                <label>SWOT · Oportunidades</label>
                                <textarea value={meetingForm.swot_oportunidades} onChange={(e) => setMeetingForm((prev) => ({ ...prev, swot_oportunidades: e.target.value }))} rows={3} />
                              </div>
                              <div className={styles.field}>
                                <label>SWOT · Ameaças</label>
                                <textarea value={meetingForm.swot_ameacas} onChange={(e) => setMeetingForm((prev) => ({ ...prev, swot_ameacas: e.target.value }))} rows={3} />
                              </div>
                              <div className={`${styles.field} ${styles.fieldFull}`}>
                                <label>Objetivos pessoais do colaborador</label>
                                <textarea value={meetingForm.objetivos_pessoais} onChange={(e) => setMeetingForm((prev) => ({ ...prev, objetivos_pessoais: e.target.value }))} rows={3} />
                              </div>
                              <div className={`${styles.field} ${styles.fieldFull}`}>
                                <label>Como a NGP pode ajudar</label>
                                <textarea value={meetingForm.apoio_ngp} onChange={(e) => setMeetingForm((prev) => ({ ...prev, apoio_ngp: e.target.value }))} rows={3} />
                              </div>
                              <div className={`${styles.field} ${styles.fieldFull}`}>
                                <label>Combinados do próximo ciclo</label>
                                <textarea value={meetingForm.combinados_proximo_ciclo} onChange={(e) => setMeetingForm((prev) => ({ ...prev, combinados_proximo_ciclo: e.target.value }))} rows={3} />
                              </div>
                              <div className={`${styles.field} ${styles.fieldFull}`}>
                                <label>Notas livres</label>
                                <textarea value={meetingForm.notas_livres} onChange={(e) => setMeetingForm((prev) => ({ ...prev, notas_livres: e.target.value }))} rows={4} />
                              </div>
                            </div>
                            <div className={styles.formActions}>
                              <button className={styles.btnPrimary} type="submit" disabled={savingMeeting}>
                                {savingMeeting ? 'Salvando...' : editingMeetingId ? 'Atualizar anotação' : 'Salvar anotação'}
                              </button>
                              <button className={styles.btnSecondary} type="button" onClick={cancelEditMeeting}>
                                Cancelar
                              </button>
                            </div>
                          </form>
                        )}

                        <div className={styles.timeline}>
                          {activeMeetings.length === 0 ? (
                            <div className={styles.emptyState}>
                              {feedbackTab === 'pending'
                                ? 'Nenhuma anotação pendente para apresentar.'
                                : 'Nenhum feedback publicado ainda.'}
                            </div>
                          ) : activeMeetings.map((reuniao) => (
                            <article
                              key={reuniao.id}
                              className={`${styles.timelineCard} ${feedbackTab === 'pending' ? styles.timelineCardCurrent : ''}`}
                            >
                              <div className={styles.timelineHeader}>
                                <div>
                                  <div className={styles.timelineDate}>
                                    {fmtDate(reuniao.data_reuniao)}
                                    {feedbackTab === 'history' && reuniao.apresentado_em ? ` · Publicado em ${fmtDate(reuniao.apresentado_em.slice(0, 10))}` : ''}
                                  </div>
                                  <h4 className={styles.timelineTitle}>
                                    {reuniao.titulo || `Anotação de feedback ${fmtDate(reuniao.data_reuniao)}`}
                                  </h4>
                                </div>
                                <div className={styles.timelineActions}>
                                  <span className={feedbackTab === 'pending' ? styles.currentBadge : styles.historyBadge}>
                                    {feedbackTab === 'pending'
                                      ? reuniao.status === 'agendado' ? 'Agendado' : 'Anotado'
                                      : 'Publicado'}
                                  </span>
                                  {feedbackTab === 'pending' && canManageFeedback && (
                                    <>
                                      {isAdminUser && (
                                        <button
                                          className={styles.iconDeleteButton}
                                          type="button"
                                          onClick={() => deleteMeeting(reuniao)}
                                          disabled={savingMeeting}
                                          aria-label="Excluir feedback"
                                          title="Excluir feedback"
                                        >
                                          <IcoLixeira />
                                        </button>
                                      )}
                                      <button className={styles.btnGhost} type="button" onClick={() => startEditMeeting(reuniao)}>
                                        Editar
                                      </button>
                                      <button
                                        className={styles.btnSecondary}
                                        type="button"
                                        onClick={() => reuniao.status === 'agendado' ? publishFeedback(reuniao) : scheduleFeedback(reuniao)}
                                        disabled={savingMeeting}
                                      >
                                        {reuniao.status === 'agendado' ? 'Apresentar feedback' : 'Agendar feedback'}
                                      </button>
                                    </>
                                  )}
                                  {feedbackTab === 'history' && isAdminUser && (
                                    <button
                                      className={styles.iconDeleteButton}
                                      type="button"
                                      onClick={() => deleteMeeting(reuniao)}
                                      disabled={savingMeeting}
                                      aria-label="Excluir feedback"
                                      title="Excluir feedback"
                                    >
                                      <IcoLixeira />
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className={styles.feedbackSummaryGrid}>
                                <div className={styles.feedbackSummaryCard}>
                                  <span className={styles.noteLabel}>SWOT</span>
                                  <p>{swotPreview(reuniao)}</p>
                                </div>
                                <div className={styles.feedbackSummaryCard}>
                                  <span className={styles.noteLabel}>Objetivos pessoais</span>
                                  <p>{previewText(reuniao.objetivos_pessoais)}</p>
                                </div>
                                <div className={styles.feedbackSummaryCard}>
                                  <span className={styles.noteLabel}>Como a NGP pode ajudar</span>
                                  <p>{previewText(reuniao.apoio_ngp)}</p>
                                </div>
                                <div className={styles.feedbackSummaryCard}>
                                  <span className={styles.noteLabel}>Próximo ciclo</span>
                                  <p>{previewText(reuniao.combinados_proximo_ciclo)}</p>
                                </div>
                              </div>

                              {reuniao.notas_livres && (
                                <div className={styles.feedbackFootnote}>
                                  <span className={styles.noteLabel}>Notas livres</span>
                                  <p>{previewText(reuniao.notas_livres)}</p>
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      </section>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
