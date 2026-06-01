'use client'
import React, { useState } from 'react'
import { Cliente } from '@/types'
import ImageCropper from '@/components/ImageCropper'
import { fmt } from '@/lib/utils'

interface AccountModalProps {
  data: Partial<Cliente>
  loading: boolean
  error: string
  userRole?: 'admin' | 'ngp' | 'cliente'
  onSave: (d: Partial<Cliente> & { foto_base64?: string; foto_mime?: string }) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export default function AccountModal({ data, loading, error, userRole, onSave, onArchive, onDelete, onClose }: AccountModalProps) {
  const [form, setForm] = useState<Partial<Cliente>>(data)
  const [senha, setSenha] = useState('')
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDeleteStep, setConfirmDeleteStep] = useState<0 | 1 | 2>(0)
  const [fotoPreview, setFotoPreview] = useState<string>(data.foto_url || '')
  const [fotoBase64, setFotoBase64] = useState<string>('')
  const [fotoMime, setFotoMime] = useState<string>('')
  const [cropSrc, setCropSrc] = useState<string>('')
  
  const isEdit = !!data.id
  const canDelete = userRole === 'admin'
  const canArchive = isEdit && (userRole === 'admin' || userRole === 'ngp')
  const up = (k: keyof Cliente, v: string) => setForm(p => ({ ...p, [k]: v }))

  function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { alert('Foto muito grande. Máximo 10MB.'); return }
    const reader = new FileReader()
    reader.onload = ev => { setCropSrc(ev.target?.result as string) }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function handleCropConfirm(b64: string, mime: string) {
    setFotoBase64(b64)
    setFotoMime(mime)
    setFotoPreview(`data:${mime};base64,${b64}`)
    setCropSrc('')
  }

  function handleSave() {
    onSave({
      ...form,
      ...(fotoBase64 ? { foto_base64: fotoBase64, foto_mime: fotoMime } : {}),
      ...(!isEdit && senha ? { senha } : {}),
    })
  }

  if (cropSrc) {
    return <ImageCropper src={cropSrc} onConfirm={handleCropConfirm} onCancel={() => setCropSrc('')} />
  }

  const initials = (form.nome || '?').slice(0, 2).toUpperCase()

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{isEdit ? 'Editar conta' : 'Nova conta'}</div>
          {isEdit && !confirmArchive && confirmDeleteStep === 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              {canArchive && (
                <button onClick={() => setConfirmArchive(true)} style={{ background: 'none', border: '1px solid #E5E5EA', borderRadius: 7, padding: '4px 10px', fontSize: 12, color: '#6E6E73', cursor: 'pointer', fontWeight: 600 }}>Arquivar</button>
              )}
              {canDelete && (
                <button onClick={() => setConfirmDeleteStep(1)} style={{ background: 'none', border: '1px solid #FEE2E2', borderRadius: 7, padding: '4px 10px', fontSize: 12, color: '#DC2626', cursor: 'pointer', fontWeight: 600 }}>Excluir</button>
              )}
            </div>
          )}
        </div>

        {confirmArchive ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <p style={{ fontSize: 13, marginBottom: 16 }}>Deseja arquivar esta conta? Ela não aparecerá mais no dashboard, mas os dados serão mantidos.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setConfirmArchive(false)} style={{ background: '#F5F5F7', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => onArchive(data.id!)} style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Sim, arquivar</button>
            </div>
          </div>
        ) : confirmDeleteStep === 1 ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <p style={{ fontSize: 13, color: '#DC2626', fontWeight: 700, marginBottom: 8 }}>⚠️ ATENÇÃO: AÇÃO IRREVERSÍVEL</p>
            <p style={{ fontSize: 13, marginBottom: 16 }}>A exclusão apagará todos os dados, relatórios e histórico deste cliente para sempre.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setConfirmDeleteStep(0)} style={{ background: '#F5F5F7', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => setConfirmDeleteStep(2)} style={{ background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Prosseguir</button>
            </div>
          </div>
        ) : confirmDeleteStep === 2 ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <p style={{ fontSize: 13, fontWeight: 800, marginBottom: 16 }}>Tem certeza absoluta? Todos os dados serão perdidos.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setConfirmDeleteStep(0)} style={{ background: '#F5F5F7', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => onDelete(data.id!)} style={{ background: '#000', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Confirmar Exclusão</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
              <div style={{ position: 'relative', width: 80, height: 80, borderRadius: 20, background: '#F5F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {fotoPreview ? (
                  <img src={fotoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 24, fontWeight: 800, color: '#AEAEB2' }}>{initials}</span>
                )}
                <label style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', opacity: 0, transition: 'opacity 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', fontSize: 10, fontWeight: 800 }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>
                  Alterar
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFotoChange} />
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6E6E73' }}>Nome do Cliente</label>
              <input value={form.nome || ''} onChange={e => up('nome', e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid #F2F2F7', background: '#F5F5F7', fontSize: 13, fontWeight: 600 }} placeholder="Ex: Rodrigo NGP" />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6E6E73' }}>Username (Login)</label>
              <input value={form.username || ''} onChange={e => up('username', e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid #F2F2F7', background: '#F5F5F7', fontSize: 13, fontWeight: 600 }} placeholder="rodrigo_ngp" />
            </div>

            {!isEdit && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6E6E73' }}>Senha inicial</label>
                <input type="password" value={senha} onChange={e => setSenha(e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid #F2F2F7', background: '#F5F5F7', fontSize: 13, fontWeight: 600 }} placeholder="••••••••" />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6E6E73' }}>Conta Meta Ads (act_XXX)</label>
              <input value={form.meta_account_id || ''} onChange={e => up('meta_account_id', e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid #F2F2F7', background: '#F5F5F7', fontSize: 13, fontWeight: 600 }} placeholder="act_1234567890" />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6E6E73' }}>Google Ads Customer ID</label>
              <input value={form.google_ads_customer_id || ''} onChange={e => up('google_ads_customer_id', e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid #F2F2F7', background: '#F5F5F7', fontSize: 13, fontWeight: 600 }} placeholder="123-456-7890" />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#6E6E73' }}>Investimento Autorizado (R$)</label>
              <input value={form.investimento_autorizado_mensal || ''} onChange={e => up('investimento_autorizado_mensal', e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1.5px solid #F2F2F7', background: '#F5F5F7', fontSize: 13, fontWeight: 600 }} placeholder="5000.00" />
            </div>

            {error && <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 600, textAlign: 'center' }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: '#F5F5F7', color: '#6E6E73', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={handleSave} disabled={loading} style={{ flex: 2, padding: '12px', borderRadius: 10, border: 'none', background: '#111', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {loading ? <div style={{ width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
