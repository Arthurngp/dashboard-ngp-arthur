// ── debounce ──────────────────────────────────────────────────────────────────
// Retorna uma versão da função que só executa após `ms` ms sem ser chamada.
// Expõe `.cancel()` para cancelar o timer pendente.
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; fn(...args) }, ms)
  }
  debounced.cancel = () => { if (timer) { clearTimeout(timer); timer = null } }
  return debounced
}

// ── withInflightGuard ─────────────────────────────────────────────────────────
// Envolve uma função async para que apenas uma execução rode por vez.
// Chamadas enquanto já há uma em andamento são ignoradas (retornam undefined).
export function withInflightGuard<T>(fn: () => Promise<T>): () => Promise<T | undefined> {
  let inflight = false
  return async () => {
    if (inflight) return undefined
    inflight = true
    try {
      return await fn()
    } finally {
      inflight = false
    }
  }
}

// ── withAbort ─────────────────────────────────────────────────────────────────
// Retorna uma função que cancela a chamada anterior antes de iniciar uma nova.
// O `fn` recebe um AbortSignal e deve passá-lo ao fetch.
export function withAbort<T>(fn: (signal: AbortSignal) => Promise<T>) {
  let controller: AbortController | null = null
  return () => {
    controller?.abort()
    controller = new AbortController()
    return fn(controller.signal)
  }
}

// ── fetchWithRetry ────────────────────────────────────────────────────────────
// Tenta `maxAttempts` vezes com backoff exponencial entre falhas.
// Não faz retry em erros de autenticação (401/403) ou cancelamento (AbortError).
export async function fetchWithRetry(
  input: RequestInfo,
  init?: RequestInit,
  maxAttempts = 3,
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(input, init)
      if (res.status === 401 || res.status === 403) return res // não retenta auth
      if (res.ok || attempt === maxAttempts - 1) return res
      lastError = new Error(`HTTP ${res.status}`)
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e // não retenta cancelamentos
      lastError = e
      if (attempt === maxAttempts - 1) throw e
    }
    await new Promise(r => setTimeout(r, 200 * 2 ** attempt)) // 200ms, 400ms, 800ms
  }
  throw lastError
}
