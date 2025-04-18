export {
  FormatSpec,
  DEFAULT_STRING_FORMATS,
  parse_string_format_spec,
}

import { ts_string } from './formatters/util'
import { isObject } from '@todo-3.0/lib/util'

type FormatSpec = {
  /** Function for returning a TypeScript fragment for parsing a
  string into the expected type. The parameter x will contain an
  expression evaluating to the string value.  */
  parse: (x: string) => string,

  /** Inverse of `parse`. Return a TypeScript fragment for turning the
  value into a string.

  If the given string isn't parsable to the expected format, an error
  MUST be thrown.
   */
  serialize: (x: string) => string,

  /** TypeScript type for this format */
  type: string,

  instanceof?: (x: string) => string,

  /*
  If any part (parser, type, ...) requires extra imports, add them
  here. Keys are module names, while values are the list of symbols to
  import.
   */
  imports?: { [module: string]: string[] },
}

const string: FormatSpec = {
  parse: x => x,
  serialize: x => x,
  type: 'string',
}

/**
Globaly available string formats. This should only include those
specified in the registry [1]. Futhermore, these should only be used
at the program entry point to get the actuall set of string formattrs,
which most likely will consist of these along with any user supplied
ones.

[1]: https://spec.openapis.org/registry/format/
 */
const DEFAULT_STRING_FORMATS = {

  'uri': {
    parse: (x) => `(new URL(${x}))`,
    serialize: (x) => `${x}.href`,
    type: 'URL',
  },

  'date-time': {
    parse: (x) => `(new Date(${x}))`,
    serialize: (x) => `${x}.toISOString()`,
    type: 'Date',
  },

  'http-date': {
    parse: (x) => `(new Date(${x}))`,
    serialize: (x) => `${x}.toUTCString()`,
    type: 'Date',
  },

  'uuid': string,
  'ipv4': string,
  'ipv6': string,
  'password': string,

} satisfies { [format: string]: FormatSpec }


function build_function(spec: { param: string, body: string }): (name: string) => string {
  return eval(`(${spec.param}) => ${ts_string(spec.body, '`')}`)
}

function isFunctionSpec(x: unknown): x is { param: string, body: string } {
  if (!isObject(x)) return false
  if (typeof x.param !== 'string') return false
  if (typeof x.body !== 'string') return false
  return true
}

function isImports(x: unknown): x is FormatSpec['imports'] {
  if (!isObject(x)) return false
  for (const [k, v] of Object.entries(x)) {
    if (typeof k !== 'string') return false
    if (!Array.isArray(v)) return false
    if (!v.every(vv => typeof vv === 'string')) return false
  }
  return true
}

/**
Parse a string format specification, as present in a configuration
file, and return a true format specification.
 */
function parse_string_format_spec(spec: unknown): FormatSpec {

  // Bare bones error handling. This is acceptable, because this
  // function should only be called after the data is already
  // validated through json schema. This just catches if something has
  // gone terribly wrong (probably due to the schema having been
  // updated).
  if (!isObject(spec)) throw new Error
  if (!isFunctionSpec(spec.parse)) throw new Error
  if (!isFunctionSpec(spec.serialize)) throw new Error
  if (typeof spec.type !== 'string') throw new Error
  if (!isImports(spec.imports)) throw new Error

  const result: FormatSpec = {
    parse: build_function(spec.parse),
    serialize: build_function(spec.serialize),
    type: spec.type,
    imports: spec.imports,
  }

  if ('instanceof' in spec) {
    if (!isFunctionSpec(spec.instanceof)) throw new Error
    result.instanceof = build_function(spec.instanceof)
  }

  return result
}
