export {
  Configuration,
  parse_command_line,
  OutputEntry,
}

import * as path from 'node:path'
import * as YAML from 'yaml'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { Validator, ValidatorResult } from 'jsonschema'
import { FormatSpec, parse_string_format_spec } from './json-schema-formats.ts'
import type { Schema } from './openapi.ts'
import { expand_vars } from './expand-vars.ts'
import type { Json } from '@todo-3.0/lib/json'


/*
Configuration loading flow:

1. A base object, containing defaults for optional fields is presented
2. For each command line argument:
    - if it's `--config`:
        - load the file, and validate it against the partial
          configuration schema.
          - If it fails, throw on error and abort execution
          - if it succeeds, merge the result with our current configuration
    - If it's any other option:
      - Check that its a sensible type
      - Merge it into our current configuration
3. Once done, validate resulting configuration file against the
   required configuration schema.
4. Return a complete configuration object to the caller.

@module
 */

type OutputEntry = {
  path: string,
  libname?: string,
}

/**
Configuration structure for the program.
 */
type Configuration = {
  /* Read specification from this file. Required. */
  input: string,

  output: {
    types: OutputEntry,
    calls: OutputEntry,
    common: OutputEntry,
    validators: OutputEntry,
    server_handler_types: OutputEntry,
    server_router: OutputEntry,
  },

  /* TODO document these */
  standalone?: {
    eslint?: string,
    package?: string,
    tsconfig?: string,
  },

  /** Should we prettify the generated code */
  prettify?: boolean,

  /**
  Should the source code location for each generated fragment be
  included in the output? This makes code "harder" to read as code,
  but makes finding source of bugs (in the generator) much easier.
   */
  'include-source-locations'?: 'raw' | 'mapped',

  /**
  User defined string formats.

  JSON Schema allows a `format` specifier for string types. This
  object allows the user of the generator to add additional types.

  When inserting each fragment into the code as a CodeFragment,
  `location.path` on the fragment *should* be set to
  `"@string-format"`.
   */
  string_formats?: { [format: string]: FormatSpec },

  'gensym-seed'?: [number, number, number, number],
}




/*
type OpenAPItoTS<T extends string>
= T extends "string" ? string
: T extends "object" ? Record<string, any>
: T extends "boolean" ? boolean
: never
 */


const format_spec_function = {
  type: 'object',
  required: ['param', 'body'],
  parameters: {
    param: { type: 'string' },
    body: { type: 'string' },
  },
} satisfies Schema

const output_path = {
  type: 'object',
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      // examples: ['~/code/my-project/generated/filename.ts'],
      description: `Location where the generated file should appear`,
    },
    libname: {
      type: 'string',
      // examples: ['@my-module/filename'],
      description: `Module name the generated module can be
              imported by. May be used by the other generated
              files. If unset, then all imports will be relative.`,
    },
  },
} satisfies Schema

/**
Schema for configuration files, and almost for the configuration
structure.
 */
