export {
  CodeFragment,
  cf,
  join_fragments,
}

import * as path from 'node:path'
import { concat, intersperse } from './util'
import type { SourceMap } from './source-map'
import {
  find_source_location,
  find_and_get_source_map,
} from './source-map'
import { assertUnreachable } from '@todo-3.0/lib/unreachable'

/**
Representations of fragments of code.

This allows (automatic) attaching of where arbitrary strings fragments
where generated.

@module
 */

type Location = {
  /** Absolute path to the source file which generated this fragment */
  path?: [string, 'absolute' | 'magic'],
  /** 1-indexed line number into .path */
  line?: number
  /** 0-inedxed column number into .path[.line] */
  column?: number
}


/**
A text fragment, tagged with where it was generated.
 */
class CodeFragment {

  #fragment: string
  #location: Location | undefined

  static source_maps: Map<
    string,
    SourceMap | null
  > = new Map

  /**
  @param fragment
  The actuall contents of the fragment.

  @param args.error
  The way of obtaining the source location depends on the top of the
  stack looking like
  - `new CodeFragment`
  - *source location*.

  If some form of pre-processing is needed, then the pre-processing
  function can save it's stack trace (by calling `new Error`) when the
  *source location* is at the second top position in the stack, and
  then pass it here.

  @param args.location
  Manuall override for source location. If this is present, the call
  stack is completely ignored.
   */
  constructor(
    fragment: string,
    args: {
      error?: Error,
      location?: Location,
    } = {}
  ) {
    this.#fragment = fragment

    const e = args.error ?? new Error

    if (args.location) {
      this.#location = args.location
    } else {

      /*
      NOTE, Error.stack is only semi-standard, but will probably
      become standard at one point.

      This also means that the format of the stack trace is completely
      non-standard. This assumes the format V8 uses as of 2025-01-15.
       */
      if ('stack' in e) {
        const trace = e.stack!.split('\n').slice(1)

        const m = trace[1].match(/ *at (?<fun>(new )?\S+ )?\(?(?<path>[^:]+):(?<line>\d+):(?<column>\d+)\)?/)

        /*
      if (m?.groups?.path === undefined) {
        console.warn('Failed resolving source location of fragment. Trace:')
        console.warn(e.stack!)
      }
         */

        this.#location = {}
        if (m?.groups?.path) {
          this.#location.path = [m.groups.path, 'absolute']
        }

        const line = Number(m?.groups?.line)
        if (!isNaN(line)) {
          this.#location.line = line
        }

        const column = Number(m?.groups?.column)
        if (!isNaN(column)) {
          this.#location.column = column
        }
      }
    }
  }

  /**
  Render this fragment into an actuall string.


  @param args.include_location
  If this is true, then a block comment containing the source location
  wil be inserted after the fragments text. Otherwise, the fragments
  text will be returned as is.

  The source location may be passed through source maps. If that happens, the path will be "quoted".
   */
  async render(args: {
    include_location?: {
      generated_file: string,
      format: 'raw' | 'mapped',
    },
  }): Promise<string> {
    let result = this.#fragment
    if (args.include_location) {
      // const file = path.basename(this.#location?.path ?? '?')

      /* Source location to output
      These fields may be overwritten if we have a source map.
       */
      let file: string
      if (this.#location?.path) {
        switch (this.#location.path[1]) {
          case 'absolute':
            file = path.relative(
              path.dirname(args.include_location.generated_file),
              this.#location.path[0])
            break
          case 'magic':
            file = this.#location.path[0]
            break
          default:
            assertUnreachable(this.#location.path[1])
        }
      } else {
        file = 'X'
      }
      let line = this.#location?.line ?? 'X'
      let column = this.#location?.column ?? 'X'

      if (args.include_location.format === 'mapped'
        && this.#location
        && this.#location.path
        && this.#location.path[1] === 'absolute'
        && this.#location.line
        && this.#location.column
      ) {

        // open and read this.#location.path
        // if it contains a source map, do all this
        // otherwise, do as we did before

        let source_map = CodeFragment.source_maps
          .get(this.#location.path[0])

        // console.log(CodeFragment.source_maps)

        if (source_map === undefined) {
          // console.log(`Fetching source map for ${this.#location.path}`)

          source_map = await find_and_get_source_map(
            /* We check for 'absolute' tag above. */
            this.#location.path as [string, 'absolute']
          )
          CodeFragment.source_maps.set(this.#location.path[0], source_map)
        }

        if (source_map === null) {
          /* We don't have a source map. Continue with the source
          location in the actual file. */
        } else {

          const fragment = find_source_location(source_map, {
            line: this.#location.line - 1,
            column: this.#location.column,
          })

          if (fragment === 'generator' || fragment === null) {
            /* The given location either couldn't be found in the
            source file (`null`), or it was created by the generator
            (`"generator"`). Keep the location in the actual file. */
          } else {
            if (fragment.file[1] === 'absolute') {
              file = `"${path.relative(
                path.dirname(args.include_location.generated_file),
                fragment.file[0],
              )}"`
            } else {
              file = `${fragment.file[0]}`
            }
            line = fragment.line + 1
            column = fragment.column
          }
        }
      }

      result += `/* ${file}:${line}:${column} */`
    }
    return result
  }
}

/**
String template for generating code fragments.

Contents are handled just as if a regular string fragment was used.
 */
function cf(
  template: TemplateStringsArray,
  ...args: unknown[]
): CodeFragment {

  let result = template[0]

  for (let i = 0; i < args.length; i++) {
    result += `${args[i]}${template[i + 1]}`
  }

  return new CodeFragment(result, { error: new Error })
}

/**
Combine a number of code fragment lists into a flat list of code fragments.

@param combiner
Item to add between each value in fragments.

@param fragments
A list of code fragment lists. This needs to be a list of lists, since
most functions return lists of fragments, and we want to insert the
delimiters between each returned value.
 */
function join_fragments(
  combiner: CodeFragment,
  fragments: CodeFragment[][],
): CodeFragment[] {
  return concat(intersperse([combiner], fragments))
}
