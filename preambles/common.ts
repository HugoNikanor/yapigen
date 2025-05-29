export {
  APIMalformedError,
}

class APIMalformedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'APIMalformedError'
  }
}
