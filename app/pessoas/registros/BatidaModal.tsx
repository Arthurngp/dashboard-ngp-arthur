'use client'
import { useState, useEffect } from 'react'
import CustomSelect from '@/components/CustomSelect'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import styles from './BatidaModal.module.css'

interface UsuarioOption {
  id: string
  nome: string
}

interface BatidaRecord {
  id: string
  usuario_id: string
  tipo_registro: string
  created_at: string             // UTC ISO
  observacao?: string | null
}

interface Props {
  mode: 'create' | 'edit'
  usuarios: UsuarioOption[]      // só usado em create
  defaultUsuarioId?: string
  defaultData?: string           // YYYY-MM-DD — só em create
  record?: BatidaRecord          // obrigatório em edit
  onClose: () => void
  onSaved: () => void
}

const TIPOS_OPTS = [
  { id: 'entrada',        label: 'Entrada' },
  { id: 'saida_almoco',   label: 'Saída almoço' },
  { id: 'retorno_almoco', label: 'Retorno almoço' },
  { id: 'saida',          label: 'Saída' },
  { id: 'extra',          label: 'Extra' },
]

function utcToLocalInput(iso: string): string {
  // UTC ISO → YYYY-MM-DDTHH:mm em BRT (-03:00) pra <input type="datetime-local">
  const d = new Date(iso)
  const ms = d.getTime() - 3 * 60 * 60 * 1000
  const local = new Date(ms)
  const yyyy = local.getUTCFullYear()
  const mm = (local.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = local.getUTCDate().toString().padStart(2, '0')
  const hh = local.getUTCHours().toString().padStart(2, '0')
  const mi = local.getUTCMinutes().toString().padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

export default function BatidaModal({ mode, usuarios, defaultUsuarioId, defaultData, record, onClose, onSaved }: Props) {
  const [usuarioId, setUsuarioId] = useState(
    record?.usuario_id || defaultUsuarioId || (usuarios[0]?.id ?? '')
  )
  const [tipo, setTipo] = useState(record?.tipo_registro || 'entrada')
  const [dataHora, setDataHora] = useState(
    record ? utcToLocalInput(record.created_at)
    : defaultData ? `${defaultData}T08:00`
    : `${new Date().toISOString().split('T')[0]}T08:00`
  )
  const [observacao, setObservacao] = useState(record?.observacao || '')

  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setError(null) }, [tipo, dataHora, usuarioId])

  const canSubmit = !!usuarioId && !!tipo && !!dataHora

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    const s = getSession()
    if (!s) return
    setLoading(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        session_token: s.session,
      }
      if (mode === 'create') {
        payload.action = 'create'
        payload.usuario_id = usuarioId
        payload.tipo_registro = tipo
        payload.data_hora = dataHora
        if (observacao.trim()) payload.observacao = observacao.trim()
      } else {
        payload.action = 'update'
        payload.record_id = record!.id
        payload.tipo_registro = tipo
        payload.data_hora = dataHora
        payload.observacao = observacao.trim() || null
      }

      const res = await fetch(`${SURL}/functions/v1/admin-ponto-manage`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify(payload),
      })
      const out = await res.json()
      if (out?.error) {
        setError(out.error)
        return
      }
      onSaved()
      onClose()
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!record) return
    if (!window.confirm('Deletar esta batida? (vai pra lixeira e pode ser restaurada)')) return
    const s = getSession()
    if (!s) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`${SURL}/functions/v1/admin-ponto-delete`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ session_token: s.session, record_ids: [record.id] }),
      })
      const out = await res.json()
      if (out?.error) {
        setError(out.error)
        return
      }
      onSaved()
      onClose()
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setDeleting(false)
    }
  }

  const isEdit = mode === 'edit'

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.iconWrap}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={26} height={26}>
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <h2 className={styles.title}>{isEdit ? 'Editar batida' : 'Adicionar batida'}</h2>
        <p className={styles.desc}>
          {isEdit ? 'Corrija o tipo, horário ou observação da batida.' : 'Cadastre uma batida que faltou.'}
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          {!isEdit && (
            <div className={styles.field}>
              <label className={styles.label}>Colaborador</label>
              <CustomSelect
                caption="Colaborador"
                value={usuarioId}
                options={usuarios.map(u => ({ id: u.id, label: u.nome }))}
                onChange={setUsuarioId}
              />
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label}>Tipo</label>
            <CustomSelect
              caption="Tipo"
              value={tipo}
              options={TIPOS_OPTS}
              onChange={setTipo}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Data e horário (BRT)</label>
            <input
              type="datetime-local"
              className={styles.input}
              value={dataHora}
              onChange={e => setDataHora(e.target.value)}
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Observação (opcional)</label>
            <textarea
              className={styles.textarea}
              rows={2}
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              placeholder="Ex.: registro retroativo, ajuste manual"
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <button type="button" className={styles.btnCancel} onClick={onClose} disabled={loading || deleting}>
              Cancelar
            </button>
            <button type="submit" className={styles.btnConfirm} disabled={!canSubmit || loading || deleting}>
              {loading ? 'Salvando...' : isEdit ? 'Salvar' : 'Adicionar'}
            </button>
          </div>

          {isEdit && (
            <button
              type="button"
              className={styles.btnDelete}
              onClick={handleDelete}
              disabled={loading || deleting}
            >
              {deleting ? 'Deletando...' : 'Deletar batida'}
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
