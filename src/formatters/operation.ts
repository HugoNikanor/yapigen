export {
  format_operation_api_call,
  operations,
  format_operation_as_server_endpoint_handler,
  format_operation_as_server_endpoint_handler_type,
}

import type {
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
  Operation,
  Parameter,
  MediaType,
  Reference,
  Response,
  RequestBody,
  SecurityRequirement,
  Schema,
} from '../openapi'
import { resolve } from '../json-pointer'
import {
  schema_to_typescript,
  schema_to_serializer,
} from '../json-schema'
import {
  ObjectField,
  object_to_type,
  ts_string,
  map_to_ts_object,
  generate_funcall,
  generate_switch,
  get_here,
} from './util'
import { format_response } from './response'
import '../group-by'
import { NotImplemented } from '../not-implemented'
import {
  format_parameter,
  unpack_parameter_expression,
  pack_parameter_expression,
} from './headers-and-parameters'
import { CodeFragment, cf, join_fragments } from '../code-fragment'
import { assertUnreachable } from '../unreachable'
import type { FormatSpec } from '../json-schema-formats'
import { validate_and_parse_body } from './validate-body'
import { is_authenticated } from './authentication'

const operations = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const

/**
Convert a type of a list of values, to an union of all those values.
 */
type Unlist<T> = T extends readonly [infer First, ...infer Rest]
  ? First | Unlist<Rest>
  : never

type BadRequestCase = {
  content_type: string,
  body: () => string,
}

type FormatBadRequest = (args: {
  type: 'MISSING',
  parameter_location: 'cookie' | 'header' | 'query' | 'path',
  parameter_name: string,
}) => BadRequestCase[]

const DEFAULT_FORMAT_BAD_REQEUST: FormatBadRequest = ({
  type, parameter_location, parameter_name,
}) => [
    {
      content_type: 'application/json',
      body: () => JSON.stringify({
        type: type,
        location: parameter_location,
        names: [parameter_name],
      }),
    },
  ]

/**
Format an operation for use in an API call.

Generates a single function, for doing the API call described in the
Operation object.

All known responses (as specified in the OpenAPI document), will
return proper values, tagged with the response code. Despite that, the
generated function may throw for a number of reasons. These includes,
but are not limited to:

- internal errors doing the request
- (for authorized entries) failure to authorize
  (technically an "internal" error. Should be handled better).
- Malformed response, including
    - a required header was missing
    - A header had incorrect form (but only in some instances, for
      example, headers with type `Date` merely return an invalid date
      object).
    - Unknown content type. This includes content types
        - not specified in the OpenAPI schema.
        - not handled by the generator.
    - unknown status codes.
- Network errors

A well-behaved client must be able to recover from most of
these. Moving them from exceptions to "negative" return values would
force all clients to actually check for these.

TODO example.

@param args.generator_common_symbol
Symbol which the common generated library is imported under.

@param args.types_symbol
symbol which the generated types is imported under.

@param args.validators_symbol
Symbol the generated validators are imported under.
 */
