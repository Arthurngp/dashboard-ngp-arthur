// ============================================================================
// Modelos OpenAI disponíveis pro NGP Copilot.
// O usuário escolhe via dropdown no header do setor; preferência fica em
// localStorage. Edge function copilot-chat respeita o parâmetro `model`.
// ============================================================================

export interface CopilotModelOption {
  id: string                // string que vai pra OpenAI API
  label: string             // nome amigável no dropdown
  hint: string              // 1 linha sobre quando usar
  costTier: 1 | 2 | 3 | 4   // 1 = barato, 4 = caro
  speedTier: 1 | 2 | 3 | 4  // 1 = lento, 4 = rápido
  isReasoning?: boolean     // modelos com chain-of-thought interno (o1)
}

export const COPILOT_MODELS: CopilotModelOption[] = [
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    hint: 'Padrão. Bom equilíbrio de qualidade, velocidade e custo.',
    costTier: 3,
    speedTier: 3,
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    hint: 'Mais barato e rápido. Bom pra conversa fiada e tarefas leves.',
    costTier: 1,
    speedTier: 4,
  },
  {
    id: 'o1-mini',
    label: 'o1-mini (raciocínio)',
    hint: 'Reasoning interno. Mais profundo, mais lento, mais caro. Bom pra análises densas.',
    costTier: 3,
    speedTier: 1,
    isReasoning: true,
  },
  {
    id: 'gpt-5',
    label: 'GPT-5',
    hint: 'Mais recente. Requer que sua API key tenha acesso liberado.',
    costTier: 4,
    speedTier: 3,
  },
]

export const DEFAULT_COPILOT_MODEL = 'gpt-4o'

const STORAGE_KEY = 'ngp-copilot-preferred-model'

export function getPreferredModel(): string {
  if (typeof window === 'undefined') return DEFAULT_COPILOT_MODEL
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && COPILOT_MODELS.some((m) => m.id === stored)) return stored
  } catch {
    // localStorage indisponível (modo privado, etc) — fallback silencioso
  }
  return DEFAULT_COPILOT_MODEL
}

export function setPreferredModel(modelId: string): void {
  if (typeof window === 'undefined') return
  if (!COPILOT_MODELS.some((m) => m.id === modelId)) return
  try {
    window.localStorage.setItem(STORAGE_KEY, modelId)
    // Notifica outros componentes da mesma tab (storage event só dispara entre tabs)
    window.dispatchEvent(new CustomEvent('ngp-copilot-model-changed', { detail: modelId }))
  } catch {
    // silencioso
  }
}

export function findModel(modelId: string | null | undefined): CopilotModelOption | null {
  if (!modelId) return null
  return COPILOT_MODELS.find((m) => m.id === modelId) || null
}
