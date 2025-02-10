export {
  intersperse,
  concat,
  zip,
  accumulate,
}

function intersperse<T>(el: T, lst: T[]): T[] {
  if (lst.length === 0) return []
  const result: T[] = [lst[0]]
  for (const item of lst.slice(1)) {
    result.push(el, item)
  }
  return result
}

function concat<T>(lst: T[][]): T[] {
  return lst.flatMap(x => x)
}


/**
"Zips" two lists inco one list of pairs.

If the lists are of the same length, then
`result[i][0] === l1[i] && result[i][1] === l2[i]`
will always be true.

If the lists are of different lengths, then the resulting list will
only be as long as the shortest of the input lists.
 */
function zip<T, V>(l1: T[], l2: V[]): [T, V][] {
  const result: [T, V][] = []
  for (let i = 0; i < Math.min(l1.length, l2.length); i++) {
    result.push([l1[i], l2[i]])
  }
  return result
}

/**
Accumulate a list of differences, into a list of numbers
 */
function accumulate(l: number[]): number[] {
  let current = 0
  const result = []
  for (const offset of l) {
    current += offset
    result.push(current)
  }
  return result
}
