'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import NGPLoading from '@/components/NGPLoading'
import styles from './editor.module.css'

import { computeBranchColors, computeLayout } from './_lib/layout'
import type { NoDB, Point } from './_lib/types'

import { useNodeSizes } from './_hooks/useNodeSizes'
import { useViewport } from './_hooks/useViewport'
import { useMapaData } from './_hooks/useMapaData'
import { useNodeDrag } from './_hooks/useNodeDrag'

import { MapaTopbar } from './_components/MapaTopbar'
import { MapaNode } from './_components/MapaNode'
import { EdgeLayer } from './_components/EdgeLayer'
import { ZoomControl } from './_components/ZoomControl'

export default function MapaEditorPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const mapaId = params.id
  const [sess] = useState(getSession)
  const [mounted, setMounted] = useState(false)

  // ── Guarda de auth ────────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true)
    if (!sess || sess.auth !== '1') { router.replace('/login'); return }
    if (sess.role !== 'admin' && sess.role !== 'ngp') { router.replace('/cliente'); return }
  }, [])

  const canvasRef = useRef<HTMLDivElement | null>(null)

  // ── Tamanhos reais dos nós (ResizeObserver) ───────────────────────────────
  const { bindRef, getSize, sizes: nodeSizes } = useNodeSizes()

  // ── Dados do mapa (load + CRUD + debounce) ────────────────────────────────
  const onLoadFatal = useCallback(() => router.push('/mapas'), [router])
  const data = useMapaData(mapaId, onLoadFatal)
  const {
    mapa, nos, loading,
    tituloMapa, scheduleSaveTitulo,
    saveStatus, lastSavedAt,
    filhosPorPai, hiddenSet,
    adicionarNo, excluirNo, reparentear,
    scheduleSaveNo, updateNoLocal, reorganizar,
    editingNoId, editingText, selectedNoId,
    setEditingNoId, setEditingText, setSelectedNoId,
  } = data

  // ── Layout + cores (derivadas) ────────────────────────────────────────────
  const layout = useMemo(() => computeLayout(nos, getSize), [nos, getSize])
  const branchColors = useMemo(() => computeBranchColors(nos), [nos])

  // ── Preferência nowrap por nó (persiste em localStorage por mapa) ─────────
  const [nowrapIds, setNowrapIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!mapaId) return
    try {
      const raw = localStorage.getItem(`mapa-nowrap:${mapaId}`)
      if (raw) setNowrapIds(new Set(JSON.parse(raw)))
    } catch {}
  }, [mapaId])
  const toggleNowrap = useCallback((id: string) => {
    setNowrapIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      try { localStorage.setItem(`mapa-nowrap:${mapaId}`, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [mapaId])

  // ── Edição inline ─────────────────────────────────────────────────────────
  const startEdit = useCallback((id: string) => {
    const n = nos.find(x => x.id === id)
    if (!n) return
    setEditingNoId(id)
    setEditingText(n.texto)
    setSelectedNoId(id)
  }, [nos, setEditingNoId, setEditingText, setSelectedNoId])

  const commitEdit = useCallback(() => {
    if (!editingNoId) return
    const id = editingNoId
    const n = nos.find(x => x.id === id)
    if (n && n.texto !== editingText) {
      updateNoLocal(id, { texto: editingText })
      scheduleSaveNo({ ...n, texto: editingText })
    }
    setEditingNoId(null)
    setEditingText('')
  }, [editingNoId, editingText, nos, updateNoLocal, scheduleSaveNo, setEditingNoId, setEditingText])

  const toggleCollapse = useCallback(() => {
    if (!selectedNoId) return
    const n = nos.find(x => x.id === selectedNoId)
    if (!n) return
    const novo = !n.collapsed
    updateNoLocal(selectedNoId, { collapsed: novo })
    scheduleSaveNo({ ...n, collapsed: novo })
  }, [selectedNoId, nos, updateNoLocal, scheduleSaveNo])

  // ── Posição efetiva de um nó (drag > manual > layout) ─────────────────────
  // Precisa estar antes do useNodeDrag (dependência) e do useViewport.
  // Mas o drag retorna dragPositions — quebrar o ciclo: definimos getPosicao usando refs.
  const dragPositionsRef = useRef<Map<string, Point>>(new Map())
  const getPosicao = useCallback((n: NoDB): Point => {
    const drag = dragPositionsRef.current.get(n.id)
    if (drag) return drag
    if (n.posicao_x !== null && n.posicao_y !== null) return { x: n.posicao_x, y: n.posicao_y }
    return layout.get(n.id) || { x: 0, y: 0 }
  }, [layout])

  // ── Viewport (pan/zoom/fit/wheel) ─────────────────────────────────────────
  const viewport = useViewport({
    canvasRef,
    nos,
    hiddenSet,
    dragPositions: dragPositionsRef.current,
    getSize,
  })
  const { tx, ty, scale, panning, viewBusy, clientToWorld, fitView, onCanvasMouseDown, zoomBy } = viewport

  // ── Drag de nós ───────────────────────────────────────────────────────────
  const onCommitMove = useCallback((id: string, pos: Point) => {
    const atual = nos.find(n => n.id === id)
    if (!atual) return
    updateNoLocal(id, { posicao_x: pos.x, posicao_y: pos.y })
    scheduleSaveNo({ ...atual, posicao_x: pos.x, posicao_y: pos.y })
  }, [nos, updateNoLocal, scheduleSaveNo])

  const drag = useNodeDrag({
    nos, filhosPorPai, hiddenSet, scale, getSize, getPosicao, clientToWorld,
    onCommitDrop: reparentear,
    onCommitMove,
    onCommitEdit: commitEdit,
    onSelect: setSelectedNoId,
  })
  const { draggingNoId, dropTargetId, dragPositions, onNodeMouseDown } = drag
  // Sincroniza ref usado em getPosicao
  useEffect(() => { dragPositionsRef.current = dragPositions }, [dragPositions])

  // ── Pan no fundo do canvas (delega pro viewport, mas precisa cuidar do estado de edição) ──
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const startedPan = onCanvasMouseDown(e)
    if (startedPan) {
      if (editingNoId) commitEdit()
      setSelectedNoId(null)
    }
  }, [onCanvasMouseDown, editingNoId, commitEdit, setSelectedNoId])

  // ── Fit inicial — quando todos os nós visíveis tiverem sido medidos,
  // ou fallback de 500ms se RO atrasar ─────────────────────────────────────
  const [needsInitialFit, setNeedsInitialFit] = useState(true)
  useEffect(() => { if (!loading) setNeedsInitialFit(true) }, [loading])
  useEffect(() => {
    if (!needsInitialFit || nos.length === 0) return
    const visiveis = nos.filter(n => !hiddenSet.has(n.id))
    if (visiveis.length === 0) return
    const todosMedidos = visiveis.every(n => nodeSizes.has(n.id))
    if (todosMedidos) {
      fitView()
      setNeedsInitialFit(false)
      return
    }
    const t = setTimeout(() => { fitView(); setNeedsInitialFit(false) }, 500)
    return () => clearTimeout(t)
  }, [nodeSizes, nos, hiddenSet, needsInitialFit, fitView])

  // ── Atalhos de teclado ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); fitView(); return }
      if (!selectedNoId) return
      if (e.key === 'Tab') { e.preventDefault(); adicionarNo(selectedNoId, false) }
      else if (e.key === 'Enter') { e.preventDefault(); adicionarNo(selectedNoId, true) }
      else if (e.key === 'F2') { e.preventDefault(); startEdit(selectedNoId) }
      else if (e.shiftKey && (e.key === 'W' || e.key === 'w')) { e.preventDefault(); toggleNowrap(selectedNoId) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); void excluirNo(selectedNoId) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedNoId, fitView, adicionarNo, startEdit, toggleNowrap, excluirNo])

  // ── Render ────────────────────────────────────────────────────────────────
  if (!sess || !mounted || loading) return <NGPLoading loading loadingText="Carregando mapa..." />
  if (!mapa) return null

  const nosVisiveis = nos.filter(n => !hiddenSet.has(n.id))
  const selectedNo = selectedNoId ? nos.find(n => n.id === selectedNoId) : null
  const animatedFloating = !panning && !viewBusy

  return (
    <div className={`${styles.shell} ${(panning || draggingNoId || viewBusy) ? styles.noTransition : ''}`}>
      <MapaTopbar
        mapa={mapa}
        tituloMapa={tituloMapa}
        onTituloChange={scheduleSaveTitulo}
        saveStatus={saveStatus}
        lastSavedAt={lastSavedAt}
        selectedNoId={selectedNoId}
        onBack={() => router.push('/mapas')}
        onReorganizar={reorganizar}
        onToggleCollapse={toggleCollapse}
        onExcluir={() => selectedNoId && excluirNo(selectedNoId)}
      />

      <div
        ref={canvasRef}
        className={`${styles.canvasWrap} ${panning ? styles.panning : ''}`}
        onMouseDown={handleCanvasMouseDown}
      >
        <EdgeLayer
          nosVisiveis={nosVisiveis}
          todosNos={nos}
          hiddenSet={hiddenSet}
          branchColors={branchColors}
          getPosicao={getPosicao}
          getSize={getSize}
          scale={scale}
          tx={tx}
          ty={ty}
        />

        <div className={styles.nodesLayer}>
          {nosVisiveis.map(n => (
            <MapaNode
              key={n.id}
              no={n}
              pos={getPosicao(n)}
              scale={scale}
              tx={tx}
              ty={ty}
              isRoot={n.parent_id === null}
              isSelected={selectedNoId === n.id}
              isDropTarget={dropTargetId === n.id}
              isDragging={draggingNoId === n.id}
              isEditing={editingNoId === n.id}
              isNowrap={nowrapIds.has(n.id)}
              cor={branchColors.get(n.id) || '#4f46e5'}
              hasChildren={(filhosPorPai.get(n.id) || []).length > 0}
              editingText={editingText}
              bindRef={bindRef(n.id)}
              onMouseDown={(e) => onNodeMouseDown(e, n)}
              onClick={() => setSelectedNoId(n.id)}
              onDoubleClick={() => startEdit(n.id)}
              onEditChange={setEditingText}
              onEditBlur={commitEdit}
              onEditEnter={commitEdit}
              onEditEscape={commitEdit}
            />
          ))}
        </div>

        {/* Botões + flutuantes ao redor do nó selecionado */}
        {selectedNo && !editingNoId && !draggingNoId && (() => {
          const pos = getPosicao(selectedNo)
          const cor = branchColors.get(selectedNo.id) || '#4f46e5'
          const screenX = pos.x * scale + tx
          const screenY = pos.y * scale + ty
          const sz = getSize(selectedNo.id)
          const halfW = sz.w / 2
          const halfH = sz.h / 2
          const btnCls = `${styles.addBtn} ${animatedFloating ? styles.animated : ''}`
          return (
            <>
              <button
                className={btnCls}
                style={{ left: screenX + halfW + 14, top: screenY, background: cor }}
                onClick={() => adicionarNo(selectedNo.id, false)}
                title="Adicionar filho (Tab)"
              >+</button>
              {selectedNo.parent_id !== null && (
                <button
                  className={btnCls}
                  style={{ left: screenX, top: screenY + halfH + 14, background: cor }}
                  onClick={() => adicionarNo(selectedNo.id, true)}
                  title="Adicionar irmão (Enter)"
                >+</button>
              )}
            </>
          )
        })()}

        <ZoomControl
          scale={scale}
          onZoomOut={() => zoomBy(1 / 1.2)}
          onZoomIn={() => zoomBy(1.2)}
          onFit={() => fitView()}
        />

        <div className={styles.helpBar}>
          <span><kbd>Tab</kbd> filho</span>
          <span><kbd>Enter</kbd> irmão</span>
          <span><kbd>F2</kbd> editar</span>
          <span><kbd>Del</kbd> excluir</span>
          <span><kbd>F</kbd> centralizar</span>
          <span><kbd>Shift+W</kbd> linha única</span>
          <span><kbd>Arrasta</kbd> mover • <kbd>Cmd+scroll</kbd> zoom</span>
        </div>
      </div>
    </div>
  )
}
