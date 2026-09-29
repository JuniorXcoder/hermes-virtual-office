import { NextResponse } from 'next/server'

export function localOriginAllowed(hostHeader: string | null, originHeader: string | null): boolean {
  if (!hostHeader || !originHeader) return false

  try {
    const host = new URL(`http://${hostHeader}`)
    const origin = new URL(originHeader)
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
    return localHosts.has(host.hostname) && origin.protocol === 'http:' && origin.host === host.host
  } catch {
    return false
  }
}

export function assertLocalWriteRequest(req: Request): NextResponse | null {
  if (localOriginAllowed(req.headers.get('host'), req.headers.get('origin'))) return null
  return NextResponse.json(
    { error: { code: 'forbidden_origin', message: 'local same-origin request required' } },
    { status: 403 },
  )
}
