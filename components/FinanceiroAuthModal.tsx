'use client'
import { useState, useEffect, useRef } from 'react'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import styles from './FinanceiroAuthModal.module.css'

interface Props {
  onSuccess: () => void
  onClose: () => void
}

export default function FinanceiroAuthModal({ onSuccess, onClose }: Props) {
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const s = getSession()
    if (!s || !password) return
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`${SURL}/functions/v1/financeiro-auth`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, password }),
      })
      const data = await res.json()
      if (data?.error) {
        setError(
          data.error === 'Acesso não autorizado.'
            ? 'Você não tem permissão para acessar o Financeiro. Solicite ao ADM.'
            : data.error === 'Senha incorreta.'
            ? 'Senha incorreta. Tente novamente.'
            : data.error
        )
        setPassword('')
        inputRef.current?.focus()
        return
      }
      sessionStorage.setItem('fin_auth_ok', '1')
      onSuccess()
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.iconWrap}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        </div>
        <h2 className={styles.title}>Acesso Restrito</h2>
        <p className={styles.desc}>O setor Financeiro contém dados sigilosos. Confirme sua senha para continuar.</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            ref={inputRef}
            type="password"
            className={styles.input}
            placeholder="Digite sua senha"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          {error && <div className={styles.error}>{error}</div>}
          <button type="submit" className={styles.btnConfirm} disabled={loading || !password}>
            {loading ? 'Verificando...' : 'Entrar no Financeiro'}
          </button>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            Cancelar
          </button>
        </form>
      </div>
    </div>
  )
}
