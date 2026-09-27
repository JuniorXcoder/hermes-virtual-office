/**
 * Reading an API response without blowing up on a non-JSON body.
 *
 * Every panel used to do `const d = await r.json()` straight. That throws
 * `Unexpected end of JSON input` (or `Unexpected token '<'`) whenever the reply is
 * not JSON — a 502 from a proxy, an HTML error page, a connection cut mid-body.
 * The thrown message describes the JSON parser, not the problem, and the real
 * status is lost: the user saw "Failed to execute 'json' on 'Response'" with no
 * hint that the backend was down.
 *
 * `readJson` always returns something, and folds the HTTP status into the error so
 * the panel can say what actually happened.
 */

export type ApiResult<T> = {
  ok: boolean
  status: number
  /** Parsed body, or null when the reply was not JSON. */
  data: T | null
  /** A message safe to show the user. */
  error: string | null
}

/**
 * Read a response as JSON, tolerating a body that is not JSON.
 *
 * Never throws. `error` is the server's own `error.message` when the body carries
 * one, otherwise a line naming the HTTP status, so a 502 reads as "backend 502"
 * rather than as a JSON parse failure.
 */
export async function readJson<T = unknown>(r: Response): Promise<ApiResult<T>> {
  const status = r.status
  let text = ''
  try {
    text = await r.text()
  } catch {
    return {
      ok: false,
      status,
      data: null,
      error: `tidak bisa membaca balasan server (HTTP ${status})`,
    }
  }

  // Empty body: a 204, or a proxy that stripped it. Not an error if the status was
  // a success — callers that expect a body check `data` themselves.
  if (!text.trim()) {
    return {
      ok: r.ok,
      status,
      data: null,
      error: r.ok ? null : `server membalas kosong (HTTP ${status})`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Not JSON. This is the case that used to throw. Say what we got instead.
    const looksHtml = /^\s*</.test(text)
    return {
      ok: false,
      status,
      data: null,
      error: looksHtml
        ? `server membalas halaman HTML, bukan JSON (HTTP ${status}) — biasanya proxy atau backend mati`
        : `balasan server bukan JSON (HTTP ${status})`,
    }
  }

  // Our routes wrap failures as { error: { message } }; surface that message.
  const asObj = parsed as { error?: { message?: string } } | null
  const serverMsg =
    asObj && typeof asObj === 'object' && asObj.error && typeof asObj.error.message === 'string'
      ? asObj.error.message
      : null

  return {
    ok: r.ok,
    status,
    data: parsed as T,
    error: r.ok ? null : serverMsg || `permintaan gagal (HTTP ${status})`,
  }
}

/**
 * Fetch and read in one step. Throws only when the reply failed, with a message
 * that names the real cause.
 */
export async function fetchJson<T = unknown>(
  input: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const r = await fetch(input, init)
    return await readJson<T>(r)
  } catch (e) {
    // Network-level failure: the request never got a reply.
    return {
      ok: false,
      status: 0,
      data: null,
      error: `tidak bisa menghubungi server: ${(e as Error).message}`,
    }
  }
}
