export {
  format_type_validator,
  validator_function_name,
  change_refs,
  SchemaLike,
}

import type {
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
  Schema
} from '../openapi'
import { CodeFragment, cf } from '../code-fragment'
import { to_ts_identifier } from '../ts-identifier'
import { typename } from './schema'

function validator_function_name(typename: string): string {
  return to_ts_identifier(`validators.validate_${typename}`)
}

function format_type_validator(
  data: {
    type_ns: string,
    validator: string,
  },
  name: string,
  schema: Schema,
  document: OpenAPISpec,
): CodeFragment[] {
  // TODO take `validators` as argument
  return [cf`
  export function ${validator_function_name(name).split('.')[1]}(
    x: unknown
  ): x is ${data.type_ns}.${typename(name, schema)} {
  return validators.validate_type(x, ${JSON.stringify(change_refs(schema as SchemaLike))})
  }
`]
}


/** This type is identical to a properly impremented JSON type.
Therefore, it should probably be replaced by one */
type SchemaLike = number | string | null | boolean | SchemaLike[] | { [key: string]: SchemaLike }

/**
Rewrite all references in document.

Currently, simply removes the first character of each '$ref' value, to
remove the leading octophorpe. This is to allow the imported
jsonschema validator to resolve the reference of manually added
sub-trees. Probably, '#' is hard coded as *this* object, which doesn't
hold when we split the document into multiple fragments.
 */
function change_refs(o: SchemaLike): SchemaLike {
  if (!(typeof o === 'object' && o !== null)) return o

  if (Array.isArray(o)) {
    return o.map(change_refs)
  } else {
    return Object.fromEntries(
      Object.entries(o).map(([key, value]) => {
        if (key === '$ref') {
          /* c8 ignore next 3 */
          if (typeof value !== 'string') {
            throw new Error(`Non-string found in $ref field: ${JSON.stringify(value)}`)
          }
          return [key, value.substring(1)]
        } else {
          return [key, change_refs(value)]
        }
      }))
  }
}
