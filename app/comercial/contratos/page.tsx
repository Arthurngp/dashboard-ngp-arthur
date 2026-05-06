'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import { getSession } from '@/lib/auth'
import { comercialNav } from '../comercial-nav'
import {
  EMPTY_CONTRACT_DRAFT,
  CONTRACT_DEFAULT_TEMPLATE,
  CONTRACT_FIELD_GROUPS,
  CONTRACT_FIELD_LABELS,
  CONTRACT_FIXED_RULES,
  ContractDraft,
  ContractFieldKey,
  applyContractTemplate,
  buildContractChangeConfirmation,
  buildContractConfirmationSummary,
  buildContractFileName,
  buildContractMissingPrompt,
  getChangedContractFields,
  getContractCompletion,
  getMissingContractFields,
  getMissingGroups,
  getRemainingPlaceholders,
  hydrateContractDraft,
  isPositiveConfirmation,
  mergeContractDraft,
} from '@/lib/contracts'
import styles from './contratos.module.css'

type MessageRole = 'assistant' | 'user'
type MessageVariant = 'default' | 'summary' | 'success' | 'error'
type ContractStage = 'collecting' | 'awaiting_confirmation' | 'generated'

interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  variant: MessageVariant
}

const TEMPLATE_STORAGE_KEY = 'ngp_contract_template_v1'

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return window.btoa(binary)
}

function initialAssistantMessage(): ChatMessage {
  return {
    id: createId('assistant'),
    role: 'assistant',
    variant: 'default',
    content: 'Ola! Vou te ajudar a gerar o contrato de Gestao de Trafego e Performance da NGP. Pode me passar os dados do novo cliente? Pode ser por texto, em blocos, como preferir.',
  }
}

