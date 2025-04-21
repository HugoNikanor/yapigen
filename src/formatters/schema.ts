export {
  format_schema,
  typename,
}

import type {
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
  Schema,
} from '../openapi.ts'

import { schema_to_typescript } from '../json-schema.ts'
import { to_ts_identifier } from '../ts-identifier.ts'
import { CodeFragment, cf } from '../code-fragment.ts'
import type { FormatSpec } from '../json-schema-formats.ts'

function typename(name: string, schema: Schema): string {
  return to_ts_identifier(schema.title ?? name)
}

function format_schema(
  name: string,
  schema: Schema,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] {
  return [
    cf`export type ${typename(name, schema)} = `,
    ...schema_to_typescript({
      schema, types_symbol: false, string_formats, document
    }),
    cf`;`
  ]
}
