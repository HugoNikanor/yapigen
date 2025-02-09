export { main }

import * as YAML from 'yaml'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as prettier from 'prettier'
import type { OutputEntry } from './configuration'
import { parse_command_line } from './configuration'

import type {
  HttpsSpecOpenapisOrgOas30Schema20241018 as OpenAPISpec,
} from './openapi'

import {
  format_path_item_as_api_call,
  format_path_item_setup_server_router,
  format_path_item_as_server_endpoint_handlers,
  format_path_item_as_server_handler_types,
} from './formatters/path-item'
import { format_schema } from './formatters/schema'
import { format_type_validator, change_refs } from './formatters/validator'
import { resolve } from './json-pointer'
import { CodeFragment, cf } from './code-fragment'
import { ts_string } from './formatters/util'
import type { FormatSpec } from './json-schema-formats'
import { DEFAULT_STRING_FORMATS } from './json-schema-formats'
import package_json from '../package.json'
import * as crypto from 'node:crypto'


function preamble(f: string) {
  return path.join(__dirname, '..', 'preambles', f)
}


function strip_extension(filepath: string): string {
  return filepath.substring(0, filepath.length - path.extname(filepath).length)
}

function get_import_path(current: OutputEntry, other: OutputEntry): string {
  if (other.libname) return other.libname

  let import_path = path.relative(path.dirname(current.path), other.path)
  if (import_path[0] !== '.') {
    import_path = `./${import_path}`
  }
  import_path = strip_extension(import_path)

  return import_path
}


