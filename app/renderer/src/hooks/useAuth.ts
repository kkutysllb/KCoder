import { useState, useCallback, useEffect, useMemo } from 'react'
import { getEngineAPI } from '../services/engine-api'
import type { AuthUser } from '../services/engine-api'

const AUTH_STORAGE_KEY = 'kcoder-auth'

interface StoredAuth {
  token: string
  user: AuthUser
}

export interface AuthState {
  user: AuthUser | null
  /** Verifying stored token on startup */
  checking: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  initialize: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

function loadStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAuth
    if (parsed.token && parsed.user) return parsed
    return null
  } catch {
    return null
  }
}

function persistAuth(auth: StoredAuth | null): void {
  if (auth) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  }
}

/**
 * Manages user authentication state against the engine's /v1/auth endpoints.
 * Token is persisted in localStorage and verified on startup.
 */
export function useAuth(enginePort: number): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [checking, setChecking] = useState(true)

  // Read the real port from URL params (available before store initialization)
  const urlPort = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return parseInt(params.get('enginePort') || String(enginePort), 10)
  }, [enginePort])

  // Verify session on startup（2026-08 重构：引擎 cookie 会话）
  useEffect(() => {
    const api = getEngineAPI(urlPort)

    // 未注册用户 → 401 → 登录页（landing）；引擎首次启动慢 → 网络错误重试；
    // 已登录（session cookie）→ authMe 返回真实用户 → 主界面。
    let attempts = 0
    let settled = false
    const tryAuth = (): void => {
      api.authMe()
        .then((me) => {
          settled = true
          setUser(me)
          // The user id drives per-user model profile storage, so keep it in
          // sync with the API instance whenever the authenticated user changes.
          api.setUserId(me.id)
          persistAuth({ token: '', user: me })
        })
        .catch((err: unknown) => {
          const status = (err as { status?: number }).status
          if (status === 401) {
            // 未认证（未登录/会话失效）→ 立即 landing 页，不重试
            settled = true
            api.setAuthToken(null)
            api.setUserId(null)
            persistAuth(null)
            setUser(null)
            return
          }
          if (attempts++ < 20) {
            // 网络错误/引擎未就绪：重试期间保持 checking（loading 屏）
            setTimeout(tryAuth, 500)
            return
          }
          settled = true
          api.setAuthToken(null)
          api.setUserId(null)
          persistAuth(null)
          setUser(null)
        })
        .finally(() => {
          if (settled) setChecking(false)
        })
    }
    tryAuth()
  }, [urlPort])

  // cookie 会话：登录/注册/初始化成功后 authMe 拿真实用户
  const applySession = useCallback(async (): Promise<void> => {
    const api = getEngineAPI(enginePort)
    console.log('[Auth] applySession: calling authMe')
    const me = await api.authMe()
    console.log('[Auth] applySession: authMe OK', me)
    api.setUserId(me.id)
    persistAuth({ token: '', user: me })
    setUser(me)
  }, [enginePort])

  const login = useCallback(async (email: string, password: string) => {
    const api = getEngineAPI(enginePort)
    console.log('[Auth] login: calling authLogin')
    await api.authLogin(email, password)
    console.log('[Auth] login: authLogin OK')
    await applySession()
  }, [enginePort, applySession])

  const register = useCallback(async (email: string, password: string) => {
    const api = getEngineAPI(enginePort)
    console.log('[Auth] register: calling authRegister')
    await api.authRegister(email, password)
    console.log('[Auth] register: authRegister OK')
    await applySession()
  }, [enginePort, applySession])

  const initialize = useCallback(async (email: string, password: string) => {
    const api = getEngineAPI(enginePort)
    console.log('[Auth] initialize: calling authInitialize')
    await api.authInitialize(email, password)
    console.log('[Auth] initialize: authInitialize OK')
    await applySession()
  }, [enginePort, applySession])

  const logout = useCallback(async () => {
    const api = getEngineAPI(enginePort)
    try {
      await api.authLogout()
    } catch {
      // Best-effort server-side revocation
    }
    api.setAuthToken(null)
    api.setUserId(null)
    persistAuth(null)
    setUser(null)
  }, [enginePort])

  return { user, checking, login, register, initialize, logout }
}
