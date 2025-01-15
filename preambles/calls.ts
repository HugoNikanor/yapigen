
/* Imports for request */
import { request, SaveRefreshCB } from '@todo-3.0/frontend-common/request'
import type { Account } from '@todo-3.0/frontend-common/account'
import type { Authenticator } from '@todo-3.0/frontend-common/authenticator'

/**

@param header
The value returned by `response.headers.get('Content-Type')
 */
function parse_content_type(header: string | null): [string | undefined, Map<string, string>] {
  if (header === null) {
    return [undefined, new Map]
  }

  const [content_type, ...params_] = header.split(';').map(s => s.trim())
  const params = new Map(params_.map(p => {
    const idx = p.indexOf('=')
    if (idx === -1) return [p, '']
    return [p.substring(0, idx), p.substring(idx + 1)]
  }))

  return [content_type, params]

}

// copied from '@todo-3.0/lib/util'
function trimStart(s: string, padchars: string): string {
  const padset = new Set(padchars)
  const idx = s.split('').findIndex(c => !padset.has(c))
  return s.substring(idx)
}

// copied from '@todo-3.0/lib/util'
function trimEnd(s: string, padchars: string): string {
  const padset = new Set(padchars)
  // const idx = s.split('').findLastIndex(c => !padset.has(c))
  // return s.substring(0, idx + 1)

  const idx = s.length - s.split('').reverse().findIndex(c => !padset.has(c))
  return s.substring(0, idx)

}

// Copied from @todo-3.0/lib/url-concat
function url_concat(base: string, path: string): URL {
  path = trimStart(path, '/')
  base = trimEnd(base, '/')

  return new URL(path, base + '/')
}
