export {
  object_to_type,
  ObjectField,
  ts_string,
  map_to_ts_object,
  generate_funcall,
  generate_switch,
  get_here,
  parse_uri_path,
  LocationIdentifier,
}

import { escape } from '../escape'
import { cf, CodeFragment } from '../code-fragment'

/**
Entry in an object mapping keys to types.

For use with `object_to_type`.
 */
type ObjectField = {
  /** Key name.
  By default treated as a string literal, but will be passed unquoted
  to the output if `raw` is true.
   */
  name: string,
  /** type for this field. */
  type: CodeFragment[],
  /** Is this field optional? Defaults to false. */
  optional?: boolean,
  /** see `name` */
  raw?: boolean,
}

function object_to_type(o: ObjectField[]): CodeFragment[] {
  if (o.length === 0) return [cf`Record<never, never>`]

  const body: CodeFragment[][] = o.map(({ name, type, optional, raw }) => [
    new CodeFragment(`${raw ? name : ts_string(name)}${optional === true ? '?' : ''}:`),
    ...type,
  ])

  return [cf`{`, ...body.flatMap(f => [...f, cf`,`]), cf`}`]
}


/**
Returns a value suitable for pasting into TypeScript code, which
evaluates to the source string.

Note that when creating a string containing interpolation, that the
interpolatin form is simply treated as part of the text here. This
means that nested interpolation will fail, due to the inner backticks
being escaped.

@example
```
ts_string('Hello') === '"Hello"'
ts_string('With ` and ${interpolate}', '`') === '`With \\` and ${interpolate}`'
```
 */
function ts_string(s: string, delim = '"'): string {
  return `${delim}${escape(delim, s)}${delim}`
}


/**
Create a TypeScript object literal fragment from a map.

- Keys are pasted in a safe way, meaning that no matter their contents they will be valid.
- Values **must** be contain valid TypeScript expressions.
 */
function map_to_ts_object(map: [string, CodeFragment[]][]): CodeFragment[] {
  const body = map
    .flatMap(([key, value]) => [
      cf`${ts_string(key)}: `, ...value, cf`,\n`,
    ])

  return [cf`{`, ...body, cf`}`]
}

/**
Create a TypeScript fragment for calling a function.

@param function_name
Name of function to call. Must be a valid TypeScript expression
evaluating to a function value.

@param parameters
Each parameter must be a TypeScript expression usable as a function parameter.
Note that top level commas (`,`) are **not** escaped, meaning that one
parameter might turn into multiple in the output.
 */
function generate_funcall(
  function_name: string,
  ...parameters: CodeFragment[][]
): CodeFragment[] {
  const retval: CodeFragment[] = [cf`${function_name}(`]
  for (const parameter of parameters) {
    retval.push(...parameter, cf`,\n`)
  }
  retval.push(cf`)`)
  return retval
}

type LocationIdentifier = {
  error: Error,
}

/**
Generate a source location, suitable to pass to `generate_switch`.

NOTE this documentation should be updated as more forms starts using
this function.
 */
function get_here(): LocationIdentifier {
  return { error: new Error }
}

/**
Create a TypeScript fragment containing a switch statement.

@param expression
Expression to switch on. Must be a valid TypeScript expression.

@param location
Where the code was called from. This is used to insert source location
for a few generated CodeFragment objects (instead of all switch
statements stating that they originates from this function).

The location object is acquired by calling `get_here`.

This parameter is needed due to how JavaScript manages its call stack.

@param clauses
Each clause of the switch case. Each entry must resolve to a string
beginning with either `case <label>`, or `default`. Note that *no*
transformation is done of the clause body, meaning that ending with a
`break` is the responsibility of the caller (as well as providing a
local variable scope by wrapping the clause body in curly braces).
 */
function generate_switch(
  expression: string,
  location: LocationIdentifier,
  ...clauses: CodeFragment[]
): CodeFragment[] {
  const fragments: CodeFragment[] = []

  fragments.push(new CodeFragment(`switch (${expression}) {\n`, { error: location.error }))
  fragments.push(...clauses)
  fragments.push(new CodeFragment(`}\n`, { error: location.error }))

  return fragments
}


/**
Parses a path component from an OpenAPI schema into a template string,
and it's template components.

@param path
Source URI path, as present in the OpenAPI specification.

@param replacement
Function to generate a replacement string for each parameter.

@return
P pair consisting of
- a TypeScript expression evaluating to a string, where each path
  parameter (`{<name>}`) is replaced by calling `replacemeng` with its
  text content. So `replacement` would be called with <name>, but the
  curly braces would also be removed.
- a list of all found parameters.

@example
```typescript
parse_uri_path('/entry/{id}/completed', (x) => `:${x}:`) === ['`/entry/:id:/completed`', ['id']]
  ```
 */
function parse_uri_path(
  path: string,
  replacement: (source: string) => string,
): [string, string[]] {
  let substring_start = 0
  const parameters = []
  let template = ''
  for (const m of path.matchAll(/{([^}]+)}/g)) {

    template += path.substring(substring_start, m.index)
    // template += '${' + parameters_object + '[' + ts_string(m[1]) + ']}'
    template += replacement(m[1])

    parameters.push(m[1])
    /* c8 ignore next */
    if (!('index' in m)) throw new Error
    substring_start = m.index! + m[0].length
  }

  template += path.substring(substring_start)

  return [ts_string(template, "`"), parameters]
}
