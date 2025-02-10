/**
Actuall declarations vendored from the [vlq](https://github.com/Rich-Harris/vlq) module, since the TypeScript compiler somehow fails to find the declarations.


@module
 */

declare module 'vlq' {

  /** @param {string} string */
  export function decode(string: string): number[];
  /** @param {number | number[]} value */
  export function encode(value: number | number[]): string;

}
