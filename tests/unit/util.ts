import { expect } from 'chai'

import {
  parse_uri_path,
} from '../../src/formatters/util'

import {
  zip,
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



describe('zip', () => {
  it('Should zip lists of equal lengths', () => {
    expect(zip([1, 2, 3, 4, 5], "Hello".split('')))
      .to.deep.equal([
        [1, 'H'],
        [2, 'e'],
        [3, 'l'],
        [4, 'l'],
        [5, 'o'],
      ])
  })

  it('Should work with a shorter left list', () => {
    expect(zip([0], 'Hello'.split('')))
      .to.deep.equal([[0, 'H']])
  })

  it('Should work with a shorter right list', () => {
    expect(zip('Hello'.split(''), [0]))
      .to.deep.equal([['H', 0]])
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
