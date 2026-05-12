'use client'
import { useState, useEffect } from 'react'
import CustomSelect from '@/components/CustomSelect'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import styles from './AusenciaModal.module.css'

interface UsuarioOption {
  id: string
  nome: string
}

interface ExistingRecord {
  id: string
  tipo_registro: string
  created_at: string
  observacao?: string | null
}

interface Props {
  usuarios: UsuarioOption[]
  defaultUsuarioId?: string
  defaultData?: string         // YYYY-MM-DD
  onClose: () => void
  onSaved: () => void          // chamado após sucesso pra parent re-buscar dados
}

const TIPOS_OPTS = [
  { id: 'atestado',          label: 'Atestado' },
  { id: 'feriado',           label: 'Feriado' },
  { id: 'folga',             label: 'Folga' },
  { id: 'falta_justificada', label: 'Falta justificada' },
]

function tipoLabel(tipo: string): string {
  const f = TIPOS_OPTS.find(t => t.id === tipo)
  return f ? f.label : tipo
}

function tipoBatidaLabel(t: string): string {
  const map: Record<string, string> = {
    entrada: 'Entrada',
    saida_almoco: 'Saída almoço',
    retorno_almoco: 'Retorno almoço',
    saida: 'Saída',
    extra: 'Extra',
  }
  return map[t] || t
}

function utcToHHmm(iso: string): string {
  const d = new Date(iso)
  const ms = d.getTime() - 3 * 60 * 60 * 1000
  const local = new Date(ms)
  return `${local.getUTCHours().toString().padStart(2, '0')}:${local.getUTCMinutes().toString().padStart(2, '0')}`
}

export default function AusenciaModal({ usuarios, defaultUsuarioId, defaultData, onClose, onSaved }: Props) {
  const [usuarioId, setUsuarioId] = useState(defaultUsuarioId || (usuarios[0]?.id ?? ''))
  const [data, setData]           = useState(defaultData || new Date().toISOString().split('T')[0])
  const [tipo, setTipo]           = useState('atestado')
  const [escopo, setEscopo]       = useState<'dia' | 'faixa'>('dia')
  const [horaInicio, setHoraInicio] = useState('13:00')
  const [horaFim, setHoraFim]       = useState('17:00')
  const [observacao, setObservacao] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [confirmStep, setConfirmStep] = useState<{ existing: ExistingRecord[] } | null>(null)

  useEffect(() => { setError(null) }, [tipo, escopo, usuarioId, data])

  const canSubmit = !!usuarioId && !!data && !!tipo
    && (escopo === 'dia' || (horaInicio && horaFim && horaFim > horaInicio))

  const showObsLivre = tipo === 'atestado' || tipo === 'falta_justificada'

  async function callMarkAbsence(replace: boolean | null) {
    const s = getSession()
    if (!s) return
    setLoading(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        session_token: s.session,
        action: 'mark_absence',
        usuario_id: usuarioId,
        data,
        tipo_ausencia: tipo,
        escopo,
        observacao: observacao.trim() || null,
      }
      if (escopo === 'faixa') {
        payload.hora_inicio = horaInicio
        payload.hora_fim = horaFim
      }
      if (replace === true) payload.replace_existing = true
      if (replace === false) payload.confirmed_keep = true

      const res = await fetch(`${SURL}/functions/v1/admin-ponto-manage`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify(payload),
      })
      const out = await res.json()

      if (out?.code === 'has_existing') {
        setConfirmStep({ existing: out.existing_records || [] })
        return
      }
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

  // Tela de confirmação quando o dia tem batidas
  if (confirmStep) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={e => e.stopPropagation()}>
          <h2 className={styles.title}>Dia já tem batidas</h2>
          <p className={styles.desc}>
            Este dia tem {confirmStep.existing.length} batida{confirmStep.existing.length > 1 ? 's' : ''} registrada{confirmStep.existing.length > 1 ? 's' : ''}.
            Como deseja marcar a ausência ({tipoLabel(tipo)})?
          </p>
          <ul className={styles.existingList}>
            {confirmStep.existing.map(r => (
              <li key={r.id}>
                <strong>{tipoBatidaLabel(r.tipo_registro)}</strong> · {utcToHHmm(r.created_at)}
              </li>
            ))}
          </ul>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => callMarkAbsence(false)}
              disabled={loading}
            >
              Manter batidas
            </button>
            <button
              type="button"
              className={styles.btnDanger}
              onClick={() => callMarkAbsence(true)}
              disabled={loading}
            >
              Apagar batidas e marcar
            </button>
          </div>
          <button type="button" className={styles.btnCancel} onClick={onClose} disabled={loading}>
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.iconWrap}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={26} height={26}>
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </div>
        <h2 className={styles.title}>Marcar ausência</h2>
        <p className={styles.desc}>Registre atestado, feriado, folga ou falta justificada.</p>

        <form className={styles.form} onSubmit={e => { e.preventDefault(); callMarkAbsence(null) }}>
          <div className={styles.field}>
            <label className={styles.label}>Colaborador</label>
            <CustomSelect
              caption="Colaborador"
              value={usuarioId}
              options={usuarios.map(u => ({ id: u.id, label: u.nome }))}
              onChange={setUsuarioId}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Data</label>
            <input
              type="date"
              className={styles.input}
              value={data}
              onChange={e => setData(e.target.value)}
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Tipo de ausência</label>
            <CustomSelect
              caption="Tipo"
              value={tipo}
              options={TIPOS_OPTS}
              onChange={setTipo}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Período</label>
            <div className={styles.toggleRow}>
              <button
                type="button"
                className={`${styles.toggleBtn} ${escopo === 'dia' ? styles.toggleBtnActive : ''}`}
                onClick={() => setEscopo('dia')}
              >Dia inteiro</button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${escopo === 'faixa' ? styles.toggleBtnActive : ''}`}
                onClick={() => setEscopo('faixa')}
              >Faixa horária</button>
            </div>
          </div>

          {escopo === 'faixa' && (
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label}>Início</label>
                <input
                  type="time"
                  className={styles.input}
                  value={horaInicio}
                  onChange={e => setHoraInicio(e.target.value)}
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Fim</label>
                <input
                  type="time"
                  className={styles.input}
                  value={horaFim}
                  onChange={e => setHoraFim(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {showObsLivre && (
            <div className={styles.field}>
              <label className={styles.label}>Observação (opcional)</label>
              <textarea
                className={styles.textarea}
                rows={2}
                value={observacao}
                onChange={e => setObservacao(e.target.value)}
                placeholder={tipo === 'atestado' ? 'Ex.: CID Z76.3' : 'Ex.: luto familiar'}
              />
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <button type="button" className={styles.btnCancel} onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className={styles.btnConfirm} disabled={!canSubmit || loading}>
              {loading ? 'Salvando...' : 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
