/**
Code for generating TypeScript fragments for packing and unpacking
parameters.

The unpacked form of a parameter is what the applications want to work
with internally, while the packed form is what should be sent over the
network (usually a string). For example, `Date` is an internal type,
with it's packed equivalent being an string containing an ISO-formated
date.

@module
 */


export {
  pack_parameter_expression,
  unpack_parameter_expression,

  format_parameter,
  format_parameter_type,
}

import type {
  Header,
  Parameter,
  Schema,
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
} from '../openapi'

import { CodeFragment, cf } from '../code-fragment'
import type { FormatSpec } from '../json-schema-formats'
import { resolve } from '../json-pointer'
import { NotImplemented } from '../not-implemented'
import { ObjectField, ts_string, map_to_ts_object } from './util'
import { validate_and_parse_body } from './validate-body'
import { schema_to_typescript } from '../json-schema'

/**
Return a TypeScript fragment, which when evaluated, is the parsed form
of a header. Note that the generated form may throw exceptions.

@param header_field
TypeScript expression evaluating to the "raw" value of the
header. This MUST evaluate to a string, meaning that a check for
existance MUST be done beforehand.

@param header
Specification of header object.
 */
function unpack_parameter_expression(
  header_field: string,
  header: (Header | Parameter) & { name: string },
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] {

  if ('x-isFlag' in header) {
    /*
    Since this function must only be called when we know we have the
    value, the return value can only be true.

    Note that this function may be used for handling response headers,
    but x-isFlag can only appear on request parameters of type
    'query', so this is a non-situation.
    */

    if (header.in !== 'query') {
      throw new Error('x-isFlag can ONLY appear on query parameters\n'
        + JSON.stringify(header, null, 2))
    }

    if (header.required) {
      throw new Error("x-isFlag can't be required\n"
        + JSON.stringify(header, null, 2))
    }

    if (!header.allowEmptyValue) {
      throw new Error("x-isFlag must allow empty values\n"
        + JSON.stringify(header, null, 2))
    }

    if ('schema' in header) {
      console.warn('Schema ignored on x-isFlag parameter:', header)
    }

    return [cf`true`]
  } else if ('schema' in header) {
    const schema = resolve(header.schema!, document)

    if (!('type' in schema) || !['integer', 'number', 'string'].includes(schema.type!)) {
      throw new NotImplemented(`Only basic schemas are implemented for response headers. Got ${JSON.stringify(schema)}`)
    }

    /*
    Validation keywords
    https://json-schema.org/draft/2020-12/json-schema-validation#name-a-vocabulary-for-structural
     */


    const fragments: CodeFragment[] = []
    let return_type_override: false | string = false

    const hname = JSON.stringify(header.name)
    /* local variable holding the "normalized" value of the field */
    const normalized = 'normalized'

    fragments.push(
      cf`(()=>{`,
      /* Normalize value to a parsed form.
      This mostly means to parse numbers back into number objects,
      but may may parse more if we implement complex objects.
       */
      cf`const ${normalized} = `,
      (
        ['integer', 'number'].includes(schema.type!)
          ? cf`Number(${header_field})`
          /* string, but we catch other types further down */
          : cf`${header_field}`
      ), cf`;\n`,

    )
    /* Check const and enum validators */
    if ('enum' in schema) {
      const enumv = JSON.stringify(schema.enum!)
      fragments.push(cf`
      if (!${enumv}.includes(${normalized})) {
        throw new generator_common.InvalidData(
            'header', ${hname} + ' not in ' + ${enumv})
        }\n`)
      return_type_override = `generator_common.Unlist<${enumv}>`
    }

    if ('const' in schema) {
      const constv = JSON.stringify(schema.const!)
      fragments.push(cf`
      if (${constv} !== ${normalized}) {
        throw new generator_common.InvalidData(
        'header', ${hname} + " !== " + ${constv})
      }\n`)
      return_type_override = constv
    }

    /**
    Return a code fragment which checks if the test failed, and if so throws InvalidData.

    @param test
    A code fragment which evaluates to true if the passes the validation.

    @param responsoe
    A code fragment evaluating to a string, which will be used as the
    contents of the error.
     */
    function validator(test: CodeFragment, response: CodeFragment): CodeFragment[] {
      return [
        cf`if (!(`, test, cf`)) {
        throw new generator_common.InvalidData('header',`,
        response,
        cf`)}\n`
      ]
    }


    /* depending on type, check type specific validators */
    switch (schema.type!) {
      case 'integer':
      case 'number':
        if ('multipleOf' in schema) {
          fragments.push(...validator(
            cf`${normalized} % ${schema.multipleOf} === 0`,
            cf`${hname} + " not a multiple of ${schema.multipleOf}"`))
        }

        if ('maximum' in schema) {
          fragments.push(...validator(
            cf`${normalized} <= ${schema.maximum}`,
            cf`${hname} + " > ${schema.maximum}"`))
        }
        if ('exclusiveMaximum' in schema) {
          fragments.push(...validator(
            cf`${normalized} < ${schema.exclusiveMaximum}`,
            cf`${hname} + " => ${schema.exclusiveMaximum}"`))
        }
        if ('minimum' in schema) {
          fragments.push(...validator(
            cf`${normalized} >= ${schema.minimum}`,
            cf`${hname} + " < ${schema.minimum}"`))
        }
        if ('exclusiveMinimum' in schema) {
          fragments.push(...validator(
            cf`${normalized} > ${schema.minimum}`,
            cf`${hname} + " <= ${schema.exclusiveMinimum}"`))
        }

        fragments.push(cf`return ${normalized}`)
        break

      case 'string':

        if ('maxLength' in schema) {
          fragments.push(...validator(
            cf`${normalized}.length <= ${schema.maxLength}`,
            cf`${hname} + " too long"`,
          ))
        }
        if ('minLength' in schema) {
          fragments.push(...validator(
            cf`${normalized}.length >= ${schema.minLength}`,
            cf`${hname} + " too short"`))
        }
        if ('pattern' in schema) {
          fragments.push(...validator(
            cf`${normalized}.match(new RegExp(${JSON.stringify(schema.pattern)}))`,
            cf`${hname} + " failed to match a regex pattern"`))
        }

        if ('format' in schema) {
          // TODO in all these cases, we should attach the format as a parameter.
          if (schema.format! in string_formats) {
            fragments.push(
              cf`return `,
              new CodeFragment(
                string_formats[schema.format!]!.parse(normalized))
            )
            return_type_override = false
          } else {
            // TODO change this to a warning, and return string
            throw new NotImplemented(`Strings with ${schema.format} format`)
          }
        } else {
          fragments.push(cf`return ${normalized}`)
        }

        break

      default:
        throw new Error('Should be impossible, due to above if statement')
    }

    if (return_type_override) {
      fragments.push(cf` as ${return_type_override}`)
    }

    fragments.push(cf`;\n`)

    fragments.push(cf`}) ()`)

    return fragments

  } else if ('content' in header) {
    const content = resolve(header.content!, document)
    if (Object.keys(content).length !== 1) {
      throw new Error
    }

    const [[mimetype, body]] = Object.entries(content)

    switch (mimetype) {
      case 'text/plain':
        // NOTE possibly check header deeper here
        return [cf`${header_field} `]

      case 'application/json': {
        const fragments: CodeFragment[] = []
        fragments.push(cf`(() => {
              const content = JSON.parse(${header_field}); `)

        if ('schema' in body) {
          body.schema!
          fragments.push(
            cf`return `,
            ...validate_and_parse_body({
              schema: body.schema!,
              body_var: 'content',
              document: document,
              string_formats: string_formats,
            }),
            cf`; \n`)
        } else {
          fragments.push(cf`return content; \n`)
        }

        fragments.push(cf`})()`)
        return fragments
      }

      default:
        throw new NotImplemented(`Headers(or parameters) of type ${mimetype} not implemented.Got ${JSON.stringify(body)} `)
    }

  } else {
    console.warn(
      'Found header or parameter with neither content nor schema: '
      + `${header_field}, ${JSON.stringify(header)} `)
    return [cf`${header_field} `]
  }
}


