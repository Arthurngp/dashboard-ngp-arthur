'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import Sidebar from '@/components/Sidebar'
import ComingSoonModal from '@/components/ComingSoonModal'

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

interface Setor {
  id: string
  title: string
  desc: string
  icon: React.ReactNode
  href: string
  external: boolean
  embed: boolean
  gradient: string
}

const SETORES: Setor[] = [
  {
    id: 'anuncios',
    title: 'Relatórios e Dados',
    desc: 'Acompanhe campanhas, métricas e relatórios das contas dos clientes.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    ),
    href: '/dashboard',
    external: false,
    embed: false,
    gradient: 'linear-gradient(135deg,#dc2626,#f97316)',
  },
  {
    id: 'financeiro',
    title: 'Financeiro',
    desc: 'Controle de receitas, despesas, DRE e gestão financeira da NGP.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
      </svg>
    ),
    href: 'https://financeiro.grupongp.com.br',
    external: true,
    embed: true, // abre inline no NGP Space
    gradient: 'linear-gradient(135deg,#059669,#14b8a6)',
  },
  {
    id: 'pessoas',
    title: 'Pessoas',
    desc: 'Gestão de equipe, colaboradores, onboarding e cultura NGP.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
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
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
        <line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
    ),
    href: '/comercial',
    external: false,
    embed: false,
    gradient: 'linear-gradient(135deg,#3b82f6,#7c3aed)',
  },
  {
    id: 'trackeamento',
    title: 'Trackeamento',
    desc: 'UTMs, pixels, eventos e análise de jornada de conversão.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
    ),
    href: '#',
    external: true,
    embed: false,
    gradient: 'linear-gradient(135deg,#7c3aed,#ec4899)',
  },
]


export default function SetoresPage() {
  const router = useRouter()
  const [sess, setSess]             = useState<ReturnType<typeof getSession> | null>(null)
  const [comingSoon, setComingSoon]   = useState<string | null>(null)
  const [embedUrl, setEmbedUrl]     = useState<string | null>(null)
  const [embedTitle, setEmbedTitle] = useState('')
  const [iframeLoads, setIframeLoads] = useState(0)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    setSess(s)
  }, [router])

  if (!sess) return null

  const isAdmin = sess.role === 'admin'

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

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal={isAdmin} />

      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.eyebrow}>Bem-vindo de volta</div>
            <h1 className={styles.title}>Olá, {sess.user?.split(' ')[0] || 'NGP'} 👋</h1>
            <p className={styles.subtitle}>Selecione o setor da NGP que você quer acessar.</p>
          </header>

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
