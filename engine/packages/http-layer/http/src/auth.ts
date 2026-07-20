export function bearerToken(headers: Headers): string | null {
  // Priority 1: Authorization: Bearer <token>
  const header = headers.get('authorization')
  if (header) {
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (match?.[1]) return match[1]
  }
  // Priority 2: Cookie: access_token=<token> (Web mode — browser cookies)
  return tokenFromCookie(headers, 'access_token')
}

/**
 * Extract a named token value from the Cookie header.
 *
 * The Web frontend relies on an HttpOnly ``access_token`` cookie set by
 * the gateway at login (see ``kworks-compat.ts``). SSR fetches forward
 * cookies via the ``Cookie`` header, and browser requests carry the
 * cookie automatically with ``credentials: "include"``.
 */
export function tokenFromCookie(headers: Headers, name: string): string | null {
  const cookieHeader = headers.get('cookie')
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq)
    const value = trimmed.slice(eq + 1)
    if (key === name && value) return decodeURIComponent(value)
  }
  return null
}

export function isAuthorized(headers: Headers, expectedToken: string, insecure = false): boolean {
  if (insecure) return true
  return expectedToken.length > 0 && bearerToken(headers) === expectedToken
}
