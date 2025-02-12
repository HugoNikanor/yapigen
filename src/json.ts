export type { Json }

/**
JSON types.

TODO move this to a general interface, and extend `JSON.parse` to return this
type.
 */
type Json
  = number
  | string
  | boolean
  | null
  | Json[]
  | { [key: string]: Json }


declare global {
  interface JSON {
    parse(s: string): Json
    stringify(x: Json): string
  }
}
