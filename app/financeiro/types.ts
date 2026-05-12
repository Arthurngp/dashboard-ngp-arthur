export type Tab = 'transacoes' | 'contatos' | 'categorias' | 'contas' | 'dre'
export type TipoFiltro = 'todos' | 'entrada' | 'saida' | 'transferencia'
export type PeriodoTipo = 'hoje' | 'semana' | 'mes' | '30dias' | 'ultimo_mes' | 'trimestre' | 'ano' | 'mes_especifico' | 'personalizado' | 'tudo'
export type ViewMode = 'competencia' | 'caixa'
export type ContatoTipo = 'cliente' | 'fornecedor' | 'ambos'
export type ContatoFiltro = 'todos' | 'clientes' | 'fornecedores' | 'ambos'
export type TransacaoSortField = 'payment_date' | 'descricao' | 'categoria' | 'cost_center' | 'account' | 'tipo' | 'valor' | 'status'
export type SortDirection = 'asc' | 'desc'
export type ImportBulkField = 'contato' | 'categoria' | 'tipo' | 'status'

export interface Categoria { id: string; nome: string; cor: string; tipo: string }

export interface FinCliente {
  id: string
  nome: string
  documento?: string
  telefone?: string
  email?: string
  observacoes?: string
  mensalidade_valor?: number | null
  mensalidade_descricao?: string | null
  dia_cobranca?: number | null
  assinatura_ativa?: boolean | null
}

export interface FinFornecedor { id: string; nome: string; documento?: string; telefone?: string; email?: string; observacoes?: string }
export interface FinAccount { id: string; nome: string; tipo: string; saldo_inicial: number; saldo_atual: number; incluir_no_saldo?: boolean; ativo?: boolean }
export interface FinCostCenter { id: string; nome: string; descricao?: string }
export interface FinProduct { id: string; nome: string; tipo: string; valor_padrao?: number | null }

export interface FinContato {
  key: string
  nome: string
  documento?: string
  telefone?: string
  email?: string
  observacoes?: string
  tipo: ContatoTipo
  clienteId?: string
  fornecedorId?: string
  mensalidade_valor?: number | null
  mensalidade_descricao?: string | null
  dia_cobranca?: number | null
  assinatura_ativa?: boolean | null
}

export interface ReceitaCnpjData {
  razao_social?: string
  nome_fantasia?: string
  email?: string | null
  ddd_telefone_1?: string
  telefone_1?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  municipio?: string
  uf?: string
  cep?: string
  descricao_situacao_cadastral?: string
  estabelecimento?: {
    nome_fantasia?: string | null
    email?: string | null
    ddd1?: string | null
    telefone1?: string | null
    logradouro?: string | null
    numero?: string | null
    complemento?: string | null
    bairro?: string | null
    cep?: string | null
    situacao_cadastral?: string | null
    cidade?: { nome?: string | null } | null
    estado?: { sigla?: string | null } | null
  } | null
}

export interface Transacao {
  id: string
  tipo: 'entrada' | 'saida' | 'transferencia'
  descricao: string
  valor: number
  data_transacao: string
  competence_date?: string | null
  payment_date?: string | null
  status: 'confirmado' | 'pendente' | 'cancelado'
  observacoes?: string
  source_type?: 'manual' | 'api' | 'import' | 'system' | null
  source_tag?: string | null
  source_message?: string | null
  api_token_id?: string | null
  categoria?: Categoria | null
  cliente?: FinCliente | null
  fornecedor?: FinFornecedor | null
  account?: FinAccount | null
  cost_center?: FinCostCenter | null
  product?: FinProduct | null
  transfer_pair_id?: string | null
  transfer_direction?: 'in' | 'out' | null
  creator?: { id: string; nome: string } | null
}

export interface DreCellValue { confirmado: number; pendente: number }

export interface DreRow {
  categoria_id: string | null
  categoria_nome: string
  tipo: 'entrada' | 'saida'
  meses: DreCellValue[]
}

export interface DreData {
  ano: number
  view: ViewMode
  entradas: DreRow[]
  saidas: DreRow[]
  total_entradas: DreCellValue[]
  total_saidas: DreCellValue[]
  resultado: DreCellValue[]
}

export interface ResumoData {
  entradas: number
  saidas: number
  saldo: number
}
