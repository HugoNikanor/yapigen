export {
  APIMalformedError,
  Unlist,
}


class APIMalformedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'APIMalformedError'
  }
}

type Unlist<T> = T extends readonly [infer First, ...infer Rest]
  ? First | Unlist<Rest>
  : never
