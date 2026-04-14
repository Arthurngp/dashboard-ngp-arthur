'use client'
import { useState, useRef, useEffect } from 'react'
import { getSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import styles from './ProfileModal.module.css'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function ProfileModal({ isOpen, onClose }: Props) {
  const [sess, setSess] = useState<ReturnType<typeof getSession>>(null)
  const [nome, setNome]         = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole]         = useState('')
  const [fotoUrl, setFotoUrl]   = useState('')
  const [avatarSrc, setAvatarSrc] = useState('')

  const [senhaAtual, setSenhaAtual] = useState('')
  const [senhaNova, setSenhaNova]   = useState('')
  const [senhaConf, setSenhaConf]   = useState('')

  const [msgFoto, setMsgFoto]   = useState<{text:string;ok:boolean}|null>(null)
  const [msgNome, setMsgNome]   = useState<{text:string;ok:boolean}|null>(null)
  const [msgSenha, setMsgSenha] = useState<{text:string;ok:boolean}|null>(null)
  const [progress, setProgress] = useState<number|null>(null)

  const [loadingNome, setLoadingNome]   = useState(false)
  const [loadingSenha, setLoadingSenha] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      const s = getSession()
      if (s) {
        setSess(s)
        setNome(s.user || '')
        setUsername(s.username || '')
        setRole(s.role || '')
        setFotoUrl(s.foto || '')
        if (s.foto) setAvatarSrc(s.foto)
      }
    } else {
        // Reset state on close
        setSenhaAtual('')
        setSenhaNova('')
        setSenhaConf('')
        setMsgFoto(null)
        setMsgNome(null)
        setMsgSenha(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  function showMsg(setter: React.Dispatch<React.SetStateAction<{text:string;ok:boolean}|null>>, text: string, ok: boolean) {
    setter({ text, ok })
    setTimeout(() => setter(null), 5000)
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !sess) return

    if (!file.type.startsWith('image/')) {
      showMsg(setMsgFoto, 'Selecione uma imagem válida (PNG, JPG ou WebP).', false); return
    }
    if (file.size > 2 * 1024 * 1024) {
      showMsg(setMsgFoto, 'A imagem deve ter no máximo 2MB.', false); return
    }

    // Preview
    const reader = new FileReader()
    reader.onload = ev => setAvatarSrc(ev.target?.result as string)
    reader.readAsDataURL(file)

    setProgress(30)
    try {
      const ext  = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = username + '.' + ext

      const upRes = await fetch(`${SURL}/storage/v1/object/avatars/${path}`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file,
      })
      setProgress(70)
      if (!upRes.ok) throw new Error('upload')

      const publicUrl = `${SURL}/storage/v1/object/public/avatars/${path}`

      const saveRes = await fetch(`${SURL}/functions/v1/update-profile`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ foto_url: publicUrl }),
      })
      setProgress(100)
      const saveData = await saveRes.json()
      if (!saveRes.ok) throw new Error(saveData.error || 'save')

      sessionStorage.setItem('adsboard_foto', publicUrl)
      setFotoUrl(publicUrl)
      showMsg(setMsgFoto, '✓ Foto atualizada com sucesso!', true)
    } catch {
      showMsg(setMsgFoto, 'Erro ao salvar foto. Tente novamente.', false)
    } finally {
      setTimeout(() => setProgress(null), 800)
    }
  }

  async function saveNome() {
    const novoNome = nome.trim()
    if (!novoNome || novoNome.length < 2) {
      showMsg(setMsgNome, 'Digite um nome com ao menos 2 caracteres.', false); return
    }
    if (!sess) return
    setLoadingNome(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/update-profile`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ nome: novoNome }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')
      sessionStorage.setItem('adsboard_user', novoNome)
      showMsg(setMsgNome, '✓ Nome atualizado com sucesso!', true)
    } catch {
      showMsg(setMsgNome, 'Erro ao salvar. Tente novamente.', false)
    } finally {
      setLoadingNome(false)
    }
  }

  async function saveSenha() {
    if (!senhaAtual)          { showMsg(setMsgSenha, 'Digite sua senha atual.', false); return }
    if (senhaNova.length < 6) { showMsg(setMsgSenha, 'A nova senha deve ter ao menos 6 caracteres.', false); return }
    if (senhaNova !== senhaConf) { showMsg(setMsgSenha, 'As senhas não coincidem.', false); return }
    if (!sess) return
    setLoadingSenha(true)
    try {
      const res = await fetch(`${SURL}/functions/v1/update-profile`, {
        method: 'POST',
        headers: efHeaders(),
        body: JSON.stringify({ senha_atual: senhaAtual, senha_nova: senhaNova }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')
      setSenhaAtual(''); setSenhaNova(''); setSenhaConf('')
      showMsg(setMsgSenha, '✓ Senha alterada com sucesso!', true)
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message === 'Senha atual incorreta'
        ? 'Senha atual incorreta.' : 'Erro ao alterar senha. Tente novamente.'
      showMsg(setMsgSenha, msg, false)
    } finally {
      setLoadingSenha(false)
    }
  }

  const initials = nome ? nome.slice(0, 2).toUpperCase() : '?'

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={e => e.stopPropagation()}>
        <div className={styles.topBar}>
          <span className={styles.topTitle}>Meu Perfil</span>
          <button className={styles.btnClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.page}>
          {/* Foto & Info */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Informações da conta</div>
            <div className={styles.avatarRow}>
              <div className={styles.avatarWrap}>
                <div className={styles.avatarCircle} onClick={() => fileRef.current?.click()}>
                  {avatarSrc
                    ? <img src={avatarSrc} alt="avatar" />
                    : <span>{initials}</span>}
                  <div className={styles.avatarOverlay}>📷</div>
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleFileSelect} />
              </div>
              <div className={styles.avatarInfo}>
                <div className={styles.uname}>{nome || '—'}</div>
                <div className={styles.uslug}>@{username || '—'}</div>
                <span className={`${styles.roleBadge} ${role === 'admin' || role === 'ngp' ? styles.roleNgp : styles.roleCliente}`}>
                  {role === 'admin' || role === 'ngp' ? '⚙ NGP Admin' : '👤 Cliente'}
                </span>
                <button className={styles.btnUpload} onClick={() => fileRef.current?.click()}>📷 Alterar foto</button>
              </div>
            </div>
            {progress !== null && (
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
            )}
            {msgFoto && <div className={`${styles.msg} ${msgFoto.ok ? styles.ok : styles.err}`}>{msgFoto.text}</div>}
          </div>

          {/* Alterar nome */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Alterar nome</div>
            <div className={styles.formGroup}>
              <label>Nome de exibição</label>
              <input type="text" placeholder="Seu nome completo" maxLength={60} value={nome} onChange={e => setNome(e.target.value)} autoComplete="off" />
            </div>
            <button className={styles.btnSave} onClick={saveNome} disabled={loadingNome}>
              {loadingNome ? 'Salvando...' : 'Salvar nome'}
            </button>
            {msgNome && <div className={`${styles.msg} ${msgNome.ok ? styles.ok : styles.err}`}>{msgNome.text}</div>}
          </div>

          {/* Alterar senha */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Alterar senha</div>
            <div className={styles.formGroup}>
              <label>Senha atual</label>
              <input type="password" placeholder="••••••••" value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} autoComplete="current-password" />
            </div>
            <div className={styles.formGroup}>
              <label>Nova senha</label>
              <input type="password" placeholder="Mínimo 6 caracteres" value={senhaNova} onChange={e => setSenhaNova(e.target.value)} autoComplete="new-password" />
            </div>
            <div className={styles.formGroup}>
              <label>Confirmar nova senha</label>
              <input type="password" placeholder="Repita a nova senha" value={senhaConf} onChange={e => setSenhaConf(e.target.value)} autoComplete="new-password" />
            </div>
            <button className={styles.btnSave} onClick={saveSenha} disabled={loadingSenha}>
              {loadingSenha ? 'Alterando...' : 'Alterar senha'}
            </button>
            {msgSenha && <div className={`${styles.msg} ${msgSenha.ok ? styles.ok : styles.err}`}>{msgSenha.text}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
