/**
 * Resolve a relative path against a provider `serviceURL`, keeping any path the
 * `serviceURL` already has.
 *
 * `new URL('piece/x', 'https://sp.example/curio')` drops the `/curio` segment
 * because the base has no trailing slash. This helper appends the slash first.
 *
 * @internal
 * @param path - Relative path (no leading slash), may include a query string.
 * @param serviceURL - Provider service URL, with or without a trailing slash.
 * @returns The resolved URL.
 */
export function serviceURLJoin(path: string, serviceURL: string | URL): URL {
  const base = serviceURL.toString()
  return new URL(path, base.endsWith('/') ? base : `${base}/`)
}
