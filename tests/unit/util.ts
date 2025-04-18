import { expect } from 'chai'

import {
  parse_uri_path,
} from '../../src/formatters/util'

import {
  accumulate,
  concat,
  intersperse,
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

describe('concat', () => {
  it('should concat a list of lists into a flat list', () => {
    expect(concat([[1, 2], [3, 4]]))
      .to.deep.equal([1, 2, 3, 4])
  })

  it('Should not flatten sub-sub lists', () => {
    expect(concat([[[1]], [2]] as (number | number[])[][]))
      .to.deep.equal([[1], 2])
  })
})

describe('intersperse', () => {
  it('Should insert an element BETWEEN every element', () => {
    expect(intersperse(0, [1, 2, 3]))
      .to.deep.equal([1, 0, 2, 0, 3])
  })

  it('Should do nothing for singleton lists', () => {
    expect(intersperse(0, [1]))
      .to.deep.equal([1])
  })
})
