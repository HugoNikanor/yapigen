export { format_response }

import type {
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
  Response,
  Header,
  SecurityRequirement,
} from '../openapi.ts'
import { resolve } from '../json-pointer.ts'
import { object_to_type, ts_string, map_to_ts_object } from './util.ts'
import {
  format_parameter,
  unpack_parameter_expression,
} from './headers-and-parameters.ts'
import { CodeFragment, cf } from '../code-fragment.ts'
import { FormatSpec } from '../json-schema-formats.ts'
import { validate_and_parse_body } from './validate-body.ts'
import { is_authenticated } from './authentication.ts'
import type { CountedSymbol } from '../counted-symbol.ts'

/**
Generate code to handle one response from a fetch request.

The generated fragment may throw exceptions.

@param args.status
The HTTP status code (200, 404, ...) to handle the response for.
This is pulled from the source api specification, and specified as a
string.

@param args.response
The response object (from the OpenAPI specification) to generate a
clause for.

@param args.response_object
TypeScript fragment resolving to the object containing the response
from a fetch request. Will be evaluated multiple times.

@param args.document
Base OpenAPI specification worked with. Used to resolve references.

@param args.generator_common_symbol
Symbol which the common generated library is imported under.

@param args.types_symbol
symbol which the generated types is imported under.

@param args.validators_symbol
Symbol the generated validators are imported under.

@returns
A TypeScript fragment suitable for pasting into a switch stament.
This means that it's either "nothing", or something beginning with
`case ${args.status}`.
 */
function format_response(args: {
  status: string,
  response: Response,
  response_object: string,
  security: SecurityRequirement[],
  generator_common_symbol: CountedSymbol,
  types_symbol: CountedSymbol,
  validators_symbol: string,

  gensym: (hint?: string) => string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): CodeFragment[] {

  if (is_authenticated(args.security) && args.status === '401') return []

  const frags: CodeFragment[] = []

  frags.push(cf`case ${args.status}: {\n`)

  const response = new Map<string, CodeFragment[]>
  response.set('status', [cf`${args.status}`])

  if ('headers' in args.response) {

    type NamedHeader = Header & { name: string }

    const headers: NamedHeader[] = Object.entries(
      resolve(args.response.headers, args.document)
    )
      .map(([name, ref_]) => ({
        ...resolve(ref_, args.document),
        name: name
      }))

    const headers_type = object_to_type(headers
      .map((header) => format_parameter(
        { ...resolve(header, args.document), in: 'header' },
        args.types_symbol,
        args.string_formats,
        args.document,
      )).filter(x => x !== null))

    const groups = headers.groupBy(h => h.required ?? false)

    /* Declare a struct of return headers */
    const headers_var = args.gensym('headers')
    const return_s: CodeFragment[] = [cf`const ${headers_var}: `, ...headers_type, cf` = `,
    ...map_to_ts_object((groups.get(true /* required headers */) ?? []).map((header) => {
      const header_var = args.gensym('header')
      const key = ts_string(header.name)
      return [
        header.name,
        [
          cf`(() => {
        const ${header_var} = ${args.response_object}.headers.get(${key});`,

          cf`if (! ${header_var}) { throw new ${args.generator_common_symbol}.APIMalformedError(`,
          new CodeFragment(ts_string(`Required header ${key} absent from response.`)),
          cf`);}\n`,

          cf`return `,
          ...unpack_parameter_expression({
            header_field: header_var,
            header: header,
            generator_common_symbol: args.generator_common_symbol,
            validators_symbol: args.validators_symbol,

            gensym: args.gensym,
            string_formats: args.string_formats,
            document: args.document,
          }
          ),
          cf`;\n`,
          cf`})()`,
        ]
      ]
    })),
    cf`;\n`,
    ]

    for (const header of groups.get(false /* optional headers */) ?? []) {
      const key = ts_string(header.name)
      const header_var = args.gensym('header')
      return_s.push(cf`{
      const ${header_var} = ${args.response_object}.headers.get(${key})
      if (${header_var}) {
        ${headers_var}[${key}] = `,
        ...unpack_parameter_expression({
          header_field: header_var,
          header: header,
          generator_common_symbol: args.generator_common_symbol,
          validators_symbol: args.validators_symbol,

          gensym: args.gensym,
          string_formats: args.string_formats,
          document: args.document,
        }),
        cf`}}`)
    }

    frags.push(...return_s)

    response.set('headers', [cf`${headers_var}`])
  }

  const content_type_var = args.gensym('content_type')
  if ('content' in args.response) {
    frags.push(
      /* parse_content_type defined in the preamble file. */
      // TODO get `parse_content_type` from somewhere
      cf`const [${content_type_var}] = parse_content_type(${args.response_object}.headers.get('Content-Type'));\n`,
      /*
      TODO handle the `encoding` parameter. Currently, we assume that
      all recieved data is in the "correct" encoding (which should be
      UTF-8 as long as neither system is stupid, so this should just
      work™).
       */
      cf`switch (${content_type_var}) {\n`)
    for (const [mimetype, media] of Object.entries(args.response.content)) {
      frags.push(cf`case ${ts_string(mimetype)}: {\n`)
      response.set(
        'content_type',
        [new CodeFragment(ts_string(mimetype))])

      if (mimetype === 'application/json') {
        const body_var = args.gensym('body')
        frags.push(cf`const ${body_var} = await ${args.response_object}.json(); \n`)
        if ('schema' in media) {
          response.set('body', validate_and_parse_body({
            schema: media.schema,
            body_var: body_var,
            validators_symbol: args.validators_symbol,
            gensym: args.gensym,
            string_formats: args.string_formats,
            document: args.document,
          }))

        } else {
          response.set('body', [cf`${body_var}`])
        }

      } else if (mimetype === 'text/plain') {
        response.set('body', [cf`await ${args.response_object}.text()`])

      } else if (mimetype === 'application/binary') {
        response.set('body', [cf`await ${args.response_object}.arrayBuffer()`])

      } else {
        response.set('content_type', [cf`${content_type_var}`])
        response.set('body', [cf`await ${args.response_object}.arrayBuffer()`])
      }
      frags.push(cf`return `, ...map_to_ts_object([...response]), cf`;`)
      frags.push(cf`};\n`) // end case
    }
    frags.push(new CodeFragment(
      `default: throw new ${args.generator_common_symbol}.APIMalformedError("Unknown Content Type: " + ${content_type_var})`))
    frags.push(cf`}\n`) // end switch mimetype

  } else {
    frags.push(cf`return `, ...map_to_ts_object([...response]), cf`;\n`)
  }


  frags.push(cf`};\n`)

  return frags
}
