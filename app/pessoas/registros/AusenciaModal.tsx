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

interface ManageRecord {
  id: string
  observacao?: string | null
  anexo_path?: string | null
  anexo_mime?: string | null
  anexo_size?: number | null
}

interface Props {
  usuarios: UsuarioOption[]
  defaultUsuarioId?: string
  defaultData?: string         // YYYY-MM-DD
  // Quando presente, abre em modo "gerenciar anexo de ausência existente"
  manageRecord?: ManageRecord
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

const ANEXO_MAX_BYTES = 5 * 1024 * 1024
const ANEXO_MIME_OK = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
])

function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })
}

export default function AusenciaModal({ usuarios, defaultUsuarioId, defaultData, manageRecord, onClose, onSaved }: Props) {
  const [usuarioId, setUsuarioId] = useState(defaultUsuarioId || (usuarios[0]?.id ?? ''))
  const [data, setData]           = useState(defaultData || new Date().toISOString().split('T')[0])
  const [tipo, setTipo]           = useState('atestado')
  const [escopo, setEscopo]       = useState<'dia' | 'faixa'>('dia')
  const [horaInicio, setHoraInicio] = useState('13:00')
  const [horaFim, setHoraFim]       = useState('17:00')
  const [observacao, setObservacao] = useState('')

  const [anexoFile, setAnexoFile] = useState<File | null>(null)
  const [anexoErr, setAnexoErr]   = useState<string | null>(null)

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

      // Se anexou um arquivo e a ausência foi criada com sucesso, faz upload.
      if (anexoFile && out?.record?.id) {
        try {
          const b64 = await fileToBase64(anexoFile)
          const upRes = await fetch(`${SURL}/functions/v1/admin-ponto-anexo`, {
            method: 'POST',
            headers: efHeaders(),
            body: JSON.stringify({
              session_token: s.session,
              action: 'upload',
              record_id: out.record.id,
              filename: anexoFile.name,
              mime_type: anexoFile.type,
              content_base64: b64,
            }),
          })
          const upOut = await upRes.json()
          if (upOut?.error) {
            // Ausência foi criada mas anexo falhou — avisa, mas considera salvo.
            setError(`Ausência salva, mas o anexo falhou: ${upOut.error}`)
            onSaved()
            return
          }
        } catch {
          setError('Ausência salva, mas o anexo falhou no upload.')
          onSaved()
          return
        }
      }

      onSaved()
      onClose()
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  function handleAnexoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setAnexoErr(null)
    const f = e.target.files?.[0] || null
    if (!f) { setAnexoFile(null); return }
    if (!ANEXO_MIME_OK.has(f.type)) {
      setAnexoErr('Formato não aceito. Use PDF, PNG, JPG ou WebP.')
      setAnexoFile(null)
      return
    }
    if (f.size > ANEXO_MAX_BYTES) {
      setAnexoErr(`Arquivo maior que 5 MB (${(f.size / 1024 / 1024).toFixed(1)} MB).`)
      setAnexoFile(null)
      return
    }
    setAnexoFile(f)
  }

  // ─── Modo "gerenciar anexo de ausência existente" ────────────────────────
  if (manageRecord) {
    return (
      <ManageAnexoPanel
        record={manageRecord}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
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

          <div className={styles.field}>
            <label className={styles.label}>Anexo (atestado, etc — opcional)</label>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
              onChange={handleAnexoChange}
              className={styles.fileInput}
            />
            {anexoFile && (
              <div className={styles.fileHint}>
                {anexoFile.name} · {(anexoFile.size / 1024).toFixed(0)} KB
              </div>
            )}
            {anexoErr && <div className={styles.error}>{anexoErr}</div>}
          </div>

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

// ──────────────────────────────────────────────────────────────────────────
// Painel de gerenciamento de anexo (subir / baixar / substituir / remover)
// ──────────────────────────────────────────────────────────────────────────

interface ManagePanelProps {
  record: ManageRecord
  onClose: () => void
  onSaved: () => void
}

function ManageAnexoPanel({ record, onClose, onSaved }: ManagePanelProps) {
  const [hasAnexo, setHasAnexo] = useState(!!record.anexo_path)
  const [anexoMime, setAnexoMime] = useState(record.anexo_mime || '')
  const [anexoSize, setAnexoSize] = useState(record.anexo_size || 0)
  const [file, setFile] = useState<File | null>(null)
  const [fileErr, setFileErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileErr(null)
    const f = e.target.files?.[0] || null
    if (!f) { setFile(null); return }
    if (!ANEXO_MIME_OK.has(f.type)) {
      setFileErr('Formato não aceito. Use PDF, PNG, JPG ou WebP.')
      setFile(null); return
    }
    if (f.size > ANEXO_MAX_BYTES) {
      setFileErr(`Arquivo maior que 5 MB (${(f.size / 1024 / 1024).toFixed(1)} MB).`)
      setFile(null); return
    }
    setFile(f)
  }

  async function handleDownload() {
    const s = getSession()
    if (!s) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${SURL}/functions/v1/admin-ponto-anexo`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({
          session_token: s.session,
          action: 'get_url',
          record_id: record.id,
        }),
      })
      const out = await res.json()
      if (out?.error) { setError(out.error); return }
      window.open(out.signed_url, '_blank', 'noopener')
    } catch {
      setError('Erro de conexão.')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload() {
    if (!file) return
    const s = getSession()
    if (!s) return
    setLoading(true); setError(null)
    try {
      const b64 = await fileToBase64(file)
      const res = await fetch(`${SURL}/functions/v1/admin-ponto-anexo`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({
          session_token: s.session,
          action: 'upload',
          record_id: record.id,
          filename: file.name,
          mime_type: file.type,
          content_base64: b64,
        }),
      })
      const out = await res.json()
      if (out?.error) { setError(out.error); return }
      setHasAnexo(true)
      setAnexoMime(file.type)
      setAnexoSize(file.size)
      setFile(null)
      onSaved()
    } catch {
      setError('Erro de conexão.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Remover o anexo desta ausência?')) return
    const s = getSession()
    if (!s) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${SURL}/functions/v1/admin-ponto-anexo`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({
          session_token: s.session,
          action: 'delete',
          record_id: record.id,
        }),
      })
      const out = await res.json()
      if (out?.error) { setError(out.error); return }
      setHasAnexo(false)
      setAnexoMime('')
      setAnexoSize(0)
      onSaved()
    } catch {
      setError('Erro de conexão.')
    } finally {
      setLoading(false)
    }
  }

  function mimeLabel(m: string) {
    if (m === 'application/pdf') return 'PDF'
    if (m.startsWith('image/')) return 'Imagem (' + m.split('/')[1].toUpperCase() + ')'
    return m
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.iconWrap}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={26} height={26}>
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
          </svg>
        </div>
        <h2 className={styles.title}>Anexo da ausência</h2>
        {record.observacao && (
          <p className={styles.desc}>{record.observacao}</p>
        )}

        {hasAnexo ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className={styles.fileHint}>
              {mimeLabel(anexoMime)} · {(anexoSize / 1024).toFixed(0)} KB
            </div>
            <button
              type="button"
              className={styles.btnConfirm}
              onClick={handleDownload}
              disabled={loading}
            >
              {loading ? 'Abrindo...' : 'Baixar / visualizar'}
            </button>

            <div className={styles.field}>
              <label className={styles.label}>Substituir arquivo</label>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
                onChange={onFileChange}
                className={styles.fileInput}
              />
              {file && (
                <div className={styles.fileHint}>
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </div>
              )}
              {fileErr && <div className={styles.error}>{fileErr}</div>}
            </div>

            {file && (
              <button
                type="button"
                className={styles.btnConfirm}
                onClick={handleUpload}
                disabled={loading}
              >
                {loading ? 'Enviando...' : 'Substituir'}
              </button>
            )}

            <button
              type="button"
              className={styles.btnDanger}
              onClick={handleDelete}
              disabled={loading}
            >
              Remover anexo
            </button>
          </div>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className={styles.field}>
              <label className={styles.label}>Selecionar arquivo (PDF, PNG, JPG, WebP — até 5 MB)</label>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
                onChange={onFileChange}
                className={styles.fileInput}
              />
              {file && (
                <div className={styles.fileHint}>
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </div>
              )}
              {fileErr && <div className={styles.error}>{fileErr}</div>}
            </div>
            <button
              type="button"
              className={styles.btnConfirm}
              onClick={handleUpload}
              disabled={!file || loading}
            >
              {loading ? 'Enviando...' : 'Enviar anexo'}
            </button>
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <button type="button" className={styles.btnCancel} onClick={onClose} disabled={loading}>
          Fechar
        </button>
      </div>
    </div>
  )
}
