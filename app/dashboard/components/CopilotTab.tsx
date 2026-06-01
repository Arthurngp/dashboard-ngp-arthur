'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  sendCopilotMessage,
  getConversationByClient,
  listMessages,
  getProfile,
  listTimeline,
  listPendingPlans,
  decidePlan,
  applyMemoryPlan,
  resolveClienteId,
  updateProfile,
} from '@/lib/copilot/api'
import type {
  CopilotMessage,
  ClientMemoryProfile,
  ClientTimelineEvent,
  AgentPlan,
  PendingAsset,
} from '@/lib/copilot/types'
import { getPreferredModel } from '@/lib/copilot/models'
import styles from './CopilotTab.module.css'

type Section = 'chat' | 'memoria' | 'pendentes' | 'timeline'

interface CopilotTabProps {
  clientId: string | null
  clientName: string | null
}

// Threshold pra detectar paste-as-attachment (estilo Claude Desktop)
const PASTE_AS_ATTACHMENT_THRESHOLD = 2000

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function fmtBytesRough(chars: number): string {
  if (chars < 1000) return `${chars} chars`
  return `${(chars / 1000).toFixed(1)}k chars`
}

function genClientId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function CopilotTab({ clientId, clientName }: CopilotTabProps) {
  const [section, setSection] = useState<Section>('chat')
  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [profile, setProfile] = useState<ClientMemoryProfile | null>(null)
  const [timeline, setTimeline] = useState<ClientTimelineEvent[]>([])
  const [pendingPlans, setPendingPlans] = useState<AgentPlan[]>([])

  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [composer, setComposer] = useState('')
  const [pendingAsset, setPendingAsset] = useState<PendingAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  // O clientId vindo do dashboard é `usuarios.id`; precisamos do `clientes.id` real
  // pra todas as queries do Copilot. Resolvemos uma vez e cacheamos.
  const [resolvedClientId, setResolvedClientId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const pendingCount = pendingPlans.length

  const loadAll = useCallback(async (cid: string) => {
    setLoading(true)
    setError(null)
    try {
      const [conv, prof, tl, pp] = await Promise.all([
        getConversationByClient(cid),
        getProfile(cid),
        listTimeline(cid, 30),
        listPendingPlans(cid, 20),
      ])
      setProfile(prof)
      setTimeline(tl)
      setPendingPlans(pp)
      if (conv) {
        setConversationId(conv.id)
        const msgs = await listMessages(conv.id, 100)
        setMessages(msgs)
      } else {
        setConversationId(null)
        setMessages([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!clientId || clientId.trim() === '') {
      setMessages([]); setProfile(null); setTimeline([]); setPendingPlans([]); setConversationId(null); setResolvedClientId(null)
      if (clientId === '' || clientId === null) {
        setError('Cliente sem ID válido. Volte ao seletor de cliente e clique nele novamente.')
      }
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    resolveClienteId(clientId)
      .then((real) => {
        if (cancelled) return
        if (!real) {
          setError('Cliente não encontrado na base. Verifique cadastro em /admin/clientes.')
          setResolvedClientId(null)
          setLoading(false)
          return
        }
        setResolvedClientId(real)
        loadAll(real)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Falha ao resolver cliente')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [clientId, loadAll])

  useEffect(() => {
    if (section === 'chat' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, section])

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData('text')
    if (!pasted || pasted.length < PASTE_AS_ATTACHMENT_THRESHOLD) return
    e.preventDefault()
    const now = new Date()
    const label = `Texto colado · ${now.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    setPendingAsset({
      text: pasted,
      asset_type: 'transcript_reuniao',
      label,
    })
  }

  function changePendingAssetType(asset_type: PendingAsset['asset_type']) {
    setPendingAsset((prev) => prev ? { ...prev, asset_type } : prev)
  }

  function removePendingAsset() {
    setPendingAsset(null)
  }

  async function handleSend() {
    if (!resolvedClientId) return
    const text = composer.trim()
    if ((!text && !pendingAsset) || sending) return

    const clientGen = genClientId()
    const assetSnapshot = pendingAsset
    const optimisticUser: CopilotMessage = {
      id: `tmp-${clientGen}`,
      conversation_id: conversationId || '',
      client_id: resolvedClientId,
      role: 'user',
      kind: assetSnapshot ? 'text_file' : 'text',
      texto: text || (assetSnapshot ? `(anexou: ${assetSnapshot.label})` : ''),
      payload_json: assetSnapshot ? {
        asset_pending: true,
        label: assetSnapshot.label,
        chars: assetSnapshot.text.length,
        words: countWords(assetSnapshot.text),
        asset_type: assetSnapshot.asset_type,
      } : null,
      autor_usuario_id: null,
      autor_nome: 'Você',
      agent_model: null,
      agent_run_id: null,
      client_generated_id: clientGen,
      reply_to_message_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    }
    setMessages((prev) => [...prev, optimisticUser])
    setComposer('')
    setPendingAsset(null)
    setSending(true)
    setError(null)

    try {
      const res = await sendCopilotMessage({
        client_id: resolvedClientId,
        message: text,
        client_generated_id: clientGen,
        pending_asset: assetSnapshot || undefined,
        model: getPreferredModel(),
      })
      if (res.conversation_id) setConversationId(res.conversation_id)
      const msgs = await listMessages(res.conversation_id, 100)
      setMessages(msgs)
      const [pp, tl, prof] = await Promise.all([
        listPendingPlans(resolvedClientId, 20),
        listTimeline(resolvedClientId, 30),
        getProfile(resolvedClientId),
      ])
      setPendingPlans(pp)
      setTimeline(tl)
      setProfile(prof)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar')
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id))
      // Restaura o anexo no chip pra usuário não perder o conteúdo
      if (assetSnapshot) setPendingAsset(assetSnapshot)
    } finally {
      setSending(false)
    }
  }

  async function handleApprovePlan(plan: AgentPlan) {
    if (!resolvedClientId) return
    try {
      await applyMemoryPlan(plan.id)
      const [pp, prof, tl] = await Promise.all([
        listPendingPlans(resolvedClientId, 20),
        getProfile(resolvedClientId),
        listTimeline(resolvedClientId, 30),
      ])
      setPendingPlans(pp); setProfile(prof); setTimeline(tl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao aprovar')
    }
  }

  async function handleRejectPlan(plan: AgentPlan) {
    if (!resolvedClientId) return
    try {
      await decidePlan(plan.id, 'rejected', 'Rejeitado pelo usuário')
      const pp = await listPendingPlans(resolvedClientId, 20)
      setPendingPlans(pp)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao rejeitar')
    }
  }

  if (!clientId) {
    return (
      <div className={styles.empty}>
        <h3>Selecione um cliente para usar o NGP Copilot</h3>
        <p>O Copilot precisa de um cliente em foco para ler o contexto e conversar com você.</p>
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>NGP Copilot</div>
          <h2 className={styles.title}>{clientName || 'Cliente'}</h2>
        </div>
        <nav className={styles.sectionNav}>
          <button className={section === 'chat' ? styles.sectionBtnActive : styles.sectionBtn} onClick={() => setSection('chat')}>
            Conversa
          </button>
          <button className={section === 'memoria' ? styles.sectionBtnActive : styles.sectionBtn} onClick={() => setSection('memoria')}>
            Memória
          </button>
          <button className={section === 'pendentes' ? styles.sectionBtnActive : styles.sectionBtn} onClick={() => setSection('pendentes')}>
            Pendentes{pendingCount > 0 && <span className={styles.badge}>{pendingCount}</span>}
          </button>
          <button className={section === 'timeline' ? styles.sectionBtnActive : styles.sectionBtn} onClick={() => setSection('timeline')}>
            Timeline
          </button>
        </nav>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}

      {section === 'chat' && (
        <div className={styles.chatSection}>
          <div className={styles.messageList} ref={scrollRef}>
            {loading && <div className={styles.muted}>Carregando…</div>}
            {!loading && messages.length === 0 && (
              <div className={styles.muted}>Sem mensagens ainda. Mande a primeira pra começar.</div>
            )}
            {messages.map((m) => (
              <MessageRow key={m.id} msg={m} />
            ))}
          </div>
          <div className={styles.composer}>
            {pendingAsset && (
              <div className={styles.attachmentChip}>
                <div className={styles.attachmentIcon}>📎</div>
                <div className={styles.attachmentInfo}>
                  <div className={styles.attachmentLabel}>{pendingAsset.label}</div>
                  <div className={styles.attachmentMeta}>
                    {countWords(pendingAsset.text).toLocaleString('pt-BR')} palavras · {fmtBytesRough(pendingAsset.text.length)}
                  </div>
                </div>
                <select
                  className={styles.attachmentTypeSelect}
                  value={pendingAsset.asset_type || 'transcript_reuniao'}
                  onChange={(e) => changePendingAssetType(e.target.value as PendingAsset['asset_type'])}
                  disabled={sending}
                  title="Tipo do anexo"
                >
                  <option value="transcript_reuniao">Transcrição de reunião</option>
                  <option value="planejamento_html">Planejamento (HTML)</option>
                  <option value="planejamento_pdf">Planejamento (PDF)</option>
                  <option value="outro">Outro texto</option>
                </select>
                <button
                  className={styles.attachmentRemoveBtn}
                  onClick={removePendingAsset}
                  disabled={sending}
                  title="Remover anexo"
                  type="button"
                >×</button>
              </div>
            )}
            <textarea
              className={styles.textarea}
              placeholder={pendingAsset ? `Adicione um contexto opcional sobre o anexo…` : `Conversar com o Copilot sobre ${clientName}…`}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend() }
              }}
              rows={3}
              disabled={sending}
            />
            <button className={styles.sendBtn} onClick={handleSend} disabled={sending || (!composer.trim() && !pendingAsset)}>
              {sending ? 'Enviando…' : pendingAsset ? 'Enviar com anexo (Ctrl/⌘+Enter)' : 'Enviar (Ctrl/⌘+Enter)'}
            </button>
          </div>
        </div>
      )}

      {section === 'memoria' && (
        <MemoriaSection
          profile={profile}
          onFieldSaved={async (field, newValue) => {
            if (!resolvedClientId) return
            try {
              const updated = await updateProfile(
                resolvedClientId,
                { [field]: newValue } as Partial<ClientMemoryProfile>,
                { motivador: `Edição manual de ${field}` }
              )
              setProfile(updated)
              // Recarrega timeline pra pegar o evento 'manual_profile_edit' que o backend gera
              const tl = await listTimeline(resolvedClientId, 30)
              setTimeline(tl)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Falha ao salvar edição')
              throw e
            }
          }}
        />
      )}
      {section === 'pendentes' && (
        <PendentesSection plans={pendingPlans} onApprove={handleApprovePlan} onReject={handleRejectPlan} />
      )}
      {section === 'timeline' && <TimelineSection events={timeline} />}
    </div>
  )
}

function MessageRow({ msg }: { msg: CopilotMessage }) {
  const isUser = msg.role === 'user'
  const isAgent = msg.role === 'agent'
  const isSystem = msg.role === 'system'

  let rowClass = styles.msgRow
  if (isUser) rowClass += ' ' + styles.msgRowUser
  if (isAgent) rowClass += ' ' + styles.msgRowAgent
  if (isSystem) rowClass += ' ' + styles.msgRowSystem

  const kindLabel: Record<string, string> = {
    text: '',
    text_file: '',
    agent_analysis: '📊 Análise',
    agent_proposal: '💡 Proposta',
    agent_alert: '⚠️ Alerta',
    agent_checklist: '✅ Checklist',
    memory_update: '🧠 Memória atualizada',
  }

  // Mensagem com anexo (paste-as-attachment): renderiza chip no balão
  const hasAttachment = (msg.kind === 'text_file' || msg.kind === 'file') && msg.payload_json
  const attachment = hasAttachment ? (msg.payload_json as Record<string, unknown>) : null
  const attachmentLabel = attachment?.label as string | undefined
  const attachmentChars = attachment?.chars as number | undefined
  const attachmentWords = attachment?.words as number | undefined
  const attachmentType = attachment?.asset_type as string | undefined

  return (
    <div className={rowClass}>
      <div className={styles.msgBubble}>
        {msg.kind !== 'text' && msg.kind !== 'text_file' && (
          <div className={styles.msgKindTag}>{kindLabel[msg.kind] || msg.kind}</div>
        )}
        {hasAttachment && (
          <div className={styles.msgAttachment}>
            <span className={styles.msgAttachmentIcon}>📎</span>
            <div className={styles.msgAttachmentBody}>
              <div className={styles.msgAttachmentLabel}>{attachmentLabel || 'Anexo'}</div>
              <div className={styles.msgAttachmentMeta}>
                {attachmentType ? `${attachmentType} · ` : ''}
                {typeof attachmentWords === 'number'
                  ? `${attachmentWords.toLocaleString('pt-BR')} palavras`
                  : typeof attachmentChars === 'number'
                    ? `~${Math.round(attachmentChars / 5).toLocaleString('pt-BR')} palavras`
                    : ''}
                {typeof attachmentChars === 'number' ? ` · ${fmtBytesRough(attachmentChars)}` : ''}
              </div>
            </div>
          </div>
        )}
        {msg.texto && !(hasAttachment && msg.texto.startsWith('(anexou:')) && (
          <div className={styles.msgText}>{msg.texto}</div>
        )}
        <div className={styles.msgMeta}>
          {isUser ? (msg.autor_nome || 'Você') : isAgent ? 'NGP Copilot' : 'Sistema'} · {fmtDateTime(msg.created_at)}
        </div>
      </div>
    </div>
  )
}

type EditableField =
  | 'executive_summary' | 'service_scope' | 'business_context' | 'offer_context'
  | 'icp_context' | 'brand_positioning' | 'content_strategy' | 'creative_learnings'
  | 'wins' | 'losses' | 'competition_notes' | 'team_and_process'
  | 'key_metrics' | 'operational_rules' | 'risks'

function MemoriaSection({
  profile,
  onFieldSaved,
}: {
  profile: ClientMemoryProfile | null
  onFieldSaved: (field: EditableField, newValue: string | null) => void
}) {
  if (!profile) {
    return (
      <div className={styles.empty}>
        <h3>Perfil ainda vazio</h3>
        <p>Converse com o Copilot ou rode uma compactação semanal pra começar a popular a memória deste cliente.</p>
        <p style={{ marginTop: 8, fontSize: 12 }}>Você também pode clicar em qualquer card vazio abaixo e digitar manualmente.</p>
        <div className={styles.memoriaGrid} style={{ marginTop: 20 }}>
          <MemoriaCard label="Resumo executivo" field="executive_summary" value={null} onSave={onFieldSaved} />
          <MemoriaCard label="Contexto do negócio" field="business_context" value={null} onSave={onFieldSaved} />
          <MemoriaCard label="ICP / Público" field="icp_context" value={null} onSave={onFieldSaved} />
          <MemoriaCard label="Regras operacionais" field="operational_rules" value={null} onSave={onFieldSaved} />
        </div>
      </div>
    )
  }
  return (
    <div className={styles.memoriaGrid}>
      <MemoriaCard label="Resumo executivo" field="executive_summary" value={profile.executive_summary} onSave={onFieldSaved} />
      <MemoriaCard label="Escopo do serviço" field="service_scope" value={profile.service_scope} onSave={onFieldSaved} />
      <MemoriaCard label="Contexto do negócio" field="business_context" value={profile.business_context} onSave={onFieldSaved} />
      <MemoriaCard label="Oferta atual" field="offer_context" value={profile.offer_context} onSave={onFieldSaved} />
      <MemoriaCard label="ICP / Público" field="icp_context" value={profile.icp_context} onSave={onFieldSaved} />
      <MemoriaCard label="Posicionamento de marca" field="brand_positioning" value={profile.brand_positioning} onSave={onFieldSaved} />
      <MemoriaCard label="Estratégia de conteúdo" field="content_strategy" value={profile.content_strategy} onSave={onFieldSaved} />
      <MemoriaCard label="Aprendizados de criativo" field="creative_learnings" value={profile.creative_learnings} onSave={onFieldSaved} />
      <MemoriaCard label="✅ Wins (o que funcionou)" field="wins" value={profile.wins} onSave={onFieldSaved} />
      <MemoriaCard label="❌ Losses (o que não funcionou)" field="losses" value={profile.losses} onSave={onFieldSaved} />
      <MemoriaCard label="Concorrência" field="competition_notes" value={profile.competition_notes} onSave={onFieldSaved} />
      <MemoriaCard label="Time e processo" field="team_and_process" value={profile.team_and_process} onSave={onFieldSaved} />
      <MemoriaCard label="Métricas-chave" field="key_metrics" value={profile.key_metrics} onSave={onFieldSaved} />
      <MemoriaCard label="Regras operacionais" field="operational_rules" value={profile.operational_rules} onSave={onFieldSaved} />
      <MemoriaCard label="Riscos / atenções" field="risks" value={profile.risks} onSave={onFieldSaved} />
      {profile.channel_notes && Object.keys(profile.channel_notes).length > 0 && (
        <div className={styles.memoriaCard}>
          <div className={styles.memoriaCardLabel}>Notas por canal</div>
          <div className={styles.memoriaCardValue}>
            {Object.entries(profile.channel_notes)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n') || <span className={styles.muted}>—</span>}
          </div>
        </div>
      )}
      {profile.last_compacted_at && (
        <div className={styles.memoriaFooter}>
          Última compactação: {fmtDateTime(profile.last_compacted_at)}
          {profile.last_compacted_by ? ` por ${profile.last_compacted_by}` : ''}
        </div>
      )}
    </div>
  )
}

function MemoriaCard({
  label,
  field,
  value,
  onSave,
}: {
  label: string
  field: EditableField
  value: string | null
  onSave: (field: EditableField, newValue: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const [motivador, setMotivador] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length)
    }
  }, [editing])

  function startEdit() {
    setDraft(value || '')
    setMotivador('')
    setErr(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setErr(null)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setErr(null)
    try {
      const trimmed = draft.trim()
      const finalValue = trimmed.length === 0 ? null : trimmed
      // onSave faz update no banco + atualiza estado local
      await Promise.resolve(onSave(field, finalValue))
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className={`${styles.memoriaCard} ${styles.memoriaCardEditing}`}>
        <div className={styles.memoriaCardLabel}>{label}</div>
        <textarea
          ref={textareaRef}
          className={styles.memoriaCardTextarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(4, Math.min(12, draft.split('\n').length + 1))}
          placeholder="Digite o conteúdo deste campo. Vazio = limpa o campo."
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() }
          }}
        />
        <input
          type="text"
          className={styles.memoriaCardMotivador}
          placeholder="Motivo da edição (opcional)"
          value={motivador}
          onChange={(e) => setMotivador(e.target.value)}
          disabled={saving}
        />
        {err && <div className={styles.memoriaCardErr}>{err}</div>}
        <div className={styles.memoriaCardActions}>
          <button className={styles.memoriaBtnCancel} onClick={cancel} disabled={saving}>Cancelar</button>
          <button className={styles.memoriaBtnSave} onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar (Ctrl/⌘+Enter)'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`${styles.memoriaCard} ${styles.memoriaCardEditable}`}
      onClick={startEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit() } }}
      title="Clique para editar"
    >
      <div className={styles.memoriaCardLabel}>
        {label}
        <span className={styles.memoriaCardEditHint}>editar ✎</span>
      </div>
      <div className={styles.memoriaCardValue}>{value || <span className={styles.muted}>— (clique para preencher)</span>}</div>
    </div>
  )
}

function PendentesSection({
  plans,
  onApprove,
  onReject,
}: {
  plans: AgentPlan[]
  onApprove: (p: AgentPlan) => void
  onReject: (p: AgentPlan) => void
}) {
  if (plans.length === 0) {
    return <div className={styles.empty}><h3>Nenhuma proposta pendente</h3><p>A IA vai propor atualizações de memória aqui quando aprender algo novo.</p></div>
  }
  return (
    <div className={styles.pendentesList}>
      {plans.map((p) => <PlanCard key={p.id} plan={p} onApprove={() => onApprove(p)} onReject={() => onReject(p)} />)}
    </div>
  )
}

function PlanCard({
  plan,
  onApprove,
  onReject,
}: {
  plan: AgentPlan
  onApprove: () => void
  onReject: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const after = plan.proposal_json?.after || {}
  const fields = Object.entries(after).filter(([, v]) => v !== null && v !== '' && v !== undefined)
  const confidencePct = Math.round((plan.confidence || 0) * 100)

  return (
    <div className={styles.planCard}>
      <div className={styles.planHeader}>
        <div>
          <div className={styles.planTitle}>{plan.title}</div>
          <div className={styles.planMeta}>
            <span className={plan.impact_scope === 'hard' ? styles.tagHard : styles.tagSoft}>
              {plan.impact_scope === 'hard' ? 'Impacto alto' : 'Soft'}
            </span>
            <span className={styles.tagConfidence}>Confiança {confidencePct}%</span>
            {plan.needs_escalation && <span className={styles.tagEscalation}>Escalada</span>}
            <span className={styles.muted}>· {fmtDate(plan.created_at)}</span>
          </div>
        </div>
      </div>
      <div className={styles.planReasoning}>{plan.reasoning_summary}</div>

      {expanded && (
        <div className={styles.planDiff}>
          {fields.map(([k, v]) => (
            <div key={k} className={styles.diffRow}>
              <div className={styles.diffField}>{k}</div>
              <div className={styles.diffAfter}>{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.planActions}>
        <button className={styles.btnSecondary} onClick={() => setExpanded((x) => !x)}>
          {expanded ? 'Recolher' : 'Ver mudanças'}
        </button>
        <button className={styles.btnReject} onClick={onReject}>Rejeitar</button>
        <button className={styles.btnApprove} onClick={onApprove}>Aprovar e aplicar</button>
      </div>
    </div>
  )
}

function TimelineSection({ events }: { events: ClientTimelineEvent[] }) {
  if (events.length === 0) {
    return <div className={styles.empty}><h3>Sem eventos ainda</h3></div>
  }
  return (
    <div className={styles.timelineList}>
      {events.map((e) => (
        <div key={e.id} className={styles.timelineItem}>
          <div className={styles.timelineDate}>{fmtDate(e.event_at)}</div>
          <div className={styles.timelineBody}>
            <div className={styles.timelineHeaderRow}>
              <span className={styles.timelineType}>{e.event_type}</span>
              {e.hypothesis_status !== 'na' && (
                <span className={`${styles.hypTag} ${styles[`hyp_${e.hypothesis_status}`]}`}>
                  {e.hypothesis_status}
                </span>
              )}
              {e.created_by_agent && <span className={styles.timelineAgent}>IA</span>}
            </div>
            <div className={styles.timelineTitle}>{e.title}</div>
            {e.description && <div className={styles.timelineDesc}>{e.description}</div>}
            {(e.motivador || e.resultado_esperado || e.resultado_observado) && (
              <div className={styles.timelineDetails}>
                {e.motivador && <div><strong>Motivador:</strong> {e.motivador}</div>}
                {e.resultado_esperado && <div><strong>Esperado:</strong> {e.resultado_esperado}</div>}
                {e.resultado_observado && <div><strong>Observado:</strong> {e.resultado_observado}</div>}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
