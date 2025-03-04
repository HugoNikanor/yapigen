export {
  return_type_name,
  ts_name_for_reference,
  schema_to_typescript,

  schema_to_serializer,
  schema_to_parser,
}

import type {
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
  Schema,
  Reference,
} from './openapi'

import { resolve } from './json-pointer'
import { object_to_type, ts_string } from './formatters/util'
import { to_ts_identifier } from './ts-identifier'
import { NotImplemented } from './not-implemented'

import type { FormatSpec } from './json-schema-formats'
import { assertUnreachable } from './unreachable'

import type { ObjectField } from './formatters/util'
import { CodeFragment, cf, join_fragments } from './code-fragment'


function return_type_name(
  schema: Reference | Schema,
  document: OpenAPISpec,
): string | null {
  const resolved_schema = resolve(schema, document)

  if ('title' in resolved_schema) {
    return resolved_schema.title!
  } else if ('$ref' in schema) {
    const $ref = schema['$ref'] as string
    return $ref.split('/').at(-1)!
  } else {
    return null
  }
}



/**
Find a name for a OpenAPI schema reference.

If the reference doesn't point to a schema object, then the result in
*undefined*.

If the resolved object contains a title attribute, then that is used,
otherwise, the final component of the reference is used.

@param ref
The object to acquire a TypeScript typename for.

@param document
 */
function ts_name_for_reference(
  ref: Reference,
  document: OpenAPISpec,
): string {
  const schema = resolve<Schema>(ref, document)
  const ret = 'title' in schema
    ? schema.title
    : ref.$ref.split('/').at(-1)!

  if (!ret) {
    throw new Error(`Failed finding a name for reference: ${JSON.stringify(ref)}`)
  }

  return to_ts_identifier(ret)
}


/**
Generates a typescript type from the OpenAPI schema object.

Note that this does *not* include the name

@example
```typescript
`type ${get_name(schema)} = ${schema_to_typescript(schema)}`
```

@param ns
Prefix to add to all type symbols. When declaring the symbols, this
should be ''. When using the symbols imported though a symbol, this
should be `${library_symbol}.`
 */
function schema_to_typescript(
  schema: Reference | Schema | boolean,
  ns: string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] {
  if (schema === true) return [cf`any`]
  if (schema === false) return [cf`never`]

  function inner(schema: Reference | Schema): CodeFragment[] {
    if (Object.keys(schema).length === 0) {
      return [cf`any`]
    }

    if ('$ref' in schema) {
      /* We assume that it's always a reference to a schema */
      return [cf`${ns}${ts_name_for_reference(schema as Reference, document)}`]
    } else if ('allOf' in schema) {
      return [cf`(`, ...join_fragments(cf` & `, schema.allOf!.map(inner)), cf`)`]
    } else if ('oneOf' in schema) {
      return [cf`(`, ...join_fragments(cf` | `, schema.oneOf!.map(inner)), cf`)`]
    } else if ('anyOf' in schema) {
      return [cf`(`, ...join_fragments(cf` | `, schema.anyOf!.map(inner)), cf`)`]
    } else if ('type' in schema) {
      switch (schema.type!) {
        case 'null':
          return [cf`null`]
        case 'boolean':
          return [cf`boolean`]
        case 'integer':
        case 'number':
          return [cf`number`]
        case 'string':
          if ('enum' in schema) {
            return [new CodeFragment(schema.enum!
              .map(x => JSON.stringify(x))
              .join(' | '))]
          } else if ('const' in schema) {
            return [new CodeFragment(JSON.stringify(schema.const!))]
          } else {
            if (schema.format === undefined) {
              return [cf`string`]
            } else {
              const spec = string_formats[schema.format]
              if (!spec) {
                throw new NotImplemented(`Strings with ${schema.format} format`)
              }
              return [new CodeFragment(spec.type,
                { location: { path: ['@string-format', 'magic'] } })]
            }
          }
        case 'array':
          {
            if ('items' in schema) {
              return [...inner(schema.items!), cf`[]`]
            } else {
              return [cf`any[]`]
            }
          }
        case 'object':
          {
            const required: string[] = schema.required ?? []
            const properties = schema.properties ?? {}

            // TODO pattern properties

            // We assume a global additionalProperties: false`. This
            // is incorrect according to the specification.
            // https://json-schema.org/draft/2020-12/json-schema-core#additionalProperties

            const generated_properties: ObjectField[] =
              Object.entries(properties)
                .map(([name, declaration]) => ({
                  name: name,
                  type: inner(declaration),
                  optional: !required.includes(name)
                }))

            if ('additionalProperties' in schema) {
              if (schema.additionalProperties! === true) {
                generated_properties.push({
                  name: '[additional: string]',
                  type: [cf`any`],
                  optional: false,
                  raw: true,
                })
              } else if (schema.additionalProperties! === false) {
                /* no-op */
              } else {
                const additional = resolve(
                  schema.additionalProperties as Schema | Reference,
                  document)
                generated_properties.push({
                  name: '[additional: string]',
                  type: schema_to_typescript(additional, ns, string_formats, document),
                  optional: false,
                  raw: true,
                })
              }
            }

            return object_to_type(generated_properties)
          }
        default:
          throw new Error(`Unhandled type: ${JSON.stringify(schema)}`)
      }

    } else {
      throw new Error(`Unhandled schema form: ${JSON.stringify(schema)}`)
    }
  }

  return inner(schema)

}


