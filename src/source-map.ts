export type {
  RawSourceMap,
  FragmentInfo,
  LineInfo,
  SourceMap,
}

export {
  find_source_location,
  find_source_map_url,
  read_source_map,
  find_and_get_source_map,
}

import { decode as vlq_decode } from 'vlq'
import type { Schema } from './openapi'

import { zip } from '@todo-3.0/lib/util'
import { accumulate } from './util'

type FragmentInfo = {
  /* Index of first character of fragment in generated text */
  start: number,
  /* Width of fragment in generated text */
  width: number | undefined,
} & (
    |
    /* Fragment not mapping to any source, purely part of the generator */
    Record<never, never>
    | {
      /* Fragment maps to the following */

      file_idx_delta: number,
      line_delta: number,
      col_delta: number,
    }
  )

type LineInfo = FragmentInfo[]

/**
https://sourcemaps.info/spec.html
 */
type RawSourceMap = {
  version: 3,
  /* filename of generated file */
  file?: string,
  /* prefix to add to each source in sources which are not already absolute. */
  sourceRoot?: '',
  /* list of files used to generate this file, relative to the directory of this file */
  sources: string[],
  /*
  content of sources, if the creator of the map feared they
  couldn't be fetched by url.

If present, MUST be the same length as `.sources`, and each entry is
the content of the file named by the same index in `.sources`. A value
of `null` means that the source text MUST be fetched from the URL.
   */
  sources_content?: (string | null)[],
  names: string[],
  mappings: string,
} /* & { [x_proprties: string]: unknown } */


type SourceMap = {
  /** name of generated file */
  generated_file: string,

  /** list of files referenced by the map.
  mappings[].source_file_idx indexes this array.

  These have the prefix present in the raw source map pre-applied to
  them.

  If `source_map_path` was passed to `parse_source_map`, then these
  will be resolved according to that. Otherwise, they will be the raw
  values from the source map.
   */
  sources: Readonly<[string, 'relative' | 'absolute' | 'uri']>[],

  mappings: (({
    gen_start: number,
    gen_width: number | undefined,
  } & (
      | Record<never, never>
      | {
        source_file_idx: number,
        source_line: number,
        source_column: number,
      }
    ))[])[],
}


/**
Find the url to the a source map in the contents of a file, if present.

This just looks for a sourceMappingURL comment on the last (non-empty)
line, and return the url it finds there.

If not found, `null` is returned.
 */
