import { expect } from 'chai'

import { parse_uri_path } from '../../src/formatters/util'

describe('parse_uri_path', () => {
  it('should return as expected', () => {
    expect(parse_uri_path(
      '/entry/{id}/completed',
      (s) => `[${s}]`)
    ).to.deep.equal(['`/entry/[id]/completed`', ['id']])
  })
})
