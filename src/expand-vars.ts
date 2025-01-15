export { expand_vars }

/**
Expand variables in a string, filling in the holes the process
environment variables.

NOTE this is really close to parse_uri_path, maybe merge them.
 */
function expand_vars(source: string): string {
  let last_idx = 0
  let result = ''
  for (const m of source.matchAll(/\$\{(\w+)\}/g)) {
    result += source.substring(last_idx, m.index)
    last_idx = m.index + m[0].length

    const value = process.env[m[1]]
    if (value === undefined) {
      throw new Error(`Referenced environment variable '${m[1]}', but it's not defined`)
    }

    result += value
  }

  result += source.substring(last_idx)

  return result
}

