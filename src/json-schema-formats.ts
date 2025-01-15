export {
  FormatSpec,
  DEFAULT_STRING_FORMATS,
  parse_string_format_spec,
}

import { ts_string } from './formatters/util'

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

/**
Parse a string format specification, as present in a configuration
file, and return a true format specification.
 */
function parse_string_format_spec(spec: any): FormatSpec {
  const result: FormatSpec = {
    parse: build_function(spec.parse),
    serialize: build_function(spec.serialize),
    type: spec.type,
    imports: spec.imports,
  }

  if ('instanceof' in spec) {
    result.instanceof = build_function(spec.instanceof)
  }

  return result
}