/**
Package a parameter object, of the type returned by calling
`format_parameter_type` on the same parameter object.

This packaging goes from a structured typescript type, to a format
suitable to insert into a fetch request.

@param param_object
string evaluating to JavaScript object evaluating to object containing
parameters.

@return
The returned value is a TypeScript fragment which will evaluate to a
list of pairs, where each value is the name of the parameter as a
string, and each is the corresponding value, as an expression
evaluating to a string.

The value may need to be further escaped, depending on usage.
For example, pass it through `encodeURIComponent` if inserting it into
a query string.
 */
function pack_parameter_expression(
  param_object: string,
  parameter: Parameter | (Header & { in: 'header', name: string }),
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] {
  const key = ts_string(parameter.name)
  if ('content' in parameter) {

    const content = Object.entries(parameter.content!)
    if (content.length !== 1) {
      throw new Error(`If 'content' is present on a parameter, it's length MUST be exactly 1 (${JSON.stringify(content)})`)
    }

    /* Type declaration doesn't matter, since it would be serialized
    the same way anyways */
    const [[content_type, _]] = content

    if (content_type === 'text/plain') {
      return [cf`[[${key}, ${param_object}[${key}]]]`]
    } else if (content_type === 'application/json') {
      return [cf`[[${key}, JSON.stringify(${param_object}[${key}])]]`]
    } else {
      throw new NotImplemented('Content types other than text/plain and application/json')
    }

  } else if ('schema' in parameter) {

    const style = parameter.style ?? {
      query: 'form',
      path: 'simple',
      header: 'simple',
      cookie: 'form',
    }[parameter.in]

    const explode = parameter.explode ?? (style === 'form' ? true : false)
    const allowReserved = parameter.allowReserved ?? false
    if (allowReserved) {
      throw new NotImplemented('`allowReserved` on parameters objects')
    }

    /* Resolve until we get a "true" schema object, since we want to
    actually use it here */
    let schema = parameter.schema!
    while ('$ref' in schema) {
      schema = resolve(schema, document)
    }


    const value = `${param_object}[${key}]`

    switch (style) {
      case 'simple':
        return [
          cf`[[${key}, `,
          ...handle_simple_parameter(schema, value, explode, string_formats, document),
          cf`]]`
        ]

      case 'form':
        return handle_form_parameter(schema, key, value, explode, string_formats, document)

      case 'deepObject':
      /*
          The representation of array or object properties is not
          defined.

          OpenAPI Specification Version 3.1.1
       */
      case 'matrix':
      case 'label':
      case 'spaceDelimited':
      case 'pipeDelimited':
        throw new NotImplemented(`Parameter style ${style} `)
      default:
        throw new NotImplemented(`Unknown style in parameter: ${JSON.stringify(parameter)} `)
    }
  } else {
    throw new Error('Content or Schema required in parameter')
  }
}

