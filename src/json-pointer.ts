export { resolve }

import type {
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
  Reference,
} from './openapi.ts'

import type { Json } from '@todo-3.0/lib/json'
import { isObject } from '@todo-3.0/lib/util'

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
  doc: Json[] | { [key: string]: Json },
  pointer: string,
): Json {
  const components = pointer.split('/')

  if (components.length === 0) {
    throw new Error('Empty path')
  }

  if (components[0] !== '#') {
    throw new Error("Can't resolve references in other documents.")
  }


  let object: Json | undefined = doc
  for (const component_ of components.slice(1)) {

    const component = json_path_unescape(component_)

    const idx = Number(component)
    if (isNaN(idx)) {
      if (!isObject(object)) {
        throw new Error(`Attempted to get attribute of non-object: ${JSON.stringify(object)}, ${component}`)
      }

      object = (object as { [key: string]: Json })[component]
    } else {
      if (!Array.isArray(object)) {
        throw new Error(`Attempted to index a non-array: ${JSON.stringify(object)}, ${idx}`)
      }
      object = object[idx]
    }

    if (object === undefined) {
      throw new Error(`Failed finding object at "${pointer}".`)
    }
  }

  return object
}

function resolve<T extends object>(
  object: T | Reference,
  document: OpenAPISpec,
): T {
  if ('$ref' in object) {
    const result = resolveReference(
      document as { [key: string]: Json },
      object['$ref'])
    if (!isObject(result)) {
      throw new Error(`"${object['$ref']}" didn't resolve to an object: ${JSON.stringify(result)}`)
    }
    return result as T
  }

  return object
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

