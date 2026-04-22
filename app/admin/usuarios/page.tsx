'use client'
import { Suspense, useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import ClientesCentralPanel from '../clientes/ClientesCentralPanel'
import styles from './usuarios.module.css'

interface Usuario { id: string; nome: string; username: string; role: 'admin' | 'ngp' | 'cliente'; ativo: boolean; created_at: string; foto_url?: string }

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', ngp: 'NGP', cliente: 'Cliente' }

type CadastrosTab = 'clientes' | 'usuarios-ngp'

function UsuariosPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [fNome, setFNome] = useState('')
  const [fUser, setFUser] = useState('')
  const [fEmail, setFEmail] = useState('')
  const [fPass, setFPass] = useState('')
  const [fRole, setFRole] = useState<'admin' | 'ngp'>('ngp')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [requestedTab, setRequestedTab] = useState<CadastrosTab>('clientes')

  const isAdmin = sess?.role === 'admin'
  const activeTab: CadastrosTab = requestedTab === 'usuarios-ngp' && !isAdmin ? 'clientes' : requestedTab

  useEffect(() => {
    const rawTab = searchParams.get('tab')
    setRequestedTab(rawTab === 'usuarios-ngp' ? 'usuarios-ngp' : 'clientes')
  }, [searchParams])

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (!['admin', 'ngp'].includes(s.role)) { router.replace('/setores'); return }
    setSess(s)
  }, [router])

  useEffect(() => {
    if (!sess) return
    if (requestedTab === 'usuarios-ngp' && sess.role !== 'admin') {
      router.replace('/admin/usuarios?tab=clientes')
    }
  }, [requestedTab, sess, router])

  const fetchUsuarios = useCallback(async () => {
    const s = getSession(); if (!s) return
    setLoading(true)
    try {
      const res  = await fetch(`${SURL}/functions/v1/admin-listar-usuarios`, { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session }) })
      const data = await res.json()
      if (!data.error) setUsuarios((data.usuarios || []).filter((usuario: Usuario) => usuario.role !== 'cliente'))
    } catch { /* silencioso */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (sess && activeTab === 'usuarios-ngp' && isAdmin) fetchUsuarios()
  }, [sess, activeTab, isAdmin, fetchUsuarios])

  function showMsg(type: 'ok' | 'err', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000) }

  async function criarUsuario(e: React.FormEvent) {
    e.preventDefault()
    const s = getSession(); if (!s) return
    setSaving(true)
    try {
      const res  = await fetch(`${SURL}/functions/v1/admin-criar-usuario`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, nome: fNome, username: fUser, email: fEmail, password: fPass, role: fRole }),
      })
      const data = await res.json()
      if (data.error) { showMsg('err', data.error); return }
      showMsg('ok', `Usuário @${data.usuario.username} criado com sucesso!`)
      setFNome(''); setFUser(''); setFEmail(''); setFPass(''); setFRole('ngp')
      setShowForm(false)
      fetchUsuarios()
    } catch { showMsg('err', 'Erro de conexão.') }
    finally { setSaving(false) }
  }

  function switchTab(tab: CadastrosTab) {
    setRequestedTab(tab)
    router.push(`/admin/usuarios?tab=${tab}`)
  }

  const internalCount = useMemo(() => usuarios.length, [usuarios])

  if (!sess) return null

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal setoresOnlyOpen />
      <main className={styles.main}>
        <div className={styles.content}>

          <header className={styles.header}>
            <button className={styles.btnBack} onClick={() => router.push('/setores')}>← Setores</button>
            <div className={styles.eyebrow}>Configurações · Cadastros</div>
            <h1 className={styles.title}>Cadastros</h1>
            <p className={styles.subtitle}>
              Centralize aqui a gestão de clientes da NGP, acessos do portal, CRM dos clientes e usuários internos da equipe.
            </p>
          </header>

          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab === 'clientes' ? styles.tabBtnActive : ''}`}
              onClick={() => switchTab('clientes')}
            >
              Central de clientes
            </button>
            {isAdmin && (
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'usuarios-ngp' ? styles.tabBtnActive : ''}`}
                onClick={() => switchTab('usuarios-ngp')}
              >
                Usuários da NGP
              </button>
            )}
          </div>

          {activeTab === 'clientes' ? (
            <ClientesCentralPanel />
          ) : (
            <>
              {msg && (
                <div className={`${styles.msgBar} ${msg.type === 'ok' ? styles.msgOk : styles.msgErr}`}>
                  {msg.type === 'ok' ? '✓ ' : '✕ '}{msg.text}
                </div>
              )}

              <div className={styles.toolbar}>
                <span className={styles.totalBadge}>{internalCount} usuário{internalCount !== 1 ? 's' : ''}</span>
                <button className={styles.btnNew} onClick={() => setShowForm(v => !v)}>
                  {showForm ? '✕ Cancelar' : '+ Novo usuário'}
                </button>
              </div>

              {showForm && (
                <form className={styles.form} onSubmit={criarUsuario}>
                  <div className={styles.formTitle}>Novo usuário interno NGP</div>
                  <div className={styles.formGrid}>
                    <div className={styles.field}>
                      <label>Nome completo</label>
                      <input type="text" placeholder="Ex: João Silva" value={fNome} onChange={e => setFNome(e.target.value)} required maxLength={80} />
                    </div>
                    <div className={styles.field}>
                      <label>Username (login)</label>
                      <input type="text" placeholder="ex: joao.silva" value={fUser} onChange={e => setFUser(e.target.value)} required maxLength={40} autoCapitalize="none" />
                    </div>
                    <div className={styles.field}>
                      <label>Email</label>
                      <input type="email" placeholder="joao@sejangp.com.br" value={fEmail} onChange={e => setFEmail(e.target.value)} required />
                    </div>
                    <div className={styles.field}>
                      <label>Senha</label>
                      <input type="password" placeholder="Mínimo 6 caracteres" value={fPass} onChange={e => setFPass(e.target.value)} required minLength={6} />
                    </div>
                    <div className={styles.field}>
                      <label>Role</label>
                      <select value={fRole} onChange={e => setFRole(e.target.value as typeof fRole)}>
                        <option value="ngp">NGP (colaborador)</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>
                  <button className={styles.btnSave} type="submit" disabled={saving}>
                    {saving ? 'Criando...' : 'Criar usuário'}
                  </button>
                </form>
              )}

              <section className={styles.section}>
                {loading ? (
                  <div className={styles.empty}>Carregando...</div>
                ) : usuarios.length === 0 ? (
                  <div className={styles.empty}>Nenhum usuário encontrado.</div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr><th>Usuário</th><th>Username</th><th>Role</th><th>Status</th><th>Criado em</th></tr>
                      </thead>
                      <tbody>
                        {usuarios.map(u => (
                          <tr key={u.id}>
                            <td>
                              <div className={styles.userCell}>
                                <div className={styles.avatar}>
                                  {u.foto_url ? <img src={u.foto_url} alt="" /> : u.nome.slice(0,2).toUpperCase()}
                                </div>
                                <span className={styles.userName}>{u.nome}</span>
                              </div>
                            </td>
                            <td className={styles.tdMuted}>@{u.username}</td>
                            <td><span className={`${styles.roleBadge} ${styles[`role_${u.role}`]}`}>{ROLE_LABEL[u.role] || u.role}</span></td>
                            <td><span className={`${styles.statusBadge} ${u.ativo ? styles.statusAtivo : styles.statusInativo}`}>{u.ativo ? 'Ativo' : 'Inativo'}</span></td>
                            <td className={styles.tdMuted}>{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

export default function UsuariosPage() {
  return (
    <Suspense fallback={null}>
      <UsuariosPageInner />
    </Suspense>
  )
}
