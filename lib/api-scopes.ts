// Fonte central das permissões de API tokens (api_tokens.scopes).
// Especificação completa em docs/api-integracoes.md.
//
// A UI de /admin/integracoes apresenta cada setor como uma "Box" com 1 toggle
// "básico" (ligado por padrão) + N toggles para ações delicadas.
//
// ⚠️ Espelho mínimo deste arquivo vive em supabase/functions/_shared/api_scopes.ts
// (Deno não importa do alias @/lib). O mirror só precisa conter os SETOR_BOXES
// com status 'disponivel' (descrições e helpers da UI ficam só aqui). Ao adicionar/
// remover scope de um setor disponível, atualize os dois arquivos para evitar
// que o backend rejeite scopes que a UI gera, ou vice-versa.

export type Sensibilidade = 'baixa' | 'media' | 'alta'
export type StatusBox     = 'disponivel' | 'em_breve'

export interface AcaoDelicada {
  /** Scope literal (ex: 'financeiro:delete'). */
  id: string
  label: string
  description: string
  sensibilidade: Sensibilidade
  /** Exige confirmação modal antes de gerar o token (default: alta exige sempre). */
  requerConfirmacao?: boolean
}

export interface SetorBoxBasico {
  label: string
  description: string
  /** Conjunto de scopes ligados quando a box está marcada e o "básico" também. */
  scopes: string[]
  sensibilidade: Sensibilidade
}

export interface SetorBox {
  id: string
  label: string
  /** Texto curto exibido sob o título da box. */
  description: string
  status: StatusBox
  basico: SetorBoxBasico
  acoesDelicadas: AcaoDelicada[]
}

export const SETOR_BOXES: SetorBox[] = [
  {
    id: 'financeiro',
    label: 'Financeiro',
    description: 'Endpoints de contas, categorias, lançamentos e relatórios financeiros.',
    status: 'disponivel',
    basico: {
      label: 'Acesso básico ao Financeiro',
      description: 'Listar contas, categorias, criar lançamentos e consultar relatórios (briefing diário, resumo semanal).',
      scopes: ['financeiro:read', 'financeiro:create', 'financeiro:reports'],
      sensibilidade: 'media',
    },
    acoesDelicadas: [
      {
        id: 'financeiro:delete',
        label: 'Excluir lançamentos',
        description: 'Ação destrutiva. Permite apagar registros financeiros pela API (soft delete com janela de 30 dias para restauração).',
        sensibilidade: 'alta',
        requerConfirmacao: true,
      },
    ],
  },
  {
    id: 'feedback',
    label: 'Feedbacks',
    description: 'Bugs, erros e sugestões enviados pelos usuários do sistema.',
    status: 'disponivel',
    basico: {
      label: 'Ler feedbacks dos usuários',
      description: 'Lista e detalhe de feedbacks (varredura matinal pelo agente externo).',
      scopes: ['feedback:read'],
      sensibilidade: 'baixa',
    },
    acoesDelicadas: [
      {
        id: 'feedback:update',
        label: 'Atualizar status / responder',
        description: 'Mover feedbacks entre status (novo / em andamento / resolvido / descartado) e gravar resposta interna.',
        sensibilidade: 'media',
      },
    ],
  },
  {
    id: 'comercial',
    label: 'Comercial',
    description: 'Leads, propostas e follow-ups (em desenvolvimento).',
    status: 'em_breve',
    basico: { label: '—', description: '—', scopes: [], sensibilidade: 'baixa' },
    acoesDelicadas: [],
  },
  {
    id: 'pessoas',
    label: 'Pessoas',
    description: 'Colaboradores, ponto e carreira (em desenvolvimento).',
    status: 'em_breve',
    basico: { label: '—', description: '—', scopes: [], sensibilidade: 'baixa' },
    acoesDelicadas: [],
  },
  {
    id: 'tarefas',
    label: 'Tarefas',
    description: 'Listas, cards e atribuições (em desenvolvimento).',
    status: 'em_breve',
    basico: { label: '—', description: '—', scopes: [], sensibilidade: 'baixa' },
    acoesDelicadas: [],
  },
]

/** Lista plana de todos os scopes válidos hoje. Backend usa para validar entrada. */
export const ALL_SCOPES: string[] = (() => {
  const set = new Set<string>()
  SETOR_BOXES.filter(b => b.status === 'disponivel').forEach(box => {
    box.basico.scopes.forEach(s => set.add(s))
    box.acoesDelicadas.forEach(a => set.add(a.id))
  })
  return Array.from(set)
})()

/** Dado um array de scopes salvo no banco, agrupa por setor para exibição em badges. */
export interface BadgeGrupo {
  setorLabel: string
  parts: Array<{ label: string; sensibilidade: Sensibilidade; scope: string }>
}

export function groupScopesForDisplay(scopes: string[]): {
  groups: BadgeGrupo[]
  unknown: string[]
} {
  const groups: BadgeGrupo[] = []
  const consumed = new Set<string>()

  for (const box of SETOR_BOXES) {
    if (box.status !== 'disponivel') continue
    const parts: BadgeGrupo['parts'] = []

    const basicoCovered = box.basico.scopes.length > 0 && box.basico.scopes.every(s => scopes.includes(s))
    if (basicoCovered) {
      parts.push({ label: 'básico', sensibilidade: box.basico.sensibilidade, scope: box.basico.scopes.join(',') })
      box.basico.scopes.forEach(s => consumed.add(s))
    }

    for (const acao of box.acoesDelicadas) {
      if (scopes.includes(acao.id)) {
        parts.push({ label: acao.label.toLowerCase(), sensibilidade: acao.sensibilidade, scope: acao.id })
        consumed.add(acao.id)
      }
    }

    if (parts.length) groups.push({ setorLabel: box.label, parts })
  }

  const unknown = scopes.filter(s => !consumed.has(s))
  return { groups, unknown }
}

export const SENSIBILIDADE_LABELS: Record<Sensibilidade, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta:  'Alta',
}
