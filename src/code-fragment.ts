export {
  CodeFragment,
  cf,
  join_fragments,
}

import * as path from 'node:path'
import { concat, intersperse } from './util'

/**
Representations of fragments of code.

This allows (automatic) attaching of where arbitrary strings fragments
where generated.

@module
 */

type Location = {
  path?: string
  line?: string
  column?: string
}


/**
A text fragment, tagged with where it was generated.
 */
class CodeFragment {

  #fragment: string
  #location: Location | undefined

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

        this.#location = {
          path: m?.groups?.path,
          line: m?.groups?.line,
          column: m?.groups?.column,
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
   */
  render(args: { include_location?: boolean }): string {
    let result = this.#fragment
    if (args.include_location) {
      const file = path.basename(this.#location?.path ?? '?')
      const line = this.#location?.line ?? 'X'
      result += `/* ${file}:${line} */`
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
  ...args: any[]
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
