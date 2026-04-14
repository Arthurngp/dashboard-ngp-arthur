'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import styles from './usuarios.module.css'

interface Usuario { id: string; nome: string; username: string; role: 'admin' | 'ngp' | 'cliente'; ativo: boolean; created_at: string; foto_url?: string }

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', ngp: 'NGP', cliente: 'Cliente' }

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

export default function UsuariosPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [fNome, setFNome] = useState('')
  const [fUser, setFUser] = useState('')
  const [fEmail, setFEmail] = useState('')
  const [fPass, setFPass] = useState('')
  const [fRole, setFRole] = useState<'admin' | 'ngp' | 'cliente'>('ngp')
  const [fMeta, setFMeta] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'admin') { router.replace('/setores'); return }
    setSess(s)
  }, [router])

  const fetchUsuarios = useCallback(async () => {
    const s = getSession(); if (!s) return
    setLoading(true)
    try {
      const res  = await fetch(`${SURL}/functions/v1/admin-listar-usuarios`, { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session }) })
      const data = await res.json()
      if (!data.error) setUsuarios(data.usuarios || [])
    } catch { /* silencioso */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (sess) fetchUsuarios() }, [sess, fetchUsuarios])

  function showMsg(type: 'ok' | 'err', text: string) { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000) }

  async function criarUsuario(e: React.FormEvent) {
    e.preventDefault()
    const s = getSession(); if (!s) return
    setSaving(true)
    try {
      const res  = await fetch(`${SURL}/functions/v1/admin-criar-usuario`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, nome: fNome, username: fUser, email: fEmail, password: fPass, role: fRole, meta_account_id: fMeta || undefined }),
      })
      const data = await res.json()
      if (data.error) { showMsg('err', data.error); return }
      showMsg('ok', `Usuário @${data.usuario.username} criado com sucesso!`)
      setFNome(''); setFUser(''); setFEmail(''); setFPass(''); setFRole('ngp'); setFMeta('')
      setShowForm(false)
      fetchUsuarios()
    } catch { showMsg('err', 'Erro de conexão.') }
    finally { setSaving(false) }
  }

  if (!sess) return null

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal />
      <main className={styles.main}>
        <div className={styles.content}>

          <header className={styles.header}>
            <button className={styles.btnBack} onClick={() => router.push('/setores')}>← Setores</button>
            <div className={styles.eyebrow}>Admin · Cadastrar</div>
            <h1 className={styles.title}>Usuários NGP Space</h1>
            <p className={styles.subtitle}>Crie e gerencie os usuários do sistema.</p>
          </header>

          {msg && (
            <div className={`${styles.msgBar} ${msg.type === 'ok' ? styles.msgOk : styles.msgErr}`}>
              {msg.type === 'ok' ? '✓ ' : '✕ '}{msg.text}
            </div>
          )}

          <div className={styles.toolbar}>
            <span className={styles.totalBadge}>{usuarios.length} usuário{usuarios.length !== 1 ? 's' : ''}</span>
            <button className={styles.btnNew} onClick={() => setShowForm(v => !v)}>
              {showForm ? '✕ Cancelar' : '+ Novo usuário'}
            </button>
          </div>

          {showForm && (
            <form className={styles.form} onSubmit={criarUsuario}>
              <div className={styles.formTitle}>Novo usuário</div>
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
                    <option value="cliente">Cliente</option>
                  </select>
                </div>
                {fRole === 'cliente' && (
                  <div className={`${styles.field} ${styles.fieldFull}`}>
                    <label>Meta Account ID <span className={styles.optional}>(opcional)</span></label>
                    <input type="text" placeholder="ID da conta de anúncios Meta" value={fMeta} onChange={e => setFMeta(e.target.value)} />
                  </div>
                )}
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

        </div>
      </main>
    </div>
  )
}
