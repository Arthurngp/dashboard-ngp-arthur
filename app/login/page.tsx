'use client'
import { useState, useEffect, Suspense } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { setSession, getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import styles from './login.module.css'

const DecoIcons = () => (
  <>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="13" y1="2" x2="13" y2="22"/><path d="M2 9l11-7 11 7"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></div>
    <div className={styles.deco}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div>
  </>
)

function LoginContent() {
  const router  = useRouter()
  const params  = useSearchParams()
  const [mounted, setMounted]       = useState(false)
  const [tab, setTab]               = useState<'cliente' | 'ngp'>('ngp')
  const [user, setUser]             = useState('')
  const [pass, setPass]             = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('Verificando...')

  useEffect(() => {
    const sess = getSession()
    if (sess?.auth === '1') {
      router.replace(sess.role === 'ngp' || sess.role === 'admin' ? '/setores' : '/cliente')
      return
    }
    setMounted(true)
  }, [router])

  function switchTab(t: 'cliente' | 'ngp') {
    setTab(t)
    setError('')
    setUser('')
    setPass('')
  }

  async function doLogin() {
    if (!user || !pass) { setError('Preencha todos os campos.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch(`${SURL}/functions/v1/login`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ username: user.trim().toLowerCase(), password: pass, role: tab }),
      })
      const data = await res.json()

      if (!res.ok || data.error) {
        setError(data.error || 'Credencial inválida.')
        setLoading(false)
        return
      }

      setSession({
        auth:        '1',
        session:     data.session_token,
        user:        data.user.nome,
        role:        data.user.role,
        username:    data.user.username,
        expires:     data.expires_at,
        metaAccount: data.user.meta_account_id,
        foto:        data.user.foto_url,
      })

      setLoadingMsg(`Bem-vindo, ${data.user.nome}!`)
      const returnUrl  = params.get('returnUrl')
      const redirectTo = returnUrl
        ? decodeURIComponent(returnUrl)
        : (data.user.role === 'ngp' || data.user.role === 'admin') ? '/setores' : '/cliente'

      router.replace(redirectTo)
    } catch (e: unknown) {
      setError('Erro de conexão: ' + (e instanceof Error ? e.message : 'Tente novamente.'))
      setLoading(false)
    }
  }

  if (!mounted) return null

  const isNgp = tab === 'ngp'

  return (
    <>
      {loading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
          <p>{loadingMsg}</p>
        </div>
      )}

      <div className={styles.page}>
        <DecoIcons />

        <div className={styles.wrap}>
          {/* Logo */}
          <div className={styles.logoArea}>
            <div className={styles.logoMark}>
              <Image src="/logos/logo-ngp.png" alt="NGP" width={140} height={80} style={{ objectFit: 'contain' }} />
            </div>
            <div className={styles.logoText}>NGP <span>SPACE</span></div>
            <div className={styles.logoSub}>Sistema Geral</div>
          </div>

          {/* Seletor de acesso */}
          <div className={styles.tabSelector}>
            <button
              className={`${styles.tabBtn} ${!isNgp ? styles.tabBtnActive : ''}`}
              onClick={() => switchTab('cliente')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              Cliente
            </button>
            <button
              className={`${styles.tabBtn} ${isNgp ? styles.tabBtnActive : ''}`}
              onClick={() => switchTab('ngp')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              NGP
            </button>
          </div>

          {/* Card */}
          <div className={`${styles.card} ${isNgp ? styles.cardNgp : ''}`}>
            <h1 className={styles.cardTitle}>
              {isNgp ? 'Acesso Equipe NGP' : 'Área do Cliente'}
            </h1>
            <p className={styles.cardSub}>
              {isNgp
                ? 'Acesso exclusivo para colaboradores NGP.'
                : 'Utilize suas credenciais de acesso.'}
            </p>

            {/* Google SSO — só para NGP */}
            {isNgp && (
              <>
                <button className={styles.btnGoogle} type="button" onClick={() => {}}>
                  <svg width="18" height="18" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                  Continuar com Google Cloud
                </button>
                <div className={styles.divider}>
                  <div className={styles.dividerLine} />
                  <span>OU</span>
                  <div className={styles.dividerLine} />
                </div>
              </>
            )}

            {error && <div className={styles.err}>{error}</div>}

            {/* Usuário */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Usuário</label>
              <div className={styles.fieldWrap}>
                <span className={styles.fieldIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </span>
                <input
                  className={styles.fieldInput}
                  type="text"
                  placeholder={isNgp ? 'usuario.ngp' : 'seu.usuario'}
                  value={user}
                  onChange={e => setUser(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doLogin()}
                />
              </div>
            </div>

            {/* Senha */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Senha</label>
              <div className={styles.fieldWrap}>
                <span className={styles.fieldIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0110 0v4"/>
                  </svg>
                </span>
                <input
                  className={styles.fieldInput}
                  type="password"
                  placeholder="••••••••"
                  value={pass}
                  onChange={e => setPass(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doLogin()}
                />
              </div>
            </div>

            <button className={styles.btnLogin} onClick={doLogin} disabled={loading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              {loading ? 'Aguarde...' : isNgp ? 'Efetivar Acesso Mestre' : 'Entrar'}
            </button>
          </div>

          <div className={styles.footer}>
            NGP SPACE © 2026 · ALL DATA ENCRYPTED
          </div>
        </div>
      </div>
    </>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff' }} />}>
      <LoginContent />
    </Suspense>
  )
}
