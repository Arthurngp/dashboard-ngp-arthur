'use client'
import { useState, useEffect } from 'react'
import { getSession, setSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import styles from './AccountSelector.module.css'

interface Cliente {
  id: string
  username: string
  nome: string
  meta_account_id: string | null
  foto_url: string | null
}

export default function AccountSelector() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [currentAccount, setCurrentAccount] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDropdown, setShowDropdown] = useState(false)

  useEffect(() => {
    loadAccounts()
  }, [])

  async function loadAccounts() {
    try {
      const sess = getSession()
      if (!sess?.session || sess.role !== 'ngp') return

      const res = await fetch(`${SURL}/functions/v1/get-ngp-data`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: sess.session })
      })

      const data = await res.json()
      if (res.ok && data.clientes) {
        setClientes(data.clientes.filter((c: Cliente) => c.meta_account_id))
      }

      // Recuperar conta atualmente selecionada
      const current = sessionStorage.getItem('ngp_viewing_account')
      setCurrentAccount(current)
    } catch (e) {
      console.error('Erro ao carregar contas:', e)
    } finally {
      setLoading(false)
    }
  }

  function selectAccount(accountId: string, clienteName: string, clienteUsername: string, clienteId: string) {
    sessionStorage.setItem('ngp_viewing_account', accountId)
    sessionStorage.setItem('ngp_viewing_name', clienteName)
    sessionStorage.setItem('ngp_viewing_username', clienteUsername)
    sessionStorage.setItem('ngp_viewing_id', clienteId)
    setCurrentAccount(accountId)
    setShowDropdown(false)
    // Trigger page reload to refresh data with new account
    window.location.reload()
  }

  const selectedCliente = clientes.find(c => c.meta_account_id === currentAccount)

  if (loading || clientes.length === 0) return null

  return (
    <div className={styles.container}>
      <button
        className={styles.trigger}
        onClick={() => setShowDropdown(!showDropdown)}
        title="Trocar conta de cliente"
      >
        {selectedCliente ? (
          <>
            {selectedCliente.foto_url && <img src={selectedCliente.foto_url} alt="" />}
            <span>{selectedCliente.nome}</span>
          </>
        ) : (
          <>
            <span className={styles.icon}>👤</span>
            <span>Selecionar conta</span>
          </>
        )}
        <svg className={`${styles.arrow} ${showDropdown ? styles.open : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {showDropdown && (
        <div className={styles.dropdown}>
          {clientes.map(cliente => (
            <button
              key={cliente.id}
              className={`${styles.option} ${currentAccount === cliente.meta_account_id ? styles.active : ''}`}
              onClick={() => selectAccount(cliente.meta_account_id!, cliente.nome, cliente.username, cliente.id)}
            >
              {cliente.foto_url && <img src={cliente.foto_url} alt="" />}
              <div>
                <div className={styles.optionName}>{cliente.nome}</div>
                <div className={styles.optionId}>{cliente.meta_account_id}</div>
              </div>
              {currentAccount === cliente.meta_account_id && <span className={styles.checkmark}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
