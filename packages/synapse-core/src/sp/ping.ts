import { request } from 'iso-web/http'

/**
 * Ping the PDP API.
 *
 * GET /pdp/ping
 *
 * @param serviceURL - The service URL of the PDP API.
 * @returns void
 * @throws Errors {@link Error}
 */
export async function ping(serviceURL: string) {
  const response = await request.get(new URL(`pdp/ping`, serviceURL))
  if (response.error) {
    throw new Error('Ping failed')
  }
  return response.result
}
