// ─────────────────────────────────────────────────────────────────────────────
// Hierarquia de roles do sistema NGP Space
//
//  admin   → acesso total (inclui tudo que ngp pode + ações administrativas)
//  ngp     → usuário interno NGP
//  cliente → acesso restrito à área do cliente
//
// Para checar permissões, use sempre as funções abaixo — nunca compare
// role strings diretamente no código. Isso facilita adicionar novos roles
// ou alterar a hierarquia no futuro sem precisar alterar cada função.
// ─────────────────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'ngp' | 'cliente'

/** Acesso de admin (exclusivo) */
export const isAdmin = (role: string): boolean => role === 'admin'

/** Acesso NGP: admin e ngp têm acesso */
export const isNgp = (role: string): boolean => role === 'ngp' || role === 'admin'

/** Acesso cliente */
export const isCliente = (role: string): boolean => role === 'cliente'

/**
 * Roles aceitas para login dependendo da aba selecionada.
 * Aba "NGP"     → ngp e admin
 * Aba "cliente" → cliente
 */
export const loginRolesFor = (tabRole: string): string[] =>
  tabRole === 'ngp' ? ['ngp', 'admin'] : [tabRole]

// ─────────────────────────────────────────────────────────────────────────────
// Helper: valida sessão e retorna { usuario_id, role } ou null
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionUser {
  usuario_id: string
  role: string
}

// deno-lint-ignore no-explicit-any
export async function validateSession(sb: any, session_token: string): Promise<SessionUser | null> {
  const { data: sessao } = await sb
    .from('sessions')
    .select('usuario_id')
    .eq('token', session_token)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (!sessao) return null

  const { data: usuario } = await sb
    .from('usuarios')
    .select('role')
    .eq('id', sessao.usuario_id)
    .single()

  if (!usuario) return null

  return { usuario_id: sessao.usuario_id, role: usuario.role }
}