function contractTranscript(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

function formatMessage(text: string) {
  return text.split('\n').map((line, index) => (
    <React.Fragment key={`${line}-${index}`}>
      {line}
      {index < text.split('\n').length - 1 ? <br /> : null}
    </React.Fragment>
  ))
}

function PreviewDocument({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean)

  return (
    <div className={styles.previewPaper}>
      {blocks.map((block, index) => {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
        const firstLine = lines[0] || ''
        const isHeading = lines.length === 1 && firstLine === firstLine.toUpperCase() && firstLine.length <= 90

        if (isHeading) {
          return <h3 key={`${block}-${index}`} className={styles.previewHeading}>{firstLine}</h3>
        }

        return (
          <div key={`${block}-${index}`} className={styles.previewBlock}>
            {lines.map((line, lineIndex) => (
              <p key={`${line}-${lineIndex}`} className={styles.previewParagraph}>{line}</p>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export default function ContratosPage() {
  const router = useRouter()
  const previewRef = useRef<HTMLDivElement>(null)
  const messageFeedRef = useRef<HTMLDivElement>(null)
  const templateFileRef = useRef<HTMLInputElement>(null)
  const templateSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([initialAssistantMessage()])
  const [draft, setDraft] = useState<ContractDraft>(EMPTY_CONTRACT_DRAFT)
  const [templateText, setTemplateText] = useState(CONTRACT_DEFAULT_TEMPLATE)
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
  const [stage, setStage] = useState<ContractStage>('collecting')
  const [generatedText, setGeneratedText] = useState('')
  const [remainingPlaceholders, setRemainingPlaceholders] = useState<string[]>([])
  const [generatedAt, setGeneratedAt] = useState('')
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingDocx, setExportingDocx] = useState(false)
  const [importingTemplate, setImportingTemplate] = useState(false)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/cliente'); return }
    setSess(s)
    loadTemplateFromDb(s.session)
  }, [router])

  async function loadTemplateFromDb(sessionToken: string) {
    try {
      const { efCall } = await import('@/lib/api')
      const res = await efCall('contract-template-load', { session_token: sessionToken }, { skipSession: true })
      if (res.template && typeof (res.template as Record<string, unknown>).conteudo === 'string') {
        const conteudo = ((res.template as Record<string, unknown>).conteudo as string).trim()
        if (conteudo) setTemplateText(conteudo)
      }
    } catch {
      // fallback silencioso — usa o default
    }
  }

  async function saveTemplateToDb(conteudo: string) {
    const s = getSession()
    if (!s) return
    try {
      const { efCall } = await import('@/lib/api')
      await efCall('contract-template-save', { conteudo })
    } catch {
      // salvar silencioso — não bloqueia o usuário
    }
  }

  useEffect(() => {
    if (!messageFeedRef.current) return
    messageFeedRef.current.scrollTop = messageFeedRef.current.scrollHeight
  }, [messages, sending])

  const hydratedDraft = hydrateContractDraft(draft)
  const completion = getContractCompletion(hydratedDraft)
  const missingFields = getMissingContractFields(hydratedDraft)
  const missingGroups = getMissingGroups(hydratedDraft)
  const fileBaseName = buildContractFileName(hydratedDraft)

  function pushMessage(message: ChatMessage) {
    setMessages((current) => [...current, message])
  }

  function pushAssistant(content: string, variant: MessageVariant = 'default') {
    pushMessage({ id: createId('assistant'), role: 'assistant', content, variant })
  }

  function pushUser(content: string) {
    pushMessage({ id: createId('user'), role: 'user', content, variant: 'default' })
  }

  function resetWorkspace() {
    setMessages([initialAssistantMessage()])
    setDraft(EMPTY_CONTRACT_DRAFT)
    setInputValue('')
    setStage('collecting')
    setGeneratedText('')
    setRemainingPlaceholders([])
    setGeneratedAt('')
  }

  function resetTemplate() {
    setTemplateText(CONTRACT_DEFAULT_TEMPLATE)
    void saveTemplateToDb(CONTRACT_DEFAULT_TEMPLATE)
  }

  async function importTemplateFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const nameLower = file.name.toLowerCase()
    const isPdf  = file.type === 'application/pdf' || nameLower.endsWith('.pdf')
    const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || nameLower.endsWith('.docx')

    if (!isPdf && !isDocx) {
      pushAssistant('O template aceita importacao em PDF ou DOCX.', 'error')
      return
    }

    setImportingTemplate(true)

    try {
      const base64 = arrayBufferToBase64(await file.arrayBuffer())

      const response = await fetch('/api/crm-contract-template-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, base64 }),
      })

      const data = await response.json().catch(() => ({ error: 'Nao consegui ler o arquivo enviado.' }))
      if (!response.ok || data.error || !data.text) {
        pushAssistant(String(data.error || 'Nao consegui importar esse arquivo como template.'), 'error')
        return
      }

      const novoTemplate = String(data.text)
      setTemplateText(novoTemplate)
      void saveTemplateToDb(novoTemplate)
      pushAssistant(
        `Template importado do ${isPdf ? 'PDF' : 'DOCX'} e salvo. Revisa o texto e ajusta os placeholders se precisar.`,
        'success'
      )
    } catch (error) {
      console.error(error)
      pushAssistant('Nao consegui importar o arquivo agora. Tenta novamente em alguns segundos.', 'error')
    } finally {
      setImportingTemplate(false)
    }
  }

  function buildFallbackPrompt(nextDraft: ContractDraft) {
    return buildContractMissingPrompt(nextDraft)
  }

  function generateContractPreview() {
    const output = applyContractTemplate(templateText, hydratedDraft)
    const unresolved = getRemainingPlaceholders(output)
    setGeneratedText(output)
    setRemainingPlaceholders(unresolved)
    setGeneratedAt(new Date().toISOString())
    setStage('generated')

    if (unresolved.length > 0) {
      pushAssistant(
        `Contrato montado para auditoria, mas ainda sobraram placeholders no modelo: ${unresolved.join(', ')}. Se eles forem validos, ajusta o template e gero de novo.`,
        'error'
      )
      return
    }

    pushAssistant('Contrato gerado para auditoria. Ja deixei o preview pronto e os downloads de DOCX e PDF habilitados.', 'success')
  }

  async function exportPdf() {
    if (!previewRef.current || !generatedText) return
    setExportingPdf(true)

    try {
      const html2pdf = (await import('html2pdf.js')).default
      await document.fonts?.ready

      await html2pdf()
        .from(previewRef.current)
        .set({
          margin: [10, 8, 10, 8],
          filename: `${fileBaseName}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: Math.min(2, window.devicePixelRatio || 1.5),
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
        })
        .save()
    } catch (error) {
      console.error(error)
      pushAssistant('Nao consegui exportar o PDF agora. Tenta novamente em alguns segundos.', 'error')
    } finally {
      setExportingPdf(false)
    }
  }

  async function exportDocx() {
    if (!generatedText) return
    setExportingDocx(true)

    try {
      const { AlignmentType, Document, Packer, Paragraph, TextRun } = await import('docx')
      const children = generatedText.split('\n').map((line, index) => {
        const trimmed = line.trim()
        const isHeading = trimmed && trimmed === trimmed.toUpperCase() && trimmed.length <= 90

        return new Paragraph({
          alignment: isHeading ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
          spacing: {
            after: trimmed ? (isHeading ? 220 : 140) : 90,
          },
          children: [
            new TextRun({
              text: line || ' ',
              bold: Boolean(isHeading),
              size: isHeading ? 28 : 23,
            }),
          ],
        })
      })

      const doc = new Document({
        sections: [
          {
            properties: {},
            children,
          },
        ],
      })

      const blob = await Packer.toBlob(doc)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${fileBaseName}.docx`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error(error)
      pushAssistant('Nao consegui gerar o DOCX agora. Tenta novamente em alguns segundos.', 'error')
    } finally {
      setExportingDocx(false)
    }
  }

  async function handleSend() {
    const text = inputValue.trim()
    if (!text || sending) return

    const sessionToken = sess?.session || getSession()?.session
    if (!sessionToken) {
      pushAssistant('Sessao expirada. Faz login novamente para continuar a conversa.', 'error')
      return
    }

    const transcript = contractTranscript(messages)
    pushUser(text)
    setInputValue('')

    if (stage === 'awaiting_confirmation' && isPositiveConfirmation(text)) {
      generateContractPreview()
      return
    }

    setSending(true)

    try {
      const response = await fetch('/api/crm-contract-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_token: sessionToken,
          message: text,
          draft: hydratedDraft,
          transcript: [...transcript, { role: 'user', content: text }],
        }),
      })

      const data = await response.json().catch(() => ({ error: 'Erro de conexao ao acionar o agente.' }))

      if (!response.ok || data.error) {
        pushAssistant(String(data.error || 'Erro ao acionar o agente de contratos.'), 'error')
        return
      }

      const nextDraft = mergeContractDraft(hydratedDraft, (data.extracted_fields || {}) as Partial<Record<ContractFieldKey, string | null>>)
      const changedFields = getChangedContractFields(hydratedDraft, nextDraft)
      const nextMissing = getMissingContractFields(nextDraft)
      setDraft(nextDraft)
      setGeneratedText('')
      setRemainingPlaceholders([])
      setGeneratedAt('')

      if (nextMissing.length === 0) {
        setStage('awaiting_confirmation')
        pushAssistant(
          stage === 'awaiting_confirmation' && changedFields.length > 0
            ? buildContractChangeConfirmation(nextDraft, changedFields)
            : buildContractConfirmationSummary(nextDraft),
          'summary'
        )
        return
      }

      setStage('collecting')
      pushAssistant(
        String(data.assistant_reply || buildFallbackPrompt(nextDraft)),
        'default'
      )
    } finally {
      setSending(false)
    }
  }

  if (!sess) return <NGPLoading loading loadingText="Carregando contratos..." />

  return (
    <div className={styles.layout}>
      <Sidebar
        minimal={true}
        sectorNavTitle="COMERCIAL"
        sectorNav={comercialNav}
        onTabChange={(tab) => {
          if (tab === 'fields') router.push('/comercial/pipeline?tab=fields')
          else if (tab === 'kanban') router.push('/comercial/pipeline?tab=kanban')
          else if (tab === 'new_pipeline') router.push('/comercial/pipeline?action=new_pipeline')
        }}
      />

      <main className={`${styles.main} ${!generatedText ? styles.mainLocked : ''}`}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Setor Comercial</div>
            <h1 className={styles.title}>Contratos com IA</h1>
            <p className={styles.subtitle}>
              Coleta guiada em conversa, confirmacao automatica e geracao auditavel do contrato.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondaryBtn} onClick={resetWorkspace}>
              Nova conversa
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={false}
              onClick={generateContractPreview}
            >
              Gerar preview
            </button>
          </div>
        </div>

        <div className={styles.workspace}>
          <section className={styles.chatCard}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Conversa</h2>
                <p className={styles.cardHint}>Use texto livre. O agente extrai os campos automaticamente.</p>
              </div>
              <span className={styles.statusPill}>{sending ? 'Processando...' : 'Pronto'}</span>
            </div>

            <div className={styles.messageFeed} ref={messageFeedRef}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`${styles.messageRow} ${message.role === 'user' ? styles.messageRowUser : styles.messageRowAssistant}`}
                >
                  <div
                    className={`${styles.messageBubble} ${
                      message.role === 'user'
                        ? styles.messageBubbleUser
                        : message.variant === 'summary'
                          ? styles.messageBubbleSummary
                          : message.variant === 'success'
                            ? styles.messageBubbleSuccess
                            : message.variant === 'error'
                              ? styles.messageBubbleError
                              : styles.messageBubbleAssistant
                    }`}
                  >
                    {formatMessage(message.content)}
                  </div>
                </div>
              ))}
              {sending && (
                <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
                  <div className={`${styles.messageBubble} ${styles.messageBubbleAssistant}`}>
                    Analisando os dados e atualizando o contrato...
                  </div>
                </div>
              )}
            </div>

            <div className={styles.inputWrap}>
              <textarea
                className={styles.chatInput}
                placeholder="Ex: A empresa e X, CNPJ Y, o responsavel sera..."
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleSend()
                  }
                }}
              />
              <div className={styles.inputFooter}>
                <span className={styles.inputHint}>
                  {stage === 'awaiting_confirmation'
                    ? 'Se estiver tudo certo, responda "sim" para gerar.'
                    : missingGroups.length > 0
                      ? `Foco atual: ${missingGroups[0].title}.`
                      : 'Tudo preenchido. Ja da para gerar.'}
                </span>
                <button type="button" className={styles.primaryBtn} onClick={() => void handleSend()} disabled={!inputValue.trim() || sending}>
                  Enviar
                </button>
              </div>
            </div>
          </section>

          <aside className={styles.sideColumn}>
            <section className={`${styles.sideCard} ${styles.fieldsCard}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h2 className={styles.cardTitle}>Campos coletados</h2>
                  <p className={styles.cardHint}>O painel mostra em tempo real o que ja entrou no contrato.</p>
                </div>
                <span className={styles.progressBadge}>{completion.percent}%</span>
              </div>

              <div className={styles.fieldGroups}>
                {CONTRACT_FIELD_GROUPS.map((group) => (
                  <div key={group.id} className={styles.fieldGroup}>
                    <div className={styles.fieldGroupTitle}>{group.title}</div>
                    <div className={styles.fieldList}>
                      {group.fields.map((field) => {
                        const hasValue = Boolean(hydratedDraft[field].trim())
                        return (
                          <div key={field} className={styles.fieldItem}>
                            <span className={`${styles.fieldDot} ${hasValue ? styles.fieldDotDone : styles.fieldDotPending}`} />
                            <div className={styles.fieldText}>
                              <strong>{CONTRACT_FIELD_LABELS[field]}</strong>
                              <span>{hasValue ? hydratedDraft[field] : 'Aguardando'}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={`${styles.sideCard} ${styles.templateCard}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h2 className={styles.cardTitle}>Template oficial</h2>
                  <p className={styles.cardHint}>Cole o contrato modelo da NGP com placeholders como <code>{'{NOME_CLIENTE}'}</code>, ou importe um PDF.</p>
                </div>
                <div className={styles.templateActions}>
                  <button type="button" className={styles.linkBtn} onClick={resetTemplate}>
                    Restaurar
                  </button>
                </div>
              </div>

              <input
                ref={templateFileRef}
                type="file"
                accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                className={styles.hiddenInput}
                onChange={importTemplateFile}
              />

              <button
                type="button"
                className={styles.templateUpload}
                onClick={() => templateFileRef.current?.click()}
                disabled={importingTemplate}
              >
                <strong>{importingTemplate ? 'Importando arquivo...' : 'Subir PDF ou DOCX do modelo'}</strong>
                <span>O sistema extrai o texto e salva como template oficial para toda a equipe.</span>
              </button>

              <textarea
                className={styles.templateInput}
                value={templateText}
                onChange={(event) => {
                  const val = event.target.value
                  setTemplateText(val)
                  if (templateSaveTimer.current) clearTimeout(templateSaveTimer.current)
                  templateSaveTimer.current = setTimeout(() => void saveTemplateToDb(val), 2000)
                }}
                placeholder="Cole aqui o contrato modelo oficial com placeholders."
              />
            </section>

            <section className={`${styles.sideCard} ${styles.rulesCard}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h2 className={styles.cardTitle}>Regras fixas NGP</h2>
                  <p className={styles.cardHint}>Esses itens ficam fora da coleta e devem permanecer padrao.</p>
                </div>
              </div>

              <div className={styles.ruleList}>
                {CONTRACT_FIXED_RULES.map((rule) => (
                  <div key={rule} className={styles.ruleItem}>{rule}</div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        {generatedText && (
          <section className={styles.previewSection}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Preview auditavel</h2>
                <p className={styles.cardHint}>
                  {generatedAt
                    ? `Ultima geracao: ${new Date(generatedAt).toLocaleString('pt-BR')}.`
                    : 'Gere o contrato para revisar o texto final antes de exportar.'}
                </p>
              </div>
              <div className={styles.previewActions}>
                <button type="button" className={styles.secondaryBtn} onClick={exportDocx} disabled={!generatedText || exportingDocx}>
                  {exportingDocx ? 'Gerando DOCX...' : 'Baixar DOCX'}
                </button>
                <button type="button" className={styles.primaryBtn} onClick={exportPdf} disabled={!generatedText || exportingPdf}>
                  {exportingPdf ? 'Gerando PDF...' : 'Baixar PDF'}
                </button>
              </div>
            </div>

            {remainingPlaceholders.length > 0 && (
              <div className={styles.previewWarning}>
                Ainda existem placeholders sem substituir: {remainingPlaceholders.join(', ')}.
              </div>
            )}
            <div className={styles.previewShell} ref={previewRef}>
              <PreviewDocument text={generatedText} />
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
