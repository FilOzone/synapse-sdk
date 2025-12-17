import { HttpResponse, http } from 'msw'

export interface PingMockOptions {
  baseUrl?: string
  debug?: boolean
}

export function PING(options: PingMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'https://pdp.example.com'

  return http.get<Record<string, any>, HttpResponse<any>>(`${baseUrl}/pdp/ping`, async () => {
    if (options.debug) {
      console.debug('PING handler called')
    }
    return new HttpResponse(null, { status: 200, statusText: 'OK' })
  })
}
