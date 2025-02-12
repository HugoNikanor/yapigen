export { validate_and_parse_body }

import {
  validator_function_name,
  change_refs,
  SchemaLike,
} from './validator'
import { schema_to_parser } from '../json-schema'
import type {
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
  Reference,
  Schema,
} from '../openapi'
import { FormatSpec } from '../json-schema-formats'
import { cf, CodeFragment } from '../code-fragment'
import { resolve } from '../json-pointer'

/**
Return a TypeScript fragment (as a string) consisting of a single expression, which
- validates a json object against a schema, and throws InvalidData on failure.
- evaluates to a parsed version of the body, with specific fields
  (like date-time fields) expanded into their internal
  representations.

It will look something like this:
```
(() => {
    // validate
    return schema_to_parser
})()
```

@param args.schema

@param args.body_var
TypeScript expression evaluating to the body. The expression *will* be
evaluated multiple times.

@param args.string_formats
@param args.document

 */
function validate_and_parse_body(args: {
  schema: Schema | Reference,
  body_var: string,
  gensym: (hint?: string) => string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): CodeFragment[] {

  let validator

  if ('$ref' in args.schema) {
    // console.warn(args.media.schema)
    const typename = (args.schema as Reference).$ref.split('/').at(-1)!

    validator = cf`${validator_function_name(typename)}(${args.body_var});\n`

  } else {
    const schema = resolve(args.schema, args.document)
    // TODO get `validators` module symbol from somewhere
    validator = cf`validators.validate_type(${args.body_var}, ${JSON.stringify(
      change_refs(schema as SchemaLike),
      (k, v) => {
        if ([
          /* Not handled by the validator */
          'discriminator',
          /* Documentation tags are bloat here */
          'description',
          'example',
          'summary'
        ].includes(k)) { return }
        else { return v }
      },
    )});\n`
  }

  const validated_body_var = args.gensym('validated_body')

  const parser = schema_to_parser(
    args.schema,
    args.document,
    args.string_formats,
    validated_body_var)

  return [
    cf`(() => {`,
    validator, cf`;\n`,
    cf`const ${validated_body_var} = ${args.body_var} as any;
    return `, ...parser, cf`;})()`]
}
