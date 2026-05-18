'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import styles from './criativo.module.css'

interface Tool {
  id: string
  title: string
  desc: string
  href: string
  badge?: string
  disabled?: boolean
}

const TOOLS: Tool[] = [
  {
    id: 'mapas',
    title: 'Mapas Mentais',
    desc: 'Brainstorm visual em árvore. Estruture ideias, campanhas e briefings em um canvas infinito.',
    href: '/mapas',
  },
  {
    id: 'processos',
    title: 'Mapeamento de Processos',
    desc: 'Quadro estilo Miro pra desenhar fluxos, processos e diagramas operacionais.',
    href: '#',
    badge: 'Em breve',
    disabled: true,
  },
  {
    id: 'quadros',
    title: 'Quadros Colaborativos',
    desc: 'Whiteboards livres pra reuniões, workshops e ideação em equipe.',
    href: '#',
    badge: 'Em breve',
    disabled: true,
  },
  {
    id: 'briefings',
    title: 'Briefings Visuais',
    desc: 'Templates de briefing visual pra alinhar campanhas com clientes.',
    href: '#',
    badge: 'Em breve',
    disabled: true,
  },
]

export default function CriativoPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    setSess(s)
  }, [router])

  if (!sess) return <NGPLoading loading loadingText="Carregando setor criativo..." />

  function openTool(tool: Tool) {
    if (tool.disabled) return
    router.push(tool.href)
  }

  return (
    <div className={styles.layout}>
      <Sidebar />
      <main className={styles.main}>
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.eyebrow}>Setor Criativo</div>
            <h1 className={styles.title}>Brainstorm & Ideação</h1>
            <p className={styles.subtitle}>Ferramentas visuais pra estruturar ideias, processos e briefings da NGP.</p>
          </header>

          <section className={styles.grid}>
            {TOOLS.map(tool => (
              <button
                key={tool.id}
                className={`${styles.card} ${tool.disabled ? styles.cardDisabled : ''}`}
                onClick={() => openTool(tool)}
                disabled={tool.disabled}
              >
                <div className={styles.cardBody}>
                  <div className={styles.cardTitleRow}>
                    <h3 className={styles.cardTitle}>{tool.title}</h3>
                    {tool.badge && <span className={styles.cardBadge}>{tool.badge}</span>}
                  </div>
                  <p className={styles.cardDesc}>{tool.desc}</p>
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
    </div>
  )
}