/* -------------------------------------------------- */

/**
Formats an OpenAPI parameter into an ObjectField.

If the return is null, then this parameter is ignored (probably due to
the OpenAPI specification explicitly prompting us to ignore
it). Otherwise, an ObjectField is returned, detailing the name and
type of the parameter. The type is "translated" from an OpenAPI
specification to a concrete TypeScript type.
 */
function format_parameter(
  parameter: Parameter | (Header & { in: 'header', name: string }),
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): null | ObjectField {
  const name = parameter.name

  const type = format_parameter_type(parameter, string_formats, document)

  switch (parameter.in) {
    case 'query':
      return {
        name: parameter.name,
        type: type,
        optional: !parameter.required,
      }

    case 'header':
      if (['Accept', 'Content-Type', 'Authorization'
      ].includes(name)) {
        return null
      }
      return {
        name: parameter.name,
        optional: !parameter.required,
        type: type,
      }

    case 'path':
      return {
        name: parameter.name,
        type: type,
      }

    case 'cookie':
      return {
        name: parameter.name,
        type: type,
        optional: !parameter.required,
      }
  }
}

/**
Format the actual type of a parameter into a string containing a
TypeScript type.

This can both return literal types declarations, as well as references
to previously defined types.

@param parameter
Either pa parameter object, or a header object, since those are
basically identical. NOTE this means that this function should
possibly be renamed, and moved to a common location.
 */
function format_parameter_type(
  parameter: Parameter | Header,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] {
  if ('content' in parameter) {
    const content = Object.entries(parameter.content!)
    if (content.length !== 1) {
      throw new Error(`If 'content' is present on a parameter, it's length MUST be exactly 1 (${JSON.stringify(content)})`)
    }
    /* Content type ignored, since that only matters when packing the
    value for transport */
    const [[_, media]] = content

    return schema_to_typescript(media.schema ?? {}, 'types.', string_formats, document)
  } else if ('schema' in parameter) {
    return schema_to_typescript(parameter.schema ?? {}, 'types.', string_formats, document)
  } else {
    throw new Error(`Content or Schema required in headers and parameter. Got ${JSON.stringify(parameter)}`)
  }
}

/**
From a Schema whose type is 'object', generate a TypeScript fragment
which evaluates to a list of pairs. Keys matches those found in
`value`, and the values are the corresponding value of each item of
value, as an expression returning its serialized form.

@param schema
Schema to operate on.

@param value
Expression evaluating to a TypeScript object, which fullfills
`schema`.

 */
