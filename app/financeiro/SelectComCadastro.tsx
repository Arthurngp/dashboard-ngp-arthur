'use client'
import { useState } from 'react'
import CustomSelect from '@/components/CustomSelect'
import styles from './financeiro.module.css'

export interface QuickCreateField {
  key: string
  label: string
  placeholder?: string
  type?: string
  required?: boolean
}

interface Props {
  label: string
  value: string
  options: { id: string; label: string }[]
  onChange: (v: string) => void
  placeholder?: string
  createLabel: string
  createFields: QuickCreateField[]
  onQuickCreate: (fields: Record<string, string>) => Promise<boolean>
  menuFixed?: boolean
}

export default function SelectComCadastro({
  label, value, options, onChange, placeholder,
  createLabel, createFields, onQuickCreate, menuFixed,
}: Props) {
  const [showQuick, setShowQuick] = useState(false)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  function openQuick() {
    const init: Record<string, string> = {}
    createFields.forEach(f => { init[f.key] = '' })
    setFieldValues(init)
    setShowQuick(true)
  }

  async function handleSubmit() {
    const hasMissingRequired = createFields.some(f => f.required && !(fieldValues[f.key] || '').trim())
    if (hasMissingRequired) return
    setSaving(true)
    try {
      const ok = await onQuickCreate(fieldValues)
      if (ok) setShowQuick(false)
    } finally { setSaving(false) }
  }

  return (
    <div className={styles.selectComCadastro}>
      <CustomSelect
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        placeholder={placeholder}
        createOptionLabel="+ Cadastrar"
        onCreateOption={openQuick}
        menuFixed={menuFixed}
      />
      {showQuick && (
        <div className={styles.quickForm}>
          {createFields.map(f => (
            <input
              key={f.key}
              type={f.type || 'text'}
              placeholder={f.placeholder || f.label}
              value={fieldValues[f.key] || ''}
              onChange={e => setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleSubmit()
                }
              }}
              required={f.required}
              className={styles.quickInput}
            />
          ))}
          <div className={styles.quickActions}>
            <button type="button" className={styles.btnQuickCancel} onClick={() => setShowQuick(false)}>Cancelar</button>
            <button type="button" className={styles.btnQuickSave} disabled={saving} onClick={() => void handleSubmit()}>{saving ? '...' : 'Salvar'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