const configuration_schema_partial = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Configuration File Format for Alternative OpenAPI Generator',
  type: 'object',
  required: [
    'input',
    'output',
  ],
  properties: {
    input: {
      type: 'string',
      description: 'Path to input file, MUST be an OpenAPI specification',
    },
    output: {
      type: 'object',
      description: `Where the result should be placed.
      Note that this **will** overwrite any file already at that location.`,
      required: [
        'types',
        'calls',
        'common',
        'validators',
        'server_handler_types',
        'server_router',
      ],
      properties: {
        types: output_path,
        calls: output_path,
        common: output_path,
        validators: output_path,
        server_handler_types: output_path,
        server_router: output_path,
      },
    },
    'include-source-locations': {
      description: `If true, then source locations (in the generator)
      for each generated code fragment will be present in the output,
      as JavaScript comments.
      Defaults to no comments. But if present a value of "raw" means to output the location from teh file which actually generated the code (e.g. our transpiled JavaScript version), while "mapped" looks for source maps, bringing us back to the TypeScript source.`,
      oneOf: [
        {
          type: 'string',
          enum: ['raw', 'mapped'],
        },
        {
          type: 'boolean',
          const: false,
        },
      ]
    },
    prettify: {
      type: 'boolean',
      description: `If generated code should be ran through
      \`prettier\`. Defaluts to true.`,
    },
    'gensym-seed': {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: { type: 'integer' },
    },
    'string-formats': {
      type: 'object',
      patternProperties: {
        '.*': {
          type: 'object',
          required: [
            'parse',
            'serialize',
            'type',
            'imports',
          ],
          properties: {
            parse: format_spec_function,
            serialize: format_spec_function,
            instanceof: format_spec_function,
            type: { type: 'string' },
            imports: {
              type: 'object',
              patternProperties: {
                '.*': {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
    }
  },
} satisfies Schema

/*
Schema for our completed configuration type.

MUST validate `type Configuration` objects.
 */
const configuration_schema_required = {
  ...configuration_schema_partial,
  required: [
    'input',
    'output',
  ],
}

/**  Resolve a file path relative to a file

Paths starting with a slash (`/`) or tilde (`~`) are treated as
absolute, and the tilde is replaced with the users home directory.

@param config_file
The file the path was found in. Paths will be resolved relative to the
directory this file recides in.

@param filepath
Path found in file.
 */
function resolve_path(config_file: string, filepath: string) {
  if (filepath === '') return ''
  if (filepath[0] === '/') return filepath
  if (filepath[0] === '~') return path.join(os.homedir(), filepath.substring(1))
  return path.join(path.dirname(config_file), filepath)
}


async function load_configuration_file(
  base_filename: string,
  format?: '.yaml' | '.json',
): Promise<Partial<Configuration>> {
  const format_ = format ?? path.extname(base_filename)

  const parser = (() => {
    switch (format_) {
      case '.json':
        return (data: string) => JSON.parse(data)

      case '.yaml':
      case '.yml':
        return (data: string) => YAML.parse(data) as Json

      default:
        console.error(
          `Unknown configuration file extension ${format_}.\n`
          + `Ignoring file "${base_filename}"`)
        return null
    }
  })()

  if (parser === null) return {}

  const bytes = await fs.readFile(base_filename, 'utf8')
  const data = parser(bytes) as Partial<Configuration>

  {
    const validator = new Validator
    const result = validator.validate(data, configuration_schema_partial)

    if (!result.valid) {
      throw new Error(`Configuration file "${base_filename}" invalid:\n${format_validator_error(result)}`)
    }
  }

  if ('input' in data) {
    data.input = resolve_path(base_filename, data.input)
  }

  if ('standalone' in data && data.standalone !== undefined) {
    const x = data.standalone

    if ('eslint' in x && x.eslint !== undefined) {
      data.standalone.eslint = resolve_path(base_filename, expand_vars(x.eslint))
    }
    if ('package' in x && x.package !== undefined) {
      data.standalone.package = resolve_path(base_filename, expand_vars(x.package))
    }
    if ('tsconfig' in x && x.tsconfig !== undefined) {
      data.standalone.tsconfig = resolve_path(base_filename, expand_vars(x.tsconfig))
    }
  }

  if ('output' in data) {
    for (const output of Object.values(data.output)) {
      output.path = resolve_path(base_filename, expand_vars(output.path))
    }
  }

  return data
}

function format_validator_error(result: ValidatorResult): string {
  return result.errors
    .map((err) => {
      const path = err.path.map(s => `/${s}`).join('')
      return `- Object at "#${path}" ${err.message}.\n`
        + `  Got \`${JSON.stringify(err.instance)}\``
    })
    .join('\n')
}

type FormatSpecFunction = {
  param: string,
  body: string,
}

async function parse_command_line(
): Promise<Configuration | null> {
  let configuration: Partial<Omit<Configuration, 'output'>> & {
    output: Partial<Configuration['output']>,
    'string-formats'?: {
      [key: string]: {
        parse: FormatSpecFunction,
        serialize: FormatSpecFunction,
        instanceof: FormatSpecFunction,
        type: string,
        imports: {
          [key: string]: string[],
        }
      },
    }
  } = {
    output: {},
  }

  /* File format for next upcomming --configuration option.
  Usually not needed, since it checks file extensions. */
  let file_format: '.yaml' | '.json' | undefined = undefined

  const sourced_files: string[] = []

  for (let i = 2; i < process.argv.length; i++) {
    switch (process.argv[i]) {

      case '--conf-format': {
        const format = process.argv[++i]
        if (!['yaml', 'json'].includes(format)) {
          console.warn(`Unknown configuration file format: ${format}`)
          break
        }

        file_format = `.${format}` as Exclude<typeof file_format, undefined>

        break
      }

      case '--config': {
        const filename = process.argv[++i]
        configuration = {
          ...configuration,
          ...await load_configuration_file(filename, file_format)
        }
        sourced_files.push(filename)
        file_format = undefined
        break
      }

      case '--input':
        configuration.input = process.argv[++i]
        break

      case '--no-prettier':
        configuration.prettify = false
        break

      case '--include-source-locations':
        if (process.argv[i + 1] === 'raw') {
          i++
          configuration['include-source-locations'] = 'raw'
        } else {
          configuration['include-source-locations'] = 'mapped'
        }
        break

      case '--gensym-seed':
        configuration['gensym-seed'] = process.argv[++i].split(',').map(x => Number(x)) as [number, number, number, number]
        break

      default: {
        /* Handle all --output-<part> flags at once. */
        const m = process.argv[i].match(/^--output-(.*)/)
        if (m) {

          const known_properties = configuration_schema_partial
            .properties
            .output
            .properties

          if (!Object.keys(known_properties).includes(m[1])) {
            console.warn(`WARNING: No output of type '${m[1]}'`)
          }

          configuration.output[m[1] as keyof Configuration['output']] = { path: process.argv[++i] }

        } else {
          console.warn(`Unknown command line flag: ${process.argv[i]}`)
        }
      }
    }
  }

  const validator = new Validator
  const result = validator.validate(configuration, configuration_schema_required)

  // console.log('final configuration', configuration)

  if (!result.valid) {
    console.error('Errors encountered while validating configuration:')
    console.error(format_validator_error(result))
    console.error()
    if (sourced_files.length === 0) {
      console.error('Perhaps you want to specify a configuration file with `--config <filename>`?')
    } else {
      console.error('Please check your command line, and the following loaded files:')
      for (const f of sourced_files) {
        console.error(`- ${f}`)
      }
    }
    console.error()
    return null
  }

  /*
  We use `string-formats` (dash) for the "raw" data from the
  configuration. When we compile these to the data actually in use by
  the program, we change to `string_format` (underscore).
   */
  if ('string-formats' in configuration) {
    configuration.string_formats = Object.fromEntries(
      Object.entries(configuration['string-formats'])
        .map(([name, format]) => [
          name,
          parse_string_format_spec(format),
        ]))
    delete configuration['string-formats']
  }

  return configuration as Configuration
}


/** This validates that our Configuration type and our schema
declaration are in sync.

It explicitly forbids extra keys, to ensure that newly added keys to
`Configuration` are present in the schema.

NOTE that this isn't foolproof, and manual checks still needs to be
performed.
 */
function self_test() {
  const sample_config = {
    input: '',
    output: {
      types: { path: '' },
      calls: { path: '' },
      common: { path: '' },
      validators: { path: '' },
      server_handler_types: { path: '' },
      server_router: { path: '' },
    },
    standalone: {
      eslint: '',
      package: '',
      tsconfig: '',
    },
    prettify: true,
    'include-source-locations': 'mapped',
    'gensym-seed': [0, 0, 0, 0],
    string_formats: {},
  } satisfies Required<Configuration> /* TODO deep required */

  const validator = new Validator
  validator.validate(
    sample_config,
    configuration_schema_required,
    {
      allowUnknownAttributes: false,
      throwError: true,
    })
}

self_test()
