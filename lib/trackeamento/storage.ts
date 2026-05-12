import type { NGPForm, FormField, FormSession, FormStep, FieldType, SubField } from '@/types/trackeamento'

// ── Pure helpers (no persistence) ────────────────────────────────────────

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export function createBlankForm(): NGPForm {
  return {
    id: generateId(),
    title: 'Formulário sem título',
    description: '',
    fields: [],
    theme: {
      primaryColor: '#6C5CE7',
      backgroundColor: '#1a1a2e',
      textColor: '#ffffff',
      buttonColor: '#6C5CE7',
      choiceBorderColor: '#cccccc',
      fontFamily: 'Inter',
      backgroundImage: '',
      logoUrl: '',
    },
    settings: {
      showProgressBar: true,
      showQuestionNumbers: true,
      submitButtonText: 'Enviar',
      thankYouTitle: 'Obrigado!',
      thankYouMessage: 'Suas respostas foram enviadas com sucesso.',
      thankYouRedirectUrl: '',
      hiddenFields: [],
      enableScoring: false,
      scoreLabel: 'Pontos',
      showScoreAtEnd: false,
    },
    published: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createField(type: FieldType): FormField {
  const base: FormField = {
    id: generateId(),
    type,
    title: '',
    description: '',
    required: false,
  };
  const defaults: Partial<Record<FieldType, Partial<FormField>>> = {
    short_text:      { title: 'Texto curto', placeholder: 'Digite sua resposta...' },
    long_text:       { title: 'Texto longo', placeholder: 'Digite sua resposta...' },
    email:           { title: 'Qual seu e-mail?', placeholder: 'nome@exemplo.com' },
    phone:           { title: 'Qual seu telefone?', placeholder: '(00) 00000-0000' },
    number:          { title: 'Número', placeholder: '0' },
    url:             { title: 'URL', placeholder: 'https://' },
    multiple_choice: { title: 'Múltipla escolha', options: ['Opção 1', 'Opção 2', 'Opção 3'], allowMultiple: false },
    checkbox:        { title: 'Caixas de seleção', options: ['Opção 1', 'Opção 2', 'Opção 3'] },
    dropdown:        { title: 'Lista suspensa', options: ['Opção 1', 'Opção 2', 'Opção 3'] },
    yes_no:          { title: 'Sim ou Não?' },
    rating:          { title: 'Avaliação', maxRating: 5 },
    opinion_scale:   { title: 'Escala de opinião', minValue: 0, maxValue: 10, minLabel: 'Nada provável', maxLabel: 'Muito provável' },
    date:            { title: 'Data' },
    welcome:         { title: 'Bem-vindo!', description: 'Clique em começar para iniciar.', buttonText: 'Começar' },
    statement:       { title: 'Declaração', description: 'Texto informativo.', buttonText: 'Continuar' },
    file_upload:     { title: 'Upload de arquivo', allowedTypes: 'image/*,.pdf,.doc,.docx' },
    picture_choice:  { title: 'Escolha com imagem', options: ['Opção 1', 'Opção 2'], allowMultiple: false },
    group: {
      title: '',
      description: 'Preencha seus dados abaixo.',
      subFields: [
        { id: generateId(), placeholder: 'Seu nome completo', type: 'short_text', required: true } as SubField,
        { id: generateId(), placeholder: 'WhatsApp com DDD', type: 'phone', required: true } as SubField,
      ],
    },
  };
  return { ...base, ...(defaults[type] || {}) };
}

// ── In-memory session step tracking (no persistence) ─────────────────────

export function recordStepView(
  session: FormSession,
  field: { id: string; title: string; type: FieldType },
): FormSession {
  const existing = session.steps.find(s => s.fieldId === field.id);
  const step: FormStep = existing
    ? { ...existing, revisits: existing.revisits + 1 }
    : { fieldId: field.id, fieldTitle: field.title, fieldType: field.type, viewedAt: new Date().toISOString(), revisits: 0 };
  const steps = existing
    ? session.steps.map(s => s.fieldId === field.id ? step : s)
    : [...session.steps, step];
  return { ...session, steps, lastFieldId: field.id };
}

export function recordStepAnswer(
  session: FormSession,
  fieldId: string,
  answer: FormStep['answer'],
  timeToAnswerMs: number,
): FormSession {
  const now = new Date().toISOString();
  const steps = session.steps.map(s =>
    s.fieldId === fieldId ? { ...s, answeredAt: now, timeToAnswerMs, answer } : s,
  );
  return { ...session, steps };
}
