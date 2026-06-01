'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import styles from './clientes.module.css'

interface ClienteCentral {
  id: string
  nome: string
  username: string
  email: string
  ativo: boolean
  created_at: string
  foto_url?: string | null
  meta_account_id?: string | null
  google_ads_customer_id?: string | null
  analytics_enabled: boolean
  reports_enabled: boolean
  crm_enabled: boolean
  crm_pipeline_count: number
  crm_pipeline_name?: string | null
}

// Customer ID Google Ads tem 10 dígitos; exibe formato xxx-xxx-xxxx pra leitura.
function formatGoogleAdsId(id: string): string {
  const clean = String(id).replace(/-/g, '')
  if (clean.length !== 10) return id
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`
}

const emptyForm = {
  id: '',
  nome: '',
  email: '',
  password: '',
  meta_account_id: '',
  google_ads_customer_id: '',
  ativo: true,
  analytics_enabled: true,
  reports_enabled: true,
  crm_enabled: false,
  crm_pipeline_name: '',
}

export default function ClientesCentralPanel() {
  const [clientes, setClientes] = useState<ClienteCentral[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [form, setForm] = useState(emptyForm)

  const isEditing = !!editingId

  const loadClientes = useCallback(async () => {
    const s = getSession()
    if (!s?.session) return
    setLoading(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/admin-listar-clientes-central`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Erro ao carregar clientes.')
      setClientes(data.clientes || [])
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Erro ao carregar clientes.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadClientes()
  }, [loadClientes])

  function showMessage(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    window.setTimeout(() => setMsg(null), 5000)
  }

  function openCreate() {
    setEditingId('')
    setForm(emptyForm)
    setShowForm(true)
  }

  function openEdit(cliente: ClienteCentral) {
    setEditingId(cliente.id)
    setForm({
      id: cliente.id,
      nome: cliente.nome,
      email: cliente.email,
      password: '',
      meta_account_id: cliente.meta_account_id || '',
      google_ads_customer_id: cliente.google_ads_customer_id || '',
      ativo: cliente.ativo,
      analytics_enabled: cliente.analytics_enabled,
      reports_enabled: cliente.reports_enabled,
      crm_enabled: cliente.crm_enabled,
      crm_pipeline_name: cliente.crm_pipeline_name || `CRM de ${cliente.nome}`,
    })
    setShowForm(true)
  }

  async function saveCliente(e: React.FormEvent) {
    e.preventDefault()
    const s = getSession()
    if (!s?.session) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        session_token: s.session,
        nome: form.nome,
        email: form.email,
        meta_account_id: form.meta_account_id || undefined,
        google_ads_customer_id: form.google_ads_customer_id || undefined,
        ativo: form.ativo,
        analytics_enabled: form.analytics_enabled,
        reports_enabled: form.reports_enabled,
        crm_enabled: form.crm_enabled,
        crm_pipeline_name: form.crm_pipeline_name || undefined,
      }
      if (isEditing) payload.id = editingId
      if (form.password.trim()) payload.password = form.password.trim()

      const res = await fetch(`${SURL}/functions/v1/admin-upsert-cliente-central`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Erro ao salvar cliente.')

      showMessage('ok', isEditing ? 'Cliente atualizado com sucesso.' : 'Cliente criado com sucesso.')
      setShowForm(false)
      setEditingId('')
      setForm(emptyForm)
      loadClientes()
    } catch (e) {
      showMessage('err', e instanceof Error ? e.message : 'Erro ao salvar cliente.')
    } finally {
      setSaving(false)
    }
  }

  async function archiveCliente(cliente: ClienteCentral) {
    const s = getSession()
    if (!s?.session) return

    const confirmed = window.confirm(
      `Arquivar ${cliente.nome}?\n\nO cliente sairá da operação ativa e ficará disponível apenas em "Clientes Arquivados".`
    )
    if (!confirmed) return

    setArchivingId(cliente.id)
    try {
      const res = await fetch(`${SURL}/functions/v1/archive-cliente`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, action: 'archive', id: cliente.id }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Erro ao arquivar cliente.')

      setClientes((prev) => prev.filter((item) => item.id !== cliente.id))
      if (editingId === cliente.id) {
        setShowForm(false)
        setEditingId('')
        setForm(emptyForm)
      }
      showMessage('ok', 'Cliente arquivado. Ele agora aparece apenas na lista de clientes arquivados.')
    } catch (e) {
      showMessage('err', e instanceof Error ? e.message : 'Erro ao arquivar cliente.')
    } finally {
      setArchivingId(null)
    }
  }

  const activeCount = useMemo(() => clientes.filter((cliente) => cliente.ativo).length, [clientes])

  return (
    <>
      {msg && (
        <div className={`${styles.msgBar} ${msg.type === 'ok' ? styles.msgOk : styles.msgErr}`}>
          {msg.text}
        </div>
      )}

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Clientes</span>
          <strong>{clientes.length}</strong>
          <p>{activeCount} ativos na área do cliente.</p>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>CRM liberado</span>
          <strong>{clientes.filter((cliente) => cliente.crm_enabled).length}</strong>
          <p>Contas que já podem abrir o Comercial Digital.</p>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Relatórios</span>
          <strong>{clientes.filter((cliente) => cliente.analytics_enabled || cliente.reports_enabled).length}</strong>
          <p>Contas com acesso a análise de dados e relatórios.</p>
        </article>
      </section>

      <div className={styles.toolbar}>
        <span className={styles.totalBadge}>{clientes.length} cliente{clientes.length !== 1 ? 's' : ''}</span>
        <button className={styles.btnNew} onClick={() => showForm ? setShowForm(false) : openCreate()}>
          {showForm ? 'Fechar cadastro' : 'Novo cliente'}
        </button>
      </div>

      {showForm && (
        <form className={styles.formCard} onSubmit={saveCliente}>
          <div className={styles.formHeader}>
            <div>
              <h2>{isEditing ? 'Editar cliente' : 'Novo cliente NGP'}</h2>
              <p>
                {isEditing
                  ? 'Atualize login, conta Meta e a liberação das áreas que esse cliente pode acessar.'
                  : 'Crie o acesso do cliente e já defina o que ficará liberado na Área do Cliente.'}
              </p>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Nome do cliente</span>
              <input
                type="text"
                value={form.nome}
                onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))}
                placeholder="Ex: Arthur Teste"
                required
              />
            </label>

            <label className={styles.field}>
              <span>E-mail de acesso</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="cliente@empresa.com"
                required
              />
            </label>

            <label className={styles.field}>
              <span>{isEditing ? 'Nova senha (opcional)' : 'Senha inicial'}</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder={isEditing ? 'Preencha só se quiser trocar' : 'Mínimo 6 caracteres'}
                minLength={isEditing ? undefined : 6}
              />
            </label>

            <label className={styles.field}>
              <span>Meta Account ID</span>
              <input
                type="text"
                value={form.meta_account_id}
                onChange={(e) => setForm((prev) => ({ ...prev, meta_account_id: e.target.value }))}
                placeholder="act_123456789 ou 123456789"
              />
            </label>

            <label className={styles.field}>
              <span>Google Ads Customer ID</span>
              <input
                type="text"
                value={form.google_ads_customer_id}
                onChange={(e) => setForm((prev) => ({ ...prev, google_ads_customer_id: e.target.value }))}
                placeholder="123-456-7890 ou 1234567890"
              />
            </label>

            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span>Nome do CRM inicial</span>
              <input
                type="text"
                value={form.crm_pipeline_name}
                onChange={(e) => setForm((prev) => ({ ...prev, crm_pipeline_name: e.target.value }))}
                placeholder={`CRM de ${form.nome || 'Novo Cliente'}`}
              />
            </label>
          </div>

          <div className={styles.accessPanel}>
            <div className={styles.accessIntro}>
              <h3>Liberação da Área do Cliente</h3>
              <p>Defina exatamente quais módulos esse cliente verá ao entrar no portal.</p>
            </div>

            <label className={styles.toggleCard}>
              <input
                type="checkbox"
                checked={form.analytics_enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, analytics_enabled: e.target.checked }))}
              />
              <div>
                <strong>Análise de dados</strong>
                <span>Libera o painel de campanhas e indicadores.</span>
              </div>
            </label>

            <label className={styles.toggleCard}>
              <input
                type="checkbox"
                checked={form.reports_enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, reports_enabled: e.target.checked }))}
              />
              <div>
                <strong>Relatórios</strong>
                <span>Permite abrir os relatórios publicados na área do cliente.</span>
              </div>
            </label>

            <label className={styles.toggleCard}>
              <input
                type="checkbox"
                checked={form.crm_enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, crm_enabled: e.target.checked }))}
              />
              <div>
                <strong>CRM / Comercial Digital</strong>
                <span>Libera o CRM isolado do cliente e cria o funil inicial quando necessário.</span>
              </div>
            </label>

            <label className={styles.toggleCard}>
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setForm((prev) => ({ ...prev, ativo: e.target.checked }))}
              />
              <div>
                <strong>Cliente ativo</strong>
                <span>Controle geral de acesso do usuário ao portal.</span>
              </div>
            </label>
          </div>

          <button className={styles.btnSave} type="submit" disabled={saving}>
            {saving ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Criar cliente'}
          </button>
        </form>
      )}

      <section className={styles.listSection}>
        {loading ? (
          <div className={styles.emptyState}>Carregando clientes...</div>
        ) : clientes.length === 0 ? (
          <div className={styles.emptyState}>Nenhum cliente cadastrado ainda.</div>
        ) : (
          <div className={styles.cardsGrid}>
            {clientes.map((cliente) => (
              <article key={cliente.id} className={styles.clientCard}>
                <div className={styles.clientHeader}>
                  <div className={styles.clientIdentity}>
                    <div className={styles.avatar}>
                      {cliente.foto_url ? <Image src={cliente.foto_url} alt={cliente.nome} width={40} height={40} style={{ objectFit: 'cover', width: '100%', height: '100%' }} /> : cliente.nome.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h3>{cliente.nome}</h3>
                      <p>{cliente.email}</p>
                    </div>
                  </div>
                  <div className={styles.clientActions}>
                    <button className={styles.editBtn} onClick={() => openEdit(cliente)} disabled={archivingId === cliente.id}>
                      Editar
                    </button>
                    <button
                      className={styles.archiveBtn}
                      onClick={() => archiveCliente(cliente)}
                      disabled={archivingId === cliente.id}
                    >
                      {archivingId === cliente.id ? 'Arquivando...' : 'Arquivar'}
                    </button>
                  </div>
                </div>

                <div className={styles.badgeRow}>
                  <span className={`${styles.badge} ${cliente.ativo ? styles.badgeGreen : styles.badgeMuted}`}>
                    {cliente.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                  <span className={`${styles.badge} ${cliente.analytics_enabled ? styles.badgeBlue : styles.badgeMuted}`}>Análise</span>
                  <span className={`${styles.badge} ${cliente.reports_enabled ? styles.badgeBlue : styles.badgeMuted}`}>Relatórios</span>
                  <span className={`${styles.badge} ${cliente.crm_enabled ? styles.badgePurple : styles.badgeMuted}`}>CRM</span>
                </div>

                <div className={styles.clientMeta}>
                  <div>
                    <span className={styles.metaLabel}>Meta Account</span>
                    <strong>{cliente.meta_account_id || 'Não vinculada'}</strong>
                  </div>
                  <div>
                    <span className={styles.metaLabel}>Google Ads</span>
                    <strong>{cliente.google_ads_customer_id ? formatGoogleAdsId(cliente.google_ads_customer_id) : 'Não vinculada'}</strong>
                  </div>
                  <div>
                    <span className={styles.metaLabel}>CRM</span>
                    <strong>{cliente.crm_pipeline_name || (cliente.crm_enabled ? 'Liberado sem funil' : 'Não liberado')}</strong>
                  </div>
                </div>

                <div className={styles.clientFooter}>
                  <span>{new Date(cliente.created_at).toLocaleDateString('pt-BR')}</span>
                  <span>{cliente.crm_pipeline_count} funil{cliente.crm_pipeline_count !== 1 ? 's' : ''}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