function find_source_map_url(data: string): string | null {
  const lines = data.split('\n')
  let line_offset = -1
  while (true) {
    const line = lines.at(line_offset)
    if (!line) break
    if (line.trim() === '') {
      line_offset--
      continue
    }
    const m = line.match(/# sourceMappingURL=(\S+)/)
    if (m) {
      return m[1]
    }
  }
  return null
}


import * as path from 'node:path'
import * as fs from 'node:fs/promises'


async function fetch_raw_source_map(args: {
  source_map_location: string,
  source_file_location: Readonly<[string, 'absolute']>,
}): Promise<unknown> {
  try {
    const url = new URL(args.source_map_location)
    if (url.protocol === 'data:') {

      const m = url.pathname.match(/^application\/json;base64,(.*)/i)
      if (!m) {
        throw new Error('Can only read source maps from data urls if application/json and base64')
      }

      return JSON.parse(atob(m[1]))

    } else if (['http:', 'https:'].includes(url.protocol)) {

      throw new Error(`Fetching source maps over HTTP is disabled. Remove this error to enable it.`)

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed fetching source map from ${url.href}`)
      }

      return response.json()
    } else {
      throw new Error(`Unsuporrted URL protocol: ${url.protocol}`)
    }
  } catch (_) {
    /* source map url was not parsable as an url. This means
    it's a local path. */
    const resolved_path = path.resolve(
      path.dirname(args.source_file_location[0]),
      args.source_map_location)
    const source_map_bytes = await fs.readFile(resolved_path, 'utf8')
    return JSON.parse(source_map_bytes)
  }
}


const source_map_schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Schema for Source Map Revision 3 Proposal (https://sourcemaps.info/spec.html)',
  type: 'object',
  required: [
    'version',
    'sources',
    'names',
    'mappings',
  ],
  properties: {
    version: { type: 'number', const: 3 },
    file: {
      type: 'string',
      description: 'An optional name of the generated code that this source map is associated with.',
    },
    sourceRoot: {
      type: 'string',
      description: 'An optional source root, useful for relocating source files on a server or removing repeated values in the "sources" entry. This value is prepended to the individual entries in the "source" field.',
    },
    sources: {
      type: 'array',
      items: { type: 'string' },
      description: 'A list of original sources used by the "mappings" entry.',
    },
    sourcesContent: {
      type: 'array',
      items: {
        oneOf: [
          { type: 'string' },
          { type: 'null' },
        ],
      },
      description: 'An optional list of source content, useful when the "source" can\'t be hosted. The contents are listed in the same order as the sources in [.sources]. "null" may be used if some original sources should be retrieved by name.',
    },
    names: {
      type: 'array',
      items: { type: 'string' },
      description: 'A list of symbol names used by the "mappings" entry.',
    },
    mappings: {
      type: 'string',
      description: 'A string with the encoded mapping data',
    },
  },
} satisfies Schema


import { Validator } from 'jsonschema'


/**
Read and parse a source map.

On failure to read the data, or if the read data is on an invalid
form, an error is thrown.

@param args.source_map_location
Location of the source map. This can be
- an absolute path,
- a relative path (relative to `args.source_file_location`, which MUST
  be the generated text file in which the source map was found)
- a data uri with content type `application/json` and base64 encoding
  (other formats could be supported, but currently aren't)
- a http(s) URI

@param source_file_location
 */
async function read_source_map(args: {
  source_map_location: string,
  source_file_location: Readonly<[string, 'absolute']>,
}): Promise<SourceMap> {

  const raw_source_map = await fetch_raw_source_map(args)

  const validator = new Validator

  // console.log(raw_source_map)
  const result = validator.validate(raw_source_map, source_map_schema, { throwError: true })

  const source_map_path = (() => {
    try {
      new URL(args.source_map_location)
      return undefined
    } catch (_) {
      return [path.resolve(
        path.dirname(args.source_file_location[0]),
        args.source_map_location), 'absolute'] as const
    }

  })()

  return parse_source_map(
    result.instance as RawSourceMap,
    source_map_path,
  )
}


/**
From the path of a generated file, attempts to find a source map in
that file, and then retrieve it, and parse it.
 */
async function find_and_get_source_map(
  generated_file: Readonly<[string, 'absolute']>,
): Promise<SourceMap | null> {
  try {
    const bytes = await fs.readFile(generated_file[0], 'utf8')
    const url_string = find_source_map_url(bytes)

    if (!url_string) {
      return null
    } else {
      return await read_source_map({
        source_map_location: url_string,
        source_file_location: generated_file,
      })
    }
  } catch (e) {
    console.error(
      `Failed finding or parsing source map for "${generated_file[0]}":\n${String(e)}\n`)
    return null
  }
}


/**
Parses a source map in into a more usable format.

@see SourceMap

@param sourceMap
Raw source map.

@param source_map_path
The file the source map was read from. If present, then all paths in
`.sources` will resolved with this one as base.
 */
function parse_source_map(
  sourceMap: RawSourceMap,
  source_map_path?: Readonly<[string, 'absolute']>,
): SourceMap {
  const lines: LineInfo[] = []

  for (const line of sourceMap.mappings.split(';')) {
    if (line === '') {
      lines.push([{ start: 0, width: undefined }])
      continue
    }

    const fragments = line.split(',').map(fragment => vlq_decode(fragment)) as
      ([number] | [number, number, number, number])[]

    const string_locations = zip<number, number | undefined>(
      [0].concat(accumulate(fragments.map(fr => fr[0]))),
      (fragments.map(fr => fr[0]) as (number | undefined)[]).concat([undefined])
    )

    const source_locations = [[0]].concat(fragments).map(f => {
      if (f.length === 1) { return {} }
      else { return { file_idx_delta: f[1], line_delta: f[2], col_delta: f[3] } }
    })

    const result = zip(string_locations, source_locations)
      .map(([[start, width], source_data]) => ({
        start: start,
        width: width,
        ...source_data,
      } as FragmentInfo))
    lines.push(result)
  }

  type CurrentLocation = {
    file: number,
    line: number,
    column: number,
  }

  let location: CurrentLocation | undefined = undefined

  return {
    generated_file: sourceMap.file ?? '',
    sources: sourceMap.sources.map(s => {
      const source = (sourceMap.sourceRoot ?? '') + s
      try {
        new URL(source)
        return [source, 'uri']
      } catch (_) {
        if (source_map_path === undefined) {
          return [source, 'relative']
        }

        return [path.resolve(path.dirname(source_map_path[0]), source), 'absolute']
      }
    }),
    mappings: lines.map(line => line.map(fragment => {
      /* copy over already found generated location */
      const gen_location = {
        gen_start: fragment.start,
        gen_width: fragment.width,
      }

      let source_location: Record<never, never> | {
        source_file_idx: number,
        source_line: number,
        source_column: number,
      }

      /* if this fragment has a source location */
      if ('file_idx_delta' in fragment) {
        if (location === undefined) {
          location = {
            file: fragment.file_idx_delta,
            line: fragment.line_delta,
            column: fragment.col_delta,
          }
        } else {
          location.file += fragment.file_idx_delta
          location.line += fragment.line_delta
          location.column += fragment.col_delta
        }


        source_location = {
          source_file_idx: location.file,
          source_line: location.line,
          source_column: location.column,
        }

      } else {
        source_location = {}
      }

      return {
        ...gen_location,
        ...source_location,
      }
    })),
  }
}

/**

This works on 0 indexed line numbers.
 */
function find_source_location(
  sourceMap: SourceMap,
  args: { line: number, column: number },
): {
  file: Readonly<[string, 'absolute' | 'relative' | 'uri']>,
  line: number,
  column: number,
} | 'generator' | null {
  const line = sourceMap.mappings[args.line]
  for (const fragment of line) {
    if (args.column >= fragment.gen_start &&
      (
        (fragment.gen_width === undefined)
        || (args.column < fragment.gen_start + fragment.gen_width)
      )) {

      if ('source_file_idx' in fragment) {
        return {
          file: sourceMap.sources[fragment.source_file_idx],
          line: fragment.source_line,
          column: fragment.source_column,
        }
      } else {
        return 'generator'
      }
    }
  }
  return null
}
