'use client'

import styles from '../editor.module.css'
import type { MapaDB, SaveStatus } from '../_lib/types'

interface Props {
  mapa: MapaDB
  tituloMapa: string
  onTituloChange: (v: string) => void
  saveStatus: SaveStatus
  lastSavedAt: Date | null
  selectedNoId: string | null
  onBack: () => void
  onReorganizar: () => void
  onToggleCollapse: () => void
  onExcluir: () => void
}

export function MapaTopbar({
  mapa, tituloMapa, onTituloChange,
  saveStatus, lastSavedAt, selectedNoId,
  onBack, onReorganizar, onToggleCollapse, onExcluir,
}: Props) {
  return (
    <header className={styles.topbar}>
      <div className={styles.topLeft}>
        <button className={styles.backBtn} onClick={onBack}>← Mapas</button>
        <input
          className={styles.titleInput}
          value={tituloMapa}
          onChange={e => onTituloChange(e.target.value)}
          placeholder="Título do mapa"
        />
        {mapa.cliente?.nome && (
          <span style={{ fontSize: 12, color: '#6366f1', fontWeight: 600 }}>
            {mapa.cliente.nome}
          </span>
        )}
      </div>
      <div className={styles.topRight}>
        <span className={[
          styles.saveStatus,
          saveStatus === 'saving' ? styles.saving : '',
          saveStatus === 'error' ? styles.error : '',
        ].filter(Boolean).join(' ')}>
          {saveStatus === 'saving' && 'salvando…'}
          {saveStatus === 'saved' && lastSavedAt && `salvo às ${lastSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
          {saveStatus === 'error' && 'erro ao salvar'}
        </span>
        <button className={styles.toolBtn} onClick={onReorganizar} title="Volta ao layout automático">Reorganizar</button>
        <button className={styles.toolBtn} onClick={onToggleCollapse} disabled={!selectedNoId}>Recolher/expandir</button>
        <button className={`${styles.toolBtn} ${styles.dangerBtn}`} onClick={onExcluir} disabled={!selectedNoId}>
          Excluir nó
        </button>
      </div>
    </header>
  )
}
