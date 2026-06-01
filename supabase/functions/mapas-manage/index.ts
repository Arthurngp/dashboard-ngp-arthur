import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json } from '../_shared/cors.ts'

// ─── mapas-manage ──────────────────────────────────────────────────────────
// CRUD do setor de Brainstorm (mapas mentais).
// PRD: docs/mapa-mental-prd.md — Fase 1
//
// Operações:
//   - list                : lista mapas (cabeçalho + qtd de nós)
//   - get                 : retorna mapa + todos os nós
//   - mapa_create         : cria mapa + nó raiz
//   - mapa_update         : atualiza titulo/descricao/cliente_id/tags/auto_layout
//   - mapa_delete         : remove mapa (cascade nos nós)
//   - no_upsert           : cria ou atualiza um nó (insert se sem id)
//   - no_delete           : remove nó (cascade na subárvore)
// ───────────────────────────────────────────────────────────────────────────

type Op =
  | 'list'
  | 'get'
  | 'mapa_create'
  | 'mapa_update'
  | 'mapa_delete'
  | 'no_upsert'
  | 'no_delete'

interface MapaPayload {
  titulo?: string
  descricao?: string | null
  cliente_id?: string | null
  tags?: string[]
  auto_layout?: boolean
}

interface NoPayload {
  id?: string
  mapa_id?: string
  parent_id?: string | null
  texto?: string
  nota_md?: string | null
  cor?: string | null
  icone?: string | null
  posicao_x?: number | null
  posicao_y?: number | null
  ordem?: number
  collapsed?: boolean
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const body = await req.json()
    const { session_token, op } = body as { session_token?: string; op?: Op }

    if (!session_token) return json(req, { error: 'Sessão inválida.' }, 401)
    if (!op) return json(req, { error: 'op obrigatório.' }, 400)

    const SURL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(SURL, SERVICE)

    const { data: sessao } = await sb
      .from('sessions')
      .select('usuario_id')
      .eq('token', session_token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!sessao) return json(req, { error: 'Sessão expirada.' }, 401)
    const userId = sessao.usuario_id as string

    const { data: usuario } = await sb
      .from('usuarios')
      .select('id, role')
      .eq('id', userId)
      .single()

    if (!usuario || (usuario.role !== 'admin' && usuario.role !== 'ngp')) {
      return json(req, { error: 'Acesso restrito à equipe NGP.' }, 403)
    }

    // ── list ────────────────────────────────────────────────────────────
    if (op === 'list') {
      const { cliente_id, search } = body as { cliente_id?: string | null; search?: string }
      let q = sb
        .from('mapas_mentais')
        .select(
          'id, titulo, descricao, cliente_id, tags, auto_layout, created_by, created_at, updated_at, ' +
          'cliente:clientes(id, nome), ' +
          'autor:usuarios!mapas_mentais_created_by_fkey(id, nome, foto_url)'
        )
        .order('updated_at', { ascending: false })

      if (cliente_id) q = q.eq('cliente_id', cliente_id)
      if (search?.trim()) q = q.ilike('titulo', `%${search.trim()}%`)

      const { data, error } = await q
      if (error) return json(req, { error: error.message }, 400)

      // Conta nós por mapa (uma query agregada)
      const ids = (data || []).map((m: { id: string }) => m.id)
      let counts: Record<string, number> = {}
      if (ids.length) {
        const { data: nos } = await sb
          .from('mapas_mentais_nos')
          .select('mapa_id')
          .in('mapa_id', ids)
        for (const n of nos || []) {
          const k = (n as { mapa_id: string }).mapa_id
          counts[k] = (counts[k] || 0) + 1
        }
      }

      const enriched = (data || []).map((m: { id: string }) => ({
        ...m,
        total_nos: counts[m.id] || 0,
      }))

      return json(req, { mapas: enriched })
    }

    // ── get ─────────────────────────────────────────────────────────────
    if (op === 'get') {
      const { id } = body as { id?: string }
      if (!id) return json(req, { error: 'id obrigatório.' }, 400)

      const { data: mapa, error: e1 } = await sb
        .from('mapas_mentais')
        .select(
          'id, titulo, descricao, cliente_id, tags, auto_layout, created_by, created_at, updated_at, ' +
          'cliente:clientes(id, nome), ' +
          'autor:usuarios!mapas_mentais_created_by_fkey(id, nome, foto_url)'
        )
        .eq('id', id)
        .single()
      if (e1) return json(req, { error: e1.message }, 404)

      const { data: nos, error: e2 } = await sb
        .from('mapas_mentais_nos')
        .select('*')
        .eq('mapa_id', id)
        .order('ordem', { ascending: true })
      if (e2) return json(req, { error: e2.message }, 400)

      return json(req, { mapa, nos: nos || [] })
    }

