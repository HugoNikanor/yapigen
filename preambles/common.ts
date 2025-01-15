export {
  UnknownStatusCode,
  UnknownContentType,
  InvalidData,
  InternalRequestError,
  Unlist,
}

class UnknownStatusCode extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnknownStatusCode'
  }
}

class UnknownContentType extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnknownContentType'
  }
}

class InvalidData extends Error {

  location: 'header' | 'body'

  constructor(location: 'header' | 'body', message: string) {
    super(message)
    this.location = location
    this.name = 'InvalidData'
  }
}

class InternalRequestError extends Error {
  msg: string
  errtype: 'server' | 'network' | 'user' | 'api'
  from: 'api' | 'auth' | 'user'

  constructor(args: {
    msg: string,
    errtype: 'server' | 'network' | 'user' | 'api',
    from: 'api' | 'auth' | 'user',
  }) {
    const message = `${args.errtype}: ${args.msg}, from ${args.from}`
    super(message)
    this.name = 'InternalRequestError'
    this.msg = args.msg
    this.errtype = args.errtype
    this.from = args.from
  }
}

type Unlist<T> = T extends readonly [infer First, ...infer Rest]
  ? First | Unlist<Rest>
  : never
