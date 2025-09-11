import { HttpResponse, http } from 'msw'

export function PING() {
  return http.get<Record<string, any>, HttpResponse<any>>('*/ping', async () => {
    return HttpResponse.json({ status: 200, statusText: 'OK' })
  })
}
