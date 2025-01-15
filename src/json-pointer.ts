export { resolve }

import type {
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
  Reference,
} from './openapi'

/**
Very basic json pointer library. Only supports absolute pointers, and
only those within the current document.

@module
 */

/**
Basic implementation of json pointer (RFC 6901), but also checks that
each string starts with '#'.
 */
function resolveReference(
  doc: OpenAPISpec,
  pointer: string,
): unknown {
  const components = pointer.split('/')

  if (components.length === 0) {
    throw new Error('Empty path')
  }

  if (components[0] !== '#') {
    throw new Error("Can't resolve references in other documents.")
  }


  let object = doc
  for (const component_ of components.slice(1)) {

    const component = json_path_unescape(component_)

    const idx = Number(component)
    if (isNaN(idx)) {
      object = object[component] as any
    } else {
      object = object[idx] as any
    }

    if (object === undefined) {
      throw new Error(`Failed finding object at "${pointer}".`)
    }
  }

  return object
}

function resolve<T extends Object>(
  object: T | Reference,
  document: OpenAPISpec,
): T {
  if ('$ref' in object) {
    return resolveReference(
      document,
      object['$ref'] as string) as T
  }

  return object as T
}


function json_path_unescape(s: string): string {
  let last = ''

  return s.split('').flatMap((c) => {
    if (last === '~') {
      if (c === '0') return '~'
      if (c === '1') return '/'
      else throw new Error(`Invalid escape found: ~${c} `)
    }
    last = c
    return c
  }).join('')
}

