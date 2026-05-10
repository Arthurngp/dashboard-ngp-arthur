// Espelho de lib/api-scopes.ts para o runtime Deno das Edge Functions.
// Ao editar SETOR_BOXES aqui, atualize lib/api-scopes.ts também.

export type Sensibilidade = 'baixa' | 'media' | 'alta'
export type StatusBox     = 'disponivel' | 'em_breve'

export interface AcaoDelicada {
  id: string
  label: string
  description: string
  sensibilidade: Sensibilidade
  requerConfirmacao?: boolean
}

export interface SetorBoxBasico {
  label: string
  description: string
  scopes: string[]
  sensibilidade: Sensibilidade
}

export interface SetorBox {
  id: string
  label: string
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
      description: 'Listar contas, categorias, criar lançamentos e consultar relatórios.',
      scopes: ['financeiro:read', 'financeiro:create', 'financeiro:reports'],
      sensibilidade: 'media',
    },
    acoesDelicadas: [
      {
        id: 'financeiro:update',
        label: 'Atualizar lançamentos',
        description: 'Permite alterar campos de lançamentos existentes (descrição, valor, status, data, categoria, conta) e reclassificar em massa.',
        sensibilidade: 'media',
      },
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
        description: 'Mover feedbacks entre status e gravar resposta interna.',
        sensibilidade: 'media',
      },
    ],
  },
]

export const ALL_SCOPES: string[] = (() => {
  const set = new Set<string>()
  SETOR_BOXES.filter(b => b.status === 'disponivel').forEach(box => {
    box.basico.scopes.forEach(s => set.add(s))
    box.acoesDelicadas.forEach(a => set.add(a.id))
  })
  return Array.from(set)
})()