/**
Given a number of object schemas, attempt to merge them into one big schema.

This is useful when an `allOf` directive is encountered. All "parts"
are passed to this, giving the "true" object at that position.
 */
function merge_schemas(schemas: (Schema & { type: 'object' })[]): Schema {
  const properties: Record<string, Reference | Schema> = {}
  const required = new Set<string>

  for (const subschema of schemas) {
    if ('properties' in subschema) {
      for (const [name, spec] of Object.entries(subschema.properties!)) {
        properties[name] = spec
      }
    }

    if ('required' in subschema) {
      for (const req of subschema.required!) {
        required.add(req)
      }
    }
  }

  const result: Schema = {
    type: 'object',
  }
  if (Object.keys(properties).length !== 0) {
    result.properties = properties
  }

  if (required.size !== 0) {
    result.required = [...required] as [string, ...string[]]
  }

  return result
}


/**
Generate a TypeScript expression, which re-packs an object to be
suitable to send to the server.

For basic objects, this will simply return the object as is.
However, some string formats require extra handling, since we store
them as a non-string object. For example: date-time objects are stored
as Date object.

NOTE the object resultingt from the expression (once evaluated during
runtime) will contain all keys present in all objects. This is as if
`additionalProperties` was set on all objects.

@example
```typescript
schema_to_serializer(
  {
    type: 'object',
    required: ['a'],
    properties: {
      a: {
        type: 'string',
        format: 'date-time',
      }
    },
  },
  <document>,
  'x'
)
⇒
{ a: x['a'].toISOString() }
```
*/
function schema_to_serializer(
  schema: Schema | Reference | boolean,
  document: OpenAPISpec,
  string_formats: { [format: string]: FormatSpec },
  x: string,
): CodeFragment[] {
  return schema_to_serializer_or_parser(
    schema,
    document,
    x,
    string_formats,
    'serializer',
  )
}

/**
Generate a TypeScript expression turning the "line" format back into a
parsed format.

@example
```typescript
schema_to_parser(
  {
    type: 'object',
    required: ['a'],
    properties: {
      a: {
        type: 'string',
        format: 'date-time',
      },
    },
  },
  <document>,
  'x')
⇒
{ a: new Date(x['a']) }
```
*/
function schema_to_parser(
  schema: Schema | Reference | boolean,
  document: OpenAPISpec,
  string_formats: { [name: string]: FormatSpec },
  x: string,
): CodeFragment[] {
  return schema_to_serializer_or_parser(
    schema,
    document,
    x,
    string_formats,
    'parser',
  )
}

/**
Implementation of `schema_to_serializer` and `schema_to_parser`.
 */
