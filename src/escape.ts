export { escape }

/**
Escape all instances of `char` in `string` by prepending a backslash to it.
Also escapes backslashes
 */
function escape(char: string, string: string): string {
  return string.split('').flatMap((c) =>
    (c === char || c === '\\') ? `\\${c}` :
      c).join('')
}
