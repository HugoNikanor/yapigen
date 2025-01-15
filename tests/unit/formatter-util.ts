import { expect } from 'chai'

import { ts_string } from '../../src/formatters/util'

describe('ts_string', () => {
  it('Should handle basic strings', () =>
    expect(ts_string('Hello')).to.equal('"Hello"'))

  it('Should handle escaped quotes, other quotes, and interpolation', () =>
    expect(ts_string('With ` and ${interpolate}', '`'))
      .to.equal('`With \\` and ${interpolate}`'))
})
