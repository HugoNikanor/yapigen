export { main }

import * as YAML from 'yaml'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as prettier from 'prettier'
import type { OutputEntry, Configuration } from './configuration'
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
import { format_type_validator, change_refs, SchemaLike } from './formatters/validator'
import { resolve } from './json-pointer'
import { CodeFragment, cf } from './code-fragment'
import { ts_string } from './formatters/util'
import type { FormatSpec } from './json-schema-formats'
import { DEFAULT_STRING_FORMATS } from './json-schema-formats'
import package_json from '../package.json'
import * as crypto from 'node:crypto'
import { CountedSymbol } from './counted-symbol'


function preamble(f: string) {
  const filename = new URL(import.meta.url).pathname
  return path.join(path.dirname(filename),
    '..', 'preambles', f)
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

import { get_gensym } from './gensym'
import { sfc32, randseed } from './srand'

import { LocationIdentifier, get_here } from './formatters/util'

function import_star(args: {
  as: string,
  from: string,
  l: LocationIdentifier,
  type?: boolean,
}): CodeFragment {
  return new CodeFragment(
    `import ${args.type ? 'type' : ''} * as ${args.as} from ${ts_string(args.from)};\n`, { error: args.l.error },
  )
}


async function main(): Promise<number> {
  const start = new Date
  const configuration = await parse_command_line()

  if (!configuration) return 1

  console.log('Continuing with configuration:', configuration)

  const gensym_seed = configuration['gensym-seed'] ?? randseed()
  const gensym = get_gensym(sfc32(...gensym_seed))

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
    source_locations: configuration['include-source-locations'] ?? false,
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
        return Object.entries(format.imports)
          .map(([module, symbols]) =>
            cf`import { ${symbols.join(', ')} } from ${ts_string(module)}; \n`,
          )
      } else { return [] }
    })

  /* "Generate" common declaration file */
  await generate({
    ...config_common,
    preamble_path: preamble('common.ts'),
    output_path: configuration.output.common.path,
    source_locations: false,
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
      output_path: self.path,
      content: (() => {
        const schemas = document.components?.schemas
        if (!schemas) return []
        const type_ns = gensym('APITypes')
        const validators_symbol = gensym('validators')
        const validator_symbol = gensym('validator')
        const schema_validator_symbol = gensym('Validator')
        const schema_type_symbol = gensym('Schema')

        const lines = []
        lines.push(
          cf`import { APIMalformedError } from ${ts_string(get_import_path(self, configuration.output.common))}; \n`,
          import_star({
            as: type_ns,
            from: get_import_path(self, configuration.output.types),
            l: get_here(),
            type: true,
          }),
          import_star({
            as: validators_symbol,
            from: get_import_path(self, configuration.output.validators),
            l: get_here(),
          }),
          cf`import { Validator as ${schema_validator_symbol} } from 'jsonschema';\n`,
          cf`import type { Schema as ${schema_type_symbol} } from 'jsonschema';\n`,
          cf`const ${validator_symbol} = new ${schema_validator_symbol};\n`,
          cf`
/**
@throws APIMalformedError
 */
export function validate_type(
  body: unknown,
  schema: ${schema_type_symbol},
): true {
  const result = ${validator_symbol}.validate(body, schema)
  if (!result.valid) {
    throw new APIMalformedError(
      result.errors.map((err) => {
        const path = err.path.map(s => '/' + String(s)).join('')
        return \`Object at "#\${path}" \${err.message}.\\nGot \${JSON.stringify(err.instance)}.\`
      }).join('\\n\\n'))
  }

  return true
}
          `,
        )

        for (const [key, value] of Object.entries(schemas)) {
          lines.push(cf`
${validator_symbol}.addSchema(
  ${JSON.stringify(change_refs(value as SchemaLike))},
  ${ts_string(`/components/schemas/${key}`)});\n`)
        }

        lines.push(
          ...Object.entries(schemas).flatMap(([name, schema]) =>
            format_type_validator(
              {
                type_ns: type_ns,
                validator: validator_symbol,
              },
              name,
              validators_symbol,
              resolve(schema, document))))

        return lines
      })(),
    })
  }

  {

    /* Generate file with API calls */
    const self = configuration.output.calls
    const generator_common_symbol = new CountedSymbol(gensym('generator_common'))
    const types_symbol = new CountedSymbol(gensym('types'))
    const validators_symbol = gensym('validators')
    await generate({
      ...config_common,
      preamble_path: preamble('calls.ts'),
      output_path: self.path,
      content: [
        import_star({
          as: validators_symbol,
          from: get_import_path(self, configuration.output.validators),
          l: get_here(),
        }),

        ...string_format_imports,

        /** We assume that we have paths in the document.
        For each, generate a function which calls the underlying api call */
        ...Object.entries(document.paths)
          .flatMap(([path, body]) => format_path_item_as_api_call({
            path: path,
            body: body,
            default_security: document.security ?? [],
            generator_common_symbol: generator_common_symbol,
            types_symbol: types_symbol,
            validators_symbol: validators_symbol,
            gensym: gensym,
            string_formats: string_formats,
            document: document,
          })),


        ...(generator_common_symbol.count > 0
          ? [import_star({
            as: String(generator_common_symbol),
            from: get_import_path(self, configuration.output.common),
            l: get_here(),
          })]
          : []),

        ...(types_symbol.count > 0
          ? [import_star({
            as: String(types_symbol),
            from: get_import_path(self, configuration.output.types),
            l: get_here(),
            type: true,
          })]
          : []),

      ],
    })
  }

  {
    /* Generate server handler types */
    const self = configuration.output.server_handler_types
    const types_symbol = new CountedSymbol(gensym('types'))
    const express_symbol = gensym('express')
    await generate({
      ...config_common,
      output_path: self.path,
      content:
        [
          cf`import ${express_symbol} from 'express';\n`,
          cf`type Awaitable<T> = T | Promise<T>;\n`,
          ...string_format_imports,
          ...Object.entries(document.paths)
            .flatMap(([path, body]) =>
              format_path_item_as_server_handler_types({
                path: path,
                body: body,
                types_symbol: types_symbol,
                express_symbol: express_symbol,
                string_formats: string_formats,
                document: document,
              })),

          ...(types_symbol.count > 0
            ? [import_star({
              as: String(types_symbol),
              from: get_import_path(self, configuration.output.types),
              l: get_here(),
              type: true,
            })]
            : []),
        ],
    })
  }

  {
    /* Generate server handlers, and router */
    const self = configuration.output.server_router
    await generate({
      ...config_common,
      output_path: self.path,
      content: (() => {
        const result: CodeFragment[] = []

        const generator_common_symbol = new CountedSymbol(gensym('generator_common'))
        const types_symbol = new CountedSymbol(gensym('types'))

        const handler_types_symbol = gensym('handler_types')

        result.push(import_star({
          as: handler_types_symbol,
          from: get_import_path(self, configuration.output.server_handler_types),
          l: get_here(),
        }))

        const validators_symbol = gensym('validators')

        result.push(import_star({
          as: validators_symbol,
          from: get_import_path(self, configuration.output.validators),
          l: get_here(),
        }))


        const express_symbol = gensym('express')

        result.push(cf`import ${express_symbol} from 'express';\n`)

        const qs_lib_symbol = new CountedSymbol(gensym('qs'))

        result.push(...format_path_item_setup_server_router(
          document.paths, handler_types_symbol, express_symbol, gensym))

        result.push(...string_format_imports)

        for (const [path, body] of Object.entries(document.paths)) {
          result.push(
            ...format_path_item_as_server_endpoint_handlers({
              path: path,
              body: body,
              generator_common_symbol: generator_common_symbol,
              types_symbol: types_symbol,
              handler_types_symbol: handler_types_symbol,
              validators_symbol: validators_symbol,
              express_symbol: express_symbol,
              qs_lib_symbol: qs_lib_symbol,

              gensym: gensym,
              string_formats: string_formats,
              document: document,
            }))
        }

        if (generator_common_symbol.count > 0) {
          result.push(import_star({
            as: String(generator_common_symbol),
            from: get_import_path(self, configuration.output.common),
            l: get_here(),
          }))
        }

        if (types_symbol.count > 0) {
          result.push(import_star({
            as: String(types_symbol),
            from: get_import_path(self, configuration.output.types),
            l: get_here(),
            type: true,
          }))
        }

        if (qs_lib_symbol.count > 0) {
          result.push(cf`import * as ${qs_lib_symbol} from 'qs';\n`)
        }

        return result
      })(),
    })
  }


  if ('standalone' in configuration && configuration.standalone !== undefined) {
    const x = configuration.standalone
    if ('eslint' in x && x.eslint !== undefined) {
      await generate({
        prettify: false,
        generator_info: config_common.generator_info,
        preamble_path: preamble('eslint.js'),
        output_path: x.eslint,
        source_locations: false,
        content: [],
      })
    }

    if ('package' in x && x.package !== undefined) {
      const file = await fs.open(x.package, 'w')
      await file.write(JSON.stringify(OUTPUT_PACKAGE, null, 2))
      await file.write('\n')
      await file.close()
    }

    if ('tsconfig' in x && x.tsconfig !== undefined) {
      const file = await fs.open(x.tsconfig, 'w')
      await file.write(JSON.stringify(OUTPUT_TSCONFIG, null, 2))
      await file.write('\n')
      await file.close()
    }
  }



  console.log()

  /**
  Write generator data.
  This uses a relative file path, since multiple (or no) configuration
  files might have been used, leaving us without a proper "base".
   */
  await write_generator_data('.yapigen', {
    gensym_seed: gensym_seed,
    start: start,
    configuration: configuration,
  })

  return 0
}

