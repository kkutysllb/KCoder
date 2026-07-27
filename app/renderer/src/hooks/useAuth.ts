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

  // Verify stored token on startup
  useEffect(() => {
    const stored = loadStoredAuth()
    const api = getEngineAPI(urlPort)

    if (!stored) {
      setChecking(false)
      return
    }

    api.setAuthToken(stored.token)
    api.authMe()
      .then((me) => {
        setUser(me)
        // The user id drives per-user model profile storage, so keep it in
        // sync with the API instance whenever the authenticated user changes.
        api.setUserId(me.id)
        persistAuth({ token: stored.token, user: me })
      })
      .catch(() => {
        // Token expired or revoked — fall back to runtime token
        api.setAuthToken(null)
        api.setUserId(null)
        persistAuth(null)
        setUser(null)
      })
      .finally(() => setChecking(false))
  }, [urlPort])

  const applySession = useCallback((token: string, sessionUser: AuthUser) => {
    const api = getEngineAPI(enginePort)
    api.setAuthToken(token)
    api.setUserId(sessionUser.id)
    persistAuth({ token, user: sessionUser })
    setUser(sessionUser)
  }, [enginePort])

  const login = useCallback(async (email: string, password: string) => {
    const api = getEngineAPI(enginePort)
    const session = await api.authLogin(email, password)
    applySession(session.access_token, session.user)
  }, [enginePort, applySession])

  const register = useCallback(async (email: string, password: string) => {
    const api = getEngineAPI(enginePort)
    const session = await api.authRegister(email, password)
    applySession(session.access_token, session.user)
  }, [enginePort, applySession])

  const initialize = useCallback(async (email: string, password: string) => {
    const api = getEngineAPI(enginePort)
    const session = await api.authInitialize(email, password)
    applySession(session.access_token, session.user)
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
