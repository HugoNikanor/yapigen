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

@param args.generator_common_symbol
Symbol which the common generated library is imported under.

@param args.types_symbol
symbol which the generated types is imported under.

@param args.validators_symbol
Symbol the generated validators are imported under.
 */
function format_path_item_as_api_call(args: {
  path: string,
  body: PathItem,
  default_security: SecurityRequirement[],
  generator_common_symbol: string,
  types_symbol: string,
  validators_symbol: string,

  gensym: (hint?: string) => string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): CodeFragment[] {
  const parameters_object = args.gensym('path_parameters')

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
      default_security: args.default_security,
      generator_common_symbol: args.generator_common_symbol,
      types_symbol: args.types_symbol,
      validators_symbol: args.validators_symbol,

      gensym: args.gensym,
      string_formats: args.string_formats,
      document: args.document
    }), cf`\n`]
  }).filter(x => x)
}


/**
Return a number of function declarations. One for each method
implemented on this endpoint.

@param args.generator_common_symbol
Symbol which the common generated library is imported under.

@param args.types_symbol
Symbol the generated type library is imported under.

@param args.handler_types_symbol
Symbol the generated handler types are imported under.

@param args.validators_symbol
Symbol the generated validators are imported under.

@param args.express_symbol
Symbol the express library is importend under.
 */
function format_path_item_as_server_endpoint_handlers(args: {
  path: string,
  body: PathItem,
  generator_common_symbol: string,
  types_symbol: string,
  handler_types_symbol: string,
  validators_symbol: string,
  express_symbol: string,

  gensym: (hint?: string) => string,
  string_formats: { [format: string]: FormatSpec },
  document: OpenAPISpec,
}): CodeFragment[] {
  // We assume that all parameters have unique names
  // Even though two parameters with the same name could probably exist if they are inserted at different places

  const shared_parameters = 'parameters' in args.body
    ? args.body.parameters!.map(x => resolve(x, args.document))
    : []


  // summary and description for docstrings
  // parameters

  return operations.flatMap((op) => {
    if (args.body[op] === undefined) return []
    return [...format_operation_as_server_endpoint_handler({
      operation: args.body[op]!,
      shared_parameters: shared_parameters,
      generator_common_symbol: args.generator_common_symbol,
      types_symbol: args.types_symbol,
      handler_types_symbol: args.handler_types_symbol,
      validators_symbol: args.validators_symbol,
      express_symbol: args.express_symbol,

      gensym: args.gensym,
      string_formats: args.string_formats,
      document: args.document,
    }), cf`\n`]
  }).filter(x => x)
}


/**
@param args.types_symbol
symbol which the generated types is imported under.

@param args.express_symbol
Symbol the express library is importend under.
 */
function format_path_item_as_server_handler_types(args: {
  path: string,
  body: PathItem,
  types_symbol: string,
  express_symbol: string,
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
        types_symbol: args.types_symbol,
        express_symbol: args.express_symbol,
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

@param handler_types_symbol
Symbol the generated handler types are imported under.

@param express_symbol
Symbol the express library is importend under.
 */
function format_path_item_setup_server_router(
  paths: { [path: string]: PathItem },
  handler_types_symbol: string,
  express_symbol: string,
  gensym: (hint?: string) => string,
): CodeFragment[] {
  const fragments: CodeFragment[] = []

  const handler_args_var = gensym('handlers')

  fragments.push(cf`export function setup_router(${handler_args_var}: `)

  fragments.push(...object_to_type(
    Object.entries(paths).map(([path, item]) => ({
      name: path,
      type: object_to_type(operations.map(op => {
        if (op in item) {
          return {
            name: op,
            type: [cf`${handler_types_symbol}.${item[op]!.operationId!}`],
          }
        } else return false
      }).filter(x => x !== false))
    }))))

  fragments.push(cf`): ${express_symbol}.Router {\n`)
  const router_var = gensym('router')
  fragments.push(cf`const ${router_var} = ${express_symbol}.Router();\n`)
  fragments.push(cf`${router_var}.use(${express_symbol}.raw({ type: '*/*' }));\n`)

  for (const [path, item] of Object.entries(paths)) {
    for (const op of operations) {
      if (op in item) {
        const opid = item[op]!.operationId!

        const [fixed_path, _] = parse_uri_path(path, s => `:${s}`)

        fragments.push(
          cf`${router_var}.${op}(${fixed_path}, handle_${opid}(${handler_args_var}[${ts_string(path)}].${op}));\n`)
      }
    }
  }

  fragments.push(cf`return ${router_var};\n`)
  fragments.push(cf`}`) /* end router function */

  return fragments
}
