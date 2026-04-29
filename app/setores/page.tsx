'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import ComingSoonModal from '@/components/ComingSoonModal'
import WorkspaceTopbar from '@/components/WorkspaceTopbar'
import NGPLoading from '@/components/NGPLoading'

const IcoAd = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
  </svg>
)
const IcoUsers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
  </svg>
)
import styles from './setores.module.css'

interface PontoRecord {
  id: string
  tipo_registro: 'entrada' | 'saida_almoco' | 'retorno_almoco' | 'saida' | 'extra_entrada' | 'extra_saida' | 'extra'
  created_at: string
}

interface NextAction {
  tipo: string
  label: string
  color: string
}

const BRT_OFFSET = -3 * 60 * 60 * 1000
const WEEKDAY_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const TIPO_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  saida_almoco: 'Saída almoço',
  retorno_almoco: 'Retorno almoço',
  saida: 'Saída',
  extra_entrada: 'Entrada extra',
  extra_saida: 'Saída extra',
  extra: 'Extra',
}

function toLocalTime(utcIso: string): string {
  const ms = new Date(utcIso).getTime() + BRT_OFFSET
  const d = new Date(ms)
  return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`
}

function fmtMins(mins: number): string {
  if (mins <= 0) return '--'
  return `${Math.floor(mins / 60)}h${(mins % 60).toString().padStart(2, '0')}m`
}

function getBrtNow() {
  return new Date(Date.now() + BRT_OFFSET)
}

function calcBalance(records: PontoRecord[]): number {
  const sorted = [...records].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const ms = (iso: string) => new Date(iso).getTime()
  const isEntry = (t: string) => ['entrada', 'retorno_almoco', 'extra_entrada'].includes(t)
  const isExit = (t: string) => ['saida_almoco', 'saida', 'extra_saida'].includes(t)

  let totalMs = 0
  let entryTime: number | null = null

  for (const record of sorted) {
    if (isEntry(record.tipo_registro)) entryTime = ms(record.created_at)
    else if (isExit(record.tipo_registro) && entryTime) {
      totalMs += ms(record.created_at) - entryTime
      entryTime = null
    }
  }

  return Math.floor(totalMs / 60000)
}

function getNextAction(records: PontoRecord[]): NextAction | null {
  if (records.length === 0) return { tipo: 'entrada', label: 'Registrar entrada', color: '#059669' }
  const last = records[records.length - 1].tipo_registro
  const map: Record<string, NextAction> = {
    entrada: { tipo: 'saida_almoco', label: 'Saída para almoço', color: '#f59e0b' },
    saida_almoco: { tipo: 'retorno_almoco', label: 'Retorno do almoço', color: '#3b82f6' },
    retorno_almoco: { tipo: 'saida', label: 'Registrar saída', color: '#9B1540' },
    saida: { tipo: 'extra_entrada', label: 'Entrada extra', color: '#7c3aed' },
    extra_entrada: { tipo: 'extra_saida', label: 'Saída extra', color: '#6d28d9' },
    extra_saida: { tipo: 'extra_entrada', label: 'Entrada extra', color: '#7c3aed' },
    extra: { tipo: 'extra_entrada', label: 'Entrada extra', color: '#7c3aed' },
  }

  return map[last] ?? null
}

interface Setor {
  id: string
  title: string
  desc: string
  icon: React.ReactNode
  href: string
  external: boolean
  embed: boolean
  gradient: string
  badge?: string
}

const GESTAO_ANUNCIOS_PLAN_PATH = 'docs/gestao-anuncios-roadmap.md'
const GESTAO_ANUNCIOS_PLAN_POINTS = [
  'Subir criativos, campanhas, conjuntos e anúncios a partir de briefing, ativos e prompts estruturados.',
  'Usar IA para sugerir naming, copy, criativos, segmentação, orçamento e estrutura de campanha antes do envio.',
  'Manter camada humana curta, focada em aprovação, ajustes sensíveis e publicação final.',
  'Começar com fluxo assistido interno e só depois evoluir para automações mais autônomas.',
]

const SETORES: Setor[] = [
  {
    id: 'anuncios',
    title: 'Análise de Dados e Relatórios',
    desc: 'Acompanhe campanhas, métricas e relatórios das contas dos clientes.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19h16"/>
        <path d="M7 16V9"/>
        <path d="M12 16V5"/>
        <path d="M17 16v-3"/>
        <circle cx="7" cy="9" r="1.5"/>
        <circle cx="12" cy="5" r="1.5"/>
        <circle cx="17" cy="13" r="1.5"/>
      </svg>
    ),
    href: '/dashboard',
    external: false,
    embed: false,
    gradient: 'linear-gradient(135deg,#dc2626,#f97316)',
  },
  {
    id: 'pessoas',
    title: 'Pessoas',
    desc: 'Gestão de equipe, colaboradores, onboarding e cultura NGP.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3"/>
        <path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
        <circle cx="18" cy="9" r="2.5"/>
        <path d="M15.5 19c.3-2.1 2.1-3.8 4.3-4.1"/>
      </svg>
    ),
    href: '/pessoas',
    external: false,
    embed: false,
    gradient: 'linear-gradient(135deg,#7c3aed,#a855f7)',
  },
  {
    id: 'comercial',
    title: 'Comercial',
    desc: 'CRM, pipeline de vendas, propostas e gestão de oportunidades.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h10"/>
        <path d="M4 12h7"/>
        <path d="M4 18h4"/>
        <path d="M16 5l4 4-4 4"/>
        <path d="M13 9h7"/>
      </svg>
    ),
    href: '/comercial',
    external: false,
    embed: false,
    gradient: 'linear-gradient(135deg,#3b82f6,#7c3aed)',
  },
  {
    id: 'comercial-digital',
    title: 'Comercial Digital',
    desc: 'CRM digital entregue aos clientes com acesso próprio, pipelines isolados e operação comercial separada da NGP.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h8" />
        <path d="M4 12h13" />
        <path d="M4 17h5" />
        <path d="M16 5l4 4-4 4" />
        <rect x="13" y="14" width="7" height="5" rx="1.5" />
      </svg>
    ),
    href: '/comercial-digital',
    external: false,
    embed: false,
    gradient: 'linear-gradient(135deg,#0f766e,#14b8a6)',
  },
  {
    id: 'tarefas',
    title: 'Gestão de Tarefas',
    desc: 'Kanban de tarefas da equipe com prioridades, responsáveis e prazos.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2"/>
        <path d="M3 10h18"/>
        <path d="M8 3v4"/>
        <path d="M16 3v4"/>
      </svg>
    ),
    href: '/tarefas',
    external: false,
    embed: false,
    gradient: 'linear-gradient(135deg,#0369a1,#3b82f6)',
  },
  {
    id: 'financeiro',
    title: 'Financeiro',
    desc: 'Controle de receitas, despesas, DRE e gestão financeira da NGP.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20"/>
        <path d="M17 6.5c0-1.9-2.2-3.5-5-3.5s-5 1.6-5 3.5 2.2 3.5 5 3.5 5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5"/>
      </svg>
    ),
    href: '/financeiro',
    external: false,
    embed: false,
    gradient: 'linear-gradient(135deg,#059669,#14b8a6)',
  },
  {
    id: 'trackeamento',
    title: 'NGP Forms',
    desc: 'UTMs, pixels, eventos e análise de jornada de conversão.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3"/>
        <path d="M21 12h-3"/>
        <path d="M12 21v-3"/>
        <path d="M3 12h3"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="1.5"/>
      </svg>
    ),
    href: '/trackeamento',
    external: false,
    embed: false,
    gradient: 'linear-gradient(135deg,#7c3aed,#ec4899)',
  },
  {
    id: 'gestao-anuncios',
    title: 'Gestão de anúncios',
    desc: 'Setor planejado para criação e operação de campanhas com apoio forte de IA, prompts e revision humana mínima.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="14" rx="2"/>
        <path d="M7 20h10"/>
        <path d="M9 8h6"/>
        <path d="M7 12h10"/>
      </svg>
    ),
    href: '#',
    external: false,
    embed: false,
    gradient: 'linear-gradient(135deg,#2563eb,#0ea5e9)',
    badge: 'Em construção',
  },
]


export default function SetoresPage() {
  const router = useRouter()
  const brtNow = getBrtNow()
  const currentMonth = brtNow.getUTCMonth()
  const currentYear = brtNow.getUTCFullYear()
  const currentDay = brtNow.getUTCDate()
  const [selectedDay, setSelectedDay] = useState(currentDay)
  const dateTrackRef = useRef<HTMLDivElement | null>(null)
  const [sess, setSess]             = useState<ReturnType<typeof getSession> | null>(null)
  const [comingSoon, setComingSoon]   = useState<string | null>(null)
  const [embedUrl, setEmbedUrl]     = useState<string | null>(null)
  const [embedTitle, setEmbedTitle] = useState('')
  const [iframeLoads, setIframeLoads] = useState(0)
  const [todayRecords, setTodayRecords] = useState<PontoRecord[]>([])
  const [clockDisplay, setClockDisplay] = useState('--:--:--')
  const [loadingPonto, setLoadingPonto] = useState(false)
  const [pontoMsg, setPontoMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [serverOffset, setServerOffset] = useState(0)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    setSess(s)
  }, [router])

  useEffect(() => {
    if (!sess) return

    let active = true

    const fetchToday = async () => {
      const s = getSession()
      if (!s) return
      try {
        const res = await fetch(`${SURL}/functions/v1/get-ponto-now`, {
          method: 'POST',
          headers: efHeaders(),
          body: JSON.stringify({ session_token: s.session }),
        })
        const data = await res.json()
        if (!active || data.error) return

        const serverNow = new Date(data.server_now)
        if (!Number.isNaN(serverNow.getTime())) {
          setServerOffset(serverNow.getTime() - Date.now())
        }
        setTodayRecords(data.today_records || [])
      } catch {
        // silencioso
      }
    }

    fetchToday()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchToday()
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      active = false
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [sess])

  useEffect(() => {
    if (!sess) return

    const updateClock = () => {
      const nowMs = Date.now() + serverOffset
      const brtMs = nowMs + BRT_OFFSET
      const brt = new Date(brtMs)
      setClockDisplay(
        `${brt.getUTCHours().toString().padStart(2, '0')}:${brt.getUTCMinutes().toString().padStart(2, '0')}:${brt.getUTCSeconds().toString().padStart(2, '0')}`,
      )
    }

    updateClock()
    const clockInterval = window.setInterval(updateClock, 1000)
    return () => window.clearInterval(clockInterval)
  }, [sess, serverOffset])

  useEffect(() => {
    const track = dateTrackRef.current
    if (!sess || !track) return

    const activeChip = track.querySelector<HTMLElement>(`[data-day="${selectedDay}"]`)
    if (!activeChip) return

    const centerChip = () => {
      const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth)
      const chipCenter = activeChip.offsetLeft + activeChip.offsetWidth / 2
      const targetLeft = Math.min(maxScrollLeft, Math.max(0, chipCenter - track.clientWidth / 2))
      track.scrollTo({ left: targetLeft, behavior: 'smooth' })
    }

    const frame = window.requestAnimationFrame(centerChip)
    return () => window.cancelAnimationFrame(frame)
  }, [sess, selectedDay])

  if (!sess) return <NGPLoading loading loadingText="Carregando setores..." />

  const isAdmin = sess.role === 'admin'
  const nextAction = getNextAction(todayRecords)
  const todayTotal = calcBalance(todayRecords)
  const findToday = (tipo: string) => todayRecords.find((r) => r.tipo_registro === tipo)
  const daysInMonth = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate()
  const monthDays = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1
    const date = new Date(Date.UTC(currentYear, currentMonth, day, 12))
    return {
      day,
      weekday: WEEKDAY_SHORT[date.getUTCDay()],
      isToday: day === currentDay,
    }
  })

  function openSetor(setor: Setor) {
    if (setor.href === '#') { setComingSoon(setor.title); return }
    if (setor.embed)        { setEmbedUrl(setor.href); setEmbedTitle(setor.title); setIframeLoads(0); return }
    if (setor.external)     { window.open(setor.href, '_blank', 'noopener,noreferrer'); return }
    router.push(setor.href)
  }

  // Detecta navegação pós-login: segundo `load` = usuário fez login e foi redirecionado
  function handleIframeLoad() {
    setIframeLoads(prev => {
      const next = prev + 1
      if (next >= 2 && embedUrl) {
        // Abre o sistema completo na aba atual e fecha o modal
        window.location.href = embedUrl
      }
      return next
    })
  }

  async function registrarPonto() {
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
        const record = data.record
        const label = TIPO_LABEL[record.tipo_registro] || record.tipo_registro
        setPontoMsg({ type: 'ok', text: `${label} registrada às ${toLocalTime(record.created_at)}` })
        window.setTimeout(() => setPontoMsg(null), 4000)
      }
    } catch {
      setPontoMsg({ type: 'err', text: 'Erro de conexão. Tente novamente.' })
    } finally {
      setLoadingPonto(false)
    }
  }

  function scrollDates(direction: 'left' | 'right') {
    const track = dateTrackRef.current
    if (!track) return
    const amount = Math.min(360, Math.round(track.clientWidth * 0.6))
    track.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    })
  }

  return (
    <div className={styles.layout}>
      <WorkspaceTopbar subtitle="Visão geral do sistema" />

      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.eyebrow}>Bem-vindo de volta</div>
            <h1 className={styles.title}>Olá, {sess.user?.split(' ')[0] || 'NGP'} 👋</h1>
            <p className={styles.subtitle}>Selecione o setor da NGP que você quer acessar.</p>
          </header>

          <section className={styles.pontoCard}>
            <div className={styles.pontoTop}>
              <div>
                <div className={styles.pontoEyebrow}>Ponto rápido</div>
                <h2 className={styles.pontoTitle}>Bater o ponto</h2>
              </div>
              <button className={styles.pontoLink} onClick={() => router.push('/pessoas/registros')}>
                Ver registros completos
              </button>
            </div>

            <div className={styles.dateCarousel}>
              <button
                className={styles.dateArrow}
                onClick={() => scrollDates('left')}
                aria-label="Ver datas anteriores"
              >
                ‹
              </button>

              <div className={styles.dateTrack} ref={dateTrackRef}>
                {monthDays.map((item) => (
                  <button
                    key={item.day}
                    className={`${styles.dateChip} ${item.isToday ? styles.dateChipToday : ''} ${selectedDay === item.day ? styles.dateChipActive : ''}`}
                    onClick={() => setSelectedDay(item.day)}
                    data-day={item.day}
                    aria-label={`Dia ${item.day}`}
                  >
                    <span className={styles.dateChipWeekday}>{item.weekday}</span>
                    <span className={styles.dateChipDay}>{item.day}</span>
                  </button>
                ))}
              </div>

              <button
                className={styles.dateArrow}
                onClick={() => scrollDates('right')}
                aria-label="Ver próximas datas"
              >
                ›
              </button>
            </div>

            <div className={styles.pontoBody}>
              <div className={styles.clockCard}>
                <div className={styles.clockTime}>{clockDisplay}</div>
                <div className={styles.clockLabel}>Horário de Brasília</div>
                {todayTotal > 0 && (
                  <div className={styles.clockTotal}>Total hoje: <strong>{fmtMins(todayTotal)}</strong></div>
                )}
              </div>

              <div className={styles.batidasGrid}>
                {(['entrada', 'saida_almoco', 'retorno_almoco', 'saida'] as const).map((tipo) => {
                  const rec = findToday(tipo)
                  return (
                    <div key={tipo} className={styles.batidaItem}>
                      <span className={styles.batidaLabel}>{TIPO_LABEL[tipo]}</span>
                      <span className={`${styles.batidaValue} ${rec ? styles.batidaValueSet : ''}`}>
                        {rec ? toLocalTime(rec.created_at) : '--:--'}
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className={styles.pontoAction}>
                {pontoMsg && (
                  <div className={`${styles.pontoMsg} ${pontoMsg.type === 'ok' ? styles.pontoOk : styles.pontoErr}`}>
                    {pontoMsg.text}
                  </div>
                )}

                {nextAction ? (
                  <button
                    className={styles.btnPonto}
                    style={{ background: nextAction.color }}
                    onClick={registrarPonto}
                    disabled={loadingPonto}
                  >
                    {loadingPonto ? 'Registrando...' : nextAction.label}
                  </button>
                ) : (
                  <div className={styles.pontoDone}>Jornada de hoje encerrada</div>
                )}
              </div>
            </div>
          </section>

          <section className={styles.grid}>
            {SETORES.map(setor => (
              <button
                key={setor.id}
                className={styles.card}
                onClick={() => openSetor(setor)}
              >
                <div className={styles.cardIcon} style={{ background: setor.gradient }}>
                  {setor.icon}
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.cardTitleRow}>
                    <h3 className={styles.cardTitle}>{setor.title}</h3>
                    {setor.badge && (
                      <span className={styles.cardBadge}>{setor.badge}</span>
                    )}
                    {setor.external && !setor.embed && (
                      <span className={styles.externalTag} title="Abre em nova aba">↗</span>
                    )}
                  </div>
                  <p className={styles.cardDesc}>{setor.desc}</p>
                </div>
                <div className={styles.cardArrow}>→</div>
              </button>
            ))}
          </section>

          {isAdmin && (
            <section className={styles.adminPlanCard}>
              <div className={styles.adminPlanHeader}>
                <div>
                  <div className={styles.adminPlanEyebrow}>Plano interno</div>
                  <h2 className={styles.adminPlanTitle}>Gestão de anúncios</h2>
                </div>
                <span className={styles.adminPlanStatus}>Em construção</span>
              </div>

              <p className={styles.adminPlanDesc}>
                Roadmap salvo para evoluirmos este setor sem perder a ideia. O objetivo é transformar a criação e a operação de anúncios em um fluxo IA-first, com aprovação humana curta e capacidade de otimização contínua.
              </p>

              <div className={styles.adminPlanPath}>
                Arquivo-base: <code>{GESTAO_ANUNCIOS_PLAN_PATH}</code>
              </div>

              <div className={styles.adminPlanGrid}>
                {GESTAO_ANUNCIOS_PLAN_POINTS.map((point) => (
                  <div key={point} className={styles.adminPlanPoint}>
                    {point}
                  </div>
                ))}
              </div>
            </section>
          )}

          <footer className={styles.footer}>
            <span className={styles.footerDot} />
            Conectado ao Supabase · {sess.user}
          </footer>
        </div>
      </main>

      <ComingSoonModal setor={comingSoon} onClose={() => setComingSoon(null)} />

      {/* Modal iframe para sistemas embarcados */}
      {embedUrl && (
        <div className={styles.embedOverlay} onClick={() => setEmbedUrl(null)}>
          <div className={styles.embedModal} onClick={e => e.stopPropagation()}>
            <div className={styles.embedHeader}>
              <div className={styles.embedTitleRow}>
                <span className={styles.embedDot} style={{ background: '#059669' }} />
                <span className={styles.embedTitle}>{embedTitle}</span>
                <span className={styles.embedUrl}>{embedUrl}</span>
              </div>
              <div className={styles.embedActions}>
                <button
                  className={styles.embedBtnExternal}
                  onClick={() => window.open(embedUrl, '_blank', 'noopener,noreferrer')}
                  title="Abrir em nova aba"
                >
                  ↗ Abrir em nova aba
                </button>
                <button className={styles.embedBtnClose} onClick={() => setEmbedUrl(null)} title="Fechar">
                  ✕
                </button>
              </div>
            </div>
            <iframe
              src={embedUrl}
              className={styles.embedFrame}
              title={embedTitle}
              allow="fullscreen"
              onLoad={handleIframeLoad}
            />
          </div>
        </div>
      )}
    </div>
  )
}