    // ── mapa_create ─────────────────────────────────────────────────────
    if (op === 'mapa_create') {
      const payload = (body.payload as MapaPayload) || {}
      const titulo = (payload.titulo || '').trim() || 'Mapa sem título'

      const { data: mapa, error: e1 } = await sb
        .from('mapas_mentais')
        .insert({
          titulo,
          descricao: payload.descricao ?? null,
          cliente_id: payload.cliente_id ?? null,
          tags: payload.tags ?? [],
          auto_layout: payload.auto_layout ?? true,
          created_by: userId,
        })
        .select('*')
        .single()
      if (e1) return json(req, { error: e1.message }, 400)

      // Nó raiz: texto padrão = título do mapa
      const { data: raiz, error: e2 } = await sb
        .from('mapas_mentais_nos')
        .insert({
          mapa_id: mapa.id,
          parent_id: null,
          texto: titulo,
          ordem: 0,
        })
        .select('*')
        .single()
      if (e2) return json(req, { error: e2.message }, 400)

      return json(req, { mapa, raiz })
    }

    // ── mapa_update ─────────────────────────────────────────────────────
    if (op === 'mapa_update') {
      const { id, payload } = body as { id?: string; payload?: MapaPayload }
      if (!id) return json(req, { error: 'id obrigatório.' }, 400)
      const upd: Record<string, unknown> = {}
      if (payload?.titulo !== undefined) upd.titulo = payload.titulo
      if (payload?.descricao !== undefined) upd.descricao = payload.descricao
      if (payload?.cliente_id !== undefined) upd.cliente_id = payload.cliente_id
      if (payload?.tags !== undefined) upd.tags = payload.tags
      if (payload?.auto_layout !== undefined) upd.auto_layout = payload.auto_layout

      const { data, error } = await sb
        .from('mapas_mentais')
        .update(upd)
        .eq('id', id)
        .select('*')
        .single()
      if (error) return json(req, { error: error.message }, 400)
      return json(req, { mapa: data })
    }

    // ── mapa_delete ─────────────────────────────────────────────────────
    if (op === 'mapa_delete') {
      const { id } = body as { id?: string }
      if (!id) return json(req, { error: 'id obrigatório.' }, 400)
      const { error } = await sb.from('mapas_mentais').delete().eq('id', id)
      if (error) return json(req, { error: error.message }, 400)
      return json(req, { ok: true })
    }

    // ── no_upsert ───────────────────────────────────────────────────────
    if (op === 'no_upsert') {
      const payload = (body.payload as NoPayload) || {}
      if (!payload.mapa_id) return json(req, { error: 'mapa_id obrigatório.' }, 400)

      // Update
      if (payload.id) {
        const upd: Record<string, unknown> = {}
        if (payload.parent_id !== undefined) upd.parent_id = payload.parent_id
        if (payload.texto !== undefined) upd.texto = payload.texto
        if (payload.nota_md !== undefined) upd.nota_md = payload.nota_md
        if (payload.cor !== undefined) upd.cor = payload.cor
        if (payload.icone !== undefined) upd.icone = payload.icone
        if (payload.posicao_x !== undefined) upd.posicao_x = payload.posicao_x
        if (payload.posicao_y !== undefined) upd.posicao_y = payload.posicao_y
        if (payload.ordem !== undefined) upd.ordem = payload.ordem
        if (payload.collapsed !== undefined) upd.collapsed = payload.collapsed

        const { data, error } = await sb
          .from('mapas_mentais_nos')
          .update(upd)
          .eq('id', payload.id)
          .select('*')
          .single()
        if (error) return json(req, { error: error.message }, 400)
        return json(req, { no: data })
      }

      // Insert
      const { data, error } = await sb
        .from('mapas_mentais_nos')
        .insert({
          mapa_id: payload.mapa_id,
          parent_id: payload.parent_id ?? null,
          texto: payload.texto ?? '',
          nota_md: payload.nota_md ?? null,
          cor: payload.cor ?? null,
          icone: payload.icone ?? null,
          posicao_x: payload.posicao_x ?? null,
          posicao_y: payload.posicao_y ?? null,
          ordem: payload.ordem ?? 0,
          collapsed: payload.collapsed ?? false,
        })
        .select('*')
        .single()
      if (error) return json(req, { error: error.message }, 400)
      return json(req, { no: data })
    }

    // ── no_delete ───────────────────────────────────────────────────────
    if (op === 'no_delete') {
      const { id } = body as { id?: string }
      if (!id) return json(req, { error: 'id obrigatório.' }, 400)

      // Não deixa apagar a raiz
      const { data: alvo } = await sb
        .from('mapas_mentais_nos')
        .select('parent_id')
        .eq('id', id)
        .single()
      if (alvo && alvo.parent_id === null) {
        return json(req, { error: 'Não é possível excluir o nó raiz.' }, 400)
      }

      const { error } = await sb.from('mapas_mentais_nos').delete().eq('id', id)
      if (error) return json(req, { error: error.message }, 400)
      return json(req, { ok: true })
    }

    return json(req, { error: `op desconhecida: ${op}` }, 400)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro interno'
    return json(req, { error: msg }, 500)
  }
})
