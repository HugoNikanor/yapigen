import { expect } from 'chai'

import {
  parse_uri_path,
} from '../../src/formatters/util'

import {
  accumulate,
} from '../../src/util'

describe('parse_uri_path', () => {
  it('should return as expected', () => {
    expect(parse_uri_path(
      '/entry/{id}/completed',
      (s) => `[${s}]`)
    ).to.deep.equal(['`/entry/[id]/completed`', ['id']])
  })
})

describe('accumulate', () => {
  it('should handle starting at 0', () => {
    expect(accumulate([0, 5, 7, 3])).to.deep.equal([0, 5, 12, 15])
  })
  it('should handle starting at not 0', () => {
    expect(accumulate([5, 15, 10])).to.deep.equal([5, 20, 30])
  })
})