function schema_to_serializer_or_parser(
  schema: Schema | Reference | boolean,
  document: OpenAPISpec,
  x: string,
  // string_handler: (args: { format: string, y: string }) => string | false,
  string_formats: { [format: string]: FormatSpec },
  mode: 'parser' | 'serializer',
): CodeFragment[] {
  if (schema === true) return [cf`${x}`]
  if (schema === false) return [cf`(()=>{throw new Error})()`]

  /*
  @returns if the field needs transforming
   */
  function inner(schema: Schema | Reference, x: string): false | CodeFragment[] {

    // console.log('schema:', schema)

    if ('$ref' in schema) {
      return inner(resolve(schema, document), x)
    } else if ('allOf' in schema) {
      // Merge all entries into the "true" type, then run with that one

      const parts = schema.allOf!.map(
        (e) => '$ref' in e ? resolve(e, document) : e)

      if (!parts.every((e) => e.type === 'object')) {
        console.warn("WARNING: Found allOf part which isn't an object:", schema)
        console.trace()
        return false
      }

      return inner(
        merge_schemas(parts as Extract<typeof parts, { type: 'object' }>),
        x)

    } else if ('oneOf' in schema || 'anyOf' in schema) {

      // if all branches are trivialy disjoint types (string and object, ...), then this is easy.

      const options = schema.oneOf ?? schema.anyOf ?? []


      const parts: CodeFragment[] = []
      parts.push(cf`(() => {`)

      if ('discriminator' in schema) {
        parts.push(cf`switch (${x}[${ts_string(schema.discriminator!.propertyName)}]) {`);
        if (schema.discriminator!.mapping !== undefined) {
          for (const [value, ref] of Object.entries(schema.discriminator!.mapping!)) {
            parts.push(cf`case ${ts_string(value)}:`)
            const part = inner({ $ref: ref }, x)
            if (part) {
              parts.push(cf`return `, ...part)
            } else {
              parts.push(cf`return ${x}`)
            }
            parts.push(cf`;\n`)
          }
        } else {
          for (const ref of options) {
            if (!('$ref' in ref)) {
              throw new Error('All entries MUST be refs when using a discriminator')
            }
            const key = (ref['$ref'] as string).split('/').at(-1)!
            parts.push(cf`case ${ts_string(key)}:`)
            const part = inner(ref, x)
            if (part) {
              parts.push(cf`return `, ...part)
            } else {
              parts.push(cf`return ${x}`)
            }
            parts.push(cf`;\n`)
          }
        }
        parts.push(cf`}`)
      } else {

        const entries = options.map(
          (e) => '$ref' in e ? resolve(e, document) : e)

        const groups = entries.groupBy(p => p.type)

        // if at least one part lacks `type`, fail with not implemented
        if (groups.get(undefined) !== undefined) {

          for (const entry of groups.get(undefined)!) {
            if ('allOf' in entry) {
              // TODO this is the one we need to implement.
              // Basic idea is to
              // - take all entries of enstry.allOf, // and merge them into one big object.
              // - Later parts get priority
              throw new NotImplemented(`allOf inside ${JSON.stringify(schema)}`)
            } else if ('oneOf' in entry) {
              throw new NotImplemented(`oneOf inside ${JSON.stringify(schema)}`)
            } else if ('anyOf' in entry) {
              throw new NotImplemented(`anyOf inside ${JSON.stringify(schema)}`)
            } else {
              throw new Error(`In a oneOf switch, all clauses must have explicit types: ${JSON.stringify(entries)}`)
            }
          }

        }

        /*
        TODO we should add validators [1] here, such as minimum and
        maximum values for numbers.
        Reason they aren't already here is that they (mostly) can't be
        encoded in TypeScripts type system, meaning that the reciever
        of the data will prorably check it themselves.

        [1]: https://json-schema.org/draft/2020-12/json-schema-validation#name-a-vocabulary-for-structural
        */


        switch ((groups.get('object') ?? []).length) {
          case 0:
            break
          case 1: {
            parts.push(cf`if (typeof ${x} === 'object' && x !== null) {`)
            const part = inner(groups.get('object')![0], x)
            if (part) {
              parts.push(cf`return `, ...part)
            } else {
              parts.push(cf`return ${x}`)
            }
            parts.push(cf`}`)
            break
          }
          default:
            // if multiple object types, fail with not implemented
            throw new Error(`Can't have multiple objects in a oneOf switch without a discriminator. Got: ${JSON.stringify(groups.get('object'))}`)
        }

        const arrays = groups.get('array') ?? []
        switch (arrays.length) {
          case 0:
            break
          case 1:
            {
              const loop_var = 'x'
              let part: CodeFragment[] | false
              parts.push(cf`if (Array.isArray(${x})) {`)
              if ('items' in arrays[0]
                && (part = inner(resolve(arrays[0]!.items!, document), loop_var))
              ) {
                parts.push(cf`return ${x}.map((${loop_var}: any) => `, ...part, cf`)`)
              } else {
                parts.push(cf`return ${x}`)
              }
              parts.push(cf`}`)
            }
            break
          default:
            {

              parts.push(cf`if (Array.isArray(${x})) {`)
              if (!arrays.every(e => 'items' in e)) {
                // If at least one case lacks a distinct type,
                // fall back to a free form array
                parts.push(cf`return ${x}`)
              } else {

                // if multiple array types: rewrite from
                // - type: array
                //   items: X
                // - type: array
                //   items: Y
                // to
                // - type: array
                //   items:
                //     oneOf: [X, Y]

                const loop_var = 'x'
                const part = inner({ 'oneOf': arrays.map(e => e.items!) }, loop_var)
                if (part) {
                  parts.push(cf`return ${x}.map((${loop_var}: any) => `, ...part, cf`)`)
                } else {
                  parts.push(cf`return ${x}`)
                }
              }
              parts.push(cf`}`)

            }

            break
        }

        if (groups.get('null') !== undefined) {
          parts.push(cf`if (${x} === null) { return ${x} }`)
        }

        if (groups.get('number') !== undefined || groups.get('integer') !== undefined) {
          parts.push(cf`if (typeof ${x} === 'number') { return ${x} }`)
        }

        if (groups.get('boolean') !== undefined) {
          parts.push(cf`if (typeof ${x} === 'boolean') { return ${x} }`)
        }

        // strings with `format` are tested one by one, until a parser
        // works without crashing.
        if (groups.get('string') !== undefined) {
          const string_groups = groups.get('string')!.groupBy(s => 'format' in s)

          /* -------------------------------------------------- */

          if (mode === 'serializer') {

            const formats = (string_groups.get(true) ?? []).map(s => s.format!)
            let has_bare_string = string_groups.get(false) !== undefined
            for (const format_name of formats) {
              const spec = string_formats[format_name]

              if (!spec) {
                console.warn(`Unknown string format: "${format_name}"`)
                has_bare_string = true
                continue
              }

              if (spec.type === 'string') {
                has_bare_string = true
                continue
              }

              parts.push(cf`if (`)
              // console.log(spec)
              if (spec.instanceof) {
                parts.push(new CodeFragment(spec.instanceof(x),
                  { location: { path: ['@string-format', 'magic'] } },
                ))
              } else {
                parts.push(cf`${x} instanceof `, new CodeFragment(spec.type,
                  { location: { path: ['@string-format', 'magic'] } },
                ))
              }
              parts.push(cf`) {return `,
                new CodeFragment(spec.serialize(x),
                  { location: { path: ['@string-format', 'magic'] } },
                ),
                cf`}`)

            }

            if (has_bare_string) {
              parts.push(cf`if (typeof ${x} === 'string') { return ${x} }`)
            }

          } else if (mode === 'parser') {

            parts.push(cf`if (typeof ${x} === 'string') {`)
            let has_bare_string = string_groups.get(false) !== undefined
            if (string_groups.get(true) !== undefined) {
              for (const string_format of string_groups.get(true)!) {
                const spec = string_formats[string_format.format!]
                if (!spec) {
                  console.warn(`Unknown string format: ${string_format.format!}`)
                  continue
                }

                if (spec.type === 'string') {
                  has_bare_string = true
                  continue
                }

                const part = inner(string_format, x)
                if (!part) {
                  has_bare_string = true
                  continue
                }

                parts.push(cf`try {return `, ...part, cf`} catch (_) {}`)
              }
            }

            if (has_bare_string) {
              parts.push(cf`return ${x}`)
            }
            parts.push(cf`}`)

          } else {
            assertUnreachable(mode)
          }

          /* -------------------------------------------------- */

        }
      }

      // NOTE this does NOT throw APIMalformedError, since that error
      // is (currently) only available on the front-end, but this code
      // is also inserted in the routers.
      // TODO improve error message
      parts.push(cf`throw new Error(
      'Failed parsing field as any of the configured string formats.'
      )`)

      parts.push(cf`})()`)

      return parts

    } else if ('type' in schema) {

      /*
      NOTE we could add validation of values, making the whole
      expression throw instead of evaluating to a "serialized"
      version. This would however lead to really messy code, so a
      separate validator of the generated object (just before we send
      it) would be better. But even so, this is only for outgoing
      objects, and the server is ALWAYS the authority on what it
      actually accepts, which means that a check here would only save
      us a network trip from time to time.
       */

      switch (schema.type) {
        case 'null':
          return false
        case 'integer':
        case 'number':
          return false
        case 'string':

          if ('format' in schema) {
            const string_format = string_formats[schema.format!]
            if (!string_format) {
              console.warn(`Unknown string format: ${schema.format}`)
              return false
            }

            switch (mode) {
              case 'parser':
                return [new CodeFragment(string_format.parse(x))]
              case 'serializer':
                return [new CodeFragment(string_format.serialize(x))]
              default:
                assertUnreachable(mode)
            }
          }

          return false

        case 'array':
          if ('items' in schema) {
            const loop_var = 'x'
            const c = inner(schema.items!, loop_var)
            if (c === false) return false
            return [cf`${x}.map((${loop_var}: any) => `, ...c, cf`)`]
          } else {
            return false
          }

        case 'object':
          if ('properties' in schema) {
            const modified: CodeFragment[] = []
            for (const [key, value] of Object.entries(schema.properties!)) {
              const safe_key = ts_string(key)
              const c = inner(value, `(${x}[${safe_key}]!)`)
              if (c === false) continue
              if ((schema.required ?? [] as string[]).includes(key)) {
                modified.push(cf`${safe_key}: `, ...c, cf`,\n`,)
              } else {
                modified.push(
                  cf`...(${safe_key} in ${x} ? { ${safe_key}: `,
                  ...c,
                  cf` } : {}),\n`)
              }
            }
            if (modified.length === 0) {
              return false
            } else {
              return [
                cf`({ ...${x}, `,
                ...modified,
                cf` })`]
            }
          } else {
            return false
          }

        default:
          return false
      }
    } else {
      throw new Error(`Unhandled schema form: ${JSON.stringify(schema)}`)
    }
  }

  const result = inner(schema, x)
  if (result === false) return [cf`${x}`]
  return result

}
