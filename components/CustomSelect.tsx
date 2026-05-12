'use client'
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import styles from './CustomSelect.module.css'

export interface SelectOption {
  id: string
  label: string
  subLabel?: string
  icon?: React.ReactNode
  image?: string
}

interface CustomSelectProps {
  label?: string
  caption?: string
  value: string
  options: SelectOption[]
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  createOptionLabel?: string
  onCreateOption?: () => void
  searchable?: boolean
  /** Renderiza o menu via portal (position:fixed) — use dentro de modais com overflow */
  menuFixed?: boolean
}

export default function CustomSelect({
  label,
  caption,
  value,
  options,
  onChange,
  placeholder = 'Selecionar...',
  className,
  disabled,
  createOptionLabel = '+ Cadastrar',
  onCreateOption,
  searchable = true,
  menuFixed,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selectedOption = options.find(o => o.id === value)
  const shouldShowSearch = searchable && options.length >= 6
  const filteredOptions = options.filter(option => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${option.label} ${option.subLabel || ''}`.toLowerCase().includes(q)
  })

  useEffect(() => {
    if (!isOpen) setSearch('')
  }, [isOpen])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      const clickedContainer = containerRef.current?.contains(target)
      const clickedMenu = menuRef.current?.contains(target)
      if (!clickedContainer && !clickedMenu) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const goUp = spaceBelow < 300 && rect.top > 300
      setOpenUp(goUp)

      if (menuFixed) {
        setMenuStyle(goUp
          ? { position: 'fixed', bottom: window.innerHeight - rect.top + 8, left: rect.left, width: rect.width, top: 'auto' }
          : { position: 'fixed', top: rect.bottom + 8, left: rect.left, width: rect.width }
        )
      }
    }
  }, [isOpen, menuFixed])

  const menu = (
    <div
      ref={menuRef}
      className={`${styles.menu} ${openUp ? styles.menuUp : ''}`}
      style={menuFixed ? { ...menuStyle, zIndex: 99999 } : undefined}
    >
      {shouldShowSearch && (
        <div className={styles.searchWrap}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Pesquisar..."
            className={styles.searchInput}
          />
        </div>
      )}
      {filteredOptions.map(option => {
        const isActive = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            className={`${styles.option} ${isActive ? styles.optionActive : ''}`}
            onClick={() => { onChange(option.id); setIsOpen(false) }}
          >
            {option.image && <img src={option.image} alt="" className={styles.optionImage} />}
            {option.icon && <span className={styles.optionIcon}>{option.icon}</span>}
            <div className={styles.optionInfo}>
              <div className={styles.optionLabel}>{option.label}</div>
              {option.subLabel && <div className={styles.optionSubLabel}>{option.subLabel}</div>}
            </div>
            {isActive && <span className={styles.checkmark}>✓</span>}
          </button>
        )
      })}
      {filteredOptions.length === 0 && (
        <div className={styles.emptyState}>Nenhuma opção encontrada.</div>
      )}
      {onCreateOption && (
        <button
          type="button"
          className={`${styles.option} ${styles.optionCreate}`}
          onClick={() => {
            setIsOpen(false)
            onCreateOption()
          }}
        >
          <span className={styles.optionCreateIcon}>+</span>
          <div className={styles.optionInfo}>
            <div className={styles.optionLabel}>{createOptionLabel}</div>
            <div className={styles.optionSubLabel}>Criar uma nova opção sem sair daqui</div>
          </div>
        </button>
      )}
    </div>
  )

  return (
    <div className={`${styles.container} ${className || ''}`} ref={containerRef}>
      {label && <label className={styles.label}>{label}</label>}
      <button
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''} ${disabled ? styles.triggerDisabled : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <div className={styles.triggerCopy}>
          {caption && <span className={styles.caption}>{caption}</span>}
          <span className={styles.value}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <svg className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        menuFixed
          ? createPortal(menu, document.body)
          : menu
      )}
    </div>
  )
}
