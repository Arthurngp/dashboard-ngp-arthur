import { Session } from '@/types'

// Chaves compatíveis com os HTML pages em /public
const KEYS = {
  auth:        'adsboard_auth',
  session:     'adsboard_session',
  user:        'adsboard_user',
  role:        'adsboard_role',
  username:    'adsboard_username',
  expires:     'adsboard_expires',
  metaAccount: 'adsboard_meta_account',
  foto:        'adsboard_foto',
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null
  try {
    const auth    = sessionStorage.getItem(KEYS.auth)
    const session = sessionStorage.getItem(KEYS.session)
    if (!auth || !session) return null

    const expires = sessionStorage.getItem(KEYS.expires) || ''
    if (expires && new Date(expires) < new Date()) {
      clearSession()
      return null
    }

    return {
      auth,
      session,
      user:        sessionStorage.getItem(KEYS.user)        || '',
      role:       (sessionStorage.getItem(KEYS.role)        || 'cliente') as 'admin' | 'ngp' | 'cliente',
      username:    sessionStorage.getItem(KEYS.username)    || '',
      expires,
      metaAccount: sessionStorage.getItem(KEYS.metaAccount) || undefined,
      foto:        sessionStorage.getItem(KEYS.foto)        || undefined,
    }
  } catch {
    return null
  }
}

export function setSession(data: Session) {
  sessionStorage.setItem(KEYS.auth,     data.auth)
  sessionStorage.setItem(KEYS.session,  data.session)
  sessionStorage.setItem(KEYS.user,     data.user)
  sessionStorage.setItem(KEYS.role,     data.role)
  sessionStorage.setItem(KEYS.username, data.username)
  sessionStorage.setItem(KEYS.expires,  data.expires)
  if (data.metaAccount) sessionStorage.setItem(KEYS.metaAccount, data.metaAccount)
  if (data.foto)        sessionStorage.setItem(KEYS.foto, data.foto)
}

export function clearSession() {
  Object.values(KEYS).forEach(k => sessionStorage.removeItem(k))
  sessionStorage.removeItem('ngp_viewing_account')
  sessionStorage.removeItem('ngp_viewing_name')
  sessionStorage.removeItem('ngp_viewing_username')
  sessionStorage.removeItem('ngp_viewing_id')
}

export function isAuthenticated(): boolean {
  return getSession()?.auth === '1'
}
