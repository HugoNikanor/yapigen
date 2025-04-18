
/* Imports for request */
import { request, SaveRefreshCB, RefreshFunction } from '@todo-3.0/request'
import type { Account as BaseAccount } from '@todo-3.0/request/account'
/* TODO fix export so /index isn't needed */
import type { Authenticator } from '@todo-3.0/request/authenticator/index'
import type { Json } from '@todo-3.0/lib/json'

import { assertUnreachable } from '@todo-3.0/lib/unreachable'

import { url_concat } from '@todo-3.0/lib/url-concat'

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

const fetch_or_network_error
  : (...args: Parameters<typeof fetch>)
    => Promise<{ error: 'network' } | Awaited<ReturnType<typeof fetch>>>
  = async (...args) => {
    try {
      return await fetch(...args)
    } catch (e: unknown) {
      if (!(e instanceof Error)) throw e
      if (e.name !== 'TypeError') throw e
      return {
        error: 'network',
      }
    }
  }
