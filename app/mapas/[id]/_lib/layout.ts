import type { NoDB, Point, Size } from './types'

// Layout horizontal estilo MindMeister: raiz à esquerda, filhos à direita,
// empilhados verticalmente. Cada folha ocupa uma "linha" de altura = altura_real_do_nó + ROW_GAP.
// Pais ficam centrados na média entre primeiro e último filho.

export const COL_WIDTH = 240
export const ROW_GAP = 14
export const NODE_W_DEFAULT = 140
export const NODE_H_DEFAULT = 40

const RAMO_COLORS = [
  '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#a855f7', '#ec4899', '#14b8a6',
]

function indexarArvore(nos: NoDB[]): { raiz: NoDB | null; filhos: Map<string, NoDB[]> } {
  const filhos = new Map<string, NoDB[]>()
  let raiz: NoDB | null = null
  for (const n of nos) {
    if (n.parent_id === null) raiz = n
    else {
      const arr = filhos.get(n.parent_id) || []
      arr.push(n)
      filhos.set(n.parent_id, arr)
    }
  }
  for (const arr of filhos.values()) arr.sort((a, b) => a.ordem - b.ordem)
  return { raiz, filhos }
}

export function computeLayout(
  nos: NoDB[],
  sizeOf: (id: string) => Size
): Map<string, Point> {
  const { raiz, filhos } = indexarArvore(nos)
  const pos = new Map<string, Point>()
  if (!raiz) return pos

  // Passo 1: altura da subárvore em coordenadas world.
  const subHeight = new Map<string, number>()
  function calcSubHeight(id: string): number {
    const kids = filhos.get(id) || []
    const minhaH = sizeOf(id).h + ROW_GAP
    if (kids.length === 0) {
      subHeight.set(id, minhaH)
      return minhaH
    }
    let soma = 0
    for (const k of kids) soma += calcSubHeight(k.id)
    const h = Math.max(minhaH, soma)
    subHeight.set(id, h)
    return h
  }
  calcSubHeight(raiz.id)

  // Passo 2: placement top-down. Cada nó fica no Y central do seu slot.
  function place(id: string, depth: number, yStart: number): number {
    const kids = filhos.get(id) || []
    const minhaH = subHeight.get(id) || 0
    if (kids.length === 0) {
      const meuY = yStart + minhaH / 2
      pos.set(id, { x: depth * COL_WIDTH, y: meuY })
      return meuY
    }
    let cursor = yStart
    const childYs: number[] = []
    for (const k of kids) {
      const altK = subHeight.get(k.id) || 0
      childYs.push(place(k.id, depth + 1, cursor))
      cursor += altK
    }
    const meuY = (childYs[0] + childYs[childYs.length - 1]) / 2
    pos.set(id, { x: depth * COL_WIDTH, y: meuY })
    return meuY
  }
  place(raiz.id, 0, -(subHeight.get(raiz.id) || 0) / 2)
  return pos
}

export function computeBranchColors(nos: NoDB[]): Map<string, string> {
  const { raiz, filhos } = indexarArvore(nos)
  const colorOf = new Map<string, string>()
  if (!raiz) return colorOf
  colorOf.set(raiz.id, RAMO_COLORS[0])

  const filhosDaRaiz = filhos.get(raiz.id) || []
  filhosDaRaiz.forEach((filho, i) => {
    const cor = RAMO_COLORS[(i % (RAMO_COLORS.length - 1)) + 1]
    const stack = [filho.id]
    while (stack.length) {
      const id = stack.pop()!
      colorOf.set(id, cor)
      for (const k of filhos.get(id) || []) stack.push(k.id)
    }
  })
  return colorOf
}

// Mapa parent → filhos (ordenado por ordem). Usado pra ocultar subárvore, contar filhos, etc.
export function indexarFilhos(nos: NoDB[]): Map<string, NoDB[]> {
  return indexarArvore(nos).filhos
}

// Conjunto de ids ocultos por causa de pais collapsed.
export function calcularOcultos(
  nos: NoDB[],
  filhosPorPai: Map<string, NoDB[]>
): Set<string> {
  const hidden = new Set<string>()
  function ocultar(parentId: string) {
    for (const k of filhosPorPai.get(parentId) || []) {
      hidden.add(k.id)
      ocultar(k.id)
    }
  }
  for (const n of nos) if (n.collapsed) ocultar(n.id)
  return hidden
}

// Descendentes (incluindo o próprio id) — pra validar drop e cascade de delete local.
export function descendentesDe(
  id: string,
  filhosPorPai: Map<string, NoDB[]>
): Set<string> {
  const out = new Set<string>([id])
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const k of filhosPorPai.get(cur) || []) {
      if (!out.has(k.id)) { out.add(k.id); stack.push(k.id) }
    }
  }
  return out
}
