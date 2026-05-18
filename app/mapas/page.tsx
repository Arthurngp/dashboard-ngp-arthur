'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { efCall } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import type { Cliente } from '@/types'
import styles from './mapas.module.css'

type MapaListItem = {
  id: string
  titulo: string
  descricao: string | null
  cliente_id: string | null
  tags: string[]
  total_nos: number
  updated_at: string
  cliente?: { id: string; nome: string } | null
  autor?: { id: string; nome: string; foto_url?: string } | null
}

export default function MapasPage() {
  const router = useRouter()
  const [sess] = useState(getSession)
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mapas, setMapas] = useState<MapaListItem[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [search, setSearch] = useState('')
  const [filterCliente, setFilterCliente] = useState<string>('')

  // Modal de criar mapa
  const [modalOpen, setModalOpen] = useState(false)
  const [novoTitulo, setNovoTitulo] = useState('')
  const [novoClienteId, setNovoClienteId] = useState<string>('')
  const [criando, setCriando] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (!sess || sess.auth !== '1') { router.replace('/login'); return }
    if (sess.role !== 'admin' && sess.role !== 'ngp') { router.replace('/cliente'); return }
    void loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [mapasRes, clientesRes] = await Promise.all([
        efCall('mapas-manage', { op: 'list' }),
        efCall('get-ngp-data', {}),
      ])
      setMapas(((mapasRes.mapas as MapaListItem[]) || []))
      const lista = ((clientesRes.clientes as Cliente[]) || []).sort((a, b) =>
        (a.nome || '').localeCompare(b.nome || '')
      )
      setClientes(lista)
    } catch (e) {
      console.error('[mapas] loadAll', e)
    } finally {
      setLoading(false)
    }
  }

  async function criarMapa() {
    const titulo = novoTitulo.trim()
    if (!titulo) return
    setCriando(true)
    try {
      const res = await efCall('mapas-manage', {
        op: 'mapa_create',
        payload: {
          titulo,
          cliente_id: novoClienteId || null,
        },
      })
      const mapa = res.mapa as { id?: string } | undefined
      if (mapa?.id) {
        router.push(`/mapas/${mapa.id}`)
      } else {
        alert(`Erro: ${res.error || 'falha ao criar mapa'}`)
      }
    } finally {
      setCriando(false)
    }
  }

  const filtered = useMemo(() => {
    let out = mapas
    if (filterCliente === '__none__') {
      out = out.filter(m => !m.cliente_id)
    } else if (filterCliente) {
      out = out.filter(m => m.cliente_id === filterCliente)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      out = out.filter(m =>
        (m.titulo || '').toLowerCase().includes(q)
        || (m.descricao || '').toLowerCase().includes(q)
        || (m.tags || []).some(t => t.toLowerCase().includes(q))
      )
    }
    return out
  }, [mapas, search, filterCliente])

  if (!sess || !mounted) return <NGPLoading loading loadingText="Carregando Mapas Mentais..." />

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.backBtn} onClick={() => router.push('/setores')}>← Setores</button>
            <div>
              <div className={styles.eyebrow}>Brainstorm</div>
              <h1 className={styles.title}>Mapas Mentais</h1>
            </div>
          </div>
          <div className={styles.topbarRight}>
            <button className={styles.primaryBtn} onClick={() => { setNovoTitulo(''); setNovoClienteId(''); setModalOpen(true) }}>
              + Novo mapa
            </button>
          </div>
        </header>

        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            placeholder="Buscar por título, descrição ou tag..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className={styles.select} value={filterCliente} onChange={e => setFilterCliente(e.target.value)}>
            <option value="">Todos os clientes</option>
            <option value="__none__">— Sem cliente —</option>
            {clientes.map(c => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <NGPLoading loading loadingText="Carregando mapas..." />
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <h3>Nenhum mapa por aqui ainda</h3>
            <p>Crie seu primeiro mapa mental clicando em <b>+ Novo mapa</b>.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {filtered.map(m => (
              <button key={m.id} className={styles.card} onClick={() => router.push(`/mapas/${m.id}`)}>
                {m.cliente?.nome && <div className={styles.cardCliente}>{m.cliente.nome}</div>}
                <h3 className={styles.cardTitle}>{m.titulo}</h3>
                {m.tags?.length > 0 && (
                  <div className={styles.tagRow}>
                    {m.tags.slice(0, 4).map(t => <span key={t} className={styles.tag}>{t}</span>)}
                  </div>
                )}
                <div className={styles.cardMeta}>
                  <span>{m.total_nos} {m.total_nos === 1 ? 'nó' : 'nós'}</span>
                  <span>{formatRelative(m.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {modalOpen && (
          <div className={styles.modalBackdrop} onClick={() => setModalOpen(false)}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <h2>Novo mapa mental</h2>
              <div className={styles.modalField}>
                <label>Título</label>
                <input
                  autoFocus
                  value={novoTitulo}
                  onChange={e => setNovoTitulo(e.target.value)}
                  placeholder="Ex: Brainstorm campanha Cliente Acme"
                  onKeyDown={e => { if (e.key === 'Enter' && novoTitulo.trim()) void criarMapa() }}
                />
              </div>
              <div className={styles.modalField}>
                <label>Cliente (opcional)</label>
                <select value={novoClienteId} onChange={e => setNovoClienteId(e.target.value)}>
                  <option value="">— Sem cliente (mapa livre) —</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>
              <div className={styles.modalActions}>
                <button className={styles.ghostBtn} onClick={() => setModalOpen(false)}>Cancelar</button>
                <button
                  className={styles.primaryBtn}
                  disabled={!novoTitulo.trim() || criando}
                  onClick={criarMapa}
                >
                  {criando ? 'Criando...' : 'Criar e abrir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function formatRelative(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const dias = Math.floor(h / 24)
  if (dias < 7) return `${dias}d`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