async function main(): Promise<number> {
  const configuration = await parse_command_line()

  if (!configuration) return 1

  const bytes = await fs.readFile(configuration.input, 'utf8')
  // TODO pass document through jsonschema's validator, ensuring
  // that it's at least ostensibly well-formed (a proper OpenAPI
  // validator is still recomended, to capture further semantic errors
  // in the document).
  const document = YAML.parse(bytes) as OpenAPISpec

  for (const output of Object.values(configuration.output)) {
    await fs.mkdir(path.dirname(output.path), { recursive: true })
  }

  const config_common = {
    prettify: configuration.prettify ?? true,
    include_source_locations: configuration.include_source_locations ?? false,
    generator_info: {
      version: package_json.version,
      schema_filename: configuration.input,
      schema_hash: crypto.hash('sha1', bytes)
    },
  } satisfies Partial<Parameters<typeof generate>[0]>

  /*
  TODO TODO TODO
  What is the expected behaviour if a given string can't be
  parsed/seralized to the expected value?
  - Should it throw an exception? Should it be a specific exception?
  - Should it continue with an invalid value?
  - Something else?
   */

  const string_formats: { [format: string]: FormatSpec } = {
    ...DEFAULT_STRING_FORMATS,
    ...(configuration.string_formats ?? {})
  }

  const string_format_imports: CodeFragment[] = Object.values(string_formats).flatMap(
    format => {
      if ('imports' in format) {
        return Object.entries(format.imports!)
          .map(([module, symbols]) =>
            cf`import { ${symbols.join(', ')} } from ${ts_string(module)};\n`,
          )
      } else { return [] }
    })

  /* "Generate" common declaration file */
  await generate({
    ...config_common,
    preamble_path: preamble('common.ts'),
    output_path: configuration.output.common.path,
    include_source_locations: false,
    content: [],
  })

  /* Generate file with type declarations */
  await generate({
    ...config_common,
    // preamble_path: preamble('types.ts'),
    output_path: configuration.output.types.path,
    content: (() => {
      /* If we have "free-standing" type declarations, include those into
      the output. Note that the result from other componens may reference
      these, so they are required */
      const schemas = document.components?.schemas
      if (!schemas) return []
      return string_format_imports.concat(
        Object.entries(schemas).flatMap(([name, schema]) =>
          format_schema(name, resolve(schema, document), string_formats, document)))
    })(),
  })

  {
    /* Generate type validators */
    const self = configuration.output.validators
    await generate({
      ...config_common,
      preamble_path: preamble('type-validators.ts'),
      output_path: self.path,
      content: (() => {
        const schemas = document.components?.schemas
        if (!schemas) return []
        const type_ns = 'APITypes'
        const validator = 'validator'

        const lines = []
        lines.push(
          cf`import { InvalidData } from ${ts_string(get_import_path(self, configuration.output.common))};\n`,
          cf`import type * as ${type_ns} from ${ts_string(get_import_path(self, configuration.output.types))};\n`,
          cf`import * as validators from ${ts_string(get_import_path(self, configuration.output.validators))};\n`,
        )

        for (const [key, value] of Object.entries(schemas)) {
          lines.push(cf`
validator.addSchema(
    ${JSON.stringify(change_refs(value as any))},
    ${ts_string(`/components/schemas/${key}`)});\n`)
        }

        lines.push(
          ...Object.entries(schemas).flatMap(([name, schema]) =>
            format_type_validator(
              {
                type_ns: type_ns,
                /* Defined in the preamble */
                validator: 'validator',
              },
              name, resolve(schema, document), document)))

        return lines
      })(),
    })
  }

  {

    /* Generate file with API calls */
    const self = configuration.output.calls
    await generate({
      ...config_common,
      preamble_path: preamble('calls.ts'),
      output_path: self.path,
      content: [

        cf`import {
            UnknownStatusCode,
            UnknownContentType,
            InvalidData,
            InternalRequestError,
        } from ${ts_string(get_import_path(self, configuration.output.common))};\n`,
        cf`import type * as types from ${ts_string(get_import_path(self, configuration.output.types))};\n`,
        cf`import * as validators from ${ts_string(get_import_path(self, configuration.output.validators))};\n`,

        ...string_format_imports,

        /** We assume that we have paths in the document.
        For each, generate a function which calls the underlying api call */
        ...Object.entries(document.paths)
          .flatMap(([path, body]) => format_path_item_as_api_call({
            path: path,
            body: body,
            default_security: document.security ?? [],
            string_formats: string_formats,
            document: document,
          })),
      ],
    })
  }

  {
    /* Generate server handler types */
    const self = configuration.output.server_handler_types
    await generate({
      ...config_common,
      preamble_path: preamble('server-types.ts'),
      output_path: self.path,
      content:
        [
          cf`import type * as types from ${ts_string(get_import_path(self, configuration.output.types))};\n`,
          ...string_format_imports,
          ...Object.entries(document.paths)
            .flatMap(([path, body]) =>
              format_path_item_as_server_handler_types({
                path: path,
                body: body,
                string_formats: string_formats,
                document: document,
              })),
        ],
    })
  }

  {
    /* Generate server handlers, and router */
    const self = configuration.output.server_router
    await generate({
      ...config_common,
      preamble_path: preamble('router.ts'),
      output_path: self.path,
      content: (() => {
        const result: CodeFragment[] = []

        result.push(cf`import * as handler_types from ${ts_string(get_import_path(self, configuration.output.server_handler_types))};\n`)
        result.push(cf`import * as validators from ${ts_string(get_import_path(self, configuration.output.validators))};\n`)
        result.push(cf`import * as generator_common from ${ts_string(get_import_path(self, configuration.output.common))};\n`)

        result.push(...format_path_item_setup_server_router(document.paths))

        result.push(...string_format_imports)

        for (const [path, body] of Object.entries(document.paths)) {
          result.push(
            ...format_path_item_as_server_endpoint_handlers(
              path, body, string_formats, document))
        }

        return result
      })(),
    })
  }

  console.log()

  return 0
}


async function generate(args: {
  preamble_path?: string,
  content: CodeFragment[],
  generator_info: {
    schema_filename: string,
    schema_hash: string,
    version: string,
  },
  output_path: string,
  prettify?: boolean,
  include_source_locations?: boolean,
}) {

  const frags: CodeFragment[] = []

  frags.push(cf`/*
  Code auto generated by yapigen ${args.generator_info.version},
  from source schema in ${path.relative(
    path.dirname(args.output_path),
    args.generator_info.schema_filename)},
  which have an SHA1 hash of ${args.generator_info.schema_hash}.
  (path relative to the directory of this file).

  LOCAL CHANGES WILL BE OVERWRITTEN.
  */\n`)

  if (args.preamble_path) {
    const preamble = await fs.readFile(args.preamble_path, 'utf-8')
    frags.push(new CodeFragment(preamble, {
      location: {
        path: path.basename(args.preamble_path),
        line: '1',
      }
    }))
  }

  frags.push(...args.content)

  const result = frags.map((frag) => frag.render({
    include_location: args.include_source_locations
      ? { destination_file: args.output_path } : undefined,
  })).join('')

  console.log('Writing', args.output_path)
  const outfile = await fs.open(args.output_path, 'w')
  if (args.prettify) {
    const pretty_result = await prettier.format(
      result, { parser: 'typescript' })
    outfile.write(pretty_result)
  } else {
    outfile.write(result)
  }
  await outfile.close()

}
