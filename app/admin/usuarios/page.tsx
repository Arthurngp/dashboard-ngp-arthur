'use client'
import { Suspense, useEffect, useMemo, useState, useCallback } from 'react'
import Image from 'next/image'
import CustomSelect, { SelectOption } from '@/components/CustomSelect'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import ClientesCentralPanel from '../clientes/ClientesCentralPanel'
import styles from './usuarios.module.css'

interface Usuario {
  id: string
  nome: string
  username: string
  role: 'admin' | 'ngp' | 'cliente'
  ativo: boolean
  created_at: string
  foto_url?: string
  acesso_financeiro?: boolean
}

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', ngp: 'NGP', cliente: 'Cliente' }

const SETORES_CONFIG = [
  { key: 'acesso_financeiro', label: 'Financeiro', cor: '#059669' },
]

type CadastrosTab = 'clientes' | 'usuarios-ngp'

// Painel de gerenciamento de setores de um usuário
function SetoresPanel({
  usuario,
  onClose,
  onSaved,
}: {
  usuario: Usuario
  onClose: () => void
  onSaved: (u: Usuario) => void
}) {
  const [values, setValues] = useState<Record<string, boolean>>({
    acesso_financeiro: usuario.acesso_financeiro ?? false,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  async function salvar() {
    const s = getSession(); if (!s) return
    setSaving(true); setErr(null)
    try {
      const res  = await fetch(`${SURL}/functions/v1/admin-update-setores`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, usuario_id: usuario.id, setores: values }),
      })
      const data = await res.json()
      if (data.error) { setErr(data.error); return }
      onSaved({ ...usuario, ...values })
      onClose()
    } catch { setErr('Erro de conexão.') }
    finally { setSaving(false) }
  }

  return (
    <div className={styles.panelOverlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.panelHeader}>
          <div>
            <div className={styles.panelEyebrow}>Gerenciar acessos</div>
            <div className={styles.panelTitle}>{usuario.nome}</div>
            <div className={styles.panelSub}>@{usuario.username}</div>
          </div>
          <button className={styles.panelClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.panelBody}>
          <p className={styles.panelDesc}>
            Defina quais setores restritos este usuário pode acessar. Setores sem restrição ficam sempre disponíveis.
          </p>

          <div className={styles.setoresList}>
            {SETORES_CONFIG.map(s => (
              <label key={s.key} className={styles.setorRow}>
                <div className={styles.setorInfo}>
                  <span className={styles.setorDot} style={{ background: s.cor }} />
                  <span className={styles.setorLabel}>{s.label}</span>
                  <span className={styles.setorTag}>Acesso restrito</span>
                </div>
                <div
                  className={`${styles.toggle} ${values[s.key] ? styles.toggleOn : ''}`}
                  onClick={() => setValues(v => ({ ...v, [s.key]: !v[s.key] }))}
                  role="switch"
                  aria-checked={values[s.key]}
                >
                  <span className={styles.toggleThumb} />
                </div>
              </label>
            ))}
          </div>

          {err && <div className={styles.panelErr}>{err}</div>}
        </div>

        <div className={styles.panelFooter}>
          <button className={styles.btnCancelPanel} onClick={onClose}>Cancelar</button>
          <button className={styles.btnSavePanel} onClick={salvar} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar acessos'}
          </button>
        </div>
      </div>
    </div>
  )
}

function UsuariosPageInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [sess, setSess]           = useState<ReturnType<typeof getSession> | null>(null)
  const [usuarios, setUsuarios]   = useState<Usuario[]>([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [fNome, setFNome]         = useState('')
  const [fUser, setFUser]         = useState('')
  const [fEmail, setFEmail]       = useState('')
  const [fPass, setFPass]         = useState('')
  const [fRole, setFRole]         = useState<'admin' | 'ngp'>('ngp')
  const [fSetores, setFSetores]   = useState<Record<string, boolean>>({ acesso_financeiro: false })
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [requestedTab, setRequestedTab] = useState<CadastrosTab>('clientes')
  const [panelUsuario, setPanelUsuario] = useState<Usuario | null>(null)

  const isAdmin     = sess?.role === 'admin'
  const isMaster    = isAdmin && ['arthur', 'arthur.oliveira@sejangp.com.br'].includes(sess?.username ?? '')
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
      const res  = await fetch(`${SURL}/functions/v1/admin-listar-usuarios`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (!data.error) setUsuarios((data.usuarios || []).filter((u: Usuario) => u.role !== 'cliente'))
    } catch { /* silencioso */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (sess && activeTab === 'usuarios-ngp' && isAdmin) fetchUsuarios()
  }, [sess, activeTab, isAdmin, fetchUsuarios])

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 5000)
  }

  async function criarUsuario(e: React.FormEvent) {
    e.preventDefault()
    const s = getSession(); if (!s) return
    setSaving(true)
    try {
      // 1. Cria o usuário
      const res  = await fetch(`${SURL}/functions/v1/admin-criar-usuario`, {
        method: 'POST', headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, nome: fNome, username: fUser, email: fEmail, password: fPass, role: fRole }),
      })
      const data = await res.json()
      if (data.error) { showMsg('err', data.error); return }

      // 2. Se master e algum setor marcado, aplica os acessos
      if (isMaster && Object.values(fSetores).some(Boolean)) {
        await fetch(`${SURL}/functions/v1/admin-update-setores`, {
          method: 'POST', headers: efHeaders(),
          body: JSON.stringify({ session_token: s.session, usuario_id: data.usuario.id, setores: fSetores }),
        })
      }

      showMsg('ok', `Usuário @${data.usuario.username} criado com sucesso!`)
      setFNome(''); setFUser(''); setFEmail(''); setFPass(''); setFRole('ngp')
      setFSetores({ acesso_financeiro: false })
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
      <Sidebar showDashboardNav={false} minimal />
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
                      <CustomSelect
                        caption="Role"
                        value={fRole}
                        options={[
                          { id: 'ngp', label: 'NGP (colaborador)' },
                          { id: 'admin', label: 'Admin' }
                        ]}
                        onChange={val => setFRole(val as 'admin' | 'ngp')}
                      />
                    </div>
                  </div>

                  {/* Setores restritos — só visível para o ADM Master */}
                  {isMaster && (
                    <div className={styles.setoresFormBlock}>
                      <div className={styles.setoresFormTitle}>Acesso a setores restritos</div>
                      <div className={styles.setoresFormGrid}>
                        {SETORES_CONFIG.map(s => (
                          <label key={s.key} className={styles.setorCheck}>
                            <input
                              type="checkbox"
                              checked={!!fSetores[s.key]}
                              onChange={e => setFSetores(v => ({ ...v, [s.key]: e.target.checked }))}
                            />
                            <span className={styles.setorCheckDot} style={{ background: s.cor }} />
                            <span>{s.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

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
                        <tr>
                          <th>Usuário</th>
                          <th>Username</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Criado em</th>
                          {isMaster && <th>Setores</th>}
                          {isMaster && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {usuarios.map(u => (
                          <tr key={u.id}>
                            <td>
                              <div className={styles.userCell}>
                                <div className={styles.avatar}>
                                  {u.foto_url ? <Image src={u.foto_url} alt={u.nome} width={32} height={32} style={{ objectFit: 'cover', borderRadius: '50%' }} /> : u.nome.slice(0, 2).toUpperCase()}
                                </div>
                                <span className={styles.userName}>{u.nome}</span>
                              </div>
                            </td>
                            <td className={styles.tdMuted}>@{u.username}</td>
                            <td>
                              <span className={`${styles.roleBadge} ${styles[`role_${u.role}`]}`}>
                                {ROLE_LABEL[u.role] || u.role}
                              </span>
                            </td>
                            <td>
                              <span className={`${styles.statusBadge} ${u.ativo ? styles.statusAtivo : styles.statusInativo}`}>
                                {u.ativo ? 'Ativo' : 'Inativo'}
                              </span>
                            </td>
                            <td className={styles.tdMuted}>{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
                            {isMaster && (
                              <td>
                                <div className={styles.setoresTags}>
                                  {u.acesso_financeiro
                                    ? <span className={styles.setorTagOn} style={{ borderColor: '#059669', color: '#059669' }}>Financeiro</span>
                                    : <span className={styles.setorTagOff}>Financeiro</span>
                                  }
                                </div>
                              </td>
                            )}
                            {isMaster && (
                              <td>
                                <button
                                  className={styles.btnSetores}
                                  onClick={() => setPanelUsuario(u)}
                                >
                                  Gerenciar setores
                                </button>
                              </td>
                            )}
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

      {/* Painel de setores */}
      {panelUsuario && (
        <SetoresPanel
          usuario={panelUsuario}
          onClose={() => setPanelUsuario(null)}
          onSaved={(updated) => {
            setUsuarios(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u))
            setPanelUsuario(null)
          }}
        />
      )}
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
