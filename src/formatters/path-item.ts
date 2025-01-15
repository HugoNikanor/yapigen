export {
  format_path_item_as_api_call,
  parse_uri_path,
  format_path_item_setup_server_router,
  format_path_item_as_server_endpoint_handlers,
  format_path_item_as_server_handler_types,
}

import type {
  PathItem,
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
  SecurityRequirement,
} from '../openapi'

import {
  format_operation_api_call,
  format_operation_as_server_endpoint_handler,
  format_operation_as_server_endpoint_handler_type,
  operations,
} from './operation'
import { resolve } from '../json-pointer'

import { CodeFragment, cf } from '../code-fragment'
import {
  ts_string,
  object_to_type,
  parse_uri_path,
} from './util'
import type { FormatSpec } from '../json-schema-formats'

/**
Generate API call functions from a PathItem.

Will return a TypeScript fragment containing multiple functions, one
for each method in the PathItem object.

@example
```
format_path_as_api_call(
    '/example',
    { get: ... },
    document,
)
⇒ // TODO result
```
 */
function format_path_item_as_api_call(args: {
  path: string,
  body: PathItem,
  default_security: SecurityRequirement[],
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): CodeFragment[] {
  const parameters_object = 'path_parameters'

  // TODO path_placeholders should be passed to format_operation_api_call,
  // in that function, we will have a complete set of parameter declarations.
  // The set of parameters specified to be present in path, and the
  // set of path placeholders, MUST BE AN EXACT MATCH.
  // !PATH_PLACEHOLDER!
  const [path_template, path_placeholders]
    = parse_uri_path(args.path, (s) => `\${${parameters_object}[${ts_string(s)}]}`)

  // We assume that all parameters have unique names
  // Even though two parameters with the same name could probably exist if they are inserted at different places

  const shared_parameters = 'parameters' in args.body
    ? args.body.parameters!.map(x => resolve(x, args.document))
    : []


  // summary and description for docstrings
  // parameters

  return operations.flatMap((op) => {
    if (args.body[op] === undefined) return []
    return [...format_operation_api_call({
      op: op,
      operation: args.body[op]!,
      shared_parameters: shared_parameters,
      path_template: path_template,
      parameters_object: parameters_object,
      string_formats: args.string_formats,
      default_security: args.default_security,
      document: args.document
    }), cf`\n`]
  }).filter(x => x)
}


/**
Return a number of function declarations. One for each method
implemented on this endpoint.
 */
function format_path_item_as_server_endpoint_handlers(
  path: string,
  body: PathItem,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
): CodeFragment[] {
  // We assume that all parameters have unique names
  // Even though two parameters with the same name could probably exist if they are inserted at different places

  const shared_parameters = 'parameters' in body
    ? body.parameters!.map(x => resolve(x, document))
    : []


  // summary and description for docstrings
  // parameters

  return operations.flatMap((op) => {
    if (body[op] === undefined) return []
    return [...format_operation_as_server_endpoint_handler({
      operation: body[op]!,
      shared_parameters: shared_parameters,
      string_formats: string_formats,
      document: document,
    }), cf`\n`]
  }).filter(x => x)
}


function format_path_item_as_server_handler_types(args: {
  path: string,
  body: PathItem,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): CodeFragment[] {

  const shared_parameters = (args.body.parameters ?? [])
    .map(x => resolve(x, args.document))

  // for each operation in the path item
  // generate a type
  // `export type ${operationId} = ${generated_type}`
  // ("cheap" names ok, since these live in their own module)

  const result: CodeFragment[] = []
  for (const op of operations) {
    if (op in args.body) {
      result.push(cf`export type ${args.body[op]!.operationId!} = `)
      result.push(...format_operation_as_server_endpoint_handler_type({
        operation: args.body[op]!,
        shared_parameters: shared_parameters,
        string_formats: args.string_formats,
        document: args.document,
      }))
      result.push(cf`;\n`)
    }
  }
  return result
}

/**
Takes the set of ALL path items in the schema, and returns a
TypeScript fragment which declares a function called `setup_router`,
which creates and sets up an express.js router with all paths
accounted for.

The function requires a user supplied callback for EACH possible
endpoint, which MUST actually do the operation. This is checked on a
type level. Types are imported from the module configured in
`output.server_handler_types`.

This router expects a number of functions to be present locally in the
same module as it. These should be called `handle_${operationId}`.
See `format_path_item_as_server_endpoint_handlers`.
 */
function format_path_item_setup_server_router(
  paths: { [path: string]: PathItem },
): CodeFragment[] {
  const fragments: CodeFragment[] = []

  fragments.push(cf`export function setup_router(handlers: `)

  fragments.push(...object_to_type(
    Object.entries(paths).map(([path, item]) => ({
      name: path,
      type: object_to_type(operations.map(op => {
        if (op in item) {
          return {
            name: op,
            type: [cf`handler_types.${item[op]!.operationId!}`],
          }
        } else return false
      }).filter(x => x !== false))
    }))))

  fragments.push(cf`): Router {\n`)
  fragments.push(cf`const router = Router();\n`)
  fragments.push(cf`router.use(express.raw({ type: '*/*' }));\n`)

  for (const [path, item] of Object.entries(paths)) {
    for (const op of operations) {
      if (op in item) {
        const opid = item[op]!.operationId!

        const [fixed_path, _] = parse_uri_path(path, s => `:${s}`)

        fragments.push(
          cf`router.${op}(${fixed_path}, handle_${opid}(handlers[${ts_string(path)}].${op}));\n`)
      }
    }
  }

  fragments.push(cf`return router;\n`)
  fragments.push(cf`}`) /* end router function */

  return fragments
}
