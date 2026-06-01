import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { efCall } from '@/lib/api'
import { calcularOcultos, descendentesDe, indexarFilhos } from '../_lib/layout'
import type { MapaDB, NoDB, SaveStatus } from '../_lib/types'

interface UseMapaDataReturn {
  mapa: MapaDB | null
  nos: NoDB[]
  setNos: React.Dispatch<React.SetStateAction<NoDB[]>>
  loading: boolean
  tituloMapa: string
  setTituloMapa: (v: string) => void
  saveStatus: SaveStatus
  lastSavedAt: Date | null
  filhosPorPai: Map<string, NoDB[]>
  hiddenSet: Set<string>
  // Ações
  adicionarNo: (parentId: string, asSibling: boolean, opts?: { onCreated?: (tempId: string) => void }) => void
  excluirNo: (id: string) => Promise<void>
  reparentear: (filhoId: string, novoPaiId: string) => Promise<void>
  scheduleSaveNo: (no: NoDB) => void
  scheduleSaveTitulo: (v: string) => void
  updateNoLocal: (id: string, patch: Partial<NoDB>) => void
  reorganizar: () => Promise<void>
  // Refs pra ler estado de edição em closures async
  editingNoIdRef: React.MutableRefObject<string | null>
  editingTextRef: React.MutableRefObject<string>
  setEditingNoId: React.Dispatch<React.SetStateAction<string | null>>
  setEditingText: React.Dispatch<React.SetStateAction<string>>
  setSelectedNoId: React.Dispatch<React.SetStateAction<string | null>>
  editingNoId: string | null
  editingText: string
  selectedNoId: string | null
}