function format_operation_api_call(args: {
  op: Unlist<typeof operations>,
  operation: Operation,
  path_template: string,
  shared_parameters: Parameter[],
  parameters_object: string,
  default_security: SecurityRequirement[],
  generator_common_symbol: string,
  types_symbol: string,
  validators_symbol: string,

  gensym: (hint?: string) => string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): CodeFragment[] {

  /* Name of argument dictionary to generated function */
  const f_args = args.gensym('args')

  const security = args.operation.security ?? args.default_security

  /* Does this endpoint require authentication?
  NOTE that endpoints with optional authentication are treated as
  unauthenticated.
   */
  const authenticated_endpoint = is_authenticated(security)

  /** Arguments to the function we are currently creating. */
  const function_args: ObjectField[] = []
  /** Arguments to pass along to the inner `request` call */
  const request_args = new Map<string, CodeFragment[]>

  /** Parts of the request header.
  Each element should evaluate to an record from header names to header values.
  In the final request, these will be joined into one complete record.
   */
  const request_header_parts: CodeFragment[] = []

  function_args.push(
    { name: 'headers', type: [cf`Record<string, string>`], optional: true },
  )

  if (authenticated_endpoint) {
    function_args.push(
      { name: 'save_refresh', type: [cf`SaveRefreshCB`] },
      { name: 'authenticator', type: [cf`Authenticator`] },
      { name: 'account', type: [cf`Account`] },
      { name: 'login_headers', type: [cf`Record<string, string>`], optional: true },
    )

    request_args.set('save_refresh', [cf`${f_args}.save_refresh`])
    request_args.set('account', [cf`${f_args}.account`])
    request_args.set('authenticator', [cf`${f_args}.authenticator`])

    request_args.set('login_headers', [cf`{...${f_args}.login_headers ?? {}}`])
  } else {
    /* For authorized calls, we get the server from the account.
    But since we don't have an account, we need to pass the server manually.
     */
    function_args.push({ name: 'server', type: [cf`string`] })
  }

  request_args.set('method', [new CodeFragment(ts_string(args.op.toUpperCase()))])

  const frags: CodeFragment[] = []

  if (args.operation.summary || args.operation.description) {
    const summary = args.operation.summary ? args.operation.summary + '\n\n' : ''
    const description = args.operation.description ?? ''

    /* NOTE the entire comment MUST be a single code fragment, since
    the source location may be added after as another block comment */
    frags.push(cf`\n/**\n${summary}${description}\n*/\n`)
  }

  if (args.operation.requestBody) {

    const body_type_alternatives: CodeFragment[][] = []
    const body_cases: CodeFragment[][] = []

    const request_body = resolve(args.operation.requestBody, args.document)

    request_header_parts.push(
      request_body.required
        ? cf`{ "Content-Type": ${f_args}.body["content-type"] }`
        : cf`...(${f_args}.body ? { "Content-Type": ${f_args}.body["content-type"] } : {})`)

    for (const body_case of handle_request_body({
      bodies: request_body.content,
      body_required: request_body.required === true,
      source_param: `${f_args}.body.body`,
      types_symbol: args.types_symbol,
      string_formats: args.string_formats,
      document: args.document
    })) {
      body_type_alternatives.push(object_to_type([
        {
          name: 'content-type',
          type: [new CodeFragment(ts_string(body_case.content_type))],
        },
        {
          name: 'body',
          type: body_case.type,
        },
      ]))

      body_cases.push([
        cf`case ${ts_string(body_case.content_type)}:\n`,
        cf`return `,
        ...body_case.pack_expression,
        cf`;\n`,
      ])
    }

    function_args.push({
      name: 'body',
      optional: !request_body.required,
      type: join_fragments(cf` | `, body_type_alternatives),
    })

    const body_proper: CodeFragment[] = [cf`(() => {
    switch (${f_args}.body["content-type"]) {`,
    ...body_cases.flatMap((c) => [...c, cf`\n`]),
    cf`
        default:
        throw new Error("Function was supplied with an unexpected content type. This should never happen.")
    }})()`]

    request_args.set('body',
      [
        (request_body.required ? cf`` : cf`${f_args}.body === undefined ? undefined : `),
        ...body_proper,
      ])
  }


  const parameters: ObjectField[] = []

  const local_parameters = (args.operation.parameters ?? []).map(x => resolve(x, args.document))
  const all_parameters = args.shared_parameters.concat(local_parameters)

  // NOTE It's would be preferable to check that the declared path
  // parameters are an exact match with the one provided in the path
  // placeholder here. !PATH_PLACEHOLDER!
  // all_parameters.filter(p => p.in === 'path').map(p => p.name)

  for (const parameter of all_parameters) {
    const type = format_parameter(parameter, args.types_symbol, args.string_formats, args.document)

    if (!type) continue

    parameters.push(type)
  }

  const responses = Object.entries(args.operation.responses)
  // .map(([k, v]) => [k, resolve(v, data)] as [string, Response])

  /**
  Return values where the server responded, with a message matching
  one of those configured in the OpenAPI document.
   */
  const expected_return_type = join_fragments(cf` | `, responses
    .map(([status, response]) => get_return_type(
      status, response, security,
      args.types_symbol, args.string_formats, args.document)
    )
    .filter(x => x !== null))

  function typ(s: string) { return [new CodeFragment(s)] }
  function lit(s: string) { return typ(ts_string(s)) }

  /**
  Errors when something went wrong with the request.

  'network' errors are always present, with 'user-cancel' and
  'unauthenticated' being added for authenticated endpoints.

  Note that errors of type 'malformed' are instead thrown as exceptions.
   */
  const unexpected_returns = [
    object_to_type([
      { name: 'error', type: lit('network') },

      { name: 'server', type: typ('string') },
      { name: 'online', type: typ('boolean'), optional: true },
    ]),
  ]

  if (authenticated_endpoint) {
    unexpected_returns.push(
      object_to_type([
        { name: 'error', type: lit('user-cancel') },
      ]),
      object_to_type([
        { name: 'error', type: lit('unauthenticated') },
        { name: 'msg', type: typ('string') },
      ]),
    )
  }

  const unexpected_return_type = join_fragments(cf` | `, unexpected_returns)

  // input to function is `parameters` and `requestBody`.

  function_args.push({
    name: 'params',
    optional: parameters.every(({ optional }) => optional === true),
    type: object_to_type(parameters)
  })

  frags.push(
    cf`export async function ${args.operation.operationId}`,
    cf`(${f_args}: `, ...object_to_type(function_args), cf`)`,
    cf`: Promise<`, ...expected_return_type, cf` | `, ...unexpected_return_type, cf`>`,
    cf`{\n`)

  const groups = all_parameters.groupBy(p => p.in)


  const path_parameters = groups.get('path')
  if (path_parameters) {
    /* All these are guaranteed to be required, so doen't even bother checking */
    frags.push(
      cf`const ${args.parameters_object} = `,
      ...params_to_object(
        `${f_args}.params`, path_parameters,
        args.gensym, args.string_formats, args.document
      ),
      cf`;`)
  }


  const query_parameters = groups.get('query')
  const query_parameters_var = args.gensym('query_parameters')
  if (query_parameters) {
    frags.push(cf`const ${query_parameters_var} = new URLSearchParams;`)

    for (const parameter of query_parameters.values()) {
      const key = ts_string(parameter.name)
      if (!parameter.required)
        frags.push(cf`if (${key} in ${f_args}.params) {`)

      const pair_var = args.gensym('pair')
      frags.push(
        cf`for (const ${pair_var} of `,
        ...pack_parameter_expression(`${f_args}.params`, parameter,
          args.gensym, args.string_formats, args.document),
        cf` as [string, string][]) {
            ${query_parameters_var}.append(${pair_var}[0], ${pair_var}[1])
        }`)

      if (!parameter.required)
        frags.push(cf`}`)
    }
  }

  const header_parameters = groups.get('header')
  if (header_parameters) {

    const groups = header_parameters!.groupBy(p => p.required ?? false)

    /* These are the headers which are passed along to `request`.
    Which is why they all have type `string`, and the actuall type
    check is in the function arguments instead.
     */
    const header_parameters_type = object_to_type(
      header_parameters!
        .map(p => ({
          name: p.name,
          type: [cf`string`],
          optional: !p.required
        }))
    )

    /*
    TODO TypeScript really wants an object object literal here, but
    params_to_object instead returns an expression which evaluates to
    an object, which is why we cast it to `any`.

    The solution is to reword `params_to_object` (and probably
    `pack_parameter_expression`).
     */
    const header_parameters_var = args.gensym('header_parameters')
    frags.push(
      cf`const ${header_parameters_var}: `, ...header_parameters_type, cf` = `,
      ...params_to_object(`${f_args}.params`, groups.get(true) ?? [],
        args.gensym, args.string_formats, args.document),
      cf` as any;\n`
    )

    for (const parameter of groups.get(false) ?? []) {
      const key = ts_string(parameter.name)
      frags.push(cf`if (${key} in ${f_args}.params) {`)
      /* TODO this assumes that no header parameter explodes into multiple headers.
      This is NOT correct, and should be fixed in the future.
       */
      const key_var = args.gensym('key')
      const value_var = args.gensym('value')
      frags.push(
        cf`const [[${key_var}, ${value_var}]] = `,
        ...pack_parameter_expression(`${f_args}.params`, parameter,
          args.gensym, args.string_formats, args.document),
        cf`;
      (${header_parameters_var} as any)[${key_var}] = ${value_var};`)
      frags.push(cf`}`)
    }

    request_header_parts.push(cf`${header_parameters_var}`)
  }

  /* error on cookie parameters. */
  if (groups.get('cookie') !== undefined) {
    request_args.set('request_credentials', [cf`"include"`])
  }

  const response_object = args.gensym('response')

  /* We do this really late, to ensure args.headers ALWAYS is last in the merged structure */
  request_header_parts.push(cf`${f_args}.headers`)
  if (request_header_parts.length === 1) {
    request_args.set('headers', [request_header_parts[0]!])
  } else {
    request_args.set('headers', [
      cf`{`,
      ...request_header_parts.flatMap(p => [cf`...`, p, cf`,\n`]),
      cf`}`,
    ])
  }

  frags.push(cf`const ${response_object} = await `,
    ...generate_funcall(authenticated_endpoint ? 'request' : 'fetch_or_network_error',
      authenticated_endpoint
        ? build_query_string({
          path_template: args.path_template,
          include_query_parameters: query_parameters !== undefined,
          query_parameters_var: query_parameters_var,
        })
        : build_query_string({
          path_template: args.path_template,
          include_query_parameters: query_parameters !== undefined,
          query_parameters_var: query_parameters_var,
          prefix: `${f_args}.server`,
        })
      ,
      map_to_ts_object([...request_args])),
    cf`;\n`)

  if (authenticated_endpoint) {
    frags.push(cf`
    if ('error' in ${response_object}) {
        switch (${response_object}.error) {
            case "user-cancel":
                return {
                    error: 'user-cancel',
                }
            case "unauthenticated":
                return {
                    error: 'unauthenticated',
                    msg: ${response_object}.msg,
                }
            case "network":
                return {
                    error: 'network',
                    server: ${response_object}.server,
                    online: ${response_object}.online,
                }
            case "malformed":
                throw new APIMalformedError(${response_object}.msg)
            default:
                assertUnreachable(${response_object})
        }
    }\n`)
  } else {
    // TODO maybe fill out the server field
    frags.push(cf`if ('error' in ${response_object}) {
    switch (${response_object}.error) {
        case 'network':
            return {
                error: 'network',
                server: '',
                online: navigator.onLine,
            }
        default:
            assertUnreachable(${response_object}.error)
    }}\n`)
  }

  frags.push(...generate_switch(
    `${response_object}.status`,
    get_here(),
    ...responses.flatMap(([status, response_]) => {
      const response = resolve(response_, args.document)
      return format_response({
        status: status,
        response: response,
        document: args.document,
        response_object: response_object,
        security: security,
        generator_common_symbol: args.generator_common_symbol,
        types_symbol: args.types_symbol,
        validators_symbol: args.validators_symbol,

        gensym: args.gensym,
        string_formats: args.string_formats,
      })
    }).concat([
      new CodeFragment(
        `default:
        throw new APIMalformedError("Unknown HTTP status code: " + ${response_object}.status)\n`)
    ])))

  frags.push(cf`}`) /* end function declaration */

  return frags

}


/**
Format an operation object into a TypeScript fragment containing a
function declaration, whhich takes a user supplied "handler", and
returns an endpoint handler in the express.js meaning.

@param args.generator_common_symbol
Symbol which the common generated library is imported under.

@param args.types_symbol
symbol which the generated types is imported under.

@param args.handler_types_symbol
Symbol the generated handler types are imported under.

@param args.validators_symbol
Symbol the generated validators are imported under.

@param args.express_symbol
Symbol the express library is importend under.
 */
function format_operation_as_server_endpoint_handler(args: {
  operation: Operation,
  shared_parameters: Parameter[],
  generator_common_symbol: string,
  types_symbol: string,
  handler_types_symbol: string,
  validators_symbol: string,
  express_symbol: string,

  gensym: (hint?: string) => string,
  string_formats: { [format: string]: FormatSpec },
  // format_bad_request: FormatBadRequest,
  document: OpenAPISpec,
}): CodeFragment[] {
  const fragments: CodeFragment[] = [];
  const req_var = args.gensym('req')
  const res_var = args.gensym('res')
  const handler_parameter_var = args.gensym('handler')
  const handler_args_var = args.gensym('handler_args')
  fragments.push(cf`
  function handle_${args.operation.operationId}(
    ${handler_parameter_var}: ${args.handler_types_symbol}.${args.operation.operationId},
  ): (req: ${args.express_symbol}.Request, res: ${args.express_symbol}.Response) => Promise<void> {
    return async (${req_var}, ${res_var}) => {`)

  const local_parameters = (args.operation.parameters ?? []).map(x => resolve(x, args.document))
  const all_parameters = args.shared_parameters.concat(local_parameters)

  fragments.push(cf`const ${handler_args_var}: Partial<Parameters<${args.handler_types_symbol}.${args.operation.operationId}>[0]> = {};\n`)

  for (const parameter of all_parameters) {

    const name = args.gensym('parameter')

    /* Retrieve parameter */
    switch (parameter.in) {
      case 'path':
        fragments.push(cf`const ${name} = ${req_var}.params[${ts_string(parameter.name)}];\n`)
        break
      case 'query':
        fragments.push(cf`const ${name} = ${req_var}.query[${ts_string(parameter.name)}];\n`)
        break
      case 'header':
        fragments.push(cf`const ${name} = ${req_var}.get(${ts_string(parameter.name)});\n`)
        break
      case 'cookie':
        fragments.push(cf`const ${name} = ${req_var}.cookies[${ts_string(parameter.name)}];\n`)
        break
      default:
        assertUnreachable(parameter)
    }

    /* if required and missing, return error */
    if (parameter.required) {
      fragments.push(cf`if (${name} === undefined) {\n`)
      fragments.push(cf`${res_var}.status(400);\n`)
      fragments.push(cf`${res_var}.format(`)
      fragments.push(...map_to_ts_object([
        // TODO TODO TODO
        // The user (of the generator) should be able to insert formats here.
        // This should preferably be driven by the OpenAPI schema
        [
          'default',
          [cf`() => {
          ${res_var}.type('text').send(
          'Required parameter "' + ${JSON.stringify(parameter.name)} + '" absent from request.'
          )
          }`]
        ]
      ]))
      fragments.push(cf`);\n`) /* end res.format */
      fragments.push(cf`return; }`)
    }

    // if optional and missing, continue
    if (!parameter.required) {
      fragments.push(cf`if (${name} !== undefined) {\n`)
    }

    if (parameter.in === 'query') {
      // TODO check if schema allows a parameter to appear multiple times.
      // If it does, fail here during generation with a NotImplemented error.

      // TODO TODO TODO make error customizable
      fragments.push(cf`if (typeof ${name} !== 'string') {
        ${res_var}
          .status(400)
          .type('text')
          .send(
            'bad request, query parameter "'
            + ${JSON.stringify(parameter.name)}
            + '" malformed '
            + '(has it been given multiple times?)')
        return
      } `)
    }

    /* parse it according to its schema, add ${name} to handler_args */
    /* Note that the parameter is already uri-decoded (meaning that we
    have "real" character, nstead of percent escapes) */
    fragments.push(
      cf`try {
        \n`,
      cf`${handler_args_var}[${ts_string(parameter.name)}] = `,
      ...unpack_parameter_expression({
        header_field: name,
        header: parameter,
        generator_common_symbol: args.generator_common_symbol,
        validators_symbol: args.validators_symbol,

        gensym: args.gensym,
        string_formats: args.string_formats,
        document: args.document,
      }),
      cf`; \n`,
      cf`} catch (e: unknown) {
        if (!(e instanceof Error)) {
          throw e
        }
        if (e.name === 'SyntaxError') {
          ${res_var}.status(400)
            .type('text')
            .send('Failed parsing body\\n' + e.message)
          return
        }
        if (e.name === 'APIMalformedError') {
          ${res_var}.status(400)
            .type('text')
            .send(\`Invalid object in \${(e as any).location}\\n\${(e as any).message}\`)
          return
        }
        throw e;
      }`)

    if (!parameter.required) {
      fragments.push(cf`}\n`)
    }
  }

  if ('requestBody' in args.operation) {
    fragments.push(...handle_request_body_payload({
      body: resolve(args.operation.requestBody!, args.document),
      req_var: req_var,
      res_var: res_var,
      handler_args_var: handler_args_var,
      validators_symbol: args.validators_symbol,
      gensym: args.gensym,
      document: args.document,
      string_formats: args.string_formats,
    }))
  }

  /* Handling request parameters and body now done, actually run the
  business logic (which may further check request parameters and
  body). */

  /* Casting to `any` is ugly, but TypeScript doesn't realize that we
  have a complete type otherwise. This must be accompanied with proper
  testing of the generator (and the generated code), to ensure we
  always have a complete set of arguments. */
  const result_var = args.gensym('result')
  fragments.push(cf`const ${result_var} = await ${handler_parameter_var}(
    ${handler_args_var} as any,
    ${req_var}
  );\n`)

  /* Start packing response */

  fragments.push(cf`${res_var}.status(${result_var}.status);\n`)

  fragments.push(cf`switch (${result_var}.status) {\n`)
  for (const [status, response_] of Object.entries(args.operation.responses)) {
    const response = resolve(response_, args.document);
    fragments.push(cf`case ${status}:\n`);

    if ('headers' in response) {
      for (const [header, type_] of Object.entries(response.headers!)) {
        const type = resolve(type_, args.document)

        fragments.push(cf`{`)

        const header_var = args.gensym('header')
        fragments.push(cf`const ${header_var} = ${result_var}[${ts_string(header)}];\n`)


        if (!type.required) {
          fragments.push(cf`if (${header_var} !== undefined) {\n`)
        }

        {
          const pair_var = args.gensym('pair')
          fragments.push(
            cf`for (const ${pair_var} of `,
            ...pack_parameter_expression(
              result_var, { ...type, in: 'header', name: header },
              args.gensym, args.string_formats, args.document),
            cf` as [string, string][]) {
            ${res_var}.append(${pair_var}[0], ${pair_var}[1])
        }`)
        }

        if (!type.required) {
          fragments.push(cf`}`) /* end if (header !== undefined) */
        }

        fragments.push(cf`}`)
      }
    }

    if ('content' in response) {

      const cases: [string, CodeFragment[]][] = []

      const body_var = args.gensym('body')

      for (const alternative of handle_request_body({
        bodies: response.content!,
        body_required: true,
        source_param: body_var,
        types_symbol: args.types_symbol,
        string_formats: args.string_formats,
        document: args.document,
      })) {
        const ctype = ts_string(alternative.content_type,)
        cases.push([
          alternative.content_type,
          [
            cf`() => {\n`,
            cf`const ${body_var} = ${result_var}[${ctype}]();\n`,
            // NOTE `Result.format` automatically adds the content
            // type header which matched. This means we can skip doing
            // it explicitly.
            // cf`res.type(${ctype});\n`,
            cf`${res_var}.send(`, ...alternative.pack_expression, cf`);\n`,
            cf`}`,
          ]
        ])
      }


      // TODO allow for async functions here.
      fragments.push(
        cf`${res_var}.format(`,
        ...map_to_ts_object(
          [...cases, [
            'default',
            [cf`() => {
                ${res_var}
                .status(406 /* Not Acceptable */)
                .type('text')
                .send('Not Acceptable')
              }`],
          ]]),
        cf`)\n`, /* end res.format */
      )
    } else {
      /* No content in response */
      fragments.push(cf`${res_var}.send();\n`)
    }

    /* return at end of each case */
    fragments.push(cf`return\n`)
  }

  fragments.push(cf`}\n`) /* end switch (result.status) */

  fragments.push(cf`}}`)
  return fragments
}

/**
Format an operation object into a TypeScript fragment evaluating to a
type literal describing the type of the user supplied handler which
should be passed to the function generated by
`format_operation_as_server_endpoint_handler`.

The returned type will be on the general form
```
(args: (parameters) & (body1 | body2))
    => Promise<{ status: 200, 'application/json': () => JSON } | ...>
```

- `parameters` is a record from parameter name to parameter value,
  regardless of where they appeared (this means that parameters can't
  share name, even when present in different parts of the request).
- Each body will be on the form
  `{ content_type: "application/json", body: ActualType }`

This allows the eventual function to easily get the parameters it
needs. If only a single body type is present, then the content_type
can generally be ignored, otherwise, it's a perfect discriminator.

Each return value specifies the status code, all response headers as
keys, and finally each possible body type. Bodies are defered (by
wrapping them in functions). This is so only the type choosen by the
content type negotiation is actually renedered.

@param args.types_symbol
Symbol the generated type library is imported under.

@param args.express_symbol
Symbol the express library is importend under.
 */
function format_operation_as_server_endpoint_handler_type(args: {
  operation: Operation,
  shared_parameters: Parameter[],
  types_symbol: string,
  express_symbol: string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): CodeFragment[] {

  const local_parameters = (args.operation.parameters ?? [])
    .map(x => resolve(x, args.document))
  const all_parameters = args.shared_parameters.concat(local_parameters)

  // NOTE It's would be preferable to check that the declared path
  // parameters are an exact match with the one provided in the path
  // placeholder here. !PATH_PLACEHOLDER!
  // all_parameters.filter(p => p.in === 'path').map(p => p.name)

  const common_function_parameters: ObjectField[] = []
  for (const parameter of all_parameters) {
    const type = format_parameter(parameter, args.types_symbol, args.string_formats, args.document)
    if (!type) continue
    common_function_parameters.push(type)
  }


  const body_parameters: CodeFragment[][] = []
  if (args.operation.requestBody) {

    const request_body = resolve(args.operation.requestBody, args.document)

    for (const [content_type, description] of Object.entries(request_body.content)) {
      body_parameters.push(object_to_type([
        {
          name: 'content_type',
          type: [new CodeFragment(ts_string(content_type))],
        },
        {
          name: 'body',
          type: request_body_to_serializer_input_type({
            schema: description.schema,
            content_type: content_type,
            types_symbol: args.types_symbol,
            string_formats: args.string_formats,
            document: args.document,
          }),
        },
      ]))
    }
  }

  const all_results: CodeFragment[][] = []

  for (const [status, response_] of Object.entries(args.operation.responses)) {
    if (status === 'default') {
      console.warn('`default` response not implemented, ignoring')
      continue
    }

    const results: ObjectField[] = []

    results.push({
      name: 'status',
      type: [new CodeFragment(status)],
    })

    const response = resolve(response_, args.document)

    if ('links' in response) {
      console.warn('Response links ignored')
    }

    if ('headers' in response) {
      results.push(...Object.entries(response.headers!)
        .map(([name, type]) =>
          format_parameter(
            { ...resolve(type, args.document), name: name, in: 'header' },
            args.types_symbol, args.string_formats, args.document))
        .filter(x => x !== null))
    }

    /*
    The body types here are all "thunk returning true type". This is
    since an endpoint may return multiple content types, but due to
    content negotiation we only want to render the one the client
    actually requested, instead of all of them.

    TODO make the thunk wrapper automatic, instead of manually writing
    it for each clause.
     */
    if ('content' in response) {
      for (const [content_type, media] of Object.entries(response.content!)) {
        switch (content_type) {
          // TODO match `text/*` here
          case 'text/plain':
          case 'text/html':
            results.push({
              name: content_type,
              type: [cf`() => string`],
            })
            break

          case 'application/json':
            if ('schema' in media) {
              results.push({
                name: content_type,
                type: [cf`() => `, ...schema_to_typescript(
                  resolve(media.schema!, args.document),
                  `${args.types_symbol}.`,
                  args.string_formats,
                  args.document)
                ],
              })
            } else {
              // TODO TODO ensure type `Json` actually exists
              results.push({
                name: content_type,
                type: [cf`() => Json`],
              })
            }
            break

          default:
            console.warn(`Unknown content type for response: ${content_type}.`)
            results.push({
              name: content_type,
              type: [cf`() => ArrayBuffer`],
            })
        }
      }
    }

    all_results.push(object_to_type(results))
  }

  const result_fragment = join_fragments(cf` | `, all_results)

  /**
  { ...params } & ({ content_type: 'application/json', body: bodyType } | ...)
   */
  const function_parameters: CodeFragment[] =
    body_parameters.length === 0
      ? object_to_type(common_function_parameters)
      : [
        cf`(`, ...object_to_type(common_function_parameters),
        cf`) & (`, ...join_fragments(cf` | `, body_parameters), cf`)`
      ]

  return [cf`(args: `,
  ...function_parameters,
  cf`, req: ${args.express_symbol}.Request`,
  cf`) => Promise<`, ...result_fragment, cf`>`]
}



/**
Calculate the type of the payload for a request, depending on content
type.

For known content types, the returned content type will be that exact string.
However, for unknown content types, this will instead be 'string' (in
place of <*>/<*>). This allows the eventuall user of the binding to
actually check it during runtime.
 */
function return_body_type(
  content: { [k: string]: MediaType },
  types_symbol: string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): ({
  content_type: string,
  body_type: CodeFragment[],
})[] {

  return Object.entries(content).map(([mime, body]) => {
    switch (mime) {
      case 'text/plain':
        return {
          content_type: ts_string('text/plain'),
          body_type: [cf`string`],
        }

      case 'application/json':
        if (!('schema' in body)) return null
        return {
          content_type: ts_string('application/json'),
          body_type: schema_to_typescript(
            body.schema!, `${types_symbol}.`, string_formats, document),
        }

      default:
        console.warn(`Unhandled content type "${mime}", defering resolution to runtime`)
        return {
          content_type: 'string',
          body_type: [cf`ArrayBuffer`],
        }
    }
  }).filter(x => x !== null)
}


/**
Calculate a single return type for a function.

The result will be a tuple, containing
- the HTTP status codes as a literal
- a body field if request returns a body
- a header fields if request specifies any headers

@param types_symbol
Symbol the generated type library is imported under.
 */
function get_return_type(
  status: string,
  response_: Reference | Response,
  security: SecurityRequirement[],
  types_symbol: string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] | null {
  if (status === 'default') throw new NotImplemented(`Response status 'default'`)

  const response = resolve(response_, document)

  /* The request state machine handles Unauthorized
  internally, meaning that it can never be returned to
  this level.

  TODO document this properly.
   */
  if (is_authenticated(security) && status === '401') return null

  const responses: Record<string, CodeFragment[]>[] = []

  /*
const responseType: Record<string, string> = {
  status: status,
}
   */

  if ('content' in response) {
    const body = return_body_type(
      response.content!, types_symbol, string_formats, document)

    if (body.length > 0) {
      for (const entry of body) {
        responses.push({
          status: [new CodeFragment(status)],
          content_type: [new CodeFragment(entry.content_type)],
          body: entry.body_type,
        })
      }
    }
  } else {
    responses.push({
      status: [new CodeFragment(status)],
    })
  }

  if ('headers' in response) {

    const header_type = object_to_type(Object.entries(response.headers!)
      .map(([name, spec]) => format_parameter(
        { ...resolve(spec, document), name: name, in: 'header' },
        types_symbol,
        string_formats, document,
      )).filter(x => x !== null))


    for (const response of responses) {
      response.headers = header_type
    }
  }


  return join_fragments(cf` | `,
    responses.map(response => object_to_type(
      Object.entries(response)
        .map(([name, type]) => ({
          name: name,
          type: type,
        })))))

}

/**
Generate code for packing request bodies.

TODO this is also used by the server to pack response bodies. Rename
this function.

@param args.bodies
Request (or Response) bodies.
This will most likely by `.content` of your `RequestBody` or `Response`
object.

@param args.body_required
Is the body required. For `RequestBody`, this is the `.required` field.
For responses, this should always be true.

@param args.source_param
TypeScript expression evaluating to the parsed form of the body.
Will be evaluated multiple times.

@param args.string_formats
@param agrs.document

@param args.types_symbol
Symbol which the generated types library is imported under.

@return
A list of structures, containing
- content_type: The content type string for the case (not escaped)
- type: The TypeScript type for the parsed version of the body.
- pack_expression: A TypeScript fragment packing the parsed form into
  a line-compatible form.

 */
function handle_request_body(args: {
  bodies: { [content_type: string]: MediaType },
  body_required: boolean,
  types_symbol: string,
  source_param: string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): {
  content_type: string,
  type: CodeFragment[],
  pack_expression: CodeFragment[],
}[] {

  const serializers = {
    'application/json': x => {
      const schema = args.bodies['application/json']!.schema
      if (schema === undefined) {
        return [cf`JSON.stringify(${x})`]
      } else {
        return [
          cf`JSON.stringify(`,
          ...schema_to_serializer(schema, args.document, args.string_formats, x),
          cf`)`,
        ]
      }
    },
    'application/x-www-form-urlencoded': x => {
      const schema = args.bodies['application/x-www-form-urlencoded']!.schema
      if (schema === undefined) {
        return [cf`(new URLSearchParams(${x})).toString()`]
      } else {
        return [
          cf`(new URLSearchParams(`,
          ...schema_to_serializer(schema, args.document, args.string_formats, x),
          cf`)).toString()`]
      }
    },
    'text/plain': x => [cf`${x}`],
    'application/binary': x => [cf`${x}`],
    'application/octet-stream': x => [cf`${x}`]
  } satisfies { [content_type: string]: (x: string) => CodeFragment[] }

  // TODO We here assume that only these content types will be returned.
  // We MUST send an `accept` header indicating this to the server.

  const result: ReturnType<typeof handle_request_body> = []

  for (const [content_type, description] of Object.entries(args.bodies)) {
    const type = request_body_to_serializer_input_type({
      schema: description.schema,
      content_type: content_type,
      types_symbol: args.types_symbol,
      string_formats: args.string_formats,
      document: args.document,
    })

    let serializer: (x: string) => CodeFragment[] = serializers[content_type as keyof typeof serializers]

    if (!serializer) {
      console.warn(`Generator don't know how to serialize "${content_type}", attempting sending it directly.`)
      serializer = (x: string) => [cf`${x}`]
    }

    result.push({
      content_type: content_type,
      type: type,
      pack_expression:
        args.body_required
          ? serializer(args.source_param)
          : [cf`${args.source_param} ? `,
          ...serializer(args.source_param),
          cf` : undefined`]
    })
  }

  return result
}

function request_body_to_serializer_input_type(args: {
  schema: Schema | Reference | undefined,
  content_type: string,

  types_symbol: string,

  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): CodeFragment[] {
  if (args.schema) {
    return schema_to_typescript(
      args.schema, `${args.types_symbol}.`,
      args.string_formats, args.document)
  } else {
    switch (args.content_type) {
      case 'text/plain':
        return [cf`string`]
      case 'application/json':
        return [cf`Json`]
      case 'application/binary':
      case 'application/octet-stream':
        return [cf`Buffer`]
      default:
        return [cf`unknown`]
    }
  }
}

function build_query_string(args: {
  path_template: string,
  include_query_parameters: boolean,
  query_parameters_var: string,
  prefix?: string,
}): CodeFragment[] {

  let s: string = ''

  if (args.prefix) {
    s += `url_concat(${args.prefix}, ${args.path_template}).href`
  } else {
    s += args.path_template
  }

  if (args.include_query_parameters) {
    s += `+ "?" + ${args.query_parameters_var}.toString()`
  }

  return [new CodeFragment(s)]
}


function params_to_object(
  param_object: string,
  parameters: Parameter[],
  gensym: (hint?: string) => string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec
): CodeFragment[] {
  const many_lists = parameters.map(
    p => pack_parameter_expression(param_object, p, gensym, string_formats, document))

  return [
    cf`Object.fromEntries([`,
    ...many_lists.flatMap(lst => [...lst, cf`,`]),
    cf`].flatMap(x => x)
    .map(([key, value]) => [key, encodeURIComponent(value)]))`
  ]
}


type ContentType = [type: string, subtype: string]
type NonEmpty<T> = [T, ...T[]]

/**
Check if a given clause matches the target content type.

@param clause
Type to check against the target.
Wildcards accept any value in target.

@param target
The content type we have. This should generally be a concrete type
(without wildcard). However, if wildcards are present, they will only
match if the clause also has a wildcard.

@example
```typescript
content_type_matches(text/html, text/html)
=> true
content_type_matches(text/*, text/<anything>)
=> true
content_type_matches(<*>/<*>, anything/here)
=> true
content_type_matches(text/*, text/*)
=> true
content_type_matches(text/plain, text/*)
=> false
```
 */
function content_type_matches(clause: ContentType, target: ContentType): boolean {
  if (target[0] === '*') return true
  if (clause[0] === target[0] && clause[1] === target[1]) return true
  if (clause[0] === target[0] && clause[1] === '*') return true
  return false
}

function match_content_type<T>(
  content_type: string,
  clauses: [
    key: ContentType | NonEmpty<ContentType>,
    proc: (content_type: ContentType) => T,
  ][],
): T | undefined {

  const ctype = content_type.split('/') as ContentType

  for (const [key, proc] of clauses) {
    /* we have a single key */
    if (typeof key[0] === 'string') {
      if (content_type_matches(key as ContentType, ctype)) {
        return proc(ctype)
      }
    } else {
      /* We have multiple keys */
      for (const k of key) {
        if (content_type_matches(k as ContentType, ctype)) {
          return proc(ctype)
        }
      }
    }
  }

}



/**
@param args.validators_symbol
Symbol the generated validators are imported under.
 */
function handle_request_body_payload(args: {
  body: RequestBody
  req_var: string,
  res_var: string,
  handler_args_var: string,
  validators_symbol: string,
  gensym: (hint?: string) => string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): CodeFragment[] {
  const fragments: CodeFragment[] = []
  // TODO body is `undefined` if no body is present.

  //      do stuff depending on if body is required
  if (!args.body.required) {
    throw new Error('Not implemented: Optional request bodies')
  }

  // TODO All error responses should be configurable

  const raw_body_var = args.gensym('raw_body')
  fragments.push(cf`const ${raw_body_var} = ${args.req_var}.body; \n`)
  fragments.push(cf`if (${raw_body_var} === undefined) {
      ${args.res_var}
        .status(400)
        .type('text')
        .send('Body required, but non provided')
    }`)

  fragments.push(cf`
    if (!(${raw_body_var} instanceof Buffer)) {
      throw new Error("Request body not a buffer object. This means that the server is misconfigured for the generated code. See documentation for the generator.")
    }
    `)


  // NOTE wildcard types MUST come after specific types. Possibly sort that here.
  for (const [content_type, content_info] of Object.entries(args.body.content)) {
    fragments.push(cf`if (${args.req_var}.is(${ts_string(content_type)})) {\n`)

    // TODO support other character encodings
    // https://developer.mozilla.org/en-US/docs/Web/API/Encoding_API/Encodings

    // TODO TODO TODO for all of these, send 400 responses as defined by the schema
    fragments.push(...match_content_type(content_type, [
      [['text', '*'], () => {
        const decoder_var = args.gensym('decoder')
        return [cf`
      const ${decoder_var} = new TextDecoder('utf8', { fatal: true });
      try {
        ${args.handler_args_var}.body = ${decoder_var}.decode(${raw_body_var});
        ${args.handler_args_var}.content_type = 'text/plain';
      } catch (e: unknown) {
        if (!(e instanceof Error)) {
          throw e
        }
        if (e instanceof TypeError && (e as any).code === 'ERR_ENCODING_INVALID_DATA') {
          ${args.res_var}.status(400)
            .type('text')
            .send('Request body not in specified character encoding (utf-8).')
          return
        }
        throw e
      }`]
      }],

      [[
        ['application', 'json'],
        ['application', 'x-www-form-urlencoded'],
      ], (content_type) => {
        const structured_body = 'structured_body'
        const fragments: CodeFragment[] = []
        const decoder_var = args.gensym('decoder')
        fragments.push(cf`
      const ${decoder_var} = new TextDecoder('utf8', { fatal: true });
      try {
        const ${structured_body} = ${content_type[1] === 'json'
            ? 'JSON.parse'
            : 'qs.parse'
          }(${decoder_var}.decode(${raw_body_var})); \n`)

        if ('schema' in content_info) {
          fragments.push(
            cf`${args.handler_args_var}.body = `,
            ...validate_and_parse_body({
              schema: content_info.schema!,
              body_var: structured_body,
              validators_symbol: args.validators_symbol,
              gensym: args.gensym,
              string_formats: args.string_formats,
              document: args.document,
            }),
            cf`;\n`)
        } else {
          fragments.push(cf`${args.handler_args_var}.body = ${structured_body}; \n`)
        }

        fragments.push(cf`
        ${args.handler_args_var}.content_type = ${ts_string(content_type.join('/'))};
      } catch (e: unknown) {
        if (!(e instanceof Error)) {
          throw e
        }
        if (e.name === 'TypeError' && (e as any).code === 'ERR_ENCODING_INVALID_DATA') {
          ${args.res_var}.status(400)
            .type('text')
            .send('Request body not in specified character encoding (utf-8).')
          return
        }
        if (e.name === 'SyntaxError') {
          ${args.res_var}.status(400)
            .type('text')
            .send('Failed parsing body as ${content_type.join('/')}: ' + e.message)
          return
        }
        if (e.name === 'APIMalformedError') {
          ${args.res_var}.status(400)
            .type('text')
            .send(\`Invalid object in \${(e as any).location}\\n\${(e as any).message}\`)
          return
        }
        throw e
      }`)

        return fragments
      }],

      [[
        ['application', 'binary'],
        ['application', 'octet-stream'],
      ], (content_type) => [cf`
        ${args.handler_args_var}.body = ${raw_body_var}
        ${args.handler_args_var}.content_type = ${ts_string(content_type.join('/'))};\n`
      ]],

      [['*', '*'], () => [cf`
        ${args.handler_args_var}.body = ${raw_body_var}
        ${args.handler_args_var}.content_type = ${args.req_var}.get('Content-Type').split(';', 1);\n`
      ]],
    ])!)

    fragments.push(cf`} else `)
  }

  /* else block */
  // TODO take error format from Spec
  fragments.push(cf`{
      ${args.res_var}
        .status(415 /* Unsupported Media Type */)
        .type('text')
        .send(\`Endpoint doesn't handle bodies of type '\${${args.req_var}.get('Content-Type')}'.\`)
        return
    }`)

  return fragments
}