function handle_object_schema_parameter(
  schema: Schema & { type: 'object' },
  value: string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] {
  const out: CodeFragment[] = [cf`(()=>{`]
  if ('properties' in schema) {
    const properties = resolve(schema.properties!, document)
    out.push(cf` const serializers = `)
    out.push(...map_to_ts_object(Object.entries(properties).map(([name, property]) => [
      name, [
        cf`(x) => `,
        ...handle_simple_parameter(
          resolve(property, document),
          'x',
          false,
          string_formats,
          document),
      ]
    ])))
  }

  const serializer = 'items' in schema
    ? `serializers[key]`
    : 'String'

  out.push(cf`
        const pairs = Object.entries(${value}).map(([key, value])=>{
        return [key, ${serializer}(value)]
        });`)
  out.push(cf`})()`)

  return out
}

/**
@param schema
@param value
A TypeScript expression evaluating to the value we want to convert to
line format.

@param document
 */
function handle_simple_parameter(
  schema: Schema,
  value: string,
  explode: boolean,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] {
  switch (schema.type) {
    case "string":
      if (schema.format === undefined) {
        return [new CodeFragment(value)]
      } else {
        const spec = string_formats[schema.format]
        if (!spec) {
          throw new NotImplemented(`Strings with ${schema.format} format`)
        }

        // TODO do we really need to force the parameter here (`!`)?
        // Shouldn't TypeScript figure out that it can't be `undefined`?
        return [new CodeFragment(
          spec.serialize(value + '!'),
          { location: { path: '@string-format' } },
        )]
      }

    case "number":
    case "integer":
      return [cf`String(${value})`]

    case "null":
      return [cf`""`]

    case "object": {
      const pairs = handle_object_schema_parameter(schema as Schema & { type: 'object' },
        value, string_formats, document)

      if (explode) {
        return [cf`${pairs}.map(p => p.join('=')).join(',')`]
      } else {
        return [cf`${pairs}.flatMap(x => x).join(',')`]
      }
    }

    case "array": {
      if ('items' in schema) {
        return [
          cf`${value}.map(x => `,
          ...handle_simple_parameter(
            resolve(schema.items!, document),
            'x', false, string_formats, document),
          cf`).join(',')`
        ]
      } else {
        return [cf`${value}.map(x => String(x)).join(',')`]
      }
    }

    case "boolean":
      /* Possibly check parameter.allowEmptyValue.
      Currently, we assume that the common idiom of `key=<non-empty>`
      is true, while `key=<empty>` is false.
       */
      return [cf`${value} ? "true" : ""`]

    default:
      throw new NotImplemented(
        `Unknown type in simple schema: ${JSON.stringify(schema)}`)
  }
}

/**
@return
A string which evaluates to a list of key value pairs.
 */
function handle_form_parameter(
  schema: Schema,
  key: string,
  value: string,
  explode: boolean,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] {

  switch (schema.type) {
    case undefined:
      return [cf`[[${key}, '']]`]

    case "string":
      // TODO format here?
      return [cf`[[${key}, ${value}]]`]

    case "number":
    case "integer":
      return [cf`[[${key}, String(${value})]]`]

    case "array":
      if (explode) {
        // TODO encode each component
        return [cf`${value}.map(v => [${key}, v])`]
      } else {
        // TODO encode each component of value
        return [cf`[[${key}, ${value}.join(',')]]`]
      }

    case "object":
      const pairs = handle_object_schema_parameter(schema as Schema & { type: 'object' },
        value, string_formats, document)

      if (explode) {
        return pairs
      } else {
        return [cf`[[${key}, ${pairs}.flatMap(x => x).join(',')]]`]
      }

    case "null":
      /* "null" sholudn't really exist, so we ignore it for now. */
      throw new NotImplemented('Null form parameters')

    case "boolean":
      return [cf`[[${key}, ${key}]]`]

    default:
      throw new Error(`Encountered schema of unknown type: ${schema.type}\n`
        + JSON.stringify(schema, null, 2))
  }

  // if undefined, then `${ key } = `
  // if string, then `${ key } = ${ value } `
  // if array and not explode, then `${ key } = ${ value.join(',') } `
  // if array and explode, then value.map((v) => `${ key } = ${ v } `)
  //     This array should later be merged as URL Query parameters
  // if object and not explode, `${ key } = ${ Object.entries(value).flatMap(x => x).joino(',') } `
  // if object and explode, Object.entries(value).map(([key, value]) >= `${ key } = ${ value } `)
}

