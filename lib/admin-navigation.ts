export type AdminNavId = 'cadastros' | 'contas' | 'clientes-arquivados' | 'setores-tarefas' | 'integracoes' | 'api-docs' | 'feedback'

export interface AdminNavigationItem {
  id: AdminNavId
  label: string
  href: string
  description: string
  adminOnly?: boolean
}

const ADMIN_NAV_ITEMS: AdminNavigationItem[] = [
  {
    id: 'cadastros',
    label: 'Cadastros',
    href: '/admin/usuarios?tab=clientes',
    description: 'Central de clientes, acessos do portal e usuarios da equipe.',
  },
  {
    id: 'contas',
    label: 'Contas de Anuncio',
    href: '/admin/contas',
    description: 'Vincule e acompanhe as contas Meta liberadas para clientes.',
    adminOnly: true,
  },
  {
    id: 'clientes-arquivados',
    label: 'Clientes Arquivados',
    href: '/admin/clientes-arquivados',
    description: 'Restaure clientes e projetos encerrados quando precisar.',
  },
  {
    id: 'setores-tarefas',
    label: 'Setores de Tarefas',
    href: '/tarefas/config',
    description: 'Organize as listas e setores usados na operacao.',
    adminOnly: true,
  },
  {
    id: 'integracoes',
    label: 'Integrações',
    href: '/admin/integracoes',
    description: 'Gere tokens de API para ferramentas externas como OpenClaw.',
    adminOnly: true,
  },
  {
    id: 'api-docs',
    label: 'Documentação de API',
    href: '/admin/api-docs',
    description: 'Endpoints, scopes, exemplos de uso e instruções para agentes externos.',
    adminOnly: true,
  },
  {
    id: 'feedback',
    label: 'Feedbacks',
    href: '/admin/feedback',
    description: 'Bugs, erros e sugestões enviados pelos usuários do sistema.',
    adminOnly: true,
  },
]

export function getAdminNavigation(role?: string) {
  return ADMIN_NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin')
}
