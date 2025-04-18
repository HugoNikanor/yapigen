export {
  APIMalformedError,
}

export { Unlist } from '@todo-3.0/lib/unlist'

class APIMalformedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'APIMalformedError'
  }
}
