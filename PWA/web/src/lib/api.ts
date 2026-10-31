export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Fired when the server asks for the password again. */
export const authEvents = new EventTarget()

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const headers = new Headers(rest.headers)
  if (json !== undefined) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(path, {
      ...rest,
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'Server non raggiungibile: controlla la connessione')
  }
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') authEvents.dispatchEvent(new Event('logout'))
    const message = (body as { error?: string } | null)?.error ?? `Errore ${response.status}`
    throw new ApiError(response.status, message)
  }
  return body as T
}