/**
Write general data about the generator run.

This includes a list of files, time it took to run, etc...

@param outpath
Directory all files are created under.

@param args.gensym_seed
Seed used for the symbol generator.

@param args.start
Date when the generator started running. This should be a Date object
created on program start.

@param args.configuration
Final configuration used for the generator.
 */
async function write_generator_data(
  outpath: string,
  args: {
    gensym_seed: [number, number, number, number],
    start: Date,
    configuration: Configuration,
  }) {
  await fs.mkdir(outpath, { recursive: true })
  {
    const f = await fs.open(path.join(outpath, 'FILES'), "w")
    /* Include all "regular" source files */
    for (const { path: output_path } of Object.values(args.configuration.output)) {
      await f.write(path.join(process.cwd(), output_path))
      await f.write('\n')
    }

    /* Include all "weird" files */
    if (args.configuration.standalone) {
      if (args.configuration.standalone.eslint) {
        await f.write(path.join(process.cwd(), args.configuration.standalone.eslint))
        await f.write('\n')
      }
      if (args.configuration.standalone.package) {
        await f.write(path.join(process.cwd(), args.configuration.standalone.package))
        await f.write('\n')
      }
      if (args.configuration.standalone.tsconfig) {
        await f.write(path.join(process.cwd(), args.configuration.standalone.tsconfig))
        await f.write('\n')
      }
    }

    await f.close()
  }

  {
    const end = new Date
    const f = await fs.open(path.join(outpath, 'info.yaml'), "w")
    await f.write(YAML.stringify({
      gensym_seed: args.gensym_seed,
      start: args.start.toISOString(),
      end: end.toISOString(),
      time: end.valueOf() - args.start.valueOf(),
    }))
    await f.close()
  }

  {
    const f = await fs.open(path.join(outpath, '.gitignore'), 'w')
    await f.write('*\n')
    await f.close()
  }

  // Writing used configuration would be nice here. However, The
  // configuration contains non-serializable data, meaning that it's
  // not possible.
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
  source_locations: 'raw' | 'mapped' | false,
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
        path: [
          'preamble: ' + path.basename(args.preamble_path),
          'magic',
        ],
        line: 1,
      }
    }))
  }

  frags.push(...args.content)

  let result: string = ''

  for (const frag of frags) {
    result += await frag.render(
      args.source_locations
        ? {
          include_location: {
            generated_file: args.output_path,
            format: args.source_locations,
          }
        }
        : {}
    )
  }

  console.log('Writing', args.output_path)
  const outfile = await fs.open(args.output_path, 'w')
  if (args.prettify) {
    const pretty_result = await prettier.format(
      result, { parser: 'typescript' })
    await outfile.write(pretty_result)
  } else {
    await outfile.write(result)
  }
  await outfile.close()

}


// TODO most of these dependencies should be split depending on modules used.
const OUTPUT_PACKAGE = {
  scripts: {
    'build': 'tsc -b',
    'lint': 'eslint',
    // TODO doc?
  },
  dependencies: {
    'jsonschema': '^1.4.1',
    'express': '^4.21.1',
    // 'express-session': '^1.18.1',
    // TODO qs should only be required when actually used
    'qs': '^6.14.0',
    '@todo-3.0/request': '^0.1.0',
    '@todo-3.0/lib': '^0.1.0',
  },
  devDependencies: {
    /* Eslint */
    'eslint': '^9.20.1',
    'typescript-eslint': '^8.24.1',
    '@eslint/js': '^9.20.0',
    /* */
    '@types/express': '^5.0.0',
    // '@types/express-session': '^1.18.0',
  },
}

const OUTPUT_TSCONFIG = {
  compilerOptions: {
    outDir: './build',
    rootDir: '.',
    esModuleInterop: true,

    declaration: false,
    sourceMap: false,
    moduleResolution: 'bundler',
    target: 'es2021',
    module: 'es2022',
    strict: true,
    baseUrl: '.',
  },
}
