'use client'
import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession, clearSession, setSession } from '@/lib/auth'
import { SURL, ANON } from '@/lib/constants'

const INACTIVITY_LIMIT_MS = 2 * 60 * 60 * 1000   // 2h sem atividade → desloga
const REFRESH_INTERVAL_MS = 5 * 60 * 1000          // pinga o servidor a cada 5 min se ativo
const ACTIVITY_DEBOUNCE_MS = 10 * 1000             // agrupa eventos num window de 10s

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']

export function useInactivityGuard() {
  const router          = useRouter()
  const lastActivityRef = useRef<number>(Date.now())
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doLogout = useCallback((reason = 'inatividade') => {
    console.info(`[InactivityGuard] Deslogando por ${reason}`)
    clearSession()
    router.replace('/login')
  }, [router])

  const refreshSession = useCallback(async () => {
    const s = getSession()
    if (!s?.session) return

    try {
      const res  = await fetch(`${SURL}/functions/v1/refresh-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
        body: JSON.stringify({ session_token: s.session }),
      })
      const data = await res.json()

      if (data.error) {
        // Servidor confirmou sessão expirada/inativa
        doLogout('sessão inválida no servidor')
        return
      }

      // Atualiza expires_at local com o novo valor do servidor
      if (data.expires_at) {
        setSession({ ...s, expires: data.expires_at })
      }
    } catch {
      // Falha de rede: não desloga para não prejudicar o usuário em conexão ruim
    }
  }, [doLogout])

  // Marca atividade (com debounce para não chamar todo evento de mouse)
  const onActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    if (debounceRef.current) return
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
    }, ACTIVITY_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    const s = getSession()
    if (!s?.session) return

    // Registra eventos de atividade
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }))

    // Timer principal: verifica inatividade E faz refresh periódico
    refreshTimerRef.current = setInterval(() => {
      const inactive = Date.now() - lastActivityRef.current

      // Se passou 2h sem atividade → desloga imediatamente no client
      if (inactive >= INACTIVITY_LIMIT_MS) {
        doLogout('2h de inatividade')
        return
      }

      // A cada 5 min, se houve atividade recente, pinga o servidor
      refreshSession()
    }, REFRESH_INTERVAL_MS)

    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, onActivity))
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [onActivity, refreshSession, doLogout])
}
