export { CountedSymbol }

/**
A "symbol" which counts how many times its been accessed.

The generated code may optionally require some libraries. Declaring a
CountedSymbol for the library allows us to generate the code, and the
easily check if the branches taken actually needed the library, and
only include it if need be.
 */
class CountedSymbol {
  #count: number = 0
  readonly #symbol: string

  constructor(symbol: string) {
    this.#symbol = symbol
  }

  toString() {
    this.#count ++
    return this.#symbol
  }

  get count() { return this.#count }

}
