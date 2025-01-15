export {
  format_schema,
  typename,
}

import type {
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
  Schema,
} from '../openapi'

import { schema_to_typescript } from '../json-schema'
import { to_ts_identifier } from '../ts-identifier'
import { CodeFragment, cf } from '../code-fragment'
import type { FormatSpec } from '../json-schema-formats'

function typename(name: string, schema: Schema): string {
  return to_ts_identifier('title' in schema ? schema.title! : name)
}

function format_schema(
  name: string,
  schema: Schema,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] {
  return [
    cf`export type ${typename(name, schema)} = `,
    ...schema_to_typescript(
      schema, '', string_formats, document),
    cf`;`
  ]
}
