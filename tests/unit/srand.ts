import { expect } from 'chai'
import { sfc32 } from '../../src/srand'

const random1 = sfc32([1, 2, 3, 4])
const random2 = sfc32([1, 2, 3, 4])

describe('random', () => {
  const seq1 = [random1(), random1(), random1()]
  const seq2 = [random2(), random2(), random2()]


  it('should return the same numbers each time', () => {
    expect(seq1).to.deep.equal(seq2)
  })
})
