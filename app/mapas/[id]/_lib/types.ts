export interface NoDB {
  id: string
  mapa_id: string
  parent_id: string | null
  texto: string
  nota_md: string | null
  cor: string | null
  icone: string | null
  posicao_x: number | null
  posicao_y: number | null
  ordem: number
  collapsed: boolean
}

export interface MapaDB {
  id: string
  titulo: string
  descricao: string | null
  cliente_id: string | null
  tags: string[]
  auto_layout: boolean
  cliente?: { id: string; nome: string } | null
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