export function useMapaData(mapaId: string, onFatal: () => void): UseMapaDataReturn {
  const [mapa, setMapa] = useState<MapaDB | null>(null)
  const [nos, setNos] = useState<NoDB[]>([])
  const [loading, setLoading] = useState(true)
  const [tituloMapa, setTituloMapa] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [selectedNoId, setSelectedNoId] = useState<string | null>(null)
  const [editingNoId, setEditingNoId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  const editingNoIdRef = useRef<string | null>(null)
  const editingTextRef = useRef('')
  useEffect(() => { editingNoIdRef.current = editingNoId }, [editingNoId])
  useEffect(() => { editingTextRef.current = editingText }, [editingText])

  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const tituloDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filhosPorPai = useMemo(() => indexarFilhos(nos), [nos])
  const hiddenSet = useMemo(() => calcularOcultos(nos, filhosPorPai), [nos, filhosPorPai])

  const loadMapa = useCallback(async () => {
    setLoading(true)
    try {
      const res = await efCall('mapas-manage', { op: 'get', id: mapaId })
      if (res.error) {
        alert(`Erro: ${res.error}`)
        onFatal()
        return
      }
      const m = res.mapa as MapaDB
      const lista = (res.nos as NoDB[]) || []
      setMapa(m)
      setNos(lista)
      setTituloMapa(m.titulo)
      const raiz = lista.find(n => n.parent_id === null)
      if (raiz) setSelectedNoId(raiz.id)
    } catch (e) {
      console.error('[mapa] load', e)
      alert('Erro ao carregar mapa.')
    } finally {
      setLoading(false)
    }
  }, [mapaId, onFatal])

  useEffect(() => { void loadMapa() }, [loadMapa])

  const updateNoLocal = useCallback((id: string, patch: Partial<NoDB>) => {
    setNos(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n))
  }, [])

  const persistNo = useCallback(async (no: NoDB) => {
    try {
      const res = await efCall('mapas-manage', {
        op: 'no_upsert',
        payload: {
          id: no.id,
          mapa_id: no.mapa_id,
          texto: no.texto,
          parent_id: no.parent_id,
          ordem: no.ordem,
          collapsed: no.collapsed,
          posicao_x: no.posicao_x,
          posicao_y: no.posicao_y,
        },
      })
      if (res.error) { setSaveStatus('error'); console.error('[mapa] persist', res.error); return }
      setSaveStatus('saved')
      setLastSavedAt(new Date())
    } catch (e) {
      setSaveStatus('error')
      console.error('[mapa] persist', e)
    }
  }, [])

  const scheduleSaveNo = useCallback((no: NoDB) => {
    const existing = debounceTimers.current.get(no.id)
    if (existing) clearTimeout(existing)
    setSaveStatus('saving')
    const t = setTimeout(() => { void persistNo(no) }, 1000)
    debounceTimers.current.set(no.id, t)
  }, [persistNo])

  const scheduleSaveTitulo = useCallback((novo: string) => {
    setTituloMapa(novo)
    if (tituloDebounce.current) clearTimeout(tituloDebounce.current)
    setSaveStatus('saving')
    tituloDebounce.current = setTimeout(async () => {
      try {
        const res = await efCall('mapas-manage', { op: 'mapa_update', id: mapaId, payload: { titulo: novo } })
        if (res.error) { setSaveStatus('error'); return }
        setSaveStatus('saved')
        setLastSavedAt(new Date())
      } catch { setSaveStatus('error') }
    }, 1000)
  }, [mapaId])

  const adicionarNo = useCallback((parentId: string, asSibling: boolean, opts: { onCreated?: (tempId: string) => void } = {}) => {
    let realParentId = parentId
    if (asSibling) {
      const atual = nos.find(n => n.id === parentId)
      if (atual && atual.parent_id !== null) realParentId = atual.parent_id
    }
    const irmaos = nos.filter(n => n.parent_id === realParentId)
    const novaOrdem = irmaos.length
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: NoDB = {
      id: tempId,
      mapa_id: mapaId,
      parent_id: realParentId,
      texto: '',
      nota_md: null,
      cor: null,
      icone: null,
      posicao_x: null,
      posicao_y: null,
      ordem: novaOrdem,
      collapsed: false,
    }
    setNos(prev => [...prev, optimistic])
    setSelectedNoId(tempId)
    setEditingNoId(tempId)
    setEditingText('')
    setSaveStatus('saving')
    opts.onCreated?.(tempId)

    void (async () => {
      try {
        const res = await efCall('mapas-manage', {
          op: 'no_upsert',
          payload: { mapa_id: mapaId, parent_id: realParentId, texto: '', ordem: novaOrdem },
        })
        if (res.error) {
          setNos(prev => prev.filter(n => n.id !== tempId))
          setSelectedNoId(prev => prev === tempId ? realParentId : prev)
          setEditingNoId(prev => prev === tempId ? null : prev)
          setSaveStatus('error')
          alert(`Erro ao criar nó: ${res.error}`)
          return
        }
        const real = res.no as NoDB
        // Lê texto digitado AGORA (refs atualizadas), não o capturado no momento do callback.
        const textoLocal = editingNoIdRef.current === tempId ? editingTextRef.current : ''
        const textoFinal = textoLocal || real.texto || ''
        setNos(prev => prev.map(n => n.id === tempId ? { ...real, texto: textoFinal } : n))
        setSelectedNoId(prev => prev === tempId ? real.id : prev)
        setEditingNoId(prev => prev === tempId ? real.id : prev)
        if (textoLocal && textoLocal.length > 0) {
          void persistNo({ ...real, texto: textoLocal })
        } else {
          setSaveStatus('saved')
          setLastSavedAt(new Date())
        }
      } catch (e) {
        console.error('[mapa] adicionar', e)
        setNos(prev => prev.filter(n => n.id !== tempId))
        setSelectedNoId(prev => prev === tempId ? realParentId : prev)
        setEditingNoId(prev => prev === tempId ? null : prev)
        setSaveStatus('error')
      }
    })()
  }, [nos, mapaId, persistNo])

  const excluirNo = useCallback(async (id: string) => {
    const alvo = nos.find(n => n.id === id)
    if (!alvo) return
    if (alvo.parent_id === null) { alert('Não é possível excluir o nó raiz.'); return }
    const filhos = nos.filter(n => n.parent_id === id)
    if (filhos.length > 0) {
      if (!confirm(`Excluir "${alvo.texto || 'sem título'}" e todos os ${filhos.length}+ nós filhos?`)) return
    }
    try {
      setSaveStatus('saving')
      const res = await efCall('mapas-manage', { op: 'no_delete', id })
      if (res.error) { alert(`Erro: ${res.error}`); setSaveStatus('error'); return }
      // Re-deriva subárvore com estado mais recente (não snapshot velho).
      setNos(prev => {
        const toRemove = new Set<string>([id])
        let changed = true
        while (changed) {
          changed = false
          for (const n of prev) {
            if (n.parent_id && toRemove.has(n.parent_id) && !toRemove.has(n.id)) {
              toRemove.add(n.id); changed = true
            }
          }
        }
        return prev.filter(n => !toRemove.has(n.id))
      })
      setSelectedNoId(alvo.parent_id)
      setSaveStatus('saved')
      setLastSavedAt(new Date())
    } catch (e) { console.error('[mapa] excluir', e); setSaveStatus('error') }
  }, [nos])

  const reparentear = useCallback(async (filhoId: string, novoPaiId: string) => {
    const filho = nos.find(n => n.id === filhoId)
    if (!filho || filho.parent_id === novoPaiId) return
    if (filho.parent_id === null) { alert('Não dá pra mover o nó raiz.'); return }
    if (descendentesDe(filhoId, filhosPorPai).has(novoPaiId)) {
      alert('Não dá pra mover um nó pra dentro da própria subárvore.'); return
    }
    const paiAntigo = filho.parent_id
    const novaOrdem = nos.filter(n => n.parent_id === novoPaiId).length
    // Re-empacota ordens dos irmãos antigos (fecha o buraco que o nó movido deixa).
    const reorderAntigos = nos
      .filter(n => n.parent_id === paiAntigo && n.id !== filhoId)
      .sort((a, b) => a.ordem - b.ordem)
      .map((n, i) => ({ no: n, novaOrdem: i }))
      .filter(({ no, novaOrdem }) => no.ordem !== novaOrdem)

    setNos(prev => prev.map(n => {
      if (n.id === filhoId) return { ...n, parent_id: novoPaiId, ordem: novaOrdem, posicao_x: null, posicao_y: null }
      const r = reorderAntigos.find(x => x.no.id === n.id)
      if (r) return { ...n, ordem: r.novaOrdem }
      return n
    }))
    setSaveStatus('saving')
    try {
      const ops = [
        efCall('mapas-manage', {
          op: 'no_upsert',
          payload: { id: filhoId, mapa_id: filho.mapa_id, parent_id: novoPaiId, ordem: novaOrdem, posicao_x: null, posicao_y: null },
        }),
        ...reorderAntigos.map(({ no, novaOrdem: ord }) =>
          efCall('mapas-manage', {
            op: 'no_upsert',
            payload: { id: no.id, mapa_id: no.mapa_id, ordem: ord },
          })
        ),
      ]
      const results = await Promise.all(ops)
      const erro = results.find(r => r.error)
      if (erro) { setSaveStatus('error'); alert(`Erro: ${erro.error}`); return }
      setSaveStatus('saved')
      setLastSavedAt(new Date())
    } catch (e) { console.error('[mapa] reparent', e); setSaveStatus('error') }
  }, [nos, filhosPorPai])

  const reorganizar = useCallback(async () => {
    if (!confirm('Reorganizar volta ao layout automático. Posições manuais serão perdidas. Continuar?')) return
    setSaveStatus('saving')
    try {
      await Promise.all(
        nos.filter(n => n.posicao_x !== null || n.posicao_y !== null).map(n =>
          efCall('mapas-manage', {
            op: 'no_upsert',
            payload: { id: n.id, mapa_id: n.mapa_id, posicao_x: null, posicao_y: null },
          })
        )
      )
      setNos(prev => prev.map(n => ({ ...n, posicao_x: null, posicao_y: null })))
      setSaveStatus('saved')
      setLastSavedAt(new Date())
    } catch (e) { console.error('[mapa] reorganizar', e); setSaveStatus('error') }
  }, [nos])

  return {
    mapa, nos, setNos, loading,
    tituloMapa, setTituloMapa,
    saveStatus, lastSavedAt,
    filhosPorPai, hiddenSet,
    adicionarNo, excluirNo, reparentear,
    scheduleSaveNo, scheduleSaveTitulo, updateNoLocal,
    reorganizar,
    editingNoIdRef, editingTextRef,
    setEditingNoId, setEditingText, setSelectedNoId,
    editingNoId, editingText, selectedNoId,
  }
}
